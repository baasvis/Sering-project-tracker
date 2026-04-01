import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/db.js';
import type { TransactionClient } from '../lib/db.js';
import { requireAdmin } from './auth.js';
import { sanitize } from '../lib/sanitize.js';
import asyncHandler from '../lib/async-handler.js';
import { validateId, isValidUuid } from '../lib/validate.js';
import { broadcast, getMutationId } from '../lib/sse.js';
import { logAction } from '../lib/audit.js';
import { sendError, handleZodError, isPrismaNotFound } from '../lib/errors.js';
import { taskCreate, taskUpdate } from '../lib/schemas.js';
import type { TaskCreate } from '../lib/schemas.js';
import { z } from 'zod';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } from '../lib/config.js';

const router = Router();

// List tasks for a project (paginated)
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) return sendError(res, 'VALIDATION_ERROR', 'projectId query param required');
  if (!isValidUuid(projectId)) return sendError(res, 'VALIDATION_ERROR', 'Invalid projectId format');

  const limit = Math.min(
    parseInt(req.query.limit as string, 10) || PAGINATION_DEFAULT_LIMIT,
    PAGINATION_MAX_LIMIT,
  );
  const cursor = req.query.cursor as string | undefined;

  const tasks = await prisma.task.findMany({
    where: { projectId, deletedAt: null },
    orderBy: { order: 'asc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = tasks.length > limit;
  if (hasMore) tasks.pop();

  const nextCursor = hasMore && tasks.length > 0 ? tasks[tasks.length - 1].id : null;
  res.json({ data: tasks, nextCursor, hasMore });
}));

// Get single task
router.get('/:id', validateId, asyncHandler(async (req: Request, res: Response) => {
  const task = await prisma.task.findUnique({
    where: { id: req.params.id },
    include: { project: { select: { id: true, name: true, groupId: true } } },
  });
  if (!task || task.deletedAt) return sendError(res, 'NOT_FOUND', 'Task not found');
  res.json(task);
}));

// Create task — admin creates immediately; visitor suggestion goes to pending
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  let data: TaskCreate;
  try {
    data = taskCreate.parse(req.body);
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

  // Atomic order assignment inside a transaction to prevent duplicates
  const task = await prisma.$transaction(async (tx: TransactionClient) => {
    const maxOrder = await tx.task.aggregate({ where: { projectId: data.projectId }, _max: { order: true } });
    return tx.task.create({
      data: {
        projectId: data.projectId,
        name: data.name,
        description: isAdmin && data.description ? sanitize(data.description) : null,
        assignee: isAdmin ? (data.assignee || null) : null,
        deadline: isAdmin ? (data.deadline || null) : null,
        order: (maxOrder._max.order || 0) + 1,
        approved: isAdmin,
        suggestedBy,
      },
    });
  });
  res.status(201).json(task);
  logAction(req, 'task:created', 'task', task.id, { name: task.name });
  broadcast('task:created', { task, projectId: task.projectId }, getMutationId(req));
}));

// Update task (admin)
router.patch('/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  let data: z.infer<typeof taskUpdate>;
  try {
    data = taskUpdate.parse(req.body);
  } catch (err: unknown) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  // Sanitize rich text description
  if (data.description !== undefined) data.description = sanitize(data.description);
  // Allow clearing optional fields
  if (data.assignee !== undefined && !data.assignee) data.assignee = null;
  if (data.deadline !== undefined && !data.deadline) data.deadline = null;

  try {
    const task = await prisma.task.update({ where: { id: req.params.id, deletedAt: null }, data });
    res.json(task);
    logAction(req, 'task:updated', 'task', task.id, { name: task.name });
    broadcast('task:updated', { task, projectId: task.projectId }, getMutationId(req));
  } catch (err: unknown) {
    if (isPrismaNotFound(err)) return sendError(res, 'NOT_FOUND', 'Task not found');
    throw err;
  }
}));

// Approve a suggested task (admin)
router.patch('/:id/approve', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  try {
    const task = await prisma.task.update({
      where: { id: req.params.id, deletedAt: null },
      data: { approved: true },
    });
    res.json(task);
    logAction(req, 'task:approved', 'task', task.id, { name: task.name });
    broadcast('task:approved', { task, projectId: task.projectId }, getMutationId(req));
  } catch (err: unknown) {
    if (isPrismaNotFound(err)) return sendError(res, 'NOT_FOUND', 'Task not found');
    throw err;
  }
}));

// Soft-delete task (admin) — also used to decline suggestions
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.task.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
  if (!existing) return sendError(res, 'NOT_FOUND', 'Task not found');

  const id = req.params.id as string;
  await prisma.task.update({ where: { id }, data: { deletedAt: new Date() } });
  res.json({ ok: true });
  logAction(req, 'task:deleted', 'task', id);
  broadcast('task:deleted', { taskId: id, projectId: existing.projectId }, getMutationId(req));
}));

export default router;
