/**
 * Context Menu — custom right-click menu for windows and viewport.
 * Blocks default browser context menu within the viewport area.
 */

import { windowManager } from './window-manager.js';

class ContextMenu {
  constructor() {
    this._el = null;
    this._ul = null;
    this._onClickOutside = this._onClickOutside.bind(this);
    /** @type {function|null} Callback for "open window" from viewport menu */
    this._onOpenWindowRequest = null;
    /** @type {function|null} Callback for export single window */
    this._onExportWindow = null;
    /** @type {object|null} Manifest reference for listing closed windows */
    this._manifest = null;
  }

  init({ manifest, onOpenWindowRequest, onExportWindow }) {
    this._el = document.getElementById('ui-context-menu');
    this._ul = this._el.querySelector('ul');
    this._manifest = manifest;
    this._onOpenWindowRequest = onOpenWindowRequest;
    this._onExportWindow = onExportWindow;

    const viewport = document.getElementById('ui-viewport');
    viewport.addEventListener('contextmenu', (e) => this._onContext(e));
    document.addEventListener('contextmenu', (e) => {
      if (viewport.contains(e.target)) e.preventDefault();
    });
  }

  _onContext(e) {
    e.preventDefault();
    e.stopPropagation();

    // Determine if click was on a window
    const windowEl = e.target.closest('.ui-window');
    const items = [];

    if (windowEl) {
      const id = windowEl.dataset.windowId;
      const config = windowManager.get(id)?.config;

      items.push({ label: `📌 ${config?.title || id}`, disabled: true });
      items.push({ separator: true });
      items.push({
        label: 'Close Window',
        action: () => windowManager.close(id),
      });
      items.push({
        label: 'Reset Position',
        action: () => {
          if (this._manifest) windowManager.resetPosition(id, this._manifest);
        },
      });
      items.push({ separator: true });
      items.push({
        label: 'Export Window PNG',
        action: () => this._onExportWindow?.(id),
      });
    } else {
      // Viewport context menu — list closed windows to open
      const closedWindows = windowManager.getAll().filter(w => !w.open);
      if (closedWindows.length > 0) {
        items.push({ label: 'Open Window', disabled: true });
        items.push({ separator: true });
        for (const w of closedWindows) {
          items.push({
            label: w.config.title || w.id,
            action: () => windowManager.open(w.id),
          });
        }
      } else {
        items.push({ label: 'All windows open', disabled: true });
      }
    }

    this._show(e.clientX, e.clientY, items);
  }

  _show(x, y, items) {
    this._ul.innerHTML = '';

    for (const item of items) {
      const li = document.createElement('li');
      if (item.separator) {
        li.className = 'separator';
      } else {
        li.textContent = item.label;
        if (item.disabled) {
          li.style.color = 'var(--panel-text-dim)';
          li.style.cursor = 'default';
          li.style.fontWeight = '600';
          li.style.fontSize = '11px';
        } else {
          li.addEventListener('click', () => {
            this._hide();
            item.action?.();
          });
        }
      }
      this._ul.appendChild(li);
    }

    // Position — keep on screen
    this._el.hidden = false;
    this._el.style.left = x + 'px';
    this._el.style.top = y + 'px';

    // Adjust if overflows
    requestAnimationFrame(() => {
      const rect = this._el.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        this._el.style.left = (x - rect.width) + 'px';
      }
      if (rect.bottom > window.innerHeight) {
        this._el.style.top = (y - rect.height) + 'px';
      }
    });

    document.addEventListener('pointerdown', this._onClickOutside, true);
  }

  _hide() {
    this._el.hidden = true;
    document.removeEventListener('pointerdown', this._onClickOutside, true);
  }

  _onClickOutside(e) {
    if (!this._el.contains(e.target)) {
      this._hide();
    }
  }
}

export const contextMenu = new ContextMenu();
