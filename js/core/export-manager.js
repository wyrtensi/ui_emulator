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
  }

  init() {
    this._exportTreeEl = document.getElementById('rfo-export-tree');
    this._exportScaleEl = document.getElementById('rfo-export-scale');
    this._transparentEl = document.getElementById('rfo-export-transparent');
    this._progressEl = document.getElementById('rfo-export-progress');
    this._progressText = this._progressEl?.querySelector('.ep-text');
    this._progressBar = this._progressEl?.querySelector('.ep-bar-fill');

    document.getElementById('rfo-export-selected')?.addEventListener('click', () => this.exportSelected());
    document.getElementById('rfo-export-all')?.addEventListener('click', () => this.exportAll());

    settings.on('mode', (val) => {
      if (val === 'export') {
        this._enableHighlights();
        this._buildTree();
      } else {
        this._disableHighlights();
      }
    });
  }

  _toast(msg, type = 'info') {
    if (typeof window.rfoToast === 'function') window.rfoToast(msg, type);
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

    const el = entry.container.querySelector(exportDef.selector);
    if (!el) return null;

    const scale = parseInt(this._exportScaleEl?.value || '2');
    return this._renderToPNG(el, windowId, exportName, scale);
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
    const checked = this._exportTreeEl?.querySelectorAll('input[type="checkbox"]:checked') ?? [];
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
        if (result) files.push(result);
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
        if (result) files.push(result);
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
    element.classList.remove('rfo-export-highlight');

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
      element.classList.add('rfo-export-highlight');
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
    this._downloadBlob(content, `rfo-export-${Date.now()}.zip`);
  }

  /* ── Export mode UI ─────────────────────────────────── */
  _enableHighlights() {
    for (const w of windowManager.getAll()) {
      if (!w.config.exports) continue;
      for (const exp of w.config.exports) {
        const el = w.container.querySelector(exp.selector);
        if (el) {
          el.classList.add('rfo-export-highlight');
          el.addEventListener('click', this._onHighlightClick);
        }
      }
    }
  }

  _disableHighlights() {
    document.querySelectorAll('.rfo-export-highlight').forEach(el => {
      el.classList.remove('rfo-export-highlight');
      el.removeEventListener('click', this._onHighlightClick);
    });
  }

  _onHighlightClick = async (e) => {
    if (settings.get('mode') !== 'export') return;
    const el = e.currentTarget;
    const windowEl = el.closest('.rfo-window');
    if (!windowEl) return;

    const windowId = windowEl.dataset.windowId;
    const entry = windowManager.get(windowId);
    if (!entry?.config.exports) return;

    const exportDef = entry.config.exports.find(exp =>
      el.matches(exp.selector) || el.querySelector(exp.selector)
    );
    if (!exportDef) return;

    this._showProgress('Exporting element...');
    const scale = parseInt(this._exportScaleEl?.value || '2');
    const result = await this._renderToPNG(el, windowId, exportDef.name, scale);
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
      this._exportTreeEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = true;
        cb.indeterminate = false;
      });
    });

    const deselectAllBtn = document.createElement('button');
    deselectAllBtn.textContent = 'Deselect All';
    deselectAllBtn.className = 'panel-btn';
    deselectAllBtn.style.flex = '1';
    deselectAllBtn.addEventListener('click', () => {
      this._exportTreeEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
        cb.indeterminate = false;
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
        details.querySelectorAll('input[type="checkbox"][data-window-id]').forEach(cb => {
          cb.checked = isChecked;
        });
      });

      const titleSpan = document.createElement('span');
      titleSpan.textContent = w.config.title || w.id;

      summary.appendChild(toggleAllCb);
      summary.appendChild(titleSpan);
      details.appendChild(summary);

      for (const exp of w.config.exports) {
        const item = document.createElement('label');
        item.className = 'export-tree-item';
        item.innerHTML = `
          <input type="checkbox" checked data-window-id="${w.id}" data-export-name="${exp.name}">
          <span>${exp.label || exp.name}</span>
        `;

        // Update the parent toggle checkbox if children are toggled
        const cb = item.querySelector('input');
        cb.addEventListener('change', () => {
          const total = details.querySelectorAll('input[type="checkbox"][data-window-id]').length;
          const checked = details.querySelectorAll('input[type="checkbox"][data-window-id]:checked').length;
          toggleAllCb.checked = (total === checked);
          toggleAllCb.indeterminate = (checked > 0 && checked < total);
        });

        details.appendChild(item);
      }

      this._exportTreeEl.appendChild(details);
    }
  }
}

export const exportManager = new ExportManager();
