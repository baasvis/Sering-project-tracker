/* ========================================
   Init — Navigation, routing, app bootstrap
   ======================================== */

// Build navigation links
function buildNav(): void {
  var nav = document.getElementById('nav-links')!;
  var screens = NAV_SCREENS.filter((s: any) => !s.adminOnly || S.isAdmin);

  var existing = nav.querySelectorAll('a[data-screen]');
  if (existing.length === screens.length) {
    existing.forEach((a: Element) => (a as HTMLElement).classList.toggle('active', (a as HTMLElement).dataset.screen === S.screen));
    return;
  }

  nav.innerHTML = screens
    .map((s: any) => html`<a href="#${s.id}" data-screen="${s.id}" class="${S.screen === s.id ? 'active' : ''}">${s.label}</a>`)
    .join('');

  // Attach click handlers — update hash only (hashchange listener handles render)
  nav.querySelectorAll('a').forEach((a: HTMLAnchorElement) => {
    a.addEventListener('click', (e: Event) => {
      e.preventDefault();
      S.currentProjectId = null;
      S.currentProject = null;
      window.location.hash = a.dataset.screen!;
    });
  });

  (document.querySelector('.nav-logo') as HTMLElement).onclick = (e: Event) => {
    e.preventDefault();
    S.currentProjectId = null;
    window.location.hash = 'dashboard';
  };
}

// Render current screen
function renderCurrentScreen(): void {
  cleanupQuillInstances();

  switch (S.screen) {
    case 'dashboard': return renderDashboard() as any;
    case 'projects': return renderProjects() as any;
    case 'budget': return renderBudget() as any;
    case 'admin': return renderAdmin() as any;
    default: return renderDashboard() as any;
  }
}

// Handle hash-based routing
function handleRoute(): void {
  var hash = window.location.hash.slice(1);
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
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    var backdrops = document.querySelectorAll('.modal-backdrop');
    if (backdrops.length > 0) {
      cleanupQuillInstances();
      backdrops.forEach((b: Element) => closeModal(b as HTMLElement));
      return;
    }
    var lb = document.querySelector('.lightbox') as HTMLElement | null;
    if (lb) { (lb as any).onclick(); }
  }
});

// App init
async function initApp(): Promise<void> {
  try {
    var config = await fetch('/api/config').then((r: Response) => r.json());
    S.devMode = config.devMode;
    S.googleClientId = config.googleClientId;
  } catch {
    S.devMode = true;
  }

  if (S.googleClientId) {
    var attempts = 0;
    var waitForGoogle = () => {
      if ((window as any).google && google.accounts) {
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
var _hashDebounce: ReturnType<typeof setTimeout> | null = null;
window.addEventListener('hashchange', () => {
  clearTimeout(_hashDebounce!);
  _hashDebounce = setTimeout(() => {
    handleRoute();
    buildNav();
    renderCurrentScreen();
  }, 50);
});

// Boot
initApp();
