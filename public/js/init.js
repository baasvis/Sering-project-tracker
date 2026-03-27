/* ========================================
   Init — Navigation, routing, app bootstrap
   ======================================== */

// Build navigation links
function buildNav() {
  const nav = document.getElementById('nav-links');
  const screens = NAV_SCREENS.filter(s => !s.adminOnly || S.isAdmin);

  const existing = nav.querySelectorAll('a[data-screen]');
  if (existing.length === screens.length) {
    existing.forEach(a => a.classList.toggle('active', a.dataset.screen === S.screen));
    return;
  }

  nav.innerHTML = screens
    .map(s => `<a href="#${s.id}" data-screen="${s.id}" class="${S.screen === s.id ? 'active' : ''}">${s.label}</a>`)
    .join('');

  // Attach click handlers — update hash only (hashchange listener handles render)
  nav.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      S.currentProjectId = null;
      S.currentProject = null;
      window.location.hash = a.dataset.screen;
    });
  });

  document.querySelector('.nav-logo').onclick = e => {
    e.preventDefault();
    S.currentProjectId = null;
    window.location.hash = 'dashboard';
  };
}

// Render current screen
function renderCurrentScreen() {
  cleanupQuillInstances();

  switch (S.screen) {
    case 'dashboard': return renderDashboard();
    case 'projects': return renderProjects();
    case 'budget': return renderBudget();
    case 'admin': return renderAdmin();
    default: return renderDashboard();
  }
}

// Handle hash-based routing
function handleRoute() {
  const hash = window.location.hash.slice(1);
  if (hash.startsWith('project/')) {
    S.screen = 'projects';
    S.currentProjectId = hash.split('/')[1];
  } else if (hash) {
    S.screen = hash;
    S.currentProjectId = null;
  } else {
    S.screen = 'dashboard';
  }
}

// Close all modals on Escape + clean up Quill instances
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const backdrops = document.querySelectorAll('.modal-backdrop');
    if (backdrops.length > 0) {
      cleanupQuillInstances();
      backdrops.forEach(b => b.remove());
    }
    document.querySelector('.lightbox')?.remove();
  }
});

// App init
async function initApp() {
  try {
    const config = await fetch('/api/config').then(r => r.json());
    S.devMode = config.devMode;
    S.googleClientId = config.googleClientId;
  } catch {
    S.devMode = true;
  }

  if (S.googleClientId) {
    let attempts = 0;
    const waitForGoogle = () => {
      if (window.google && google.accounts) {
        google.accounts.id.initialize({
          client_id: S.googleClientId,
          callback: handleGoogleCredential
        });
      } else if (++attempts < 50) {
        setTimeout(waitForGoogle, 200);
      }
    };
    waitForGoogle();
  }

  await checkAuth();

  if (!S.isAdmin) setupNameOverlay();

  handleRoute();
  buildNav();
  renderCurrentScreen();
  connectSSE();
  initReportButton();
}

// Handle back/forward — debounced
let _hashDebounce = null;
window.addEventListener('hashchange', () => {
  clearTimeout(_hashDebounce);
  _hashDebounce = setTimeout(() => {
    handleRoute();
    buildNav();
    renderCurrentScreen();
  }, 50);
});

// Boot
initApp();
