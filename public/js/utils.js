/* ========================================
   Utils — API helpers, toast, HTML escape
   ======================================== */

async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

async function apiPatch(url, body) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

async function apiDelete(url) {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

async function apiUpload(url, formData) {
  const res = await fetch(url, { method: 'POST', body: formData });
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
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
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

// Create a Quill editor inside a container element
function createRichEditor(containerId, initialHTML) {
  const container = document.getElementById(containerId);
  if (!container) return null;

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
  // Quill uses <p><br></p> for empty content
  if (html === '<p><br></p>' || html === '<p></p>') return '';
  // Normalize Quill's list format to standard HTML
  // Quill 2.x uses <ol> with <li data-list="bullet"|"ordered"> for all lists
  return normalizeQuillHTML(html);
}

// Convert Quill's internal list markup to standard <ul>/<ol> + <li>
function normalizeQuillHTML(html) {
  const div = document.createElement('div');
  div.innerHTML = html;

  // Remove all ql-ui spans (Quill's internal UI elements)
  div.querySelectorAll('.ql-ui').forEach(el => el.remove());

  // Convert Quill's <ol> with data-list attributes to proper <ul>/<ol>
  div.querySelectorAll('ol').forEach(ol => {
    const items = ol.querySelectorAll('li[data-list]');
    if (items.length === 0) return;

    // Group consecutive items by list type
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
