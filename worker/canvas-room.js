const EMPTY_STATE = Object.freeze({ nodes: [], edges: [] });
const PRESENCE_TTL_MS = 30_000;
const PRESENCE_HEARTBEAT_WRITE_MS = 10_000;

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeEntityList(list) {
  if (!Array.isArray(list)) return [];

  return list
    .filter((item) => item && typeof item === 'object' && typeof item.id === 'string' && item.id.trim())
    .map((item) => deepClone(item));
}

function normalizeCanvasState(state) {
  const input = state && typeof state === 'object' ? state : EMPTY_STATE;
  return {
    nodes: normalizeEntityList(input.nodes),
    edges: normalizeEntityList(input.edges),
  };
}

function normalizeIdList(list) {
  if (!Array.isArray(list)) return [];

  const ids = [];
  const seen = new Set();

  list.forEach((value) => {
    const id = String(value || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });

  return ids;
}

function normalizePatch(patch) {
  const input = patch && typeof patch === 'object' ? patch : {};
  return {
    upsertNodes: normalizeEntityList(input.upsertNodes),
    removeNodeIds: normalizeIdList(input.removeNodeIds),
    upsertEdges: normalizeEntityList(input.upsertEdges),
    removeEdgeIds: normalizeIdList(input.removeEdgeIds),
  };
}

function isPatchEmpty(patch) {
  return (
    patch.upsertNodes.length === 0
    && patch.removeNodeIds.length === 0
    && patch.upsertEdges.length === 0
    && patch.removeEdgeIds.length === 0
  );
}

function mapById(entities) {
  return new Map(entities.map((entity) => [entity.id, entity]));
}

function applyPatchToState(state, patch) {
  const current = normalizeCanvasState(state);
  const normalizedPatch = normalizePatch(patch);

  if (isPatchEmpty(normalizedPatch)) {
    return {
      changed: false,
      state: current,
    };
  }

  const nodesById = mapById(current.nodes);
  const edgesById = mapById(current.edges);
  let changed = false;

  normalizedPatch.upsertNodes.forEach((node) => {
    const previous = nodesById.get(node.id);
    const nextSerialized = JSON.stringify(node);
    const previousSerialized = previous ? JSON.stringify(previous) : '';
    if (!previous || previousSerialized !== nextSerialized) {
      nodesById.set(node.id, node);
      changed = true;
    }
  });

  normalizedPatch.removeNodeIds.forEach((id) => {
    if (nodesById.delete(id)) {
      changed = true;
    }
  });

  normalizedPatch.upsertEdges.forEach((edge) => {
    const previous = edgesById.get(edge.id);
    const nextSerialized = JSON.stringify(edge);
    const previousSerialized = previous ? JSON.stringify(previous) : '';
    if (!previous || previousSerialized !== nextSerialized) {
      edgesById.set(edge.id, edge);
      changed = true;
    }
  });

  normalizedPatch.removeEdgeIds.forEach((id) => {
    if (edgesById.delete(id)) {
      changed = true;
    }
  });

  // Remove dangling edges after node deletions.
  for (const [edgeId, edge] of edgesById.entries()) {
    if (!nodesById.has(edge.fromNode) || !nodesById.has(edge.toNode)) {
      edgesById.delete(edgeId);
      changed = true;
    }
  }

  return {
    changed,
    state: {
      nodes: Array.from(nodesById.values()),
      edges: Array.from(edgesById.values()),
    },
  };
}

function normalizePresenceEntry(entry) {
  const input = entry && typeof entry === 'object' ? entry : {};
  const login = String(input.login || '').trim().toLowerCase();
  if (!login) return null;

  return {
    login,
    role: input.role === 'owner' ? 'owner' : 'editor',
    selectedNodeIds: normalizeIdList(input.selectedNodeIds),
    updatedAtMs: Number(input.updatedAtMs) || 0,
  };
}

function normalizePresenceMap(input) {
  if (!input || typeof input !== 'object') return {};

  const output = {};
  Object.entries(input).forEach(([key, value]) => {
    const entry = normalizePresenceEntry(value);
    if (!entry) return;
    output[key.toLowerCase()] = entry;
  });
  return output;
}

function parseActor(request) {
  const login = String(request.headers.get('X-Live-Actor') || '').trim().toLowerCase();
  if (!login) return null;

  const roleHeader = String(request.headers.get('X-Live-Role') || '').trim().toLowerCase();
  return {
    login,
    role: roleHeader === 'owner' ? 'owner' : 'editor',
  };
}

function parseSelectedNodeIdsFromQuery(url) {
  const raw = String(url.searchParams.get('selected') || '').trim();
  if (!raw) return [];

  return normalizeIdList(raw.split(','));
}

function parseSelectedNodeIdsFromBody(body) {
  if (!body || typeof body !== 'object') return null;
  if (!body.presence || typeof body.presence !== 'object') return null;
  if (!Array.isArray(body.presence.selectedNodeIds)) return null;
  return normalizeIdList(body.presence.selectedNodeIds);
}

function prunePresence(record, nowMs) {
  const nextPresence = {};
  let changed = false;

  Object.entries(record.presence).forEach(([login, entry]) => {
    const normalized = normalizePresenceEntry(entry);
    if (!normalized) {
      changed = true;
      return;
    }

    if (nowMs - normalized.updatedAtMs > PRESENCE_TTL_MS) {
      changed = true;
      return;
    }

    nextPresence[login] = normalized;
  });

  if (changed) {
    record.presence = nextPresence;
    record.presenceVersion += 1;
  }

  return changed;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function touchPresence(record, actor, selectedNodeIds, nowMs) {
  if (!actor) {
    return { changed: false, needsPersist: false };
  }

  const key = actor.login;
  const previous = normalizePresenceEntry(record.presence[key]);
  const nextSelection = Array.isArray(selectedNodeIds)
    ? normalizeIdList(selectedNodeIds)
    : (previous?.selectedNodeIds || []);

  const roleChanged = !previous || previous.role !== actor.role;
  const selectionChanged = !previous || !arraysEqual(previous.selectedNodeIds, nextSelection);
  const shouldRefreshHeartbeat = !previous || (nowMs - previous.updatedAtMs >= PRESENCE_HEARTBEAT_WRITE_MS);

  if (!roleChanged && !selectionChanged && !shouldRefreshHeartbeat) {
    return { changed: false, needsPersist: false };
  }

  record.presence[key] = {
    login: key,
    role: actor.role,
    selectedNodeIds: nextSelection,
    updatedAtMs: nowMs,
  };

  if (roleChanged || selectionChanged || !previous) {
    record.presenceVersion += 1;
    return { changed: true, needsPersist: true };
  }

  return { changed: false, needsPersist: true };
}

function buildPresenceList(record) {
  return Object.values(record.presence)
    .map((entry) => normalizePresenceEntry(entry))
    .filter(Boolean)
    .sort((a, b) => a.login.localeCompare(b.login));
}

async function readRoomRecord(storage) {
  const existing = await storage.get('canvas-record');
  if (existing && typeof existing === 'object') {
    return {
      version: Number(existing.version) || 0,
      updatedAt: typeof existing.updatedAt === 'string' ? existing.updatedAt : null,
      state: normalizeCanvasState(existing.state),
      presenceVersion: Number(existing.presenceVersion) || 0,
      presence: normalizePresenceMap(existing.presence),
    };
  }

  const fresh = {
    version: 0,
    updatedAt: null,
    state: normalizeCanvasState(EMPTY_STATE),
    presenceVersion: 0,
    presence: {},
  };

  await storage.put('canvas-record', fresh);
  return fresh;
}

class BaseCanvasRoom {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      const actor = parseActor(request);
      const nowMs = Date.now();

      if (request.method === 'GET') {
        const record = await readRoomRecord(this.state.storage);
        const selectedNodeIds = parseSelectedNodeIdsFromQuery(url);

        const removed = prunePresence(record, nowMs);
        const presenceUpdate = touchPresence(record, actor, selectedNodeIds, nowMs);
        if (removed || presenceUpdate.needsPersist) {
          await this.state.storage.put('canvas-record', record);
        }

        const sinceVersion = Number(url.searchParams.get('sinceVersion'));
        const sincePresenceVersion = Number(url.searchParams.get('sincePresenceVersion'));
        const stateChanged = !Number.isFinite(sinceVersion) || sinceVersion < record.version;
        const presenceChanged = !Number.isFinite(sincePresenceVersion) || sincePresenceVersion < record.presenceVersion;

        const payload = {
          version: record.version,
          updatedAt: record.updatedAt,
          presenceVersion: record.presenceVersion,
          changed: stateChanged,
          presenceChanged,
          heartbeatWriteMs: PRESENCE_HEARTBEAT_WRITE_MS,
          state: stateChanged ? record.state : null,
          presence: presenceChanged ? buildPresenceList(record) : [],
        };

        return Response.json(payload, { status: 200 });
      }

      if (request.method === 'POST') {
        let body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
        }

        const record = await readRoomRecord(this.state.storage);
        let changed = false;

        const removed = prunePresence(record, nowMs);
        if (removed) changed = true;

        const selectedNodeIds = parseSelectedNodeIdsFromBody(body);
        const presenceUpdate = touchPresence(record, actor, selectedNodeIds, nowMs);
        if (presenceUpdate.needsPersist) changed = true;

        if (body && typeof body === 'object' && body.patch && typeof body.patch === 'object') {
          const patchResult = applyPatchToState(record.state, body.patch);
          if (patchResult.changed) {
            record.state = patchResult.state;
            record.version += 1;
            record.updatedAt = new Date().toISOString();
            changed = true;
          }
        } else if (body && typeof body === 'object' && body.state) {
          const nextState = normalizeCanvasState(body.state);
          if (JSON.stringify(record.state) !== JSON.stringify(nextState)) {
            record.state = nextState;
            record.version += 1;
            record.updatedAt = new Date().toISOString();
            changed = true;
          }
        }

        if (changed) {
          await this.state.storage.put('canvas-record', record);
        }

        return Response.json(
          {
            version: record.version,
            updatedAt: record.updatedAt,
            state: record.state,
            presenceVersion: record.presenceVersion,
            presence: buildPresenceList(record),
          },
          { status: 200 },
        );
      }

      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : 'Unknown persistence error';
      return Response.json({ error: `Canvas room persistence failed: ${detail}` }, { status: 500 });
    }
  }
}

export class CanvasRoom extends BaseCanvasRoom {}

export class CanvasRoomV2 extends BaseCanvasRoom {}
