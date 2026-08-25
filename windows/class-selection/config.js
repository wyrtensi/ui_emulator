export default {
  id: 'class-selection',
  title: 'Class Selection',
  defaultPosition: { x: 300, y: 150, width: 640, height: 480 },
  defaultOpen: false,
  dragHandle: '.class-header',
  opacityMode: 'frame',
  resizable: {
    enabled: true,
    handles: ['se', 's', 'e'],
    minWidth: 500,
    minHeight: 380,
    maxWidth: 800,
    maxHeight: 600,
  },
  exports: [
    { selector: '[data-export="class-full"]', name: 'full', label: 'Full Class Selection Window' }
  ],
  init(container) {
    const closeBtn = container.querySelector('.class-close');
    const cancelBtn = container.querySelector('.class-cancel-btn');
    const okBtn = container.querySelector('.class-ok-btn');

    const closeWindow = () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('class-selection'));
    };

    if (closeBtn) closeBtn.addEventListener('click', closeWindow);
    if (cancelBtn) cancelBtn.addEventListener('click', closeWindow);

    if (okBtn) {
      okBtn.addEventListener('click', () => {
        // Here we could handle the selection logic later
        closeWindow();
      });
    }

    // Handle class card selection
    const cards = Array.from(container.querySelectorAll('.class-card'));
    cards.forEach(card => {
      card.addEventListener('click', () => {
        cards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        // Update selection logic here if needed
        document.dispatchEvent(new CustomEvent('ui-export-refresh'));
      });
    });
  }
};
