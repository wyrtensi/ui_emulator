export default {
  id: 'profession-selection',
  title: 'Profession Selection',
  defaultPosition: { x: 100, y: 50, width: 1200, height: 675 },
  defaultOpen: true,
  dragHandle: '.prof-header',
  resizable: {
    enabled: false
  },
  opacityMode: 'frame',
  init(container) {
    container.querySelector('.prof-btn-cancel')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('profession-selection'));
    });
  }
};