/* ========================================
   Init — Navigation, routing, app bootstrap
   ======================================== */

// Build navigation links
function buildNav() {
  const nav = document.getElementById('nav-links');
  const screens = NAV_SCREENS.filter(s => !s.adminOnly || S.isAdmin);

  // Optimization: only update active class if links already built
  const existing = nav.querySelectorAll('a[data-screen]');
  if (existing.length === screens.length) {
    existing.forEach(a => {
      a.classList.toggle('active', a.dataset.screen === S.screen);
    });
    return;
  }

  // Full rebuild (only on first load or admin state change)
  nav.innerHTML = screens
    .map(s => `<a href="#${s.id}" data-screen="${s.id}" class="${S.screen === s.id ? 'active' : ''}">${s.label}</a>`)
    .join('');

  // Attach click handlers
  nav.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const screen = a.dataset.screen;
      S.screen = screen;
      S.currentProjectId = null;
      S.currentProject = null;
      window.location.hash = screen;
      renderCurrentScreen();
      buildNav();
    });
  });

  // Logo also goes to dashboard
  document.querySelector('.nav-logo').onclick = e => {
    e.preventDefault();
    S.screen = 'dashboard';
    S.currentProjectId = null;
    window.location.hash = 'dashboard';
    renderCurrentScreen();
    buildNav();
  };
}

// Render current screen
function renderCurrentScreen() {
  // Clean up Quill instances from previous screen
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

// Close modals on Escape — also clean up Quill instances
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const backdrop = document.querySelector('.modal-backdrop');
    if (backdrop) {
      cleanupQuillInstances();
      backdrop.remove();
    }
    document.querySelector('.lightbox')?.remove();
  }
});

// Show loading state while screen renders
function showLoading() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading-spinner">Loading...</div>';
}

// App init
async function initApp() {
  // Load config
  try {
    const config = await fetch('/api/config').then(r => r.json());
    S.devMode = config.devMode;
    S.googleClientId = config.googleClientId;
  } catch (e) {
    S.devMode = true;
  }

  // Initialize Google Sign-In SDK with timeout
  if (S.googleClientId) {
    let attempts = 0;
    const maxAttempts = 50; // 10 seconds max
    const waitForGoogle = () => {
      if (window.google && google.accounts) {
        google.accounts.id.initialize({
          client_id: S.googleClientId,
          callback: handleGoogleCredential
        });
      } else if (++attempts < maxAttempts) {
        setTimeout(waitForGoogle, 200);
      } else {
        console.warn('Google Sign-In SDK failed to load after 10s');
      }
    };
    waitForGoogle();
  }

  // Check auth
  await checkAuth();

  // Show name overlay if no name and not admin
  if (!S.isAdmin) {
    setupNameOverlay();
  }

  // Route
  handleRoute();
  buildNav();
  renderCurrentScreen();

  // Floating report button
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
