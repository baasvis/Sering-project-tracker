const request = require('supertest');
const prisma = require('../lib/db');
const { createAdminSession, createVisitorSession } = require('./_test-helpers');

let app, admin, visitor;

const createdIds = { projects: [], groups: [], tasks: [] };

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:pzEGdqUXPsVtFkuPiLtHVcjUirkzIEmG@gondola.proxy.rlwy.net:56119/railway';
  app = require('../server');
  admin = await createAdminSession(app);
  visitor = await createVisitorSession(app);
});

afterAll(async () => {
  for (const id of createdIds.tasks) {
    await prisma.task.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdIds.projects) {
    await prisma.project.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdIds.groups) {
    await prisma.group.delete({ where: { id } }).catch(() => {});
  }
});

async function createTestGroup() {
  const group = await prisma.group.create({ data: { name: 'Proj Test Group ' + Date.now() } });
  createdIds.groups.push(group.id);
  return group;
}

describe('Projects: GET /api/projects — task counts', () => {
  it('returns task counts (todo, in_progress, done) per project', async () => {
    const group = await createTestGroup();
    const project = await prisma.project.create({
      data: { groupId: group.id, name: 'Task Count Project', approved: true }
    });
    createdIds.projects.push(project.id);

    const t1 = await prisma.task.create({ data: { projectId: project.id, name: 'Todo Task', status: 'todo', approved: true, order: 1 } });
    const t2 = await prisma.task.create({ data: { projectId: project.id, name: 'In Progress Task', status: 'in_progress', approved: true, order: 2 } });
    const t3 = await prisma.task.create({ data: { projectId: project.id, name: 'Done Task', status: 'done', approved: true, order: 3 } });
    const t4 = await prisma.task.create({ data: { projectId: project.id, name: 'Another Done Task', status: 'done', approved: true, order: 4 } });
    createdIds.tasks.push(t1.id, t2.id, t3.id, t4.id);

    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);

    const proj = res.body.data.find(p => p.id === project.id);
    expect(proj).toBeDefined();
    expect(proj.taskCounts).toEqual({ todo: 1, in_progress: 1, done: 2 });
  });

  it('excludes unapproved tasks from counts', async () => {
    const group = await createTestGroup();
    const project = await prisma.project.create({
      data: { groupId: group.id, name: 'Unapproved Count Project', approved: true }
    });
    createdIds.projects.push(project.id);

    const t1 = await prisma.task.create({ data: { projectId: project.id, name: 'Approved', status: 'todo', approved: true, order: 1 } });
    const t2 = await prisma.task.create({ data: { projectId: project.id, name: 'Unapproved', status: 'todo', approved: false, order: 2 } });
    createdIds.tasks.push(t1.id, t2.id);

    const res = await request(app).get('/api/projects');
    const proj = res.body.data.find(p => p.id === project.id);
    expect(proj.taskCounts.todo).toBe(1);
  });
});

describe('Projects: GET /api/projects — filtering', () => {
  it('filters by status', async () => {
    const group = await createTestGroup();
    const active = await prisma.project.create({ data: { groupId: group.id, name: 'Active Filter', approved: true, status: 'active' } });
    const completed = await prisma.project.create({ data: { groupId: group.id, name: 'Completed Filter', approved: true, status: 'completed' } });
    createdIds.projects.push(active.id, completed.id);

    const res = await request(app).get('/api/projects?status=completed');
    expect(res.status).toBe(200);
    const ids = res.body.data.map(p => p.id);
    expect(ids).toContain(completed.id);
    expect(ids).not.toContain(active.id);
  });

  it('rejects invalid status filter', async () => {
    const res = await request(app).get('/api/projects?status=invalid');
    expect(res.status).toBe(400);
  });

  it('filters soft-deleted projects', async () => {
    const group = await createTestGroup();
    const deleted = await prisma.project.create({
      data: { groupId: group.id, name: 'Deleted Filter', approved: true, deletedAt: new Date() }
    });
    createdIds.projects.push(deleted.id);

    const res = await request(app).get('/api/projects');
    const ids = res.body.data.map(p => p.id);
    expect(ids).not.toContain(deleted.id);
  });
});

describe('Projects: GET /api/projects/:id', () => {
  it('returns project with tasks', async () => {
    const group = await createTestGroup();
    const project = await prisma.project.create({ data: { groupId: group.id, name: 'Detail Project', approved: true } });
    createdIds.projects.push(project.id);

    const task = await prisma.task.create({ data: { projectId: project.id, name: 'Detail Task', status: 'todo', approved: true, order: 1 } });
    createdIds.tasks.push(task.id);

    const res = await request(app).get(`/api/projects/${project.id}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Detail Project');
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].name).toBe('Detail Task');
  });

  it('returns 404 for soft-deleted project', async () => {
    const group = await createTestGroup();
    const project = await prisma.project.create({
      data: { groupId: group.id, name: 'Deleted Detail', deletedAt: new Date() }
    });
    createdIds.projects.push(project.id);

    const res = await request(app).get(`/api/projects/${project.id}`);
    expect(res.status).toBe(404);
  });
});

describe('Projects: POST /api/projects — admin create', () => {
  it('admin creates approved project', async () => {
    const group = await createTestGroup();
    const res = await admin.post('/api/projects').send({
      groupId: group.id, name: 'Admin Created Project',
      tier: 'mvp', joinType: 'open'
    });
    expect(res.status).toBe(201);
    expect(res.body.approved).toBe(true);
    expect(res.body.tier).toBe('mvp');
    createdIds.projects.push(res.body.id);
  });

  it('rejects project with non-existent group', async () => {
    const res = await admin.post('/api/projects').send({
      groupId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Orphan Project'
    });
    expect(res.status).toBe(404);
  });
});

describe('Projects: POST /api/projects — visitor suggestion', () => {
  it('visitor suggestion is not auto-approved', async () => {
    const group = await createTestGroup();
    const res = await visitor.post('/api/projects').send({
      groupId: group.id, name: 'Visitor Suggested Project',
      authorName: 'VisitorProjectTest'
    });
    expect(res.status).toBe(201);
    expect(res.body.approved).toBe(false);
    expect(res.body.suggestedBy).toBe('VisitorProjectTest');
    createdIds.projects.push(res.body.id);
  });
});

describe('Projects: PATCH /api/projects/:id/approve', () => {
  it('admin can approve a suggested project', async () => {
    const group = await createTestGroup();
    const project = await prisma.project.create({
      data: { groupId: group.id, name: 'Pending Approval', approved: false, suggestedBy: 'Visitor' }
    });
    createdIds.projects.push(project.id);

    const res = await admin.patch(`/api/projects/${project.id}/approve`).send({});
    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(true);
  });
});

describe('Projects: DELETE /api/projects/:id — soft delete', () => {
  it('soft-deletes a project (sets deletedAt)', async () => {
    const group = await createTestGroup();
    const project = await prisma.project.create({
      data: { groupId: group.id, name: 'To Soft Delete', approved: true }
    });
    createdIds.projects.push(project.id);

    const res = await admin.del(`/api/projects/${project.id}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify filtered from list
    const listRes = await request(app).get('/api/projects');
    const ids = listRes.body.data.map(p => p.id);
    expect(ids).not.toContain(project.id);

    // Still exists in DB with deletedAt set
    const dbProject = await prisma.project.findUnique({ where: { id: project.id } });
    expect(dbProject).not.toBeNull();
    expect(dbProject.deletedAt).not.toBeNull();
  });
});
