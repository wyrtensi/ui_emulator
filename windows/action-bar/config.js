export default {
  id: 'action-bar',
  title: 'Action Bar',
  defaultPosition: { x: 698, y: 780, width: 524, height: 190 },
  defaultOpen: true,
  dragHandle: '.ab-move-btn',
  resizable: {
    enabled: false,
    handles: [],
    minWidth: 52,
    minHeight: 52,
    maxWidth: 900,
    maxHeight: 400,
  },
  exports: [
    { selector: '[data-export="ab-full"]', name: 'full', label: 'Full Action Bar' },
    { selector: '[data-export="ab-left"]', name: 'left', label: 'Left Buttons' },
    {
      selector: '[data-export="ab-move"]',
      name: 'move',
      label: 'Move Handle',
      variants: [
        { state: 'hover', className: 'ui-export-hover' },
        { state: 'click', className: 'ui-export-click' },
      ],
    },
    {
      selector: '[data-export="ab-settings"]',
      name: 'settings',
      label: 'Settings Button',
      variants: [
        { state: 'hover', className: 'ui-export-hover' },
        { state: 'click', className: 'ui-export-click' },
      ],
    },
    {
      selector: '[data-export="ab-lock"]',
      name: 'lock',
      label: 'Lock Button',
      variants: [
        { state: 'hover', className: 'ui-export-hover' },
        { state: 'click', className: 'ui-export-click' },
      ],
    },
    { selector: '[data-export="ab-grid"]', name: 'grid', label: 'Grid Wrap' },
    { selector: '[data-export="ab-slots"]', name: 'slots', label: 'Slot Grid' },
    {
      selector: '[data-export="ab-slot"]',
      name: 'slot',
      label: 'Cells (Slots)',
      variants: [
        { state: 'hover', className: 'ui-export-hover' },
        { state: 'click', className: 'ui-export-click' },
      ],
    },
    { selector: '[data-export="ab-slot-inner"]', name: 'slot-inner', label: 'Slot Inner Area' },
    { selector: '[data-export="ab-slot-dot"]', name: 'slot-dot', label: 'Slot Dots' },
    {
      selector: '[data-export="ab-right"]',
      name: 'right',
      label: 'Resize Arrow',
      variants: [
        { state: 'hover', className: 'ui-export-hover' },
        { state: 'click', className: 'ui-export-click' },
      ],
    },
  ],
  init(container) {
    const grid = container.querySelector('.ab-grid');
    if (!grid) return;
    const requestExportRefresh = () => {
      window.dispatchEvent(new CustomEvent('ui-export-refresh'));
    };

    const cellW = 48, cellH = 48, gap = 4;

    const slotTemplate = (key) => {
      const s = document.createElement('div');
      s.className = 'ab-slot';
      s.dataset.export = 'ab-slot'; // Expose individual slot
      s.innerHTML = `<div class="ab-slot-inner" data-export="ab-slot-inner"></div><div class="ab-dot" data-export="ab-slot-dot"></div><span class="ab-label" data-export="ab-slot-label">${key}</span>`;
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

    // Snap container size to cell grid
    const snapToCell = () => {
      const leftW = container.querySelector('.ab-left')?.offsetWidth || 0;
      const mainGap = 2; // .ab-main gap
      const gridW = container.offsetWidth - leftW - mainGap;
      const gridH = container.offsetHeight;

      const cols = Math.max(1, Math.floor((gridW + gap) / (cellW + gap)));
      const rows = Math.max(1, Math.floor((gridH + gap) / (cellH + gap)));

      const snappedGridW = cols * (cellW + gap) - gap;
      const snappedGridH = rows * (cellH + gap) - gap;

      const snappedW = snappedGridW + leftW + mainGap;
      const snappedH = snappedGridH;

      container.style.width = snappedW + 'px';
      container.style.height = snappedH + 'px';
    };

    const fillGrid = () => {
      const w = grid.clientWidth;
      const h = grid.clientHeight;
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

      requestExportRefresh();
    };

    const getSlotLabels = () => {
      return Array.from(grid.querySelectorAll('.ab-label')).map(label => label.textContent || '');
    };

    const applySlotLabels = (labels = []) => {
      if (!Array.isArray(labels)) return;
      const nodes = Array.from(grid.querySelectorAll('.ab-label'));
      nodes.forEach((node, idx) => {
        if (idx >= labels.length) return;
        node.textContent = String(labels[idx] || '');
      });
    };

    // Custom resize via the arrow handle
    const arrow = container.querySelector('.ab-resize-arrow');
    if (arrow) {
      let dragging = false, startX, startY, origW, origH, origX, origY;

      arrow.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        origW = container.offsetWidth;
        origH = container.offsetHeight;
        origX = container.offsetLeft;
        origY = container.offsetTop;
        e.preventDefault(); e.stopPropagation();
        arrow.setPointerCapture(e.pointerId);
      });

      arrow.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        // ne: right grows width, up grows height & moves top
        let newW = origW + dx;
        let newH = origH - dy;
        let newY = origY + dy;

        // Snap to cell grid
        const leftW = container.querySelector('.ab-left')?.offsetWidth || 0;
        const mainGap = 2;
        const availW = newW - leftW - mainGap;
        const cols = Math.max(1, Math.round((availW + gap) / (cellW + gap)));
        const rows = Math.max(1, Math.round((newH + gap) / (cellH + gap)));

        const snappedGridW = cols * (cellW + gap) - gap;
        const snappedGridH = rows * (cellH + gap) - gap;
        const snappedW = snappedGridW + leftW + mainGap;
        const snappedH = snappedGridH;
        const snappedY = origY + (origH - snappedH);

        container.style.width = snappedW + 'px';
        container.style.height = snappedH + 'px';
        container.style.top = snappedY + 'px';
      });

      arrow.addEventListener('pointerup', (e) => {
        if (!dragging) return;
        dragging = false;
        arrow.releasePointerCapture(e.pointerId);
        fillGrid();
        requestExportRefresh();
      });
    }

    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(fillGrid);
    });
    ro.observe(grid);

    grid.addEventListener('dblclick', (event) => {
      const labelEl = event.target.closest('.ab-label');
      if (!labelEl) return;

      const next = window.prompt('Set slot label', labelEl.textContent || '');
      if (next === null) return;
      labelEl.textContent = next;
      requestExportRefresh();
    });

    container._actionBarStateApi = {
      getState: () => ({ labels: getSlotLabels() }),
      setState: (next = {}) => {
        if (Array.isArray(next.labels)) {
          applySlotLabels(next.labels);
          requestExportRefresh();
        }
      },
    };

    // Initial snap + fill
    requestAnimationFrame(() => {
      snapToCell();
      fillGrid();
      requestExportRefresh();
    });
  },

  captureState(container) {
    return container?._actionBarStateApi?.getState?.() || null;
  },

  applyState(container, state) {
    if (!state || typeof state !== 'object') return;
    container?._actionBarStateApi?.setState?.(state);
  },
};
