# UI Emulator

![UI Emulator](readme_poster.jpg)

UI Emulator is a static, browser-based RF Online HUD playground with two connected workspaces:

- Window Emulator: arrange modular UI windows, export art slices, and share layouts.
- Concept Canvas: full-screen node graph for planning, linking, and discussion.

No build pipeline is required. The app runs on plain HTML, CSS, and ES modules.

## Current Project State (April 2026)

### Window Emulator

- Dynamic runtime window loading from `windows/registry.json` and per-window `config.js` modules.
- Drag, resize, focus/z-order management, and right-click context actions.
- Design, Export, and Comment modes.
- PNG export and batch ZIP export via html2canvas + JSZip.
- Export Mode now supports multi-match selector slicing with count-aware selection (fine-grained repeated parts export correctly).
- Export slicing policy is element-first: text-only selectors are intentionally excluded from built-in export lists.
- Export definitions can declare optional state variants (for example hover/click) and generate extra PNGs with suffixes (`_hover`, `_click`, ...).
- Export rendering preserves clip-path/cut-corner silhouettes with a clip-path-aware canvas mask pass.
- Layout save/load/share using JSON files or URL hash compression (LZ-String).
- Auto-save to localStorage.
- Background gallery, local background upload, and independent background zoom.
- Runtime module import:
  - Local ZIP or file bundle (`config.js`, `template.html`, `style.css`)
  - GitHub branch window import (`https://github.com/{user}/{repo}/tree/{branch}`).
- Optional window versions under one window id using subfolders (`windows/{id}/v1`, `windows/{id}/v2`, ...).
- GitHub import can target a specific version with hash params (`#window={id}&version={key}`), while old links continue to work.
- Versioned windows can be switched at runtime from the Control Panel Windows list (selection persists in local settings and owner defaults).
- Owner-only one-click action to save default window versions + layout positions/sizes for everyone via `config.json`.
- Interactive window state (tabs, editable values, filters, mode toggles) can be captured/applied by window modules and included in owner defaults.

### Collaboration and GitHub Integration

- GitHub OAuth login through a Cloudflare Worker proxy.
- Global discussion panel backed by one GitHub Discussion.
- Message reactions and image paste support in discussion chat.
- Comment pins backed by GitHub Issues threads:
  - One issue per pin
  - Issue comments as replies
  - Owner controls for move/resolve/clear
  - Signed-in users can create pins and reply/delete their own content.

### Permission Model

- Guest (not signed in):
  - Can browse UI and canvas content
  - Can use local layout features
  - Cannot post chat, react, create pins, or write repository files.
- Signed-in contributor (non-owner):
  - Can use discussion chat and reactions
  - Can create/reply in pin threads
  - Can navigate/select/search canvas and share node links
  - Cannot edit or save canvas content.
- Repository owner:
  - Full emulator and canvas edit permissions
  - Can upload canvas images and save `concept.canvas`
  - Can manage pins globally (move/resolve/clear) and update default scale settings.

### Concept Canvas (Canvas Window)

- Full-screen infinite canvas overlay with:
  - Text, image, and group nodes
  - Directed edges with arrowheads
  - Minimap and node search
  - Smooth zoom, pan, and fit-to-content.
- Owner editing features:
  - Create/edit/delete nodes and edges
  - Marquee multi-select and multi-delete
  - Duplicate and copy/paste node sets (including internal edges)
  - Rich text formatting (lists, headings, quote, code, links)
  - Text alignment (left/center/right) and vertical alignment (top/middle/bottom)
  - Smart edge-drop on empty canvas:
    - Opens context menu
    - Creates selected node type
    - Auto-connects pending edge
  - Image uploads by picker, drag-and-drop, and clipboard paste
  - Manual save plus owner autosave to `concept.canvas`.
- Viewer-safe behavior:
  - Can open, pan, zoom, search, and select nodes
  - Can share node links to chat from the node toolbar
  - Cannot mutate canvas content.
- Reliability improvements:
  - Remote canvas load fallback to local `concept.canvas`
  - Safer rendering for malformed image-node payloads.

## Included Windows

Modules currently listed in `windows/registry.json`:

- `top-panel`
- `hp-bars`
- `race-indicator`
- `target-info`
- `minimap`
- `chat-box`
- `action-bar`
- `xp-bar`
- `inventory`
- `character`
- `abilities`
- `example-window`

The `canvas` module is loaded from `canvas/` and opened from the Canvas button in side controls.

## Quick Start

1. Clone or download this repository.
2. Serve it with any static server, for example:

   python -m http.server 3000

3. Open `http://localhost:3000` in a modern browser.
4. Press `F2` to open the Control Panel.

No npm install and no build step are required.

## Configuration

### App and GitHub settings

Edit `js/config.js`:

- `github.clientId`: GitHub OAuth app client id
- `github.repo`: target repository (`owner/repo`)
- `github.branch`: write/read branch
- `github.workerUrl`: deployed Cloudflare Worker URL
- `github.pinLabel`: issue label used for pins
- `github.discussionNumber`: discussion number used for chat.

### Optional default UI values

`config.json` can define startup defaults:

- `scale`
- `bgScale`
- `windowDefaults` (owner-published baseline for all users when no local/url preset exists):
  - `windowVersions`: selected version per window id
  - `windows`: layout snapshot (`x`, `y`, `width`, `height`, `open`, `zIndex`)
  - `windowState`: optional interactive state payload per window (tabs, editable values, filters)

### Worker deployment

`worker/auth-proxy.js` handles:

- `POST /auth/callback` for OAuth token exchange
- `POST /catbox` for image upload proxy.

Expected Worker environment variables:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `ALLOWED_ORIGIN`
- `CATBOX_USERHASH` (optional)

`wrangler.jsonc` is included for Cloudflare Worker deployment.

## Keyboard Shortcuts

Global:

- `F2`: Toggle Control Panel
- `Esc`: Close topmost window (or close guide first)
- `Ctrl+S`: Quick layout autosave
- `1 / 2 / 3`: Switch Design / Export / Comment mode
- `Space` (Comment mode): Toggle pin visibility.

Canvas:

- `Ctrl+F`: Open node search
- `Ctrl+S`: Save canvas (owner)
- `Delete` / `Backspace`: Delete selected node or edge (owner)
- `Ctrl+C` / `Ctrl+V`: Copy and paste selected node set (owner)
- `Ctrl+D`: Duplicate selected node set (owner)
- `V` / `T` / `E`: Select, Text, Edge tools (owner)
- Arrow keys: Nudge selection by 1px (owner)
- `Shift + Arrow`: Nudge selection by 10px (owner)
- Triple-click node text: Select all text in the node
- Drag image files onto canvas: Upload and create image nodes (owner)
- Paste image from clipboard: Upload and create image node (owner).

## Project Structure

ui_emulator-main/

- `index.html`: App shell, overlays, panel, and discussion containers
- `css/core.css`: Global styling and viewport/background layering
- `js/app.js`: Bootstrap, runtime loading, and panel wiring
- `js/core/`: Core managers (window, drag, resize, export, comments, auth, API, discussion)
- `windows/`: Modular HUD windows
  - `registry.json`: Boot window id list
- `windows_guide/`: Boilerplate files and authoring guide for new windows
- `canvas/`: Concept Canvas module
  - `canvas-engine.js`: Canvas interaction, chat mirror, and persistence
- `concept.canvas`: Canvas graph data file
- `canvas_uploads/`: Repository-stored canvas image assets
- `assets/backgrounds/`: Built-in background presets
- `worker/auth-proxy.js`: Cloudflare Worker for OAuth and upload proxy
- `wrangler.jsonc`: Worker config
- `.instructions.md`: Developer and agent implementation guidance.

## Creating a New Window

1. Create `windows/your-window-id`.
2. Copy `windows_guide/config.js`, `windows_guide/template.html`, and `windows_guide/style.css` into that folder.
3. Edit the files for your window and set `id` to your folder name.
4. Add the id to `windows/registry.json`.
5. Reload the app and toggle the module from the Windows list.

You can also test without committing by importing a ZIP from the Control Panel.

For versioned windows (single id, multiple looks):

1. Keep root `windows/your-window-id/config.js` as version catalog (`defaultVersion` + `versions`).
2. Add subfolders per version (`v1`, `v2`, etc.), each with `config.js`, `template.html`, `style.css`.
3. Keep the same `id` inside every version config.
4. During import, the app prompts for version when multiple versions exist.
5. After load, switch versions any time from the Control Panel Windows list selector.

### Optional Export State Variants

When you need interactive-state assets (hover/click/active), add `variants` to a granular export entry:

```js
{
  selector: '[data-export="my-button"]',
  name: 'button',
  label: 'Button',
  variants: [
    { state: 'hover', className: 'ui-export-hover' },
    { state: 'click', className: 'ui-export-click' },
  ],
}
```

Notes:

- Variants are applied to cloned export DOM only (live UI is not mutated).
- Export file naming includes the variant suffix, e.g. `my-window_button_hover_2x.png`.
- Multi-match selectors keep indexing, then add suffix, e.g. `button_3_click`.
- Implement the matching CSS classes (or attribute/style rules) in your window styles.
- Prefer exporting element containers/cells (buttons, slots, bars, cards) and avoid text-only export targets.

## Tech Stack

- Vanilla HTML/CSS/JavaScript (ES modules)
- html2canvas
- JSZip
- LZ-String
- marked
- GitHub REST + GraphQL APIs
- Cloudflare Workers

## License

PolyForm Noncommercial License 1.0.0
