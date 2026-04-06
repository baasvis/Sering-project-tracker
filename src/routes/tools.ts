import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/db.js';
import type { TransactionClient } from '../lib/db.js';
import { requireAdmin } from './auth.js';
import asyncHandler from '../lib/async-handler.js';
import { validateId, isValidUuid } from '../lib/validate.js';
import { broadcast, getMutationId } from '../lib/sse.js';
import { logAction } from '../lib/audit.js';
import { sendError, handleZodError, isPrismaNotFound } from '../lib/errors.js';
import { toolItemCreate, toolItemUpdate } from '../lib/schemas.js';
import type { ToolItemCreate, ToolItemUpdate } from '../lib/schemas.js';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } from '../lib/config.js';

const router = Router();

// List tool items for a project (paginated)
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) return sendError(res, 'VALIDATION_ERROR', 'projectId query param required');
  if (!isValidUuid(projectId)) return sendError(res, 'VALIDATION_ERROR', 'Invalid projectId format');

  const limit = Math.min(
    parseInt(req.query.limit as string, 10) || PAGINATION_DEFAULT_LIMIT,
    PAGINATION_MAX_LIMIT,
  );
  const cursor = req.query.cursor as string | undefined;

  const items = await prisma.toolItem.findMany({
    where: { projectId },
    orderBy: { order: 'asc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = items.length > limit;
  if (hasMore) items.pop();

  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;
  res.json({ data: items, nextCursor, hasMore });
}));

// Create tool item (anyone can suggest, admin auto-approved)
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  let data: ToolItemCreate;
  try {
    data = toolItemCreate.parse(req.body);
  } catch (err: unknown) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  const isAdmin = !!req.session?.admin;

  let suggestedBy: string | null = null;
  if (!isAdmin) {
    if (!data.authorName) return sendError(res, 'VALIDATION_ERROR', 'authorName is required for suggestions');
    suggestedBy = data.authorName;
  }

  const project = await prisma.project.findUnique({ where: { id: data.projectId }, select: { id: true } });
  if (!project) return sendError(res, 'NOT_FOUND', 'Project not found');

  const item = await prisma.$transaction(async (tx: TransactionClient) => {
    const maxOrder = await tx.toolItem.aggregate({ where: { projectId: data.projectId }, _max: { order: true } });
    return tx.toolItem.create({
      data: {
        projectId: data.projectId,
        name: data.name,
        quantity: data.quantity,
        link: data.link || null,
        notes: data.notes || null,
        category: data.category || null,
        importance: data.importance || null,
        assignedTo: data.assignedTo || null,
        approved: isAdmin,
        suggestedBy,
        order: (maxOrder._max.order || 0) + 1,
      },
    });
  });
  res.status(201).json(item);
  logAction(req, 'tool:created', 'toolItem', item.id, { name: item.name });
  broadcast('tool:created', { item, projectId: item.projectId }, getMutationId(req));
}));

// Update tool item (admin)
router.patch('/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  let data: ToolItemUpdate;
  try {
    data = toolItemUpdate.parse(req.body);
  } catch (err: unknown) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  try {
    const item = await prisma.toolItem.update({ where: { id: req.params.id }, data });
    res.json(item);
    logAction(req, 'tool:updated', 'toolItem', item.id, { name: item.name });
    broadcast('tool:updated', { item, projectId: item.projectId }, getMutationId(req));
  } catch (err: unknown) {
    if (isPrismaNotFound(err)) return sendError(res, 'NOT_FOUND', 'Tool item not found');
    throw err;
  }
}));

// Toggle availability (anyone — for get-together prep section)
router.patch('/:id/available', validateId, asyncHandler(async (req: Request, res: Response) => {
  const { available } = req.body;
  if (typeof available !== 'boolean') {
    return sendError(res, 'VALIDATION_ERROR', 'available must be a boolean');
  }

  try {
    const item = await prisma.toolItem.update({
      where: { id: req.params.id },
      data: { available },
    });
    res.json(item);
    broadcast('tool:updated', { item, projectId: item.projectId }, getMutationId(req));
    broadcast('get-together:tool-toggled', { toolItemId: item.id, available: item.available }, getMutationId(req));
  } catch (err: unknown) {
    if (isPrismaNotFound(err)) return sendError(res, 'NOT_FOUND', 'Tool item not found');
    throw err;
  }
}));

// Approve suggestion (admin)
router.patch('/:id/approve', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  try {
    const item = await prisma.toolItem.update({
      where: { id: req.params.id },
      data: { approved: true },
    });
    res.json(item);
    logAction(req, 'tool:approved', 'toolItem', item.id, { name: item.name });
    broadcast('tool:approved', { item, projectId: item.projectId }, getMutationId(req));
  } catch (err: unknown) {
    if (isPrismaNotFound(err)) return sendError(res, 'NOT_FOUND', 'Tool item not found');
    throw err;
  }
}));

// Delete tool item (admin)
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.toolItem.findUnique({ where: { id: req.params.id }, select: { projectId: true, name: true } });
  if (!existing) return sendError(res, 'NOT_FOUND', 'Tool item not found');

  await prisma.toolItem.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
  logAction(req, 'tool:deleted', 'toolItem', req.params.id, { name: existing.name });
  broadcast('tool:deleted', { itemId: req.params.id, projectId: existing.projectId }, getMutationId(req));
}));

export default router;
