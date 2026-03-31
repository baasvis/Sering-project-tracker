import type { Response } from 'express';

// Consistent error response codes
export const ERROR_CODES = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

// Send a structured error response: { error: "message", code: "CODE" }
export function sendError(res: Response, code: ErrorCode, message: string) {
  const status = ERROR_CODES[code] || 500;
  return res.status(status).json({ error: message, code });
}

// Express middleware: handle ZodError from schema.parse()
export function handleZodError(err: unknown, res: Response): boolean {
  if (err && typeof err === 'object' && 'name' in err && err.name === 'ZodError') {
    const zodErr = err as unknown as { issues: Array<{ path: (string | number)[]; message: string }> };
    const messages = zodErr.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    sendError(res, 'VALIDATION_ERROR', messages);
    return true;
  }
  return false;
}
