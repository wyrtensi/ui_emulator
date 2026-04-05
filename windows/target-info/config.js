export default {
  id: 'target-info',
  title: 'Target Info',
  defaultPosition: { x: 1100, y: 45, width: 380, height: 110 },
  defaultOpen: true,
  dragHandle: '.ti-header',
  resizable: {
    enabled: true,
    handles: ['e', 'w'],
    minWidth: 300,
    minHeight: 80,
    maxWidth: 500,
  },
  exports: [
    { selector: '[data-export="ti-full"]', name: 'full', label: 'Full Target' },
    {
      selector: '[data-export="ti-header"]',
      name: 'header',
      label: 'Header Bar',
      variants: [
        { state: 'hover', className: 'ui-export-hover' },
      ],
    },
    {
      selector: '[data-export="ti-close"]',
      name: 'close',
      label: 'Close Button',
      variants: [
        { state: 'hover', className: 'ui-export-hover' },
        { state: 'click', className: 'ui-export-click' },
      ],
    },
    { selector: '[data-export="ti-body"]', name: 'body', label: 'Body Content' },
    { selector: '[data-export="ti-health"]', name: 'health', label: 'Health Bar' },
    { selector: '[data-export="ti-health-fill"]', name: 'health-fill', label: 'Health Fill' },
  ],
  init(container) {
    const requestExportRefresh = () => {
      document.dispatchEvent(new CustomEvent('ui-export-refresh'));
    };

    const levelEl = container.querySelector('.ti-lvl');
    const nameEl = container.querySelector('.ti-name');
    const distEl = container.querySelector('.ti-dist');
    const raceEl = container.querySelector('.ti-race');
    const pctEl = container.querySelector('.ti-pct');
    const fillEl = container.querySelector('.ti-health-fill');

    const parsePercent = (value) => {
      const parsed = Number.parseFloat(String(value || '').replace('%', ''));
      if (!Number.isFinite(parsed)) return 0;
      return Math.max(0, Math.min(100, parsed));
    };

    const formatPercent = (value) => {
      const normalized = Math.round(value * 10) / 10;
      return Number.isInteger(normalized) ? `${normalized}%` : `${normalized.toFixed(1)}%`;
    };

    const setHealthPercent = (value) => {
      const pct = parsePercent(value);
      if (fillEl) fillEl.style.width = `${pct}%`;
      if (pctEl) pctEl.textContent = formatPercent(pct);
      requestExportRefresh();
    };

    container.addEventListener('dblclick', (event) => {
      const fieldTarget = event.target.closest('.ti-lvl, .ti-name, .ti-dist, .ti-race');
      if (fieldTarget) {
        const nextValue = window.prompt('Set value', fieldTarget.textContent || '');
        if (nextValue !== null) {
          fieldTarget.textContent = nextValue;
          requestExportRefresh();
        }
        return;
      }

      const pctTarget = event.target.closest('.ti-pct, .ti-health-fill');
      if (pctTarget) {
        const current = pctEl?.textContent || fillEl?.style.width || '0%';
        const nextPct = window.prompt('Set health percent (0-100)', String(current));
        if (nextPct !== null) setHealthPercent(nextPct);
      }
    });

    container._targetInfoStateApi = {
      getState: () => ({
        level: levelEl?.textContent || '',
        name: nameEl?.textContent || '',
        distance: distEl?.textContent || '',
        race: raceEl?.textContent || '',
        healthPercent: parsePercent(fillEl?.style.width || pctEl?.textContent || '0%'),
      }),
      setState: (next = {}) => {
        if (typeof next.level === 'string' && levelEl) levelEl.textContent = next.level;
        if (typeof next.name === 'string' && nameEl) nameEl.textContent = next.name;
        if (typeof next.distance === 'string' && distEl) distEl.textContent = next.distance;
        if (typeof next.race === 'string' && raceEl) raceEl.textContent = next.race;
        if (typeof next.healthPercent === 'number' || typeof next.healthPercent === 'string') {
          setHealthPercent(next.healthPercent);
        } else {
          requestExportRefresh();
        }
      },
    };

    setHealthPercent(pctEl?.textContent || fillEl?.style.width || '0%');

    container.querySelector('.ti-close')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('target-info'));
    });
  },

  captureState(container) {
    return container?._targetInfoStateApi?.getState?.() || null;
  },

  applyState(container, state) {
    if (!state || typeof state !== 'object') return;
    container?._targetInfoStateApi?.setState?.(state);
  },
};
