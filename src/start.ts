import { app, shutdownSSE, PORT, DEV_MODE } from './server.js';
import prisma from './lib/db.js';

const server = app.listen(PORT, () => {
  console.log(`Sering Project Tracker running on http://localhost:${PORT}`);
  if (DEV_MODE) console.log('DEV MODE: No Google auth required. Use /auth/dev-login to become admin.');
});

server.keepAliveTimeout = 55_000;
server.headersTimeout = 60_000;

function gracefulShutdown(signal: string) {
  console.log(`${signal} received — shutting down gracefully...`);
  // Close SSE connections first so server.close() can complete
  shutdownSSE();
  server.close(async () => {
    console.log('HTTP server closed');
    try { await prisma.$disconnect(); } catch { /* ignore */ }
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forced shutdown after 10s timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
