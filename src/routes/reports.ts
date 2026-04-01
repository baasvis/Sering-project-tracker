import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/db.js';
import { requireAdmin } from './auth.js';
import asyncHandler from '../lib/async-handler.js';
import { validateId } from '../lib/validate.js';
import { logAction } from '../lib/audit.js';
import { sendError, handleZodError, isPrismaNotFound } from '../lib/errors.js';
import { reportCreate, reportUpdate } from '../lib/schemas.js';
import type { ReportCreate, ReportUpdate } from '../lib/schemas.js';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } from '../lib/config.js';

const router = Router();

// Create report (anyone can submit)
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  let data: ReportCreate;
  try {
    data = reportCreate.parse(req.body);
  } catch (err: unknown) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  // Extra screenshot validation: only raster image formats (reject SVG)
  if (data.screenshotData) {
    const SAFE_PREFIXES = ['data:image/jpeg', 'data:image/png', 'data:image/webp', 'data:image/gif'];
    if (!SAFE_PREFIXES.some(p => data.screenshotData!.startsWith(p))) {
      return sendError(res, 'VALIDATION_ERROR', 'Screenshot must be JPEG, PNG, WebP, or GIF');
    }
    if (data.screenshotData.length > 2 * 1024 * 1024) {
      return sendError(res, 'VALIDATION_ERROR', 'Screenshot too large');
    }
  }

  const report = await prisma.report.create({
    data: {
      description: data.description,
      screenshotData: data.screenshotData || null,
      reporterName: data.reporterName,
      currentPage: data.currentPage || null,
    },
  });

  res.status(201).json({ ...report, screenshotData: undefined });
  logAction(req, 'report:created', 'report', report.id, { reporterName: report.reporterName });
}));

// List reports (admin only, paginated)
router.get('/', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const where: Prisma.ReportWhereInput = {};
  if (req.query.resolved === 'true') where.resolved = true;
  if (req.query.resolved === 'false') where.resolved = false;

  const limit = Math.min(
    parseInt(req.query.limit as string, 10) || PAGINATION_DEFAULT_LIMIT,
    PAGINATION_MAX_LIMIT,
  );
  const cursor = req.query.cursor as string | undefined;

  const reports = await prisma.report.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = reports.length > limit;
  if (hasMore) reports.pop();

  const data = reports.map(r => ({
    ...r,
    hasScreenshot: !!r.screenshotData,
    screenshotData: undefined,
  }));

  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].id : null;
  res.json({ data, nextCursor, hasMore });
}));

// Get single report with screenshot (admin only)
router.get('/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report) return sendError(res, 'NOT_FOUND', 'Report not found');
  res.json(report);
}));

// Update report (admin — resolve, add notes)
router.patch('/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  let data: ReportUpdate;
  try {
    data = reportUpdate.parse(req.body);
  } catch (err: unknown) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  try {
    const report = await prisma.report.update({ where: { id: req.params.id }, data });
    res.json({ ...report, screenshotData: undefined });
    logAction(req, 'report:updated', 'report', report.id);
  } catch (err: unknown) {
    if (isPrismaNotFound(err)) return sendError(res, 'NOT_FOUND', 'Report not found');
    throw err;
  }
}));

// Delete report (admin)
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  try {
    await prisma.report.delete({ where: { id: req.params.id } });
  } catch (err: unknown) {
    if (isPrismaNotFound(err)) return sendError(res, 'NOT_FOUND', 'Report not found');
    throw err;
  }
  res.json({ ok: true });
  logAction(req, 'report:deleted', 'report', req.params.id);
}));

export default router;
