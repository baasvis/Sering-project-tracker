import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import prisma from '../lib/db.js';
import type { TransactionClient } from '../lib/db.js';
import { requireAdmin } from './auth.js';
import asyncHandler from '../lib/async-handler.js';
import { validateId } from '../lib/validate.js';
import { sendError, handleZodError, isPrismaNotFound } from '../lib/errors.js';
import { logAction } from '../lib/audit.js';
import { broadcast, getMutationId } from '../lib/sse.js';
import { sanitize } from '../lib/sanitize.js';
import {
  getTogetherLocationCreate, getTogetherLocationUpdate,
  getTogetherBlockCreate, getTogetherBlockUpdate,
  getTogetherSignupCreate, GetTogetherDay,
} from '../lib/schemas.js';
import type {
  GetTogetherLocationCreate, GetTogetherLocationUpdate,
  GetTogetherBlockCreate, GetTogetherBlockUpdate,
} from '../lib/schemas.js';
import { MAX_IMAGE_SIZE_BYTES } from '../lib/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..', '..');

const router = Router();

// ─── Helper: fetch block with includes for SSE payloads ────────────────────

async function fetchBlockWithIncludes(blockId: string) {
  const block = await prisma.getTogetherBlock.findUnique({
    where: { id: blockId },
    include: {
      location: true,
      signups: { select: { id: true, name: true } },
    },
  });
  if (!block) return null;

  // Attach project data if linked
  let project = null;
  if (block.projectId) {
    project = await prisma.project.findUnique({
      where: { id: block.projectId },
      select: { id: true, name: true, description: true, contactPerson: true },
    });
  }

  return {
    ...block,
    project,
    signupCount: block.signups.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LOCATIONS
// ═══════════════════════════════════════════════════════════════════════════

router.get('/locations', asyncHandler(async (_req: Request, res: Response) => {
  const locations = await prisma.getTogetherLocation.findMany({
    orderBy: { order: 'asc' },
  });
  res.json({ locations });
}));

router.post('/locations', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  let data: GetTogetherLocationCreate;
  try {
    data = getTogetherLocationCreate.parse(req.body);
  } catch (err: unknown) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  const location = await prisma.getTogetherLocation.create({
    data: {
      name: data.name,
      order: data.order ?? 0,
    },
  });
  res.status(201).json({ location });
  logAction(req, 'get-together:location-created', 'getTogetherLocation', location.id, { name: location.name });
  broadcast('get-together:location-created', { location }, getMutationId(req));
}));

router.patch('/locations/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  let data: GetTogetherLocationUpdate;
  try {
    data = getTogetherLocationUpdate.parse(req.body);
  } catch (err: unknown) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  try {
    const location = await prisma.getTogetherLocation.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ location });
    broadcast('get-together:location-updated', { location }, getMutationId(req));
  } catch (err: unknown) {
    if (isPrismaNotFound(err)) return sendError(res, 'NOT_FOUND', 'Location not found');
    throw err;
  }
}));

router.delete('/locations/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const blockCount = await prisma.getTogetherBlock.count({
    where: { locationId: req.params.id },
  });
  if (blockCount > 0) {
    return sendError(res, 'VALIDATION_ERROR', 'Cannot delete location with assigned blocks');
  }

  try {
    await prisma.getTogetherLocation.delete({ where: { id: req.params.id } });
  } catch (err: unknown) {
    if (isPrismaNotFound(err)) return sendError(res, 'NOT_FOUND', 'Location not found');
    throw err;
  }
  res.json({ ok: true });
  logAction(req, 'get-together:location-deleted', 'getTogetherLocation', req.params.id);
  broadcast('get-together:location-deleted', { locationId: req.params.id }, getMutationId(req));
}));

// ═══════════════════════════════════════════════════════════════════════════
// BLOCKS
// ═══════════════════════════════════════════════════════════════════════════

// List blocks (optionally filter by day)
router.get('/blocks', asyncHandler(async (req: Request, res: Response) => {
  const dayFilter = req.query.day as string | undefined;
  const where: Record<string, unknown> = {};
  if (dayFilter && (dayFilter === 'day1' || dayFilter === 'day2')) {
    where.day = dayFilter;
  }

  const blocks = await prisma.getTogetherBlock.findMany({
    where,
    include: {
      location: true,
      signups: { select: { id: true, name: true } },
    },
    orderBy: [{ day: 'asc' }, { startTime: 'asc' }],
  });

  // Batch-fetch linked projects
  const projectIds = [...new Set(blocks.map(b => b.projectId).filter(Boolean))] as string[];
  const projects = projectIds.length > 0
    ? await prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true, description: true, contactPerson: true },
      })
    : [];
  const projectMap = new Map(projects.map(p => [p.id, p]));

  const result = blocks.map(b => ({
    ...b,
    project: b.projectId ? (projectMap.get(b.projectId) || null) : null,
    signupCount: b.signups.length,
  }));

  res.json({ blocks: result });
}));

// Get single block with detail (tasks, shopping items, tool items)
router.get('/blocks/:id', validateId, asyncHandler(async (req: Request, res: Response) => {
  const block = await prisma.getTogetherBlock.findUnique({
    where: { id: req.params.id },
    include: {
      location: true,
      signups: { select: { id: true, name: true } },
    },
  });
  if (!block) return sendError(res, 'NOT_FOUND', 'Block not found');

  let project = null;
  let tasks: unknown[] = [];
  let shoppingItems: unknown[] = [];
  let toolItems: unknown[] = [];

  if (block.projectId) {
    project = await prisma.project.findUnique({
      where: { id: block.projectId },
      select: { id: true, name: true, description: true, contactPerson: true },
    });

    if (project) {
      // Fetch incomplete tasks, unpurchased shopping items, unavailable tool items
      [tasks, shoppingItems, toolItems] = await Promise.all([
        prisma.task.findMany({
          where: { projectId: block.projectId, status: { not: 'done' }, deletedAt: null },
          orderBy: { order: 'asc' },
        }),
        prisma.shoppingItem.findMany({
          where: { projectId: block.projectId, purchased: false, approved: true },
          orderBy: { order: 'asc' },
        }),
        prisma.toolItem.findMany({
          where: { projectId: block.projectId, available: false, approved: true },
          orderBy: { order: 'asc' },
        }),
      ]);
    }
  }

  res.json({
    block: {
      ...block,
      project: project || (block.projectId ? { id: block.projectId, name: '[Deleted project]', description: null, contactPerson: null } : null),
      signupCount: block.signups.length,
      tasks,
      shoppingItems,
      toolItems,
    },
  });
}));

// Create block (admin)
router.post('/blocks', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  let data: GetTogetherBlockCreate;
  try {
    data = getTogetherBlockCreate.parse(req.body);
  } catch (err: unknown) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  // Validate location exists
  const location = await prisma.getTogetherLocation.findUnique({ where: { id: data.locationId } });
  if (!location) return sendError(res, 'VALIDATION_ERROR', 'Location not found');

  // Validate project exists if linked
  if (data.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: data.projectId },
      select: { id: true, deletedAt: true, status: true },
    });
    if (!project || project.deletedAt) {
      return sendError(res, 'VALIDATION_ERROR', 'Project not found or deleted');
    }
  }

  // Sanitize description if provided
  const description = data.description ? sanitize(data.description) : null;

  const block = await prisma.getTogetherBlock.create({
    data: {
      locationId: data.locationId,
      day: data.day,
      startTime: data.startTime,
      endTime: data.endTime,
      projectId: data.projectId || null,
      title: data.title || null,
      description,
      signupCap: data.signupCap ?? null,
    },
    include: {
      location: true,
      signups: { select: { id: true, name: true } },
    },
  });

  // Attach project for SSE payload
  let project = null;
  if (block.projectId) {
    project = await prisma.project.findUnique({
      where: { id: block.projectId },
      select: { id: true, name: true, description: true, contactPerson: true },
    });
  }

  const payload = { ...block, project, signupCount: 0 };
  res.status(201).json({ block: payload });
  logAction(req, 'get-together:block-created', 'getTogetherBlock', block.id, { title: data.title || 'linked project' });
  broadcast('get-together:block-created', { block: payload }, getMutationId(req));
}));

// Update block (admin)
router.patch('/blocks/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  let data: GetTogetherBlockUpdate;
  try {
    data = getTogetherBlockUpdate.parse(req.body);
  } catch (err: unknown) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  // Validate location if changing
  if (data.locationId) {
    const location = await prisma.getTogetherLocation.findUnique({ where: { id: data.locationId } });
    if (!location) return sendError(res, 'VALIDATION_ERROR', 'Location not found');
  }

  // Validate project if changing
  if (data.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: data.projectId },
      select: { id: true, deletedAt: true },
    });
    if (!project || project.deletedAt) {
      return sendError(res, 'VALIDATION_ERROR', 'Project not found or deleted');
    }
  }

  if (data.description !== undefined) {
    data.description = data.description ? sanitize(data.description) : null;
  }

  try {
    await prisma.getTogetherBlock.update({
      where: { id: req.params.id },
      data: data as Record<string, unknown>,
    });
  } catch (err: unknown) {
    if (isPrismaNotFound(err)) return sendError(res, 'NOT_FOUND', 'Block not found');
    throw err;
  }

  const result = await fetchBlockWithIncludes(req.params.id);
  res.json({ block: result });
  broadcast('get-together:block-updated', { block: result }, getMutationId(req));
}));

// Delete block (admin) — cascades to signups
router.delete('/blocks/:id', validateId, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  try {
    await prisma.getTogetherBlock.delete({ where: { id: req.params.id } });
  } catch (err: unknown) {
    if (isPrismaNotFound(err)) return sendError(res, 'NOT_FOUND', 'Block not found');
    throw err;
  }
  res.json({ ok: true });
  logAction(req, 'get-together:block-deleted', 'getTogetherBlock', req.params.id);
  broadcast('get-together:block-deleted', { blockId: req.params.id }, getMutationId(req));
}));

// ═══════════════════════════════════════════════════════════════════════════
// SIGN-UPS (no admin required)
// ═══════════════════════════════════════════════════════════════════════════

router.post('/blocks/:id/signup', validateId, asyncHandler(async (req: Request, res: Response) => {
  let parsed: { name: string };
  try {
    parsed = getTogetherSignupCreate.parse(req.body);
  } catch (err: unknown) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  const block = await prisma.getTogetherBlock.findUnique({
    where: { id: req.params.id },
    select: { id: true, signupCap: true },
  });
  if (!block) return sendError(res, 'NOT_FOUND', 'Block not found');

  // Transaction: check cap + check duplicate + insert atomically
  let signup;
  let signupCount: number;
  try {
    const result = await prisma.$transaction(async (tx: TransactionClient) => {
      const currentCount = await tx.getTogetherSignup.count({ where: { blockId: block.id } });

      if (block.signupCap !== null && currentCount >= block.signupCap) {
        throw new Error('BLOCK_FULL');
      }

      // Check if already signed up (the unique constraint would catch this too,
      // but we want a friendlier error message)
      const existing = await tx.getTogetherSignup.findUnique({
        where: { blockId_name: { blockId: block.id, name: parsed.name } },
      });
      if (existing) throw new Error('ALREADY_SIGNED_UP');

      const newSignup = await tx.getTogetherSignup.create({
        data: { blockId: block.id, name: parsed.name },
      });

      const newCount = await tx.getTogetherSignup.count({ where: { blockId: block.id } });
      return { signup: newSignup, signupCount: newCount };
    });
    signup = result.signup;
    signupCount = result.signupCount;
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === 'BLOCK_FULL') return sendError(res, 'CONFLICT', 'Block is full');
      if (err.message === 'ALREADY_SIGNED_UP') return sendError(res, 'CONFLICT', 'Already signed up');
    }
    throw err;
  }

  res.status(201).json({ signup });
  broadcast('get-together:signup-added', {
    blockId: block.id,
    signup: { id: signup.id, name: signup.name },
    signupCount,
  }, getMutationId(req));
}));

router.delete('/blocks/:id/signup', validateId, asyncHandler(async (req: Request, res: Response) => {
  let parsed: { name: string };
  try {
    parsed = getTogetherSignupCreate.parse(req.body);
  } catch (err: unknown) {
    if (handleZodError(err, res)) return;
    throw err;
  }

  const signup = await prisma.getTogetherSignup.findUnique({
    where: { blockId_name: { blockId: req.params.id, name: parsed.name } },
  });
  if (!signup) return sendError(res, 'NOT_FOUND', 'Signup not found');

  await prisma.getTogetherSignup.delete({ where: { id: signup.id } });

  const signupCount = await prisma.getTogetherSignup.count({ where: { blockId: req.params.id } });

  res.json({ ok: true });
  broadcast('get-together:signup-removed', {
    blockId: req.params.id,
    name: parsed.name,
    signupCount,
  }, getMutationId(req));
}));

// ═══════════════════════════════════════════════════════════════════════════
// PREP OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════

router.get('/prep', asyncHandler(async (_req: Request, res: Response) => {
  // 1. Find all blocks with a project linked
  const linkedBlocks = await prisma.getTogetherBlock.findMany({
    where: { projectId: { not: null } },
    select: { projectId: true, day: true, startTime: true },
    orderBy: [{ day: 'asc' }, { startTime: 'asc' }],
  });

  // 2. Group by projectId, determine earliest day per project
  const projectDayMap = new Map<string, string>();
  for (const block of linkedBlocks) {
    if (block.projectId && !projectDayMap.has(block.projectId)) {
      projectDayMap.set(block.projectId, block.day);
    }
  }

  const projectIds = [...projectDayMap.keys()];
  if (projectIds.length === 0) {
    return res.json({
      day1: { tasks: [], shoppingItems: [], toolItems: [] },
      day2: { tasks: [], shoppingItems: [], toolItems: [] },
    });
  }

  // 3. Fetch project names + items in parallel
  const [projects, tasks, shoppingItems, toolItems] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true },
    }),
    prisma.task.findMany({
      where: { projectId: { in: projectIds }, status: { not: 'done' }, deletedAt: null },
      orderBy: [{ projectId: 'asc' }, { name: 'asc' }],
    }),
    prisma.shoppingItem.findMany({
      where: { projectId: { in: projectIds }, purchased: false, approved: true },
      orderBy: [{ projectId: 'asc' }, { name: 'asc' }],
    }),
    prisma.toolItem.findMany({
      where: { projectId: { in: projectIds }, available: false, approved: true },
      orderBy: [{ projectId: 'asc' }, { name: 'asc' }],
    }),
  ]);

  const projectNameMap = new Map(projects.map(p => [p.id, p.name]));

  type PrepResult = {
    tasks: (typeof tasks[number] & { projectName: string })[];
    shoppingItems: (typeof shoppingItems[number] & { projectName: string })[];
    toolItems: (typeof toolItems[number] & { projectName: string })[];
  };

  const result: { day1: PrepResult; day2: PrepResult } = {
    day1: { tasks: [], shoppingItems: [], toolItems: [] },
    day2: { tasks: [], shoppingItems: [], toolItems: [] },
  };

  for (const task of tasks) {
    const day = projectDayMap.get(task.projectId) || 'day1';
    const bucket = day === 'day2' ? result.day2 : result.day1;
    bucket.tasks.push({ ...task, projectName: projectNameMap.get(task.projectId) || 'Unknown' });
  }
  for (const item of shoppingItems) {
    const day = projectDayMap.get(item.projectId) || 'day1';
    const bucket = day === 'day2' ? result.day2 : result.day1;
    bucket.shoppingItems.push({ ...item, projectName: projectNameMap.get(item.projectId) || 'Unknown' });
  }
  for (const item of toolItems) {
    const day = projectDayMap.get(item.projectId) || 'day1';
    const bucket = day === 'day2' ? result.day2 : result.day1;
    bucket.toolItems.push({ ...item, projectName: projectNameMap.get(item.projectId) || 'Unknown' });
  }

  res.json(result);
}));

// ═══════════════════════════════════════════════════════════════════════════
// MAP (static floor map image)
// ═══════════════════════════════════════════════════════════════════════════

const mapDir = path.join(projectRoot, 'uploads', 'get-together', 'map');

const mapStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(mapDir)) fs.mkdirSync(mapDir, { recursive: true });
    cb(null, mapDir);
  },
  filename: (_req, _file, cb) => {
    const ext = path.extname(_file.originalname) || '.jpg';
    cb(null, `floor-map${ext}`);
  },
});

const BLOCKED_MIMES = new Set(['image/svg+xml', 'image/svg', 'text/xml', 'application/xml']);

const mapUpload = multer({
  storage: mapStorage,
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (BLOCKED_MIMES.has(file.mimetype)) {
      return cb(new Error('SVG and XML files are not allowed'));
    }
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

router.get('/map', (_req: Request, res: Response) => {
  if (!fs.existsSync(mapDir)) return res.json({ url: null });
  const files = fs.readdirSync(mapDir).filter(f => f.startsWith('floor-map'));
  if (files.length === 0) return res.json({ url: null });
  res.json({ url: `/uploads/get-together/map/${files[0]}` });
});

router.post('/map', requireAdmin, (req: Request, res: Response, next) => {
  mapUpload.single('file')(req, res, (err: unknown) => {
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
}, asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) return sendError(res, 'VALIDATION_ERROR', 'No file uploaded');

  // Remove any previous map files with different extensions
  const existingFiles = fs.readdirSync(mapDir).filter(f => f.startsWith('floor-map'));
  for (const f of existingFiles) {
    const fullPath = path.join(mapDir, f);
    if (fullPath !== file.path) {
      try { fs.unlinkSync(fullPath); } catch { /* ignore */ }
    }
  }

  const url = `/uploads/get-together/map/${file.filename}`;
  res.status(201).json({ url });
  logAction(req, 'get-together:map-uploaded', 'getTogetherMap', null, { filename: file.filename });
}));

// Delete map (admin)
router.delete('/map', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  if (!fs.existsSync(mapDir)) return res.json({ ok: true });
  const files = fs.readdirSync(mapDir).filter(f => f.startsWith('floor-map'));
  for (const f of files) {
    try { fs.unlinkSync(path.join(mapDir, f)); } catch { /* ignore */ }
  }
  res.json({ ok: true });
  logAction(req, 'get-together:map-deleted', 'getTogetherMap', null, {});
  broadcast('get-together:map-deleted', {}, getMutationId(req));
}));

export default router;
