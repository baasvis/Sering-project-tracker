const { Router } = require('express');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');
const { sanitize } = require('../lib/sanitize');
const asyncHandler = require('../lib/async-handler');
const { validateId, isValidUuid } = require('../lib/validate');

const router = Router();

const VALID_TASK_STATUSES = ['todo', 'in_progress', 'done'];

// Strip HTML tags from user input
function stripTags(str) {
  return String(str).replace(/<[^>]*>/g, '');
}

// List tasks for a project
router.get('/', asyncHandler(async (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId query param required' });

  const tasks = await prisma.task.findMany({
    where: { projectId },
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

  // Non-admins must provide a name
  if (!isAdmin && !authorName) {
    return res.status(400).json({ error: 'authorName is required for suggestions' });
  }

  let sanitizedAuthor = null;
  if (!isAdmin && authorName) {
    sanitizedAuthor = stripTags(String(authorName).trim());
    if (sanitizedAuthor.length < 1 || sanitizedAuthor.length > 50) {
      return res.status(400).json({ error: 'Author name must be 1-50 characters' });
    }
  }

  // Validate project exists
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const maxOrder = await prisma.task.aggregate({
    where: { projectId },
    _max: { order: true }
  });

  const task = await prisma.task.create({
    data: {
      projectId,
      name,
      description: isAdmin ? sanitize(description) : null,
      assignee: isAdmin ? (assignee || null) : null,
      deadline: (isAdmin && deadline) ? new Date(deadline) : null,
      order: (maxOrder._max.order || 0) + 1,
      approved: isAdmin,
      suggestedBy: sanitizedAuthor
    }
  });
  res.status(201).json(task);
}));

// Update task (admin)
router.patch('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  const { name, description, status, assignee, deadline, order } = req.body;

  if (status !== undefined && !VALID_TASK_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_TASK_STATUSES.join(', ')}` });
  }

  const data = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = sanitize(description);
  if (status !== undefined) data.status = status;
  if (assignee !== undefined) data.assignee = assignee;
  if (deadline !== undefined) data.deadline = deadline ? new Date(deadline) : null;
  if (order !== undefined) data.order = order;

  const task = await prisma.task.update({ where: { id: req.params.id }, data });
  res.json(task);
}));

// Approve a suggested task (admin)
router.patch('/:id/approve', validateId, requireAdmin, asyncHandler(async (req, res) => {
  try {
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: { approved: true }
    });
    res.json(task);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Task not found' });
    throw err;
  }
}));

// Delete task (admin) — also used to decline suggestions
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  await prisma.task.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

module.exports = router;
