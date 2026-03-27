const { Router } = require('express');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');
const asyncHandler = require('../lib/async-handler');
const { validateId } = require('../lib/validate');

const router = Router();

// Validate :id param on all routes that use it
router.param('id', (req, res, next, id) => {
  validateId(req, res, next);
});

// Strip HTML tags from plain text input
function stripTags(str) {
  if (!str) return '';
  return str.replace(/<[^>]*>/g, '').trim();
}

// Create report (anyone can submit)
router.post('/', asyncHandler(async (req, res) => {
  const { description, screenshotData, reporterName, currentPage } = req.body;
  if (!description || !reporterName) {
    return res.status(400).json({ error: 'Description and name are required' });
  }

  // Validate reporter name
  const cleanName = stripTags(String(reporterName)).slice(0, 100);
  if (!cleanName || cleanName.length < 1) {
    return res.status(400).json({ error: 'Valid name is required' });
  }

  // Validate description
  const cleanDesc = stripTags(String(description)).slice(0, 2000);
  if (!cleanDesc || cleanDesc.length < 2) {
    return res.status(400).json({ error: 'Description must be at least 2 characters' });
  }

  // Validate screenshot is a data URL if provided
  if (screenshotData) {
    if (typeof screenshotData !== 'string' || !screenshotData.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid screenshot format' });
    }
    // Limit screenshot size (~2MB base64 ≈ ~1.5MB image)
    if (screenshotData.length > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'Screenshot too large' });
    }
  }

  const report = await prisma.report.create({
    data: {
      description: cleanDesc,
      screenshotData: screenshotData || null,
      reporterName: cleanName,
      currentPage: currentPage ? String(currentPage).slice(0, 200) : null
    }
  });

  // Don't send back screenshotData in response (bandwidth)
  res.status(201).json({ ...report, screenshotData: undefined });
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
  if (resolved !== undefined) data.resolved = !!resolved;
  if (adminNotes !== undefined) data.adminNotes = stripTags(String(adminNotes)).slice(0, 2000);

  const report = await prisma.report.update({ where: { id: req.params.id }, data });
  res.json({ ...report, screenshotData: undefined });
}));

// Delete report (admin)
router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  await prisma.report.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

module.exports = router;
