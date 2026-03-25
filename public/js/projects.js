/* ========================================
   Projects — List, Detail, Tasks
   ======================================== */

// ---- Project list screen ----
async function renderProjects() {
  const app = document.getElementById('app');

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

  // Collect all projects from groups
  let allProjects = [];
  for (const g of S.groups) {
    for (const p of (g.projects || [])) {
      allProjects.push({ ...p, groupName: g.name, groupId: g.id });
    }
  }

  // Also fetch completed/archived projects not in groups.projects (which only has active)
  try {
    const all = await apiGet('/api/projects');
    for (const p of all) {
      if (!allProjects.find(x => x.id === p.id)) {
        allProjects.push({ ...p, groupName: p.group?.name || '', groupId: p.groupId });
      }
    }
  } catch (e) { /* fallback to what we have */ }

  // Filter by group
  const filtered = S.selectedGroupId
    ? allProjects.filter(p => p.groupId === S.selectedGroupId)
    : allProjects;

  app.innerHTML = `
    <div class="flex-between mb-lg">
      <h1>Projects</h1>
      ${S.isAdmin ? '<button class="btn btn-primary" onclick="showProjectModal()">+ New Project</button>' : ''}
    </div>

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
          const tasks = p.tasks || [];
          const total = tasks.length;
          const done = tasks.filter(t => t.status === 'done').length;
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          return `<div class="project-card card-clickable" onclick="navigateToProject('${p.id}')">
            <div class="project-card-header">
              <h3>${esc(p.name)}</h3>
              <span class="tag tag-group">${esc(p.groupName)}</span>
            </div>
            <div class="task-count">${done}/${total} tasks done</div>
            <div class="progress-bar">
              <div class="progress-bar-fill" style="width: ${pct}%"></div>
            </div>
          </div>`;
        }).join('')}
    </div>`;
}

// ---- Project detail ----
async function renderProjectDetail() {
  const app = document.getElementById('app');

  try {
    S.currentProject = await apiGet(`/api/projects/${S.currentProjectId}`);
  } catch (err) {
    app.innerHTML = `<p class="text-muted">Project not found.</p>`;
    return;
  }

  const p = S.currentProject;
  const tasks = p.tasks || [];
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  app.innerHTML = `
    <div class="project-detail">
      <div class="project-detail-header">
        <div class="breadcrumb">
          <a href="#" onclick="S.currentProjectId = null; renderProjects(); return false;">Projects</a>
          &rsaquo; <a href="#" onclick="S.selectedGroupId = '${p.groupId}'; S.currentProjectId = null; renderProjects(); return false;">${esc(p.group?.name || '')}</a>
          &rsaquo; ${esc(p.name)}
        </div>
        <div class="flex-between">
          <h1>${esc(p.name)}</h1>
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

      <div class="task-list">
        <div class="task-list-header">
          <h2>Tasks</h2>
          ${S.isAdmin ? '<button class="btn btn-primary" onclick="showTaskModal()">+ Add Task</button>' : ''}
        </div>
        ${tasks.length === 0
          ? '<div class="empty-state"><h3>No tasks yet</h3><p>Add tasks to track progress.</p></div>'
          : tasks.map(renderTaskItem).join('')}
      </div>

      <div id="project-comments"></div>
    </div>`;

  // Load project media
  try {
    const projectMedia = await apiGet(`/api/media?parentType=project&parentId=${p.id}`);
    const mediaContainer = document.getElementById('project-media');
    if (projectMedia.length > 0 || S.isAdmin) {
      mediaContainer.innerHTML = renderMediaItems(projectMedia) +
        (S.isAdmin ? renderMediaUploadButtons('project', p.id) : '');
    }
  } catch (e) { /* ignore */ }

  // Load comments
  const commentsContainer = document.getElementById('project-comments');
  await renderComments('project', p.id, commentsContainer);
}

function renderTaskItem(task) {
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

// ---- Task status cycling (admin) ----
async function cycleTaskStatus(taskId, currentStatus) {
  const next = STATUS_CYCLE[currentStatus] || 'todo';
  try {
    await apiPatch(`/api/tasks/${taskId}`, { status: next });
    renderProjectDetail();
  } catch (err) {
    toast(err.message, 'error');
  }
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

  // Load media
  let media = [];
  try {
    media = await apiGet(`/api/media?parentType=task&parentId=${taskId}`);
  } catch (e) { /* ignore */ }

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
      <button class="btn btn-ghost" onclick="document.querySelector('.modal-backdrop').remove(); showTaskModal(${JSON.stringify(task).replace(/"/g, '&quot;')})">Edit</button>
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
    <div class="form-group">
      <label>Contact Person</label>
      <input type="text" id="proj-contact" value="${esc(existing?.contactPerson || '')}" placeholder="Who to reach out to about this project">
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
  const groupId = document.getElementById('proj-group')?.value;
  const name = document.getElementById('proj-name').value.trim();
  const description = getRichEditorHTML('proj-description-editor');
  const contactPerson = document.getElementById('proj-contact').value.trim();

  if (!name) return toast('Name is required', 'error');
  if (!groupId) return toast('Select a group first', 'error');

  const data = { groupId, name, description, contactPerson: contactPerson || null };
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
      await apiPatch(`/api/tasks/${id}`, data);
    } else {
      data.projectId = S.currentProjectId;
      await apiPost('/api/tasks', data);
    }
    document.querySelector('.modal-backdrop')?.remove();
    renderProjectDetail();
    toast(id ? 'Task updated' : 'Task added', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  try {
    await apiDelete(`/api/tasks/${id}`);
    document.querySelector('.modal-backdrop')?.remove();
    renderProjectDetail();
    toast('Task deleted');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Navigate to project detail
function navigateToProject(projectId) {
  S.screen = 'projects';
  S.currentProjectId = projectId;
  renderCurrentScreen();
  buildNav();
}
