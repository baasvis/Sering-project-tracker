"use strict";
/* ========================================
   Get Together — Festival schedule page
   Two-day grid/timeline for April 11–12, 2026
   ======================================== */
// ─── State keys for get-together ────────────────────────────────────────────
var _gtBlocks = [];
var _gtLocations = [];
var _gtSelectedDay = 'day1';
var _gtMapUrl = null;
var _gtPrep = null;
var _gtExpandedBlockId = null;
var _gtExpandedBlockDetail = null;
var _gtSSECleanup = [];
// Day labels
var GT_DAYS = {
    day1: { label: 'Saturday April 11', date: '2026-04-11' },
    day2: { label: 'Sunday April 12', date: '2026-04-12' },
};
// Time grid: 09:00–20:30 in 30-min columns = 24 columns
var GT_TIME_SLOTS = [];
(function () {
    for (var h = 9; h < 21; h++) {
        GT_TIME_SLOTS.push(String(h).padStart(2, '0') + ':00');
        GT_TIME_SLOTS.push(String(h).padStart(2, '0') + ':30');
    }
})();
// ─── Data fetching ──────────────────────────────────────────────────────────
async function gtFetchAll() {
    try {
        var [blocksRes, locRes, mapRes] = await Promise.all([
            apiFetch('GET', '/api/get-together/blocks'),
            apiFetch('GET', '/api/get-together/locations'),
            apiFetch('GET', '/api/get-together/map'),
        ]);
        _gtBlocks = blocksRes.blocks || [];
        _gtLocations = locRes.locations || [];
        _gtMapUrl = mapRes.url || null;
    }
    catch (e) {
        toast('Failed to load get-together data', 'error');
    }
}
async function gtFetchPrep() {
    try {
        _gtPrep = await apiFetch('GET', '/api/get-together/prep');
    }
    catch {
        _gtPrep = null;
    }
}
async function gtFetchBlockDetail(blockId) {
    try {
        var res = await apiFetch('GET', `/api/get-together/blocks/${blockId}`);
        return res.block;
    }
    catch {
        return null;
    }
}
// ─── Default day selection ──────────────────────────────────────────────────
function gtDefaultDay() {
    var today = new Date().toISOString().slice(0, 10);
    if (today === '2026-04-12')
        return 'day2';
    return 'day1';
}
// ─── Main render ────────────────────────────────────────────────────────────
async function renderGetTogether() {
    var app = document.getElementById('app');
    _gtSelectedDay = gtDefaultDay();
    _gtExpandedBlockId = null;
    _gtExpandedBlockDetail = null;
    app.innerHTML = html `<div class="gt-page"><div class="gt-loading">Loading schedule...</div></div>`;
    await Promise.all([gtFetchAll(), gtFetchPrep()]);
    gtRenderPage();
    gtRegisterSSE();
}
function gtRenderPage() {
    var app = document.getElementById('app');
    var isAdmin = S.isAdmin;
    var mapHtml = '';
    if (_gtMapUrl) {
        mapHtml = html `<div class="gt-map">
      <img src="${_gtMapUrl}" alt="Floor map" class="gt-map-img" onclick="gtToggleMapZoom(this)">
    </div>`;
    }
    var adminControls = '';
    if (isAdmin) {
        adminControls = html `<div class="gt-admin-controls">
      <button class="btn btn-primary btn-small" onclick="gtShowBlockForm()">Add Block</button>
      <button class="btn btn-small" onclick="gtShowLocationManager()">Manage Locations</button>
      <button class="btn btn-small" onclick="gtShowMapUpload()">Upload Map</button>
    </div>`;
    }
    app.innerHTML = html `<div class="gt-page">
    <div class="gt-header">
      <h1>Get Together — April 11 & 12</h1>
      <p class="gt-intro">Two days of building, fixing, planning, and eating together at Sering Centraal.</p>
      ${raw(mapHtml)}
      <div class="gt-day-toggle">
        <button class="btn gt-day-btn ${_gtSelectedDay === 'day1' ? 'active' : ''}" onclick="gtSwitchDay('day1')">${GT_DAYS.day1.label}</button>
        <button class="btn gt-day-btn ${_gtSelectedDay === 'day2' ? 'active' : ''}" onclick="gtSwitchDay('day2')">${GT_DAYS.day2.label}</button>
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
function gtSwitchDay(day) {
    _gtSelectedDay = day;
    _gtExpandedBlockId = null;
    _gtExpandedBlockDetail = null;
    // Update button states
    var buttons = document.querySelectorAll('.gt-day-btn');
    buttons.forEach((btn) => {
        btn.classList.toggle('active', btn.textContent === GT_DAYS[day].label);
    });
    gtRenderSchedule();
}
// ─── Schedule: Desktop grid vs Mobile timeline ─────────────────────────────
function gtRenderSchedule() {
    var container = document.getElementById('gt-schedule');
    if (!container)
        return;
    var dayBlocks = _gtBlocks.filter((b) => b.day === _gtSelectedDay);
    if (dayBlocks.length === 0 && _gtLocations.length === 0) {
        container.innerHTML = html `<div class="gt-empty">No activities scheduled for this day yet.</div>`;
        return;
    }
    if (window.innerWidth < 768) {
        gtRenderTimeline(container, dayBlocks);
    }
    else {
        gtRenderGrid(container, dayBlocks);
    }
}
// ─── Desktop Grid ───────────────────────────────────────────────────────────
function gtRenderGrid(container, dayBlocks) {
    var headerCells = GT_TIME_SLOTS.map((t) => html `<div class="gt-grid-header-cell">${t}</div>`).join('');
    // Group blocks by location
    var blocksByLocation = {};
    for (var b of dayBlocks) {
        var locId = b.locationId;
        if (!blocksByLocation[locId])
            blocksByLocation[locId] = [];
        blocksByLocation[locId].push(b);
    }
    var rows = _gtLocations.map((loc) => {
        var locBlocks = blocksByLocation[loc.id] || [];
        var blocksHtml = locBlocks.map((b) => gtRenderGridBlock(b)).join('');
        return html `<div class="gt-grid-row" data-location-id="${loc.id}">
      <div class="gt-grid-label">${loc.name}</div>
      <div class="gt-grid-cells">${raw(blocksHtml)}</div>
    </div>`;
    }).join('');
    container.innerHTML = html `<div class="gt-grid">
    <div class="gt-grid-row gt-grid-header">
      <div class="gt-grid-label"></div>
      <div class="gt-grid-cells">${raw(headerCells)}</div>
    </div>
    ${raw(rows)}
  </div>
  <div id="gt-block-detail"></div>`;
}
function gtTimeToMinutes(time) {
    var parts = time.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}
function gtRenderGridBlock(block) {
    var startMin = gtTimeToMinutes(block.startTime) - 540; // 540 = 9*60
    var endMin = gtTimeToMinutes(block.endTime) - 540;
    var columnWidth = 100 / GT_TIME_SLOTS.length; // percentage per 30-min column
    var left = (startMin / 30) * columnWidth;
    var width = ((endMin - startMin) / 30) * columnWidth;
    var title = block.project ? block.project.name : (block.title || 'Untitled');
    var colorClass = block.projectId ? 'gt-block-project' : 'gt-block-custom';
    var signupText = block.signupCap
        ? `${block.signupCount}/${block.signupCap}`
        : `${block.signupCount} signed up`;
    var isExpanded = _gtExpandedBlockId === block.id;
    return html `<div class="gt-block ${colorClass} ${isExpanded ? 'gt-block-expanded' : ''}"
    style="left:${left}%;width:${width}%"
    data-block-id="${block.id}"
    onclick="gtToggleBlock('${block.id}')"
    tabindex="0"
    role="button"
    aria-expanded="${isExpanded ? 'true' : 'false'}">
    <span class="gt-block-time">${block.startTime}–${block.endTime}</span>
    <span class="gt-block-title">${title}</span>
    <span class="gt-block-signup">${signupText}</span>
  </div>`;
}
// ─── Mobile Timeline ────────────────────────────────────────────────────────
function gtRenderTimeline(container, dayBlocks) {
    // Sort by startTime, then location order
    var locOrder = new Map(_gtLocations.map((l, i) => [l.id, i]));
    var sorted = [...dayBlocks].sort((a, b) => {
        var cmp = a.startTime.localeCompare(b.startTime);
        if (cmp !== 0)
            return cmp;
        return (locOrder.get(a.locationId) || 0) - (locOrder.get(b.locationId) || 0);
    });
    if (sorted.length === 0) {
        container.innerHTML = html `<div class="gt-empty">No activities scheduled for this day yet.</div>`;
        return;
    }
    var cards = sorted.map((b) => {
        var title = b.project ? b.project.name : (b.title || 'Untitled');
        var colorClass = b.projectId ? 'gt-block-project' : 'gt-block-custom';
        var locationName = b.location?.name || '';
        var signupText = b.signupCap
            ? `${b.signupCount}/${b.signupCap} signed up`
            : `${b.signupCount} signed up`;
        var isExpanded = _gtExpandedBlockId === b.id;
        return html `<div class="gt-timeline-card ${colorClass} ${isExpanded ? 'gt-card-expanded' : ''}"
      data-block-id="${b.id}"
      onclick="gtToggleBlock('${b.id}')"
      tabindex="0"
      role="button"
      aria-expanded="${isExpanded ? 'true' : 'false'}">
      <div class="gt-card-header">
        <span class="gt-card-time">${b.startTime} – ${b.endTime}</span>
        <span class="gt-card-location">${locationName}</span>
      </div>
      <div class="gt-card-title">${title}</div>
      <div class="gt-card-signup">${signupText}</div>
    </div>`;
    }).join('');
    container.innerHTML = html `<div class="gt-timeline">${raw(cards)}</div>
    <div id="gt-block-detail"></div>`;
}
// ─── Block detail fold-out ──────────────────────────────────────────────────
async function gtToggleBlock(blockId) {
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
    if (!detail || _gtExpandedBlockId !== blockId)
        return;
    _gtExpandedBlockDetail = detail;
    gtRenderBlockDetail();
}
function gtRenderBlockDetail() {
    var container = document.getElementById('gt-block-detail');
    if (!container || !_gtExpandedBlockDetail) {
        if (container)
            container.innerHTML = '';
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
        var tasksHtml = (b.tasks || []).map((t) => {
            var statusInfo = TASK_STATUSES[t.status] || { label: t.status, color: '#999' };
            var assigneeHtml = t.assignee ? html ` <span class="gt-assignee">— ${t.assignee}</span>` : '';
            return html `<li class="gt-prep-item">
        <a href="#project/${b.project.id}" class="gt-prep-link">${t.name}</a>
        <span class="status-pill" style="background:${statusInfo.color}">${statusInfo.label}</span>
        ${raw(assigneeHtml)}
      </li>`;
        }).join('');
        var shoppingHtml = (b.shoppingItems || []).map((item) => {
            var price = item.pricePerItem ? `€${Number(item.pricePerItem).toFixed(2)}` : '';
            return html `<li class="gt-prep-item">
        <a href="#project/${b.project.id}" class="gt-prep-link">${item.name}</a>
        <span class="gt-meta">${item.quantity ? 'x' + item.quantity : ''} ${price}</span>
      </li>`;
        }).join('');
        var toolsHtml = (b.toolItems || []).map((item) => html `<li class="gt-prep-item">
        <a href="#project/${b.project.id}" class="gt-prep-link">${item.name}</a>
        <span class="gt-meta">${item.quantity > 1 ? 'x' + item.quantity : ''}</span>
      </li>`).join('');
        if (tasksHtml || shoppingHtml || toolsHtml) {
            itemsHtml = '<div class="gt-detail-items">';
            if (tasksHtml)
                itemsHtml += html `<h4>Tasks</h4><ul class="gt-prep-list">${raw(tasksHtml)}</ul>`;
            if (shoppingHtml)
                itemsHtml += html `<h4>Shopping</h4><ul class="gt-prep-list">${raw(shoppingHtml)}</ul>`;
            if (toolsHtml)
                itemsHtml += html `<h4>Tools & Items</h4><ul class="gt-prep-list">${raw(toolsHtml)}</ul>`;
            itemsHtml += '</div>';
        }
    }
    // Admin controls
    var adminHtml = '';
    if (S.isAdmin) {
        adminHtml = html `<div class="gt-detail-admin">
      <button class="btn btn-small" onclick="gtShowBlockForm('${b.id}')">Edit</button>
      <button class="btn btn-small btn-danger" onclick="gtDeleteBlock('${b.id}')">Delete</button>
    </div>`;
    }
    container.innerHTML = html `<div class="gt-detail" data-block-id="${b.id}">
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
function gtRenderSignupSection(block) {
    var signups = block.signups || [];
    var cap = block.signupCap;
    var count = block.signupCount ?? signups.length;
    var visitorName = S.visitorName;
    var isSigned = signups.some((s) => s.name === visitorName);
    var isFull = cap !== null && count >= cap;
    // Names list
    var showCount = 10;
    var visibleNames = signups.slice(0, showCount);
    var extraCount = signups.length - showCount;
    var namesHtml = visibleNames.map((s) => html `<span class="gt-signup-name">${s.name}</span>`).join('');
    if (extraCount > 0) {
        namesHtml += html `<span class="gt-signup-more">and ${extraCount} more...</span>`;
    }
    // Button
    var buttonHtml = '';
    if (!visitorName) {
        buttonHtml = html `<p class="gt-signup-prompt">Enter your name above to sign up for activities.</p>`;
    }
    else if (isSigned) {
        buttonHtml = html `<button class="btn btn-small gt-signup-leave" onclick="event.stopPropagation(); gtLeaveBlock('${block.id}')">Leave</button>`;
    }
    else if (isFull) {
        buttonHtml = html `<button class="btn btn-small" disabled>Full</button>`;
    }
    else {
        buttonHtml = html `<button class="btn btn-primary btn-small" onclick="event.stopPropagation(); gtSignupBlock('${block.id}')">Sign up</button>`;
    }
    var countText = cap ? `${count}/${cap}` : `${count} signed up`;
    return html `<div class="gt-signup-section">
    <div class="gt-signup-header">
      <h4>Sign-ups <span class="gt-signup-count">${countText}</span></h4>
      ${raw(buttonHtml)}
    </div>
    <div class="gt-signup-names">${raw(namesHtml)}</div>
  </div>`;
}
async function gtSignupBlock(blockId) {
    var name = S.visitorName;
    if (!name)
        return;
    try {
        await apiPost(`/api/get-together/blocks/${blockId}/signup`, { name });
        toast('Signed up!', 'success');
    }
    catch (e) {
        toast(e.message || 'Could not sign up', 'error');
    }
}
async function gtLeaveBlock(blockId) {
    var name = S.visitorName;
    if (!name)
        return;
    try {
        await apiFetch('DELETE', `/api/get-together/blocks/${blockId}/signup`, { name });
        toast('Left the block', 'info');
    }
    catch (e) {
        toast(e.message || 'Could not leave', 'error');
    }
}
// ─── Prep section ───────────────────────────────────────────────────────────
function gtRenderPrep() {
    var container = document.getElementById('gt-prep');
    if (!container || !_gtPrep)
        return;
    var day1 = _gtPrep.day1;
    var day2 = _gtPrep.day2;
    var hasDay1 = day1 && (day1.tasks.length || day1.shoppingItems.length || day1.toolItems.length);
    var hasDay2 = day2 && (day2.tasks.length || day2.shoppingItems.length || day2.toolItems.length);
    if (!hasDay1 && !hasDay2) {
        container.innerHTML = html `<div class="gt-prep-section"><h2>What still needs to happen</h2><p class="gt-prep-done">Everything is ready! 🎉</p></div>`;
        return;
    }
    var sections = '';
    if (hasDay1)
        sections += gtRenderPrepDay('Saturday', day1);
    if (hasDay2)
        sections += gtRenderPrepDay('Sunday', day2);
    container.innerHTML = html `<div class="gt-prep-section">
    <h2>What still needs to happen</h2>
    ${raw(sections)}
  </div>`;
}
function gtRenderPrepDay(label, data) {
    var tasksHtml = (data.tasks || []).map((t) => {
        var statusInfo = TASK_STATUSES[t.status] || { label: t.status, color: '#999' };
        var assigneeHtml = t.assignee ? html ` <span class="gt-assignee">— ${t.assignee}</span>` : '';
        return html `<li class="gt-prep-item">
      <a href="#project/${t.projectId}" class="gt-prep-link">${t.name}</a>
      <span class="gt-prep-project">${t.projectName}</span>
      <span class="status-pill" style="background:${statusInfo.color}">${statusInfo.label}</span>
      ${raw(assigneeHtml)}
    </li>`;
    }).join('');
    var shoppingHtml = (data.shoppingItems || []).map((item) => {
        var price = item.pricePerItem ? `€${Number(item.pricePerItem).toFixed(2)}` : '';
        return html `<li class="gt-prep-item">
      <a href="#project/${item.projectId}" class="gt-prep-link">${item.name}</a>
      <span class="gt-prep-project">${item.projectName}</span>
      <span class="gt-meta">${item.quantity ? 'x' + item.quantity : ''} ${price}</span>
    </li>`;
    }).join('');
    var toolsHtml = (data.toolItems || []).map((item) => html `<li class="gt-prep-item gt-tool-item" data-tool-id="${item.id}">
      <label class="gt-tool-check" onclick="event.stopPropagation()">
        <input type="checkbox" ${item.available ? 'checked' : ''} onchange="gtToggleTool('${item.id}', this.checked)">
      </label>
      <a href="#project/${item.projectId}" class="gt-prep-link">${item.name}</a>
      <span class="gt-prep-project">${item.projectName}</span>
      <span class="gt-meta">${item.quantity > 1 ? 'x' + item.quantity : ''}</span>
    </li>`).join('');
    var content = '';
    if (tasksHtml)
        content += html `<h4>Tasks</h4><ul class="gt-prep-list">${raw(tasksHtml)}</ul>`;
    if (shoppingHtml)
        content += html `<h4>Shopping</h4><ul class="gt-prep-list">${raw(shoppingHtml)}</ul>`;
    if (toolsHtml)
        content += html `<h4>Tools & Items</h4><ul class="gt-prep-list">${raw(toolsHtml)}</ul>`;
    return html `<div class="gt-prep-day">
    <h3>${label}</h3>
    ${raw(content)}
  </div>`;
}
async function gtToggleTool(toolItemId, available) {
    try {
        await apiPatch(`/api/tools/${toolItemId}/available`, { available });
    }
    catch (e) {
        toast(e.message || 'Failed to update', 'error');
        // Refresh prep to reset checkbox
        await gtFetchPrep();
        gtRenderPrep();
    }
}
// ─── Map zoom ───────────────────────────────────────────────────────────────
function gtToggleMapZoom(img) {
    if (img.classList.contains('gt-map-zoomed')) {
        img.classList.remove('gt-map-zoomed');
    }
    else {
        img.classList.add('gt-map-zoomed');
    }
}
// ─── Admin: Block form ──────────────────────────────────────────────────────
async function gtShowBlockForm(editBlockId) {
    var editing = false;
    var block = null;
    if (editBlockId) {
        block = await gtFetchBlockDetail(editBlockId);
        if (!block)
            return toast('Block not found', 'error');
        editing = true;
    }
    // Fetch active projects for dropdown
    var projects = [];
    try {
        projects = await apiGet('/api/projects');
    }
    catch { /* ignore */ }
    var activeProjects = projects.filter((p) => p.status === 'active' && !p.deletedAt);
    var locationOptions = _gtLocations.map((l) => html `<option value="${l.id}" ${block && block.locationId === l.id ? 'selected' : ''}>${l.name}</option>`).join('');
    var projectOptions = html `<option value="">— Select project —</option>` +
        activeProjects.map((p) => html `<option value="${p.id}" ${block && block.projectId === p.id ? 'selected' : ''}>${p.name}</option>`).join('');
    // Time picker options (15-min increments, 09:00–21:00)
    var timeOptions = '';
    for (var h = 9; h <= 21; h++) {
        for (var m = 0; m < 60; m += 15) {
            if (h === 21 && m > 0)
                break;
            var t = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
            timeOptions += html `<option value="${t}">${t}</option>`;
        }
    }
    var isLinked = block ? !!block.projectId : false;
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = html `<div class="modal gt-block-modal">
    <h3>${editing ? 'Edit Block' : 'Add Block'}</h3>
    <form id="gt-block-form" onsubmit="return false">
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
        <input type="checkbox" id="gt-link-toggle" ${isLinked ? 'checked' : ''} onchange="gtToggleLinkMode(this.checked)">
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
        <button type="button" class="btn" onclick="closeModal(this.closest('.modal-backdrop'))">Cancel</button>
        <button type="submit" class="btn btn-primary">${editing ? 'Save' : 'Create'}</button>
      </div>
    </form>
  </div>`;
    openModal(backdrop, editing ? 'Edit Block' : 'Add Block');
    // Set time values after DOM is ready
    var form = document.getElementById('gt-block-form');
    if (block) {
        form.querySelector('[name="startTime"]').value = block.startTime;
        form.querySelector('[name="endTime"]').value = block.endTime;
    }
    else {
        form.querySelector('[name="startTime"]').value = '10:00';
        form.querySelector('[name="endTime"]').value = '11:00';
    }
    form.onsubmit = async (e) => {
        e.preventDefault();
        var fd = new FormData(form);
        var data = {
            day: fd.get('day'),
            locationId: fd.get('locationId'),
            startTime: fd.get('startTime'),
            endTime: fd.get('endTime'),
        };
        var linkToggle = document.getElementById('gt-link-toggle');
        if (linkToggle.checked) {
            data.projectId = fd.get('projectId') || null;
            data.title = null;
            data.description = null;
        }
        else {
            data.projectId = null;
            data.title = fd.get('title');
            data.description = fd.get('description');
        }
        var capVal = fd.get('signupCap');
        data.signupCap = capVal ? parseInt(capVal, 10) : null;
        try {
            if (editing && editBlockId) {
                await apiPatch(`/api/get-together/blocks/${editBlockId}`, data);
                toast('Block updated', 'success');
            }
            else {
                await apiPost('/api/get-together/blocks', data);
                toast('Block created', 'success');
            }
            closeModal(backdrop);
        }
        catch (err) {
            toast(err.message || 'Failed to save block', 'error');
        }
    };
}
function gtToggleLinkMode(linked) {
    var projectField = document.getElementById('gt-project-field');
    var customFields = document.getElementById('gt-custom-fields');
    projectField.style.display = linked ? '' : 'none';
    customFields.style.display = linked ? 'none' : '';
}
async function gtDeleteBlock(blockId) {
    if (!confirm('Delete this block? This will also remove all sign-ups.'))
        return;
    try {
        await apiFetch('DELETE', `/api/get-together/blocks/${blockId}`);
        toast('Block deleted', 'success');
    }
    catch (e) {
        toast(e.message || 'Failed to delete', 'error');
    }
}
// ─── Admin: Location manager ────────────────────────────────────────────────
function gtShowLocationManager() {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'gt-location-modal';
    gtRenderLocationModal(backdrop);
    openModal(backdrop, 'Manage Locations');
}
function gtRenderLocationModal(backdrop) {
    var listHtml = _gtLocations.map((loc, i) => html `<div class="gt-loc-row" data-loc-id="${loc.id}">
      <input type="text" value="${loc.name}" class="gt-loc-name" data-loc-id="${loc.id}">
      <button class="btn btn-small" onclick="gtMoveLocation('${loc.id}', -1)" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn btn-small" onclick="gtMoveLocation('${loc.id}', 1)" ${i === _gtLocations.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn btn-small" onclick="gtRenameLocation('${loc.id}')">Save</button>
      <button class="btn btn-small btn-danger" onclick="gtDeleteLocation('${loc.id}')">Delete</button>
    </div>`).join('');
    backdrop.innerHTML = html `<div class="modal gt-loc-modal">
    <h3>Manage Locations</h3>
    <div class="gt-loc-list">${raw(listHtml)}</div>
    <div class="gt-loc-add">
      <input type="text" id="gt-new-loc-name" placeholder="New location name" maxlength="200">
      <button class="btn btn-primary btn-small" onclick="gtAddLocation()">Add</button>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal(this.closest('.modal-backdrop'))">Close</button>
    </div>
  </div>`;
}
async function gtAddLocation() {
    var input = document.getElementById('gt-new-loc-name');
    var name = input.value.trim();
    if (!name)
        return;
    try {
        var res = await apiPost('/api/get-together/locations', { name, order: _gtLocations.length });
        _gtLocations.push(res.location);
        input.value = '';
        var backdrop = document.getElementById('gt-location-modal');
        if (backdrop)
            gtRenderLocationModal(backdrop);
        gtRenderSchedule();
    }
    catch (e) {
        toast(e.message || 'Failed to add location', 'error');
    }
}
async function gtRenameLocation(locId) {
    var input = document.querySelector(`.gt-loc-name[data-loc-id="${locId}"]`);
    if (!input)
        return;
    try {
        var res = await apiPatch(`/api/get-together/locations/${locId}`, { name: input.value.trim() });
        var idx = _gtLocations.findIndex((l) => l.id === locId);
        if (idx !== -1)
            _gtLocations[idx] = res.location;
        gtRenderSchedule();
        toast('Location renamed', 'success');
    }
    catch (e) {
        toast(e.message || 'Failed to rename', 'error');
    }
}
async function gtMoveLocation(locId, direction) {
    var idx = _gtLocations.findIndex((l) => l.id === locId);
    var targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= _gtLocations.length)
        return;
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
        _gtLocations.sort((a, b) => a.order - b.order);
        var backdrop = document.getElementById('gt-location-modal');
        if (backdrop)
            gtRenderLocationModal(backdrop);
        gtRenderSchedule();
    }
    catch (e) {
        toast(e.message || 'Failed to reorder', 'error');
    }
}
async function gtDeleteLocation(locId) {
    if (!confirm('Delete this location?'))
        return;
    try {
        await apiFetch('DELETE', `/api/get-together/locations/${locId}`);
        _gtLocations = _gtLocations.filter((l) => l.id !== locId);
        var backdrop = document.getElementById('gt-location-modal');
        if (backdrop)
            gtRenderLocationModal(backdrop);
        gtRenderSchedule();
        toast('Location deleted', 'success');
    }
    catch (e) {
        toast(e.message || 'Failed to delete', 'error');
    }
}
// ─── Admin: Map upload ──────────────────────────────────────────────────────
function gtShowMapUpload() {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = html `<div class="modal">
    <h3>Upload Floor Map</h3>
    <form id="gt-map-form" onsubmit="return false">
      <input type="file" name="file" accept="image/*" required>
      <div class="modal-actions">
        <button type="button" class="btn" onclick="closeModal(this.closest('.modal-backdrop'))">Cancel</button>
        <button type="submit" class="btn btn-primary">Upload</button>
      </div>
    </form>
  </div>`;
    openModal(backdrop, 'Upload Floor Map');
    var form = document.getElementById('gt-map-form');
    form.onsubmit = async (e) => {
        e.preventDefault();
        var fileInput = form.querySelector('input[type="file"]');
        if (!fileInput.files?.length)
            return;
        var fd = new FormData();
        fd.append('file', fileInput.files[0]);
        try {
            var res = await apiUpload('/api/get-together/map', fd);
            _gtMapUrl = res.url;
            closeModal(backdrop);
            gtRenderPage();
            toast('Map uploaded', 'success');
        }
        catch (err) {
            toast(err.message || 'Upload failed', 'error');
        }
    };
}
// ─── SSE handlers ───────────────────────────────────────────────────────────
function gtRegisterSSE() {
    // Clean up previous listeners
    gtCleanupSSE();
    if (!_eventSource)
        return;
    var handlers = {
        'get-together:block-created': (e) => {
            var data = JSON.parse(e.data);
            if (data._mutationId && S._pendingMutationIds.has(data._mutationId)) {
                S._pendingMutationIds.delete(data._mutationId);
                return;
            }
            var block = data.block;
            if (block) {
                _gtBlocks = [..._gtBlocks.filter((b) => b.id !== block.id), block];
                gtRenderSchedule();
            }
        },
        'get-together:block-updated': (e) => {
            var data = JSON.parse(e.data);
            if (data._mutationId && S._pendingMutationIds.has(data._mutationId)) {
                S._pendingMutationIds.delete(data._mutationId);
                return;
            }
            var block = data.block;
            if (block) {
                _gtBlocks = _gtBlocks.map((b) => b.id === block.id ? block : b);
                gtRenderSchedule();
                if (_gtExpandedBlockId === block.id) {
                    _gtExpandedBlockDetail = { ..._gtExpandedBlockDetail, ...block };
                    gtRenderBlockDetail();
                }
            }
        },
        'get-together:block-deleted': (e) => {
            var data = JSON.parse(e.data);
            if (data._mutationId && S._pendingMutationIds.has(data._mutationId)) {
                S._pendingMutationIds.delete(data._mutationId);
                return;
            }
            _gtBlocks = _gtBlocks.filter((b) => b.id !== data.blockId);
            if (_gtExpandedBlockId === data.blockId) {
                _gtExpandedBlockId = null;
                _gtExpandedBlockDetail = null;
            }
            gtRenderSchedule();
        },
        'get-together:signup-added': (e) => {
            var data = JSON.parse(e.data);
            if (data._mutationId && S._pendingMutationIds.has(data._mutationId)) {
                S._pendingMutationIds.delete(data._mutationId);
                return;
            }
            gtUpdateBlockSignup(data.blockId, data.signupCount, data.signup, 'add');
        },
        'get-together:signup-removed': (e) => {
            var data = JSON.parse(e.data);
            if (data._mutationId && S._pendingMutationIds.has(data._mutationId)) {
                S._pendingMutationIds.delete(data._mutationId);
                return;
            }
            gtUpdateBlockSignup(data.blockId, data.signupCount, { name: data.name }, 'remove');
        },
        'get-together:location-created': (e) => {
            var data = JSON.parse(e.data);
            if (data._mutationId && S._pendingMutationIds.has(data._mutationId)) {
                S._pendingMutationIds.delete(data._mutationId);
                return;
            }
            if (data.location) {
                _gtLocations = [..._gtLocations, data.location].sort((a, b) => a.order - b.order);
                gtRenderSchedule();
            }
        },
        'get-together:location-updated': (e) => {
            var data = JSON.parse(e.data);
            if (data._mutationId && S._pendingMutationIds.has(data._mutationId)) {
                S._pendingMutationIds.delete(data._mutationId);
                return;
            }
            if (data.location) {
                _gtLocations = _gtLocations.map((l) => l.id === data.location.id ? data.location : l).sort((a, b) => a.order - b.order);
                gtRenderSchedule();
            }
        },
        'get-together:location-deleted': (e) => {
            var data = JSON.parse(e.data);
            if (data._mutationId && S._pendingMutationIds.has(data._mutationId)) {
                S._pendingMutationIds.delete(data._mutationId);
                return;
            }
            _gtLocations = _gtLocations.filter((l) => l.id !== data.locationId);
            gtRenderSchedule();
        },
        'get-together:tool-toggled': (e) => {
            var data = JSON.parse(e.data);
            // Update prep section checkbox
            var checkbox = document.querySelector(`.gt-tool-item[data-tool-id="${data.toolItemId}"] input[type="checkbox"]`);
            if (checkbox)
                checkbox.checked = data.available;
        },
    };
    for (var [eventType, handler] of Object.entries(handlers)) {
        _eventSource.addEventListener(eventType, handler);
        _gtSSECleanup.push(() => {
            if (_eventSource)
                _eventSource.removeEventListener(eventType, handler);
        });
    }
}
function gtUpdateBlockSignup(blockId, signupCount, signup, action) {
    // Update the block in the list
    _gtBlocks = _gtBlocks.map((b) => {
        if (b.id !== blockId)
            return b;
        var signups = [...(b.signups || [])];
        if (action === 'add') {
            if (!signups.some((s) => s.name === signup.name)) {
                signups.push(signup);
            }
        }
        else {
            signups = signups.filter((s) => s.name !== signup.name);
        }
        return { ...b, signups, signupCount };
    });
    gtRenderSchedule();
    // Update detail if this block is expanded
    if (_gtExpandedBlockId === blockId && _gtExpandedBlockDetail) {
        var updatedBlock = _gtBlocks.find((b) => b.id === blockId);
        if (updatedBlock) {
            _gtExpandedBlockDetail = { ..._gtExpandedBlockDetail, signups: updatedBlock.signups, signupCount };
            gtRenderBlockDetail();
        }
    }
}
function gtCleanupSSE() {
    for (var cleanup of _gtSSECleanup) {
        try {
            cleanup();
        }
        catch { /* ignore */ }
    }
    _gtSSECleanup = [];
}
