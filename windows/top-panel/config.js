export default {
  id: 'top-panel',
  title: '',
  defaultPosition: { x: 20, y: 55, width: 500, height: 65 },
  defaultOpen: true,
  hideHeader: true,
  dragHandle: '.top-bar',
  resizable: {
    enabled: true,
    handles: ['se', 's', 'e'],
    minWidth: 360,
    minHeight: 65,
    maxWidth: 980,
    maxHeight: 120,
  },
  exports: [
    { selector: '[data-export="top-panel-full"]', name: 'full', label: 'Top Panel Full' },
    { selector: '[data-export="top-panel-emblem"]', name: 'emblem', label: 'Gold Emblem' },
    { selector: '[data-export="top-panel-emblem-icon"]', name: 'emblem-icon', label: 'Gold Emblem Icon' },
    { selector: '[data-export="top-panel-middle"]', name: 'middle', label: 'Middle Panel' },
    { selector: '[data-export="top-panel-middle-icon"]', name: 'middle-icon', label: 'Middle Icons' },
    { selector: '[data-export="top-panel-timer"]', name: 'timer', label: 'Timer Panel' },
  ],
  init(container) {
    const requestExportRefresh = () => {
      document.dispatchEvent(new CustomEvent('ui-export-refresh'));
    };

    const timerText = container.querySelector('.timer-text');
    if (timerText) {
      timerText.addEventListener('dblclick', () => {
        const next = window.prompt('Set timer text', timerText.textContent || '');
        if (next === null) return;
        timerText.textContent = next;
        requestExportRefresh();
      });
    }

    container._topPanelStateApi = {
      getState: () => ({
        timerText: timerText ? (timerText.textContent || '') : '',
      }),
      setState: (next = {}) => {
        if (timerText && typeof next.timerText === 'string') {
          timerText.textContent = next.timerText;
          requestExportRefresh();
        }
      },
    };
  },

  captureState(container) {
    return container?._topPanelStateApi?.getState?.() || null;
  },

  applyState(container, state) {
    if (!state || typeof state !== 'object') return;
    container?._topPanelStateApi?.setState?.(state);
  },
};
