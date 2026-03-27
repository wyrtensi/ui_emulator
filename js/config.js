/**
 * RFO UI Emulator — Configuration
 * Fill in the values below after setting up your GitHub OAuth App
 * and Cloudflare Worker.
 */
export default {
  github: {
    // 1. Create a GitHub OAuth App: Settings → Developer settings → OAuth Apps → New
    clientId: 'YOUR_GITHUB_CLIENT_ID',

    // 2. Your GitHub repo in "owner/repo" format
    repo: 'YOUR_USERNAME/rfo_ui_emulator',

    // 3. Your Cloudflare Worker URL (deployed from worker/auth-proxy.js)
    workerUrl: 'https://rfo-auth.YOUR_SUBDOMAIN.workers.dev',

    // Label used to identify pin issues (auto-created if missing)
    pinLabel: 'rfo-pin',
  },
};
