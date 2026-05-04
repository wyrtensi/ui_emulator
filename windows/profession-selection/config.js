export default {
  id: 'profession-selection',
  title: 'Profession Selection',
  defaultPosition: { x: 100, y: 100, width: 1200, height: 800 },
  defaultOpen: false,
  dragHandle: '.prof-header',
  resizable: {
    enabled: true,
    handles: ['se', 's', 'e'],
    minWidth: 800,
    minHeight: 600,
  },
  opacityMode: 'frame',
  exports: [
    { selector: '[data-export="prof-full"]', name: 'full', label: 'Profession Selection' },
  ],
  init(container) {
    // Add event listener for close button if required,
    // or let window-manager handle it via canonical path.
    const closeBtn = container.querySelector('.prof-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        import('../../js/core/window-manager.js').then(m => m.windowManager.close('profession-selection'));
      });
    }

    // Interaction handlers
    const classItems = container.querySelectorAll('.prof-class-item');
    classItems.forEach(item => {
      item.addEventListener('click', () => {
        container.querySelectorAll('.prof-class-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
      });
    });

    const profCards = container.querySelectorAll('.prof-card');
    profCards.forEach(card => {
      card.addEventListener('click', () => {
        container.querySelectorAll('.prof-card').forEach(el => el.classList.remove('selected'));
        card.classList.add('selected');

        // Update confirm button state
        const confirmBtn = container.querySelector('.prof-btn-confirm');
        if (confirmBtn) {
          confirmBtn.classList.remove('disabled');
        }
      });
    });

    // Action buttons
    const cancelBtn = container.querySelector('.prof-btn-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        import('../../js/core/window-manager.js').then(m => m.windowManager.close('profession-selection'));
      });
    }

    const confirmBtn = container.querySelector('.prof-btn-confirm');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        if (!confirmBtn.classList.contains('disabled')) {
          console.log('Profession confirmed');
          import('../../js/core/window-manager.js').then(m => m.windowManager.close('profession-selection'));
        }
      });
    }
  },
};
