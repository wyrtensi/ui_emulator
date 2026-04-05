export default {
  id: 'minimap',
  title: 'Minimap',
  defaultPosition: { x: 1660, y: 20, width: 240, height: 240 },
  defaultOpen: true,
  dragHandle: '.mm-header',
  resizable: {
    enabled: true,
    handles: ['se', 's', 'e'],
    minWidth: 180,
    minHeight: 180,
    maxWidth: 400,
    maxHeight: 400,
  },
  exports: [
    { selector: '[data-export="mm-full"]', name: 'full', label: 'Full Minimap' },
    { selector: '[data-export="mm-header"]', name: 'header', label: 'Header Bar' },
    {
      selector: '[data-export="mm-close"]',
      name: 'close',
      label: 'Close Button',
      variants: [
        { state: 'hover', className: 'ui-export-hover' },
        { state: 'click', className: 'ui-export-click' },
      ],
    },
    { selector: '[data-export="mm-map"]', name: 'map', label: 'Map Area' },
    { selector: '[data-export="mm-content"]', name: 'content', label: 'Content Area' },
    { selector: '[data-export="mm-grid"]', name: 'grid', label: 'Map Grid' },
    { selector: '[data-export="mm-crosshair"]', name: 'crosshair', label: 'Crosshair' },
    { selector: '[data-export="mm-player"]', name: 'player', label: 'Player Marker' },
    { selector: '[data-export="mm-tools"]', name: 'tools', label: 'Tool Buttons' },
    {
      selector: '[data-export="mm-tool-btn"]',
      name: 'tool-button',
      label: 'Tool Button',
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

    const mapEl = container.querySelector('.mm-body');
    const gridEl = container.querySelector('.mm-grid');
    const playerEl = container.querySelector('.mm-player');
    const locationEl = container.querySelector('.mm-location');
    const coordsEl = container.querySelector('.mm-footer');
    const tools = Array.from(container.querySelectorAll('.mm-btn[data-tool]'));
    const pinBtn = tools.find(btn => btn.dataset.tool === 'pin');

    let zoom = 100;
    let pinEnabled = false;

    const parsePercent = (value, fallback = 50) => {
      const parsed = Number.parseFloat(String(value || '').replace('%', ''));
      if (!Number.isFinite(parsed)) return fallback;
      return Math.max(0, Math.min(100, parsed));
    };

    const setZoom = (nextZoom) => {
      zoom = Math.max(50, Math.min(250, Number(nextZoom) || 100));
      const gridSize = Math.max(8, (20 * zoom) / 100);
      if (gridEl) gridEl.style.backgroundSize = `${gridSize}px ${gridSize}px`;
      requestExportRefresh();
    };

    const setPinEnabled = (enabled) => {
      pinEnabled = Boolean(enabled);
      if (!pinBtn) return;
      pinBtn.setAttribute('aria-pressed', pinEnabled ? 'true' : 'false');
      pinBtn.style.color = pinEnabled ? '#00e5ff' : 'rgba(255,255,255,0.4)';
      pinBtn.style.background = pinEnabled ? 'rgba(0,229,255,0.1)' : 'transparent';
      requestExportRefresh();
    };

    const setPlayerPosition = (xPercent, yPercent, updateCoords = true) => {
      const x = Math.max(0, Math.min(100, Number(xPercent) || 0));
      const y = Math.max(0, Math.min(100, Number(yPercent) || 0));
      if (playerEl) {
        playerEl.style.left = `${x}%`;
        playerEl.style.top = `${y}%`;
      }
      if (updateCoords && coordsEl) {
        coordsEl.textContent = `COORD X:${Math.round(x)} Y:${Math.round(y)}`;
      }
      requestExportRefresh();
    };

    mapEl?.addEventListener('click', (event) => {
      const rect = mapEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      setPlayerPosition(x, y, true);
    });

    tools.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        if (tool === 'zoom-in') setZoom(zoom + 10);
        if (tool === 'zoom-out') setZoom(zoom - 10);
        if (tool === 'center') setPlayerPosition(50, 50, true);
        if (tool === 'pin') setPinEnabled(!pinEnabled);
      });
    });

    container.addEventListener('dblclick', (event) => {
      const locationTarget = event.target.closest('.mm-location');
      if (locationTarget) {
        const nextLocation = window.prompt('Set location', locationTarget.textContent || '');
        if (nextLocation !== null) {
          locationTarget.textContent = nextLocation;
          requestExportRefresh();
        }
        return;
      }

      const coordsTarget = event.target.closest('.mm-footer');
      if (coordsTarget) {
        const nextCoords = window.prompt('Set coordinates label', coordsTarget.textContent || '');
        if (nextCoords !== null) {
          coordsTarget.textContent = nextCoords;
          requestExportRefresh();
        }
      }
    });

    container._minimapStateApi = {
      getState: () => ({
        location: locationEl?.textContent || '',
        coords: coordsEl?.textContent || '',
        zoom,
        pinEnabled,
        player: {
          x: parsePercent(playerEl?.style.left, 50),
          y: parsePercent(playerEl?.style.top, 50),
        },
      }),
      setState: (next = {}) => {
        if (typeof next.location === 'string' && locationEl) {
          locationEl.textContent = next.location;
        }
        if (typeof next.coords === 'string' && coordsEl) {
          coordsEl.textContent = next.coords;
        }
        if (typeof next.zoom === 'number') {
          setZoom(next.zoom);
        }
        if (typeof next.pinEnabled === 'boolean') {
          setPinEnabled(next.pinEnabled);
        }
        if (next.player && typeof next.player === 'object') {
          setPlayerPosition(next.player.x, next.player.y, false);
        }
        requestExportRefresh();
      },
    };

    setZoom(zoom);
    setPinEnabled(pinEnabled);

    container.querySelector('.mm-close')?.addEventListener('click', () => {
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('minimap'));
    });
  },

  captureState(container) {
    return container?._minimapStateApi?.getState?.() || null;
  },

  applyState(container, state) {
    if (!state || typeof state !== 'object') return;
    container?._minimapStateApi?.setState?.(state);
  },
};
