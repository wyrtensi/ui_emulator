import { githubAuth } from '../../js/core/github-auth.js';
import { githubApi } from '../../js/core/github-api.js';
import config from '../../js/config.js';

let canvasData = { nodes: [], edges: [] };
let scale = 1;
let translateX = 0;
let translateY = 0;
let isDraggingViewport = false;
let startDragX, startDragY;

let selectedNode = null;
let selectedEdge = null;
let isDraggingNode = false;

let currentTool = 'select';
let theme = 'dark';
let isOwner = false;
let canvasSha = null;

let isDrawingEdge = false;
let drawEdgeStartNode = null;
let drawEdgeStartSide = null;

const CANVAS_FILE = 'concept.canvas';
let hasUnsavedChanges = false;
let autoSaveInterval = null;

// DOM Elements
let container, viewport, content, nodesLayer, edgesLayer, drawingLayer, drawingEdge;
let zoomLabel, saveIndicator, nodeToolbar;

export async function initCanvas(winContainer, config) {
    container = winContainer;

    // Force fullscreen overlay by resetting the window wrapper
    const rfoWindow = container.closest('.rfo-window');
    if (rfoWindow) {
        // Appending to body strips it out of the scaled viewport and ensures it is truly fullscreen
        // Keep it in DOM so windowManager can track it, but position it absolute/fixed
        rfoWindow.style.position = 'fixed';
        rfoWindow.style.top = '0';
        rfoWindow.style.left = '0';
        rfoWindow.style.width = '100vw';
        rfoWindow.style.height = '100vh';
        rfoWindow.style.zIndex = '9998';
        rfoWindow.style.transform = 'none';

        // Remove from the scaled 'rfo-windows' layer and append directly to document.body
        // This fully bypasses the emulator scaling that shrinks it
        if (rfoWindow.parentElement && rfoWindow.parentElement.id === 'rfo-windows') {
             document.body.appendChild(rfoWindow);
        }
    }

    viewport = container.querySelector('#canvas-viewport');
    content = container.querySelector('#canvas-content');
    nodesLayer = container.querySelector('#canvas-nodes');
    edgesLayer = container.querySelector('#canvas-edges');
    drawingLayer = container.querySelector('#canvas-drawing-layer');
    drawingEdge = container.querySelector('#canvas-drawing-edge');
    zoomLabel = container.querySelector('#canvas-zoom-level');
    saveIndicator = container.querySelector('#canvas-saving-indicator');
    nodeToolbar = container.querySelector('#canvas-node-toolbar');

    isOwner = githubAuth.isOwner;
    setupNodeToolbar();

    // Toggle owner UI
    if (isOwner) {
        container.querySelector('#canvas-toolbar').hidden = false;
        setupOwnerTools();
    }

    // Setup Chat
    setupChat();

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
    if (!isOwner) return;

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
        // Only trigger viewport drag if middle click OR (left click on background in select mode)
        if (e.button === 1 || (e.button === 0 && e.target === viewport && currentTool === 'select')) {
            isDraggingViewport = true;
            startDragX = e.clientX - translateX;
            startDragY = e.clientY - translateY;
            viewport.style.cursor = 'grabbing';
        }

        if (e.button === 0 && e.target === viewport) {
            clearSelection();

            // Text tool - click to create node
            if (currentTool === 'text' && isOwner) {
                const rect = viewport.getBoundingClientRect();
                const x = (e.clientX - rect.left - translateX) / scale;
                const y = (e.clientY - rect.top - translateY) / scale;
                createNode('text', x, y, 200, 100, "New node");
                setTool('select');
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
    });

    window.addEventListener('mouseup', (e) => {
        isDraggingViewport = false;
        if (currentTool === 'select') viewport.style.cursor = 'grab';

        if (isDrawingEdge) {
            // Drop edge nowhere
            isDrawingEdge = false;
            drawingEdge.setAttribute('d', '');
        }
    });

    viewport.addEventListener('wheel', (e) => {
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
}

function renderCanvas() {
    nodesLayer.innerHTML = '';
    edgesLayer.innerHTML = '';

    // Render edges
    canvasData.edges.forEach(edge => {
        renderEdge(edge);
    });

    // Render nodes
    canvasData.nodes.forEach(node => {
        renderNode(node);
    });
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
    if (node.type === 'text') {
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
            // Reference repo root path
            let imgSrc = `./${node.file}`;
            // If we are on GitHub pages, we can just use the path relative to root
            contentHtml = `
                <div class="node-title">${node.file.split('/').pop()}</div>
                <div class="node-content-image">
                    <img src="${imgSrc}" alt="${node.file}" />
                </div>
            `;
        } else {
            contentHtml = `<div class="node-content-text">📄 ${node.file}</div>`;
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

    // Node interactions
    setupNodeInteractions(el, node);
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

        // Handle edge creation handles
        if (e.target.classList.contains('node-edge-handle')) {
            if (!isOwner || currentTool !== 'edge') return;
            isDrawingEdge = true;
            drawEdgeStartNode = node.id;
            drawEdgeStartSide = e.target.dataset.side;
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

        // Select node
        selectNode(node);

        // Drag node
        if (isOwner && currentTool === 'select' && !e.target.classList.contains('editing')) {
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
    if (node.type === 'text' && isOwner) {
        const textContent = el.querySelector('.node-content-text');
        el.addEventListener('dblclick', (e) => {
            if (currentTool !== 'select') return;
            e.stopPropagation();

            // Swap HTML to Raw Textarea for Markdown editing
            const textarea = document.createElement('textarea');
            textarea.className = 'node-content-textarea';
            textarea.style.width = '100%';
            textarea.style.height = '100%';
            textarea.style.resize = 'none';
            textarea.style.border = 'none';
            textarea.style.background = 'transparent';
            textarea.style.color = 'inherit';
            textarea.style.fontFamily = 'inherit';
            textarea.style.fontSize = 'inherit';
            textarea.style.outline = 'none';
            textarea.value = node.text || '';

            textContent.style.display = 'none';
            el.insertBefore(textarea, textContent);

            textarea.focus();

            textarea.addEventListener('blur', () => {
                const newText = textarea.value;
                textarea.remove();

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
            });

            textarea.addEventListener('keydown', (ke) => {
                // Ignore emulator hotkeys when editing
                ke.stopPropagation();
            });
        });
    }

    // Global drag handlers attached to window to capture fast movement
    const onMouseMove = (e) => {
        if (isDragging) {
            const dx = (e.clientX - startX) / scale;
            const dy = (e.clientY - startY) / scale;
            node.x = Math.round(origLeft + dx);
            node.y = Math.round(origTop + dy);

            el.style.left = `${node.x}px`;
            el.style.top = `${node.y}px`;

            if (selectedNode === node) showNodeToolbar(node, el);

            updateEdgesForNode(node.id);
            markUnsaved();
        } else if (isResizing) {
            const dx = (e.clientX - startX) / scale;
            const dy = (e.clientY - startY) / scale;

            if (resizeDir.includes('e')) node.width = Math.max(100, Math.round(origWidth + dx));
            if (resizeDir.includes('s')) node.height = Math.max(40, Math.round(origHeight + dy));
            if (resizeDir.includes('w')) {
                const nw = Math.max(100, Math.round(origWidth - dx));
                node.x = origLeft + (origWidth - nw);
                node.width = nw;
            }
            if (resizeDir.includes('n')) {
                const nh = Math.max(40, Math.round(origHeight - dy));
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
        isDragging = false;
        isResizing = false;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
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
    if (edge.toSide) path.setAttribute('marker-end', 'url(#arrowhead)');

    path.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        selectEdge(edge);
    });

    edgesLayer.appendChild(path);
    updateEdgePath(edge, path);

    if (edge.id === selectedEdge?.id) {
        path.classList.add('selected');
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
        case 'top': return { x: node.x + node.width / 2, y: node.y };
        case 'bottom': return { x: node.x + node.width / 2, y: node.y + node.height };
        case 'left': return { x: node.x, y: node.y + node.height / 2 };
        case 'right': return { x: node.x + node.width, y: node.y + node.height / 2 };
        default: return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
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
    hideNodeToolbar();
    updateDeleteBtn();
}

function showNodeToolbar(node, el) {
    if (!isOwner) return;

    // Position toolbar above the node
    const rect = el.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();

    // Calculate position relative to content layer
    const x = node.x + (node.width / 2);
    const y = node.y;

    nodeToolbar.style.left = `${x}px`;
    nodeToolbar.style.top = `${y}px`;
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
        scale = Math.min(1, Math.min(scaleX, scaleY));

        translateX = -(selectedNode.x + selectedNode.width/2) * scale + (rect.width / 2);
        translateY = -(selectedNode.y + selectedNode.height/2) * scale + (rect.height / 2);

        updateTransform();
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
    viewport.addEventListener('contextmenu', (e) => {
        const nodeEl = e.target.closest('.canvas-node');
        if (nodeEl && isOwner) {
            e.preventDefault();
            const id = nodeEl.dataset.id;
            const node = canvasData.nodes.find(n => n.id === id);
            if (node && node.type === 'text') {
                selectNode(node); // show toolbar
                palette.hidden = true;
                formatMenu.hidden = false;
            }
        } else {
            if (formatMenu) formatMenu.hidden = true;
            if (palette) palette.hidden = true;
        }
    });

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
                    // Append to raw text and re-render
                    selectedNode.text = `${selectedNode.text || ''}\n${prefix}text${suffix}`;
                    renderCanvas();
                    selectNode(selectedNode);
                }

                formatMenu.hidden = true;
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
        // Ignore if typing in text box
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
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

                // Add to canvas at center of viewport
                const rect = viewport.getBoundingClientRect();
                const x = (-translateX + rect.width / 2) / scale;
                const y = (-translateY + rect.height / 2) / scale;

                createNode('file', x - 150, y - 100, 300, 200, repoPath);
                window.rfoToast('Image uploaded and added', 'success');
            } catch (err) {
                console.error("Upload failed", err);
                window.rfoToast('Failed to upload image to repo', 'error');
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

    if (selectedNode) {
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

        scale = Math.min(1, Math.min(scaleX, scaleY));
        translateX = -(minX - padding) * scale;
        translateY = -(minY - padding) * scale;

        updateTransform();
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
// DIRECT LINKS
// -----------------------------------------------------------------

function checkHashForDirectLink() {
    // Format: #canvas:NodeName_firstWord or #canvas:NodeName_image.jpg
    const hash = window.location.hash;
    if (hash.startsWith('#canvas:')) {
        // Find matching node based on text/file rules requested by user
        const targetDesc = decodeURIComponent(hash.substring(8)).toLowerCase();

        // Logic to trace backward to root to construct full "path name" if needed,
        // but for zooming we just search all nodes to see if their derived name matches targetDesc

        let targetNode = null;
        for (const node of canvasData.nodes) {
            let nodeName = '';

            // Reconstruct path name (naive implementation matching user's request)
            const root = findRootOfBranch(node.id);
            const rootName = root.type === 'text' ? root.text.split('\n')[0].trim() : '';

            if (node.type === 'file') {
                const filename = node.file.split('/').pop();
                nodeName = `${rootName}_${filename}`.toLowerCase();
            } else if (node.type === 'text') {
                const firstWord = node.text.trim().split(/\s+/)[0] || '';
                nodeName = `${rootName}_${firstWord}`.toLowerCase();
            }

            if (nodeName === targetDesc || nodeName.includes(targetDesc)) {
                targetNode = node;
                break;
            }
        }

        if (targetNode) {
            // Pan and zoom slightly to target
            scale = 1.0;
            const rect = viewport.getBoundingClientRect();
            translateX = -(targetNode.x + targetNode.width/2) * scale + (rect.width / 2);
            translateY = -(targetNode.y + targetNode.height/2) * scale + (rect.height / 2);
            updateTransform();
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
    const toggleBtn = container.querySelector('#canvas-chat-toggle');
    const sidebar = container.querySelector('.canvas-chat-sidebar');

    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

    // Instead of completely reinventing chat here, since discussion-manager
    // is a singleton tied to #rfo-discussion-panel, we will create a lightweight
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
    import('../../js/core/image-upload.js').then(mod => {
        mod.setupImagePaste(inputEl);
    });

    fetchDiscussion(messagesEl);

    sendBtn.addEventListener('click', async () => {
         const text = inputEl.value.trim();
         if (!text) return;
         if (!githubAuth.isLoggedIn) {
             window.rfoToast('Sign in to chat', 'info');
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
            el.innerHTML = `
                <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                    <img src="${msg.author.avatarUrl}" width="16" height="16" style="border-radius:50%">
                    <strong>${msg.author.login}</strong>
                </div>
                <div style="color:var(--canvas-text);word-break:break-word">${msg.body.replace(/\n/g, '<br>')}</div>
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
