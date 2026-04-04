const EMPTY_STATE = Object.freeze({ nodes: [], edges: [] });

function normalizeCanvasState(state) {
  const input = state && typeof state === 'object' ? state : EMPTY_STATE;
  return {
    nodes: Array.isArray(input.nodes) ? input.nodes : [],
    edges: Array.isArray(input.edges) ? input.edges : [],
  };
}

async function readRoomRecord(storage) {
  const existing = await storage.get('canvas-record');
  if (existing && typeof existing === 'object' && existing.state) {
    return {
      version: Number(existing.version) || 0,
      updatedAt: typeof existing.updatedAt === 'string' ? existing.updatedAt : null,
      state: normalizeCanvasState(existing.state),
    };
  }

  const fresh = {
    version: 0,
    updatedAt: null,
    state: normalizeCanvasState(EMPTY_STATE),
  };

  await storage.put('canvas-record', fresh);
  return fresh;
}

export class CanvasRoom {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.method === 'GET') {
      const record = await readRoomRecord(this.state.storage);
      return Response.json(record, { status: 200 });
    }

    if (request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
      }

      const record = await readRoomRecord(this.state.storage);
      const baseVersion = Number.isInteger(body?.baseVersion) ? body.baseVersion : null;

      if (baseVersion !== null && baseVersion !== record.version) {
        return Response.json(
          {
            error: 'Version mismatch',
            version: record.version,
            state: record.state,
          },
          { status: 409 },
        );
      }

      const nextRecord = {
        version: record.version + 1,
        updatedAt: new Date().toISOString(),
        state: normalizeCanvasState(body?.state),
      };

      await this.state.storage.put('canvas-record', nextRecord);
      return Response.json(nextRecord, { status: 200 });
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }
}
