/**
 * GitHub API Helper
 * Utility for reading, writing, and deleting files directly in the repository via GitHub API.
 */
import config from '../config.js';
import { githubAuth } from './github-auth.js';

export const githubApi = {
  /**
   * Helper to make an API request
   */
  async request(endpoint, options = {}) {
    if (!githubAuth.token) throw new Error('Not authenticated');

    const url = `https://api.github.com/repos/${config.github.repo}${endpoint}`;

    const headers = {
      'Authorization': `token ${githubAuth.token}`,
      'Accept': 'application/vnd.github.v3+json',
      ...options.headers
    };

    const response = await fetch(url, { ...options, headers });

    if (!response.ok && response.status !== 404) {
      let msg = response.statusText;
      try {
        const errData = await response.json();
        if (errData.message) msg = errData.message;
      } catch (e) {}
      throw new Error(`GitHub API error (${response.status}): ${msg}`);
    }

    return response;
  },

  /**
   * Get file content and SHA (needed for updates/deletes)
   */
  async getFile(path) {
    const response = await this.request(`/contents/${path}`);
    if (response.status === 404) return null;

    const data = await response.json();
    return {
      sha: data.sha,
      content: decodeURIComponent(escape(atob(data.content)))
    };
  },

  /**
   * Create or update a file
   */
  async saveFile(path, content, message, isBase64 = false) {
    let sha = undefined;

    // Check if file exists to get SHA for update
    try {
      const existing = await this.request(`/contents/${path}`);
      if (existing.ok) {
        const data = await existing.json();
        sha = data.sha;
      }
    } catch (e) {
      // Ignore errors, assume file doesn't exist
    }

    // Prepare content (base64 encode if not already)
    const encodedContent = isBase64 ? content : btoa(unescape(encodeURIComponent(content)));

    const body = {
      message: message,
      content: encodedContent,
      sha: sha
    };

    const response = await this.request(`/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });

    return await response.json();
  },

  /**
   * Delete a file
   */
  async deleteFile(path, message) {
    // Need SHA to delete
    const existing = await this.request(`/contents/${path}`);
    if (!existing.ok) return; // File already doesn't exist

    const data = await existing.json();
    const sha = data.sha;

    await this.request(`/contents/${path}`, {
      method: 'DELETE',
      body: JSON.stringify({
        message: message,
        sha: sha
      })
    });
  }
};
