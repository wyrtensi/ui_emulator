export default {
  id: 'race-indicator',
  title: 'Race Indicator',
  defaultPosition: { x: 890, y: 10, width: 140, height: 140 },
  defaultOpen: true,
  dragHandle: '.ri-drag-ring',
  resizable: { enabled: false },
  exports: [
    { selector: '[data-export="ri-full"]', name: 'full', label: 'Full Indicator' },
    { selector: '[data-export="ri-logo"]', name: 'logo', label: 'Logo Only' },
    { selector: '[data-export="ri-ring"]', name: 'ring', label: 'Ring Only' },
  ],
  init(container) {
    const states = ['safe', 'attack', 'warning'];
    const colors = {
      safe:    { color: '#00e5ff', glow: 'rgba(0,229,255,0.5)' },
      attack:  { color: '#ff2a00', glow: 'rgba(255,42,0,0.5)' },
      warning: { color: '#ffea00', glow: 'rgba(255,234,0,0.5)' },
    };
    let idx = 0;
    const el = container.querySelector('.ri-indicator');
    const logoWrap = container.querySelector('.ri-logo-wrap');

    function applyState() {
      const state = states[idx];
      const c = colors[state];
      el.dataset.state = state;
      el.style.setProperty('--ri-color', c.color);
      el.style.setProperty('--ri-glow', c.glow);
    }

    applyState();

    // Click center to cycle state
    logoWrap.addEventListener('click', () => {
      idx = (idx + 1) % states.length;
      applyState();
    });
  },
};
