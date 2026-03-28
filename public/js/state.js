/* ========================================
   State — Global app state + constants + reactive subscriptions
   ======================================== */

const NAV_SCREENS = [
  { id: 'dashboard', label: 'Dashboard', icon: '~' },
  { id: 'projects',  label: 'Projects',  icon: '#' },
  { id: 'budget',    label: 'Budget',    icon: '$' },
  { id: 'admin',     label: 'Admin',     icon: '*', adminOnly: true }
];

const TASK_STATUSES = {
  todo:        { label: 'To do',        color: 'var(--status-todo)' },
  in_progress: { label: 'In progress',  color: 'var(--status-progress)' },
  done:        { label: 'Done',         color: 'var(--status-done)' }
};

const STATUS_CYCLE = { todo: 'in_progress', in_progress: 'done', done: 'todo' };

const PROJECT_STATUSES = ['active', 'completed', 'archived'];

const PROJECT_TIERS = {
  mvp:        { label: 'MVP',        color: '#FF3F00', bg: '#FFF0EB', description: 'All the essential items we need to do before opening' },
  medium:     { label: 'Medium',     color: '#494C1A', bg: '#EEF3E5', description: 'All the items required for being open while TestTafel is also serving' },
  next_level: { label: 'Next Level', color: '#8F0500', bg: '#FAE8E7', description: 'All the items required for 6/7 days a week, large volume operations' }
};

const WHATSAPP_DIRECT = 'https://wa.me/31644795523';
const WHATSAPP_GROUP  = 'https://chat.whatsapp.com/Itn12adPqBFAvoXqkv8dgS?mode=gi_t';

const JOIN_TYPES = {
  open:    { label: 'At get-together', color: 'var(--status-done)',      bg: '#EEF3E5' },
  contact: { label: 'Contact us',     color: 'var(--accent)',           bg: '#FFF0EB' },
  closed:  { label: 'No help needed', color: 'var(--text-secondary)',   bg: 'var(--border)' }
};

// ─── Reactive state ─────────────────────────────────────────────────────────
// S.subscribe(key, callback) — subscribe to changes on a specific key.
// When S[key] is set to a new value, all subscribers are notified.
// SSE handlers should ONLY update S — subscribers handle re-rendering.

const _subscribers = {};

const _stateData = {
  screen: 'dashboard',
  isAdmin: false,
  adminEmail: null,
  visitorName: localStorage.getItem('sering_visitor_name') || '',
  devMode: false,
  googleClientId: '',

  // Data
  groups: [],
  projects: [],
  announcements: [],

  // Current view state
  selectedTier: null,
  selectedGroupId: null,
  currentProjectId: null,
  currentProject: null,

  // Internal caches
  _taskCache: {},
  _expandedCardId: null,
  _expandedProjects: {},

  // SSE state
  _pendingMutationIds: new Set(),
  _sseConnected: false,
};

const S = new Proxy(_stateData, {
  set(target, key, value) {
    const old = target[key];
    target[key] = value;
    // Notify subscribers if value changed (skip internal keys starting with _)
    if (old !== value && _subscribers[key]) {
      for (const cb of _subscribers[key]) {
        try { cb(value, old, key); } catch (e) { console.error('Subscriber error:', key, e); }
      }
    }
    return true;
  }
});

// Subscribe to state changes on a key. Returns unsubscribe function.
S.subscribe = function(key, callback) {
  if (!_subscribers[key]) _subscribers[key] = [];
  _subscribers[key].push(callback);
  return function unsubscribe() {
    const idx = _subscribers[key].indexOf(callback);
    if (idx >= 0) _subscribers[key].splice(idx, 1);
  };
};

// Batch-update multiple keys without triggering subscribers until all are set.
// Usage: S.batch({ groups: [...], projects: [...] })
S.batch = function(updates) {
  const changed = [];
  for (const [key, value] of Object.entries(updates)) {
    const old = _stateData[key];
    _stateData[key] = value;
    if (old !== value && _subscribers[key]) {
      changed.push({ key, value, old });
    }
  }
  // Fire all subscribers after all values are set
  for (const { key, value, old } of changed) {
    for (const cb of _subscribers[key]) {
      try { cb(value, old, key); } catch (e) { console.error('Subscriber error:', key, e); }
    }
  }
};
