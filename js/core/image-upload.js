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
      if (typeof window.uiToast === 'function') {
        window.uiToast('Sign in with GitHub to paste images', 'info');
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
      const formData = new FormData();
      formData.append('reqtype', 'fileupload');
      formData.append('fileToUpload', file);
      // The secure userhash is automatically appended by the Cloudflare Worker server-side
      // via the CATBOX_USERHASH environment variable.

      // Use the Cloudflare Worker to proxy the request and avoid browser CORS blocks
      const workerUrl = config.github.workerUrl || 'https://ui-emulator-auth.wyrtensi.workers.dev';
      const response = await fetch(`${workerUrl}/catbox`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Upload failed: ${response.status} - ${errorText}`);
      }

      const url = await response.text();

      if (url && url.startsWith('http')) {
        // Format similar to GitHub's markdown image tags
        const imgTag = `<img alt="Image" src="${url}" />`;

        // Replace placeholder with the image tag
        const startIdx = textarea.value.indexOf(placeholder);
        if (startIdx !== -1) {
          textarea.setRangeText(imgTag, startIdx, startIdx + placeholder.length, 'end');
        }
      } else {
        throw new Error('Invalid response from image host');
      }
    } catch (err) {
      console.error('[ImageUpload] Error:', err);
      const startIdx = textarea.value.indexOf(placeholder);
      if (startIdx !== -1) {
        textarea.setRangeText('[Image upload failed]', startIdx, startIdx + placeholder.length, 'end');
      }
      if (typeof window.uiToast === 'function') {
        window.uiToast('Image upload failed', 'error');
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
