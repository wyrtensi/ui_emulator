export default {
  id: 'hp-bars',
  title: '',
  defaultPosition: { x: 20, y: 130, width: 440, height: 180 },
  defaultOpen: true,
  hideHeader: true,
  dragHandle: null,
  resizable: {
    enabled: false,
    handles: [],
    minWidth: 440,
    minHeight: 180,
  },
  exports: [
    { selector: '[data-export="hp-bars-full"]', name: 'full', label: 'HP Bars Full' },
  ],
  init(container) {
  },
};
