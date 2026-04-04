/**
 * UI Emulator — Configuration
 * Fill in the values below after setting up your GitHub OAuth App
 * and Cloudflare Worker.
 */
export default {
  github: {
    clientId: 'Ov23liImBzxpyx4fQXG2',
    repo: 'wyrtensi/ui_emulator',
    branch: 'main',
    workerUrl: 'https://ui-emulator-auth.wyrtensi.workers.dev',
    pinLabel: 'ui-emulator-pin',
    discussionNumber: 35,
  },
  live: {
    enabled: true,
    roomId: 'global',
    workerUrl: 'https://ui-emulator-auth.wyrtensi.workers.dev',
    pollIntervalMs: 2200,
    syncDebounceMs: 1200,
    allowedEditors: [],
  },
};
