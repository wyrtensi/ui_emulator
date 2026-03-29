export default {
  id: 'character',
  title: 'Character',
  defaultPosition: { x: 390, y: 130, width: 340, height: 480 },
  defaultOpen: false,
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
    { selector: '[data-export="char-header"]', name: 'header', label: 'Header Bar' },
    { selector: '[data-export="char-title"]', name: 'title', label: 'Title Text' },
    { selector: '[data-export="char-tabs"]', name: 'tabs', label: 'Tab Row' },
    { selector: '[data-export="char-close"]', name: 'close', label: 'Close Button' },
    { selector: '[data-export="char-equip"]', name: 'equip', label: 'Equipment Area' },
    { selector: '[data-export="char-silhouette"]', name: 'silhouette', label: 'Silhouette' },
    { selector: '[data-export="char-stats"]', name: 'stats', label: 'Stats Panel' },
    { selector: '[data-export="char-stat-atk"]', name: 'stat-atk', label: 'Attack Stat' },
    { selector: '[data-export="char-stat-def"]', name: 'stat-def', label: 'Defense Stat' },
    { selector: '[data-export="char-stat-range"]', name: 'stat-range', label: 'Range Stat' },
    { selector: '[data-export="char-stat-hp"]', name: 'stat-hp', label: 'Max HP Stat' },
    { selector: '[data-export="char-mastery"]', name: 'mastery', label: 'Mastery Bars' },
    { selector: '[data-export="char-mastery-melee"]', name: 'mastery-melee', label: 'Melee Mastery' },
    { selector: '[data-export="char-mastery-range"]', name: 'mastery-range', label: 'Range Mastery' },
    { selector: '[data-export="char-mastery-def"]', name: 'mastery-def', label: 'Defense Mastery' },
    { selector: '[data-export="char-mastery-shield"]', name: 'mastery-shield', label: 'Shield Mastery' },
    { selector: '[data-export="char-slot"]', name: 'slot', label: 'Equipment Slots' },
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
