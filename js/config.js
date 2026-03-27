/**
 * RFO UI Emulator — Configuration
 * Fill in the values below after setting up your GitHub OAuth App
 * and Cloudflare Worker.
 */
export default {
  github: {
    // 1. Create a GitHub OAuth App: Settings → Developer settings → OAuth Apps → New
    clientId: 'Ov23liImBzxpyx4fQXG2',

    // 2. Your GitHub repo in "owner/repo" format
    repo: 'wyrtensi/ui_emulator',

    // 3. Your Cloudflare Worker URL (deployed from worker/auth-proxy.js)
    workerUrl: 'https://ui-emulator-auth.wyrtensi.workers.dev',

    // Label used to identify pin issues (auto-created if missing)
    pinLabel: 'ui-emulator-pin',
  },
};
