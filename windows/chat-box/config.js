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
    {
      selector: '[data-export="cb-close"]',
      name: 'close',
      label: 'Close Button',
      variants: [
        { state: 'hover', className: 'ui-export-hover' },
        { state: 'click', className: 'ui-export-click' },
      ],
    },
    { selector: '[data-export="cb-log"]', name: 'log', label: 'Chat Log' },
    { selector: '[data-export="cb-input"]', name: 'input', label: 'Input Box' },
    { selector: '[data-export="cb-type"]', name: 'type', label: 'Channel Label' },
    { selector: '[data-export="cb-field"]', name: 'field', label: 'Text Field' },
    {
      selector: '[data-export="cb-tab"]',
      name: 'tab',
      label: 'Individual Tabs',
      variants: [
        { state: 'hover', className: 'ui-export-hover' },
        { state: 'click', className: 'ui-export-click' },
      ],
    },
    { selector: '[data-export="cb-msg"]', name: 'msg', label: 'Chat Messages' },
    { selector: '[data-export="cb-time"]', name: 'msg-time', label: 'Message Time' },
    { selector: '[data-export="cb-text"]', name: 'msg-text', label: 'Message Text' },
  ],
  init(container) {
    const requestExportRefresh = () => {
      document.dispatchEvent(new CustomEvent('ui-export-refresh'));
    };

    const tabs = Array.from(container.querySelectorAll('.cb-tab'));
    const typeEl = container.querySelector('.cb-type');
    const messages = Array.from(container.querySelectorAll('.cb-msg'));

    const applyChannel = (channel) => {
      const requested = typeof channel === 'string' ? channel.toUpperCase() : 'ALL';
      const available = tabs.map(tab => (tab.dataset.channel || '').toUpperCase()).filter(Boolean);
      const normalized = available.includes(requested) ? requested : (available[0] || 'ALL');

      tabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.channel === normalized);
      });

      if (typeEl) typeEl.textContent = normalized;

      messages.forEach(msg => {
        const msgChannel = (msg.dataset.channel || 'ALL').toUpperCase();
        const visible = normalized === 'ALL' || msgChannel === normalized;
        msg.style.display = visible ? '' : 'none';
      });

      requestExportRefresh();
    };

    // Tab switching
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        applyChannel(tab.dataset.channel || 'ALL');
      });
    });

    container.addEventListener('dblclick', (event) => {
      const typeTarget = event.target.closest('.cb-type');
      if (typeTarget) {
        const choice = window.prompt('Set active channel (ALL, GUILD, PARTY, RACE)', typeTarget.textContent || 'ALL');
        if (choice !== null) {
          applyChannel(choice);
        }
        return;
      }

      const timeTarget = event.target.closest('.cb-time');
      if (timeTarget) {
        const nextTime = window.prompt('Set message time', timeTarget.textContent || '');
        if (nextTime !== null) {
          timeTarget.textContent = nextTime;
          requestExportRefresh();
        }
        return;
      }

      const textTarget = event.target.closest('.cb-txt');
      if (textTarget) {
        const nextText = window.prompt('Set message text', textTarget.textContent || '');
        if (nextText !== null) {
          textTarget.textContent = nextText;
          requestExportRefresh();
        }
      }
    });

    const getMessagesState = () => {
      return messages.map(msg => {
        const time = msg.querySelector('.cb-time')?.textContent || '';
        const text = msg.querySelector('.cb-txt')?.textContent || '';
        const channel = (msg.dataset.channel || 'ALL').toUpperCase();
        return { time, text, channel };
      });
    };

    const setMessagesState = (nextMessages = []) => {
      if (!Array.isArray(nextMessages)) return;
      messages.forEach((msg, idx) => {
        if (idx >= nextMessages.length) return;
        const payload = nextMessages[idx] || {};
        const timeEl = msg.querySelector('.cb-time');
        const txtEl = msg.querySelector('.cb-txt');
        if (timeEl && typeof payload.time === 'string') timeEl.textContent = payload.time;
        if (txtEl && typeof payload.text === 'string') txtEl.textContent = payload.text;
        if (typeof payload.channel === 'string') msg.dataset.channel = payload.channel.toUpperCase();
      });
    };

    const inputEl = container.querySelector('.cb-input');
    container._chatBoxStateApi = {
      getState: () => ({
        activeChannel: (typeEl?.textContent || 'ALL').toUpperCase(),
        inputText: inputEl?.value || '',
        messages: getMessagesState(),
      }),
      setState: (next = {}) => {
        if (typeof next.inputText === 'string' && inputEl) {
          inputEl.value = next.inputText;
        }
        if (Array.isArray(next.messages)) {
          setMessagesState(next.messages);
        }
        if (typeof next.activeChannel === 'string') {
          applyChannel(next.activeChannel);
        } else {
          requestExportRefresh();
        }
      },
    };

    container.querySelector('.cb-close')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('chat-box'));
    });

    applyChannel(typeEl?.textContent || 'ALL');
  },

  captureState(container) {
    return container?._chatBoxStateApi?.getState?.() || null;
  },

  applyState(container, state) {
    if (!state || typeof state !== 'object') return;
    container?._chatBoxStateApi?.setState?.(state);
  },
};
