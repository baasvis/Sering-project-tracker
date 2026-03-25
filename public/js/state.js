/* ========================================
   State — Global app state + constants
   ======================================== */

// Navigation screens
const NAV_SCREENS = [
  { id: 'dashboard', label: 'Dashboard', icon: '~' },
  { id: 'projects',  label: 'Projects',  icon: '#' },
  { id: 'admin',     label: 'Admin',     icon: '*', adminOnly: true }
];

// Task statuses
const TASK_STATUSES = {
  todo: { label: 'To do', color: 'var(--status-todo)' },
  in_progress: { label: 'In progress', color: 'var(--status-progress)' },
  done: { label: 'Done', color: 'var(--status-done)' }
};

// Status cycle: clicking advances to next
const STATUS_CYCLE = { todo: 'in_progress', in_progress: 'done', done: 'todo' };

// Project statuses
const PROJECT_STATUSES = ['active', 'completed', 'archived'];

// Global app state
const S = {
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
  selectedGroupId: null,     // filter on projects screen
  currentProjectId: null,    // viewing a project detail
  currentProject: null,      // full project object with tasks
};
