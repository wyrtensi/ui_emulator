/**
 * Discussion Manager — global chat via a single GitHub Discussion.
 *
 * Uses one Discussion as a shared chatroom.
 * Discussion comments = messages. Polls every 15s for new messages.
 */

import config from '../config.js';
import { githubAuth } from './github-auth.js';
import { setupImagePaste } from './image-upload.js';

const GRAPHQL_API = 'https://api.github.com/graphql';
const { repo, discussionNumber } = config.github;
const POLL_INTERVAL = 15000; // 15 seconds

class DiscussionManager {
  constructor() {
    this._discussionId = null; // Node ID for mutations
    this._messages = [];
    this._panel = null;
    this._messagesEl = null;
    this._inputEl = null;
    this._sendBtn = null;
    this._pollTimer = null;
    this._open = false;
  }

  init() {
    this._panel = document.getElementById('ui-discussion-panel');
    this._messagesEl = document.getElementById('ui-discussion-messages');
    this._inputEl = document.getElementById('ui-discussion-input');
    this._sendBtn = document.getElementById('ui-discussion-send');

    setupImagePaste(this._inputEl);

    const toggleBtn = document.getElementById('ui-discussion-toggle');
    const closeBtn = document.getElementById('ui-discussion-close');

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

  async _gqlQuery(query, variables = {}) {
    const h = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (githubAuth.token) {
      h.Authorization = `bearer ${githubAuth.token}`;
    }

    const resp = await fetch(GRAPHQL_API, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ query, variables })
    });

    if (!resp.ok) {
      throw new Error(`GraphQL Error: ${resp.status}`);
    }

    const json = await resp.json();
    if (json.errors) {
      throw new Error(json.errors[0].message);
    }
    return json.data;
  }

  async _fetchDiscussionData() {
    const [owner, name] = repo.split('/');
    const query = `
      query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          discussion(number: $number) {
            id
            comments(last: 100) {
              nodes {
                id
                body
                createdAt
                author {
                  login
                  avatarUrl
                }
                reactions(first: 100) {
                  nodes {
                    content
                    user {
                      login
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;
    const data = await this._gqlQuery(query, { owner, name, number: discussionNumber });
    return data.repository.discussion;
  }

  /* ── Load all messages ───────────────────────────── */

  async _loadDiscussion() {
    this._messagesEl.innerHTML = '<div class="ui-discussion-loading">Loading discussion...<br><small style="color:#aaa;">Messages may take ~30s to appear due to platform delays.</small></div>';

    try {
      const discussion = await this._fetchDiscussionData();
      if (!discussion) {
        this._messagesEl.innerHTML = '<div class="ui-discussion-loading">Discussion not found.</div>';
        return;
      }
      this._discussionId = discussion.id;
      this._messages = discussion.comments.nodes || [];
      this._renderMessages();
      this._scrollToBottom();
    } catch (err) {
      console.error('[Discussion] Load failed:', err);
      if (err.message && err.message.includes('401') || err.message.includes('403')) {
        this._messagesEl.innerHTML = '<div class="ui-discussion-loading">Sign in to view and participate in the discussion.<br><small style="color:#aaa;">GitHub Discussions require authentication to view.</small></div>';
      } else {
        this._messagesEl.innerHTML = '<div class="ui-discussion-loading">Failed to load discussion</div>';
      }
    }
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
    if (!this._open || !this._discussionId) return;

    try {
      const discussion = await this._fetchDiscussionData();
      const newMessages = discussion.comments.nodes || [];

      let shouldRender = false;
      if (newMessages.length !== this._messages.length) {
        shouldRender = true;
      } else {
        for (let i = 0; i < newMessages.length; i++) {
          if (newMessages[i].id !== this._messages[i]?.id) {
            shouldRender = true; break;
          }
          const oldRx = this._messages[i]?.reactions?.nodes || [];
          const newRx = newMessages[i].reactions.nodes || [];
          if (oldRx.length !== newRx.length) {
            shouldRender = true; break;
          }
        }
      }

      if (shouldRender) {
        this._messages = newMessages;
        const wasAtBottom = this._isScrolledToBottom();
        this._renderMessages();
        if (wasAtBottom) this._scrollToBottom();
      }
    } catch { /* silent poll failure */ }
  }

  /* ── Send message ────────────────────────────────── */

  async _send() {
    if (!githubAuth.isLoggedIn) {
      if (typeof window.uiToast === 'function') window.uiToast('Sign in with GitHub to chat', 'info');
      return;
    }

    const text = this._inputEl.value.trim();
    if (!text) return;

    this._sendBtn.disabled = true;
    this._inputEl.disabled = true;

    try {
      if (!this._discussionId) throw new Error('No discussion ID');

      const query = `
        mutation($discussionId: ID!, $body: String!) {
          addDiscussionComment(input: {discussionId: $discussionId, body: $body}) {
            comment {
              id
              body
              createdAt
              author {
                login
                avatarUrl
              }
              reactions(first: 100) {
                nodes {
                  content
                  user {
                    login
                  }
                }
              }
            }
          }
        }
      `;
      const data = await this._gqlQuery(query, { discussionId: this._discussionId, body: text });
      const newMsg = data.addDiscussionComment.comment;

      this._messages.push(newMsg);
      this._renderMessages();
      this._scrollToBottom();
      this._inputEl.value = '';
    } catch (err) {
      console.error('[Discussion] Send failed:', err);
      if (typeof window.uiToast === 'function') window.uiToast('Failed to send message', 'error');
    } finally {
      this._sendBtn.disabled = false;
      this._inputEl.disabled = false;
      this._inputEl.focus();
    }
  }

  /* ── Delete message ──────────────────────────────── */

  async _deleteMessage(commentId) {
    if (!githubAuth.isLoggedIn) return;

    try {
      const query = `
        mutation($id: ID!) {
          deleteDiscussionComment(input: {id: $id}) {
            clientMutationId
          }
        }
      `;
      await this._gqlQuery(query, { id: commentId });

      this._messages = this._messages.filter(m => m.id !== commentId);
      this._renderMessages();
    } catch (err) {
      console.error('[Discussion] Delete failed:', err);
      if (typeof window.uiToast === 'function') window.uiToast('Failed to delete message', 'error');
    }
  }

  /* ── Toggle reaction ─────────────────────────────── */

  async _toggleReaction(commentId, content) {
    if (!githubAuth.isLoggedIn) {
      if (typeof window.uiToast === 'function') window.uiToast('Sign in to react', 'info');
      return;
    }

    const myLogin = githubAuth.user.login;
    const msg = this._messages.find(m => m.id === commentId);
    if (!msg) return;

    const currentReactions = msg.reactions.nodes || [];
    const hasReacted = currentReactions.some(r => r.user.login === myLogin && r.content === content);

    // Optimistic update
    if (hasReacted) {
      msg.reactions.nodes = currentReactions.filter(r => !(r.user.login === myLogin && r.content === content));
    } else {
      msg.reactions.nodes.push({ content, user: { login: myLogin } });
    }
    this._renderMessages();

    try {
      const mutationName = hasReacted ? 'removeReaction' : 'addReaction';
      const query = `
        mutation($subjectId: ID!, $content: ReactionContent!) {
          ${mutationName}(input: {subjectId: $subjectId, content: $content}) {
            reaction {
              content
            }
          }
        }
      `;
      await this._gqlQuery(query, { subjectId: commentId, content: content });
    } catch (err) {
      console.error('[Discussion] Reaction failed:', err);
      // Revert optimistic update on failure would be nice, but next poll will fix it.
    }
  }

  /* ── Render messages ─────────────────────────────── */

  _renderMessages() {
    if (!this._messagesEl) return;
    this._messagesEl.innerHTML = '';

    // Add delay notice to the top
    const notice = document.createElement('div');
    notice.style.fontSize = '10px';
    notice.style.color = '#aaa';
    notice.style.textAlign = 'center';
    notice.style.marginBottom = '8px';
    notice.innerText = 'Messages may take up to 30s to appear for others due to platform delays.';
    this._messagesEl.appendChild(notice);

    if (this._messages.length === 0) {
      const noMsg = document.createElement('div');
      noMsg.className = 'ui-discussion-loading';
      noMsg.innerText = 'No messages yet — be the first to chat!';
      this._messagesEl.appendChild(noMsg);
      return;
    }

    for (const msg of this._messages) {
      if (!msg || !msg.author) continue;

      const el = document.createElement('div');
      const isOwn = githubAuth.user?.login === msg.author.login;
      // Author and Repo Owner can delete
      const canDelete = isOwn || (githubAuth.isLoggedIn && githubAuth.isOwner);
      el.className = 'ui-discussion-msg' + (isOwn ? ' ui-discussion-msg-own' : '');
      el.dataset.id = msg.id;

      const time = new Date(msg.createdAt);
      const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateStr = time.toLocaleDateString();

      const reactionCounts = {};
      const reactionTypes = ['THUMBS_UP', 'HEART', 'LAUGH', 'HOORAY', 'CONFUSED', 'MINUS_ONE', 'ROCKET', 'EYES'];
      const emojis = { THUMBS_UP: '👍', HEART: '❤️', LAUGH: '😄', HOORAY: '🎉', CONFUSED: '😕', MINUS_ONE: '👎', ROCKET: '🚀', EYES: '👀' };

      if (msg.reactions && msg.reactions.nodes) {
        for (const r of msg.reactions.nodes) {
          if (!reactionCounts[r.content]) reactionCounts[r.content] = [];
          reactionCounts[r.content].push(r.user.login);
        }
      }

      let reactionsHtml = '';
      for (const rt of reactionTypes) {
        const users = reactionCounts[rt] || [];
        if (users.length > 0) {
          const reactedByMe = githubAuth.user && users.includes(githubAuth.user.login);
          reactionsHtml += `<span class="ui-discussion-reaction ${reactedByMe ? 'active' : ''}" data-type="${rt}" data-id="${msg.id}" title="${users.join(', ')}">${emojis[rt]} ${users.length}</span>`;
        }
      }
      reactionsHtml += `<span class="ui-discussion-reaction-add" data-id="${msg.id}">+👍</span>`;

      el.innerHTML = `
        <img class="ui-discussion-avatar" src="${this._escAttr(msg.author.avatarUrl)}" alt="" width="24" height="24">
        <div class="ui-discussion-msg-body">
          <div class="ui-discussion-msg-header">
            <span class="ui-discussion-author">${this._esc(msg.author.login)}</span>
            <span class="ui-discussion-time" title="${dateStr}">${timeStr}</span>
            ${canDelete ? `<button class="ui-discussion-msg-del" data-id="${msg.id}" title="Delete Message">&times;</button>` : ''}
          </div>
          <div class="ui-discussion-text">${this._escAndLinkify(msg.body)}</div>
          <div class="ui-discussion-reactions">
            ${reactionsHtml}
          </div>
        </div>
      `;
      this._messagesEl.appendChild(el);
    }

    const delBtns = this._messagesEl.querySelectorAll('.ui-discussion-msg-del');
    delBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Delete this message?')) {
          this._deleteMessage(btn.getAttribute('data-id'));
        }
      });
    });

    const rxBtns = this._messagesEl.querySelectorAll('.ui-discussion-reaction');
    rxBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const type = btn.getAttribute('data-type');
        this._toggleReaction(id, type);
      });
    });

    const addRxBtns = this._messagesEl.querySelectorAll('.ui-discussion-reaction-add');
    addRxBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        this._toggleReaction(id, 'THUMBS_UP');
      });
    });
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

    const mdLinks = [];
    const addMdLink = (html) => {
      mdLinks.push(html);
      return `__MDLINK_${mdLinks.length - 1}__`;
    };

    // Markdown links: [label](#canvas:slug or #canvasid:nodeId)
    escaped = escaped.replace(
      /\[([^\]]+)\]\(\s*(#canvas(?:id)?:[^)\s]+)\s*\)/g,
      (m, label, href) => addMdLink(`<a href="${href}" class="canvas-link" target="_self">${label}</a>`)
    );

    // Markdown links: [label](https://...)
    escaped = escaped.replace(
      /\[([^\]]+)\]\(\s*(https?:\/\/[^)\s]+)\s*\)/g,
      (m, label, href) => addMdLink(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`)
    );

    // Linkify URLs
    escaped = escaped.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    // Linkify Canvas hashes (#canvas:Something / #canvasid:NodeId)
    escaped = escaped.replace(
      /(#canvas(?:id)?:[a-zA-Z0-9_\-\.]+)/g,
      '<a href="$1" class="canvas-link" target="_self">$1</a>'
    );

    // Re-inject markdown links after URL/hash linkification
    escaped = escaped.replace(/__MDLINK_(\d+)__/g, (match, idx) => mdLinks[Number(idx)] || match);

    // Re-inject images safely
    escaped = escaped.replace(/__IMG_PLACEHOLDER_(\d+)__/g, (match, idx) => {
      let safeSrc = this._escAttr(images[idx]);

      // Proxy files.catbox.moe through a public image proxy to avoid ISP blocks (ERR_TIMED_OUT)
      if (safeSrc.includes('files.catbox.moe')) {
        safeSrc = `https://wsrv.nl/?url=${encodeURIComponent(safeSrc)}`;
      }

      return `<img src="${safeSrc}" alt="Image" loading="lazy" style="max-width: 100%;" />`;
    });

    return escaped;
  }
}

export const discussionManager = new DiscussionManager();
