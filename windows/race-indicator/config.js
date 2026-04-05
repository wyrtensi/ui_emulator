export default {
  id: 'race-indicator',
  title: 'Race Indicator',
  defaultPosition: { x: 890, y: 10, width: 140, height: 140 },
  defaultOpen: true,
  dragHandle: '.ri-drag-ring',
  resizable: { enabled: true },
  exports: [
    { selector: '[data-export="ri-full"]', name: 'full', label: 'Full Indicator' },
    { selector: '[data-export="ri-logo"]', name: 'logo', label: 'Logo Only' },
    { selector: '[data-export="ri-logo-path"]', name: 'logo-path', label: 'Logo Path' },
    { selector: '[data-export="ri-ring"]', name: 'ring', label: 'Ring Only' },
    { selector: '[data-export="ri-drag-ring"]', name: 'drag-ring', label: 'Drag Ring' },
    { selector: '[data-export="ri-ring-layer"]', name: 'ring-layer', label: 'Ring Layers' },
  ],
  init(container) {
    const requestExportRefresh = () => {
      document.dispatchEvent(new CustomEvent('ui-export-refresh'));
    };

    const states = ['safe', 'attack', 'warning'];
    const colors = {
      safe:    { color: '#00e5ff', glow: 'rgba(0,229,255,0.5)' },
      attack:  { color: '#ff2a00', glow: 'rgba(255,42,0,0.5)' },
      warning: { color: '#ffea00', glow: 'rgba(255,234,0,0.5)' },
    };

    const el = container.querySelector('.ri-indicator');
    const logoWrap = container.querySelector('.ri-logo-wrap');
    if (!el) return;
    let idx = Math.max(0, states.indexOf(el?.dataset.state || 'safe'));

    function applyStateByIndex(nextIdx = idx) {
      idx = ((nextIdx % states.length) + states.length) % states.length;
      const state = states[idx];
      const c = colors[state];
      el.dataset.state = state;
      el.style.setProperty('--ri-color', c.color);
      el.style.setProperty('--ri-glow', c.glow);
      requestExportRefresh();
    }

    function applyStateByName(stateName) {
      const normalized = String(stateName || '').toLowerCase();
      const found = states.indexOf(normalized);
      if (found >= 0) {
        applyStateByIndex(found);
      }
    }

    applyStateByIndex(idx);

    // Click center to cycle state
    if (logoWrap) {
      logoWrap.addEventListener('click', () => {
        applyStateByIndex(idx + 1);
      });

      logoWrap.addEventListener('dblclick', () => {
        const next = window.prompt('Set state (safe, attack, warning)', states[idx]);
        if (next !== null) {
          applyStateByName(next);
        }
      });
    }

    container._raceIndicatorStateApi = {
      getState: () => ({ state: states[idx] }),
      setState: (next = {}) => {
        if (typeof next.state === 'string') {
          applyStateByName(next.state);
        }
      },
    };
  },

  captureState(container) {
    return container?._raceIndicatorStateApi?.getState?.() || null;
  },

  applyState(container, state) {
    if (!state || typeof state !== 'object') return;
    container?._raceIndicatorStateApi?.setState?.(state);
  },
};
