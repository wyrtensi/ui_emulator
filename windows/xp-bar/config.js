export default {
  id: 'xp-bar',
  title: 'XP Bar',
  defaultPosition: { x: 650, y: 1000, width: 620, height: 50 },
  defaultOpen: true,
  dragHandle: '.xp-container',
  resizable: {
    enabled: true,
    handles: ['e', 'w'],
    minWidth: 400,
    minHeight: 50,
    maxWidth: 1000,
  },
  exports: [
    { selector: '[data-export="xp-full"]', name: 'full', label: 'Full XP Bar' },
    { selector: '[data-export="xp-bar"]', name: 'bar', label: 'Progress Arc' },
    { selector: '[data-export="xp-bg"]', name: 'bg', label: 'Background Path' },
    { selector: '[data-export="xp-fg"]', name: 'fg', label: 'Fill Path' },
  ],

  init(container) {
    const fgPath = container.querySelector('.xp-fg-path');
    const levelEl = container.querySelector('.xp-level');
    const mainEl = container.querySelector('.xp-percent-main');
    const fracEl = container.querySelector('.xp-percent-frac');
    if (!fgPath || !levelEl || !mainEl || !fracEl) return;

    const clampPercent = (val) => Math.max(0, Math.min(100, Number(val) || 0));
    const clampLevel = (val) => Math.max(1, Math.floor(Number(val) || 1));

    const parseInitialPercent = () => {
      const raw = `${mainEl.textContent.trim()}${fracEl.textContent.trim()}`;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? clampPercent(parsed) : 0;
    };

    const state = {
      level: clampLevel(levelEl.textContent),
      percent: parseInitialPercent(),
    };

    const render = () => {
      state.level = clampLevel(state.level);
      state.percent = clampPercent(state.percent);

      const [intPart, fracPart = '0000'] = state.percent.toFixed(4).split('.');
      levelEl.textContent = String(state.level);
      mainEl.textContent = `${intPart}.${fracPart.slice(0, 2)}`;
      fracEl.textContent = fracPart.slice(2, 4);

      const dash = (state.percent * 100).toFixed(2);
      fgPath.style.strokeDasharray = `${dash} 10000`;

      window.dispatchEvent(new CustomEvent('ui-export-refresh'));
    };

    const setState = (next = {}) => {
      if (Object.prototype.hasOwnProperty.call(next, 'level')) {
        state.level = clampLevel(next.level);
      }
      if (Object.prototype.hasOwnProperty.call(next, 'percent')) {
        state.percent = clampPercent(next.percent);
      }
      render();
    };

    const editLevel = () => {
      const next = window.prompt('Set level (>= 1)', String(state.level));
      if (next === null) return;
      setState({ level: next });
    };

    const editPercent = () => {
      const next = window.prompt('Set XP percent (0-100)', state.percent.toFixed(4));
      if (next === null) return;
      setState({ percent: next });
    };

    levelEl.addEventListener('dblclick', editLevel);
    mainEl.addEventListener('dblclick', editPercent);
    fracEl.addEventListener('dblclick', editPercent);

    container._xpStateApi = {
      getState: () => ({ ...state }),
      setState,
    };

    render();
  },

  captureState(container) {
    return container?._xpStateApi?.getState?.() || null;
  },

  applyState(container, state) {
    if (!state || typeof state !== 'object') return;
    container?._xpStateApi?.setState?.(state);
  },
};
