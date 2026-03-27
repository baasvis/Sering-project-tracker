const express = require('express');
const session = require('express-session');
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
      scriptSrcAttr: ["'unsafe-inline'"],
    }
  },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginEmbedderPolicy: false,
}));

// Body parsing with tight limits
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ---- Rate limiting ----

// General API: 100 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});

// Write operations: 20 per minute per IP
const writeLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' }
});

// File uploads: 10 per minute per IP
const uploadLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads, please wait a minute' }
});

// SSE: 5 new connections per minute per IP (reconnection protection)
const sseLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many SSE connections, please wait' }
});

app.use('/api', apiLimiter);

// Write limiter on all mutation endpoints
app.delete('/api/comments/:id', writeLimiter);
app.delete('/api/media/:id', writeLimiter);
app.delete('/api/shopping/:id', writeLimiter);
app.delete('/api/reports/:id', writeLimiter);

// Session (for admin login)
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

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

// Request timeout: kill requests that take too long (30s for normal, 120s for exports)
app.use((req, res, next) => {
  const timeout = req.path === '/api/export' ? 120_000 : 30_000;
  req.setTimeout(timeout, () => {
    if (!res.headersSent) {
      res.status(408).json({ error: 'Request timeout' });
    }
  });
  next();
});

// Static files (cache CSS/JS for 1 hour, HTML short-lived)
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

// Client config endpoint (long cache — doesn't change at runtime)
app.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ googleClientId: GOOGLE_CLIENT_ID, devMode: DEV_MODE });
});

// Cache-Control for read-heavy API GETs (prevents stampede with 300 users)
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

// SPA fallback — serve index.html for all non-API routes
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

// Configure server timeouts for long-lived connections (SSE)
server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;
