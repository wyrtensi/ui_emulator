/**
 * Example Window v1 - classic tab layout.
 */
export default {
  id: 'example-window',
  title: 'Example Window',
  defaultPosition: { x: 200, y: 150, width: 380, height: 320 },
  defaultOpen: false,
  dragHandle: '.example-header',
  resizable: {
    enabled: true,
    handles: ['se', 'e', 's'],
    minWidth: 280,
    minHeight: 220,
    maxWidth: 600,
    maxHeight: 500,
  },
  exports: [
    { selector: '[data-export="example-full"]', name: 'full', label: 'Full Window' },
    { selector: '[data-export="example-header"]', name: 'header', label: 'Header Bar' },
    { selector: '[data-export="example-title"]', name: 'title', label: 'Title' },
    { selector: '[data-export="example-close"]', name: 'close', label: 'Close Button' },
    { selector: '[data-export="example-tabs"]', name: 'tabs', label: 'Tab Row' },
    { selector: '[data-export="example-tab"]', name: 'tab', label: 'Single Tab' },
    { selector: '[data-export="example-content"]', name: 'content', label: 'Content Area' },
    { selector: '[data-export="example-panel"]', name: 'panel', label: 'Panels' },
    { selector: '[data-export="example-row"]', name: 'row', label: 'Info Rows' },
    { selector: '[data-export="example-label"]', name: 'label', label: 'Labels' },
    { selector: '[data-export="example-value"]', name: 'value', label: 'Values' },
    { selector: '[data-export="example-bars"]', name: 'bars', label: 'Bar Group' },
    { selector: '[data-export="example-bar"]', name: 'bar', label: 'Bars' },
    { selector: '[data-export="example-bar-fill"]', name: 'bar-fill', label: 'Bar Fill' },
    { selector: '[data-export="example-bar-text"]', name: 'bar-text', label: 'Bar Text' },
    { selector: '[data-export="example-stat-grid"]', name: 'stat-grid', label: 'Stat Grid' },
    { selector: '[data-export="example-stat"]', name: 'stat', label: 'Stats' },
    { selector: '[data-export="example-stat-label"]', name: 'stat-label', label: 'Stat Labels' },
    { selector: '[data-export="example-stat-value"]', name: 'stat-value', label: 'Stat Values' },
    { selector: '[data-export="example-hint"]', name: 'hint', label: 'Hints' },
  ],
  init(container) {
    const requestExportRefresh = () => {
      document.dispatchEvent(new CustomEvent('ui-export-refresh'));
    };

    const tabs = Array.from(container.querySelectorAll('.example-tab'));
    const panels = Array.from(container.querySelectorAll('.example-panel'));

    const applyTab = (nextTab) => {
      const requested = String(nextTab || '').toLowerCase();
      const allTabs = tabs.map(tab => String(tab.dataset.tab || '').toLowerCase()).filter(Boolean);
      const targetTab = allTabs.includes(requested) ? requested : (allTabs[0] || 'info');

      tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === targetTab));
      panels.forEach(panel => panel.classList.toggle('active', panel.dataset.panel === targetTab));
      container.dataset.activeTab = targetTab;
      requestExportRefresh();
    };

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        applyTab(tab.dataset.tab);
      });
    });

    container.addEventListener('dblclick', (event) => {
      const editable = event.target.closest('.example-value, .stat-value, .example-bar-text, .example-hint');
      if (!editable) return;

      const next = window.prompt('Set value', editable.textContent || '');
      if (next === null) return;
      editable.textContent = next;
      requestExportRefresh();
    });

    container.querySelectorAll('.example-bar-fill').forEach((fillEl) => {
      fillEl.addEventListener('dblclick', () => {
        const current = parseFloat((fillEl.style.width || '0').replace('%', '')) || 0;
        const next = window.prompt('Set bar percent (0-100)', String(current));
        if (next === null) return;
        const parsed = Number.parseFloat(next);
        if (!Number.isFinite(parsed)) return;
        const clamped = Math.max(0, Math.min(100, parsed));
        fillEl.style.width = `${clamped}%`;
        requestExportRefresh();
      });
    });

    container._exampleV1StateApi = {
      getState: () => ({
        activeTab: container.dataset.activeTab || (tabs.find(tab => tab.classList.contains('active'))?.dataset.tab || 'info'),
        values: Array.from(container.querySelectorAll('.example-value')).map(el => el.textContent || ''),
        statValues: Array.from(container.querySelectorAll('.stat-value')).map(el => el.textContent || ''),
        barTexts: Array.from(container.querySelectorAll('.example-bar-text')).map(el => el.textContent || ''),
        barFills: Array.from(container.querySelectorAll('.example-bar-fill')).map(el => el.style.width || ''),
      }),
      setState: (next = {}) => {
        if (Array.isArray(next.values)) {
          Array.from(container.querySelectorAll('.example-value')).forEach((el, idx) => {
            if (idx < next.values.length) el.textContent = String(next.values[idx] || '');
          });
        }

        if (Array.isArray(next.statValues)) {
          Array.from(container.querySelectorAll('.stat-value')).forEach((el, idx) => {
            if (idx < next.statValues.length) el.textContent = String(next.statValues[idx] || '');
          });
        }

        if (Array.isArray(next.barTexts)) {
          Array.from(container.querySelectorAll('.example-bar-text')).forEach((el, idx) => {
            if (idx < next.barTexts.length) el.textContent = String(next.barTexts[idx] || '');
          });
        }

        if (Array.isArray(next.barFills)) {
          Array.from(container.querySelectorAll('.example-bar-fill')).forEach((el, idx) => {
            if (idx < next.barFills.length) el.style.width = String(next.barFills[idx] || '');
          });
        }

        if (typeof next.activeTab === 'string') {
          applyTab(next.activeTab);
        } else {
          requestExportRefresh();
        }
      },
    };

    applyTab(tabs.find(tab => tab.classList.contains('active'))?.dataset.tab || 'info');

    container.querySelector('.example-close')?.addEventListener('click', () => {
      import('../../../js/core/window-manager.js').then(m => m.windowManager.close('example-window'));
    });
  },

  captureState(container) {
    return container?._exampleV1StateApi?.getState?.() || null;
  },

  applyState(container, state) {
    if (!state || typeof state !== 'object') return;
    container?._exampleV1StateApi?.setState?.(state);
  },
};
