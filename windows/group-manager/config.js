export default {
  id: 'group-manager',
  title: 'Group Manager',
  defaultPosition: { x: 400, y: 200, width: 320, height: 400 },
  defaultOpen: false,
  dragHandle: '.group-header',
  resizable: {
    enabled: true,
    handles: ['se', 's', 'e'],
    minWidth: 280, minHeight: 250,
    maxWidth: 500, maxHeight: 800,
  },
  exports: [
    { selector: '[data-export="group-full"]', name: 'group-full', label: 'Full Group Window' },
  ],
  init(container) {
    container.querySelector('.group-close')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('group-manager'));
    });
  },
};
