import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/db.js';
import { getClientCount } from '../lib/sse.js';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
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

export default router;
