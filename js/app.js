/**
 * app.js v4 — Bootstrap: load registry, init core managers, wire UI.
 * v4: Per-window config (no central manifest), client-side window import.
 */

import { settings } from './core/settings.js';
import { windowManager } from './core/window-manager.js';
import { dragEngine } from './core/drag-engine.js';
import { resizeEngine } from './core/resize-engine.js';
import { contextMenu } from './core/context-menu.js';
import { layoutManager } from './core/layout-manager.js';
import { commentManager } from './core/comment-manager.js';
import { exportManager } from './core/export-manager.js';
import { githubAuth } from './core/github-auth.js';
import { discussionManager } from './core/discussion-manager.js';

let manifest = null;  // built dynamically from registry + per-window configs
let backgroundsList = [];

/* ── Global toast function ────────────────────────────── */
window.rfoToast = function(message, type = 'info') {
  const container = document.getElementById('rfo-toasts');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `rfo-toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
};

/* ═══════════════════════════════════════════════════════
   BOOTSTRAP
   ═══════════════════════════════════════════════════════ */
async function boot() {
  const viewport = document.getElementById('rfo-viewport');
  const windowsLayer = document.getElementById('rfo-windows');

  // 1. Load window registry (simple array of window IDs)
  const regResp = await fetch('windows/registry.json');
  const registry = await regResp.json();

  // Build manifest from per-window configs
  manifest = { windows: [] };

  // 2. Load backgrounds list
  try {
    const bgResp = await fetch('assets/backgrounds/backgrounds.json');
    backgroundsList = await bgResp.json();
  } catch {
    backgroundsList = [];
  }

  // 3. Init engines
  dragEngine.init(viewport);
  resizeEngine.init(viewport);
  commentManager.init();
  discussionManager.init();
  layoutManager.init({ commentManager });
  exportManager.init();

  // 3b. Init GitHub auth (handles OAuth callback if ?code= present)
  const loggedIn = await githubAuth.init();
  githubAuth.onAuthChange(updateAuthUI);
  updateAuthUI(githubAuth.user);

  // 4. Load each window from registry
  for (const windowId of registry) {
    await loadWindowById(windowId, windowsLayer);
  }

  // 5. Init context menu (needs manifest)
  contextMenu.init({
    manifest,
    onExportWindow: (id) => exportManager.exportWindow(id),
  });

  // 6. Apply settings to UI — auto-fit if enabled, else use saved scale
  if (settings.get('autoFitScale')) {
    const ww = window.innerWidth - 40;
    const wh = window.innerHeight - 20;
    const fit = Math.min(ww / 1920, wh / 1080);
    const autoScale = Math.max(0.3, Math.min(2, fit));
    settings.set('scale', autoScale);
    applyScale(autoScale);
  } else {
    applyScale(settings.get('scale'));
  }
  applyBackground(settings.get('background'), settings.get('backgroundType'));

  // 7. Try to load from URL, then autosave, then default
  if (!layoutManager.loadFromURL()) {
    if (!layoutManager.loadAutoSave()) {
      for (const wDef of manifest.windows) {
        windowManager.resetPosition(wDef.id, manifest);
        if (wDef.defaultOpen) windowManager.open(wDef.id);
      }
    }
  }

  // 8. Wire UI controls
  wireControlPanel();
  wireKeyboardShortcuts();
  wireAuthButtons();
  updateModeIndicator(settings.get('mode'));

  // 9. Load remote pins from GitHub (non-blocking)
  commentManager.loadRemotePins().catch(() => {});

  // 10. Hide loading screen and open all windows initially
  const loadingScreen = document.getElementById('rfo-loading-screen');
  if (loadingScreen) {
    loadingScreen.classList.add('hidden');
    setTimeout(() => loadingScreen.remove(), 500); // Wait for transition
  }

  // Open all windows
  for (const w of windowManager.getAll()) {
    windowManager.open(w.id);
  }

  // 11. Show panel arrow briefly
  const arrow = document.getElementById('rfo-panel-arrow');
  if (arrow) {
    arrow.removeAttribute('hidden');
    setTimeout(() => {
      arrow.setAttribute('hidden', '');
    }, 2000);
  }

  console.log('[RFO UI Emulator] Ready —', manifest.windows.length, 'windows loaded');
}

/* ═══════════════════════════════════════════════════════
   WINDOW LOADER
   ═══════════════════════════════════════════════════════ */
async function loadWindowById(windowId, windowsLayer) {
  const folder = `windows/${windowId}`;

  const configModule = await import(`../${folder}/config.js`);
  const config = configModule.default;

  // Build wDef from config (per-window manifest)
  const wDef = {
    id: config.id,
    name: config.title,
    folder,
    defaultPosition: config.defaultPosition || { x: 100, y: 100, width: 300, height: 200 },
    defaultOpen: config.defaultOpen ?? false,
  };
  manifest.windows.push(wDef);

  await _mountWindow(wDef, config, folder, windowsLayer);
}

/** Mount a window given its wDef, config, folder path, and DOM layer */
async function _mountWindow(wDef, config, folder, windowsLayer) {
  const htmlResp = await fetch(`${folder}/template.html`);
  const htmlText = await htmlResp.text();

  const cssResp = await fetch(`${folder}/style.css`);
  const cssText = await cssResp.text();

  _injectWindow(wDef, config, htmlText, cssText, windowsLayer);
}

/** Inject window from raw strings (used by both file-based and imported). */
function _injectWindow(wDef, config, htmlText, cssText, windowsLayer) {
  const scopedCSS = scopeCSS(cssText, wDef.id);

  const styleEl = document.createElement('style');
  styleEl.dataset.windowId = wDef.id;
  styleEl.textContent = scopedCSS;
  document.head.appendChild(styleEl);

  const container = document.createElement('div');
  container.className = 'rfo-window';
  container.dataset.windowId = wDef.id;
  container.innerHTML = htmlText;

  const dp = wDef.defaultPosition;
  if (dp) {
    container.style.left = dp.x + 'px';
    container.style.top = dp.y + 'px';
    if (dp.width) container.style.width = dp.width + 'px';
    if (dp.height) container.style.height = dp.height + 'px';
  }

  windowsLayer.appendChild(container);

  windowManager.register(wDef.id, config, container);
  dragEngine.attach(wDef.id);
  resizeEngine.attach(wDef.id);

  if (typeof config.init === 'function') {
    config.init(container);
  }
}

/* ═══════════════════════════════════════════════════════
   CLIENT-SIDE WINDOW IMPORT
   ═══════════════════════════════════════════════════════ */

/** Import a window from user-provided files (ZIP or individual files). */
async function importWindowFromFiles(files) {
  let configText = '', htmlText = '', cssText = '';

  // Check if it's a ZIP file
  if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
    if (typeof JSZip === 'undefined') {
      window.rfoToast('JSZip not loaded', 'error');
      return;
    }
    const zip = await JSZip.loadAsync(files[0]);

    // Find files — may be at root or inside a subfolder
    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const name = path.split('/').pop().toLowerCase();
      if (name === 'config.js') configText = await entry.async('string');
      else if (name === 'template.html') htmlText = await entry.async('string');
      else if (name === 'style.css') cssText = await entry.async('string');
    }
  } else {
    // Individual files
    for (const file of files) {
      const name = file.name.toLowerCase();
      const text = await file.text();
      if (name === 'config.js') configText = text;
      else if (name === 'template.html') htmlText = text;
      else if (name === 'style.css') cssText = text;
    }
  }

  if (!configText) {
    window.rfoToast('config.js not found in import', 'error');
    return;
  }
  if (!htmlText) {
    window.rfoToast('template.html not found in import', 'error');
    return;
  }

  // Parse config.js via blob URL dynamic import
  const blob = new Blob([configText], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  let config;
  try {
    const mod = await import(blobUrl);
    config = mod.default;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }

  if (!config || !config.id) {
    window.rfoToast('Invalid config.js — missing id', 'error');
    return;
  }

  // Check for duplicate
  if (windowManager.get(config.id)) {
    window.rfoToast(`Window "${config.id}" already exists`, 'error');
    return;
  }

  const wDef = {
    id: config.id,
    name: config.title || config.id,
    folder: `_imported/${config.id}`,
    defaultPosition: config.defaultPosition || { x: 100, y: 100, width: 380, height: 320 },
    defaultOpen: true,
    _imported: true,
  };

  manifest.windows.push(wDef);

  const windowsLayer = document.getElementById('rfo-windows');
  _injectWindow(wDef, config, htmlText, cssText || '', windowsLayer);
  windowManager.open(wDef.id);

  // Rebuild windows list in panel
  _rebuildWindowsList();

  window.rfoToast(`Window "${config.title || config.id}" imported!`, 'success');
}

/** Import windows directly from a GitHub branch URL */
async function importWindowsFromGithub(url) {
  // Expected URL format: https://github.com/{user}/{repo}/tree/{branch}

  const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/tree\/(.+)/);
  if (!match) {
    window.rfoToast('Invalid GitHub URL. Must be a branch tree URL (e.g. github.com/user/repo/tree/branch)', 'error');
    return;
  }

  const [_, user, repo, branch] = match;
  window.rfoToast(`Fetching windows from ${user}/${repo} (${branch})...`, 'info');

  try {
    const apiURL = `https://api.github.com/repos/${user}/${repo}/contents/windows?ref=${branch}`;
    const response = await fetch(apiURL);
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const contents = await response.json();
    if (!Array.isArray(contents)) throw new Error('Could not read windows directory');

    let importedCount = 0;
    const windowsLayer = document.getElementById('rfo-windows');

    for (const item of contents) {
      if (item.type !== 'dir') continue;

      const folderName = item.name;
      // Skip if already in registry/imported
      if (windowManager.get(folderName)) continue;

      try {
        const rawBase = `https://raw.githubusercontent.com/${user}/${repo}/${branch}/windows/${folderName}`;

        // Fetch config.js
        const configResp = await fetch(`${rawBase}/config.js`);
        if (!configResp.ok) continue;
        const configText = await configResp.text();

        // Fetch template.html
        const htmlResp = await fetch(`${rawBase}/template.html`);
        if (!htmlResp.ok) continue;
        const htmlText = await htmlResp.text();

        // Fetch style.css (optional)
        const cssResp = await fetch(`${rawBase}/style.css`);
        const cssText = cssResp.ok ? await cssResp.text() : '';

        // Import the window dynamically
        const blob = new Blob([configText], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        let config;
        try {
          const mod = await import(blobUrl);
          config = mod.default;
        } finally {
          URL.revokeObjectURL(blobUrl);
        }

        if (!config || !config.id) continue;

        const wDef = {
          id: config.id,
          name: config.title || config.id,
          folder: `_imported/${config.id}`,
          defaultPosition: config.defaultPosition || { x: 100, y: 100, width: 380, height: 320 },
          defaultOpen: true,
          _imported: true,
        };

        manifest.windows.push(wDef);
        _injectWindow(wDef, config, htmlText, cssText, windowsLayer);
        windowManager.open(wDef.id);

        importedCount++;
      } catch (err) {
        console.warn(`[GitHub Import] Failed to import ${folderName}:`, err);
      }
    }

    if (importedCount > 0) {
      _rebuildWindowsList();
      window.rfoToast(`Imported ${importedCount} new windows from GitHub!`, 'success');
    } else {
      window.rfoToast('No new windows found to import.', 'info');
    }

  } catch (error) {
    console.error('[GitHub Import]', error);
    window.rfoToast(`GitHub Import Failed: ${error.message}`, 'error');
  }
}

/** Expose for rebuildWindowsList after import */
let _rebuildWindowsList = () => {};

function scopeCSS(cssText, windowId) {
  const scope = `[data-window-id="${windowId}"]`;
  return cssText.replace(
    /([^{}@]+)\{/g,
    (match, selectorGroup) => {
      const trimmed = selectorGroup.trim();
      if (trimmed.startsWith('@') || trimmed === 'from' || trimmed === 'to' || /^\d+%$/.test(trimmed)) {
        return match;
      }
      const scoped = trimmed.split(',').map(sel => {
        sel = sel.trim();
        if (!sel) return sel;
        if (sel === ':root' || sel === ':host') return scope;
        return `${scope} ${sel}`;
      }).join(', ');
      return scoped + ' {';
    }
  );
}

/* ═══════════════════════════════════════════════════════
   MODE INDICATOR
   ═══════════════════════════════════════════════════════ */
const modeInfo = {
  design:  { icon: '<svg class="si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>', label: 'Design Mode' },
  export:  { icon: '<svg class="si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>', label: 'Export Mode' },
  comment: { icon: '<svg class="si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>', label: 'Comment Mode' },
};

function updateModeIndicator(mode) {
  document.body.dataset.mode = mode;
  const indicator = document.getElementById('rfo-mode-indicator');
  if (!indicator) return;
  const info = modeInfo[mode] || modeInfo.design;
  indicator.querySelector('.mode-icon').innerHTML = info.icon;
  indicator.querySelector('.mode-label').textContent = info.label;
}

/* ═══════════════════════════════════════════════════════
   CONTROL PANEL WIRING
   ═══════════════════════════════════════════════════════ */
function wireControlPanel() {
  const panel = document.getElementById('rfo-control-panel');
  const toggleBtn = document.getElementById('rfo-panel-toggle');
  const closeBtn = document.getElementById('rfo-panel-close');

  toggleBtn.addEventListener('click', () => panel.classList.toggle('closed'));
  closeBtn.addEventListener('click', () => panel.classList.add('closed'));

  // ── Guide dialog ──────────────────────────────────
  const guideBtn = document.getElementById('rfo-guide-btn');
  const guideOverlay = document.getElementById('rfo-guide-overlay');
  const guideClose = document.getElementById('rfo-guide-close');
  if (guideBtn && guideOverlay) {
    guideBtn.addEventListener('click', () => { guideOverlay.hidden = false; });
    guideClose?.addEventListener('click', () => { guideOverlay.hidden = true; });
    guideOverlay.addEventListener('click', (e) => {
      if (e.target === guideOverlay) guideOverlay.hidden = true;
    });

    // Copy buttons on code blocks
    guideOverlay.querySelectorAll('.rfo-guide-section pre').forEach(pre => {
      const btn = document.createElement('button');
      btn.className = 'rfo-guide-copy-btn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', () => {
        const code = pre.querySelector('code');
        const text = code ? code.textContent : pre.textContent;
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
        });
      });
      pre.appendChild(btn);
    });

    // Export guide as .md
    document.getElementById('rfo-guide-export-md')?.addEventListener('click', () => {
      const md = _buildGuideMD();
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'rfo-window-guide.md';
      a.click();
      URL.revokeObjectURL(url);
      window.rfoToast('Guide exported as .md', 'success');
    });
  }

  // ── Mode buttons ──────────────────────────────────
  const modeButtons = document.querySelectorAll('.mode-btn');
  const exportPanel = document.getElementById('rfo-export-panel');
  const commentPanel = document.getElementById('rfo-comment-panel');

  function setMode(mode) {
    settings.set('mode', mode);
    modeButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
    exportPanel.hidden = mode !== 'export';
    commentPanel.hidden = mode !== 'comment';
    commentManager.showToolbar(mode === 'comment');
    updateModeIndicator(mode);
  }

  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  setMode(settings.get('mode'));

  // ── Windows list ──────────────────────────────────
  const windowsList = document.getElementById('rfo-windows-list');
  function buildWindowsList() {
    windowsList.innerHTML = '';
    for (const w of windowManager.getAll()) {
      const item = document.createElement('div');
      item.className = 'window-list-item';
      const toggle = document.createElement('button');
      toggle.className = 'window-list-toggle' + (w.open ? ' on' : '');
      toggle.addEventListener('click', () => {
        windowManager.toggle(w.id);
        toggle.classList.toggle('on', windowManager.isOpen(w.id));
      });
      item.innerHTML = `<span>${w.config.title || w.id}</span>`;
      item.appendChild(toggle);
      windowsList.appendChild(item);
    }
  }

  buildWindowsList();
  _rebuildWindowsList = buildWindowsList; // expose for import
  windowManager.on('window:opened', buildWindowsList);
  windowManager.on('window:closed', buildWindowsList);

  // ── Import Window ─────────────────────────────────
  const importFile = document.getElementById('rfo-import-file');
  if (importFile) {
    importFile.addEventListener('change', async (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      await importWindowFromFiles(files);
      importFile.value = '';
    });
  }

  // ── Import from GitHub ────────────────────────────
  const ghUrlInput = document.getElementById('rfo-import-gh-url');
  const ghImportBtn = document.getElementById('rfo-import-gh-btn');
  if (ghUrlInput && ghImportBtn) {
    ghImportBtn.addEventListener('click', async () => {
      const url = ghUrlInput.value.trim();
      if (!url) return;
      ghImportBtn.disabled = true;
      ghImportBtn.style.opacity = '0.5';
      await importWindowsFromGithub(url);
      ghImportBtn.disabled = false;
      ghImportBtn.style.opacity = '1';
      ghUrlInput.value = '';
    });
  }

  // ── Open All / Close All ──────────────────────────
  document.getElementById('rfo-open-all')?.addEventListener('click', () => {
    for (const w of windowManager.getAll()) windowManager.open(w.id);
  });
  document.getElementById('rfo-close-all')?.addEventListener('click', () => {
    for (const w of windowManager.getAll()) windowManager.close(w.id);
  });

  // ── Auto-fit toggle ───────────────────────────────
  const autoFitCheck = document.getElementById('rfo-auto-fit');
  const scaleSlider = document.getElementById('rfo-scale-slider');
  const scaleValue = document.getElementById('rfo-scale-value');

  autoFitCheck.checked = settings.get('autoFitScale');

  // Sync slider to current scale (may have been auto-fitted in boot)
  const currentPct = Math.round(settings.get('scale') * 100);
  scaleSlider.value = currentPct;
  scaleValue.textContent = currentPct + '%';

  function computeFitScale() {
    const ww = window.innerWidth - 40;
    const wh = window.innerHeight - 20;
    const fit = Math.min(ww / 1920, wh / 1080);
    return Math.max(0.3, Math.min(2, fit));
  }

  function updateScaleUI(pct) {
    scaleSlider.value = pct;
    scaleValue.textContent = pct + '%';
    const val = pct / 100;
    settings.set('scale', val);
    applyScale(val);

    document.querySelectorAll('.scale-preset').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.scale) === pct);
    });
  }

  function applyAutoFit() {
    if (!settings.get('autoFitScale')) return;
    const fit = computeFitScale();
    const pct = Math.round(fit * 100);
    updateScaleUI(pct);
  }

  autoFitCheck.addEventListener('change', () => {
    settings.set('autoFitScale', autoFitCheck.checked);
    if (autoFitCheck.checked) applyAutoFit();
  });

  // On manual scale change, disable auto-fit
  scaleSlider.addEventListener('input', () => {
    settings.set('autoFitScale', false);
    autoFitCheck.checked = false;
    updateScaleUI(parseInt(scaleSlider.value));
  });

  document.querySelectorAll('.scale-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.set('autoFitScale', false);
      autoFitCheck.checked = false;
      updateScaleUI(parseInt(btn.dataset.scale));
    });
  });

  // Fit button
  document.getElementById('rfo-scale-fit')?.addEventListener('click', () => {
    settings.set('autoFitScale', true);
    autoFitCheck.checked = true;
    applyAutoFit();
  });

  // ── Screen bounds ─────────────────────────────────
  const boundsCheck = document.getElementById('rfo-screen-bounds');
  boundsCheck.checked = settings.get('screenBounds');
  boundsCheck.addEventListener('change', () => {
    settings.set('screenBounds', boundsCheck.checked);
  });

  // ── Snap to grid ──────────────────────────────────
  const snapCheck = document.getElementById('rfo-snap-grid');
  const gridSizeRow = document.getElementById('rfo-grid-size-row');
  const gridSizeInput = document.getElementById('rfo-grid-size');

  snapCheck.checked = settings.get('snapToGrid');
  gridSizeRow.style.display = snapCheck.checked ? 'flex' : 'none';

  snapCheck.addEventListener('change', () => {
    settings.set('snapToGrid', snapCheck.checked);
    gridSizeRow.style.display = snapCheck.checked ? 'flex' : 'none';
  });

  gridSizeInput.value = settings.get('gridSize');
  gridSizeInput.addEventListener('change', () => {
    settings.set('gridSize', parseInt(gridSizeInput.value) || 10);
  });

  // ── Background gallery ────────────────────────────
  buildBackgroundGallery();

  const bgFile = document.getElementById('rfo-bg-file');
  const bgClear = document.getElementById('rfo-bg-clear');

  bgFile.addEventListener('change', () => {
    const file = bgFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      const type = file.type.startsWith('video') ? 'video' : 'image';
      settings.set('background', url);
      settings.set('backgroundType', type);
      applyBackground(url, type);
      clearActiveThumb();
      window.rfoToast('Background uploaded', 'success');
    };
    reader.readAsDataURL(file);
  });

  bgClear.addEventListener('click', () => {
    settings.set('background', '');
    settings.set('backgroundType', '');
    applyBackground('', '');
    clearActiveThumb();
  });

  // ── Presets ───────────────────────────────────────
  const presetName = document.getElementById('rfo-preset-name');
  document.getElementById('rfo-preset-save').addEventListener('click', () => {
    layoutManager.downloadJSON(presetName.value || 'preset');
    window.rfoToast('Preset saved', 'success');
  });

  document.getElementById('rfo-preset-load').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await layoutManager.uploadJSON(file);
    buildWindowsList();
    window.rfoToast('Preset loaded', 'success');
  });

  document.getElementById('rfo-preset-share-url').addEventListener('click', () => {
    const url = layoutManager.shareURL(presetName.value || 'shared');
    navigator.clipboard.writeText(url).then(() => {
      window.rfoToast('URL copied to clipboard!', 'success');
    }).catch(() => {
      window.rfoToast('Failed to copy URL', 'error');
    });
  });

  document.getElementById('rfo-preset-reset').addEventListener('click', () => {
    layoutManager.resetAll(manifest);
    buildWindowsList();
    window.rfoToast('Layout reset to defaults', 'info');
  });
}

/* ═══════════════════════════════════════════════════════
   BACKGROUND GALLERY
   ═══════════════════════════════════════════════════════ */
function buildBackgroundGallery() {
  const gallery = document.getElementById('rfo-bg-gallery');
  if (!gallery || backgroundsList.length === 0) return;

  gallery.innerHTML = '';
  for (const bg of backgroundsList) {
    const thumb = document.createElement('div');
    thumb.className = 'bg-thumb';
    thumb.title = bg.name || bg.file;

    const img = document.createElement('img');
    img.src = bg.thumb || bg.path;
    img.alt = bg.name || bg.file;
    img.loading = 'lazy';
    thumb.appendChild(img);

    // Check if this is the currently active bg
    if (settings.get('background') === bg.path) {
      thumb.classList.add('active');
    }

    thumb.addEventListener('click', () => {
      const type = guessMediaType(bg.path);
      settings.set('background', bg.path);
      settings.set('backgroundType', type);
      applyBackground(bg.path, type);

      // Update active thumb
      gallery.querySelectorAll('.bg-thumb').forEach(t => t.classList.remove('active'));
      thumb.classList.add('active');
    });

    gallery.appendChild(thumb);
  }
}

function clearActiveThumb() {
  document.querySelectorAll('.bg-thumb.active').forEach(t => t.classList.remove('active'));
}

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */
function applyScale(scale) {
  const viewport = document.getElementById('rfo-viewport');
  viewport.style.setProperty('--ui-scale', scale);
  viewport.style.transform = `scale(${scale})`;

  const vw = 1920 * scale;
  const vh = 1080 * scale;
  const ww = window.innerWidth;
  const wh = window.innerHeight;
  viewport.style.left = vw < ww ? ((ww - vw) / 2) + 'px' : '0';
  viewport.style.top = vh < wh ? ((wh - vh) / 2) + 'px' : '0';
}

function applyBackground(url, type) {
  const bgEl = document.getElementById('rfo-background');
  bgEl.innerHTML = '';
  if (!url) return;

  if (type === 'video') {
    const video = document.createElement('video');
    video.src = url;
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    bgEl.appendChild(video);
  } else if (url) {
    const img = document.createElement('img');
    img.src = url;
    bgEl.appendChild(img);
  }
}

function guessMediaType(url) {
  if (!url) return '';
  const lower = url.toLowerCase();
  if (lower.endsWith('.mp4') || lower.endsWith('.webm')) return 'video';
  return 'image';
}

/* ═══════════════════════════════════════════════════════
   AUTH UI
   ═══════════════════════════════════════════════════════ */
function wireAuthButtons() {
  document.getElementById('rfo-gh-login')?.addEventListener('click', () => githubAuth.login());
  document.getElementById('rfo-gh-logout')?.addEventListener('click', () => {
    githubAuth.logout();
    commentManager.loadRemotePins().catch(() => {}); // refresh pins (permissions change)
  });
}

function updateAuthUI(user) {
  const loginBtn = document.getElementById('rfo-gh-login');
  const userEl = document.getElementById('rfo-gh-user');
  const avatarEl = document.getElementById('rfo-gh-avatar');
  const nameEl = document.getElementById('rfo-gh-username');
  const hintEl = document.getElementById('rfo-comment-hint');

  if (user) {
    if (loginBtn) loginBtn.classList.add('hidden');
    if (userEl) userEl.classList.remove('hidden');
    if (avatarEl) avatarEl.src = user.avatar_url;
    if (nameEl) nameEl.textContent = user.login;
    if (hintEl) hintEl.innerHTML = '<svg class="si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> Double-click on any window to add a comment pin';
  } else {
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (userEl) userEl.classList.add('hidden');
    if (hintEl) hintEl.innerHTML = '<svg class="si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> Sign in with GitHub to leave comment pins';
  }
}

/* ═══════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
   ═══════════════════════════════════════════════════════ */
function wireKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // F2 — toggle panel
    if (e.key === 'F2') {
      e.preventDefault();
      document.getElementById('rfo-control-panel').classList.toggle('closed');
    }

    // Escape — close guide dialog first, then focused window (topmost)
    if (e.key === 'Escape') {
      const guideOverlay = document.getElementById('rfo-guide-overlay');
      if (guideOverlay && !guideOverlay.hidden) {
        guideOverlay.hidden = true;
        return;
      }
      const stack = windowManager._zStack;
      if (stack.length > 0) {
        windowManager.close(stack[stack.length - 1]);
      }
    }

    // Ctrl+S — save preset to localStorage
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      layoutManager._autoSave();
      window.rfoToast('Layout saved', 'success');
    }

    // 1/2/3 — quick mode switch (when not in input)
    if (!e.target.closest('input, textarea, select')) {
      if (e.key === '1') settings.set('mode', 'design');
      if (e.key === '2') settings.set('mode', 'export');
      if (e.key === '3') settings.set('mode', 'comment');

      if (['1', '2', '3'].includes(e.key)) {
        const mode = settings.get('mode');
        document.querySelectorAll('.mode-btn').forEach(btn =>
          btn.classList.toggle('active', btn.dataset.mode === mode)
        );
        document.getElementById('rfo-export-panel').hidden = mode !== 'export';
        document.getElementById('rfo-comment-panel').hidden = mode !== 'comment';
        commentManager.showToolbar(mode === 'comment');
        updateModeIndicator(mode);
      }
    }
  });
}

/* ═══════════════════════════════════════════════════════
   RESIZE HANDLER — auto-fit if enabled, else just re-center
   ═══════════════════════════════════════════════════════ */
window.addEventListener('resize', () => {
  if (settings.get('autoFitScale')) {
    const ww = window.innerWidth - 40;
    const wh = window.innerHeight - 20;
    const fit = Math.max(0.3, Math.min(2, Math.min(ww / 1920, wh / 1080)));
    settings.set('scale', fit);
    applyScale(fit);
    // Sync slider UI if panel is open
    const slider = document.getElementById('rfo-scale-slider');
    const label = document.getElementById('rfo-scale-value');
    if (slider) slider.value = Math.round(fit * 100);
    if (label) label.textContent = Math.round(fit * 100) + '%';
  } else {
    applyScale(settings.get('scale'));
  }
});

/* ═══════════════════════════════════════════════════════
   GUIDE EXPORT — builds markdown from guide dialog DOM
   ═══════════════════════════════════════════════════════ */
function _buildGuideMD() {
  const lines = ['# How to Create & Import a Window\n'];
  const sections = document.querySelectorAll('.rfo-guide-section');
  sections.forEach(sec => {
    const h4 = sec.querySelector('h4');
    if (h4) lines.push(`## ${h4.textContent.trim()}\n`);
    sec.querySelectorAll(':scope > p, :scope > ol, :scope > pre').forEach(el => {
      if (el.tagName === 'P') {
        lines.push(el.textContent.trim() + '\n');
      } else if (el.tagName === 'OL') {
        el.querySelectorAll('li').forEach((li, i) => {
          lines.push(`${i + 1}. ${li.textContent.trim()}`);
        });
        lines.push('');
      } else if (el.tagName === 'PRE') {
        const code = el.querySelector('code');
        const text = code ? code.textContent : el.textContent;
        lines.push('```');
        lines.push(text.trim());
        lines.push('```\n');
      }
    });
  });
  return lines.join('\n');
}

/* ═══════════════════════════════════════════════════════
   IMAGE ZOOM MODAL (Global click handler)
   ═══════════════════════════════════════════════════════ */
document.addEventListener('click', (e) => {
  if (e.target.tagName === 'IMG') {
    const isZoomable = e.target.closest('.rfo-discussion-text') ||
                       e.target.closest('.comment-message') ||
                       e.target.closest('.comment-reply-text');
    if (isZoomable) {
      const modal = document.getElementById('rfo-image-modal');
      const img = document.getElementById('rfo-image-modal-img');
      if (modal && img) {
        img.src = e.target.src;
        modal.hidden = false;
      }
    }
  }

  // Close modal logic
  if (e.target.id === 'rfo-image-modal-close' || e.target.classList.contains('rfo-image-modal-backdrop')) {
    const modal = document.getElementById('rfo-image-modal');
    const img = document.getElementById('rfo-image-modal-img');
    if (modal && img) {
      modal.hidden = true;
      img.src = '';
    }
  }
});

/* ═══════════════════════════════════════════════════════
   START
   ═══════════════════════════════════════════════════════ */
boot().catch(err => console.error('[RFO UI Emulator] Boot failed:', err));
