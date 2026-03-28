export default {
  id: 'top-panel',
  title: '',
  defaultPosition: { x: 20, y: 55, width: 250, height: 65 },
  defaultOpen: true,
  hideHeader: true,
  dragHandle: null,
  resizable: {
    enabled: false,
    handles: [],
    minWidth: 250,
    minHeight: 65,
  },
  exports: [
    { selector: '[data-export="top-panel-full"]', name: 'full', label: 'Top Panel Full' },
  ],
  init(container) {
  },
};
