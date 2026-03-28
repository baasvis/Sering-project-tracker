const { Router } = require('express');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');
const asyncHandler = require('../lib/async-handler');
const { validateId } = require('../lib/validate');
const { sendError, handleZodError } = require('../lib/errors');
const { reportCreate, reportUpdate } = require('../lib/schemas');
const { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } = require('../lib/config');

const router = Router();

// Create report (anyone can submit)
router.post('/', asyncHandler(async (req, res) => {
  let data;
  try {
    data = reportCreate.parse(req.body);
  } catch (err) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  // Extra screenshot validation: only raster image formats (reject SVG)
  if (data.screenshotData) {
    const SAFE_PREFIXES = ['data:image/jpeg', 'data:image/png', 'data:image/webp', 'data:image/gif'];
    if (!SAFE_PREFIXES.some(p => data.screenshotData.startsWith(p))) {
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
    }
  });

  res.status(201).json({ ...report, screenshotData: undefined });
}));

// List reports (admin only, paginated)
router.get('/', requireAdmin, asyncHandler(async (req, res) => {
  const where = {};
  if (req.query.resolved === 'true') where.resolved = true;
  if (req.query.resolved === 'false') where.resolved = false;

  const limit = Math.min(
    parseInt(req.query.limit, 10) || PAGINATION_DEFAULT_LIMIT,
    PAGINATION_MAX_LIMIT
  );
  const cursor = req.query.cursor;

  const findArgs = {
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
  };
  if (cursor) {
    findArgs.cursor = { id: cursor };
    findArgs.skip = 1;
  }

  const reports = await prisma.report.findMany(findArgs);

  const hasMore = reports.length > limit;
  if (hasMore) reports.pop();

  const data = reports.map(r => ({
    ...r,
    hasScreenshot: !!r.screenshotData,
    screenshotData: undefined
  }));

  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].id : null;
  res.json({ data, nextCursor, hasMore });
}));

// Get single report with screenshot (admin only)
router.get('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report) return sendError(res, 'NOT_FOUND', 'Report not found');
  res.json(report);
}));

// Update report (admin — resolve, add notes)
router.patch('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  let data;
  try {
    data = reportUpdate.parse(req.body);
  } catch (err) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  try {
    const report = await prisma.report.update({ where: { id: req.params.id }, data });
    res.json({ ...report, screenshotData: undefined });
  } catch (err) {
    if (err.code === 'P2025') return sendError(res, 'NOT_FOUND', 'Report not found');
    throw err;
  }
}));

// Delete report (admin)
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  try {
    await prisma.report.delete({ where: { id: req.params.id } });
  } catch (err) {
    if (err.code === 'P2025') return sendError(res, 'NOT_FOUND', 'Report not found');
    throw err;
  }
  res.json({ ok: true });
}));

module.exports = router;
