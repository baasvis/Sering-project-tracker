const { Router } = require('express');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');
const { sanitize } = require('../lib/sanitize');
const asyncHandler = require('../lib/async-handler');
const { validateId, isValidUrl, stripTags } = require('../lib/validate');
const { broadcast, getMutationId } = require('../lib/sse');
const { logAction } = require('../lib/audit');

const router = Router();

// List all groups with project counts and task status counts
router.get('/', asyncHandler(async (req, res) => {
  const groups = await prisma.group.findMany({
    where: { deletedAt: null },
    orderBy: { order: 'asc' },
    include: {
      _count: { select: { projects: true } },
      projects: {
        where: { status: 'active', approved: true, deletedAt: null },
        select: {
          id: true, name: true, status: true, tier: true, joinType: true,
          _count: { select: { tasks: true } },
          tasks: { where: { approved: true, deletedAt: null }, select: { status: true } }
        }
      }
    }
  });

  const result = groups.map(g => ({
    ...g,
    projects: g.projects.map(p => {
      const counts = { todo: 0, in_progress: 0, done: 0 };
      for (const t of p.tasks) {
        if (counts[t.status] !== undefined) counts[t.status]++;
      }
      const { tasks, ...rest } = p;
      return { ...rest, taskCounts: counts };
    })
  }));

  res.json(result);
}));

// Get single group
router.get('/:id', validateId, asyncHandler(async (req, res) => {
  const group = await prisma.group.findUnique({
    where: { id: req.params.id },
    include: {
      projects: {
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { tasks: true } },
          tasks: { where: { approved: true, deletedAt: null }, select: { status: true } }
        }
      }
    }
  });
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const result = {
    ...group,
    projects: group.projects.map(p => {
      const counts = { todo: 0, in_progress: 0, done: 0 };
      for (const t of p.tasks) {
        if (counts[t.status] !== undefined) counts[t.status]++;
      }
      const { tasks, ...rest } = p;
      return { ...rest, taskCounts: counts };
    })
  };

  res.json(result);
}));

// Create group (admin)
router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  const mattermostChannel = req.body.mattermostChannel?.trim() || null;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const trimmedName = stripTags(String(name)).slice(0, 200);
  if (trimmedName.length < 1) return res.status(400).json({ error: 'Name must be 1-200 characters' });

  if (!isValidUrl(mattermostChannel)) return res.status(400).json({ error: 'mattermostChannel must be a valid URL' });

  const maxOrder = await prisma.group.aggregate({ _max: { order: true } });
  const group = await prisma.group.create({
    data: {
      name: trimmedName,
      description: sanitize(description),
      mattermostChannel,
      order: (maxOrder._max.order || 0) + 1
    }
  });
  res.status(201).json(group);
  logAction(req, 'group:created', 'group', group.id, { name: group.name });
  broadcast('group:created', { group }, getMutationId(req));
}));

// Update group (admin)
router.patch('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  const { name, description, order } = req.body;
  const mattermostChannel = req.body.mattermostChannel !== undefined
    ? (req.body.mattermostChannel?.trim() || null)
    : undefined;

  if (!isValidUrl(mattermostChannel)) return res.status(400).json({ error: 'mattermostChannel must be a valid URL' });

  const data = {};
  if (name !== undefined) {
    const trimmed = stripTags(String(name)).slice(0, 200);
    if (trimmed.length < 1) return res.status(400).json({ error: 'Name must be 1-200 characters' });
    data.name = trimmed;
  }
  if (description !== undefined) data.description = sanitize(description);
  if (order !== undefined) data.order = order;
  if (mattermostChannel !== undefined) data.mattermostChannel = mattermostChannel;

  const group = await prisma.group.update({ where: { id: req.params.id }, data });
  res.json(group);
  broadcast('group:updated', { group }, getMutationId(req));
}));

// Soft-delete group (admin, only if no active projects)
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  const count = await prisma.project.count({ where: { groupId: req.params.id, deletedAt: null } });
  if (count > 0) return res.status(400).json({ error: 'Cannot delete group with projects' });

  await prisma.group.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
  res.json({ ok: true });
  logAction(req, 'group:deleted', 'group', req.params.id);
  broadcast('group:deleted', { groupId: req.params.id }, getMutationId(req));
}));

module.exports = router;
