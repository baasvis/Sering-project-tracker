require('dotenv/config');
const { PrismaClient } = require('@prisma/client');

// Increase connection pool for concurrent load (default is 5, too low for 100+ users)
// Append connection_limit to DATABASE_URL if not already set
const dbUrl = process.env.DATABASE_URL || '';
const pooledUrl = dbUrl.includes('connection_limit')
  ? dbUrl
  : `${dbUrl}${dbUrl.includes('?') ? '&' : '?'}connection_limit=20`;

const prisma = new PrismaClient({
  datasources: { db: { url: pooledUrl } }
});

module.exports = prisma;
