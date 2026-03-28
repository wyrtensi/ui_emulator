# How to Create a New Window — Guide for Developers & AI Agents

## Overview

Each window in the RFO UI Emulator is an independent module consisting of 3 files inside its own folder under `windows/`:

```
windows/
  my-window/
    config.js       ← Module config (position, drag handle, resize, export definitions)
    template.html   ← HTML content of the window
    style.css       ← Window-specific styles (auto-scoped by core)
```

---

## Step-by-Step: Creating a New Window

### 1. Copy the Template

Copy the entire `windows/_template/` folder and rename it to your window's ID:

```
windows/_template/  →  windows/inventory/
```

The folder name **must match** the window's `id` in config.js.

### 2. Register in Registry

Add your window's ID to `windows/registry.json`:

```json
[
  "player-status",
  "inventory"
]
```

That's it — no complex manifest needed. All metadata lives in your window's `config.js`.

### 2b. Or Import Client-Side (No Git Required)

You can also test your window without adding it to the repository:
1. ZIP your 3 files (config.js, template.html, style.css)
2. In the emulator, open the Control Panel (F2)
3. Click **📥 Import Window** and select your ZIP
4. The window loads instantly and persists in localStorage

### 2c. Or Import from GitHub Repository (Branch)

You can import custom windows directly from a GitHub repository using a branch URL:
1. Ensure your custom windows are in their own folders (e.g., `my-window/`) containing `config.js`, `template.html`, and `style.css`.
2. Push them to a GitHub repository branch.
3. In the emulator, open the Control Panel (F2).
4. Enter the GitHub branch URL (e.g., `https://github.com/{user}/{repo}/tree/{branch}`) and click **Import from GitHub**.
5. The emulator will automatically fetch and load all valid windows from that branch into your local instance.

### 3. Edit config.js

```js
export default {
  id: 'inventory',
  title: 'Inventory',
  defaultPosition: { x: 100, y: 100, width: 400, height: 500 },
  defaultOpen: false,
  dragHandle: '.inventory-header',  // CSS selector for the drag zone
  resizable: {
    enabled: true,
    handles: ['se'],                // which edges/corners allow resize
    minWidth: 300, minHeight: 400,
    maxWidth: 800, maxHeight: 900,
  },
  exports: [
    { selector: '[data-export="inventory-full"]', name: 'inventory-full', label: 'Full Inventory' },
    { selector: '[data-export="inv-grid"]', name: 'inv-grid', label: 'Item Grid' },
    { selector: '[data-export="inv-cell"]', name: 'inv-cell', label: 'Single Cell' },
  ],
  init(container) {
    // Optional: wire interactive logic here
  },
};
```

### 4. Edit template.html

Write your window's HTML. Important attributes:

```html
<!-- Wrapper for the full window export -->
<div class="inventory-container" data-export="inventory-full">
  <!-- This is the drag handle (matches config.dragHandle) -->
  <div class="inventory-header">
    <span>INVENTORY</span>
    <button class="close-btn">✕</button>
  </div>

  <!-- Mark individual exportable elements -->
  <!-- IMPORTANT: Use padded wrappers for elements with box-shadows, drop-shadows, or clip-paths -->
  <div data-export="inv-grid" style="padding: 10px; margin: -10px;">
    <div class="inv-grid">
      <div class="inv-cell">...</div>
    </div>
  </div>
</div>
```

### 5. Edit style.css

Write plain CSS — **no scoping needed**. The core loader automatically prefixes all selectors with `[data-window-id="inventory"]`.

```css
/* This becomes: [data-window-id="inventory"] .inventory-container { ... } */
.inventory-container {
  width: 100%;
  height: 100%;
  background: rgba(10, 14, 24, 0.92);
}
```

---

## Key Concepts

### Drag Handle
- Any element inside your window can be the drag handle
- Referenced by `config.dragHandle` CSS selector
- The core automatically sets `cursor: move` on it
- Interactive elements inside the handle (inputs, buttons) still work normally

### Resize
- `resizable.enabled: false` → window cannot be resized
- `resizable.handles` → array of directions: `'n','s','e','w','ne','nw','se','sw'`
- The core adds invisible handles; you don't need to create them
- Min/max dimensions prevent over-shrinking or over-expanding

### Exportable Elements (`data-export`)
- Add `data-export="name"` to any element you want individually exportable as PNG
- The name is used in the export filename: `{window-id}_{name}_{scale}x.png`
- In Export Mode, these elements get highlighted and become clickable for instant download

### IMPORTANT FOR AI AGENTS: Preventing Visual Clipping on Export
When `html2canvas` generates PNG exports, it strictly crops to the bounding box of the element marked with `data-export`.
**If your element uses `box-shadow`, `drop-shadow()`, thick borders, or `clip-path` effects that extend beyond its standard bounding box, they WILL BE CUT OFF.**

**To fix this, you must wrap the target element in a padded container and move the `data-export` attribute to the wrapper.**

**Incorrect:**
```html
<!-- The glow shadow will be cut off! -->
<div class="glowing-orb" data-export="orb"></div>
```

**Correct:**
```html
<!-- The wrapper gives 15px of breathing room on all sides so the shadow is captured.
     The negative margin ensures it doesn't break the layout flow. -->
<div data-export="orb" style="padding: 15px; margin: -15px;">
  <div class="glowing-orb"></div>
</div>
```
Always use this padded wrapper pattern when defining `data-export` regions for elements that have visual overlap, glows, or borders.

### CSS Scoping Rules
- The loader prefixes ALL your CSS selectors with `[data-window-id="your-id"]`
- `:root` and `:host` selectors are replaced with the scope selector
- `@keyframes` and `@media` are passed through unmodified
- Use class names freely — they won't conflict with other windows
- **Avoid** using IDs in window CSS (use classes instead)

### Interactive Behavior
- Use `config.init(container)` for event listeners, animations, etc.
- `container` is the `.rfo-window` element containing your HTML
- Query elements with `container.querySelector(...)` to stay within scope
- For closing the window from inside:
  ```js
  init(container) {
    container.querySelector('.close-btn')?.addEventListener('click', () => {
      // Access window manager to close this window
      import('../../js/core/window-manager.js').then(m => m.windowManager.close('inventory'));
    });
  }
  ```

---

## Complete Example: Minimal Window

### config.js
```js
export default {
  id: 'minimap',
  title: 'Minimap',
  dragHandle: '.minimap-header',
  resizable: { enabled: false },
  exports: [
    { selector: '[data-export="minimap-full"]', name: 'full', label: 'Full Minimap' },
  ],
  init(container) {},
};
```

### template.html
```html
<div class="minimap" data-export="minimap-full">
  <div class="minimap-header">MAP</div>
  <div class="minimap-canvas">
    <div class="player-dot"></div>
  </div>
</div>
```

### style.css
```css
.minimap {
  width: 200px;
  height: 220px;
  background: rgba(0, 10, 20, 0.9);
  border: 1px solid rgba(0, 200, 255, 0.2);
}

.minimap-header {
  padding: 4px 8px;
  font-size: 10px;
  color: #00c8ff;
  text-transform: uppercase;
  border-bottom: 1px solid rgba(0, 200, 255, 0.15);
}

.minimap-canvas {
  position: relative;
  flex: 1;
  background: rgba(0, 40, 60, 0.3);
}

.player-dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 6px;
  height: 6px;
  background: #0f0;
  border-radius: 50%;
  transform: translate(-50%, -50%);
}
```

---

## Checklist

- [ ] Folder created under `windows/` with matching name
- [ ] `config.js` exports valid config with `id`, `title`, `dragHandle`
- [ ] `template.html` contains the window HTML with `data-export` attributes
- [ ] Visual elements marked for export are wrapped in padded containers to prevent clipping
- [ ] `style.css` uses class selectors (no IDs, no `!important` unless necessary)
- [ ] Entry added to `windows/registry.json`
- [ ] Tested: window opens, drags, resizes, exports elements
