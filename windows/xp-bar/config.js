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
    { selector: '[data-export="xp-bar"]', name: 'bar', label: 'Progress Arc' },
    { selector: '[data-export="xp-bg"]', name: 'bg', label: 'Background Path' },
    { selector: '[data-export="xp-fg"]', name: 'fg', label: 'Fill Path' },
    { selector: '[data-export="xp-text"]', name: 'text', label: 'Level & Percent' },
  ],
  init() {},
};
