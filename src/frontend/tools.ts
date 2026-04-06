/* ========================================
   Tools — Required tools/items checklist
   ======================================== */

var _toolItemCache: Record<string, any> = {};

function renderToolsSection(items: any[], projectId: string): string {
  var approved = items.filter((i: any) => i.approved);
  var pending = items.filter((i: any) => !i.approved);

  for (var item of items) {
    _toolItemCache[item.id] = item;
  }

  var addButton = S.isAdmin
    ? html`<button class="btn btn-primary btn-small" data-action="showToolItemModal" data-project-id="${projectId}">+ Tool</button>`
    : html`<button class="btn btn-secondary btn-small" data-action="showToolItemModal" data-project-id="${projectId}">Suggest Tool</button>`;

  var out = html`<div class="tools-list" id="tools-${projectId}">
    <div class="shopping-header">
      <div class="shopping-header-left">
        <h2>Required Tools &amp; Items</h2>
        <span class="text-muted">${approved.length} item${raw(approved.length !== 1 ? 's' : '')}</span>
      </div>
      <div class="shopping-actions">${raw(addButton)}</div>
    </div>`;

  if (approved.length > 0) {
    out += html`<div class="shopping-table">
      <div class="shopping-table-head ${raw(S.isAdmin ? 'has-actions' : '')}">
        <span class="sh-status">Have</span>
        <span class="sh-name">Tool / Item</span>
        <span class="sh-qty">Qty</span>
        ${raw(S.isAdmin ? '<span class="sh-actions"></span>' : '')}
      </div>`;
    for (var item of approved) {
      out += renderToolRow(item, projectId);
    }
    out += html`</div>`;
  }

  if (pending.length > 0) {
    out += html`<div class="shopping-pending">
      <h3>Pending Suggestions (${pending.length})</h3>`;
    for (var item of pending) {
      out += html`<div class="shopping-pending-row">
        <div>
          <span class="shopping-pending-name">${item.name}${raw(item.quantity > 1 ? html` x ${item.quantity}` : '')}</span>
          <span class="text-muted text-sm">suggested by ${item.suggestedBy || 'someone'}</span>
        </div>
        <div class="shopping-pending-actions">
          ${raw(S.isAdmin
            ? html`<button class="btn btn-small btn-primary" data-action="approveToolItem" data-id="${item.id}" data-project-id="${projectId}" data-stop>Approve</button>
               <button class="btn btn-small btn-danger" data-action="deleteToolItem" data-id="${item.id}" data-project-id="${projectId}" data-stop>Reject</button>`
            : '<span class="pending-badge">Pending approval</span>')}
        </div>
      </div>`;
    }
    out += html`</div>`;
  }

  if (approved.length === 0 && pending.length === 0) {
    out += html`<div class="empty-state" style="${raw('padding:var(--space-lg) 0')}">
      <p class="text-muted">No tools listed yet. ${raw(S.isAdmin ? 'Add required tools for this project.' : 'Suggest tools needed for this project.')}</p>
    </div>`;
  }

  out += html`</div>`;
  return out;
}

function renderToolRow(item: any, projectId: string): string {
  var href = item.link ? safeHref(item.link) : '';
  var nameHtml = href
    ? html`<a href="${raw(href)}" target="_blank" rel="noopener noreferrer">${item.name}</a>`
    : esc(item.name);
  var meta: string[] = [];
  if (item.importance) meta.push(html`<span class="badge badge-${item.importance === 'Critical' ? 'danger' : item.importance === 'Medium' ? 'warning' : 'muted'}">${item.importance}</span>`);
  if (item.assignedTo) meta.push(html`<span class="text-muted text-sm">${item.assignedTo}</span>`);
  if (item.notes) meta.push(html`<span class="text-muted text-sm">${item.notes}</span>`);
  var metaHtml = meta.length ? html`<div class="item-meta">${raw(meta.join(' '))}</div>` : '';
  return html`<div class="shopping-row ${raw(item.available ? 'purchased' : '')} ${raw(S.isAdmin ? 'has-actions' : '')}">
    <span class="sh-status">
      ${raw(S.isAdmin
        ? html`<button class="shopping-check ${raw(item.available ? 'checked' : '')}" aria-label="${item.available ? 'Mark unavailable' : 'Mark available'}" data-action="toggleToolAvailable" data-stop data-id="${item.id}" data-available="${!item.available}">${raw(item.available ? '&#10003;' : '')}</button>`
        : html`<span class="shopping-check ${raw(item.available ? 'checked' : '')}">${raw(item.available ? '&#10003;' : '')}</span>`)}
    </span>
    <span class="sh-name">${raw(nameHtml)}${raw(metaHtml)}</span>
    <span class="sh-qty">${item.quantity || 1}</span>
    ${raw(S.isAdmin ? html`<span class="sh-actions">
      <button class="btn-icon" aria-label="Edit tool" data-action="editToolItem" data-stop data-id="${item.id}" data-project-id="${projectId}">&#9998;</button>
      <button class="btn-icon btn-icon-danger" aria-label="Delete tool" data-action="deleteToolItem" data-stop data-id="${item.id}" data-project-id="${projectId}">&#10005;</button>
    </span>` : '')}
  </div>`;
}

async function loadToolsSection(projectId: string, containerId: string): Promise<void> {
  try {
    var resp = await apiGet('/api/tools?projectId=' + projectId);
    var items = resp.data || resp;
    var container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = renderToolsSection(items, projectId);
    }
  } catch (err: any) {
    console.error('Failed to load tools list:', err);
  }
}

function showToolItemModal(projectId: string, existing?: any): void {
  var isEdit = !!existing;
  var isAdmin = S.isAdmin;

  var backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = html`<div class="modal">
    <h2>${isEdit ? 'Edit' : (isAdmin ? 'Add' : 'Suggest')} Tool / Item</h2>
    <div class="form-group">
      <label>Name</label>
      <input type="text" id="tool-name" maxlength="200" value="${existing?.name || ''}" placeholder="e.g. Sanding machine, Safety goggles">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Quantity</label>
        <input type="number" id="tool-qty" min="1" max="10000" value="${existing?.quantity ?? 1}">
      </div>
      <div class="form-group">
        <label>Category</label>
        <input type="text" id="tool-category" maxlength="100" value="${existing?.category || ''}" placeholder="e.g. Tools, Safety gear">
      </div>
    </div>
    <div class="form-group">
      <label>Link (optional)</label>
      <input type="url" id="tool-link" value="${existing?.link || ''}" placeholder="https://...">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Importance</label>
        <select id="tool-importance">
          <option value=""${raw(!existing?.importance ? ' selected' : '')}>—</option>
          <option value="Critical"${raw(existing?.importance === 'Critical' ? ' selected' : '')}>Critical</option>
          <option value="Medium"${raw(existing?.importance === 'Medium' ? ' selected' : '')}>Medium</option>
          <option value="Low"${raw(existing?.importance === 'Low' ? ' selected' : '')}>Low</option>
        </select>
      </div>
      <div class="form-group">
        <label>Who arranges</label>
        <input type="text" id="tool-assigned" maxlength="100" value="${existing?.assignedTo || ''}" placeholder="e.g. Noah, Jeroen">
      </div>
    </div>
    <div class="form-group">
      <label>Notes (optional)</label>
      <input type="text" id="tool-notes" maxlength="500" value="${existing?.notes || ''}" placeholder="Extra details...">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" data-action="closeModal">Cancel</button>
      <button class="btn btn-primary" data-action="saveToolItem" data-project-id="${projectId}" data-id="${isEdit ? existing.id : ''}">${isEdit ? 'Save' : (isAdmin ? 'Add' : 'Suggest')}</button>
    </div>
  </div>`;
  backdrop.addEventListener('click', (e: Event) => { if (e.target === backdrop) closeModal(backdrop); });
  openModal(backdrop, (isEdit ? 'Edit' : (isAdmin ? 'Add' : 'Suggest')) + ' Tool');
}

async function saveToolItem(projectId: string, id: string | null): Promise<void> {
  return withDedup('saveToolItem', async () => {
    var name = (document.getElementById('tool-name') as HTMLInputElement).value.trim();
    if (!name) return toast('Name is required', 'error');

    var qty = parseInt((document.getElementById('tool-qty') as HTMLInputElement).value) || 1;
    var link = (document.getElementById('tool-link') as HTMLInputElement).value.trim();
    var category = (document.getElementById('tool-category') as HTMLInputElement).value.trim();
    var importance = (document.getElementById('tool-importance') as HTMLSelectElement).value;
    var assignedTo = (document.getElementById('tool-assigned') as HTMLInputElement).value.trim();
    var notes = (document.getElementById('tool-notes') as HTMLInputElement).value.trim();
    var data: any = {
      name, quantity: qty,
      link: link || null,
      category: category || null,
      importance: importance || null,
      assignedTo: assignedTo || null,
      notes: notes || null,
    };

    if (id) {
      // Update — only send changed fields
      try {
        await apiPatch('/api/tools/' + id, data);
        { var bd = document.querySelector('.modal-backdrop') as HTMLElement | null; if (bd) closeModal(bd); }
        toast('Tool updated', 'success');
        refreshToolsView(projectId);
      } catch (err: any) {
        toast(err.message, 'error');
      }
    } else {
      // Create
      data.projectId = projectId;
      if (!S.isAdmin) {
        data.authorName = S.visitorName || 'Anonymous';
      }
      try {
        await apiPost('/api/tools', data);
        { var bd = document.querySelector('.modal-backdrop') as HTMLElement | null; if (bd) closeModal(bd); }
        toast(S.isAdmin ? 'Tool added' : 'Suggestion submitted', 'success');
        refreshToolsView(projectId);
      } catch (err: any) {
        toast(err.message, 'error');
      }
    }
  });
}

async function toggleToolAvailable(itemId: string, available: boolean): Promise<void> {
  try {
    var item = await apiPatch('/api/tools/' + itemId, { available: available });
    refreshToolsView(item.projectId);
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

async function approveToolItem(itemId: string, projectId: string): Promise<void> {
  try {
    await apiPatch('/api/tools/' + itemId + '/approve', {});
    toast('Tool approved', 'success');
    refreshToolsView(projectId);
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

async function deleteToolItem(itemId: string, projectId: string): Promise<void> {
  if (!confirm('Delete this tool/item?')) return;
  try {
    await apiDelete('/api/tools/' + itemId);
    toast('Tool deleted');
    refreshToolsView(projectId);
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

function refreshToolsView(projectId: string): void {
  loadToolsSection(projectId, 'tools-container-' + projectId);
}

// --- Action registrations ---
onAction('showToolItemModal', (el: HTMLElement) => showToolItemModal(el.dataset.projectId!));
onAction('editToolItem', (el: HTMLElement) => {
  var item = _toolItemCache[el.dataset.id!];
  if (!item) return toast('Item not found — try refreshing', 'error');
  showToolItemModal(el.dataset.projectId!, item);
});
onAction('deleteToolItem', (el: HTMLElement) => deleteToolItem(el.dataset.id!, el.dataset.projectId!));
onAction('toggleToolAvailable', (el: HTMLElement) => toggleToolAvailable(el.dataset.id!, el.dataset.available === 'true'));
onAction('approveToolItem', (el: HTMLElement) => approveToolItem(el.dataset.id!, el.dataset.projectId!));
onAction('saveToolItem', (el: HTMLElement) => saveToolItem(el.dataset.projectId!, el.dataset.id || null));

// --- SSE reactive subscription ---
S.subscribe('_toolsUpdate', (update: any) => {
  if (update && S.currentProjectId === update.projectId) {
    loadToolsSection(update.projectId, 'tools-container-' + update.projectId);
  }
});
