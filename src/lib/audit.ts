import type { Request } from 'express';
import prisma from './db.js';

// Log an admin action for audit trail
// Fire-and-forget — never blocks the request
export function logAction(
  req: Request,
  action: string,
  targetType?: string | null,
  targetId?: string | null,
  details?: Record<string, unknown> | null,
) {
  const actor = req.session?.email || 'unknown';
  prisma.auditLog.create({
    data: {
      action,
      actor,
      targetType: targetType || null,
      targetId: targetId || null,
      details: details ? JSON.stringify(details) : null,
    },
  }).catch((err: Error) => {
    console.error('Audit log failed:', err.message);
  });
}
