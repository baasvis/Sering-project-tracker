const { Router } = require('express');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');
const { sanitize } = require('../lib/sanitize');
const asyncHandler = require('../lib/async-handler');
const { validateId, isValidUuid } = require('../lib/validate');

const router = Router();

const VALID_PROJECT_STATUSES = ['active', 'completed', 'archived'];
const VALID_JOIN_TYPES = ['open', 'contact', 'closed'];
const VALID_TIERS = ['mvp', 'medium', 'next_level'];

// Strip HTML tags from user input
function stripTags(str) {
  return String(str).replace(/<[^>]*>/g, '');
}

// List projects (optional ?groupId= filter, ?status= filter)
router.get('/', asyncHandler(async (req, res) => {
  const where = {};
  if (req.query.groupId) where.groupId = req.query.groupId;
  if (req.query.status) where.status = req.query.status;

  const projects = await prisma.project.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      group: { select: { id: true, name: true } },
      _count: { select: { tasks: true } },
      tasks: { where: { approved: true }, select: { status: true } }
    }
  });

  // Transform: replace tasks array with status counts (approved tasks only)
  const result = projects.map(p => {
    const counts = { todo: 0, in_progress: 0, done: 0 };
    for (const t of p.tasks) {
      if (counts[t.status] !== undefined) counts[t.status]++;
    }
    const { tasks, ...rest } = p;
    return { ...rest, taskCounts: counts };
  });

  res.json(result);
}));

// Get single project with tasks (all tasks including pending)
router.get('/:id', validateId, asyncHandler(async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: {
      group: { select: { id: true, name: true, mattermostChannel: true } },
      tasks: { orderBy: { order: 'asc' } }
    }
  });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
}));

// Create project — admin creates immediately; visitor suggestion goes to pending
router.post('/', asyncHandler(async (req, res) => {
  const { groupId, name, description, contactPerson, tier, joinType, authorName } = req.body;
  if (!groupId || !name) return res.status(400).json({ error: 'groupId and name are required' });
  if (!isValidUuid(groupId)) return res.status(400).json({ error: 'Invalid groupId format' });
  if (joinType && !VALID_JOIN_TYPES.includes(joinType)) return res.status(400).json({ error: 'Invalid joinType' });
  if (tier && !VALID_TIERS.includes(tier)) return res.status(400).json({ error: 'Invalid tier' });

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

  // Validate group exists
  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { id: true } });
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const project = await prisma.project.create({
    data: {
      groupId,
      name,
      description: isAdmin ? sanitize(description) : null,
      contactPerson: isAdmin ? (contactPerson || null) : null,
      tier: isAdmin ? (tier || null) : null,
      joinType: isAdmin ? (joinType || null) : null,
      approved: isAdmin,
      suggestedBy: sanitizedAuthor
    },
    include: { group: { select: { id: true, name: true } } }
  });
  res.status(201).json(project);
}));

// Update project (admin)
router.patch('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  const { name, description, contactPerson, status, groupId, tier, joinType } = req.body;

  if (status !== undefined && !VALID_PROJECT_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_PROJECT_STATUSES.join(', ')}` });
  }
  if (joinType && !VALID_JOIN_TYPES.includes(joinType)) return res.status(400).json({ error: 'Invalid joinType' });
  if (tier && !VALID_TIERS.includes(tier)) return res.status(400).json({ error: 'Invalid tier' });
  if (groupId && !isValidUuid(groupId)) return res.status(400).json({ error: 'Invalid groupId format' });

  const data = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = sanitize(description);
  if (contactPerson !== undefined) data.contactPerson = contactPerson;
  if (tier !== undefined) data.tier = tier || null;
  if (status !== undefined) data.status = status;
  if (groupId !== undefined) data.groupId = groupId;
  if (joinType !== undefined) data.joinType = joinType || null;

  const project = await prisma.project.update({
    where: { id: req.params.id },
    data,
    include: { group: { select: { id: true, name: true } } }
  });
  res.json(project);
}));

// Approve a suggested project (admin)
router.patch('/:id/approve', validateId, requireAdmin, asyncHandler(async (req, res) => {
  try {
    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: { approved: true },
      include: { group: { select: { id: true, name: true } } }
    });
    res.json(project);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Project not found' });
    throw err;
  }
}));

// Delete project (admin) — also used to decline suggestions
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  await prisma.project.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

module.exports = router;
