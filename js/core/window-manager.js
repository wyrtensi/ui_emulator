/**
 * Window Manager — registry, open/close/focus, z-index stack.
 * Behaves like a desktop OS: click to focus, newest on top.
 */

import { settings } from './settings.js';

class WindowManager {
  constructor() {
    /** @type {Map<string, {config: object, container: HTMLElement, open: boolean}>} */
    this._windows = new Map();
    this._zStack = [];    // ordered list of ids, last = top
    this._baseZ = 100;
    this._bus = new EventTarget();
  }

  /* ── Registration ─────────────────────────────────── */
  register(id, config, container) {
    this._windows.set(id, { config, container, open: false });
    // Click anywhere on the window → focus it
    container.addEventListener('pointerdown', () => this.focus(id), true);
  }

  get(id) {
    return this._windows.get(id);
  }

  getAll() {
    return [...this._windows.entries()].map(([id, w]) => ({
      id,
      config: w.config,
      container: w.container,
      open: w.open,
    }));
  }

  /* ── Open / Close / Toggle ────────────────────────── */
  open(id) {
    const w = this._windows.get(id);
    if (!w) return;
    w.open = true;
    w.container.classList.add('open');
    this.focus(id);
    this._emit('window:opened', id);
  }

  close(id) {
    const w = this._windows.get(id);
    if (!w) return;
    w.open = false;
    w.container.classList.remove('open');
    this._removeFromStack(id);
    this._emit('window:closed', id);
  }

  toggle(id) {
    const w = this._windows.get(id);
    if (!w) return;
    w.open ? this.close(id) : this.open(id);
  }

  isOpen(id) {
    return this._windows.get(id)?.open ?? false;
  }

  /* ── Focus / Z-index ──────────────────────────────── */
  focus(id) {
    const w = this._windows.get(id);
    if (!w || !w.open) return;
    this._removeFromStack(id);
    this._zStack.push(id);
    this._applyZStack();
    this._emit('window:focused', id);
  }

  getZIndex(id) {
    const idx = this._zStack.indexOf(id);
    return idx >= 0 ? this._baseZ + idx : this._baseZ;
  }

  _removeFromStack(id) {
    const i = this._zStack.indexOf(id);
    if (i >= 0) this._zStack.splice(i, 1);
  }

  _applyZStack() {
    for (let i = 0; i < this._zStack.length; i++) {
      const w = this._windows.get(this._zStack[i]);
      if (w) w.container.style.zIndex = this._baseZ + i;
    }
  }

  /* ── Position / Size helpers ──────────────────────── */
  setPosition(id, x, y) {
    const w = this._windows.get(id);
    if (!w) return;
    w.container.style.left = x + 'px';
    w.container.style.top = y + 'px';
  }

  getPosition(id) {
    const w = this._windows.get(id);
    if (!w) return { x: 0, y: 0 };
    return {
      x: parseFloat(w.container.style.left) || 0,
      y: parseFloat(w.container.style.top) || 0,
    };
  }

  setSize(id, width, height) {
    const w = this._windows.get(id);
    if (!w) return;
    w.container.style.width = width + 'px';
    w.container.style.height = height + 'px';
  }

  getSize(id) {
    const w = this._windows.get(id);
    if (!w) return { width: 0, height: 0 };
    return {
      width: w.container.offsetWidth,
      height: w.container.offsetHeight,
    };
  }

  resetPosition(id, manifest) {
    const entry = manifest?.windows?.find(e => e.id === id);
    if (!entry) return;
    const dp = entry.defaultPosition;
    this.setPosition(id, dp.x, dp.y);
    if (dp.width) this.setSize(id, dp.width, dp.height);
  }

  /* ── Layout snapshot ──────────────────────────────── */
  captureLayout() {
    const windows = [];
    for (const [id, w] of this._windows) {
      const pos = this.getPosition(id);
      const size = this.getSize(id);
      windows.push({
        id,
        open: w.open,
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        zIndex: this.getZIndex(id),
      });
    }
    return windows;
  }

  restoreLayout(windowStates) {
    // Sort by zIndex so we open in correct stacking order
    const sorted = [...windowStates].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    // Close all first
    for (const [id] of this._windows) {
      this.close(id);
    }
    for (const ws of sorted) {
      if (!this._windows.has(ws.id)) continue;
      this.setPosition(ws.id, ws.x, ws.y);
      if (ws.width && ws.height) this.setSize(ws.id, ws.width, ws.height);
      if (ws.open) this.open(ws.id);
    }
  }

  /* ── Events ───────────────────────────────────────── */
  on(event, fn) {
    this._bus.addEventListener(event, fn);
    return () => this._bus.removeEventListener(event, fn);
  }

  _emit(event, id) {
    this._bus.dispatchEvent(new CustomEvent(event, { detail: { id } }));
  }
}

export const windowManager = new WindowManager();
