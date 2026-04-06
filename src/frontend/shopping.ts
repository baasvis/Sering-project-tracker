/* ========================================
   Shopping — List rendering, modals, CRUD
   ======================================== */

// Item cache for safe edit (avoids XSS from JSON.stringify in data attributes)
var _shoppingItemCache: Record<string, any> = {};

// Format currency (euros)
function formatEuro(amount: number | null | undefined): string {
  if (amount == null || isNaN(amount)) return '\u20AC0.00';
  return '\u20AC' + Number(amount).toFixed(2);
}

// Calculate totals from a list of shopping items (single pass)
function calcShoppingTotals(items: any[]): { productTotal: number; costTotal: number; total: number } {
  var productTotal = 0, costTotal = 0;
  for (var i of items) {
    if (!i.approved) continue;
    if (i.type === 'product') {
      productTotal += (i.pricePerItem || 0) * (i.quantity || 1);
    } else if (i.type === 'cost') {
      costTotal += (i.amount || 0);
    }
  }
  return { productTotal, costTotal, total: productTotal + costTotal };
}

// Safely render a link href (only allow http/https)
function safeHref(url: string | null | undefined): string {
  if (!url) return '';
  try {
    var parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return esc(url);
  } catch {}
  return '';
}

// Render a shopping list section (used in project detail and budget fold-out)
function renderShoppingSection(items: any[], projectId: string, options: { compact?: boolean } = {}): string {
  var { compact = false } = options;
  var products = items.filter((i: any) => i.type === 'product' && i.approved);
  var costs = items.filter((i: any) => i.type === 'cost' && i.approved);
  var pending = items.filter((i: any) => !i.approved);
  var totals = calcShoppingTotals(items);

  // Cache items for safe edit modal access
  for (var item of items) {
    _shoppingItemCache[item.id] = item;
  }

  var addButtons = S.isAdmin
    ? html`<div class="shopping-actions">
        <button class="btn btn-primary btn-small" data-action="showShoppingItemModal" data-type="product" data-project-id="${projectId}">+ Item</button>
        <button class="btn btn-secondary btn-small" data-action="showShoppingItemModal" data-type="cost" data-project-id="${projectId}">+ Cost</button>
      </div>`
    : html`<div class="shopping-actions">
        <button class="btn btn-secondary btn-small" data-action="showShoppingItemModal" data-type="product" data-project-id="${projectId}">Suggest Item</button>
        <button class="btn btn-secondary btn-small" data-action="showShoppingItemModal" data-type="cost" data-project-id="${projectId}">Suggest Cost</button>
      </div>`;

  var out = html`<div class="shopping-list" id="shopping-${projectId}">
    <div class="shopping-header">
      <div class="shopping-header-left">
        <h2>Shopping List</h2>
        <span class="shopping-total">${raw(formatEuro(totals.total))}</span>
      </div>
      ${raw(addButtons)}
    </div>`;

  // Products table
  if (products.length > 0) {
    out += html`<div class="shopping-table">
      <div class="shopping-table-head ${S.isAdmin ? 'has-actions' : ''}">
        <span class="sh-name">Item</span>
        <span class="sh-price">Price</span>
        <span class="sh-qty">Qty</span>
        <span class="sh-total">Total</span>
        <span class="sh-status">Got it</span>
        ${raw(S.isAdmin ? '<span class="sh-actions"></span>' : '')}
      </div>`;
    for (var item of products) {
      var itemTotal = (item.pricePerItem || 0) * (item.quantity || 1);
      var href = safeHref(item.link);
      var nameHtml = href
        ? html`<a href="${raw(href)}" target="_blank" rel="noopener noreferrer">${item.name}</a>`
        : esc(item.name);
      var meta: string[] = [];
      if (item.importance) meta.push(html`<span class="badge badge-${raw(item.importance === 'Critical' ? 'danger' : item.importance === 'Medium' ? 'warning' : 'muted')}">${item.importance}</span>`);
      if (item.assignedTo) meta.push(html`<span class="text-muted text-sm">${item.assignedTo}</span>`);
      if (item.notes) meta.push(html`<span class="text-muted text-sm">${item.notes}</span>`);
      var metaHtml = meta.length ? html`<div class="item-meta">${raw(meta.join(' '))}</div>` : '';
      out += html`<div class="shopping-row ${item.purchased ? 'purchased' : ''} ${S.isAdmin ? 'has-actions' : ''}">
        <span class="sh-name">${raw(nameHtml)}${raw(metaHtml)}</span>
        <span class="sh-price">${raw(formatEuro(item.pricePerItem))}</span>
        <span class="sh-qty">${item.quantity || 1}</span>
        <span class="sh-total">${raw(formatEuro(itemTotal))}</span>
        <span class="sh-status">
          ${raw(S.isAdmin
            ? html`<button class="shopping-check ${item.purchased ? 'checked' : ''}" aria-label="${item.purchased ? 'Mark as not purchased' : 'Mark as purchased'}" data-action="togglePurchased" data-stop data-id="${item.id}" data-purchased="${!item.purchased}">${raw(item.purchased ? '&#10003;' : '')}</button>`
            : html`<span class="shopping-check ${item.purchased ? 'checked' : ''}">${raw(item.purchased ? '&#10003;' : '')}</span>`)}
        </span>
        ${raw(S.isAdmin ? html`<span class="sh-actions">
          <button class="btn-icon" aria-label="Edit item" data-action="editShoppingItem" data-stop data-id="${item.id}" data-type="product" data-project-id="${projectId}">&#9998;</button>
          <button class="btn-icon btn-icon-danger" aria-label="Delete item" data-action="deleteShoppingItem" data-stop data-id="${item.id}" data-project-id="${projectId}">&#10005;</button>
        </span>` : '')}
      </div>`;
    }
    out += html`</div>`;
  }

  // Extra costs
  if (costs.length > 0) {
    out += html`<div class="shopping-costs">
      <h3>Extra Costs</h3>`;
    for (var item of costs) {
      out += html`<div class="shopping-cost-row">
        <span class="sh-name">${item.name}</span>
        <span class="sh-total">${raw(formatEuro(item.amount))}</span>
        ${raw(S.isAdmin ? html`<span class="sh-actions">
          <button class="btn-icon" aria-label="Edit cost" data-action="editShoppingItem" data-stop data-id="${item.id}" data-type="cost" data-project-id="${projectId}">&#9998;</button>
          <button class="btn-icon btn-icon-danger" aria-label="Delete cost" data-action="deleteShoppingItem" data-stop data-id="${item.id}" data-project-id="${projectId}">&#10005;</button>
        </span>` : '')}
      </div>`;
    }
    out += html`</div>`;
  }

  // Grand total
  if (products.length > 0 || costs.length > 0) {
    out += html`<div class="shopping-grand-total">
      <span>Total</span>
      <span>${raw(formatEuro(totals.total))}</span>
    </div>`;
  }

  // Pending suggestions — visible to all, but admin gets approve/reject actions
  if (pending.length > 0) {
    out += html`<div class="shopping-pending">
      <h3>Pending Suggestions (${pending.length})</h3>`;
    for (var item of pending) {
      var desc = item.type === 'product'
        ? html`${item.name} — ${raw(formatEuro(item.pricePerItem))} x ${item.quantity || 1}`
        : html`${item.name} — ${raw(formatEuro(item.amount))}`;
      out += html`<div class="shopping-pending-row">
        <div>
          <span class="shopping-pending-name">${raw(desc)}</span>
          <span class="text-muted text-sm">suggested by ${item.suggestedBy || 'someone'}</span>
        </div>
        <div class="shopping-pending-actions">
          ${raw(S.isAdmin
            ? html`<button class="btn btn-small btn-primary" data-action="approveShoppingItem" data-id="${item.id}" data-project-id="${projectId}">Approve</button>
               <button class="btn btn-small btn-danger" data-action="deleteShoppingItem" data-id="${item.id}" data-project-id="${projectId}">Reject</button>`
            : `<span class="pending-badge">Pending approval</span>`)}
        </div>
      </div>`;
    }
    out += html`</div>`;
  }

  // Empty state
  if (products.length === 0 && costs.length === 0 && pending.length === 0) {
    out += html`<div class="empty-state" style="padding:${raw('var(--space-lg)')} 0">
      <p class="text-muted">No items yet. ${S.isAdmin ? 'Add items to track costs.' : 'Suggest items for this project.'}</p>
    </div>`;
  }

  out += html`</div>`;
  return out;
}

// Load and render shopping section into a container
async function loadShoppingSection(projectId: string, containerId: string): Promise<void> {
  try {
    var items = await apiGet(`/api/shopping?projectId=${projectId}`);
    var container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = renderShoppingSection(items, projectId);
    }
  } catch (err: any) {
    console.error('Failed to load shopping list:', err);
  }
}

// Edit item via cache (avoids JSON.stringify XSS)
function editShoppingItem(itemId: string, type: string, projectId: string): void {
  var item = _shoppingItemCache[itemId];
  if (!item) return toast('Item not found — try refreshing', 'error');
  showShoppingItemModal(type, projectId, item);
}

// Show modal for adding/editing a shopping item
function showShoppingItemModal(type: string, projectId: string, existing?: any): void {
  var isEdit = !!existing;
  var isProduct = type === 'product';
  var isAdmin = S.isAdmin;

  var backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = html`<div class="modal">
    <h2>${isEdit ? 'Edit' : (isAdmin ? 'Add' : 'Suggest')} ${isProduct ? 'Item' : 'Cost'}</h2>
    <div class="form-group">
      <label>${isProduct ? 'Item Name' : 'Cost Description'}</label>
      <input type="text" id="shop-name" maxlength="200" value="${existing?.name || ''}" placeholder="${isProduct ? 'e.g. Screws M6 x 50mm' : 'e.g. Labour, delivery fee'}">
    </div>
    ${raw(isProduct ? html`
    <div class="form-group">
      <label>Link (optional)</label>
      <input type="url" id="shop-link" value="${existing?.link || ''}" placeholder="https://...">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Price per item (\u20AC)</label>
        <input type="number" id="shop-price" step="0.01" min="0" max="1000000" value="${existing?.pricePerItem ?? ''}">
      </div>
      <div class="form-group">
        <label>Quantity</label>
        <input type="number" id="shop-qty" min="1" max="10000" value="${existing?.quantity ?? 1}">
      </div>
    </div>` : html`
    <div class="form-group">
      <label>Amount (\u20AC)</label>
      <input type="number" id="shop-amount" step="0.01" min="0" max="1000000" value="${existing?.amount ?? ''}">
    </div>`)}
    <div class="form-row">
      <div class="form-group">
        <label>Category</label>
        <input type="text" id="shop-category" maxlength="100" value="${existing?.category || ''}" placeholder="e.g. Materials, Safety gear">
      </div>
      <div class="form-group">
        <label>Importance</label>
        <select id="shop-importance">
          <option value=""${raw(!existing?.importance ? ' selected' : '')}>—</option>
          <option value="Critical"${raw(existing?.importance === 'Critical' ? ' selected' : '')}>Critical</option>
          <option value="Medium"${raw(existing?.importance === 'Medium' ? ' selected' : '')}>Medium</option>
          <option value="Low"${raw(existing?.importance === 'Low' ? ' selected' : '')}>Low</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Who arranges</label>
        <input type="text" id="shop-assigned" maxlength="100" value="${existing?.assignedTo || ''}" placeholder="e.g. Noah, Jeroen">
      </div>
      <div class="form-group">
        <label>Notes (optional)</label>
        <input type="text" id="shop-notes" maxlength="500" value="${existing?.notes || ''}" placeholder="Extra details...">
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" data-action="closeModal">Cancel</button>
      <button class="btn btn-primary" data-action="saveShoppingItem" data-type="${type}" data-project-id="${projectId}" data-id="${isEdit ? existing.id : ''}">${isEdit ? 'Save' : (isAdmin ? 'Add' : 'Suggest')}</button>
    </div>
  </div>`;
  backdrop.addEventListener('click', (e: Event) => { if (e.target === backdrop) closeModal(backdrop); });
  openModal(backdrop, (isEdit ? 'Edit' : (isAdmin ? 'Add' : 'Suggest')) + ' ' + (isProduct ? 'Item' : 'Cost'));
}

// Save shopping item
async function saveShoppingItem(type: string, projectId: string, id: string | null): Promise<void> {
  var name = (document.getElementById('shop-name') as HTMLInputElement).value.trim();
  if (!name) return toast('Name is required', 'error');
  if (name.length > 200) return toast('Name must be under 200 characters', 'error');

  var category = (document.getElementById('shop-category') as HTMLInputElement).value.trim();
  var importance = (document.getElementById('shop-importance') as HTMLSelectElement).value;
  var assignedTo = (document.getElementById('shop-assigned') as HTMLInputElement).value.trim();
  var notes = (document.getElementById('shop-notes') as HTMLInputElement).value.trim();
  var data: any = {
    projectId, type, name,
    category: category || null,
    importance: importance || null,
    assignedTo: assignedTo || null,
    notes: notes || null,
  };

  if (type === 'product') {
    var price = (document.getElementById('shop-price') as HTMLInputElement).value;
    var qty = (document.getElementById('shop-qty') as HTMLInputElement).value;
    data.pricePerItem = price ? parseFloat(price) : null;
    data.quantity = qty ? parseInt(qty) : 1;
    var link = (document.getElementById('shop-link') as HTMLInputElement).value.trim();
    data.link = link || null;
  } else {
    var amount = (document.getElementById('shop-amount') as HTMLInputElement).value;
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
    { var bd = document.querySelector('.modal-backdrop') as HTMLElement | null; if (bd) closeModal(bd); }
    toast(id ? 'Item updated' : (S.isAdmin ? 'Item added' : 'Suggestion submitted'), 'success');
    refreshShoppingView(projectId);
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

// Toggle purchased status
async function togglePurchased(itemId: string, purchased: boolean): Promise<void> {
  try {
    var item = await apiPatch(`/api/shopping/${itemId}`, { purchased });
    refreshShoppingView(item.projectId);
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

// Approve a suggestion
async function approveShoppingItem(itemId: string, projectId: string): Promise<void> {
  try {
    await apiPatch(`/api/shopping/${itemId}/approve`, {});
    toast('Item approved', 'success');
    refreshShoppingView(projectId);
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

// Delete a shopping item
async function deleteShoppingItem(itemId: string, projectId: string): Promise<void> {
  if (!confirm('Delete this item?')) return;
  try {
    await apiDelete(`/api/shopping/${itemId}`);
    toast('Item deleted');
    refreshShoppingView(projectId);
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

// Refresh the shopping view for a project (works in both contexts)
function refreshShoppingView(projectId: string): void {
  if (S.screen === 'budget') {
    renderBudget();
    return;
  }
  loadShoppingSection(projectId, `shopping-container-${projectId}`);
}

// --- onAction registrations for shopping ---
onAction('showShoppingItemModal', (el: HTMLElement) => showShoppingItemModal(el.dataset.type!, el.dataset.projectId!));
onAction('editShoppingItem', (el: HTMLElement) => editShoppingItem(el.dataset.id!, el.dataset.type!, el.dataset.projectId!));
onAction('deleteShoppingItem', (el: HTMLElement) => deleteShoppingItem(el.dataset.id!, el.dataset.projectId!));
onAction('togglePurchased', (el: HTMLElement) => togglePurchased(el.dataset.id!, el.dataset.purchased === 'true'));
onAction('approveShoppingItem', (el: HTMLElement) => approveShoppingItem(el.dataset.id!, el.dataset.projectId!));
onAction('saveShoppingItem', (el: HTMLElement) => saveShoppingItem(el.dataset.type!, el.dataset.projectId!, el.dataset.id || null));

// ---- Reactive subscriptions ----

S.subscribe('_shoppingUpdate', (update: any) => {
  if (S.screen === 'budget') return; // budget.js handles this
  if (update && S.currentProjectId === update.projectId) {
    loadShoppingSection(update.projectId, `shopping-container-${update.projectId}`);
  }
});
