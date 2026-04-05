/**
 * Example Window — demonstrates versioned windows under one stable id.
 */
export default {
  id: 'example-window',
  title: 'Example Window',
  defaultPosition: { x: 200, y: 150, width: 380, height: 320 },
  defaultOpen: false,
  dragHandle: '.example-header',
  resizable: {
    enabled: true,
    handles: ['se', 'e', 's'],
    minWidth: 280,
    minHeight: 220,
    maxWidth: 600,
    maxHeight: 500,
  },
  exports: [
    { selector: '[data-export="example-full"]', name: 'full', label: 'Full Window' },
    { selector: '[data-export="example-header"]', name: 'header', label: 'Header Bar' },
    { selector: '[data-export="example-tabs"]', name: 'tabs', label: 'Tab Row' },
    {
      selector: '[data-export="example-tab"]',
      name: 'tab',
      label: 'Single Tab',
      variants: [
        { state: 'hover', className: 'ui-export-hover' },
        { state: 'click', className: 'ui-export-click' },
      ],
    },
    {
      selector: '.example-close',
      name: 'close',
      label: 'Close Button',
      variants: [
        { state: 'hover', className: 'ui-export-hover' },
        { state: 'click', className: 'ui-export-click' },
      ],
    },
    { selector: '[data-export="example-content"]', name: 'content', label: 'Content Area' },
  ],
  defaultVersion: 'v1',
  versions: {
    v1: {
      label: 'Classic Tabs',
      folder: 'v1',
      config: 'config.js',
      template: 'template.html',
      style: 'style.css',
    },
    v2: {
      label: 'Command Deck',
      folder: 'v2',
      config: 'config.js',
      template: 'template.html',
      style: 'style.css',
    },
  },

  // Fallback only: version-specific behavior lives in v1/v2 configs.
  init(container) {
    container.querySelector('.example-close')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('example-window'));
    });
  },
};
