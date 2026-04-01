/**
 * Pin Store — CRUD for comment pins via GitHub Issues API.
 *
 * Each pin = 1 GitHub Issue
 *   - Title: "[PIN] {windowId} | {x},{y}"
 *   - Body: JSON metadata in HTML comment + first message text
 *   - Labels: ["ui-pin"]
 *   - Issue comments = thread replies
 *
 * Unauthenticated users can read pins (public repo).
 * Authenticated users can create, reply, delete own.
 * Repo owner can delete any, close, lock.
 */

import config from '../config.js';
import { githubAuth } from './github-auth.js';

const API = 'https://api.github.com';
const { repo, pinLabel } = config.github;

class PinStore {
  constructor() {
    this._labelChecked = false;
  }

  /* ── Headers ─────────────────────────────────────── */

  _headers(auth = true) {
    const h = { Accept: 'application/vnd.github.v3+json' };
    if (auth && githubAuth.token) {
      h.Authorization = `token ${githubAuth.token}`;
    }
    return h;
  }

  /* ── Ensure label exists ─────────────────────────── */

  async _ensureLabel() {
    if (this._labelChecked) return;
    try {
      const resp = await fetch(`${API}/repos/${repo}/labels/${encodeURIComponent(pinLabel)}`, {
        headers: this._headers(),
      });
      if (resp.status === 404) {
        await fetch(`${API}/repos/${repo}/labels`, {
          method: 'POST',
          headers: { ...this._headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: pinLabel, color: 'ff4080', description: 'UI Emulator pin' }),
        });
      }
    } catch { /* ignore — label may already exist */ }
    this._labelChecked = true;
  }

  /* ── Load all pins ───────────────────────────────── */

  async loadAll() {
    const pins = [];
    let page = 1;

    // Use search API to find all [PIN] issues regardless of label
    // (non-collaborators can't add labels, so label filter misses their pins)
    while (true) {
      const q = encodeURIComponent(`repo:${repo} is:issue "[PIN]" in:title`);
      const resp = await fetch(
        `${API}/search/issues?q=${q}&per_page=100&page=${page}`,
        { headers: this._headers(false) }
      );
      if (!resp.ok) throw new Error('Failed to load pins: ' + resp.status);
      const data = await resp.json();
      const issues = data.items || [];
      if (issues.length === 0) break;

      for (const issue of issues) {
        const pin = this._parseIssue(issue);
        if (pin) pins.push(pin);
      }
      page++;
      if (issues.length < 100) break;
    }

    return pins;
  }

  /* ── Load thread replies for one pin ─────────────── */

  async loadReplies(issueNumber) {
    const resp = await fetch(
      `${API}/repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
      { headers: this._headers(false) }
    );
    if (!resp.ok) return [];
    const comments = await resp.json();

    return comments.map(c => ({
      id: c.id,
      author: c.user.login,
      avatarUrl: c.user.avatar_url,
      text: c.body,
      timestamp: c.created_at,
      canDelete: githubAuth.isOwner || (githubAuth.user?.login === c.user.login),
    }));
  }

  /* ── Create pin ──────────────────────────────────── */

  async createPin(windowId, relativeX, relativeY, text) {
    await this._ensureLabel();

    const meta = { windowId, relativeX, relativeY, v: 1 };
    const body = `<!-- UI_PIN ${JSON.stringify(meta)} -->\n\n${text}`;

    const resp = await fetch(`${API}/repos/${repo}/issues`, {
      method: 'POST',
      headers: { ...this._headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `[PIN] ${windowId} | ${relativeX.toFixed(3)},${relativeY.toFixed(3)}`,
        body,
        labels: [pinLabel],
      }),
    });

    if (!resp.ok) throw new Error('Failed to create pin: ' + resp.status);
    const issue = await resp.json();
    return this._parseIssue(issue);
  }

  /* ── Reply to pin ────────────────────────────────── */

  async addReply(issueNumber, text) {
    const resp = await fetch(`${API}/repos/${repo}/issues/${issueNumber}/comments`, {
      method: 'POST',
      headers: { ...this._headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: text }),
    });

    if (!resp.ok) throw new Error('Failed to add reply: ' + resp.status);
    const c = await resp.json();
    return {
      id: c.id,
      author: c.user.login,
      avatarUrl: c.user.avatar_url,
      text: c.body,
      timestamp: c.created_at,
      canDelete: true,
    };
  }

  /* ── Update pin body (set first message text) ────── */

  async updatePinBody(issueNumber, windowId, relX, relY, text) {
    const meta = { windowId, relativeX: relX, relativeY: relY, v: 1 };
    const body = `<!-- UI_PIN ${JSON.stringify(meta)} -->\n\n${text}`;

    const resp = await fetch(`${API}/repos/${repo}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers: { ...this._headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (!resp.ok) throw new Error('Failed to update pin body: ' + resp.status);
  }

  /* ── Move pin (update coordinates) ─────────────── */

  async movePin(issueNumber, windowId, relX, relY, existingText) {
    const meta = { windowId, relativeX: relX, relativeY: relY, v: 1 };
    const body = `<!-- UI_PIN ${JSON.stringify(meta)} -->\n\n${existingText || ''}`;
    const title = `[PIN] ${windowId} | ${relX.toFixed(3)},${relY.toFixed(3)}`;

    const resp = await fetch(`${API}/repos/${repo}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers: { ...this._headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body }),
    });
    if (!resp.ok) throw new Error('Failed to move pin: ' + resp.status);
  }

  /* ── Resolve pin (close issue as completed) ──────── */

  async resolvePin(issueNumber) {
    const resp = await fetch(`${API}/repos/${repo}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers: { ...this._headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
    });
    if (!resp.ok) throw new Error('Failed to resolve pin: ' + resp.status);
  }

  /* ── Delete pin (close issue) ────────────────────── */

  async deletePin(issueNumber) {
    const resp = await fetch(`${API}/repos/${repo}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers: { ...this._headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'closed' }),
    });
    if (!resp.ok) throw new Error('Failed to delete pin: ' + resp.status);
  }

  /* ── Delete reply ────────────────────────────────── */

  async deleteReply(commentId) {
    const resp = await fetch(`${API}/repos/${repo}/issues/comments/${commentId}`, {
      method: 'DELETE',
      headers: this._headers(),
    });
    if (!resp.ok) throw new Error('Failed to delete reply: ' + resp.status);
  }

  /* ── Lock pin (owner only) ──────────────────────── */

  async lockPin(issueNumber) {
    await fetch(`${API}/repos/${repo}/issues/${issueNumber}/lock`, {
      method: 'PUT',
      headers: { ...this._headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ lock_reason: 'resolved' }),
    });
  }

  /* ── Parse issue into pin object ─────────────────── */

  _parseIssue(issue) {
    const match = issue.body?.match(/<!-- UI_PIN (.+?) -->/);
    if (!match) return null;

    let meta;
    try { meta = JSON.parse(match[1]); } catch { return null; }

    const textAfterMeta = issue.body.replace(/<!-- UI_PIN .+? -->\n*/, '').trim();

    return {
      issueNumber: issue.number,
      windowId: meta.windowId,
      relativeX: meta.relativeX,
      relativeY: meta.relativeY,
      author: issue.user.login,
      avatarUrl: issue.user.avatar_url,
      text: textAfterMeta,
      timestamp: issue.created_at,
      commentCount: issue.comments,
      locked: issue.locked,
      canDelete: githubAuth.isOwner || (githubAuth.user?.login === issue.user.login),
    };
  }
}

export const pinStore = new PinStore();
