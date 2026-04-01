import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma, { getPrismaDelegate } from '../lib/db.js';
import type { PrismaModelName } from '../lib/db.js';
import { requireAdmin } from './auth.js';
import asyncHandler from '../lib/async-handler.js';
import { deleteMediaFile } from '../lib/media-utils.js';
import { validateId } from '../lib/validate.js';
import { broadcast, getMutationId } from '../lib/sse.js';
import { logAction } from '../lib/audit.js';
import { sendError, handleZodError } from '../lib/errors.js';
import { commentCreate } from '../lib/schemas.js';
import type { CommentCreate } from '../lib/schemas.js';
import { COMMENT_COOLDOWN_WINDOW_MS, COMMENT_COOLDOWN_MAX, PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } from '../lib/config.js';

const router = Router();

// Map comment targetType values to Prisma delegate names
const targetModelMap: Record<string, PrismaModelName> = {
  group: 'group',
  project: 'project',
  task: 'task',
  announcement: 'announcement',
};

// List comments for a target (paginated)
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { targetType, targetId } = req.query;
  if (!targetType || !targetId) {
    return sendError(res, 'VALIDATION_ERROR', 'targetType and targetId required');
  }

  // Validate via schema enums
  let parsed: Pick<CommentCreate, 'targetType' | 'targetId'>;
  try {
    parsed = commentCreate.pick({ targetType: true, targetId: true }).parse({ targetType, targetId });
  } catch (err: unknown) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  const limit = Math.min(
    parseInt(req.query.limit as string, 10) || PAGINATION_DEFAULT_LIMIT,
    PAGINATION_MAX_LIMIT,
  );
  const cursor = req.query.cursor as string | undefined;

  const comments = await prisma.comment.findMany({
    where: { targetType: parsed.targetType, targetId: parsed.targetId },
    orderBy: { createdAt: 'asc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  // Filter out comments whose target entity has been soft-deleted
  if (['project', 'task'].includes(parsed.targetType)) {
    const delegate = getPrismaDelegate(parsed.targetType as PrismaModelName);
    const target = await (delegate as typeof prisma.project).findFirst({
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
        where: { parentType: 'comment', parentId: { in: commentIds } },
      })
    : [];

  const mediaByComment: Record<string, typeof media> = {};
  for (const m of media) {
    if (!mediaByComment[m.parentId]) mediaByComment[m.parentId] = [];
    mediaByComment[m.parentId]!.push(m);
  }

  const data = comments.map(c => ({
    ...c,
    media: mediaByComment[c.id] || [],
  }));

  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].id : null;
  res.json({ data, nextCursor, hasMore });
}));

// Create comment (anyone — requires authorName)
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  let data: CommentCreate;
  try {
    data = commentCreate.parse(req.body);
  } catch (err: unknown) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  // DB-based cooldown: count recent comments by this author
  const cooldownCutoff = new Date(Date.now() - COMMENT_COOLDOWN_WINDOW_MS);
  const recentCount = await prisma.comment.count({
    where: {
      authorName: data.authorName,
      createdAt: { gte: cooldownCutoff },
    },
  });
  if (recentCount >= COMMENT_COOLDOWN_MAX) {
    return sendError(res, 'RATE_LIMITED', 'Too many comments — please wait a few minutes');
  }

  // Duplicate detection: same author + same body within last 5 minutes
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const duplicate = await prisma.comment.findFirst({
    where: { authorName: data.authorName, body: data.body, createdAt: { gte: fiveMinAgo } },
  });
  if (duplicate) return sendError(res, 'CONFLICT', 'Duplicate comment — you already posted this');

  // Verify target entity exists (and is not soft-deleted)
  const modelName = targetModelMap[data.targetType];
  if (modelName) {
    const delegate = getPrismaDelegate(modelName);
    const hasSoftDelete = ['project', 'task', 'group'].includes(data.targetType);
    const where = hasSoftDelete
      ? { id: data.targetId, deletedAt: null }
      : { id: data.targetId };
    const target = await (delegate as typeof prisma.project).findFirst({ where, select: { id: true } });
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
    },
  });
  res.status(201).json(comment);
  logAction(req, 'comment:created', 'comment', comment.id, { authorName: comment.authorName });
  broadcast('comment:created', { comment }, getMutationId(req));
}));

// Delete comment (admin only)
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.comment.findUnique({
    where: { id: req.params.id },
    select: { targetType: true, targetId: true },
  });
  if (!existing) return sendError(res, 'NOT_FOUND', 'Comment not found');

  // Gather media for disk cleanup, then delete in a transaction
  const media = await prisma.media.findMany({
    where: { parentType: 'comment', parentId: req.params.id },
  });

  await prisma.$transaction([
    prisma.media.deleteMany({ where: { parentType: 'comment', parentId: req.params.id } }),
    prisma.comment.delete({ where: { id: req.params.id } }),
  ]);

  // Clean up files on disk after successful DB delete
  for (const m of media) await deleteMediaFile(m);
  res.json({ ok: true });
  const id = req.params.id as string;
  logAction(req, 'comment:deleted', 'comment', id, existing);
  broadcast('comment:deleted', {
    commentId: id,
    targetType: existing.targetType,
    targetId: existing.targetId,
  }, getMutationId(req));
}));

export default router;
