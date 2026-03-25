const { Router } = require('express');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');
const { sanitize } = require('../lib/sanitize');

const router = Router();

// List all groups with project counts
router.get('/', async (req, res) => {
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
          _count: { select: { tasks: true } },
          tasks: { select: { status: true } }
        }
      }
    }
  });
  res.json(groups);
});

// Get single group
router.get('/:id', async (req, res) => {
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
  res.json(group);
});

// Create group (admin)
router.post('/', requireAdmin, async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const maxOrder = await prisma.group.aggregate({ _max: { order: true } });
  const group = await prisma.group.create({
    data: { name, description: sanitize(description), order: (maxOrder._max.order || 0) + 1 }
  });
  res.status(201).json(group);
});

// Update group (admin)
router.patch('/:id', requireAdmin, async (req, res) => {
  const { name, description, order } = req.body;
  const data = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = sanitize(description);
  if (order !== undefined) data.order = order;

  const group = await prisma.group.update({ where: { id: req.params.id }, data });
  res.json(group);
});

// Delete group (admin, only if no projects)
router.delete('/:id', requireAdmin, async (req, res) => {
  const count = await prisma.project.count({ where: { groupId: req.params.id } });
  if (count > 0) return res.status(400).json({ error: 'Cannot delete group with projects' });

  await prisma.group.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
