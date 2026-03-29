/* ========================================
   Auth — Google Sign-In (admin) + name entry (visitor)
   ======================================== */

// Check auth status on load
async function checkAuth() {
  try {
    const res = await fetch('/auth/me');
    if (!res.ok) return;
    const data = await res.json();
    S.isAdmin = data.admin;
    S.adminEmail = data.email || null;
    updateAuthUI();
  } catch (e) {
    console.warn('Auth check failed:', e.message);
  }
}

// Dev mode: one-click admin login
async function devLogin() {
  try {
    const res = await fetch('/auth/dev-login', { method: 'POST' });
    if (!res.ok) { toast('Login failed', 'error'); return; }
    const data = await res.json();
    S.isAdmin = data.admin;
    S.adminEmail = data.email;
    updateAuthUI();
    renderCurrentScreen();
    toast('Logged in as dev admin');
  } catch (e) {
    toast('Login failed — server unreachable', 'error');
  }
}

// Google Sign-In callback
async function handleGoogleCredential(response) {
  try {
    const res = await fetch('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    if (!res.ok) { toast('Login failed', 'error'); return; }
    const data = await res.json();
    if (data.admin) {
      S.isAdmin = true;
      S.adminEmail = data.email;
      updateAuthUI();
      renderCurrentScreen();
      toast('Logged in as admin');
    } else {
      toast('Not an admin account', 'error');
    }
  } catch (e) {
    toast('Login failed — server unreachable', 'error');
  }
}

async function logout() {
  try {
    await fetch('/auth/logout', { method: 'POST' });
  } catch (e) { /* continue logout regardless */ }
  S.isAdmin = false;
  S.adminEmail = null;
  updateAuthUI();
  renderCurrentScreen();
  toast('Logged out');
}

// Update nav UI based on auth state
function updateAuthUI() {
  const nameEl = document.getElementById('user-name');
  const loginBtn = document.getElementById('admin-login-btn');
  const logoutBtn = document.getElementById('admin-logout-btn');

  if (S.isAdmin) {
    nameEl.textContent = S.adminEmail || 'Admin';
    loginBtn.style.display = 'none';
    logoutBtn.style.display = '';
    logoutBtn.onclick = logout;
  } else {
    nameEl.textContent = S.visitorName || '';
    loginBtn.style.display = '';
    logoutBtn.style.display = 'none';

    if (S.devMode) {
      loginBtn.textContent = 'Dev Login';
      loginBtn.onclick = devLogin;
    } else if (S.googleClientId) {
      loginBtn.textContent = 'Admin';
      loginBtn.onclick = () => {
        // Initialize Google SDK if not yet done, then prompt
        if (window.google && google.accounts) {
          google.accounts.id.initialize({
            client_id: S.googleClientId,
            callback: handleGoogleCredential
          });
          google.accounts.id.prompt();
        } else {
          toast('Google Sign-In not loaded yet, try again in a moment', 'error');
        }
      };
    } else {
      loginBtn.style.display = 'none';
    }
  }

  // Rebuild nav to show/hide admin link
  buildNav();
}

// Name overlay for visitors
function setupNameOverlay() {
  const overlay = document.getElementById('name-overlay');
  const input = document.getElementById('name-input');
  const submit = document.getElementById('name-submit');

  if (S.visitorName) {
    overlay.style.display = 'none';
    return;
  }

  overlay.style.display = 'flex';

  function submitName() {
    const name = input.value.trim();
    if (!name) return;
    S.visitorName = name;
    localStorage.setItem('sering_visitor_name', name);
    overlay.style.display = 'none';
    updateAuthUI();
  }

  submit.onclick = submitName;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitName();
  });
}
