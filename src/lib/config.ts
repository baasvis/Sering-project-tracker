import 'dotenv/config';
import crypto from 'crypto';

// ─── Environment ────────────────────────────────────────────────────────────

export const PORT = process.env.PORT || 3001;
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const SESSION_SECRET_RAW = process.env.SESSION_SECRET || '';
export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Dev mode requires BOTH: not production AND no Google client ID
export const DEV_MODE = !IS_PRODUCTION && !GOOGLE_CLIENT_ID;

// ─── Production startup checks (crash early, not at request time) ───────────

if (IS_PRODUCTION) {
  if (!SESSION_SECRET_RAW) {
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
export const SESSION_SECRET = SESSION_SECRET_RAW || crypto.randomBytes(32).toString('hex');

// ─── Rate limiting ──────────────────────────────────────────────────────────

export const RATE_LIMIT_GENERAL = 100;      // requests per minute
export const RATE_LIMIT_WRITES = 20;        // write requests per minute
export const RATE_LIMIT_UPLOADS = 10;       // uploads per minute
export const RATE_LIMIT_SSE = 5;            // SSE connections per minute
export const RATE_LIMIT_AUTH = 5;           // auth attempts per minute
export const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute window

// ─── SSE ────────────────────────────────────────────────────────────────────

export const MAX_SSE_CONNECTIONS = 500;
export const SSE_HEARTBEAT_MS = 30_000;       // 30s — keeps proxies from closing idle
export const SSE_DEAD_CLIENT_MS = 90_000;     // 90s — remove clients that fail heartbeats

// ─── Media / uploads ────────────────────────────────────────────────────────

export const MAX_IMAGE_SIZE_MB = 5;
export const MAX_VOICE_SIZE_MB = 2;
export const MAX_STORAGE_MB = 100;
export const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
export const MAX_VOICE_SIZE_BYTES = MAX_VOICE_SIZE_MB * 1024 * 1024;
export const MAX_STORAGE_BYTES = MAX_STORAGE_MB * 1024 * 1024;

// ─── Pagination ─────────────────────────────────────────────────────────────

export const PAGINATION_DEFAULT_LIMIT = 50;
export const PAGINATION_MAX_LIMIT = 200;

// ─── Timeouts ───────────────────────────────────────────────────────────────

export const REQUEST_TIMEOUT_MS = 30_000;
export const EXPORT_TIMEOUT_MS = 120_000;

// ─── Comment cooldown ───────────────────────────────────────────────────────

export const COMMENT_COOLDOWN_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
export const COMMENT_COOLDOWN_MAX = 5;                      // max comments per window

// ─── Session ────────────────────────────────────────────────────────────────

export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Validation limits ──────────────────────────────────────────────────────

export const MAX_NAME_LENGTH = 200;
export const MAX_AUTHOR_LENGTH = 50;
export const MAX_CONTACT_LENGTH = 100;
export const MAX_TITLE_LENGTH = 500;
export const MAX_COMMENT_LENGTH = 2000;
export const MIN_COMMENT_LENGTH = 2;
export const MAX_PRICE = 1_000_000;
export const MAX_QUANTITY = 10_000;
