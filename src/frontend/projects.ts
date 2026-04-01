/* ========================================
   Projects — List, Detail, Tasks
   ======================================== */

// Cache for passing objects to modals without JSON.stringify in onclick
// Capped at 500 entries to prevent unbounded memory growth
(window as any)._taskCache = {};
var TASK_CACHE_MAX = 500;

function cacheTask(task: any): void {
  // Evict oldest entries if cache is full
  var keys = Object.keys((window as any)._taskCache);
  if (keys.length >= TASK_CACHE_MAX) {
    for (var i = 0; i < 100; i++) delete (window as any)._taskCache[keys[i]];
  }
  (window as any)._taskCache[task.id] = task;
}

// Cached projects for filter-only re-renders (avoids re-fetching)
var _allProjectsCached: any[] = [];

// ---- Project list screen ----
async function renderProjects(): Promise<void> {
  var app = document.getElementById('app')!;
  showLoading();
  S._expandedProjects = {};
  S._expandedCardId = null;

  try {
    S.groups = await apiGet('/api/groups');
  } catch (err: any) {
    app.innerHTML = html`<p class="text-muted">Could not load projects: ${err.message}</p>`;
    return;
  }

  // If we have a currentProjectId, show detail instead
  if (S.currentProjectId) {
    return renderProjectDetail();
  }

  // Collect active projects from groups (already loaded)
  var allProjects: any[] = [];
  var seenIds = new Set<string>();
  for (var g of S.groups) {
    for (var p of (g.projects || [])) {
      allProjects.push({ ...p, groupName: g.name, groupId: g.id });
      seenIds.add(p.id);
    }
  }

  // Fetch non-active (completed/archived) and pending projects separately
  try {
    var [completed, archived, activeAll] = await Promise.all([
      apiGet('/api/projects?status=completed'),
      apiGet('/api/projects?status=archived'),
      apiGet('/api/projects?status=active')
    ]);
    for (var p of [...completed, ...archived, ...activeAll]) {
      if (!seenIds.has(p.id)) {
        allProjects.push({ ...p, groupName: p.group?.name || '', groupId: p.groupId });
        seenIds.add(p.id);
      }
    }
  } catch (e: any) {
    console.warn('Could not load all projects:', e.message);
  }

  // Cache for filter-only re-renders
  _allProjectsCached = allProjects;

  // Filter by group and tier
  var filtered = S.selectedGroupId
    ? allProjects.filter((p: any) => p.groupId === S.selectedGroupId)
    : allProjects;
  filtered = sortProjectsByTier(filterProjectsByTier(filtered));

  app.innerHTML = html`
    <div class="flex-between mb-lg">
      <h1>Projects</h1>
      ${raw(S.isAdmin
        ? '<button class="btn btn-primary" data-action="showProjectModal">+ New Project</button>'
        : '<button class="btn btn-secondary" data-action="showSuggestProjectModal">Suggest Project</button>')}
    </div>

    ${raw(renderTierButtons())}

    <div class="group-tabs" id="projects-group-tabs">
      ${raw(renderGroupTabs())}
    </div>

    <div class="project-cards" id="projects-cards">
      ${raw(renderProjectCards(filtered))}
    </div>`;

  // Load media for approved project cards (batch)
  var approvedIds = filtered.filter((p: any) => p.approved !== false).map((p: any) => p.id);
  loadAllProjectCardMedia(approvedIds);
}

// Render group tab buttons (extracted for reuse)
function renderGroupTabs(): string {
  return html`<button class="group-tab ${raw(!S.selectedGroupId ? 'active' : '')}"
              data-action="selectGroup" data-group-id="">All</button>
      ${raw(S.groups.map((g: any) => html`
        <button class="group-tab ${raw(S.selectedGroupId === g.id ? 'active' : '')}"
                data-action="selectGroup" data-group-id="${g.id}">${g.name}</button>
      `).join(''))}`;
}

// Render project card list HTML (extracted for reuse)
function renderProjectCards(filtered: any[]): string {
  return filtered.length === 0
    ? '<div class="empty-state"><h3>No projects yet</h3><p>Create a project to get started.</p></div>'
    : filtered.map((p: any) => {
        if (p.approved === false) {
          return html`<div class="project-card pending">
            <div class="project-card-header">
              <h3>${p.name}</h3>
              <div class="project-card-tags">
                <span class="tag tag-pending">Pending approval</span>
                <span class="tag tag-group">${p.groupName}</span>
              </div>
            </div>
            <p class="text-muted text-sm">Suggested by ${p.suggestedBy || 'someone'} — waiting for admin approval</p>
            ${raw(S.isAdmin ? html`<div class="pending-actions mt-sm">
              <button class="btn btn-small btn-primary" data-action="approveSuggestedProject" data-id="${p.id}" data-stop>Approve</button>
              <button class="btn btn-small btn-danger" data-action="declineSuggested" data-type="project" data-id="${p.id}" data-stop>Decline</button>
            </div>` : '')}
          </div>`;
        }
        return renderProjectCard(p, { name: p.groupName });
      }).join('');
}

// Select a group filter — targeted update without full re-render
function selectGroup(groupId: string | null): void {
  S.selectedGroupId = groupId;
  rerenderProjectFilters();
}

// Re-render only the filter UI + project cards (no API calls, no loading spinner)
function rerenderProjectFilters(): void {
  // Update tier button active states
  updateTierButtonStates();

  // Update group tab active states
  var tabsContainer = document.getElementById('projects-group-tabs');
  if (tabsContainer) {
    tabsContainer.innerHTML = renderGroupTabs();
  }

  // Re-filter and update project cards
  var filtered = S.selectedGroupId
    ? _allProjectsCached.filter((p: any) => p.groupId === S.selectedGroupId)
    : _allProjectsCached;
  filtered = filterProjectsByTier(filtered);

  var cardsContainer = document.getElementById('projects-cards');
  if (cardsContainer) {
    cardsContainer.innerHTML = renderProjectCards(filtered);
    // Load media for newly rendered cards
    loadAllProjectCardMedia(filtered.filter((p: any) => p.approved !== false).map((p: any) => p.id));
  }
}

// ---- Project detail ----
async function renderProjectDetail(): Promise<void> {
  var app = document.getElementById('app')!;
  showLoading();

  try {
    S.currentProject = await apiGet(`/api/projects/${S.currentProjectId}`);
  } catch (err: any) {
    app.innerHTML = html`<p class="text-muted">Project not found.</p>`;
    return;
  }

  var p = S.currentProject;
  var tasks: any[] = p.tasks || [];
  var approvedTasks = tasks.filter((t: any) => t.approved !== false);
  var total = approvedTasks.length;
  var done = approvedTasks.filter((t: any) => t.status === 'done').length;
  var inProgress = approvedTasks.filter((t: any) => t.status === 'in_progress').length;
  var pct = total > 0 ? Math.round((done / total) * 100) : 0;

  app.innerHTML = html`
    <div class="project-detail">
      <div class="project-detail-header">
        <div class="breadcrumb">
          <a href="#projects" data-action="breadcrumbProjects">Projects</a>
          &rsaquo; <a href="#projects" data-action="breadcrumbGroup" data-group-id="${p.groupId}">${p.group?.name || ''}</a>
          &rsaquo; ${p.name}
        </div>
        <div class="flex-between">
          <div class="flex gap-sm" style="align-items:center">
            <h1>${p.name}</h1>
            ${raw(p.tier && PROJECT_TIERS[p.tier] ? html`<span class="tag tag-tier" style="background:${raw(PROJECT_TIERS[p.tier].bg)};color:${raw(PROJECT_TIERS[p.tier].color)}">${PROJECT_TIERS[p.tier].label}</span>` : '')}
            ${raw(p.joinType && JOIN_TYPES[p.joinType] ? html`<span class="tag tag-join-${p.joinType}">${JOIN_TYPES[p.joinType].label}</span>` : '')}
          </div>
          ${raw(S.isAdmin ? html`<div class="flex gap-sm">
            <button class="btn btn-ghost" data-action="showEditProjectModal" data-id="${p.id}">Edit</button>
            <button class="btn btn-danger" data-action="deleteProject" data-id="${p.id}">Delete</button>
          </div>` : '')}
        </div>
      </div>

      ${raw(p.description ? html`<div class="project-description">${raw(renderDescription(p.description))}</div>` : '')}

      ${raw(p.contactPerson ? html`<div class="project-contact mb-lg">
        <span class="text-sm text-muted">Contact:</span> <strong>${p.contactPerson}</strong>
      </div>` : '')}

      <div class="project-contact-links mb-lg">
        <p class="text-sm text-muted mb-sm">Get involved or ask questions:</p>
        <div class="contact-links">
          <a href="${WHATSAPP_DIRECT}" target="_blank" rel="noopener" class="contact-link">
            \u{1F4AC} WhatsApp direct
          </a>
          ${raw(p.group?.mattermostChannel ? html`<a href="${p.group.mattermostChannel}" target="_blank" rel="noopener" class="contact-link">
            # Mattermost channel
          </a>` : '')}
          <a href="${WHATSAPP_GROUP}" target="_blank" rel="noopener" class="contact-link">
            \u{1F465} WhatsApp group
          </a>
        </div>
      </div>

      <div id="project-media" class="mb-lg"></div>

      <div class="project-stats">
        <div class="stat">
          <div class="stat-value">${total}</div>
          <div class="stat-label">Total</div>
        </div>
        <div class="stat">
          <div class="stat-value" style="${raw('color: var(--status-todo)')}">${total - done - inProgress}</div>
          <div class="stat-label">To do</div>
        </div>
        <div class="stat">
          <div class="stat-value" style="${raw('color: var(--status-progress)')}">${inProgress}</div>
          <div class="stat-label">In progress</div>
        </div>
        <div class="stat">
          <div class="stat-value" style="${raw('color: var(--status-done)')}">${done}</div>
          <div class="stat-label">Done</div>
        </div>
      </div>

      <div class="progress-bar mb-lg" style="height: 8px">
        <div class="progress-bar-fill" style="width: ${pct}%"></div>
      </div>

      <div id="task-list-section" class="task-list">
        <div class="task-list-header">
          <h2>Tasks</h2>
          ${raw(S.isAdmin
            ? '<button class="btn btn-primary" data-action="showTaskModal">+ Add Task</button>'
            : '<button class="btn btn-secondary" data-action="showSuggestTaskModal">Suggest Task</button>')}
        </div>
        ${raw(tasks.length === 0
          ? '<div class="empty-state"><h3>No tasks yet</h3><p>Add tasks to track progress.</p></div>'
          : tasks.map(renderTaskItem).join(''))}
      </div>

      <div id="shopping-container-${p.id}" class="mt-lg"></div>

      <div id="project-comments"></div>
    </div>`;

  // Load project media and comments in parallel
  var mediaPromise = apiGet(`/api/media?parentType=project&parentId=${p.id}`)
    .then((projectMedia: any[]) => {
      var mediaContainer = document.getElementById('project-media');
      if (mediaContainer && (projectMedia.length > 0 || S.isAdmin)) {
        mediaContainer.innerHTML = renderMediaItems(projectMedia) +
          (S.isAdmin ? renderMediaUploadButtons('project', p.id) : '');
      }
    })
    .catch((e: any) => console.warn('Could not load project media:', e.message));

  // Load shopping list
  loadShoppingSection(p.id, `shopping-container-${p.id}`);

  // Load comments in parallel with media
  var commentsPromise = renderComments('project', p.id, document.getElementById('project-comments')!);
  await Promise.all([mediaPromise, commentsPromise]);
}

// Re-render just the task list section without touching the rest of the page
function rerenderTaskList(): void {
  var section = document.getElementById('task-list-section');
  if (!section || !S.currentProject) return;

  var tasks: any[] = S.currentProject.tasks || [];
  section.innerHTML = html`
    <div class="task-list-header">
      <h2>Tasks</h2>
      ${raw(S.isAdmin
        ? '<button class="btn btn-primary" data-action="showTaskModal">+ Add Task</button>'
        : '<button class="btn btn-secondary" data-action="showSuggestTaskModal">Suggest Task</button>')}
    </div>
    ${raw(tasks.length === 0
      ? '<div class="empty-state"><h3>No tasks yet</h3><p>Add tasks to track progress.</p></div>'
      : tasks.map(renderTaskItem).join(''))}`;

  // Update stats — only count approved tasks
  var approvedTasks = tasks.filter((t: any) => t.approved !== false);
  var total = approvedTasks.length;
  var done = approvedTasks.filter((t: any) => t.status === 'done').length;
  var inProgress = approvedTasks.filter((t: any) => t.status === 'in_progress').length;
  var pct = total > 0 ? Math.round((done / total) * 100) : 0;

  var stats = document.querySelector('.project-stats');
  if (stats) {
    var statValues = stats.querySelectorAll('.stat-value');
    if (statValues.length >= 4) {
      statValues[0].textContent = String(total);
      statValues[1].textContent = String(total - done - inProgress);
      statValues[2].textContent = String(inProgress);
      statValues[3].textContent = String(done);
    }
  }
  var progressFill = document.querySelector('.progress-bar-fill') as HTMLElement | null;
  if (progressFill) progressFill.style.width = `${pct}%`;
}

function renderTaskItem(task: any): string {
  // Cache task for modal access
  cacheTask(task);

  var isPending = task.approved === false;

  if (isPending) {
    return html`<div class="task-item pending">
      <div class="task-status-btn" style="cursor:default;border-style:dashed"></div>
      <div class="task-content">
        <div class="task-name">${task.name}</div>
        <div class="task-meta">
          <span class="pending-badge">Pending approval</span>
          ${raw(task.suggestedBy ? html`<span class="text-muted">suggested by ${task.suggestedBy}</span>` : '')}
        </div>
      </div>
      ${raw(S.isAdmin ? html`<div class="task-pending-actions">
        <button class="btn btn-small btn-primary" data-action="approveSuggestedTask" data-id="${task.id}" data-stop>Approve</button>
        <button class="btn btn-small btn-danger" data-action="declineSuggested" data-type="task" data-id="${task.id}" data-stop>Decline</button>
      </div>` : '')}
    </div>`;
  }

  var statusClass = task.status;
  var statusIcon = task.status === 'done' ? '&#10003;' : (task.status === 'in_progress' ? '&#9679;' : '');
  var nameClass = task.status === 'done' ? 'done' : '';
  var preview = task.description ? truncateDescription(task.description) : '';
  var hasFullDescription = task.description && task.description.trim().length > 0;

  return html`<div class="task-item" data-action="toggleTaskExpand" data-id="${task.id}">
    ${raw(S.isAdmin ? html`<button class="task-status-btn ${raw(statusClass)}"
      data-action="cycleTaskStatus" data-id="${task.id}" data-status="${task.status}" data-stop>${raw(statusIcon)}</button>` :
      html`<div class="task-status-btn ${raw(statusClass)}" style="cursor:default">${raw(statusIcon)}</div>`)}
    <div class="task-content">
      <div class="task-name ${raw(nameClass)}">${task.name}</div>
      ${raw(preview ? html`<div class="task-description-preview">${preview}</div>` : '')}
      <div class="task-meta">
        ${raw(task.assignee ? html`<span>&#128100; ${task.assignee}</span>` : '')}
        ${raw(task.deadline ? html`<span class="deadline ${raw(isOverdue(task.deadline) && task.status !== 'done' ? 'overdue' : '')}">&#128197; ${formatDate(task.deadline)}</span>` : '')}
        <span class="tag tag-status-${task.status}">${TASK_STATUSES[task.status]?.label || task.status}</span>
      </div>
      ${raw(hasFullDescription ? html`<div class="task-description-full" id="task-full-${task.id}" style="display:none">${raw(renderDescription(task.description))}<div class="task-expand-actions"><button class="btn btn-small btn-ghost" data-action="showTaskDetail" data-id="${task.id}" data-stop>Open full detail</button></div></div>` : '')}
    </div>
  </div>`;
}

// ---- Task status cycling (admin) — optimistic update with rollback ----
async function cycleTaskStatus(taskId: string, currentStatus: string): Promise<void> {
  return withDedup(`cycleTask-${taskId}`, async () => {
    var next = STATUS_CYCLE[currentStatus] || 'todo';

    // Optimistic: update local state immediately
    if (S.currentProject && S.currentProject.tasks) {
      var idx = S.currentProject.tasks.findIndex((t: any) => t.id === taskId);
      if (idx !== -1) {
        S.currentProject.tasks[idx] = { ...S.currentProject.tasks[idx], status: next };
        rerenderTaskList();
      }
    }

    try {
      var updated = await apiPatch(`/api/tasks/${taskId}`, { status: next });
      // Merge server response (may have extra fields like updatedAt)
      if (S.currentProject && S.currentProject.tasks) {
        var idx = S.currentProject.tasks.findIndex((t: any) => t.id === taskId);
        if (idx !== -1) S.currentProject.tasks[idx] = { ...S.currentProject.tasks[idx], ...updated };
      }
    } catch (err: any) {
      // Rollback on error
      if (S.currentProject && S.currentProject.tasks) {
        var idx = S.currentProject.tasks.findIndex((t: any) => t.id === taskId);
        if (idx !== -1) S.currentProject.tasks[idx].status = currentStatus;
        rerenderTaskList();
      }
      toast(err.message, 'error');
    }
  });
}

// ---- Task detail modal ----
async function showTaskDetail(taskId: string): Promise<void> {
  var task: any;
  try {
    task = await apiGet(`/api/tasks/${taskId}`);
  } catch (err: any) {
    toast('Could not load task', 'error');
    return;
  }

  // Cache for edit modal
  cacheTask(task);

  // Load media
  var media: any[] = [];
  try {
    media = await apiGet(`/api/media?parentType=task&parentId=${taskId}`);
  } catch (e: any) {
    console.warn('Could not load task media:', e.message);
  }

  var backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = html`<div class="modal">
    <div class="task-detail-header">
      <div class="task-status-btn ${raw(task.status)}" style="width:32px;height:32px;font-size:16px;cursor:default">
        ${raw(task.status === 'done' ? '&#10003;' : (task.status === 'in_progress' ? '&#9679;' : ''))}
      </div>
      <h2>${task.name}</h2>
    </div>

    <div class="task-detail-fields">
      <div>
        <label>Status</label>
        <span class="tag tag-status-${task.status}">${TASK_STATUSES[task.status]?.label || task.status}</span>
      </div>
      <div>
        <label>Assignee</label>
        <span>${raw(task.assignee ? esc(task.assignee) : '<span class="text-muted">Unassigned</span>')}</span>
      </div>
      <div>
        <label>Deadline</label>
        <span>${raw(task.deadline ? formatDate(task.deadline) : '<span class="text-muted">No deadline</span>')}</span>
      </div>
      <div>
        <label>Created</label>
        <span>${formatDate(task.createdAt)}</span>
      </div>
    </div>

    ${raw(task.description ? html`<div class="mb-lg">
      <label>Description</label>
      <div style="${raw('margin-top:var(--space-xs)')}">${raw(renderDescription(task.description))}</div>
    </div>` : '')}

    ${raw(renderMediaItems(media))}
    ${raw(S.isAdmin ? renderMediaUploadButtons('task', task.id) : '')}

    ${raw(S.isAdmin ? html`<div class="flex gap-sm mt-md">
      <button class="btn btn-ghost" data-action="editTaskFromDetail" data-id="${task.id}">Edit</button>
      <button class="btn btn-danger" data-action="deleteTask" data-id="${task.id}">Delete</button>
    </div>` : '')}

    <div id="task-comments-${task.id}" class="mt-lg"></div>

    <div class="modal-actions">
      <button class="btn btn-secondary" data-action="closeModal">Close</button>
    </div>
  </div>`;

  backdrop.addEventListener('click', (e: Event) => { if (e.target === backdrop) closeModal(backdrop); });
  openModal(backdrop, 'Task: ' + task.name);

  // Load task comments
  var taskComments = document.getElementById(`task-comments-${task.id}`)!;
  await renderComments('task', task.id, taskComments);
}

// ---- Project modals ----
function showProjectModal(existing?: any): void {
  var isEdit = !!existing;
  var backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = html`<div class="modal">
    <h2>${isEdit ? 'Edit' : 'New'} Project</h2>
    <div class="form-group">
      <label>Group / Theme</label>
      <select id="proj-group">
        ${raw(S.groups.map((g: any) => html`<option value="${g.id}" ${raw(existing?.groupId === g.id ? 'selected' : '')}>${g.name}</option>`).join(''))}
      </select>
      ${raw(S.groups.length === 0 ? '<p class="text-muted text-sm mt-sm">Create a group first in the Admin panel.</p>' : '')}
    </div>
    <div class="form-group">
      <label>Project Name</label>
      <input type="text" id="proj-name" value="${existing?.name || ''}">
    </div>
    <div class="form-group">
      <label>Description</label>
      <div id="proj-description-editor"></div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Contact Person</label>
        <input type="text" id="proj-contact" value="${existing?.contactPerson || ''}" placeholder="Who to reach out to">
      </div>
      <div class="form-group">
        <label>Tier</label>
        <select id="proj-tier">
          <option value="">None</option>
          ${raw(Object.entries(PROJECT_TIERS).map(([k, v]: [string, any]) =>
            html`<option value="${k}" ${raw(existing?.tier === k ? 'selected' : '')}>${v.label}</option>`
          ).join(''))}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Join Type</label>
      <select id="proj-jointype">
        <option value="" ${raw(!existing?.joinType ? 'selected' : '')}>— No tag —</option>
        ${raw(Object.entries(JOIN_TYPES).map(([k, v]: [string, any]) =>
          html`<option value="${k}" ${raw(existing?.joinType === k ? 'selected' : '')}>${v.label}</option>`
        ).join(''))}
      </select>
    </div>
    ${raw(isEdit ? html`<div class="form-group">
      <label>Status</label>
      <select id="proj-status">
        ${raw(PROJECT_STATUSES.map((s: string) => html`<option value="${s}" ${raw(existing?.status === s ? 'selected' : '')}>${s}</option>`).join(''))}
      </select>
    </div>` : '')}
    <div class="modal-actions">
      <button class="btn btn-secondary" data-action="closeModal">Cancel</button>
      <button class="btn btn-primary" data-action="saveProject" data-id="${isEdit ? existing.id : ''}">
        ${isEdit ? 'Save' : 'Create'}
      </button>
    </div>
  </div>`;
  backdrop.addEventListener('click', (e: Event) => { if (e.target === backdrop) closeModal(backdrop); });
  openModal(backdrop, (isEdit ? 'Edit' : 'New') + ' Project');
  createRichEditor('proj-description-editor', existing?.description || '');
}

async function showEditProjectModal(id: string): Promise<void> {
  try {
    var project = id && id !== S.currentProject?.id
      ? await apiGet(`/api/projects/${id}`)
      : S.currentProject;
    if (project) showProjectModal(project);
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

async function saveProject(id: string | null): Promise<void> {
  return withDedup('saveProject', async () => {
    var groupId = (document.getElementById('proj-group') as HTMLSelectElement)?.value;
    var name = (document.getElementById('proj-name') as HTMLInputElement).value.trim();
    var description = getRichEditorHTML('proj-description-editor');
    var contactPerson = (document.getElementById('proj-contact') as HTMLInputElement).value.trim();
    var tier = (document.getElementById('proj-tier') as HTMLSelectElement).value;

    if (!name) return toast('Name is required', 'error');
    if (!groupId) return toast('Select a group first', 'error');

    var joinType = (document.getElementById('proj-jointype') as HTMLSelectElement)?.value || null;
    var data: any = { groupId, name, description, contactPerson: contactPerson || null, tier: tier || null, joinType };
    var statusEl = document.getElementById('proj-status') as HTMLSelectElement | null;
    if (statusEl) data.status = statusEl.value;

    try {
      if (id) {
        await apiPatch(`/api/projects/${id}`, data);
      } else {
        await apiPost('/api/projects', data);
      }
      { var bd = document.querySelector('.modal-backdrop') as HTMLElement | null; if (bd) closeModal(bd); }
      renderCurrentScreen();
      toast(id ? 'Project updated' : 'Project created', 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    }
  });
}

async function deleteProject(id: string): Promise<void> {
  if (!confirm('Delete this project and all its tasks?')) return;
  try {
    await apiDelete(`/api/projects/${id}`);
    S.currentProjectId = null;
    S.currentProject = null;
    renderProjects();
    toast('Project deleted');
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

// ---- Task modals ----
function showTaskModal(existing?: any): void {
  var isEdit = !!existing;
  var backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = html`<div class="modal">
    <h2>${isEdit ? 'Edit' : 'Add'} Task</h2>
    <div class="form-group">
      <label>Task Name</label>
      <input type="text" id="task-name" value="${existing?.name || ''}">
    </div>
    <div class="form-group">
      <label>Description (optional)</label>
      <div id="task-description-editor"></div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Assignee (optional)</label>
        <input type="text" id="task-assignee" value="${existing?.assignee || ''}" placeholder="Who's doing this?">
      </div>
      <div class="form-group">
        <label>Deadline (optional)</label>
        <input type="date" id="task-deadline" value="${existing?.deadline ? existing.deadline.slice(0, 10) : ''}">
      </div>
    </div>
    ${raw(isEdit ? html`<div class="form-group">
      <label>Status</label>
      <select id="task-status">
        ${raw(Object.entries(TASK_STATUSES).map(([k, v]: [string, any]) =>
          html`<option value="${k}" ${raw(existing?.status === k ? 'selected' : '')}>${v.label}</option>`
        ).join(''))}
      </select>
    </div>` : '')}
    <div class="modal-actions">
      <button class="btn btn-secondary" data-action="closeModal">Cancel</button>
      <button class="btn btn-primary" data-action="saveTask" data-id="${isEdit ? existing.id : ''}">
        ${isEdit ? 'Save' : 'Add'}
      </button>
    </div>
  </div>`;
  backdrop.addEventListener('click', (e: Event) => { if (e.target === backdrop) closeModal(backdrop); });
  openModal(backdrop, (isEdit ? 'Edit' : 'Add') + ' Task');
  createRichEditor('task-description-editor', existing?.description || '');
}

async function saveTask(id: string | null): Promise<void> {
  return withDedup('saveTask', async () => {
    var name = (document.getElementById('task-name') as HTMLInputElement).value.trim();
    var description = getRichEditorHTML('task-description-editor');
    var assignee = (document.getElementById('task-assignee') as HTMLInputElement).value.trim();
    var deadline = (document.getElementById('task-deadline') as HTMLInputElement).value;

    if (!name) return toast('Task name is required', 'error');

    var data: any = { name, description, assignee: assignee || null, deadline: deadline || null };

    var statusEl = document.getElementById('task-status') as HTMLSelectElement | null;
    if (statusEl) data.status = statusEl.value;

    try {
      if (id) {
        var updated = await apiPatch(`/api/tasks/${id}`, data);
        // Update in local state
        if (S.currentProject && S.currentProject.tasks) {
          var idx = S.currentProject.tasks.findIndex((t: any) => t.id === id);
          if (idx !== -1) S.currentProject.tasks[idx] = { ...S.currentProject.tasks[idx], ...updated };
        }
      } else {
        data.projectId = S.currentProjectId;
        var created = await apiPost('/api/tasks', data);
        if (S.currentProject) {
          S.currentProject.tasks = S.currentProject.tasks || [];
          S.currentProject.tasks.push(created);
        }
      }
      { var bd = document.querySelector('.modal-backdrop') as HTMLElement | null; if (bd) closeModal(bd); }
      rerenderTaskList();
      toast(id ? 'Task updated' : 'Task added', 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    }
  });
}

async function deleteTask(id: string): Promise<void> {
  if (!confirm('Delete this task?')) return;
  try {
    await apiDelete(`/api/tasks/${id}`);
    // Remove from local state
    if (S.currentProject && S.currentProject.tasks) {
      S.currentProject.tasks = S.currentProject.tasks.filter((t: any) => t.id !== id);
    }
    (document.querySelector('.modal-backdrop') as HTMLElement | null)?.remove();
    rerenderTaskList();
    toast('Task deleted');
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

// ---- Suggest Task modal (non-admin) ----
function showSuggestTaskModal(): void {
  var backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = html`<div class="modal">
    <h2>Suggest a Task</h2>
    <p class="text-muted text-sm mb-md">Your suggestion will be reviewed by an admin before it appears as an active task.</p>
    <div class="form-group">
      <label>Task Name</label>
      <input type="text" id="suggest-task-name" maxlength="200" placeholder="What needs to be done?">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" data-action="closeModal">Cancel</button>
      <button class="btn btn-primary" data-action="saveSuggestedTask">Suggest</button>
    </div>
  </div>`;
  backdrop.addEventListener('click', (e: Event) => { if (e.target === backdrop) closeModal(backdrop); });
  openModal(backdrop, 'Suggest a Task');
}

async function saveSuggestedTask(): Promise<void> {
  return withDedup('saveSuggestedTask', async () => {
    var name = (document.getElementById('suggest-task-name') as HTMLInputElement).value.trim();
    if (!name) return toast('Task name is required', 'error');

    try {
      var created = await apiPost('/api/tasks', {
        projectId: S.currentProjectId,
        name,
        authorName: S.visitorName || 'Anonymous'
      });
      if (S.currentProject) {
        S.currentProject.tasks = S.currentProject.tasks || [];
        S.currentProject.tasks.push(created);
      }
      { var bd = document.querySelector('.modal-backdrop') as HTMLElement | null; if (bd) closeModal(bd); }
      rerenderTaskList();
      toast('Task suggestion submitted — waiting for admin approval', 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    }
  });
}

// ---- Suggest Project modal (non-admin) ----
function showSuggestProjectModal(): void {
  if (!S.groups || S.groups.length === 0) {
    toast('No groups available to suggest a project in', 'error');
    return;
  }
  var backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = html`<div class="modal">
    <h2>Suggest a Project</h2>
    <p class="text-muted text-sm mb-md">Your suggestion will be reviewed by an admin before it appears as an active project.</p>
    <div class="form-group">
      <label>Group / Theme</label>
      <select id="suggest-proj-group">
        ${raw(S.groups.map((g: any) => html`<option value="${g.id}">${g.name}</option>`).join(''))}
      </select>
    </div>
    <div class="form-group">
      <label>Project Name</label>
      <input type="text" id="suggest-proj-name" maxlength="200" placeholder="What project do you have in mind?">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" data-action="closeModal">Cancel</button>
      <button class="btn btn-primary" data-action="saveSuggestedProject">Suggest</button>
    </div>
  </div>`;
  backdrop.addEventListener('click', (e: Event) => { if (e.target === backdrop) closeModal(backdrop); });
  openModal(backdrop, 'Suggest a Project');
}

async function saveSuggestedProject(): Promise<void> {
  return withDedup('saveSuggestedProject', async () => {
    var groupId = (document.getElementById('suggest-proj-group') as HTMLSelectElement)?.value;
    var name = (document.getElementById('suggest-proj-name') as HTMLInputElement).value.trim();
    if (!name) return toast('Project name is required', 'error');
    if (!groupId) return toast('Select a group', 'error');

    try {
      await apiPost('/api/projects', {
        groupId,
        name,
        authorName: S.visitorName || 'Anonymous'
      });
      { var bd = document.querySelector('.modal-backdrop') as HTMLElement | null; if (bd) closeModal(bd); }
      renderCurrentScreen();
      toast('Project suggestion submitted — waiting for admin approval', 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    }
  });
}

// ---- Approve / Decline suggested tasks and projects (admin) ----
async function approveSuggestedTask(taskId: string): Promise<void> {
  try {
    var updated = await apiPatch(`/api/tasks/${taskId}/approve`, {});
    if (S.currentProject && S.currentProject.tasks) {
      var idx = S.currentProject.tasks.findIndex((t: any) => t.id === taskId);
      if (idx !== -1) S.currentProject.tasks[idx] = { ...S.currentProject.tasks[idx], ...updated };
    }
    rerenderTaskList();
    toast('Task approved', 'success');
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

async function approveSuggestedProject(projectId: string): Promise<void> {
  try {
    await apiPatch(`/api/projects/${projectId}/approve`, {});
    renderCurrentScreen();
    toast('Project approved', 'success');
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

async function declineSuggested(type: string, id: string): Promise<void> {
  if (!confirm(`Decline and delete this suggested ${type}?`)) return;
  try {
    if (type === 'task') {
      await apiDelete(`/api/tasks/${id}`);
      if (S.currentProject && S.currentProject.tasks) {
        S.currentProject.tasks = S.currentProject.tasks.filter((t: any) => t.id !== id);
      }
      rerenderTaskList();
    } else {
      await apiDelete(`/api/projects/${id}`);
      renderCurrentScreen();
    }
    toast(`Suggestion declined`);
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

// Navigate to project detail
function navigateToProject(projectId: string): void {
  S.screen = 'projects';
  S.currentProjectId = projectId;
  window.location.hash = `project/${projectId}`;
  // hashchange listener handles renderCurrentScreen() + buildNav()
}

/* ---- onAction registrations for projects ---- */

// Note: showProjectModal (no args) and closeModal are already registered in dashboard.js

onAction('showSuggestProjectModal', () => showSuggestProjectModal());
onAction('selectGroup', (el: HTMLElement) => selectGroup(el.dataset.groupId || null));
onAction('approveSuggestedProject', (el: HTMLElement) => approveSuggestedProject(el.dataset.id!));
onAction('declineSuggested', (el: HTMLElement) => declineSuggested(el.dataset.type!, el.dataset.id!));
onAction('breadcrumbProjects', (el: HTMLElement, e: Event) => {
  e.preventDefault();
  S.currentProjectId = null;
  window.location.hash = 'projects';
  renderProjects();
});
onAction('breadcrumbGroup', (el: HTMLElement, e: Event) => {
  e.preventDefault();
  S.selectedGroupId = el.dataset.groupId;
  S.currentProjectId = null;
  window.location.hash = 'projects';
  renderProjects();
});
onAction('showEditProjectModal', (el: HTMLElement) => showEditProjectModal(el.dataset.id!));
onAction('deleteProject', (el: HTMLElement) => deleteProject(el.dataset.id!));
onAction('showTaskModal', () => showTaskModal());
onAction('showSuggestTaskModal', () => showSuggestTaskModal());
onAction('approveSuggestedTask', (el: HTMLElement) => approveSuggestedTask(el.dataset.id!));
onAction('showTaskDetail', (el: HTMLElement) => showTaskDetail(el.dataset.id!));
onAction('toggleTaskExpand', (el: HTMLElement) => {
  var taskId = el.dataset.id!;
  var fullEl = document.getElementById('task-full-' + taskId);
  var previewEl = el.querySelector('.task-description-preview') as HTMLElement | null;
  if (!fullEl) {
    // No description to expand — open detail modal directly
    showTaskDetail(taskId);
    return;
  }
  var isExpanded = fullEl.style.display !== 'none';
  if (isExpanded) {
    fullEl.style.display = 'none';
    if (previewEl) previewEl.style.display = '';
    el.classList.remove('expanded');
  } else {
    fullEl.style.display = '';
    if (previewEl) previewEl.style.display = 'none';
    el.classList.add('expanded');
  }
});
onAction('cycleTaskStatus', (el: HTMLElement) => cycleTaskStatus(el.dataset.id!, el.dataset.status!));
onAction('editTaskFromDetail', (el: HTMLElement) => {
  { var bd = document.querySelector('.modal-backdrop') as HTMLElement | null; if (bd) closeModal(bd); }
  showTaskModal((window as any)._taskCache[el.dataset.id!]);
});
onAction('deleteTask', (el: HTMLElement) => deleteTask(el.dataset.id!));
onAction('saveProject', (el: HTMLElement) => saveProject(el.dataset.id || null));
onAction('saveTask', (el: HTMLElement) => saveTask(el.dataset.id || null));
onAction('saveSuggestedTask', () => saveSuggestedTask());
onAction('saveSuggestedProject', () => saveSuggestedProject());

// ---- Reactive subscriptions (SSE updates S → subscribers re-render) ----

S.subscribe('groups', () => {
  if (S.screen !== 'projects' || S.currentProjectId) return;
  _allProjectsCached = S.groups.flatMap((g: any) =>
    (g.projects || []).filter((p: any) => p.approved !== false)
      .map((p: any) => ({ ...p, groupName: g.name, groupId: g.id }))
  );
  rerenderProjectFilters();
});

S.subscribe('currentProject', () => {
  if (S.screen !== 'projects' || !S.currentProjectId) return;
  if (document.getElementById('task-list-section')) {
    rerenderTaskList();
  }
});
