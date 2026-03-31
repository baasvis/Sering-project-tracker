import type { Request, Response, NextFunction } from 'express';

// Shared validation and sanitization helpers

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(str: string): boolean {
  return typeof str === 'string' && UUID_RE.test(str);
}

// Express middleware: validate :id param is a UUID
export function validateId(req: Request, res: Response, next: NextFunction) {
  if (!isValidUuid(req.params.id as string)) {
    return res.status(400).json({ error: 'Invalid ID format' });
  }
  next();
}

// Strip HTML tags from user input (defense-in-depth against stored XSS)
export function stripTags(str: string | null | undefined): string {
  if (!str) return '';
  return String(str).replace(/<[^>]*>/g, '').trim();
}

// Validate URL is http/https only (prevents javascript: XSS)
export function isValidUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

// Validate numeric value within bounds, returns null if invalid
export function validateNumber(val: unknown, min: number, max: number): number | null {
  if (val === null || val === undefined) return null;
  const num = parseFloat(String(val));
  if (isNaN(num) || !isFinite(num) || num < min || num > max) return null;
  return num;
}

// Sanitize and validate a name field (author, reporter, etc.)
export function sanitizeName(
  name: string | null | undefined,
  { minLen = 1, maxLen = 50 }: { minLen?: number; maxLen?: number } = {},
): string | null {
  if (!name) return null;
  const clean = stripTags(String(name)).slice(0, maxLen);
  if (clean.length < minLen) return null;
  return clean;
}
