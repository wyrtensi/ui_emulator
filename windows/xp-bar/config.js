export default {
  id: 'xp-bar',
  title: 'XP Bar',
  dragHandle: '.xp-container',
  resizable: {
    enabled: true,
    handles: ['e', 'w'],
    minWidth: 400,
    minHeight: 50,
    maxWidth: 1000,
  },
  exports: [
    { selector: '[data-export="xp-full"]', name: 'full', label: 'Full XP Bar' },
  ],
  init() {},
};
