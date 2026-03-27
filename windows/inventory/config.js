export default {
  id: 'inventory',
  title: 'Inventory',
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
    { selector: '[data-export="inv-grid"]', name: 'grid', label: 'Item Grid' },
  ],
  init(container) {
    const grid = container.querySelector('.inv-grid');
    if (!grid) return;

    const cellTemplate = (hasItem) => {
      const c = document.createElement('div');
      c.className = 'inv-cell' + (hasItem ? ' has' : '');
      c.innerHTML = '<div class="inv-cell-inner"></div>';
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
