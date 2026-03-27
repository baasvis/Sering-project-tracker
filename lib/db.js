require('dotenv/config');
const { PrismaClient } = require('@prisma/client');

// Connection pool sized for 300 concurrent users on a single server.
// Railway's Postgres plugin supports up to ~97 connections.
// 30 covers peak load with headroom for admin exports + background queries.
const dbUrl = process.env.DATABASE_URL || '';
const pooledUrl = dbUrl.includes('connection_limit')
  ? dbUrl
  : `${dbUrl}${dbUrl.includes('?') ? '&' : '?'}connection_limit=30`;

const prisma = new PrismaClient({
  datasources: { db: { url: pooledUrl } },
  log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
});

// Graceful shutdown — close Prisma connection pool
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

module.exports = prisma;
