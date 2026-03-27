const prisma = require('./db');

// Log an admin action for audit trail
// Fire-and-forget — never blocks the request
function logAction(req, action, targetType, targetId, details) {
  const actor = req.session?.email || 'unknown';
  prisma.auditLog.create({
    data: {
      action,
      actor,
      targetType: targetType || null,
      targetId: targetId || null,
      details: details ? JSON.stringify(details) : null,
    }
  }).catch(err => {
    console.error('Audit log failed:', err.message);
  });
}

module.exports = { logAction };
