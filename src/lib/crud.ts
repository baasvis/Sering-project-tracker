import type { Request, Response } from 'express';
import type { ZodType } from 'zod';
import prisma from './db.js';
import asyncHandler from './async-handler.js';
import { broadcast, getMutationId } from './sse.js';
import { logAction } from './audit.js';
import { sendError, handleZodError } from './errors.js';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } from './config.js';

interface CrudDeps {
  db?: Record<string, any>;
  broadcast?: typeof broadcast;
  getMutationId?: typeof getMutationId;
  logAction?: typeof logAction;
}

interface CrudOptions {
  model: string;
  entityName: string;
  createSchema: ZodType;
  updateSchema: ZodType;
  softDelete?: boolean;
  include?: Record<string, unknown>;
  orderBy?: Record<string, string> | Array<Record<string, string>>;
  defaultWhere?: Record<string, unknown>;
  buildWhere?: (req: Request) => Record<string, unknown> | null;
  beforeCreate?: (data: any, req: Request) => Promise<any>;
  beforeUpdate?: (data: any, req: Request) => Promise<any>;
  afterCreate?: (record: any, req: Request) => Promise<void>;
  afterUpdate?: (record: any, req: Request) => Promise<void>;
  afterDelete?: (id: string, req: Request) => Promise<void>;
  mapListItem?: (item: any) => any;
  _deps?: CrudDeps;
}

/**
 * CRUD factory — generates standard Express handlers for a Prisma model.
 */
export function makeCrud(opts: CrudOptions) {
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
    _deps,
  } = opts;

  const _db: any = _deps?.db || prisma;
  const _broadcast = _deps?.broadcast || broadcast;
  const _getMutationId = _deps?.getMutationId || getMutationId;
  const _logAction = _deps?.logAction || logAction;

  const prismaModel = _db[model];

  // ─── LIST with cursor-based pagination ──────────────────────────────────

  const list = asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(
      parseInt(req.query.limit as string, 10) || PAGINATION_DEFAULT_LIMIT,
      PAGINATION_MAX_LIMIT,
    );
    const cursor = req.query.cursor as string | undefined;

    const where: Record<string, unknown> = { ...defaultWhere };
    if (softDelete) where.deletedAt = null;

    // Allow opts to add custom where filters from query params
    if (opts.buildWhere) {
      const custom = opts.buildWhere(req);
      if (custom === null) return; // buildWhere sent a response (e.g. 400)
      Object.assign(where, custom);
    }

    const findArgs: Record<string, unknown> = {
      where,
      orderBy,
      take: limit + 1, // fetch one extra to determine hasMore
    };
    if (include) findArgs.include = include;
    if (cursor) {
      findArgs.cursor = { id: cursor };
      findArgs.skip = 1; // skip the cursor item itself
    }

    const items: any[] = await prismaModel.findMany(findArgs);

    const hasMore = items.length > limit;
    if (hasMore) items.pop();

    const result = mapListItem ? items.map(mapListItem) : items;
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;

    res.json({ data: result, nextCursor, hasMore });
  });

  // ─── GET by ID ──────────────────────────────────────────────────────────

  const getById = asyncHandler(async (req: Request, res: Response) => {
    const findArgs: Record<string, unknown> = { where: { id: req.params.id } };
    if (include) findArgs.include = include;

    const record = await prismaModel.findUnique(findArgs);
    if (!record || (softDelete && record.deletedAt)) {
      return sendError(res, 'NOT_FOUND', `${entityName} not found`);
    }
    res.json(record);
  });

  // ─── CREATE ─────────────────────────────────────────────────────────────

  const create = asyncHandler(async (req: Request, res: Response) => {
    let data: any;
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

    const createArgs: Record<string, unknown> = { data };
    if (include) createArgs.include = include;

    const record = await prismaModel.create(createArgs);
    res.status(201).json(record);

    _logAction(req, `${entityName}:created`, entityName, record.id, { name: record.name || record.title });
    _broadcast(`${entityName}:created`, { [entityName]: record }, _getMutationId(req));

    if (afterCreate) await afterCreate(record, req);
  });

  // ─── UPDATE ─────────────────────────────────────────────────────────────

  const update = asyncHandler(async (req: Request, res: Response) => {
    let data: any;
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

    const updateArgs: Record<string, unknown> = {
      where: { id: req.params.id },
      data,
    };
    if (include) updateArgs.include = include;

    try {
      const record = await prismaModel.update(updateArgs);
      res.json(record);
      _broadcast(`${entityName}:updated`, { [entityName]: record }, _getMutationId(req));
      if (afterUpdate) await afterUpdate(record, req);
    } catch (err: any) {
      if (err.code === 'P2025') return sendError(res, 'NOT_FOUND', `${entityName} not found`);
      throw err;
    }
  });

  // ─── SOFT DELETE or HARD DELETE ─────────────────────────────────────────

  const remove = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    try {
      if (softDelete) {
        await prismaModel.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
      } else {
        await prismaModel.delete({ where: { id } });
      }
    } catch (err: any) {
      if (err.code === 'P2025') return sendError(res, 'NOT_FOUND', `${entityName} not found`);
      throw err;
    }

    res.json({ ok: true });
    _logAction(req, `${entityName}:deleted`, entityName, id);
    _broadcast(`${entityName}:deleted`, { [`${entityName}Id`]: id }, _getMutationId(req));

    if (afterDelete) await afterDelete(id, req);
  });

  // ─── APPROVE (for suggestion workflows) ─────────────────────────────────

  const approve = asyncHandler(async (req: Request, res: Response) => {
    const updateArgs: Record<string, unknown> = {
      where: { id: req.params.id },
      data: { approved: true },
    };
    if (include) updateArgs.include = include;

    try {
      const record = await prismaModel.update(updateArgs);
      res.json(record);
      _logAction(req, `${entityName}:approved`, entityName, record.id, { name: record.name || record.title });
      _broadcast(`${entityName}:approved`, { [entityName]: record }, _getMutationId(req));
    } catch (err: any) {
      if (err.code === 'P2025') return sendError(res, 'NOT_FOUND', `${entityName} not found`);
      throw err;
    }
  });

  return { list, getById, create, update, remove, approve };
}
