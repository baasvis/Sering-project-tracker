const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { PORT, SESSION_SECRET, GOOGLE_CLIENT_ID, DEV_MODE } = require('./lib/config');

const app = express();

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Session (for admin login)
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

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
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/comments', require('./routes/comments'));
app.use('/api/media', require('./routes/media'));
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

app.listen(PORT, () => {
  console.log(`Sering Project Tracker running on http://localhost:${PORT}`);
  if (DEV_MODE) console.log('DEV MODE: No Google auth required. Use /auth/dev-login to become admin.');
});
