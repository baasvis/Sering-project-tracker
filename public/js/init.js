"use strict";
/* ========================================
   Init — Navigation, routing, app bootstrap
   ======================================== */
// Build navigation links
function buildNav() {
    var nav = document.getElementById('nav-links');
    var screens = NAV_SCREENS.filter((s) => !s.adminOnly || S.isAdmin);
    var existing = nav.querySelectorAll('a[data-screen]');
    if (existing.length === screens.length) {
        existing.forEach((a) => a.classList.toggle('active', a.dataset.screen === S.screen));
        return;
    }
    nav.innerHTML = screens
        .map((s) => html `<a href="#${s.id}" data-screen="${s.id}" class="${S.screen === s.id ? 'active' : ''}">${s.label}</a>`)
        .join('');
    // Attach click handlers — update hash only (hashchange listener handles render)
    nav.querySelectorAll('a').forEach((a) => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            S.currentProjectId = null;
            S.currentProject = null;
            S.currentAnnouncementId = null;
            window.location.hash = a.dataset.screen;
        });
    });
    document.querySelector('.nav-logo').onclick = (e) => {
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
    var hash = window.location.hash.slice(1);
    if (hash.startsWith('project/')) {
        S.screen = 'projects';
        S.currentProjectId = hash.split('/')[1];
        S.currentAnnouncementId = null;
    }
    else if (hash.startsWith('announcement/')) {
        S.screen = 'dashboard';
        S.currentAnnouncementId = hash.split('/')[1];
        S.currentProjectId = null;
    }
    else if (hash) {
        S.screen = hash;
        S.currentProjectId = null;
        S.currentAnnouncementId = null;
    }
    else {
        S.screen = 'dashboard';
        S.currentAnnouncementId = null;
    }
}
// Close all modals on Escape + clean up Quill instances
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        var backdrops = document.querySelectorAll('.modal-backdrop');
        if (backdrops.length > 0) {
            cleanupQuillInstances();
            backdrops.forEach((b) => closeModal(b));
            return;
        }
        var lb = document.querySelector('.lightbox');
        if (lb) {
            lb.onclick();
        }
    }
});
// App init
async function initApp() {
    try {
        var config = await fetch('/api/config').then((r) => r.json());
        S.devMode = config.devMode;
        S.googleClientId = config.googleClientId;
    }
    catch {
        S.devMode = true;
    }
    if (S.googleClientId) {
        var attempts = 0;
        var waitForGoogle = () => {
            if (window.google && google.accounts) {
                google.accounts.id.initialize({
                    client_id: S.googleClientId,
                    callback: handleGoogleCredential
                });
            }
            else if (++attempts < 50) {
                setTimeout(waitForGoogle, 200);
            }
        };
        waitForGoogle();
    }
    await checkAuth();
    if (!S.isAdmin)
        setupNameOverlay();
    handleRoute();
    buildNav();
    renderCurrentScreen();
    connectSSE();
    initReportButton();
}
// Handle back/forward — debounced
var _hashDebounce = null;
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
