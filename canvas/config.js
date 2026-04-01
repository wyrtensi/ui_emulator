export default {
  id: 'canvas',
  title: 'Concept Canvas',
  defaultPosition: { x: 50, y: 50, width: 1400, height: 800 },
  defaultOpen: false,
  dragHandle: '.canvas-header',
  resizable: {
    enabled: true,
    handles: ['e', 's', 'se'],
    minWidth: 800, minHeight: 600,
  },
  exports: [
    { selector: '[data-export="canvas-full"]', name: 'concept_canvas', label: 'Full Canvas' }
  ],
  async init(container) {
    // Dynamic import to keep logic separated
    const module = await import('./canvas-engine.js');
    module.initCanvas(container, this);
  }
};
