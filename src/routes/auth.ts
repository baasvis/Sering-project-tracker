import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { ADMIN_EMAILS, DEV_MODE, GOOGLE_CLIENT_ID, IS_PRODUCTION } from '../lib/config.js';
import { logAction } from '../lib/audit.js';
import { sendError } from '../lib/errors.js';

const router = Router();
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// Regenerate session ID to prevent session fixation attacks.
// Falls back to just setting the session if regenerate is unavailable or errors.
function regenerateSession(req: Request, cb: () => void) {
  if (typeof req.session.regenerate === 'function') {
    req.session.regenerate((err) => {
      if (err) console.warn('Session regenerate failed (non-fatal):', err.message);
      cb();
    });
  } else {
    cb();
  }
}

// Check current auth state
router.get('/me', (req: Request, res: Response) => {
  if (req.session?.admin) {
    return res.json({ admin: true, email: req.session.email });
  }
  res.json({ admin: false });
});

// Google Sign-In token verification
router.post('/google', async (req: Request, res: Response) => {
  const { credential } = req.body;
  if (!credential) return sendError(res, 'VALIDATION_ERROR', 'No credential provided');

  if (!googleClient) {
    return sendError(res, 'INTERNAL_ERROR', 'Google Sign-In not configured');
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = (payload?.email || '').toLowerCase();
    const name = payload?.name || email;

    if (!ADMIN_EMAILS.includes(email)) {
      return sendError(res, 'FORBIDDEN', 'Not an admin email');
    }

    regenerateSession(req, () => {
      req.session.admin = true;
      req.session.email = email;
      req.session.name = name;
      res.json({ admin: true, email });
    });
    logAction(req, 'auth:google-login', 'auth', null, { email });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Google auth error:', message);
    sendError(res, 'UNAUTHORIZED', 'Invalid credential');
  }
});

// Dev mode: instant admin login — BLOCKED in production regardless of config
router.post('/dev-login', (req: Request, res: Response) => {
  if (IS_PRODUCTION) {
    return sendError(res, 'FORBIDDEN', 'Dev login is disabled in production');
  }
  if (!DEV_MODE) {
    return sendError(res, 'FORBIDDEN', 'Dev login is not available');
  }

  regenerateSession(req, () => {
    req.session.admin = true;
    req.session.email = 'dev@localhost';
    req.session.name = 'Dev Admin';
    res.json({ admin: true, email: 'dev@localhost' });
  });
  logAction(req, 'auth:dev-login', 'auth', null, { email: 'dev@localhost' });
});

// Logout
router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// Middleware: require admin for protected routes
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session?.admin) return next();
  sendError(res, 'UNAUTHORIZED', 'Admin login required');
}

export default router;
