const { Router } = require('express');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');
const { sanitize } = require('../lib/sanitize');
const asyncHandler = require('../lib/async-handler');
const { validateId, stripTags } = require('../lib/validate');
const { broadcast, getMutationId } = require('../lib/sse');
const { logAction } = require('../lib/audit');

const router = Router();

// List announcements (pinned first, then newest) — includes media inline
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const announcements = await prisma.announcement.findMany({
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    take: limit
  });

  const ids = announcements.map(a => a.id);
  const media = ids.length > 0
    ? await prisma.media.findMany({
        where: { parentType: 'announcement', parentId: { in: ids } }
      })
    : [];

  const mediaByAnnouncement = {};
  for (const m of media) {
    if (!mediaByAnnouncement[m.parentId]) mediaByAnnouncement[m.parentId] = [];
    mediaByAnnouncement[m.parentId].push(m);
  }

  const result = announcements.map(a => ({
    ...a,
    media: mediaByAnnouncement[a.id] || []
  }));

  res.json(result);
}));

// Create announcement (admin)
router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const { title, body, pinned } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and body are required' });

  const announcement = await prisma.announcement.create({
    data: {
      title: stripTags(String(title)).slice(0, 500),
      body: sanitize(body),
      authorEmail: req.session.email,
      pinned: !!pinned
    }
  });
  res.status(201).json(announcement);
  logAction(req, 'announcement:created', 'announcement', announcement.id, { title: announcement.title });
  broadcast('announcement:created', { announcement }, getMutationId(req));
}));

// Update announcement (admin)
router.patch('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  const { title, body, pinned } = req.body;
  const data = {};
  if (title !== undefined) data.title = stripTags(String(title)).slice(0, 500);
  if (body !== undefined) data.body = sanitize(body);
  if (pinned !== undefined) data.pinned = !!pinned;

  const announcement = await prisma.announcement.update({ where: { id: req.params.id }, data });
  res.json(announcement);
  logAction(req, 'announcement:updated', 'announcement', announcement.id);
  broadcast('announcement:updated', { announcement }, getMutationId(req));
}));

// Delete announcement (admin)
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  await prisma.announcement.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
  logAction(req, 'announcement:deleted', 'announcement', req.params.id);
  broadcast('announcement:deleted', { announcementId: req.params.id }, getMutationId(req));
}));

module.exports = router;
