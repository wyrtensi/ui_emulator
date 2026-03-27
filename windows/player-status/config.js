export default {
  id: 'player-status',
  title: 'Player Status',
  dragHandle: '.ps-header',
  resizable: {
    enabled: false,
    handles: [],
    minWidth: 380,
    minHeight: 200,
  },
  exports: [
    { selector: '[data-export="ps-full"]', name: 'full', label: 'Full HUD' },
    { selector: '[data-export="ps-bars"]', name: 'bars', label: 'Stat Bars' },
    { selector: '[data-export="ps-icon"]', name: 'icon', label: 'Race Icon' },
  ],
  init(container) {
    container.querySelector('.ps-close')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('player-status'));
    });
  },
};
