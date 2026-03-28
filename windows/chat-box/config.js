export default {
  id: 'chat-box',
  title: 'Chat',
  defaultPosition: { x: 20, y: 755, width: 440, height: 240 },
  defaultOpen: true,
  dragHandle: '.cb-tabs',
  resizable: {
    enabled: true,
    handles: ['se', 's', 'e'],
    minWidth: 320,
    minHeight: 180,
    maxWidth: 600,
    maxHeight: 400,
  },
  exports: [
    { selector: '[data-export="cb-full"]', name: 'full', label: 'Full Chat' },
    { selector: '[data-export="cb-tabs"]', name: 'tabs', label: 'Tab Bar' },
    { selector: '[data-export="cb-tabs-inner"]', name: 'tabs-inner', label: 'Channel Tabs' },
    { selector: '[data-export="cb-close"]', name: 'close', label: 'Close Button' },
    { selector: '[data-export="cb-log"]', name: 'log', label: 'Chat Log' },
    { selector: '[data-export="cb-input"]', name: 'input', label: 'Input Box' },
    { selector: '[data-export="cb-type"]', name: 'type', label: 'Channel Label' },
    { selector: '[data-export="cb-field"]', name: 'field', label: 'Text Field' },
  ],
  init(container) {
    // Tab switching
    const tabs = container.querySelectorAll('.cb-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        // Update channel indicator
        const typeEl = container.querySelector('.cb-type');
        if (typeEl) typeEl.textContent = tab.textContent;
      });
    });

    container.querySelector('.cb-close')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('chat-box'));
    });
  },
};
