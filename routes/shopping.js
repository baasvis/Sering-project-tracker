const { Router } = require('express');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');

const { broadcast, getMutationId } = require('../lib/sse');

const router = Router();

// Strip HTML tags from user input (defense-in-depth against stored XSS)
function stripTags(str) {
  return String(str).replace(/<[^>]*>/g, '');
}

// Validate UUID format
function isValidUuid(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// Validate URL is http/https only (prevents javascript: XSS)
function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

// Validate numeric value within bounds
function validateNumber(val, min, max) {
  if (val === null || val === undefined) return null;
  const num = parseFloat(val);
  if (isNaN(num) || !isFinite(num) || num < min || num > max) return null;
  return num;
}

// List shopping items for a project
router.get('/', async (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId query param required' });
  if (!isValidUuid(projectId)) return res.status(400).json({ error: 'Invalid projectId format' });

  const items = await prisma.shoppingItem.findMany({
    where: { projectId },
    orderBy: { order: 'asc' }
  });
  res.json(items);
});

// Budget summary: all projects with shopping totals
router.get('/summary', async (req, res) => {
  const projects = await prisma.project.findMany({
    where: { status: 'active' },
    include: {
      group: { select: { name: true } },
      shoppingItems: {
        where: { approved: true },
        select: {
          id: true, type: true, name: true, link: true,
          pricePerItem: true, quantity: true, amount: true,
          purchased: true, suggestedBy: true, order: true
        },
        orderBy: { order: 'asc' }
      }
    },
    orderBy: { name: 'asc' }
  });

  const summary = projects
    .map(p => {
      const products = p.shoppingItems.filter(i => i.type === 'product');
      const costs = p.shoppingItems.filter(i => i.type === 'cost');
      const productTotal = products.reduce((sum, i) => sum + (i.pricePerItem || 0) * (i.quantity || 1), 0);
      const costTotal = costs.reduce((sum, i) => sum + (i.amount || 0), 0);
      return {
        id: p.id,
        name: p.name,
        groupName: p.group?.name || '',
        itemCount: p.shoppingItems.length,
        productTotal,
        costTotal,
        total: productTotal + costTotal,
        items: p.shoppingItems
      };
    })
    .filter(p => p.itemCount > 0);

  res.json(summary);
});

// Create shopping item (anyone can suggest, admin auto-approved)
router.post('/', async (req, res) => {
  const { projectId, type, name, link, pricePerItem, quantity, amount, authorName } = req.body;
  if (!projectId || !name) return res.status(400).json({ error: 'projectId and name are required' });
  if (!isValidUuid(projectId)) return res.status(400).json({ error: 'Invalid projectId format' });
  if (!['product', 'cost'].includes(type)) return res.status(400).json({ error: 'type must be product or cost' });

  // Strip HTML tags and validate length
  const trimmedName = stripTags(String(name).trim());
  if (trimmedName.length < 1 || trimmedName.length > 200) {
    return res.status(400).json({ error: 'Name must be 1-200 characters' });
  }

  // Validate link URL protocol (prevent javascript: XSS)
  const trimmedLink = link?.trim() || null;
  if (trimmedLink && !isValidUrl(trimmedLink)) {
    return res.status(400).json({ error: 'Link must be a valid http or https URL' });
  }

  const isAdmin = !!req.session?.admin;

  // Non-admins must provide a name
  if (!isAdmin && !authorName) {
    return res.status(400).json({ error: 'authorName is required for suggestions' });
  }

  let sanitizedAuthor = null;
  if (!isAdmin && authorName) {
    sanitizedAuthor = stripTags(String(authorName).trim());
    if (sanitizedAuthor.length < 1 || sanitizedAuthor.length > 50) {
      return res.status(400).json({ error: 'Author name must be 1-50 characters' });
    }
  }

  // Verify project exists
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const maxOrder = await prisma.shoppingItem.aggregate({
    where: { projectId },
    _max: { order: true }
  });

  const data = {
    projectId,
    type,
    name: trimmedName,
    link: trimmedLink,
    pricePerItem: validateNumber(pricePerItem, 0, 1000000),
    quantity: Math.max(1, Math.min(10000, parseInt(quantity) || 1)),
    amount: validateNumber(amount, 0, 1000000),
    approved: isAdmin,
    suggestedBy: sanitizedAuthor,
    order: (maxOrder._max.order || 0) + 1
  };

  const item = await prisma.shoppingItem.create({ data });
  res.status(201).json(item);
  broadcast('shopping:created', { item, projectId: item.projectId }, getMutationId(req));
});

// Update shopping item (admin)
router.patch('/:id', requireAdmin, async (req, res) => {
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid item ID format' });

  const { name, link, pricePerItem, quantity, amount, purchased, order } = req.body;
  const data = {};

  if (name !== undefined) {
    const trimmed = stripTags(String(name).trim());
    if (trimmed.length < 1 || trimmed.length > 200) {
      return res.status(400).json({ error: 'Name must be 1-200 characters' });
    }
    data.name = trimmed;
  }
  if (link !== undefined) {
    const trimmedLink = link?.trim() || null;
    if (trimmedLink && !isValidUrl(trimmedLink)) {
      return res.status(400).json({ error: 'Link must be a valid http or https URL' });
    }
    data.link = trimmedLink;
  }
  if (pricePerItem !== undefined) data.pricePerItem = validateNumber(pricePerItem, 0, 1000000);
  if (quantity !== undefined) data.quantity = Math.max(1, Math.min(10000, parseInt(quantity) || 1));
  if (amount !== undefined) data.amount = validateNumber(amount, 0, 1000000);
  if (purchased !== undefined) data.purchased = !!purchased;
  if (order !== undefined) data.order = parseInt(order) || 0;

  try {
    const item = await prisma.shoppingItem.update({ where: { id: req.params.id }, data });
    res.json(item);
    broadcast('shopping:updated', { item, projectId: item.projectId }, getMutationId(req));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Item not found' });
    throw err;
  }
});

// Approve suggestion (admin)
router.patch('/:id/approve', requireAdmin, async (req, res) => {
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid item ID format' });

  try {
    const item = await prisma.shoppingItem.update({
      where: { id: req.params.id },
      data: { approved: true }
    });
    res.json(item);
    broadcast('shopping:approved', { item, projectId: item.projectId }, getMutationId(req));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Item not found' });
    throw err;
  }
});

// Delete shopping item (admin)
router.delete('/:id', requireAdmin, async (req, res) => {
  if (!isValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid item ID format' });

  try {
    const existing = await prisma.shoppingItem.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
    await prisma.shoppingItem.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
    if (existing) broadcast('shopping:deleted', { itemId: req.params.id, projectId: existing.projectId }, getMutationId(req));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Item not found' });
    throw err;
  }
});

module.exports = router;
