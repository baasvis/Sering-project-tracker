const { Router } = require('express');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');
const asyncHandler = require('../lib/async-handler');

const router = Router();

// Create report (anyone can submit)
router.post('/', asyncHandler(async (req, res) => {
  const { description, screenshotData, reporterName, currentPage } = req.body;
  if (!description || !reporterName) {
    return res.status(400).json({ error: 'Description and name are required' });
  }

  // Limit screenshot size (~2MB base64 ≈ ~1.5MB image)
  if (screenshotData && screenshotData.length > 2 * 1024 * 1024) {
    return res.status(400).json({ error: 'Screenshot too large' });
  }

  const report = await prisma.report.create({
    data: {
      description: description.slice(0, 2000),
      screenshotData: screenshotData || null,
      reporterName: reporterName.slice(0, 100),
      currentPage: currentPage ? currentPage.slice(0, 200) : null
    }
  });

  res.status(201).json(report);
}));

// List reports (admin only)
router.get('/', requireAdmin, asyncHandler(async (req, res) => {
  const where = {};
  if (req.query.resolved === 'true') where.resolved = true;
  if (req.query.resolved === 'false') where.resolved = false;

  const reports = await prisma.report.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  // Strip screenshot data from list view to keep response small
  const result = reports.map(r => ({
    ...r,
    hasScreenshot: !!r.screenshotData,
    screenshotData: undefined
  }));

  res.json(result);
}));

// Get single report with screenshot (admin only)
router.get('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report) return res.status(404).json({ error: 'Report not found' });
  res.json(report);
}));

// Update report (admin — resolve, add notes)
router.patch('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { resolved, adminNotes } = req.body;
  const data = {};
  if (resolved !== undefined) data.resolved = resolved;
  if (adminNotes !== undefined) data.adminNotes = adminNotes;

  const report = await prisma.report.update({ where: { id: req.params.id }, data });
  res.json({ ...report, screenshotData: undefined });
}));

// Delete report (admin)
router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  await prisma.report.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

module.exports = router;
