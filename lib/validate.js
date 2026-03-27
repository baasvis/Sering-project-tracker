// Shared validation helpers

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(str) {
  return typeof str === 'string' && UUID_RE.test(str);
}

// Express middleware: validate :id param is a UUID
function validateId(req, res, next) {
  if (!isValidUuid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid ID format' });
  }
  next();
}

const VALID_TARGET_TYPES = ['group', 'project', 'task', 'announcement'];
const VALID_PARENT_TYPES = ['task', 'project', 'announcement', 'comment'];
const VALID_STATUSES = ['active', 'completed', 'archived'];
const VALID_TASK_STATUSES = ['todo', 'in_progress', 'done'];

module.exports = { isValidUuid, validateId, VALID_TARGET_TYPES, VALID_PARENT_TYPES, VALID_STATUSES, VALID_TASK_STATUSES };
