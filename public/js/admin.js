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

  let reports = [];
  try {
    const [groups, reportsData] = await Promise.all([
      apiGet('/api/groups'),
      apiGet('/api/reports?resolved=false').catch(() => [])
    ]);
    S.groups = groups;
    reports = reportsData;
  } catch (err) {
    app.innerHTML = html`<p class="text-muted">Could not load admin data.</p>`;
    return;
  }

  app.innerHTML = html`
    <div class="admin-panel">
      <h1 class="mb-lg">Admin</h1>

      <div class="admin-section">
        <div class="flex-between">
          <h2>Groups / Themes</h2>
          <button class="btn btn-primary" data-action="showGroupModal">+ New Group</button>
        </div>
        <ul class="admin-list mt-md">
          ${raw(S.groups.length === 0
            ? '<p class="text-muted">No groups yet. Create one to start organising projects.</p>'
            : S.groups.map(g => {
              window._groupCache = window._groupCache || {};
              window._groupCache[g.id] = g;
              return html`
              <li class="admin-list-item">
                <div>
                  <strong>${g.name}</strong>
                  <span class="text-muted text-sm"> — ${g._count?.projects || 0} projects</span>
                </div>
                <div class="admin-actions">
                  <button class="btn btn-ghost btn-small" data-action="editGroup" data-id="${g.id}">Edit</button>
                  <button class="btn btn-danger btn-small" data-action="deleteGroup" data-id="${g.id}">Delete</button>
                </div>
              </li>`;
            }).join(''))}
        </ul>
      </div>

      <div class="admin-section">
        <h2>Quick Actions</h2>
        <div class="flex gap-sm mt-md">
          <button class="btn btn-primary" data-action="showProjectModal">+ New Project</button>
          <button class="btn btn-primary" data-action="newAnnouncementFromAdmin">+ Announcement</button>
        </div>
      </div>

      <div class="admin-section">
        <div class="flex-between">
          <h2>Reports ${raw(reports.length > 0 ? html`<span class="report-badge">${reports.length}</span>` : '')}</h2>
          <button class="btn btn-ghost btn-small" data-action="toggleResolvedReports">Show resolved</button>
        </div>
        <div id="admin-reports-list" class="mt-md">
          ${raw(reports.length === 0
            ? '<p class="text-muted">No open reports.</p>'
            : reports.map(r => {
              window._reportCache = window._reportCache || {};
              window._reportCache[r.id] = r;
              return html`
              <div class="report-card">
                <div class="report-card-header">
                  <strong>${r.reporterName}</strong>
                  <span class="text-muted text-xs">${raw(timeAgo(r.createdAt))}${raw(r.currentPage ? ' · ' + esc(r.currentPage) : '')}</span>
                </div>
                <p class="report-card-desc">${r.description}</p>
                ${raw(r.hasScreenshot ? html`<button class="btn btn-ghost btn-small" data-action="viewReportScreenshot" data-id="${r.id}">View screenshot</button>` : '')}
                <div class="report-card-actions">
                  <button class="btn btn-primary btn-small" data-action="resolveReport" data-id="${r.id}">Resolve</button>
                  <button class="btn btn-danger btn-small" data-action="deleteReport" data-id="${r.id}">Delete</button>
                </div>
              </div>`;
            }).join(''))}
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
  backdrop.innerHTML = html`<div class="modal">
    <h2>${isEdit ? 'Edit' : 'New'} Group</h2>
    <div class="form-group">
      <label>Name</label>
      <input type="text" id="group-name" value="${existing?.name || ''}" placeholder="e.g. Construction, Events, Expansion">
    </div>
    <div class="form-group">
      <label>Description (optional)</label>
      <div id="group-description-editor"></div>
    </div>
    <div class="form-group">
      <label>Mattermost channel URL (optional)</label>
      <input type="text" id="group-mattermost" value="${existing?.mattermostChannel || ''}" placeholder="https://mattermost.desering.org/de-sering/channels/...">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" data-action="closeModal">Cancel</button>
      <button class="btn btn-primary" data-action="saveGroup" data-id="${isEdit ? existing.id : ''}">
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

// ---- Reports management ----

async function viewReportScreenshot(id) {
  try {
    const report = await apiGet(`/api/reports/${id}`);
    if (!report.screenshotData) return toast('No screenshot available', 'error');

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = html`<div class="modal report-screenshot-modal">
      <div class="flex-between mb-md">
        <h2>Screenshot</h2>
        <button class="btn btn-ghost btn-small" data-action="closeModal">Close</button>
      </div>
      <img src="${raw(report.screenshotData)}" alt="Report screenshot" class="report-screenshot-full">
    </div>`;
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function resolveReport(id) {
  try {
    await apiPatch(`/api/reports/${id}`, { resolved: true });
    renderAdmin();
    toast('Report resolved', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteReport(id) {
  if (!confirm('Delete this report permanently?')) return;
  try {
    await apiDelete(`/api/reports/${id}`);
    renderAdmin();
    toast('Report deleted');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function toggleResolvedReports() {
  try {
    const reports = await apiGet('/api/reports');
    const container = document.getElementById('admin-reports-list');
    if (!container) return;

    if (reports.length === 0) {
      container.innerHTML = '<p class="text-muted">No reports at all.</p>';
      return;
    }

    container.innerHTML = reports.map(r => {
      window._reportCache = window._reportCache || {};
      window._reportCache[r.id] = r;
      return html`
      <div class="report-card ${r.resolved ? 'report-resolved' : ''}">
        <div class="report-card-header">
          <strong>${r.reporterName}</strong>
          <span class="text-muted text-xs">${raw(r.resolved ? 'Resolved · ' : '')}${raw(timeAgo(r.createdAt))}${raw(r.currentPage ? ' · ' + esc(r.currentPage) : '')}</span>
        </div>
        <p class="report-card-desc">${r.description}</p>
        ${raw(r.hasScreenshot ? html`<button class="btn btn-ghost btn-small" data-action="viewReportScreenshot" data-id="${r.id}">View screenshot</button>` : '')}
        <div class="report-card-actions">
          ${raw(r.resolved
            ? html`<button class="btn btn-ghost btn-small" data-action="unresolveReport" data-id="${r.id}">Reopen</button>`
            : html`<button class="btn btn-primary btn-small" data-action="resolveReport" data-id="${r.id}">Resolve</button>`)}
          <button class="btn btn-danger btn-small" data-action="deleteReport" data-id="${r.id}">Delete</button>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function unresolveReport(id) {
  try {
    await apiPatch(`/api/reports/${id}`, { resolved: false });
    renderAdmin();
    toast('Report reopened');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---- onAction registrations ----
onAction('showGroupModal', () => showGroupModal());
onAction('editGroup', (el) => showGroupModal(window._groupCache[el.dataset.id]));
onAction('saveGroup', (el) => saveGroup(el.dataset.id || null));
onAction('deleteGroup', (el) => deleteGroup(el.dataset.id));
onAction('newAnnouncementFromAdmin', () => { S.screen = 'dashboard'; renderCurrentScreen(); showAnnouncementModal(); });
onAction('toggleResolvedReports', () => toggleResolvedReports());
onAction('viewReportScreenshot', (el) => viewReportScreenshot(el.dataset.id));
onAction('resolveReport', (el) => resolveReport(el.dataset.id));
onAction('deleteReport', (el) => deleteReport(el.dataset.id));
onAction('unresolveReport', (el) => unresolveReport(el.dataset.id));
