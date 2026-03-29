const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');
const asyncHandler = require('../lib/async-handler');
const { deleteMediaFile } = require('../lib/media-utils');
const { validateId, isValidUuid } = require('../lib/validate');
const { sendError, handleZodError } = require('../lib/errors');
const { mediaCreate, mediaBatch } = require('../lib/schemas');
const {
  MAX_IMAGE_SIZE_BYTES, MAX_VOICE_SIZE_BYTES, MAX_STORAGE_BYTES,
} = require('../lib/config');

const router = Router();

// Configure multer for file uploads — save to a flat directory
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

// Allowed file extensions — prevents uploading .html, .js, .svg etc.
const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif',  // images
  '.webm', '.ogg', '.mp3', '.m4a', '.wav',                     // audio
]);

const upload = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeOk = file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/');
    const extOk = ALLOWED_EXTENSIONS.has(ext);
    if (mimeOk && extOk) {
      cb(null, true);
    } else {
      cb(new Error('Only image and audio files are allowed'));
    }
  }
});

// In-memory storage cache — initialized from DB on first use, re-synced periodically
let cachedStorageUsed = null;
let storageCacheTime = 0;
const STORAGE_CACHE_TTL = 5 * 60 * 1000;

async function getTotalStorageUsed() {
  const now = Date.now();
  if (cachedStorageUsed !== null && now - storageCacheTime < STORAGE_CACHE_TTL) {
    return cachedStorageUsed;
  }
  const result = await prisma.media.aggregate({ _sum: { sizeBytes: true } });
  cachedStorageUsed = result._sum.sizeBytes || 0;
  storageCacheTime = now;
  return cachedStorageUsed;
}

function cleanupFile(file) {
  try { if (file?.path) fs.unlinkSync(file.path); } catch { /* ignore */ }
}

// Upload media — requires admin session OR uploaderName in body
router.post('/', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return sendError(res, 'VALIDATION_ERROR', 'No file uploaded');

  const isAdmin = req.session?.admin;
  const uploaderName = req.body.uploaderName;

  if (!isAdmin && !uploaderName) {
    cleanupFile(req.file);
    return sendError(res, 'UNAUTHORIZED', 'Please enter your name before uploading');
  }

  // Validate parentType + parentId via Zod
  let parsed;
  try {
    parsed = mediaCreate.parse(req.body);
  } catch (err) {
    cleanupFile(req.file);
    if (handleZodError(err, res)) return;
    throw err;
  }

  // Verify parent entity exists
  const parentModel = { task: 'task', project: 'project', announcement: 'announcement', comment: 'comment' }[parsed.parentType];
  if (parentModel) {
    const parent = await prisma[parentModel].findUnique({ where: { id: parsed.parentId }, select: { id: true } });
    if (!parent) {
      cleanupFile(req.file);
      return sendError(res, 'NOT_FOUND', `Parent ${parsed.parentType} not found`);
    }
  }

  // Enforce voice note size limit
  if (req.file.mimetype.startsWith('audio/') && req.file.size > MAX_VOICE_SIZE_BYTES) {
    cleanupFile(req.file);
    return sendError(res, 'VALIDATION_ERROR', 'Voice notes must be under 2MB (about 60 seconds)');
  }

  const type = req.file.mimetype.startsWith('image/') ? 'photo' : 'voice';

  // Atomic storage cap check + insert inside a serializable transaction
  let media;
  try {
    media = await prisma.$transaction(async (tx) => {
      const result = await tx.media.aggregate({ _sum: { sizeBytes: true } });
      const totalUsed = result._sum.sizeBytes || 0;
      if (totalUsed + req.file.size > MAX_STORAGE_BYTES) {
        throw new Error('STORAGE_LIMIT');
      }
      return tx.media.create({
        data: {
          parentType: parsed.parentType,
          parentId: parsed.parentId,
          type,
          filename: req.file.filename,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size
        }
      });
    }, { isolationLevel: 'Serializable' });
  } catch (err) {
    if (err.message === 'STORAGE_LIMIT') {
      cleanupFile(req.file);
      return res.status(507).json({ error: 'Storage limit reached. Contact an admin.', code: 'INTERNAL_ERROR' });
    }
    throw err;
  }

  if (cachedStorageUsed !== null) cachedStorageUsed += req.file.size;

  res.status(201).json(media);
}));

// List media for a parent
router.get('/', asyncHandler(async (req, res) => {
  let parsed;
  try {
    parsed = mediaCreate.parse({ parentType: req.query.parentType, parentId: req.query.parentId });
  } catch (err) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  const media = await prisma.media.findMany({
    where: { parentType: parsed.parentType, parentId: parsed.parentId },
    orderBy: { createdAt: 'asc' }
  });
  res.json(media);
}));

// Batch-fetch media for multiple parents (avoids N+1 on dashboard)
const batchHandler = asyncHandler(async (req, res) => {
  let parsed;
  try {
    parsed = mediaBatch.parse({ parentType: req.query.parentType, parentIds: req.query.parentIds || '' });
  } catch (err) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  const media = await prisma.media.findMany({
    where: { parentType: parsed.parentType, parentId: { in: parsed.parentIds } },
    orderBy: { createdAt: 'asc' }
  });

  const grouped = {};
  for (const m of media) {
    if (!grouped[m.parentId]) grouped[m.parentId] = [];
    grouped[m.parentId].push(m);
  }
  res.json(grouped);
});
router.batchHandler = batchHandler;

// Serve a media file
router.get('/:id/file', validateId, asyncHandler(async (req, res) => {
  const media = await prisma.media.findUnique({ where: { id: req.params.id } });
  if (!media) return sendError(res, 'NOT_FOUND', 'Media not found');

  const safeFilename = path.basename(media.filename);
  const resolvedUploads = path.resolve(uploadsDir);

  const candidates = [
    path.resolve(uploadsDir, safeFilename),
    path.resolve(uploadsDir, media.parentType, media.parentId, safeFilename),
    path.resolve(uploadsDir, 'misc', 'unknown', safeFilename),
  ];

  let filePath = null;
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
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  const media = await prisma.media.findUnique({ where: { id: req.params.id } });
  if (!media) return sendError(res, 'NOT_FOUND', 'Media not found');

  await prisma.media.delete({ where: { id: req.params.id } });

  // Delete file from disk after DB record is removed
  deleteMediaFile(media);

  if (cachedStorageUsed !== null) {
    cachedStorageUsed = Math.max(0, cachedStorageUsed - media.sizeBytes);
  }
  res.json({ ok: true });
}));

module.exports = router;
