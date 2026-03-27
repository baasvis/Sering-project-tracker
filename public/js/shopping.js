/* ========================================
   Shopping — List rendering, modals, CRUD
   ======================================== */

// Item cache for safe edit (avoids XSS from JSON.stringify in onclick)
const _shoppingItemCache = {};

// Format currency (euros)
function formatEuro(amount) {
  if (amount == null || isNaN(amount)) return '€0.00';
  return '€' + Number(amount).toFixed(2);
}

// Calculate totals from a list of shopping items
function calcShoppingTotals(items) {
  const approved = items.filter(i => i.approved);
  const products = approved.filter(i => i.type === 'product');
  const costs = approved.filter(i => i.type === 'cost');
  const productTotal = products.reduce((sum, i) => sum + (i.pricePerItem || 0) * (i.quantity || 1), 0);
  const costTotal = costs.reduce((sum, i) => sum + (i.amount || 0), 0);
  return { productTotal, costTotal, total: productTotal + costTotal };
}

// Safely render a link href (only allow http/https)
function safeHref(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return esc(url);
  } catch {}
  return '';
}

// Render a shopping list section (used in project detail and budget fold-out)
function renderShoppingSection(items, projectId, options = {}) {
  const { compact = false } = options;
  const products = items.filter(i => i.type === 'product' && i.approved);
  const costs = items.filter(i => i.type === 'cost' && i.approved);
  const pending = items.filter(i => !i.approved);
  const totals = calcShoppingTotals(items);

  // Cache items for safe edit modal access
  for (const item of items) {
    _shoppingItemCache[item.id] = item;
  }

  const addButtons = S.isAdmin
    ? `<div class="shopping-actions">
        <button class="btn btn-primary btn-small" onclick="showShoppingItemModal('product', '${esc(projectId)}')">+ Item</button>
        <button class="btn btn-secondary btn-small" onclick="showShoppingItemModal('cost', '${esc(projectId)}')">+ Cost</button>
      </div>`
    : `<div class="shopping-actions">
        <button class="btn btn-secondary btn-small" onclick="showShoppingItemModal('product', '${esc(projectId)}')">Suggest Item</button>
        <button class="btn btn-secondary btn-small" onclick="showShoppingItemModal('cost', '${esc(projectId)}')">Suggest Cost</button>
      </div>`;

  let html = `<div class="shopping-list" id="shopping-${esc(projectId)}">
    <div class="shopping-header">
      <div class="shopping-header-left">
        <h2>Shopping List</h2>
        <span class="shopping-total">${formatEuro(totals.total)}</span>
      </div>
      ${addButtons}
    </div>`;

  // Products table
  if (products.length > 0) {
    html += `<div class="shopping-table">
      <div class="shopping-table-head ${S.isAdmin ? 'has-actions' : ''}">
        <span class="sh-name">Item</span>
        <span class="sh-price">Price</span>
        <span class="sh-qty">Qty</span>
        <span class="sh-total">Total</span>
        <span class="sh-status">Got it</span>
        ${S.isAdmin ? '<span class="sh-actions"></span>' : ''}
      </div>`;
    for (const item of products) {
      const itemTotal = (item.pricePerItem || 0) * (item.quantity || 1);
      const href = safeHref(item.link);
      const nameHtml = href
        ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${esc(item.name)}</a>`
        : esc(item.name);
      html += `<div class="shopping-row ${item.purchased ? 'purchased' : ''} ${S.isAdmin ? 'has-actions' : ''}">`;
        <span class="sh-name">${nameHtml}</span>
        <span class="sh-price">${formatEuro(item.pricePerItem)}</span>
        <span class="sh-qty">${item.quantity || 1}</span>
        <span class="sh-total">${formatEuro(itemTotal)}</span>
        <span class="sh-status">
          ${S.isAdmin
            ? `<button class="shopping-check ${item.purchased ? 'checked' : ''}" aria-label="${item.purchased ? 'Mark as not purchased' : 'Mark as purchased'}" onclick="event.stopPropagation(); togglePurchased('${esc(item.id)}', ${!item.purchased})">${item.purchased ? '&#10003;' : ''}</button>`
            : `<span class="shopping-check ${item.purchased ? 'checked' : ''}">${item.purchased ? '&#10003;' : ''}</span>`}
        </span>
        ${S.isAdmin ? `<span class="sh-actions">
          <button class="btn-icon" aria-label="Edit item" onclick="event.stopPropagation(); editShoppingItem('${esc(item.id)}', 'product', '${esc(projectId)}')">&#9998;</button>
          <button class="btn-icon btn-icon-danger" aria-label="Delete item" onclick="event.stopPropagation(); deleteShoppingItem('${esc(item.id)}', '${esc(projectId)}')">&#10005;</button>
        </span>` : ''}
      </div>`;
    }
    html += `</div>`;
  }

  // Extra costs
  if (costs.length > 0) {
    html += `<div class="shopping-costs">
      <h3>Extra Costs</h3>`;
    for (const item of costs) {
      html += `<div class="shopping-cost-row">
        <span class="sh-name">${esc(item.name)}</span>
        <span class="sh-total">${formatEuro(item.amount)}</span>
        ${S.isAdmin ? `<span class="sh-actions">
          <button class="btn-icon" aria-label="Edit cost" onclick="event.stopPropagation(); editShoppingItem('${esc(item.id)}', 'cost', '${esc(projectId)}')">&#9998;</button>
          <button class="btn-icon btn-icon-danger" aria-label="Delete cost" onclick="event.stopPropagation(); deleteShoppingItem('${esc(item.id)}', '${esc(projectId)}')">&#10005;</button>
        </span>` : ''}
      </div>`;
    }
    html += `</div>`;
  }

  // Grand total
  if (products.length > 0 || costs.length > 0) {
    html += `<div class="shopping-grand-total">
      <span>Total</span>
      <span>${formatEuro(totals.total)}</span>
    </div>`;
  }

  // Pending suggestions (admin only)
  if (S.isAdmin && pending.length > 0) {
    html += `<div class="shopping-pending">
      <h3>Pending Suggestions (${pending.length})</h3>`;
    for (const item of pending) {
      const desc = item.type === 'product'
        ? `${esc(item.name)} — ${formatEuro(item.pricePerItem)} x ${item.quantity || 1}`
        : `${esc(item.name)} — ${formatEuro(item.amount)}`;
      html += `<div class="shopping-pending-row">
        <div>
          <span class="shopping-pending-name">${desc}</span>
          <span class="text-muted text-sm">suggested by ${esc(item.suggestedBy)}</span>
        </div>
        <div class="shopping-pending-actions">
          <button class="btn btn-small btn-primary" onclick="approveShoppingItem('${esc(item.id)}', '${esc(projectId)}')">Approve</button>
          <button class="btn btn-small btn-danger" onclick="deleteShoppingItem('${esc(item.id)}', '${esc(projectId)}')">Reject</button>
        </div>
      </div>`;
    }
    html += `</div>`;
  }

  // Empty state
  if (products.length === 0 && costs.length === 0 && pending.length === 0) {
    html += `<div class="empty-state" style="padding:var(--space-lg) 0">
      <p class="text-muted">No items yet. ${S.isAdmin ? 'Add items to track costs.' : 'Suggest items for this project.'}</p>
    </div>`;
  }

  html += `</div>`;
  return html;
}

// Load and render shopping section into a container
async function loadShoppingSection(projectId, containerId) {
  try {
    const items = await apiGet(`/api/shopping?projectId=${projectId}`);
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = renderShoppingSection(items, projectId);
    }
  } catch (err) {
    console.error('Failed to load shopping list:', err);
  }
}

// Edit item via cache (avoids JSON.stringify XSS)
function editShoppingItem(itemId, type, projectId) {
  const item = _shoppingItemCache[itemId];
  if (!item) return toast('Item not found — try refreshing', 'error');
  showShoppingItemModal(type, projectId, item);
}

// Show modal for adding/editing a shopping item
function showShoppingItemModal(type, projectId, existing) {
  const isEdit = !!existing;
  const isProduct = type === 'product';
  const isAdmin = S.isAdmin;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal">
    <h2>${isEdit ? 'Edit' : (isAdmin ? 'Add' : 'Suggest')} ${isProduct ? 'Item' : 'Cost'}</h2>
    <div class="form-group">
      <label>${isProduct ? 'Item Name' : 'Cost Description'}</label>
      <input type="text" id="shop-name" maxlength="200" value="${esc(existing?.name || '')}" placeholder="${isProduct ? 'e.g. Screws M6 x 50mm' : 'e.g. Labour, delivery fee'}">
    </div>
    ${isProduct ? `
    <div class="form-group">
      <label>Link (optional)</label>
      <input type="url" id="shop-link" value="${esc(existing?.link || '')}" placeholder="https://...">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Price per item (€)</label>
        <input type="number" id="shop-price" step="0.01" min="0" max="1000000" value="${existing?.pricePerItem ?? ''}">
      </div>
      <div class="form-group">
        <label>Quantity</label>
        <input type="number" id="shop-qty" min="1" max="10000" value="${existing?.quantity ?? 1}">
      </div>
    </div>` : `
    <div class="form-group">
      <label>Amount (€)</label>
      <input type="number" id="shop-amount" step="0.01" min="0" max="1000000" value="${existing?.amount ?? ''}">
    </div>`}
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="saveShoppingItem('${esc(type)}', '${esc(projectId)}', ${isEdit ? `'${esc(existing.id)}'` : 'null'})">${isEdit ? 'Save' : (isAdmin ? 'Add' : 'Suggest')}</button>
    </div>
  </div>`;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
}

// Save shopping item
async function saveShoppingItem(type, projectId, id) {
  const name = document.getElementById('shop-name').value.trim();
  if (!name) return toast('Name is required', 'error');
  if (name.length > 200) return toast('Name must be under 200 characters', 'error');

  const data = { projectId, type, name };

  if (type === 'product') {
    const price = document.getElementById('shop-price').value;
    const qty = document.getElementById('shop-qty').value;
    data.pricePerItem = price ? parseFloat(price) : null;
    data.quantity = qty ? parseInt(qty) : 1;
    const link = document.getElementById('shop-link').value.trim();
    data.link = link || null;
  } else {
    const amount = document.getElementById('shop-amount').value;
    data.amount = amount ? parseFloat(amount) : null;
  }

  // Non-admin suggestions need authorName
  if (!S.isAdmin) {
    data.authorName = S.visitorName || 'Anonymous';
  }

  try {
    if (id) {
      await apiPatch(`/api/shopping/${id}`, data);
    } else {
      await apiPost('/api/shopping', data);
    }
    document.querySelector('.modal-backdrop')?.remove();
    toast(id ? 'Item updated' : (S.isAdmin ? 'Item added' : 'Suggestion submitted'), 'success');
    refreshShoppingView(projectId);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Toggle purchased status
async function togglePurchased(itemId, purchased) {
  try {
    const item = await apiPatch(`/api/shopping/${itemId}`, { purchased });
    refreshShoppingView(item.projectId);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Approve a suggestion
async function approveShoppingItem(itemId, projectId) {
  try {
    await apiPatch(`/api/shopping/${itemId}/approve`, {});
    toast('Item approved', 'success');
    refreshShoppingView(projectId);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Delete a shopping item
async function deleteShoppingItem(itemId, projectId) {
  if (!confirm('Delete this item?')) return;
  try {
    await apiDelete(`/api/shopping/${itemId}`);
    toast('Item deleted');
    refreshShoppingView(projectId);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Refresh the shopping view for a project (works in both contexts)
function refreshShoppingView(projectId) {
  if (S.screen === 'budget') {
    renderBudget();
    return;
  }
  loadShoppingSection(projectId, `shopping-container-${projectId}`);
}
