# RFO UI Emulator

A modular, browser-based interface emulator for RF Online. Design, arrange, comment on, and export pixel-perfect recreations of the game's HUD using a drag-and-drop canvas at native 1920x1080 resolution.

## Features

* Modular Window System: each HUD element is a self-contained module (HTML + CSS + JS) loaded at runtime
* Drag and Drop: move any window freely across the canvas
* Resize Handles: eight-directional resize with per-window min/max constraints
* Right-Click Context Menu: quick access to export, comment, layout, and window actions
* Layout Presets: save, load, and share entire UI arrangements
* Granular Image Export: export individual UI elements, slots, cells, or the full viewport via html2canvas and JSZip, with an advanced UI export tree
* Auto-Fit Scale: scales the 1920x1080 viewport to fit any browser size
* Collaborative Comments: pin threaded comment markers on any window
  * Local mode: anonymous, stored in-browser
  * GitHub Discussions mode: authenticate via GitHub OAuth, pins backed by GitHub GraphQL API
* GitHub URL Import: dynamically import custom UI windows straight from a repository branch (e.g. `https://github.com/user/repo/tree/branch`)
* Anonymous Image Uploads: seamless upload of screenshots to Catbox.moe via Cloudflare Worker proxy

## Included Windows

| Window | Description |
|--------|-------------|
| Player Status | Race icon, guild name, timer, HP/FP/SP/DEF bars with cascading widths |
| Target Info | Enemy name, level, distance, health track, race badge |
| Minimap | Grid-based minimap with crosshair, player dot, zoom/center tools |
| Chat Box | Tabbed chat (ALL/GUILD/PARTY/RACE) with colored messages and input |
| Action Bar | Dynamic hotkey grid (F1-F9+) that reflows on resize via ResizeObserver |
| XP Bar | SVG arc with pathLength-based percentage fill and level display |
| Inventory | Dynamic grid with ResizeObserver, search, tabs, slot counter, gold |
| Character | Equipment slots with silhouette wireframe, stat grid, mastery bars |
| Abilities | Color-dot tabs, category headers, skill rows with segmented progress bars |

## Quick Start

1. Clone or download this repository
2. Serve from any local HTTP server:
   ```bash
   python3 -m http.server 3000
   ```
   or open with VS Code Live Server
3. Open `http://localhost:3000` in a modern browser

No build step, no dependencies to install. Everything runs from vanilla JS + ES modules.

## Project Structure

```
rfo_ui_emulator/
├── index.html              # Main page viewport, overlays, control panel
├── css/core.css            # Global styles, panel, toolbar, toast, auth UI
├── js/
│   ├── app.js              # Bootstrap loads registry, wires settings and auth
│   ├── config.js           # GitHub and Application configuration
│   └── core/
│       ├── window-manager.js   # Creates, opens, closes, z-orders windows
│       ├── drag-engine.js      # Pointer-based drag with bounds clamping
│       ├── resize-engine.js    # Eight-handle resize with min/max enforcement
│       ├── context-menu.js     # Dynamic right-click menu
│       ├── layout-manager.js   # Save/load/share layout presets (LZ-string)
│       ├── export-manager.js   # html2canvas single, batched, and ZIP export
│       ├── comment-manager.js  # Pin placement, threads, visibility toggle
│       ├── settings.js         # Observable settings store
│       ├── github-auth.js      # GitHub OAuth flow (popup + Cloudflare Worker)
│       ├── discussion-manager.js # Remote pin CRUD via GitHub Discussions GraphQL API
│       └── image-upload.js     # Image upload via Catbox.moe API proxy
├── windows/
│   ├── registry.json       # Window registry IDs
│   ├── top-panel/          # Control Panel
│   ├── hp-bars/            # HP/FP/SP/DEF bars
│   ├── target-info/        # Enemy target overlay
│   ├── minimap/            # Grid minimap
│   ├── chat-box/           # Tabbed chat
│   ├── action-bar/         # Hotkey grid
│   ├── xp-bar/             # XP arc
│   ├── inventory/          # Item grid
│   ├── character/          # Equipment and stats
│   └── abilities/          # Skills and progress
├── worker/
│   └── auth-proxy.js       # Cloudflare Worker for Auth and Image Upload proxy
└── .instructions.md        # Guide for AI Agents and Developers for making new windows
```

## How to Create a New Window

For a comprehensive guide, please refer to `.instructions.md`.

In short:
1. Create a new folder under `windows/{window-id}/`
2. Create `config.js`, `template.html`, and `style.css`
3. Add your `{window-id}` to `windows/registry.json`
4. Use `data-export` attributes directly on your HTML elements for clean PNG exports

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| F2 | Toggle control panel |
| Space | Toggle comment pins visibility |
| Escape | Close context menu / cancel |

## Tech Stack

* HTML / CSS / ES Modules (zero build, zero framework)
* html2canvas: screenshot rendering
* JSZip: batch ZIP export
* LZ-String: layout preset compression
* Cloudflare Workers: Proxy for OAuth token exchange and Catbox Image Uploads
* GitHub Discussions GraphQL API: Remote comment storage

## License

MIT
