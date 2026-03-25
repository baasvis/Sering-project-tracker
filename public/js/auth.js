/* ========================================
   Auth — Google Sign-In (admin) + name entry (visitor)
   ======================================== */

// Check auth status on load
async function checkAuth() {
  const res = await fetch('/auth/me');
  const data = await res.json();
  S.isAdmin = data.admin;
  S.adminEmail = data.email || null;
  updateAuthUI();
}

// Dev mode: one-click admin login
async function devLogin() {
  const res = await fetch('/auth/dev-login', { method: 'POST' });
  const data = await res.json();
  S.isAdmin = data.admin;
  S.adminEmail = data.email;
  updateAuthUI();
  renderCurrentScreen();
  toast('Logged in as dev admin');
}

// Google Sign-In callback
async function handleGoogleCredential(response) {
  const res = await fetch('/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: response.credential })
  });
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
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
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
        // Trigger Google Sign-In
        google.accounts.id.prompt();
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
