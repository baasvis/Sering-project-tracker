const { Router } = require('express');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');
const { sanitize } = require('../lib/sanitize');
const asyncHandler = require('../lib/async-handler');
const { validateId, isValidUuid, stripTags, sanitizeName, VALID_TASK_STATUSES } = require('../lib/validate');
const { broadcast, getMutationId } = require('../lib/sse');
const { logAction } = require('../lib/audit');

const router = Router();

// List tasks for a project
router.get('/', asyncHandler(async (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId query param required' });
  if (!isValidUuid(projectId)) return res.status(400).json({ error: 'Invalid projectId format' });

  const tasks = await prisma.task.findMany({
    where: { projectId, deletedAt: null },
    orderBy: { order: 'asc' }
  });
  res.json(tasks);
}));

// Get single task
router.get('/:id', validateId, asyncHandler(async (req, res) => {
  const task = await prisma.task.findUnique({
    where: { id: req.params.id },
    include: { project: { select: { id: true, name: true, groupId: true } } }
  });
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
}));

// Create task — admin creates immediately; visitor suggestion goes to pending
router.post('/', asyncHandler(async (req, res) => {
  const { projectId, name, description, assignee, deadline, authorName } = req.body;
  if (!projectId || !name) return res.status(400).json({ error: 'projectId and name are required' });
  if (!isValidUuid(projectId)) return res.status(400).json({ error: 'Invalid projectId format' });

  const isAdmin = !!req.session?.admin;

  let suggestedBy = null;
  if (!isAdmin) {
    suggestedBy = sanitizeName(authorName);
    if (!suggestedBy) return res.status(400).json({ error: 'authorName is required for suggestions (1-50 chars)' });
  }

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const trimmedName = stripTags(String(name)).slice(0, 200);
  if (trimmedName.length < 1) return res.status(400).json({ error: 'Task name must be 1-200 characters' });

  const maxOrder = await prisma.task.aggregate({ where: { projectId }, _max: { order: true } });

  const task = await prisma.task.create({
    data: {
      projectId,
      name: trimmedName,
      description: isAdmin ? sanitize(description) : null,
      assignee: isAdmin ? (assignee || null) : null,
      deadline: (isAdmin && deadline) ? new Date(deadline) : null,
      order: (maxOrder._max.order || 0) + 1,
      approved: isAdmin,
      suggestedBy
    }
  });
  res.status(201).json(task);
  broadcast('task:created', { task, projectId: task.projectId }, getMutationId(req));
}));

// Update task (admin)
router.patch('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  const { name, description, status, assignee, deadline, order } = req.body;

  if (status !== undefined && !VALID_TASK_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_TASK_STATUSES.join(', ')}` });
  }

  const data = {};
  if (name !== undefined) {
    const trimmed = stripTags(String(name)).slice(0, 200);
    if (trimmed.length < 1) return res.status(400).json({ error: 'Task name must be 1-200 characters' });
    data.name = trimmed;
  }
  if (description !== undefined) data.description = sanitize(description);
  if (status !== undefined) data.status = status;
  if (assignee !== undefined) data.assignee = assignee ? stripTags(String(assignee)).slice(0, 100) : null;
  if (deadline !== undefined) data.deadline = deadline ? new Date(deadline) : null;
  if (order !== undefined) data.order = order;

  const task = await prisma.task.update({ where: { id: req.params.id }, data });
  res.json(task);
  broadcast('task:updated', { task, projectId: task.projectId }, getMutationId(req));
}));

// Approve a suggested task (admin)
router.patch('/:id/approve', validateId, requireAdmin, asyncHandler(async (req, res) => {
  try {
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: { approved: true }
    });
    res.json(task);
    logAction(req, 'task:approved', 'task', task.id, { name: task.name });
    broadcast('task:approved', { task, projectId: task.projectId }, getMutationId(req));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Task not found' });
    throw err;
  }
}));

// Soft-delete task (admin) — also used to decline suggestions
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  const existing = await prisma.task.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
  await prisma.task.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
  res.json({ ok: true });
  logAction(req, 'task:deleted', 'task', req.params.id);
  if (existing) broadcast('task:deleted', { taskId: req.params.id, projectId: existing.projectId }, getMutationId(req));
}));

module.exports = router;
