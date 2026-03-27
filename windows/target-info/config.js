export default {
  id: 'target-info',
  title: 'Target Info',
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
    { selector: '[data-export="ti-info"]', name: 'info', label: 'Name & Level' },
    { selector: '[data-export="ti-health"]', name: 'health', label: 'Health Bar' },
  ],
  init(container) {
    container.querySelector('.ti-close')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('target-info'));
    });
  },
};
