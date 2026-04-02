import { githubAuth } from '../js/core/github-auth.js';
import { githubApi } from '../js/core/github-api.js';
import config from '../js/config.js';

let canvasData = { nodes: [], edges: [] };
let scale = 1;
let translateX = 0;
let translateY = 0;
let isDraggingViewport = false;
let startDragX, startDragY;
let isMarqueeSelect = false;
let marqueeStartX = 0, marqueeStartY = 0;
let selectionBox = null;

let selectedNode = null;
let selectedEdge = null;
let isDraggingNode = false;
let multiSelectedNodes = new Set();
let editingNodeId = null; // Track which node is currently being edited

let currentTool = 'select';
let theme = 'dark';
let isOwner = false;
let canvasSha = null;

let undoStack = [];
let redoStack = [];

let isDrawingEdge = false;
let drawEdgeStartNode = null;
let drawEdgeStartSide = null;

const CANVAS_FILE = 'concept.canvas';
let hasUnsavedChanges = false;
let autoSaveInterval = null;
let isSaving = false;

// Search state
let searchResults = [];
let searchIndex = -1;

// Snap guides
let guidesLayer = null;

// Minimap
let minimapCanvas = null, minimapCtx = null, minimapEl = null, minimapViewportEl = null;
let minimapBounds = null; // cached { minX, minY, maxX, maxY }

// Smooth animation
let animationFrameId = null;

// Nudge history debounce
let nudgeHistoryPushed = false;
let nudgeTimeout = null;

// Cleanup functions for window-level event listeners (prevents memory leaks)
let nodeCleanupFns = [];

// DOM Elements
let container, viewport, content, nodesLayer, edgesLayer, drawingLayer, drawingEdge;
let zoomLabel, saveIndicator, nodeToolbar;

export async function initCanvas(winContainer, config) {
    container = winContainer;

    // Force fullscreen overlay by resetting the window wrapper
    const uiWindow = container.closest('.ui-window');
    if (uiWindow) {
        // Appending to body strips it out of the scaled viewport and ensures it is truly fullscreen
        // Keep it in DOM so windowManager can track it, but position it absolute/fixed
        uiWindow.style.position = 'fixed';
        uiWindow.style.top = '0';
        uiWindow.style.left = '0';
        uiWindow.style.width = '100vw';
        uiWindow.style.height = '100vh';
        uiWindow.style.zIndex = '9998';
        uiWindow.style.transform = 'none';

        // Remove from the scaled 'ui-windows' layer and append directly to document.body
        // This fully bypasses the emulator scaling that shrinks it
        if (uiWindow.parentElement && uiWindow.parentElement.id === 'ui-windows') {
             document.body.appendChild(uiWindow);
        }
    }

    viewport = container.querySelector('#canvas-viewport');
    content = container.querySelector('#canvas-content');
    nodesLayer = container.querySelector('#canvas-nodes');
    edgesLayer = container.querySelector('#canvas-edges');
    drawingLayer = container.querySelector('#canvas-drawing-layer');
    drawingEdge = container.querySelector('#canvas-drawing-edge');
    zoomLabel = container.querySelector('#canvas-zoom-level');
    selectionBox = container.querySelector('#canvas-selection-box');
    saveIndicator = container.querySelector('#canvas-saving-indicator');
    nodeToolbar = container.querySelector('#canvas-node-toolbar');
    guidesLayer = container.querySelector('#canvas-guides-layer');

    // Minimap elements
    minimapEl = container.querySelector('#canvas-minimap');
    minimapCanvas = container.querySelector('#canvas-minimap-canvas');
    minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;
    minimapViewportEl = container.querySelector('#canvas-minimap-viewport');

    // Initialize translate so (0,0) starts at center of viewport
    // This replaces the CSS left:50%;top:50% approach for consistent coordinate mapping
    translateX = viewport.clientWidth / 2;
    translateY = viewport.clientHeight / 2;

    isOwner = githubAuth.isOwner;
    if (isOwner) {
        document.body.classList.add('is-owner');
    } else {
        document.body.classList.remove('is-owner');
    }

    setupNodeToolbar();

    // Toggle owner UI
    if (isOwner) {
        setupOwnerTools();
    }

    // Setup Chat
    setupChat();

    // Setup new features
    setupMinimap();
    setupSearch();
    setupChatToggle();

    // Setup viewport interactions
    setupViewport();
    setupThemeToggle();
    setupZoomControls();

    // Load data
    await loadCanvasData();

    // Check URL hash for direct links
    checkHashForDirectLink();

    // Listen for hash changes
    window.addEventListener('hashchange', checkHashForDirectLink);

    // Setup auto-save
    if (isOwner) {
        autoSaveInterval = setInterval(() => {
            if (hasUnsavedChanges) saveCanvasData(true);
        }, 60000); // 1 minute

        // Prevent tab close if unsaved
        window.addEventListener('beforeunload', (e) => {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = '';
            }
        });

        // Global Paste Listener
        container.addEventListener('paste', handleGlobalPaste);
    }

    const closeBtnTop = container.querySelector('#canvas-close-top-right');
    if (closeBtnTop) {
        closeBtnTop.addEventListener('click', () => {
            import('../js/core/window-manager.js').then(m => {
                m.windowManager.close('canvas');
            }).catch(() => {
                if (window.location.hash.startsWith('#canvas')) {
                    window.location.hash = '';
                }
            });
        });
    }
}

async function loadCanvasData() {
    showOverlay('Loading Canvas...');
    try {
        const file = await githubApi.getFile(CANVAS_FILE);
        if (file) {
            canvasData = JSON.parse(file.content);
            canvasSha = file.sha;
            if (!canvasData.nodes) canvasData.nodes = [];
            if (!canvasData.edges) canvasData.edges = [];
        }
    } catch (err) {
        console.error("No existing canvas found or error loading", err);
        // Start fresh
        canvasData = { nodes: [], edges: [] };
    }
    renderCanvas();
    hideOverlay();
}

async function saveCanvasData(isAuto = false) {
    if (!isOwner || isSaving) return;

    isSaving = true;
    saveIndicator.hidden = false;
    saveIndicator.textContent = isAuto ? 'Auto-saving...' : 'Saving...';

    try {
        const content = JSON.stringify(canvasData, null, 2);
        const result = await githubApi.saveFile(
            CANVAS_FILE,
            content,
            `Update concept.canvas (via UI Emulator)`
        );
        canvasSha = result.content.sha;
        hasUnsavedChanges = false;
        saveIndicator.textContent = 'Saved';
        setTimeout(() => saveIndicator.hidden = true, 2000);
    } catch (err) {
        console.error("Save failed", err);
        saveIndicator.textContent = 'Save Failed!';
        setTimeout(() => saveIndicator.hidden = true, 3000);
    } finally {
        isSaving = false;
    }
}

function markUnsaved() {
    hasUnsavedChanges = true;
    saveIndicator.hidden = false;
    saveIndicator.textContent = 'Unsaved changes';
}

// -----------------------------------------------------------------
// VIEWPORT & RENDER LOGIC
// -----------------------------------------------------------------

function setupViewport() {
    viewport.addEventListener('mousedown', (e) => {
        cancelAnimation();
        // Obsidian style panning: Middle click OR (Spacebar + Left click) OR (Right click on background)
        if (e.button === 1 || (e.button === 0 && window.isSpacePressed) || e.button === 2) {
            isDraggingViewport = true;
            startDragX = e.clientX - translateX;
            startDragY = e.clientY - translateY;
            viewport.style.cursor = 'grabbing';
            if (e.button === 1) e.preventDefault(); // prevent auto-scroll ring
        }

        // Allow marquee/tool on empty canvas area (not just viewport element itself)
        const clickedOnNode = e.target.closest('.canvas-node');
        if (e.button === 0 && !clickedOnNode && !window.isSpacePressed) {
            if (!e.shiftKey) clearSelection();

            // Text tool - click to create node
            if (currentTool === 'text' && isOwner) {
                const rect = viewport.getBoundingClientRect();
                const x = (e.clientX - rect.left - translateX) / scale;
                const y = (e.clientY - rect.top - translateY) / scale;
                createNode('text', x, y, 200, 100, "New node");
                setTool('select');
            } else if (currentTool === 'select' && !e.shiftKey) {
                isMarqueeSelect = true;
                const rect = viewport.getBoundingClientRect();
                marqueeStartX = e.clientX - rect.left;
                marqueeStartY = e.clientY - rect.top;

                selectionBox.style.left = marqueeStartX + 'px';
                selectionBox.style.top = marqueeStartY + 'px';
                selectionBox.style.width = '0px';
                selectionBox.style.height = '0px';
                selectionBox.hidden = false;
            }
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (isDraggingViewport) {
            translateX = e.clientX - startDragX;
            translateY = e.clientY - startDragY;
            updateTransform();
        }

        if (isDrawingEdge) {
            const rect = viewport.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left - translateX) / scale;
            const mouseY = (e.clientY - rect.top - translateY) / scale;
            updateDrawingEdge(mouseX, mouseY);
        }

        if (isMarqueeSelect) {
            const rect = viewport.getBoundingClientRect();
            const currentX = e.clientX - rect.left;
            const currentY = e.clientY - rect.top;

            const left = Math.min(marqueeStartX, currentX);
            const top = Math.min(marqueeStartY, currentY);
            const width = Math.abs(currentX - marqueeStartX);
            const height = Math.abs(currentY - marqueeStartY);

            selectionBox.style.left = left + 'px';
            selectionBox.style.top = top + 'px';
            selectionBox.style.width = width + 'px';
            selectionBox.style.height = height + 'px';
        }
    });

    window.addEventListener('mouseup', (e) => {
        isDraggingViewport = false;
        if (currentTool === 'select') viewport.style.cursor = 'grab';

        if (isDrawingEdge) {
            // Drop edge nowhere (or onto empty space)
            // Show context menu here so they can create a node!
            const targetNode = e.target.closest('.canvas-node');
            if (!targetNode && isOwner) {
                const rect = viewport.getBoundingClientRect();
                ctxMenu.style.left = e.clientX + 'px';
                ctxMenu.style.top = e.clientY + 'px';
                ctxMenu.hidden = false;

                ctxMenuX = (e.clientX - rect.left - translateX) / scale;
                ctxMenuY = (e.clientY - rect.top - translateY) / scale;

                // Save context so we can auto-connect after creation
                window._pendingEdgeConnect = {
                    fromNode: drawEdgeStartNode,
                    fromSide: drawEdgeStartSide
                };
            }
            isDrawingEdge = false;
            drawingEdge.setAttribute('d', '');
        }

        if (isMarqueeSelect) {
            isMarqueeSelect = false;

            // Capture selection box dimensions BEFORE hiding it
            const selLeft = parseFloat(selectionBox.style.left);
            const selTop = parseFloat(selectionBox.style.top);
            const selRight = selLeft + parseFloat(selectionBox.style.width);
            const selBottom = selTop + parseFloat(selectionBox.style.height);

            selectionBox.hidden = true;

            // Only process if the selection box has meaningful size
            if (selRight - selLeft < 5 && selBottom - selTop < 5) return;

            // Calculate intersect
            const rect = viewport.getBoundingClientRect();

            canvasData.nodes.forEach(n => {
                const nx1 = translateX + (n.x * scale);
                const ny1 = translateY + (n.y * scale);
                const nx2 = nx1 + (n.width * scale);
                const ny2 = ny1 + (n.height * scale);

                // AABB intersection
                if (nx1 < selRight && nx2 > selLeft && ny1 < selBottom && ny2 > selTop) {
                    multiSelectedNodes.add(n.id);
                }
            });

            if (multiSelectedNodes.size > 0) {
                renderCanvas(); // Render to show selection states
            }
        }
    });

    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
            return;
        }

        if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
            window.isSpacePressed = true;
            if (currentTool === 'select') {
                viewport.style.cursor = 'grab';
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            window.isSpacePressed = false;
            if (currentTool === 'select' && !isDraggingViewport) {
                viewport.style.cursor = 'default';
            }
        }
    });

    // Double click on viewport to create default node
    viewport.addEventListener('dblclick', (e) => {
        if (e.target === viewport || e.target.closest('.canvas-content') === content && !e.target.closest('.canvas-node')) {
            if (!isOwner) return;
            const rect = viewport.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left - translateX) / scale;
            const mouseY = (e.clientY - rect.top - translateY) / scale;

            pushHistory();
            const id = 'n_' + Date.now();
            canvasData.nodes.push({ id, type: 'text', x: mouseX, y: mouseY, width: 250, height: 150, text: '' });
            saveCanvasData(true);
            renderCanvas();
        }
    });

    // Right click context menu on background
    let lastRightClickedNode = null;
    const ctxMenu = container.querySelector('#canvas-context-menu');
    let ctxMenuX = 0, ctxMenuY = 0;

    viewport.addEventListener('contextmenu', (e) => {
        const nodeEl = e.target.closest('.canvas-node');
        const linkBtn = container.querySelector('#cm-make-link');

        if (nodeEl) {
            e.preventDefault();
            const nodeId = nodeEl.dataset.id || nodeEl.id.replace('node-', '');
            lastRightClickedNode = canvasData.nodes.find(n => n.id === nodeId);

            if (linkBtn) linkBtn.style.display = 'block';

            // When right-clicking a node, HIDE add-node items — only show format/link
            const addText = container.querySelector('#cm-add-text');
            const addImg = container.querySelector('#cm-add-img');
            const addGroup = container.querySelector('#cm-add-group');
            if (addText) addText.style.display = 'none';
            if (addImg) addImg.style.display = 'none';
            if (addGroup) addGroup.style.display = 'none';

            ctxMenu.style.left = e.clientX + 'px';
            ctxMenu.style.top = e.clientY + 'px';
            ctxMenu.hidden = false;

            // If it's a text node, also show format menu
            if (isOwner && lastRightClickedNode && lastRightClickedNode.type === 'text') {
                const formatMenu = container.querySelector('#node-format-menu');
                const palette = container.querySelector('#node-color-palette');
                selectNode(lastRightClickedNode);
                if (palette) palette.hidden = true;
                if (formatMenu) formatMenu.hidden = false;
            }

        } else if (!e.target.closest('.canvas-node')) {
            e.preventDefault();
            if (!isOwner) return; // Only owners can interact with background right-click
            lastRightClickedNode = null;
            if (linkBtn) linkBtn.style.display = 'none';

            const addText = container.querySelector('#cm-add-text');
            const addImg = container.querySelector('#cm-add-img');
            const addGroup = container.querySelector('#cm-add-group');
            if (addText) addText.style.display = 'block';
            if (addImg) addImg.style.display = 'block';
            if (addGroup) addGroup.style.display = 'block';

            const rect = viewport.getBoundingClientRect();
            ctxMenu.style.left = e.clientX + 'px';
            ctxMenu.style.top = e.clientY + 'px';
            ctxMenu.hidden = false;

            // Calc logic canvas coords
            ctxMenuX = (e.clientX - rect.left - translateX) / scale;
            ctxMenuY = (e.clientY - rect.top - translateY) / scale;
        }
    });

    document.addEventListener('click', (e) => {
        if (ctxMenu && !ctxMenu.hidden && !ctxMenu.contains(e.target)) {
            ctxMenu.hidden = true;
        }
        // Also close format menu and palette when clicking outside them
        const formatMenu = container.querySelector('#node-format-menu');
        const palette = container.querySelector('#node-color-palette');
        if (formatMenu && !formatMenu.hidden && !formatMenu.contains(e.target) && !e.target.closest('#nt-edit')) {
            formatMenu.hidden = true;
        }
        if (palette && !palette.hidden && !palette.contains(e.target) && !e.target.closest('#nt-color')) {
            palette.hidden = true;
        }
    });

    // Close all menus on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            ctxMenu.hidden = true;
            const formatMenu = container.querySelector('#node-format-menu');
            const palette = container.querySelector('#node-color-palette');
            if (formatMenu) formatMenu.hidden = true;
            if (palette) palette.hidden = true;
            closeSearch();
        }
    });

    container.querySelector('#cm-add-text')?.addEventListener('click', () => {
        pushHistory();
        const id = 'n_' + Date.now();
        canvasData.nodes.push({ id, type: 'text', x: ctxMenuX, y: ctxMenuY, width: 250, height: 150, text: '' });

        if (window._pendingEdgeConnect) {
             createEdge(window._pendingEdgeConnect.fromNode, window._pendingEdgeConnect.fromSide, id, 'left');
             window._pendingEdgeConnect = null;
        }
        saveCanvasData(true);
        renderCanvas();
    });

    container.querySelector('#cm-add-img')?.addEventListener('click', () => {
        pushHistory();
        const id = 'n_' + Date.now();
        canvasData.nodes.push({ id, type: 'file', file: '', x: ctxMenuX, y: ctxMenuY, width: 250, height: 250 });

        if (window._pendingEdgeConnect) {
             createEdge(window._pendingEdgeConnect.fromNode, window._pendingEdgeConnect.fromSide, id, 'left');
             window._pendingEdgeConnect = null;
        }
        saveCanvasData(true);
        renderCanvas();
    });

    container.querySelector('#cm-make-link')?.addEventListener('click', () => {
        if (!lastRightClickedNode) return;
        generateAndInsertNodeLink(lastRightClickedNode);
    });

    container.querySelector('#cm-add-group')?.addEventListener('click', () => {
        pushHistory();
        const id = 'n_' + Date.now();

        let minX = ctxMenuX, minY = ctxMenuY, maxX = ctxMenuX + 400, maxY = ctxMenuY + 300;

        // If there are multiSelectedNodes, snap group box around them!
        if (multiSelectedNodes && multiSelectedNodes.size > 0) {
            let first = true;
            canvasData.nodes.forEach(n => {
                if (multiSelectedNodes.has(n.id)) {
                    if (first) {
                        minX = n.x; minY = n.y; maxX = n.x + n.width; maxY = n.y + n.height;
                        first = false;
                    } else {
                        minX = Math.min(minX, n.x);
                        minY = Math.min(minY, n.y);
                        maxX = Math.max(maxX, n.x + n.width);
                        maxY = Math.max(maxY, n.y + n.height);
                    }
                }
            });
            // Give some padding
            minX -= 40; minY -= 60; maxX += 40; maxY += 40;
        }

        canvasData.nodes.push({ id, type: 'group', label: 'New Group', x: minX, y: minY, width: maxX - minX, height: maxY - minY });
        if (window._pendingEdgeConnect) {
             createEdge(window._pendingEdgeConnect.fromNode, window._pendingEdgeConnect.fromSide, id, 'left');
             window._pendingEdgeConnect = null;
        }
        saveCanvasData(true);
        renderCanvas();
    });


    viewport.addEventListener('wheel', (e) => {
        cancelAnimation();
        if (e.ctrlKey || e.metaKey) {
            // Zoom
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const newScale = Math.min(Math.max(0.1, scale * delta), 5);

            // Zoom towards mouse
            const rect = viewport.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            translateX = mx - (mx - translateX) * (newScale / scale);
            translateY = my - (my - translateY) * (newScale / scale);
            scale = newScale;

            updateTransform();
        } else {
            // Pan
            translateX -= e.deltaX;
            translateY -= e.deltaY;
            updateTransform();
        }
    }, { passive: false });
}

function updateTransform() {
    content.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;

    // Keep node toolbar positioned correctly during pan/zoom
    if (selectedNode) {
        const el = nodesLayer.querySelector(`[data-id="${selectedNode.id}"]`);
        if (el) showNodeToolbar(selectedNode, el);
    }

    renderMinimap();
}

function renderCanvas() {
    // Clean up old window-level event listeners to prevent memory leaks
    nodeCleanupFns.forEach(fn => fn());
    nodeCleanupFns = [];

    nodesLayer.innerHTML = '';

    // Preserve SVG defs (arrowhead markers) - clear only paths
    const defs = edgesLayer.querySelector('defs');
    edgesLayer.innerHTML = '';
    if (defs) edgesLayer.appendChild(defs);

    // Render edges
    canvasData.edges.forEach(edge => {
        renderEdge(edge);
    });

    // Render nodes
    canvasData.nodes.forEach(node => {
        renderNode(node);
    });

    // Re-apply search highlights after DOM rebuild
    reapplySearchHighlights();

    renderMinimap();
}

// Re-apply search match CSS classes after renderCanvas rebuilds DOM
function reapplySearchHighlights() {
    if (searchResults.length === 0) return;
    searchResults.forEach(n => {
        const el = nodesLayer.querySelector(`[data-id="${n.id}"]`);
        if (el) el.classList.add('search-match');
    });
    if (searchIndex >= 0 && searchIndex < searchResults.length) {
        const currentNode = searchResults[searchIndex];
        const el = nodesLayer.querySelector(`[data-id="${currentNode.id}"]`);
        if (el) el.classList.add('search-current');
    }
}

// -----------------------------------------------------------------
// NODES
// -----------------------------------------------------------------

function renderNode(node) {
    const el = document.createElement('div');
    el.className = 'canvas-node';
    el.dataset.id = node.id;
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.style.width = `${node.width}px`;
    el.style.height = `${node.height}px`;

    if (node.color) {
        if (['1','2','3','4','5','6'].includes(node.color)) {
            el.classList.add(`color-${node.color}`);
        } else {
            el.style.borderColor = node.color;
        }
    }

    let contentHtml = '';
    if (node.type === 'group') {
        el.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
        el.style.border = '2px dashed var(--canvas-node-border)';
        el.style.zIndex = '0';
        contentHtml = `<div class="node-title" style="font-weight:bold; font-size:18px; padding:8px; opacity:0.8;">${node.label || 'Group'}</div>`;
    } else if (node.type === 'text') {
        let renderedHtml = node.text || '';
        try {
            if (typeof marked !== 'undefined') {
                renderedHtml = marked.parse(renderedHtml);
            } else {
                renderedHtml = renderedHtml.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
            }
        } catch(e) {
            renderedHtml = renderedHtml.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        }
        contentHtml = `<div class="node-content-text" data-id="${node.id}">${renderedHtml}</div>`;
    } else if (node.type === 'file') {
        // Handle images
        const fileExt = node.file.split('.').pop().toLowerCase();
        if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(fileExt)) {
            let imgSrc;
            if (node._tempBase64) {
                imgSrc = node._tempBase64;
            } else {
                // Construct raw GitHub URL for reliable loading on GitHub Pages
                const [owner, repo] = config.github.repo.split('/');
                imgSrc = `https://raw.githubusercontent.com/${owner}/${repo}/main/${node.file}`;
            }

            contentHtml = `
                <div class="node-title">${node.file.split('/').pop()}</div>
                <div class="node-content-image">
                    <img src="${imgSrc}" alt="${node.file}" />
                </div>
            `;
        } else {
            contentHtml = `<div class="node-content-text"> ${node.file}</div>`;
        }
    }

    el.innerHTML = `
        ${contentHtml}
        <!-- Resize Handles -->
        <div class="node-resize-handle nrh-se" data-dir="se"></div>
        <div class="node-resize-handle nrh-sw" data-dir="sw"></div>
        <div class="node-resize-handle nrh-ne" data-dir="ne"></div>
        <div class="node-resize-handle nrh-nw" data-dir="nw"></div>
        <div class="node-resize-handle nrh-e" data-dir="e"></div>
        <div class="node-resize-handle nrh-s" data-dir="s"></div>
        <!-- Edge Handles -->
        <div class="node-edge-handle neh-t" data-side="top"></div>
        <div class="node-edge-handle neh-r" data-side="right"></div>
        <div class="node-edge-handle neh-b" data-side="bottom"></div>
        <div class="node-edge-handle neh-l" data-side="left"></div>
    `;

    nodesLayer.appendChild(el);

    if (node.id === selectedNode?.id) {
        el.classList.add('selected');
    }

    // Multi-select persistence
    if (multiSelectedNodes.has(node.id)) {
        el.classList.add('selected');
    }

    // Make links in node content clickable
    const textEl = el.querySelector('.node-content-text');
    if (textEl) {
        textEl.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (!link) return;
            e.preventDefault();
            e.stopPropagation();
            const href = link.getAttribute('href');
            if (href && href.startsWith('#canvas:')) {
                window.location.hash = href.substring(1);
            } else if (href) {
                window.open(href, '_blank', 'noopener');
            }
        });
    }

    // Node interactions
    setupNodeInteractions(el, node);

    // Auto-resize text nodes on initial render if content overflows
    // Double-rAF ensures the browser has completed layout before measuring
    if (node.type === 'text' && node.text) {
        requestAnimationFrame(() => requestAnimationFrame(() => autoResizeNode(node, el)));
    }
}

function setupNodeInteractions(el, node) {
    let startX, startY, origLeft, origTop;
    let isDragging = false;
    let isResizing = false;
    let resizeDir = null;
    let origWidth, origHeight;

    el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation(); // prevent viewport drag

        // Push history if starting to drag or resize
        if (e.target.classList.contains('node-resize-handle') || !e.target.classList.contains('node-edge-handle')) {
            if (isOwner) pushHistory();
        }

        // Handle edge creation handles
        if (e.target.classList.contains('node-edge-handle')) {
            if (!isOwner) return;
            isDrawingEdge = true;
            drawEdgeStartNode = node.id;
            drawEdgeStartSide = e.target.dataset.side;
            e.preventDefault();
            return;
        }

        // Handle resize handles
        if (e.target.classList.contains('node-resize-handle')) {
            if (!isOwner) return;
            isResizing = true;
            resizeDir = e.target.dataset.dir;
            startX = e.clientX;
            startY = e.clientY;
            origLeft = node.x;
            origTop = node.y;
            origWidth = node.width;
            origHeight = node.height;
            return;
        }

        // If an active textarea exists in this node, don't interfere with text selection
        if (el.querySelector('.node-content-textarea')) {
            return; // Let textarea handle its own mouse events for text selection
        }

        // Shift+Click multi-select
        if (e.shiftKey && isOwner) {
            if (multiSelectedNodes.has(node.id)) {
                multiSelectedNodes.delete(node.id);
                el.classList.remove('selected');
            } else {
                multiSelectedNodes.add(node.id);
                el.classList.add('selected');
                // Also add the currently selected single node if any
                if (selectedNode && !multiSelectedNodes.has(selectedNode.id)) {
                    multiSelectedNodes.add(selectedNode.id);
                }
                multiSelectedNodes.add(node.id);
            }
            selectedNode = node;
            showNodeToolbar(node, el);
            updateDeleteBtn();
            return; // Don't start drag on shift-click
        }

        // Select node
        selectNode(node);

        // Drag node (but NOT if currently editing this node)
        if (isOwner && currentTool === 'select' && editingNodeId !== node.id) {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            origLeft = node.x;
            origTop = node.y;
        }
    });

    // Handle dropping an edge onto this node
    el.addEventListener('mouseup', (e) => {
        if (isDrawingEdge && drawEdgeStartNode !== node.id) {
            let dropSide = 'left';
            if (e.target.classList.contains('node-edge-handle')) {
                dropSide = e.target.dataset.side;
            } else {
                // Determine closest side
                const rect = el.getBoundingClientRect();
                const dx = e.clientX - rect.left;
                const dy = e.clientY - rect.top;
                const w = rect.width, h = rect.height;
                const dists = {
                    left: dx,
                    right: w - dx,
                    top: dy,
                    bottom: h - dy
                };
                dropSide = Object.keys(dists).reduce((a, b) => dists[a] < dists[b] ? a : b);
            }

            createEdge(drawEdgeStartNode, drawEdgeStartSide, node.id, dropSide);
            isDrawingEdge = false;
            drawingEdge.setAttribute('d', '');
        }
    });

    // Text editing
    if (node.type === 'file' && isOwner) {
        el.addEventListener('dblclick', (e) => {
            if (currentTool !== 'select') return;
            e.stopPropagation();
            // Open the file dialog for this node
            const input = container.querySelector('#canvas-upload-image');
            // We need to pass the target node so the upload logic knows who to replace!
            window._targetImageNode = node.id;
            input.click();
        });
    }

    if (node.type === 'text' && isOwner) {
        const textContent = el.querySelector('.node-content-text');

        // Handle checkbox toggling
        textContent.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox') {
                const isChecked = e.target.checked;
                // We need to figure out WHICH checkbox this is. The easiest way is to count them
                // and replace the nth match of [ ] or [x] in the raw markdown text.
                const checkboxes = Array.from(textContent.querySelectorAll('input[type="checkbox"]'));
                const index = checkboxes.indexOf(e.target);

                if (index > -1) {
                    let matchCount = 0;
                    node.text = node.text.replace(/\[([ xX])\]/g, (match, p1) => {
                        if (matchCount === index) {
                            matchCount++;
                            return isChecked ? '[x]' : '[ ]';
                        }
                        matchCount++;
                        return match;
                    });
                    pushHistory();
                    saveCanvasData(true);
                    markUnsaved();

                    // re-render the node text
                    try {
                        if (typeof marked !== 'undefined') {
                            textContent.innerHTML = marked.parse(node.text);
                        } else {
                            textContent.innerHTML = node.text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
                        }
                    } catch(err) {
                        textContent.innerHTML = node.text;
                    }
                }
            }
        });

        el.addEventListener('dblclick', (e) => {
            if (currentTool !== 'select') return;
            e.stopPropagation();

            // Don't re-enter edit mode if already editing
            if (editingNodeId === node.id) return;

            // Swap HTML to Raw Textarea for Markdown editing
            const textarea = document.createElement('textarea');
            textarea.className = 'node-content-textarea';
            textarea.value = node.text || '';

            editingNodeId = node.id;
            textContent.style.display = 'none';
            el.insertBefore(textarea, textContent);

            textarea.focus();

            // Prevent node drag when interacting with textarea
            textarea.addEventListener('mousedown', (me) => {
                me.stopPropagation();
            });

            textarea.addEventListener('blur', () => {
                const newText = textarea.value;
                textarea.remove();
                editingNodeId = null;

                if (newText !== node.text) {
                    node.text = newText;
                    markUnsaved();
                    // Re-render just this node's content
                    try {
                        if (typeof marked !== 'undefined') {
                            textContent.innerHTML = marked.parse(node.text);
                        } else {
                            textContent.innerHTML = node.text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
                        }
                    } catch(err) {
                        textContent.innerHTML = node.text;
                    }
                }
                textContent.style.display = '';

                // Auto-resize to fit content
                autoResizeNode(node, el);
            });

            textarea.addEventListener('keydown', (ke) => {
                // Ignore emulator hotkeys when editing
                ke.stopPropagation();
            });
            textarea.addEventListener('keyup', (ke) => {
                ke.stopPropagation();
            });
        });
    }

    // Global drag handlers attached to window to capture fast movement
    const onMouseMove = (e) => {
        if (isDragging) {
            const dx = (e.clientX - startX) / scale;
            const dy = (e.clientY - startY) / scale;

            // Multi-select drag: move all selected nodes together
            if (multiSelectedNodes.size > 0 && multiSelectedNodes.has(node.id)) {
                // We need start positions for all nodes - store them on first move
                if (!el._multiDragOrigins) {
                    el._multiDragOrigins = new Map();
                    multiSelectedNodes.forEach(id => {
                        const n = canvasData.nodes.find(nd => nd.id === id);
                        if (n) el._multiDragOrigins.set(id, { x: n.x, y: n.y });
                    });
                }
                multiSelectedNodes.forEach(id => {
                    const n = canvasData.nodes.find(nd => nd.id === id);
                    const orig = el._multiDragOrigins.get(id);
                    if (n && orig) {
                        n.x = Math.round(orig.x + dx);
                        n.y = Math.round(orig.y + dy);
                        const nel = nodesLayer.querySelector(`[data-id="${id}"]`);
                        if (nel) {
                            nel.style.left = `${n.x}px`;
                            nel.style.top = `${n.y}px`;
                        }
                        updateEdgesForNode(id);
                    }
                });
            } else {
                node.x = Math.round(origLeft + dx);
                node.y = Math.round(origTop + dy);

                // Snap guides for single-node drag
                const snap = getSnapGuides(node);
                if (snap.snapX !== null) node.x = snap.snapX;
                if (snap.snapY !== null) node.y = snap.snapY;
                renderGuides(snap.guides);

                el.style.left = `${node.x}px`;
                el.style.top = `${node.y}px`;
                updateEdgesForNode(node.id);
            }

            if (selectedNode === node) showNodeToolbar(node, el);
            markUnsaved();
        } else if (isResizing) {
            const dx = (e.clientX - startX) / scale;
            const dy = (e.clientY - startY) / scale;

            if (resizeDir.includes('e')) node.width = Math.max(150, Math.round(origWidth + dx));
            if (resizeDir.includes('s')) node.height = Math.max(80, Math.round(origHeight + dy));
            if (resizeDir.includes('w')) {
                const nw = Math.max(150, Math.round(origWidth - dx));
                node.x = origLeft + (origWidth - nw);
                node.width = nw;
            }
            if (resizeDir.includes('n')) {
                const nh = Math.max(80, Math.round(origHeight - dy));
                node.y = origTop + (origHeight - nh);
                node.height = nh;
            }

            el.style.left = `${node.x}px`;
            el.style.top = `${node.y}px`;
            el.style.width = `${node.width}px`;
            el.style.height = `${node.height}px`;

            if (selectedNode === node) showNodeToolbar(node, el);

            updateEdgesForNode(node.id);
            markUnsaved();
        }
    };

    const onMouseUp = () => {
        if (isDragging) {
            el._multiDragOrigins = null;
            clearGuides();
        }
        isDragging = false;
        isResizing = false;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    // Register cleanup so these get removed on next renderCanvas()
    nodeCleanupFns.push(() => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    });
}

function createNode(type, x, y, width, height, textOrFile) {
    const id = generateId();
    const node = { id, type, x: Math.round(x), y: Math.round(y), width, height };

    if (type === 'text') node.text = textOrFile;
    if (type === 'file') node.file = textOrFile;

    canvasData.nodes.push(node);
    renderNode(node);
    selectNode(node);
    markUnsaved();
    return node;
}

// -----------------------------------------------------------------
// EDGES
// -----------------------------------------------------------------

function renderEdge(edge) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'canvas-edge');
    path.dataset.id = edge.id;

    if (edge.color) path.style.stroke = edge.color;
    path.setAttribute('marker-end', 'url(#arrowhead)');

    path.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        selectEdge(edge);
    });

    edgesLayer.appendChild(path);
    updateEdgePath(edge, path);

    if (edge.id === selectedEdge?.id) {
        path.classList.add('selected');
        path.setAttribute('marker-end', 'url(#arrowhead-selected)');
    }
}

function updateEdgePath(edge, pathEl) {
    if (!pathEl) {
        pathEl = edgesLayer.querySelector(`path[data-id="${edge.id}"]`);
        if (!pathEl) return;
    }

    const fromNode = canvasData.nodes.find(n => n.id === edge.fromNode);
    const toNode = canvasData.nodes.find(n => n.id === edge.toNode);
    if (!fromNode || !toNode) return;

    const p1 = getPortPoint(fromNode, edge.fromSide);
    const p2 = getPortPoint(toNode, edge.toSide);

    // Draw simple cubic bezier based on direction
    const d = getBezierPath(p1, p2, edge.fromSide, edge.toSide);
    pathEl.setAttribute('d', d);
    pathEl.setAttribute('marker-end', 'url(#arrowhead)');
}

function updateEdgesForNode(nodeId) {
    canvasData.edges.forEach(edge => {
        if (edge.fromNode === nodeId || edge.toNode === nodeId) {
            updateEdgePath(edge);
        }
    });
}

function updateDrawingEdge(mouseX, mouseY) {
    const fromNode = canvasData.nodes.find(n => n.id === drawEdgeStartNode);
    if (!fromNode) return;

    const p1 = getPortPoint(fromNode, drawEdgeStartSide);
    const p2 = { x: mouseX, y: mouseY };

    const d = getBezierPath(p1, p2, drawEdgeStartSide, 'left'); // fake dest side for curve
    drawingEdge.setAttribute('d', d);
}

function createEdge(fromNodeId, fromSide, toNodeId, toSide) {
    // Avoid duplicates
    if (canvasData.edges.some(e => e.fromNode === fromNodeId && e.toNode === toNodeId)) return;

    pushHistory();

    const edge = {
        id: generateId(),
        fromNode: fromNodeId,
        fromSide: fromSide,
        toNode: toNodeId,
        toSide: toSide
    };

    canvasData.edges.push(edge);
    renderEdge(edge);
    markUnsaved();
}

function getPortPoint(node, side) {
    if (!node) return { x: 0, y: 0 };
    switch (side) {
        case 'top':    return { x: node.x + node.width / 2, y: node.y };
        case 'bottom': return { x: node.x + node.width / 2, y: node.y + node.height };
        case 'left':   return { x: node.x,                  y: node.y + node.height / 2 };
        case 'right':  return { x: node.x + node.width,      y: node.y + node.height / 2 };
        default:       return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
    }
}

function getBezierPath(p1, p2, side1, side2) {
    const dx = Math.abs(p2.x - p1.x);
    const dy = Math.abs(p2.y - p1.y);
    const weight = Math.max(dx, dy) * 0.5;

    let cp1 = { ...p1 }, cp2 = { ...p2 };

    if (side1 === 'right') cp1.x += weight;
    if (side1 === 'left') cp1.x -= weight;
    if (side1 === 'bottom') cp1.y += weight;
    if (side1 === 'top') cp1.y -= weight;

    if (side2 === 'right') cp2.x += weight;
    if (side2 === 'left') cp2.x -= weight;
    if (side2 === 'bottom') cp2.y += weight;
    if (side2 === 'top') cp2.y -= weight;

    return `M ${p1.x} ${p1.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${p2.x} ${p2.y}`;
}

// -----------------------------------------------------------------
// SELECTION & TOOLS
// -----------------------------------------------------------------

function selectNode(node) {
    clearSelection();
    selectedNode = node;
    const el = nodesLayer.querySelector(`[data-id="${node.id}"]`);
    if (el) {
        el.classList.add('selected');
        showNodeToolbar(node, el);
    }
    updateDeleteBtn();
}

function selectEdge(edge) {
    clearSelection();
    selectedEdge = edge;
    const el = edgesLayer.querySelector(`[data-id="${edge.id}"]`);
    if (el) el.classList.add('selected');
    updateDeleteBtn();
}

function clearSelection() {
    if (selectedNode) {
        const el = nodesLayer.querySelector(`[data-id="${selectedNode.id}"]`);
        if (el) el.classList.remove('selected');
        selectedNode = null;
    }
    if (selectedEdge) {
        const el = edgesLayer.querySelector(`[data-id="${selectedEdge.id}"]`);
        if (el) el.classList.remove('selected');
        selectedEdge = null;
    }
    multiSelectedNodes.forEach(id => {
        const el = nodesLayer.querySelector(`[data-id="${id}"]`);
        if (el) el.classList.remove('selected');
    });
    multiSelectedNodes.clear();
    hideNodeToolbar();
    updateDeleteBtn();

    const formatMenu = container.querySelector('#node-format-menu');
    const palette = container.querySelector('#node-color-palette');
    if (formatMenu) formatMenu.hidden = true;
    if (palette) palette.hidden = true;
}

function showNodeToolbar(node, el) {
    if (!isOwner) return;

    // Calculate position relative to content layer
    const x = node.x + (node.width / 2);
    const y = node.y;

    const rect = viewport.getBoundingClientRect();

    // Calculate the top-center position of the node in viewport coordinates
    const vX = translateX + (node.x * scale) + (node.width * scale) / 2;
    const vY = translateY + (node.y * scale);

    // Shift up to sit above the node
    nodeToolbar.style.left = `${vX}px`;
    nodeToolbar.style.top = `${vY - 45}px`;
    nodeToolbar.style.transform = 'translateX(-50%)';
    nodeToolbar.hidden = false;
}

function hideNodeToolbar() {
    if (nodeToolbar) {
        nodeToolbar.hidden = true;
        nodeToolbar.querySelector('#node-color-palette').hidden = true;
    }
}

function setupNodeToolbar() {
    if (!nodeToolbar) return;

    nodeToolbar.querySelector('#nt-delete').addEventListener('click', deleteSelected);

    const palette = nodeToolbar.querySelector('#node-color-palette');
    nodeToolbar.querySelector('#nt-color').addEventListener('click', () => {
        palette.hidden = !palette.hidden;
    });

    nodeToolbar.querySelector('#nt-zoom').addEventListener('click', () => {
        if (!selectedNode) return;

        const padding = 100;
        const rect = viewport.getBoundingClientRect();

        const scaleX = rect.width / (selectedNode.width + padding * 2);
        const scaleY = rect.height / (selectedNode.height + padding * 2);
        const targetScale = Math.min(1, Math.min(scaleX, scaleY));

        const targetTX = -(selectedNode.x + selectedNode.width/2) * targetScale + (rect.width / 2);
        const targetTY = -(selectedNode.y + selectedNode.height/2) * targetScale + (rect.height / 2);

        animateTo(targetScale, targetTX, targetTY);
    });

    nodeToolbar.querySelector('#nt-edit').addEventListener('click', () => {
        if (selectedNode && selectedNode.type === 'text') {
            const el = nodesLayer.querySelector(`[data-id="${selectedNode.id}"]`);
            const textContent = el.querySelector('.node-content-text');
            if (textContent) {
                // Simulate a double click to trigger the existing edit logic
                textContent.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            }
        }
    });

    // Link button — generate a canvas link for this node and copy to chat input
    nodeToolbar.querySelector('#nt-link')?.addEventListener('click', () => {
        if (!selectedNode) return;
        generateAndInsertNodeLink(selectedNode);
    });

    // Setup color swatches
    nodeToolbar.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', (e) => {
            if (!selectedNode) return;
            const colorCode = e.target.dataset.color;

            const el = nodesLayer.querySelector(`[data-id="${selectedNode.id}"]`);

            // Clear existing color classes
            el.className = el.className.replace(/\bcolor-\S+/g, '');

            if (colorCode === 'default') {
                selectedNode.color = null;
                el.style.borderColor = '';
            } else {
                selectedNode.color = colorCode; // JSON canvas standard says color can be 1-6
                el.classList.add(`color-${colorCode}`);
                el.style.borderColor = ''; // Let css handle it
            }

            palette.hidden = true;
            markUnsaved();
        });
    });

    const formatMenu = nodeToolbar.querySelector('#node-format-menu');

    // Add right click context menu to nodes

    // Close menus when clicking elsewhere
    viewport.addEventListener('mousedown', (e) => {
        if (e.button === 0 && formatMenu && !e.target.closest('.node-format-menu') && !e.target.closest('.node-color-palette')) {
            formatMenu.hidden = true;
            palette.hidden = true;
        }
    });

    // Handle format actions
    if (formatMenu) {
        formatMenu.querySelectorAll('.format-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!selectedNode || selectedNode.type !== 'text') return;

                const fmt = e.target.dataset.format;
                let prefix = '';
                let suffix = '';

                switch (fmt) {
                    case 'h1': prefix = '# '; break;
                    case 'h2': prefix = '## '; break;
                    case 'h3': prefix = '### '; break;
                    case 'bold': prefix = '**'; suffix = '**'; break;
                    case 'italic': prefix = '*'; suffix = '*'; break;
                    case 'quote': prefix = '> '; break;
                    case 'code': prefix = '`'; suffix = '`'; break;
                    case 'ul': prefix = '- '; break;
                    case 'ol': prefix = '1. '; break;
                    case 'task': prefix = '- [ ] '; break;
                    case 'link': prefix = '['; suffix = '](url)'; break;
                }

                // If currently editing, we can't easily inject without a ref to the textarea/contenteditable.
                // If we aren't editing, we just prepend/wrap the whole text
                const el = nodesLayer.querySelector(`[data-id="${selectedNode.id}"]`);
                const textContent = el.querySelector('.node-content-text');

                const textarea = el.querySelector('.node-content-textarea');

                if (textarea) {
                    // Insert into active textarea
                    const start = textarea.selectionStart;
                    const end = textarea.selectionEnd;
                    const text = textarea.value;
                    const selected = text.substring(start, end) || 'text';
                    textarea.value = text.substring(0, start) + prefix + selected + suffix + text.substring(end);
                    textarea.focus();
                    textarea.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
                } else {
                    const selection = window.getSelection();
                    const selectedText = selection.toString() || 'text';

                    if (selection.rangeCount > 0 && selectedText !== 'text' && textContent.contains(selection.anchorNode)) {
                         // A simplistic way to wrap selection, but usually text formatting
                         // requires editing mode (textarea). We will switch to textarea mode first.
                         textContent.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                         setTimeout(() => {
                             const newTextarea = el.querySelector('.node-content-textarea');
                             if (newTextarea) {
                                 // Simple append since selection boundaries in HTML->Markdown are complex
                                 newTextarea.value = newTextarea.value + `\n${prefix}${selectedText}${suffix}`;
                                 newTextarea.focus();
                             }
                         }, 50);
                    } else {
                        // Append to raw text and re-render
                        selectedNode.text = `${selectedNode.text || ''}\n${prefix}text${suffix}`;
                        renderCanvas();
                        selectNode(selectedNode);
                    }
                }

                if (formatMenu) formatMenu.hidden = true;
                markUnsaved();
            });
        });
    }
}

function setupOwnerTools() {
    const tools = container.querySelectorAll('.canvas-tool-btn[data-tool]');
    tools.forEach(btn => {
        btn.addEventListener('click', () => {
            setTool(btn.dataset.tool);
        });
    });

    const delBtn = container.querySelector('#canvas-delete-selected');
    delBtn.addEventListener('click', deleteSelected);

    const saveBtn = container.querySelector('#canvas-save-btn');
    saveBtn.addEventListener('click', () => saveCanvasData(false));

    // Keyboard shortcuts
    container.addEventListener('keydown', (e) => {
        // Ignore if typing in text box (except Ctrl shortcuts)
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
            // Allow Ctrl+F even in inputs
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                openSearch();
            }
            return;
        }

        if (e.key === 'Delete' || e.key === 'Backspace') {
            deleteSelected();
        } else if (e.key === 'v' || e.key === 'V') {
            setTool('select');
        } else if (e.key === 't' || e.key === 'T') {
            setTool('text');
        } else if (e.key === 'e' || e.key === 'E') {
            setTool('edge');
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            saveCanvasData(false);
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
            e.preventDefault();
            duplicateSelected();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
            e.preventDefault();
            openSearch();
        } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            if (selectedNode || multiSelectedNodes.size > 0) {
                e.preventDefault();
                const step = e.shiftKey ? 10 : 1;
                let dx = 0, dy = 0;
                if (e.key === 'ArrowUp') dy = -step;
                if (e.key === 'ArrowDown') dy = step;
                if (e.key === 'ArrowLeft') dx = -step;
                if (e.key === 'ArrowRight') dx = step;
                nudgeSelected(dx, dy);
            }
        }
    });

    // Image Upload Logic
    const uploadInput = container.querySelector('#canvas-upload-image');
    uploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        let filename = file.name;

        // Simple collision check logic
        while (canvasData.nodes.some(n => n.type === 'file' && n.file === `canvas_uploads/${filename}`)) {
            const promptName = prompt(`File canvas_uploads/${filename} exists. Please enter a new name:`, filename);
            if (!promptName) return; // User cancelled
            filename = promptName;
        }

        await uploadAndAddImage(file, filename);

        // reset input
        uploadInput.value = '';
    });
}

async function handleGlobalPaste(e) {
    if (!isOwner) return;

    // Ignore if pasting into a text field (chat)
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
    }

    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let index in items) {
        const item = items[index];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
            const blob = item.getAsFile();
            const ext = blob.type.split('/')[1] || 'png';
            const filename = `pasted_image_${Date.now()}.${ext}`;
            await uploadAndAddImage(blob, filename);
            break; // only handle first image
        }
    }
}

async function uploadAndAddImage(file, filename) {
    // Convert to base64
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async () => {
            const base64Data = reader.result.split(',')[1];
            showOverlay('Uploading image...');
            try {
                const repoPath = `canvas_uploads/${filename}`;
                await githubApi.saveFile(repoPath, base64Data, `Upload ${filename} to canvas`, true);

                let node;
                if (window._targetImageNode) {
                    node = canvasData.nodes.find(n => n.id === window._targetImageNode);
                    if (node) {
                        pushHistory();
                        node.file = repoPath;
                        node._tempBase64 = reader.result; // Set BEFORE render for immediate preview
                        markUnsaved();
                        renderCanvas();
                    }
                    window._targetImageNode = null;
                } else {
                    // Add to canvas at center of viewport
                    const rect = viewport.getBoundingClientRect();
                    const x = (rect.width / 2 - translateX) / scale;
                    const y = (rect.height / 2 - translateY) / scale;
                    node = createNode('file', x - 150, y - 100, 300, 200, repoPath);
                    if (node) {
                        node._tempBase64 = reader.result;
                        // Re-render this node with base64 preview
                        const el = container.querySelector(`.canvas-node[data-id="${node.id}"]`);
                        if (el) {
                            const imgEl = el.querySelector('.node-content-image img');
                            if (imgEl) {
                                imgEl.src = reader.result;
                            }
                        }
                    }
                }

                window.uiToast('Image uploaded and added', 'success');
            } catch (err) {
                console.error("Upload failed", err);
                window.uiToast('Failed to upload image to repo', 'error');
            } finally {
                hideOverlay();
                resolve();
            }
        };
        reader.readAsDataURL(file);
    });
}

function setTool(toolName) {
    if (!isOwner) return;
    currentTool = toolName;

    container.querySelectorAll('.canvas-tool-btn[data-tool]').forEach(btn => {
        if (btn.dataset.tool === toolName) {
            btn.setAttribute('aria-pressed', 'true');
        } else {
            btn.setAttribute('aria-pressed', 'false');
        }
    });

    viewport.className = 'canvas-viewport ' + `tool-${toolName}`;
}

function deleteSelected() {
    if (!isOwner) return;
    pushHistory();

    if (selectedNode) {
        hideNodeToolbar();
        // Delete associated edges first
        canvasData.edges = canvasData.edges.filter(e => e.fromNode !== selectedNode.id && e.toNode !== selectedNode.id);

        // Check if it's an image, if so delete from repo
        if (selectedNode.type === 'file' && selectedNode.file.startsWith('canvas_uploads/')) {
            if (confirm(`Delete the image file ${selectedNode.file} from the repository as well?`)) {
                githubApi.deleteFile(selectedNode.file, `Delete unused canvas image ${selectedNode.file}`).catch(e => console.error(e));
            }
        }

        // Delete node
        canvasData.nodes = canvasData.nodes.filter(n => n.id !== selectedNode.id);
        markUnsaved();
        clearSelection();
        renderCanvas();
    } else if (selectedEdge) {
        canvasData.edges = canvasData.edges.filter(e => e.id !== selectedEdge.id);
        markUnsaved();
        clearSelection();
        renderCanvas();
    }
}

function updateDeleteBtn() {
    const btn = container.querySelector('#canvas-delete-selected');
    if (btn) btn.disabled = (!selectedNode && !selectedEdge);
}

// -----------------------------------------------------------------
// MISC & HELPERS
// -----------------------------------------------------------------

function setupThemeToggle() {
    const btn = container.querySelector('#canvas-theme-toggle');
    const win = container.querySelector('.canvas-window');
    btn.addEventListener('click', () => {
        theme = theme === 'dark' ? 'light' : 'dark';
        if (theme === 'light') win.classList.add('light-theme');
        else win.classList.remove('light-theme');
    });

    const closeBtn = container.querySelector('#canvas-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            import('../js/core/window-manager.js').then(m => {
                m.windowManager.close('canvas');
            });
        });
    }
}

function setupZoomControls() {
    container.querySelector('#canvas-zoom-in').addEventListener('click', () => {
        scale = Math.min(5, scale * 1.2);
        updateTransform();
    });
    container.querySelector('#canvas-zoom-out').addEventListener('click', () => {
        scale = Math.max(0.1, scale / 1.2);
        updateTransform();
    });
    container.querySelector('#canvas-fit').addEventListener('click', () => {
        if (canvasData.nodes.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        canvasData.nodes.forEach(n => {
            if (n.x < minX) minX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.x + n.width > maxX) maxX = n.x + n.width;
            if (n.y + n.height > maxY) maxY = n.y + n.height;
        });

        const padding = 100;
        const width = maxX - minX + padding * 2;
        const height = maxY - minY + padding * 2;

        const rect = viewport.getBoundingClientRect();
        const scaleX = rect.width / width;
        const scaleY = rect.height / height;

        const targetScale = Math.min(1, Math.min(scaleX, scaleY));
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const targetTX = rect.width / 2 - centerX * targetScale;
        const targetTY = rect.height / 2 - centerY * targetScale;

        animateTo(targetScale, targetTX, targetTY);
    });
}

function generateId() {
    return Math.random().toString(36).substring(2, 18);
}

function showOverlay(text) {
    const ov = container.querySelector('#canvas-overlay');
    container.querySelector('#canvas-overlay-text').textContent = text;
    ov.classList.remove('hidden');
}

function hideOverlay() {
    const ov = container.querySelector('#canvas-overlay');
    ov.classList.add('hidden');
}

// -----------------------------------------------------------------
// HELPERS FOR NODE LINKS
// -----------------------------------------------------------------

function getNodeLinkName(node) {
    let rootName = '';
    try {
        const root = findRootOfBranch(node.id);
        rootName = root.type === 'text' ? root.text.split('\n')[0].trim() : '';
    } catch (e) { /* no root */ }

    let nodeName = '';
    if (node.type === 'file') {
        const filename = node.file.split('/').pop();
        nodeName = rootName ? `${rootName}_${filename}`.toLowerCase() : filename.toLowerCase();
    } else if (node.type === 'text') {
        const firstWord = node.text.trim().split(/\s+/)[0] || 'node';
        nodeName = rootName ? `${rootName}_${firstWord}`.toLowerCase() : firstWord.toLowerCase();
    } else {
        nodeName = node.id;
    }
    return nodeName.replace(/[^a-z0-9_.-]/g, '');
}

function generateAndInsertNodeLink(node) {
    const nodeName = getNodeLinkName(node);
    const chatInput = document.getElementById('chat-input') || document.getElementById('canvas-discussion-input');
    if (chatInput) {
        const linkText = `[Link to Node](#canvas:${nodeName})`;
        chatInput.value = chatInput.value + (chatInput.value ? ' ' : '') + linkText;
        chatInput.focus();
        window.uiToast('Link inserted into chat', 'success');
    } else {
        // Fallback: copy to clipboard
        navigator.clipboard.writeText(`#canvas:${nodeName}`).then(() => {
            window.uiToast('Canvas link copied to clipboard', 'success');
        });
    }
}

// -----------------------------------------------------------------
// DIRECT LINKS
// -----------------------------------------------------------------

function checkHashForDirectLink() {
    // Format: #canvas:NodeName_firstWord or #canvas:NodeName_image.jpg
    const hash = window.location.hash;
    if (hash.startsWith('#canvas:')) {
        const targetDesc = decodeURIComponent(hash.substring(8)).toLowerCase();

        let targetNode = null;
        for (const node of canvasData.nodes) {
            const nodeName = getNodeLinkName(node);
            if (nodeName === targetDesc || nodeName.includes(targetDesc) || targetDesc.includes(nodeName)) {
                targetNode = node;
                break;
            }
        }

        if (targetNode) {
            // Pan and zoom smoothly to target
            const targetScale = 1.0;
            const rect = viewport.getBoundingClientRect();
            const targetTX = -(targetNode.x + targetNode.width/2) * targetScale + (rect.width / 2);
            const targetTY = -(targetNode.y + targetNode.height/2) * targetScale + (rect.height / 2);
            animateTo(targetScale, targetTX, targetTY);
            selectNode(targetNode);
        } else {
            console.warn("Target canvas node not found for hash:", targetDesc);
        }
    }
}

function findRootOfBranch(nodeId) {
    let currentId = nodeId;
    let iterations = 0;
    while (iterations < 100) { // prevent infinite loop
        const incomingEdge = canvasData.edges.find(e => e.toNode === currentId);
        if (!incomingEdge) break;
        currentId = incomingEdge.fromNode;
        iterations++;
    }
    return canvasData.nodes.find(n => n.id === currentId);
}

// -----------------------------------------------------------------
// CHAT INTEGRATION
// -----------------------------------------------------------------

function setupChat() {
    // We reuse the logic from discussion-manager.js but scoped to our sidebar
    const sidebar = container.querySelector('.canvas-chat-sidebar');

    // Instead of completely reinventing chat here, since discussion-manager
    // is a singleton tied to #ui-discussion-panel, we will create a lightweight
    // mirror implementation using the same GraphQL logic for our embedded chat.

    // Quick and dirty copy of init logic, but pointing to local DOM elements.
    const messagesEl = container.querySelector('#canvas-discussion-messages');
    const inputEl = container.querySelector('#canvas-discussion-input');
    const sendBtn = container.querySelector('#canvas-discussion-send');

    // Let's hook up discussionManager APIs if they were public,
    // but they are mostly private. We'll dispatch a custom event or wait for
    // a small refactor in another file to share the class.
    // For now, inform user chat is loading (simulated or real implementation required).

    // Dynamic import the discussion manager to see if we can instantiate another
    import('../js/core/image-upload.js').then(mod => {
        mod.setupImagePaste(inputEl);
    });

    fetchDiscussion(messagesEl);

    sendBtn.addEventListener('click', async () => {
         const text = inputEl.value.trim();
         if (!text) return;
         if (!githubAuth.isLoggedIn) {
             window.uiToast('Sign in to chat', 'info');
             return;
         }
         sendBtn.disabled = true;
         await sendComment(text);
         inputEl.value = '';
         sendBtn.disabled = false;
         fetchDiscussion(messagesEl);
    });
}

// Minimal GraphQL implementation for canvas chat
async function fetchDiscussion(messagesEl) {
    if (!messagesEl) return;

    messagesEl.innerHTML = '<div class="canvas-discussion-loading">Loading chat...</div>';

    try {
        if (!githubAuth.token) {
            messagesEl.innerHTML = '<div class="canvas-discussion-loading">Sign in to view and participate in the discussion.<br><small style="color:#aaa;">GitHub Discussions require authentication to view.</small></div>';
            return;
        }

        const [owner, name] = config.github.repo.split('/');
        const query = `
          query($owner: String!, $name: String!, $number: Int!) {
            repository(owner: $owner, name: $name) {
              discussion(number: $number) {
                id
                comments(last: 50) {
                  nodes {
                    id
                    body
                    createdAt
                    author {
                      login
                      avatarUrl
                    }
                  }
                }
              }
            }
          }
        `;

        const h = {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        };
        if (githubAuth.token) {
          h.Authorization = `bearer ${githubAuth.token}`;
        }

        const resp = await fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ query, variables: { owner, name, number: config.github.discussionNumber } })
        });

        if (!resp.ok) throw new Error("Fetch failed");

        const json = await resp.json();
        const discussion = json.data?.repository?.discussion;

        if (!discussion) throw new Error("Discussion not found");

        // Save ID for posting
        window.canvasDiscussionId = discussion.id;

        const comments = discussion.comments.nodes || [];

        messagesEl.innerHTML = '';
        if (comments.length === 0) {
            messagesEl.innerHTML = '<div class="canvas-discussion-loading">No messages yet.</div>';
            return;
        }

        for (const msg of comments) {
            const el = document.createElement('div');
            el.style.fontSize = '13px';
            el.style.padding = '8px';
            el.style.borderBottom = '1px solid var(--canvas-node-border)';

            // Escape HTML then linkify URLs and #canvas: links
            let bodyHtml = msg.body
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;')
                .replace(/\n/g, '<br>');
            // Linkify URLs
            bodyHtml = bodyHtml.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--canvas-accent)">$1</a>');
            // Linkify #canvas: links
            bodyHtml = bodyHtml.replace(/(#canvas:[a-zA-Z0-9_.\-]+)/g, '<a href="$1" class="canvas-link">$1</a>');

            el.innerHTML = `
                <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                    <img src="${msg.author.avatarUrl}" width="16" height="16" style="border-radius:50%">
                    <strong>${msg.author.login}</strong>
                </div>
                <div style="color:var(--canvas-text);word-break:break-word">${bodyHtml}</div>
            `;
            messagesEl.appendChild(el);
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;

    } catch (e) {
        messagesEl.innerHTML = '<div class="canvas-discussion-loading">Failed to load chat.</div>';
    }
}

async function sendComment(body) {
    if (!window.canvasDiscussionId) return;

    const query = `
      mutation($discussionId: ID!, $body: String!) {
        addDiscussionComment(input: {discussionId: $discussionId, body: $body}) {
          comment { id }
        }
      }
    `;

    const h = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `bearer ${githubAuth.token}`
    };

    await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ query, variables: { discussionId: window.canvasDiscussionId, body } })
    });
}

// Group Node Creation
function createGroupNode(x, y) {
    return {
        id: 'n_' + Date.now() + Math.floor(Math.random() * 1000),
        type: 'group',
        x: x,
        y: y,
        width: 300,
        height: 200,
        label: 'New Group'
    };
}

// -----------------------------------------------------------------
// MINIMAP
// -----------------------------------------------------------------

function setupMinimap() {
    if (!minimapEl || !minimapCanvas) return;

    let isDraggingMinimap = false;

    function minimapToCanvas(e) {
        if (!minimapBounds) return;
        const mr = minimapCanvas.getBoundingClientRect();
        const mx = e.clientX - mr.left;
        const my = e.clientY - mr.top;

        const { minX, minY, maxX, maxY, mScale, pad } = minimapBounds;
        // Convert minimap pixel to canvas coord
        const canvasX = (mx / (mr.width)) * ((maxX - minX) + pad * 2) + (minX - pad);
        const canvasY = (my / (mr.height)) * ((maxY - minY) + pad * 2) + (minY - pad);

        // Pan so this canvas coord is at center of viewport
        const rect = viewport.getBoundingClientRect();
        translateX = -(canvasX) * scale + (rect.width / 2);
        translateY = -(canvasY) * scale + (rect.height / 2);
        updateTransform();
    }

    minimapEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        isDraggingMinimap = true;
        minimapToCanvas(e);
    });

    window.addEventListener('mousemove', (e) => {
        if (isDraggingMinimap) {
            minimapToCanvas(e);
        }
    });

    window.addEventListener('mouseup', () => {
        isDraggingMinimap = false;
    });
}

function renderMinimap() {
    if (!minimapCtx || !minimapCanvas) return;
    const ctx = minimapCtx;
    const w = minimapCanvas.width;
    const h = minimapCanvas.height;
    ctx.clearRect(0, 0, w, h);

    if (canvasData.nodes.length === 0) {
        minimapBounds = null;
        minimapViewportEl.style.display = 'none';
        return;
    }

    // Get bounding box of all nodes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    canvasData.nodes.forEach(n => {
        if (n.x < minX) minX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.x + n.width > maxX) maxX = n.x + n.width;
        if (n.y + n.height > maxY) maxY = n.y + n.height;
    });

    const pad = 80;
    const totalW = (maxX - minX) + pad * 2;
    const totalH = (maxY - minY) + pad * 2;
    const mScale = Math.min(w / totalW, h / totalH);

    minimapBounds = { minX, minY, maxX, maxY, mScale, pad };

    const offsetX = (w - totalW * mScale) / 2;
    const offsetY = (h - totalH * mScale) / 2;

    // Draw nodes
    const colorMap = { '1': '#ff5252', '2': '#ff9800', '3': '#ffd600', '4': '#4caf50', '5': '#00bcd4', '6': '#ba68c8' };

    canvasData.nodes.forEach(n => {
        const rx = offsetX + (n.x - minX + pad) * mScale;
        const ry = offsetY + (n.y - minY + pad) * mScale;
        const rw = Math.max(2, n.width * mScale);
        const rh = Math.max(2, n.height * mScale);

        if (n.type === 'group') {
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.strokeRect(rx, ry, rw, rh);
            ctx.setLineDash([]);
        } else {
            ctx.fillStyle = n.color && colorMap[n.color] ? colorMap[n.color] : '#555';
            ctx.fillRect(rx, ry, rw, rh);
        }
    });

    // Draw edges as thin lines
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 0.5;
    canvasData.edges.forEach(edge => {
        const from = canvasData.nodes.find(n => n.id === edge.fromNode);
        const to = canvasData.nodes.find(n => n.id === edge.toNode);
        if (!from || !to) return;
        const fx = offsetX + (from.x + from.width / 2 - minX + pad) * mScale;
        const fy = offsetY + (from.y + from.height / 2 - minY + pad) * mScale;
        const tx = offsetX + (to.x + to.width / 2 - minX + pad) * mScale;
        const ty = offsetY + (to.y + to.height / 2 - minY + pad) * mScale;
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
    });

    // Draw viewport rectangle
    const vRect = viewport.getBoundingClientRect();
    // Visible canvas bounds: top-left and bottom-right in canvas coords
    const visLeft = -translateX / scale;
    const visTop = -translateY / scale;
    const visRight = visLeft + vRect.width / scale;
    const visBottom = visTop + vRect.height / scale;

    const vx = offsetX + (visLeft - minX + pad) * mScale;
    const vy = offsetY + (visTop - minY + pad) * mScale;
    const vw = (visRight - visLeft) * mScale;
    const vh = (visBottom - visTop) * mScale;

    minimapViewportEl.style.display = '';
    minimapViewportEl.style.left = Math.max(0, vx) + 'px';
    minimapViewportEl.style.top = Math.max(0, vy) + 'px';
    minimapViewportEl.style.width = Math.min(w - Math.max(0, vx), Math.max(4, vw)) + 'px';
    minimapViewportEl.style.height = Math.min(h - Math.max(0, vy), Math.max(4, vh)) + 'px';
}

// -----------------------------------------------------------------
// SEARCH
// -----------------------------------------------------------------

function setupSearch() {
    const bar = container.querySelector('#canvas-search-bar');
    const input = container.querySelector('#canvas-search-input');
    const countEl = container.querySelector('#canvas-search-count');
    const prevBtn = container.querySelector('#canvas-search-prev');
    const nextBtn = container.querySelector('#canvas-search-next');
    const closeBtn = container.querySelector('#canvas-search-close');

    if (!bar || !input) return;

    input.addEventListener('input', () => {
        performSearch(input.value);
        updateSearchUI();
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) navigateSearch(-1);
            else navigateSearch(1);
        }
        if (e.key === 'Escape') {
            closeSearch();
        }
        e.stopPropagation();
    });

    prevBtn.addEventListener('click', () => navigateSearch(-1));
    nextBtn.addEventListener('click', () => navigateSearch(1));
    closeBtn.addEventListener('click', closeSearch);

    function updateSearchUI() {
        if (searchResults.length === 0) {
            countEl.textContent = input.value ? 'No results' : '';
        } else {
            countEl.textContent = `${searchIndex + 1} of ${searchResults.length}`;
        }
    }

    function performSearch(query) {
        // Clear old highlights
        nodesLayer.querySelectorAll('.search-match, .search-current').forEach(el => {
            el.classList.remove('search-match', 'search-current');
        });

        if (!query.trim()) {
            searchResults = [];
            searchIndex = -1;
            return;
        }

        const q = query.toLowerCase();
        searchResults = canvasData.nodes.filter(n => {
            if (n.type === 'text' && n.text && n.text.toLowerCase().includes(q)) return true;
            if (n.type === 'file' && n.file && n.file.toLowerCase().includes(q)) return true;
            if (n.type === 'group' && n.label && n.label.toLowerCase().includes(q)) return true;
            return false;
        });

        searchIndex = searchResults.length > 0 ? 0 : -1;

        // Highlight all matches
        searchResults.forEach(n => {
            const el = nodesLayer.querySelector(`[data-id="${n.id}"]`);
            if (el) el.classList.add('search-match');
        });

        // Highlight current
        if (searchIndex >= 0) {
            const currentNode = searchResults[searchIndex];
            const el = nodesLayer.querySelector(`[data-id="${currentNode.id}"]`);
            if (el) el.classList.add('search-current');
            zoomToSearchResult(currentNode);
        }
    }

    function navigateSearch(dir) {
        if (searchResults.length === 0) return;

        // Remove current highlight
        if (searchIndex >= 0) {
            const prevNode = searchResults[searchIndex];
            const el = nodesLayer.querySelector(`[data-id="${prevNode.id}"]`);
            if (el) el.classList.remove('search-current');
        }

        searchIndex = (searchIndex + dir + searchResults.length) % searchResults.length;

        const currentNode = searchResults[searchIndex];
        const el = nodesLayer.querySelector(`[data-id="${currentNode.id}"]`);
        if (el) el.classList.add('search-current');
        zoomToSearchResult(currentNode);
        updateSearchUI();
    }

    function zoomToSearchResult(node) {
        const rect = viewport.getBoundingClientRect();
        const targetScale = Math.min(1, Math.max(scale, 0.6));
        const targetTX = -(node.x + node.width / 2) * targetScale + (rect.width / 2);
        const targetTY = -(node.y + node.height / 2) * targetScale + (rect.height / 2);
        animateTo(targetScale, targetTX, targetTY, 200);
    }
}

function openSearch() {
    const bar = container.querySelector('#canvas-search-bar');
    const input = container.querySelector('#canvas-search-input');
    if (!bar) return;
    bar.hidden = false;
    input.value = '';
    input.focus();
    searchResults = [];
    searchIndex = -1;
    container.querySelector('#canvas-search-count').textContent = '';
}

function closeSearch() {
    const bar = container.querySelector('#canvas-search-bar');
    if (bar) bar.hidden = true;
    // Clear highlights
    nodesLayer.querySelectorAll('.search-match, .search-current').forEach(el => {
        el.classList.remove('search-match', 'search-current');
    });
    searchResults = [];
    searchIndex = -1;
}

// -----------------------------------------------------------------
// SNAP GUIDES
// -----------------------------------------------------------------

function getSnapGuides(dragNode) {
    const THRESH = 8;
    const guides = [];
    let snapX = null, snapY = null;

    const dl = dragNode.x;
    const dr = dragNode.x + dragNode.width;
    const dcx = dragNode.x + dragNode.width / 2;
    const dt = dragNode.y;
    const db = dragNode.y + dragNode.height;
    const dcy = dragNode.y + dragNode.height / 2;

    for (const other of canvasData.nodes) {
        if (other.id === dragNode.id) continue;
        if (multiSelectedNodes.has(other.id)) continue;

        const ol = other.x;
        const or_ = other.x + other.width;
        const ocx = other.x + other.width / 2;
        const ot = other.y;
        const ob = other.y + other.height;
        const ocy = other.y + other.height / 2;

        // Horizontal alignment checks (snap X)
        const xChecks = [
            { drag: dl, other: ol, snapVal: ol },                            // left ↔ left
            { drag: dl, other: or_, snapVal: or_ },                          // left ↔ right
            { drag: dr, other: ol, snapVal: ol - dragNode.width },           // right ↔ left
            { drag: dr, other: or_, snapVal: or_ - dragNode.width },         // right ↔ right
            { drag: dcx, other: ocx, snapVal: ocx - dragNode.width / 2 },   // center ↔ center
        ];

        for (const chk of xChecks) {
            if (Math.abs(chk.drag - chk.other) < THRESH) {
                if (snapX === null) snapX = chk.snapVal;
                // Vertical guide line at the align-x coordinate
                const lineX = chk.other;
                const lineTop = Math.min(dt, db, ot, ob) - 20;
                const lineBot = Math.max(dt, db, ot, ob) + 20;
                guides.push({ x1: lineX, y1: lineTop, x2: lineX, y2: lineBot });
            }
        }

        // Vertical alignment checks (snap Y)
        const yChecks = [
            { drag: dt, other: ot, snapVal: ot },                            // top ↔ top
            { drag: dt, other: ob, snapVal: ob },                            // top ↔ bottom
            { drag: db, other: ot, snapVal: ot - dragNode.height },          // bottom ↔ top
            { drag: db, other: ob, snapVal: ob - dragNode.height },          // bottom ↔ bottom
            { drag: dcy, other: ocy, snapVal: ocy - dragNode.height / 2 },  // center ↔ center
        ];

        for (const chk of yChecks) {
            if (Math.abs(chk.drag - chk.other) < THRESH) {
                if (snapY === null) snapY = chk.snapVal;
                const lineY = chk.other;
                const lineLeft = Math.min(dl, dr, ol, or_) - 20;
                const lineRight = Math.max(dl, dr, ol, or_) + 20;
                guides.push({ x1: lineLeft, y1: lineY, x2: lineRight, y2: lineY });
            }
        }
    }

    return { snapX, snapY, guides };
}

function renderGuides(guides) {
    if (!guidesLayer) return;
    guidesLayer.innerHTML = '';
    for (const g of guides) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', g.x1);
        line.setAttribute('y1', g.y1);
        line.setAttribute('x2', g.x2);
        line.setAttribute('y2', g.y2);
        line.setAttribute('class', 'canvas-guide-line');
        guidesLayer.appendChild(line);
    }
}

function clearGuides() {
    if (guidesLayer) guidesLayer.innerHTML = '';
}

// -----------------------------------------------------------------
// DUPLICATE
// -----------------------------------------------------------------

function duplicateSelected() {
    if (!isOwner) return;

    pushHistory();
    const idMap = new Map();
    const newNodes = [];

    const nodesToClone = multiSelectedNodes.size > 0
        ? canvasData.nodes.filter(n => multiSelectedNodes.has(n.id))
        : (selectedNode ? [selectedNode] : []);

    if (nodesToClone.length === 0) return;

    for (const n of nodesToClone) {
        const newId = generateId();
        idMap.set(n.id, newId);
        const clone = { ...n, id: newId, x: n.x + 30, y: n.y + 30 };
        // Deep copy mutable fields
        if (clone._tempBase64) delete clone._tempBase64;
        newNodes.push(clone);
        canvasData.nodes.push(clone);
    }

    // Duplicate edges between cloned nodes
    if (nodesToClone.length > 1) {
        canvasData.edges.forEach(edge => {
            if (idMap.has(edge.fromNode) && idMap.has(edge.toNode)) {
                canvasData.edges.push({
                    id: generateId(),
                    fromNode: idMap.get(edge.fromNode),
                    fromSide: edge.fromSide,
                    toNode: idMap.get(edge.toNode),
                    toSide: edge.toSide,
                });
            }
        });
    }

    // Select newly created nodes
    clearSelection();
    if (newNodes.length === 1) {
        selectNode(newNodes[0]);
    } else {
        multiSelectedNodes = new Set(newNodes.map(n => n.id));
        selectedNode = newNodes[0];
    }

    markUnsaved();
    renderCanvas();
}

// -----------------------------------------------------------------
// SMOOTH ANIMATION
// -----------------------------------------------------------------

function animateTo(targetScale, targetTX, targetTY, duration = 300) {
    cancelAnimation();

    const startScale = scale;
    const startTX = translateX;
    const startTY = translateY;
    const startTime = performance.now();

    function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const t = easeOutCubic(progress);

        scale = startScale + (targetScale - startScale) * t;
        translateX = startTX + (targetTX - startTX) * t;
        translateY = startTY + (targetTY - startTY) * t;
        updateTransform();

        if (progress < 1) {
            animationFrameId = requestAnimationFrame(step);
        } else {
            animationFrameId = null;
        }
    }

    animationFrameId = requestAnimationFrame(step);
}

function cancelAnimation() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

// -----------------------------------------------------------------
// COLLAPSIBLE CHAT SIDEBAR
// -----------------------------------------------------------------

function setupChatToggle() {
    const sidebar = container.querySelector('#canvas-chat-sidebar');
    const toggleBtn = container.querySelector('#canvas-chat-toggle');
    const reopenBtn = container.querySelector('#canvas-chat-reopen');

    if (!toggleBtn || !sidebar) return;

    const chevronLeft = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><polyline points="15 18 9 12 15 6"></polyline></svg>';
    const chevronRight = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><polyline points="9 6 15 12 9 18"></polyline></svg>';

    toggleBtn.addEventListener('click', () => {
        const isCollapsed = sidebar.classList.toggle('collapsed');
        toggleBtn.innerHTML = isCollapsed ? chevronRight : chevronLeft;
        if (reopenBtn) reopenBtn.hidden = !isCollapsed;
    });

    if (reopenBtn) {
        reopenBtn.addEventListener('click', () => {
            sidebar.classList.remove('collapsed');
            toggleBtn.innerHTML = chevronLeft;
            reopenBtn.hidden = true;
        });
    }
}

// -----------------------------------------------------------------
// ARROW KEY NUDGE
// -----------------------------------------------------------------

function nudgeSelected(dx, dy) {
    if (!isOwner) return;

    // Debounced history push — only push once per nudge burst
    if (!nudgeHistoryPushed) {
        pushHistory();
        nudgeHistoryPushed = true;
    }
    clearTimeout(nudgeTimeout);
    nudgeTimeout = setTimeout(() => { nudgeHistoryPushed = false; }, 500);

    const nodesToNudge = multiSelectedNodes.size > 0
        ? canvasData.nodes.filter(n => multiSelectedNodes.has(n.id))
        : (selectedNode ? [selectedNode] : []);

    for (const node of nodesToNudge) {
        node.x += dx;
        node.y += dy;
        const el = nodesLayer.querySelector(`[data-id="${node.id}"]`);
        if (el) {
            el.style.left = `${node.x}px`;
            el.style.top = `${node.y}px`;
        }
        updateEdgesForNode(node.id);
    }

    if (selectedNode) {
        const el = nodesLayer.querySelector(`[data-id="${selectedNode.id}"]`);
        if (el) showNodeToolbar(selectedNode, el);
    }

    markUnsaved();
    renderMinimap();
}

// -----------------------------------------------------------------
// AUTO-RESIZE TEXT NODES
// -----------------------------------------------------------------

function autoResizeNode(node, el) {
    if (node.type !== 'text') return;
    const textEl = el.querySelector('.node-content-text');
    if (!textEl) return;

    // Measure the content's natural height
    const scrollH = textEl.scrollHeight;
    const newHeight = Math.max(80, scrollH + 4); // 4px buffer

    if (newHeight !== node.height) {
        node.height = newHeight;
        el.style.height = `${newHeight}px`;
        updateEdgesForNode(node.id);
        if (selectedNode && selectedNode.id === node.id) {
            showNodeToolbar(node, el);
        }
        renderMinimap();
    }
}

// -----------------------------------------------------------------
// HISTORY (UNDO/REDO)
// -----------------------------------------------------------------
function pushHistory() {
    undoStack.push(JSON.stringify(canvasData));
    if (undoStack.length > 50) undoStack.shift();
    redoStack = []; // Clear redo on new action
}

function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(JSON.stringify(canvasData));
    canvasData = JSON.parse(undoStack.pop());
    clearSelection();
    saveCanvasData(true);
    renderCanvas();
}

function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(JSON.stringify(canvasData));
    canvasData = JSON.parse(redoStack.pop());
    clearSelection();
    saveCanvasData(true);
    renderCanvas();
}
