import { Router } from 'express';
import type { Request, Response } from 'express';
import prisma from '../lib/db.js';
import { requireAdmin } from './auth.js';
import { sanitize } from '../lib/sanitize.js';
import asyncHandler from '../lib/async-handler.js';
import { validateId } from '../lib/validate.js';
import { broadcast, getMutationId } from '../lib/sse.js';
import { logAction } from '../lib/audit.js';
import { deleteMediaFile } from '../lib/media-utils.js';
import { sendError, handleZodError } from '../lib/errors.js';
import { announcementCreate, announcementUpdate } from '../lib/schemas.js';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } from '../lib/config.js';

const router = Router();

// List announcements (pinned first, then newest) — includes media inline
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(
    parseInt(req.query.limit as string, 10) || PAGINATION_DEFAULT_LIMIT,
    PAGINATION_MAX_LIMIT,
  );
  const cursor = req.query.cursor as string | undefined;

  const findArgs: any = {
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    take: limit + 1,
  };
  if (cursor) {
    findArgs.cursor = { id: cursor };
    findArgs.skip = 1;
  }

  const announcements = await prisma.announcement.findMany(findArgs);

  const hasMore = announcements.length > limit;
  if (hasMore) announcements.pop();

  // Batch-fetch media for all announcements in one query
  const ids = announcements.map((a: any) => a.id);
  const media = ids.length > 0
    ? await prisma.media.findMany({
        where: { parentType: 'announcement', parentId: { in: ids } },
      })
    : [];

  const mediaByAnnouncement: Record<string, any[]> = {};
  for (const m of media) {
    if (!mediaByAnnouncement[m.parentId]) mediaByAnnouncement[m.parentId] = [];
    mediaByAnnouncement[m.parentId]!.push(m);
  }

  const data = announcements.map((a: any) => ({
    ...a,
    media: mediaByAnnouncement[a.id] || [],
  }));

  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].id : null;
  res.json({ data, nextCursor, hasMore });
}));

// Create announcement (admin)
router.post('/', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  let data: any;
  try {
    data = announcementCreate.parse(req.body);
  } catch (err) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  const announcement = await prisma.announcement.create({
    data: {
      title: data.title,
      body: sanitize(data.body),
      authorEmail: req.session!.email!,
      pinned: data.pinned,
    },
  });
  res.status(201).json(announcement);
  logAction(req, 'announcement:created', 'announcement', announcement.id, { title: announcement.title });
  broadcast('announcement:created', { announcement }, getMutationId(req));
}));

// Update announcement (admin)
router.patch('/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  let data: any;
  try {
    data = announcementUpdate.parse(req.body);
  } catch (err) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  if (data.body !== undefined) data.body = sanitize(data.body);

  const announcement = await prisma.announcement.update({ where: { id: req.params.id }, data });
  res.json(announcement);
  logAction(req, 'announcement:updated', 'announcement', announcement.id);
  broadcast('announcement:updated', { announcement }, getMutationId(req));
}));

// Delete announcement (admin) — hard delete + cleanup associated media & comments
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  // Gather all media to delete from disk (announcement media + comment media)
  const comments = await prisma.comment.findMany({
    where: { targetType: 'announcement', targetId: req.params.id },
    select: { id: true },
  });
  const commentIds = comments.map((c: any) => c.id);

  const [announcementMedia, commentMedia] = await Promise.all([
    prisma.media.findMany({ where: { parentType: 'announcement', parentId: req.params.id } }),
    commentIds.length > 0
      ? prisma.media.findMany({ where: { parentType: 'comment', parentId: { in: commentIds } } })
      : [],
  ]);

  try {
    const ops: any[] = [];
    if (commentIds.length > 0) {
      ops.push(prisma.media.deleteMany({ where: { parentType: 'comment', parentId: { in: commentIds } } }));
      ops.push(prisma.comment.deleteMany({ where: { targetType: 'announcement', targetId: req.params.id } }));
    }
    ops.push(prisma.media.deleteMany({ where: { parentType: 'announcement', parentId: req.params.id } }));
    ops.push(prisma.announcement.delete({ where: { id: req.params.id } }));
    await prisma.$transaction(ops);
  } catch (err: any) {
    if (err.code === 'P2025') return sendError(res, 'NOT_FOUND', 'Announcement not found');
    throw err;
  }

  // Clean up files on disk after successful DB delete
  for (const m of [...commentMedia, ...announcementMedia]) await deleteMediaFile(m);

  res.json({ ok: true });
  const id = req.params.id as string;
  logAction(req, 'announcement:deleted', 'announcement', id);
  broadcast('announcement:deleted', { announcementId: id }, getMutationId(req));
}));

export default router;
