import config from '../config.js';
import { githubAuth } from './github-auth.js';

function normalizeCanvasState(state) {
  const input = state && typeof state === 'object' ? state : {};
  return {
    nodes: Array.isArray(input.nodes) ? input.nodes : [],
    edges: Array.isArray(input.edges) ? input.edges : [],
  };
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeEntityList(list) {
  if (!Array.isArray(list)) return [];

  return list
    .filter((item) => item && typeof item === 'object' && typeof item.id === 'string' && item.id.trim())
    .map((item) => deepClone(item));
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

function normalizeCanvasPatch(patch) {
  const input = patch && typeof patch === 'object' ? patch : {};
  return {
    upsertNodes: normalizeEntityList(input.upsertNodes),
    removeNodeIds: normalizeIdList(input.removeNodeIds),
    upsertEdges: normalizeEntityList(input.upsertEdges),
    removeEdgeIds: normalizeIdList(input.removeEdgeIds),
  };
}

function normalizePresenceList(list) {
  if (!Array.isArray(list)) return [];

  return list
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const login = String(entry.login || '').trim().toLowerCase();
      if (!login) return null;
      return {
        login,
        role: entry.role === 'owner' ? 'owner' : 'editor',
        selectedNodeIds: normalizeIdList(entry.selectedNodeIds),
        updatedAtMs: Number(entry.updatedAtMs) || 0,
      };
    })
    .filter(Boolean);
}

function buildRoomUrl(roomId) {
  const base = String(config.live?.workerUrl || config.github?.workerUrl || '').replace(/\/+$/, '');
  if (!base) return '';
  const targetRoom = String(roomId || config.live?.roomId || 'global').trim() || 'global';
  return `${base}/live/canvas/${encodeURIComponent(targetRoom)}`;
}

async function buildLiveRequestError(resp, fallbackMessage) {
  let detail = '';
  try {
    const payload = await resp.json();
    if (payload && typeof payload.error === 'string') {
      detail = payload.error.trim();
    }
  } catch {
    // Ignore JSON parse failures; fallback to status-only message.
  }

  const suffix = detail ? `: ${detail}` : '';
  const err = new Error(`${fallbackMessage} (${resp.status})${suffix}`);
  err.status = resp.status;
  err.detail = detail;
  return err;
}

export class CanvasLiveClient {
  constructor(options = {}) {
    this.roomId = options.roomId || config.live?.roomId || 'global';
    this.enabled = (options.enabled ?? config.live?.enabled ?? false) === true;
    this.roomUrl = options.roomUrl || buildRoomUrl(this.roomId);
    this.version = 0;
    this.presenceVersion = 0;
    this.actorLogin = '';
    this.actorRole = '';
  }

  isReady() {
    return this.enabled && !!this.roomUrl && !!githubAuth.token;
  }

  getAuthHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${githubAuth.token}`,
    };
  }

  applyActorMetadata(resp) {
    const actor = String(resp.headers.get('X-Live-Actor') || '').trim().toLowerCase();
    const role = String(resp.headers.get('X-Live-Role') || '').trim().toLowerCase();
    if (actor) {
      this.actorLogin = actor;
    }
    if (role) {
      this.actorRole = role === 'owner' ? 'owner' : 'editor';
    }
  }

  applyVersionMetadata(payload) {
    if (Number.isInteger(payload?.version)) {
      this.version = payload.version;
    } else {
      this.version = Number(payload?.version) || this.version;
    }

    if (Number.isInteger(payload?.presenceVersion)) {
      this.presenceVersion = payload.presenceVersion;
    } else {
      this.presenceVersion = Number(payload?.presenceVersion) || this.presenceVersion;
    }
  }

  normalizeLivePayload(payload) {
    const state = payload && payload.state ? normalizeCanvasState(payload.state) : null;
    const presence = normalizePresenceList(payload?.presence);

    return {
      changed: payload?.changed !== false,
      presenceChanged: payload?.presenceChanged === true || presence.length > 0,
      version: this.version,
      presenceVersion: this.presenceVersion,
      state,
      presence,
      heartbeatWriteMs: Number(payload?.heartbeatWriteMs) || 0,
    };
  }

  buildFetchUrl(options = {}) {
    const url = new URL(this.roomUrl);
    if (Number.isInteger(options.sinceVersion)) {
      url.searchParams.set('sinceVersion', String(options.sinceVersion));
    }
    if (Number.isInteger(options.sincePresenceVersion)) {
      url.searchParams.set('sincePresenceVersion', String(options.sincePresenceVersion));
    }

    const selectedNodeIds = normalizeIdList(options.selectedNodeIds);
    url.searchParams.set('selected', selectedNodeIds.join(','));

    return url.toString();
  }

  async fetchState(options = {}) {
    if (!this.isReady()) return null;

    const resp = await fetch(this.buildFetchUrl(options), {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    if (!resp.ok) {
      throw await buildLiveRequestError(resp, 'Live state fetch failed');
    }

    this.applyActorMetadata(resp);
    const payload = await resp.json();
    this.applyVersionMetadata(payload);
    return this.normalizeLivePayload(payload);
  }

  async pushState(state, options = {}) {
    if (!this.isReady()) return null;

    const selectedNodeIds = normalizeIdList(options.selectedNodeIds);

    const resp = await fetch(this.roomUrl, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        state: normalizeCanvasState(state),
        baseVersion: Number.isInteger(options.baseVersion) ? options.baseVersion : this.version,
        presence: {
          selectedNodeIds,
        },
      }),
    });

    if (!resp.ok) {
      throw await buildLiveRequestError(resp, 'Live state push failed');
    }

    this.applyActorMetadata(resp);
    const payload = await resp.json();
    this.applyVersionMetadata(payload);
    return this.normalizeLivePayload(payload);
  }

  async pushPatch(patch, options = {}) {
    if (!this.isReady()) return null;

    const selectedNodeIds = normalizeIdList(options.selectedNodeIds);

    const resp = await fetch(this.roomUrl, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        patch: normalizeCanvasPatch(patch),
        baseVersion: Number.isInteger(options.baseVersion) ? options.baseVersion : this.version,
        presence: {
          selectedNodeIds,
        },
      }),
    });

    if (!resp.ok) {
      throw await buildLiveRequestError(resp, 'Live patch push failed');
    }

    this.applyActorMetadata(resp);
    const payload = await resp.json();
    this.applyVersionMetadata(payload);
    return this.normalizeLivePayload(payload);
  }
}
