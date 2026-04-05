export default {
  id: 'character',
  title: 'Character',
  defaultPosition: { x: 390, y: 130, width: 340, height: 480 },
  defaultOpen: false,
  dragHandle: '.char-header',
  resizable: {
    enabled: true,
    handles: ['se', 's', 'e'],
    minWidth: 300,
    minHeight: 380,
    maxWidth: 500,
    maxHeight: 700,
  },
  exports: [
    { selector: '[data-export="char-full"]', name: 'full', label: 'Full Character' },
    { selector: '[data-export="char-header"]', name: 'header', label: 'Header Bar' },
    { selector: '[data-export="char-tabs"]', name: 'tabs', label: 'Tab Row' },
    {
      selector: '[data-export="char-tab"]',
      name: 'tab',
      label: 'Individual Tabs',
      variants: [
        { state: 'hover', className: 'ui-export-hover' },
        { state: 'click', className: 'ui-export-click' },
      ],
    },
    {
      selector: '[data-export="char-close"]',
      name: 'close',
      label: 'Close Button',
      variants: [
        { state: 'hover', className: 'ui-export-hover' },
        { state: 'click', className: 'ui-export-click' },
      ],
    },
    { selector: '[data-export="char-equip"]', name: 'equip', label: 'Equipment Area' },
    { selector: '[data-export="char-silhouette"]', name: 'silhouette', label: 'Silhouette' },
    { selector: '[data-export="char-stats"]', name: 'stats', label: 'Stats Panel' },
    { selector: '[data-export="char-stat-atk"]', name: 'stat-atk', label: 'Attack Stat' },
    { selector: '[data-export="char-stat-def"]', name: 'stat-def', label: 'Defense Stat' },
    { selector: '[data-export="char-stat-range"]', name: 'stat-range', label: 'Range Stat' },
    { selector: '[data-export="char-stat-hp"]', name: 'stat-hp', label: 'Max HP Stat' },
    { selector: '[data-export="char-mastery"]', name: 'mastery', label: 'Mastery Bars' },
    { selector: '[data-export="char-mastery-track"]', name: 'mastery-track', label: 'Mastery Tracks' },
    { selector: '[data-export="char-mastery-fill"]', name: 'mastery-fill', label: 'Mastery Fills' },
    { selector: '[data-export="char-mastery-melee"]', name: 'mastery-melee', label: 'Melee Mastery' },
    { selector: '[data-export="char-mastery-range"]', name: 'mastery-range', label: 'Range Mastery' },
    { selector: '[data-export="char-mastery-def"]', name: 'mastery-def', label: 'Defense Mastery' },
    { selector: '[data-export="char-mastery-shield"]', name: 'mastery-shield', label: 'Shield Mastery' },
    {
      selector: '[data-export="char-slot"]',
      name: 'slot',
      label: 'Cells (Equipment Slots)',
      variants: [
        { state: 'hover', className: 'ui-export-hover' },
        { state: 'click', className: 'ui-export-click' },
      ],
    },
  ],
  init(container) {
    const requestExportRefresh = () => {
      document.dispatchEvent(new CustomEvent('ui-export-refresh'));
    };

    const tabs = Array.from(container.querySelectorAll('.char-tab'));
    const statValues = Array.from(container.querySelectorAll('.stat-val'));
    const slotLabels = Array.from(container.querySelectorAll('.eq-slot span'));
    const masteryRows = Array.from(container.querySelectorAll('.mastery-row'));

    const applyTab = (nextTab) => {
      const requested = String(nextTab || '').toUpperCase();
      const available = tabs.map(tab => (tab.dataset.tab || '').toUpperCase()).filter(Boolean);
      const normalized = available.includes(requested) ? requested : (available[0] || 'EQUIP');
      tabs.forEach(tab => {
        tab.classList.toggle('active', (tab.dataset.tab || '').toUpperCase() === normalized);
      });
      container.dataset.activeTab = normalized;
      requestExportRefresh();
    };

    // Tab switching
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        applyTab(tab.dataset.tab || tab.textContent || 'EQUIP');
      });
    });

    container.addEventListener('dblclick', (event) => {
      const statValueEl = event.target.closest('.stat-val');
      if (statValueEl) {
        const next = window.prompt('Set stat value', statValueEl.textContent || '');
        if (next !== null) {
          statValueEl.textContent = next;
          requestExportRefresh();
        }
        return;
      }

      const slotLabelEl = event.target.closest('.eq-slot span');
      if (slotLabelEl) {
        const next = window.prompt('Set equipment label', slotLabelEl.textContent || '');
        if (next !== null) {
          slotLabelEl.textContent = next;
          requestExportRefresh();
        }
        return;
      }

      const rankEl = event.target.closest('.mastery-rank');
      if (rankEl) {
        const nextRank = window.prompt('Set mastery rank', rankEl.textContent || '');
        if (nextRank !== null) {
          rankEl.textContent = nextRank;
          requestExportRefresh();
        }
        return;
      }

      const fillEl = event.target.closest('.mastery-fill');
      if (fillEl) {
        const current = parseInt(fillEl.style.width || '0', 10) || 0;
        const nextPct = window.prompt('Set mastery percent (0-100)', String(current));
        if (nextPct !== null) {
          const parsed = Number.parseFloat(nextPct);
          if (Number.isFinite(parsed)) {
            const clamped = Math.max(0, Math.min(100, parsed));
            fillEl.style.width = `${clamped}%`;
            requestExportRefresh();
          }
        }
      }
    });

    const getMasteryState = () => {
      return masteryRows.map((row) => {
        const label = row.querySelector('.mastery-label')?.textContent || '';
        const fillWidth = row.querySelector('.mastery-fill')?.style.width || '0%';
        const rank = row.querySelector('.mastery-rank')?.textContent || '';
        return { label, fillWidth, rank };
      });
    };

    const applyMasteryState = (entries = []) => {
      if (!Array.isArray(entries)) return;
      masteryRows.forEach((row, idx) => {
        if (idx >= entries.length) return;
        const entry = entries[idx] || {};
        const labelEl = row.querySelector('.mastery-label');
        const fillEl = row.querySelector('.mastery-fill');
        const rankEl = row.querySelector('.mastery-rank');

        if (labelEl && typeof entry.label === 'string') labelEl.textContent = entry.label;
        if (fillEl && typeof entry.fillWidth === 'string') fillEl.style.width = entry.fillWidth;
        if (rankEl && typeof entry.rank === 'string') rankEl.textContent = entry.rank;
      });
    };

    container._characterStateApi = {
      getState: () => ({
        activeTab: container.dataset.activeTab || (tabs.find(tab => tab.classList.contains('active'))?.dataset.tab || 'EQUIP'),
        statValues: statValues.map(el => el.textContent || ''),
        slotLabels: slotLabels.map(el => el.textContent || ''),
        mastery: getMasteryState(),
      }),
      setState: (next = {}) => {
        if (Array.isArray(next.statValues)) {
          statValues.forEach((el, idx) => {
            if (idx < next.statValues.length) el.textContent = String(next.statValues[idx] || '');
          });
        }

        if (Array.isArray(next.slotLabels)) {
          slotLabels.forEach((el, idx) => {
            if (idx < next.slotLabels.length) el.textContent = String(next.slotLabels[idx] || '');
          });
        }

        if (Array.isArray(next.mastery)) {
          applyMasteryState(next.mastery);
        }

        if (typeof next.activeTab === 'string') {
          applyTab(next.activeTab);
        } else {
          requestExportRefresh();
        }
      },
    };

    container.querySelector('.char-close')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('character'));
    });

    applyTab(tabs.find(tab => tab.classList.contains('active'))?.dataset.tab || 'EQUIP');
  },

  captureState(container) {
    return container?._characterStateApi?.getState?.() || null;
  },

  applyState(container, state) {
    if (!state || typeof state !== 'object') return;
    container?._characterStateApi?.setState?.(state);
  },
};
