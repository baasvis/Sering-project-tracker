const { Router } = require('express');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');
const { sanitize } = require('../lib/sanitize');
const asyncHandler = require('../lib/async-handler');

const router = Router();

function validUrl(val) {
  if (!val) return true;
  return val.startsWith('https://') || val.startsWith('http://');
}

// List all groups with project counts and task status counts
router.get('/', asyncHandler(async (req, res) => {
  const groups = await prisma.group.findMany({
    orderBy: { order: 'asc' },
    include: {
      _count: { select: { projects: true } },
      projects: {
        where: { status: 'active' },
        select: {
          id: true,
          name: true,
          status: true,
          tier: true,
          _count: { select: { tasks: true } },
          tasks: { select: { status: true } }
        }
      }
    }
  });

  // Transform: replace tasks array with status counts to cut payload size
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
router.get('/:id', asyncHandler(async (req, res) => {
  const group = await prisma.group.findUnique({
    where: { id: req.params.id },
    include: {
      projects: {
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { tasks: true } },
          tasks: { select: { status: true } }
        }
      }
    }
  });
  if (!group) return res.status(404).json({ error: 'Group not found' });

  // Transform tasks to counts
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
  if (!validUrl(mattermostChannel)) return res.status(400).json({ error: 'mattermostChannel must be a valid URL' });

  const maxOrder = await prisma.group.aggregate({ _max: { order: true } });
  const group = await prisma.group.create({
    data: { name, description: sanitize(description), mattermostChannel, order: (maxOrder._max.order || 0) + 1 }
  });
  res.status(201).json(group);
}));

// Update group (admin)
router.patch('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { name, description, order } = req.body;
  const mattermostChannel = req.body.mattermostChannel !== undefined ? (req.body.mattermostChannel?.trim() || null) : undefined;
  if (!validUrl(mattermostChannel)) return res.status(400).json({ error: 'mattermostChannel must be a valid URL' });
  const data = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = sanitize(description);
  if (order !== undefined) data.order = order;
  if (mattermostChannel !== undefined) data.mattermostChannel = mattermostChannel;

  const group = await prisma.group.update({ where: { id: req.params.id }, data });
  res.json(group);
}));

// Delete group (admin, only if no projects)
router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const count = await prisma.project.count({ where: { groupId: req.params.id } });
  if (count > 0) return res.status(400).json({ error: 'Cannot delete group with projects' });

  await prisma.group.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

module.exports = router;
