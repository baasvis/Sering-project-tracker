const { Router } = require('express');
const { OAuth2Client } = require('google-auth-library');
const { ADMIN_EMAILS, DEV_MODE, GOOGLE_CLIENT_ID } = require('../lib/config');

const router = Router();
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// Check current auth state
router.get('/me', (req, res) => {
  if (req.session && req.session.admin) {
    return res.json({ admin: true, email: req.session.email });
  }
  res.json({ admin: false });
});

// Google Sign-In token verification
router.post('/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'No credential provided' });

  if (!googleClient) {
    return res.status(500).json({ error: 'Google Sign-In not configured' });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    const email = (payload.email || '').toLowerCase();
    const name = payload.name || email;

    if (!ADMIN_EMAILS.includes(email)) {
      return res.status(403).json({ error: 'Not an admin email' });
    }

    req.session.admin = true;
    req.session.email = email;
    req.session.name = name;
    res.json({ admin: true, email });
  } catch (err) {
    console.error('Google auth error:', err.message);
    res.status(401).json({ error: 'Invalid credential' });
  }
});

// Dev mode: instant admin login
if (DEV_MODE) {
  router.post('/dev-login', (req, res) => {
    req.session.admin = true;
    req.session.email = 'dev@localhost';
    req.session.name = 'Dev Admin';
    res.json({ admin: true, email: 'dev@localhost' });
  });
}

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// Middleware: require admin for protected routes
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  res.status(401).json({ error: 'Admin login required' });
}

module.exports = router;
module.exports.requireAdmin = requireAdmin;
