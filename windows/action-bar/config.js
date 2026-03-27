export default {
  id: 'action-bar',
  title: 'Action Bar',
  dragHandle: '.ab-drag-zone',
  resizable: {
    enabled: true,
    handles: ['e', 'w'],
    minWidth: 200,
    minHeight: 56,
    maxWidth: 900,
    maxHeight: 200,
  },
  exports: [
    { selector: '[data-export="ab-full"]', name: 'full', label: 'Full Action Bar' },
    { selector: '[data-export="ab-grid"]', name: 'grid', label: 'Slot Grid' },
  ],
  init(container) {
    const grid = container.querySelector('.ab-grid');
    if (!grid) return;

    const slotTemplate = (key) => {
      const s = document.createElement('div');
      s.className = 'ab-slot';
      s.innerHTML = `<div class="ab-slot-inner"></div><div class="ab-dot"></div><span class="ab-label">${key}</span>`;
      return s;
    };

    const keys = ['F1','F2','F3','F4','F5','F6','F7','F8','F9'];

    const fillGrid = () => {
      const w = grid.clientWidth;
      const h = grid.clientHeight;
      const cellW = 48, cellH = 48, gap = 4;
      const cols = Math.floor((w + gap) / (cellW + gap)) || 1;
      const rows = Math.floor((h + gap) / (cellH + gap)) || 1;
      const total = cols * rows;
      const current = grid.children.length;

      if (total > current) {
        for (let i = current; i < total; i++) {
          const k = i < keys.length ? keys[i] : (i < 20 ? 'F'+(i+1) : '');
          grid.appendChild(slotTemplate(k));
        }
      } else if (total < current) {
        for (let i = current; i > total; i--) grid.removeChild(grid.lastElementChild);
      }
    };

    const ro = new ResizeObserver(() => fillGrid());
    ro.observe(grid);
    fillGrid();
  },
};
