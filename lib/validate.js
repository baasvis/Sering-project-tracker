// Shared validation and sanitization helpers

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

// Strip HTML tags from user input (defense-in-depth against stored XSS)
function stripTags(str) {
  if (!str) return '';
  return String(str).replace(/<[^>]*>/g, '').trim();
}

// Validate URL is http/https only (prevents javascript: XSS)
function isValidUrl(url) {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

// Validate numeric value within bounds, returns null if invalid
function validateNumber(val, min, max) {
  if (val === null || val === undefined) return null;
  const num = parseFloat(val);
  if (isNaN(num) || !isFinite(num) || num < min || num > max) return null;
  return num;
}

// Sanitize and validate a name field (author, reporter, etc.)
function sanitizeName(name, { minLen = 1, maxLen = 50 } = {}) {
  if (!name) return null;
  const clean = stripTags(String(name)).slice(0, maxLen);
  if (clean.length < minLen) return null;
  return clean;
}

const VALID_TARGET_TYPES = ['group', 'project', 'task', 'announcement'];
const VALID_PARENT_TYPES = ['task', 'project', 'announcement', 'comment'];
const VALID_STATUSES = ['active', 'completed', 'archived'];
const VALID_TASK_STATUSES = ['todo', 'in_progress', 'done'];
const VALID_JOIN_TYPES = ['open', 'contact', 'closed'];
const VALID_TIERS = ['mvp', 'medium', 'next_level'];
const VALID_SHOPPING_TYPES = ['product', 'cost'];

module.exports = {
  isValidUuid,
  validateId,
  stripTags,
  isValidUrl,
  validateNumber,
  sanitizeName,
  VALID_TARGET_TYPES,
  VALID_PARENT_TYPES,
  VALID_STATUSES,
  VALID_TASK_STATUSES,
  VALID_JOIN_TYPES,
  VALID_TIERS,
  VALID_SHOPPING_TYPES,
};
