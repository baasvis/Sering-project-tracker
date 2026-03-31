import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/db.js';
import { requireAdmin } from './auth.js';
import { sanitize } from '../lib/sanitize.js';
import asyncHandler from '../lib/async-handler.js';
import { validateId, isValidUuid } from '../lib/validate.js';
import { broadcast, getMutationId } from '../lib/sse.js';
import { logAction } from '../lib/audit.js';
import { sendError, handleZodError } from '../lib/errors.js';
import { projectCreate, projectUpdate, ProjectStatus } from '../lib/schemas.js';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } from '../lib/config.js';

const router = Router();

// List projects (optional ?groupId= filter, ?status= filter, paginated)
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const where: any = { deletedAt: null };

  if (req.query.groupId) {
    if (!isValidUuid(req.query.groupId as string)) return sendError(res, 'VALIDATION_ERROR', 'Invalid groupId format');
    where.groupId = req.query.groupId;
  }
  if (req.query.status) {
    try { ProjectStatus.parse(req.query.status); } catch {
      return sendError(res, 'VALIDATION_ERROR', 'Invalid status filter');
    }
    where.status = req.query.status;
  }

  const limit = Math.min(
    parseInt(req.query.limit as string, 10) || PAGINATION_DEFAULT_LIMIT,
    PAGINATION_MAX_LIMIT,
  );
  const cursor = req.query.cursor as string | undefined;

  const findArgs: any = {
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    include: {
      group: { select: { id: true, name: true } },
      _count: { select: { tasks: true } },
    },
  };
  if (cursor) {
    findArgs.cursor = { id: cursor };
    findArgs.skip = 1;
  }

  const projects = await prisma.project.findMany(findArgs);

  const hasMore = projects.length > limit;
  if (hasMore) projects.pop();

  // Batch-fetch task status counts in one query
  const projectIds = projects.map((p: any) => p.id);
  const taskCountsByProject: Record<string, Record<string, number>> = {};
  if (projectIds.length > 0) {
    const statusCounts = await prisma.task.groupBy({
      by: ['projectId', 'status'],
      where: { projectId: { in: projectIds }, approved: true, deletedAt: null },
      _count: true,
    });
    for (const row of statusCounts) {
      if (!taskCountsByProject[row.projectId]) taskCountsByProject[row.projectId] = { todo: 0, in_progress: 0, done: 0 };
      taskCountsByProject[row.projectId]![row.status] = row._count;
    }
  }

  const data = projects.map((p: any) => ({
    ...p,
    taskCounts: taskCountsByProject[p.id] || { todo: 0, in_progress: 0, done: 0 },
  }));

  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].id : null;
  res.json({ data, nextCursor, hasMore });
}));

// Get single project with tasks (all tasks including pending)
router.get('/:id', validateId, asyncHandler(async (req: Request, res: Response) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: {
      group: { select: { id: true, name: true, mattermostChannel: true } },
      tasks: { where: { deletedAt: null }, orderBy: { order: 'asc' } },
    },
  });
  if (!project || project.deletedAt) return sendError(res, 'NOT_FOUND', 'Project not found');
  res.json(project);
}));

// Create project — admin creates immediately; visitor suggestion goes to pending
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  let data: any;
  try {
    data = projectCreate.parse(req.body);
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

  const group = await prisma.group.findUnique({ where: { id: data.groupId }, select: { id: true } });
  if (!group) return sendError(res, 'NOT_FOUND', 'Group not found');

  const project = await prisma.project.create({
    data: {
      groupId: data.groupId,
      name: data.name,
      description: isAdmin && data.description ? sanitize(data.description) : null,
      contactPerson: isAdmin ? (data.contactPerson || null) : null,
      tier: isAdmin ? (data.tier || null) : null,
      joinType: isAdmin ? (data.joinType || null) : null,
      approved: isAdmin,
      suggestedBy,
    },
    include: { group: { select: { id: true, name: true } } },
  });
  res.status(201).json(project);
  logAction(req, 'project:created', 'project', project.id, { name: project.name });
  broadcast('project:created', { project }, getMutationId(req));
}));

// Update project (admin)
router.patch('/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  let data: any;
  try {
    data = projectUpdate.parse(req.body);
  } catch (err) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  // Sanitize rich text description
  if (data.description !== undefined) data.description = sanitize(data.description);
  // Allow clearing optional fields by setting to null
  if (data.tier !== undefined && !data.tier) data.tier = null;
  if (data.joinType !== undefined && !data.joinType) data.joinType = null;
  if (data.contactPerson !== undefined && !data.contactPerson) data.contactPerson = null;

  try {
    const project = await prisma.project.update({
      where: { id: req.params.id, deletedAt: null },
      data,
      include: { group: { select: { id: true, name: true } } },
    });
    res.json(project);
    broadcast('project:updated', { project }, getMutationId(req));
  } catch (err: any) {
    if (err.code === 'P2025') return sendError(res, 'NOT_FOUND', 'Project not found');
    throw err;
  }
}));

// Approve a suggested project (admin)
router.patch('/:id/approve', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  try {
    const project = await prisma.project.update({
      where: { id: req.params.id, deletedAt: null },
      data: { approved: true },
      include: { group: { select: { id: true, name: true } } },
    });
    res.json(project);
    logAction(req, 'project:approved', 'project', project.id, { name: project.name });
    broadcast('project:approved', { project }, getMutationId(req));
  } catch (err: any) {
    if (err.code === 'P2025') return sendError(res, 'NOT_FOUND', 'Project not found');
    throw err;
  }
}));

// Soft-delete project (admin) — also used to decline suggestions
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  try {
    await prisma.project.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
  } catch (err: any) {
    if (err.code === 'P2025') return sendError(res, 'NOT_FOUND', 'Project not found');
    throw err;
  }
  const id = req.params.id as string;
  res.json({ ok: true });
  logAction(req, 'project:deleted', 'project', id);
  broadcast('project:deleted', { projectId: id }, getMutationId(req));
}));

export default router;
