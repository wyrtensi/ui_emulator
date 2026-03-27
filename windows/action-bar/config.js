export default {
  id: 'action-bar',
  title: 'Action Bar',
  dragHandle: '.ab-move-btn',
  resizable: {
    enabled: true,
    handles: ['e', 'w', 's', 'se'],
    minWidth: 200,
    minHeight: 56,
    maxWidth: 900,
    maxHeight: 400,
  },
  exports: [
    { selector: '[data-export="ab-full"]', name: 'full', label: 'Full Action Bar' },
    { selector: '[data-export="ab-grid"]', name: 'grid', label: 'Slot Grid' },
    { selector: '[data-export="ab-left"]', name: 'left', label: 'Left Buttons' },
    { selector: '[data-export="ab-right"]', name: 'right', label: 'Corner Button' },
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

    const allKeys = [
      'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
      '1','2','3','4','5','6','7','8','9','0',
      'Q','W','E','R','T','Y','U','I','O','P',
      'A','S','D','F','G','H','J','K','L',
      'Z','X','C','V','B','N','M',
    ];
    let lastTotal = -1;
    let rafId = 0;

    const fillGrid = () => {
      const w = grid.clientWidth;
      const h = grid.clientHeight;
      const cellW = 48, cellH = 48, gap = 4;
      const cols = Math.max(1, Math.floor((w + gap) / (cellW + gap)));
      const rows = Math.max(1, Math.floor((h + gap) / (cellH + gap)));
      const total = cols * rows;
      if (total === lastTotal) return;
      lastTotal = total;

      const current = grid.children.length;
      if (total > current) {
        for (let i = current; i < total; i++) {
          grid.appendChild(slotTemplate(i < allKeys.length ? allKeys[i] : ''));
        }
      } else if (total < current) {
        for (let i = current; i > total; i--) grid.removeChild(grid.lastElementChild);
      }
    };

    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(fillGrid);
    });
    ro.observe(grid);
    fillGrid();
  },
};
