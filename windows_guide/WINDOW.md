# Window Authoring Guide (Canonical, AI-Safe)

## Scope

This is the canonical guide for building runtime window modules in this repository.

Important:

- `windows_guide/` is guide content, not a runtime module.
- The guide dialog in settings UI is a documentation surface, not an emulated window.
- Do not register `windows_guide` in `windows/registry.json`.
- Do not add slicing requirements to guide content itself.

## Runtime Architecture Snapshot

Each runtime window lives in `windows/{window-id}/` and contains:

- `config.js`
- `template.html`
- `style.css`

Built-in windows are loaded from `windows/registry.json`.

Ad-hoc windows can be imported from:

- local ZIP / 3 files
- GitHub branch URL

Versioned import targeting supports:

- `#window={id}&version={key}`
- runtime switching from Control Panel Windows list selector (for windows with multiple versions)

## Quick Start

1. Create folder: `windows/{your-window-id}/`
2. Copy starter files from `windows_guide/`
3. Edit `id`, markup, styles, behavior
4. Add id to `windows/registry.json` if this is a built-in window
5. Reload and verify behavior

## CSS Behavior (Critical)

Window CSS is automatically scoped by the loader.

Rules:

- write plain class-based CSS
- avoid global selectors (`html`, `body`, `*`)
- avoid id selectors unless necessary
- `@media` and `@keyframes` are supported
- global per-window transparency is controlled by the emulator on `.ui-window` using background alpha
- avoid applying `opacity` on your top-level container when you want transparency, because it also fades text/icons
- prefer `rgba(...)` backgrounds for visual transparency effects inside your module

## Config Contract

Required:

- `id`: matches folder name
- `title`: display label
- `defaultPosition`: `{ x, y, width, height }`
- `defaultOpen`: boolean
- `dragHandle`: selector existing in template
- `resizable`: `{ enabled, handles, min/max }`

Behavior:

- `init(container)`: wire events and interactions

Optional state persistence:

- `captureState(container)`
- `applyState(container, state)`

Note:

- Control Panel transparency sliders are handled globally and stored in settings/presets; window modules do not need custom state hooks for this.

## Export Strategy (Decision Rule)

Default path:

- use minimal export scope (`full` only)

Only add granular slicing when explicitly needed for asset extraction.

If you enable granular slicing:

- include stable semantic selectors
- use repeated selectors for repeated nodes (multi-match export supported)
- prefer cell/shape containers over text-only selectors
- dispatch refresh event after dynamic DOM updates:

```js
document.dispatchEvent(new CustomEvent('ui-export-refresh'));
```

`window.dispatchEvent(...)` is also supported.

Optional state variants (hover/click/active):

- add `variants` to a specific export entry when extra state PNGs are required
- variants are rendered from cloned DOM during export (live UI is not mutated)
- file names append a normalized suffix from `state` (or fallback token)

Example:

```js
{
  selector: '[data-export="my-btn"]',
  name: 'button',
  label: 'Button',
  variants: [
    { state: 'hover', className: 'ui-export-hover' },
    { state: 'click', className: 'ui-export-click' },
  ],
}
```

Supported variant fields:

- `state`: logical state name used for output suffix (`_hover`, `_click`, ...)
- `className`: class tokens to add to target clone
- `selector`: optional nested selector inside exported element clone
- `attributes`: optional attribute map applied to clone target(s)
- `style`: optional inline style map applied to clone target(s)

Cut-corner note:

- clip-path based corners/chamfers are preserved in exported PNGs via clip-path-aware masking
- avoid text-only export targets when building granular lists

## Minimal Baseline Example

```js
export default {
  id: 'inventory',
  title: 'Inventory',
  defaultPosition: { x: 580, y: 130, width: 340, height: 380 },
  defaultOpen: false,
  dragHandle: '.inv-header',
  resizable: {
    enabled: true,
    handles: ['se', 's', 'e'],
    minWidth: 260,
    minHeight: 280,
  },
  exports: [
    { selector: '[data-export="inv-full"]', name: 'full', label: 'Full Inventory' },
  ],
  init(container) {},
};
```

## Optional Interactive State Pattern

Use this only when users can edit tabs/values/filters/modes.

```js
init(container) {
  container._stateApi = {
    getState: () => ({ activeTab: 'info' }),
    setState: (state) => {
      // apply state safely
    },
  };
},

captureState(container) {
  return container?._stateApi?.getState?.() || null;
},

applyState(container, state) {
  if (!state || typeof state !== 'object') return;
  container?._stateApi?.setState?.(state);
}
```

This integrates with `config.json.windowDefaults.windowState`.
Global transparency defaults integrate through `config.json.windowDefaults.windowOpacity`.

## Versioned Windows (Optional)

```text
windows/example-window/
  config.js
  v1/
    config.js
    template.html
    style.css
  v2/
    config.js
    template.html
    style.css
```

Keep one logical id across versions.

At runtime, users can change version from the Windows list selector for that window.

## Close Import Paths

Standard window path (`windows/{id}/config.js`):

```js
import('../../js/core/window-manager.js').then(m => m.windowManager.close('your-id'));
```

Versioned path (`windows/{id}/{version}/config.js`):

```js
import('../../../js/core/window-manager.js').then(m => m.windowManager.close('your-id'));
```

## AI Output Contract (Strict)

When another AI generates a window, require this exact output shape:

- exactly 3 files
- no extra narrative
- no framework dependencies

Expected output sections:

1. `config.js`
2. `template.html`
3. `style.css`

Reject output if:

- `id` mismatches folder name
- `dragHandle` selector does not exist
- import path depth is wrong
- unnecessary slicing is added when not requested
- unknown external libraries are introduced

## Common Failure Modes

- id/folder mismatch
- missing drag handle element
- wrong close import depth
- over-sliced templates by default
- text-only export slices that duplicate typography instead of UI elements
- no refresh event after dynamic render
- unbounded resize values
- variant classes declared in config but missing in CSS
- using variants when base selector is too broad (unintended state output)

## Verification Gate (Must Pass)

1. Open/close works.
2. Drag handle moves window.
3. Resize handles enforce min/max.
4. Export behavior matches requested scope:
   - minimal: full only
   - granular: repeated selectors index correctly
5. Dynamic DOM updates keep export tree in sync.
6. Optional variant exports produce expected suffix files and visuals.
7. Clip-path/cut-corner elements preserve silhouette in exported output.
8. Optional state capture/apply restores UI correctly.
9. No runtime console errors.

## Copy-Paste Prompt (Minimal, Recommended)

```text
Create a UI Emulator window module as exactly 3 files: config.js, template.html, style.css.

Rules:
- Vanilla HTML/CSS/JS only. No frameworks and no external libraries.
- id must match folder name: {window-id}.
- dragHandle selector must exist in template.html.
- Use minimal export scope only: one full-window export.
- Add captureState/applyState only if the window has editable tab/value/filter state.
- Use close import path depth matching config.js location.

Output format:
- Return only 3 code blocks named config.js, template.html, style.css.
- No explanation text.
```

## Copy-Paste Prompt (Granular Export Variant)

```text
Create a UI Emulator window module as exactly 3 files: config.js, template.html, style.css.

Same constraints as minimal mode, plus:
- Add granular export slicing for requested sub-parts.
- Use stable semantic export selectors.
- Use repeated selectors for repeated nodes.
- Avoid text-only export targets; export element containers/cells.
- Dispatch ui-export-refresh after dynamic DOM changes.
- If interactive export states are requested, add `variants` and matching CSS state classes.

Output format:
- Return only 3 code blocks named config.js, template.html, style.css.
- No explanation text.
```
