import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import connectPg from 'connect-pg-simple';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  PORT, SESSION_SECRET, GOOGLE_CLIENT_ID, DEV_MODE, IS_PRODUCTION,
  RATE_LIMIT_GENERAL, RATE_LIMIT_WRITES, RATE_LIMIT_UPLOADS,
  RATE_LIMIT_SSE, RATE_LIMIT_AUTH, RATE_LIMIT_WINDOW_MS,
  REQUEST_TIMEOUT_MS, EXPORT_TIMEOUT_MS, SESSION_MAX_AGE_MS,
} from './lib/config.js';
import { addClient, shutdown as shutdownSSE } from './lib/sse.js';
import authRouter, { requireAdmin } from './routes/auth.js';
import groupsRouter from './routes/groups.js';
import projectsRouter from './routes/projects.js';
import tasksRouter from './routes/tasks.js';
import shoppingRouter from './routes/shopping.js';
import toolsRouter from './routes/tools.js';
import announcementsRouter from './routes/announcements.js';
import commentsRouter from './routes/comments.js';
import mediaRouter, { batchHandler } from './routes/media.js';
import reportsRouter from './routes/reports.js';
import exportRouter from './routes/export.js';
import healthRouter from './routes/health.js';
import getTogetherRouter from './routes/get-together.js';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Project root is one level up from src/
const projectRoot = path.join(__dirname, '..');

const PgSession = connectPg(session);

const app = express();

// Compress all responses (gzip/brotli)
app.use(compression());

// Trust reverse proxy (Railway, Nginx, etc.) for correct IP in rate limiting
app.set('trust proxy', 1);

// Enable ETags for API responses (weak ETags — content-based caching)
app.set('etag', 'weak');

// Request logging — concise format, skip health checks
app.use(morgan('short', {
  skip: (req: Request) => req.path === '/api/health' || req.path === '/api/events',
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
    },
  },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginEmbedderPolicy: false,
}));

// Permissions-Policy: restrict browser features to only what's needed
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Permissions-Policy',
    'camera=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), ' +
    'microphone=(self)',  // needed for voice note recording
  );
  next();
});

// Body parsing with tight limits
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ---- Rate limiting ----

const isTest = process.env.NODE_ENV === 'test';
const limiterDefaults = { windowMs: RATE_LIMIT_WINDOW_MS, standardHeaders: true, legacyHeaders: false, ...(isTest && { skip: () => true }) };

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
const sessionConfig: session.SessionOptions = {
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
  },
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
app.use((req: Request, res: Response, next: NextFunction) => {
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
app.use((req: Request, res: Response, next: NextFunction) => {
  const timeout = req.path === '/api/export' ? EXPORT_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  req.setTimeout(timeout, () => {
    if (!res.headersSent) {
      res.status(408).json({ error: 'Request timeout' });
    }
  });
  next();
});

// Static files
app.use(express.static(path.join(projectRoot, 'public'), {
  maxAge: IS_PRODUCTION ? '1h' : 0,
  etag: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html') || !IS_PRODUCTION) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// Ensure uploads directory exists
const uploadsDir = path.join(projectRoot, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', (req: Request, res: Response, next: NextFunction) => {
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
app.get('/api/events', sseLimiter, (req: Request, res: Response) => {
  addClient(req, res);
});

// CSP violation reports (fire-and-forget logging)
app.post('/api/csp-report', express.json({ type: 'application/csp-report' }), (req: Request, res: Response) => {
  const report = (req.body as any)?.['csp-report'] || req.body;
  if (report) {
    console.warn('CSP violation:', report['blocked-uri'] || report.blockedURL || 'unknown',
      'directive:', report['violated-directive'] || report.effectiveDirective || 'unknown');
  }
  res.status(204).end();
});

// Client config endpoint
app.get('/api/config', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ googleClientId: GOOGLE_CLIENT_ID, devMode: DEV_MODE });
});

// Cache-Control for read-heavy API GETs — use private to prevent shared caches leaking data
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'GET') {
    res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  }
  next();
});

// ---- Routes ----

app.use('/auth', authLimiter, authRouter);
app.post('/api/groups', writeLimiter);
app.patch('/api/groups/:id', writeLimiter);
app.delete('/api/groups/:id', writeLimiter);
app.use('/api/groups', groupsRouter);

app.post('/api/projects', writeLimiter);
app.patch('/api/projects/:id', writeLimiter);
app.patch('/api/projects/:id/approve', writeLimiter);
app.delete('/api/projects/:id', writeLimiter);
app.use('/api/projects', projectsRouter);

app.post('/api/tasks', writeLimiter);
app.patch('/api/tasks/:id', writeLimiter);
app.patch('/api/tasks/:id/approve', writeLimiter);
app.delete('/api/tasks/:id', writeLimiter);
app.use('/api/tasks', tasksRouter);

app.post('/api/shopping', writeLimiter);
app.patch('/api/shopping/:id', writeLimiter);
app.patch('/api/shopping/:id/approve', writeLimiter);
app.use('/api/shopping', shoppingRouter);
app.post('/api/tools', writeLimiter);
app.patch('/api/tools/:id', writeLimiter);
app.patch('/api/tools/:id/available', writeLimiter);
app.patch('/api/tools/:id/approve', writeLimiter);
app.delete('/api/tools/:id', writeLimiter);
app.use('/api/tools', toolsRouter);

app.post('/api/announcements', writeLimiter);
app.patch('/api/announcements/:id', writeLimiter);
app.delete('/api/announcements/:id', writeLimiter);
app.use('/api/announcements', announcementsRouter);

app.post('/api/comments', writeLimiter);
app.use('/api/comments', commentsRouter);

app.post('/api/media', uploadLimiter);
app.get('/api/media/batch', batchHandler);
app.use('/api/media', mediaRouter);

app.post('/api/reports', writeLimiter);
app.use('/api/reports', reportsRouter);

app.post('/api/get-together/locations', writeLimiter);
app.patch('/api/get-together/locations/:id', writeLimiter);
app.delete('/api/get-together/locations/:id', writeLimiter);
app.post('/api/get-together/blocks', writeLimiter);
app.patch('/api/get-together/blocks/:id', writeLimiter);
app.delete('/api/get-together/blocks/:id', writeLimiter);
app.post('/api/get-together/blocks/:id/signup', writeLimiter);
app.delete('/api/get-together/blocks/:id/signup', writeLimiter);
app.post('/api/get-together/map', uploadLimiter);
app.delete('/api/get-together/map', writeLimiter);
app.use('/api/get-together', getTogetherRouter);

app.use('/api/export', exportRouter);
app.use('/api', healthRouter);

// SPA fallback
app.get('/{*path}', (_req: Request, res: Response) => {
  res.sendFile(path.join(projectRoot, 'public', 'index.html'));
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// Export for testing and start.ts
export { app, shutdownSSE, PORT, DEV_MODE };
export default app;
