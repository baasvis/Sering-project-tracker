const request = require('supertest');
const prisma = require('../lib/db');
const { createAdminSession, createVisitorSession } = require('./_test-helpers');

let app, admin, visitor;

const createdIds = { items: [], projects: [], groups: [] };

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:pzEGdqUXPsVtFkuPiLtHVcjUirkzIEmG@gondola.proxy.rlwy.net:56119/railway';
  app = require('../server');
  admin = await createAdminSession(app);
  visitor = await createVisitorSession(app);
});

afterAll(async () => {
  for (const id of createdIds.items) {
    await prisma.shoppingItem.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdIds.projects) {
    await prisma.project.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdIds.groups) {
    await prisma.group.delete({ where: { id } }).catch(() => {});
  }
});

async function createTestProject() {
  const group = await prisma.group.create({ data: { name: 'Shop Test Group ' + Date.now() } });
  createdIds.groups.push(group.id);
  const project = await prisma.project.create({
    data: { groupId: group.id, name: 'Shop Test Project', approved: true, status: 'active' }
  });
  createdIds.projects.push(project.id);
  return project;
}

describe('Shopping: GET /api/shopping', () => {
  it('rejects missing projectId', async () => {
    const res = await request(app).get('/api/shopping');
    expect(res.status).toBe(400);
  });

  it('rejects invalid projectId format', async () => {
    const res = await request(app).get('/api/shopping?projectId=not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('returns paginated items for a project', async () => {
    const project = await createTestProject();
    const res = await request(app).get(`/api/shopping?projectId=${project.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('hasMore');
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('Shopping: POST /api/shopping — admin auto-approve', () => {
  it('admin-created items are auto-approved', async () => {
    const project = await createTestProject();
    const res = await admin.post('/api/shopping').send({
      projectId: project.id, type: 'product',
      name: 'Test Product', pricePerItem: 9.99, quantity: 2
    });
    expect(res.status).toBe(201);
    expect(res.body.approved).toBe(true);
    expect(res.body.suggestedBy).toBeNull();
    createdIds.items.push(res.body.id);
  });

  it('rejects item for non-existent project', async () => {
    const res = await admin.post('/api/shopping').send({
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      type: 'product', name: 'Orphan Item'
    });
    expect(res.status).toBe(404);
  });
});

describe('Shopping: POST /api/shopping — visitor suggestions', () => {
  it('visitor suggestions are not auto-approved', async () => {
    const project = await createTestProject();
    const res = await visitor.post('/api/shopping').send({
      projectId: project.id, type: 'product',
      name: 'Visitor Suggestion', pricePerItem: 5.50,
      quantity: 1, authorName: 'VisitorTest'
    });
    expect(res.status).toBe(201);
    expect(res.body.approved).toBe(false);
    expect(res.body.suggestedBy).toBe('VisitorTest');
    createdIds.items.push(res.body.id);
  });

  it('visitor suggestion requires authorName', async () => {
    const project = await createTestProject();
    const res = await visitor.post('/api/shopping').send({
      projectId: project.id, type: 'product', name: 'No Author Suggestion'
    });
    expect(res.status).toBe(400);
  });
});

describe('Shopping: PATCH /api/shopping/:id/approve — approval workflow', () => {
  it('admin can approve a pending suggestion', async () => {
    const project = await createTestProject();
    const item = await prisma.shoppingItem.create({
      data: {
        projectId: project.id, type: 'product', name: 'Pending Approval Test',
        approved: false, suggestedBy: 'SomeVisitor', order: 1
      }
    });
    createdIds.items.push(item.id);

    const res = await admin.patch(`/api/shopping/${item.id}/approve`).send({});
    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(true);
  });

  it('returns 404 for non-existent item', async () => {
    const res = await admin.patch('/api/shopping/550e8400-e29b-41d4-a716-446655440000/approve').send({});
    expect(res.status).toBe(404);
  });
});

describe('Shopping: GET /api/shopping/summary', () => {
  it('returns budget summary with totals', async () => {
    const project = await createTestProject();
    const product = await prisma.shoppingItem.create({
      data: {
        projectId: project.id, type: 'product', name: 'Summary Product',
        pricePerItem: 10.00, quantity: 3, approved: true, order: 1
      }
    });
    createdIds.items.push(product.id);
    const cost = await prisma.shoppingItem.create({
      data: {
        projectId: project.id, type: 'cost', name: 'Summary Cost',
        amount: 25.00, approved: true, order: 2
      }
    });
    createdIds.items.push(cost.id);

    const res = await request(app).get('/api/shopping/summary');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');

    const projectSummary = res.body.data.find(p => p.id === project.id);
    expect(projectSummary).toBeDefined();
    expect(projectSummary.productTotal).toBe(30);
    expect(projectSummary.costTotal).toBe(25);
    expect(projectSummary.total).toBe(55);
  });
});

describe('Shopping: DELETE /api/shopping/:id', () => {
  it('admin can delete an item', async () => {
    const project = await createTestProject();
    const item = await prisma.shoppingItem.create({
      data: {
        projectId: project.id, type: 'cost', name: 'To Delete',
        amount: 5, approved: true, order: 1
      }
    });

    const res = await admin.del(`/api/shopping/${item.id}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects non-admin delete', async () => {
    const project = await createTestProject();
    const item = await prisma.shoppingItem.create({
      data: {
        projectId: project.id, type: 'cost', name: 'Non-admin delete test',
        amount: 5, approved: true, order: 1
      }
    });
    createdIds.items.push(item.id);

    const res = await visitor.del(`/api/shopping/${item.id}`);
    expect(res.status).toBe(401);
  });
});
