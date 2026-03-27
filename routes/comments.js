const { Router } = require('express');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');
const asyncHandler = require('../lib/async-handler');
const { deleteMediaFile } = require('../lib/media-utils');
const { validateId, isValidUuid, stripTags, sanitizeName, VALID_TARGET_TYPES } = require('../lib/validate');
const { broadcast, getMutationId } = require('../lib/sse');
const { logAction } = require('../lib/audit');

const router = Router();

// Per-name comment cooldown: max 5 comments per name per 10 minutes
// In-memory map: name -> [timestamp, timestamp, ...]
const _commentCooldowns = new Map();
const COOLDOWN_WINDOW = 10 * 60 * 1000; // 10 minutes
const COOLDOWN_MAX = 5;

// Clean up old entries every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - COOLDOWN_WINDOW;
  for (const [name, times] of _commentCooldowns) {
    const recent = times.filter(t => t > cutoff);
    if (recent.length === 0) _commentCooldowns.delete(name);
    else _commentCooldowns.set(name, recent);
  }
}, COOLDOWN_WINDOW);

function checkCommentCooldown(name) {
  const now = Date.now();
  const cutoff = now - COOLDOWN_WINDOW;
  const times = (_commentCooldowns.get(name) || []).filter(t => t > cutoff);
  if (times.length >= COOLDOWN_MAX) return false;
  times.push(now);
  _commentCooldowns.set(name, times);
  return true;
}

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

  // Batch-fetch media for all comments in one query
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
  if (trimmed.length < 2) return res.status(400).json({ error: 'Comment too short' });
  if (trimmed.length > 2000) return res.status(400).json({ error: 'Comment too long (max 2000 characters)' });

  // Sanitize author name (strip HTML tags)
  const name = sanitizeName(authorName);
  if (!name) return res.status(400).json({ error: 'Invalid name (1-50 characters, no HTML)' });

  // Per-name cooldown: max 5 comments per 10 minutes (spam protection)
  if (!checkCommentCooldown(name)) {
    return res.status(429).json({ error: 'Too many comments — please wait a few minutes' });
  }

  // Duplicate detection: same author + same body within last 5 minutes
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const duplicate = await prisma.comment.findFirst({
    where: { authorName: name, body: trimmed, createdAt: { gte: fiveMinAgo } }
  });
  if (duplicate) return res.status(409).json({ error: 'Duplicate comment — you already posted this' });

  const comment = await prisma.comment.create({
    data: { targetType, targetId, authorName: name, body: trimmed }
  });
  res.status(201).json(comment);
  broadcast('comment:created', { comment }, getMutationId(req));
}));

// Delete comment (admin only)
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  const existing = await prisma.comment.findUnique({
    where: { id: req.params.id },
    select: { targetType: true, targetId: true }
  });

  // Delete associated media files from disk
  const media = await prisma.media.findMany({
    where: { parentType: 'comment', parentId: req.params.id }
  });
  for (const m of media) deleteMediaFile(m);

  await prisma.media.deleteMany({ where: { parentType: 'comment', parentId: req.params.id } });
  await prisma.comment.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
  logAction(req, 'comment:deleted', 'comment', req.params.id, existing);
  if (existing) broadcast('comment:deleted', { commentId: req.params.id, targetType: existing.targetType, targetId: existing.targetId }, getMutationId(req));
}));

module.exports = router;
