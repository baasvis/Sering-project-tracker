const { Router } = require('express');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');
const { sanitize } = require('../lib/sanitize');
const asyncHandler = require('../lib/async-handler');
const { validateId, isValidUrl } = require('../lib/validate');
const { broadcast, getMutationId } = require('../lib/sse');
const { logAction } = require('../lib/audit');
const { sendError, handleZodError } = require('../lib/errors');
const { groupCreate, groupUpdate } = require('../lib/schemas');
const { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } = require('../lib/config');

const router = Router();

// List all groups with project counts and task status counts (paginated)
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(
    parseInt(req.query.limit, 10) || PAGINATION_DEFAULT_LIMIT,
    PAGINATION_MAX_LIMIT
  );
  const cursor = req.query.cursor;

  const findArgs = {
    where: { deletedAt: null },
    orderBy: { order: 'asc' },
    take: limit + 1,
    include: {
      _count: { select: { projects: true } },
      projects: {
        where: { status: 'active', approved: true, deletedAt: null },
        select: {
          id: true, name: true, status: true, tier: true, joinType: true,
          _count: { select: { tasks: true } },
        }
      }
    }
  };
  if (cursor) {
    findArgs.cursor = { id: cursor };
    findArgs.skip = 1;
  }

  const groups = await prisma.group.findMany(findArgs);

  const hasMore = groups.length > limit;
  if (hasMore) groups.pop();

  // Batch-fetch task status counts for all projects in one query
  const allProjectIds = groups.flatMap(g => g.projects.map(p => p.id));
  const taskCountsByProject = {};
  if (allProjectIds.length > 0) {
    const statusCounts = await prisma.task.groupBy({
      by: ['projectId', 'status'],
      where: { projectId: { in: allProjectIds }, approved: true, deletedAt: null },
      _count: true,
    });
    for (const row of statusCounts) {
      if (!taskCountsByProject[row.projectId]) taskCountsByProject[row.projectId] = { todo: 0, in_progress: 0, done: 0 };
      taskCountsByProject[row.projectId][row.status] = row._count;
    }
  }

  const data = groups.map(g => ({
    ...g,
    projects: g.projects.map(p => ({
      ...p,
      taskCounts: taskCountsByProject[p.id] || { todo: 0, in_progress: 0, done: 0 },
    }))
  }));

  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].id : null;
  res.json({ data, nextCursor, hasMore });
}));

// Get single group
router.get('/:id', validateId, asyncHandler(async (req, res) => {
  const group = await prisma.group.findUnique({
    where: { id: req.params.id },
    include: {
      projects: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { tasks: true } },
        }
      }
    }
  });
  if (!group || group.deletedAt) return sendError(res, 'NOT_FOUND', 'Group not found');

  // Batch-fetch task status counts
  const projectIds = group.projects.map(p => p.id);
  const taskCountsByProject = {};
  if (projectIds.length > 0) {
    const statusCounts = await prisma.task.groupBy({
      by: ['projectId', 'status'],
      where: { projectId: { in: projectIds }, approved: true, deletedAt: null },
      _count: true,
    });
    for (const row of statusCounts) {
      if (!taskCountsByProject[row.projectId]) taskCountsByProject[row.projectId] = { todo: 0, in_progress: 0, done: 0 };
      taskCountsByProject[row.projectId][row.status] = row._count;
    }
  }

  const result = {
    ...group,
    projects: group.projects.map(p => ({
      ...p,
      taskCounts: taskCountsByProject[p.id] || { todo: 0, in_progress: 0, done: 0 },
    }))
  };

  res.json(result);
}));

// Create group (admin)
router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  let data;
  try {
    data = groupCreate.parse(req.body);
  } catch (err) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  if (data.description) data.description = sanitize(data.description);

  // Atomic order assignment inside a transaction to prevent duplicates
  const group = await prisma.$transaction(async (tx) => {
    const maxOrder = await tx.group.aggregate({ _max: { order: true } });
    return tx.group.create({
      data: {
        name: data.name,
        description: data.description || null,
        mattermostChannel: data.mattermostChannel || null,
        order: (maxOrder._max.order || 0) + 1
      }
    });
  });
  res.status(201).json(group);
  logAction(req, 'group:created', 'group', group.id, { name: group.name });
  broadcast('group:created', { group }, getMutationId(req));
}));

// Update group (admin)
router.patch('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  let data;
  try {
    data = groupUpdate.parse(req.body);
  } catch (err) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  if (data.description !== undefined) data.description = sanitize(data.description);

  try {
    const group = await prisma.group.update({ where: { id: req.params.id, deletedAt: null }, data });
    res.json(group);
    broadcast('group:updated', { group }, getMutationId(req));
  } catch (err) {
    if (err.code === 'P2025') return sendError(res, 'NOT_FOUND', 'Group not found');
    throw err;
  }
}));

// Soft-delete group (admin, only if no active projects)
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  const count = await prisma.project.count({ where: { groupId: req.params.id, deletedAt: null } });
  if (count > 0) return sendError(res, 'VALIDATION_ERROR', 'Cannot delete group with projects');

  await prisma.group.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
  res.json({ ok: true });
  logAction(req, 'group:deleted', 'group', req.params.id);
  broadcast('group:deleted', { groupId: req.params.id }, getMutationId(req));
}));

module.exports = router;
