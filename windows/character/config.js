export default {
  id: 'character',
  title: 'Character',
  dragHandle: '.char-header',
  resizable: {
    enabled: true,
    handles: ['se', 's', 'e'],
    minWidth: 300,
    minHeight: 380,
    maxWidth: 500,
    maxHeight: 700,
  },
  exports: [
    { selector: '[data-export="char-full"]', name: 'full', label: 'Full Character' },
    { selector: '[data-export="char-equip"]', name: 'equip', label: 'Equipment Area' },
    { selector: '[data-export="char-stats"]', name: 'stats', label: 'Stats Panel' },
    { selector: '[data-export="char-mastery"]', name: 'mastery', label: 'Mastery Bars' },
  ],
  init(container) {
    // Tab switching
    const tabs = container.querySelectorAll('.char-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
      });
    });

    container.querySelector('.char-close')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('character'));
    });
  },
};
