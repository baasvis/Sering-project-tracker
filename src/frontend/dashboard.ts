/* ========================================
   Dashboard — Announcements + Project Overview
   ======================================== */

async function renderDashboard(): Promise<void> {
  const app = document.getElementById('app')!;
  showLoading();
  S._expandedProjects = {};
  S._expandedCardId = null;

  // Load data
  try {
    const [announcements, groups] = await Promise.all([
      apiGet('/api/announcements'),
      apiGet('/api/groups')
    ]);
    S.announcements = announcements;
    S.groups = groups;
  } catch (err: any) {
    app.innerHTML = html`<p class="text-muted">Could not load data: ${err.message}</p>`;
    return;
  }

  app.innerHTML = html`
    <div class="dashboard-header">
      <h1>Sering Centraal Projects</h1>
      <p>Let's build Summer Sering!</p>
    </div>

    <div class="announcements-section">
      <div class="section-header">
        <h2>Announcements</h2>
        ${raw(S.isAdmin ? '<button class="btn btn-primary" data-action="showAnnouncementModal">+ New</button>' : '')}
      </div>
      <div class="announcements-grid" id="announcements-list">
        ${raw(S.announcements.length === 0
          ? '<p class="text-muted">No announcements yet.</p>'
          : S.announcements.map(renderAnnouncementCard).join(''))}
      </div>
    </div>

    ${raw(renderTierButtons())}

    <div class="projects-overview" id="dashboard-projects-overview">
      <div class="section-header">
        <h2>Active Projects</h2>
        ${raw(S.isAdmin ? '<button class="btn btn-primary" data-action="showProjectModal">+ New Project</button>' : '')}
      </div>
      <div id="dashboard-group-sections">
        ${raw(S.groups.length === 0
          ? '<p class="text-muted">No projects yet.</p>'
          : S.groups.map(renderGroupSection).join(''))}
      </div>
    </div>`;

  // Load announcement media (inline from backend) + batch-fetch all project media in one call
  const projectIds = S.groups.flatMap((g: any) => (g.projects || []).map((p: any) => p.id));
  await Promise.all([
    ...S.announcements.map((a: any) => loadAnnouncementMedia(a)),
    loadAllProjectCardMedia(projectIds)
  ]);
}

async function loadAnnouncementMedia(a: any): Promise<void> {
  try {
    // Use inline media from backend response (batch-fetched)
    const media = a.media || [];
    const annId = a.id;
    const carousel = document.getElementById(`ann-carousel-${annId}`);
    const extras = document.getElementById(`ann-extras-${annId}`);

    const photos = media.filter((m: any) => m.type === 'photo');
    const voiceNotes = media.filter((m: any) => m.type === 'voice');

    // Populate carousel with photos
    if (carousel && photos.length > 0) {
      carousel.classList.remove('empty');
      carousel.innerHTML = html`
        <div class="carousel-track" id="ann-track-${annId}">
          ${raw(photos.map((p: any) => html`<img src="/api/media/${p.id}/file" alt="${p.originalName}" data-action="openLightbox" data-src="/api/media/${p.id}/file">`).join(''))}
        </div>
        ${raw(photos.length > 1 ? html`
          <button class="carousel-btn prev" data-action="slideCarousel" data-stop data-ann-id="${annId}" data-direction="-1">${raw('&#8249;')}</button>
          <button class="carousel-btn next" data-action="slideCarousel" data-stop data-ann-id="${annId}" data-direction="1">${raw('&#8250;')}</button>
          <div class="carousel-dots">
            ${raw(photos.map((_: any, i: number) => html`<button class="carousel-dot${raw(i === 0 ? ' active' : '')}" data-action="goToSlide" data-stop data-ann-id="${annId}" data-index="${i}"></button>`).join(''))}
          </div>` : '')}`;
      carousel.dataset.slide = '0';
      carousel.dataset.total = String(photos.length);
    }

    // Voice notes + upload buttons below
    if (extras) {
      let extrasHtml = '';
      if (voiceNotes.length > 0) extrasHtml += renderMediaItems(voiceNotes);
      if (S.isAdmin) {
        if (photos.length > 0) {
          extrasHtml += html`<div class="media-grid">${raw(photos.map((p: any) =>
            html`<div class="media-item"><img src="/api/media/${p.id}/file" class="media-thumb" style="width:40px;height:40px" alt="${p.originalName}"><button class="media-delete-btn" data-action="deleteMedia" data-stop data-id="${p.id}" title="Delete" style="display:flex">${raw('&#10005;')}</button></div>`
          ).join(''))}</div>`;
        }
        extrasHtml += renderMediaUploadButtons('announcement', annId);
      }
      if (extrasHtml) extras.innerHTML = extrasHtml;
    }
  } catch (e: any) {
    console.warn('Could not load announcement media:', e.message);
  }
}

function slideCarousel(annId: string, direction: number): void {
  const carousel = document.getElementById(`ann-carousel-${annId}`);
  if (!carousel) return;
  const total = parseInt(carousel.dataset.total!);
  let current = parseInt(carousel.dataset.slide!);
  current = (current + direction + total) % total;
  carousel.dataset.slide = String(current);

  const track = document.getElementById(`ann-track-${annId}`);
  if (track) track.style.transform = `translateX(-${current * 100}%)`;

  // Update dots
  carousel.querySelectorAll('.carousel-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === current);
  });
}

function goToSlide(annId: string, index: number): void {
  const carousel = document.getElementById(`ann-carousel-${annId}`);
  if (!carousel) return;
  carousel.dataset.slide = String(index);

  const track = document.getElementById(`ann-track-${annId}`);
  if (track) track.style.transform = `translateX(-${index * 100}%)`;

  carousel.querySelectorAll('.carousel-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === index);
  });
}

function toggleAnnouncement(id: string): void {
  const card = document.querySelector(`.announcement-card[data-ann-id="${id}"]`);
  if (card) card.classList.toggle('expanded');
}

function renderAnnouncementCard(a: any): string {
  // Media is now included inline from the backend
  const mediaHtml = renderMediaItems(a.media || []);
  const uploadHtml = S.isAdmin ? renderMediaUploadButtons('announcement', a.id) : '';

  return html`<div class="announcement-card${raw(a.pinned ? ' pinned' : '')}" data-ann-id="${a.id}">
    <div class="announcement-carousel empty" id="ann-carousel-${a.id}"></div>
    <div class="announcement-content" data-action="toggleAnnouncement" data-id="${a.id}">
      <div class="announcement-meta">
        ${raw(a.pinned ? '<span class="tag tag-group">Pinned</span>' : '')}
        <span>${raw(timeAgo(a.createdAt))}</span>
      </div>
      <h3>${a.title}</h3>
      <p class="announcement-preview">${raw(esc(extractPreviewText(a.body)))}</p>
      <div class="announcement-body">${raw(renderDescription(a.body))}</div>
      <div class="announcement-expand-hint">Click to read more</div>
    </div>
    ${raw(S.isAdmin ? html`<div class="announcement-admin">
      <button class="comment-delete" data-action="editAnnouncement" data-id="${a.id}">edit</button>
      <button class="comment-delete" data-action="deleteAnnouncement" data-id="${a.id}">delete</button>
    </div>` : '')}
    <div class="announcement-extras" id="ann-extras-${a.id}"></div>
  </div>`;
}

// Re-render only the dashboard project sections (tier filter changed, no full reload)
function rerenderDashboardProjects(): void {
  updateTierButtonStates();

  const container = document.getElementById('dashboard-group-sections');
  if (!container || !S.groups) return;

  container.innerHTML = S.groups.length === 0
    ? html`<p class="text-muted">No projects yet.</p>`
    : S.groups.map(renderGroupSection).join('');

  // Reload project card media
  const projectIds = S.groups.flatMap((g: any) =>
    filterProjectsByTier(g.projects || []).map((p: any) => p.id)
  );
  loadAllProjectCardMedia(projectIds);
}

function renderGroupSection(group: any): string {
  const activeProjects = sortProjectsByTier(filterProjectsByTier(group.projects || []));
  if (activeProjects.length === 0) return '';

  return html`<div class="group-section">
    <div class="group-label">${group.name}</div>
    <div class="project-cards">
      ${raw(activeProjects.map((p: any) => renderProjectCard(p, group)).join(''))}
    </div>
  </div>`;
}

function renderProjectCard(project: any, group: any): string {
  const counts = project.taskCounts || { todo: 0, in_progress: 0, done: 0 };
  const total = counts.todo + counts.in_progress + counts.done;
  const done = counts.done;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isExpanded = S._expandedCardId === project.id;

  return html`<div class="project-card card-clickable ${raw(isExpanded ? 'expanded' : '')}"
               id="project-card-${project.id}"
               data-action="toggleProjectCard" data-project-id="${project.id}">
    <div class="project-card-header">
      <h3>${project.name}</h3>
      <div class="project-card-tags">
        ${raw(project.tier && PROJECT_TIERS[project.tier] ? html`<span class="tag tag-tier" style="background:${raw(PROJECT_TIERS[project.tier].bg)};color:${raw(PROJECT_TIERS[project.tier].color)}">${PROJECT_TIERS[project.tier].label}</span>` : '')}
        ${raw(project.joinType && JOIN_TYPES[project.joinType] ? html`<span class="tag tag-join-${project.joinType}">${JOIN_TYPES[project.joinType].label}</span>` : '')}
        <span class="tag tag-group">${group.name}</span>
      </div>
    </div>
    <div class="task-count">${done}/${total} tasks done</div>
    <div class="progress-bar">
      <div class="progress-bar-fill" style="width: ${pct}%"></div>
    </div>
    <div class="project-card-media" id="proj-media-${project.id}"></div>
    <div class="project-card-expanded" id="proj-expanded-${project.id}">
      <div class="project-card-expanded-content"></div>
    </div>
  </div>`;
}

async function toggleProjectCard(projectId: string): Promise<void> {
  // Collapse if already expanded
  if (S._expandedCardId === projectId) {
    S._expandedCardId = null;
    const card = document.getElementById('project-card-' + projectId);
    if (card) card.classList.remove('expanded');
    return;
  }

  // Collapse previous
  if (S._expandedCardId) {
    const prev = document.getElementById('project-card-' + S._expandedCardId);
    if (prev) prev.classList.remove('expanded');
  }

  S._expandedCardId = projectId;
  const card = document.getElementById('project-card-' + projectId);
  if (!card) return;
  card.classList.add('expanded');

  const contentEl = card.querySelector('.project-card-expanded-content') as HTMLElement | null;
  if (!contentEl) return;

  // Check cache
  let project = S._expandedProjects[projectId];
  if (!project) {
    contentEl.innerHTML = html`<div class="loading-spinner" style="${raw('margin:var(--space-md) 0')}"></div>`;
    try {
      project = await apiGet('/api/projects/' + projectId);
      S._expandedProjects[projectId] = project;
    } catch (err) {
      contentEl.innerHTML = html`<p class="text-muted">Could not load details.</p>`;
      return;
    }
  }

  const tasks = (project.tasks || []).filter((t: any) => t.approved !== false);
  const statusIcon: Record<string, string> = { done: '&#10003;', in_progress: '&#9679;', todo: '' };

  contentEl.innerHTML = html`
    ${raw(project.description ? html`<div class="project-card-description">${raw(renderDescription(project.description))}</div>` : '')}
    ${raw(tasks.length > 0
      ? html`<div class="project-card-tasks"><h4>Tasks</h4>
          ${raw(tasks.map((t: any) =>
            html`<div class="inline-task-item">
              <div class="task-status-dot ${t.status}">${raw(statusIcon[t.status] || '')}</div>
              <span class="${raw(t.status === 'done' ? 'task-done' : '')}">${t.name}</span>
            </div>`
          ).join(''))}
        </div>`
      : '')}
    <button class="btn btn-secondary btn-small mt-sm" data-action="navigateToProject" data-stop data-project-id="${projectId}">View full details ${raw('&rarr;')}</button>`;
}

// Batch-fetch media for all project cards in one API call (avoids N+1)
async function loadAllProjectCardMedia(projectIds: string[]): Promise<void> {
  if (projectIds.length === 0) return;
  try {
    const mediaByProject = await apiGet(`/api/media/batch?parentType=project&parentIds=${projectIds.join(',')}`);
    for (const projectId of projectIds) {
      const media = mediaByProject[projectId] || [];
      const container = document.getElementById(`proj-media-${projectId}`);
      if (!container) continue;
      const photos = media.filter((m: any) => m.type === 'photo');
      if (photos.length > 0) {
        container.innerHTML = html`<div class="media-grid project-card-photos">${raw(photos.map((m: any) =>
          html`<img src="/api/media/${m.id}/file" class="media-thumb"
                data-action="openLightbox" data-stop data-src="/api/media/${m.id}/file"
                alt="${m.originalName}">`
        ).join(''))}</div>`;
      }
    }
  } catch (e) { /* ignore */ }
}

// Announcement modal
function showAnnouncementModal(existing?: any): void {
  const isEdit = !!existing;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = html`<div class="modal">
    <h2>${isEdit ? 'Edit' : 'New'} Announcement</h2>
    <div class="form-group">
      <label>Title</label>
      <input type="text" id="ann-title" value="${existing?.title || ''}">
    </div>
    <div class="form-group">
      <label>Body</label>
      <div id="ann-body-editor"></div>
    </div>
    <div class="form-group">
      <label><input type="checkbox" id="ann-pinned" ${raw(existing?.pinned ? 'checked' : '')}> Pin to top</label>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" data-action="closeModal">Cancel</button>
      <button class="btn btn-primary" data-action="saveAnnouncement" data-id="${isEdit ? existing.id : ''}">
        ${isEdit ? 'Save' : 'Post'}
      </button>
    </div>
  </div>`;
  backdrop.addEventListener('click', (e: MouseEvent) => { if (e.target === backdrop) closeModal(backdrop); });
  openModal(backdrop, (isEdit ? 'Edit' : 'New') + ' Announcement');
  createRichEditor('ann-body-editor', existing?.body || '');
}

async function saveAnnouncement(id: string | null): Promise<void> {
  return withDedup('saveAnnouncement', async () => {
    const title = (document.getElementById('ann-title') as HTMLInputElement).value.trim();
    const body = getRichEditorHTML('ann-body-editor');
    const pinned = (document.getElementById('ann-pinned') as HTMLInputElement).checked;

    if (!title || !body) return toast('Title and body are required', 'error');

    try {
      if (id) {
        await apiPatch(`/api/announcements/${id}`, { title, body, pinned });
      } else {
        await apiPost('/api/announcements', { title, body, pinned });
      }
      const bd = document.querySelector('.modal-backdrop') as HTMLElement | null;
      if (bd) closeModal(bd);
      renderDashboard();
      toast(id ? 'Announcement updated' : 'Announcement posted', 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    }
  });
}

async function editAnnouncement(id: string): Promise<void> {
  const a = S.announcements.find((x: any) => x.id === id);
  if (a) showAnnouncementModal(a);
}

async function deleteAnnouncement(id: string): Promise<void> {
  if (!confirm('Delete this announcement?')) return;
  try {
    await apiDelete(`/api/announcements/${id}`);
    renderDashboard();
    toast('Announcement deleted');
  } catch (err: any) {
    toast(err.message, 'error');
  }
}

/* ---- onAction registrations for dashboard ---- */

onAction('showAnnouncementModal', () => showAnnouncementModal());
onAction('showProjectModal', () => showProjectModal());
onAction('toggleAnnouncement', (el: HTMLElement) => toggleAnnouncement(el.dataset.id!));
onAction('editAnnouncement', (el: HTMLElement) => editAnnouncement(el.dataset.id!));
onAction('deleteAnnouncement', (el: HTMLElement) => deleteAnnouncement(el.dataset.id!));
onAction('toggleProjectCard', (el: HTMLElement) => toggleProjectCard(el.dataset.projectId!));
onAction('navigateToProject', (el: HTMLElement) => navigateToProject(el.dataset.projectId!));
onAction('slideCarousel', (el: HTMLElement) => slideCarousel(el.dataset.annId!, parseInt(el.dataset.direction!)));
onAction('goToSlide', (el: HTMLElement) => goToSlide(el.dataset.annId!, parseInt(el.dataset.index!)));
// deleteMedia action is registered in media.js — uses data-id
onAction('closeModal', (el: HTMLElement) => closeModal(el.closest('.modal-backdrop')!));
onAction('saveAnnouncement', (el: HTMLElement) => saveAnnouncement(el.dataset.id || null));

// ---- Reactive subscriptions (SSE updates S -> subscribers re-render) ----

S.subscribe('groups', () => {
  if (S.screen !== 'dashboard') return;
  rerenderDashboardProjects();
});

S.subscribe('announcements', () => {
  if (S.screen !== 'dashboard') return;
  const grid = document.getElementById('announcements-list');
  if (!grid) return;
  grid.innerHTML = S.announcements.length === 0
    ? html`<p class="text-muted">No announcements yet.</p>`
    : S.announcements.map(renderAnnouncementCard).join('');
  S.announcements.forEach((a: any) => loadAnnouncementMedia(a));
});
