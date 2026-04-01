import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import prisma, { getPrismaDelegate } from '../lib/db.js';
import type { PrismaModelName, TransactionClient } from '../lib/db.js';
import { requireAdmin } from './auth.js';
import asyncHandler from '../lib/async-handler.js';
import { deleteMediaFile } from '../lib/media-utils.js';
import { validateId } from '../lib/validate.js';
import { sendError, handleZodError } from '../lib/errors.js';
import { logAction } from '../lib/audit.js';
import { broadcast, getMutationId } from '../lib/sse.js';
import { z } from 'zod';
import { mediaCreate, mediaBatch } from '../lib/schemas.js';
import type { MediaCreate, MediaParentTypeType } from '../lib/schemas.js';
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
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, _file, cb) => {
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
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // Block dangerous MIME types that pass startsWith('image/') — SVG can embed JavaScript
    const BLOCKED_MIMES = new Set(['image/svg+xml', 'image/svg', 'text/xml', 'application/xml']);
    if (BLOCKED_MIMES.has(file.mimetype)) {
      return cb(new Error('SVG and XML files are not allowed'));
    }
    const mimeOk = file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/');
    // Allow files with no extension (common on mobile) if MIME type is valid
    const extOk = ext === '' || ALLOWED_EXTENSIONS.has(ext);
    if (mimeOk && extOk) {
      cb(null, true);
    } else {
      cb(new Error('Only image and audio files are allowed'));
    }
  },
});

// Wraps multer to return proper 400 errors instead of letting them fall through to the 500 handler
function handleUpload(req: Request, res: Response, next: (err?: unknown) => void) {
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return sendError(res, 'VALIDATION_ERROR', `File too large (max ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB)`);
      }
      return sendError(res, 'VALIDATION_ERROR', err.message);
    }
    if (err instanceof Error) {
      return sendError(res, 'VALIDATION_ERROR', err.message);
    }
    next();
  });
}

// Map parentType values to Prisma delegate names
const parentModelMap: Record<string, PrismaModelName> = {
  task: 'task',
  project: 'project',
  announcement: 'announcement',
  comment: 'comment',
};

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

function cleanupFile(file: Express.Multer.File | undefined) {
  try { if (file?.path) fs.unlinkSync(file.path); } catch { /* ignore */ }
}

// Upload media — requires admin session OR uploaderName in body
router.post('/', handleUpload, asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) return sendError(res, 'VALIDATION_ERROR', 'No file uploaded');

  const isAdmin = req.session?.admin;
  const uploaderName = req.body.uploaderName;

  if (!isAdmin && !uploaderName) {
    cleanupFile(file);
    return sendError(res, 'UNAUTHORIZED', 'Please enter your name before uploading');
  }

  // Validate parentType + parentId via Zod
  let parsed: MediaCreate;
  try {
    parsed = mediaCreate.parse(req.body);
  } catch (err: unknown) {
    cleanupFile(file);
    if (handleZodError(err, res)) return;
    throw err;
  }

  // Verify parent entity exists
  const modelName = parentModelMap[parsed.parentType];
  if (modelName) {
    const delegate = getPrismaDelegate(modelName);
    const parent = await (delegate as typeof prisma.project).findUnique({
      where: { id: parsed.parentId },
      select: { id: true },
    });
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
    media = await prisma.$transaction(async (tx: TransactionClient) => {
      const result = await tx.media.aggregate({ _sum: { sizeBytes: true } });
      const totalUsed = result._sum.sizeBytes || 0;
      if (Number(totalUsed) + file.size > MAX_STORAGE_BYTES) {
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
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'STORAGE_LIMIT') {
      cleanupFile(file);
      return res.status(507).json({ error: 'Storage limit reached. Contact an admin.', code: 'INTERNAL_ERROR' });
    }
    throw err;
  }

  if (cachedStorageUsed !== null) cachedStorageUsed += file.size;

  res.status(201).json(media);
  logAction(req, 'media:uploaded', 'media', media.id, { parentType: parsed.parentType, parentId: parsed.parentId });
  broadcast('media:created', { media, parentType: parsed.parentType, parentId: parsed.parentId }, getMutationId(req));
}));

// List media for a parent
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  let parsed: MediaCreate;
  try {
    parsed = mediaCreate.parse({ parentType: req.query.parentType, parentId: req.query.parentId });
  } catch (err: unknown) {
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
  let parsed: z.infer<typeof mediaBatch>;
  try {
    parsed = mediaBatch.parse({ parentType: req.query.parentType, parentIds: req.query.parentIds || '' });
  } catch (err: unknown) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  const media = await prisma.media.findMany({
    where: { parentType: parsed.parentType as MediaParentTypeType, parentId: { in: parsed.parentIds } },
    orderBy: { createdAt: 'asc' },
  });

  const grouped: Record<string, typeof media> = {};
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
  res.set('X-Content-Type-Options', 'nosniff');
  // Defense-in-depth: never serve SVG/XML inline (XSS vector)
  const dangerousMime = media.mimeType.includes('svg') || media.mimeType.includes('xml');
  if (dangerousMime) {
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', 'attachment');
  } else {
    res.set('Content-Type', media.mimeType);
    const safeInline = media.mimeType.startsWith('image/') || media.mimeType.startsWith('audio/');
    res.set('Content-Disposition', safeInline ? 'inline' : 'attachment');
  }
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
  logAction(req, 'media:deleted', 'media', req.params.id, { parentType: media.parentType, parentId: media.parentId });
  broadcast('media:deleted', { mediaId: req.params.id, parentType: media.parentType, parentId: media.parentId }, getMutationId(req));
}));

export default router;
