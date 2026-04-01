/* ========================================
   Utils — html`` tagged template, API helpers, toast, helpers
   ======================================== */

// ─── XSS-safe HTML tagged template ─────────────────────────────────────────
// All innerHTML assignments should use html`...` — interpolated values are
// auto-escaped. Use raw() to opt out for server-sanitized HTML (e.g. Quill).

function esc(str: any): string {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// Validate and return a data:image/* URI, or empty string if invalid.
// Prevents XSS via crafted data URIs in img src attributes.
function safeDataImageSrc(str: any): string {
  if (typeof str !== 'string') return '';
  if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(str)) return str;
  return '';
}

// Marker for pre-sanitized HTML that should NOT be escaped
function raw(str: any): any {
  const r: any = new String(str || '');
  r.__raw = true;
  return r;
}

// Tagged template literal: html`<div>${unsafe}</div>` auto-escapes ${} values
var html = function(strings: TemplateStringsArray, ...values: any[]): string {
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
};

// ─── Modal accessibility: focus trapping + restoration ──────────────────────

var FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Track the element that opened the modal so we can restore focus on close
var _modalTriggerEl: Element | null = null;

function openModal(backdrop: HTMLElement, label?: string): void {
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

function trapFocus(container: HTMLElement): void {
  const focusable = container.querySelectorAll(FOCUSABLE_SELECTOR);
  if (focusable.length > 0) {
    (focusable[0] as HTMLElement).focus();
  }
  (container as any)._trapHandler = function(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const els = container.querySelectorAll(FOCUSABLE_SELECTOR);
    if (els.length === 0) return;
    const first = els[0] as HTMLElement;
    const last = els[els.length - 1] as HTMLElement;
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  container.addEventListener('keydown', (container as any)._trapHandler);
}

function closeModal(backdrop: HTMLElement): void {
  if ((backdrop as any)._trapHandler) backdrop.removeEventListener('keydown', (backdrop as any)._trapHandler);
  backdrop.remove();
  if (_modalTriggerEl && typeof (_modalTriggerEl as HTMLElement).focus === 'function') {
    (_modalTriggerEl as HTMLElement).focus();
    _modalTriggerEl = null;
  }
}

// ─── Cryptographic mutation ID ──────────────────────────────────────────────

function generateMutationId(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

// ─── CSRF ───────────────────────────────────────────────────────────────────

function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]*)/);
  return match ? match[1] : '';
}

// ─── API helpers ────────────────────────────────────────────────────────────

async function apiFetch(method: string, url: string, body?: any): Promise<any> {
  const opts: RequestInit = { method, cache: 'no-cache' };
  const headers: Record<string, string> = {};
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

async function apiGet(url: string): Promise<any> {
  const result = await apiFetch('GET', url);
  // Auto-unwrap paginated responses from CRUD factory
  if (result && typeof result === 'object' && !Array.isArray(result) && Array.isArray(result.data) && 'hasMore' in result) {
    return result.data;
  }
  return result;
}
function apiPost(url: string, body: any): Promise<any> { return apiFetch('POST', url, body); }
function apiPatch(url: string, body: any): Promise<any> { return apiFetch('PATCH', url, body); }
function apiDelete(url: string): Promise<any> { return apiFetch('DELETE', url); }

async function apiUpload(url: string, formData: FormData): Promise<any> {
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

function toast(message: string, type: string = 'info'): void {
  const container = document.getElementById('toast-container')!;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ─── Date/time helpers ──────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isOverdue(dateStr: string): boolean {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date(new Date().toDateString());
}

// ─── Rich text editor (Quill) ───────────────────────────────────────────────

var _quillInstances: Record<string, any> = {};

function cleanupQuillInstances(): void {
  for (const [key, quill] of Object.entries(_quillInstances)) {
    try {
      quill.disable();
      quill.setContents([]);
      const container = quill.container;
      if (container) {
        const toolbar = container.previousElementSibling as HTMLElement | null;
        if (toolbar && toolbar.classList.contains('ql-toolbar')) toolbar.remove();
        container.innerHTML = '';
      }
    } catch { /* already cleaned up */ }
    delete _quillInstances[key];
  }
}

function createRichEditor(containerId: string, initialHTML?: string): any {
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

function getRichEditorHTML(containerId: string): string {
  const quill = _quillInstances[containerId];
  if (!quill) return '';
  const h: string = quill.root.innerHTML;
  if (h === '<p><br></p>' || h === '<p></p>') return '';
  return normalizeQuillHTML(h);
}

function normalizeQuillHTML(h: string): string {
  const div = document.createElement('div');
  div.innerHTML = h;

  div.querySelectorAll('.ql-ui').forEach(el => el.remove());

  div.querySelectorAll('ol').forEach(ol => {
    const items = ol.querySelectorAll('li[data-list]');
    if (items.length === 0) return;

    let currentType: string | null = null;
    let currentList: HTMLElement | null = null;
    const fragment = document.createDocumentFragment();

    items.forEach(li => {
      const type = li.getAttribute('data-list');
      li.removeAttribute('data-list');

      if (type !== currentType) {
        currentList = document.createElement(type === 'ordered' ? 'ol' : 'ul');
        fragment.appendChild(currentList);
        currentType = type;
      }
      currentList!.appendChild(li);
    });

    ol.replaceWith(fragment);
  });

  return div.innerHTML;
}

// Render server-sanitized HTML description (wrap with raw() to skip escaping)
function renderDescription(descHtml: string): string {
  if (!descHtml) return '';
  return html`<div class="rich-content">${raw(descHtml)}</div>`;
}

// Extract plain text from HTML and truncate to ~2-3 sentences for preview
function truncateDescription(descHtml: string, maxSentences: number = 3): string {
  if (!descHtml) return '';
  var div = document.createElement('div');
  // Insert space between block-level elements so list items don't concatenate
  div.innerHTML = descHtml.replace(/<(\/?(li|p|div|br|h[1-6])[^>]*)>/gi, ' <$1>');
  var text = (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  // Split on sentence-ending punctuation followed by space or end
  var sentences = text.match(/[^.!?]*[.!?]+/g);
  if (!sentences) return text.length > 200 ? text.slice(0, 200) + '…' : text;
  var preview = sentences.slice(0, maxSentences).join(' ').trim();
  if (sentences.length > maxSentences) preview += '…';
  return preview;
}

// ─── Tier filter buttons ────────────────────────────────────────────────────

function renderTierButtons(): string {
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

onAction('selectTier', (el: HTMLElement) => selectTier(el.dataset.tier!));

function selectTier(tier: string): void {
  S.selectedTier = S.selectedTier === tier ? null : tier;

  if (S.screen === 'projects' && !S.currentProjectId && document.getElementById('projects-cards')) {
    rerenderProjectFilters();
  } else if (S.screen === 'dashboard' && document.getElementById('dashboard-projects-overview')) {
    rerenderDashboardProjects();
  } else {
    renderCurrentScreen();
  }
}

function updateTierButtonStates(): void {
  document.querySelectorAll('.tier-btn').forEach(btn => {
    const tierKey = (btn as HTMLElement).dataset.tier;
    if (tierKey) btn.classList.toggle('active', S.selectedTier === tierKey);
  });
}

function filterProjectsByTier(projects: any[]): any[] {
  if (!S.selectedTier) return projects;
  return projects.filter((p: any) => p.tier === S.selectedTier);
}

var TIER_ORDER: Record<string, number> = { mvp: 0, medium: 1, next_level: 2 };
function sortProjectsByTier(projects: any[]): any[] {
  return projects.slice().sort((a: any, b: any) => {
    return (TIER_ORDER[a.tier] ?? 3) - (TIER_ORDER[b.tier] ?? 3);
  });
}

function extractPreviewText(descHtml: string, maxLength?: number): string {
  if (!descHtml) return '';
  maxLength = maxLength || 150;
  const doc = new DOMParser().parseFromString(descHtml, 'text/html');
  const firstP = doc.querySelector('p');
  const text = (firstP ? firstP.textContent : doc.body.textContent)!.trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).replace(/\s+\S*$/, '') + '\u2026';
}

// ─── Loading + dedup ────────────────────────────────────────────────────────

function showLoading(): void {
  document.getElementById('app')!.innerHTML = '<div class="loading-spinner"></div>';
}

var _pendingRequests: Record<string, Promise<any>> = {};
function withDedup(key: string, fn: () => Promise<any>): Promise<any> {
  if (key in _pendingRequests) return _pendingRequests[key];
  const promise = fn().finally(() => { delete _pendingRequests[key]; });
  _pendingRequests[key] = promise;
  return promise;
}
