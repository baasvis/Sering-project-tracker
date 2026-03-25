/* ========================================
   Dashboard — Announcements + Project Overview
   ======================================== */

async function renderDashboard() {
  const app = document.getElementById('app');

  // Load data
  try {
    const [announcements, groups] = await Promise.all([
      apiGet('/api/announcements'),
      apiGet('/api/groups')
    ]);
    S.announcements = announcements;
    S.groups = groups;
  } catch (err) {
    app.innerHTML = `<p class="text-muted">Could not load data: ${esc(err.message)}</p>`;
    return;
  }

  app.innerHTML = `
    <div class="dashboard-header">
      <h1>De Sering Projects</h1>
      <p>Where community grows through food.</p>
    </div>

    <div class="announcements-section">
      <div class="section-header">
        <h2>Announcements</h2>
        ${S.isAdmin ? '<button class="btn btn-primary" onclick="showAnnouncementModal()">+ New</button>' : ''}
      </div>
      <div id="announcements-list">
        ${S.announcements.length === 0
          ? '<p class="text-muted">No announcements yet.</p>'
          : S.announcements.map(renderAnnouncementCard).join('')}
      </div>
    </div>

    <div class="projects-overview">
      <div class="section-header">
        <h2>Active Projects</h2>
        ${S.isAdmin ? '<button class="btn btn-primary" onclick="showProjectModal()">+ New Project</button>' : ''}
      </div>
      ${S.groups.length === 0
        ? '<p class="text-muted">No projects yet.</p>'
        : S.groups.map(renderGroupSection).join('')}
    </div>`;

  // Load media for each announcement
  for (const a of S.announcements) {
    loadAnnouncementMedia(a.id);
  }
}

async function loadAnnouncementMedia(annId) {
  try {
    const media = await apiGet(`/api/media?parentType=announcement&parentId=${annId}`);
    const container = document.getElementById(`ann-media-${annId}`);
    if (!container) return;
    if (media.length > 0 || S.isAdmin) {
      container.innerHTML = renderMediaItems(media) +
        (S.isAdmin ? renderMediaUploadButtons('announcement', annId) : '');
    }
  } catch (e) { /* ignore */ }
}

function renderAnnouncementCard(a) {
  return `<div class="announcement-card${a.pinned ? ' pinned' : ''}" data-ann-id="${a.id}">
    <div class="announcement-meta">
      ${a.pinned ? '<span class="tag tag-group">Pinned</span>' : ''}
      <span>${timeAgo(a.createdAt)}</span>
      ${S.isAdmin ? `
        <button class="comment-delete" onclick="editAnnouncement('${a.id}')">edit</button>
        <button class="comment-delete" onclick="deleteAnnouncement('${a.id}')">delete</button>
      ` : ''}
    </div>
    <h3>${esc(a.title)}</h3>
    <div class="announcement-body">${esc(a.body)}</div>
    <div class="announcement-media" id="ann-media-${a.id}"></div>
  </div>`;
}

function renderGroupSection(group) {
  const activeProjects = group.projects || [];
  if (activeProjects.length === 0) return '';

  return `<div class="group-section">
    <div class="group-label">${esc(group.name)}</div>
    <div class="project-cards">
      ${activeProjects.map(p => renderProjectCard(p, group)).join('')}
    </div>
  </div>`;
}

function renderProjectCard(project, group) {
  const tasks = project.tasks || [];
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return `<div class="project-card card-clickable" onclick="navigateToProject('${project.id}')">
    <div class="project-card-header">
      <h3>${esc(project.name)}</h3>
      <span class="tag tag-group">${esc(group.name)}</span>
    </div>
    <div class="task-count">${done}/${total} tasks done</div>
    <div class="progress-bar">
      <div class="progress-bar-fill" style="width: ${pct}%"></div>
    </div>
  </div>`;
}

// Announcement modal
function showAnnouncementModal(existing) {
  const isEdit = !!existing;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal">
    <h2>${isEdit ? 'Edit' : 'New'} Announcement</h2>
    <div class="form-group">
      <label>Title</label>
      <input type="text" id="ann-title" value="${esc(existing?.title || '')}">
    </div>
    <div class="form-group">
      <label>Body</label>
      <textarea id="ann-body" rows="5">${esc(existing?.body || '')}</textarea>
    </div>
    <div class="form-group">
      <label><input type="checkbox" id="ann-pinned" ${existing?.pinned ? 'checked' : ''}> Pin to top</label>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="saveAnnouncement(${isEdit ? `'${existing.id}'` : 'null'})">
        ${isEdit ? 'Save' : 'Post'}
      </button>
    </div>
  </div>`;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
}

async function saveAnnouncement(id) {
  const title = document.getElementById('ann-title').value.trim();
  const body = document.getElementById('ann-body').value.trim();
  const pinned = document.getElementById('ann-pinned').checked;

  if (!title || !body) return toast('Title and body are required', 'error');

  try {
    if (id) {
      await apiPatch(`/api/announcements/${id}`, { title, body, pinned });
    } else {
      await apiPost('/api/announcements', { title, body, pinned });
    }
    document.querySelector('.modal-backdrop')?.remove();
    renderDashboard();
    toast(id ? 'Announcement updated' : 'Announcement posted', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function editAnnouncement(id) {
  const a = S.announcements.find(x => x.id === id);
  if (a) showAnnouncementModal(a);
}

async function deleteAnnouncement(id) {
  if (!confirm('Delete this announcement?')) return;
  try {
    await apiDelete(`/api/announcements/${id}`);
    renderDashboard();
    toast('Announcement deleted');
  } catch (err) {
    toast(err.message, 'error');
  }
}
