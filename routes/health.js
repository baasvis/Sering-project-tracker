const { Router } = require('express');
const prisma = require('../lib/db');
const { getClientCount } = require('../lib/sse');

const router = Router();

router.get('/health', async (req, res) => {
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    // DB unreachable
  }

  const status = dbOk ? 'ok' : 'degraded';
  const statusCode = dbOk ? 200 : 503;

  res.status(statusCode).json({
    status,
    timestamp: new Date().toISOString(),
    sseClients: getClientCount(),
    uptime: Math.floor(process.uptime()),
    db: dbOk ? 'connected' : 'unreachable',
  });
});

module.exports = router;
