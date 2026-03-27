export default {
  id: 'minimap',
  title: 'Minimap',
  dragHandle: '.mm-header',
  resizable: {
    enabled: true,
    handles: ['se', 's', 'e'],
    minWidth: 180,
    minHeight: 180,
    maxWidth: 400,
    maxHeight: 400,
  },
  exports: [
    { selector: '[data-export="mm-full"]', name: 'full', label: 'Full Minimap' },
    { selector: '[data-export="mm-map"]', name: 'map', label: 'Map Area' },
    { selector: '[data-export="mm-tools"]', name: 'tools', label: 'Tool Buttons' },
    { selector: '[data-export="mm-coords"]', name: 'coords', label: 'Coordinates' },
  ],
  init(container) {
    container.querySelector('.mm-close')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('minimap'));
    });
  },
};
