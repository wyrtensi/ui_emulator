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
import { githubApi } from './core/github-api.js';
import { discussionManager } from './core/discussion-manager.js';

let manifest = null;  // built dynamically from registry + per-window configs
let backgroundsList = [];
let remoteConfig = null;

/* ── Global toast function ────────────────────────────── */
window.uiToast = function(message, type = 'info') {
  const container = document.getElementById('ui-toasts');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `ui-toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
};

/* ═══════════════════════════════════════════════════════
   BOOTSTRAP
   ═══════════════════════════════════════════════════════ */
async function boot() {
  const viewport = document.getElementById('ui-viewport');
  const windowsLayer = document.getElementById('ui-windows');

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

  // 3c. Load remote config if available
  try {
    const configResp = await fetch('config.json');
    if (configResp.ok) {
      remoteConfig = await configResp.json();
      if (remoteConfig.scale !== undefined && !localStorage.getItem('ui-ui-settings')) {
        settings.set('scale', remoteConfig.scale);
        settings.set('autoFitScale', false);
      }
      if (remoteConfig.bgScale !== undefined && !localStorage.getItem('ui-ui-settings')) {
        settings.set('bgScale', remoteConfig.bgScale);
      }
    }
  } catch (err) {
    // No remote config found, silently continue
  }

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
  applyBackgroundColor(settings.get('backgroundColor'));

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
  wireCanvasButton();
  updateModeIndicator(settings.get('mode'));

  // 9. Load remote pins from GitHub (non-blocking)
  commentManager.loadRemotePins().catch(() => {});

  // 10. Hide loading screen and open all windows initially
  const loadingScreen = document.getElementById('ui-loading-screen');
  if (loadingScreen) {
    loadingScreen.classList.add('hidden');
    setTimeout(() => loadingScreen.remove(), 500); // Wait for transition
  }

  // Open all windows
  for (const w of windowManager.getAll()) {
    windowManager.open(w.id);
  }

  // 11. Show panel arrow briefly
  const arrow = document.getElementById('ui-panel-arrow');
  if (arrow) {
    arrow.removeAttribute('hidden');
    setTimeout(() => {
      arrow.setAttribute('hidden', '');
    }, 2000);
  }

  // 12. Global hash listener for canvas links
  checkGlobalHash(window.location.hash);
  window.addEventListener('hashchange', () => checkGlobalHash(window.location.hash));

  console.log('[UI Emulator] Ready —', manifest.windows.length, 'windows loaded');
}

/** Global hash interceptor to ensure canvas window opens before its internal logic runs */
function checkGlobalHash(hash) {
  if (hash.startsWith('#canvas:')) {
    const canvasBtn = document.getElementById('ui-canvas-btn');
    if (!windowManager.get('canvas') && canvasBtn) {
      // It's not loaded yet, simulate click to load it
      canvasBtn.click();
    } else if (windowManager.get('canvas') && !windowManager.isOpen('canvas')) {
      // Loaded but closed, just open it
      windowManager.open('canvas');
    }
    // The internal logic in canvas-engine.js will handle the actual zooming
  }
}

/* ═══════════════════════════════════════════════════════
   WINDOW LOADER
   ═══════════════════════════════════════════════════════ */
async function loadWindowById(windowId, windowsLayer) {
  // If id is "canvas", force it to load from root /canvas folder instead of /windows
  const folder = windowId === 'canvas' ? 'canvas' : `windows/${windowId}`;

  let configModule;
try {
  configModule = await import(`../${folder}/config.js`).catch(e => { console.log("CATCH CAUGHT ERROR:", e.message); throw e; });
} catch(e) {
  console.error("IMPORT ERROR:", e);
  throw e;
}
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
  container.className = 'ui-window';
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
      window.uiToast('JSZip not loaded', 'error');
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
    window.uiToast('config.js not found in import', 'error');
    return;
  }
  if (!htmlText) {
    window.uiToast('template.html not found in import', 'error');
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
    window.uiToast('Invalid config.js — missing id', 'error');
    return;
  }

  // Check for duplicate
  if (windowManager.get(config.id)) {
    window.uiToast(`Window "${config.id}" already exists`, 'error');
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

  const windowsLayer = document.getElementById('ui-windows');
  _injectWindow(wDef, config, htmlText, cssText || '', windowsLayer);
  windowManager.open(wDef.id);

  // Rebuild windows list in panel
  _rebuildWindowsList();

  window.uiToast(`Window "${config.title || config.id}" imported!`, 'success');
}

/** Import windows directly from a GitHub branch URL */
async function importWindowsFromGithub(url) {
  // Expected URL format: https://github.com/{user}/{repo}/tree/{branch}

  const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/tree\/(.+)/);
  if (!match) {
    window.uiToast('Invalid GitHub URL. Must be a branch tree URL (e.g. github.com/user/repo/tree/branch)', 'error');
    return;
  }

  const [_, user, repo, branch] = match;
  window.uiToast(`Fetching windows from ${user}/${repo} (${branch})...`, 'info');

  try {
    const apiURL = `https://api.github.com/repos/${user}/${repo}/contents/windows?ref=${branch}`;
    const response = await fetch(apiURL);
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const contents = await response.json();
    if (!Array.isArray(contents)) throw new Error('Could not read windows directory');

    let importedCount = 0;
    const windowsLayer = document.getElementById('ui-windows');

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
      window.uiToast(`Imported ${importedCount} new windows from GitHub!`, 'success');
    } else {
      window.uiToast('No new windows found to import.', 'info');
    }

  } catch (error) {
    console.error('[GitHub Import]', error);
    window.uiToast(`GitHub Import Failed: ${error.message}`, 'error');
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
  const indicator = document.getElementById('ui-mode-indicator');
  if (!indicator) return;
  const info = modeInfo[mode] || modeInfo.design;
  indicator.querySelector('.mode-icon').innerHTML = info.icon;
  indicator.querySelector('.mode-label').textContent = info.label;
}

/* ═══════════════════════════════════════════════════════
   CONTROL PANEL WIRING
   ═══════════════════════════════════════════════════════ */
function wireControlPanel() {
  const panel = document.getElementById('ui-control-panel');
  const toggleBtn = document.getElementById('ui-panel-toggle');
  const closeBtn = document.getElementById('ui-panel-close');

  toggleBtn.addEventListener('click', () => {
    panel.classList.toggle('closed');
    document.body.dataset.panelOpen = !panel.classList.contains('closed');
  });
  closeBtn.addEventListener('click', () => {
    panel.classList.add('closed');
    document.body.dataset.panelOpen = 'false';
  });

  // ── Guide dialog ──────────────────────────────────
  const guideBtn = document.getElementById('ui-guide-btn');
  const guideOverlay = document.getElementById('ui-guide-overlay');
  const guideClose = document.getElementById('ui-guide-close');
  if (guideBtn && guideOverlay) {
    guideBtn.addEventListener('click', () => { guideOverlay.hidden = false; });
    guideClose?.addEventListener('click', () => { guideOverlay.hidden = true; });
    guideOverlay.addEventListener('click', (e) => {
      if (e.target === guideOverlay) guideOverlay.hidden = true;
    });

    // Copy buttons on code blocks
    guideOverlay.querySelectorAll('.ui-guide-section pre').forEach(pre => {
      const btn = document.createElement('button');
      btn.className = 'ui-guide-copy-btn';
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
    document.getElementById('ui-guide-export-md')?.addEventListener('click', () => {
      const md = _buildGuideMD();
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ui-window-guide.md';
      a.click();
      URL.revokeObjectURL(url);
      window.uiToast('Guide exported as .md', 'success');
    });
  }

  // ── Mode buttons ──────────────────────────────────
  const modeButtons = document.querySelectorAll('.mode-btn');
  const exportPanel = document.getElementById('ui-export-panel');
  const commentPanel = document.getElementById('ui-comment-panel');

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
  const windowsList = document.getElementById('ui-windows-list');
  function buildWindowsList() {
    windowsList.innerHTML = '';
    for (const w of windowManager.getAll()) {
      if (w.id === 'canvas') continue; // Hide canvas from windows list
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
  const importFile = document.getElementById('ui-import-file');
  if (importFile) {
    importFile.addEventListener('change', async (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      await importWindowFromFiles(files);
      importFile.value = '';
    });
  }

  // ── Import from GitHub ────────────────────────────
  const ghUrlInput = document.getElementById('ui-import-gh-url');
  const ghImportBtn = document.getElementById('ui-import-gh-btn');
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
  document.getElementById('ui-open-all')?.addEventListener('click', () => {
    for (const w of windowManager.getAll()) windowManager.open(w.id);
  });
  document.getElementById('ui-close-all')?.addEventListener('click', () => {
    for (const w of windowManager.getAll()) windowManager.close(w.id);
  });

  // ── Auto-fit toggle ───────────────────────────────
  const autoFitCheck = document.getElementById('ui-auto-fit');
  const scaleSlider = document.getElementById('ui-scale-slider');
  const scaleValue = document.getElementById('ui-scale-value');

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
  document.getElementById('ui-scale-fit')?.addEventListener('click', () => {
    settings.set('autoFitScale', true);
    autoFitCheck.checked = true;
    applyAutoFit();
  });

  // Set default button (Owner only)
  document.getElementById('ui-scale-default')?.addEventListener('click', async () => {
    if (!githubAuth.isOwner) return;
    const btn = document.getElementById('ui-scale-default');
    const oldText = btn.textContent;
    btn.textContent = 'Saving...';
    btn.disabled = true;

    try {
      remoteConfig = remoteConfig || {};
      remoteConfig.scale = settings.get('scale');
      await githubApi.saveFile('config.json', JSON.stringify(remoteConfig, null, 2), 'chore: Update default UI scale');
      window.uiToast('Saved default UI scale to repo', 'success');
    } catch (err) {
      window.uiToast('Failed to save default UI scale', 'error');
      console.error(err);
    } finally {
      btn.textContent = oldText;
      btn.disabled = false;
    }
  });

  // ── Background Zoom ──────────────────────────────
  const bgScaleSlider = document.getElementById('ui-bg-scale-slider');
  const bgScaleValue = document.getElementById('ui-bg-scale-val');

  if (bgScaleSlider && bgScaleValue) {
    const currentBgPct = Math.round((settings.get('bgScale') || 1.0) * 100);
    bgScaleSlider.value = currentBgPct;
    bgScaleValue.textContent = currentBgPct + '%';
    applyBgScale(settings.get('bgScale') || 1.0);

    function updateBgScaleUI(pct) {
      bgScaleSlider.value = pct;
      bgScaleValue.textContent = pct + '%';
      const val = pct / 100;
      settings.set('bgScale', val);
      applyBgScale(val);

      document.querySelectorAll('.bg-scale-preset').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.scale) === pct);
      });
    }

    bgScaleSlider.addEventListener('input', () => {
      updateBgScaleUI(parseInt(bgScaleSlider.value));
    });

    document.querySelectorAll('.bg-scale-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        updateBgScaleUI(parseInt(btn.dataset.scale));
      });
    });

    document.getElementById('ui-bg-scale-default')?.addEventListener('click', async () => {
      if (!githubAuth.isOwner) return;
      const btn = document.getElementById('ui-bg-scale-default');
      const oldText = btn.textContent;
      btn.textContent = 'Saving...';
      btn.disabled = true;

      try {
        remoteConfig = remoteConfig || {};
        remoteConfig.bgScale = settings.get('bgScale');
        await githubApi.saveFile('config.json', JSON.stringify(remoteConfig, null, 2), 'chore: Update default Background zoom');
        window.uiToast('Saved default Background zoom to repo', 'success');
      } catch (err) {
        window.uiToast('Failed to save default Background zoom', 'error');
        console.error(err);
      } finally {
        btn.textContent = oldText;
        btn.disabled = false;
      }
    });
  }

  // ── Screen bounds ─────────────────────────────────
  const boundsCheck = document.getElementById('ui-screen-bounds');
  boundsCheck.checked = settings.get('screenBounds');
  boundsCheck.addEventListener('change', () => {
    settings.set('screenBounds', boundsCheck.checked);
  });

  // ── Snap to grid ──────────────────────────────────
  const snapCheck = document.getElementById('ui-snap-grid');
  const gridSizeRow = document.getElementById('ui-grid-size-row');
  const gridSizeInput = document.getElementById('ui-grid-size');

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

  const bgFile = document.getElementById('ui-bg-file');
  const bgClear = document.getElementById('ui-bg-clear');
  const bgColorInput = document.getElementById('ui-bg-color');

  if (bgColorInput) {
    bgColorInput.value = settings.get('backgroundColor') || '#0a0e18';
    bgColorInput.addEventListener('input', (e) => {
      const color = e.target.value;
      settings.set('backgroundColor', color);
      applyBackgroundColor(color);
    });
  }

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
      window.uiToast('Background uploaded', 'success');
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
  const presetName = document.getElementById('ui-preset-name');
  document.getElementById('ui-preset-save').addEventListener('click', () => {
    layoutManager.downloadJSON(presetName.value || 'preset');
    window.uiToast('Preset saved', 'success');
  });

  document.getElementById('ui-preset-load').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await layoutManager.uploadJSON(file);
    buildWindowsList();
    window.uiToast('Preset loaded', 'success');
  });

  document.getElementById('ui-preset-share-url').addEventListener('click', () => {
    const url = layoutManager.shareURL(presetName.value || 'shared');
    navigator.clipboard.writeText(url).then(() => {
      window.uiToast('URL copied to clipboard!', 'success');
    }).catch(() => {
      window.uiToast('Failed to copy URL', 'error');
    });
  });

  document.getElementById('ui-preset-reset').addEventListener('click', () => {
    layoutManager.resetAll(manifest);
    buildWindowsList();
    window.uiToast('Layout reset to defaults', 'info');
  });
}

/* ═══════════════════════════════════════════════════════
   BACKGROUND GALLERY
   ═══════════════════════════════════════════════════════ */
function buildBackgroundGallery() {
  const gallery = document.getElementById('ui-bg-gallery');
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
  const viewport = document.getElementById('ui-viewport');
  viewport.style.setProperty('--ui-scale', scale);
  viewport.style.transform = `scale(${scale})`;

  const vw = 1920 * scale;
  const vh = 1080 * scale;
  const ww = window.innerWidth;
  const wh = window.innerHeight;

  // Calculate top-left based on scaled dimensions
  viewport.style.left = Math.max(0, (ww - vw) / 2) + 'px';
  viewport.style.top = Math.max(0, (wh - vh) / 2) + 'px';
}

function applyBgScale(scale) {
  document.documentElement.style.setProperty('--bg-scale', scale);
}

function applyBackground(url, type) {
  const bgEl = document.getElementById('ui-background');
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

function applyBackgroundColor(color) {
  const bgEl = document.getElementById('ui-background');
  if (bgEl && color) {
    bgEl.style.backgroundColor = color;
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
function wireCanvasButton() {
  const canvasBtn = document.getElementById('ui-canvas-btn');
  if (canvasBtn) {
    canvasBtn.addEventListener('click', () => {
      // Create if not exists in registry list, then toggle
      if (!windowManager.get('canvas')) {
        loadWindowById('canvas', document.getElementById('ui-windows')).then(() => {
          windowManager.open('canvas');
        }).catch(err => {
          console.error("Failed to load canvas module", err);
          window.uiToast('Failed to load canvas module', 'error');
        });
      } else {
        windowManager.toggle('canvas');
      }
    });
  }
}

function wireAuthButtons() {
  document.getElementById('ui-gh-login')?.addEventListener('click', () => githubAuth.login());
  document.getElementById('ui-gh-logout')?.addEventListener('click', () => {
    githubAuth.logout();
    commentManager.loadRemotePins().catch(() => {}); // refresh pins (permissions change)
  });
}

function updateAuthUI(user) {
  const loginBtn = document.getElementById('ui-gh-login');
  const userEl = document.getElementById('ui-gh-user');
  const avatarEl = document.getElementById('ui-gh-avatar');
  const nameEl = document.getElementById('ui-gh-username');
  const hintEl = document.getElementById('ui-comment-hint');

  if (user) {
    if (loginBtn) loginBtn.classList.add('hidden');
    if (userEl) userEl.classList.remove('hidden');
    if (avatarEl) avatarEl.src = user.avatar_url;
    if (nameEl) nameEl.textContent = user.login;
    if (hintEl) hintEl.innerHTML = '<svg class="si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> Double-click on any window to add a comment pin';

    if (githubAuth.isOwner) {
      document.getElementById('ui-scale-default')?.removeAttribute('hidden');
      document.getElementById('ui-bg-scale-default')?.removeAttribute('hidden');
    }
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
      document.getElementById('ui-control-panel').classList.toggle('closed');
    }

    // Escape — close guide dialog first, then focused window (topmost)
    if (e.key === 'Escape') {
      const guideOverlay = document.getElementById('ui-guide-overlay');
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
      window.uiToast('Layout saved', 'success');
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
        document.getElementById('ui-export-panel').hidden = mode !== 'export';
        document.getElementById('ui-comment-panel').hidden = mode !== 'comment';
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
    const slider = document.getElementById('ui-scale-slider');
    const label = document.getElementById('ui-scale-value');
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
  const sections = document.querySelectorAll('.ui-guide-section');
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
    const isZoomable = e.target.closest('.ui-discussion-text') ||
                       e.target.closest('.comment-message') ||
                       e.target.closest('.comment-reply-text');
    if (isZoomable) {
      const modal = document.getElementById('ui-image-modal');
      const img = document.getElementById('ui-image-modal-img');
      if (modal && img) {
        img.src = e.target.src;
        modal.hidden = false;
      }
    }
  }

  // Close modal logic
  if (e.target.id === 'ui-image-modal-close' || e.target.classList.contains('ui-image-modal-backdrop')) {
    const modal = document.getElementById('ui-image-modal');
    const img = document.getElementById('ui-image-modal-img');
    if (modal && img) {
      modal.hidden = true;
      img.src = '';
    }
  }
});

/* ═══════════════════════════════════════════════════════
   START
   ═══════════════════════════════════════════════════════ */
boot().catch(err => console.error('[UI Emulator] Boot failed:', err));
