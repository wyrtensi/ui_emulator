import { githubAuth } from '../js/core/github-auth.js';
import { githubApi } from '../js/core/github-api.js';
import { CanvasLiveClient } from '../js/core/canvas-live.js';
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
let selectedInlineImage = null;
let editingNodeId = null; // Track which node is currently being edited
let preserveTextareaForFormat = false;

let currentTool = 'select';
let theme = 'dark';
let isOwner = false;
let canvasSha = null;

let undoStack = [];
let redoStack = [];

let isDrawingEdge = false;
let drawEdgeStartNode = null;
let drawEdgeStartSide = null;
let drawingArrow = null;
let isMiddleButtonDown = false;
let suppressCtxMenuCloseUntil = 0;
let canvasClipboard = null;
let clipboardPasteCount = 0;
let pendingClipboardNodePaste = false;
let undoRedoCaptureBound = false;
let liveClient = null;
let liveModeActive = false;
let liveSyncTimer = null;

const CANVAS_FILE = 'concept.canvas';
const CANVAS_VIEW_STATE_KEY = 'ui-canvas-view-v1';
const LIVE_SYNC_DEBOUNCE_MS = 250;
let hasUnsavedChanges = false;
let autoSaveInterval = null;
let isSaving = false;
let viewStateSaveTimer = null;
let pendingInitialViewportPolicy = false;
let pendingInlineImageMarkerId = null;
let pendingInlineImageNodeId = null;
let inlineRepoFilesAtEditStart = new Map();
let inlineRepoFilesHandledInEdit = new Map();
let inlineRepoFilesLastSeenInEdit = new Map();

const CANVAS_REACTION_TYPES = ['THUMBS_UP', 'HEART', 'LAUGH', 'HOORAY', 'CONFUSED', 'MINUS_ONE', 'ROCKET', 'EYES'];
const CANVAS_REACTION_EMOJIS = {
    THUMBS_UP: '👍',
    HEART: '❤️',
    LAUGH: '😄',
    HOORAY: '🎉',
    CONFUSED: '😕',
    MINUS_ONE: '👎',
    ROCKET: '🚀',
    EYES: '👀'
};
let canvasDiscussionMessages = [];

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
let zoomLabel, saveIndicator, nodeToolbar, liveStatusIndicator;

async function ensureMarkedLoaded() {
    if (typeof marked !== 'undefined' && typeof marked.parse === 'function') return;
    if (window.__uiMarkedLoadPromise) {
        await window.__uiMarkedLoadPromise;
        return;
    }

    window.__uiMarkedLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/marked@4.3.0/marked.min.js';
        script.async = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });

    try {
        await window.__uiMarkedLoadPromise;
    } catch (err) {
        console.warn('marked.js failed to load, using plain-text fallback');
    }
}

function renderMarkdown(text) {
    const raw = text || '';
    try {
        if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
            return marked.parse(raw);
        }
    } catch (err) {
        // Fall through to escaped text
    }

    return raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
}

function stripMarkdownFormatting(text) {
    return (text || '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^>\s?/gm, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/__(.*?)__/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/_(.*?)_/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^\s*[-*]\s+\[[ xX]\]\s+/gm, '')
        .replace(/^\s*[-*]\s+/gm, '')
        .replace(/^\s*\d+\.\s+/gm, '')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
}

function getRepoRawUrl(filePath) {
    if (!filePath) return '';
    const [owner, repo] = (config.github?.repo || '').split('/');
    const branch = config.github?.branch || 'main';
    if (!owner || !repo) return filePath;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
}

function escapeHtmlText(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getCurrentSelectionNodeIds() {
    if (multiSelectedNodes.size > 0) {
        return new Set(multiSelectedNodes);
    }
    return selectedNode ? new Set([selectedNode.id]) : new Set();
}

function getSelectedNonGroupNodeIds() {
    const ids = getCurrentSelectionNodeIds();
    return Array.from(ids).filter(id => {
        const node = canvasData.nodes.find(n => n.id === id);
        return !!node && node.type !== 'group';
    });
}

function getSelectedNodes() {
    return Array.from(getCurrentSelectionNodeIds())
        .map(id => canvasData.nodes.find(n => n.id === id))
        .filter(Boolean);
}

function getGroupNodes() {
    return canvasData.nodes.filter(n => n.type === 'group');
}

function getGroupMemberNodes(groupId) {
    if (!groupId) return [];
    return canvasData.nodes.filter(n => n.type !== 'group' && n.groupId === groupId);
}

function getGroupMemberCount(groupId) {
    return getGroupMemberNodes(groupId).length;
}

const GROUP_PADDING = Object.freeze({
    left: 40,
    top: 60,
    right: 40,
    bottom: 40,
});

function getBoundsFromNodes(nodes, padding = GROUP_PADDING) {
    const list = Array.isArray(nodes) ? nodes.filter(Boolean) : [];
    if (list.length === 0) return null;

    const pad = {
        left: Number(padding?.left) || 0,
        top: Number(padding?.top) || 0,
        right: Number(padding?.right) || 0,
        bottom: Number(padding?.bottom) || 0,
    };

    const minX = Math.min(...list.map(n => n.x)) - pad.left;
    const minY = Math.min(...list.map(n => n.y)) - pad.top;
    const maxX = Math.max(...list.map(n => n.x + n.width)) + pad.right;
    const maxY = Math.max(...list.map(n => n.y + n.height)) + pad.bottom;

    return { minX, minY, maxX, maxY };
}

function ensureGroupCoversMembers(groupId, options = {}) {
    const group = canvasData.nodes.find(n => n.id === groupId && n.type === 'group');
    if (!group) return false;

    const members = getGroupMemberNodes(groupId);
    const bounds = getBoundsFromNodes(members, options.padding || GROUP_PADDING);
    if (!bounds) return false;

    const expandOnly = options.expandOnly === true;
    const minWidth = Math.max(120, Number(options.minWidth) || 200);
    const minHeight = Math.max(80, Number(options.minHeight) || 120);

    let nextMinX = bounds.minX;
    let nextMinY = bounds.minY;
    let nextMaxX = bounds.maxX;
    let nextMaxY = bounds.maxY;

    if (expandOnly) {
        const currentMaxX = group.x + group.width;
        const currentMaxY = group.y + group.height;
        nextMinX = Math.min(group.x, nextMinX);
        nextMinY = Math.min(group.y, nextMinY);
        nextMaxX = Math.max(currentMaxX, nextMaxX);
        nextMaxY = Math.max(currentMaxY, nextMaxY);
    }

    const nextWidth = Math.max(minWidth, Math.round(nextMaxX - nextMinX));
    const nextHeight = Math.max(minHeight, Math.round(nextMaxY - nextMinY));
    const roundedX = Math.round(nextMinX);
    const roundedY = Math.round(nextMinY);

    const changed = group.x !== roundedX
        || group.y !== roundedY
        || group.width !== nextWidth
        || group.height !== nextHeight;

    if (!changed) return false;

    group.x = roundedX;
    group.y = roundedY;
    group.width = nextWidth;
    group.height = nextHeight;
    return true;
}

function ensureGroupsCoverMembers(groupIds, options = {}) {
    const ids = new Set(Array.isArray(groupIds) ? groupIds : []);
    let changed = false;

    ids.forEach(groupId => {
        if (!groupId) return;
        if (ensureGroupCoversMembers(groupId, options)) {
            changed = true;
        }
    });

    return changed;
}

function fitGroupsForNodeIds(nodeIds, options = {}) {
    const ids = new Set(Array.isArray(nodeIds) ? nodeIds : []);
    const groupIds = new Set();

    ids.forEach(id => {
        const node = canvasData.nodes.find(n => n.id === id);
        if (!node || node.type === 'group') return;
        if (node.groupId) {
            groupIds.add(node.groupId);
        }
    });

    return ensureGroupsCoverMembers(Array.from(groupIds), options);
}

function isNodeVisible(node) {
    if (!node) return false;
    if (node.type === 'group') return true;

    const gid = typeof node.groupId === 'string' ? node.groupId : '';
    if (!gid) return true;

    const group = canvasData.nodes.find(n => n.id === gid && n.type === 'group');
    if (!group) return true;
    return !group.collapsed;
}

function isNodeLocked(node) {
    return !!node?.locked;
}

function groupHasSelectedMembers(groupId) {
    if (!groupId) return false;
    const selectedIds = getCurrentSelectionNodeIds();
    for (const id of selectedIds) {
        const node = canvasData.nodes.find(n => n.id === id);
        if (node && node.type !== 'group' && node.groupId === groupId) {
            return true;
        }
    }
    return false;
}

function setNodeGroupId(node, groupId) {
    if (!node || node.type === 'group') return false;
    const currentGroupId = typeof node.groupId === 'string' && node.groupId ? node.groupId : null;
    const nextGroupId = typeof groupId === 'string' && groupId ? groupId : null;

    if (currentGroupId === nextGroupId) return false;

    if (nextGroupId) {
        node.groupId = nextGroupId;
    } else {
        delete node.groupId;
    }

    return true;
}

function setNodeLocked(node, locked) {
    if (!node || typeof node !== 'object') return false;
    const nextLocked = !!locked;
    if (!!node.locked === nextLocked) return false;

    if (nextLocked) {
        node.locked = true;
    } else {
        delete node.locked;
    }
    return true;
}

function setNodesLocked(nodeIds, locked) {
    let changed = false;
    const ids = new Set(Array.isArray(nodeIds) ? nodeIds : []);

    ids.forEach(id => {
        const node = canvasData.nodes.find(n => n.id === id);
        if (!node) return;
        if (setNodeLocked(node, locked)) {
            changed = true;
        }
    });

    return changed;
}

function assignNodesToGroup(nodeIds, groupId) {
    const targetGroup = canvasData.nodes.find(n => n.id === groupId && n.type === 'group');
    if (!targetGroup) return false;

    let changed = false;
    const ids = new Set(Array.isArray(nodeIds) ? nodeIds : []);
    ids.forEach(id => {
        const node = canvasData.nodes.find(n => n.id === id);
        if (!node || node.type === 'group' || node.id === groupId) return;
        if (setNodeGroupId(node, groupId)) changed = true;
    });

    if (changed) {
        ensureGroupCoversMembers(groupId);
    }

    return changed;
}

function removeNodesFromGroup(nodeIds) {
    let changed = false;
    const ids = new Set(Array.isArray(nodeIds) ? nodeIds : []);
    const affectedGroupIds = new Set();

    ids.forEach(id => {
        const node = canvasData.nodes.find(n => n.id === id);
        if (!node || node.type === 'group') return;
        if (node.groupId) affectedGroupIds.add(node.groupId);
        if (setNodeGroupId(node, null)) changed = true;
    });

    if (changed) {
        ensureGroupsCoverMembers(Array.from(affectedGroupIds));
    }

    return changed;
}

function clearGroupMembershipForGroup(groupId, exceptNodeIds = null) {
    const except = exceptNodeIds instanceof Set ? exceptNodeIds : new Set();
    let changed = false;

    canvasData.nodes.forEach(node => {
        if (node.type === 'group') return;
        if (node.groupId !== groupId) return;
        if (except.has(node.id)) return;
        if (setNodeGroupId(node, null)) changed = true;
    });

    return changed;
}

function sanitizeGroupMembership() {
    const validGroupIds = new Set(getGroupNodes().map(g => g.id));

    canvasData.nodes.forEach(node => {
        if (!node || typeof node !== 'object') return;

        if (node.type === 'group') {
            if ('groupId' in node) delete node.groupId;
            if (typeof node.label !== 'string' || !node.label.trim()) {
                node.label = 'New Group';
            }
            if (node.collapsed) {
                node.collapsed = true;
                const expandedHeight = Number(node.expandedHeight || 0);
                if (expandedHeight > 56) {
                    node.expandedHeight = Math.round(expandedHeight);
                } else {
                    delete node.expandedHeight;
                }
            } else {
                delete node.collapsed;
                delete node.expandedHeight;
            }

            if (node.locked) {
                node.locked = true;
            } else {
                delete node.locked;
            }
            return;
        }

        const gid = typeof node.groupId === 'string' ? node.groupId.trim() : '';
        if (!gid || !validGroupIds.has(gid)) {
            delete node.groupId;
        } else {
            node.groupId = gid;
        }

        if (node.locked) {
            node.locked = true;
        } else {
            delete node.locked;
        }
    });
}

function createGroupFromSelectionAt(anchorX, anchorY, options = {}) {
    const boundsNodeIds = Array.isArray(options.boundsNodeIds) ? options.boundsNodeIds : [];
    const memberNodeIds = Array.isArray(options.memberNodeIds) ? options.memberNodeIds : [];
    const label = (options.label || 'New Group').trim() || 'New Group';

    const boundsNodes = boundsNodeIds
        .map(id => canvasData.nodes.find(n => n.id === id))
        .filter(Boolean);

    let minX = Number(anchorX) || 0;
    let minY = Number(anchorY) || 0;
    let maxX = minX + 400;
    let maxY = minY + 300;

    const bounds = getBoundsFromNodes(boundsNodes, GROUP_PADDING);
    if (bounds) {
        minX = bounds.minX;
        minY = bounds.minY;
        maxX = bounds.maxX;
        maxY = bounds.maxY;
    }

    const id = `n_${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
    const newGroup = {
        id,
        type: 'group',
        label,
        x: minX,
        y: minY,
        width: Math.max(200, maxX - minX),
        height: Math.max(120, maxY - minY),
    };

    canvasData.nodes.push(newGroup);
    assignNodesToGroup(memberNodeIds, newGroup.id);
    connectPendingEdgeToNode(newGroup);
    return newGroup;
}

function promptSelectGroupId() {
    const groups = getGroupNodes();
    if (groups.length === 0) {
        window.uiToast?.('Create a group first', 'info');
        return '';
    }

    const lines = groups.map((g, idx) => {
        const label = (g.label || 'Group').trim() || 'Group';
        const members = getGroupMemberCount(g.id);
        const suffix = members === 1 ? 'node' : 'nodes';
        return `${idx + 1}. ${label} (${members} ${suffix})`;
    });

    const input = prompt(`Select group by number:\n${lines.join('\n')}`, '1');
    if (input === null) return '';

    const byIndex = Number.parseInt(input, 10);
    if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= groups.length) {
        return groups[byIndex - 1].id;
    }

    window.uiToast?.('Invalid group selection', 'error');
    return '';
}

function getContainingGroupForNode(node, ignoreGroupIds = null) {
    if (!node || node.type === 'group') return null;

    const ignore = ignoreGroupIds instanceof Set ? ignoreGroupIds : new Set();
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;

    const containers = getGroupNodes().filter(group => {
        if (!group || ignore.has(group.id)) return false;
        if (group.collapsed) return false;
        return cx >= group.x
            && cx <= group.x + group.width
            && cy >= group.y
            && cy <= group.y + group.height;
    });

    if (containers.length === 0) return null;

    containers.sort((a, b) => (a.width * a.height) - (b.width * b.height));
    return containers[0];
}

function updateGroupMembershipForNodeIds(nodeIds, options = {}) {
    const ids = new Set(Array.isArray(nodeIds) ? nodeIds : []);
    const ignoreGroupIds = options.ignoreGroupIds instanceof Set ? options.ignoreGroupIds : new Set();
    let changed = false;
    const affectedGroupIds = new Set();

    ids.forEach(id => {
        const node = canvasData.nodes.find(n => n.id === id);
        if (!node || node.type === 'group') return;

        const previousGroupId = node.groupId || null;
        if (previousGroupId) affectedGroupIds.add(previousGroupId);

        const group = getContainingGroupForNode(node, ignoreGroupIds);
        if (setNodeGroupId(node, group ? group.id : null)) {
            changed = true;
        }

        const nextGroupId = node.groupId || null;
        if (nextGroupId) affectedGroupIds.add(nextGroupId);
    });

    if (affectedGroupIds.size > 0) {
        ensureGroupsCoverMembers(Array.from(affectedGroupIds));
    }

    return changed;
}

const ALIGN_COLLISION_GAP = 24;

function nodesOverlap(a, b) {
    if (!a || !b || a.id === b.id) return false;
    return a.x < (b.x + b.width)
        && (a.x + a.width) > b.x
        && a.y < (b.y + b.height)
        && (a.y + a.height) > b.y;
}

function selectionHasOverlaps(nodes) {
    const list = Array.isArray(nodes) ? nodes.filter(Boolean) : [];
    for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
            if (nodesOverlap(list[i], list[j])) {
                return true;
            }
        }
    }
    return false;
}

function getConnectedLayoutOrder(nodes, axis = 'x') {
    const list = Array.isArray(nodes) ? nodes.filter(Boolean) : [];
    if (list.length < 2) return list;

    const ids = new Set(list.map(n => n.id));
    const byId = new Map(list.map(n => [n.id, n]));
    const fallbackSort = (aId, bId) => {
        const a = byId.get(aId);
        const b = byId.get(bId);
        if (!a || !b) return 0;
        const primary = (Number(a[axis]) || 0) - (Number(b[axis]) || 0);
        if (primary !== 0) return primary;
        return String(aId).localeCompare(String(bId));
    };

    const linkedEdges = canvasData.edges.filter(edge => (
        ids.has(edge.fromNode)
        && ids.has(edge.toNode)
        && edge.fromNode !== edge.toNode
    ));

    if (linkedEdges.length === 0) {
        return list.slice().sort((a, b) => fallbackSort(a.id, b.id));
    }

    const indegree = new Map();
    const outgoing = new Map();
    ids.forEach(id => {
        indegree.set(id, 0);
        outgoing.set(id, new Set());
    });

    linkedEdges.forEach(edge => {
        const out = outgoing.get(edge.fromNode);
        if (!out || out.has(edge.toNode)) return;
        out.add(edge.toNode);
        indegree.set(edge.toNode, (indegree.get(edge.toNode) || 0) + 1);
    });

    const queue = Array.from(ids)
        .filter(id => (indegree.get(id) || 0) === 0)
        .sort(fallbackSort);
    const orderedIds = [];

    while (queue.length > 0) {
        const id = queue.shift();
        orderedIds.push(id);

        const out = outgoing.get(id);
        if (!out) continue;

        Array.from(out).sort(fallbackSort).forEach(nextId => {
            const next = (indegree.get(nextId) || 0) - 1;
            indegree.set(nextId, next);
            if (next === 0) {
                queue.push(nextId);
                queue.sort(fallbackSort);
            }
        });
    }

    // Cycles or disconnected graph shapes fall back to visual order.
    if (orderedIds.length !== list.length) {
        return list.slice().sort((a, b) => fallbackSort(a.id, b.id));
    }

    return orderedIds.map(id => byId.get(id)).filter(Boolean);
}

function distributeNodesWithGap(nodes, axis = 'x', gap = ALIGN_COLLISION_GAP) {
    const list = Array.isArray(nodes) ? nodes.filter(Boolean) : [];
    if (list.length < 2) return;

    const posKey = axis === 'y' ? 'y' : 'x';
    const sizeKey = axis === 'y' ? 'height' : 'width';
    const ordered = getConnectedLayoutOrder(list, posKey);
    if (ordered.length < 2) return;

    const minPos = Math.min(...ordered.map(node => Number(node[posKey]) || 0));
    const maxPos = Math.max(...ordered.map(node => (Number(node[posKey]) || 0) + (Number(node[sizeKey]) || 0)));
    const totalSize = ordered.reduce((sum, node) => sum + (Number(node[sizeKey]) || 0), 0)
        + (Math.max(0, ordered.length - 1) * gap);

    let cursor = (minPos + maxPos - totalSize) / 2;
    ordered.forEach(node => {
        node[posKey] = Math.round(cursor);
        cursor += (Number(node[sizeKey]) || 0) + gap;
    });
}

function alignSelectedNodes(mode) {
    const selected = getSelectedNodes().filter(node => !isNodeLocked(node));
    if (selected.length < 2) {
        window.uiToast?.('Select at least two unlocked nodes', 'info');
        return false;
    }

    pushHistory();

    const minX = Math.min(...selected.map(n => n.x));
    const maxX = Math.max(...selected.map(n => n.x + n.width));
    const minY = Math.min(...selected.map(n => n.y));
    const maxY = Math.max(...selected.map(n => n.y + n.height));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    selected.forEach(node => {
        switch (mode) {
            case 'left':
                node.x = Math.round(minX);
                break;
            case 'center':
                node.x = Math.round(centerX - node.width / 2);
                break;
            case 'right':
                node.x = Math.round(maxX - node.width);
                break;
            case 'top':
                node.y = Math.round(minY);
                break;
            case 'middle':
                node.y = Math.round(centerY - node.height / 2);
                break;
            case 'bottom':
                node.y = Math.round(maxY - node.height);
                break;
            default:
                break;
        }
    });

    // If alignment causes overlap, spread along the free axis with small spacing.
    if (selectionHasOverlaps(selected)) {
        const distributeAxis = ['left', 'center', 'right'].includes(mode) ? 'y' : 'x';
        distributeNodesWithGap(selected, distributeAxis);
    }

    const movedNonGroupIds = selected.filter(n => n.type !== 'group').map(n => n.id);
    if (movedNonGroupIds.length > 0) {
        updateGroupMembershipForNodeIds(movedNonGroupIds);
        fitGroupsForNodeIds(movedNonGroupIds);
    }

    markUnsaved();
    renderCanvas();
    return true;
}

function setSelectedNodesLocked(locked) {
    const ids = Array.from(getCurrentSelectionNodeIds());
    if (ids.length === 0) {
        window.uiToast?.('Select node(s) first', 'info');
        return false;
    }

    const hasChanges = ids.some(id => {
        const node = canvasData.nodes.find(n => n.id === id);
        return !!node && !!node.locked !== !!locked;
    });

    if (!hasChanges) {
        window.uiToast?.(locked ? 'Selection is already locked' : 'Selection is already unlocked', 'info');
        return false;
    }

    pushHistory();
    setNodesLocked(ids, locked);

    markUnsaved();
    renderCanvas();
    return true;
}

function setGroupCollapsed(group, collapsed) {
    if (!group || group.type !== 'group') return false;
    const nextCollapsed = !!collapsed;
    const currentCollapsed = !!group.collapsed;
    if (currentCollapsed === nextCollapsed) return false;

    if (nextCollapsed) {
        const currentHeight = Math.round(Number(group.height) || 120);
        if (currentHeight > 56) {
            group.expandedHeight = currentHeight;
        }
        group.collapsed = true;
        group.height = 56;
    } else {
        const expanded = Math.round(Number(group.expandedHeight) || 180);
        group.height = Math.max(120, expanded);
        delete group.expandedHeight;
        delete group.collapsed;
    }

    return true;
}

function toggleCollapseSelectedGroups() {
    const selectedGroups = getSelectedNodes().filter(n => n.type === 'group' && !isNodeLocked(n));
    if (selectedGroups.length === 0) {
        window.uiToast?.('Select unlocked group node(s) first', 'info');
        return false;
    }

    const shouldCollapse = selectedGroups.some(g => !g.collapsed);
    let changed = false;

    pushHistory();
    selectedGroups.forEach(group => {
        if (setGroupCollapsed(group, shouldCollapse)) changed = true;
    });

    if (!changed) return false;

    markUnsaved();
    renderCanvas();
    return true;
}

function createInlineImageMarkerId() {
    return `inline-image-marker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createInlineImageMarkerElement(markerId) {
    const marker = document.createElement('span');
    marker.id = markerId;
    marker.className = 'node-inline-image-marker';
    marker.setAttribute('data-inline-image-marker', 'true');
    marker.setAttribute('contenteditable', 'false');
    marker.setAttribute('aria-hidden', 'true');
    return marker;
}

function findInlineMarker(rootEl, markerId) {
    if (!rootEl || !markerId) return null;
    return rootEl.querySelector(`#${markerId}`);
}

function placeCaretAfterElement(target) {
    if (!target || !target.parentNode) return;

    if (target.classList?.contains('node-inline-image')) {
        const anchor = ensureInlineImageCaretAnchorAfterFigure(target);
        if (anchor) {
            const range = document.createRange();
            range.setStart(anchor, anchor.textContent.length);
            range.collapse(true);
            const sel = window.getSelection();
            if (!sel) return;
            sel.removeAllRanges();
            sel.addRange(range);
            return;
        }
    }

    const range = document.createRange();
    range.setStartAfter(target);
    range.collapse(true);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
}

function placeCaretBeforeElement(target) {
    if (!target || !target.parentNode) return;
    const range = document.createRange();
    range.setStartBefore(target);
    range.collapse(true);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
}

function placeInlineImageMarker(editorEl, nodeId = null) {
    if (!editorEl) return null;

    clearPendingInlineImageMarker();

    const markerId = createInlineImageMarkerId();
    const marker = createInlineImageMarkerElement(markerId);
    let inserted = false;

    editorEl.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0).cloneRange();
        if (editorEl.contains(range.commonAncestorContainer)) {
            range.collapse(true);
            range.insertNode(marker);
            placeCaretAfterElement(marker);
            inserted = true;
        }
    }

    if (!inserted) {
        editorEl.appendChild(marker);
        placeCaretAfterElement(marker);
    }

    pendingInlineImageMarkerId = markerId;
    pendingInlineImageNodeId = nodeId;
    return markerId;
}

function clearPendingInlineImageMarker(targetNode = null) {
    const markerId = pendingInlineImageMarkerId;
    const targetId = pendingInlineImageNodeId;

    if (markerId && container) {
        const markerInDom = container.querySelector(`#${markerId}`);
        if (markerInDom) markerInDom.remove();
    }

    const node = targetNode || (targetId ? canvasData.nodes.find(n => n.id === targetId) : null);
    if (markerId && node && node.type === 'text' && typeof node.html === 'string' && node.html.includes(markerId)) {
        const tmp = document.createElement('div');
        tmp.innerHTML = node.html;
        const markerInHtml = tmp.querySelector(`#${markerId}`);
        if (markerInHtml) {
            markerInHtml.remove();
            node.html = tmp.innerHTML.trim();
            node.text = tmp.textContent || '';
        }
    }

    pendingInlineImageMarkerId = null;
    pendingInlineImageNodeId = null;
}

function createInlineImageFigure(filePath, width = 240) {
    if (!filePath) return null;
    const src = getRepoRawUrl(filePath);
    const name = (filePath || '').split('/').pop() || 'embedded-image';
    const safeWidth = Math.max(80, Math.round(Number(width) || 240));

    const figure = document.createElement('figure');
    figure.className = 'node-inline-image';
    figure.contentEditable = 'false';
    figure.style.width = `${safeWidth}px`;
    figure.dataset.inlineId = `inline-image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const img = document.createElement('img');
    img.src = src;
    img.alt = name;
    img.setAttribute('data-file', filePath);
    img.setAttribute('draggable', 'false');

    const handle = document.createElement('span');
    handle.className = 'node-inline-image-resizer';
    handle.title = 'Resize image';

    figure.appendChild(img);
    figure.appendChild(handle);
    return figure;
}

function getOrAssignInlineImageId(figureEl) {
    if (!figureEl) return '';
    if (!figureEl.dataset.inlineId) {
        figureEl.dataset.inlineId = `inline-image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }
    return figureEl.dataset.inlineId;
}

function stripEditorZeroWidth(text) {
    return String(text || '').replace(/\u200B/g, '');
}

function ensureInlineImageCaretAnchorAfterFigure(figureEl) {
    if (!figureEl || !figureEl.parentNode) return null;

    const next = figureEl.nextSibling;
    if (next && next.nodeType === Node.TEXT_NODE && next.textContent && next.textContent.length > 0) {
        return next;
    }

    if (next && next.nodeType === Node.ELEMENT_NODE) {
        if (!next.classList?.contains('node-inline-image')) {
            return null;
        }
    }

    const anchor = document.createTextNode('\u200B');
    figureEl.parentNode.insertBefore(anchor, next || null);
    return anchor;
}

function normalizeInlineImagesInTextElement(textEl, options = {}) {
    const draggable = !!options.draggable;
    if (!textEl) return;

    textEl.querySelectorAll('.node-inline-image').forEach(fig => {
        fig.setAttribute('contenteditable', 'false');
        fig.setAttribute('draggable', draggable ? 'true' : 'false');
        getOrAssignInlineImageId(fig);
        if (!fig.style.width) fig.style.width = '240px';

        if (!fig.querySelector('.node-inline-image-resizer')) {
            const handle = document.createElement('span');
            handle.className = 'node-inline-image-resizer';
            handle.title = 'Resize image';
            fig.appendChild(handle);
        }

        const img = fig.querySelector('img');
        if (img) img.setAttribute('draggable', draggable ? 'true' : 'false');

        ensureInlineImageCaretAnchorAfterFigure(fig);
    });
}

function extractCanvasUploadPathFromImageSrc(srcValue) {
    const src = String(srcValue || '').trim();
    if (!src) return '';
    if (src.startsWith('canvas_uploads/')) {
        return src.split(/[?#]/)[0];
    }

    const uploadToken = '/canvas_uploads/';
    const tokenIndex = src.indexOf(uploadToken);
    if (tokenIndex >= 0) {
        const decoded = decodeURIComponent(src.substring(tokenIndex + 1));
        return decoded.split(/[?#]/)[0];
    }

    return '';
}

function getInlineImageRepoFilesFromRoot(rootEl) {
    const files = new Set();
    if (!rootEl) return files;

    rootEl.querySelectorAll('.node-inline-image img, img[data-file], img').forEach(img => {
        let dataFile = (img.getAttribute('data-file') || '').trim();
        if (dataFile) {
            try {
                dataFile = decodeURIComponent(dataFile);
            } catch {
                // Keep original value when decode fails
            }
            dataFile = dataFile.replace(/^\/+/, '');
        }

        const resolved = (dataFile && dataFile.startsWith('canvas_uploads/'))
            ? dataFile
            : extractCanvasUploadPathFromImageSrc(img.getAttribute('src'));

        if (resolved && resolved.startsWith('canvas_uploads/')) {
            files.add(resolved);
        }
    });

    return files;
}

function getInlineImageRepoFilesFromTextNode(node) {
    if (!node || node.type !== 'text' || !node.html) return [];

    const tmp = document.createElement('div');
    tmp.innerHTML = node.html;
    return Array.from(getInlineImageRepoFilesFromRoot(tmp));
}

function promptDeleteRepoFiles(imageFiles) {
    const repoFiles = [...new Set((imageFiles || [])
        .map(f => String(f || '').trim())
        .filter(f => f.startsWith('canvas_uploads/'))
    )];

    if (repoFiles.length === 0) return;

    const promptText = repoFiles.length === 1
        ? `Delete the image file ${repoFiles[0]} from the repository as well?`
        : `Delete ${repoFiles.length} image files from the repository as well?`;

    if (confirm(promptText)) {
        repoFiles.forEach(filePath => {
            githubApi.deleteFile(filePath, `Delete unused canvas image ${filePath}`).catch(e => console.error(e));
        });
    }
}

function handleInlineRepoFileRemovalsDuringEdit(nodeId, textContentEl) {
    if (!nodeId || !textContentEl) return;

    const prevSeen = inlineRepoFilesLastSeenInEdit.get(nodeId) || new Set(getInlineImageRepoFilesFromRoot(textContentEl));
    const currentSeen = getInlineImageRepoFilesFromRoot(textContentEl);
    const handled = inlineRepoFilesHandledInEdit.get(nodeId) || new Set();
    const removed = Array.from(prevSeen).filter(filePath => !currentSeen.has(filePath) && !handled.has(filePath));

    if (removed.length > 0) {
        removed.forEach(filePath => handled.add(filePath));
        inlineRepoFilesHandledInEdit.set(nodeId, handled);
        promptDeleteRepoFiles(removed);
    }

    inlineRepoFilesLastSeenInEdit.set(nodeId, new Set(currentSeen));
}

function getInlineImageRepoFileFromFigure(figureEl) {
    if (!figureEl) return '';
    const files = Array.from(getInlineImageRepoFilesFromRoot(figureEl));
    return files[0] || '';
}

function clearInlineImageSelection() {
    if (selectedInlineImage?.nodeId && selectedInlineImage?.inlineId && nodesLayer) {
        const nodeEl = nodesLayer.querySelector(`[data-id="${selectedInlineImage.nodeId}"]`);
        const fig = nodeEl?.querySelector(`.node-inline-image[data-inline-id="${selectedInlineImage.inlineId}"]`);
        if (fig) fig.classList.remove('inline-selected');
    }

    if (nodesLayer) {
        nodesLayer.querySelectorAll('.node-inline-image.inline-selected').forEach(fig => fig.classList.remove('inline-selected'));
    }

    selectedInlineImage = null;
}

function selectInlineImage(node, figureEl) {
    if (!node || node.type !== 'text' || !figureEl) return;

    const inlineId = getOrAssignInlineImageId(figureEl);
    clearInlineImageSelection();
    figureEl.classList.add('inline-selected');
    selectedInlineImage = { nodeId: node.id, inlineId };
    updateDeleteBtn();
}

function getSelectedInlineFigureElement() {
    if (!selectedInlineImage?.nodeId || !selectedInlineImage?.inlineId || !nodesLayer) return null;
    return nodesLayer.querySelector(`[data-id="${selectedInlineImage.nodeId}"] .node-inline-image[data-inline-id="${selectedInlineImage.inlineId}"]`);
}

function deleteSelectedInlineImage() {
    if (!isOwner || !selectedInlineImage?.nodeId || !selectedInlineImage?.inlineId) return false;

    const node = canvasData.nodes.find(n => n.id === selectedInlineImage.nodeId);
    if (!node || node.type !== 'text') {
        clearInlineImageSelection();
        updateDeleteBtn();
        return false;
    }

    pushHistory();

    const inlineId = selectedInlineImage.inlineId;
    let removedRepoFile = '';
    let removed = false;

    const textEl = nodesLayer?.querySelector(`[data-id="${node.id}"] .node-content-text`);
    if (textEl) {
        const figure = textEl.querySelector(`.node-inline-image[data-inline-id="${inlineId}"]`);
        if (figure) {
            removedRepoFile = getInlineImageRepoFileFromFigure(figure);
            figure.remove();
            removed = true;

            node.html = textEl.innerHTML.trim();
            node.text = stripEditorZeroWidth(textEl.textContent || '');

            if (!hasMeaningfulTextNodeHtml(node.html) && !(node.text || '').trim()) {
                node.html = '';
                node.text = '';
                textEl.innerHTML = '<span class="node-placeholder">Double-click to edit</span>';
            } else {
                normalizeInlineImagesInTextElement(textEl);
            }
        }
    }

    if (!removed) {
        const tmp = document.createElement('div');
        tmp.innerHTML = node.html || '';
        const figure = tmp.querySelector(`.node-inline-image[data-inline-id="${inlineId}"]`);
        if (figure) {
            removedRepoFile = getInlineImageRepoFileFromFigure(figure);
            figure.remove();
            removed = true;

            node.html = tmp.innerHTML.trim();
            node.text = stripEditorZeroWidth(tmp.textContent || '');
            if (!hasMeaningfulTextNodeHtml(node.html) && !(node.text || '').trim()) {
                node.html = '';
                node.text = '';
            }
        }
    }

    clearInlineImageSelection();
    updateDeleteBtn();
    if (!removed) return false;

    markUnsaved();

    const nodeEl = nodesLayer?.querySelector(`[data-id="${node.id}"]`);
    if (nodeEl) {
        autoResizeNode(node, nodeEl);
        if (selectedNode?.id === node.id) {
            showNodeToolbar(node, nodeEl);
        }
    }

    if (removedRepoFile && editingNodeId === node.id) {
        const handled = inlineRepoFilesHandledInEdit.get(node.id) || new Set();
        handled.add(removedRepoFile);
        inlineRepoFilesHandledInEdit.set(node.id, handled);

        const currentFiles = new Set(getInlineImageRepoFilesFromTextNode(node));
        inlineRepoFilesLastSeenInEdit.set(node.id, currentFiles);
    }

    promptDeleteRepoFiles([removedRepoFile]);

    return true;
}

function hasMeaningfulTextNodeHtml(html) {
    const raw = String(html || '').trim();
    if (!raw) return false;

    const tmp = document.createElement('div');
    tmp.innerHTML = raw;

    if (tmp.querySelector('.node-inline-image, img, figure, video, iframe, table')) {
        return true;
    }

    const textOnly = (tmp.textContent || '').replace(/\u200B/g, '').trim();
    return textOnly.length > 0;
}

function insertInlineImageIntoTextNode(node, filePath, markerId = null) {
    if (!node || node.type !== 'text' || !filePath) return false;

    const liveTextEl = nodesLayer
        ? nodesLayer.querySelector(`[data-id="${node.id}"] .node-content-text`)
        : null;

    if (liveTextEl) {
        if (liveTextEl.querySelector('.node-placeholder')) {
            liveTextEl.innerHTML = '';
        }

        let inserted = false;
        let figure = createInlineImageFigure(filePath, 240);
        if (!figure) return false;

        const marker = markerId ? findInlineMarker(liveTextEl, markerId) : null;
        if (marker && marker.parentNode) {
            marker.parentNode.insertBefore(figure, marker);
            marker.remove();
            inserted = true;
            if (editingNodeId === node.id) {
                placeCaretAfterElement(figure);
            }
        }

        if (!inserted && editingNodeId === node.id) {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
                const range = sel.getRangeAt(0).cloneRange();
                if (liveTextEl.contains(range.commonAncestorContainer)) {
                    range.collapse(true);
                    range.insertNode(figure);
                    placeCaretAfterElement(figure);
                    inserted = true;
                }
            }
        }

        if (!inserted) {
            figure = createInlineImageFigure(filePath, 240);
            if (!figure) return false;
            liveTextEl.appendChild(figure);
            inserted = true;
        }

        node.html = liveTextEl.innerHTML.trim();
        node.text = stripEditorZeroWidth(liveTextEl.textContent || '');
        pendingInlineImageMarkerId = null;
        pendingInlineImageNodeId = null;
        return inserted;
    }

    const tmp = document.createElement('div');
    const baseHtml = (node.html || '').trim() || ((node.text || '').trim() ? renderMarkdown(node.text || '') : '');
    tmp.innerHTML = baseHtml;

    let inserted = false;
    const marker = markerId ? findInlineMarker(tmp, markerId) : null;
    const figure = createInlineImageFigure(filePath, 240);
    if (!figure) return false;

    if (marker && marker.parentNode) {
        marker.parentNode.insertBefore(figure, marker);
        marker.remove();
        inserted = true;
    }

    if (!inserted) {
        tmp.appendChild(figure);
        inserted = true;
    }

    node.html = tmp.innerHTML.trim();
    node.text = stripEditorZeroWidth(tmp.textContent || '');
    pendingInlineImageMarkerId = null;
    pendingInlineImageNodeId = null;
    return inserted;
}

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
    drawingArrow = container.querySelector('#canvas-drawing-arrow');
    zoomLabel = container.querySelector('#canvas-zoom-level');
    selectionBox = container.querySelector('#canvas-selection-box');
    saveIndicator = container.querySelector('#canvas-saving-indicator');
    liveStatusIndicator = container.querySelector('#canvas-live-status');
    nodeToolbar = container.querySelector('#canvas-node-toolbar');
    guidesLayer = container.querySelector('#canvas-guides-layer');
    hideForeignNodeToolbars();

    // Minimap elements
    minimapEl = container.querySelector('#canvas-minimap');
    minimapCanvas = container.querySelector('#canvas-minimap-canvas');
    minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;
    minimapViewportEl = container.querySelector('#canvas-minimap-viewport');

    // Initialize translate so (0,0) starts at center of viewport.
    // When the window is created while still hidden, clientWidth/Height can be 0,
    // so fall back to the current window size.
    const initialViewportWidth = viewport.clientWidth || window.innerWidth || 1920;
    const initialViewportHeight = viewport.clientHeight || window.innerHeight || 1080;
    translateX = initialViewportWidth / 2;
    translateY = initialViewportHeight / 2;

    isOwner = githubAuth.isOwner;
    const canvasWindowEl = container.querySelector('.canvas-window');
    if (canvasWindowEl) {
        canvasWindowEl.classList.toggle('is-owner', isOwner);
    }
    if (isOwner) {
        document.body.classList.add('is-owner');
    } else {
        document.body.classList.remove('is-owner');
    }

    if (isOwner) {
        setLiveStatus('Initializing...', 'live-off', 'Preparing owner live session');
    }

    await initializeOwnerLiveMode();

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

    // Ensure markdown parser is available before first render
    await ensureMarkedLoaded();

    // Load data
    pendingInitialViewportPolicy = true;
    await loadCanvasData();

    // Listen for hash changes
    window.addEventListener('hashchange', checkHashForDirectLink);

    // Setup auto-save
    if (isOwner) {
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

function buildLiveCanvasStatePayload() {
    return {
        nodes: Array.isArray(canvasData?.nodes) ? canvasData.nodes : [],
        edges: Array.isArray(canvasData?.edges) ? canvasData.edges : [],
    };
}

function setLiveStatus(text, className = 'live-off', title = '') {
    if (!liveStatusIndicator || !isOwner) return;
    liveStatusIndicator.hidden = false;
    liveStatusIndicator.textContent = text;
    liveStatusIndicator.classList.remove('live-ok', 'live-warn', 'live-off');
    if (className) {
        liveStatusIndicator.classList.add(className);
    }
    liveStatusIndicator.title = title || text;
}

async function initializeOwnerLiveMode() {
    liveModeActive = false;
    liveClient = null;

    if (!isOwner) return false;

    const roomId = (String(config.live?.roomId || 'global').trim() || 'global');
    const workerBaseUrl = String(config.live?.workerUrl || config.github?.workerUrl || '').replace(/\/+$/, '');
    const roomUrl = workerBaseUrl ? `${workerBaseUrl}/live/canvas/${encodeURIComponent(roomId)}` : '';

    liveClient = new CanvasLiveClient({
        enabled: config.live?.enabled !== false,
        roomId,
        roomUrl,
    });

    liveModeActive = liveClient.isReady();
    if (!liveModeActive) {
        liveClient = null;
        if (isOwner) {
            setLiveStatus('Live: disabled', 'live-off', 'Live sync disabled or unavailable');
        }
    } else {
        setLiveStatus('Live: connecting', 'live-off', 'Connecting to owner live room');
    }

    return liveModeActive;
}

async function pushLiveStateNow(options = {}) {
    const silent = options.silent === true;
    if (!isOwner || !liveModeActive || !liveClient) return false;

    try {
        await liveClient.pushState(buildLiveCanvasStatePayload());
        if (!silent) {
            setLiveStatus('Live: synced', 'live-ok', 'Live room sync is healthy');
        }
        return true;
    } catch (err) {
        setLiveStatus('Live: retrying', 'live-warn', 'Live sync failed, will retry while editing');
        if (!silent) {
            console.warn('Live sync push failed', err);
        }
        return false;
    }
}

function queueLiveSync() {
    if (!isOwner || !liveModeActive || !liveClient) return;

    if (liveSyncTimer) {
        clearTimeout(liveSyncTimer);
    }

    liveSyncTimer = setTimeout(() => {
        liveSyncTimer = null;
        pushLiveStateNow({ silent: true });
    }, LIVE_SYNC_DEBOUNCE_MS);
}

async function loadCanvasData() {
    showOverlay('Loading Canvas...');
    let loaded = false;
    let loadedFromLive = false;

    function parseCanvasPayload(raw, sourceLabel) {
        const text = String(raw ?? '').trim();
        if (!text) return null;

        try {
            const parsed = JSON.parse(text);
            return {
                nodes: Array.isArray(parsed?.nodes) ? parsed.nodes : [],
                edges: Array.isArray(parsed?.edges) ? parsed.edges : []
            };
        } catch (err) {
            console.warn(`Invalid canvas JSON from ${sourceLabel}; continuing fallback`, err);
            return null;
        }
    }

    if (isOwner && liveModeActive && liveClient) {
        try {
            const liveState = await liveClient.fetchState();
            if (liveState && ((liveState.nodes?.length || 0) > 0 || (liveState.edges?.length || 0) > 0)) {
                canvasData = liveState;
                canvasSha = null;
                loaded = true;
                loadedFromLive = true;
                setLiveStatus('Live: connected', 'live-ok', 'Owner live room connected');
            }
        } catch (err) {
            setLiveStatus('Live: fallback', 'live-warn', 'Live room unavailable, using snapshot fallback');
            console.warn('Live canvas load failed, trying snapshot fallback', err);
        }
    }

    if (!loaded) {
        try {
            const file = await githubApi.getFile(CANVAS_FILE);
            if (file) {
                const parsed = parseCanvasPayload(file.content, 'remote source');
                if (parsed) {
                    canvasData = parsed;
                    canvasSha = file.sha;
                    loaded = true;
                }
            }
        } catch (err) {
            console.error('Remote canvas load failed, trying local fallback', err);
        }
    }

    if (!loaded) {
        try {
            const localResp = await fetch(CANVAS_FILE, { cache: 'no-store' });
            if (localResp.ok) {
                const localRaw = await localResp.text();
                const localParsed = parseCanvasPayload(localRaw, 'local fallback');
                if (localParsed) {
                    canvasData = localParsed;
                    canvasSha = null;
                    loaded = true;
                    window.uiToast?.('Loaded local canvas fallback', 'info');
                }
            }
        } catch (err) {
            console.error('Local canvas fallback failed', err);
        }
    }

    if (!loaded) {
        console.error('No existing canvas found or error loading');
        canvasData = { nodes: [], edges: [] };
    }

    if (isOwner && liveModeActive && liveClient && !loadedFromLive) {
        await pushLiveStateNow({ silent: true });
        setLiveStatus('Live: connected', 'live-ok', 'Owner live room connected');
    } else if (isOwner && !liveModeActive) {
        setLiveStatus('Live: snapshot', 'live-off', 'Owner is in snapshot-only mode');
    }

    sanitizeGroupMembership();

    renderCanvas();
    hideOverlay();

    // Apply initial viewport policy only after canvas load/overlay flow completes.
    // This mirrors user expectation: run fit/restore after the canvas has finished loading.
    if (pendingInitialViewportPolicy) {
        pendingInitialViewportPolicy = false;
        requestAnimationFrame(() => requestAnimationFrame(() => applyInitialViewportPolicy()));
    }
}

async function saveCanvasData(isAuto = false) {
    if (!isOwner || isSaving) return;

    if (isAuto) {
        if (liveModeActive && liveClient) {
            await pushLiveStateNow({ silent: true });
        }
        return;
    }

    isSaving = true;
    saveIndicator.hidden = false;
    saveIndicator.textContent = 'Publishing...';

    try {
        const content = JSON.stringify(canvasData, null, 2);
        const result = await githubApi.saveFile(
            CANVAS_FILE,
            content,
            `Publish concept.canvas snapshot (via UI Emulator)`
        );
        canvasSha = result.content.sha;
        hasUnsavedChanges = false;
        saveIndicator.textContent = 'Published';
        setTimeout(() => saveIndicator.hidden = true, 2000);
    } catch (err) {
        console.error("Publish failed", err);
        saveIndicator.textContent = 'Publish Failed!';
        setTimeout(() => saveIndicator.hidden = true, 3000);
    } finally {
        isSaving = false;
    }
}

function markUnsaved() {
    hasUnsavedChanges = true;
    saveIndicator.hidden = false;
    saveIndicator.textContent = 'Unpublished changes';
    queueLiveSync();
    refreshCanvasDiscussionLinkLabels();
}

function getNodeTextAlign(node) {
    return ['left', 'center', 'right'].includes(node?.textAlign) ? node.textAlign : 'left';
}

function getNodeVerticalAlign(node) {
    return ['top', 'center', 'bottom'].includes(node?.verticalAlign) ? node.verticalAlign : 'top';
}

function applyNodeTextAlignment(node, textEl) {
    if (!node || node.type !== 'text' || !textEl) return;

    const textAlign = getNodeTextAlign(node);
    const verticalAlign = getNodeVerticalAlign(node);
    const justify = verticalAlign === 'center' ? 'center' : (verticalAlign === 'bottom' ? 'flex-end' : 'flex-start');

    textEl.style.textAlign = textAlign;
    textEl.style.justifyContent = justify;
}

// -----------------------------------------------------------------
// VIEWPORT & RENDER LOGIC
// -----------------------------------------------------------------

function setupViewport() {
    // Capture undo/redo before node-level handlers can stop propagation.
    if (!undoRedoCaptureBound) {
        window.addEventListener('keydown', (e) => {
            if (!isOwner) return;

            const isCtrlOrCmd = e.ctrlKey || e.metaKey;
            if (!isCtrlOrCmd) return;

            const key = String(e.key || '').toLowerCase();
            const isUndo = key === 'z' && !e.shiftKey;
            const isRedo = key === 'y' || (key === 'z' && e.shiftKey);
            if (!isUndo && !isRedo) return;

            const target = e.target;
            if (!container || !target || !container.contains(target)) return;

            const tag = target.tagName;
            const isTextInput = tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
            if (isTextInput) return;

            e.preventDefault();
            e.stopPropagation();

            if (isRedo) redo();
            else undo();
        }, true);
        undoRedoCaptureBound = true;
    }

    viewport.addEventListener('mousedown', (e) => {
        cancelAnimation();
        const clickedOnNode = e.target.closest('.canvas-node');
        const clickedOnToolbarUi = e.target.closest('.canvas-node-toolbar') || e.target.closest('.node-format-menu') || e.target.closest('.node-color-palette');

        // Deselect when clicking empty canvas (left/right), so toolbar always hides reliably
        if (!clickedOnNode && !clickedOnToolbarUi && !window.isSpacePressed && !e.shiftKey && (e.button === 0 || e.button === 2)) {
            clearSelection();
        }

        // Obsidian style panning: Middle click OR (Spacebar + Left click) OR (Right click on background)
        const panByRightClick = e.button === 2 && !clickedOnNode;
        if (e.button === 1 || (e.button === 0 && window.isSpacePressed) || panByRightClick) {
            if (selectedNode || selectedEdge) {
                clearSelection();
            }
            if (e.button === 1) isMiddleButtonDown = true;
            isDraggingViewport = true;
            startDragX = e.clientX - translateX;
            startDragY = e.clientY - translateY;
            viewport.style.cursor = 'grabbing';
            if (e.button === 1) e.preventDefault(); // prevent auto-scroll ring
            // Hide toolbar during panning to prevent ghost toolbar
            hideNodeToolbar();
        }

        // Allow marquee/tool on empty canvas area (not just viewport element itself)
        if (e.button === 0 && !clickedOnNode && !window.isSpacePressed) {
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

            // Live preview: highlight nodes that intersect the selection box
            canvasData.nodes.forEach(n => {
                const nx1 = translateX + (n.x * scale);
                const ny1 = translateY + (n.y * scale);
                const nx2 = nx1 + (n.width * scale);
                const ny2 = ny1 + (n.height * scale);
                const nodeEl = nodesLayer.querySelector(`[data-id="${n.id}"]`);
                if (!nodeEl) return;
                if (nx1 < left + width && nx2 > left && ny1 < top + height && ny2 > top) {
                    nodeEl.classList.add('marquee-hover');
                } else {
                    nodeEl.classList.remove('marquee-hover');
                }
            });
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 1) isMiddleButtonDown = false;
        isDraggingViewport = false;
        if (currentTool === 'select') viewport.style.cursor = 'grab';

        // Restore toolbar position after panning if a node is still selected and toolbar visible
        if (selectedNode && nodeToolbar && !nodeToolbar.hidden) {
            const el = nodesLayer.querySelector(`[data-id="${selectedNode.id}"]`);
            if (el) showNodeToolbar(selectedNode, el);
        }

        if (isDrawingEdge) {
            // Drop edge nowhere (or onto empty space)
            // Show context menu here so they can create a node!
            const targetNode = e.target.closest('.canvas-node');
            if (!targetNode && isOwner) {
                openContextMenu(e.clientX, e.clientY, null);
                suppressCtxMenuCloseUntil = Date.now() + 200;

                // Save context so we can auto-connect after creation
                window._pendingEdgeConnect = {
                    fromNode: drawEdgeStartNode,
                    fromSide: drawEdgeStartSide
                };
            }
            isDrawingEdge = false;
            drawingEdge.setAttribute('d', '');
            drawingArrow.setAttribute('points', '');
        }

        if (isMarqueeSelect) {
            isMarqueeSelect = false;

            // Clear marquee hover highlights
            nodesLayer.querySelectorAll('.marquee-hover').forEach(el => el.classList.remove('marquee-hover'));

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
            updateDeleteBtn();
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
            canvasData.nodes.push({ id, type: 'text', x: mouseX, y: mouseY, width: 250, height: 150, text: '', textAlign: 'left', verticalAlign: 'top' });
            saveCanvasData(true);
            renderCanvas();
        }
    });

    // Right click context menu
    const ctxMenu = container.querySelector('#canvas-context-menu');
    let ctxMenuX = 0, ctxMenuY = 0;
    let ctxMenuTargetNodeId = null;

    const cmAddText = container.querySelector('#cm-add-text');
    const cmAddImg = container.querySelector('#cm-add-img');
    const cmAddGroup = container.querySelector('#cm-add-group');
    const cmGroupSelected = container.querySelector('#cm-group-selected');
    const cmAddSelectedToGroup = container.querySelector('#cm-add-selected-to-group');
    const cmAddSelectedToTargetGroup = container.querySelector('#cm-add-selected-to-target-group');
    const cmRemoveTargetFromGroup = container.querySelector('#cm-remove-target-from-group');
    const cmRemoveSelectedFromGroup = container.querySelector('#cm-remove-selected-from-group');
    const cmRenameGroup = container.querySelector('#cm-rename-group');
    const cmUngroupKeep = container.querySelector('#cm-ungroup-keep');
    const cmDeleteGroupWithMembers = container.querySelector('#cm-delete-group-with-members');
    const cmOpenFormat = container.querySelector('#cm-open-format');
    const cmAlignLeft = container.querySelector('#cm-align-left');
    const cmAlignCenter = container.querySelector('#cm-align-center');
    const cmAlignRight = container.querySelector('#cm-align-right');
    const cmAlignTop = container.querySelector('#cm-align-top');
    const cmAlignMiddle = container.querySelector('#cm-align-middle');
    const cmAlignBottom = container.querySelector('#cm-align-bottom');
    const cmLockSelected = container.querySelector('#cm-lock-selected');
    const cmUnlockSelected = container.querySelector('#cm-unlock-selected');
    const cmToggleCollapseSelectedGroups = container.querySelector('#cm-toggle-collapse-selected-groups');

    const groupPicker = container.querySelector('#canvas-group-picker');
    const groupPickerTitle = container.querySelector('#canvas-group-picker-title');
    const groupPickerList = container.querySelector('#canvas-group-picker-list');
    const groupPickerClose = container.querySelector('#canvas-group-picker-close');

    let groupPickerAction = null;

    function setMenuItemVisible(el, isVisible) {
        if (!el) return;
        el.hidden = !isVisible;
    }

    function getContextTargetNode() {
        if (!ctxMenuTargetNodeId) return null;
        return canvasData.nodes.find(n => n.id === ctxMenuTargetNodeId) || null;
    }

    function closeGroupPicker() {
        if (!groupPicker) return;
        groupPicker.hidden = true;
        groupPickerAction = null;
        if (groupPickerList) {
            groupPickerList.innerHTML = '';
        }
    }

    function openGroupPicker(options = {}) {
        if (!groupPicker || !groupPickerList) return;

        const title = (options.title || 'Select Group').trim() || 'Select Group';
        const excludeIds = new Set(Array.isArray(options.excludeIds) ? options.excludeIds : []);
        const groups = getGroupNodes().filter(g => !excludeIds.has(g.id));

        if (groups.length === 0) {
            window.uiToast?.('No groups available', 'info');
            return;
        }

        groupPickerAction = typeof options.onPick === 'function' ? options.onPick : null;
        if (!groupPickerAction) return;

        if (groupPickerTitle) {
            groupPickerTitle.textContent = title;
        }

        groupPickerList.innerHTML = '';
        groups.forEach(group => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'canvas-group-picker-item';

            const label = (group.label || 'Group').trim() || 'Group';
            const memberCount = getGroupMemberCount(group.id);
            const memberText = memberCount === 1 ? '1 node' : `${memberCount} nodes`;
            btn.innerHTML = `<span class="canvas-group-picker-item-label">${escapeHtmlText(label)}</span><span class="canvas-group-picker-item-meta">${memberText}</span>`;

            btn.addEventListener('click', () => {
                const action = groupPickerAction;
                closeGroupPicker();
                if (action) {
                    action(group.id);
                }
            });

            groupPickerList.appendChild(btn);
        });

        const baseLeft = Number.parseFloat(ctxMenu?.style.left || '') || 24;
        const baseTop = Number.parseFloat(ctxMenu?.style.top || '') || 24;
        groupPicker.style.left = `${baseLeft + 12}px`;
        groupPicker.style.top = `${baseTop + 12}px`;
        groupPicker.hidden = false;
    }

    groupPickerClose?.addEventListener('click', () => {
        closeGroupPicker();
    });

    function showFormatMenuForNode(node) {
        if (!node || node.type !== 'text') return;

        const formatMenu = container.querySelector('#node-format-menu');
        if (!formatMenu) return;

        if (selectedNode?.id !== node.id || multiSelectedNodes.size > 0) {
            selectNode(node);
        }

        const nodeEl = nodesLayer.querySelector(`[data-id="${node.id}"]`);
        if (nodeEl) {
            showNodeToolbar(node, nodeEl);
        }

        const palette = container.querySelector('#node-color-palette');
        const linkMenu = container.querySelector('#node-link-menu');
        if (palette) palette.hidden = true;
        if (linkMenu) linkMenu.hidden = true;

        // Keep format menu attached to the floating node toolbar for consistent positioning.
        formatMenu.style.position = 'absolute';
        formatMenu.style.left = '50%';
        formatMenu.style.top = '100%';
        formatMenu.style.marginTop = '8px';
        formatMenu.style.transform = 'translateX(-50%)';
        formatMenu.style.zIndex = '120';

        formatMenu.style.display = 'flex';
        formatMenu.hidden = false;
    }

    function refreshContextMenuItems() {
        if (!isOwner) {
            [
                cmAddText,
                cmAddImg,
                cmAddGroup,
                cmGroupSelected,
                cmAddSelectedToGroup,
                cmAddSelectedToTargetGroup,
                cmRemoveTargetFromGroup,
                cmRemoveSelectedFromGroup,
                cmRenameGroup,
                cmUngroupKeep,
                cmDeleteGroupWithMembers,
                cmOpenFormat,
                cmAlignLeft,
                cmAlignCenter,
                cmAlignRight,
                cmAlignTop,
                cmAlignMiddle,
                cmAlignBottom,
                cmLockSelected,
                cmUnlockSelected,
                cmToggleCollapseSelectedGroups
            ].forEach(item => setMenuItemVisible(item, false));
            return;
        }

        const targetNode = getContextTargetNode();
        const isBackgroundMenu = !targetNode;
        const selectedIds = getCurrentSelectionNodeIds();
        const selectedNodes = Array.from(selectedIds)
            .map(id => canvasData.nodes.find(n => n.id === id))
            .filter(Boolean);
        const selectedNonGroupNodes = Array.from(selectedIds)
            .map(id => canvasData.nodes.find(n => n.id === id))
            .filter(n => !!n && n.type !== 'group');
        const selectedEditableNonGroupNodes = selectedNonGroupNodes.filter(n => !isNodeLocked(n));
        const selectedNonGroupIds = selectedNonGroupNodes.map(n => n.id);
        const selectedGroups = selectedNodes.filter(n => n.type === 'group');
        const alignableCount = selectedNodes.filter(n => !isNodeLocked(n)).length;
        const hasLockedSelection = selectedNodes.some(n => isNodeLocked(n));
        const hasUnlockedSelection = selectedNodes.some(n => !isNodeLocked(n));
        const hasSelectedGroups = selectedGroups.length > 0;
        const hasUnlockedSelectedGroups = selectedGroups.some(g => !isNodeLocked(g));
        const allSelectedGroupsCollapsed = hasSelectedGroups && selectedGroups.every(g => !!g.collapsed);
        const hasGroupedSelection = selectedEditableNonGroupNodes.some(n => !!n.groupId);
        const targetIsGroup = !!targetNode && targetNode.type === 'group';
        const targetIsEditableGroupedNode = !!targetNode && targetNode.type !== 'group' && !isNodeLocked(targetNode) && !!targetNode.groupId;
        const canGroupSelection = selectedEditableNonGroupNodes.length > 1;
        const hasGroups = getGroupNodes().length > 0;
        const targetGroupCanAcceptSelection = targetIsGroup
            && selectedEditableNonGroupNodes.some(n => n.id !== targetNode.id && n.groupId !== targetNode.id);

        setMenuItemVisible(cmAddText, isBackgroundMenu || (targetIsGroup && !isNodeLocked(targetNode)));
        setMenuItemVisible(cmAddImg, isBackgroundMenu || (targetIsGroup && !isNodeLocked(targetNode)));
        setMenuItemVisible(cmAddGroup, isBackgroundMenu && !canGroupSelection);
        setMenuItemVisible(cmGroupSelected, canGroupSelection);
        setMenuItemVisible(cmAddSelectedToGroup, !targetIsGroup && selectedEditableNonGroupNodes.length > 0 && hasGroups);
        setMenuItemVisible(cmAddSelectedToTargetGroup, targetGroupCanAcceptSelection);
        setMenuItemVisible(cmRemoveTargetFromGroup, targetIsEditableGroupedNode);
        setMenuItemVisible(cmRemoveSelectedFromGroup, selectedEditableNonGroupNodes.length > 0 && hasGroupedSelection);
        setMenuItemVisible(cmRenameGroup, targetIsGroup && !isNodeLocked(targetNode));
        setMenuItemVisible(cmUngroupKeep, targetIsGroup);
        setMenuItemVisible(cmDeleteGroupWithMembers, targetIsGroup && getGroupMemberCount(targetNode.id) > 0);
        setMenuItemVisible(cmOpenFormat, !!targetNode && targetNode.type === 'text' && selectedNonGroupIds.length <= 1 && !isNodeLocked(targetNode));
        setMenuItemVisible(cmAlignLeft, alignableCount >= 2);
        setMenuItemVisible(cmAlignCenter, alignableCount >= 2);
        setMenuItemVisible(cmAlignRight, alignableCount >= 2);
        setMenuItemVisible(cmAlignTop, alignableCount >= 2);
        setMenuItemVisible(cmAlignMiddle, alignableCount >= 2);
        setMenuItemVisible(cmAlignBottom, alignableCount >= 2);
        setMenuItemVisible(cmLockSelected, hasUnlockedSelection);
        setMenuItemVisible(cmUnlockSelected, hasLockedSelection);
        setMenuItemVisible(cmToggleCollapseSelectedGroups, hasUnlockedSelectedGroups);

        if (cmToggleCollapseSelectedGroups) {
            cmToggleCollapseSelectedGroups.textContent = allSelectedGroupsCollapsed
                ? 'Expand Selected Groups'
                : 'Collapse Selected Groups';
        }
    }

    function openContextMenu(clientX, clientY, targetNode = null) {
        if (!ctxMenu) return;
        if (!isOwner) return;

        closeGroupPicker();

        const formatMenu = container.querySelector('#node-format-menu');
        if (formatMenu) {
            formatMenu.hidden = true;
        }

        ctxMenuTargetNodeId = targetNode?.id || null;
        refreshContextMenuItems();

        const rect = viewport.getBoundingClientRect();
        ctxMenu.style.left = `${clientX}px`;
        ctxMenu.style.top = `${clientY}px`;
        ctxMenu.hidden = false;

        ctxMenuX = (clientX - rect.left - translateX) / scale;
        ctxMenuY = (clientY - rect.top - translateY) / scale;
    }

    viewport.addEventListener('contextmenu', (e) => {
        const nodeEl = e.target.closest('.canvas-node');
        if (!nodeEl) {
            e.preventDefault();
            if (!isOwner) return;
            window._pendingEdgeConnect = null;
            openContextMenu(e.clientX, e.clientY, null);
            return;
        }

        e.preventDefault();
        if (!isOwner) return;

        const nodeId = nodeEl.dataset.id || nodeEl.id.replace('node-', '');
        const clickedNode = canvasData.nodes.find(n => n.id === nodeId);
        if (!clickedNode) return;

        const selectedBefore = getCurrentSelectionNodeIds();
        const clickedAlreadySelected = selectedBefore.has(clickedNode.id);
        const hasSelectedNonGroupBesidesClicked = Array.from(selectedBefore).some(id => {
            if (id === clickedNode.id) return false;
            const node = canvasData.nodes.find(n => n.id === id);
            return !!node && node.type !== 'group';
        });

        const keepSelectionForGroupTarget = clickedNode.type === 'group'
            && !clickedAlreadySelected
            && hasSelectedNonGroupBesidesClicked;

        if (!clickedAlreadySelected && !keepSelectionForGroupTarget) {
            selectNode(clickedNode);
        }

        openContextMenu(e.clientX, e.clientY, clickedNode);
    });

    document.addEventListener('click', (e) => {
        hideForeignNodeToolbars();
        if (Date.now() < suppressCtxMenuCloseUntil) return;
        if (ctxMenu && !ctxMenu.hidden && !ctxMenu.contains(e.target)) {
            ctxMenu.hidden = true;
            window._pendingEdgeConnect = null;
            ctxMenuTargetNodeId = null;
        }
        if (groupPicker && !groupPicker.hidden && !groupPicker.contains(e.target) && !(ctxMenu && ctxMenu.contains(e.target))) {
            closeGroupPicker();
        }
        // Also close format menu and palette when clicking outside them
        const formatMenu = container.querySelector('#node-format-menu');
        const palette = container.querySelector('#node-color-palette');
        const linkMenu = container.querySelector('#node-link-menu');
        if (!e.target.closest('.node-format-menu')) {
            preserveTextareaForFormat = false;
        }
        if (formatMenu && !formatMenu.hidden && !formatMenu.contains(e.target) && !e.target.closest('#nt-edit')) {
            formatMenu.hidden = true;
        }
        if (palette && !palette.hidden && !palette.contains(e.target) && !e.target.closest('#nt-color')) {
            palette.hidden = true;
        }
        if (linkMenu && !linkMenu.hidden && !linkMenu.contains(e.target) && !e.target.closest('#nt-link')) {
            linkMenu.hidden = true;
        }

        // Belt-and-suspenders: deselect node when clicking on empty viewport area
        // This ensures toolbar always hides even if mousedown handler didn't catch it
        if (selectedNode && e.target.closest && !e.target.closest('.canvas-node') && !e.target.closest('.canvas-node-toolbar') && !e.target.closest('.node-format-menu') && !e.target.closest('.node-color-palette') && !e.target.closest('.node-link-menu') && !e.target.closest('.canvas-context-menu') && !e.target.closest('.canvas-group-picker') && !e.target.closest('.ui-context-menu')) {
            clearSelection();
        }
    });

    // Close all menus on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            ctxMenu.hidden = true;
            window._pendingEdgeConnect = null;
            ctxMenuTargetNodeId = null;
            closeGroupPicker();
            const formatMenu = container.querySelector('#node-format-menu');
            const palette = container.querySelector('#node-color-palette');
            const linkMenu = container.querySelector('#node-link-menu');
            if (formatMenu) formatMenu.hidden = true;
            if (palette) palette.hidden = true;
            if (linkMenu) linkMenu.hidden = true;
            closeSearch();
        }
    });

    cmAddText?.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.hidden = true;
        pushHistory();
        const id = 'n_' + Date.now();
        const newNode = { id, type: 'text', x: ctxMenuX, y: ctxMenuY, width: 250, height: 150, text: '', textAlign: 'left', verticalAlign: 'top' };

        const targetNode = getContextTargetNode();
        if (targetNode?.type === 'group') {
            if (targetNode.collapsed) {
                setGroupCollapsed(targetNode, false);
            }
            newNode.groupId = targetNode.id;
        }

        canvasData.nodes.push(newNode);
        if (targetNode?.type === 'group') {
            ensureGroupCoversMembers(targetNode.id);
        }

        connectPendingEdgeToNode(newNode);
        saveCanvasData(true);
        renderCanvas();
    });

    cmAddImg?.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.hidden = true;
        pushHistory();
        const id = 'n_' + Date.now();
        const newNode = { id, type: 'file', file: '', x: ctxMenuX, y: ctxMenuY, width: 250, height: 250 };

        const targetNode = getContextTargetNode();
        if (targetNode?.type === 'group') {
            if (targetNode.collapsed) {
                setGroupCollapsed(targetNode, false);
            }
            newNode.groupId = targetNode.id;
        }

        canvasData.nodes.push(newNode);
        if (targetNode?.type === 'group') {
            ensureGroupCoversMembers(targetNode.id);
        }

        connectPendingEdgeToNode(newNode);
        saveCanvasData(true);
        renderCanvas();

        // Immediately open file picker for the new image node
        const input = container.querySelector('#canvas-upload-image');
        window._targetImageNode = id;
        window._targetImageMode = 'file-node';
        input.click();
    });

    cmAddGroup?.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.hidden = true;
        pushHistory();
        const selectedIds = Array.from(getCurrentSelectionNodeIds());
        const memberIds = selectedIds.filter(id => {
            const node = canvasData.nodes.find(n => n.id === id);
            return !!node && node.type !== 'group' && !isNodeLocked(node);
        });

        const newGroup = createGroupFromSelectionAt(ctxMenuX, ctxMenuY, {
            boundsNodeIds: selectedIds,
            memberNodeIds: memberIds,
        });

        saveCanvasData(true);
        renderCanvas();

        const refreshed = newGroup ? canvasData.nodes.find(n => n.id === newGroup.id) : null;
        if (refreshed) {
            selectNode(refreshed);
        }
    });

    cmGroupSelected?.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.hidden = true;

        const selectedIds = Array.from(getCurrentSelectionNodeIds());
        const memberIds = selectedIds.filter(id => {
            const node = canvasData.nodes.find(n => n.id === id);
            return !!node && node.type !== 'group' && !isNodeLocked(node);
        });

        if (memberIds.length < 2) {
            window.uiToast?.('Select at least two unlocked non-group nodes', 'info');
            return;
        }

        pushHistory();
        const newGroup = createGroupFromSelectionAt(ctxMenuX, ctxMenuY, {
            boundsNodeIds: selectedIds,
            memberNodeIds: memberIds,
        });

        markUnsaved();
        renderCanvas();

        const refreshed = newGroup ? canvasData.nodes.find(n => n.id === newGroup.id) : null;
        if (refreshed) {
            selectNode(refreshed);
        }
    });

    cmAddSelectedToTargetGroup?.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.hidden = true;

        const targetNode = getContextTargetNode();
        if (!targetNode || targetNode.type !== 'group') return;

        const selectedIds = getSelectedNonGroupNodeIds().filter(id => {
            const node = canvasData.nodes.find(n => n.id === id);
            return !!node && !isNodeLocked(node);
        });
        if (selectedIds.length === 0) {
            window.uiToast?.('Select unlocked node(s) to add', 'info');
            return;
        }

        const hasChanges = selectedIds.some(id => {
            const node = canvasData.nodes.find(n => n.id === id);
            return !!node && node.groupId !== targetNode.id;
        });

        if (!hasChanges) {
            window.uiToast?.('Selection is already in this group', 'info');
            return;
        }

        pushHistory();
        if (targetNode.collapsed) {
            setGroupCollapsed(targetNode, false);
        }
        assignNodesToGroup(selectedIds, targetNode.id);

        markUnsaved();
        renderCanvas();
    });

    cmAddSelectedToGroup?.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.hidden = true;

        const selectedIds = getSelectedNonGroupNodeIds().filter(id => {
            const node = canvasData.nodes.find(n => n.id === id);
            return !!node && !isNodeLocked(node);
        });
        if (selectedIds.length === 0) {
            window.uiToast?.('Select unlocked node(s) to add', 'info');
            return;
        }

        openGroupPicker({
            title: 'Add Selected To Group',
            onPick: (targetGroupId) => {
                const hasChanges = selectedIds.some(id => {
                    const node = canvasData.nodes.find(n => n.id === id);
                    return !!node && node.groupId !== targetGroupId;
                });

                if (!hasChanges) {
                    window.uiToast?.('Selection is already in that group', 'info');
                    return;
                }

                pushHistory();
                const targetGroup = canvasData.nodes.find(n => n.id === targetGroupId && n.type === 'group');
                if (targetGroup?.collapsed) {
                    setGroupCollapsed(targetGroup, false);
                }
                assignNodesToGroup(selectedIds, targetGroupId);

                markUnsaved();
                renderCanvas();
            }
        });
    });

    cmRemoveSelectedFromGroup?.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.hidden = true;

        const selectedIds = getSelectedNonGroupNodeIds().filter(id => {
            const node = canvasData.nodes.find(n => n.id === id);
            return !!node && !isNodeLocked(node);
        });
        if (selectedIds.length === 0) {
            window.uiToast?.('Select unlocked node(s) first', 'info');
            return;
        }

        const hasChanges = selectedIds.some(id => {
            const node = canvasData.nodes.find(n => n.id === id);
            return !!node && !!node.groupId;
        });

        if (!hasChanges) {
            window.uiToast?.('Selected nodes are not grouped', 'info');
            return;
        }

        pushHistory();
        removeNodesFromGroup(selectedIds);

        markUnsaved();
        renderCanvas();
    });

    cmRemoveTargetFromGroup?.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.hidden = true;

        const targetNode = getContextTargetNode();
        if (!targetNode || targetNode.type === 'group' || isNodeLocked(targetNode)) return;
        if (!targetNode.groupId) {
            window.uiToast?.('This node is not in a group', 'info');
            return;
        }

        pushHistory();
        removeNodesFromGroup([targetNode.id]);

        markUnsaved();
        renderCanvas();
    });

    cmRenameGroup?.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.hidden = true;

        const targetNode = getContextTargetNode();
        if (!targetNode || targetNode.type !== 'group') return;

        selectNode(targetNode);
        requestAnimationFrame(() => {
            const titleEl = nodesLayer?.querySelector(`[data-id="${targetNode.id}"] .group-title`);
            if (titleEl) {
                titleEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            }
        });
    });

    cmUngroupKeep?.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.hidden = true;

        const targetNode = getContextTargetNode();
        if (!targetNode || targetNode.type !== 'group') return;

        pushHistory();
        deleteNodesByIds(new Set([targetNode.id]));
    });

    cmDeleteGroupWithMembers?.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.hidden = true;

        const targetNode = getContextTargetNode();
        if (!targetNode || targetNode.type !== 'group') return;

        const members = getGroupMemberNodes(targetNode.id);
        if (members.length === 0) {
            pushHistory();
            deleteNodesByIds(new Set([targetNode.id]));
            return;
        }

        const memberText = members.length === 1 ? '1 node' : `${members.length} nodes`;
        if (!confirm(`Delete group "${targetNode.label || 'Group'}" and its ${memberText}?`)) return;

        pushHistory();
        const ids = new Set([targetNode.id, ...members.map(n => n.id)]);
        deleteNodesByIds(ids);
    });

    cmOpenFormat?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (ctxMenu) ctxMenu.hidden = true;

        const targetNode = getContextTargetNode();
        if (!targetNode || targetNode.type !== 'text') return;

        suppressCtxMenuCloseUntil = Date.now() + 120;
        showFormatMenuForNode(targetNode);
    });

    cmAlignLeft?.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.hidden = true;
        alignSelectedNodes('left');
    });

    cmAlignCenter?.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.hidden = true;
        alignSelectedNodes('center');
    });

    cmAlignRight?.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.hidden = true;
        alignSelectedNodes('right');
    });

    cmAlignTop?.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.hidden = true;
        alignSelectedNodes('top');
    });

    cmAlignMiddle?.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.hidden = true;
        alignSelectedNodes('middle');
    });

    cmAlignBottom?.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.hidden = true;
        alignSelectedNodes('bottom');
    });

    cmLockSelected?.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.hidden = true;
        setSelectedNodesLocked(true);
    });

    cmUnlockSelected?.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.hidden = true;
        setSelectedNodesLocked(false);
    });

    cmToggleCollapseSelectedGroups?.addEventListener('click', () => {
        if (ctxMenu) ctxMenu.hidden = true;
        toggleCollapseSelectedGroups();
    });

    viewport.addEventListener('dragover', (e) => {
        const dt = e.dataTransfer;
        if (!dt) return;
        if (!Array.from(dt.types || []).includes('Files')) return;

        e.preventDefault();
        dt.dropEffect = isOwner ? 'copy' : 'none';
    });

    viewport.addEventListener('drop', async (e) => {
        const dt = e.dataTransfer;
        if (!dt) return;

        const files = Array.from(dt.files || []);
        if (files.length === 0) return;

        e.preventDefault();
        e.stopPropagation();

        const imageFiles = files.filter(f => f && f.type && f.type.startsWith('image/'));
        if (imageFiles.length === 0) {
            window.uiToast('Only image files can be dropped on canvas', 'info');
            return;
        }

        if (!isOwner) {
            window.uiToast('Only owner can upload images to canvas', 'info');
            return;
        }

        const rect = viewport.getBoundingClientRect();
        const baseX = (e.clientX - rect.left - translateX) / scale;
        const baseY = (e.clientY - rect.top - translateY) / scale;

        // Stagger multiple dropped images slightly so they do not overlap perfectly.
        let offset = 0;
        for (const file of imageFiles) {
            const filename = getUniqueCanvasUploadFilename(file.name || `dropped_image_${Date.now()}.png`);
            await uploadAndAddImage(file, filename, { x: baseX + offset, y: baseY + offset });
            offset += 24;
        }
    });


    viewport.addEventListener('wheel', (e) => {
        cancelAnimation();
        const shouldZoom = e.ctrlKey || e.metaKey || isMiddleButtonDown || !e.shiftKey;

        // Hide toolbar while user moves viewport (prevents "flying" toolbar effect)
        if (selectedNode) {
            hideNodeToolbar();
        }

        if (shouldZoom) {
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
        } else {
            // Pan
            translateX -= e.deltaX;
            translateY -= e.deltaY;
        }

        updateTransform();
    }, { passive: false });
}

function updateTransform() {
    content.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;
    queueSaveCanvasViewState();
    hideForeignNodeToolbars();

    // Keep toolbar anchored to selected node, and hard-hide any ghost toolbar
    if (selectedNode && nodeToolbar && !nodeToolbar.hidden) {
        const el = nodesLayer.querySelector(`[data-id="${selectedNode.id}"]`);
        if (el && el.classList.contains('selected')) showNodeToolbar(selectedNode, el);
        else {
            selectedNode = null;
            hideNodeToolbar();
        }
    } else if (!selectedNode && nodeToolbar && !nodeToolbar.hidden) {
        hideNodeToolbar();
    }

    renderMinimap();
}

function renderCanvas() {
    // Clean up old window-level event listeners to prevent memory leaks
    nodeCleanupFns.forEach(fn => fn());
    nodeCleanupFns = [];

    nodesLayer.innerHTML = '';
    edgesLayer.innerHTML = '';

    const visibleNodeIds = new Set(
        canvasData.nodes.filter(isNodeVisible).map(n => n.id)
    );

    let selectionChanged = false;

    if (selectedNode && !visibleNodeIds.has(selectedNode.id)) {
        selectedNode = null;
        selectionChanged = true;
    }

    if (multiSelectedNodes.size > 0) {
        Array.from(multiSelectedNodes).forEach(id => {
            if (!visibleNodeIds.has(id)) {
                multiSelectedNodes.delete(id);
                selectionChanged = true;
            }
        });
    }

    if (selectedEdge) {
        const edgeVisible = visibleNodeIds.has(selectedEdge.fromNode) && visibleNodeIds.has(selectedEdge.toNode);
        if (!edgeVisible) {
            selectedEdge = null;
            selectionChanged = true;
        }
    }

    // Render edges
    canvasData.edges.forEach(edge => {
        if (!visibleNodeIds.has(edge.fromNode) || !visibleNodeIds.has(edge.toNode)) return;
        renderEdge(edge);
    });

    // Render nodes
    canvasData.nodes.forEach(node => {
        if (!visibleNodeIds.has(node.id)) return;
        renderNode(node);
    });

    if (selectedInlineImage?.nodeId && selectedInlineImage?.inlineId) {
        const selectedFigure = nodesLayer.querySelector(`[data-id="${selectedInlineImage.nodeId}"] .node-inline-image[data-inline-id="${selectedInlineImage.inlineId}"]`);
        if (!selectedFigure) {
            selectedInlineImage = null;
            selectionChanged = true;
        }
    }

    if (selectionChanged) {
        updateDeleteBtn();
        if (!selectedNode) {
            hideNodeToolbar();
        }
    }

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

    if (isNodeLocked(node)) {
        el.classList.add('node-locked');
    }

    if (node.type !== 'group' && typeof node.groupId === 'string' && node.groupId) {
        el.dataset.groupId = node.groupId;
        el.classList.add('grouped-node');
    }

    if (node.color) {
        if (['1','2','3','4','5','6'].includes(node.color)) {
            el.classList.add(`color-${node.color}`);
        } else {
            el.style.borderColor = node.color;
        }
    }

    let contentHtml = '';
    if (node.type === 'group') {
        const memberCount = getGroupMemberCount(node.id);
        const groupLabel = (node.label || 'New Group').trim() || 'New Group';
        const memberLabel = memberCount === 1 ? '1 node' : `${memberCount} nodes`;

        el.classList.add('canvas-group');
        if (node.collapsed) {
            el.classList.add('group-collapsed');
        }
        if (groupHasSelectedMembers(node.id)) {
            el.classList.add('group-has-selected-member');
        }

        contentHtml = `
            <div class="group-title" title="Double-click to rename group">${escapeHtmlText(groupLabel)}</div>
            <div class="group-members-count" title="Grouped nodes">${memberLabel}</div>
        `;
    } else if (node.type === 'text') {
        const htmlText = (node.html || '').trim();
        const rawText = (node.text || '').trim();
        const isEmpty = !htmlText && !rawText;
        let renderedHtml = htmlText || renderMarkdown(node.text || '');
        // Allow checkbox interaction only for owner; viewers stay read-only.
        if (isOwner) {
            renderedHtml = renderedHtml.replace(/disabled=""/g, '').replace(/disabled/g, '');
        }
        if (isEmpty) {
            renderedHtml = '<span class="node-placeholder">Double-click to edit</span>';
        }
        contentHtml = `<div class="node-content-text" data-id="${node.id}">${renderedHtml}</div>`;
    } else if (node.type === 'file') {
        const filePath = typeof node.file === 'string' ? node.file : '';

        // Handle images
        const fileExt = filePath.split('.').pop().toLowerCase();
        if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(fileExt)) {
            let imgSrc;
            if (node._tempBase64) {
                imgSrc = node._tempBase64;
            } else {
                imgSrc = getRepoRawUrl(filePath);
            }

            contentHtml = `
                <div class="node-title">${filePath.split('/').pop()}</div>
                <div class="node-content-image">
                    <img src="${imgSrc}" alt="${filePath}" />
                </div>
            `;
        } else {
            contentHtml = `<div class="node-content-text"> ${filePath}</div>`;
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
        if (node.type === 'text') {
            applyNodeTextAlignment(node, textEl);
            normalizeInlineImagesInTextElement(textEl);

            if (!isOwner) {
                textEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.setAttribute('disabled', 'disabled'));
            }

            if (selectedInlineImage?.nodeId === node.id && selectedInlineImage?.inlineId) {
                const selectedFigure = textEl.querySelector(`.node-inline-image[data-inline-id="${selectedInlineImage.inlineId}"]`);
                if (selectedFigure) {
                    selectedFigure.classList.add('inline-selected');
                }
            }
        }

        textEl.addEventListener('click', (e) => {
            if (e.detail >= 3) return;
            const link = e.target.closest('a');
            if (!link) return;
            e.preventDefault();
            e.stopPropagation();
            const href = link.getAttribute('href');
            const canvasHash = getCanvasHashFromLink(href);
            if (canvasHash) {
                window.location.hash = canvasHash.substring(1);
            } else if (href) {
                window.open(href, '_blank', 'noopener');
            }
        });
    }

    // Node interactions
    setupNodeInteractions(el, node);

}

function selectAllNodeText(target) {
    const range = document.createRange();
    range.selectNodeContents(target);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

function setupNodeInteractions(el, node) {
    let startX, startY, origLeft, origTop;
    let isDragging = false;
    let isResizing = false;
    let resizeDir = null;
    let origWidth, origHeight;
    let textContentEl = null;
    let inlineImageResizeState = null;
    let inlineImageDragState = null;
    let dragMovedNodeIds = null;
    let dragIncludesGroupNode = false;

    el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation(); // prevent viewport drag

        const clickedGroupTitle = e.target.closest('.group-title');
        if (clickedGroupTitle) {
            if (!clickedGroupTitle.isContentEditable) {
                if (selectedNode?.id !== node.id || multiSelectedNodes.size > 0) {
                    selectNode(node);
                }
            }
            return;
        }

        if (isNodeLocked(node)) {
            if (e.shiftKey && isOwner) {
                if (multiSelectedNodes.has(node.id)) {
                    multiSelectedNodes.delete(node.id);
                    el.classList.remove('selected');
                } else {
                    multiSelectedNodes.add(node.id);
                    el.classList.add('selected');
                    if (selectedNode && !multiSelectedNodes.has(selectedNode.id)) {
                        multiSelectedNodes.add(selectedNode.id);
                    }
                }
                selectedNode = node;
                showNodeToolbar(node, el);
                updateDeleteBtn();
            } else if (selectedNode?.id !== node.id || multiSelectedNodes.size > 0) {
                selectNode(node);
            }
            return;
        }

        // Push history if starting to drag or resize
        if (e.target.classList.contains('node-resize-handle') || !e.target.classList.contains('node-edge-handle')) {
            if (isOwner && !isNodeLocked(node)) pushHistory();
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

        // If rich preview editor is active in this node, don't interfere with text selection
        if (el.querySelector('.node-content-text.editing')) {
            return; // Let rich editor handle its own mouse events for text selection
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

        if (isOwner && currentTool === 'select') {
            const domSelectedIds = Array.from(nodesLayer.querySelectorAll('.canvas-node.selected'))
                .map(n => n.dataset.id)
                .filter(Boolean);

            // If visual selection has multiple nodes but internal set drifted,
            // rebuild from DOM so dragging keeps the intended group selection.
            if (domSelectedIds.length > 1 && domSelectedIds.includes(node.id) && (multiSelectedNodes.size <= 1 || !multiSelectedNodes.has(node.id))) {
                multiSelectedNodes = new Set(domSelectedIds);
            }
        }

        const keepMultiSelection = isOwner
            && currentTool === 'select'
            && multiSelectedNodes.size > 1
            && multiSelectedNodes.has(node.id);

        // Keep existing multi-selection when dragging one of its nodes.
        // Otherwise fall back to normal single-node selection behavior.
        if (keepMultiSelection) {
            selectedNode = node;
            el.classList.add('selected');
            showNodeToolbar(node, el);
            updateDeleteBtn();
        } else {
            selectNode(node);
        }

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
            drawingArrow.setAttribute('points', '');
        }
    });

    // Text editing
    if (node.type === 'file' && isOwner) {
        el.addEventListener('dblclick', (e) => {
            if (currentTool !== 'select') return;
            if (isNodeLocked(node)) return;
            e.stopPropagation();
            const currentName = node.file ? node.file.split('/').pop() : '';
            const newName = prompt('Rename image:', currentName);
            if (!newName || newName === currentName) return;

            pushHistory();
            const dir = node.file && node.file.includes('/')
                ? node.file.substring(0, node.file.lastIndexOf('/') + 1)
                : 'canvas_uploads/';
            node.file = dir + newName;
            markUnsaved();
            renderCanvas();

            const refreshed = canvasData.nodes.find(n => n.id === node.id);
            if (refreshed) selectNode(refreshed);
        });
    }

    if (node.type === 'group' && isOwner) {
        const titleEl = el.querySelector('.group-title');
        if (titleEl) {
            let originalLabel = '';
            let isRenaming = false;

            const finishRename = (commit) => {
                if (!isRenaming) return;

                const nextLabel = (titleEl.textContent || '').trim() || 'New Group';
                titleEl.contentEditable = 'false';
                titleEl.classList.remove('editing');
                isRenaming = false;

                if (commit) {
                    node.label = nextLabel;
                    if (node.label !== originalLabel) {
                        markUnsaved();
                    }
                }

                titleEl.textContent = (node.label || originalLabel || 'New Group').trim() || 'New Group';
            };

            const startRename = () => {
                if (isRenaming || currentTool !== 'select' || isNodeLocked(node)) return;

                pushHistory();
                if (selectedNode?.id !== node.id || multiSelectedNodes.size > 0) {
                    selectNode(node);
                }

                originalLabel = (node.label || 'New Group').trim() || 'New Group';
                titleEl.contentEditable = 'true';
                titleEl.classList.add('editing');
                titleEl.focus();
                isRenaming = true;

                const range = document.createRange();
                range.selectNodeContents(titleEl);
                const sel = window.getSelection();
                if (sel) {
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            };

            titleEl.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                startRename();
            });

            titleEl.addEventListener('keydown', (e) => {
                if (!isRenaming) return;

                if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.shiftKey) {
                        redo();
                    } else {
                        undo();
                    }
                    return;
                }

                e.stopPropagation();

                if (e.key === 'Enter') {
                    e.preventDefault();
                    finishRename(true);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    node.label = originalLabel;
                    finishRename(false);
                }
            });

            titleEl.addEventListener('blur', () => {
                finishRename(true);
            });
        }
    }

    if (node.type === 'text' && isOwner) {
        const textContent = el.querySelector('.node-content-text');
        textContentEl = textContent;

        function ensureInlineImageControls() {
            normalizeInlineImagesInTextElement(textContent, { draggable: editingNodeId === node.id });
        }

        ensureInlineImageControls();

        function setCaretAtEnd(target) {
            const range = document.createRange();
            range.selectNodeContents(target);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }

        function setCaretAtStart(target) {
            const range = document.createRange();
            range.selectNodeContents(target);
            range.collapse(true);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }

        function getCaretRangeFromPoint(x, y) {
            if (document.caretRangeFromPoint) {
                return document.caretRangeFromPoint(x, y);
            }

            if (document.caretPositionFromPoint) {
                const pos = document.caretPositionFromPoint(x, y);
                if (pos) {
                    const r = document.createRange();
                    r.setStart(pos.offsetNode, pos.offset);
                    r.collapse(true);
                    return r;
                }
            }

            return null;
        }

        function startRichEdit() {
            if (editingNodeId === node.id) return;
            if (isNodeLocked(node)) return;

            // Close any other active editor first
            if (editingNodeId && editingNodeId !== node.id) {
                const prev = nodesLayer.querySelector(`[data-id="${editingNodeId}"] .node-content-text.editing`);
                if (prev) prev.blur();
            }

            if (textContent.querySelector('.node-placeholder')) {
                textContent.innerHTML = '';
            }

            editingNodeId = node.id;
            textContent.contentEditable = 'true';
            textContent.classList.add('editing');
            textContent.focus();
            setCaretAtEnd(textContent);

            const filesAtStart = new Set(getInlineImageRepoFilesFromRoot(textContent));
            inlineRepoFilesAtEditStart.set(node.id, filesAtStart);
            inlineRepoFilesHandledInEdit.set(node.id, new Set());
            inlineRepoFilesLastSeenInEdit.set(node.id, new Set(filesAtStart));
            ensureInlineImageControls();
        }

        function finishRichEdit() {
            if (editingNodeId !== node.id) return;

            const html = textContent.innerHTML.trim();
            const plain = stripEditorZeroWidth(textContent.textContent || '');
            const hasPendingMarker = !!findInlineMarker(textContent, pendingInlineImageMarkerId)
                && pendingInlineImageNodeId === node.id;
            const hasRichContent = hasMeaningfulTextNodeHtml(html);
            const filesBefore = inlineRepoFilesAtEditStart.get(node.id) || new Set();
            const filesHandled = inlineRepoFilesHandledInEdit.get(node.id) || new Set();
            const filesAfter = getInlineImageRepoFilesFromRoot(textContent);
            const removedRepoFiles = Array.from(filesBefore).filter(filePath => !filesAfter.has(filePath) && !filesHandled.has(filePath));

            editingNodeId = null;
            textContent.contentEditable = 'false';
            textContent.classList.remove('editing');

            if (!plain.trim() && !hasRichContent && !hasPendingMarker) {
                node.text = '';
                node.html = '';
                textContent.innerHTML = '<span class="node-placeholder">Double-click to edit</span>';
            } else {
                node.text = plain;
                node.html = html;
                textContent.innerHTML = node.html;
                textContent.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.removeAttribute('disabled'));
                ensureInlineImageControls();
            }

            applyNodeTextAlignment(node, textContent);

            inlineRepoFilesAtEditStart.delete(node.id);
            inlineRepoFilesHandledInEdit.delete(node.id);
            inlineRepoFilesLastSeenInEdit.delete(node.id);

            markUnsaved();
            autoResizeNode(node, el);
            promptDeleteRepoFiles(removedRepoFiles);
        }

        textContent.addEventListener('input', () => {
            if (editingNodeId !== node.id) return;
            handleInlineRepoFileRemovalsDuringEdit(node.id, textContent);
        });

        textContent.addEventListener('beforeinput', (be) => {
            if (editingNodeId !== node.id) return;
            const inputType = String(be.inputType || '');
            if (!inputType.startsWith('delete')) return;
            requestAnimationFrame(() => {
                handleInlineRepoFileRemovalsDuringEdit(node.id, textContent);
            });
        });

        // Handle checkbox toggling in both markdown-rendered and rich-edit modes
        textContent.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox') {
                pushHistory();

                if (node.html && node.html.trim()) {
                    node.html = textContent.innerHTML;
                    node.text = textContent.textContent || '';
                    markUnsaved();
                    return;
                }

                const isChecked = e.target.checked;
                const checkboxes = Array.from(textContent.querySelectorAll('input[type="checkbox"]'));
                const index = checkboxes.indexOf(e.target);

                if (index > -1) {
                    let matchCount = 0;
                    node.text = (node.text || '').replace(/\[([ xX])\]/g, (match) => {
                        if (matchCount === index) {
                            matchCount++;
                            return isChecked ? '[x]' : '[ ]';
                        }
                        matchCount++;
                        return match;
                    });
                    markUnsaved();
                    textContent.innerHTML = renderMarkdown(node.text);
                    textContent.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.removeAttribute('disabled'));
                    ensureInlineImageControls();
                    applyNodeTextAlignment(node, textContent);
                }
            }
        });

        // Double click enters preview-mode rich editor (not raw markdown editor)
        el.addEventListener('dblclick', (e) => {
            if (currentTool !== 'select') return;
            if (isNodeLocked(node)) return;
            e.stopPropagation();
            startRichEdit();
        });

        textContent.addEventListener('mousedown', (me) => {
            const resizer = me.target.closest('.node-inline-image-resizer');
            const inlineImage = me.target.closest('.node-inline-image');

            if (resizer && inlineImage) {
                me.preventDefault();
                me.stopPropagation();
                if (selectedNode?.id !== node.id) {
                    selectNode(node);
                }
                selectInlineImage(node, inlineImage);

                const startWidth = inlineImage.getBoundingClientRect().width || parseFloat(inlineImage.style.width) || 240;
                inlineImageResizeState = {
                    figure: inlineImage,
                    startX: me.clientX,
                    startWidth,
                };
                return;
            }

            if (inlineImage) {
                if (selectedNode?.id !== node.id) {
                    selectNode(node);
                }
                if (editingNodeId !== node.id) {
                    me.stopPropagation();
                    selectInlineImage(node, inlineImage);
                    me.preventDefault();
                }
                return;
            }

            clearInlineImageSelection();
            updateDeleteBtn();

            if (editingNodeId === node.id) {
                me.stopPropagation();
            }
        });

        textContent.addEventListener('dragstart', (de) => {
            const inlineImage = de.target.closest('.node-inline-image');
            if (!inlineImage || editingNodeId !== node.id) {
                de.preventDefault();
                return;
            }

            const inlineId = getOrAssignInlineImageId(inlineImage);
            if (!inlineId) {
                de.preventDefault();
                return;
            }

            inlineImageDragState = { nodeId: node.id, inlineId };
            if (selectedNode?.id !== node.id) {
                selectNode(node);
            }
            selectInlineImage(node, inlineImage);

            if (de.dataTransfer) {
                de.dataTransfer.effectAllowed = 'move';
                try {
                    de.dataTransfer.setData('text/plain', inlineId);
                } catch {
                    // No-op for browsers that block custom drag payloads
                }
            }
        });

        textContent.addEventListener('dragover', (de) => {
            if (!inlineImageDragState || inlineImageDragState.nodeId !== node.id || editingNodeId !== node.id) return;
            de.preventDefault();
            if (de.dataTransfer) de.dataTransfer.dropEffect = 'move';
        });

        textContent.addEventListener('drop', (de) => {
            if (!inlineImageDragState || inlineImageDragState.nodeId !== node.id || editingNodeId !== node.id) return;
            de.preventDefault();
            de.stopPropagation();

            const draggedFigure = textContent.querySelector(`.node-inline-image[data-inline-id="${inlineImageDragState.inlineId}"]`);
            if (!draggedFigure) {
                inlineImageDragState = null;
                return;
            }

            const targetFigure = de.target.closest('.node-inline-image');
            if (targetFigure && targetFigure !== draggedFigure && targetFigure.parentNode) {
                const rect = targetFigure.getBoundingClientRect();
                const placeAfter = de.clientY > rect.top + rect.height / 2;
                if (placeAfter) targetFigure.parentNode.insertBefore(draggedFigure, targetFigure.nextSibling);
                else targetFigure.parentNode.insertBefore(draggedFigure, targetFigure);
            } else {
                const range = getCaretRangeFromPoint(de.clientX, de.clientY);
                if (range && textContent.contains(range.startContainer)) {
                    range.collapse(true);
                    range.insertNode(draggedFigure);
                } else {
                    textContent.appendChild(draggedFigure);
                }
            }

            ensureInlineImageControls();
            node.html = textContent.innerHTML.trim();
            node.text = stripEditorZeroWidth(textContent.textContent || '');
            markUnsaved();
            autoResizeNode(node, el);
            selectInlineImage(node, draggedFigure);
            inlineImageDragState = null;
        });

        textContent.addEventListener('dragend', () => {
            inlineImageDragState = null;
        });

        textContent.addEventListener('click', (ce) => {
            const inlineImage = ce.target.closest('.node-inline-image');
            if (inlineImage) {
                ce.stopPropagation();
                if (selectedNode?.id !== node.id) {
                    selectNode(node);
                }

                const sel = window.getSelection();
                if (!sel || sel.isCollapsed) {
                    selectInlineImage(node, inlineImage);
                } else {
                    clearInlineImageSelection();
                    updateDeleteBtn();
                }
                return;
            }

            if (ce.detail !== 3) return;
            if (ce.target && ce.target.tagName === 'INPUT') return;

            ce.preventDefault();
            ce.stopPropagation();

            if (editingNodeId !== node.id) {
                startRichEdit();
                requestAnimationFrame(() => requestAnimationFrame(() => selectAllNodeText(textContent)));
                return;
            }

            selectAllNodeText(textContent);
        });

        textContent.addEventListener('blur', () => {
            if (preserveTextareaForFormat) {
                // Keep editor alive while interacting with format menu
                textContent.focus();
                return;
            }
            finishRichEdit();
        });

        textContent.addEventListener('keydown', (ke) => {
            ke.stopPropagation();
            if (editingNodeId !== node.id) return;

            if (selectedInlineImage?.nodeId === node.id && selectedInlineImage?.inlineId) {
                const selectedFigure = getSelectedInlineFigureElement();

                if (selectedFigure && ke.key === 'Enter') {
                    ke.preventDefault();
                    const anchor = ensureInlineImageCaretAnchorAfterFigure(selectedFigure);
                    if (anchor) {
                        const range = document.createRange();
                        range.setStart(anchor, anchor.textContent.length);
                        range.collapse(true);
                        const sel = window.getSelection();
                        if (sel) {
                            sel.removeAllRanges();
                            sel.addRange(range);
                        }
                    } else {
                        placeCaretAfterElement(selectedFigure);
                    }

                    const sel = window.getSelection();
                    if (sel && sel.rangeCount > 0) {
                        const range = sel.getRangeAt(0);
                        const br = document.createElement('br');
                        range.insertNode(br);
                        range.setStartAfter(br);
                        range.collapse(true);
                        sel.removeAllRanges();
                        sel.addRange(range);
                    }

                    clearInlineImageSelection();
                    updateDeleteBtn();
                    return;
                }

                if (selectedFigure
                    && ke.key.length === 1
                    && !ke.ctrlKey
                    && !ke.metaKey
                    && !ke.altKey) {
                    placeCaretAfterElement(selectedFigure);
                    clearInlineImageSelection();
                    updateDeleteBtn();
                }
            }

            if (ke.key === 'Escape') {
                ke.preventDefault();
                finishRichEdit();
                return;
            }

            if ((ke.key === 'Backspace' || ke.key === 'Delete')
                && selectedInlineImage?.nodeId === node.id
                && selectedInlineImage?.inlineId) {
                ke.preventDefault();
                deleteSelectedInlineImage();
                return;
            }

            if (ke.key === 'Backspace') {
                const sel = window.getSelection();
                if (sel && sel.rangeCount > 0 && sel.isCollapsed) {
                    const anchor = sel.anchorNode
                        ? (sel.anchorNode.nodeType === Node.ELEMENT_NODE ? sel.anchorNode : sel.anchorNode.parentElement)
                        : null;
                    const currentLi = anchor ? anchor.closest('ol li, ul li') : null;
                    if (currentLi) {
                        const range = sel.getRangeAt(0).cloneRange();
                        const probe = document.createRange();
                        probe.selectNodeContents(currentLi);
                        probe.setEnd(range.startContainer, range.startOffset);
                        const atLineStart = probe.toString().length === 0;

                        if (atLineStart) {
                            ke.preventDefault();
                            // Keep the text on the same line but remove list linkage
                            document.execCommand('outdent', false, null);
                            node.html = textContent.innerHTML;
                            node.text = stripEditorZeroWidth(textContent.textContent || '');
                            markUnsaved();
                            return;
                        }
                    }
                }
            }

            // Smart Enter continuation for task lists in rich editor
            if (ke.key === 'Enter') {
                const sel = window.getSelection();
                const anchor = sel && sel.anchorNode
                    ? (sel.anchorNode.nodeType === Node.ELEMENT_NODE ? sel.anchorNode : sel.anchorNode.parentElement)
                    : null;
                const currentLi = anchor ? anchor.closest('ul.task-list li') : null;
                if (currentLi) {
                    ke.preventDefault();
                    const currentText = currentLi.querySelector('.task-item-text');
                    const emptyCurrent = !currentText || !currentText.textContent.trim();

                    if (emptyCurrent) {
                        const list = currentLi.closest('ul.task-list');
                        const breakLine = document.createElement('div');
                        breakLine.innerHTML = '<br>';
                        list.parentNode.insertBefore(breakLine, list.nextSibling);
                        currentLi.remove();
                        if (!list.querySelector('li')) list.remove();
                        setCaretAtStart(breakLine);
                    } else {
                        const nextLi = document.createElement('li');
                        nextLi.innerHTML = '<input type="checkbox"> <span class="task-item-text"></span>';
                        currentLi.parentNode.insertBefore(nextLi, currentLi.nextSibling);
                        const span = nextLi.querySelector('.task-item-text');
                        setCaretAtStart(span);
                    }

                    node.html = textContent.innerHTML;
                    node.text = stripEditorZeroWidth(textContent.textContent || '');
                    markUnsaved();
                }
            }
        });

        textContent.addEventListener('keyup', (ke) => {
            if (editingNodeId !== node.id) return;
            if (ke.key === 'Backspace' || ke.key === 'Delete') {
                handleInlineRepoFileRemovalsDuringEdit(node.id, textContent);
            }
        });
    }

    // Global drag handlers attached to window to capture fast movement
    const onMouseMove = (e) => {
        if (inlineImageResizeState && textContentEl) {
            const dx = e.clientX - inlineImageResizeState.startX;
            const maxWidth = Math.max(80, node.width - 24);
            const newWidth = Math.max(80, Math.min(maxWidth, Math.round(inlineImageResizeState.startWidth + dx)));
            inlineImageResizeState.figure.style.width = `${newWidth}px`;
            return;
        }

        if (isDragging) {
            const dx = (e.clientX - startX) / scale;
            const dy = (e.clientY - startY) / scale;
            dragMovedNodeIds = new Set();
            dragIncludesGroupNode = false;

            // Multi-select drag: move all selected nodes together
            if (multiSelectedNodes.size > 0 && multiSelectedNodes.has(node.id)) {
                const dragNodeIds = new Set(Array.from(multiSelectedNodes).filter(id => {
                    const target = canvasData.nodes.find(n => n.id === id);
                    return !!target && !isNodeLocked(target);
                }));
                const selectedGroupIds = new Set();

                multiSelectedNodes.forEach(id => {
                    const selected = canvasData.nodes.find(n => n.id === id);
                    if (!selected || selected.type !== 'group') return;
                    selectedGroupIds.add(selected.id);
                    getGroupMemberNodes(selected.id)
                        .filter(member => !isNodeLocked(member))
                        .forEach(member => dragNodeIds.add(member.id));
                });

                // Cache drag origins once per drag gesture.
                if (!el._multiDragOrigins) {
                    el._multiDragOrigins = new Map();
                    dragNodeIds.forEach(id => {
                        const n = canvasData.nodes.find(nd => nd.id === id);
                        if (n) el._multiDragOrigins.set(id, { x: n.x, y: n.y });
                    });
                }

                const anchorOrigin = el._multiDragOrigins.get(node.id) || { x: origLeft, y: origTop };
                let anchorX = Math.round(anchorOrigin.x + dx);
                let anchorY = Math.round(anchorOrigin.y + dy);

                // Snap based on the dragged anchor node while moving the full selection as a block.
                const anchorSnapProbe = { ...node, x: anchorX, y: anchorY };
                const snap = getSnapGuides(anchorSnapProbe);
                if (snap.snapX !== null) anchorX = snap.snapX;
                if (snap.snapY !== null) anchorY = snap.snapY;
                renderGuides(snap.guides);

                const deltaX = anchorX - anchorOrigin.x;
                const deltaY = anchorY - anchorOrigin.y;

                dragNodeIds.forEach(id => {
                    const n = canvasData.nodes.find(nd => nd.id === id);
                    const orig = el._multiDragOrigins.get(id);
                    if (n && orig) {
                        n.x = Math.round(orig.x + deltaX);
                        n.y = Math.round(orig.y + deltaY);
                        const nel = nodesLayer.querySelector(`[data-id="${id}"]`);
                        if (nel) {
                            nel.style.left = `${n.x}px`;
                            nel.style.top = `${n.y}px`;
                        }
                        updateEdgesForNode(id);
                    }
                });
                dragMovedNodeIds = dragNodeIds;
                dragIncludesGroupNode = selectedGroupIds.size > 0;
            } else if (node.type === 'group') {
                if (!el._groupDragOrigins) {
                    el._groupDragOrigins = new Map();
                    el._groupDragOrigins.set(node.id, { x: node.x, y: node.y });
                    getGroupMemberNodes(node.id)
                        .filter(member => !isNodeLocked(member))
                        .forEach(member => {
                        el._groupDragOrigins.set(member.id, { x: member.x, y: member.y });
                    });
                }

                const anchorOrigin = el._groupDragOrigins.get(node.id) || { x: origLeft, y: origTop };
                let anchorX = Math.round(anchorOrigin.x + dx);
                let anchorY = Math.round(anchorOrigin.y + dy);

                const anchorSnapProbe = { ...node, x: anchorX, y: anchorY };
                const snap = getSnapGuides(anchorSnapProbe);
                if (snap.snapX !== null) anchorX = snap.snapX;
                if (snap.snapY !== null) anchorY = snap.snapY;
                renderGuides(snap.guides);

                const deltaX = anchorX - anchorOrigin.x;
                const deltaY = anchorY - anchorOrigin.y;

                el._groupDragOrigins.forEach((orig, id) => {
                    const n = canvasData.nodes.find(nd => nd.id === id);
                    if (!n) return;

                    n.x = Math.round(orig.x + deltaX);
                    n.y = Math.round(orig.y + deltaY);
                    const movedEl = nodesLayer.querySelector(`[data-id="${id}"]`);
                    if (movedEl) {
                        movedEl.style.left = `${n.x}px`;
                        movedEl.style.top = `${n.y}px`;
                    }
                    updateEdgesForNode(id);
                });

                dragMovedNodeIds = new Set(el._groupDragOrigins.keys());
                dragIncludesGroupNode = true;
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
                dragMovedNodeIds = new Set([node.id]);
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
        if (inlineImageResizeState && textContentEl) {
            node.html = textContentEl.innerHTML.trim();
            node.text = textContentEl.textContent || '';
            markUnsaved();
            autoResizeNode(node, el);
            inlineImageResizeState = null;
        }

        const wasResizing = isResizing;

        if (isDragging) {
            if (dragMovedNodeIds && dragMovedNodeIds.size > 0 && !dragIncludesGroupNode) {
                const movedIds = Array.from(dragMovedNodeIds);
                const membershipChanged = updateGroupMembershipForNodeIds(movedIds);
                const fitChanged = fitGroupsForNodeIds(movedIds);
                if (membershipChanged || fitChanged) {
                    markUnsaved();
                    renderCanvas();
                }
            }

            el._multiDragOrigins = null;
            el._groupDragOrigins = null;
            dragMovedNodeIds = null;
            dragIncludesGroupNode = false;
            clearGuides();
        }

        if (wasResizing && node.type !== 'group') {
            const fitChanged = fitGroupsForNodeIds([node.id]);
            if (fitChanged) {
                markUnsaved();
                renderCanvas();
            }
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

    if (type === 'text') {
        node.text = textOrFile;
        node.textAlign = 'left';
        node.verticalAlign = 'top';
    }
    if (type === 'file') node.file = textOrFile;

    if (type !== 'group') {
        const group = getContainingGroupForNode(node);
        if (group) {
            node.groupId = group.id;
        }
    }

    canvasData.nodes.push(node);
    if (node.type !== 'group' && node.groupId) {
        ensureGroupCoversMembers(node.groupId);
    }
    renderNode(node);
    selectNode(node);
    markUnsaved();
    return node;
}

// -----------------------------------------------------------------
// EDGES
// -----------------------------------------------------------------

// Compute arrowhead triangle points at the end of a bezier curve
function getArrowhead(endPoint, controlPoint, size = 10) {
    const dx = endPoint.x - controlPoint.x;
    const dy = endPoint.y - controlPoint.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / len, ny = dy / len;
    const px = -ny, py = nx;
    return [
        { x: endPoint.x, y: endPoint.y },
        { x: endPoint.x - nx * size + px * size * 0.45, y: endPoint.y - ny * size + py * size * 0.45 },
        { x: endPoint.x - nx * size - px * size * 0.45, y: endPoint.y - ny * size - py * size * 0.45 }
    ];
}

function renderEdge(edge) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.dataset.id = edge.id;
    g.setAttribute('class', 'canvas-edge-group');

    const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hitPath.setAttribute('class', 'canvas-edge-hit');
    hitPath.setAttribute('fill', 'none');
    hitPath.setAttribute('stroke', 'transparent');
    hitPath.setAttribute('stroke-width', '14');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'canvas-edge');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-width', '2.5');
    path.setAttribute('stroke', edge.color || '#8fa3c7');

    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    arrow.setAttribute('class', 'canvas-edge-arrow');
    arrow.setAttribute('fill', edge.color || '#8fa3c7');

    g.appendChild(hitPath);
    g.appendChild(path);
    g.appendChild(arrow);

    g.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        selectEdge(edge);
    });

    edgesLayer.appendChild(g);
    updateEdgePath(edge, g);

    if (edge.id === selectedEdge?.id) {
        g.classList.add('selected');
    }
}

function updateEdgePath(edge, groupEl) {
    if (!groupEl) {
        groupEl = edgesLayer.querySelector(`g[data-id="${edge.id}"]`);
        if (!groupEl) return;
    }

    const fromNode = canvasData.nodes.find(n => n.id === edge.fromNode);
    const toNode = canvasData.nodes.find(n => n.id === edge.toNode);
    if (!fromNode || !toNode) return;

    const p1 = getPortPoint(fromNode, edge.fromSide);
    const p2 = getPortPoint(toNode, edge.toSide);

    const hitEl = groupEl.querySelector('.canvas-edge-hit');
    const pathEl = groupEl.querySelector('.canvas-edge');
    const arrowEl = groupEl.querySelector('.canvas-edge-arrow');

    // Draw cubic bezier
    const result = getBezierPath(p1, p2, edge.fromSide, edge.toSide);
    if (hitEl) hitEl.setAttribute('d', result.d);
    pathEl.setAttribute('d', result.d);
    if (edge.color) pathEl.setAttribute('stroke', edge.color);

    // Draw arrowhead triangle at endpoint
    const tri = getArrowhead(p2, result.cp2);
    arrowEl.setAttribute('points', tri.map(p => `${p.x},${p.y}`).join(' '));
    if (edge.color) arrowEl.setAttribute('fill', edge.color);
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

    const result = getBezierPath(p1, p2, drawEdgeStartSide, 'left');
    drawingEdge.setAttribute('d', result.d);
    drawingEdge.setAttribute('stroke', '#8fa3c7');

    // Update drawing arrowhead
    const tri = getArrowhead(p2, result.cp2, 8);
    drawingArrow.setAttribute('fill', '#8fa3c7');
    drawingArrow.setAttribute('points', tri.map(p => `${p.x},${p.y}`).join(' '));
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

function getOppositeSide(side) {
    if (side === 'left') return 'right';
    if (side === 'right') return 'left';
    if (side === 'top') return 'bottom';
    if (side === 'bottom') return 'top';
    return 'left';
}

function getSmartTargetSideForPendingEdge(pending, newNode) {
    if (!pending || !newNode) return 'left';

    const fromNode = canvasData.nodes.find(n => n.id === pending.fromNode);
    if (!fromNode) return getOppositeSide(pending.fromSide);

    const fromPoint = getPortPoint(fromNode, pending.fromSide);
    const targetCenterX = newNode.x + newNode.width / 2;
    const targetCenterY = newNode.y + newNode.height / 2;
    const dx = targetCenterX - fromPoint.x;
    const dy = targetCenterY - fromPoint.y;

    if (Math.abs(dx) >= Math.abs(dy)) {
        return dx >= 0 ? 'left' : 'right';
    }
    return dy >= 0 ? 'top' : 'bottom';
}

function connectPendingEdgeToNode(newNode) {
    const pending = window._pendingEdgeConnect;
    if (!pending || !newNode) return;

    const toSide = getSmartTargetSideForPendingEdge(pending, newNode);
    createEdge(pending.fromNode, pending.fromSide, newNode.id, toSide);
    window._pendingEdgeConnect = null;
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
    const dist = Math.sqrt(dx * dx + dy * dy);
    const weight = Math.min(Math.max(dist * 0.5, 60), 300);

    let cp1 = { ...p1 }, cp2 = { ...p2 };

    if (side1 === 'right') cp1.x += weight;
    if (side1 === 'left') cp1.x -= weight;
    if (side1 === 'bottom') cp1.y += weight;
    if (side1 === 'top') cp1.y -= weight;

    if (side2 === 'right') cp2.x += weight;
    if (side2 === 'left') cp2.x -= weight;
    if (side2 === 'bottom') cp2.y += weight;
    if (side2 === 'top') cp2.y -= weight;

    return {
        d: `M ${p1.x} ${p1.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${p2.x} ${p2.y}`,
        cp2: cp2
    };
}

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
    clearInlineImageSelection();

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
    const linkMenu = container.querySelector('#node-link-menu');
    if (formatMenu) formatMenu.hidden = true;
    if (palette) palette.hidden = true;
    if (linkMenu) linkMenu.hidden = true;
}

function showNodeToolbar(node, el) {
    if (!nodeToolbar) return;

    nodeToolbar.querySelectorAll('.node-toolbar-btn').forEach(btn => {
        const isLinkButton = btn.id === 'nt-link';
        btn.hidden = !isOwner && !isLinkButton;
    });
    nodeToolbar.querySelectorAll('.node-toolbar-sep').forEach(sep => {
        sep.hidden = !isOwner;
    });

    const quickFormatRow = nodeToolbar.querySelector('#node-toolbar-format-row');
    const showTextFormatControls = !!isOwner && node?.type === 'text' && !isNodeLocked(node);
    if (quickFormatRow) {
        quickFormatRow.hidden = !showTextFormatControls;
        quickFormatRow.style.cssText = showTextFormatControls
            ? 'display:grid;grid-template-columns:repeat(9, minmax(0, 1fr));gap:3px;width:100%;margin-top:3px;padding-top:3px;border-top:1px solid var(--canvas-node-border);align-items:stretch;justify-items:stretch;'
            : '';
    }
    nodeToolbar.classList.toggle('has-format-row', showTextFormatControls);
    if (showTextFormatControls) {
        nodeToolbar.style.width = '252px';
        nodeToolbar.style.maxWidth = '252px';
        nodeToolbar.style.flexWrap = 'wrap';
        // Keep sizing enforced in JS, but leave visual states to CSS so hover still works.
        quickFormatRow.querySelectorAll('.node-toolbar-format-btn').forEach(btn => {
            btn.style.cssText = 'height:22px;min-width:0;width:100%;padding:0;font-size:9px;line-height:1;';
            const svg = btn.querySelector('svg');
            if (svg) { svg.style.width = '12px'; svg.style.height = '12px'; }
            if (btn.classList.contains('node-toolbar-format-text')) {
                btn.style.fontWeight = '700';
                btn.style.letterSpacing = '0.02em';
            }
        });
    } else {
        nodeToolbar.style.width = '';
        nodeToolbar.style.maxWidth = '';
    }

    // Viewers should still see non-edit actions (e.g., link), while owner actions stay hidden.
    const hasVisibleAction = Array.from(nodeToolbar.querySelectorAll('.node-toolbar-btn'))
        .some(btn => !btn.hidden && window.getComputedStyle(btn).display !== 'none');
    if (!hasVisibleAction) return;

    hideForeignNodeToolbars();

    // Calculate the top-center position of the node in viewport coordinates
    const vX = translateX + (node.x * scale) + (node.width * scale) / 2;
    const vY = translateY + (node.y * scale);

    // Anchor toolbar above node regardless of toolbar height.
    nodeToolbar.style.left = `${vX}px`;
    nodeToolbar.style.top = `${vY}px`;
    nodeToolbar.style.transform = 'translate(-50%, -100%)';
    nodeToolbar.style.display = 'flex';
    nodeToolbar.hidden = false;

    const locked = !!node?.locked;
    ['#nt-color', '#nt-edit', '#nt-image', '#nt-disconnect'].forEach(sel => {
        const btn = nodeToolbar.querySelector(sel);
        if (btn) {
            btn.disabled = locked;
        }
    });
}

function hideNodeToolbar() {
    if (nodeToolbar) {
        hideForeignNodeToolbars();
        nodeToolbar.hidden = true;
        nodeToolbar.style.display = 'none';
        nodeToolbar.style.width = '';
        nodeToolbar.style.maxWidth = '';
        nodeToolbar.classList.remove('has-format-row');
        nodeToolbar.querySelector('#node-color-palette').hidden = true;
        const quickFormatRow = nodeToolbar.querySelector('#node-toolbar-format-row');
        if (quickFormatRow) { quickFormatRow.hidden = true; quickFormatRow.style.cssText = ''; }
        const formatMenu = container.querySelector('#node-format-menu');
        const linkMenu = container.querySelector('#node-link-menu');
        if (formatMenu) formatMenu.hidden = true;
        if (linkMenu) linkMenu.hidden = true;

        ['#nt-color', '#nt-edit', '#nt-image', '#nt-disconnect'].forEach(sel => {
            const btn = nodeToolbar.querySelector(sel);
            if (btn) btn.disabled = false;
        });
    }
}

function hideForeignNodeToolbars() {
    document.querySelectorAll('#canvas-node-toolbar').forEach(tb => {
        if (tb !== nodeToolbar) {
            tb.hidden = true;
            tb.style.display = 'none';
        }
    });
    document.querySelectorAll('#node-format-menu').forEach(menu => {
        if (!nodeToolbar || !nodeToolbar.contains(menu)) {
            menu.hidden = true;
            menu.style.display = 'none';
        }
    });
    document.querySelectorAll('#node-link-menu').forEach(menu => {
        if (!nodeToolbar || !nodeToolbar.contains(menu)) {
            menu.hidden = true;
            menu.style.display = 'none';
        }
    });
}

function setupNodeToolbar() {
    if (!nodeToolbar) return;

    nodeToolbar.querySelector('#nt-delete').addEventListener('click', deleteSelected);

    const palette = nodeToolbar.querySelector('#node-color-palette');
    const formatMenu = nodeToolbar.querySelector('#node-format-menu');
    const quickFormatRow = nodeToolbar.querySelector('#node-toolbar-format-row');
    const linkMenu = nodeToolbar.querySelector('#node-link-menu');
    const linkShareBtn = nodeToolbar.querySelector('#nt-link-share-chat');
    const linkCopyBtn = nodeToolbar.querySelector('#nt-link-copy-url');
    nodeToolbar.querySelector('#nt-color').addEventListener('click', () => {
        if (!isOwner) return;
        if (selectedNode && isNodeLocked(selectedNode)) {
            window.uiToast?.('Unlock node to change color', 'info');
            return;
        }
        palette.hidden = !palette.hidden;
        if (formatMenu) formatMenu.hidden = true;
        if (linkMenu) linkMenu.hidden = true;
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
        if (!isOwner) return;
        if (!selectedNode) return;
        if (isNodeLocked(selectedNode)) {
            window.uiToast?.('Unlock node to edit', 'info');
            return;
        }
        if (selectedNode.type === 'text') {
            const el = nodesLayer.querySelector(`[data-id="${selectedNode.id}"]`);
            const textContent = el.querySelector('.node-content-text');
            if (textContent) {
                // Simulate a double click to trigger the existing edit logic
                textContent.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            }
        } else if (selectedNode.type === 'file') {
            // Rename image file
            const currentName = selectedNode.file ? selectedNode.file.split('/').pop() : '';
            const newName = prompt('Rename image:', currentName);
            if (newName && newName !== currentName) {
                const dir = selectedNode.file ? selectedNode.file.substring(0, selectedNode.file.lastIndexOf('/') + 1) : 'canvas_uploads/';
                selectedNode.file = dir + newName;
                markUnsaved();
                renderCanvas();
                // Re-select the node to update toolbar
                selectNode(selectedNode);
            }
        } else if (selectedNode.type === 'group') {
            const groupId = selectedNode.id;
            requestAnimationFrame(() => {
                const titleEl = nodesLayer?.querySelector(`[data-id="${groupId}"] .group-title`);
                if (titleEl) {
                    titleEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
                }
            });
        }
    });

    // Import image button — open file picker for selected node
    nodeToolbar.querySelector('#nt-image')?.addEventListener('click', () => {
        if (!isOwner) return;
        if (!selectedNode) return;
        if (isNodeLocked(selectedNode)) {
            window.uiToast?.('Unlock node to import image', 'info');
            return;
        }
        const input = container.querySelector('#canvas-upload-image');
        clearPendingInlineImageMarker();

        window._targetImageNode = selectedNode.id;

        if (selectedNode.type === 'text') {
            const nodeEl = nodesLayer.querySelector(`[data-id="${selectedNode.id}"]`);
            const textContent = nodeEl?.querySelector('.node-content-text');
            if (nodeEl && textContent && editingNodeId !== selectedNode.id) {
                nodeEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            }

            const activeText = nodeEl?.querySelector('.node-content-text');
            if (activeText) {
                activeText.focus();
                placeInlineImageMarker(activeText, selectedNode.id);
            }

            window._targetImageMode = 'inline-text';
            preserveTextareaForFormat = true;
            window.addEventListener('focus', () => {
                preserveTextareaForFormat = false;
            }, { once: true });
        } else {
            window._targetImageMode = 'file-node';
        }

        input.click();
    });

    // Link button — open share menu
    nodeToolbar.querySelector('#nt-link')?.addEventListener('click', () => {
        if (!selectedNode) return;
        if (!linkMenu) {
            generateAndInsertNodeLink(selectedNode);
            return;
        }
        linkMenu.hidden = !linkMenu.hidden;
    });

    linkShareBtn?.addEventListener('click', () => {
        if (!selectedNode) return;
        generateAndInsertNodeLink(selectedNode);
        if (linkMenu) linkMenu.hidden = true;
    });

    linkCopyBtn?.addEventListener('click', () => {
        if (!selectedNode) return;
        copyExternalNodeLink(selectedNode);
        if (linkMenu) linkMenu.hidden = true;
    });

    // Disconnect button — remove all edges connected to selected node
    nodeToolbar.querySelector('#nt-disconnect')?.addEventListener('click', () => {
        if (!isOwner) return;
        if (!selectedNode) return;
        if (isNodeLocked(selectedNode)) {
            window.uiToast?.('Unlock node to edit connections', 'info');
            return;
        }
        disconnectSelectedNodeEdges();
    });

    // Setup color swatches
    nodeToolbar.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', (e) => {
            if (!isOwner) return;
            if (!selectedNode) return;
            if (isNodeLocked(selectedNode)) {
                window.uiToast?.('Unlock node to change color', 'info');
                return;
            }
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

    if (formatMenu) {
        formatMenu.addEventListener('mousedown', () => {
            preserveTextareaForFormat = true;
        });
    }

    // Close menus when clicking on empty canvas (but not when clicking on node or format items)
    viewport.addEventListener('mousedown', (e) => {
        if (e.button === 0 && !e.target.closest('.node-format-menu') && !e.target.closest('.node-color-palette') && !e.target.closest('.canvas-node')) {
            if (formatMenu) formatMenu.hidden = true;
            palette.hidden = true;
            if (linkMenu) linkMenu.hidden = true;
        }
    });

    function escapeHtml(text) {
        return (text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function ensureActiveRichEditor() {
        if (!selectedNode || selectedNode.type !== 'text') return null;
        if (isNodeLocked(selectedNode)) return null;
        const nodeEl = nodesLayer.querySelector(`[data-id="${selectedNode.id}"]`);
        if (!nodeEl) return null;
        const editor = nodeEl.querySelector('.node-content-text');
        if (!editor) return null;

        if (editingNodeId !== selectedNode.id) {
            editor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        }

        editor.focus();
        return editor;
    }

    function selectionRangeBelongsToEditor(editor, range) {
        if (!editor || !range) return false;
        return editor.contains(range.commonAncestorContainer)
            || editor.contains(range.startContainer)
            || editor.contains(range.endContainer);
    }

    function rangeIntersectsNode(range, node) {
        if (!range || !node) return false;

        const nodeRange = document.createRange();
        try {
            nodeRange.selectNode(node);
        } catch {
            nodeRange.selectNodeContents(node);
        }

        return range.compareBoundaryPoints(Range.END_TO_START, nodeRange) > 0
            && range.compareBoundaryPoints(Range.START_TO_END, nodeRange) < 0;
    }

    function getElementDepthWithinRoot(el, root) {
        let depth = 0;
        let current = el;
        while (current && current !== root) {
            depth += 1;
            current = current.parentElement;
        }
        return depth;
    }

    function unwrapElement(el) {
        if (!el || !el.parentNode) return;
        const parent = el.parentNode;
        while (el.firstChild) {
            parent.insertBefore(el.firstChild, el);
        }
        el.remove();
    }

    function replaceElementTag(el, tagName) {
        if (!el || !el.parentNode) return null;

        const replacement = document.createElement(tagName);
        while (el.firstChild) {
            replacement.appendChild(el.firstChild);
        }
        el.parentNode.replaceChild(replacement, el);
        return replacement;
    }

    function clearListItemFormatting(el) {
        if (!el || !el.parentNode) return null;

        const replacement = document.createElement('div');
        Array.from(el.childNodes).forEach(child => {
            if (child.nodeType === Node.ELEMENT_NODE && child.matches('input[type="checkbox"]')) {
                return;
            }

            if (child.nodeType === Node.ELEMENT_NODE && child.classList?.contains('task-item-text')) {
                while (child.firstChild) {
                    replacement.appendChild(child.firstChild);
                }
                child.remove();
                return;
            }

            replacement.appendChild(child);
        });

        el.parentNode.replaceChild(replacement, el);
        return replacement;
    }

    function clearFormattingElement(el) {
        if (!el || !el.isConnected) return;
        if (el.matches('.node-placeholder, [data-inline-image-marker], .node-inline-image-resizer')) return;

        const tag = el.tagName;
        if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'BLOCKQUOTE' || tag === 'PRE') {
            replaceElementTag(el, 'div');
            return;
        }

        if (tag === 'LI') {
            clearListItemFormatting(el);
            return;
        }

        if (
            tag === 'UL'
            || tag === 'OL'
            || tag === 'A'
            || tag === 'B'
            || tag === 'STRONG'
            || tag === 'I'
            || tag === 'EM'
            || tag === 'U'
            || tag === 'S'
            || tag === 'STRIKE'
            || tag === 'CODE'
            || tag === 'SPAN'
            || tag === 'FONT'
            || tag === 'MARK'
            || tag === 'SUB'
            || tag === 'SUP'
        ) {
            unwrapElement(el);
        }
    }

    function collectFormattingElementsInRange(editor, range) {
        if (!editor || !range) return [];

        const selector = 'h1, h2, h3, blockquote, pre, ul, ol, li, a, b, strong, i, em, u, s, strike, code, span, font, mark, sub, sup';
        const matches = new Set();

        [range.startContainer, range.endContainer].forEach(node => {
            let current = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
            while (current && current !== editor) {
                if (current.matches?.(selector)) {
                    matches.add(current);
                }
                current = current.parentElement;
            }
        });

        editor.querySelectorAll(selector).forEach(el => {
            if (rangeIntersectsNode(range, el)) {
                matches.add(el);
            }
        });

        return Array.from(matches)
            .sort((a, b) => getElementDepthWithinRoot(b, editor) - getElementDepthWithinRoot(a, editor));
    }

    function clearFormattingInEditorSelection(editor) {
        const sel = window.getSelection();
        if (!editor || !sel || sel.rangeCount === 0) return false;

        const range = sel.getRangeAt(0);
        if (!selectionRangeBelongsToEditor(editor, range)) return false;

        // removeFormat handles inline styles, but not block wrappers like H1/blockquote or list markup.
        document.execCommand('removeFormat', false, null);
        document.execCommand('unlink', false, null);

        collectFormattingElementsInRange(editor, range).forEach(clearFormattingElement);

        editor.normalize();
        normalizeInlineImagesInTextElement(editor, { draggable: editingNodeId === selectedNode?.id });
        return true;
    }

    function applyFormatToRichEditor(editor, fmt) {
        if (!selectedNode || selectedNode.type !== 'text') return;
        if (isNodeLocked(selectedNode)) return;

        if (fmt === 'align-left' || fmt === 'align-center' || fmt === 'align-right') {
            selectedNode.textAlign = fmt.replace('align-', '');
            applyNodeTextAlignment(selectedNode, editor);
            return;
        }

        if (fmt === 'valign-top' || fmt === 'valign-center' || fmt === 'valign-bottom') {
            selectedNode.verticalAlign = fmt.replace('valign-', '');
            applyNodeTextAlignment(selectedNode, editor);
            return;
        }

        const sel = window.getSelection();
        const selectedText = sel ? sel.toString() : '';

        if (fmt === 'clear') {
            if (!clearFormattingInEditorSelection(editor)) {
                document.execCommand('removeFormat', false, null);
                document.execCommand('unlink', false, null);
            }
            return;
        }

        if (fmt === 'bold') {
            document.execCommand('bold', false, null);
            return;
        }
        if (fmt === 'italic') {
            document.execCommand('italic', false, null);
            return;
        }
        if (fmt === 'ul') {
            document.execCommand('insertUnorderedList', false, null);
            return;
        }
        if (fmt === 'ol') {
            document.execCommand('insertOrderedList', false, null);
            return;
        }
        if (fmt === 'h1' || fmt === 'h2' || fmt === 'h3' || fmt === 'quote') {
            const tag = fmt === 'h1' ? 'H1' : fmt === 'h2' ? 'H2' : fmt === 'h3' ? 'H3' : 'BLOCKQUOTE';
            document.execCommand('formatBlock', false, tag);
            return;
        }
        if (fmt === 'code') {
            const codeText = selectedText || '';
            document.execCommand('insertHTML', false, `<code>${escapeHtml(codeText)}</code>`);
            return;
        }
        if (fmt === 'link') {
            const url = prompt('Enter URL:', 'https://');
            if (!url) return;
            if (selectedText) {
                document.execCommand('createLink', false, url);
            } else {
                const safeUrl = escapeHtml(url);
                document.execCommand('insertHTML', false, `<a href="${safeUrl}" target="_blank" rel="noopener">${safeUrl}</a>`);
            }
            return;
        }
        if (fmt === 'task') {
            const lines = (selectedText || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
            const items = (lines.length ? lines : ['']).map(line => {
                return `<li><input type="checkbox"> <span class="task-item-text">${escapeHtml(line)}</span></li>`;
            }).join('');
            document.execCommand('insertHTML', false, `<ul class="task-list">${items}</ul>`);
            return;
        }
    }

    function applyTextFormatAction(fmt, options = {}) {
        if (!isOwner) {
            preserveTextareaForFormat = false;
            return false;
        }
        if (!selectedNode || selectedNode.type !== 'text') {
            preserveTextareaForFormat = false;
            return false;
        }

        const closeMenu = options.closeMenu !== false;

        if (fmt.startsWith('align-') || fmt.startsWith('valign-')) {
            const nodeEl = nodesLayer.querySelector(`[data-id="${selectedNode.id}"]`);
            const textEl = nodeEl?.querySelector('.node-content-text');
            if (textEl) {
                applyFormatToRichEditor(textEl, fmt);
                markUnsaved();
            }

            preserveTextareaForFormat = false;
            if (closeMenu && formatMenu) formatMenu.hidden = true;
            return !!textEl;
        }

        const editor = ensureActiveRichEditor();
        if (!editor) {
            preserveTextareaForFormat = false;
            if (closeMenu && formatMenu) formatMenu.hidden = true;
            return false;
        }

        applyFormatToRichEditor(editor, fmt);

        selectedNode.html = editor.innerHTML;
        selectedNode.text = editor.textContent || '';

        preserveTextareaForFormat = false;
        if (closeMenu && formatMenu) formatMenu.hidden = true;
        markUnsaved();
        return true;
    }

    if (quickFormatRow) {
        quickFormatRow.addEventListener('mousedown', (e) => {
            const quickBtn = e.target.closest('.node-toolbar-format-btn');
            if (!quickBtn) return;

            // Keep text selection active while clicking quick formatting controls.
            preserveTextareaForFormat = true;
            e.preventDefault();
            e.stopPropagation();
        });

        quickFormatRow.querySelectorAll('.node-toolbar-format-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const fmt = btn.dataset.format;
                if (!fmt) {
                    preserveTextareaForFormat = false;
                    return;
                }

                applyTextFormatAction(fmt, { closeMenu: false });
            });
        });
    }

    // Handle format actions
    if (formatMenu) {
        formatMenu.querySelectorAll('.format-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const fmt = e.target.closest('.format-item')?.dataset.format;
                if (!fmt) {
                    preserveTextareaForFormat = false;
                    return;
                }
                applyTextFormatAction(fmt, { closeMenu: true });
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
        const isCtrlOrCmd = e.ctrlKey || e.metaKey;

        // Ignore if typing in text box (except Ctrl shortcuts)
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
            // Allow Ctrl+F even in inputs
            if (isCtrlOrCmd && e.key === 'f') {
                e.preventDefault();
                openSearch();
            }
            return;
        }

        if (e.key === 'Delete' || e.key === 'Backspace') {
            deleteSelected();
        } else if (isCtrlOrCmd && (e.key === 'c' || e.key === 'C')) {
            e.preventDefault();
            copySelectedToClipboard();
        } else if (isCtrlOrCmd && (e.key === 'v' || e.key === 'V')) {
            pendingClipboardNodePaste = !!(canvasClipboard && Array.isArray(canvasClipboard.nodes) && canvasClipboard.nodes.length > 0);

            // Do not block native paste. The paste event handler decides whether to
            // paste nodes, upload image clipboard content, or allow text paste.
            if (pendingClipboardNodePaste) {
                setTimeout(() => {
                    if (!pendingClipboardNodePaste) return;
                    pendingClipboardNodePaste = false;
                    pasteFromClipboard();
                }, 0);
            }
        } else if (isCtrlOrCmd && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            saveCanvasData(false);
        } else if (isCtrlOrCmd && (e.key === 'd' || e.key === 'D')) {
            e.preventDefault();
            duplicateSelected();
        } else if (isCtrlOrCmd && (e.key === 'g' || e.key === 'G')) {
            e.preventDefault();

            const selectedIds = Array.from(getCurrentSelectionNodeIds());
            const memberIds = selectedIds.filter(id => {
                const node = canvasData.nodes.find(n => n.id === id);
                return !!node && node.type !== 'group' && !isNodeLocked(node);
            });

            if (memberIds.length < 2) {
                window.uiToast('Select at least two unlocked non-group nodes to group', 'info');
                return;
            }

            const selectedNodes = selectedIds
                .map(id => canvasData.nodes.find(n => n.id === id))
                .filter(Boolean);

            const fallbackX = (viewport.clientWidth / 2 - translateX) / scale;
            const fallbackY = (viewport.clientHeight / 2 - translateY) / scale;
            const anchorX = selectedNodes.length > 0 ? selectedNodes[0].x : fallbackX;
            const anchorY = selectedNodes.length > 0 ? selectedNodes[0].y : fallbackY;

            pushHistory();
            const newGroup = createGroupFromSelectionAt(anchorX, anchorY, {
                boundsNodeIds: selectedIds,
                memberNodeIds: memberIds,
            });

            markUnsaved();
            renderCanvas();

            const refreshed = newGroup ? canvasData.nodes.find(n => n.id === newGroup.id) : null;
            if (refreshed) {
                selectNode(refreshed);
            }
        } else if (isCtrlOrCmd && (e.key === 'f' || e.key === 'F')) {
            e.preventDefault();
            openSearch();
        } else if (e.key === 'v' || e.key === 'V') {
            setTool('select');
        } else if (e.key === 't' || e.key === 'T') {
            setTool('text');
        } else if (e.key === 'e' || e.key === 'E') {
            setTool('edge');
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
        preserveTextareaForFormat = false;
        const file = e.target.files[0];
        if (!file) {
            clearPendingInlineImageMarker();
            window._targetImageNode = null;
            window._targetImageMode = null;
            return;
        }

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

    const targetTag = e.target?.tagName;
    const isInputLike = targetTag === 'INPUT' || targetTag === 'TEXTAREA';
    const clipboard = e.clipboardData || e.originalEvent?.clipboardData;
    const items = Array.from(clipboard?.items || []);

    // Ignore if pasting into text inputs (chat, forms)
    if (isInputLike) {
        pendingClipboardNodePaste = false;
        return;
    }

    const activeTextEditor = e.target?.closest?.('.node-content-text.editing');
    const activeTextNodeId = activeTextEditor?.dataset?.id || null;

    // Clipboard image paste inserts inline when editing a text node.
    const imageItem = items.find(item => item.kind === 'file' && item.type.startsWith('image/'));
    if (imageItem) {
        e.preventDefault();
        pendingClipboardNodePaste = false;

        const blob = imageItem.getAsFile();
        if (!blob) return;

        const ext = blob.type.split('/')[1] || 'png';
        const filename = getUniqueCanvasUploadFilename(`pasted_image_${Date.now()}.${ext}`);

        if (activeTextEditor && activeTextNodeId) {
            window._targetImageNode = activeTextNodeId;
            window._targetImageMode = 'inline-text';
            activeTextEditor.focus();
            placeInlineImageMarker(activeTextEditor, activeTextNodeId);
            const activeNode = canvasData.nodes.find(n => n.id === activeTextNodeId);
            if (activeNode) selectedNode = activeNode;
        } else {
            clearPendingInlineImageMarker();
            window._targetImageNode = null;
            window._targetImageMode = null;
        }

        await uploadAndAddImage(blob, filename);
        return;
    }

    // Let native paste flow for active rich-text node editing.
    if (e.target.isContentEditable) {
        pendingClipboardNodePaste = false;
        return;
    }

    // If Ctrl+V was intended for node clipboard, consume this paste and paste nodes.
    if (pendingClipboardNodePaste && canvasClipboard && Array.isArray(canvasClipboard.nodes) && canvasClipboard.nodes.length > 0) {
        e.preventDefault();
        pendingClipboardNodePaste = false;
        pasteFromClipboard();
        return;
    }

    pendingClipboardNodePaste = false;
}

function getUniqueCanvasUploadFilename(originalName) {
    const raw = (originalName || '').trim() || `image_${Date.now()}.png`;
    const cleaned = raw.replace(/[\\/:*?"<>|]/g, '_');

    const dot = cleaned.lastIndexOf('.');
    const base = (dot > 0 ? cleaned.substring(0, dot) : cleaned) || `image_${Date.now()}`;
    const ext = dot > 0 ? cleaned.substring(dot + 1).toLowerCase() : 'png';

    let candidate = `${base}.${ext}`;
    let i = 1;
    while (canvasData.nodes.some(n => n.type === 'file' && n.file === `canvas_uploads/${candidate}`)) {
        candidate = `${base}_${i}.${ext}`;
        i += 1;
    }
    return candidate;
}

async function uploadAndAddImage(file, filename, dropPos = null) {
    // Convert to base64
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async () => {
            const base64Data = reader.result.split(',')[1];
            showOverlay('Uploading image...');
            try {
                const repoPath = `canvas_uploads/${filename}`;
                await githubApi.saveFile(repoPath, base64Data, `Upload ${filename} to canvas`, true);

                const targetNodeId = window._targetImageNode;
                const targetMode = window._targetImageMode || 'file-node';
                const targetMarkerId = pendingInlineImageMarkerId;

                let node;
                if (targetNodeId) {
                    node = canvasData.nodes.find(n => n.id === targetNodeId);
                    if (node) {
                        pushHistory();
                        let needsRender = false;

                        if (targetMode === 'inline-text' && node.type === 'text') {
                            const inserted = insertInlineImageIntoTextNode(node, repoPath, targetMarkerId);
                            if (!inserted) {
                                node.type = 'file';
                                delete node.text;
                                delete node.html;
                                node.file = repoPath;
                                node._tempBase64 = reader.result;
                                needsRender = true;
                            } else {
                                markUnsaved();
                                const nodeEl = nodesLayer?.querySelector(`[data-id="${node.id}"]`);
                                if (nodeEl) {
                                    autoResizeNode(node, nodeEl);
                                    if (selectedNode?.id === node.id) {
                                        showNodeToolbar(node, nodeEl);
                                    }
                                }
                            }
                        } else {
                            // Convert text node to file node if needed
                            if (node.type === 'text') {
                                node.type = 'file';
                                delete node.text;
                                delete node.html;
                            }
                            node.file = repoPath;
                            node._tempBase64 = reader.result; // Set BEFORE render for immediate preview
                            needsRender = true;
                        }

                        if (needsRender) {
                            markUnsaved();
                            renderCanvas();

                            const refreshed = canvasData.nodes.find(n => n.id === node.id);
                            if (refreshed) selectNode(refreshed);
                        }
                    }
                    clearPendingInlineImageMarker(node || null);
                    window._targetImageNode = null;
                    window._targetImageMode = null;
                } else {
                    clearPendingInlineImageMarker();

                    // Add to drop point when available, otherwise at center of viewport.
                    let x;
                    let y;
                    if (dropPos && Number.isFinite(dropPos.x) && Number.isFinite(dropPos.y)) {
                        x = dropPos.x;
                        y = dropPos.y;
                    } else {
                        const rect = viewport.getBoundingClientRect();
                        x = (rect.width / 2 - translateX) / scale;
                        y = (rect.height / 2 - translateY) / scale;
                    }
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
                clearPendingInlineImageMarker();
                window._targetImageNode = null;
                window._targetImageMode = null;
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

function collectRepoFilesFromNodes(nodes) {
    return [...new Set((nodes || []).flatMap(n => {
        if (n.type === 'file' && typeof n.file === 'string' && n.file.startsWith('canvas_uploads/')) {
            return [n.file];
        }
        if (n.type === 'text') {
            return getInlineImageRepoFilesFromTextNode(n);
        }
        return [];
    }))];
}

function deleteNodesByIds(nodeIds) {
    const ids = nodeIds instanceof Set ? new Set(nodeIds) : new Set(nodeIds || []);
    if (ids.size === 0) return false;

    const nodesToDelete = canvasData.nodes.filter(n => ids.has(n.id));
    if (nodesToDelete.length === 0) return false;

    hideNodeToolbar();

    const deletedGroupIds = new Set(
        nodesToDelete.filter(n => n.type === 'group').map(n => n.id)
    );
    const affectedGroupIds = new Set(
        nodesToDelete
            .filter(n => n.type !== 'group' && typeof n.groupId === 'string' && n.groupId)
            .map(n => n.groupId)
    );

    // Default behavior: deleting a group keeps member nodes by clearing membership.
    deletedGroupIds.forEach(groupId => {
        clearGroupMembershipForGroup(groupId, ids);
    });

    // Delete associated edges for every selected node.
    canvasData.edges = canvasData.edges.filter(e => !ids.has(e.fromNode) && !ids.has(e.toNode));

    const imageFiles = collectRepoFilesFromNodes(nodesToDelete);

    nodesToDelete.forEach(n => {
        inlineRepoFilesAtEditStart.delete(n.id);
        inlineRepoFilesHandledInEdit.delete(n.id);
        inlineRepoFilesLastSeenInEdit.delete(n.id);
    });

    if (editingNodeId && ids.has(editingNodeId)) {
        editingNodeId = null;
        preserveTextareaForFormat = false;
    }

    canvasData.nodes = canvasData.nodes.filter(n => !ids.has(n.id));

    sanitizeGroupMembership();
    ensureGroupsCoverMembers(Array.from(affectedGroupIds));

    if (selectedInlineImage?.nodeId && ids.has(selectedInlineImage.nodeId)) {
        clearInlineImageSelection();
    }

    promptDeleteRepoFiles(imageFiles);

    markUnsaved();
    clearSelection();
    renderCanvas();
    return true;
}

function deleteSelected() {
    if (!isOwner) return;

    if (selectedInlineImage) {
        if (deleteSelectedInlineImage()) return;
    }

    const selectedNodeIds = multiSelectedNodes.size > 0
        ? new Set(multiSelectedNodes)
        : (selectedNode ? new Set([selectedNode.id]) : null);

    if (selectedNodeIds && selectedNodeIds.size > 0) {
        pushHistory();
        deleteNodesByIds(selectedNodeIds);
        return;
    } else if (selectedEdge) {
        pushHistory();
        canvasData.edges = canvasData.edges.filter(e => e.id !== selectedEdge.id);
        markUnsaved();
        clearSelection();
        renderCanvas();
    }
}

function disconnectSelectedNodeEdges() {
    if (!isOwner || !selectedNode) return;

    const nodeId = selectedNode.id;
    const before = canvasData.edges.length;
    if (before === 0) return;

    pushHistory();
    canvasData.edges = canvasData.edges.filter(e => e.fromNode !== nodeId && e.toNode !== nodeId);

    if (canvasData.edges.length !== before) {
        markUnsaved();
        renderCanvas();
        const refreshed = canvasData.nodes.find(n => n.id === nodeId);
        if (refreshed) selectNode(refreshed);
        window.uiToast('Node connections removed', 'success');
    }
}

function updateDeleteBtn() {
    const btn = container.querySelector('#canvas-delete-selected');
    if (btn) btn.disabled = (!selectedNode && !selectedEdge && multiSelectedNodes.size === 0 && !selectedInlineImage);
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
        fitCanvasToScreen(true);
    });
}

function fitCanvasToScreen(animate = true) {
    if (canvasData.nodes.length === 0) {
        if (!animate) updateTransform();
        return false;
    }

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

    if (animate) {
        animateTo(targetScale, targetTX, targetTY);
    } else {
        scale = targetScale;
        translateX = targetTX;
        translateY = targetTY;
        updateTransform();
    }
    return true;
}

function applyInitialViewportPolicy() {
    const run = () => {
        if (!viewport || !container || !container.isConnected) return;
        const rect = viewport.getBoundingClientRect();
        const viewportStyle = window.getComputedStyle(viewport);
        const isMeasurable = rect.width >= 32 && rect.height >= 32 && viewportStyle.display !== 'none' && viewportStyle.visibility !== 'hidden';

        // Canvas init can run before window is actually visible/opened.
        // Wait until viewport has usable dimensions to get a correct fit.
        if (!isMeasurable) {
            setTimeout(() => requestAnimationFrame(run), 80);
            return;
        }

        if (hasCanvasLinkHash(window.location.hash)) {
            const handled = checkHashForDirectLink();
            if (handled) return;
        }

        if (loadCanvasViewState()) return;

        // Use the exact same action path as manual "Fit to Screen".
        const fitBtn = container?.querySelector('#canvas-fit');
        if (fitBtn) {
            fitBtn.click();
        } else {
            fitCanvasToScreen(true);
        }
    };

    requestAnimationFrame(run);
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

function getFirstWordForLink(node) {
    if (!node) return 'Node';
    if (node.type === 'file') {
        const filename = (node.file || '').split('/').pop() || 'Node';
        const stem = filename.includes('.') ? filename.substring(0, filename.lastIndexOf('.')) : filename;
        return (stem.split(/\s+|_|-/)[0] || 'Node').replace(/[^A-Za-z0-9]/g, '') || 'Node';
    }
    if (node.type === 'text') {
        const source = (node.text || node.html || '').replace(/<[^>]*>/g, ' ');
        return (source.trim().split(/\s+/)[0] || 'Node').replace(/[^A-Za-z0-9]/g, '') || 'Node';
    }
    return 'Node';
}

function getNodeLinkMeta(node) {
    let branchWord = 'Branch';
    try {
        const root = findRootOfBranch(node.id);
        branchWord = getFirstWordForLink(root) || 'Branch';
    } catch (e) {
        branchWord = 'Branch';
    }

    const nodeWord = getFirstWordForLink(node) || 'Node';
    const label = `Canvas:${branchWord}_${nodeWord}`;
    const slug = `${branchWord}_${nodeWord}`.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    return { label, slug };
}

function getCanvasHashFromLink(href) {
    if (!href) return '';
    const raw = String(href).trim();
    if (!raw) return '';

    if (raw.startsWith('#canvas:') || raw.startsWith('#canvasid:')) {
        return raw;
    }

    try {
        const parsed = new URL(raw, window.location.href);
        if (parsed.hash && (parsed.hash.startsWith('#canvas:') || parsed.hash.startsWith('#canvasid:'))) {
            return parsed.hash;
        }
    } catch (e) {
        // ignore URL parsing failures and try fallback below
    }

    const hashIndex = raw.indexOf('#canvas');
    if (hashIndex >= 0) {
        const tail = raw.substring(hashIndex);
        if (tail.startsWith('#canvas:') || tail.startsWith('#canvasid:')) {
            return tail;
        }
    }

    return '';
}

function getNodeLinkHash(node) {
    return `#canvasid:${encodeURIComponent(node.id)}`;
}

function getNodeExternalShareUrl(node) {
    return `${window.location.origin}${window.location.pathname}${getNodeLinkHash(node)}`;
}

function resolveNodeFromCanvasLink(href) {
    const canvasHash = getCanvasHashFromLink(href);
    if (!canvasHash) return null;

    if (canvasHash.startsWith('#canvasid:')) {
        const nodeId = decodeURIComponent(canvasHash.substring(10));
        return canvasData.nodes.find(n => n.id === nodeId) || null;
    }

    if (canvasHash.startsWith('#canvas:')) {
        const targetDesc = decodeURIComponent(canvasHash.substring(8)).toLowerCase();
        for (const node of canvasData.nodes) {
            const nodeName = getNodeLinkName(node);
            if (nodeName === targetDesc || nodeName.includes(targetDesc) || targetDesc.includes(nodeName)) {
                return node;
            }
        }
    }

    return null;
}

function refreshCanvasDiscussionLinkLabels() {
    if (!container) return;
    const messagesEl = container.querySelector('#canvas-discussion-messages');
    if (!messagesEl) return;

    messagesEl.querySelectorAll('a.canvas-link').forEach(a => {
        const href = a.getAttribute('href') || '';
        const node = resolveNodeFromCanvasLink(href);
        if (!node) return;
        a.textContent = getNodeLinkMeta(node).label;
    });
}

function getNodeLinkName(node) {
    return getNodeLinkMeta(node).slug;
}

function generateAndInsertNodeLink(node) {
    const meta = getNodeLinkMeta(node);
    const chatInput = document.getElementById('chat-input') || document.getElementById('canvas-discussion-input');
    if (chatInput) {
        const linkText = `[${meta.label}](${getNodeLinkHash(node)})`;
        chatInput.value = chatInput.value + (chatInput.value ? ' ' : '') + linkText;
        chatInput.focus();
        window.uiToast('Link inserted into chat', 'success');
    } else {
        copyExternalNodeLink(node);
    }
}

function copyExternalNodeLink(node) {
    const url = getNodeExternalShareUrl(node);
    navigator.clipboard.writeText(url).then(() => {
        window.uiToast('External canvas link copied', 'success');
    }).catch(() => {
        window.uiToast('Failed to copy canvas link', 'error');
    });
}

// -----------------------------------------------------------------
// DIRECT LINKS
// -----------------------------------------------------------------

function checkHashForDirectLink() {
    // Format: #canvas:slug or #canvasid:nodeId
    const hash = window.location.hash;
    if (hash.startsWith('#canvas:') || hash.startsWith('#canvasid:')) {
        const targetNode = resolveNodeFromCanvasLink(hash);

        if (targetNode) {
            // Pan and zoom smoothly to target
            const targetScale = 1.0;
            const rect = viewport.getBoundingClientRect();
            const targetTX = -(targetNode.x + targetNode.width/2) * targetScale + (rect.width / 2);
            const targetTY = -(targetNode.y + targetNode.height/2) * targetScale + (rect.height / 2);
            animateTo(targetScale, targetTX, targetTY);
            selectNode(targetNode);
            return true;
        } else {
            console.warn("Target canvas node not found for hash:", hash);
            return false;
        }
    }
    return false;
}

function hasCanvasLinkHash(hash) {
    return typeof hash === 'string' && (hash.startsWith('#canvas:') || hash.startsWith('#canvasid:'));
}

function loadCanvasViewState() {
    try {
        const raw = localStorage.getItem(CANVAS_VIEW_STATE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (parsed?.v !== 2) return false;
        const nextScale = Number(parsed?.scale);
        const nextTX = Number(parsed?.translateX);
        const nextTY = Number(parsed?.translateY);
        if (!Number.isFinite(nextScale) || !Number.isFinite(nextTX) || !Number.isFinite(nextTY)) return false;

        scale = Math.min(5, Math.max(0.1, nextScale));
        translateX = nextTX;
        translateY = nextTY;
        updateTransform();
        return true;
    } catch (err) {
        return false;
    }
}

function queueSaveCanvasViewState() {
    clearTimeout(viewStateSaveTimer);
    viewStateSaveTimer = setTimeout(() => {
        try {
            localStorage.setItem(CANVAS_VIEW_STATE_KEY, JSON.stringify({
                v: 2,
                scale,
                translateX,
                translateY,
            }));
        } catch (err) {
            // Ignore storage failures (private mode/quota)
        }
    }, 120);
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
function renderCanvasDiscussionMessages(messagesEl, comments) {
    if (!messagesEl) return;

    const escapeLabel = (s) => (s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const getLiveCanvasLabel = (href, fallbackLabel) => {
        const node = resolveNodeFromCanvasLink(href);
        if (!node) return fallbackLabel;
        return getNodeLinkMeta(node).label;
    };

    messagesEl.innerHTML = '';

    if (!comments || comments.length === 0) {
        messagesEl.innerHTML = '<div class="canvas-discussion-loading">No messages yet.</div>';
        return;
    }

    for (const msg of comments) {
        if (!msg || !msg.author) continue;

        const el = document.createElement('div');
        const isOwn = githubAuth.user?.login === msg.author.login;
        const canDelete = !!(githubAuth.isLoggedIn && githubAuth.isOwner);
        el.className = 'canvas-discussion-msg' + (isOwn ? ' canvas-discussion-msg-own' : '');

        const time = new Date(msg.createdAt);
        const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = time.toLocaleDateString();

        // Escape HTML then linkify markdown links, raw URLs and #canvas links
        let bodyHtml = (msg.body || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        const mdLinks = [];
        const addMdLink = (html) => {
            mdLinks.push(html);
            return `__MDLINK_${mdLinks.length - 1}__`;
        };

        // Markdown links: [text](#canvas:slug) and [text](#canvasid:nodeId)
        bodyHtml = bodyHtml.replace(/\[([^\]]+)\]\((#canvas(?:id)?:[^)\s]+)\)/g, (m, label, href) => {
            const liveLabel = getLiveCanvasLabel(href, label);
            return addMdLink(`<a href="${href}" class="canvas-link">${escapeLabel(liveLabel)}</a>`);
        });

        // Markdown links: [text](https://...#canvas:slug or #canvasid:nodeId)
        bodyHtml = bodyHtml.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]*#canvas(?:id)?:[^)\s]+)\)/gi, (m, label, href) => {
            const liveLabel = getLiveCanvasLabel(href, label);
            return addMdLink(`<a href="${href}" class="canvas-link">${escapeLabel(liveLabel)}</a>`);
        });

        // Markdown links: [text](https://...)
        bodyHtml = bodyHtml.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, label, href) => {
            return addMdLink(`<a href="${href}" target="_blank" rel="noopener" style="color:var(--canvas-accent)">${label}</a>`);
        });

        // Raw absolute canvas URLs should remain canvas links
        bodyHtml = bodyHtml.replace(/(^|\s)(https?:\/\/[^\s<]*#canvas(?:id)?:[a-zA-Z0-9_.\-]+)/gi, (m, prefix, href) => {
            const liveLabel = getLiveCanvasLabel(href, href);
            return `${prefix}${addMdLink(`<a href="${href}" class="canvas-link">${escapeLabel(liveLabel)}</a>`)}`;
        });

        // Raw URLs (standalone)
        bodyHtml = bodyHtml.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener" style="color:var(--canvas-accent)">$2</a>');

        // Raw #canvas/#canvasid links (standalone)
        bodyHtml = bodyHtml.replace(/(^|\s)(#canvas(?:id)?:[a-zA-Z0-9_.\-]+)/g, (m, prefix, href) => {
            const liveLabel = getLiveCanvasLabel(href, href);
            return `${prefix}<a href="${href}" class="canvas-link">${escapeLabel(liveLabel)}</a>`;
        });

        // Re-inject markdown links after URL/hash linkification
        bodyHtml = bodyHtml.replace(/__MDLINK_(\d+)__/g, (m, idx) => mdLinks[Number(idx)] || m);

        // Preserve line breaks
        bodyHtml = bodyHtml.replace(/\n/g, '<br>');

        const reactionCounts = {};
        const reactions = msg.reactions?.nodes || [];
        for (const r of reactions) {
            if (!r?.content || !r?.user?.login) continue;
            if (!reactionCounts[r.content]) reactionCounts[r.content] = [];
            reactionCounts[r.content].push(r.user.login);
        }

        let reactionsHtml = '';
        for (const rt of CANVAS_REACTION_TYPES) {
            const users = reactionCounts[rt] || [];
            if (users.length === 0) continue;
            const reactedByMe = githubAuth.user && users.includes(githubAuth.user.login);
            reactionsHtml += `<span class="canvas-discussion-reaction ${reactedByMe ? 'active' : ''}" data-type="${rt}" data-id="${msg.id}" title="${escapeLabel(users.join(', '))}">${CANVAS_REACTION_EMOJIS[rt]} ${users.length}</span>`;
        }
        reactionsHtml += `<span class="canvas-discussion-reaction-add" data-id="${msg.id}">+👍</span>`;

        el.innerHTML = `
            <img class="canvas-discussion-avatar" src="${msg.author.avatarUrl}" alt="" width="20" height="20">
            <div class="canvas-discussion-msg-body">
                <div class="canvas-discussion-msg-header">
                    <span class="canvas-discussion-author">${escapeLabel(msg.author.login)}</span>
                    <span class="canvas-discussion-time" title="${escapeLabel(dateStr)}">${escapeLabel(timeStr)}</span>
                    <span class="canvas-discussion-msg-spacer"></span>
                    ${canDelete ? `<button class="canvas-discussion-msg-del" data-id="${msg.id}" title="Delete Message"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>` : ''}
                </div>
                <div class="canvas-discussion-text">${bodyHtml}</div>
                <div class="canvas-discussion-reactions">${reactionsHtml}</div>
            </div>
        `;

        messagesEl.appendChild(el);
    }

    messagesEl.querySelectorAll('.canvas-discussion-reaction').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const type = btn.getAttribute('data-type');
            toggleCanvasReaction(id, type, messagesEl);
        });
    });

    messagesEl.querySelectorAll('.canvas-discussion-msg-del').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!githubAuth.isOwner) return;
            const id = btn.getAttribute('data-id');
            if (!id) return;
            if (!confirm('Delete this message?')) return;
            deleteCanvasDiscussionMessage(id, messagesEl);
        });
    });

    messagesEl.querySelectorAll('.canvas-discussion-reaction-add').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            toggleCanvasReaction(id, 'THUMBS_UP', messagesEl);
        });
    });
}

async function toggleCanvasReaction(commentId, content, messagesEl) {
    if (!githubAuth.isLoggedIn) {
        window.uiToast('Sign in to react', 'info');
        return;
    }

    const myLogin = githubAuth.user?.login;
    if (!myLogin) return;

    const msg = canvasDiscussionMessages.find(m => m.id === commentId);
    if (!msg) return;

    if (!msg.reactions) msg.reactions = { nodes: [] };
    const currentReactions = msg.reactions.nodes || [];
    const hasReacted = currentReactions.some(r => r.user?.login === myLogin && r.content === content);

    // Optimistic update
    if (hasReacted) {
        msg.reactions.nodes = currentReactions.filter(r => !(r.user?.login === myLogin && r.content === content));
    } else {
        msg.reactions.nodes = [...currentReactions, { content, user: { login: myLogin } }];
    }

    const prevScroll = messagesEl.scrollTop;
    renderCanvasDiscussionMessages(messagesEl, canvasDiscussionMessages);
    messagesEl.scrollTop = prevScroll;

    try {
        const mutationName = hasReacted ? 'removeReaction' : 'addReaction';
        const query = `
          mutation($subjectId: ID!, $content: ReactionContent!) {
            ${mutationName}(input: {subjectId: $subjectId, content: $content}) {
              reaction {
                content
              }
            }
          }
        `;

        const h = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `bearer ${githubAuth.token}`
        };

        const resp = await fetch('https://api.github.com/graphql', {
            method: 'POST',
            headers: h,
            body: JSON.stringify({ query, variables: { subjectId: commentId, content } })
        });

        if (!resp.ok) throw new Error('Reaction request failed');
        const json = await resp.json();
        if (json.errors) throw new Error(json.errors[0]?.message || 'Reaction mutation failed');
    } catch (err) {
        console.error('Canvas reaction failed', err);
        fetchDiscussion(messagesEl);
    }
}

async function deleteCanvasDiscussionMessage(commentId, messagesEl) {
    if (!githubAuth.isOwner || !githubAuth.token) {
        window.uiToast('Only owner can delete messages', 'info');
        return;
    }

    try {
        const query = `
          mutation($id: ID!) {
            deleteDiscussionComment(input: {id: $id}) {
              clientMutationId
            }
          }
        `;

        const h = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `bearer ${githubAuth.token}`
        };

        const resp = await fetch('https://api.github.com/graphql', {
            method: 'POST',
            headers: h,
            body: JSON.stringify({ query, variables: { id: commentId } })
        });

        if (!resp.ok) throw new Error('Delete request failed');
        const json = await resp.json();
        if (json.errors) throw new Error(json.errors[0]?.message || 'Delete mutation failed');

        canvasDiscussionMessages = canvasDiscussionMessages.filter(m => m.id !== commentId);
        renderCanvasDiscussionMessages(messagesEl, canvasDiscussionMessages);
    } catch (err) {
        console.error('Canvas message delete failed', err);
        window.uiToast('Failed to delete message', 'error');
        fetchDiscussion(messagesEl);
    }
}

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
                                        reactions(first: 100) {
                                            nodes {
                                                content
                                                user {
                                                    login
                                                }
                                            }
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

        canvasDiscussionMessages = discussion.comments.nodes || [];
        renderCanvasDiscussionMessages(messagesEl, canvasDiscussionMessages);
        refreshCanvasDiscussionLinkLabels();
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
    const vw = Math.max(6, (visRight - visLeft) * mScale);
    const vh = Math.max(6, (visBottom - visTop) * mScale);

    const rawLeft = vx;
    const rawTop = vy;
    const rawRight = vx + vw;
    const rawBottom = vy + vh;

    // Clamp viewport rectangle to minimap bounds, but keep a minimal visible marker
    // when the viewport is mostly outside the represented graph area.
    let left = Math.max(0, Math.min(w - 2, rawLeft));
    let top = Math.max(0, Math.min(h - 2, rawTop));
    let right = Math.max(2, Math.min(w, rawRight));
    let bottom = Math.max(2, Math.min(h, rawBottom));

    if (right <= left) {
        if (rawRight < 0) {
            left = 0;
            right = 2;
        } else if (rawLeft > w) {
            left = w - 2;
            right = w;
        } else {
            right = Math.min(w, left + 2);
            left = Math.max(0, right - 2);
        }
    }

    if (bottom <= top) {
        if (rawBottom < 0) {
            top = 0;
            bottom = 2;
        } else if (rawTop > h) {
            top = h - 2;
            bottom = h;
        } else {
            bottom = Math.min(h, top + 2);
            top = Math.max(0, bottom - 2);
        }
    }

    minimapViewportEl.style.display = '';
    minimapViewportEl.style.left = `${left}px`;
    minimapViewportEl.style.top = `${top}px`;
    minimapViewportEl.style.width = `${Math.max(2, right - left)}px`;
    minimapViewportEl.style.height = `${Math.max(2, bottom - top)}px`;
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

    if (!isNodeVisible(dragNode)) {
        return { snapX, snapY, guides };
    }

    const dl = dragNode.x;
    const dr = dragNode.x + dragNode.width;
    const dcx = dragNode.x + dragNode.width / 2;
    const dt = dragNode.y;
    const db = dragNode.y + dragNode.height;
    const dcy = dragNode.y + dragNode.height / 2;

    const dragGroupId = (dragNode.type !== 'group' && typeof dragNode.groupId === 'string' && dragNode.groupId)
        ? dragNode.groupId
        : null;
    const restrictToSameGroupMembers = !!dragGroupId;

    for (const other of canvasData.nodes) {
        if (other.id === dragNode.id) continue;
        if (multiSelectedNodes.has(other.id)) continue;
        if (!isNodeVisible(other)) continue;

        if (restrictToSameGroupMembers) {
            if (other.type === 'group') continue;
            if (other.groupId !== dragGroupId) continue;
        }

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

function getSelectedNodesForClone() {
    const baseSelection = multiSelectedNodes.size > 0
        ? canvasData.nodes.filter(n => multiSelectedNodes.has(n.id))
        : (selectedNode ? [selectedNode] : []);

    if (baseSelection.length === 0) return [];

    const idsToClone = new Set(baseSelection.map(n => n.id));

    // Copying a group should always include its members.
    baseSelection
        .filter(n => n.type === 'group')
        .forEach(group => {
            getGroupMemberNodes(group.id).forEach(member => {
                idsToClone.add(member.id);
            });
        });

    return canvasData.nodes.filter(n => idsToClone.has(n.id));
}

function copySelectedToClipboard() {
    if (!isOwner) return;

    const nodesToCopy = getSelectedNodesForClone();
    if (nodesToCopy.length === 0) {
        window.uiToast('Select node(s) to copy', 'info');
        return;
    }

    const nodeIds = new Set(nodesToCopy.map(n => n.id));
    const minX = Math.min(...nodesToCopy.map(n => Number(n.x) || 0));
    const minY = Math.min(...nodesToCopy.map(n => Number(n.y) || 0));

    canvasClipboard = {
        baseX: minX,
        baseY: minY,
        nodes: nodesToCopy.map(n => {
            const clone = JSON.parse(JSON.stringify(n));
            clone.__sourceId = n.id;
            clone.x = (Number(n.x) || 0) - minX;
            clone.y = (Number(n.y) || 0) - minY;
            if (clone._tempBase64) delete clone._tempBase64;
            return clone;
        }),
        edges: canvasData.edges
            .filter(e => nodeIds.has(e.fromNode) && nodeIds.has(e.toNode))
            .map(e => JSON.parse(JSON.stringify(e)))
    };

    clipboardPasteCount = 0;
    window.uiToast(`Copied ${nodesToCopy.length} node${nodesToCopy.length === 1 ? '' : 's'}`, 'success');
}

function pasteFromClipboard() {
    if (!isOwner) return;
    if (!canvasClipboard || !Array.isArray(canvasClipboard.nodes) || canvasClipboard.nodes.length === 0) {
        window.uiToast('Clipboard is empty', 'info');
        return;
    }

    pushHistory();

    clipboardPasteCount += 1;
    const offset = 32 * clipboardPasteCount;
    const idMap = new Map();
    const newNodes = [];

    for (const sourceNode of canvasClipboard.nodes) {
        const clone = JSON.parse(JSON.stringify(sourceNode));
        const oldId = clone.__sourceId || clone.id;
        delete clone.__sourceId;

        clone.id = generateId();
        clone.x = Math.round((canvasClipboard.baseX || 0) + (Number(sourceNode.x) || 0) + offset);
        clone.y = Math.round((canvasClipboard.baseY || 0) + (Number(sourceNode.y) || 0) + offset);

        if (clone._tempBase64) delete clone._tempBase64;

        idMap.set(oldId, clone.id);
        canvasData.nodes.push(clone);
        newNodes.push(clone);
    }

    for (const clone of newNodes) {
        if (clone.type === 'group') {
            delete clone.groupId;
            continue;
        }

        const originalGroupId = typeof clone.groupId === 'string' ? clone.groupId : '';
        if (originalGroupId && idMap.has(originalGroupId)) {
            clone.groupId = idMap.get(originalGroupId);
        } else {
            delete clone.groupId;
        }
    }

    for (const sourceEdge of (canvasClipboard.edges || [])) {
        if (!idMap.has(sourceEdge.fromNode) || !idMap.has(sourceEdge.toNode)) continue;
        canvasData.edges.push({
            ...sourceEdge,
            id: generateId(),
            fromNode: idMap.get(sourceEdge.fromNode),
            toNode: idMap.get(sourceEdge.toNode),
        });
    }

    clearSelection();
    if (newNodes.length === 1) {
        selectNode(newNodes[0]);
    } else {
        multiSelectedNodes = new Set(newNodes.map(n => n.id));
        selectedNode = newNodes[0];
    }

    markUnsaved();
    renderCanvas();
    window.uiToast(`Pasted ${newNodes.length} node${newNodes.length === 1 ? '' : 's'}`, 'success');
}

function duplicateSelected() {
    if (!isOwner) return;

    const nodesToClone = getSelectedNodesForClone();
    if (nodesToClone.length === 0) return;

    pushHistory();
    const idMap = new Map();
    const newNodes = [];

    for (const n of nodesToClone) {
        const newId = generateId();
        idMap.set(n.id, newId);
        const clone = { ...n, id: newId, x: n.x + 30, y: n.y + 30 };
        // Deep copy mutable fields
        if (clone._tempBase64) delete clone._tempBase64;
        newNodes.push(clone);
        canvasData.nodes.push(clone);
    }

    for (const clone of newNodes) {
        if (clone.type === 'group') {
            delete clone.groupId;
            continue;
        }

        const originalGroupId = typeof clone.groupId === 'string' ? clone.groupId : '';
        if (originalGroupId && idMap.has(originalGroupId)) {
            clone.groupId = idMap.get(originalGroupId);
        } else {
            delete clone.groupId;
        }
    }

    // Duplicate only connections fully inside the copied set.
    const sourceEdges = canvasData.edges.filter(edge => idMap.has(edge.fromNode) && idMap.has(edge.toNode));
    sourceEdges.forEach(edge => {
        canvasData.edges.push({
            id: generateId(),
            fromNode: idMap.get(edge.fromNode),
            fromSide: edge.fromSide,
            toNode: idMap.get(edge.toNode),
            toSide: edge.toSide,
        });
    });

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

    const baseSelection = multiSelectedNodes.size > 0
        ? canvasData.nodes.filter(n => multiSelectedNodes.has(n.id))
        : (selectedNode ? [selectedNode] : []);

    const nodesToMove = new Map();
    baseSelection.forEach(node => {
        if (!node || isNodeLocked(node)) return;
        nodesToMove.set(node.id, node);

        if (node.type === 'group') {
            getGroupMemberNodes(node.id)
                .filter(member => !isNodeLocked(member))
                .forEach(member => nodesToMove.set(member.id, member));
        }
    });

    if (nodesToMove.size === 0) {
        window.uiToast?.('Selected nodes are locked', 'info');
        return;
    }

    // Debounced history push — only push once per nudge burst
    if (!nudgeHistoryPushed) {
        pushHistory();
        nudgeHistoryPushed = true;
    }
    clearTimeout(nudgeTimeout);
    nudgeTimeout = setTimeout(() => { nudgeHistoryPushed = false; }, 500);

    nodesToMove.forEach(node => {
        node.x += dx;
        node.y += dy;
        const el = nodesLayer.querySelector(`[data-id="${node.id}"]`);
        if (el) {
            el.style.left = `${node.x}px`;
            el.style.top = `${node.y}px`;
        }
        updateEdgesForNode(node.id);
    });

    const movedIncludesGroup = Array.from(nodesToMove.values()).some(n => n.type === 'group');
    if (!movedIncludesGroup) {
        const movedNonGroupIds = Array.from(nodesToMove.values())
            .filter(n => n.type !== 'group')
            .map(n => n.id);
        updateGroupMembershipForNodeIds(movedNonGroupIds);
        fitGroupsForNodeIds(movedNonGroupIds);
    }

    if (selectedNode) {
        const el = nodesLayer.querySelector(`[data-id="${selectedNode.id}"]`);
        if (el) showNodeToolbar(selectedNode, el);
    }

    markUnsaved();
    renderCanvas();
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
