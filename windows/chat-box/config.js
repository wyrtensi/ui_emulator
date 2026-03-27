export default {
  id: 'chat-box',
  title: 'Chat',
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
    { selector: '[data-export="cb-log"]', name: 'log', label: 'Chat Log' },
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
