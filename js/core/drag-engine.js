/**
 * Drag Engine — pointer-event-based window dragging.
 * Reads dragHandle from window config; respects screen bounds setting.
 */

import { settings } from './settings.js';
import { windowManager } from './window-manager.js';

class DragEngine {
  constructor() {
    this._active = null; // { id, startX, startY, origX, origY }
    this._viewport = null;
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
  }

  _clamp(value, min, max) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return value;
    if (max < min) return min;
    return Math.max(min, Math.min(value, max));
  }

  /** Call once after DOM ready */
  init(viewport) {
    this._viewport = viewport;
  }

  /** Attach drag to a registered window */
  attach(id) {
    const entry = windowManager.get(id);
    if (!entry) return;
    const { config, container } = entry;
    const handle = container.querySelector(config.dragHandle);
    if (!handle) return;

    handle.style.cursor = 'move';
    handle.addEventListener('pointerdown', (e) => this._onDown(e, id));
  }

  /* ── Internal ─────────────────────────────────────── */
  _onDown(e, id) {
    // Ignore if not primary button or if target is interactive
    if (e.button !== 0) return;
    if (e.target.closest('input, textarea, select, button, a')) return;

    const entry = windowManager.get(id);
    if (!entry) return;

    const pos = windowManager.getPosition(id);
    const scale = settings.get('scale');

    this._active = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };

    windowManager.focus(id);
    e.preventDefault();
    document.addEventListener('pointermove', this._onMove);
    document.addEventListener('pointerup', this._onUp);
  }

  _onMove(e) {
    if (!this._active) return;
    const a = this._active;
    const scale = settings.get('scale');

    let newX = a.origX + (e.clientX - a.startX) / scale;
    let newY = a.origY + (e.clientY - a.startY) / scale;

    // Snap to grid
    if (settings.get('snapToGrid')) {
      const gs = settings.get('gridSize') || 10;
      newX = Math.round(newX / gs) * gs;
      newY = Math.round(newY / gs) * gs;
    }

    // Screen bounds
    if (settings.get('screenBounds') && this._viewport) {
      const entry = windowManager.get(a.id);
      if (entry) {
        const vw = this._viewport.clientWidth;
        const vh = this._viewport.clientHeight;
        const ww = entry.container.offsetWidth;
        const wh = entry.container.offsetHeight;

        let minX = 0;
        let minY = 0;
        let maxX = vw - ww;
        let maxY = vh - wh;

        // At lower UI scales, the viewport is centered with outer margins.
        // Extend bounds into those margins so windows can pass the scaled frame.
        if (scale < 1) {
          const safeScale = Math.max(0.001, scale);
          const rect = this._viewport.getBoundingClientRect();

          const marginMinX = (0 - rect.left) / safeScale;
          const marginMinY = (0 - rect.top) / safeScale;
          const marginMaxX = (window.innerWidth - rect.left) / safeScale - ww;
          const marginMaxY = (window.innerHeight - rect.top) / safeScale - wh;

          minX = Math.min(minX, marginMinX);
          minY = Math.min(minY, marginMinY);
          maxX = Math.max(maxX, marginMaxX);
          maxY = Math.max(maxY, marginMaxY);
        }

        newX = this._clamp(newX, minX, maxX);
        newY = this._clamp(newY, minY, maxY);
      }
    }

    windowManager.setPosition(a.id, newX, newY);
  }

  _onUp() {
    this._active = null;
    document.removeEventListener('pointermove', this._onMove);
    document.removeEventListener('pointerup', this._onUp);
  }
}

export const dragEngine = new DragEngine();
