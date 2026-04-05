/**
 * Layout Manager — preset save/load/share via JSON and URL hash.
 * Auto-saves to localStorage. Preset includes window states + comments.
 */

import { windowManager } from './window-manager.js';
import { settings } from './settings.js';

const AUTOSAVE_KEY = 'ui-ui-autosave';
const PRESET_VERSION = 1;
const WINDOW_OPACITY_MIN = 30;
const WINDOW_OPACITY_MAX = 100;
const WINDOW_OPACITY_DEFAULT = 100;

function normalizeWindowOpacityMap(rawMap) {
  if (!rawMap || typeof rawMap !== 'object') return {};

  const cleanMap = {};
  for (const [windowId, value] of Object.entries(rawMap)) {
    if (!windowId) continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) continue;
    const normalized = Math.max(
      WINDOW_OPACITY_MIN,
      Math.min(WINDOW_OPACITY_MAX, Math.round(numeric))
    );
    if (normalized !== WINDOW_OPACITY_DEFAULT) {
      cleanMap[windowId] = normalized;
    }
  }

  return cleanMap;
}

class LayoutManager {
  constructor() {
    this._commentManager = null; // set via init
    this._autoSaveTimer = null;
  }

  init({ commentManager }) {
    this._commentManager = commentManager;
    this._startAutoSave();
  }

  /* ── Capture current state ────────────────────────── */
  capture(name = 'Untitled') {
    const windowOpacity = normalizeWindowOpacityMap(settings.get('windowOpacity'));

    return {
      version: PRESET_VERSION,
      name,
      created: new Date().toISOString(),
      resolution: '1920x1080',
      scale: settings.get('scale'),
      windowOpacity,
      windows: windowManager.captureLayout(),
      comments: this._commentManager?.getAll() ?? [],
    };
  }

  /* ── Restore from preset data ─────────────────────── */
  restore(preset) {
    if (!preset || preset.version !== PRESET_VERSION) {
      console.warn('Incompatible preset version');
      return false;
    }

    if (preset.windowOpacity && typeof preset.windowOpacity === 'object') {
      settings.set('windowOpacity', normalizeWindowOpacityMap(preset.windowOpacity));
    } else {
      settings.set('windowOpacity', {});
    }

    if (preset.scale) settings.set('scale', preset.scale);
    if (preset.windows) windowManager.restoreLayout(preset.windows);
    if (preset.comments && this._commentManager) {
      this._commentManager.restoreAll(preset.comments);
    }
    return true;
  }

  /* ── Download JSON ────────────────────────────────── */
  downloadJSON(name) {
    const preset = this.capture(name || 'preset');
    const json = JSON.stringify(preset, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(name || 'preset').replace(/[^a-zA-Z0-9_-]/g, '_')}.ui.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ── Upload JSON ──────────────────────────────────── */
  async uploadJSON(file) {
    const text = await file.text();
    const preset = JSON.parse(text);
    return this.restore(preset);
  }

  /* ── URL sharing ──────────────────────────────────── */
  shareURL(name) {
    const preset = this.capture(name || 'shared');
    const json = JSON.stringify(preset);
    // Use lz-string (loaded from CDN, global)
    const compressed = LZString.compressToEncodedURIComponent(json);
    const url = `${location.origin}${location.pathname}#preset=${compressed}`;
    return url;
  }

  loadFromURL() {
    const hash = location.hash;
    if (!hash.startsWith('#preset=')) return false;
    try {
      const compressed = hash.slice('#preset='.length);
      const json = LZString.decompressFromEncodedURIComponent(compressed);
      if (!json) return false;
      const preset = JSON.parse(json);
      return this.restore(preset);
    } catch (e) {
      console.warn('Failed to load preset from URL:', e);
      return false;
    }
  }

  /* ── Auto-save to localStorage ────────────────────── */
  _startAutoSave() {
    setInterval(() => {
      this._autoSave();
    }, 5000);
  }

  _autoSave() {
    try {
      const preset = this.capture('autosave');
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(preset));
    } catch { /* ignore */ }
  }

  loadAutoSave() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return false;
      const preset = JSON.parse(raw);
      return this.restore(preset);
    } catch {
      return false;
    }
  }

  clearAutoSave() {
    localStorage.removeItem(AUTOSAVE_KEY);
  }

  /* ── Reset ────────────────────────────────────────── */
  resetAll(manifest) {
    this.clearAutoSave();
    if (this._commentManager) this._commentManager.clearAll();
    settings.set('windowOpacity', {});
    // Restore all windows to default positions from manifest
    for (const wDef of manifest.windows) {
      windowManager.resetPosition(wDef.id, manifest);
      windowManager.close(wDef.id);
      if (wDef.defaultOpen) windowManager.open(wDef.id);
    }
  }
}

export const layoutManager = new LayoutManager();
