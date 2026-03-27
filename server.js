const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const cookieParser = require('cookie-parser');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { PORT, SESSION_SECRET, GOOGLE_CLIENT_ID, DEV_MODE } = require('./lib/config');
const { addClient, getClientCount } = require('./lib/sse');

const app = express();

// Compress all responses (gzip/brotli)
app.use(compression());

// Trust reverse proxy (Railway, Nginx, etc.) for correct IP in rate limiting
app.set('trust proxy', 1);

// Security headers via helmet — NO unsafe-inline for scriptSrcAttr
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
    }
  },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginEmbedderPolicy: false,
}));

// Body parsing with tight limits
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ---- Rate limiting ----

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});

const writeLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' }
});

const uploadLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads, please wait a minute' }
});

const sseLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many SSE connections, please wait' }
});

app.use('/api', apiLimiter);

app.delete('/api/comments/:id', writeLimiter);
app.delete('/api/media/:id', writeLimiter);
app.delete('/api/shopping/:id', writeLimiter);
app.delete('/api/reports/:id', writeLimiter);

// Session with Postgres store (survives restarts, no memory leak)
const sessionConfig = {
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
};

// Use Postgres session store if DATABASE_URL is available (production)
// Falls back to MemoryStore in dev (acceptable for 3 admin sessions)
if (process.env.DATABASE_URL) {
  sessionConfig.store = new PgSession({
    conString: process.env.DATABASE_URL,
    tableName: 'session',
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 15, // Clean expired sessions every 15 min
  });
}

app.use(session(sessionConfig));

// Cookie parser (needed for CSRF double-submit)
app.use(cookieParser());

// CSRF protection: double-submit cookie pattern
app.use((req, res, next) => {
  if (!req.cookies?.['csrf-token']) {
    const token = crypto.randomBytes(24).toString('hex');
    res.cookie('csrf-token', token, { httpOnly: false, sameSite: 'strict', secure: !DEV_MODE });
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
  const timeout = req.path === '/api/export' ? 120_000 : 30_000;
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
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir, { maxAge: '7d' }));

// SSE endpoint
app.get('/api/events', sseLimiter, (req, res) => {
  addClient(req, res);
});

// Client config endpoint
app.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ googleClientId: GOOGLE_CLIENT_ID, devMode: DEV_MODE });
});

// Cache-Control for read-heavy API GETs
app.use('/api', (req, res, next) => {
  if (req.method === 'GET') {
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
  }
  next();
});

// ---- Routes ----

app.use('/auth', require('./routes/auth'));
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

const server = app.listen(PORT, () => {
  console.log(`Sering Project Tracker running on http://localhost:${PORT}`);
  if (DEV_MODE) console.log('DEV MODE: No Google auth required. Use /auth/dev-login to become admin.');
});

server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;
