const { Router } = require('express');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');
const { sanitize } = require('../lib/sanitize');

const router = Router();

// List projects (optional ?groupId= filter, ?status= filter)
router.get('/', async (req, res) => {
  const where = {};
  if (req.query.groupId) where.groupId = req.query.groupId;
  if (req.query.status) where.status = req.query.status;

  const projects = await prisma.project.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      group: { select: { id: true, name: true } },
      _count: { select: { tasks: true } },
      tasks: { select: { status: true } }
    }
  });
  res.json(projects);
});

// Get single project with tasks
router.get('/:id', async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: {
      group: { select: { id: true, name: true } },
      tasks: { orderBy: { order: 'asc' } }
    }
  });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

// Create project (admin)
router.post('/', requireAdmin, async (req, res) => {
  const { groupId, name, description, contactPerson } = req.body;
  if (!groupId || !name) return res.status(400).json({ error: 'groupId and name are required' });

  const project = await prisma.project.create({
    data: { groupId, name, description: sanitize(description), contactPerson },
    include: { group: { select: { id: true, name: true } } }
  });
  res.status(201).json(project);
});

// Update project (admin)
router.patch('/:id', requireAdmin, async (req, res) => {
  const { name, description, contactPerson, status, groupId } = req.body;
  const data = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = sanitize(description);
  if (contactPerson !== undefined) data.contactPerson = contactPerson;
  if (status !== undefined) data.status = status;
  if (groupId !== undefined) data.groupId = groupId;

  const project = await prisma.project.update({
    where: { id: req.params.id },
    data,
    include: { group: { select: { id: true, name: true } } }
  });
  res.json(project);
});

// Delete project (admin)
router.delete('/:id', requireAdmin, async (req, res) => {
  await prisma.project.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
