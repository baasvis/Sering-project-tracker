import request from 'supertest';
import type { Express } from 'express';
import { createAdminSession, createVisitorSession } from './_test-helpers.js';

let app: Express;
let admin: Awaited<ReturnType<typeof createAdminSession>>;
let visitor: Awaited<ReturnType<typeof createVisitorSession>>;

const createdIds: { comments: string[]; groups: string[]; projects: string[] } = {
  comments: [], groups: [], projects: [],
};

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:pzEGdqUXPsVtFkuPiLtHVcjUirkzIEmG@gondola.proxy.rlwy.net:56119/railway';
  app = (await import('../server.js')).default;
  admin = await createAdminSession(app);
  visitor = await createVisitorSession(app);
});

afterAll(async () => {
  const prisma = (await import('../lib/db.js')).default;
  for (const id of createdIds.comments) {
    await prisma.comment.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdIds.projects) {
    await prisma.project.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdIds.groups) {
    await prisma.group.delete({ where: { id } }).catch(() => {});
  }
});

async function createTestProject() {
  const prisma = (await import('../lib/db.js')).default;
  const group = await prisma.group.create({ data: { name: 'Comment Test Group ' + Date.now() } });
  createdIds.groups.push(group.id);
  const project = await prisma.project.create({
    data: { groupId: group.id, name: 'Comment Test Project', approved: true },
  });
  createdIds.projects.push(project.id);
  return project;
}

describe('Comments: GET /api/comments — validation', () => {
  it('rejects missing targetType and targetId', async () => {
    const res = await request(app).get('/api/comments');
    expect(res.status).toBe(400);
  });

  it('rejects invalid targetType', async () => {
    const res = await request(app).get('/api/comments?targetType=invalid&targetId=550e8400-e29b-41d4-a716-446655440000');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns empty array for non-existent target', async () => {
    const res = await request(app).get('/api/comments?targetType=project&targetId=550e8400-e29b-41d4-a716-446655440000');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.hasMore).toBe(false);
  });

  it('returns comments for a valid target', async () => {
    const project = await createTestProject();
    const createRes = await admin.post('/api/comments').send({
      targetType: 'project', targetId: project.id,
      authorName: 'TestListUser', body: 'Test comment for listing',
    });
    expect(createRes.status).toBe(201);
    createdIds.comments.push(createRes.body.id);

    const res = await request(app).get(`/api/comments?targetType=project&targetId=${project.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].authorName).toBe('TestListUser');
  });
});

describe('Comments: POST /api/comments — target validation', () => {
  it('rejects missing required fields', async () => {
    const res = await admin.post('/api/comments').send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects comment on non-existent project', async () => {
    const res = await admin.post('/api/comments').send({
      targetType: 'project', targetId: '550e8400-e29b-41d4-a716-446655440000',
      authorName: 'TestUser', body: 'Comment on non-existent target',
    });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('creates comment on valid target', async () => {
    const project = await createTestProject();
    const res = await admin.post('/api/comments').send({
      targetType: 'project', targetId: project.id,
      authorName: 'TestCreateUser', body: 'Valid comment on a real project',
    });
    expect(res.status).toBe(201);
    expect(res.body.authorName).toBe('TestCreateUser');
    expect(res.body.targetType).toBe('project');
    createdIds.comments.push(res.body.id);
  });

  it('strips HTML tags from comment body', async () => {
    const project = await createTestProject();
    const res = await admin.post('/api/comments').send({
      targetType: 'project', targetId: project.id,
      authorName: 'TestHTMLUser', body: 'Hello <script>alert("xss")</script> world',
    });
    expect(res.status).toBe(201);
    expect(res.body.body).not.toContain('<script>');
    expect(res.body.body).toContain('Hello');
    createdIds.comments.push(res.body.id);
  });
});

describe('Comments: POST /api/comments — duplicate detection', () => {
  it('rejects duplicate comment (same author + body within 5 minutes)', async () => {
    const project = await createTestProject();
    const uniqueName = 'DupTestUser_' + Date.now();
    const uniqueBody = 'Unique dup test body ' + Date.now();
    const payload = {
      targetType: 'project', targetId: project.id,
      authorName: uniqueName, body: uniqueBody,
    };

    const first = await admin.post('/api/comments').send(payload);
    expect(first.status).toBe(201);
    createdIds.comments.push(first.body.id);

    const second = await admin.post('/api/comments').send(payload);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('CONFLICT');
  });
});

describe('Comments: DELETE /api/comments/:id — admin delete', () => {
  it('admin can delete a comment', async () => {
    const project = await createTestProject();
    const createRes = await admin.post('/api/comments').send({
      targetType: 'project', targetId: project.id,
      authorName: 'DeleteTestUser', body: 'Comment to be deleted by admin',
    });
    expect(createRes.status).toBe(201);

    const deleteRes = await admin.del(`/api/comments/${createRes.body.id}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.ok).toBe(true);
  });

  it('returns 404 for non-existent comment', async () => {
    const res = await admin.del('/api/comments/550e8400-e29b-41d4-a716-446655440000');
    expect(res.status).toBe(404);
  });

  it('rejects non-admin delete', async () => {
    const project = await createTestProject();
    const createRes = await admin.post('/api/comments').send({
      targetType: 'project', targetId: project.id,
      authorName: 'NoAdminDeleteTest', body: 'Comment that non-admin tries to delete',
    });
    expect(createRes.status).toBe(201);
    createdIds.comments.push(createRes.body.id);

    const deleteRes = await visitor.del(`/api/comments/${createRes.body.id}`);
    expect(deleteRes.status).toBe(401);
  });
});
