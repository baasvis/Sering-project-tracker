/* ========================================
   Init — Navigation, routing, app bootstrap
   ======================================== */

// Build navigation links
function buildNav() {
  const nav = document.getElementById('nav-links');
  nav.innerHTML = NAV_SCREENS
    .filter(s => !s.adminOnly || S.isAdmin)
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

// Close modals on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelector('.modal-backdrop')?.remove();
    document.querySelector('.lightbox')?.remove();
  }
});

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

  // Initialize Google Sign-In SDK if configured
  if (S.googleClientId) {
    const waitForGoogle = () => {
      if (window.google && google.accounts) {
        google.accounts.id.initialize({
          client_id: S.googleClientId,
          callback: handleGoogleCredential
        });
      } else {
        setTimeout(waitForGoogle, 200);
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
}

// Handle back/forward
window.addEventListener('hashchange', () => {
  handleRoute();
  buildNav();
  renderCurrentScreen();
});

// Boot
initApp();
