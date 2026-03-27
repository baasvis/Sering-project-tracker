const { Router } = require('express');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');
const { sanitize } = require('../lib/sanitize');
const asyncHandler = require('../lib/async-handler');
const {
  validateId, isValidUuid, stripTags, sanitizeName,
  VALID_STATUSES, VALID_JOIN_TYPES, VALID_TIERS,
} = require('../lib/validate');
const { broadcast, getMutationId } = require('../lib/sse');
const { logAction } = require('../lib/audit');

const router = Router();

// List projects (optional ?groupId= filter, ?status= filter)
router.get('/', asyncHandler(async (req, res) => {
  const where = { deletedAt: null };
  if (req.query.groupId) {
    if (!isValidUuid(req.query.groupId)) return res.status(400).json({ error: 'Invalid groupId format' });
    where.groupId = req.query.groupId;
  }
  if (req.query.status) {
    if (!VALID_STATUSES.includes(req.query.status)) return res.status(400).json({ error: 'Invalid status filter' });
    where.status = req.query.status;
  }

  const projects = await prisma.project.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      group: { select: { id: true, name: true } },
      _count: { select: { tasks: true } },
      tasks: { where: { approved: true, deletedAt: null }, select: { status: true } }
    }
  });

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
      tasks: { where: { deletedAt: null }, orderBy: { order: 'asc' } }
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

  let suggestedBy = null;
  if (!isAdmin) {
    suggestedBy = sanitizeName(authorName);
    if (!suggestedBy) return res.status(400).json({ error: 'authorName is required for suggestions (1-50 chars)' });
  }

  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { id: true } });
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const trimmedName = stripTags(String(name)).slice(0, 200);
  if (trimmedName.length < 1) return res.status(400).json({ error: 'Project name must be 1-200 characters' });

  const project = await prisma.project.create({
    data: {
      groupId,
      name: trimmedName,
      description: isAdmin ? sanitize(description) : null,
      contactPerson: isAdmin ? (contactPerson ? stripTags(String(contactPerson)).slice(0, 100) : null) : null,
      tier: isAdmin ? (tier || null) : null,
      joinType: isAdmin ? (joinType || null) : null,
      approved: isAdmin,
      suggestedBy
    },
    include: { group: { select: { id: true, name: true } } }
  });
  res.status(201).json(project);
  logAction(req, 'project:created', 'project', project.id, { name: project.name });
  broadcast('project:created', { project }, getMutationId(req));
}));

// Update project (admin)
router.patch('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  const { name, description, contactPerson, status, groupId, tier, joinType } = req.body;

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  if (joinType && !VALID_JOIN_TYPES.includes(joinType)) return res.status(400).json({ error: 'Invalid joinType' });
  if (tier && !VALID_TIERS.includes(tier)) return res.status(400).json({ error: 'Invalid tier' });
  if (groupId && !isValidUuid(groupId)) return res.status(400).json({ error: 'Invalid groupId format' });

  const data = {};
  if (name !== undefined) {
    const trimmed = stripTags(String(name)).slice(0, 200);
    if (trimmed.length < 1) return res.status(400).json({ error: 'Project name must be 1-200 characters' });
    data.name = trimmed;
  }
  if (description !== undefined) data.description = sanitize(description);
  if (contactPerson !== undefined) data.contactPerson = contactPerson ? stripTags(String(contactPerson)).slice(0, 100) : null;
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
  broadcast('project:updated', { project }, getMutationId(req));
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
    logAction(req, 'project:approved', 'project', project.id, { name: project.name });
    broadcast('project:approved', { project }, getMutationId(req));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Project not found' });
    throw err;
  }
}));

// Soft-delete project (admin) — also used to decline suggestions
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  await prisma.project.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
  res.json({ ok: true });
  logAction(req, 'project:deleted', 'project', req.params.id);
  broadcast('project:deleted', { projectId: req.params.id }, getMutationId(req));
}));

module.exports = router;
