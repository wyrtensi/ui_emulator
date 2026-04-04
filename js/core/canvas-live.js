import config from '../config.js';
import { githubAuth } from './github-auth.js';

function normalizeCanvasState(state) {
  const input = state && typeof state === 'object' ? state : {};
  return {
    nodes: Array.isArray(input.nodes) ? input.nodes : [],
    edges: Array.isArray(input.edges) ? input.edges : [],
  };
}

function buildRoomUrl(roomId) {
  const base = String(config.live?.workerUrl || config.github?.workerUrl || '').replace(/\/+$/, '');
  if (!base) return '';
  const targetRoom = String(roomId || config.live?.roomId || 'global').trim() || 'global';
  return `${base}/live/canvas/${encodeURIComponent(targetRoom)}`;
}

export class CanvasLiveClient {
  constructor(options = {}) {
    this.roomId = options.roomId || config.live?.roomId || 'global';
    this.enabled = (options.enabled ?? config.live?.enabled ?? false) === true;
    this.roomUrl = options.roomUrl || buildRoomUrl(this.roomId);
    this.version = 0;
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

  async fetchState() {
    if (!this.isReady()) return null;

    const resp = await fetch(this.roomUrl, {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    if (!resp.ok) {
      throw new Error(`Live state fetch failed (${resp.status})`);
    }

    const payload = await resp.json();
    this.version = Number(payload?.version) || 0;
    return normalizeCanvasState(payload?.state);
  }

  async pushState(state) {
    if (!this.isReady()) return null;

    const resp = await fetch(this.roomUrl, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        state: normalizeCanvasState(state),
        baseVersion: this.version,
      }),
    });

    if (resp.status === 409) {
      const payload = await resp.json().catch(() => null);
      if (payload && Number.isInteger(payload.version)) {
        this.version = payload.version;
      }
      throw new Error('Live state version conflict');
    }

    if (!resp.ok) {
      throw new Error(`Live state push failed (${resp.status})`);
    }

    const payload = await resp.json();
    this.version = Number(payload?.version) || this.version;
    return payload;
  }
}
