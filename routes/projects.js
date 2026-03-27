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
      tasks: { select: { status: true } }
    }
  });

  // Transform: replace tasks array with status counts
  const result = projects.map(p => {
    const counts = { todo: 0, in_progress: 0, done: 0 };
    for (const t of p.tasks) {
      if (counts[t.status] !== undefined) counts[t.status]++;
    }
    const { tasks, ...rest } = p;
    return { ...rest, taskCounts: counts };
  });

  // Batch-fetch media for all projects in one query (avoids N+1 on frontend)
  const projectIds = result.map(p => p.id);
  const projectMedia = projectIds.length > 0
    ? await prisma.media.findMany({ where: { parentType: 'project', parentId: { in: projectIds } } })
    : [];
  const mediaByProject = {};
  for (const m of projectMedia) {
    if (!mediaByProject[m.parentId]) mediaByProject[m.parentId] = [];
    mediaByProject[m.parentId].push(m);
  }

  res.json(result.map(p => ({ ...p, media: mediaByProject[p.id] || [] })));
}));

// Get single project with tasks
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

// Create project (admin)
router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const { groupId, name, description, contactPerson, tier, joinType } = req.body;
  if (!groupId || !name) return res.status(400).json({ error: 'groupId and name are required' });
  if (joinType && !VALID_JOIN_TYPES.includes(joinType)) return res.status(400).json({ error: 'Invalid joinType' });
  if (tier && !VALID_TIERS.includes(tier)) return res.status(400).json({ error: 'Invalid tier' });

  const project = await prisma.project.create({
    data: { groupId, name, description: sanitize(description), contactPerson, tier: tier || null, joinType: joinType || null },
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

// Delete project (admin)
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  await prisma.project.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

module.exports = router;
