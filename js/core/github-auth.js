/**
 * GitHub Auth — OAuth flow for GitHub Pages (static site).
 *
 * Flow:
 *   1. User clicks "Sign in" → redirect to GitHub /login/oauth/authorize
 *   2. GitHub redirects back with ?code=XXX
 *   3. We POST the code to a Cloudflare Worker that exchanges it for an access_token
 *   4. Token stored in sessionStorage; user info fetched from /user
 */

import config from '../config.js';

const STORAGE_KEY = 'ui_gh_token';
const USER_KEY = 'ui_gh_user';
const STORAGE = localStorage;   // persist across tabs & sessions

class GitHubAuth {
  constructor() {
    this._token = null;
    this._user = null;
    this._listeners = [];
  }

  /* ── Public API ──────────────────────────────────── */

  /** Current logged-in user object or null */
  get user() { return this._user; }

  /** Current access token or null */
  get token() { return this._token; }

  get isLoggedIn() { return !!this._token && !!this._user; }

  /** Is the current user the repo owner? */
  get isOwner() {
    if (!this._user) return false;
    const owner = config.github.repo.split('/')[0];
    return this._user.login.toLowerCase() === owner.toLowerCase();
  }

  /** Register a callback for auth state changes */
  onAuthChange(fn) { this._listeners.push(fn); }

  /** Kick off the OAuth redirect */
  login() {
    const redirectUri = window.location.origin + window.location.pathname;
    const scope = 'public_repo';
    const url = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(config.github.clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`;
    window.location.href = url;
  }

  /** Clear session */
  logout() {
    this._token = null;
    this._user = null;
    STORAGE.removeItem(STORAGE_KEY);
    STORAGE.removeItem(USER_KEY);
    this._notify();
  }

  /**
   * Call on page load — handles OAuth callback and restores session.
   * Returns true if user is logged in after init.
   */
  async init() {
    // 1. Check for OAuth callback code in URL
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code) {
      // Remove code from URL to prevent re-use on refresh
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);

      try {
        this._token = await this._exchangeCode(code);
        this._user = await this._fetchUser();
        STORAGE.setItem(STORAGE_KEY, this._token);
        STORAGE.setItem(USER_KEY, JSON.stringify(this._user));
        this._notify();
        return true;
      } catch (err) {
        console.error('[GitHubAuth] OAuth exchange failed:', err);
        this._token = null;
        this._user = null;
        // Surface error visibly so user knows what went wrong
        if (typeof window.uiToast === 'function') {
          window.uiToast('GitHub sign-in failed: ' + (err.message || err), 'error');
        }
      }
    }

    // 2. Restore from localStorage
    const saved = STORAGE.getItem(STORAGE_KEY);
    if (saved) {
      this._token = saved;
      try {
        const cachedUser = STORAGE.getItem(USER_KEY);
        this._user = cachedUser ? JSON.parse(cachedUser) : await this._fetchUser();
        if (!cachedUser) STORAGE.setItem(USER_KEY, JSON.stringify(this._user));
        this._notify();
        return true;
      } catch {
        // Token expired or invalid
        this.logout();
      }
    }

    this._notify();
    return false;
  }

  /* ── Private ─────────────────────────────────────── */

  async _exchangeCode(code) {
    const resp = await fetch(config.github.workerUrl + '/auth/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!resp.ok) throw new Error('Token exchange failed: ' + resp.status);
    const data = await resp.json();
    if (!data.access_token) throw new Error('No access_token in response');
    return data.access_token;
  }

  async _fetchUser() {
    const resp = await fetch('https://api.github.com/user', {
      headers: { Authorization: `token ${this._token}` },
    });
    if (!resp.ok) throw new Error('Failed to fetch user: ' + resp.status);
    return resp.json();
  }

  _notify() {
    for (const fn of this._listeners) {
      try { fn(this._user, this._token); } catch (e) { console.error(e); }
    }
  }
}

export const githubAuth = new GitHubAuth();
