const { Router } = require('express');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');

const router = Router();

// List comments for a target
router.get('/', async (req, res) => {
  const { targetType, targetId } = req.query;
  if (!targetType || !targetId) {
    return res.status(400).json({ error: 'targetType and targetId required' });
  }

  const comments = await prisma.comment.findMany({
    where: { targetType, targetId },
    orderBy: { createdAt: 'asc' }
  });

  // Attach media to each comment
  const commentIds = comments.map(c => c.id);
  const media = commentIds.length > 0
    ? await prisma.media.findMany({
        where: { parentType: 'comment', parentId: { in: commentIds } }
      })
    : [];

  const mediaByComment = {};
  for (const m of media) {
    if (!mediaByComment[m.parentId]) mediaByComment[m.parentId] = [];
    mediaByComment[m.parentId].push(m);
  }

  const result = comments.map(c => ({
    ...c,
    media: mediaByComment[c.id] || []
  }));

  res.json(result);
});

// Create comment (anyone — requires authorName)
router.post('/', async (req, res) => {
  const { targetType, targetId, authorName, body } = req.body;
  if (!targetType || !targetId || !authorName) {
    return res.status(400).json({ error: 'targetType, targetId, and authorName are required' });
  }
  if (!body) {
    return res.status(400).json({ error: 'Comment body is required' });
  }

  const comment = await prisma.comment.create({
    data: { targetType, targetId, authorName, body }
  });
  res.status(201).json(comment);
});

// Delete comment (admin only)
router.delete('/:id', requireAdmin, async (req, res) => {
  // Also delete associated media files
  const media = await prisma.media.findMany({
    where: { parentType: 'comment', parentId: req.params.id }
  });

  const fs = require('fs');
  const path = require('path');
  for (const m of media) {
    const filePath = path.join(__dirname, '..', 'uploads', m.parentType, m.parentId, m.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  await prisma.media.deleteMany({ where: { parentType: 'comment', parentId: req.params.id } });
  await prisma.comment.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
