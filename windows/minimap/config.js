export default {
  id: 'minimap',
  title: 'Minimap',
  defaultPosition: { x: 1660, y: 20, width: 240, height: 240 },
  defaultOpen: true,
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
    { selector: '[data-export="mm-header"]', name: 'header', label: 'Header Bar' },
    { selector: '[data-export="mm-location"]', name: 'location', label: 'Location Name' },
    { selector: '[data-export="mm-close"]', name: 'close', label: 'Close Button' },
    { selector: '[data-export="mm-map"]', name: 'map', label: 'Map Area' },
    { selector: '[data-export="mm-grid"]', name: 'grid', label: 'Map Grid' },
    { selector: '[data-export="mm-crosshair"]', name: 'crosshair', label: 'Crosshair' },
    { selector: '[data-export="mm-player"]', name: 'player', label: 'Player Marker' },
    { selector: '[data-export="mm-tools"]', name: 'tools', label: 'Tool Buttons' },
    { selector: '[data-export="mm-coords"]', name: 'coords', label: 'Coordinates' },
  ],
  init(container) {
    container.querySelector('.mm-close')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('minimap'));
    });
  },
};
