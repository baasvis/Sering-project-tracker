require('dotenv/config');

const crypto = require('crypto');

// ─── Environment ────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Dev mode requires BOTH: not production AND no Google client ID
const DEV_MODE = !IS_PRODUCTION && !GOOGLE_CLIENT_ID;

// ─── Production startup checks (crash early, not at request time) ───────────

if (IS_PRODUCTION) {
  if (!SESSION_SECRET) {
    console.error('FATAL: SESSION_SECRET is required in production. Set it in your environment variables.');
    process.exit(1);
  }
  if (!GOOGLE_CLIENT_ID) {
    console.error('FATAL: GOOGLE_CLIENT_ID is required in production. Set it in your environment variables.');
    process.exit(1);
  }
  if (ADMIN_EMAILS.length === 0) {
    console.error('FATAL: ADMIN_EMAILS is required in production. Set it in your environment variables (comma-separated).');
    process.exit(1);
  }
}

// In dev, generate a random secret if none set (safe for single-process dev)
const RESOLVED_SESSION_SECRET = SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// ─── Rate limiting ──────────────────────────────────────────────────────────

const RATE_LIMIT_GENERAL = 100;      // requests per minute
const RATE_LIMIT_WRITES = 20;        // write requests per minute
const RATE_LIMIT_UPLOADS = 10;       // uploads per minute
const RATE_LIMIT_SSE = 5;            // SSE connections per minute
const RATE_LIMIT_AUTH = 5;           // auth attempts per minute
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute window

// ─── SSE ────────────────────────────────────────────────────────────────────

const MAX_SSE_CONNECTIONS = 500;
const SSE_HEARTBEAT_MS = 30_000;       // 30s — keeps proxies from closing idle
const SSE_DEAD_CLIENT_MS = 90_000;     // 90s — remove clients that fail heartbeats

// ─── Media / uploads ────────────────────────────────────────────────────────

const MAX_IMAGE_SIZE_MB = 5;
const MAX_VOICE_SIZE_MB = 2;
const MAX_STORAGE_MB = 100;
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
const MAX_VOICE_SIZE_BYTES = MAX_VOICE_SIZE_MB * 1024 * 1024;
const MAX_STORAGE_BYTES = MAX_STORAGE_MB * 1024 * 1024;

// ─── Pagination ─────────────────────────────────────────────────────────────

const PAGINATION_DEFAULT_LIMIT = 50;
const PAGINATION_MAX_LIMIT = 200;

// ─── Timeouts ───────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;
const EXPORT_TIMEOUT_MS = 120_000;

// ─── Comment cooldown ───────────────────────────────────────────────────────

const COMMENT_COOLDOWN_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const COMMENT_COOLDOWN_MAX = 5;                      // max comments per window

// ─── Session ────────────────────────────────────────────────────────────────

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Validation limits ──────────────────────────────────────────────────────

const MAX_NAME_LENGTH = 200;
const MAX_AUTHOR_LENGTH = 50;
const MAX_CONTACT_LENGTH = 100;
const MAX_TITLE_LENGTH = 500;
const MAX_COMMENT_LENGTH = 2000;
const MIN_COMMENT_LENGTH = 2;
const MAX_PRICE = 1_000_000;
const MAX_QUANTITY = 10_000;

module.exports = {
  PORT,
  GOOGLE_CLIENT_ID,
  SESSION_SECRET: RESOLVED_SESSION_SECRET,
  ADMIN_EMAILS,
  IS_PRODUCTION,
  DEV_MODE,
  // Rate limiting
  RATE_LIMIT_GENERAL,
  RATE_LIMIT_WRITES,
  RATE_LIMIT_UPLOADS,
  RATE_LIMIT_SSE,
  RATE_LIMIT_AUTH,
  RATE_LIMIT_WINDOW_MS,
  // SSE
  MAX_SSE_CONNECTIONS,
  SSE_HEARTBEAT_MS,
  SSE_DEAD_CLIENT_MS,
  // Media
  MAX_IMAGE_SIZE_MB,
  MAX_VOICE_SIZE_MB,
  MAX_STORAGE_MB,
  MAX_IMAGE_SIZE_BYTES,
  MAX_VOICE_SIZE_BYTES,
  MAX_STORAGE_BYTES,
  // Pagination
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  // Timeouts
  REQUEST_TIMEOUT_MS,
  EXPORT_TIMEOUT_MS,
  // Comment cooldown
  COMMENT_COOLDOWN_WINDOW_MS,
  COMMENT_COOLDOWN_MAX,
  // Session
  SESSION_MAX_AGE_MS,
  // Validation
  MAX_NAME_LENGTH,
  MAX_AUTHOR_LENGTH,
  MAX_CONTACT_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_COMMENT_LENGTH,
  MIN_COMMENT_LENGTH,
  MAX_PRICE,
  MAX_QUANTITY,
};
