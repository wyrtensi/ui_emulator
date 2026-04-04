/**
 * Cloudflare Worker — UI Auth Proxy
 *
 * Exchanges a GitHub OAuth code for an access_token.
 * Keeps the client_secret safe server-side.
 * Proxies Catbox image uploads to bypass browser CORS constraints.
 *
 * Required environment variables (set in Cloudflare dashboard):
 *   GITHUB_CLIENT_ID      — from your GitHub OAuth App
 *   GITHUB_CLIENT_SECRET   — from your GitHub OAuth App
 *   ALLOWED_ORIGIN         — your GitHub Pages URL, e.g. https://username.github.io
 *   CATBOX_USERHASH        — Optional: Your Catbox.moe user hash for permanent uploads
 *   GITHUB_REPO_OWNER      — Optional: explicit owner login for live owner verification
 *   GITHUB_REPO            — Optional fallback format: owner/repo (used if GITHUB_REPO_OWNER not set)
 *   GITHUB_ALLOWED_EDITORS — Optional CSV of additional GitHub logins allowed for live edit
 */

import { CanvasRoom, CanvasRoomV2 } from './canvas-room.js';

export { CanvasRoom, CanvasRoomV2 };

function getCorsHeaders(env) {
  const allowed = env.ALLOWED_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function jsonResponse(env, status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...getCorsHeaders(env),
      'Content-Type': 'application/json',
    },
  });
}

function parseAllowedEditors(env) {
  return new Set(
    String(env.GITHUB_ALLOWED_EDITORS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function resolveGitHubUserFromToken(token) {
  const commonHeaders = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ui-emulator-auth-worker',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const authCandidates = [`Bearer ${token}`, `token ${token}`];
  let lastResp = null;

  for (const authorization of authCandidates) {
    const resp = await fetch('https://api.github.com/user', {
      method: 'GET',
      headers: {
        ...commonHeaders,
        Authorization: authorization,
      },
    });

    if (resp.ok) {
      const user = await resp.json().catch(() => null);
      return { ok: true, user };
    }

    lastResp = resp;
    if (resp.status !== 401) {
      break;
    }
  }

  let detail = '';
  if (lastResp) {
    try {
      const payload = await lastResp.json();
      if (payload && typeof payload.message === 'string') {
        detail = payload.message;
      }
    } catch {
      detail = '';
    }
  }

  return {
    ok: false,
    status: lastResp?.status || 502,
    detail,
  };
}

async function verifyOwnerRequest(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  let token = '';

  if (authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (authHeader.toLowerCase().startsWith('token ')) {
    token = authHeader.slice(6).trim();
  }

  if (!token) {
    return { ok: false, status: 401, error: 'Missing bearer token' };
  }

  const configuredOwner = String(env.GITHUB_REPO_OWNER || '').trim();
  const configuredRepo = String(env.GITHUB_REPO || '').trim();
  const repoOwner = configuredOwner || (configuredRepo.includes('/') ? configuredRepo.split('/')[0] : '');
  const allowedEditors = parseAllowedEditors(env);

  if (!repoOwner && allowedEditors.size === 0) {
    return {
      ok: false,
      status: 500,
      error: 'Worker missing GITHUB_REPO_OWNER or GITHUB_REPO or GITHUB_ALLOWED_EDITORS',
    };
  }

  let verification;
  try {
    verification = await resolveGitHubUserFromToken(token);
  } catch {
    return { ok: false, status: 502, error: 'Failed to verify token against GitHub' };
  }

  if (!verification?.ok) {
    if (verification?.status === 401) {
      return { ok: false, status: 401, error: 'Invalid or expired GitHub token' };
    }
    if (verification?.status === 403) {
      return {
        ok: false,
        status: 403,
        error: verification.detail || 'GitHub denied token validation request',
      };
    }
    return {
      ok: false,
      status: 502,
      error: verification?.detail || 'Failed to verify token against GitHub',
    };
  }

  const user = verification.user;
  const login = String(user?.login || '').trim().toLowerCase();
  if (!login) {
    return { ok: false, status: 401, error: 'Unable to resolve GitHub user' };
  }

  const ownerLogin = repoOwner.toLowerCase();
  const isRepoOwner = !!ownerLogin && login === ownerLogin;
  const isAllowedEditor = allowedEditors.has(login);

  if (!isRepoOwner && !isAllowedEditor) {
    return { ok: false, status: 403, error: 'Live canvas access denied' };
  }

  return {
    ok: true,
    login,
    role: isRepoOwner ? 'owner' : 'editor',
  };
}

async function proxyCanvasRoomRequest(request, env, roomName) {
  if (!env.CANVAS_ROOM) {
    return jsonResponse(env, 500, { error: 'Canvas room binding is not configured' });
  }

  try {
    const roomId = env.CANVAS_ROOM.idFromName(roomName || 'global');
    const roomStub = env.CANVAS_ROOM.get(roomId);

    const init = {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (request.method === 'POST') {
      init.body = await request.text();
    }

    const roomResp = await roomStub.fetch('https://canvas-room.internal/live', init);
    const responseText = await roomResp.text();

    return new Response(responseText, {
      status: roomResp.status,
      headers: {
        ...getCorsHeaders(env),
        'Content-Type': roomResp.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (err) {
    const detail = err instanceof Error && err.message ? err.message : 'Unknown canvas room error';
    return jsonResponse(env, 500, { error: `Canvas room request failed: ${detail}` });
  }
}

export default {
  async fetch(request, env) {
    const corsHeaders = getCorsHeaders(env);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname.startsWith('/live/canvas/') && (request.method === 'GET' || request.method === 'POST')) {
      const auth = await verifyOwnerRequest(request, env);
      if (!auth.ok) {
        return jsonResponse(env, auth.status, { error: auth.error });
      }

      const roomName = decodeURIComponent(url.pathname.slice('/live/canvas/'.length) || 'global');
      return proxyCanvasRoomRequest(request, env, roomName);
    }

    if (url.pathname === '/catbox' && request.method === 'POST') {
      try {
        // Read incoming form data
        const clientFormData = await request.formData();

        // Reconstruct FormData to avoid 520 errors caused by Cloudflare Worker's internal FormData serialization bugs
        const newForm = new FormData();

        for (const [key, value] of clientFormData.entries()) {
          if (value instanceof File) {
            // Re-create the File object to ensure headers like filename and content-type are preserved correctly
            const arrayBuffer = await value.arrayBuffer();
            const newFile = new File([arrayBuffer], value.name, { type: value.type });
            newForm.append(key, newFile);
          } else {
            newForm.append(key, value);
          }
        }

        // Append userhash securely server-side if provided in Cloudflare environment
        if (env.CATBOX_USERHASH) {
          newForm.append('userhash', env.CATBOX_USERHASH);
        }

        // Convert FormData to an ArrayBuffer to force a Content-Length header and prevent
        // Cloudflare from using Transfer-Encoding: chunked, which Catbox's PHP server rejects (causing 520 errors)
        const tempResponse = new Response(newForm);
        const bodyBuffer = await tempResponse.arrayBuffer();
        const contentType = tempResponse.headers.get('Content-Type');

        // Forward FormData to Catbox.moe
        const catboxResponse = await fetch('https://catbox.moe/user/api.php', {
          method: 'POST',
          headers: {
            'Content-Type': contentType,
            'Content-Length': bodyBuffer.byteLength.toString(),
            'User-Agent': 'Cloudflare Worker Proxy'
          },
          body: bodyBuffer
        });

        const text = await catboxResponse.text();
        if (!catboxResponse.ok) {
          return new Response(text, { status: catboxResponse.status, headers: corsHeaders });
        }

        return new Response(text, { headers: corsHeaders });
      } catch (err) {
        return new Response('Catbox proxy error', { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname === '/auth/callback' && request.method === 'POST') {
      try {
        const { code } = await request.json();
        if (!code) {
          return jsonResponse(env, 400, { error: 'Missing code' });
        }

        const ghResp = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code,
          }),
        });

        const data = await ghResp.json();

        if (data.error) {
          return jsonResponse(env, 400, { error: data.error_description || data.error });
        }

        return jsonResponse(env, 200, { access_token: data.access_token });
      } catch (err) {
        return jsonResponse(env, 500, { error: 'Internal error' });
      }
    }

    return jsonResponse(env, 404, { error: 'Not found' });
  },
};
