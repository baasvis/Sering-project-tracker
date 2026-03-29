const { Router } = require('express');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');
const asyncHandler = require('../lib/async-handler');
const { deleteMediaFile } = require('../lib/media-utils');
const { validateId } = require('../lib/validate');
const { broadcast, getMutationId } = require('../lib/sse');
const { logAction } = require('../lib/audit');
const { sendError, handleZodError } = require('../lib/errors');
const { commentCreate } = require('../lib/schemas');
const { COMMENT_COOLDOWN_WINDOW_MS, COMMENT_COOLDOWN_MAX, PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } = require('../lib/config');

const router = Router();

// List comments for a target (paginated)
router.get('/', asyncHandler(async (req, res) => {
  const { targetType, targetId } = req.query;
  if (!targetType || !targetId) {
    return sendError(res, 'VALIDATION_ERROR', 'targetType and targetId required');
  }

  // Validate via schema enums
  let parsed;
  try {
    parsed = commentCreate.pick({ targetType: true, targetId: true }).parse({ targetType, targetId });
  } catch (err) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  const limit = Math.min(
    parseInt(req.query.limit, 10) || PAGINATION_DEFAULT_LIMIT,
    PAGINATION_MAX_LIMIT
  );
  const cursor = req.query.cursor;

  const findArgs = {
    where: { targetType: parsed.targetType, targetId: parsed.targetId },
    orderBy: { createdAt: 'asc' },
    take: limit + 1,
  };
  if (cursor) {
    findArgs.cursor = { id: cursor };
    findArgs.skip = 1;
  }

  let comments = await prisma.comment.findMany(findArgs);

  // Filter out comments whose target entity has been soft-deleted
  if (['project', 'task'].includes(parsed.targetType)) {
    const targetModel = parsed.targetType;
    const target = await prisma[targetModel].findFirst({
      where: { id: parsed.targetId, deletedAt: null },
      select: { id: true },
    });
    if (!target) {
      return res.json({ data: [], nextCursor: null, hasMore: false });
    }
  }

  const hasMore = comments.length > limit;
  if (hasMore) comments.pop();

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

  const data = comments.map(c => ({
    ...c,
    media: mediaByComment[c.id] || []
  }));

  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].id : null;
  res.json({ data, nextCursor, hasMore });
}));

// Create comment (anyone — requires authorName)
router.post('/', asyncHandler(async (req, res) => {
  let data;
  try {
    data = commentCreate.parse(req.body);
  } catch (err) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  // DB-based cooldown: count recent comments by this author
  const cooldownCutoff = new Date(Date.now() - COMMENT_COOLDOWN_WINDOW_MS);
  const recentCount = await prisma.comment.count({
    where: {
      authorName: data.authorName,
      createdAt: { gte: cooldownCutoff },
    }
  });
  if (recentCount >= COMMENT_COOLDOWN_MAX) {
    return sendError(res, 'RATE_LIMITED', 'Too many comments — please wait a few minutes');
  }

  // Duplicate detection: same author + same body within last 5 minutes
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const duplicate = await prisma.comment.findFirst({
    where: { authorName: data.authorName, body: data.body, createdAt: { gte: fiveMinAgo } }
  });
  if (duplicate) return sendError(res, 'CONFLICT', 'Duplicate comment — you already posted this');

  // Verify target entity exists (and is not soft-deleted)
  const targetModel = { group: 'group', project: 'project', task: 'task', announcement: 'announcement' }[data.targetType];
  if (targetModel) {
    const where = { id: data.targetId };
    // Projects, tasks, and groups use soft-delete
    if (['project', 'task', 'group'].includes(data.targetType)) {
      where.deletedAt = null;
    }
    const target = await prisma[targetModel].findFirst({ where, select: { id: true } });
    if (!target) {
      return sendError(res, 'NOT_FOUND', `${data.targetType} not found`);
    }
  }

  const comment = await prisma.comment.create({
    data: {
      targetType: data.targetType,
      targetId: data.targetId,
      authorName: data.authorName,
      body: data.body ? data.body.replace(/<[^>]*>/g, '') : data.body,
    }
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
  if (!existing) return sendError(res, 'NOT_FOUND', 'Comment not found');

  // Gather media for disk cleanup, then delete in a transaction
  const media = await prisma.media.findMany({
    where: { parentType: 'comment', parentId: req.params.id }
  });

  await prisma.$transaction([
    prisma.media.deleteMany({ where: { parentType: 'comment', parentId: req.params.id } }),
    prisma.comment.delete({ where: { id: req.params.id } }),
  ]);

  // Clean up files on disk after successful DB delete
  for (const m of media) await deleteMediaFile(m);
  res.json({ ok: true });
  logAction(req, 'comment:deleted', 'comment', req.params.id, existing);
  broadcast('comment:deleted', {
    commentId: req.params.id,
    targetType: existing.targetType,
    targetId: existing.targetId,
  }, getMutationId(req));
}));

module.exports = router;
