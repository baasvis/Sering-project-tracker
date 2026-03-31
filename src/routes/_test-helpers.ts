import request from 'supertest';
import type { Express } from 'express';
import type { Response } from 'supertest';

// Extract all Set-Cookie values as "name=value" pairs joined with "; "
export function extractCookies(res: Response): string {
  const raw = res.headers['set-cookie'] as string | string[] | undefined;
  if (!raw) return '';
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((c: string) => c.split(';')[0]).join('; ');
}

// Merge multiple cookie strings, later values override earlier ones
export function mergeCookies(...cookieStrings: string[]): string {
  const map: Record<string, string> = {};
  for (const cs of cookieStrings) {
    for (const part of cs.split('; ')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const name = part.substring(0, eq);
      map[name] = part;
    }
  }
  return Object.values(map).join('; ');
}

// Extract a specific cookie value from a cookie string
export function getCookieValue(cookieStr: string, name: string): string {
  const match = cookieStr.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
  return match ? match[1] ?? '' : '';
}

interface AdminSession {
  post: (url: string) => request.Test;
  patch: (url: string) => request.Test;
  del: (url: string) => request.Test;
  get: (url: string) => request.Test;
  cookies: string;
  csrfToken: string;
}

// Creates an admin session and returns helpers for making authenticated requests
export async function createAdminSession(app: Express): Promise<AdminSession> {
  // First GET to get CSRF cookie (before login, since login is POST to /auth/ not /api/)
  const initRes = await request(app).get('/api/config');
  const initCookies = extractCookies(initRes);
  const csrfToken = getCookieValue(initCookies, 'csrf-token');

  // Login as admin, forwarding the csrf cookie
  const loginRes = await request(app).post('/auth/dev-login').set('Cookie', initCookies);
  const loginCookies = extractCookies(loginRes);

  // Merge: session cookie from login + csrf cookie from init
  const cookies = mergeCookies(initCookies, loginCookies);

  function post(url: string) {
    return request(app).post(url).set('Cookie', cookies).set('X-CSRF-Token', csrfToken);
  }
  function patch(url: string) {
    return request(app).patch(url).set('Cookie', cookies).set('X-CSRF-Token', csrfToken);
  }
  function del(url: string) {
    return request(app).delete(url).set('Cookie', cookies).set('X-CSRF-Token', csrfToken);
  }
  function get(url: string) {
    return request(app).get(url).set('Cookie', cookies);
  }

  return { post, patch, del, get, cookies, csrfToken };
}

interface VisitorSession {
  post: (url: string) => request.Test;
  del: (url: string) => request.Test;
  cookies: string;
  csrfToken: string;
}

// Creates a visitor session (no admin) with CSRF token
export async function createVisitorSession(app: Express): Promise<VisitorSession> {
  const configRes = await request(app).get('/api/config');
  const cookies = extractCookies(configRes);
  const csrfToken = getCookieValue(cookies, 'csrf-token');

  function post(url: string) {
    return request(app).post(url).set('Cookie', cookies).set('X-CSRF-Token', csrfToken);
  }
  function del(url: string) {
    return request(app).delete(url).set('Cookie', cookies).set('X-CSRF-Token', csrfToken);
  }

  return { post, del, cookies, csrfToken };
}
