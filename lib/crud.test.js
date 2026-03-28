const { z } = require('zod');
const { makeCrud } = require('./crud');

// ─── Test doubles ───────────────────────────────────────────────────────────

function createMockModel() {
  return {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  };
}

function createMockDeps(mockModel) {
  return {
    db: { testEntity: mockModel },
    broadcast: vi.fn(),
    getMutationId: vi.fn(() => 'mut-123'),
    logAction: vi.fn(),
  };
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });

function mockReqRes(overrides = {}) {
  const req = {
    query: {},
    params: { id: '550e8400-e29b-41d4-a716-446655440000' },
    body: {},
    headers: { 'x-mutation-id': 'mut-123' },
    session: { email: 'admin@test.com' },
    ...overrides,
  };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    _data: null,
  };
  res.json.mockImplementation((data) => { res._data = data; return res; });
  return { req, res };
}

function buildCrud(mockModel, deps, overrides = {}) {
  return makeCrud({
    model: 'testEntity',
    entityName: 'test',
    createSchema,
    updateSchema,
    softDelete: true,
    _deps: deps,
    ...overrides,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('makeCrud', () => {
  let crud, model, deps;

  beforeEach(() => {
    model = createMockModel();
    deps = createMockDeps(model);
    crud = buildCrud(model, deps);
  });

  describe('list', () => {
    it('returns paginated results with default limit', async () => {
      const items = Array.from({ length: 51 }, (_, i) => ({ id: `id-${i}`, name: `Item ${i}` }));
      model.findMany.mockResolvedValue(items);

      const { req, res } = mockReqRes();
      await crud.list(req, res, vi.fn());

      expect(model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 51, where: { deletedAt: null } })
      );
      expect(res._data.hasMore).toBe(true);
      expect(res._data.data).toHaveLength(50);
      expect(res._data.nextCursor).toBe('id-49');
    });

    it('respects cursor parameter', async () => {
      const { req, res } = mockReqRes({ query: { cursor: 'abc-123' } });
      await crud.list(req, res, vi.fn());

      expect(model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: 'abc-123' }, skip: 1 })
      );
    });

    it('caps limit at max', async () => {
      const { req, res } = mockReqRes({ query: { limit: '500' } });
      await crud.list(req, res, vi.fn());

      expect(model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 201 })
      );
    });

    it('filters soft-deleted records', async () => {
      const { req, res } = mockReqRes();
      await crud.list(req, res, vi.fn());

      expect(model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) })
      );
    });

    it('returns hasMore=false when fewer items than limit', async () => {
      model.findMany.mockResolvedValue([{ id: '1', name: 'A' }]);
      const { req, res } = mockReqRes();
      await crud.list(req, res, vi.fn());

      expect(res._data.hasMore).toBe(false);
      expect(res._data.nextCursor).toBeNull();
    });
  });

  describe('getById', () => {
    it('returns record when found', async () => {
      const record = { id: 'abc', name: 'Test', deletedAt: null };
      model.findUnique.mockResolvedValue(record);

      const { req, res } = mockReqRes();
      await crud.getById(req, res, vi.fn());

      expect(res._data).toEqual(record);
    });

    it('returns 404 when not found', async () => {
      model.findUnique.mockResolvedValue(null);
      const { req, res } = mockReqRes();
      await crud.getById(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res._data.code).toBe('NOT_FOUND');
    });

    it('returns 404 when soft-deleted', async () => {
      model.findUnique.mockResolvedValue({ id: 'abc', deletedAt: new Date() });
      const { req, res } = mockReqRes();
      await crud.getById(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('create', () => {
    it('creates record and broadcasts', async () => {
      const created = { id: 'new-id', name: 'New Thing' };
      model.create.mockResolvedValue(created);

      const { req, res } = mockReqRes({ body: { name: 'New Thing' } });
      await crud.create(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res._data).toEqual(created);
      expect(deps.broadcast).toHaveBeenCalledWith('test:created', { test: created }, 'mut-123');
      expect(deps.logAction).toHaveBeenCalledWith(req, 'test:created', 'test', 'new-id', { name: 'New Thing' });
    });

    it('returns 400 on validation error', async () => {
      const { req, res } = mockReqRes({ body: { name: '' } });
      await crud.create(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._data.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('update', () => {
    it('updates record and broadcasts', async () => {
      const updated = { id: 'abc', name: 'Updated' };
      model.update.mockResolvedValue(updated);

      const { req, res } = mockReqRes({ body: { name: 'Updated' } });
      await crud.update(req, res, vi.fn());

      expect(res._data).toEqual(updated);
      expect(deps.broadcast).toHaveBeenCalledWith('test:updated', { test: updated }, 'mut-123');
    });

    it('returns 404 when record not found', async () => {
      model.update.mockRejectedValue({ code: 'P2025' });
      const { req, res } = mockReqRes({ body: { name: 'Updated' } });
      await crud.update(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 on empty update body', async () => {
      const { req, res } = mockReqRes({ body: {} });
      await crud.update(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('remove (soft delete)', () => {
    it('soft-deletes by setting deletedAt', async () => {
      const { req, res } = mockReqRes();
      await crud.remove(req, res, vi.fn());

      expect(model.update).toHaveBeenCalledWith({
        where: { id: req.params.id },
        data: { deletedAt: expect.any(Date) },
      });
      expect(res._data).toEqual({ ok: true });
      expect(deps.broadcast).toHaveBeenCalled();
      expect(deps.logAction).toHaveBeenCalled();
    });

    it('returns 404 when record not found', async () => {
      model.update.mockRejectedValue({ code: 'P2025' });
      const { req, res } = mockReqRes();
      await crud.remove(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('approve', () => {
    it('sets approved=true and broadcasts', async () => {
      const approved = { id: 'abc', name: 'Thing', approved: true };
      model.update.mockResolvedValue(approved);

      const { req, res } = mockReqRes();
      await crud.approve(req, res, vi.fn());

      expect(model.update).toHaveBeenCalledWith({
        where: { id: req.params.id },
        data: { approved: true },
      });
      expect(res._data).toEqual(approved);
      expect(deps.broadcast).toHaveBeenCalledWith('test:approved', { test: approved }, 'mut-123');
    });
  });
});

describe('makeCrud with hard delete', () => {
  it('calls delete instead of update', async () => {
    const model = createMockModel();
    const deps = createMockDeps(model);
    const crud = buildCrud(model, deps, { softDelete: false });

    const { req, res } = mockReqRes();
    await crud.remove(req, res, vi.fn());

    expect(model.delete).toHaveBeenCalledWith({ where: { id: req.params.id } });
  });
});

describe('makeCrud with mapListItem', () => {
  it('transforms list items', async () => {
    const model = createMockModel();
    const deps = createMockDeps(model);
    model.findMany.mockResolvedValue([{ id: '1', name: 'A', extra: 'data' }]);

    const crud = buildCrud(model, deps, {
      mapListItem: (item) => ({ id: item.id, name: item.name }),
    });

    const { req, res } = mockReqRes();
    await crud.list(req, res, vi.fn());

    expect(res._data.data[0]).toEqual({ id: '1', name: 'A' });
    expect(res._data.data[0].extra).toBeUndefined();
  });
});

describe('makeCrud with beforeCreate hook', () => {
  it('transforms data before insert', async () => {
    const model = createMockModel();
    const deps = createMockDeps(model);
    model.create.mockResolvedValue({ id: 'new', name: 'LOWER' });

    const crud = buildCrud(model, deps, {
      beforeCreate: async (data) => ({ ...data, name: data.name.toUpperCase() }),
    });

    const { req, res } = mockReqRes({ body: { name: 'lower' } });
    await crud.create(req, res, vi.fn());

    expect(model.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'LOWER' }),
    });
  });
});
