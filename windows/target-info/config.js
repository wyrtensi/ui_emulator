export default {
  id: 'target-info',
  title: 'Target Info',
  defaultPosition: { x: 170, y: 25, width: 380, height: 110 },
  defaultOpen: true,
  dragHandle: '.ti-header',
  resizable: {
    enabled: true,
    handles: ['e', 'w'],
    minWidth: 300,
    minHeight: 80,
    maxWidth: 500,
  },
  exports: [
    { selector: '[data-export="ti-full"]', name: 'full', label: 'Full Target' },
    { selector: '[data-export="ti-header"]', name: 'header', label: 'Header Bar' },
    { selector: '[data-export="ti-title"]', name: 'title', label: 'Title Text' },
    { selector: '[data-export="ti-close"]', name: 'close', label: 'Close Button' },
    { selector: '[data-export="ti-body"]', name: 'body', label: 'Body Content' },
    { selector: '[data-export="ti-info"]', name: 'info', label: 'Name & Level' },
    { selector: '[data-export="ti-level"]', name: 'level', label: 'Level Badge' },
    { selector: '[data-export="ti-name"]', name: 'name', label: 'Target Name' },
    { selector: '[data-export="ti-dist"]', name: 'dist', label: 'Distance' },
    { selector: '[data-export="ti-health"]', name: 'health', label: 'Health Bar' },
    { selector: '[data-export="ti-bottom"]', name: 'bottom', label: 'Bottom Row' },
    { selector: '[data-export="ti-race"]', name: 'race', label: 'Race Label' },
    { selector: '[data-export="ti-pct"]', name: 'pct', label: 'HP Percent' },
  ],
  init(container) {
    container.querySelector('.ti-close')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('target-info'));
    });
  },
};
