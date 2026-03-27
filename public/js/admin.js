/* ========================================
   Admin Panel — Group management
   ======================================== */

async function renderAdmin() {
  const app = document.getElementById('app');
  showLoading();

  if (!S.isAdmin) {
    app.innerHTML = '<div class="empty-state"><h3>Admin access required</h3><p>Log in as admin to manage groups and settings.</p></div>';
    return;
  }

  try {
    S.groups = await apiGet('/api/groups');
  } catch (err) {
    app.innerHTML = `<p class="text-muted">Could not load groups.</p>`;
    return;
  }

  app.innerHTML = `
    <div class="admin-panel">
      <h1 class="mb-lg">Admin</h1>

      <div class="admin-section">
        <div class="flex-between">
          <h2>Groups / Themes</h2>
          <button class="btn btn-primary" onclick="showGroupModal()">+ New Group</button>
        </div>
        <ul class="admin-list mt-md">
          ${S.groups.length === 0
            ? '<p class="text-muted">No groups yet. Create one to start organising projects.</p>'
            : S.groups.map(g => {
              window._groupCache = window._groupCache || {};
              window._groupCache[g.id] = g;
              return `
              <li class="admin-list-item">
                <div>
                  <strong>${esc(g.name)}</strong>
                  <span class="text-muted text-sm"> — ${g._count?.projects || 0} projects</span>
                </div>
                <div class="admin-actions">
                  <button class="btn btn-ghost btn-small" onclick="showGroupModal(window._groupCache['${g.id}'])">Edit</button>
                  <button class="btn btn-danger btn-small" onclick="deleteGroup('${g.id}')">Delete</button>
                </div>
              </li>`;
            }).join('')}
        </ul>
      </div>

      <div class="admin-section">
        <h2>Quick Actions</h2>
        <div class="flex gap-sm mt-md">
          <button class="btn btn-primary" onclick="showProjectModal()">+ New Project</button>
          <button class="btn btn-primary" onclick="S.screen='dashboard'; renderCurrentScreen(); showAnnouncementModal()">+ Announcement</button>
        </div>
      </div>

      <div class="admin-section">
        <h2>Data Export</h2>
        <p class="text-muted text-sm mt-sm">Download all data as CSVs — open in Google Sheets via File → Import.</p>
        <a href="/api/export" class="btn btn-ghost mt-md" download>↓ Export all data</a>
      </div>
    </div>`;
}

// Group modal
function showGroupModal(existing) {
  const isEdit = !!existing;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal">
    <h2>${isEdit ? 'Edit' : 'New'} Group</h2>
    <div class="form-group">
      <label>Name</label>
      <input type="text" id="group-name" value="${esc(existing?.name || '')}" placeholder="e.g. Construction, Events, Expansion">
    </div>
    <div class="form-group">
      <label>Description (optional)</label>
      <div id="group-description-editor"></div>
    </div>
    <div class="form-group">
      <label>Mattermost channel URL (optional)</label>
      <input type="text" id="group-mattermost" value="${esc(existing?.mattermostChannel || '')}" placeholder="https://mattermost.desering.org/de-sering/channels/...">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="saveGroup(${isEdit ? `'${existing.id}'` : 'null'})">
        ${isEdit ? 'Save' : 'Create'}
      </button>
    </div>
  </div>`;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
  createRichEditor('group-description-editor', existing?.description || '');
}

async function saveGroup(id) {
  const name = document.getElementById('group-name').value.trim();
  const description = getRichEditorHTML('group-description-editor');
  const mattermostChannel = document.getElementById('group-mattermost').value.trim() || null;
  if (!name) return toast('Name is required', 'error');

  try {
    if (id) {
      await apiPatch(`/api/groups/${id}`, { name, description, mattermostChannel });
    } else {
      await apiPost('/api/groups', { name, description, mattermostChannel });
    }
    document.querySelector('.modal-backdrop')?.remove();
    renderAdmin();
    toast(id ? 'Group updated' : 'Group created', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteGroup(id) {
  if (!confirm('Delete this group? Only works if it has no projects.')) return;
  try {
    await apiDelete(`/api/groups/${id}`);
    renderAdmin();
    toast('Group deleted');
  } catch (err) {
    toast(err.message, 'error');
  }
}
