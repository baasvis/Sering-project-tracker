const { Router } = require('express');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');
const asyncHandler = require('../lib/async-handler');
const { validateId, isValidUuid } = require('../lib/validate');
const { broadcast, getMutationId } = require('../lib/sse');
const { sendError, handleZodError } = require('../lib/errors');
const { shoppingItemCreate, shoppingItemUpdate } = require('../lib/schemas');
const { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } = require('../lib/config');

const router = Router();

// List shopping items for a project (paginated)
router.get('/', asyncHandler(async (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return sendError(res, 'VALIDATION_ERROR', 'projectId query param required');
  if (!isValidUuid(projectId)) return sendError(res, 'VALIDATION_ERROR', 'Invalid projectId format');

  const limit = Math.min(
    parseInt(req.query.limit, 10) || PAGINATION_DEFAULT_LIMIT,
    PAGINATION_MAX_LIMIT
  );
  const cursor = req.query.cursor;

  const findArgs = {
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

// Budget summary: all projects with shopping totals
router.get('/summary', asyncHandler(async (req, res) => {
  const projects = await prisma.project.findMany({
    where: { status: 'active' },
    include: {
      group: { select: { name: true } },
      shoppingItems: {
        where: { approved: true },
        select: {
          id: true, type: true, name: true, link: true,
          pricePerItem: true, quantity: true, amount: true,
          purchased: true, suggestedBy: true, order: true
        },
        orderBy: { order: 'asc' }
      }
    },
    orderBy: { name: 'asc' }
  });

  const summary = projects
    .map(p => {
      const products = p.shoppingItems.filter(i => i.type === 'product');
      const costs = p.shoppingItems.filter(i => i.type === 'cost');
      const productTotal = products.reduce((sum, i) => sum + (i.pricePerItem || 0) * (i.quantity || 1), 0);
      const costTotal = costs.reduce((sum, i) => sum + (i.amount || 0), 0);
      return {
        id: p.id, name: p.name,
        groupName: p.group?.name || '',
        itemCount: p.shoppingItems.length,
        productTotal, costTotal,
        total: productTotal + costTotal,
        items: p.shoppingItems
      };
    })
    .filter(p => p.itemCount > 0);

  res.json(summary);
}));

// Create shopping item (anyone can suggest, admin auto-approved)
router.post('/', asyncHandler(async (req, res) => {
  let data;
  try {
    data = shoppingItemCreate.parse(req.body);
  } catch (err) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  const isAdmin = !!req.session?.admin;

  let suggestedBy = null;
  if (!isAdmin) {
    if (!data.authorName) return sendError(res, 'VALIDATION_ERROR', 'authorName is required for suggestions');
    suggestedBy = data.authorName;
  }

  const project = await prisma.project.findUnique({ where: { id: data.projectId }, select: { id: true } });
  if (!project) return sendError(res, 'NOT_FOUND', 'Project not found');

  const maxOrder = await prisma.shoppingItem.aggregate({ where: { projectId: data.projectId }, _max: { order: true } });

  const item = await prisma.shoppingItem.create({
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
    }
  });
  res.status(201).json(item);
  broadcast('shopping:created', { item, projectId: item.projectId }, getMutationId(req));
}));

// Update shopping item (admin)
router.patch('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  let data;
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
  } catch (err) {
    if (err.code === 'P2025') return sendError(res, 'NOT_FOUND', 'Item not found');
    throw err;
  }
}));

// Approve suggestion (admin)
router.patch('/:id/approve', validateId, requireAdmin, asyncHandler(async (req, res) => {
  try {
    const item = await prisma.shoppingItem.update({
      where: { id: req.params.id },
      data: { approved: true }
    });
    res.json(item);
    broadcast('shopping:approved', { item, projectId: item.projectId }, getMutationId(req));
  } catch (err) {
    if (err.code === 'P2025') return sendError(res, 'NOT_FOUND', 'Item not found');
    throw err;
  }
}));

// Delete shopping item (admin)
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  try {
    const existing = await prisma.shoppingItem.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
    if (!existing) return sendError(res, 'NOT_FOUND', 'Item not found');

    await prisma.shoppingItem.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
    broadcast('shopping:deleted', { itemId: req.params.id, projectId: existing.projectId }, getMutationId(req));
  } catch (err) {
    if (err.code === 'P2025') return sendError(res, 'NOT_FOUND', 'Item not found');
    throw err;
  }
}));

module.exports = router;
