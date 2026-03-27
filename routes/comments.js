const { Router } = require('express');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');
const asyncHandler = require('../lib/async-handler');
const { deleteMediaFile } = require('../lib/media-utils');
const { validateId, isValidUuid } = require('../lib/validate');
const { broadcast, getMutationId } = require('../lib/sse');

const router = Router();

const VALID_TARGET_TYPES = ['group', 'project', 'task', 'announcement'];

// List comments for a target
router.get('/', asyncHandler(async (req, res) => {
  const { targetType, targetId } = req.query;
  if (!targetType || !targetId) {
    return res.status(400).json({ error: 'targetType and targetId required' });
  }
  if (!VALID_TARGET_TYPES.includes(targetType)) {
    return res.status(400).json({ error: 'Invalid targetType' });
  }
  if (!isValidUuid(targetId)) {
    return res.status(400).json({ error: 'Invalid targetId format' });
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
}));

// Create comment (anyone — requires authorName)
router.post('/', asyncHandler(async (req, res) => {
  const { targetType, targetId, authorName, body } = req.body;
  if (!targetType || !targetId || !authorName) {
    return res.status(400).json({ error: 'targetType, targetId, and authorName are required' });
  }
  if (!VALID_TARGET_TYPES.includes(targetType)) {
    return res.status(400).json({ error: `Invalid targetType. Must be one of: ${VALID_TARGET_TYPES.join(', ')}` });
  }
  if (!isValidUuid(targetId)) {
    return res.status(400).json({ error: 'Invalid targetId format' });
  }
  if (!body || body.trim().length === 0) {
    return res.status(400).json({ error: 'Comment body is required' });
  }

  const trimmed = body.trim();

  // Spam protection: min 2 chars, max 2000 chars
  if (trimmed.length < 2) {
    return res.status(400).json({ error: 'Comment too short' });
  }
  if (trimmed.length > 2000) {
    return res.status(400).json({ error: 'Comment too long (max 2000 characters)' });
  }

  // Name validation: 1-50 chars
  const name = authorName.trim();
  if (name.length < 1 || name.length > 50) {
    return res.status(400).json({ error: 'Invalid name' });
  }

  // Duplicate detection: same author + same body within last 5 minutes
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const duplicate = await prisma.comment.findFirst({
    where: {
      authorName: name,
      body: trimmed,
      createdAt: { gte: fiveMinAgo }
    }
  });
  if (duplicate) {
    return res.status(409).json({ error: 'Duplicate comment — you already posted this' });
  }

  const comment = await prisma.comment.create({
    data: { targetType, targetId, authorName: name, body: trimmed }
  });
  res.status(201).json(comment);
  broadcast('comment:created', { comment }, getMutationId(req));
}));

// Delete comment (admin only)
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  // Fetch comment info before deleting (for SSE broadcast)
  const existing = await prisma.comment.findUnique({
    where: { id: req.params.id },
    select: { targetType: true, targetId: true }
  });

  // Also delete associated media files
  const media = await prisma.media.findMany({
    where: { parentType: 'comment', parentId: req.params.id }
  });

  for (const m of media) {
    deleteMediaFile(m);
  }

  await prisma.media.deleteMany({ where: { parentType: 'comment', parentId: req.params.id } });
  await prisma.comment.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
  if (existing) broadcast('comment:deleted', { commentId: req.params.id, targetType: existing.targetType, targetId: existing.targetId }, getMutationId(req));
}));

module.exports = router;
