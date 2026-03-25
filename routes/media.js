const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { parentType, parentId } = req.body;
    const dir = path.join(__dirname, '..', 'uploads', parentType || 'misc', parentId || 'unknown');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (req, file, cb) => {
    // Allow images and audio
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image and audio files are allowed'));
    }
  }
});

// Upload media (anyone can upload — attached to comments, etc.)
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { parentType, parentId } = req.body;
  if (!parentType || !parentId) {
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'parentType and parentId are required' });
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
  const media = await prisma.media.findUnique({ where: { id: req.params.id } });
  if (!media) return res.status(404).json({ error: 'Media not found' });

  const filePath = path.join(__dirname, '..', 'uploads', media.parentType, media.parentId, media.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

  res.sendFile(filePath);
});

// Delete media (admin only)
router.delete('/:id', requireAdmin, async (req, res) => {
  const media = await prisma.media.findUnique({ where: { id: req.params.id } });
  if (!media) return res.status(404).json({ error: 'Media not found' });

  const filePath = path.join(__dirname, '..', 'uploads', media.parentType, media.parentId, media.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  await prisma.media.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
