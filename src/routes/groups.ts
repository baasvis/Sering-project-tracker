import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/db.js';
import type { TransactionClient } from '../lib/db.js';
import { requireAdmin } from './auth.js';
import { sanitize } from '../lib/sanitize.js';
import asyncHandler from '../lib/async-handler.js';
import { validateId } from '../lib/validate.js';
import { broadcast, getMutationId } from '../lib/sse.js';
import { logAction } from '../lib/audit.js';
import { sendError, handleZodError, isPrismaNotFound } from '../lib/errors.js';
import { groupCreate, groupUpdate } from '../lib/schemas.js';
import type { GroupCreate, GroupUpdate } from '../lib/schemas.js';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } from '../lib/config.js';

const router = Router();

interface TaskCountMap { [projectId: string]: Record<string, number> }

async function batchTaskCounts(projectIds: string[]): Promise<TaskCountMap> {
  const result: TaskCountMap = {};
  if (projectIds.length === 0) return result;
  const statusCounts = await prisma.task.groupBy({
    by: ['projectId', 'status'],
    where: { projectId: { in: projectIds }, approved: true, deletedAt: null },
    _count: true,
  });
  for (const row of statusCounts) {
    if (!result[row.projectId]) result[row.projectId] = { todo: 0, in_progress: 0, done: 0 };
    result[row.projectId]![row.status] = row._count;
  }
  return result;
}

// List all groups with project counts and task status counts (paginated)
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(
    parseInt(req.query.limit as string, 10) || PAGINATION_DEFAULT_LIMIT,
    PAGINATION_MAX_LIMIT,
  );
  const cursor = req.query.cursor as string | undefined;

  const groups = await prisma.group.findMany({
    where: { deletedAt: null },
    orderBy: { order: 'asc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      _count: { select: { projects: true } },
      projects: {
        where: { status: 'active', approved: true, deletedAt: null },
        select: {
          id: true, name: true, status: true, tier: true, joinType: true,
          _count: { select: { tasks: true } },
        },
      },
    },
  });

  const hasMore = groups.length > limit;
  if (hasMore) groups.pop();

  const allProjectIds = groups.flatMap(g => g.projects.map(p => p.id));
  const taskCountsByProject = await batchTaskCounts(allProjectIds);

  const data = groups.map(g => ({
    ...g,
    projects: g.projects.map(p => ({
      ...p,
      taskCounts: taskCountsByProject[p.id] || { todo: 0, in_progress: 0, done: 0 },
    })),
  }));

  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].id : null;
  res.json({ data, nextCursor, hasMore });
}));

// Get single group
router.get('/:id', validateId, asyncHandler(async (req: Request, res: Response) => {
  const group = await prisma.group.findUnique({
    where: { id: req.params.id },
    include: {
      projects: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { tasks: true } },
        },
      },
    },
  });
  if (!group || group.deletedAt) return sendError(res, 'NOT_FOUND', 'Group not found');

  const projectIds = group.projects.map(p => p.id);
  const taskCountsByProject = await batchTaskCounts(projectIds);

  const result = {
    ...group,
    projects: group.projects.map(p => ({
      ...p,
      taskCounts: taskCountsByProject[p.id] || { todo: 0, in_progress: 0, done: 0 },
    })),
  };

  res.json(result);
}));

// Create group (admin)
router.post('/', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  let data: GroupCreate;
  try {
    data = groupCreate.parse(req.body);
  } catch (err: unknown) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  if (data.description) data.description = sanitize(data.description);

  // Atomic order assignment inside a transaction to prevent duplicates
  const group = await prisma.$transaction(async (tx: TransactionClient) => {
    const maxOrder = await tx.group.aggregate({ _max: { order: true } });
    return tx.group.create({
      data: {
        name: data.name,
        description: data.description || null,
        mattermostChannel: data.mattermostChannel || null,
        order: (maxOrder._max.order || 0) + 1,
      },
    });
  });
  res.status(201).json(group);
  logAction(req, 'group:created', 'group', group.id, { name: group.name });
  broadcast('group:created', { group }, getMutationId(req));
}));

// Update group (admin)
router.patch('/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  let data: GroupUpdate;
  try {
    data = groupUpdate.parse(req.body);
  } catch (err: unknown) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  if (data.description !== undefined) data.description = sanitize(data.description);

  try {
    const group = await prisma.group.update({ where: { id: req.params.id, deletedAt: null }, data });
    res.json(group);
    broadcast('group:updated', { group }, getMutationId(req));
  } catch (err: unknown) {
    if (isPrismaNotFound(err)) return sendError(res, 'NOT_FOUND', 'Group not found');
    throw err;
  }
}));

// Soft-delete group (admin, only if no active projects)
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const count = await prisma.project.count({ where: { groupId: req.params.id, deletedAt: null } });
  if (count > 0) return sendError(res, 'VALIDATION_ERROR', 'Cannot delete group with projects');

  const id = req.params.id as string;
  await prisma.group.update({ where: { id }, data: { deletedAt: new Date() } });
  res.json({ ok: true });
  logAction(req, 'group:deleted', 'group', id);
  broadcast('group:deleted', { groupId: id }, getMutationId(req));
}));

export default router;
