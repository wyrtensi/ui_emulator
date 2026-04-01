/**
 * Window Config — _template
 *
 * Copy this folder, rename it to your window id (e.g. "inventory"),
 * update the fields below, and add the window id to windows/registry.json.
 *
 * See WINDOW.md for full documentation.
 */
export default {
  /* ── Required ─────────────────────────────────────── */
  id: '_template',           // Must match folder name and registry entry
  title: 'Template Window',  // Display name in menus and panel

  /**
   * Default position and size on the 1920×1080 viewport.
   * Width/height are optional if CSS handles sizing.
   */
  defaultPosition: { x: 200, y: 150, width: 380, height: 320 },
  defaultOpen: false,         // Whether visible on first load

  /**
   * CSS selector for the drag handle (relative to this window's container).
   * Can be any element: a header bar, an invisible zone, or the entire window.
   */
  dragHandle: '.window-header',

  /**
   * Resize configuration.
   * Set enabled: false if this window should not be resizable.
   */
  resizable: {
    enabled: true,
    handles: ['se'],           // 'n','s','e','w','ne','nw','se','sw'
    minWidth: 200,
    minHeight: 150,
    maxWidth: 800,
    maxHeight: 600,
  },

  /**
   * Elements that can be exported as individual PNGs.
   * Each entry maps a CSS selector (within this window) to an export name.
   *
   * For a group of DOM elements that should export as ONE image,
   * wrap them in a container with data-export-group="name" attribute.
   *
   * selector: CSS selector to find the element
   * name:     Filename part (e.g. "header" → "{window-id}_header_2x.png")
   * label:    Human-readable label in the export panel
   */
  exports: [
    { selector: '[data-export="full"]', name: 'full', label: 'Full Window' },
    // { selector: '[data-export="header"]', name: 'header', label: 'Header Bar' },
    // { selector: '[data-export="content"]', name: 'content', label: 'Content Area' },
  ],

  /**
   * Optional initialization function.
   * Called once after the window HTML is injected into the DOM.
   * Use for wiring interactive elements (tabs, buttons, etc.)
   *
   * @param {HTMLElement} container — the .ui-window element
   */
  init(container) {
    // Example: wire a close button
    // container.querySelector('.close-btn')?.addEventListener('click', () => {
    //   import('../js/core/window-manager.js').then(m => m.windowManager.close(this.id));
    // });
  },
};
