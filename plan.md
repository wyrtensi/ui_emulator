# Plan: UI Emulator — Modular Interface Concept Tool

## TL;DR
A static-site (GitHub Pages ready) interactive emulator for RF Online UI concepts. Each game window is a standalone HTML/CSS/JS module loaded into a core shell. Supports drag, resize, z-index management, layout presets with pin comments, individual element PNG export for Photoshop, and multi-user sharing via URL/JSON.

**Tech stack**: Vanilla JS (ES Modules) + CSS Custom Properties + html2canvas (CDN) + JSZip (CDN) + LZ-String (CDN for URL compression). No build step.

---

## Phase 1: Project Scaffold & Core Shell

### Steps
1. Create project structure:
   ```
   ui_ui_emulator/
   ├── index.html
   ├── css/
   │   └── core.css
   ├── js/
   │   ├── app.js
   │   └── core/
   │       ├── window-manager.js
   │       ├── drag-engine.js
   │       ├── resize-engine.js
   │       ├── context-menu.js
   │       ├── layout-manager.js
   │       ├── export-manager.js
   │       ├── comment-manager.js
   │       └── settings.js
   ├── windows/
   │   ├── manifest.json
   │   └── _template/
   │       ├── config.js
   │       ├── template.html
   │       ├── style.css
   │       └── WINDOW.md
   ├── assets/
   │   └── backgrounds/
   └── presets/
       └── default.json
   ```

2. **index.html** — Main entry:
   - `<div id="ui-viewport">` — main container, base 1920×1080, scaled via `transform: scale()` and CSS `--ui-scale` variable
   - `<div id="ui-background">` — supports `<img>` or `<video loop autoplay muted>`
   - `<div id="ui-windows">` — window container layer
   - `<div id="ui-overlays">` — comment pins, export highlights
   - `<div id="ui-control-panel">` — side panel for emulator controls
   - Loads libs from CDN: html2canvas, JSZip, lz-string

3. **css/core.css** — CSS variables for scale, viewport size, z-index layers; dark sci-fi theme for the control panel matching RF Online aesthetic

## Phase 2: Window Manager & Window Loading

### Steps
4. **windows/manifest.json** — registry of all available windows:
   ```json
   {
     "windows": [
       {
         "id": "inventory",
         "name": "Inventory",
         "folder": "windows/inventory",
         "defaultPosition": { "x": 100, "y": 100, "width": 400, "height": 500 },
         "defaultOpen": false
       }
     ]
   }
   ```

5. **Window loader** (`app.js`) — For each window in manifest:
   - `import()` the window's `config.js` (ES module with metadata)
   - `fetch()` the `template.html` and `style.css`
   - Inject scoped CSS (auto-prefix all selectors with `[data-window-id="{id}"]`)
   - Create wrapper: `<div class="ui-window" data-window-id="{id}">` + inject HTML
   - Call `config.init(container)` if defined
   - Register with window-manager

6. **Window config.js contract** — each window exports:
   ```js
   export default {
     id: 'inventory',
     title: 'Inventory',
     dragHandle: '.inventory-header',    // CSS selector for drag zone
     resizable: {
       enabled: true,
       handles: ['se'],                  // 'n','s','e','w','ne','nw','se','sw'
       minWidth: 300, minHeight: 400,
       maxWidth: 800, maxHeight: 900
     },
     exports: [
       { selector: '[data-export="inventory-full"]', name: 'inventory-full', label: 'Full Inventory Window' },
       { selector: '[data-export="inv-grid"]', name: 'inv-grid', label: 'Item Grid' },
       { selector: '[data-export="inv-cell"]', name: 'inv-cell', label: 'Single Cell' },
       { selector: '[data-export="inv-header"]', name: 'inv-header', label: 'Header Bar' },
     ],
     init(container) { /* optional interactive logic */ }
   };
   ```

7. **window-manager.js** — Core window management:
   - `registerWindow(id, config, container)` — register a loaded window
   - `openWindow(id)` / `closeWindow(id)` / `toggleWindow(id)`
   - `focusWindow(id)` — bring to front, update z-index stack
   - Click on any `.ui-window` → automatically calls `focusWindow`
   - Track open/closed state
   - Event: `window:opened`, `window:closed`, `window:focused`

8. **drag-engine.js** — Generic drag implementation:
   - On mousedown on element matching `config.dragHandle` within a window → start drag
   - Move window via `transform: translate(x, y)` or `left/top`
   - Respects screen bounds setting (constrain to viewport or allow overflow)
   - Automatically calls `focusWindow` on drag start

9. **resize-engine.js** — Generic resize:
   - Creates invisible resize handles on edges/corners as defined in `config.resizable.handles`
   - Enforces min/max dimensions
   - Cursor changes on hover (nwse-resize, etc.)

10. **context-menu.js** — Custom right-click menu:
    - On right-click on `.ui-window` → show custom menu
    - Options: "Close Window", "Reset Position", "Export Window PNG"
    - `preventDefault()` to block browser menu
    - On right-click on viewport (not window) → show "Open Window >" submenu

## Phase 3: Settings & Control Panel

### Steps
11. **Control Panel UI** (sidebar, toggleable with hotkey or button):
    - **Windows list**: All windows from manifest, toggle switches to open/close each
    - **Scale slider**: 50%–200%, updates `--ui-scale` CSS var + transform
    - **Screen bounds toggle**: Checkbox
    - **Background selector**: File input for image/video, or URL field
    - **Mode selector**: "Design Mode" (normal) / "Export Mode" / "Comment Mode"
    - **Preset controls**: Save / Load / Share URL / Download JSON / Upload JSON

12. **settings.js** — Global state manager:
    - `settings.scale` (default 1.0)
    - `settings.screenBounds` (default true)
    - `settings.background` (path or data URL)
    - `settings.mode` ('design' | 'export' | 'comment')
    - Persists to localStorage
    - Events on change

## Phase 4: Layout Presets & Sharing

### Steps
13. **layout-manager.js** — Preset system:
    - **Capture layout**: iterate all registered windows → collect `{ id, open, x, y, width, height, zIndex }`
    - **Include comments**: merge pin annotations from comment-manager
    - **Export JSON**: `{ version: 1, name: "...", created: "...", resolution: "1920x1080", scale: 1.0, windows: [...], comments: [...] }`
    - **Download as file**: `preset-name.ui.json`
    - **Upload file**: FileReader → parse JSON → restore layout
    - **URL sharing**: JSON → lz-string compress → base64 → append to URL hash `#preset=...`
    - **URL loading**: on page load, check URL hash → decompress → restore layout
    - **Auto-save to localStorage** every 5 seconds (debounced)

14. **Built-in presets**: `presets/default.json` — a starter layout with example window positions

## Phase 5: Comment / Annotation System

### Steps
15. **comment-manager.js** — Pin annotations:
    - **Comment Mode**: When active, clicking anywhere on a window places a numbered pin marker
    - Each pin: `{ id, windowId, relativeX, relativeY, text, author, timestamp, color }`
    - Coordinates stored relative to window (0-1 range) so they survive resize/move
    - Pins rendered as small colored circles with numbers, positioned absolutely within the window
    - Click pin → expand to show text + author + reply thread
    - Edit/delete own pins
    - Author name: prompted once, stored in localStorage

16. **Pin visual design**: Small glowing dots (numbered), on hover show a tooltip, on click show full comment card with text area

17. **Comments travel with presets**: When exporting a preset, all pins are included. When loading, all pins are restored. This makes sharing + commenting a single flow: arrange layout → pin comments → share URL/JSON → others see layout + comments → add their pins → share back

18. **Optional: Giscus integration** — A toggleable discussion panel connected to the GitHub repo's Discussions for persistent general feedback (separate from pin annotations)

## Phase 6: Export System (PNG for Photoshop)

### Steps
19. **export-manager.js** — Element-level PNG export:
    - **Export Mode**: When active, all elements with `data-export` attribute get a colored overlay/outline
    - Hovering highlights the export boundary
    - Click → renders via html2canvas with `backgroundColor: null` (transparent) → downloads as PNG
    - Export scale: configurable multiplier (1x, 2x, 3x) for higher resolution output

20. **Export Panel** (appears in Export Mode):
    - Tree view: Window → Exportable elements
    - Checkbox to select multiple elements
    - "Export Selected" → each element rendered to PNG → packaged into ZIP via JSZip → download
    - "Export All" → batch export everything
    - Preview thumbnails for each exportable element

21. **data-export-group** attribute: When multiple DOM elements should export as one image, wrap them in a container with `data-export-group="name"`. The exporter captures the container as a single PNG.

22. **Export naming convention**: `{window-id}_{export-name}_{scale}x.png` e.g. `inventory_cell_2x.png`

## Phase 7: Window Template & AI Agent Instructions

### Steps
23. **windows/_template/** — Boilerplate for creating new windows:
    - `config.js` — Pre-filled with all required fields and comments
    - `template.html` — Skeleton HTML with data-export examples
    - `style.css` — Base structure with scoping comments
    - `WINDOW.md` — Comprehensive instructions for AI/developer:
      - System overview and contract
      - How to define drag handle
      - How to define resize behavior
      - How to mark exportable elements (`data-export` vs `data-export-group`)
      - CSS scoping rules (all selectors auto-scoped to `[data-window-id="..."]`)
      - Interactive behavior patterns (tabs, tooltips, scrollable areas)
      - File naming and registration in manifest.json
      - Example: complete annotated window

24. **Root `.instructions.md`** — Top-level project instructions for AI agents:
    - Project overview
    - How to create a new window (copy _template, customize, register in manifest)
    - Architecture overview
    - List of core APIs available to windows
    - CSS variable reference

---

## Relevant Files

- `index.html` — Main shell, viewport, CDN imports, control panel markup
- `css/core.css` — Viewport layout, control panel styles, CSS variables, animations
- `js/app.js` — Bootstrap: load manifest, init managers, restore layout from URL/localStorage
- `js/core/window-manager.js` — Window registry, open/close/focus, z-index stack
- `js/core/drag-engine.js` — Pointer-event-based drag with optional screen bounds
- `js/core/resize-engine.js` — Resize handles, min/max constraints
- `js/core/context-menu.js` — Custom right-click menu
- `js/core/layout-manager.js` — JSON preset save/load/share, URL encoding, localStorage auto-save
- `js/core/export-manager.js` — html2canvas PNG export, batch ZIP, export mode UI
- `js/core/comment-manager.js` — Pin annotations, comment cards, author tracking
- `js/core/settings.js` — Global settings state, persistence, UI bindings
- `windows/manifest.json` — Window registry
- `windows/_template/` — New window boilerplate + WINDOW.md instructions
- `presets/default.json` — Default layout preset

## Verification

1. Open `index.html` in browser (or via local server) — viewport renders at 1920×1080 with scaling
2. Add a test window using the template → appears in manifest → opens/closes from control panel
3. Drag window by its handle → moves; drag stops at viewport edges (when bounds enabled)
4. Right-click window → context menu appears with "Close" option
5. Click between two open windows → z-index changes correctly (focused on top)
6. Resize window via handle → respects min/max constraints
7. Save preset → JSON file downloads; upload it → layout restores exactly
8. Click "Share URL" → URL with hash generated; open in new tab → same layout loads
9. Switch to Comment Mode → click on window → pin appears → type comment → pin persists in preset
10. Switch to Export Mode → exportable elements highlighted → click element → PNG downloads with transparency
11. Batch export → ZIP file downloads with all PNGs named correctly
12. Change UI scale → all windows scale proportionally
13. Set video background → video loops behind windows

## Decisions

- **No framework / no build step**: Vanilla JS + ES Modules + CDN libs — maximum simplicity for GitHub Pages
- **CSS scoping via attribute selectors** (not Shadow DOM) — ensures html2canvas compatibility for PNG export
- **Comments via pin annotations in presets** — multi-user sharing works by passing JSON/URL, no backend needed
- **Giscus optional** — can be added later for persistent GitHub Discussions integration
- **Base resolution 1920×1080** — scale factor adjusts from there
- **Export format: PNG with transparency** — directly usable in Photoshop
- **Window authoring: manual in code** — AI agents use WINDOW.md template instructions
- **Auto-scoping CSS**: Core loader automatically wraps all window CSS selectors inside `[data-window-id="..."]` so window authors write plain CSS without worrying about conflicts

## Further Considerations

1. **Snap-to-grid**: Optional grid snapping for window positioning (useful for pixel-perfect layouts). Recommend adding as a settings toggle — easy to implement in drag-engine. **Recommendation: include as optional feature.**

2. **Keyboard shortcuts**: e.g. Ctrl+S to save preset, Escape to close focused window, Tab to cycle windows. **Recommendation: add in Phase 3 alongside control panel.**

3. **Mobile/touch support**: The emulator is desktop-focused (1920×1080), but touch events could be mapped for tablet testing. **Recommendation: exclude from initial scope, add later if needed.**
