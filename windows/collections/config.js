export default {
  id: 'collections',
  title: 'COLLECTIONS',
  defaultPosition: { x: 200, y: 100, width: 880, height: 560 },
  defaultOpen: false,
  dragHandle: '.collections-header',
  opacityMode: 'content',
  resizable: {
    enabled: true,
    handles: ['se', 's', 'e'],
    minWidth: 800,
    minHeight: 500,
  },
  exports: [
    { selector: '[data-export="collections-full"]', name: 'full', label: 'Full Collections' },
  ],
  init(container) {
    // Add simple state management if interactive parts needed (tabs, selections)
    container._stateApi = {
      getState: () => ({ activeCategory: 'cyber-armor' }),
      setState: (state) => {
        // Apply state UI updates if necessary
      },
    };
  },
  captureState(container) {
    return container?._stateApi?.getState?.() || null;
  },
  applyState(container, state) {
    if (!state || typeof state !== 'object') return;
    container?._stateApi?.setState?.(state);
  }
};
