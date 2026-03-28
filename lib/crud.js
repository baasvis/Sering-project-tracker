const prisma = require('./db');
const asyncHandler = require('./async-handler');
const { broadcast, getMutationId } = require('./sse');
const { logAction } = require('./audit');
const { sendError, handleZodError } = require('./errors');
const { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } = require('./config');

/**
 * CRUD factory — generates standard Express handlers for a Prisma model.
 *
 * Options:
 *   model        - Prisma model name (string), e.g. 'group'
 *   entityName   - Name used in SSE events and errors, e.g. 'group'
 *   createSchema - Zod schema for POST body validation
 *   updateSchema - Zod schema for PATCH body validation
 *   softDelete   - boolean, if true uses deletedAt instead of hard delete (default: false)
 *   include      - Prisma include clause for list/get queries
 *   orderBy      - Prisma orderBy clause for list queries (default: { createdAt: 'desc' })
 *   defaultWhere - Extra where conditions applied to all list queries
 *   beforeCreate - async (data, req) => data — transform create data before insert
 *   beforeUpdate - async (data, req) => data — transform update data before update
 *   afterCreate  - async (record, req) => void — runs after create (e.g. custom broadcast)
 *   afterUpdate  - async (record, req) => void — runs after update
 *   afterDelete  - async (id, req) => void — runs after delete
 *   mapListItem  - (item) => item — transform each list item before sending
 */
function makeCrud(opts) {
  const {
    model,
    entityName,
    createSchema,
    updateSchema,
    softDelete = false,
    include,
    orderBy = { createdAt: 'desc' },
    defaultWhere = {},
    beforeCreate,
    beforeUpdate,
    afterCreate,
    afterUpdate,
    afterDelete,
    mapListItem,
    _deps, // test-only: override dependencies
  } = opts;

  const _db = _deps?.db || prisma;
  const _broadcast = _deps?.broadcast || broadcast;
  const _getMutationId = _deps?.getMutationId || getMutationId;
  const _logAction = _deps?.logAction || logAction;

  const prismaModel = _db[model];

  // ─── LIST with cursor-based pagination ──────────────────────────────────

  const list = asyncHandler(async (req, res) => {
    const limit = Math.min(
      parseInt(req.query.limit, 10) || PAGINATION_DEFAULT_LIMIT,
      PAGINATION_MAX_LIMIT
    );
    const cursor = req.query.cursor;

    const where = { ...defaultWhere };
    if (softDelete) where.deletedAt = null;

    // Allow opts to add custom where filters from query params
    if (opts.buildWhere) {
      const custom = opts.buildWhere(req);
      if (custom === null) return; // buildWhere sent a response (e.g. 400)
      Object.assign(where, custom);
    }

    const findArgs = {
      where,
      orderBy,
      take: limit + 1, // fetch one extra to determine hasMore
    };
    if (include) findArgs.include = include;
    if (cursor) {
      findArgs.cursor = { id: cursor };
      findArgs.skip = 1; // skip the cursor item itself
    }

    const items = await prismaModel.findMany(findArgs);

    const hasMore = items.length > limit;
    if (hasMore) items.pop();

    const result = mapListItem ? items.map(mapListItem) : items;
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;

    res.json({ data: result, nextCursor, hasMore });
  });

  // ─── GET by ID ──────────────────────────────────────────────────────────

  const getById = asyncHandler(async (req, res) => {
    const findArgs = { where: { id: req.params.id } };
    if (include) findArgs.include = include;

    const record = await prismaModel.findUnique(findArgs);
    if (!record || (softDelete && record.deletedAt)) {
      return sendError(res, 'NOT_FOUND', `${entityName} not found`);
    }
    res.json(record);
  });

  // ─── CREATE ─────────────────────────────────────────────────────────────

  const create = asyncHandler(async (req, res) => {
    let data;
    try {
      data = createSchema.parse(req.body);
    } catch (err) {
      if (handleZodError(err, res)) return;
      throw err;
    }

    if (beforeCreate) {
      data = await beforeCreate(data, req);
      if (!data) return; // beforeCreate sent a response
    }

    const createArgs = { data };
    if (include) createArgs.include = include;

    const record = await prismaModel.create(createArgs);
    res.status(201).json(record);

    _logAction(req, `${entityName}:created`, entityName, record.id, { name: record.name || record.title });
    _broadcast(`${entityName}:created`, { [entityName]: record }, _getMutationId(req));

    if (afterCreate) await afterCreate(record, req);
  });

  // ─── UPDATE ─────────────────────────────────────────────────────────────

  const update = asyncHandler(async (req, res) => {
    let data;
    try {
      data = updateSchema.parse(req.body);
    } catch (err) {
      if (handleZodError(err, res)) return;
      throw err;
    }

    if (beforeUpdate) {
      data = await beforeUpdate(data, req);
      if (!data) return;
    }

    const updateArgs = {
      where: { id: req.params.id },
      data,
    };
    if (include) updateArgs.include = include;

    try {
      const record = await prismaModel.update(updateArgs);
      res.json(record);
      _broadcast(`${entityName}:updated`, { [entityName]: record }, _getMutationId(req));
      if (afterUpdate) await afterUpdate(record, req);
    } catch (err) {
      if (err.code === 'P2025') return sendError(res, 'NOT_FOUND', `${entityName} not found`);
      throw err;
    }
  });

  // ─── SOFT DELETE or HARD DELETE ─────────────────────────────────────────

  const remove = asyncHandler(async (req, res) => {
    try {
      if (softDelete) {
        await prismaModel.update({
          where: { id: req.params.id },
          data: { deletedAt: new Date() },
        });
      } else {
        await prismaModel.delete({ where: { id: req.params.id } });
      }
    } catch (err) {
      if (err.code === 'P2025') return sendError(res, 'NOT_FOUND', `${entityName} not found`);
      throw err;
    }

    res.json({ ok: true });
    _logAction(req, `${entityName}:deleted`, entityName, req.params.id);
    _broadcast(`${entityName}:deleted`, { [`${entityName}Id`]: req.params.id }, _getMutationId(req));

    if (afterDelete) await afterDelete(req.params.id, req);
  });

  // ─── APPROVE (for suggestion workflows) ─────────────────────────────────

  const approve = asyncHandler(async (req, res) => {
    const updateArgs = {
      where: { id: req.params.id },
      data: { approved: true },
    };
    if (include) updateArgs.include = include;

    try {
      const record = await prismaModel.update(updateArgs);
      res.json(record);
      _logAction(req, `${entityName}:approved`, entityName, record.id, { name: record.name || record.title });
      _broadcast(`${entityName}:approved`, { [entityName]: record }, _getMutationId(req));
    } catch (err) {
      if (err.code === 'P2025') return sendError(res, 'NOT_FOUND', `${entityName} not found`);
      throw err;
    }
  });

  return { list, getById, create, update, remove, approve };
}

module.exports = { makeCrud };
