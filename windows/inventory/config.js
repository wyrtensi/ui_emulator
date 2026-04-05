export default {
  id: 'inventory',
  title: 'Inventory',
  defaultPosition: { x: 580, y: 130, width: 340, height: 380 },
  defaultOpen: false,
  dragHandle: '.inv-header',
  resizable: {
    enabled: true,
    handles: ['se', 's', 'e'],
    minWidth: 260,
    minHeight: 280,
    maxWidth: 500,
    maxHeight: 600,
  },
  exports: [
    { selector: '[data-export="inv-full"]', name: 'full', label: 'Full Inventory' },
    { selector: '[data-export="inv-header"]', name: 'header', label: 'Title Bar' },
    {
      selector: '[data-export="inv-close"]',
      name: 'close',
      label: 'Close Button',
      variants: [
        { state: 'hover', className: 'ui-export-hover' },
        { state: 'click', className: 'ui-export-click' },
      ],
    },
    { selector: '[data-export="inv-toolbar"]', name: 'toolbar', label: 'Tabs & Search' },
    { selector: '[data-export="inv-tabs"]', name: 'tabs', label: 'Filter Tabs' },
    {
      selector: '[data-export="inv-tab"]',
      name: 'tab',
      label: 'Single Tab',
      variants: [
        { state: 'hover', className: 'ui-export-hover' },
        { state: 'click', className: 'ui-export-click' },
      ],
    },
    {
      selector: '[data-export="inv-search"]',
      name: 'search',
      label: 'Search Field',
      variants: [
        { state: 'click', className: 'ui-export-click' },
      ],
    },
    { selector: '[data-export="inv-grid"]', name: 'grid', label: 'Item Grid' },
    {
      selector: '[data-export="inv-cell"]',
      name: 'cell',
      label: 'Individual Cells',
      variants: [
        { state: 'hover', className: 'ui-export-hover' },
        { state: 'click', className: 'ui-export-click' },
      ],
    },
    { selector: '[data-export="inv-cell-inner"]', name: 'cell-inner', label: 'Cell Inner Area' },
    { selector: '[data-export="inv-footer"]', name: 'footer', label: 'Footer Bar' },
  ],
  init(container) {
    const grid = container.querySelector('.inv-grid');
    if (!grid) return;
    const requestExportRefresh = () => {
      window.dispatchEvent(new CustomEvent('ui-export-refresh'));
    };

    const tabs = Array.from(container.querySelectorAll('.inv-tab'));
    const counter = container.querySelector('.inv-count');
    const goldEl = container.querySelector('.inv-gold');

    const state = {
      activeTab: tabs.find(t => t.classList.contains('active'))?.dataset.tab || 'ALL',
      filled: 7,
      gold: goldEl?.textContent || '',
    };

    const cellTemplate = (hasItem) => {
      const c = document.createElement('div');
      c.className = 'inv-cell' + (hasItem ? ' has' : '');
      c.dataset.export = 'inv-cell'; // Expose individual cell
      c.innerHTML = '<div class="inv-cell-inner" data-export="inv-cell-inner"></div>';
      return c;
    };

    const applyTabState = () => {
      tabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === state.activeTab);
      });
    };

    const fillGrid = () => {
      const w = grid.clientWidth;
      const h = grid.clientHeight;
      const cellW = 42, cellH = 42, gap = 4;
      const cols = Math.floor((w + gap) / (cellW + gap)) || 1;
      const rows = Math.floor((h + gap) / (cellH + gap)) || 1;
      const total = cols * rows;
      const current = grid.children.length;
      const clampedFilled = Math.max(0, Math.min(total, Math.floor(Number(state.filled) || 0)));

      state.filled = clampedFilled;

      if (total > current) {
        for (let i = current; i < total; i++) {
          grid.appendChild(cellTemplate(i < state.filled));
        }
      } else if (total < current) {
        for (let i = current; i > total; i--) grid.removeChild(grid.lastElementChild);
      }

      Array.from(grid.children).forEach((cell, idx) => {
        cell.classList.toggle('has', idx < state.filled);
      });

      // Update counter
      if (counter) {
        counter.textContent = state.filled + '/' + total + ' SLOTS';
      }

      if (goldEl) {
        goldEl.textContent = state.gold;
      }

      requestExportRefresh();
    };

    const ro = new ResizeObserver(() => fillGrid());
    ro.observe(grid);
    fillGrid();

    // Tab switching
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        state.activeTab = tab.dataset.tab || tab.textContent.trim();
        applyTabState();
        requestExportRefresh();
      });
    });

    goldEl?.addEventListener('dblclick', () => {
      const next = window.prompt('Set gold label', state.gold);
      if (next === null) return;
      state.gold = next;
      fillGrid();
    });

    counter?.addEventListener('dblclick', () => {
      const next = window.prompt('Set filled slots count', String(state.filled));
      if (next === null) return;
      state.filled = Math.max(0, Math.floor(Number(next) || 0));
      fillGrid();
    });

    const setState = (next = {}) => {
      if (Object.prototype.hasOwnProperty.call(next, 'activeTab')) {
        state.activeTab = String(next.activeTab || 'ALL').toUpperCase();
      }
      if (Object.prototype.hasOwnProperty.call(next, 'filled')) {
        state.filled = Math.max(0, Math.floor(Number(next.filled) || 0));
      }
      if (Object.prototype.hasOwnProperty.call(next, 'gold')) {
        state.gold = String(next.gold || '');
      }

      applyTabState();
      fillGrid();
    };

    container._invStateApi = {
      getState: () => ({ ...state }),
      setState,
    };

    applyTabState();

    container.querySelector('.inv-close')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('inventory'));
    });
  },

  captureState(container) {
    return container?._invStateApi?.getState?.() || null;
  },

  applyState(container, state) {
    if (!state || typeof state !== 'object') return;
    container?._invStateApi?.setState?.(state);
  },
};
