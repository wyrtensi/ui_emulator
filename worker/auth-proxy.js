/**
 * Cloudflare Worker — RFO Auth Proxy
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
 */

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '*';

    const corsHeaders = {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

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
          return Response.json({ error: 'Missing code' }, { status: 400, headers: corsHeaders });
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
          return Response.json({ error: data.error_description || data.error }, { status: 400, headers: corsHeaders });
        }

        return Response.json({ access_token: data.access_token }, { headers: corsHeaders });
      } catch (err) {
        return Response.json({ error: 'Internal error' }, { status: 500, headers: corsHeaders });
      }
    }

    return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
  },
};
