// Consistent error response codes
const ERROR_CODES = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

// Send a structured error response: { error: "message", code: "CODE" }
function sendError(res, code, message) {
  const status = ERROR_CODES[code] || 500;
  return res.status(status).json({ error: message, code });
}

// Express middleware: handle ZodError from schema.parse()
function handleZodError(err, res) {
  if (err?.name === 'ZodError') {
    const messages = err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    return sendError(res, 'VALIDATION_ERROR', messages);
  }
  return false;
}

module.exports = { ERROR_CODES, sendError, handleZodError };
