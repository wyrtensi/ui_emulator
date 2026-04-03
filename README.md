# UI Emulator

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
- Layout save/load/share using JSON files or URL hash compression (LZ-String).
- Auto-save to localStorage.
- Background gallery, local background upload, and independent background zoom.
- Runtime module import:
  - Local ZIP or file bundle (`config.js`, `template.html`, `style.css`)
  - GitHub branch window import (`https://github.com/{user}/{repo}/tree/{branch}`).

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
  - `_template/`: Boilerplate for new windows
- `canvas/`: Concept Canvas module
  - `canvas-engine.js`: Canvas interaction, chat mirror, and persistence
- `concept.canvas`: Canvas graph data file
- `canvas_uploads/`: Repository-stored canvas image assets
- `assets/backgrounds/`: Built-in background presets
- `worker/auth-proxy.js`: Cloudflare Worker for OAuth and upload proxy
- `wrangler.jsonc`: Worker config
- `.instructions.md`: Developer and agent implementation guidance.

## Creating a New Window

1. Copy `windows/_template` to `windows/your-window-id`.
2. Edit `config.js`, `template.html`, and `style.css`.
3. Add the id to `windows/registry.json`.
4. Reload the app and toggle the module from the Windows list.

You can also test without committing by importing a ZIP from the Control Panel.

## Tech Stack

- Vanilla HTML/CSS/JavaScript (ES modules)
- html2canvas
- JSZip
- LZ-String
- marked
- GitHub REST + GraphQL APIs
- Cloudflare Workers

## License

PolyForm Noncommercial License
