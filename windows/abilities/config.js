export default {
  id: 'abilities',
  title: 'Abilities',
  defaultPosition: { x: 1060, y: 160, width: 320, height: 420 },
  defaultOpen: false,
  dragHandle: '.abl-header',
  resizable: {
    enabled: true,
    handles: ['se', 's', 'e'],
    minWidth: 280,
    minHeight: 300,
    maxWidth: 480,
    maxHeight: 650,
  },
  exports: [
    { selector: '[data-export="abl-full"]', name: 'full', label: 'Full Abilities' },
    { selector: '[data-export="abl-header"]', name: 'header', label: 'Header Bar' },
    { selector: '[data-export="abl-title"]', name: 'title', label: 'Title Text' },
    { selector: '[data-export="abl-dots"]', name: 'dots', label: 'Color Dots' },
    { selector: '[data-export="abl-dot"]', name: 'dot', label: 'Single Dot' },
    { selector: '[data-export="abl-close"]', name: 'close', label: 'Close Button' },
    { selector: '[data-export="abl-cats"]', name: 'cats', label: 'Category Tabs' },
    { selector: '[data-export="abl-cat"]', name: 'cat', label: 'Single Category Tab' },
    { selector: '[data-export="abl-list"]', name: 'list', label: 'Skill List' },
    { selector: '[data-export="abl-skill"]', name: 'skill', label: 'Individual Skills' },
    { selector: '[data-export="abl-icon"]', name: 'icon', label: 'Skill Icons' },
    { selector: '[data-export="abl-name"]', name: 'name', label: 'Skill Names' },
    { selector: '[data-export="abl-bar"]', name: 'bar', label: 'Skill Bars' },
    { selector: '[data-export="abl-seg"]', name: 'seg', label: 'Skill Segments' },
    { selector: '[data-export="abl-rank"]', name: 'rank', label: 'Skill Rank Blocks' },
    { selector: '[data-export="abl-rank-lv"]', name: 'rank-lv', label: 'Skill Rank Level' },
    { selector: '[data-export="abl-rank-pct"]', name: 'rank-pct', label: 'Skill Rank Percent' },
  ],
  init(container) {
    const requestExportRefresh = () => {
      window.dispatchEvent(new CustomEvent('ui-export-refresh'));
    };

    const dots = Array.from(container.querySelectorAll('.abl-dot'));
    const cats = Array.from(container.querySelectorAll('.abl-cat'));
    const skills = Array.from(container.querySelectorAll('.abl-skill'));

    const state = {
      activeDot: dots.find(d => d.classList.contains('active'))?.dataset.dot || 'attack',
      activeCat: cats.find(c => c.classList.contains('active'))?.dataset.cat || 'basic',
      skills: {},
    };

    const parsePercent = (text) => {
      const n = Number(String(text || '').replace('%', '').trim());
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(100, Math.round(n)));
    };

    const setSkillPercent = (skill, percent) => {
      const next = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
      const pctEl = skill.querySelector('.abl-rank-pct');
      if (pctEl) pctEl.textContent = `${next}%`;

      const segs = Array.from(skill.querySelectorAll('.abl-seg'));
      const filledCount = Math.round((next / 100) * segs.length);
      segs.forEach((seg, idx) => {
        seg.classList.toggle('filled', idx < filledCount);
      });

      skill.classList.toggle('active', next > 0);
      skill.classList.toggle('disabled', next === 0);

      if (skill.dataset.skillId) {
        state.skills[skill.dataset.skillId] = next;
      }
    };

    const applyFilterState = () => {
      dots.forEach(dot => {
        dot.classList.toggle('active', dot.dataset.dot === state.activeDot);
      });

      cats.forEach(cat => {
        cat.classList.toggle('active', cat.dataset.cat === state.activeCat);
      });

      let visible = skills.filter(skill => skill.dataset.skillTier === state.activeCat && skill.dataset.skillType === state.activeDot);
      if (visible.length === 0) {
        visible = skills.filter(skill => skill.dataset.skillTier === state.activeCat);
      }

      skills.forEach(skill => {
        const show = visible.includes(skill);
        skill.style.display = show ? '' : 'none';
      });

      requestExportRefresh();
    };

    // Initialize state from DOM
    skills.forEach(skill => {
      const id = skill.dataset.skillId;
      if (!id) return;
      const pctEl = skill.querySelector('.abl-rank-pct');
      state.skills[id] = parsePercent(pctEl?.textContent);
    });

    // Color-circle switching
    dots.forEach(dot => {
      dot.addEventListener('click', () => {
        state.activeDot = dot.dataset.dot || 'attack';
        applyFilterState();
      });
    });

    // Category switching
    cats.forEach(cat => {
      cat.addEventListener('click', () => {
        state.activeCat = cat.dataset.cat || 'basic';
        applyFilterState();
      });
    });

    // Double-click percent edit
    container.querySelector('.abl-list')?.addEventListener('dblclick', (event) => {
      const pctEl = event.target.closest('.abl-rank-pct');
      if (!pctEl) return;

      const skill = pctEl.closest('.abl-skill');
      if (!skill) return;

      const currentPct = parsePercent(pctEl.textContent);
      const input = window.prompt('Set skill percent (0-100)', String(currentPct));
      if (input === null) return;
      setSkillPercent(skill, input);
      applyFilterState();
    });

    const setState = (next = {}) => {
      if (Object.prototype.hasOwnProperty.call(next, 'activeDot')) {
        state.activeDot = String(next.activeDot || state.activeDot);
      }
      if (Object.prototype.hasOwnProperty.call(next, 'activeCat')) {
        state.activeCat = String(next.activeCat || state.activeCat);
      }

      if (next.skills && typeof next.skills === 'object') {
        for (const skill of skills) {
          const id = skill.dataset.skillId;
          if (!id) continue;
          if (Object.prototype.hasOwnProperty.call(next.skills, id)) {
            setSkillPercent(skill, next.skills[id]);
          }
        }
      }

      applyFilterState();
    };

    container._abilitiesStateApi = {
      getState: () => ({
        activeDot: state.activeDot,
        activeCat: state.activeCat,
        skills: { ...state.skills },
      }),
      setState,
    };

    applyFilterState();

    container.querySelector('.abl-close')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('abilities'));
    });
  },

  captureState(container) {
    return container?._abilitiesStateApi?.getState?.() || null;
  },

  applyState(container, state) {
    if (!state || typeof state !== 'object') return;
    container?._abilitiesStateApi?.setState?.(state);
  },
};
