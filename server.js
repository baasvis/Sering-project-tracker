const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { PORT, SESSION_SECRET, GOOGLE_CLIENT_ID, DEV_MODE } = require('./lib/config');

const app = express();

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
      connectSrc: ["'self'"],
      frameSrc: ["https://accounts.google.com"],
      fontSrc: ["'self'"],
      mediaSrc: ["'self'", "blob:"],
    }
  },
  crossOriginEmbedderPolicy: false, // needed for Google Sign-In
}));

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting — general API: 100 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});

// Stricter limit for write operations: 20 per minute per IP
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' }
});

// Strict limit for file uploads: 10 per minute per IP
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads, please wait a minute' }
});

app.use('/api', apiLimiter);

// Session (for admin login)
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

// Cookie parser (needed for CSRF double-submit)
app.use(cookieParser());

// CSRF protection: double-submit cookie pattern
// Set a CSRF token cookie on every request; require it as a header on writes
app.use((req, res, next) => {
  // Set token cookie if not present
  if (!req.cookies?.['csrf-token']) {
    const token = crypto.randomBytes(24).toString('hex');
    res.cookie('csrf-token', token, { httpOnly: false, sameSite: 'strict', secure: !DEV_MODE });
  }
  // Verify on mutating requests to /api/*
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && req.path.startsWith('/api/')) {
    const cookieToken = req.cookies?.['csrf-token'];
    const headerToken = req.headers['x-csrf-token'];
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return res.status(403).json({ error: 'Invalid or missing CSRF token' });
    }
  }
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

// Inject config into a client-accessible endpoint
app.get('/api/config', (req, res) => {
  res.json({
    googleClientId: GOOGLE_CLIENT_ID,
    devMode: DEV_MODE
  });
});

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/tasks', require('./routes/tasks'));
// Shopping: stricter write limit (spam protection for suggestions)
const shoppingRouter = require('./routes/shopping');
app.post('/api/shopping', writeLimiter);
app.use('/api/shopping', shoppingRouter);
app.use('/api/announcements', require('./routes/announcements'));

// Comments: stricter write limit (spam protection)
const commentsRouter = require('./routes/comments');
app.post('/api/comments', writeLimiter);
app.use('/api/comments', commentsRouter);

// Media: strict upload limit
const mediaRouter = require('./routes/media');
app.post('/api/media', uploadLimiter);
app.use('/api/media', mediaRouter);

app.use('/api/export', require('./routes/export'));
app.use('/api', require('./routes/health'));

// SPA fallback — serve index.html for all non-API routes
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Sync database schema on startup, then start listening
const { execSync } = require('child_process');
try {
  console.log('Syncing database schema...');
  execSync('npx prisma db push --skip-generate --accept-data-loss', { stdio: 'inherit', cwd: __dirname });
  console.log('Database schema synced.');
} catch (err) {
  console.error('Warning: Could not sync database schema:', err.message);
}

app.listen(PORT, () => {
  console.log(`Sering Project Tracker running on http://localhost:${PORT}`);
  if (DEV_MODE) console.log('DEV MODE: No Google auth required. Use /auth/dev-login to become admin.');
});
