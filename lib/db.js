require('dotenv/config');
const { PrismaClient } = require('@prisma/client');

const dbUrl = process.env.DATABASE_URL || '';
const pooledUrl = dbUrl.includes('connection_limit')
  ? dbUrl
  : `${dbUrl}${dbUrl.includes('?') ? '&' : '?'}connection_limit=30`;

// Base client with query timeout built into the connection string
// Prisma 6+ uses statement_timeout at the DB level for per-query timeouts
const timeoutUrl = pooledUrl.includes('statement_timeout')
  ? pooledUrl
  : `${pooledUrl}&statement_timeout=10000`; // 10s query timeout

const prisma = new PrismaClient({
  datasources: { db: { url: timeoutUrl } },
  log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
});

// Note: Prisma disconnect is handled by server.js gracefulShutdown()
// to ensure it runs after server.close() completes

module.exports = prisma;
