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
      <div class="announcements-grid" id="announcements-list">
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
    const carousel = document.getElementById(`ann-carousel-${annId}`);
    const extras = document.getElementById(`ann-extras-${annId}`);

    const photos = media.filter(m => m.type === 'photo');
    const voiceNotes = media.filter(m => m.type === 'voice');

    // Populate carousel with photos
    if (carousel && photos.length > 0) {
      carousel.classList.remove('empty');
      carousel.innerHTML = `
        <div class="carousel-track" id="ann-track-${annId}">
          ${photos.map(p => `<img src="/api/media/${p.id}/file" alt="${esc(p.originalName)}" onclick="openLightbox('/api/media/${p.id}/file')">`).join('')}
        </div>
        ${photos.length > 1 ? `
          <button class="carousel-btn prev" onclick="event.stopPropagation(); slideCarousel('${annId}', -1)">&#8249;</button>
          <button class="carousel-btn next" onclick="event.stopPropagation(); slideCarousel('${annId}', 1)">&#8250;</button>
          <div class="carousel-dots">
            ${photos.map((_, i) => `<button class="carousel-dot${i === 0 ? ' active' : ''}" onclick="event.stopPropagation(); goToSlide('${annId}', ${i})"></button>`).join('')}
          </div>` : ''}`;
      // Store slide state
      carousel.dataset.slide = '0';
      carousel.dataset.total = photos.length;
    }

    // Voice notes + upload buttons below
    if (extras) {
      let html = '';
      if (voiceNotes.length > 0) html += renderMediaItems(voiceNotes);
      if (S.isAdmin) {
        // Photo delete buttons for carousel photos
        if (photos.length > 0) {
          html += `<div class="media-grid">${photos.map(p =>
            `<div class="media-item"><img src="/api/media/${p.id}/file" class="media-thumb" style="width:40px;height:40px" alt="${esc(p.originalName)}"><button class="media-delete-btn" onclick="event.stopPropagation(); deleteMedia('${p.id}')" title="Delete" style="display:flex">&#10005;</button></div>`
          ).join('')}</div>`;
        }
        html += renderMediaUploadButtons('announcement', annId);
      }
      if (html) extras.innerHTML = html;
    }
  } catch (e) { /* ignore */ }
}

function slideCarousel(annId, direction) {
  const carousel = document.getElementById(`ann-carousel-${annId}`);
  if (!carousel) return;
  const total = parseInt(carousel.dataset.total);
  let current = parseInt(carousel.dataset.slide);
  current = (current + direction + total) % total;
  carousel.dataset.slide = current;

  const track = document.getElementById(`ann-track-${annId}`);
  if (track) track.style.transform = `translateX(-${current * 100}%)`;

  // Update dots
  carousel.querySelectorAll('.carousel-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === current);
  });
}

function goToSlide(annId, index) {
  const carousel = document.getElementById(`ann-carousel-${annId}`);
  if (!carousel) return;
  carousel.dataset.slide = index;

  const track = document.getElementById(`ann-track-${annId}`);
  if (track) track.style.transform = `translateX(-${index * 100}%)`;

  carousel.querySelectorAll('.carousel-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === index);
  });
}

function toggleAnnouncement(id) {
  const card = document.querySelector(`.announcement-card[data-ann-id="${id}"]`);
  if (card) card.classList.toggle('expanded');
}

function renderAnnouncementCard(a) {
  return `<div class="announcement-card${a.pinned ? ' pinned' : ''}" data-ann-id="${a.id}">
    <div class="announcement-carousel empty" id="ann-carousel-${a.id}"></div>
    <div class="announcement-content" onclick="toggleAnnouncement('${a.id}')">
      <div class="announcement-meta">
        ${a.pinned ? '<span class="tag tag-group">Pinned</span>' : ''}
        <span>${timeAgo(a.createdAt)}</span>
      </div>
      <h3>${esc(a.title)}</h3>
      <div class="announcement-body">${esc(a.body)}</div>
      <div class="announcement-expand-hint">Click to read more</div>
    </div>
    ${S.isAdmin ? `<div class="announcement-admin">
      <button class="comment-delete" onclick="editAnnouncement('${a.id}')">edit</button>
      <button class="comment-delete" onclick="deleteAnnouncement('${a.id}')">delete</button>
    </div>` : ''}
    <div class="announcement-extras" id="ann-extras-${a.id}"></div>
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
