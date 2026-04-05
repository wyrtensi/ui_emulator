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
import config from './config.js';

let manifest = null;  // built dynamically from registry + per-window configs
let backgroundsList = [];
let remoteConfig = null;
let remoteWindowDefaults = null;
let _activeVersionPrompt = null;

const WINDOW_OPACITY_MIN = 0;
const WINDOW_OPACITY_MAX = 100;
const WINDOW_OPACITY_DEFAULT = 100;
const windowOpacityModeMap = new Map();
const OWNER_DEFAULT_MODES = new Set(['design', 'export', 'comment']);

function normalizeRelativePath(path) {
  return String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .filter(seg => seg !== '.' && seg !== '..')
    .join('/');
}

function joinRelativePath(...parts) {
  return normalizeRelativePath(parts.filter(Boolean).join('/'));
}

function dirnamePath(path) {
  const norm = normalizeRelativePath(path);
  if (!norm) return '';
  const parts = norm.split('/');
  parts.pop();
  return parts.join('/');
}

function getWindowVersionEntries(configObj) {
  if (!configObj || typeof configObj !== 'object') return [];
  const versions = configObj.versions;
  if (!versions || typeof versions !== 'object' || Array.isArray(versions)) return [];

  const entries = [];
  for (const [key, raw] of Object.entries(versions)) {
    if (!key) continue;

    let folder = key;
    let configFile = 'config.js';
    let templateFile = 'template.html';
    let styleFile = 'style.css';
    let label = key;

    if (typeof raw === 'string') {
      folder = raw;
    } else if (raw && typeof raw === 'object') {
      folder = raw.folder || key;
      configFile = raw.config || configFile;
      templateFile = raw.template || templateFile;
      styleFile = raw.style || styleFile;
      label = raw.label || raw.title || key;
    } else {
      continue;
    }

    entries.push({
      key,
      label: String(label),
      folder: normalizeRelativePath(folder),
      configFile: normalizeRelativePath(configFile) || 'config.js',
      templateFile: normalizeRelativePath(templateFile) || 'template.html',
      styleFile: normalizeRelativePath(styleFile) || 'style.css',
    });
  }

  return entries;
}

function getDefaultWindowVersionKey(configObj, versionEntries) {
  const entries = Array.isArray(versionEntries) ? versionEntries : [];
  if (entries.length === 0) return null;
  const requested = configObj?.defaultVersion;
  if (requested && entries.some(e => e.key === requested)) return requested;
  return entries[0].key;
}

function getStoredWindowVersion(windowId) {
  if (!windowId) return null;
  const map = settings.get('windowVersions');
  if (!map || typeof map !== 'object') return null;
  return typeof map[windowId] === 'string' ? map[windowId] : null;
}

function setStoredWindowVersion(windowId, versionKey) {
  if (!windowId) return;
  const current = settings.get('windowVersions');
  const map = (current && typeof current === 'object') ? { ...current } : {};

  if (versionKey) map[windowId] = versionKey;
  else delete map[windowId];

  settings.set('windowVersions', map);
}

function getRemoteWindowVersion(windowId) {
  if (!windowId) return null;
  const map = remoteWindowDefaults?.windowVersions;
  if (!map || typeof map !== 'object') return null;
  return typeof map[windowId] === 'string' ? map[windowId] : null;
}

function getDefaultableWindowIds() {
  if (!manifest || !Array.isArray(manifest.windows)) return new Set();
  return new Set(
    manifest.windows
      .filter(w => !w._imported)
      .map(w => w.id)
  );
}

function getActiveWindowVersionMap() {
  const current = settings.get('windowVersions');
  const map = (current && typeof current === 'object') ? { ...current } : {};

  for (const w of windowManager.getAll()) {
    if (!w?.id) continue;
    const versionKey = w.config?._versionKey;
    if (typeof versionKey === 'string' && versionKey) {
      map[w.id] = versionKey;
    }
  }

  return map;
}

function normalizeWindowOpacityPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return WINDOW_OPACITY_DEFAULT;
  return Math.max(WINDOW_OPACITY_MIN, Math.min(WINDOW_OPACITY_MAX, Math.round(num)));
}

function normalizeWindowOpacityMap(rawMap) {
  if (!rawMap || typeof rawMap !== 'object') return {};

  const cleanMap = {};
  for (const [windowId, rawValue] of Object.entries(rawMap)) {
    if (!windowId) continue;
    const nextValue = normalizeWindowOpacityPercent(rawValue);
    if (nextValue !== WINDOW_OPACITY_DEFAULT) {
      cleanMap[windowId] = nextValue;
    }
  }

  return cleanMap;
}

function getWindowOpacityMap() {
  return normalizeWindowOpacityMap(settings.get('windowOpacity'));
}

function getWindowOpacityPercent(windowId) {
  if (!windowId) return WINDOW_OPACITY_DEFAULT;
  const map = getWindowOpacityMap();
  return map[windowId] ?? WINDOW_OPACITY_DEFAULT;
}

function setWindowOpacityPercent(windowId, value) {
  if (!windowId) return;

  const nextValue = normalizeWindowOpacityPercent(value);
  const currentMap = getWindowOpacityMap();
  const currentValue = currentMap[windowId] ?? WINDOW_OPACITY_DEFAULT;
  if (currentValue === nextValue) return;

  if (nextValue === WINDOW_OPACITY_DEFAULT) {
    delete currentMap[windowId];
  } else {
    currentMap[windowId] = nextValue;
  }

  settings.set('windowOpacity', currentMap);
}

function normalizeOwnerDefaultSettings(raw) {
  if (!raw || typeof raw !== 'object') return {};

  const normalized = {};

  const readNumber = (key, min, max) => {
    if (!(key in raw)) return;
    const value = Number(raw[key]);
    if (!Number.isFinite(value)) return;
    normalized[key] = Math.max(min, Math.min(max, value));
  };

  readNumber('scale', 0.3, 2);
  readNumber('bgScale', 0.3, 2);

  if (typeof raw.autoFitScale === 'boolean') normalized.autoFitScale = raw.autoFitScale;
  if (typeof raw.screenBounds === 'boolean') normalized.screenBounds = raw.screenBounds;
  if (typeof raw.snapToGrid === 'boolean') normalized.snapToGrid = raw.snapToGrid;

  if ('gridSize' in raw) {
    const value = Number(raw.gridSize);
    if (Number.isFinite(value)) {
      normalized.gridSize = Math.max(1, Math.min(100, Math.round(value)));
    }
  }

  if (typeof raw.background === 'string') {
    normalized.background = raw.background;
  }

  if (typeof raw.backgroundType === 'string') {
    const type = raw.backgroundType.trim().toLowerCase();
    if (type === '' || type === 'image' || type === 'video') {
      normalized.backgroundType = type;
    }
  }

  if (typeof normalized.background === 'string' && normalized.background === '') {
    normalized.backgroundType = '';
  } else if (typeof normalized.background === 'string' && !('backgroundType' in normalized)) {
    normalized.backgroundType = guessMediaType(normalized.background);
  }

  if (typeof raw.backgroundColor === 'string' && raw.backgroundColor.trim()) {
    normalized.backgroundColor = raw.backgroundColor.trim();
  }

  if (typeof raw.mode === 'string') {
    const mode = raw.mode.trim().toLowerCase();
    if (OWNER_DEFAULT_MODES.has(mode)) {
      normalized.mode = mode;
    }
  }

  return normalized;
}

function captureOwnerDefaultSettings() {
  return normalizeOwnerDefaultSettings({
    scale: settings.get('scale'),
    bgScale: settings.get('bgScale'),
    autoFitScale: settings.get('autoFitScale'),
    screenBounds: settings.get('screenBounds'),
    snapToGrid: settings.get('snapToGrid'),
    gridSize: settings.get('gridSize'),
    background: settings.get('background'),
    backgroundType: settings.get('backgroundType'),
    backgroundColor: settings.get('backgroundColor'),
    mode: settings.get('mode'),
  });
}

function applyOwnerDefaultSettings(rawSettings, { applyRuntime = true } = {}) {
  const normalized = normalizeOwnerDefaultSettings(rawSettings);
  const entries = Object.entries(normalized);
  if (entries.length === 0) return false;

  for (const [key, value] of entries) {
    settings.set(key, value);
  }

  if (applyRuntime) {
    applyScaleFromSettings();
    applyBgScale(settings.get('bgScale') || 1.0);
    applyBackground(settings.get('background'), settings.get('backgroundType'));
    applyBackgroundColor(settings.get('backgroundColor'));
    applyViewportBoundsMode();
  }

  return true;
}

function parseAlphaToken(token) {
  if (!token) return 1;
  const trimmed = String(token).trim();
  if (trimmed.endsWith('%')) {
    const percent = Number(trimmed.slice(0, -1));
    return Number.isFinite(percent) ? percent / 100 : 1;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : 1;
}

function parseColorAlpha(colorValue) {
  if (!colorValue || colorValue === 'transparent') return 0;

  const match = String(colorValue).match(/^rgba?\((.+)\)$/i);
  if (!match) return 1;

  const body = match[1].trim();

  // CSS Color 4 syntax: rgb(10 20 30 / 0.5)
  if (body.includes('/')) {
    const [, alphaRaw] = body.split('/');
    return parseAlphaToken(alphaRaw);
  }

  // Legacy syntax: rgba(10, 20, 30, 0.5)
  const parts = body.split(',').map(part => part.trim());
  if (parts.length < 4) return 1;
  return parseAlphaToken(parts[3]);
}

function detectWindowFrameSupport(container) {
  const rootEl = container?.firstElementChild;
  if (!(rootEl instanceof HTMLElement)) return false;

  const style = window.getComputedStyle(rootEl);
  if (style.backgroundImage && style.backgroundImage !== 'none') {
    return true;
  }

  return parseColorAlpha(style.backgroundColor) > 0.01;
}

function hasCustomWindowShape(container) {
  const rootEl = container?.firstElementChild;
  if (!(rootEl instanceof HTMLElement)) return false;

  const style = window.getComputedStyle(rootEl);
  const clipPath = style.clipPath || style.webkitClipPath;
  const maskImage = style.maskImage || style.webkitMaskImage;

  return (clipPath && clipPath !== 'none') || (maskImage && maskImage !== 'none');
}

function resolveWindowOpacityMode(configObj, frameSupported, hasCustomShape) {
  const rawMode = typeof configObj?.opacityMode === 'string'
    ? configObj.opacityMode.trim().toLowerCase()
    : '';

  if (rawMode === 'frame' || rawMode === 'content') {
    return rawMode;
  }

  // Backward compatible override from earlier iteration.
  if (typeof configObj?.opaqueFrame === 'boolean') {
    return configObj.opaqueFrame ? 'frame' : 'content';
  }

  if (hasCustomShape) {
    return 'content';
  }

  return frameSupported ? 'frame' : 'content';
}

function getWindowOpacityMode(windowId) {
  return windowOpacityModeMap.get(windowId) || 'content';
}

function clearWindowFrameShape(container) {
  container.style.removeProperty('clip-path');
  container.style.removeProperty('-webkit-clip-path');
  container.style.removeProperty('border-radius');
  container.style.removeProperty('mask-image');
  container.style.removeProperty('mask-position');
  container.style.removeProperty('mask-repeat');
  container.style.removeProperty('mask-size');
  container.style.removeProperty('-webkit-mask-image');
  container.style.removeProperty('-webkit-mask-position');
  container.style.removeProperty('-webkit-mask-repeat');
  container.style.removeProperty('-webkit-mask-size');
}

function syncWindowFrameShape(container) {
  const rootEl = container?.firstElementChild;
  if (!(rootEl instanceof HTMLElement)) {
    clearWindowFrameShape(container);
    return;
  }

  const style = window.getComputedStyle(rootEl);
  const clipPath = style.clipPath && style.clipPath !== 'none'
    ? style.clipPath
    : (style.webkitClipPath && style.webkitClipPath !== 'none' ? style.webkitClipPath : '');

  const borderRadius = style.borderRadius && style.borderRadius !== '0px'
    ? style.borderRadius
    : '';

  const maskImage = style.maskImage && style.maskImage !== 'none'
    ? style.maskImage
    : '';

  const webkitMaskImage = style.webkitMaskImage && style.webkitMaskImage !== 'none'
    ? style.webkitMaskImage
    : '';

  if (clipPath) {
    container.style.clipPath = clipPath;
    container.style.webkitClipPath = clipPath;
  } else {
    container.style.removeProperty('clip-path');
    container.style.removeProperty('-webkit-clip-path');
  }

  if (borderRadius) {
    container.style.borderRadius = borderRadius;
  } else {
    container.style.removeProperty('border-radius');
  }

  if (maskImage) {
    container.style.maskImage = maskImage;
    container.style.maskPosition = style.maskPosition;
    container.style.maskRepeat = style.maskRepeat;
    container.style.maskSize = style.maskSize;
  } else {
    container.style.removeProperty('mask-image');
    container.style.removeProperty('mask-position');
    container.style.removeProperty('mask-repeat');
    container.style.removeProperty('mask-size');
  }

  if (webkitMaskImage) {
    container.style.webkitMaskImage = webkitMaskImage;
    container.style.webkitMaskPosition = style.webkitMaskPosition;
    container.style.webkitMaskRepeat = style.webkitMaskRepeat;
    container.style.webkitMaskSize = style.webkitMaskSize;
  } else {
    container.style.removeProperty('-webkit-mask-image');
    container.style.removeProperty('-webkit-mask-position');
    container.style.removeProperty('-webkit-mask-repeat');
    container.style.removeProperty('-webkit-mask-size');
  }
}

function applyWindowOpacityToContainer(container, windowId) {
  if (!container || !windowId) return;

  const opacityMode = getWindowOpacityMode(windowId);
  const useFrameMode = opacityMode === 'frame';
  const opacityPercent = getWindowOpacityPercent(windowId);
  const opacityValue = opacityPercent / 100;

  container.dataset.opacityMode = opacityMode;
  container.classList.toggle('ui-window-opaque-frame', useFrameMode);

  if (useFrameMode) {
    syncWindowFrameShape(container);
    container.style.setProperty('--window-bg-opacity', String(opacityValue));
    container.style.opacity = '1';
  } else {
    clearWindowFrameShape(container);
    container.style.setProperty('--window-bg-opacity', '1');
    container.style.opacity = String(opacityValue);
  }
}

function applyWindowOpacityToAllWindows() {
  for (const w of windowManager.getAll()) {
    if (!w?.container || !w?.id) continue;
    applyWindowOpacityToContainer(w.container, w.id);
  }
}

function captureDefaultWindowState() {
  const allowedIds = getDefaultableWindowIds();
  const states = windowManager.captureLayout().filter(ws => allowedIds.has(ws.id));
  const allInteractiveState = windowManager.captureInteractiveState();
  const defaultsSettings = captureOwnerDefaultSettings();

  const currentVersionMap = getActiveWindowVersionMap();
  const currentOpacityMap = getWindowOpacityMap();
  const windowVersions = {};
  const windowOpacity = {};
  const windowState = {};
  for (const id of allowedIds) {
    if (typeof currentVersionMap[id] === 'string' && currentVersionMap[id]) {
      windowVersions[id] = currentVersionMap[id];
    }
    if (typeof currentOpacityMap[id] === 'number') {
      windowOpacity[id] = currentOpacityMap[id];
    }
    if (allInteractiveState[id] && typeof allInteractiveState[id] === 'object') {
      windowState[id] = allInteractiveState[id];
    }
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    settings: defaultsSettings,
    windows: states,
    windowVersions,
    windowOpacity,
    windowState,
  };
}

function applyRemoteWindowDefaults() {
  if (!remoteWindowDefaults || typeof remoteWindowDefaults !== 'object') return false;

  let applied = false;

  if (remoteWindowDefaults.settings && typeof remoteWindowDefaults.settings === 'object') {
    applied = applyOwnerDefaultSettings(remoteWindowDefaults.settings) || applied;
  }

  if (remoteWindowDefaults.windowVersions && typeof remoteWindowDefaults.windowVersions === 'object') {
    settings.set('windowVersions', { ...remoteWindowDefaults.windowVersions });
    applied = true;
  }

  if (remoteWindowDefaults.windowOpacity && typeof remoteWindowDefaults.windowOpacity === 'object') {
    settings.set('windowOpacity', normalizeWindowOpacityMap(remoteWindowDefaults.windowOpacity));
    applied = true;
  }

  const windowStates = Array.isArray(remoteWindowDefaults.windows) ? remoteWindowDefaults.windows : [];
  if (windowStates.length > 0) {
    windowManager.restoreLayout(windowStates);
    applied = true;
  }

  if (remoteWindowDefaults.windowState && typeof remoteWindowDefaults.windowState === 'object') {
    windowManager.restoreInteractiveState(remoteWindowDefaults.windowState);
    applied = true;
  }

  return applied;
}

function mergeWindowConfigs(baseConfig, versionConfig) {
  if (!versionConfig || typeof versionConfig !== 'object') return { ...baseConfig };

  const merged = {
    ...baseConfig,
    ...versionConfig,
  };

  merged.defaultPosition = {
    ...(baseConfig?.defaultPosition || {}),
    ...(versionConfig?.defaultPosition || {}),
  };

  merged.resizable = {
    ...(baseConfig?.resizable || {}),
    ...(versionConfig?.resizable || {}),
  };

  if (!merged.id) merged.id = baseConfig?.id;
  if (!merged.title) merged.title = baseConfig?.title || merged.id;

  return merged;
}

async function importConfigModuleFromText(configText) {
  const blob = new Blob([configText], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  try {
    const mod = await import(blobUrl);
    return mod.default;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function pickRootConfigPath(fileLookup) {
  const configPaths = [...fileLookup.keys()].filter(path => path.endsWith('/config.js') || path === 'config.js');
  if (configPaths.length === 0) return null;
  configPaths.sort((a, b) => a.split('/').length - b.split('/').length);
  return configPaths[0];
}

async function promptWindowVersionSelection({ windowId, title, versions, defaultVersion, sourceLabel }) {
  if (!Array.isArray(versions) || versions.length === 0) return null;
  if (versions.length === 1) return versions[0].key;

  if (_activeVersionPrompt) {
    await _activeVersionPrompt;
  }

  const overlay = document.getElementById('ui-version-picker-overlay');
  const closeBtn = document.getElementById('ui-version-picker-close');
  const cancelBtn = document.getElementById('ui-version-picker-cancel');
  const list = document.getElementById('ui-version-picker-list');
  const titleEl = document.getElementById('ui-version-picker-title');
  const subtitleEl = document.getElementById('ui-version-picker-subtitle');
  if (!overlay || !closeBtn || !cancelBtn || !list || !titleEl || !subtitleEl) {
    return defaultVersion || versions[0].key;
  }

  const activeDefault = versions.some(v => v.key === defaultVersion)
    ? defaultVersion
    : versions[0].key;

  _activeVersionPrompt = new Promise(resolve => {
    let settled = false;

    const cleanup = () => {
      overlay.hidden = true;
      list.innerHTML = '';
      closeBtn.removeEventListener('click', onCancel);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      settled = true;
      _activeVersionPrompt = null;
    };

    const finish = (value) => {
      if (settled) return;
      cleanup();
      resolve(value);
    };

    const onCancel = () => finish(null);
    const onBackdrop = (event) => {
      if (event.target === overlay) finish(null);
    };

    titleEl.textContent = `Choose version for ${title || windowId}`;
    subtitleEl.textContent = sourceLabel
      ? `${sourceLabel} found multiple versions for "${windowId}".`
      : `Multiple versions are available for "${windowId}".`;

    for (const version of versions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ui-version-option';
      const isDefault = version.key === activeDefault;
      btn.innerHTML = `
        <span class="ui-version-option-main">${version.label || version.key}</span>
        <span class="ui-version-option-meta">${version.key}${isDefault ? ' - default' : ''}</span>
      `;
      btn.addEventListener('click', () => finish(version.key));
      list.appendChild(btn);
    }

    closeBtn.addEventListener('click', onCancel);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    overlay.hidden = false;
  });

  return _activeVersionPrompt;
}

async function resolveWindowVersionSelection({
  windowId,
  title,
  rootConfig,
  preferredVersion,
  sourceLabel,
  askIfMultiple,
}) {
  const versionEntries = getWindowVersionEntries(rootConfig);
  if (versionEntries.length === 0) {
    return { selectedVersion: null, versionEntry: null, versionEntries, cancelled: false };
  }

  let selectedVersion = null;
  const preferredIsValid = !!preferredVersion && versionEntries.some(v => v.key === preferredVersion);

  if (preferredIsValid) {
    selectedVersion = preferredVersion;
  } else {
    selectedVersion = getDefaultWindowVersionKey(rootConfig, versionEntries);
    if (askIfMultiple && versionEntries.length > 1) {
      selectedVersion = await promptWindowVersionSelection({
        windowId,
        title,
        versions: versionEntries,
        defaultVersion: selectedVersion,
        sourceLabel,
      });
      if (!selectedVersion) {
        return { selectedVersion: null, versionEntry: null, versionEntries, cancelled: true };
      }
    }
  }

  const versionEntry = versionEntries.find(v => v.key === selectedVersion) || null;
  return { selectedVersion, versionEntry, versionEntries, cancelled: false };
}

function parseGitHubImportURL(rawUrl) {
  const input = String(rawUrl || '').trim();
  if (!input) return null;

  let normalized = input;
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }

  if (!/github\.com$/i.test(parsed.hostname)) return null;
  const pathParts = parsed.pathname.split('/').filter(Boolean);
  if (pathParts.length < 4 || pathParts[2] !== 'tree') return null;

  const user = pathParts[0];
  const repo = pathParts[1];
  const branch = decodeURIComponent(pathParts.slice(3).join('/'));
  if (!user || !repo || !branch) return null;

  const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
  const hashParams = new URLSearchParams(hash);
  const targetWindow = (hashParams.get('window') || '').trim();
  const targetVersion = (hashParams.get('version') || '').trim();

  return { user, repo, branch, targetWindow, targetVersion };
}

async function _switchWindowVersionInPlace(windowId, versionKey) {
  const currentEntry = windowManager.get(windowId);
  if (!currentEntry?.config) return false;

  const manifestEntry = manifest?.windows?.find(w => w.id === windowId) || null;
  if (manifestEntry?._imported) {
    window.uiToast?.('Version switching without reload is only supported for built-in windows.', 'error');
    return false;
  }

  const folder = manifestEntry?.folder || (windowId === 'canvas' ? 'canvas' : `windows/${windowId}`);
  const rootConfigModule = await import(`../${folder}/config.js`);
  const rootConfig = rootConfigModule.default;
  if (!rootConfig || !rootConfig.id) return false;

  const versionEntries = getWindowVersionEntries(rootConfig);
  if (versionEntries.length <= 1) return false;

  const selected = versionEntries.find(v => v.key === versionKey);
  if (!selected) return false;
  if (currentEntry.config._versionKey === selected.key) return true;

  const versionFolder = joinRelativePath(folder, selected.folder);
  const versionConfigPath = joinRelativePath(versionFolder, selected.configFile);

  let versionConfig = null;
  try {
    const versionConfigModule = await import(`../${versionConfigPath}`);
    versionConfig = versionConfigModule.default;
  } catch (err) {
    console.warn(`[UI Emulator] Missing version config: ${versionConfigPath}`, err);
  }

  const nextConfig = mergeWindowConfigs(rootConfig, versionConfig);
  nextConfig._versionKey = selected.key;
  nextConfig._versionLabel = selected.label;

  const mountOptions = {
    templatePath: `${versionFolder}/${selected.templateFile}`,
    stylePath: `${versionFolder}/${selected.styleFile}`,
  };

  const htmlResp = await fetch(mountOptions.templatePath);
  if (!htmlResp.ok) {
    throw new Error(`Missing template: ${mountOptions.templatePath}`);
  }
  const htmlText = await htmlResp.text();

  const cssResp = await fetch(mountOptions.stylePath);
  const cssText = cssResp.ok ? await cssResp.text() : '';

  const wasOpen = windowManager.isOpen(windowId);
  const pos = windowManager.getPosition(windowId);
  const size = windowManager.getSize(windowId);

  windowManager.close(windowId);

  const oldContainer = currentEntry.container;
  if (oldContainer?.parentElement) {
    oldContainer.parentElement.removeChild(oldContainer);
  }

  document.querySelectorAll(`style[data-window-id="${windowId}"]`).forEach(el => el.remove());

  const windowsLayer = document.getElementById('ui-windows');
  if (!windowsLayer) throw new Error('Windows layer not found');

  const wDef = manifestEntry || {
    id: nextConfig.id,
    name: nextConfig.title || nextConfig.id,
    folder,
    defaultPosition: nextConfig.defaultPosition || { x: 100, y: 100, width: 300, height: 200 },
    defaultOpen: nextConfig.defaultOpen ?? false,
    version: selected.key,
  };

  wDef.name = nextConfig.title || wDef.name;
  wDef.folder = folder;
  wDef.version = selected.key;
  if (nextConfig.defaultPosition) {
    wDef.defaultPosition = nextConfig.defaultPosition;
  }

  if (!manifestEntry && manifest?.windows) {
    manifest.windows.push(wDef);
  }

  _injectWindow(wDef, nextConfig, htmlText, cssText, windowsLayer);

  windowManager.setPosition(windowId, pos.x, pos.y);
  if (size.width > 0 && size.height > 0) {
    windowManager.setSize(windowId, size.width, size.height);
  }
  if (wasOpen) {
    windowManager.open(windowId);
  }

  setStoredWindowVersion(windowId, selected.key);
  _rebuildWindowsList();
  document.dispatchEvent(new CustomEvent('ui-export-refresh'));
  window.dispatchEvent(new CustomEvent('ui-export-refresh'));

  return true;
}

function setWindowVersionAndReload(windowId, versionKey) {
  const entry = windowManager.get(windowId);
  if (!entry?.config) return;

  const versionEntries = getWindowVersionEntries(entry.config);
  if (versionEntries.length <= 1) return;

  const selected = versionEntries.find(v => v.key === versionKey);
  if (!selected) return;

  if (entry.config._versionKey === selected.key) return;

  window.uiToast?.(`Switching ${entry.config.title || windowId} to ${selected.label || selected.key}...`, 'info');
  _switchWindowVersionInPlace(windowId, selected.key)
    .then((ok) => {
      if (ok) {
        window.uiToast?.(`Switched ${entry.config.title || windowId} to ${selected.label || selected.key}.`, 'success');
      } else {
        window.uiToast?.('Version switch failed.', 'error');
      }
    })
    .catch((err) => {
      console.error('[UI Emulator] Version switch failed:', err);
      window.uiToast?.('Version switch failed.', 'error');
    });
}

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
async function updateLastEditTime() {
  try {
    if (!config.github || !config.github.repo) return;

    // Fetch the latest commit on the repo (unauthenticated, public API)
    const res = await fetch(`https://api.github.com/repos/${config.github.repo}/commits?per_page=1`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        const date = new Date(data[0].commit.committer.date);
        const el = document.getElementById('ui-info-time');
        if (el) el.textContent = date.toLocaleString();
      }
    }
  } catch (err) {
    console.error("Failed to fetch last edit time", err);
  }
}

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
  settings.on('screenBounds', () => applyViewportBoundsMode());
  settings.on('windowOpacity', () => applyWindowOpacityToAllWindows());

  // 3b. Init GitHub auth (handles OAuth callback if ?code= present)
  const loggedIn = await githubAuth.init();
  githubAuth.onAuthChange(updateAuthUI);
  updateAuthUI(githubAuth.user);

  // 3c. Load remote config if available
  try {
    const configResp = await fetch('config.json');
    if (configResp.ok) {
      remoteConfig = await configResp.json();

      if (remoteConfig.windowDefaults && typeof remoteConfig.windowDefaults === 'object') {
        remoteWindowDefaults = remoteConfig.windowDefaults;

        if (remoteWindowDefaults.settings && typeof remoteWindowDefaults.settings === 'object') {
          applyOwnerDefaultSettings(remoteWindowDefaults.settings, { applyRuntime: false });
        }

        if (remoteWindowDefaults.windowVersions && typeof remoteWindowDefaults.windowVersions === 'object') {
          settings.set('windowVersions', { ...remoteWindowDefaults.windowVersions });
        }

        if (remoteWindowDefaults.windowOpacity && typeof remoteWindowDefaults.windowOpacity === 'object') {
          settings.set('windowOpacity', normalizeWindowOpacityMap(remoteWindowDefaults.windowOpacity));
        }
      }

      // Backward-compatible support for legacy top-level defaults.
      const hasWindowDefaultSettings = !!(
        remoteWindowDefaults &&
        typeof remoteWindowDefaults.settings === 'object'
      );

      if (!hasWindowDefaultSettings && (remoteConfig.scale !== undefined || remoteConfig.bgScale !== undefined)) {
        const legacyDefaults = {};
        if (remoteConfig.scale !== undefined) {
          legacyDefaults.scale = remoteConfig.scale;
          legacyDefaults.autoFitScale = false;
        }
        if (remoteConfig.bgScale !== undefined) {
          legacyDefaults.bgScale = remoteConfig.bgScale;
        }
        applyOwnerDefaultSettings(legacyDefaults, { applyRuntime: false });
      }
    }
  } catch (err) {
    // No remote config found, silently continue
  }

  // Update info zone (now safe, config.github should be populated)
  try {
    if (config.github && config.github.repo) {
        const commitData = await githubApi.getBranchCommit();
        if (commitData && commitData.commit && commitData.commit.author) {
          const date = new Date(commitData.commit.author.date);
          const timeStr = date.toLocaleString();
          document.getElementById('ui-info-time').textContent = timeStr;
          document.getElementById('ui-info-repo').textContent = config.github.repo;
        }
    }
  } catch (err) {
    document.getElementById('ui-info-time').textContent = 'Unknown';
    if (config.github) {
        document.getElementById('ui-info-repo').textContent = config.github.repo;
    }
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

  // 6. Apply settings to UI
  applyScaleFromSettings();
  applyViewportBoundsMode();
  applyBackground(settings.get('background'), settings.get('backgroundType'));
  applyBackgroundColor(settings.get('backgroundColor'));

  // 7. Startup precedence: URL preset > owner defaults > local autosave > manifest defaults
  if (!layoutManager.loadFromURL()) {
    if (!applyRemoteWindowDefaults()) {
      if (!layoutManager.loadAutoSave()) {
        for (const wDef of manifest.windows) {
          windowManager.resetPosition(wDef.id, manifest);
          if (wDef.defaultOpen) windowManager.open(wDef.id);
        }
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

  // 10. Hide loading screen
  const loadingScreen = document.getElementById('ui-loading-screen');
  if (loadingScreen) {
    loadingScreen.classList.add('hidden');
    setTimeout(() => loadingScreen.remove(), 500); // Wait for transition
  }

  // 11. Show panel arrow briefly
  const arrow = document.getElementById('ui-panel-arrow');
  if (arrow) {
    arrow.removeAttribute('hidden');
    setTimeout(() => {
      arrow.setAttribute('hidden', '');
    }, 2000);
  }

  // Global listener for canvas mode UI handling
  windowManager.on('window:opened', (e) => {
    if (e.detail.id === 'canvas') {
      document.body.classList.add('canvas-mode-active');
      if(window.setMode) window.setMode('design');
    }
  });
  windowManager.on('window:closed', (e) => {
    if (e.detail.id === 'canvas') {
      document.body.classList.remove('canvas-mode-active');
    }
  });

  // Fetch last edit
  updateLastEditTime();

  // 12. Global hash listener for canvas links
  checkGlobalHash(window.location.hash);
  window.addEventListener('hashchange', () => checkGlobalHash(window.location.hash));

  console.log('[UI Emulator] Ready —', manifest.windows.length, 'windows loaded');
}

/** Global hash interceptor to ensure canvas window opens before its internal logic runs */
function checkGlobalHash(hash) {
  if (hash.startsWith('#canvas:') || hash.startsWith('#canvasid:')) {
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
    configModule = await import(`../${folder}/config.js`);
  } catch (e) {
    console.error('IMPORT ERROR:', e);
    throw e;
  }

  const rootConfig = configModule.default;
  if (!rootConfig || !rootConfig.id) {
    throw new Error(`Invalid window config in ${folder}/config.js`);
  }

  const storedVersion = getStoredWindowVersion(rootConfig.id);
  const remoteVersion = getRemoteWindowVersion(rootConfig.id);
  const versionResolution = await resolveWindowVersionSelection({
    windowId: rootConfig.id,
    title: rootConfig.title,
    rootConfig,
    preferredVersion: remoteVersion || storedVersion,
    sourceLabel: '',
    askIfMultiple: false,
  });

  let config = rootConfig;
  let mountOptions = {};

  if (versionResolution.versionEntry) {
    const entry = versionResolution.versionEntry;
    const versionFolder = joinRelativePath(folder, entry.folder);
    const versionConfigPath = joinRelativePath(versionFolder, entry.configFile);

    let versionConfig = null;
    try {
      const versionConfigModule = await import(`../${versionConfigPath}`);
      versionConfig = versionConfigModule.default;
    } catch (err) {
      console.warn(`[UI Emulator] Missing version config: ${versionConfigPath}`, err);
    }

    config = mergeWindowConfigs(rootConfig, versionConfig);
    config._versionKey = entry.key;
    config._versionLabel = entry.label;

    mountOptions = {
      templatePath: `${versionFolder}/${entry.templateFile}`,
      stylePath: `${versionFolder}/${entry.styleFile}`,
    };

    setStoredWindowVersion(config.id, entry.key);
  }

  // Build wDef from config (per-window manifest)
  const wDef = {
    id: config.id,
    name: config.title,
    folder,
    defaultPosition: config.defaultPosition || { x: 100, y: 100, width: 300, height: 200 },
    defaultOpen: config.defaultOpen ?? false,
    version: config._versionKey || null,
  };
  manifest.windows.push(wDef);

  await _mountWindow(wDef, config, folder, windowsLayer, mountOptions);
}

/** Mount a window given its wDef, config, folder path, and DOM layer */
async function _mountWindow(wDef, config, folder, windowsLayer, mountOptions = {}) {
  const templatePath = mountOptions.templatePath || `${folder}/template.html`;
  const stylePath = mountOptions.stylePath || `${folder}/style.css`;

  const htmlResp = await fetch(templatePath);
  if (!htmlResp.ok) {
    throw new Error(`Missing template: ${templatePath}`);
  }
  const htmlText = await htmlResp.text();

  const cssResp = await fetch(stylePath);
  const cssText = cssResp.ok ? await cssResp.text() : '';

  _injectWindow(wDef, config, htmlText, cssText, windowsLayer);
}

/** Inject window from raw strings (used by both file-based and imported). */
function _injectWindow(wDef, config, htmlText, cssText, windowsLayer) {
  const scopedCSS = scopeCSS(cssText, wDef.id);

  const styleEl = document.createElement('style');
  styleEl.dataset.windowId = wDef.id;
  if (wDef.version) styleEl.dataset.windowVersion = wDef.version;
  styleEl.textContent = scopedCSS;
  document.head.appendChild(styleEl);

  const container = document.createElement('div');
  container.className = 'ui-window';
  container.dataset.windowId = wDef.id;
  if (wDef.version) container.dataset.windowVersion = wDef.version;
  container.innerHTML = htmlText;

  const dp = wDef.defaultPosition;
  if (dp) {
    container.style.left = dp.x + 'px';
    container.style.top = dp.y + 'px';
    if (dp.width) container.style.width = dp.width + 'px';
    if (dp.height) container.style.height = dp.height + 'px';
  }

  windowsLayer.appendChild(container);

  const frameSupported = detectWindowFrameSupport(container);
  const customShape = hasCustomWindowShape(container);
  const opacityMode = resolveWindowOpacityMode(config, frameSupported, customShape);
  windowOpacityModeMap.set(wDef.id, opacityMode);
  applyWindowOpacityToContainer(container, wDef.id);

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

function getFileLookupText(fileLookup, path) {
  return fileLookup.get(normalizeRelativePath(path).toLowerCase()) || null;
}

async function buildImportFileLookupFromZip(zipFile) {
  const zip = await JSZip.loadAsync(zipFile);
  const fileLookup = new Map();

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const normPath = normalizeRelativePath(path).toLowerCase();
    const text = await entry.async('string');
    fileLookup.set(normPath, text);
  }

  return fileLookup;
}

async function buildImportFileLookupFromFiles(files) {
  const fileLookup = new Map();
  for (const file of files) {
    const normPath = normalizeRelativePath(file.name).toLowerCase();
    const text = await file.text();
    fileLookup.set(normPath, text);
  }
  return fileLookup;
}

async function resolveImportedWindowBundle(fileLookup, { sourceLabel, preferredVersion, askIfMultiple }) {
  const rootConfigPath = pickRootConfigPath(fileLookup);
  if (!rootConfigPath) {
    return { error: 'config.js not found in import' };
  }

  const rootConfigText = getFileLookupText(fileLookup, rootConfigPath);
  if (!rootConfigText) {
    return { error: 'config.js not found in import' };
  }

  const rootConfig = await importConfigModuleFromText(rootConfigText);
  if (!rootConfig || !rootConfig.id) {
    return { error: 'Invalid config.js - missing id' };
  }

  const rootFolder = dirnamePath(rootConfigPath);
  const versionResolution = await resolveWindowVersionSelection({
    windowId: rootConfig.id,
    title: rootConfig.title,
    rootConfig,
    preferredVersion,
    sourceLabel,
    askIfMultiple,
  });

  if (versionResolution.cancelled) {
    return { cancelled: true };
  }

  let config = rootConfig;
  let templatePath = joinRelativePath(rootFolder, 'template.html');
  let stylePath = joinRelativePath(rootFolder, 'style.css');

  if (versionResolution.versionEntry) {
    const entry = versionResolution.versionEntry;
    const versionBase = joinRelativePath(rootFolder, entry.folder);

    const versionConfigPath = joinRelativePath(versionBase, entry.configFile);
    const versionConfigText = getFileLookupText(fileLookup, versionConfigPath);
    if (!versionConfigText) {
      return { error: `Version config not found: ${versionConfigPath}` };
    }

    const versionConfig = await importConfigModuleFromText(versionConfigText);
    config = mergeWindowConfigs(rootConfig, versionConfig);
    config._versionKey = entry.key;
    config._versionLabel = entry.label;

    templatePath = joinRelativePath(versionBase, entry.templateFile);
    stylePath = joinRelativePath(versionBase, entry.styleFile);
  }

  const htmlText = getFileLookupText(fileLookup, templatePath);
  if (!htmlText) {
    return { error: `Template not found: ${templatePath}` };
  }

  const cssText = getFileLookupText(fileLookup, stylePath) || '';

  return {
    config,
    htmlText,
    cssText,
    selectedVersion: config._versionKey || null,
  };
}

async function fetchTextFromURL(url, required = false) {
  const resp = await fetch(url);
  if (!resp.ok) {
    if (required) {
      throw new Error(`Missing required file: ${url}`);
    }
    return null;
  }
  return resp.text();
}

/** Import a window from user-provided files (ZIP or individual files). */
async function importWindowFromFiles(files) {
  let fileLookup;
  const isZip = files.length === 1 && files[0].name.toLowerCase().endsWith('.zip');

  if (isZip) {
    if (typeof JSZip === 'undefined') {
      window.uiToast('JSZip not loaded', 'error');
      return;
    }
    fileLookup = await buildImportFileLookupFromZip(files[0]);
  } else {
    fileLookup = await buildImportFileLookupFromFiles(files);
  }

  const bundle = await resolveImportedWindowBundle(fileLookup, {
    sourceLabel: 'Local import',
    preferredVersion: null,
    askIfMultiple: true,
  });

  if (bundle.cancelled) {
    window.uiToast('Window import cancelled', 'info');
    return;
  }

  if (bundle.error) {
    window.uiToast(bundle.error, 'error');
    return;
  }

  const config = bundle.config;

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
    version: bundle.selectedVersion,
  };

  manifest.windows.push(wDef);

  const windowsLayer = document.getElementById('ui-windows');
  _injectWindow(wDef, config, bundle.htmlText, bundle.cssText || '', windowsLayer);
  windowManager.open(wDef.id);

  if (bundle.selectedVersion) {
    setStoredWindowVersion(config.id, bundle.selectedVersion);
  }

  // Rebuild windows list in panel
  _rebuildWindowsList();

  const suffix = bundle.selectedVersion ? ` (${bundle.selectedVersion})` : '';
  window.uiToast(`Window "${config.title || config.id}" imported${suffix}!`, 'success');
}

/** Import windows directly from a GitHub branch URL */
async function importWindowsFromGithub(url) {
  const parsed = parseGitHubImportURL(url);
  if (!parsed) {
    window.uiToast('Invalid GitHub URL. Use github.com/user/repo/tree/branch with optional #window=...&version=...', 'error');
    return;
  }

  const { user, repo, branch, targetWindow, targetVersion } = parsed;
  window.uiToast(`Fetching windows from ${user}/${repo} (${branch})...`, 'info');

  try {
    const apiURL = `https://api.github.com/repos/${user}/${repo}/contents/windows?ref=${encodeURIComponent(branch)}`;
    const response = await fetch(apiURL);
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const contents = await response.json();
    if (!Array.isArray(contents)) throw new Error('Could not read windows directory');

    const directories = contents.filter(item => item.type === 'dir');
    const candidates = targetWindow
      ? directories.filter(item => item.name === targetWindow)
      : directories;

    if (targetWindow && candidates.length === 0) {
      window.uiToast(`Window folder "${targetWindow}" not found in branch`, 'error');
      return;
    }

    let importedCount = 0;
    let skippedCount = 0;
    const windowsLayer = document.getElementById('ui-windows');

    for (const item of candidates) {
      const folderName = item.name;

      try {
        const rawBase = `https://raw.githubusercontent.com/${user}/${repo}/${branch}/windows/${folderName}`;

        const rootConfigText = await fetchTextFromURL(`${rawBase}/config.js`);
        if (!rootConfigText) {
          skippedCount++;
          continue;
        }

        const rootConfig = await importConfigModuleFromText(rootConfigText);
        if (!rootConfig || !rootConfig.id) {
          skippedCount++;
          continue;
        }

        // Skip if already in registry/imported
        if (windowManager.get(rootConfig.id)) {
          skippedCount++;
          continue;
        }

        const preferredVersion = targetVersion || getStoredWindowVersion(rootConfig.id);
        const versionResolution = await resolveWindowVersionSelection({
          windowId: rootConfig.id,
          title: rootConfig.title,
          rootConfig,
          preferredVersion,
          sourceLabel: `GitHub import (${folderName})`,
          askIfMultiple: true,
        });

        if (versionResolution.cancelled) {
          skippedCount++;
          continue;
        }

        let config = rootConfig;
        let htmlURL = `${rawBase}/template.html`;
        let cssURL = `${rawBase}/style.css`;

        if (versionResolution.versionEntry) {
          const entry = versionResolution.versionEntry;
          const versionBase = `${rawBase}/${entry.folder}`;
          const versionConfigURL = `${versionBase}/${entry.configFile}`;
          const versionConfigText = await fetchTextFromURL(versionConfigURL);
          if (!versionConfigText) {
            skippedCount++;
            continue;
          }

          const versionConfig = await importConfigModuleFromText(versionConfigText);
          config = mergeWindowConfigs(rootConfig, versionConfig);
          config._versionKey = entry.key;
          config._versionLabel = entry.label;

          htmlURL = `${versionBase}/${entry.templateFile}`;
          cssURL = `${versionBase}/${entry.styleFile}`;
        }

        const htmlText = await fetchTextFromURL(htmlURL, true);
        const cssText = await fetchTextFromURL(cssURL) || '';

        if (!config || !config.id) continue;

        const wDef = {
          id: config.id,
          name: config.title || config.id,
          folder: `_imported/${config.id}`,
          defaultPosition: config.defaultPosition || { x: 100, y: 100, width: 380, height: 320 },
          defaultOpen: true,
          _imported: true,
          version: config._versionKey || null,
        };

        manifest.windows.push(wDef);
        _injectWindow(wDef, config, htmlText, cssText, windowsLayer);
        windowManager.open(wDef.id);

        if (config._versionKey) {
          setStoredWindowVersion(config.id, config._versionKey);
        }

        importedCount++;
      } catch (err) {
        console.warn(`[GitHub Import] Failed to import ${folderName}:`, err);
        skippedCount++;
      }
    }

    if (importedCount > 0) {
      _rebuildWindowsList();
      const skippedSuffix = skippedCount > 0 ? ` (${skippedCount} skipped)` : '';
      window.uiToast(`Imported ${importedCount} new windows from GitHub${skippedSuffix}!`, 'success');
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

  window.setMode = function(mode) {
    settings.set('mode', mode);
    modeButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
    exportPanel.hidden = mode !== 'export';
    commentPanel.hidden = mode !== 'comment';
    commentManager.showToolbar(mode === 'comment');
    updateModeIndicator(mode);
  }

  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => window.setMode(btn.dataset.mode));
  });
  window.setMode(settings.get('mode'));

  // ── Windows list ──────────────────────────────────
  const windowsList = document.getElementById('ui-windows-list');
  function buildWindowsList() {
    windowsList.innerHTML = '';
    for (const w of windowManager.getAll()) {
      if (w.id === 'canvas') continue; // Hide canvas from windows list
      const item = document.createElement('div');
      item.className = 'window-list-item';

      const itemHead = document.createElement('div');
      itemHead.className = 'window-list-head';

      const titleWrap = document.createElement('div');
      titleWrap.className = 'window-list-main';

      const titleEl = document.createElement('span');
      titleEl.textContent = w.config.title || w.id;
      titleWrap.appendChild(titleEl);

      const versionEntries = getWindowVersionEntries(w.config);
      if (versionEntries.length > 1) {
        const versionSelect = document.createElement('select');
        versionSelect.className = 'window-version-select';

        for (const versionEntry of versionEntries) {
          const option = document.createElement('option');
          option.value = versionEntry.key;
          option.textContent = versionEntry.label || versionEntry.key;
          versionSelect.appendChild(option);
        }

        versionSelect.value = w.config._versionKey || getDefaultWindowVersionKey(w.config, versionEntries);
        versionSelect.title = `${w.config.title || w.id} version`;
        versionSelect.addEventListener('click', (event) => event.stopPropagation());
        versionSelect.addEventListener('change', (event) => {
          event.stopPropagation();
          setWindowVersionAndReload(w.id, versionSelect.value);
        });

        titleWrap.appendChild(versionSelect);
      } else if (w.config._versionKey) {
        const badge = document.createElement('span');
        badge.className = 'window-version-badge';
        badge.textContent = w.config._versionKey;
        titleWrap.appendChild(badge);
      }

      const toggle = document.createElement('button');
      toggle.className = 'window-list-toggle' + (w.open ? ' on' : '');
      toggle.addEventListener('click', () => {
        windowManager.toggle(w.id);
        toggle.classList.toggle('on', windowManager.isOpen(w.id));
      });

      const opacityRow = document.createElement('div');
      opacityRow.className = 'window-opacity-row';

      const opacityLabel = document.createElement('span');
      opacityLabel.className = 'window-opacity-label';
      opacityLabel.textContent = 'Transparency';

      const opacityRange = document.createElement('input');
      opacityRange.className = 'window-opacity-range';
      opacityRange.type = 'range';
      opacityRange.min = String(WINDOW_OPACITY_MIN);
      opacityRange.max = String(WINDOW_OPACITY_MAX);
      opacityRange.step = '1';
      const opacityMode = getWindowOpacityMode(w.id);
      opacityRange.value = String(getWindowOpacityPercent(w.id));
      opacityRange.title = `${w.config.title || w.id} transparency (${opacityMode} mode)`;

      const opacityValue = document.createElement('div');
      opacityValue.className = 'window-opacity-value';

      const opacityNumber = document.createElement('input');
      opacityNumber.className = 'window-opacity-number';
      opacityNumber.type = 'number';
      opacityNumber.min = String(WINDOW_OPACITY_MIN);
      opacityNumber.max = String(WINDOW_OPACITY_MAX);
      opacityNumber.step = '1';
      opacityNumber.inputMode = 'numeric';
      opacityNumber.value = opacityRange.value;
      opacityNumber.title = `${w.config.title || w.id} transparency percent`;

      const opacityUnit = document.createElement('span');
      opacityUnit.className = 'window-opacity-unit';
      opacityUnit.textContent = '%';

      const setOpacityValue = (rawValue) => {
        const nextOpacity = normalizeWindowOpacityPercent(rawValue);
        opacityRange.value = String(nextOpacity);
        opacityNumber.value = String(nextOpacity);
        setWindowOpacityPercent(w.id, nextOpacity);
      };

      opacityRange.addEventListener('click', (event) => event.stopPropagation());
      opacityRange.addEventListener('pointerdown', (event) => event.stopPropagation());
      opacityRange.addEventListener('input', (event) => {
        event.stopPropagation();
        setOpacityValue(event.target.value);
      });

      opacityNumber.addEventListener('click', (event) => event.stopPropagation());
      opacityNumber.addEventListener('pointerdown', (event) => event.stopPropagation());
      opacityNumber.addEventListener('keydown', (event) => event.stopPropagation());
      opacityNumber.addEventListener('focus', () => opacityNumber.select());
      opacityNumber.addEventListener('input', (event) => {
        event.stopPropagation();
        const rawValue = event.target.value;
        if (rawValue === '') return;
        const parsedValue = Number(rawValue);
        if (!Number.isFinite(parsedValue)) return;
        setOpacityValue(parsedValue);
      });
      opacityNumber.addEventListener('change', (event) => {
        event.stopPropagation();
        const rawValue = event.target.value;
        if (rawValue === '') {
          opacityNumber.value = opacityRange.value;
          return;
        }
        const parsedValue = Number(rawValue);
        if (!Number.isFinite(parsedValue)) {
          opacityNumber.value = opacityRange.value;
          return;
        }
        setOpacityValue(parsedValue);
      });
      opacityNumber.addEventListener('blur', () => {
        if (opacityNumber.value === '') {
          opacityNumber.value = opacityRange.value;
        }
      });

      itemHead.appendChild(titleWrap);
      itemHead.appendChild(toggle);

      opacityValue.appendChild(opacityNumber);
      opacityValue.appendChild(opacityUnit);

      opacityRow.appendChild(opacityLabel);
      opacityRow.appendChild(opacityRange);
      opacityRow.appendChild(opacityValue);

      item.appendChild(itemHead);
      item.appendChild(opacityRow);
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
    for (const w of windowManager.getAll()) {
      if (w.id === 'canvas') continue;
      windowManager.open(w.id);
    }
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
    applyViewportBoundsMode();
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

  const saveDefaultsBtn = document.getElementById('ui-layout-defaults-save');
  saveDefaultsBtn?.addEventListener('click', async () => {
    if (!githubAuth.isOwner) return;

    const oldText = saveDefaultsBtn.textContent;
    saveDefaultsBtn.textContent = 'Saving...';
    saveDefaultsBtn.disabled = true;

    try {
      const snapshot = captureDefaultWindowState();
      if (!Array.isArray(snapshot.windows) || snapshot.windows.length === 0) {
        window.uiToast('No windows available to save as defaults', 'error');
        return;
      }

      remoteConfig = remoteConfig || {};
      remoteConfig.windowDefaults = snapshot;
      remoteWindowDefaults = snapshot;

      await githubApi.saveFile(
        'config.json',
        JSON.stringify(remoteConfig, null, 2),
        'chore: Update default UI baseline for everyone'
      );

      window.uiToast('Saved default UI baseline for everyone', 'success');
    } catch (err) {
      window.uiToast('Failed to save default UI baseline', 'error');
      console.error(err);
    } finally {
      saveDefaultsBtn.textContent = oldText;
      saveDefaultsBtn.disabled = false;
    }
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
function applyScaleFromSettings() {
  if (settings.get('autoFitScale')) {
    const ww = window.innerWidth - 40;
    const wh = window.innerHeight - 20;
    const fit = Math.min(ww / 1920, wh / 1080);
    const autoScale = Math.max(0.3, Math.min(2, fit));
    settings.set('scale', autoScale);
    applyScale(autoScale);
    return;
  }

  applyScale(settings.get('scale'));
}

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

  applyViewportBoundsMode();
}

function applyViewportBoundsMode() {
  const viewport = document.getElementById('ui-viewport');
  if (!viewport) return;

  const boundsEnabled = settings.get('screenBounds');
  const scale = settings.get('scale') || 1;

  // In constrained mode at low scales, keep overflow visible so windows can
  // move into the outer margins outside the scaled 1920x1080 frame.
  const shouldClip = boundsEnabled && scale >= 1;
  viewport.style.overflow = shouldClip ? 'hidden' : 'visible';
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
  const ownerOnlyButtonIds = [
    'ui-scale-default',
    'ui-bg-scale-default',
    'ui-layout-defaults-save',
  ];

  const setOwnerButtonsVisible = (visible) => {
    ownerOnlyButtonIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (visible) el.removeAttribute('hidden');
      else el.setAttribute('hidden', '');
    });
  };

  if (user) {
    if (loginBtn) loginBtn.classList.add('hidden');
    if (userEl) userEl.classList.remove('hidden');
    if (avatarEl) avatarEl.src = user.avatar_url;
    if (nameEl) nameEl.textContent = user.login;
    if (hintEl) hintEl.innerHTML = '<svg class="si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> Double-click on any window to add a comment pin';
    setOwnerButtonsVisible(!!githubAuth.isOwner);
  } else {
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (userEl) userEl.classList.add('hidden');
    if (hintEl) hintEl.innerHTML = '<svg class="si" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> Sign in with GitHub to leave comment pins';
    setOwnerButtonsVisible(false);
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
      const versionOverlay = document.getElementById('ui-version-picker-overlay');
      if (versionOverlay && !versionOverlay.hidden) {
        document.getElementById('ui-version-picker-cancel')?.click();
        return;
      }

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
