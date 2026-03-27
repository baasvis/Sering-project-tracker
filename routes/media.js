const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');
const asyncHandler = require('../lib/async-handler');
const { deleteMediaFile } = require('../lib/media-utils');
const { validateId, isValidUuid } = require('../lib/validate');

const router = Router();

const VALID_PARENT_TYPES = ['task', 'project', 'announcement', 'comment'];

// Configure multer for file uploads — save to a flat directory
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${uuidv4()}${ext}`);
  }
});

// File size limits: 5MB for images, 2MB for voice notes
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_VOICE_SIZE = 2 * 1024 * 1024;

const upload = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image and audio files are allowed'));
    }
  }
});

// Total storage cap: prevent abuse (100MB)
const STORAGE_CAP_BYTES = 100 * 1024 * 1024;

// Atomic storage counter — initialized from DB on first use, then maintained in-memory.
// Avoids full table scan on every upload. Race-safe: even if two concurrent uploads
// both read the same initial value, the counter only drifts by one file size — acceptable
// since the DB is the source of truth and we re-sync periodically.
let cachedStorageUsed = null;
let storageCacheTime = 0;
const STORAGE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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

// Upload media — requires admin session OR uploaderName in body
router.post('/', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const isAdmin = req.session && req.session.admin;
  const uploaderName = req.body.uploaderName;

  // Require identity: either admin or a visitor name
  if (!isAdmin && !uploaderName) {
    fs.unlinkSync(req.file.path);
    return res.status(401).json({ error: 'Please enter your name before uploading' });
  }

  const { parentType, parentId } = req.body;
  if (!parentType || !parentId) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'parentType and parentId are required' });
  }
  if (!VALID_PARENT_TYPES.includes(parentType)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: `Invalid parentType. Must be one of: ${VALID_PARENT_TYPES.join(', ')}` });
  }
  if (!isValidUuid(parentId)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Invalid parentId format' });
  }

  // Enforce voice note size limit (2MB)
  if (req.file.mimetype.startsWith('audio/') && req.file.size > MAX_VOICE_SIZE) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Voice notes must be under 2MB (about 60 seconds)' });
  }

  // Check total storage used (cached, simple abuse prevention)
  const totalUsed = await getTotalStorageUsed();
  if (totalUsed + req.file.size > STORAGE_CAP_BYTES) {
    fs.unlinkSync(req.file.path);
    return res.status(507).json({ error: 'Storage limit reached. Contact an admin.' });
  }

  const type = req.file.mimetype.startsWith('image/') ? 'photo' : 'voice';

  const media = await prisma.media.create({
    data: {
      parentType,
      parentId,
      type,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size
    }
  });

  // Update cached storage total
  if (cachedStorageUsed !== null) cachedStorageUsed += req.file.size;

  res.status(201).json(media);
}));

// List media for a parent
router.get('/', asyncHandler(async (req, res) => {
  const { parentType, parentId } = req.query;
  if (!parentType || !parentId) {
    return res.status(400).json({ error: 'parentType and parentId required' });
  }
  if (!VALID_PARENT_TYPES.includes(parentType)) {
    return res.status(400).json({ error: 'Invalid parentType' });
  }
  if (!isValidUuid(parentId)) {
    return res.status(400).json({ error: 'Invalid parentId format' });
  }

  const media = await prisma.media.findMany({
    where: { parentType, parentId },
    orderBy: { createdAt: 'asc' }
  });
  res.json(media);
}));

// Batch-fetch media for multiple parents (avoids N+1 on dashboard)
// Exported as router.batchHandler for app-level mounting (Express 5 compatibility)
const batchHandler = asyncHandler(async (req, res) => {
  const { parentType, parentIds } = req.query;
  if (!parentType || !parentIds) {
    return res.status(400).json({ error: 'parentType and parentIds required' });
  }
  if (!VALID_PARENT_TYPES.includes(parentType)) {
    return res.status(400).json({ error: 'Invalid parentType' });
  }

  const ids = parentIds.split(',').filter(id => isValidUuid(id)).slice(0, 100);
  if (ids.length === 0) {
    return res.json({});
  }

  const media = await prisma.media.findMany({
    where: { parentType, parentId: { in: ids } },
    orderBy: { createdAt: 'asc' }
  });

  // Group by parentId
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
  if (!media) return res.status(404).json({ error: 'Media not found' });

  // Validate filename to prevent path traversal — use basename only
  const safeFilename = path.basename(media.filename);
  const resolvedUploads = path.resolve(uploadsDir);

  // Check multiple possible locations for the file, validating each
  const candidates = [
    path.resolve(uploadsDir, safeFilename),
    path.resolve(uploadsDir, media.parentType, media.parentId, safeFilename),
    path.resolve(uploadsDir, 'misc', 'unknown', safeFilename),
  ];

  let filePath = null;
  for (const candidate of candidates) {
    // Path traversal guard: every candidate must resolve within uploads dir
    if (!candidate.startsWith(resolvedUploads)) continue;
    if (fs.existsSync(candidate)) { filePath = candidate; break; }
  }

  if (!filePath) return res.status(404).json({ error: 'File not found on disk' });

  res.set('Cache-Control', 'public, max-age=604800, immutable');
  res.set('Content-Type', media.mimeType);
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).json({ error: 'Failed to serve file' });
  });
  stream.pipe(res);
}));

// Delete media (admin only)
router.delete('/:id', validateId, requireAdmin, asyncHandler(async (req, res) => {
  const media = await prisma.media.findUnique({ where: { id: req.params.id } });
  if (!media) return res.status(404).json({ error: 'Media not found' });

  deleteMediaFile(media);

  // Decrement storage counter (atomic counter approach — no full DB scan)
  if (cachedStorageUsed !== null) {
    cachedStorageUsed = Math.max(0, cachedStorageUsed - media.sizeBytes);
  }

  await prisma.media.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

module.exports = router;
