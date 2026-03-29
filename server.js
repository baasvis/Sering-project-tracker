const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const cookieParser = require('cookie-parser');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const {
  PORT, SESSION_SECRET, GOOGLE_CLIENT_ID, DEV_MODE, IS_PRODUCTION,
  RATE_LIMIT_GENERAL, RATE_LIMIT_WRITES, RATE_LIMIT_UPLOADS,
  RATE_LIMIT_SSE, RATE_LIMIT_AUTH, RATE_LIMIT_WINDOW_MS,
  REQUEST_TIMEOUT_MS, EXPORT_TIMEOUT_MS, SESSION_MAX_AGE_MS,
} = require('./lib/config');
const { addClient, getClientCount, shutdown: shutdownSSE } = require('./lib/sse');

const app = express();

// Compress all responses (gzip/brotli)
app.use(compression());

// Trust reverse proxy (Railway, Nginx, etc.) for correct IP in rate limiting
app.set('trust proxy', 1);

// Enable ETags for API responses (weak ETags — content-based caching)
app.set('etag', 'weak');

// Request logging — concise format, skip health checks
app.use(morgan('short', {
  skip: (req) => req.path === '/api/health' || req.path === '/api/events',
}));

// Security headers via helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://accounts.google.com", "https://apis.google.com", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://accounts.google.com", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https://accounts.google.com"],
      frameSrc: ["https://accounts.google.com"],
      fontSrc: ["'self'"],
      mediaSrc: ["'self'", "blob:"],
      reportUri: '/api/csp-report',
    }
  },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginEmbedderPolicy: false,
}));

// Permissions-Policy: restrict browser features to only what's needed
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy',
    'camera=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), ' +
    'microphone=(self)'  // needed for voice note recording
  );
  next();
});

// Body parsing with tight limits
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ---- Rate limiting ----

const limiterDefaults = { windowMs: RATE_LIMIT_WINDOW_MS, standardHeaders: true, legacyHeaders: false };

const apiLimiter = rateLimit({
  ...limiterDefaults, max: RATE_LIMIT_GENERAL,
  message: { error: 'Too many requests, please try again later', code: 'RATE_LIMITED' },
});

const writeLimiter = rateLimit({
  ...limiterDefaults, max: RATE_LIMIT_WRITES,
  message: { error: 'Too many requests, please slow down', code: 'RATE_LIMITED' },
});

const uploadLimiter = rateLimit({
  ...limiterDefaults, max: RATE_LIMIT_UPLOADS,
  message: { error: 'Too many uploads, please wait a minute', code: 'RATE_LIMITED' },
});

const sseLimiter = rateLimit({
  ...limiterDefaults, max: RATE_LIMIT_SSE,
  message: { error: 'Too many SSE connections, please wait', code: 'RATE_LIMITED' },
});

const authLimiter = rateLimit({
  ...limiterDefaults, max: RATE_LIMIT_AUTH,
  message: { error: 'Too many auth attempts, please wait', code: 'RATE_LIMITED' },
});

app.use('/api', apiLimiter);

app.delete('/api/comments/:id', writeLimiter);
app.delete('/api/media/:id', writeLimiter);
app.delete('/api/shopping/:id', writeLimiter);
app.delete('/api/reports/:id', writeLimiter);

// Session with Postgres store (survives restarts, no memory leak)
const sessionConfig = {
  name: IS_PRODUCTION ? '__Host-sid' : 'sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: SESSION_MAX_AGE_MS,
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    path: '/',
  }
};

if (process.env.DATABASE_URL) {
  sessionConfig.store = new PgSession({
    conString: process.env.DATABASE_URL,
    tableName: 'session',
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 15,
  });
}

app.use(session(sessionConfig));

// Cookie parser (needed for CSRF double-submit)
app.use(cookieParser());

// CSRF protection: double-submit cookie pattern
app.use((req, res, next) => {
  if (!req.cookies?.['csrf-token']) {
    const token = crypto.randomBytes(24).toString('hex');
    res.cookie('csrf-token', token, { httpOnly: false, sameSite: 'strict', secure: IS_PRODUCTION });
  }
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && req.path.startsWith('/api/')) {
    const cookieToken = req.cookies?.['csrf-token'];
    const headerToken = req.headers['x-csrf-token'];
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return res.status(403).json({ error: 'Invalid or missing CSRF token' });
    }
  }
  next();
});

// Request timeout
app.use((req, res, next) => {
  const timeout = req.path === '/api/export' ? EXPORT_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  req.setTimeout(timeout, () => {
    if (!res.headersSent) {
      res.status(408).json({ error: 'Request timeout' });
    }
  });
  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', (req, res, next) => {
  // Block serving potentially dangerous file types from uploads
  const ext = path.extname(req.path).toLowerCase();
  if (['.html', '.htm', '.js', '.svg', '.xml', '.xhtml'].includes(ext)) {
    return res.status(403).end();
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
}, express.static(uploadsDir, { maxAge: '7d' }));

// SSE endpoint
app.get('/api/events', sseLimiter, (req, res) => {
  addClient(req, res);
});

// CSP violation reports (fire-and-forget logging)
app.post('/api/csp-report', express.json({ type: 'application/csp-report' }), (req, res) => {
  const report = req.body?.['csp-report'] || req.body;
  if (report) {
    console.warn('CSP violation:', report['blocked-uri'] || report.blockedURL || 'unknown',
      'directive:', report['violated-directive'] || report.effectiveDirective || 'unknown');
  }
  res.status(204).end();
});

// Client config endpoint
app.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ googleClientId: GOOGLE_CLIENT_ID, devMode: DEV_MODE });
});

// Cache-Control for read-heavy API GETs — use private to prevent shared caches leaking data
app.use('/api', (req, res, next) => {
  if (req.method === 'GET') {
    res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  }
  next();
});

// ---- Routes ----

app.use('/auth', authLimiter, require('./routes/auth'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/tasks', require('./routes/tasks'));

const shoppingRouter = require('./routes/shopping');
app.post('/api/shopping', writeLimiter);
app.use('/api/shopping', shoppingRouter);

app.use('/api/announcements', require('./routes/announcements'));

const commentsRouter = require('./routes/comments');
app.post('/api/comments', writeLimiter);
app.use('/api/comments', commentsRouter);

const mediaRouter = require('./routes/media');
app.post('/api/media', uploadLimiter);
app.get('/api/media/batch', mediaRouter.batchHandler);
app.use('/api/media', mediaRouter);

const reportsRouter = require('./routes/reports');
app.post('/api/reports', writeLimiter);
app.use('/api/reports', reportsRouter);

app.use('/api/export', require('./routes/export'));
app.use('/api', require('./routes/health'));

// SPA fallback
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export app for testing (supertest)
module.exports = app;

// Only listen when run directly (not when imported by tests)
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Sering Project Tracker running on http://localhost:${PORT}`);
    if (DEV_MODE) console.log('DEV MODE: No Google auth required. Use /auth/dev-login to become admin.');
  });

  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 125_000;

  function gracefulShutdown(signal) {
    console.log(`${signal} received — shutting down gracefully...`);
    // Close SSE connections first so server.close() can complete
    shutdownSSE();
    server.close(async () => {
      console.log('HTTP server closed');
      try { await require('./lib/db').$disconnect(); } catch { /* ignore */ }
      process.exit(0);
    });
    setTimeout(() => {
      console.error('Forced shutdown after 10s timeout');
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}
