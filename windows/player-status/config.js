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
    { selector: '[data-export="ps-header"]', name: 'header', label: 'Header Bar' },
    { selector: '[data-export="ps-title"]', name: 'title', label: 'Title Text' },
    { selector: '[data-export="ps-close"]', name: 'close', label: 'Close Button' },
    { selector: '[data-export="ps-icon"]', name: 'icon', label: 'Race Icon' },
    { selector: '[data-export="ps-guild"]', name: 'guild', label: 'Guild Group' },
    { selector: '[data-export="ps-guild-name"]', name: 'guild-name', label: 'Guild Name' },
    { selector: '[data-export="ps-timer"]', name: 'timer', label: 'Timer' },
    { selector: '[data-export="ps-bars"]', name: 'bars', label: 'All Stat Bars' },
    { selector: '[data-export="ps-hp"]', name: 'hp', label: 'HP Bar' },
    { selector: '[data-export="ps-fp"]', name: 'fp', label: 'FP Bar' },
    { selector: '[data-export="ps-sp"]', name: 'sp', label: 'SP Bar' },
    { selector: '[data-export="ps-def"]', name: 'def', label: 'DEF Bar' },
  ],
  init(container) {
    container.querySelector('.ps-close')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('player-status'));
    });
  },
};
