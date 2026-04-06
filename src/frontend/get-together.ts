/* ========================================
   Get Together — Festival schedule page
   Two-day grid/timeline for April 11–12, 2026
   ======================================== */

// ─── State keys for get-together ────────────────────────────────────────────

var _gtBlocks: any[] = [];
var _gtLocations: any[] = [];
var _gtSelectedDay: 'day1' | 'day2' = 'day1';
var _gtMapUrl: string | null = null;
var _gtPrep: any = null;
var _gtExpandedBlockId: string | null = null;
var _gtExpandedBlockDetail: any = null;
var _gtSSECleanup: Array<() => void> = [];

// Day labels
var GT_DAYS: Record<string, { label: string; date: string }> = {
  day1: { label: 'Saturday April 11', date: '2026-04-11' },
  day2: { label: 'Sunday April 12', date: '2026-04-12' },
};

// Time grid: hourly labels 9–20 (12 columns), blocks snap to 15-min precision
var GT_HOURS: number[] = [];
(function() {
  for (var h = 9; h <= 20; h++) GT_HOURS.push(h);
})();
var GT_TOTAL_MINUTES = 720; // 09:00–21:00 = 12 hours

// ─── Data fetching ──────────────────────────────────────────────────────────

async function gtFetchAll(): Promise<void> {
  try {
    var [blocksRes, locRes, mapRes] = await Promise.all([
      apiFetch('GET', '/api/get-together/blocks'),
      apiFetch('GET', '/api/get-together/locations'),
      apiFetch('GET', '/api/get-together/map'),
    ]);
    _gtBlocks = blocksRes.blocks || [];
    _gtLocations = locRes.locations || [];
    _gtMapUrl = mapRes.url || null;
  } catch (e: any) {
    toast('Failed to load get-together data', 'error');
  }
}

async function gtFetchPrep(): Promise<void> {
  try {
    _gtPrep = await apiFetch('GET', '/api/get-together/prep');
  } catch {
    _gtPrep = null;
  }
}

async function gtFetchBlockDetail(blockId: string): Promise<any> {
  try {
    var res = await apiFetch('GET', `/api/get-together/blocks/${blockId}`);
    return res.block;
  } catch {
    return null;
  }
}

// ─── Default day selection ──────────────────────────────────────────────────

function gtDefaultDay(): 'day1' | 'day2' {
  var today = new Date().toISOString().slice(0, 10);
  if (today === '2026-04-12') return 'day2';
  return 'day1';
}

// ─── Main render ────────────────────────────────────────────────────────────

async function renderGetTogether(): Promise<void> {
  var app = document.getElementById('app')!;
  _gtSelectedDay = gtDefaultDay();
  _gtExpandedBlockId = null;
  _gtExpandedBlockDetail = null;

  app.innerHTML = html`<div class="gt-page"><div class="gt-loading">Loading schedule...</div></div>`;

  await Promise.all([gtFetchAll(), gtFetchPrep()]);

  gtRenderPage();
  gtRegisterSSE();
}

function gtRenderPage(): void {
  var app = document.getElementById('app')!;
  var isAdmin = S.isAdmin;

  var mapHtml = '';
  if (_gtMapUrl) {
    mapHtml = html`<div class="gt-map">
      <img src="${_gtMapUrl}" alt="Floor map" class="gt-map-img" data-action="gtToggleMapZoom">
    </div>`;
  }

  var adminControls = '';
  if (isAdmin) {
    adminControls = html`<div class="gt-admin-controls">
      <button class="btn btn-primary btn-small" data-action="gtShowBlockForm">Add Block</button>
      <button class="btn btn-small" data-action="gtShowLocationManager">Manage Locations</button>
      <button class="btn btn-small" data-action="gtShowMapUpload">Upload Map</button>
    </div>`;
  }

  app.innerHTML = html`<div class="gt-page">
    <div class="gt-header">
      <h1>Get Together — April 11 & 12</h1>
      <p class="gt-intro">Two days of building, fixing, planning, and eating together at Sering Centraal.</p>
      ${raw(mapHtml)}
      <div class="gt-day-toggle">
        <button class="btn gt-day-btn ${_gtSelectedDay === 'day1' ? 'active' : ''}" data-action="gtSwitchDay" data-day="day1">${GT_DAYS.day1.label}</button>
        <button class="btn gt-day-btn ${_gtSelectedDay === 'day2' ? 'active' : ''}" data-action="gtSwitchDay" data-day="day2">${GT_DAYS.day2.label}</button>
      </div>
      ${raw(adminControls)}
    </div>
    <div id="gt-schedule"></div>
    <div id="gt-prep"></div>
  </div>`;

  gtRenderSchedule();
  gtRenderPrep();
}

// ─── Day toggle ─────────────────────────────────────────────────────────────

function gtSwitchDay(day: 'day1' | 'day2'): void {
  _gtSelectedDay = day;
  _gtExpandedBlockId = null;
  _gtExpandedBlockDetail = null;

  // Update button states
  var buttons = document.querySelectorAll('.gt-day-btn');
  buttons.forEach((btn: Element) => {
    (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.day === day);
  });

  gtRenderSchedule();
}

// ─── Schedule: Desktop grid vs Mobile timeline ─────────────────────────────

function gtRenderSchedule(): void {
  var container = document.getElementById('gt-schedule');
  if (!container) return;

  var dayBlocks = _gtBlocks.filter((b: any) => b.day === _gtSelectedDay);

  if (dayBlocks.length === 0 && _gtLocations.length === 0) {
    container.innerHTML = html`<div class="gt-empty">No activities scheduled for this day yet.</div>`;
    return;
  }

  if (window.innerWidth < 768) {
    gtRenderTimeline(container, dayBlocks);
  } else {
    gtRenderGrid(container, dayBlocks);
  }
}

// ─── Desktop Grid ───────────────────────────────────────────────────────────

function gtRenderGrid(container: HTMLElement, dayBlocks: any[]): void {
  var headerCells = GT_HOURS.map((h: number) => html`<div class="gt-grid-header-cell">${h}:00</div>`).join('');

  // Group blocks by location
  var blocksByLocation: Record<string, any[]> = {};
  for (var b of dayBlocks) {
    var locId = b.locationId;
    if (!blocksByLocation[locId]) blocksByLocation[locId] = [];
    blocksByLocation[locId].push(b);
  }

  var rows = _gtLocations.map((loc: any) => {
    var locBlocks = blocksByLocation[loc.id] || [];
    var blocksHtml = locBlocks.map((b: any) => gtRenderGridBlock(b)).join('');
    return html`<div class="gt-grid-row" data-location-id="${loc.id}">
      <div class="gt-grid-label">${loc.name}</div>
      <div class="gt-grid-cells">${raw(blocksHtml)}</div>
    </div>`;
  }).join('');

  container.innerHTML = html`<div class="gt-grid">
    <div class="gt-grid-row gt-grid-header">
      <div class="gt-grid-label"></div>
      <div class="gt-grid-cells">${raw(headerCells)}</div>
    </div>
    ${raw(rows)}
  </div>
  <div id="gt-block-detail"></div>`;
}

function gtTimeToMinutes(time: string): number {
  var parts = time.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function gtRenderGridBlock(block: any): string {
  var startMin = gtTimeToMinutes(block.startTime) - 540; // 540 = 9*60
  var endMin = gtTimeToMinutes(block.endTime) - 540;
  var left = (startMin / GT_TOTAL_MINUTES) * 100;
  var width = ((endMin - startMin) / GT_TOTAL_MINUTES) * 100;

  var title = block.project ? block.project.name : (block.title || 'Untitled');
  var colorClass = block.projectId ? 'gt-block-project' : 'gt-block-custom';
  var signupLabel = block.signupCap
    ? `${block.signupCount}/${block.signupCap} signed up`
    : `${block.signupCount} signed up`;
  var isExpanded = _gtExpandedBlockId === block.id;

  return html`<div class="gt-block ${colorClass} ${isExpanded ? 'gt-block-expanded' : ''}"
    style="left:${left}%;width:${width}%"
    data-action="gtToggleBlock"
    data-block-id="${block.id}"
    tabindex="0"
    role="button"
    aria-expanded="${isExpanded ? 'true' : 'false'}">
    <span class="gt-block-title">${title}</span>
    <span class="gt-block-time">${block.startTime}–${block.endTime}</span>
    <span class="gt-block-signup">${signupLabel}</span>
  </div>`;
}

// ─── Mobile Timeline ────────────────────────────────────────────────────────

function gtRenderTimeline(container: HTMLElement, dayBlocks: any[]): void {
  // Sort by startTime, then location order
  var locOrder = new Map(_gtLocations.map((l: any, i: number) => [l.id, i]));
  var sorted = [...dayBlocks].sort((a: any, b: any) => {
    var cmp = a.startTime.localeCompare(b.startTime);
    if (cmp !== 0) return cmp;
    return (locOrder.get(a.locationId) || 0) - (locOrder.get(b.locationId) || 0);
  });

  if (sorted.length === 0) {
    container.innerHTML = html`<div class="gt-empty">No activities scheduled for this day yet.</div>`;
    return;
  }

  var cards = sorted.map((b: any) => {
    var title = b.project ? b.project.name : (b.title || 'Untitled');
    var colorClass = b.projectId ? 'gt-block-project' : 'gt-block-custom';
    var locationName = b.location?.name || '';
    var signupLabel = b.signupCap
      ? `${b.signupCount}/${b.signupCap} signed up`
      : `${b.signupCount} signed up`;
    var isExpanded = _gtExpandedBlockId === b.id;

    // Each card is followed by a detail slot; the expanded one gets the id
    var detailSlot = isExpanded
      ? '<div id="gt-block-detail" class="gt-block-detail-slot"></div>'
      : '';

    return html`<div class="gt-timeline-card ${colorClass} ${isExpanded ? 'gt-card-expanded' : ''}"
      data-action="gtToggleBlock"
      data-block-id="${b.id}"
      tabindex="0"
      role="button"
      aria-expanded="${isExpanded ? 'true' : 'false'}">
      <div class="gt-card-header">
        <span class="gt-card-time">${b.startTime} – ${b.endTime}</span>
        <span class="gt-card-location">${locationName}</span>
      </div>
      <div class="gt-card-title">${title}</div>
      <div class="gt-card-signup">${signupLabel}</div>
    </div>${raw(detailSlot)}`;
  }).join('');

  container.innerHTML = html`<div class="gt-timeline">${raw(cards)}</div>`;
}

// ─── Block detail fold-out ──────────────────────────────────────────────────

async function gtToggleBlock(blockId: string): Promise<void> {
  if (_gtExpandedBlockId === blockId) {
    _gtExpandedBlockId = null;
    _gtExpandedBlockDetail = null;
    gtRenderSchedule();
    return;
  }

  _gtExpandedBlockId = blockId;
  _gtExpandedBlockDetail = null;
  gtRenderSchedule();

  // Fetch detail
  var detail = await gtFetchBlockDetail(blockId);
  if (!detail || _gtExpandedBlockId !== blockId) return;

  _gtExpandedBlockDetail = detail;
  gtRenderBlockDetail();
}

function gtRenderBlockDetail(): void {
  var container = document.getElementById('gt-block-detail');
  if (!container || !_gtExpandedBlockDetail) {
    if (container) container.innerHTML = '';
    return;
  }

  var b = _gtExpandedBlockDetail;
  var title = b.project ? b.project.name : (b.title || 'Untitled');
  var description = b.project?.description || b.description || '';
  var locationName = b.location?.name || '';

  // Sign-up section
  var signupHtml = gtRenderSignupSection(b);

  // Tasks/Shopping/Tools for linked blocks
  var itemsHtml = '';
  if (b.projectId && b.project) {
    var tasksHtml = (b.tasks || []).map((t: any) => {
      var statusInfo = TASK_STATUSES[t.status] || { label: t.status, color: '#999' };
      var assigneeHtml = t.assignee ? html` <span class="gt-assignee">— ${t.assignee}</span>` : '';
      return html`<li class="gt-prep-item">
        <a href="#project/${b.project.id}" class="gt-prep-link">${t.name}</a>
        <span class="status-pill" style="background:${statusInfo.color}">${statusInfo.label}</span>
        ${raw(assigneeHtml)}
      </li>`;
    }).join('');

    var shoppingHtml = (b.shoppingItems || []).map((item: any) => {
      var price = item.pricePerItem ? `€${Number(item.pricePerItem).toFixed(2)}` : '';
      return html`<li class="gt-prep-item">
        <a href="#project/${b.project.id}" class="gt-prep-link">${item.name}</a>
        <span class="gt-meta">${item.quantity ? 'x' + item.quantity : ''} ${price}</span>
      </li>`;
    }).join('');

    var toolsHtml = (b.toolItems || []).map((item: any) =>
      html`<li class="gt-prep-item">
        <a href="#project/${b.project.id}" class="gt-prep-link">${item.name}</a>
        <span class="gt-meta">${item.quantity > 1 ? 'x' + item.quantity : ''}</span>
      </li>`
    ).join('');

    if (tasksHtml || shoppingHtml || toolsHtml) {
      itemsHtml = '<div class="gt-detail-items">';
      if (tasksHtml) itemsHtml += html`<h4>Tasks</h4><ul class="gt-prep-list">${raw(tasksHtml)}</ul>`;
      if (shoppingHtml) itemsHtml += html`<h4>Shopping</h4><ul class="gt-prep-list">${raw(shoppingHtml)}</ul>`;
      if (toolsHtml) itemsHtml += html`<h4>Tools & Items</h4><ul class="gt-prep-list">${raw(toolsHtml)}</ul>`;
      itemsHtml += '</div>';
    }
  }

  // Admin controls
  var adminHtml = '';
  if (S.isAdmin) {
    adminHtml = html`<div class="gt-detail-admin">
      <button class="btn btn-small" data-action="gtEditBlock" data-block-id="${b.id}">Edit</button>
      <button class="btn btn-small btn-danger" data-action="gtDeleteBlock" data-block-id="${b.id}">Delete</button>
    </div>`;
  }

  container.innerHTML = html`<div class="gt-detail" data-block-id="${b.id}">
    <h3>${title}</h3>
    <div class="gt-detail-meta">
      <span>${b.startTime} – ${b.endTime}</span>
      <span>${locationName}</span>
    </div>
    ${raw(description ? `<div class="gt-detail-desc">${description}</div>` : '')}
    ${raw(signupHtml)}
    ${raw(itemsHtml)}
    ${raw(adminHtml)}
  </div>`;
}

// ─── Sign-up section ────────────────────────────────────────────────────────

function gtRenderSignupSection(block: any): string {
  var signups: any[] = block.signups || [];
  var cap = block.signupCap;
  var count = block.signupCount ?? signups.length;
  var visitorName = S.visitorName;
  var isSigned = signups.some((s: any) => s.name === visitorName);
  var isFull = cap !== null && count >= cap;

  // Names list
  var showCount = 10;
  var visibleNames = signups.slice(0, showCount);
  var extraCount = signups.length - showCount;

  var namesHtml = visibleNames.map((s: any) => html`<span class="gt-signup-name">${s.name}</span>`).join('');
  if (extraCount > 0) {
    namesHtml += html`<span class="gt-signup-more">and ${extraCount} more...</span>`;
  }

  // Button
  var buttonHtml = '';
  if (!visitorName) {
    buttonHtml = html`<p class="gt-signup-prompt">Enter your name above to sign up for activities.</p>`;
  } else if (isSigned) {
    buttonHtml = html`<button class="btn btn-small gt-signup-leave" data-action="gtLeaveBlock" data-block-id="${block.id}" data-stop>Leave</button>`;
  } else if (isFull) {
    buttonHtml = html`<button class="btn btn-small" disabled>Full</button>`;
  } else {
    buttonHtml = html`<button class="btn btn-primary btn-small" data-action="gtSignupBlock" data-block-id="${block.id}" data-stop>Sign up</button>`;
  }

  var countText = cap ? `${count}/${cap}` : `${count} signed up`;

  return html`<div class="gt-signup-section">
    <div class="gt-signup-header">
      <h4>Sign-ups <span class="gt-signup-count">${countText}</span></h4>
      ${raw(buttonHtml)}
    </div>
    <div class="gt-signup-names">${raw(namesHtml)}</div>
  </div>`;
}

async function gtSignupBlock(blockId: string): Promise<void> {
  var name = S.visitorName;
  if (!name) return;
  try {
    await apiPost(`/api/get-together/blocks/${blockId}/signup`, { name });
    toast('Signed up!', 'success');
  } catch (e: any) {
    toast(e.message || 'Could not sign up', 'error');
  }
}

async function gtLeaveBlock(blockId: string): Promise<void> {
  var name = S.visitorName;
  if (!name) return;
  try {
    await apiFetch('DELETE', `/api/get-together/blocks/${blockId}/signup`, { name });
    toast('Left the block', 'info');
  } catch (e: any) {
    toast(e.message || 'Could not leave', 'error');
  }
}

// ─── Prep section ───────────────────────────────────────────────────────────

function gtRenderPrep(): void {
  var container = document.getElementById('gt-prep');
  if (!container || !_gtPrep) return;

  var day1 = _gtPrep.day1;
  var day2 = _gtPrep.day2;

  var hasDay1 = day1 && (day1.tasks.length || day1.shoppingItems.length || day1.toolItems.length);
  var hasDay2 = day2 && (day2.tasks.length || day2.shoppingItems.length || day2.toolItems.length);

  if (!hasDay1 && !hasDay2) {
    container.innerHTML = html`<div class="gt-prep-section"><h2>What still needs to happen</h2><p class="gt-prep-done">Everything is ready!</p></div>`;
    return;
  }

  var sections = '';
  if (hasDay1) sections += gtRenderPrepDay('Saturday', day1);
  if (hasDay2) sections += gtRenderPrepDay('Sunday', day2);

  container.innerHTML = html`<div class="gt-prep-section">
    <h2>What still needs to happen</h2>
    ${raw(sections)}
  </div>`;
}

function gtRenderPrepDay(label: string, data: any): string {
  // Tasks — reuse .task-item pattern from projects
  var tasksHtml = (data.tasks || []).map((t: any) => {
    var statusInfo = TASK_STATUSES[t.status] || { label: t.status, color: '#999' };
    var statusIcon = t.status === 'done' ? '&#x2713;' : t.status === 'in_progress' ? '&#x25CF;' : '';
    var assigneeHtml = t.assignee ? html`<span>&#x1F464; ${t.assignee}</span>` : '';
    return html`<a href="#project/${t.projectId}" class="task-item gt-prep-task" style="text-decoration:none;color:inherit">
      <div class="task-status-btn ${t.status}">${raw(statusIcon)}</div>
      <div class="task-content">
        <div class="task-name ${t.status === 'done' ? 'done' : ''}">${t.name}</div>
        <div class="task-meta">
          <span class="gt-prep-project">${t.projectName}</span>
          ${raw(assigneeHtml)}
        </div>
      </div>
    </a>`;
  }).join('');

  // Shopping — reuse .shopping-row pattern
  var shoppingHtml = '';
  if (data.shoppingItems?.length) {
    var shoppingRows = (data.shoppingItems || []).map((item: any) => {
      var price = item.pricePerItem ? `€${Number(item.pricePerItem).toFixed(2)}` : '';
      var total = (item.pricePerItem && item.quantity) ? `€${(Number(item.pricePerItem) * Number(item.quantity)).toFixed(2)}` : '';
      return html`<div class="shopping-row">
        <span class="sh-name"><a href="#project/${item.projectId}">${item.name}</a> <span class="gt-prep-project">${item.projectName}</span></span>
        <span class="sh-price">${price}</span>
        <span class="sh-qty">${item.quantity || ''}</span>
        <span class="sh-total">${total}</span>
      </div>`;
    }).join('');

    shoppingHtml = html`<div class="shopping-table">
      <div class="shopping-table-head">
        <span class="sh-name">Item</span>
        <span class="sh-price">Price</span>
        <span class="sh-qty">Qty</span>
        <span class="sh-total">Total</span>
      </div>
      ${raw(shoppingRows)}
    </div>`;
  }

  // Tools — reuse .shopping-row + .shopping-check pattern
  var toolsHtml = '';
  if (data.toolItems?.length) {
    var toolRows = (data.toolItems || []).map((item: any) => {
      var checked = item.available ? 'checked' : '';
      return html`<div class="shopping-row" data-tool-id="${item.id}">
        <span class="sh-status">
          <button class="shopping-check ${checked}" data-action="gtToggleToolBtn" data-tool-id="${item.id}" data-stop>${raw(item.available ? '&#x2713;' : '')}</button>
        </span>
        <span class="sh-name"><a href="#project/${item.projectId}">${item.name}</a> <span class="gt-prep-project">${item.projectName}</span></span>
        <span class="sh-qty">${item.quantity > 1 ? item.quantity : ''}</span>
      </div>`;
    }).join('');

    toolsHtml = html`<div class="shopping-table">
      <div class="shopping-table-head gt-tool-head">
        <span class="sh-status">Have</span>
        <span class="sh-name">Tool / Item</span>
        <span class="sh-qty">Qty</span>
      </div>
      ${raw(toolRows)}
    </div>`;
  }

  var sections = '';
  if (tasksHtml) sections += html`<div class="gt-prep-category">
    <h4>Tasks</h4>
    <div class="gt-prep-tasks">${raw(tasksHtml)}</div>
  </div>`;
  if (shoppingHtml) sections += html`<div class="gt-prep-category">
    <h4>Shopping</h4>
    ${raw(shoppingHtml)}
  </div>`;
  if (toolsHtml) sections += html`<div class="gt-prep-category">
    <h4>Tools &amp; Items</h4>
    ${raw(toolsHtml)}
  </div>`;

  return html`<div class="gt-prep-day">
    <h3>${label}</h3>
    ${raw(sections)}
  </div>`;
}

async function gtToggleTool(toolItemId: string, available: boolean): Promise<void> {
  try {
    await apiPatch(`/api/tools/${toolItemId}/available`, { available });
  } catch (e: any) {
    toast(e.message || 'Failed to update', 'error');
    // Refresh prep to reset checkbox
    await gtFetchPrep();
    gtRenderPrep();
  }
}

// ─── Map zoom ───────────────────────────────────────────────────────────────

function gtToggleMapZoom(img: HTMLElement): void {
  if (img.classList.contains('gt-map-zoomed')) {
    img.classList.remove('gt-map-zoomed');
  } else {
    img.classList.add('gt-map-zoomed');
  }
}

// ─── Admin: Block form ──────────────────────────────────────────────────────

async function gtShowBlockForm(editBlockId?: string): Promise<void> {
  var editing = false;
  var block: any = null;

  if (editBlockId) {
    block = await gtFetchBlockDetail(editBlockId);
    if (!block) return toast('Block not found', 'error');
    editing = true;
  }

  // Fetch active projects for dropdown
  var projects: any[] = [];
  try {
    projects = await apiGet('/api/projects');
  } catch { /* ignore */ }
  var activeProjects = projects.filter((p: any) => p.status === 'active' && !p.deletedAt);

  var locationOptions = _gtLocations.map((l: any) =>
    html`<option value="${l.id}" ${block && block.locationId === l.id ? 'selected' : ''}>${l.name}</option>`
  ).join('');

  var projectOptions = html`<option value="">— Select project —</option>` +
    activeProjects.map((p: any) =>
      html`<option value="${p.id}" ${block && block.projectId === p.id ? 'selected' : ''}>${p.name}</option>`
    ).join('');

  // Time picker options (15-min increments, 09:00–21:00)
  var timeOptions = '';
  for (var h = 9; h <= 21; h++) {
    for (var m = 0; m < 60; m += 15) {
      if (h === 21 && m > 0) break;
      var t = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      timeOptions += html`<option value="${t}">${t}</option>`;
    }
  }

  var isLinked = block ? !!block.projectId : false;

  var backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = html`<div class="modal gt-block-modal">
    <h3>${editing ? 'Edit Block' : 'Add Block'}</h3>
    <form id="gt-block-form">
      <label>Day
        <select name="day">
          <option value="day1" ${!block || block.day === 'day1' ? 'selected' : ''}>Saturday April 11</option>
          <option value="day2" ${block && block.day === 'day2' ? 'selected' : ''}>Sunday April 12</option>
        </select>
      </label>
      <label>Location
        <select name="locationId">${raw(locationOptions)}</select>
      </label>
      <div class="gt-form-times">
        <label>Start time
          <select name="startTime">${raw(timeOptions)}</select>
        </label>
        <label>End time
          <select name="endTime">${raw(timeOptions)}</select>
        </label>
      </div>
      <label class="gt-form-toggle">
        <input type="checkbox" id="gt-link-toggle" ${isLinked ? 'checked' : ''}>
        Link to project
      </label>
      <div id="gt-project-field" style="${isLinked ? '' : 'display:none'}">
        <label>Project
          <select name="projectId">${raw(projectOptions)}</select>
        </label>
      </div>
      <div id="gt-custom-fields" style="${isLinked ? 'display:none' : ''}">
        <label>Title
          <input type="text" name="title" value="${block && !block.projectId ? (block.title || '') : ''}" maxlength="200">
        </label>
        <label>Description
          <textarea name="description" rows="3">${block && !block.projectId ? (block.description || '') : ''}</textarea>
        </label>
      </div>
      <label>Sign-up cap (leave empty for unlimited)
        <input type="number" name="signupCap" min="1" value="${block?.signupCap || ''}">
      </label>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="closeModal">Cancel</button>
        <button type="submit" class="btn btn-primary">${editing ? 'Save' : 'Create'}</button>
      </div>
    </form>
  </div>`;

  openModal(backdrop, editing ? 'Edit Block' : 'Add Block');

  // Set time values + attach listeners after DOM is ready
  var form = document.getElementById('gt-block-form') as HTMLFormElement;
  if (block) {
    (form.querySelector('[name="startTime"]') as HTMLSelectElement).value = block.startTime;
    (form.querySelector('[name="endTime"]') as HTMLSelectElement).value = block.endTime;
  } else {
    (form.querySelector('[name="startTime"]') as HTMLSelectElement).value = '10:00';
    (form.querySelector('[name="endTime"]') as HTMLSelectElement).value = '11:00';
  }

  // Link toggle
  var linkToggle = document.getElementById('gt-link-toggle') as HTMLInputElement;
  linkToggle.addEventListener('change', () => {
    var projectField = document.getElementById('gt-project-field')!;
    var customFields = document.getElementById('gt-custom-fields')!;
    projectField.style.display = linkToggle.checked ? '' : 'none';
    customFields.style.display = linkToggle.checked ? 'none' : '';
  });

  form.addEventListener('submit', async (e: Event) => {
    e.preventDefault();
    var fd = new FormData(form);
    var data: any = {
      day: fd.get('day'),
      locationId: fd.get('locationId'),
      startTime: fd.get('startTime'),
      endTime: fd.get('endTime'),
    };

    if (linkToggle.checked) {
      data.projectId = fd.get('projectId') || null;
      data.title = null;
      data.description = null;
    } else {
      data.projectId = null;
      data.title = fd.get('title');
      data.description = fd.get('description');
    }

    var capVal = fd.get('signupCap') as string;
    data.signupCap = capVal ? parseInt(capVal, 10) : null;

    try {
      if (editing && editBlockId) {
        await apiPatch(`/api/get-together/blocks/${editBlockId}`, data);
        toast('Block updated', 'success');
      } else {
        await apiPost('/api/get-together/blocks', data);
        toast('Block created', 'success');
      }
      closeModal(backdrop);
    } catch (err: any) {
      toast(err.message || 'Failed to save block', 'error');
    }
  });
}

async function gtDeleteBlock(blockId: string): Promise<void> {
  if (!confirm('Delete this block? This will also remove all sign-ups.')) return;
  try {
    await apiFetch('DELETE', `/api/get-together/blocks/${blockId}`);
    toast('Block deleted', 'success');
  } catch (e: any) {
    toast(e.message || 'Failed to delete', 'error');
  }
}

// ─── Admin: Location manager ────────────────────────────────────────────────

function gtShowLocationManager(): void {
  var backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'gt-location-modal';

  gtRenderLocationModal(backdrop);
  openModal(backdrop, 'Manage Locations');
}

function gtRenderLocationModal(backdrop: HTMLElement): void {
  var listHtml = _gtLocations.map((loc: any, i: number) =>
    html`<div class="gt-loc-row" data-loc-id="${loc.id}">
      <input type="text" value="${loc.name}" class="gt-loc-name" data-loc-id="${loc.id}">
      <button class="btn btn-small" data-action="gtMoveLocation" data-loc-id="${loc.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>&#x2191;</button>
      <button class="btn btn-small" data-action="gtMoveLocation" data-loc-id="${loc.id}" data-dir="1" ${i === _gtLocations.length - 1 ? 'disabled' : ''}>&#x2193;</button>
      <button class="btn btn-small" data-action="gtRenameLocation" data-loc-id="${loc.id}">Save</button>
      <button class="btn btn-small btn-danger" data-action="gtDeleteLocation" data-loc-id="${loc.id}">Delete</button>
    </div>`
  ).join('');

  backdrop.innerHTML = html`<div class="modal gt-loc-modal">
    <h3>Manage Locations</h3>
    <div class="gt-loc-list">${raw(listHtml)}</div>
    <div class="gt-loc-add">
      <input type="text" id="gt-new-loc-name" placeholder="New location name" maxlength="200">
      <button class="btn btn-primary btn-small" data-action="gtAddLocation">Add</button>
    </div>
    <div class="modal-actions">
      <button class="btn" data-action="closeModal">Close</button>
    </div>
  </div>`;
}

async function gtAddLocation(): Promise<void> {
  var input = document.getElementById('gt-new-loc-name') as HTMLInputElement;
  var name = input.value.trim();
  if (!name) return;
  try {
    var res = await apiPost('/api/get-together/locations', { name, order: _gtLocations.length });
    _gtLocations.push(res.location);
    input.value = '';
    var backdrop = document.getElementById('gt-location-modal');
    if (backdrop) gtRenderLocationModal(backdrop);
    gtRenderSchedule();
  } catch (e: any) {
    toast(e.message || 'Failed to add location', 'error');
  }
}

async function gtRenameLocation(locId: string): Promise<void> {
  var input = document.querySelector(`.gt-loc-name[data-loc-id="${locId}"]`) as HTMLInputElement;
  if (!input) return;
  try {
    var res = await apiPatch(`/api/get-together/locations/${locId}`, { name: input.value.trim() });
    var idx = _gtLocations.findIndex((l: any) => l.id === locId);
    if (idx !== -1) _gtLocations[idx] = res.location;
    gtRenderSchedule();
    toast('Location renamed', 'success');
  } catch (e: any) {
    toast(e.message || 'Failed to rename', 'error');
  }
}

async function gtMoveLocation(locId: string, direction: number): Promise<void> {
  var idx = _gtLocations.findIndex((l: any) => l.id === locId);
  var targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= _gtLocations.length) return;

  // Swap orders
  var currentOrder = _gtLocations[idx].order;
  var targetOrder = _gtLocations[targetIdx].order;

  try {
    await Promise.all([
      apiPatch(`/api/get-together/locations/${_gtLocations[idx].id}`, { order: targetOrder }),
      apiPatch(`/api/get-together/locations/${_gtLocations[targetIdx].id}`, { order: currentOrder }),
    ]);
    _gtLocations[idx].order = targetOrder;
    _gtLocations[targetIdx].order = currentOrder;
    _gtLocations.sort((a: any, b: any) => a.order - b.order);

    var backdrop = document.getElementById('gt-location-modal');
    if (backdrop) gtRenderLocationModal(backdrop);
    gtRenderSchedule();
  } catch (e: any) {
    toast(e.message || 'Failed to reorder', 'error');
  }
}

async function gtDeleteLocation(locId: string): Promise<void> {
  if (!confirm('Delete this location?')) return;
  try {
    await apiFetch('DELETE', `/api/get-together/locations/${locId}`);
    _gtLocations = _gtLocations.filter((l: any) => l.id !== locId);
    var backdrop = document.getElementById('gt-location-modal');
    if (backdrop) gtRenderLocationModal(backdrop);
    gtRenderSchedule();
    toast('Location deleted', 'success');
  } catch (e: any) {
    toast(e.message || 'Failed to delete', 'error');
  }
}

// ─── Admin: Map upload ──────────────────────────────────────────────────────

function gtShowMapUpload(): void {
  var backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = html`<div class="modal">
    <h3>Upload Floor Map</h3>
    <form id="gt-map-form">
      <input type="file" name="file" accept="image/*" required>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="closeModal">Cancel</button>
        <button type="submit" class="btn btn-primary">Upload</button>
      </div>
    </form>
  </div>`;

  openModal(backdrop, 'Upload Floor Map');

  var form = document.getElementById('gt-map-form') as HTMLFormElement;
  form.addEventListener('submit', async (e: Event) => {
    e.preventDefault();
    var fileInput = form.querySelector('input[type="file"]') as HTMLInputElement;
    if (!fileInput.files?.length) return;
    var fd = new FormData();
    fd.append('file', fileInput.files[0]);
    try {
      var res = await apiUpload('/api/get-together/map', fd);
      _gtMapUrl = res.url;
      closeModal(backdrop);
      gtRenderPage();
      toast('Map uploaded', 'success');
    } catch (err: any) {
      toast(err.message || 'Upload failed', 'error');
    }
  });
}

// ─── Action handlers (event delegation) ─────────────────────────────────────

onAction('gtSwitchDay', (el: HTMLElement) => gtSwitchDay(el.dataset.day as 'day1' | 'day2'));
onAction('gtToggleBlock', (el: HTMLElement) => gtToggleBlock(el.dataset.blockId!));
onAction('gtSignupBlock', (el: HTMLElement) => gtSignupBlock(el.dataset.blockId!));
onAction('gtLeaveBlock', (el: HTMLElement) => gtLeaveBlock(el.dataset.blockId!));
onAction('gtEditBlock', (el: HTMLElement) => gtShowBlockForm(el.dataset.blockId!));
onAction('gtDeleteBlock', (el: HTMLElement) => gtDeleteBlock(el.dataset.blockId!));
onAction('gtShowBlockForm', () => gtShowBlockForm());
onAction('gtShowLocationManager', () => gtShowLocationManager());
onAction('gtShowMapUpload', () => gtShowMapUpload());
onAction('gtToggleMapZoom', (el: HTMLElement) => gtToggleMapZoom(el));
onAction('gtAddLocation', () => gtAddLocation());
onAction('gtRenameLocation', (el: HTMLElement) => gtRenameLocation(el.dataset.locId!));
onAction('gtDeleteLocation', (el: HTMLElement) => gtDeleteLocation(el.dataset.locId!));
onAction('gtMoveLocation', (el: HTMLElement) => gtMoveLocation(el.dataset.locId!, parseInt(el.dataset.dir!)));
onAction('gtToggleToolBtn', (el: HTMLElement) => {
  var isChecked = el.classList.contains('checked');
  gtToggleTool(el.dataset.toolId!, !isChecked);
  // Optimistic toggle
  el.classList.toggle('checked');
  el.innerHTML = isChecked ? '' : '&#x2713;';
});

// ─── SSE handlers ───────────────────────────────────────────────────────────

function gtRegisterSSE(): void {
  // Clean up previous listeners
  gtCleanupSSE();

  if (!_eventSource) return;

  var handlers: Record<string, (e: Event) => void> = {
    'get-together:block-created': (e: Event) => {
      var data = JSON.parse((e as MessageEvent).data);
      if (data._mutationId && S._pendingMutationIds.has(data._mutationId)) {
        S._pendingMutationIds.delete(data._mutationId);
        return;
      }
      var block = data.block;
      if (block) {
        _gtBlocks = [..._gtBlocks.filter((b: any) => b.id !== block.id), block];
        gtRenderSchedule();
      }
    },
    'get-together:block-updated': (e: Event) => {
      var data = JSON.parse((e as MessageEvent).data);
      if (data._mutationId && S._pendingMutationIds.has(data._mutationId)) {
        S._pendingMutationIds.delete(data._mutationId);
        return;
      }
      var block = data.block;
      if (block) {
        _gtBlocks = _gtBlocks.map((b: any) => b.id === block.id ? block : b);
        gtRenderSchedule();
        if (_gtExpandedBlockId === block.id) {
          _gtExpandedBlockDetail = { ..._gtExpandedBlockDetail, ...block };
          gtRenderBlockDetail();
        }
      }
    },
    'get-together:block-deleted': (e: Event) => {
      var data = JSON.parse((e as MessageEvent).data);
      if (data._mutationId && S._pendingMutationIds.has(data._mutationId)) {
        S._pendingMutationIds.delete(data._mutationId);
        return;
      }
      _gtBlocks = _gtBlocks.filter((b: any) => b.id !== data.blockId);
      if (_gtExpandedBlockId === data.blockId) {
        _gtExpandedBlockId = null;
        _gtExpandedBlockDetail = null;
      }
      gtRenderSchedule();
    },
    'get-together:signup-added': (e: Event) => {
      var data = JSON.parse((e as MessageEvent).data);
      if (data._mutationId && S._pendingMutationIds.has(data._mutationId)) {
        S._pendingMutationIds.delete(data._mutationId);
        return;
      }
      gtUpdateBlockSignup(data.blockId, data.signupCount, data.signup, 'add');
    },
    'get-together:signup-removed': (e: Event) => {
      var data = JSON.parse((e as MessageEvent).data);
      if (data._mutationId && S._pendingMutationIds.has(data._mutationId)) {
        S._pendingMutationIds.delete(data._mutationId);
        return;
      }
      gtUpdateBlockSignup(data.blockId, data.signupCount, { name: data.name }, 'remove');
    },
    'get-together:location-created': (e: Event) => {
      var data = JSON.parse((e as MessageEvent).data);
      if (data._mutationId && S._pendingMutationIds.has(data._mutationId)) {
        S._pendingMutationIds.delete(data._mutationId);
        return;
      }
      if (data.location) {
        _gtLocations = [..._gtLocations, data.location].sort((a: any, b: any) => a.order - b.order);
        gtRenderSchedule();
      }
    },
    'get-together:location-updated': (e: Event) => {
      var data = JSON.parse((e as MessageEvent).data);
      if (data._mutationId && S._pendingMutationIds.has(data._mutationId)) {
        S._pendingMutationIds.delete(data._mutationId);
        return;
      }
      if (data.location) {
        _gtLocations = _gtLocations.map((l: any) => l.id === data.location.id ? data.location : l).sort((a: any, b: any) => a.order - b.order);
        gtRenderSchedule();
      }
    },
    'get-together:location-deleted': (e: Event) => {
      var data = JSON.parse((e as MessageEvent).data);
      if (data._mutationId && S._pendingMutationIds.has(data._mutationId)) {
        S._pendingMutationIds.delete(data._mutationId);
        return;
      }
      _gtLocations = _gtLocations.filter((l: any) => l.id !== data.locationId);
      gtRenderSchedule();
    },
    'get-together:tool-toggled': (e: Event) => {
      var data = JSON.parse((e as MessageEvent).data);
      // Update prep section checkbox
      var checkbox = document.querySelector(`.gt-tool-item[data-tool-id="${data.toolItemId}"] input[type="checkbox"]`) as HTMLInputElement;
      if (checkbox) checkbox.checked = data.available;
    },
  };

  for (var [eventType, handler] of Object.entries(handlers)) {
    _eventSource.addEventListener(eventType, handler);
    _gtSSECleanup.push(() => {
      if (_eventSource) _eventSource.removeEventListener(eventType, handler);
    });
  }
}

function gtUpdateBlockSignup(blockId: string, signupCount: number, signup: any, action: string): void {
  // Update the block in the list
  _gtBlocks = _gtBlocks.map((b: any) => {
    if (b.id !== blockId) return b;
    var signups = [...(b.signups || [])];
    if (action === 'add') {
      if (!signups.some((s: any) => s.name === signup.name)) {
        signups.push(signup);
      }
    } else {
      signups = signups.filter((s: any) => s.name !== signup.name);
    }
    return { ...b, signups, signupCount };
  });

  gtRenderSchedule();

  // Update detail if this block is expanded
  if (_gtExpandedBlockId === blockId && _gtExpandedBlockDetail) {
    var updatedBlock = _gtBlocks.find((b: any) => b.id === blockId);
    if (updatedBlock) {
      _gtExpandedBlockDetail = { ..._gtExpandedBlockDetail, signups: updatedBlock.signups, signupCount };
      gtRenderBlockDetail();
    }
  }
}

function gtCleanupSSE(): void {
  for (var cleanup of _gtSSECleanup) {
    try { cleanup(); } catch { /* ignore */ }
  }
  _gtSSECleanup = [];
}
