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
    { selector: '[data-export="inv-title"]', name: 'title', label: 'Title Text' },
    { selector: '[data-export="inv-close"]', name: 'close', label: 'Close Button' },
    { selector: '[data-export="inv-toolbar"]', name: 'toolbar', label: 'Tabs & Search' },
    { selector: '[data-export="inv-tabs"]', name: 'tabs', label: 'Filter Tabs' },
    { selector: '[data-export="inv-search"]', name: 'search', label: 'Search Field' },
    { selector: '[data-export="inv-grid"]', name: 'grid', label: 'Item Grid' },
    { selector: '[data-export="inv-cell"]', name: 'cell', label: 'Individual Cells' },
    { selector: '[data-export="inv-footer"]', name: 'footer', label: 'Footer Bar' },
    { selector: '[data-export="inv-count"]', name: 'count', label: 'Slot Count' },
    { selector: '[data-export="inv-gold"]', name: 'gold', label: 'Gold Amount' },
  ],
  init(container) {
    const grid = container.querySelector('.inv-grid');
    if (!grid) return;

    const cellTemplate = (hasItem) => {
      const c = document.createElement('div');
      // Wrap cell in export padding
      c.dataset.export = "inv-cell";
      c.style.padding = "10px";
      c.style.margin = "-10px";

      const inner = document.createElement('div');
      inner.className = 'inv-cell' + (hasItem ? ' has' : '');
      inner.innerHTML = '<div class="inv-cell-inner"></div>';
      c.appendChild(inner);
      return c;
    };

    const fillGrid = () => {
      const w = grid.clientWidth;
      const h = grid.clientHeight;
      const cellW = 42, cellH = 42, gap = 4;
      const cols = Math.floor((w + gap) / (cellW + gap)) || 1;
      const rows = Math.floor((h + gap) / (cellH + gap)) || 1;
      const total = cols * rows;
      const current = grid.children.length;

      if (total > current) {
        for (let i = current; i < total; i++) {
          grid.appendChild(cellTemplate(i < 7));
        }
      } else if (total < current) {
        for (let i = current; i > total; i--) grid.removeChild(grid.lastElementChild);
      }

      // Update counter
      const counter = container.querySelector('.inv-count');
      if (counter) {
        const filled = grid.querySelectorAll('.inv-cell.has').length;
        counter.textContent = filled + '/' + total + ' SLOTS';
      }
    };

    const ro = new ResizeObserver(() => fillGrid());
    ro.observe(grid);
    fillGrid();

    // Tab switching
    const tabs = container.querySelectorAll('.inv-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
      });
    });

    container.querySelector('.inv-close')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('inventory'));
    });
  },
};
