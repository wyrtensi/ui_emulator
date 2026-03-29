export default {
  id: 'abilities',
  title: 'Abilities',
  defaultPosition: { x: 1060, y: 160, width: 320, height: 420 },
  defaultOpen: false,
  dragHandle: '.abl-header',
  resizable: {
    enabled: true,
    handles: ['se', 's', 'e'],
    minWidth: 280,
    minHeight: 300,
    maxWidth: 480,
    maxHeight: 650,
  },
  exports: [
    { selector: '[data-export="abl-full"]', name: 'full', label: 'Full Abilities' },
    { selector: '[data-export="abl-header"]', name: 'header', label: 'Header Bar' },
    { selector: '[data-export="abl-title"]', name: 'title', label: 'Title Text' },
    { selector: '[data-export="abl-dots"]', name: 'dots', label: 'Color Dots' },
    { selector: '[data-export="abl-close"]', name: 'close', label: 'Close Button' },
    { selector: '[data-export="abl-cats"]', name: 'cats', label: 'Category Tabs' },
    { selector: '[data-export="abl-list"]', name: 'list', label: 'Skill List' },
    { selector: '[data-export="abl-skill"]', name: 'skill', label: 'Individual Skills' },
  ],
  init(container) {
    // Color-circle tab switching
    const dots = container.querySelectorAll('.abl-dot');
    dots.forEach(dot => {
      dot.addEventListener('click', () => {
        dots.forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
      });
    });

    // Category header switching
    const cats = container.querySelectorAll('.abl-cat');
    cats.forEach(cat => {
      cat.addEventListener('click', () => {
        cats.forEach(c => c.classList.remove('active'));
        cat.classList.add('active');
      });
    });

    container.querySelector('.abl-close')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('abilities'));
    });
  },
};
