import { Router } from 'express';
import type { Request, Response } from 'express';
import archiver from 'archiver';
import { Readable } from 'stream';
import prisma from '../lib/db.js';
import { requireAdmin } from './auth.js';
import asyncHandler from '../lib/async-handler.js';

const router = Router();

// Escape a CSV cell value (prevent formula injection + handle commas/quotes)
function escapeCSV(val: unknown): string {
  if (val === null || val === undefined) return '';
  let str = String(val);
  if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// A Prisma delegate with findMany — matches all model delegates
interface PrismaFindManyDelegate {
  findMany(args: { orderBy: Record<string, string>; take: number; cursor?: { id: string }; skip?: number }): Promise<Array<Record<string, unknown>>>;
}

// Stream CSV rows from a Prisma model using cursor-based pagination
// Yields rows in chunks to avoid loading entire tables into memory
async function* streamCSVRows(
  model: PrismaFindManyDelegate,
  orderBy: Record<string, string>,
  transformRow: (row: Record<string, unknown>) => Record<string, unknown>,
): AsyncGenerator<string> {
  const BATCH_SIZE = 500;
  let cursor: string | undefined = undefined;
  let isFirst = true;
  let headers: string[] | null = null;

  while (true) {
    const findArgs: { orderBy: Record<string, string>; take: number; cursor?: { id: string }; skip?: number } = {
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
      const transformed = transformRow(row);
      if (isFirst) {
        headers = Object.keys(transformed);
        yield headers.map(escapeCSV).join(',') + '\n';
        isFirst = false;
      }
      yield headers!.map(h => escapeCSV(transformed[h])).join(',') + '\n';
    }

    if (rows.length < BATCH_SIZE) break;
    cursor = rows[rows.length - 1].id as string;
  }

  // Handle empty tables — yield empty string so archiver doesn't error
  if (isFirst) yield '';
}

function csvReadable(model: PrismaFindManyDelegate, orderBy: Record<string, string>, transformRow: (row: Record<string, unknown>) => Record<string, unknown>) {
  const generator = streamCSVRows(model, orderBy, transformRow);
  return Readable.from(generator);
}

// GET /api/export — stream all tables as a ZIP of CSVs (admin only)
router.get('/', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const date = new Date().toISOString().slice(0, 10);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="sering-backup-${date}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => {
    console.error('Archive error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Export failed', code: 'INTERNAL_ERROR' });
    } else {
      res.destroy();
    }
  });
  archive.pipe(res);

  const identity = (r: Record<string, unknown>) => r;
  const stripScreenshot = ({ screenshotData, ...rest }: Record<string, unknown>) => ({
    ...rest,
    hasScreenshot: !!screenshotData,
  });

  archive.append(csvReadable(prisma.group as unknown as PrismaFindManyDelegate, { order: 'asc' }, identity), { name: 'groups.csv' });
  archive.append(csvReadable(prisma.project as unknown as PrismaFindManyDelegate, { createdAt: 'asc' }, identity), { name: 'projects.csv' });
  archive.append(csvReadable(prisma.task as unknown as PrismaFindManyDelegate, { createdAt: 'asc' }, identity), { name: 'tasks.csv' });
  archive.append(csvReadable(prisma.announcement as unknown as PrismaFindManyDelegate, { createdAt: 'asc' }, identity), { name: 'announcements.csv' });
  archive.append(csvReadable(prisma.comment as unknown as PrismaFindManyDelegate, { createdAt: 'asc' }, identity), { name: 'comments.csv' });
  archive.append(csvReadable(prisma.shoppingItem as unknown as PrismaFindManyDelegate, { createdAt: 'asc' }, identity), { name: 'shopping_items.csv' });
  archive.append(csvReadable(prisma.media as unknown as PrismaFindManyDelegate, { createdAt: 'asc' }, identity), { name: 'media.csv' });
  archive.append(csvReadable(prisma.report as unknown as PrismaFindManyDelegate, { createdAt: 'asc' }, stripScreenshot), { name: 'reports.csv' });

  await archive.finalize();
}));

export default router;
