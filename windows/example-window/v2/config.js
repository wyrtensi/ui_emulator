/**
 * Example Window v2 - command deck layout.
 */
export default {
  id: 'example-window',
  title: 'Example Window',
  defaultPosition: { x: 220, y: 140, width: 420, height: 340 },
  defaultOpen: false,
  dragHandle: '.example-v2-header',
  resizable: {
    enabled: true,
    handles: ['se', 'e', 's'],
    minWidth: 320,
    minHeight: 240,
    maxWidth: 700,
    maxHeight: 540,
  },
  exports: [
    { selector: '[data-export="example-v2-full"]', name: 'full', label: 'Full Window' },
    { selector: '[data-export="example-v2-header"]', name: 'header', label: 'Header' },
    { selector: '[data-export="example-v2-title-wrap"]', name: 'title-wrap', label: 'Title Wrap' },
    { selector: '[data-export="example-v2-kicker"]', name: 'kicker', label: 'Kicker' },
    { selector: '[data-export="example-v2-title"]', name: 'title', label: 'Title' },
    {
      selector: '[data-export="example-v2-close"]',
      name: 'close',
      label: 'Close Button',
      variants: [
        { state: 'hover', className: 'ui-export-hover' },
        { state: 'click', className: 'ui-export-click' },
      ],
    },
    { selector: '[data-export="example-v2-grid"]', name: 'grid', label: 'Stats Grid' },
    { selector: '[data-export="example-v2-mode"]', name: 'mode', label: 'Mode Switch' },
    {
      selector: '[data-export="example-v2-mode-btn"]',
      name: 'mode-button',
      label: 'Mode Button',
      variants: [
        { state: 'hover', className: 'ui-export-hover' },
        { state: 'click', className: 'ui-export-click' },
      ],
    },
    { selector: '[data-export="example-v2-panel"]', name: 'panel', label: 'Mode Panel' },
    { selector: '[data-export="example-v2-card"]', name: 'card', label: 'Cards' },
    { selector: '[data-export="example-v2-card-label"]', name: 'card-label', label: 'Card Labels' },
    { selector: '[data-export="example-v2-card-value"]', name: 'card-value', label: 'Card Values' },
  ],
  init(container) {
    const requestExportRefresh = () => {
      document.dispatchEvent(new CustomEvent('ui-export-refresh'));
    };

    const modeButtons = Array.from(container.querySelectorAll('.example-v2-mode-btn'));
    const modePanels = Array.from(container.querySelectorAll('.example-v2-panel'));

    const applyMode = (nextMode) => {
      const requested = String(nextMode || '').toLowerCase();
      const validModes = modeButtons.map(btn => String(btn.dataset.mode || '').toLowerCase()).filter(Boolean);
      const mode = validModes.includes(requested) ? requested : (validModes[0] || 'combat');

      modeButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
      modePanels.forEach(panel => panel.classList.toggle('active', panel.dataset.mode === mode));
      container.dataset.activeMode = mode;
      requestExportRefresh();
    };

    modeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        applyMode(btn.dataset.mode);
      });
    });

    container.addEventListener('dblclick', (event) => {
      const editable = event.target.closest('.example-v2-card-value, .example-v2-title, .example-v2-kicker');
      if (!editable) return;

      const next = window.prompt('Set value', editable.textContent || '');
      if (next === null) return;
      editable.textContent = next;
      requestExportRefresh();
    });

    container._exampleV2StateApi = {
      getState: () => ({
        activeMode: container.dataset.activeMode || (modeButtons.find(btn => btn.classList.contains('active'))?.dataset.mode || 'combat'),
        kicker: container.querySelector('.example-v2-kicker')?.textContent || '',
        title: container.querySelector('.example-v2-title')?.textContent || '',
        cardValues: Array.from(container.querySelectorAll('.example-v2-card-value')).map(el => el.textContent || ''),
      }),
      setState: (next = {}) => {
        if (typeof next.kicker === 'string') {
          const kickerEl = container.querySelector('.example-v2-kicker');
          if (kickerEl) kickerEl.textContent = next.kicker;
        }
        if (typeof next.title === 'string') {
          const titleEl = container.querySelector('.example-v2-title');
          if (titleEl) titleEl.textContent = next.title;
        }
        if (Array.isArray(next.cardValues)) {
          Array.from(container.querySelectorAll('.example-v2-card-value')).forEach((el, idx) => {
            if (idx < next.cardValues.length) el.textContent = String(next.cardValues[idx] || '');
          });
        }
        if (typeof next.activeMode === 'string') {
          applyMode(next.activeMode);
        } else {
          requestExportRefresh();
        }
      },
    };

    applyMode(modeButtons.find(btn => btn.classList.contains('active'))?.dataset.mode || 'combat');

    container.querySelector('.example-v2-close')?.addEventListener('click', () => {
      import('../../../js/core/window-manager.js').then(m => m.windowManager.close('example-window'));
    });
  },

  captureState(container) {
    return container?._exampleV2StateApi?.getState?.() || null;
  },

  applyState(container, state) {
    if (!state || typeof state !== 'object') return;
    container?._exampleV2StateApi?.setState?.(state);
  },
};
