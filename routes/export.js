const { Router } = require('express');
const archiver = require('archiver');
const { Readable } = require('stream');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');
const asyncHandler = require('../lib/async-handler');

const router = Router();

// Escape a CSV cell value (prevent formula injection + handle commas/quotes)
function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  let str = String(val);
  if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// Stream CSV rows from a Prisma model using cursor-based pagination
// Yields rows in chunks to avoid loading entire tables into memory
async function* streamCSVRows(model, orderBy, transformRow) {
  const BATCH_SIZE = 500;
  let cursor = undefined;
  let isFirst = true;
  let headers = null;

  while (true) {
    const findArgs = {
      orderBy,
      take: BATCH_SIZE,
    };
    if (cursor) {
      findArgs.cursor = { id: cursor };
      findArgs.skip = 1;
    }

    const rows = await model.findMany(findArgs);
    if (rows.length === 0) break;

    for (const row of rows) {
      const transformed = transformRow ? transformRow(row) : row;
      if (isFirst) {
        headers = Object.keys(transformed);
        yield headers.map(escapeCSV).join(',') + '\n';
        isFirst = false;
      }
      yield headers.map(h => escapeCSV(transformed[h])).join(',') + '\n';
    }

    if (rows.length < BATCH_SIZE) break;
    cursor = rows[rows.length - 1].id;
  }

  // Handle empty tables — yield empty string so archiver doesn't error
  if (isFirst) yield '';
}

function csvReadable(model, orderBy, transformRow) {
  const generator = streamCSVRows(model, orderBy, transformRow);
  return Readable.from(generator);
}

// GET /api/export — stream all tables as a ZIP of CSVs (admin only)
router.get('/', requireAdmin, asyncHandler(async (req, res) => {
  const date = new Date().toISOString().slice(0, 10);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="sering-backup-${date}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => {
    console.error('Archive error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Export failed', code: 'INTERNAL_ERROR' });
    } else {
      res.destroy();
    }
  });
  archive.pipe(res);

  const identity = r => r;
  const stripScreenshot = ({ screenshotData, ...rest }) => ({
    ...rest,
    hasScreenshot: !!screenshotData,
  });

  archive.append(csvReadable(prisma.group, { order: 'asc' }, identity), { name: 'groups.csv' });
  archive.append(csvReadable(prisma.project, { createdAt: 'asc' }, identity), { name: 'projects.csv' });
  archive.append(csvReadable(prisma.task, { createdAt: 'asc' }, identity), { name: 'tasks.csv' });
  archive.append(csvReadable(prisma.announcement, { createdAt: 'asc' }, identity), { name: 'announcements.csv' });
  archive.append(csvReadable(prisma.comment, { createdAt: 'asc' }, identity), { name: 'comments.csv' });
  archive.append(csvReadable(prisma.shoppingItem, { createdAt: 'asc' }, identity), { name: 'shopping_items.csv' });
  archive.append(csvReadable(prisma.media, { createdAt: 'asc' }, identity), { name: 'media.csv' });
  archive.append(csvReadable(prisma.report, { createdAt: 'asc' }, stripScreenshot), { name: 'reports.csv' });

  await archive.finalize();
}));

module.exports = router;
