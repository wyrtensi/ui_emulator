/**
 * Discussion Manager — global chat via a single GitHub Issue.
 *
 * Uses one issue titled "[DISCUSSION] UI Emulator Chat" as a shared chatroom.
 * Issue comments = messages. Polls every 15s for new messages.
 */

import config from '../config.js';
import { githubAuth } from './github-auth.js';
import { setupImagePaste } from './image-upload.js';

const API = 'https://api.github.com';
const { repo, pinLabel } = config.github;
const DISCUSSION_TITLE = '[DISCUSSION] UI Emulator Chat';
const POLL_INTERVAL = 15000; // 15 seconds

class DiscussionManager {
  constructor() {
    this._issueNumber = null;
    this._messages = [];
    this._panel = null;
    this._messagesEl = null;
    this._inputEl = null;
    this._sendBtn = null;
    this._pollTimer = null;
    this._lastMessageId = 0;
    this._open = false;
  }

  init() {
    this._panel = document.getElementById('rfo-discussion-panel');
    this._messagesEl = document.getElementById('rfo-discussion-messages');
    this._inputEl = document.getElementById('rfo-discussion-input');
    this._sendBtn = document.getElementById('rfo-discussion-send');

    setupImagePaste(this._inputEl);

    const toggleBtn = document.getElementById('rfo-discussion-toggle');
    const closeBtn = document.getElementById('rfo-discussion-close');

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggle());
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }

    if (this._sendBtn) {
      this._sendBtn.addEventListener('click', () => this._send());
    }

    if (this._inputEl) {
      this._inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this._send();
        }
      });
    }
  }

  toggle() {
    if (this._open) {
      this.close();
    } else {
      this.open();
    }
  }

  async open() {
    if (!this._panel) return;
    this._open = true;
    this._panel.classList.remove('closed');

    // Load discussion
    await this._loadDiscussion();

    // Start polling
    this._startPoll();
  }

  close() {
    if (!this._panel) return;
    this._open = false;
    this._panel.classList.add('closed');
    this._stopPoll();
  }

  /* ── Find or create the discussion issue ─────────── */

  async _findOrCreateIssue() {
    if (this._issueNumber) return this._issueNumber;

    // Search for existing discussion issue
    const q = encodeURIComponent(`repo:${repo} is:issue is:open "${DISCUSSION_TITLE}" in:title`);
    const resp = await fetch(`${API}/search/issues?q=${q}&per_page=5`, {
      headers: this._headers(false),
    });

    if (resp.ok) {
      const data = await resp.json();
      const found = (data.items || []).find(i => i.title === DISCUSSION_TITLE);
      if (found) {
        this._issueNumber = found.number;
        return this._issueNumber;
      }
    }

    // Create if not found (requires auth)
    if (!githubAuth.isLoggedIn) return null;

    const createResp = await fetch(`${API}/repos/${repo}/issues`, {
      method: 'POST',
      headers: { ...this._headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: DISCUSSION_TITLE,
        body: 'This issue serves as the global discussion chat for the RFO UI Emulator.\n\nAdd comments below to chat with other users.',
        labels: [pinLabel],
      }),
    });

    if (createResp.ok) {
      const issue = await createResp.json();
      this._issueNumber = issue.number;
      return this._issueNumber;
    }

    return null;
  }

  /* ── Load all messages ───────────────────────────── */

  async _loadDiscussion() {
    this._messagesEl.innerHTML = '<div class="rfo-discussion-loading">Loading discussion...</div>';

    try {
      const issueNum = await this._findOrCreateIssue();
      if (!issueNum) {
        this._messagesEl.innerHTML = '<div class="rfo-discussion-loading">Sign in to start a discussion</div>';
        return;
      }

      const messages = await this._fetchMessages();
      this._messages = messages;
      this._renderMessages();
    } catch (err) {
      console.error('[Discussion] Load failed:', err);
      this._messagesEl.innerHTML = '<div class="rfo-discussion-loading">Failed to load discussion</div>';
    }
  }

  async _fetchMessages() {
    if (!this._issueNumber) return [];

    const resp = await fetch(
      `${API}/repos/${repo}/issues/${this._issueNumber}/comments?per_page=100&sort=created&direction=asc`,
      { headers: this._headers(false) }
    );
    if (!resp.ok) return [];
    return await resp.json();
  }

  /* ── Poll for new messages ───────────────────────── */

  _startPoll() {
    this._stopPoll();
    this._pollTimer = setInterval(() => this._pollNewMessages(), POLL_INTERVAL);
  }

  _stopPoll() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async _pollNewMessages() {
    if (!this._open || !this._issueNumber) return;

    try {
      const messages = await this._fetchMessages();
      if (messages.length !== this._messages.length) {
        this._messages = messages;
        const wasAtBottom = this._isScrolledToBottom();
        this._renderMessages();
        if (wasAtBottom) this._scrollToBottom();
      }
    } catch { /* silent poll failure */ }
  }

  /* ── Send message ────────────────────────────────── */

  async _send() {
    if (!githubAuth.isLoggedIn) {
      if (typeof window.rfoToast === 'function') window.rfoToast('Sign in with GitHub to chat', 'info');
      return;
    }

    const text = this._inputEl.value.trim();
    if (!text) return;

    this._sendBtn.disabled = true;
    this._inputEl.disabled = true;

    try {
      const issueNum = await this._findOrCreateIssue();
      if (!issueNum) throw new Error('No discussion issue');

      const resp = await fetch(`${API}/repos/${repo}/issues/${issueNum}/comments`, {
        method: 'POST',
        headers: { ...this._headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });

      if (!resp.ok) throw new Error('Failed to send');

      const newMsg = await resp.json();
      this._messages.push(newMsg);
      this._renderMessages();
      this._scrollToBottom();
      this._inputEl.value = '';
    } catch (err) {
      console.error('[Discussion] Send failed:', err);
      if (typeof window.rfoToast === 'function') window.rfoToast('Failed to send message', 'error');
    } finally {
      this._sendBtn.disabled = false;
      this._inputEl.disabled = false;
      this._inputEl.focus();
    }
  }

  /* ── Render messages ─────────────────────────────── */

  _renderMessages() {
    if (!this._messagesEl) return;
    this._messagesEl.innerHTML = '';

    if (this._messages.length === 0) {
      this._messagesEl.innerHTML = '<div class="rfo-discussion-loading">No messages yet — be the first to chat!</div>';
      return;
    }

    for (const msg of this._messages) {
      const el = document.createElement('div');
      const isOwn = githubAuth.user?.login === msg.user.login;
      el.className = 'rfo-discussion-msg' + (isOwn ? ' rfo-discussion-msg-own' : '');

      const time = new Date(msg.created_at);
      const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateStr = time.toLocaleDateString();

      el.innerHTML = `
        <img class="rfo-discussion-avatar" src="${this._escAttr(msg.user.avatar_url)}" alt="" width="24" height="24">
        <div class="rfo-discussion-msg-body">
          <div class="rfo-discussion-msg-header">
            <span class="rfo-discussion-author">${this._esc(msg.user.login)}</span>
            <span class="rfo-discussion-time" title="${dateStr}">${timeStr}</span>
          </div>
          <div class="rfo-discussion-text">${this._escAndLinkify(msg.body)}</div>
        </div>
      `;
      this._messagesEl.appendChild(el);
    }

    this._lastMessageId = this._messages[this._messages.length - 1]?.id || 0;
  }

  _scrollToBottom() {
    if (this._messagesEl) {
      this._messagesEl.scrollTop = this._messagesEl.scrollHeight;
    }
  }

  _isScrolledToBottom() {
    if (!this._messagesEl) return true;
    return this._messagesEl.scrollHeight - this._messagesEl.scrollTop - this._messagesEl.clientHeight < 40;
  }

  /* ── Helpers ─────────────────────────────────────── */

  _headers(auth = true) {
    const h = { Accept: 'application/vnd.github.v3+json' };
    if (auth && githubAuth.token) {
      h.Authorization = `token ${githubAuth.token}`;
    }
    return h;
  }

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  _escAttr(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  _escAndLinkify(text) {
    const images = [];
    const textWithPlaceholders = (text || '').replace(/<img\s+[^>]*src="([^"]+)"[^>]*>/gi, (match, src) => {
      images.push(src);
      return `__IMG_PLACEHOLDER_${images.length - 1}__`;
    });

    let escaped = this._esc(textWithPlaceholders);

    // Linkify URLs
    escaped = escaped.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    // Re-inject images safely
    escaped = escaped.replace(/__IMG_PLACEHOLDER_(\d+)__/g, (match, idx) => {
      const safeSrc = this._escAttr(images[idx]);
      return `<img src="${safeSrc}" alt="Image" loading="lazy" />`;
    });

    return escaped;
  }
}

export const discussionManager = new DiscussionManager();
