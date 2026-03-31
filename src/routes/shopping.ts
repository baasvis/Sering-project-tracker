import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/db.js';
import { requireAdmin } from './auth.js';
import asyncHandler from '../lib/async-handler.js';
import { validateId, isValidUuid } from '../lib/validate.js';
import { broadcast, getMutationId } from '../lib/sse.js';
import { sendError, handleZodError } from '../lib/errors.js';
import { shoppingItemCreate, shoppingItemUpdate } from '../lib/schemas.js';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } from '../lib/config.js';

const router = Router();

// List shopping items for a project (paginated)
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) return sendError(res, 'VALIDATION_ERROR', 'projectId query param required');
  if (!isValidUuid(projectId)) return sendError(res, 'VALIDATION_ERROR', 'Invalid projectId format');

  const limit = Math.min(
    parseInt(req.query.limit as string, 10) || PAGINATION_DEFAULT_LIMIT,
    PAGINATION_MAX_LIMIT,
  );
  const cursor = req.query.cursor as string | undefined;

  const findArgs: any = {
    where: { projectId },
    orderBy: { order: 'asc' },
    take: limit + 1,
  };
  if (cursor) {
    findArgs.cursor = { id: cursor };
    findArgs.skip = 1;
  }

  const items = await prisma.shoppingItem.findMany(findArgs);

  const hasMore = items.length > limit;
  if (hasMore) items.pop();

  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;
  res.json({ data: items, nextCursor, hasMore });
}));

// Budget summary: active projects with approved shopping items (paginated)
router.get('/summary', asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(
    parseInt(req.query.limit as string, 10) || PAGINATION_DEFAULT_LIMIT,
    PAGINATION_MAX_LIMIT,
  );
  const cursor = req.query.cursor as string | undefined;

  const findArgs: any = {
    where: {
      status: 'active',
      shoppingItems: { some: { approved: true } },
    },
    select: {
      id: true, name: true,
      group: { select: { name: true } },
      shoppingItems: {
        select: {
          id: true, type: true, name: true, link: true,
          pricePerItem: true, quantity: true, amount: true,
          purchased: true, suggestedBy: true, approved: true, order: true,
        },
        orderBy: { order: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
    take: limit + 1,
  };
  if (cursor) {
    findArgs.cursor = { id: cursor };
    findArgs.skip = 1;
  }

  const projects = await prisma.project.findMany(findArgs);

  const hasMore = projects.length > limit;
  if (hasMore) projects.pop();

  const summary = projects.map((p: any) => {
    let productTotal = 0, costTotal = 0, itemCount = 0;
    for (const i of p.shoppingItems) {
      if (!i.approved) continue; // pending items excluded from totals and count
      itemCount++;
      // Prisma Decimal values need explicit conversion to Number
      const price = Number(i.pricePerItem) || 0;
      const qty = i.quantity || 1;
      const amt = Number(i.amount) || 0;
      if (i.type === 'product') productTotal += price * qty;
      else if (i.type === 'cost') costTotal += amt;
    }
    return {
      id: p.id, name: p.name,
      groupName: p.group?.name || '',
      itemCount,
      productTotal, costTotal,
      total: productTotal + costTotal,
      items: p.shoppingItems,
    };
  });

  const nextCursor = hasMore && summary.length > 0 ? summary[summary.length - 1].id : null;
  res.json({ data: summary, nextCursor, hasMore });
}));

// Create shopping item (anyone can suggest, admin auto-approved)
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  let data: any;
  try {
    data = shoppingItemCreate.parse(req.body);
  } catch (err) {
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

  // Atomic order assignment inside a transaction to prevent duplicates
  const item = await prisma.$transaction(async (tx: any) => {
    const maxOrder = await tx.shoppingItem.aggregate({ where: { projectId: data.projectId }, _max: { order: true } });
    return tx.shoppingItem.create({
      data: {
        projectId: data.projectId,
        type: data.type,
        name: data.name,
        link: data.link || null,
        pricePerItem: data.pricePerItem ?? null,
        quantity: data.quantity,
        amount: data.amount ?? null,
        approved: isAdmin,
        suggestedBy,
        order: (maxOrder._max.order || 0) + 1,
      },
    });
  });
  res.status(201).json(item);
  broadcast('shopping:created', { item, projectId: item.projectId }, getMutationId(req));
}));

// Update shopping item (admin)
router.patch('/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  let data: any;
  try {
    data = shoppingItemUpdate.parse(req.body);
  } catch (err) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  try {
    const item = await prisma.shoppingItem.update({ where: { id: req.params.id }, data });
    res.json(item);
    broadcast('shopping:updated', { item, projectId: item.projectId }, getMutationId(req));
  } catch (err: any) {
    if (err.code === 'P2025') return sendError(res, 'NOT_FOUND', 'Item not found');
    throw err;
  }
}));

// Approve suggestion (admin)
router.patch('/:id/approve', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  try {
    const item = await prisma.shoppingItem.update({
      where: { id: req.params.id },
      data: { approved: true },
    });
    res.json(item);
    broadcast('shopping:approved', { item, projectId: item.projectId }, getMutationId(req));
  } catch (err: any) {
    if (err.code === 'P2025') return sendError(res, 'NOT_FOUND', 'Item not found');
    throw err;
  }
}));

// Delete shopping item (admin)
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  try {
    const existing = await prisma.shoppingItem.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
    if (!existing) return sendError(res, 'NOT_FOUND', 'Item not found');

    await prisma.shoppingItem.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
    broadcast('shopping:deleted', { itemId: req.params.id, projectId: existing.projectId }, getMutationId(req));
  } catch (err: any) {
    if (err.code === 'P2025') return sendError(res, 'NOT_FOUND', 'Item not found');
    throw err;
  }
}));

export default router;
