/**
 * Export Manager v2 — element-level PNG export via html2canvas.
 * Features: progress overlay, transparent BG toggle, batch ZIP, toast feedback.
 */

import { windowManager } from './window-manager.js';
import { settings } from './settings.js';

class ExportManager {
  constructor() {
    this._exportTreeEl = null;
    this._exportScaleEl = null;
    this._transparentEl = null;
    this._progressEl = null;
    this._progressText = null;
    this._progressBar = null;
    this._highlightedEls = new Set();
    this._highlightMeta = new WeakMap();
    this._refreshRaf = 0;
  }

  init() {
    this._exportTreeEl = document.getElementById('ui-export-tree');
    this._exportScaleEl = document.getElementById('ui-export-scale');
    this._transparentEl = document.getElementById('ui-export-transparent');
    this._progressEl = document.getElementById('ui-export-progress');
    this._progressText = this._progressEl?.querySelector('.ep-text');
    this._progressBar = this._progressEl?.querySelector('.ep-bar-fill');

    document.getElementById('ui-export-selected')?.addEventListener('click', () => this.exportSelected());
    document.getElementById('ui-export-all')?.addEventListener('click', () => this.exportAll());

    settings.on('mode', (val) => {
      if (val === 'export') {
        this._queueRefresh();
      } else {
        this._disableHighlights();
      }
    });

    // Keep export highlights in sync with dynamic windows (inventory/action-bar/grid rebuilds).
    document.addEventListener('ui-export-refresh', this._onExternalRefresh);
    window.addEventListener('ui-export-refresh', this._onExternalRefresh);
    windowManager.on('window:opened', () => this._queueRefresh());
    windowManager.on('window:closed', () => this._queueRefresh());
  }

  _onExternalRefresh = () => {
    this._queueRefresh();
  };

  _queueRefresh() {
    if (settings.get('mode') !== 'export') return;
    if (this._refreshRaf) cancelAnimationFrame(this._refreshRaf);

    this._refreshRaf = requestAnimationFrame(() => {
      this._refreshRaf = 0;
      this._disableHighlights();
      this._enableHighlights();
      this._buildTree();
    });
  }

  _toast(msg, type = 'info') {
    if (typeof window.uiToast === 'function') window.uiToast(msg, type);
  }

  _getRenderableMatches(container, selector) {
    if (!container || !selector) return [];
    return Array.from(container.querySelectorAll(selector)).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  /* ── Progress overlay ──────────────────────────────── */
  _showProgress(text = 'Exporting...') {
    if (this._progressEl) {
      this._progressEl.hidden = false;
      if (this._progressText) this._progressText.textContent = text;
      if (this._progressBar) this._progressBar.style.width = '0%';
    }
  }

  _updateProgress(current, total) {
    if (this._progressBar) {
      this._progressBar.style.width = `${(current / total * 100).toFixed(0)}%`;
    }
    if (this._progressText) {
      this._progressText.textContent = `Exporting ${current}/${total}...`;
    }
  }

  _hideProgress() {
    if (this._progressEl) this._progressEl.hidden = true;
  }

  /* ── Export single element by id ────────────────────── */
  async exportElement(windowId, exportName) {
    const entry = windowManager.get(windowId);
    if (!entry) return null;

    const exportDef = entry.config.exports?.find(e => e.name === exportName);
    if (!exportDef) return null;

    const els = this._getRenderableMatches(entry.container, exportDef.selector);
    if (!els || els.length === 0) return null;

    const scale = parseInt(this._exportScaleEl?.value || '2');

    if (els.length === 1) {
      return this._renderToPNG(els[0], windowId, exportName, scale);
    }

    const results = [];
    for (let i = 0; i < els.length; i++) {
      const res = await this._renderToPNG(els[i], windowId, `${exportName}_${i + 1}`, scale);
      if (res) results.push(res);
    }
    return results.length > 0 ? results : null;
  }

  /* ── Export entire window ──────────────────────────── */
  async exportWindow(windowId) {
    const entry = windowManager.get(windowId);
    if (!entry) return null;

    const scale = parseInt(this._exportScaleEl?.value || '2');
    return this._renderToPNG(entry.container, windowId, 'full', scale);
  }

  /* ── Export selected checkboxes ─────────────────────── */
  async exportSelected() {
    // Exclude indeterminate or unchecked parent toggles without data-window-id
    const checked = this._exportTreeEl?.querySelectorAll('input[type="checkbox"][data-window-id]:checked:not([disabled])') ?? [];
    if (checked.length === 0) {
      this._toast('No elements selected for export', 'error');
      return;
    }

    this._showProgress();
    const files = [];
    let i = 0;

    for (const cb of checked) {
      const { windowId, exportName } = cb.dataset;
      this._updateProgress(++i, checked.length);

      try {
        const result = await this.exportElement(windowId, exportName);
        if (result) {
          if (Array.isArray(result)) {
            files.push(...result);
          } else {
            files.push(result);
          }
        }
      } catch (err) {
        console.error(`[ExportManager] Failed to export ${windowId}/${exportName}:`, err);
      }

      // Yield to main thread to prevent freezing during batch export and allow GC
      await new Promise(r => setTimeout(r, 100));
    }

    this._hideProgress();

    if (files.length === 1) {
      this._downloadBlob(files[0].blob, files[0].filename);
      this._toast(`Exported: ${files[0].filename}`, 'success');
    } else if (files.length > 1) {
      await this._downloadZip(files);
      this._toast(`Exported ${files.length} elements as ZIP`, 'success');
    }
  }

  /* ── Export all elements ────────────────────────────── */
  async exportAll() {
    const allExports = [];
    for (const w of windowManager.getAll()) {
      if (!w.config.exports) continue;
      for (const exp of w.config.exports) {
        allExports.push({ windowId: w.id, exportName: exp.name });
      }
    }

    if (allExports.length === 0) {
      this._toast('No exportable elements found', 'error');
      return;
    }

    this._showProgress();
    const files = [];

    for (let i = 0; i < allExports.length; i++) {
      this._updateProgress(i + 1, allExports.length);
      const { windowId, exportName } = allExports[i];

      try {
        const result = await this.exportElement(windowId, exportName);
        if (result) {
          if (Array.isArray(result)) {
            files.push(...result);
          } else {
            files.push(result);
          }
        }
      } catch (err) {
        console.error(`[ExportManager] Failed to export ${windowId}/${exportName}:`, err);
      }

      // Yield to main thread to prevent freezing during batch export and allow GC
      await new Promise(r => setTimeout(r, 100));
    }

    this._hideProgress();

    if (files.length > 0) {
      await this._downloadZip(files);
      this._toast(`Exported ${files.length} elements as ZIP`, 'success');
    }
  }

  /* ── Render to PNG via html2canvas ──────────────────── */
  async _renderToPNG(element, windowId, exportName, scale = 2) {
    element.classList.remove('ui-export-highlight');

    // Temporarily apply padding to prevent html2canvas from clipping box-shadows/glows
    const originalPadding = element.style.padding;
    const originalMargin = element.style.margin;

    // We only apply this hack if we're not inside an SVG (SVGs don't support HTML padding)
    const isSVG = element.tagName.toLowerCase() === 'svg' || element.closest('svg') !== null;
    if (!isSVG) {
      element.style.padding = '10px';
      element.style.margin = '-10px';
    }

    const transparent = this._transparentEl?.checked ?? true;

    const canvas = await html2canvas(element, {
      backgroundColor: transparent ? null : '#000000',
      scale,
      useCORS: true,
      logging: false,
    });

    // Restore original styles immediately after render
    if (!isSVG) {
      element.style.padding = originalPadding;
      element.style.margin = originalMargin;
    }

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const filename = `${windowId}_${exportName}_${scale}x.png`;

    if (settings.get('mode') === 'export') {
      element.classList.add('ui-export-highlight');
    }

    return { blob, filename };
  }

  /* ── Download helpers ───────────────────────────────── */
  _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async _downloadZip(files) {
    const zip = new JSZip();
    for (const f of files) {
      zip.file(f.filename, f.blob);
    }
    const content = await zip.generateAsync({ type: 'blob' });
    this._downloadBlob(content, `ui-export-${Date.now()}.zip`);
  }

  /* ── Export mode UI ─────────────────────────────────── */
  _enableHighlights() {
    for (const w of windowManager.getAll()) {
      if (!w.config.exports) continue;
      for (const exp of w.config.exports) {
        const els = this._getRenderableMatches(w.container, exp.selector);
        for (const el of els) {
          if (this._highlightMeta.has(el)) continue;
          el.classList.add('ui-export-highlight');
          el.addEventListener('click', this._onHighlightClick);
          this._highlightedEls.add(el);
          this._highlightMeta.set(el, { windowId: w.id, exportName: exp.name });
        }
      }
    }
  }

  _disableHighlights() {
    this._highlightedEls.forEach(el => {
      el.classList.remove('ui-export-highlight');
      el.removeEventListener('click', this._onHighlightClick);
    });
    this._highlightedEls.clear();
    this._highlightMeta = new WeakMap();
    document.querySelectorAll('.ui-export-highlight').forEach(el => {
      el.classList.remove('ui-export-highlight');
      el.removeEventListener('click', this._onHighlightClick);
    });
  }

  _onHighlightClick = async (e) => {
    if (settings.get('mode') !== 'export') return;
    const el = e.currentTarget;
    const windowEl = el.closest('.ui-window');
    if (!windowEl) return;

    const highlighted = e.currentTarget;
    const meta = this._highlightMeta.get(highlighted);
    const windowId = meta?.windowId || windowEl.dataset.windowId;
    const entry = windowManager.get(windowId);
    if (!entry?.config.exports) return;

    let exportDef = null;
    if (meta?.exportName) {
      exportDef = entry.config.exports.find(exp => exp.name === meta.exportName) || null;
    }

    if (!exportDef) {
      exportDef = entry.config.exports.find(exp => highlighted.matches(exp.selector)) || null;
    }

    if (!exportDef) return;

    // Find if it's one of multiple to append an index
    const els = this._getRenderableMatches(entry.container, exportDef.selector);
    const index = els.indexOf(highlighted);
    const suffix = index >= 0 && els.length > 1 ? `_${index + 1}` : '';

    this._showProgress('Exporting element...');
    const scale = parseInt(this._exportScaleEl?.value || '2');
    const result = await this._renderToPNG(highlighted, windowId, `${exportDef.name}${suffix}`, scale);
    this._hideProgress();

    if (result) {
      this._downloadBlob(result.blob, result.filename);
      this._toast(`Exported: ${result.filename}`, 'success');
    }
  };

  /* ── Export tree in panel ───────────────────────────── */
  _buildTree() {
    if (!this._exportTreeEl) return;
    this._exportTreeEl.innerHTML = '';

    const globalControls = document.createElement('div');
    globalControls.className = 'export-tree-controls';
    globalControls.style.display = 'flex';
    globalControls.style.gap = '8px';
    globalControls.style.marginBottom = '12px';

    const selectAllBtn = document.createElement('button');
    selectAllBtn.textContent = 'Select All';
    selectAllBtn.className = 'panel-btn';
    selectAllBtn.style.flex = '1';
    selectAllBtn.addEventListener('click', () => {
      this._exportTreeEl.querySelectorAll('input[type="checkbox"][data-window-id]:not([disabled])').forEach(cb => {
        cb.checked = true;
      });
      this._exportTreeEl.querySelectorAll('details.export-tree-window').forEach(details => {
        const parent = details.querySelector('summary > input[type="checkbox"]');
        if (!parent) return;
        const total = details.querySelectorAll('input[type="checkbox"][data-window-id]:not([disabled])').length;
        const checked = details.querySelectorAll('input[type="checkbox"][data-window-id]:checked:not([disabled])').length;
        parent.checked = total > 0 && total === checked;
        parent.indeterminate = checked > 0 && checked < total;
      });
    });

    const deselectAllBtn = document.createElement('button');
    deselectAllBtn.textContent = 'Deselect All';
    deselectAllBtn.className = 'panel-btn';
    deselectAllBtn.style.flex = '1';
    deselectAllBtn.addEventListener('click', () => {
      this._exportTreeEl.querySelectorAll('input[type="checkbox"][data-window-id]:not([disabled])').forEach(cb => {
        cb.checked = false;
      });
      this._exportTreeEl.querySelectorAll('details.export-tree-window').forEach(details => {
        const parent = details.querySelector('summary > input[type="checkbox"]');
        if (!parent) return;
        parent.checked = false;
        parent.indeterminate = false;
      });
    });

    globalControls.appendChild(selectAllBtn);
    globalControls.appendChild(deselectAllBtn);
    this._exportTreeEl.appendChild(globalControls);

    for (const w of windowManager.getAll()) {
      if (!w.config.exports || w.config.exports.length === 0) continue;

      const details = document.createElement('details');
      details.className = 'export-tree-window';
      details.open = true;

      const summary = document.createElement('summary');
      summary.style.display = 'flex';
      summary.style.alignItems = 'center';

      const toggleAllCb = document.createElement('input');
      toggleAllCb.type = 'checkbox';
      toggleAllCb.checked = true;
      toggleAllCb.style.marginRight = '8px';

      // Stop the details from toggling when clicking the checkbox
      toggleAllCb.addEventListener('click', (e) => e.stopPropagation());

      toggleAllCb.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        details.querySelectorAll('input[type="checkbox"][data-window-id]:not([disabled])').forEach(cb => {
          cb.checked = isChecked;
        });
      });

      const titleSpan = document.createElement('span');
      titleSpan.textContent = w.config.title || w.id;

      summary.appendChild(toggleAllCb);
      summary.appendChild(titleSpan);
      details.appendChild(summary);

      for (const exp of w.config.exports) {
        const matchCount = this._getRenderableMatches(w.container, exp.selector).length;
        const hasMatches = matchCount > 0;
        const countHTML = matchCount > 1 ? ` <span class="export-match-count">(${matchCount})</span>` : '';

        const item = document.createElement('label');
        item.className = 'export-tree-item';
        item.innerHTML = `
          <input type="checkbox" ${hasMatches ? 'checked' : ''} ${hasMatches ? '' : 'disabled'} data-window-id="${w.id}" data-export-name="${exp.name}">
          <span>${exp.label || exp.name}${countHTML}</span>
        `;

        // Update the parent toggle checkbox if children are toggled
        const cb = item.querySelector('input');
        cb.addEventListener('change', () => {
          const total = details.querySelectorAll('input[type="checkbox"][data-window-id]:not([disabled])').length;
          const checked = details.querySelectorAll('input[type="checkbox"][data-window-id]:checked:not([disabled])').length;
          toggleAllCb.checked = (total === checked);
          toggleAllCb.indeterminate = (checked > 0 && checked < total);
        });

        details.appendChild(item);
      }

      const enabledTotal = details.querySelectorAll('input[type="checkbox"][data-window-id]:not([disabled])').length;
      const enabledChecked = details.querySelectorAll('input[type="checkbox"][data-window-id]:checked:not([disabled])').length;
      toggleAllCb.checked = enabledTotal > 0 && enabledTotal === enabledChecked;
      toggleAllCb.indeterminate = enabledChecked > 0 && enabledChecked < enabledTotal;

      this._exportTreeEl.appendChild(details);
    }
  }
}

export const exportManager = new ExportManager();
