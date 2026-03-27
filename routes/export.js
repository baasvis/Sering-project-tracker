const { Router } = require('express');
const archiver = require('archiver');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');

const router = Router();

function toCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = val => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    // Wrap in quotes if contains comma, newline, or quote
    if (str.includes(',') || str.includes('\n') || str.includes('"')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };
  const lines = [
    headers.join(','),
    ...rows.map(row => headers.map(h => escape(row[h])).join(','))
  ];
  return lines.join('\n');
}

// GET /api/export — download all tables as a ZIP of CSVs (admin only)
router.get('/', requireAdmin, async (req, res) => {
  const date = new Date().toISOString().slice(0, 10);

  // Fetch all tables in parallel
  const [groups, projects, tasks, announcements, comments, shoppingItems, media] = await Promise.all([
    prisma.group.findMany({ orderBy: { order: 'asc' } }),
    prisma.project.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.task.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.announcement.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.comment.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.shoppingItem.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.media.findMany({ orderBy: { createdAt: 'asc' } }),
  ]);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="sering-backup-${date}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => { throw err; });
  archive.pipe(res);

  archive.append(toCSV(groups),        { name: 'groups.csv' });
  archive.append(toCSV(projects),      { name: 'projects.csv' });
  archive.append(toCSV(tasks),         { name: 'tasks.csv' });
  archive.append(toCSV(announcements), { name: 'announcements.csv' });
  archive.append(toCSV(comments),      { name: 'comments.csv' });
  archive.append(toCSV(shoppingItems), { name: 'shopping_items.csv' });
  archive.append(toCSV(media),         { name: 'media.csv' });

  await archive.finalize();
});

module.exports = router;
