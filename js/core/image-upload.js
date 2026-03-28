import config from '../config.js';
import { githubAuth } from './github-auth.js';

/**
 * Image Upload Interceptor
 *
 * Allows users to paste images directly into textareas (discussions, pins)
 * and generates a standard image tag pointing to the GitHub repository.
 */

const API = 'https://api.github.com';

export function setupImagePaste(textarea) {
  if (!textarea) return;

  textarea.addEventListener('paste', async (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    let imageItem = null;

    for (const item of items) {
      if (item.type.indexOf('image') === 0) {
        imageItem = item;
        break;
      }
    }

    if (!imageItem) return;

    // Prevent default paste (we handle the image)
    e.preventDefault();

    const file = imageItem.getAsFile();
    if (!file) return;

    if (!githubAuth.isLoggedIn) {
      if (typeof window.rfoToast === 'function') {
        window.rfoToast('Sign in with GitHub to paste images', 'info');
      }
      return;
    }

    // Insert loading placeholder at cursor
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const placeholder = '[Uploading image...]';

    const originalValue = textarea.value;
    textarea.value = originalValue.substring(0, start) + placeholder + originalValue.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + placeholder.length;

    try {
      const base64 = await fileToBase64(file);
      const base64Data = base64.split(',')[1];

      const filename = `upload_${Date.now()}_${Math.floor(Math.random() * 1000)}.png`;
      const path = `assets/uploads/${filename}`;
      const repo = config.github.repo;

      const response = await fetch(`${API}/repos/${repo}/contents/${path}`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${githubAuth.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: `Upload image ${filename}`,
          content: base64Data
        })
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      const data = await response.json();

      if (data.content && data.content.download_url) {
        const url = data.content.download_url;

        // Format similar to GitHub's markdown image tags
        const imgTag = `<img alt="Image" src="${url}" />`;

        // Replace placeholder with the image tag
        const startIdx = textarea.value.indexOf(placeholder);
        if (startIdx !== -1) {
          textarea.setRangeText(imgTag, startIdx, startIdx + placeholder.length, 'end');
        }
      } else {
        throw new Error('Invalid response from GitHub');
      }
    } catch (err) {
      console.error('[ImageUpload] Error:', err);
      const startIdx = textarea.value.indexOf(placeholder);
      if (startIdx !== -1) {
        textarea.setRangeText('[Image upload failed]', startIdx, startIdx + placeholder.length, 'end');
      }
      if (typeof window.rfoToast === 'function') {
        window.rfoToast('Image upload failed', 'error');
      }
    }
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}
