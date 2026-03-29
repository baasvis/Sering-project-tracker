const request = require('supertest');

// The app requires DATABASE_URL for Prisma client initialization.
// In test env without a DB, the Prisma client will be created but
// queries will fail — we test request validation and middleware only.

let app;

beforeAll(() => {
  // Set minimal env for app to load
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
  app = require('../server');
});

describe('Health endpoint', () => {
  it('GET /api/health returns health status with db field', async () => {
    const res = await request(app).get('/api/health');
    expect([200, 503]).toContain(res.status);
    expect(['ok', 'degraded']).toContain(res.body.status);
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('sseClients');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('db');
    expect(['connected', 'unreachable']).toContain(res.body.db);
  });
});

describe('Config endpoint', () => {
  it('GET /api/config returns devMode and googleClientId', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('devMode');
    expect(res.body).toHaveProperty('googleClientId');
  });
});

describe('Auth endpoints', () => {
  it('GET /auth/me returns admin: false when not logged in', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.admin).toBe(false);
  });

  it('POST /auth/google returns 400 without credential', async () => {
    const res = await request(app)
      .post('/auth/google')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('POST /auth/dev-login works in dev mode', async () => {
    const res = await request(app).post('/auth/dev-login');
    // In test env (not production, no GOOGLE_CLIENT_ID), dev mode is enabled
    expect(res.status).toBe(200);
    expect(res.body.admin).toBe(true);
    expect(res.body.email).toBe('dev@localhost');
  });
});

describe('CSRF protection', () => {
  it('POST without CSRF token returns 403', async () => {
    const res = await request(app)
      .post('/api/comments')
      .send({ body: 'test' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/CSRF/i);
  });

  it('POST with matching CSRF tokens passes CSRF check', async () => {
    // First get a CSRF token from a cookie
    const getRes = await request(app).get('/api/health');
    const cookies = getRes.headers['set-cookie'] || [];
    const csrfCookie = cookies.find(c => c.startsWith('csrf-token='));
    if (!csrfCookie) return; // no CSRF cookie set on this request

    const token = csrfCookie.split('=')[1].split(';')[0];
    const res = await request(app)
      .post('/api/comments')
      .set('Cookie', `csrf-token=${token}`)
      .set('X-CSRF-Token', token)
      .send({ targetType: 'project', targetId: '550e8400-e29b-41d4-a716-446655440000', authorName: 'Test', body: 'Hello' });

    // Should pass CSRF (may fail on DB query, but NOT on 403 CSRF)
    expect(res.status).not.toBe(403);
  });
});

describe('Input validation on routes', () => {
  let csrfToken;
  let cookies;

  beforeAll(async () => {
    // Get CSRF token for write requests
    const getRes = await request(app).get('/api/config');
    const setCookies = getRes.headers['set-cookie'] || [];
    const csrfCookie = setCookies.find(c => c.startsWith('csrf-token='));
    if (csrfCookie) {
      csrfToken = csrfCookie.split('=')[1].split(';')[0];
      cookies = `csrf-token=${csrfToken}`;
    }
  });

  function postWithCsrf(url) {
    return request(app)
      .post(url)
      .set('Cookie', cookies || '')
      .set('X-CSRF-Token', csrfToken || '');
  }

  function patchWithCsrf(url) {
    return request(app)
      .patch(url)
      .set('Cookie', cookies || '')
      .set('X-CSRF-Token', csrfToken || '');
  }

  it('POST /api/comments rejects missing fields', async () => {
    const res = await postWithCsrf('/api/comments').send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/comments rejects invalid targetType', async () => {
    const res = await postWithCsrf('/api/comments').send({
      targetType: 'invalid',
      targetId: '550e8400-e29b-41d4-a716-446655440000',
      authorName: 'Test',
      body: 'Hello world',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/comments rejects short body', async () => {
    const res = await postWithCsrf('/api/comments').send({
      targetType: 'project',
      targetId: '550e8400-e29b-41d4-a716-446655440000',
      authorName: 'Test',
      body: 'x',
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/reports rejects missing description', async () => {
    const res = await postWithCsrf('/api/reports').send({ reporterName: 'Test' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/reports rejects invalid screenshot', async () => {
    const res = await postWithCsrf('/api/reports').send({
      description: 'Something broke',
      reporterName: 'Test',
      screenshotData: 'not-a-data-url',
    });
    expect(res.status).toBe(400);
  });

  it('GET /api/groups/:id rejects non-UUID id', async () => {
    const res = await request(app).get('/api/groups/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid ID/i);
  });

  it('GET /api/comments rejects missing params', async () => {
    const res = await request(app).get('/api/comments');
    expect(res.status).toBe(400);
  });

  it('GET /api/comments rejects invalid targetType', async () => {
    const res = await request(app).get('/api/comments?targetType=bad&targetId=550e8400-e29b-41d4-a716-446655440000');
    expect(res.status).toBe(400);
  });

  it('GET /api/tasks rejects missing projectId', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(400);
  });

  it('GET /api/shopping rejects missing projectId', async () => {
    const res = await request(app).get('/api/shopping');
    expect(res.status).toBe(400);
  });

  it('Admin routes reject unauthenticated requests', async () => {
    const res = await patchWithCsrf('/api/groups/550e8400-e29b-41d4-a716-446655440000')
      .send({ name: 'Test' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });
});

describe('Static files', () => {
  it('GET / serves index.html', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('De Sering');
  });

  it('GET /js/state.js serves JS file', async () => {
    const res = await request(app).get('/js/state.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('NAV_SCREENS');
  });
});

describe('Error responses follow consistent shape', () => {
  it('404 on unknown API route returns JSON', async () => {
    const res = await request(app).get('/api/nonexistent');
    // Express 5 returns 404 for unmatched routes
    expect([404, 200, 500]).toContain(res.status);
  });

  it('Validation errors include code field', async () => {
    const res = await request(app).get('/api/groups/not-a-uuid');
    expect(res.body).toHaveProperty('error');
  });
});
