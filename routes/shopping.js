const { Router } = require('express');
const prisma = require('../lib/db');
const { requireAdmin } = require('./auth');

const router = Router();

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

  const where = { projectId };
  // Non-admins only see approved items
  if (!req.session?.admin) {
    where.approved = true;
  }

  const items = await prisma.shoppingItem.findMany({
    where,
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
  if (!['product', 'cost'].includes(type)) return res.status(400).json({ error: 'type must be product or cost' });

  const trimmedName = String(name).trim();
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

  if (!isAdmin && authorName) {
    const trimmedAuthor = String(authorName).trim();
    if (trimmedAuthor.length < 1 || trimmedAuthor.length > 50) {
      return res.status(400).json({ error: 'Author name must be 1-50 characters' });
    }
  }

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
    suggestedBy: isAdmin ? null : String(authorName).trim(),
    order: (maxOrder._max.order || 0) + 1
  };

  const item = await prisma.shoppingItem.create({ data });
  res.status(201).json(item);
});

// Update shopping item (admin)
router.patch('/:id', requireAdmin, async (req, res) => {
  const { name, link, pricePerItem, quantity, amount, purchased, order } = req.body;
  const data = {};

  if (name !== undefined) {
    const trimmed = String(name).trim();
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

  const item = await prisma.shoppingItem.update({ where: { id: req.params.id }, data });
  res.json(item);
});

// Approve suggestion (admin)
router.patch('/:id/approve', requireAdmin, async (req, res) => {
  const item = await prisma.shoppingItem.update({
    where: { id: req.params.id },
    data: { approved: true }
  });
  res.json(item);
});

// Delete shopping item (admin)
router.delete('/:id', requireAdmin, async (req, res) => {
  await prisma.shoppingItem.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
