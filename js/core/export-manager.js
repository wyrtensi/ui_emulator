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

  _createRenderMarker() {
    return `ui-export-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  _hasClipPath(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const clipPath = style?.clipPath || style?.webkitClipPath;
    return !!clipPath && clipPath !== 'none';
  }

  _splitTopLevelComma(input) {
    const parts = [];
    let depth = 0;
    let start = 0;

    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === ',' && depth === 0) {
        parts.push(input.slice(start, i).trim());
        start = i + 1;
      }
    }

    const tail = input.slice(start).trim();
    if (tail) parts.push(tail);
    return parts;
  }

  _resolveClipLength(rawValue, basis) {
    const value = String(rawValue || '').trim();
    if (!value) return 0;

    if (value.startsWith('calc(') && value.endsWith(')')) {
      const inner = value.slice(5, -1).trim();
      const terms = inner.match(/[+-]?\s*[^+-]+/g) || [];
      let total = 0;

      for (const termRaw of terms) {
        const term = termRaw.trim();
        if (!term) continue;

        let sign = 1;
        let body = term;
        if (body.startsWith('+')) body = body.slice(1).trim();
        else if (body.startsWith('-')) {
          sign = -1;
          body = body.slice(1).trim();
        }

        total += sign * this._resolveClipLength(body, basis);
      }

      return total;
    }

    if (value.endsWith('%')) {
      const n = Number.parseFloat(value);
      return Number.isFinite(n) ? (n / 100) * basis : 0;
    }

    if (value.endsWith('px')) {
      const n = Number.parseFloat(value);
      return Number.isFinite(n) ? n : 0;
    }

    const numeric = Number.parseFloat(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  _parsePolygonClipPath(clipPath, width, height) {
    const raw = String(clipPath || '').trim();
    if (!raw.startsWith('polygon(') || !raw.endsWith(')')) return null;

    const inner = raw.slice('polygon('.length, -1).trim();
    const pointChunks = this._splitTopLevelComma(inner).filter(Boolean);
    const points = [];

    for (const chunk of pointChunks) {
      // Skip optional polygon fill-rule token (e.g. evenodd).
      if (/^(nonzero|evenodd)$/i.test(chunk)) continue;

      const coords = chunk.match(/calc\([^)]*\)|-?\d*\.?\d+(?:px|%)?/g);
      if (!coords || coords.length < 2) continue;

      const x = this._resolveClipLength(coords[0], width);
      const y = this._resolveClipLength(coords[1], height);
      points.push({ x, y });
    }

    return points.length >= 3 ? points : null;
  }

  _extractClipMask(element) {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const style = window.getComputedStyle(element);
    const clipPath = style?.clipPath || style?.webkitClipPath;
    if (!clipPath || clipPath === 'none') return null;

    const points = this._parsePolygonClipPath(clipPath, rect.width, rect.height);
    if (!points) return null;

    return {
      type: 'polygon',
      width: rect.width,
      height: rect.height,
      points,
    };
  }

  _applyClipMaskToCanvas(canvas, mask) {
    if (!canvas || !mask || mask.type !== 'polygon' || !Array.isArray(mask.points) || mask.points.length < 3) {
      return canvas;
    }

    const ratioX = canvas.width / mask.width;
    const ratioY = canvas.height / mask.height;
    const output = document.createElement('canvas');
    output.width = canvas.width;
    output.height = canvas.height;

    const ctx = output.getContext('2d');
    if (!ctx) return canvas;

    ctx.save();
    ctx.beginPath();
    mask.points.forEach((point, idx) => {
      const x = point.x * ratioX;
      const y = point.y * ratioY;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();

    return output;
  }

  _normalizeVariantSuffix(value) {
    const raw = String(value || 'variant').trim().toLowerCase();
    const normalized = raw
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return normalized || 'variant';
  }

  _getExportVariants(exportDef) {
    if (!Array.isArray(exportDef?.variants)) return [];

    return exportDef.variants
      .filter((variant) => variant && typeof variant === 'object')
      .map((variant) => ({
        state: typeof variant.state === 'string' ? variant.state : '',
        className: typeof variant.className === 'string' ? variant.className : '',
        selector: typeof variant.selector === 'string' ? variant.selector : '',
        attributes: variant.attributes && typeof variant.attributes === 'object' ? variant.attributes : null,
        style: variant.style && typeof variant.style === 'object' ? variant.style : null,
      }))
      .filter((variant) => variant.state || variant.className || variant.selector || variant.attributes || variant.style);
  }

  _applyVariantToClone(cloneRoot, variant) {
    if (!cloneRoot || !variant || typeof variant !== 'object') return;

    const targets = variant.selector
      ? Array.from(cloneRoot.querySelectorAll(variant.selector))
      : [cloneRoot];

    if (targets.length === 0) return;

    for (const target of targets) {
      if (variant.className) {
        for (const classToken of variant.className.split(/\s+/).filter(Boolean)) {
          target.classList.add(classToken);
        }
      }

      if (variant.attributes) {
        for (const [key, val] of Object.entries(variant.attributes)) {
          if (val === null || typeof val === 'undefined') continue;
          target.setAttribute(key, String(val));
        }
      }

      if (variant.style) {
        for (const [prop, val] of Object.entries(variant.style)) {
          if (val === null || typeof val === 'undefined') continue;
          target.style.setProperty(prop, String(val));
        }
      }
    }
  }

  async _renderTargetWithVariants(element, windowId, exportDef, baseExportName, scale) {
    const files = [];

    const base = await this._renderToPNG(element, windowId, baseExportName, scale, null);
    if (base) files.push(base);

    const variants = this._getExportVariants(exportDef);
    for (const variant of variants) {
      const suffix = this._normalizeVariantSuffix(variant.state || variant.className || 'variant');
      const variantFile = await this._renderToPNG(
        element,
        windowId,
        `${baseExportName}_${suffix}`,
        scale,
        variant,
      );
      if (variantFile) files.push(variantFile);
    }

    return files;
  }

  _getRenderableMatches(container, selector) {
    if (!container || !selector) return [];
    return Array.from(container.querySelectorAll(selector)).filter((el) => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rects = el.getClientRects();
      if (!rects || rects.length === 0) return false;
      const rect = rects[0];
      return rect.width > 0.5 && rect.height > 0.5;
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
      const files = await this._renderTargetWithVariants(els[0], windowId, exportDef, exportName, scale);
      if (files.length === 0) return null;
      return files.length === 1 ? files[0] : files;
    }

    const results = [];
    for (let i = 0; i < els.length; i++) {
      const files = await this._renderTargetWithVariants(
        els[i],
        windowId,
        exportDef,
        `${exportName}_${i + 1}`,
        scale,
      );
      results.push(...files);
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
  async _renderToPNG(element, windowId, exportName, scale = 2, variant = null) {
    element.classList.remove('ui-export-highlight');

    const isSVG = element.tagName.toLowerCase() === 'svg' || element.closest('svg') !== null;
    const clipMask = this._extractClipMask(element);
    const hasClipPath = this._hasClipPath(element);
    const needsPaddingHack = !isSVG && !hasClipPath;
    const renderMarker = this._createRenderMarker();
    element.setAttribute('data-ui-export-marker', renderMarker);

    const transparent = this._transparentEl?.checked ?? true;

    try {
      const renderOptions = {
        backgroundColor: transparent ? null : '#000000',
        scale,
        useCORS: true,
        logging: false,
        onclone: (doc) => {
          const clone = doc.querySelector(`[data-ui-export-marker="${renderMarker}"]`);
          if (!clone) return;

          clone.classList.remove('ui-export-highlight');
          this._applyVariantToClone(clone, variant);

          // Padding hack is still useful for glow/box-shadow overflow,
          // but should not be applied to clip-path targets.
          if (needsPaddingHack) {
            clone.style.padding = '10px';
            clone.style.margin = '-10px';
          }
        },
      };

      let canvas;
      try {
        canvas = await html2canvas(element, {
          ...renderOptions,
          foreignObjectRendering: true,
        });
      } catch (renderError) {
        console.warn('[ExportManager] foreignObject rendering failed, retrying standard mode:', renderError);
        canvas = await html2canvas(element, {
          ...renderOptions,
          foreignObjectRendering: false,
        });
      }

      const maskedCanvas = clipMask ? this._applyClipMaskToCanvas(canvas, clipMask) : canvas;
      const blob = await new Promise(resolve => maskedCanvas.toBlob(resolve, 'image/png'));
      if (!blob) return null;

      const filename = `${windowId}_${exportName}_${scale}x.png`;
      return { blob, filename };
    } finally {
      element.removeAttribute('data-ui-export-marker');
      if (settings.get('mode') === 'export') {
        element.classList.add('ui-export-highlight');
      }
    }
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
    const files = await this._renderTargetWithVariants(
      highlighted,
      windowId,
      exportDef,
      `${exportDef.name}${suffix}`,
      scale,
    );
    this._hideProgress();

    if (files.length === 1) {
      this._downloadBlob(files[0].blob, files[0].filename);
      this._toast(`Exported: ${files[0].filename}`, 'success');
      return;
    }

    if (files.length > 1) {
      await this._downloadZip(files);
      this._toast(`Exported ${files.length} files (state variants included)`, 'success');
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
        const variantCount = this._getExportVariants(exp).length;
        const variantHTML = variantCount > 0
          ? ` <span class="export-variant-count">(+${variantCount} states)</span>`
          : '';

        const item = document.createElement('label');
        item.className = 'export-tree-item';
        item.innerHTML = `
          <input type="checkbox" ${hasMatches ? 'checked' : ''} ${hasMatches ? '' : 'disabled'} data-window-id="${w.id}" data-export-name="${exp.name}">
          <span>${exp.label || exp.name}${countHTML}${variantHTML}</span>
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
