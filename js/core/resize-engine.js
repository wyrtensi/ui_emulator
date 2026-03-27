/**
 * Resize Engine — creates invisible handles on window edges/corners.
 * Reads resizable config from window; enforces min/max dimensions.
 */

import { settings } from './settings.js';
import { windowManager } from './window-manager.js';

class ResizeEngine {
  constructor() {
    this._active = null;
    this._viewport = null;
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
  }

  init(viewport) {
    this._viewport = viewport;
  }

  /** Attach resize handles to a registered window */
  attach(id) {
    const entry = windowManager.get(id);
    if (!entry) return;
    const { config, container } = entry;
    const r = config.resizable;
    if (!r?.enabled) return;

    const handles = r.handles || ['se'];
    for (const dir of handles) {
      const handle = document.createElement('div');
      handle.className = `rfo-resize-handle ${dir}`;
      handle.addEventListener('pointerdown', (e) => this._onDown(e, id, dir));
      container.appendChild(handle);
    }
  }

  _onDown(e, id, dir) {
    if (e.button !== 0) return;
    const entry = windowManager.get(id);
    if (!entry) return;

    const pos = windowManager.getPosition(id);
    const size = windowManager.getSize(id);
    const scale = settings.get('scale');

    this._active = {
      id, dir,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x, origY: pos.y,
      origW: size.width, origH: size.height,
      config: entry.config.resizable,
    };

    windowManager.focus(id);
    e.preventDefault();
    e.stopPropagation();
    document.addEventListener('pointermove', this._onMove);
    document.addEventListener('pointerup', this._onUp);
  }

  _onMove(e) {
    if (!this._active) return;
    const a = this._active;
    const scale = settings.get('scale');
    const dx = (e.clientX - a.startX) / scale;
    const dy = (e.clientY - a.startY) / scale;
    const cfg = a.config;

    let newX = a.origX;
    let newY = a.origY;
    let newW = a.origW;
    let newH = a.origH;

    const dir = a.dir;

    // Width / X
    if (dir.includes('e')) {
      newW = a.origW + dx;
    } else if (dir.includes('w')) {
      newW = a.origW - dx;
      newX = a.origX + dx;
    }

    // Height / Y
    if (dir.includes('s')) {
      newH = a.origH + dy;
    } else if (dir.includes('n')) {
      newH = a.origH - dy;
      newY = a.origY + dy;
    }

    // Clamp
    const minW = cfg.minWidth ?? 50;
    const minH = cfg.minHeight ?? 50;
    const maxW = cfg.maxWidth ?? Infinity;
    const maxH = cfg.maxHeight ?? Infinity;

    if (newW < minW) {
      if (dir.includes('w')) newX -= (minW - newW);
      newW = minW;
    }
    if (newW > maxW) {
      if (dir.includes('w')) newX -= (maxW - newW);
      newW = maxW;
    }
    if (newH < minH) {
      if (dir.includes('n')) newY -= (minH - newH);
      newH = minH;
    }
    if (newH > maxH) {
      if (dir.includes('n')) newY -= (maxH - newH);
      newH = maxH;
    }

    // Snap
    if (settings.get('snapToGrid')) {
      const gs = settings.get('gridSize') || 10;
      newW = Math.round(newW / gs) * gs;
      newH = Math.round(newH / gs) * gs;
      newX = Math.round(newX / gs) * gs;
      newY = Math.round(newY / gs) * gs;
    }

    windowManager.setPosition(a.id, newX, newY);
    windowManager.setSize(a.id, newW, newH);
  }

  _onUp() {
    this._active = null;
    document.removeEventListener('pointermove', this._onMove);
    document.removeEventListener('pointerup', this._onUp);
  }
}

export const resizeEngine = new ResizeEngine();
