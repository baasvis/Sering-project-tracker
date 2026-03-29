/* ========================================
   Utils — html`` tagged template, API helpers, toast, helpers
   ======================================== */

// ─── XSS-safe HTML tagged template ─────────────────────────────────────────
// All innerHTML assignments should use html`...` — interpolated values are
// auto-escaped. Use raw() to opt out for server-sanitized HTML (e.g. Quill).

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// Validate and return a data:image/* URI, or empty string if invalid.
// Prevents XSS via crafted data URIs in img src attributes.
function safeDataImageSrc(str) {
  if (typeof str !== 'string') return '';
  if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(str)) return str;
  return '';
}

// Marker for pre-sanitized HTML that should NOT be escaped
function raw(str) {
  const r = new String(str || '');
  r.__raw = true;
  return r;
}

// Tagged template literal: html`<div>${unsafe}</div>` auto-escapes ${} values
function html(strings, ...values) {
  let result = '';
  for (let i = 0; i < strings.length; i++) {
    result += strings[i];
    if (i < values.length) {
      const val = values[i];
      if (val && val.__raw) {
        result += String(val); // pre-sanitized, pass through
      } else if (Array.isArray(val)) {
        result += val.join(''); // arrays assumed to be pre-built html fragments
      } else {
        result += esc(val == null ? '' : String(val));
      }
    }
  }
  return result;
}

// ─── Modal accessibility: focus trapping + restoration ──────────────────────

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Track the element that opened the modal so we can restore focus on close
let _modalTriggerEl = null;

function openModal(backdrop, label) {
  _modalTriggerEl = document.activeElement;
  const modal = backdrop.querySelector('.modal') || backdrop.querySelector('.lightbox');
  if (modal) {
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    if (label) modal.setAttribute('aria-label', label);
  }
  document.body.appendChild(backdrop);
  trapFocus(backdrop);
}

function trapFocus(container) {
  const focusable = container.querySelectorAll(FOCUSABLE_SELECTOR);
  if (focusable.length > 0) {
    focusable[0].focus();
  }
  container._trapHandler = function(e) {
    if (e.key !== 'Tab') return;
    const els = container.querySelectorAll(FOCUSABLE_SELECTOR);
    if (els.length === 0) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  container.addEventListener('keydown', container._trapHandler);
}

function closeModal(backdrop) {
  if (backdrop._trapHandler) backdrop.removeEventListener('keydown', backdrop._trapHandler);
  backdrop.remove();
  if (_modalTriggerEl && typeof _modalTriggerEl.focus === 'function') {
    _modalTriggerEl.focus();
    _modalTriggerEl = null;
  }
}

// ─── Cryptographic mutation ID ──────────────────────────────────────────────

function generateMutationId() {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

// ─── CSRF ───────────────────────────────────────────────────────────────────

function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]*)/);
  return match ? match[1] : '';
}

// ─── API helpers ────────────────────────────────────────────────────────────

async function apiFetch(method, url, body) {
  const opts = { method };
  const headers = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    headers['X-CSRF-Token'] = getCsrfToken();
    const mutationId = generateMutationId();
    headers['X-Mutation-ID'] = mutationId;
    S._pendingMutationIds.add(mutationId);
    setTimeout(() => S._pendingMutationIds.delete(mutationId), 30_000);
  }
  opts.headers = headers;
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

async function apiGet(url) {
  const result = await apiFetch('GET', url);
  // Auto-unwrap paginated responses from CRUD factory
  if (result && typeof result === 'object' && !Array.isArray(result) && Array.isArray(result.data) && 'hasMore' in result) {
    return result.data;
  }
  return result;
}
function apiPost(url, body) { return apiFetch('POST', url, body); }
function apiPatch(url, body) { return apiFetch('PATCH', url, body); }
function apiDelete(url) { return apiFetch('DELETE', url); }

async function apiUpload(url, formData) {
  const res = await fetch(url, {
    method: 'POST',
    body: formData,
    headers: { 'X-CSRF-Token': getCsrfToken() }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Upload failed');
  }
  return res.json();
}

// ─── Toast notifications ────────────────────────────────────────────────────

function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ─── Date/time helpers ──────────────────────────────────────────────────────

function timeAgo(dateStr) {
  const seconds = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date(new Date().toDateString());
}

// ─── Rich text editor (Quill) ───────────────────────────────────────────────

const _quillInstances = {};

function cleanupQuillInstances() {
  for (const [key, quill] of Object.entries(_quillInstances)) {
    try {
      quill.disable();
      quill.setContents([]);
      const container = quill.container;
      if (container) {
        const toolbar = container.previousElementSibling;
        if (toolbar && toolbar.classList.contains('ql-toolbar')) toolbar.remove();
        container.innerHTML = '';
      }
    } catch { /* already cleaned up */ }
    delete _quillInstances[key];
  }
}

function createRichEditor(containerId, initialHTML) {
  const container = document.getElementById(containerId);
  if (!container) return null;

  if (_quillInstances[containerId]) {
    try { _quillInstances[containerId].disable(); } catch { /* ignore */ }
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

function getRichEditorHTML(containerId) {
  const quill = _quillInstances[containerId];
  if (!quill) return '';
  const h = quill.root.innerHTML;
  if (h === '<p><br></p>' || h === '<p></p>') return '';
  return normalizeQuillHTML(h);
}

function normalizeQuillHTML(h) {
  const div = document.createElement('div');
  div.innerHTML = h;

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

// Render server-sanitized HTML description (wrap with raw() to skip escaping)
function renderDescription(descHtml) {
  if (!descHtml) return '';
  return html`<div class="rich-content">${raw(descHtml)}</div>`;
}

// ─── Tier filter buttons ────────────────────────────────────────────────────

function renderTierButtons() {
  return html`<div class="tier-buttons">
    ${raw(Object.entries(PROJECT_TIERS).map(([key, tier]) => html`
      <button class="tier-btn ${S.selectedTier === key ? 'active' : ''}"
              style="--tier-color: ${raw(tier.color)}; --tier-bg: ${raw(tier.bg)}"
              data-action="selectTier" data-tier="${key}">
        <span class="tier-btn-label">${tier.label}</span>
        <span class="tier-btn-desc">${tier.description}</span>
      </button>
    `).join(''))}
  </div>`;
}

onAction('selectTier', (el) => selectTier(el.dataset.tier));

function selectTier(tier) {
  S.selectedTier = S.selectedTier === tier ? null : tier;

  if (S.screen === 'projects' && !S.currentProjectId && document.getElementById('projects-cards')) {
    rerenderProjectFilters();
  } else if (S.screen === 'dashboard' && document.getElementById('dashboard-projects-overview')) {
    rerenderDashboardProjects();
  } else {
    renderCurrentScreen();
  }
}

function updateTierButtonStates() {
  document.querySelectorAll('.tier-btn').forEach(btn => {
    const tierKey = btn.dataset.tier;
    if (tierKey) btn.classList.toggle('active', S.selectedTier === tierKey);
  });
}

function filterProjectsByTier(projects) {
  if (!S.selectedTier) return projects;
  return projects.filter(p => p.tier === S.selectedTier);
}

const TIER_ORDER = { mvp: 0, medium: 1, next_level: 2 };
function sortProjectsByTier(projects) {
  return projects.slice().sort((a, b) => {
    return (TIER_ORDER[a.tier] ?? 3) - (TIER_ORDER[b.tier] ?? 3);
  });
}

function extractPreviewText(descHtml, maxLength) {
  if (!descHtml) return '';
  maxLength = maxLength || 150;
  const doc = new DOMParser().parseFromString(descHtml, 'text/html');
  const firstP = doc.querySelector('p');
  const text = (firstP ? firstP.textContent : doc.body.textContent).trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).replace(/\s+\S*$/, '') + '\u2026';
}

// ─── Loading + dedup ────────────────────────────────────────────────────────

function showLoading() {
  document.getElementById('app').innerHTML = '<div class="loading-spinner"></div>';
}

const _pendingRequests = {};
function withDedup(key, fn) {
  if (_pendingRequests[key]) return _pendingRequests[key];
  const promise = fn().finally(() => { delete _pendingRequests[key]; });
  _pendingRequests[key] = promise;
  return promise;
}
