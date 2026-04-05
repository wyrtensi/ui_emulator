/**
 * Settings — global state manager for the emulator.
 * Persists to localStorage, emits events on change.
 */

const STORAGE_KEY = 'ui-ui-settings';

const defaults = {
  scale: 1.0,
  bgScale: 1.0,
  autoFitScale: true,
  screenBounds: true,
  snapToGrid: false,
  gridSize: 10,
  background: '',        // URL or data-URI
  backgroundType: '',    // 'image' | 'video' | ''
  backgroundColor: '#0a0e18',
  mode: 'design',        // 'design' | 'export' | 'comment'
  authorName: '',
  windowVersions: {},    // { [windowId]: versionKey }
  windowOpacity: {},     // { [windowId]: opacityPercent 0..100 }
};

class Settings {
  constructor() {
    this._state = { ...defaults };
    this._listeners = {};
    this._load();
  }

  /* ── Getters ──────────────────────────────────────── */
  get(key) {
    return this._state[key];
  }

  getAll() {
    return { ...this._state };
  }

  /* ── Setters ──────────────────────────────────────── */
  set(key, value) {
    if (!(key in defaults)) return;
    const old = this._state[key];
    if (old === value) return;
    this._state[key] = value;
    this._save();
    this._emit(key, value, old);
    this._emit('*', key, value, old);
  }

  /* ── Events ───────────────────────────────────────── */
  on(key, fn) {
    (this._listeners[key] ??= []).push(fn);
    return () => this.off(key, fn);
  }

  off(key, fn) {
    const arr = this._listeners[key];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }

  _emit(key, ...args) {
    for (const fn of (this._listeners[key] ?? [])) {
      fn(...args);
    }
  }

  /* ── Persistence ──────────────────────────────────── */
  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._state));
    } catch { /* quota exceeded — ignore */ }
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const k of Object.keys(defaults)) {
          if (k in parsed) this._state[k] = parsed[k];
        }
      }
    } catch { /* corrupted — ignore, use defaults */ }
  }

  reset() {
    this._state = { ...defaults };
    this._save();
    this._emit('*', null, null, null);
  }
}

export const settings = new Settings();
