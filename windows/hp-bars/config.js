export default {
  id: 'hp-bars',
  title: '',
  defaultPosition: { x: 20, y: 130, width: 500, height: 180 },
  defaultOpen: true,
  hideHeader: true,
  dragHandle: null,
  resizable: {
    enabled: false,
    handles: [],
    minWidth: 500,
    minHeight: 180,
  },
  exports: [
    { selector: '[data-export="hp-bars-full"]', name: 'full', label: 'HP Bars Full' },
    { selector: '[data-export="hp-bars-container"]', name: 'container', label: 'Bars Container' },
    { selector: '[data-export="hp-bar-row"]', name: 'row', label: 'Individual Bars' },
    { selector: '[data-export="hp-bar-fill"]', name: 'fill', label: 'Bar Fills' },
    { selector: '[data-export="hp-bar-label"]', name: 'label', label: 'Bar Labels' },
    { selector: '[data-export="hp-bar-icon"]', name: 'icon', label: 'Bar Icons' },
    { selector: '[data-export="hp-bar-label-text"]', name: 'label-text', label: 'Label Text' },
    { selector: '[data-export="hp-bar-value"]', name: 'value', label: 'Value Fields' },
    { selector: '[data-export="hp-bar-current"]', name: 'current', label: 'Current Values' },
    { selector: '[data-export="hp-bar-separator"]', name: 'separator', label: 'Value Separators' },
    { selector: '[data-export="hp-bar-max"]', name: 'max', label: 'Max Values' },
  ],
  init(container) {
    const requestExportRefresh = () => {
      document.dispatchEvent(new CustomEvent('ui-export-refresh'));
    };

    const rows = Array.from(container.querySelectorAll('.hud-bar'));

    const parseNumber = (text) => {
      const cleaned = String(text || '').replace(/[^\d.\-]/g, '');
      const parsed = Number.parseFloat(cleaned);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const updateBarFill = (row) => {
      const currentEl = row.querySelector('.current');
      const maxEl = row.querySelector('.max');
      const fillEl = row.querySelector('.hud-fill');
      if (!currentEl || !maxEl || !fillEl) return;

      const current = parseNumber(currentEl.textContent);
      const max = parseNumber(maxEl.textContent);
      const ratio = max > 0 ? (current / max) : 0;
      const pct = Math.max(0, Math.min(100, ratio * 100));
      fillEl.style.width = `${pct}%`;
    };

    const refreshAllBars = () => {
      rows.forEach(updateBarFill);
      requestExportRefresh();
    };

    container.addEventListener('dblclick', (event) => {
      const valueEl = event.target.closest('.current, .max');
      if (!valueEl) return;

      const promptLabel = valueEl.classList.contains('current') ? 'current value' : 'max value';
      const next = window.prompt(`Set ${promptLabel}`, valueEl.textContent || '');
      if (next === null) return;

      valueEl.textContent = next;
      const row = valueEl.closest('.hud-bar');
      if (row) updateBarFill(row);
      requestExportRefresh();
    });

    const getRowsState = () => {
      return rows.map((row) => {
        const bar = row.dataset.bar || '';
        const label = row.querySelector('[data-export="hp-bar-label-text"]')?.textContent || '';
        const current = row.querySelector('.current')?.textContent || '';
        const max = row.querySelector('.max')?.textContent || '';
        const fillWidth = row.querySelector('.hud-fill')?.style.width || '';
        return { bar, label, current, max, fillWidth };
      });
    };

    const setRowsState = (nextRows = []) => {
      if (!Array.isArray(nextRows)) return;
      rows.forEach((row, idx) => {
        if (idx >= nextRows.length) return;
        const payload = nextRows[idx] || {};
        const labelEl = row.querySelector('[data-export="hp-bar-label-text"]');
        const currentEl = row.querySelector('.current');
        const maxEl = row.querySelector('.max');
        const fillEl = row.querySelector('.hud-fill');

        if (labelEl && typeof payload.label === 'string') labelEl.textContent = payload.label;
        if (currentEl && typeof payload.current === 'string') currentEl.textContent = payload.current;
        if (maxEl && typeof payload.max === 'string') maxEl.textContent = payload.max;
        if (fillEl && typeof payload.fillWidth === 'string' && payload.fillWidth.trim()) {
          fillEl.style.width = payload.fillWidth;
        } else {
          updateBarFill(row);
        }
      });
    };

    container._hpBarsStateApi = {
      getState: () => ({ rows: getRowsState() }),
      setState: (next = {}) => {
        if (Array.isArray(next.rows)) {
          setRowsState(next.rows);
          requestExportRefresh();
        }
      },
    };

    refreshAllBars();
  },

  captureState(container) {
    return container?._hpBarsStateApi?.getState?.() || null;
  },

  applyState(container, state) {
    if (!state || typeof state !== 'object') return;
    container?._hpBarsStateApi?.setState?.(state);
  },
};
