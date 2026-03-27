/* ========================================
   Projects — List, Detail, Tasks
   ======================================== */

// Cache for passing objects to modals without JSON.stringify in onclick
window._taskCache = {};

// ---- Project list screen ----
async function renderProjects() {
  const app = document.getElementById('app');
  showLoading();

  try {
    S.groups = await apiGet('/api/groups');
  } catch (err) {
    app.innerHTML = `<p class="text-muted">Could not load projects: ${esc(err.message)}</p>`;
    return;
  }

  // If we have a currentProjectId, show detail instead
  if (S.currentProjectId) {
    return renderProjectDetail();
  }

  // Collect active projects from groups (already loaded)
  let allProjects = [];
  const seenIds = new Set();
  for (const g of S.groups) {
    for (const p of (g.projects || [])) {
      allProjects.push({ ...p, groupName: g.name, groupId: g.id });
      seenIds.add(p.id);
    }
  }

  // Fetch non-active (completed/archived) and pending projects separately
  try {
    const [completed, archived, activeAll] = await Promise.all([
      apiGet('/api/projects?status=completed'),
      apiGet('/api/projects?status=archived'),
      apiGet('/api/projects?status=active')
    ]);
    for (const p of [...completed, ...archived, ...activeAll]) {
      if (!seenIds.has(p.id)) {
        allProjects.push({ ...p, groupName: p.group?.name || '', groupId: p.groupId });
        seenIds.add(p.id);
      }
    }
  } catch (e) {
    console.warn('Could not load all projects:', e.message);
  }

  // Filter by group and tier
  let filtered = S.selectedGroupId
    ? allProjects.filter(p => p.groupId === S.selectedGroupId)
    : allProjects;
  filtered = sortProjectsByTier(filterProjectsByTier(filtered));

  app.innerHTML = `
    <div class="flex-between mb-lg">
      <h1>Projects</h1>
      ${S.isAdmin
        ? '<button class="btn btn-primary" onclick="showProjectModal()">+ New Project</button>'
        : '<button class="btn btn-secondary" onclick="showSuggestProjectModal()">Suggest Project</button>'}
    </div>

    ${renderTierButtons()}

    <div class="group-tabs">
      <button class="group-tab ${!S.selectedGroupId ? 'active' : ''}"
              onclick="S.selectedGroupId = null; renderProjects()">All</button>
      ${S.groups.map(g => `
        <button class="group-tab ${S.selectedGroupId === g.id ? 'active' : ''}"
                onclick="S.selectedGroupId = '${g.id}'; renderProjects()">${esc(g.name)}</button>
      `).join('')}
    </div>

    <div class="project-cards">
      ${filtered.length === 0
        ? '<div class="empty-state"><h3>No projects yet</h3><p>Create a project to get started.</p></div>'
        : filtered.map(p => {
          if (p.approved === false) {
            return `<div class="project-card pending">
              <div class="project-card-header">
                <h3>${esc(p.name)}</h3>
                <div class="project-card-tags">
                  <span class="tag tag-pending">Pending approval</span>
                  <span class="tag tag-group">${esc(p.groupName)}</span>
                </div>
              </div>
              <p class="text-muted text-sm">Suggested by ${esc(p.suggestedBy || 'someone')} — waiting for admin approval</p>
              ${S.isAdmin ? `<div class="pending-actions mt-sm">
                <button class="btn btn-small btn-primary" onclick="event.stopPropagation(); approveSuggestedProject('${p.id}')">Approve</button>
                <button class="btn btn-small btn-danger" onclick="event.stopPropagation(); declineSuggested('project', '${p.id}')">Decline</button>
              </div>` : ''}
            </div>`;
          }
          return renderProjectCard(p, { name: p.groupName });
        }).join('')}
    </div>`;

  // Load media for approved project cards (batch)
  const approvedIds = filtered.filter(p => p.approved !== false).map(p => p.id);
  loadAllProjectCardMedia(approvedIds);
}

// ---- Project detail ----
async function renderProjectDetail() {
  const app = document.getElementById('app');
  showLoading();

  try {
    S.currentProject = await apiGet(`/api/projects/${S.currentProjectId}`);
  } catch (err) {
    app.innerHTML = `<p class="text-muted">Project not found.</p>`;
    return;
  }

  const p = S.currentProject;
  const tasks = p.tasks || [];
  const approvedTasks = tasks.filter(t => t.approved !== false);
  const total = approvedTasks.length;
  const done = approvedTasks.filter(t => t.status === 'done').length;
  const inProgress = approvedTasks.filter(t => t.status === 'in_progress').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  app.innerHTML = `
    <div class="project-detail">
      <div class="project-detail-header">
        <div class="breadcrumb">
          <a href="#projects" onclick="S.currentProjectId = null; window.location.hash = 'projects'; renderProjects(); return false;">Projects</a>
          &rsaquo; <a href="#projects" onclick="S.selectedGroupId = '${p.groupId}'; S.currentProjectId = null; window.location.hash = 'projects'; renderProjects(); return false;">${esc(p.group?.name || '')}</a>
          &rsaquo; ${esc(p.name)}
        </div>
        <div class="flex-between">
          <div class="flex gap-sm" style="align-items:center">
            <h1>${esc(p.name)}</h1>
            ${p.tier && PROJECT_TIERS[p.tier] ? `<span class="tag tag-tier" style="background:${PROJECT_TIERS[p.tier].bg};color:${PROJECT_TIERS[p.tier].color}">${PROJECT_TIERS[p.tier].label}</span>` : ''}
            ${p.joinType && JOIN_TYPES[p.joinType] ? `<span class="tag tag-join-${esc(p.joinType)}">${JOIN_TYPES[p.joinType].label}</span>` : ''}
          </div>
          ${S.isAdmin ? `<div class="flex gap-sm">
            <button class="btn btn-ghost" onclick="showEditProjectModal('${p.id}')">Edit</button>
            <button class="btn btn-danger" onclick="deleteProject('${p.id}')">Delete</button>
          </div>` : ''}
        </div>
      </div>

      ${p.description ? `<div class="project-description">${renderDescription(p.description)}</div>` : ''}

      ${p.contactPerson ? `<div class="project-contact mb-lg">
        <span class="text-sm text-muted">Contact:</span> <strong>${esc(p.contactPerson)}</strong>
      </div>` : ''}

      <div class="project-contact-links mb-lg">
        <p class="text-sm text-muted mb-sm">Get involved or ask questions:</p>
        <div class="contact-links">
          <a href="${WHATSAPP_DIRECT}" target="_blank" rel="noopener" class="contact-link">
            💬 WhatsApp direct
          </a>
          ${p.group?.mattermostChannel ? `<a href="${esc(p.group.mattermostChannel)}" target="_blank" rel="noopener" class="contact-link">
            # Mattermost channel
          </a>` : ''}
          <a href="${WHATSAPP_GROUP}" target="_blank" rel="noopener" class="contact-link">
            👥 WhatsApp group
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
          <div class="stat-value" style="color: var(--status-todo)">${total - done - inProgress}</div>
          <div class="stat-label">To do</div>
        </div>
        <div class="stat">
          <div class="stat-value" style="color: var(--status-progress)">${inProgress}</div>
          <div class="stat-label">In progress</div>
        </div>
        <div class="stat">
          <div class="stat-value" style="color: var(--status-done)">${done}</div>
          <div class="stat-label">Done</div>
        </div>
      </div>

      <div class="progress-bar mb-lg" style="height: 8px">
        <div class="progress-bar-fill" style="width: ${pct}%"></div>
      </div>

      <div id="task-list-section" class="task-list">
        <div class="task-list-header">
          <h2>Tasks</h2>
          ${S.isAdmin
            ? '<button class="btn btn-primary" onclick="showTaskModal()">+ Add Task</button>'
            : '<button class="btn btn-secondary" onclick="showSuggestTaskModal()">Suggest Task</button>'}
        </div>
        ${tasks.length === 0
          ? '<div class="empty-state"><h3>No tasks yet</h3><p>Add tasks to track progress.</p></div>'
          : tasks.map(renderTaskItem).join('')}
      </div>

      <div id="shopping-container-${p.id}" class="mt-lg"></div>

      <div id="project-comments"></div>
    </div>`;

  // Load project media and comments in parallel
  const mediaPromise = apiGet(`/api/media?parentType=project&parentId=${p.id}`)
    .then(projectMedia => {
      const mediaContainer = document.getElementById('project-media');
      if (mediaContainer && (projectMedia.length > 0 || S.isAdmin)) {
        mediaContainer.innerHTML = renderMediaItems(projectMedia) +
          (S.isAdmin ? renderMediaUploadButtons('project', p.id) : '');
      }
    })
    .catch(e => console.warn('Could not load project media:', e.message));

  // Load shopping list
  loadShoppingSection(p.id, `shopping-container-${p.id}`);

  // Load comments in parallel with media
  const commentsPromise = renderComments('project', p.id, document.getElementById('project-comments'));
  await Promise.all([mediaPromise, commentsPromise]);
}

// Re-render just the task list section without touching the rest of the page
function rerenderTaskList() {
  const section = document.getElementById('task-list-section');
  if (!section || !S.currentProject) return;

  const tasks = S.currentProject.tasks || [];
  section.innerHTML = `
    <div class="task-list-header">
      <h2>Tasks</h2>
      ${S.isAdmin
        ? '<button class="btn btn-primary" onclick="showTaskModal()">+ Add Task</button>'
        : '<button class="btn btn-secondary" onclick="showSuggestTaskModal()">Suggest Task</button>'}
    </div>
    ${tasks.length === 0
      ? '<div class="empty-state"><h3>No tasks yet</h3><p>Add tasks to track progress.</p></div>'
      : tasks.map(renderTaskItem).join('')}`;

  // Update stats — only count approved tasks
  const approvedTasks = tasks.filter(t => t.approved !== false);
  const total = approvedTasks.length;
  const done = approvedTasks.filter(t => t.status === 'done').length;
  const inProgress = approvedTasks.filter(t => t.status === 'in_progress').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const stats = document.querySelector('.project-stats');
  if (stats) {
    const statValues = stats.querySelectorAll('.stat-value');
    if (statValues.length >= 4) {
      statValues[0].textContent = total;
      statValues[1].textContent = total - done - inProgress;
      statValues[2].textContent = inProgress;
      statValues[3].textContent = done;
    }
  }
  const progressFill = document.querySelector('.progress-bar-fill');
  if (progressFill) progressFill.style.width = `${pct}%`;
}

function renderTaskItem(task) {
  // Cache task for modal access
  window._taskCache[task.id] = task;

  const isPending = task.approved === false;

  if (isPending) {
    return `<div class="task-item pending">
      <div class="task-status-btn" style="cursor:default;border-style:dashed"></div>
      <div class="task-content">
        <div class="task-name">${esc(task.name)}</div>
        <div class="task-meta">
          <span class="pending-badge">Pending approval</span>
          ${task.suggestedBy ? `<span class="text-muted">suggested by ${esc(task.suggestedBy)}</span>` : ''}
        </div>
      </div>
      ${S.isAdmin ? `<div class="task-pending-actions">
        <button class="btn btn-small btn-primary" onclick="event.stopPropagation(); approveSuggestedTask('${task.id}')">Approve</button>
        <button class="btn btn-small btn-danger" onclick="event.stopPropagation(); declineSuggested('task', '${task.id}')">Decline</button>
      </div>` : ''}
    </div>`;
  }

  const statusClass = task.status;
  const statusIcon = task.status === 'done' ? '&#10003;' : (task.status === 'in_progress' ? '&#9679;' : '');
  const nameClass = task.status === 'done' ? 'done' : '';

  return `<div class="task-item" onclick="showTaskDetail('${task.id}')">
    ${S.isAdmin ? `<button class="task-status-btn ${statusClass}"
      onclick="event.stopPropagation(); cycleTaskStatus('${task.id}', '${task.status}')">${statusIcon}</button>` :
      `<div class="task-status-btn ${statusClass}" style="cursor:default">${statusIcon}</div>`}
    <div class="task-content">
      <div class="task-name ${nameClass}">${esc(task.name)}</div>
      <div class="task-meta">
        ${task.assignee ? `<span>&#128100; ${esc(task.assignee)}</span>` : ''}
        ${task.deadline ? `<span class="deadline ${isOverdue(task.deadline) && task.status !== 'done' ? 'overdue' : ''}">&#128197; ${formatDate(task.deadline)}</span>` : ''}
        <span class="tag tag-status-${task.status}">${TASK_STATUSES[task.status]?.label || task.status}</span>
      </div>
    </div>
  </div>`;
}

// ---- Task status cycling (admin) — targeted update, no full re-render ----
async function cycleTaskStatus(taskId, currentStatus) {
  return withDedup(`cycleTask-${taskId}`, async () => {
    const next = STATUS_CYCLE[currentStatus] || 'todo';
    try {
      const updated = await apiPatch(`/api/tasks/${taskId}`, { status: next });
      // Update task in local state
      if (S.currentProject && S.currentProject.tasks) {
        const idx = S.currentProject.tasks.findIndex(t => t.id === taskId);
        if (idx !== -1) S.currentProject.tasks[idx] = { ...S.currentProject.tasks[idx], ...updated };
      }
      rerenderTaskList();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ---- Task detail modal ----
async function showTaskDetail(taskId) {
  let task;
  try {
    task = await apiGet(`/api/tasks/${taskId}`);
  } catch (err) {
    toast('Could not load task', 'error');
    return;
  }

  // Cache for edit modal
  window._taskCache[taskId] = task;

  // Load media
  let media = [];
  try {
    media = await apiGet(`/api/media?parentType=task&parentId=${taskId}`);
  } catch (e) {
    console.warn('Could not load task media:', e.message);
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal">
    <div class="task-detail-header">
      <div class="task-status-btn ${task.status}" style="width:32px;height:32px;font-size:16px;cursor:default">
        ${task.status === 'done' ? '&#10003;' : (task.status === 'in_progress' ? '&#9679;' : '')}
      </div>
      <h2>${esc(task.name)}</h2>
    </div>

    <div class="task-detail-fields">
      <div>
        <label>Status</label>
        <span class="tag tag-status-${task.status}">${TASK_STATUSES[task.status]?.label || task.status}</span>
      </div>
      <div>
        <label>Assignee</label>
        <span>${task.assignee ? esc(task.assignee) : '<span class="text-muted">Unassigned</span>'}</span>
      </div>
      <div>
        <label>Deadline</label>
        <span>${task.deadline ? formatDate(task.deadline) : '<span class="text-muted">No deadline</span>'}</span>
      </div>
      <div>
        <label>Created</label>
        <span>${formatDate(task.createdAt)}</span>
      </div>
    </div>

    ${task.description ? `<div class="mb-lg">
      <label>Description</label>
      <div style="margin-top:var(--space-xs)">${renderDescription(task.description)}</div>
    </div>` : ''}

    ${renderMediaItems(media)}
    ${S.isAdmin ? renderMediaUploadButtons('task', task.id) : ''}

    ${S.isAdmin ? `<div class="flex gap-sm mt-md">
      <button class="btn btn-ghost" onclick="document.querySelector('.modal-backdrop').remove(); showTaskModal(window._taskCache['${task.id}'])">Edit</button>
      <button class="btn btn-danger" onclick="deleteTask('${task.id}')">Delete</button>
    </div>` : ''}

    <div id="task-comments-${task.id}" class="mt-lg"></div>

    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">Close</button>
    </div>
  </div>`;

  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);

  // Load task comments
  const taskComments = document.getElementById(`task-comments-${task.id}`);
  await renderComments('task', task.id, taskComments);
}

// ---- Project modals ----
function showProjectModal(existing) {
  const isEdit = !!existing;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal">
    <h2>${isEdit ? 'Edit' : 'New'} Project</h2>
    <div class="form-group">
      <label>Group / Theme</label>
      <select id="proj-group">
        ${S.groups.map(g => `<option value="${g.id}" ${existing?.groupId === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
      </select>
      ${S.groups.length === 0 ? '<p class="text-muted text-sm mt-sm">Create a group first in the Admin panel.</p>' : ''}
    </div>
    <div class="form-group">
      <label>Project Name</label>
      <input type="text" id="proj-name" value="${esc(existing?.name || '')}">
    </div>
    <div class="form-group">
      <label>Description</label>
      <div id="proj-description-editor"></div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Contact Person</label>
        <input type="text" id="proj-contact" value="${esc(existing?.contactPerson || '')}" placeholder="Who to reach out to">
      </div>
      <div class="form-group">
        <label>Tier</label>
        <select id="proj-tier">
          <option value="">None</option>
          ${Object.entries(PROJECT_TIERS).map(([k, v]) =>
            `<option value="${k}" ${existing?.tier === k ? 'selected' : ''}>${v.label}</option>`
          ).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Join Type</label>
      <select id="proj-jointype">
        <option value="" ${!existing?.joinType ? 'selected' : ''}>— No tag —</option>
        ${Object.entries(JOIN_TYPES).map(([k, v]) =>
          `<option value="${k}" ${existing?.joinType === k ? 'selected' : ''}>${v.label}</option>`
        ).join('')}
      </select>
    </div>
    ${isEdit ? `<div class="form-group">
      <label>Status</label>
      <select id="proj-status">
        ${PROJECT_STATUSES.map(s => `<option value="${s}" ${existing?.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="saveProject(${isEdit ? `'${existing.id}'` : 'null'})">
        ${isEdit ? 'Save' : 'Create'}
      </button>
    </div>
  </div>`;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
  createRichEditor('proj-description-editor', existing?.description || '');
}

async function showEditProjectModal(id) {
  showProjectModal(S.currentProject);
}

async function saveProject(id) {
  return withDedup('saveProject', async () => {
    const groupId = document.getElementById('proj-group')?.value;
    const name = document.getElementById('proj-name').value.trim();
    const description = getRichEditorHTML('proj-description-editor');
    const contactPerson = document.getElementById('proj-contact').value.trim();
    const tier = document.getElementById('proj-tier').value;

    if (!name) return toast('Name is required', 'error');
    if (!groupId) return toast('Select a group first', 'error');

    const joinType = document.getElementById('proj-jointype')?.value || null;
    const data = { groupId, name, description, contactPerson: contactPerson || null, tier: tier || null, joinType };
    const statusEl = document.getElementById('proj-status');
    if (statusEl) data.status = statusEl.value;

    try {
      if (id) {
        await apiPatch(`/api/projects/${id}`, data);
      } else {
        await apiPost('/api/projects', data);
      }
      document.querySelector('.modal-backdrop')?.remove();
      renderCurrentScreen();
      toast(id ? 'Project updated' : 'Project created', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function deleteProject(id) {
  if (!confirm('Delete this project and all its tasks?')) return;
  try {
    await apiDelete(`/api/projects/${id}`);
    S.currentProjectId = null;
    S.currentProject = null;
    renderProjects();
    toast('Project deleted');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---- Task modals ----
function showTaskModal(existing) {
  const isEdit = !!existing;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal">
    <h2>${isEdit ? 'Edit' : 'Add'} Task</h2>
    <div class="form-group">
      <label>Task Name</label>
      <input type="text" id="task-name" value="${esc(existing?.name || '')}">
    </div>
    <div class="form-group">
      <label>Description (optional)</label>
      <div id="task-description-editor"></div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Assignee (optional)</label>
        <input type="text" id="task-assignee" value="${esc(existing?.assignee || '')}" placeholder="Who's doing this?">
      </div>
      <div class="form-group">
        <label>Deadline (optional)</label>
        <input type="date" id="task-deadline" value="${existing?.deadline ? existing.deadline.slice(0, 10) : ''}">
      </div>
    </div>
    ${isEdit ? `<div class="form-group">
      <label>Status</label>
      <select id="task-status">
        ${Object.entries(TASK_STATUSES).map(([k, v]) =>
          `<option value="${k}" ${existing?.status === k ? 'selected' : ''}>${v.label}</option>`
        ).join('')}
      </select>
    </div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="saveTask(${isEdit ? `'${existing.id}'` : 'null'})">
        ${isEdit ? 'Save' : 'Add'}
      </button>
    </div>
  </div>`;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
  createRichEditor('task-description-editor', existing?.description || '');
}

async function saveTask(id) {
  return withDedup('saveTask', async () => {
    const name = document.getElementById('task-name').value.trim();
    const description = getRichEditorHTML('task-description-editor');
    const assignee = document.getElementById('task-assignee').value.trim();
    const deadline = document.getElementById('task-deadline').value;

    if (!name) return toast('Task name is required', 'error');

    const data = { name, description, assignee: assignee || null, deadline: deadline || null };

    const statusEl = document.getElementById('task-status');
    if (statusEl) data.status = statusEl.value;

    try {
      if (id) {
        const updated = await apiPatch(`/api/tasks/${id}`, data);
        // Update in local state
        if (S.currentProject && S.currentProject.tasks) {
          const idx = S.currentProject.tasks.findIndex(t => t.id === id);
          if (idx !== -1) S.currentProject.tasks[idx] = { ...S.currentProject.tasks[idx], ...updated };
        }
      } else {
        data.projectId = S.currentProjectId;
        const created = await apiPost('/api/tasks', data);
        if (S.currentProject) {
          S.currentProject.tasks = S.currentProject.tasks || [];
          S.currentProject.tasks.push(created);
        }
      }
      document.querySelector('.modal-backdrop')?.remove();
      rerenderTaskList();
      toast(id ? 'Task updated' : 'Task added', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  try {
    await apiDelete(`/api/tasks/${id}`);
    // Remove from local state
    if (S.currentProject && S.currentProject.tasks) {
      S.currentProject.tasks = S.currentProject.tasks.filter(t => t.id !== id);
    }
    document.querySelector('.modal-backdrop')?.remove();
    rerenderTaskList();
    toast('Task deleted');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---- Suggest Task modal (non-admin) ----
function showSuggestTaskModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal">
    <h2>Suggest a Task</h2>
    <p class="text-muted text-sm mb-md">Your suggestion will be reviewed by an admin before it appears as an active task.</p>
    <div class="form-group">
      <label>Task Name</label>
      <input type="text" id="suggest-task-name" maxlength="200" placeholder="What needs to be done?">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="saveSuggestedTask()">Suggest</button>
    </div>
  </div>`;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
}

async function saveSuggestedTask() {
  return withDedup('saveSuggestedTask', async () => {
    const name = document.getElementById('suggest-task-name').value.trim();
    if (!name) return toast('Task name is required', 'error');

    try {
      const created = await apiPost('/api/tasks', {
        projectId: S.currentProjectId,
        name,
        authorName: S.visitorName || 'Anonymous'
      });
      if (S.currentProject) {
        S.currentProject.tasks = S.currentProject.tasks || [];
        S.currentProject.tasks.push(created);
      }
      document.querySelector('.modal-backdrop')?.remove();
      rerenderTaskList();
      toast('Task suggestion submitted — waiting for admin approval', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ---- Suggest Project modal (non-admin) ----
function showSuggestProjectModal() {
  if (!S.groups || S.groups.length === 0) {
    toast('No groups available to suggest a project in', 'error');
    return;
  }
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal">
    <h2>Suggest a Project</h2>
    <p class="text-muted text-sm mb-md">Your suggestion will be reviewed by an admin before it appears as an active project.</p>
    <div class="form-group">
      <label>Group / Theme</label>
      <select id="suggest-proj-group">
        ${S.groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Project Name</label>
      <input type="text" id="suggest-proj-name" maxlength="200" placeholder="What project do you have in mind?">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="saveSuggestedProject()">Suggest</button>
    </div>
  </div>`;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
}

async function saveSuggestedProject() {
  return withDedup('saveSuggestedProject', async () => {
    const groupId = document.getElementById('suggest-proj-group')?.value;
    const name = document.getElementById('suggest-proj-name').value.trim();
    if (!name) return toast('Project name is required', 'error');
    if (!groupId) return toast('Select a group', 'error');

    try {
      await apiPost('/api/projects', {
        groupId,
        name,
        authorName: S.visitorName || 'Anonymous'
      });
      document.querySelector('.modal-backdrop')?.remove();
      renderCurrentScreen();
      toast('Project suggestion submitted — waiting for admin approval', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ---- Approve / Decline suggested tasks and projects (admin) ----
async function approveSuggestedTask(taskId) {
  try {
    const updated = await apiPatch(`/api/tasks/${taskId}/approve`, {});
    if (S.currentProject && S.currentProject.tasks) {
      const idx = S.currentProject.tasks.findIndex(t => t.id === taskId);
      if (idx !== -1) S.currentProject.tasks[idx] = { ...S.currentProject.tasks[idx], ...updated };
    }
    rerenderTaskList();
    toast('Task approved', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function approveSuggestedProject(projectId) {
  try {
    await apiPatch(`/api/projects/${projectId}/approve`, {});
    renderCurrentScreen();
    toast('Project approved', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function declineSuggested(type, id) {
  if (!confirm(`Decline and delete this suggested ${type}?`)) return;
  try {
    if (type === 'task') {
      await apiDelete(`/api/tasks/${id}`);
      if (S.currentProject && S.currentProject.tasks) {
        S.currentProject.tasks = S.currentProject.tasks.filter(t => t.id !== id);
      }
      rerenderTaskList();
    } else {
      await apiDelete(`/api/projects/${id}`);
      renderCurrentScreen();
    }
    toast(`Suggestion declined`);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Navigate to project detail
function navigateToProject(projectId) {
  S.screen = 'projects';
  S.currentProjectId = projectId;
  window.location.hash = `project/${projectId}`;
  renderCurrentScreen();
  buildNav();
}
