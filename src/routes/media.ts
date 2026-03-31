import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';

// Multer file type for req.file
interface MulterFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  filename: string;
  path: string;
  destination: string;
}
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import prisma from '../lib/db.js';
import { requireAdmin } from './auth.js';
import asyncHandler from '../lib/async-handler.js';
import { deleteMediaFile } from '../lib/media-utils.js';
import { validateId } from '../lib/validate.js';
import { sendError, handleZodError } from '../lib/errors.js';
import { mediaCreate, mediaBatch } from '../lib/schemas.js';
import {
  MAX_IMAGE_SIZE_BYTES, MAX_VOICE_SIZE_BYTES, MAX_STORAGE_BYTES,
} from '../lib/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Configure multer for file uploads — save to a flat directory
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => cb(null, uploadsDir),
  filename: (_req: any, _file: any, cb: any) => {
    const ext = path.extname(_file.originalname) || '';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

// Allowed file extensions — prevents uploading .html, .js, .svg etc.
const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif',  // images
  '.webm', '.ogg', '.mp3', '.m4a', '.wav',                     // audio
]);

const upload = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
  fileFilter: (_req: any, file: any, cb: any) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeOk = file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/');
    const extOk = ALLOWED_EXTENSIONS.has(ext);
    if (mimeOk && extOk) {
      cb(null, true);
    } else {
      cb(new Error('Only image and audio files are allowed'));
    }
  },
});

// In-memory storage cache — initialized from DB on first use, re-synced periodically
let cachedStorageUsed: number | null = null;
let storageCacheTime = 0;
const STORAGE_CACHE_TTL = 5 * 60 * 1000;

async function getTotalStorageUsed(): Promise<number> {
  const now = Date.now();
  if (cachedStorageUsed !== null && now - storageCacheTime < STORAGE_CACHE_TTL) {
    return cachedStorageUsed;
  }
  const result = await prisma.media.aggregate({ _sum: { sizeBytes: true } });
  cachedStorageUsed = Number(result._sum.sizeBytes ?? 0);
  storageCacheTime = now;
  return cachedStorageUsed;
}

function cleanupFile(file: MulterFile | undefined) {
  try { if (file?.path) fs.unlinkSync(file.path); } catch { /* ignore */ }
}

// Upload media — requires admin session OR uploaderName in body
router.post('/', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const file = (req as any).file as MulterFile | undefined;
  if (!file) return sendError(res, 'VALIDATION_ERROR', 'No file uploaded');

  const isAdmin = req.session?.admin;
  const uploaderName = req.body.uploaderName;

  if (!isAdmin && !uploaderName) {
    cleanupFile(file);
    return sendError(res, 'UNAUTHORIZED', 'Please enter your name before uploading');
  }

  // Validate parentType + parentId via Zod
  let parsed: any;
  try {
    parsed = mediaCreate.parse(req.body);
  } catch (err) {
    cleanupFile(file);
    if (handleZodError(err, res)) return;
    throw err;
  }

  // Verify parent entity exists
  const parentModelMap: Record<string, string> = { task: 'task', project: 'project', announcement: 'announcement', comment: 'comment' };
  const parentModel = parentModelMap[parsed.parentType];
  if (parentModel) {
    const parent = await (prisma as any)[parentModel].findUnique({ where: { id: parsed.parentId }, select: { id: true } });
    if (!parent) {
      cleanupFile(file);
      return sendError(res, 'NOT_FOUND', `Parent ${parsed.parentType} not found`);
    }
  }

  // Enforce voice note size limit
  if (file.mimetype.startsWith('audio/') && file.size > MAX_VOICE_SIZE_BYTES) {
    cleanupFile(file);
    return sendError(res, 'VALIDATION_ERROR', 'Voice notes must be under 2MB (about 60 seconds)');
  }

  const type = file.mimetype.startsWith('image/') ? 'photo' : 'voice';

  // Atomic storage cap check + insert inside a serializable transaction
  let media;
  try {
    media = await prisma.$transaction(async (tx: any) => {
      const result = await tx.media.aggregate({ _sum: { sizeBytes: true } });
      const totalUsed = result._sum.sizeBytes || 0;
      if (totalUsed + file.size > MAX_STORAGE_BYTES) {
        throw new Error('STORAGE_LIMIT');
      }
      return tx.media.create({
        data: {
          parentType: parsed.parentType,
          parentId: parsed.parentId,
          type,
          filename: file.filename,
          originalName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
        },
      });
    }, { isolationLevel: 'Serializable' });
  } catch (err: any) {
    if (err.message === 'STORAGE_LIMIT') {
      cleanupFile(file);
      return res.status(507).json({ error: 'Storage limit reached. Contact an admin.', code: 'INTERNAL_ERROR' });
    }
    throw err;
  }

  if (cachedStorageUsed !== null) cachedStorageUsed += file.size;

  res.status(201).json(media);
}));

// List media for a parent
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  let parsed: any;
  try {
    parsed = mediaCreate.parse({ parentType: req.query.parentType, parentId: req.query.parentId });
  } catch (err) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  const media = await prisma.media.findMany({
    where: { parentType: parsed.parentType, parentId: parsed.parentId },
    orderBy: { createdAt: 'asc' },
  });
  res.json(media);
}));

// Batch-fetch media for multiple parents (avoids N+1 on dashboard)
export const batchHandler = asyncHandler(async (req: Request, res: Response) => {
  let parsed: any;
  try {
    parsed = mediaBatch.parse({ parentType: req.query.parentType, parentIds: req.query.parentIds || '' });
  } catch (err) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  const media = await prisma.media.findMany({
    where: { parentType: parsed.parentType, parentId: { in: parsed.parentIds } },
    orderBy: { createdAt: 'asc' },
  });

  const grouped: Record<string, any[]> = {};
  for (const m of media) {
    if (!grouped[m.parentId]) grouped[m.parentId] = [];
    grouped[m.parentId]!.push(m);
  }
  res.json(grouped);
});

// Serve a media file
router.get('/:id/file', validateId, asyncHandler(async (req: Request, res: Response) => {
  const media = await prisma.media.findUnique({ where: { id: req.params.id } });
  if (!media) return sendError(res, 'NOT_FOUND', 'Media not found');

  const safeFilename = path.basename(media.filename);
  const resolvedUploads = path.resolve(uploadsDir);

  const candidates = [
    path.resolve(uploadsDir, safeFilename),
    path.resolve(uploadsDir, media.parentType, media.parentId, safeFilename),
    path.resolve(uploadsDir, 'misc', 'unknown', safeFilename),
  ];

  let filePath: string | null = null;
  for (const candidate of candidates) {
    if (!candidate.startsWith(resolvedUploads)) continue;
    if (fs.existsSync(candidate)) { filePath = candidate; break; }
  }

  if (!filePath) return sendError(res, 'NOT_FOUND', 'File not found on disk');

  res.set('Cache-Control', 'public, max-age=604800, immutable');
  res.set('Content-Type', media.mimeType);
  res.set('X-Content-Type-Options', 'nosniff');
  const safeInline = media.mimeType.startsWith('image/') || media.mimeType.startsWith('audio/');
  res.set('Content-Disposition', safeInline ? 'inline' : 'attachment');
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).json({ error: 'Failed to serve file', code: 'INTERNAL_ERROR' });
  });
  stream.pipe(res);
}));

// Delete media (admin only)
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const media = await prisma.media.findUnique({ where: { id: req.params.id } });
  if (!media) return sendError(res, 'NOT_FOUND', 'Media not found');

  await prisma.media.delete({ where: { id: req.params.id } });

  // Delete file from disk after DB record is removed
  await deleteMediaFile(media);

  if (cachedStorageUsed !== null) {
    cachedStorageUsed = Math.max(0, cachedStorageUsed - media.sizeBytes);
  }
  res.json({ ok: true });
}));

export default router;
