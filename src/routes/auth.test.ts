import request from 'supertest';
import type { Express } from 'express';
import { extractCookies, createAdminSession, createVisitorSession } from './_test-helpers.js';

let app: Express;

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:pzEGdqUXPsVtFkuPiLtHVcjUirkzIEmG@gondola.proxy.rlwy.net:56119/railway';
  app = (await import('../server.js')).default;
});

describe('Auth: GET /auth/me', () => {
  it('returns admin: false when not logged in', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.admin).toBe(false);
    expect(res.body).not.toHaveProperty('email');
  });

  it('returns admin: true with email after dev-login', async () => {
    const loginRes = await request(app).post('/auth/dev-login');
    expect(loginRes.status).toBe(200);
    const cookies = extractCookies(loginRes);

    const res = await request(app).get('/auth/me').set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.admin).toBe(true);
    expect(res.body.email).toBe('dev@localhost');
  });
});

describe('Auth: POST /auth/dev-login', () => {
  it('succeeds in dev mode (non-production, no GOOGLE_CLIENT_ID)', async () => {
    const res = await request(app).post('/auth/dev-login');
    expect(res.status).toBe(200);
    expect(res.body.admin).toBe(true);
    expect(res.body.email).toBe('dev@localhost');
  });

  it('IS_PRODUCTION is false in test env (dev-login would be blocked if true)', () => {
    expect(process.env.NODE_ENV).not.toBe('production');
  });
});

describe('Auth: POST /auth/google', () => {
  it('rejects request without credential', async () => {
    const res = await request(app).post('/auth/google').send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.error).toMatch(/credential/i);
  });
});

describe('Auth: POST /auth/logout', () => {
  it('destroys session and returns ok', async () => {
    const loginRes = await request(app).post('/auth/dev-login');
    const cookies = extractCookies(loginRes);

    const me1 = await request(app).get('/auth/me').set('Cookie', cookies);
    expect(me1.body.admin).toBe(true);

    const logoutRes = await request(app).post('/auth/logout').set('Cookie', cookies);
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.ok).toBe(true);

    const me2 = await request(app).get('/auth/me').set('Cookie', cookies);
    expect(me2.body.admin).toBe(false);
  });
});

describe('Auth: requireAdmin middleware', () => {
  it('rejects unauthenticated PATCH to admin-only route', async () => {
    const visitor = await createVisitorSession(app);
    const res = await request(app)
      .patch('/api/groups/550e8400-e29b-41d4-a716-446655440000')
      .set('Cookie', visitor.cookies)
      .set('X-CSRF-Token', visitor.csrfToken)
      .send({ name: 'Hacked' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('allows admin to access protected routes', async () => {
    const admin = await createAdminSession(app);
    const res = await admin.patch('/api/groups/550e8400-e29b-41d4-a716-446655440000')
      .send({ name: 'Test' });
    // Should NOT get 401 (may get 404 for non-existent group, but not 401)
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
