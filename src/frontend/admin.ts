/* ========================================
   Admin Panel — Group management
   ======================================== */

async function renderAdmin(): Promise<void> {
  var app = document.getElementById('app')!;
  showLoading();

  if (!S.isAdmin) {
    app.innerHTML = '<div class="empty-state"><h3>Admin access required</h3><p>Log in as admin to manage groups and settings.</p></div>';
    return;
  }

  var reports: any[] = [];
  try {
    var [groups, reportsData] = await Promise.all([
      apiGet('/api/groups'),
      apiGet('/api/reports?resolved=false').catch(() => [])
    ]);
    S.groups = groups;
    reports = reportsData;
  } catch (err: any) {
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
            : S.groups.map((g: any) => {
              (window as any)._groupCache = (window as any)._groupCache || {};
              (window as any)._groupCache[g.id] = g;
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
            : reports.map((r: any) => {
              (window as any)._reportCache = (window as any)._reportCache || {};
              (window as any)._reportCache[r.id] = r;
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
        <p class="text-muted text-sm mt-sm">Download all data as CSVs — open in Google Sheets via File \u2192 Import.</p>
        <a href="/api/export" class="btn btn-ghost mt-md" download>\u2193 Export all data</a>
      </div>
    </div>`;
}

// Group modal
function showGroupModal(existing?: any): void {
  var isEdit = !!existing;
  var backdrop = document.createElement('div');
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
  backdrop.addEventListener('click', (e: Event) => { if (e.target === backdrop) closeModal(backdrop); });
  openModal(backdrop, (isEdit ? 'Edit' : 'New') + ' Group');
  createRichEditor('group-description-editor', existing?.description || '');
}

async function saveGroup(id: string | null): Promise<void> {
  var name = (document.getElementById('group-name') as HTMLInputElement).value.trim();
  var description = getRichEditorHTML('group-description-editor');
  var mattermostChannel = (document.getElementById('group-mattermost') as HTMLInputElement).value.trim() || null;
  if (!name) return toast('Name is required', 'error');

  try {
    if (id) {
      await apiPatch(`/api/groups/${id}`, { name, description, mattermostChannel });
    } else {
      await apiPost('/api/groups', { name, description, mattermostChannel });
    }
    { var bd = document.querySelector('.modal-backdrop') as HTMLElement | null; if (bd) closeModal(bd); }
    renderAdmin();
    toast(id ? 'Group updated' : 'Group created', 'success');
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

async function deleteGroup(id: string): Promise<void> {
  if (!confirm('Delete this group? Only works if it has no projects.')) return;
  try {
    await apiDelete(`/api/groups/${id}`);
    renderAdmin();
    toast('Group deleted');
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

// ---- Reports management ----

async function viewReportScreenshot(id: string): Promise<void> {
  try {
    var report = await apiGet(`/api/reports/${id}`);
    if (!report.screenshotData) return toast('No screenshot available', 'error');

    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = html`<div class="modal report-screenshot-modal">
      <div class="flex-between mb-md">
        <h2>Screenshot</h2>
        <button class="btn btn-ghost btn-small" data-action="closeModal">Close</button>
      </div>
      <img src="${safeDataImageSrc(report.screenshotData)}" alt="Report screenshot" class="report-screenshot-full">
    </div>`;
    backdrop.addEventListener('click', (e: Event) => { if (e.target === backdrop) closeModal(backdrop); });
    openModal(backdrop, 'Report Screenshot');
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

async function resolveReport(id: string): Promise<void> {
  try {
    await apiPatch(`/api/reports/${id}`, { resolved: true });
    renderAdmin();
    toast('Report resolved', 'success');
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

async function deleteReport(id: string): Promise<void> {
  if (!confirm('Delete this report permanently?')) return;
  try {
    await apiDelete(`/api/reports/${id}`);
    renderAdmin();
    toast('Report deleted');
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

async function toggleResolvedReports(): Promise<void> {
  try {
    var reports = await apiGet('/api/reports');
    var container = document.getElementById('admin-reports-list');
    if (!container) return;

    if (reports.length === 0) {
      container.innerHTML = '<p class="text-muted">No reports at all.</p>';
      return;
    }

    container.innerHTML = reports.map((r: any) => {
      (window as any)._reportCache = (window as any)._reportCache || {};
      (window as any)._reportCache[r.id] = r;
      return html`
      <div class="report-card ${r.resolved ? 'report-resolved' : ''}">
        <div class="report-card-header">
          <strong>${r.reporterName}</strong>
          <span class="text-muted text-xs">${raw(r.resolved ? 'Resolved \u00B7 ' : '')}${raw(timeAgo(r.createdAt))}${raw(r.currentPage ? ' \u00B7 ' + esc(r.currentPage) : '')}</span>
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
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

async function unresolveReport(id: string): Promise<void> {
  try {
    await apiPatch(`/api/reports/${id}`, { resolved: false });
    renderAdmin();
    toast('Report reopened');
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

// Re-render just the groups list from current S.groups (no API fetch)
function rerenderAdminGroups(): void {
  var list = document.querySelector('.admin-list');
  if (!list) return;
  (window as any)._groupCache = (window as any)._groupCache || {};
  list.innerHTML = S.groups.length === 0
    ? '<p class="text-muted">No groups yet. Create one to start organising projects.</p>'
    : S.groups.map((g: any) => {
        (window as any)._groupCache[g.id] = g;
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
      }).join('');
}

// ---- onAction registrations ----
onAction('showGroupModal', () => showGroupModal());
onAction('editGroup', (el: HTMLElement) => showGroupModal((window as any)._groupCache[el.dataset.id!]));
onAction('saveGroup', (el: HTMLElement) => saveGroup(el.dataset.id || null));
onAction('deleteGroup', (el: HTMLElement) => deleteGroup(el.dataset.id!));
onAction('newAnnouncementFromAdmin', () => { S.screen = 'dashboard'; renderCurrentScreen(); showAnnouncementModal(); });
onAction('toggleResolvedReports', () => toggleResolvedReports());
onAction('viewReportScreenshot', (el: HTMLElement) => viewReportScreenshot(el.dataset.id!));
onAction('resolveReport', (el: HTMLElement) => resolveReport(el.dataset.id!));
onAction('deleteReport', (el: HTMLElement) => deleteReport(el.dataset.id!));
onAction('unresolveReport', (el: HTMLElement) => unresolveReport(el.dataset.id!));

// ---- Reactive subscriptions ----

S.subscribe('groups', () => {
  if (S.screen !== 'admin') return;
  rerenderAdminGroups();
});
