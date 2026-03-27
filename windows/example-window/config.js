/**
 * Example Window — demonstrates all features of the window system.
 */
export default {
  id: 'example-window',
  title: 'Example Window',
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
    { selector: '[data-export="example-tab"]', name: 'tab', label: 'Single Tab' },
    { selector: '[data-export="example-content"]', name: 'content', label: 'Content Area' },
  ],
  init(container) {
    // Tab switching
    const tabs = container.querySelectorAll('.example-tab');
    const panels = container.querySelectorAll('.example-panel');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const panel = container.querySelector(`.example-panel[data-panel="${tab.dataset.tab}"]`);
        if (panel) panel.classList.add('active');
      });
    });

    // Close button
    container.querySelector('.example-close')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('example-window'));
    });
  },
};
