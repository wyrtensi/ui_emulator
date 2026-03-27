/**
 * Comment Manager v3 — threaded pin annotations with GitHub Issues backend.
 *
 * When authenticated via GitHub:
 *   - Pins are GitHub Issues (CRUD via pin-store.js)
 *   - Replies are Issue comments (threaded)
 *   - Owner can delete/lock any pin
 *
 * When NOT authenticated:
 *   - Pins are local-only (localStorage via layout presets) — legacy mode
 *   - Double-click to place, type to comment
 *
 * Space key toggles pin visibility in comment mode.
 */

import { settings } from './settings.js';
import { windowManager } from './window-manager.js';
import { githubAuth } from './github-auth.js';
import { pinStore } from './pin-store.js';

let pinCounter = 0;

class CommentManager {
  constructor() {
    this._pins = [];            // unified pin array (remote + local)
    this._activeCard = null;
    this._pinsVisible = true;
    this._commentPanelList = null;
    this._pinCountEl = null;
    this._toolbar = null;
    this._authorInput = null;
    this._loading = false;
  }

  init() {
    this._commentPanelList = document.getElementById('rfo-comments-list');
    this._pinCountEl = document.getElementById('rfo-pin-count');
    this._toolbar = document.getElementById('rfo-comment-toolbar');
    this._authorInput = document.getElementById('rfo-author-name');

    // Load saved author name
    const savedAuthor = settings.get('authorName');
    if (savedAuthor && this._authorInput) {
      this._authorInput.value = savedAuthor;
    }

    // Save author name on change
    if (this._authorInput) {
      this._authorInput.addEventListener('input', () => {
        settings.set('authorName', this._authorInput.value.trim());
      });
    }

    // Double-click on any window to place a pin (works in ALL modes)
    document.getElementById('rfo-windows').addEventListener('dblclick', (e) => {
      const windowEl = e.target.closest('.rfo-window');
      if (!windowEl) return;
      if (e.target.closest('.comment-pin, .comment-card')) return;

      const rect = windowEl.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;

      this._placePin(windowEl.dataset.windowId, relX, relY);
    });

    // Toggle pins visibility
    const toggleBtn = document.getElementById('rfo-toggle-pins');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.togglePinsVisibility());
    }

    // Clear all local pins
    const clearBtn = document.getElementById('rfo-comments-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (this._pins.length === 0) return;
        if (githubAuth.isLoggedIn) {
          this._toast('Remote pins are managed on GitHub — use pin delete buttons', 'info');
          return;
        }
        this.clearAll();
        this._toast('All comment pins cleared', 'info');
      });
    }

    // Space key toggles pins in comment mode
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && settings.get('mode') === 'comment' && !e.target.closest('input, textarea, select')) {
        e.preventDefault();
        this.togglePinsVisibility();
      }
    });

    // Close card when clicking outside
    document.addEventListener('pointerdown', (e) => {
      if (this._activeCard && !this._activeCard.contains(e.target) && !e.target.closest('.comment-pin')) {
        this._closeActiveCard();
      }
    });
  }

  /* ── Toast helper ────────────────────────────────── */
  _toast(msg, type = 'info') {
    if (typeof window.rfoToast === 'function') window.rfoToast(msg, type);
  }

  /* ── Place a new pin (local or remote) ───────────── */
  async _placePin(windowId, relX, relY) {
    if (githubAuth.isLoggedIn) {
      // Remote: create via GitHub Issues
      try {
        const pin = await pinStore.createPin(windowId, relX, relY, '');
        this._pins.push(pin);
        this._renderPin(pin);
        this._updatePanelList();

        // Open card to type first message
        const entry = windowManager.get(pin.windowId);
        if (entry) {
          const pinEl = entry.container.querySelector(`[data-pin-id="gh_${pin.issueNumber}"]`);
          if (pinEl) this._openCard(pin, pinEl, entry.container);
        }
        this._toast('Pin created', 'success');
      } catch (err) {
        console.error('[CommentManager] Create pin failed:', err);
        this._toast('Failed to create pin — check GitHub config', 'error');
      }
    } else {
      // Local fallback
      this._addLocalPin(windowId, relX, relY);
    }
  }

  /* ── Add local-only pin (legacy/offline) ─────────── */
  _addLocalPin(windowId, relX, relY, data = {}) {
    const author = data.author || this._getAuthorName();

    const pin = {
      id: data.id || `pin_${Date.now()}_${++pinCounter}`,
      windowId,
      relativeX: relX,
      relativeY: relY,
      text: data.text || '',
      author,
      timestamp: data.timestamp || new Date().toISOString(),
      _local: true,
    };

    this._pins.push(pin);
    this._renderPin(pin);
    this._updatePanelList();

    if (!data.id) {
      const entry = windowManager.get(pin.windowId);
      if (entry) {
        const pinEl = entry.container.querySelector(`[data-pin-id="${pin.id}"]`);
        if (pinEl) this._openCard(pin, pinEl, entry.container);
      }
    }

    return pin;
  }

  _getAuthorName() {
    if (githubAuth.isLoggedIn) return githubAuth.user.login;
    if (this._authorInput && this._authorInput.value.trim()) return this._authorInput.value.trim();
    return settings.get('authorName') || 'Anonymous';
  }

  /* ── Load remote pins from GitHub Issues ─────────── */
  async loadRemotePins() {
    this._loading = true;
    try {
      const remotePins = await pinStore.loadAll();
      // Remove any previous remote pins, keep local
      this._pins = this._pins.filter(p => p._local);
      this._pins.push(...remotePins);
      this._rerenderAll();
      this._updatePanelList();
    } catch (err) {
      console.error('[CommentManager] Failed to load remote pins:', err);
      this._toast('Could not load pins from GitHub', 'error');
    } finally {
      this._loading = false;
    }
  }

  /* ── Get pin id for DOM (unified) ────────────────── */
  _pinDomId(pin) {
    return pin.issueNumber ? `gh_${pin.issueNumber}` : pin.id;
  }

  /* ── Render pin on overlay ────────────────────────── */
  _renderPin(pin) {
    const entry = windowManager.get(pin.windowId);
    if (!entry) return;

    const pinEl = document.createElement('div');
    pinEl.className = 'comment-pin' + (pin.issueNumber ? ' comment-pin-remote' : '');
    pinEl.dataset.pinId = this._pinDomId(pin);

    const idx = this._pins.indexOf(pin) + 1;
    pinEl.textContent = idx;

    // Thread count badge
    if (pin.commentCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'pin-reply-badge';
      badge.textContent = pin.commentCount;
      pinEl.appendChild(badge);
    }

    pinEl.style.position = 'absolute';
    pinEl.style.left = (pin.relativeX * 100) + '%';
    pinEl.style.top = (pin.relativeY * 100) + '%';

    pinEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this._openCard(pin, pinEl, entry.container);
    });

    let pinsContainer = entry.container.querySelector('.rfo-pins-layer');
    if (!pinsContainer) {
      pinsContainer = document.createElement('div');
      pinsContainer.className = 'rfo-pins-layer';
      pinsContainer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:9999;';
      if (!this._pinsVisible) pinsContainer.classList.add('rfo-pins-hidden');
      entry.container.appendChild(pinsContainer);
    }
    pinsContainer.appendChild(pinEl);
  }

  /* ── Open comment card (threaded) ─────────────────── */
  async _openCard(pin, pinEl, windowContainer) {
    this._closeActiveCard();

    const card = document.createElement('div');
    card.className = 'comment-card';

    // Header
    const header = document.createElement('div');
    header.className = 'comment-card-header';
    header.innerHTML = `
      ${pin.avatarUrl ? `<img class="comment-avatar" src="${this._escAttr(pin.avatarUrl)}" alt="">` : ''}
      <span class="comment-author">${this._esc(pin.author)}</span>
      <span class="comment-time">${new Date(pin.timestamp).toLocaleString()}</span>
      ${pin.canDelete ? '<button class="comment-delete" title="Delete pin">✕</button>' : ''}
    `;
    card.appendChild(header);

    // First message
    if (pin.text) {
      const msg = document.createElement('div');
      msg.className = 'comment-message';
      msg.textContent = pin.text;
      card.appendChild(msg);
    }

    // Thread replies (remote pins only)
    if (pin.issueNumber) {
      const threadEl = document.createElement('div');
      threadEl.className = 'comment-thread';
      threadEl.innerHTML = '<div class="comment-thread-loading">Loading replies...</div>';
      card.appendChild(threadEl);

      // Load replies async
      pinStore.loadReplies(pin.issueNumber).then(replies => {
        threadEl.innerHTML = '';
        for (const r of replies) {
          threadEl.appendChild(this._renderReply(r, pin));
        }
        if (replies.length === 0 && !pin.text) {
          threadEl.innerHTML = '<div class="comment-thread-empty">No messages yet</div>';
        }
      }).catch(() => {
        threadEl.innerHTML = '<div class="comment-thread-empty">Failed to load replies</div>';
      });

      // Reply input (if logged in and not locked)
      if (githubAuth.isLoggedIn && !pin.locked) {
        const replyWrap = document.createElement('div');
        replyWrap.className = 'comment-reply-wrap';
        replyWrap.innerHTML = `
          <textarea class="comment-reply-input" rows="2" placeholder="Write a reply..."></textarea>
          <button class="comment-reply-btn">Reply</button>
        `;
        card.appendChild(replyWrap);

        const replyBtn = replyWrap.querySelector('.comment-reply-btn');
        const replyInput = replyWrap.querySelector('.comment-reply-input');

        replyBtn.addEventListener('click', async () => {
          const text = replyInput.value.trim();
          if (!text) return;
          replyBtn.disabled = true;
          try {
            const reply = await pinStore.addReply(pin.issueNumber, text);
            const threadEl2 = card.querySelector('.comment-thread');
            const emptyMsg = threadEl2.querySelector('.comment-thread-empty');
            if (emptyMsg) emptyMsg.remove();
            threadEl2.appendChild(this._renderReply(reply, pin));
            replyInput.value = '';
            pin.commentCount = (pin.commentCount || 0) + 1;
            this._toast('Reply added', 'success');
          } catch {
            this._toast('Failed to post reply', 'error');
          } finally {
            replyBtn.disabled = false;
          }
        });
      } else if (pin.locked) {
        const lockMsg = document.createElement('div');
        lockMsg.className = 'comment-thread-locked';
        lockMsg.textContent = '🔒 This thread is locked';
        card.appendChild(lockMsg);
      }
    } else {
      // Local pin — edit textarea
      const textarea = document.createElement('textarea');
      textarea.className = 'comment-text';
      textarea.rows = 3;
      textarea.placeholder = 'Write your comment...';
      textarea.value = pin.text || '';
      card.appendChild(textarea);

      const footer = document.createElement('div');
      footer.className = 'comment-card-footer';
      footer.innerHTML = '<button class="comment-save-btn">Save</button>';
      card.appendChild(footer);

      footer.querySelector('.comment-save-btn').addEventListener('click', () => {
        pin.text = textarea.value;
        this._updatePanelList();
        this._closeActiveCard();
        this._toast('Comment saved', 'success');
      });

      requestAnimationFrame(() => textarea.focus());
    }

    // Delete button
    const deleteBtn = card.querySelector('.comment-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (pin.issueNumber) {
          try {
            await pinStore.deletePin(pin.issueNumber);
            this._pins = this._pins.filter(p => p !== pin);
            this._closeActiveCard();
            this._rerenderAll();
            this._updatePanelList();
            this._toast('Pin deleted', 'success');
          } catch {
            this._toast('Failed to delete pin', 'error');
          }
        } else {
          this._removeLocalPin(pin.id);
        }
      });
    }

    // Owner moderation: lock button
    if (pin.issueNumber && githubAuth.isOwner && !pin.locked) {
      const lockBtn = document.createElement('button');
      lockBtn.className = 'comment-lock-btn';
      lockBtn.title = 'Lock thread';
      lockBtn.textContent = '🔒';
      lockBtn.addEventListener('click', async () => {
        try {
          await pinStore.lockPin(pin.issueNumber);
          pin.locked = true;
          this._closeActiveCard();
          this._toast('Thread locked', 'info');
        } catch {
          this._toast('Failed to lock thread', 'error');
        }
      });
      header.insertBefore(lockBtn, header.querySelector('.comment-delete'));
    }

    // Position card next to pin
    const xPct = pin.relativeX * 100;
    const yPct = pin.relativeY * 100;
    card.style.position = 'absolute';
    if (pin.relativeX > 0.5) {
      card.style.right = (100 - xPct) + '%';
      card.style.left = 'auto';
    } else {
      card.style.left = xPct + '%';
    }
    card.style.top = `calc(${yPct}% + 16px)`;

    const pinsContainer = windowContainer.querySelector('.rfo-pins-layer');
    if (pinsContainer) pinsContainer.appendChild(card);

    this._activeCard = card;
  }

  /* ── Render a single reply in thread ─────────────── */
  _renderReply(reply, pin) {
    const el = document.createElement('div');
    el.className = 'comment-reply';
    el.innerHTML = `
      ${reply.avatarUrl ? `<img class="comment-avatar-sm" src="${this._escAttr(reply.avatarUrl)}" alt="">` : ''}
      <div class="comment-reply-body">
        <div class="comment-reply-header">
          <span class="comment-author">${this._esc(reply.author)}</span>
          <span class="comment-time">${new Date(reply.timestamp).toLocaleString()}</span>
          ${reply.canDelete ? `<button class="comment-reply-delete" data-reply-id="${reply.id}" title="Delete">✕</button>` : ''}
        </div>
        <div class="comment-reply-text">${this._esc(reply.text)}</div>
      </div>
    `;

    const delBtn = el.querySelector('.comment-reply-delete');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        try {
          await pinStore.deleteReply(reply.id);
          el.remove();
          pin.commentCount = Math.max(0, (pin.commentCount || 1) - 1);
          this._toast('Reply deleted', 'info');
        } catch {
          this._toast('Failed to delete reply', 'error');
        }
      });
    }

    return el;
  }

  _closeActiveCard() {
    if (this._activeCard) {
      this._activeCard.remove();
      this._activeCard = null;
    }
  }

  /* ── Toggle pins visibility ───────────────────────── */
  togglePinsVisibility() {
    this._pinsVisible = !this._pinsVisible;
    const layers = document.querySelectorAll('.rfo-pins-layer');
    for (const layer of layers) {
      layer.classList.toggle('rfo-pins-hidden', !this._pinsVisible);
    }
    const toggleBtn = document.getElementById('rfo-toggle-pins');
    if (toggleBtn) {
      toggleBtn.textContent = this._pinsVisible ? '👁 Pins' : '👁‍🗨 Pins';
    }
  }

  /* ── Remove local pin ─────────────────────────────── */
  _removeLocalPin(pinId) {
    this._pins = this._pins.filter(p => p.id !== pinId);
    this._closeActiveCard();
    this._rerenderAll();
    this._updatePanelList();
    this._toast('Pin removed', 'info');
  }

  /* ── Re-render all pins ───────────────────────────── */
  _rerenderAll() {
    for (const [, entry] of windowManager._windows ?? []) {
      const layer = entry?.container?.querySelector('.rfo-pins-layer');
      if (layer) layer.remove();
    }
    for (const pin of this._pins) {
      this._renderPin(pin);
    }
  }

  /* ── Panel list ───────────────────────────────────── */
  _updatePanelList() {
    if (this._pinCountEl) {
      this._pinCountEl.textContent = this._pins.length;
    }
    if (!this._commentPanelList) return;
    this._commentPanelList.innerHTML = '';

    for (let i = 0; i < this._pins.length; i++) {
      const pin = this._pins[i];
      const item = document.createElement('div');
      item.className = 'comment-list-item';
      const preview = pin.text ? pin.text.substring(0, 40) : '(empty)';
      const badge = pin.commentCount ? ` (${pin.commentCount})` : '';
      item.innerHTML = `
        <span class="comment-list-pin-num">${i + 1}</span>
        <span><b>${this._esc(pin.author)}</b>: ${this._esc(preview)}${badge}</span>
      `;
      item.addEventListener('click', () => {
        windowManager.open(pin.windowId);
        windowManager.focus(pin.windowId);
        const entry = windowManager.get(pin.windowId);
        if (entry) {
          const pinEl = entry.container.querySelector(`[data-pin-id="${this._pinDomId(pin)}"]`);
          if (pinEl) this._openCard(pin, pinEl, entry.container);
        }
      });
      this._commentPanelList.appendChild(item);
    }
  }

  /* ── Show/hide toolbar based on mode ──────────────── */
  showToolbar(show) {
    if (this._toolbar) {
      this._toolbar.hidden = !show;
    }
  }

  /* ── Data access (local pins for layout presets) ──── */
  getAll() {
    return this._pins.filter(p => p._local).map(p => ({ ...p }));
  }

  restoreAll(pinsData) {
    // Only restore local pins; remote are loaded from GitHub
    const remotePins = this._pins.filter(p => !p._local);
    this._pins = [...remotePins];
    this._closeActiveCard();
    for (const p of pinsData) {
      this._addLocalPin(p.windowId, p.relativeX, p.relativeY, { ...p, _local: true });
    }
    this._rerenderAll();
    this._updatePanelList();
  }

  clearAll() {
    this._pins = this._pins.filter(p => !p._local);
    this._closeActiveCard();
    this._rerenderAll();
    this._updatePanelList();
  }

  /* ── HTML escape helpers ─────────────────────────── */
  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
  _escAttr(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

export const commentManager = new CommentManager();
