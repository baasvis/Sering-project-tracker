require('dotenv/config');

const PORT = process.env.PORT || 3001;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

// Dev mode: no Google auth required
const DEV_MODE = !GOOGLE_CLIENT_ID;

// Generate a random secret for dev if none is set (safe for single-process dev)
// In production, SESSION_SECRET MUST be set — warn loudly
if (!SESSION_SECRET && !DEV_MODE) {
  console.error('WARNING: SESSION_SECRET is not set. Admin sessions will not survive restarts.');
  console.error('Set SESSION_SECRET in your environment variables.');
}
const RESOLVED_SESSION_SECRET = SESSION_SECRET || require('crypto').randomBytes(32).toString('hex');

if (!DEV_MODE && ADMIN_EMAILS.length === 0) {
  console.error('WARNING: ADMIN_EMAILS is empty. Nobody will be able to log in as admin.');
  console.error('Set ADMIN_EMAILS in your environment variables (comma-separated).');
}

module.exports = {
  PORT,
  GOOGLE_CLIENT_ID,
  SESSION_SECRET: RESOLVED_SESSION_SECRET,
  ADMIN_EMAILS,
  DEV_MODE,
};
