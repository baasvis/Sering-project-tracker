const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');

const router = Router();

// Configure multer for file uploads — save to a flat directory
// (req.body fields aren't available yet in destination when file comes first in FormData)
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
  limits: { fileSize: MAX_IMAGE_SIZE }, // 5MB max (covers both, voice is smaller)
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else if (file.mimetype.startsWith('audio/')) {
      // Voice notes get a stricter size check after upload (multer limits apply globally)
      cb(null, true);
    } else {
      cb(new Error('Only image and audio files are allowed'));
    }
  }
});

// Total storage cap: prevent abuse (100MB)
const STORAGE_CAP_BYTES = 100 * 1024 * 1024;

// Cache total storage used to avoid full table scan on every upload
let cachedStorageUsed = null;
let storageCacheTime = 0;
const STORAGE_CACHE_TTL = 60 * 1000; // 1 minute

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
router.post('/', upload.single('file'), async (req, res) => {
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
});

// List media for a parent
router.get('/', async (req, res) => {
  const { parentType, parentId } = req.query;
  if (!parentType || !parentId) {
    return res.status(400).json({ error: 'parentType and parentId required' });
  }

  const media = await prisma.media.findMany({
    where: { parentType, parentId },
    orderBy: { createdAt: 'asc' }
  });
  res.json(media);
});

// Serve a media file
router.get('/:id/file', async (req, res) => {
  try {
    const media = await prisma.media.findUnique({ where: { id: req.params.id } });
    if (!media) return res.status(404).json({ error: 'Media not found' });

    // Check multiple possible locations for the file:
    // 1. Flat directory (current layout)
    // 2. Nested by parent type/id (original design)
    // 3. misc/unknown (files uploaded before multer fix when parentType/parentId weren't available)
    let filePath = path.resolve(uploadsDir, media.filename);
    if (!fs.existsSync(filePath)) {
      filePath = path.resolve(uploadsDir, media.parentType, media.parentId, media.filename);
    }
    if (!fs.existsSync(filePath)) {
      filePath = path.resolve(uploadsDir, 'misc', 'unknown', media.filename);
    }
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

    res.set('Cache-Control', 'public, max-age=604800, immutable');
    res.set('Content-Type', media.mimeType);
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).json({ error: 'Failed to serve file' });
    });
    stream.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  }
});

// Delete media (admin only)
router.delete('/:id', requireAdmin, async (req, res) => {
  const media = await prisma.media.findUnique({ where: { id: req.params.id } });
  if (!media) return res.status(404).json({ error: 'Media not found' });

  // Check all possible file locations
  let filePath = path.join(uploadsDir, media.filename);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(uploadsDir, media.parentType, media.parentId, media.filename);
  }
  if (!fs.existsSync(filePath)) {
    filePath = path.join(uploadsDir, 'misc', 'unknown', media.filename);
  }
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  // Invalidate storage cache on delete
  cachedStorageUsed = null;

  await prisma.media.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
