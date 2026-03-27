/* ========================================
   Utils — API helpers, toast, HTML escape
   ======================================== */

// Read CSRF token from cookie
function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]*)/);
  return match ? match[1] : '';
}

// Core API function — all HTTP methods go through here
async function apiFetch(method, url, body) {
  const opts = { method };
  const headers = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    headers['X-CSRF-Token'] = getCsrfToken();
  }
  opts.headers = headers;
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// Convenience wrappers
function apiGet(url) { return apiFetch('GET', url); }
function apiPost(url, body) { return apiFetch('POST', url, body); }
function apiPatch(url, body) { return apiFetch('PATCH', url, body); }
function apiDelete(url) { return apiFetch('DELETE', url); }

async function apiUpload(url, formData) {
  const res = await fetch(url, { method: 'POST', body: formData, headers: { 'X-CSRF-Token': getCsrfToken() } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Upload failed');
  }
  return res.json();
}

// Toast notifications
function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.remove(); }, 3000);
}

// HTML escape
function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// Format relative time
function timeAgo(dateStr) {
  const seconds = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Format date for display
function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

// Check if deadline is overdue
function isOverdue(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date(new Date().toDateString());
}

// ---- Rich text editor (Quill) ----

// Active Quill instances (keyed by container ID)
const _quillInstances = {};

// Clean up all Quill instances (call on screen change / modal close)
function cleanupQuillInstances() {
  for (const key of Object.keys(_quillInstances)) {
    delete _quillInstances[key];
  }
}

// Create a Quill editor inside a container element
function createRichEditor(containerId, initialHTML) {
  const container = document.getElementById(containerId);
  if (!container) return null;

  // Clean up existing instance if any
  if (_quillInstances[containerId]) {
    delete _quillInstances[containerId];
  }

  const quill = new Quill(container, {
    theme: 'snow',
    placeholder: 'Add a description...',
    modules: {
      toolbar: [
        [{ header: [2, 3, false] }],
        ['bold', 'italic'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['blockquote', 'link'],
        ['clean']
      ]
    }
  });

  if (initialHTML) {
    const delta = quill.clipboard.convert({ html: initialHTML });
    quill.setContents(delta);
  }

  _quillInstances[containerId] = quill;
  return quill;
}

// Get HTML content from a Quill editor, normalized to standard HTML
function getRichEditorHTML(containerId) {
  const quill = _quillInstances[containerId];
  if (!quill) return '';
  const html = quill.root.innerHTML;
  if (html === '<p><br></p>' || html === '<p></p>') return '';
  return normalizeQuillHTML(html);
}

// Convert Quill's internal list markup to standard <ul>/<ol> + <li>
function normalizeQuillHTML(html) {
  const div = document.createElement('div');
  div.innerHTML = html;

  div.querySelectorAll('.ql-ui').forEach(el => el.remove());

  div.querySelectorAll('ol').forEach(ol => {
    const items = ol.querySelectorAll('li[data-list]');
    if (items.length === 0) return;

    let currentType = null;
    let currentList = null;
    const fragment = document.createDocumentFragment();

    items.forEach(li => {
      const type = li.getAttribute('data-list');
      li.removeAttribute('data-list');

      if (type !== currentType) {
        currentList = document.createElement(type === 'ordered' ? 'ol' : 'ul');
        fragment.appendChild(currentList);
        currentType = type;
      }
      currentList.appendChild(li);
    });

    ol.replaceWith(fragment);
  });

  return div.innerHTML;
}

// Render HTML description safely (only tags allowed by server sanitization)
function renderDescription(html) {
  if (!html) return '';
  return `<div class="rich-content">${html}</div>`;
}

// Loading spinner — show while fetching screen data
function showLoading() {
  document.getElementById('app').innerHTML = '<div class="loading-spinner"></div>';
}

// Request deduplication guard
const _pendingRequests = {};
function withDedup(key, fn) {
  if (_pendingRequests[key]) return;
  _pendingRequests[key] = true;
  return fn().finally(() => { delete _pendingRequests[key]; });
}
