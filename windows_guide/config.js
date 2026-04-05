/**
 * Window template config for UI Emulator (current architecture).
 *
 * Copy this file to windows/{your-window-id}/config.js and update fields.
 * See windows_guide/WINDOW.md for the full guide.
 */
export default {
  id: 'my-window',
  title: 'My Window',
  defaultPosition: { x: 240, y: 180, width: 380, height: 320 },
  defaultOpen: false,

  // Pointer-down on this element starts dragging.
  dragHandle: '.wg-header',

  resizable: {
    enabled: true,
    handles: ['se', 'e', 's'],
    minWidth: 280,
    minHeight: 220,
    maxWidth: 760,
    maxHeight: 680,
  },

  exports: [
    { selector: '[data-export="wg-full"]', name: 'full', label: 'Full Window' },
    // Add granular slices only if you really need export assets per sub-part.
    // { selector: '[data-export="wg-tab"]', name: 'tab', label: 'Tab Button' },
    // { selector: '[data-export="wg-cell"]', name: 'cell', label: 'Cells (Items)' },
    // Prefer exporting element/cell containers, not text-only selectors.
    // Optional state variants (exported as extra files, e.g. tab_hover / tab_click):
    // {
    //   selector: '[data-export="wg-tab"]',
    //   name: 'tab',
    //   label: 'Tab Button',
    //   variants: [
    //     { state: 'hover', className: 'ui-export-hover' },
    //     { state: 'click', className: 'ui-export-click' },
    //   ],
    // },
  ],

  init(container) {
    const requestExportRefresh = () => {
      document.dispatchEvent(new CustomEvent('ui-export-refresh'));
    };

    const tabs = Array.from(container.querySelectorAll('.wg-tab'));
    const panels = Array.from(container.querySelectorAll('.wg-panel'));

    const applyTab = (nextTab) => {
      const requested = String(nextTab || '').toLowerCase();
      const validTabs = tabs.map(tab => String(tab.dataset.tab || '').toLowerCase()).filter(Boolean);
      const tabId = validTabs.includes(requested) ? requested : (validTabs[0] || 'info');

      tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === tabId));
      panels.forEach(panel => panel.classList.toggle('active', panel.dataset.panel === tabId));
      container.dataset.activeTab = tabId;
      requestExportRefresh();
    };

    tabs.forEach(tab => {
      tab.addEventListener('click', () => applyTab(tab.dataset.tab));
    });

    container.addEventListener('dblclick', (event) => {
      const valueEl = event.target.closest('.wg-value');
      if (!valueEl) return;
      const next = window.prompt('Set value', valueEl.textContent || '');
      if (next === null) return;
      valueEl.textContent = next;
      requestExportRefresh();
    });

    container._windowStateApi = {
      getState: () => ({
        activeTab: container.dataset.activeTab || (tabs.find(tab => tab.classList.contains('active'))?.dataset.tab || 'info'),
        values: Array.from(container.querySelectorAll('.wg-value')).map(el => el.textContent || ''),
      }),
      setState: (next = {}) => {
        if (Array.isArray(next.values)) {
          Array.from(container.querySelectorAll('.wg-value')).forEach((el, idx) => {
            if (idx < next.values.length) el.textContent = String(next.values[idx] || '');
          });
        }

        if (typeof next.activeTab === 'string') {
          applyTab(next.activeTab);
        } else {
          requestExportRefresh();
        }
      },
    };

    container.querySelector('.wg-close')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('my-window'));
    });

    applyTab(tabs.find(tab => tab.classList.contains('active'))?.dataset.tab || 'info');
  },

  captureState(container) {
    return container?._windowStateApi?.getState?.() || null;
  },

  applyState(container, state) {
    if (!state || typeof state !== 'object') return;
    container?._windowStateApi?.setState?.(state);
  },
};
