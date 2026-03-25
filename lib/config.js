require('dotenv/config');

const PORT = process.env.PORT || 3001;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

// Dev mode: no Google auth required, first visitor becomes admin
const DEV_MODE = !GOOGLE_CLIENT_ID;

module.exports = { PORT, GOOGLE_CLIENT_ID, SESSION_SECRET, ADMIN_EMAILS, DEV_MODE };
