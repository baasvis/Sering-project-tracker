/* ========================================
   SSE — Real-time event handling
   ======================================== */

let _eventSource = null;

function connectSSE() {
  if (_eventSource) return;

  _eventSource = new EventSource('/api/events');

  _eventSource.onopen = () => {
    if (S._sseConnected) {
      // Reconnection — re-fetch current screen to catch missed events
      renderCurrentScreen();
    }
    S._sseConnected = true;
  };

  _eventSource.onerror = () => {
    // EventSource auto-reconnects; nothing to do here
  };

  // Register all event handlers
  const events = [
    'task:created', 'task:updated', 'task:approved', 'task:deleted',
    'project:created', 'project:updated', 'project:approved', 'project:deleted',
    'shopping:created', 'shopping:updated', 'shopping:approved', 'shopping:deleted',
    'comment:created', 'comment:deleted',
    'announcement:created', 'announcement:updated', 'announcement:deleted',
    'group:created', 'group:updated', 'group:deleted',
  ];

  for (const evt of events) {
    _eventSource.addEventListener(evt, (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }

      // Self-dedup: skip events from our own mutations
      if (data._mutationId && S._pendingMutationIds.has(data._mutationId)) {
        S._pendingMutationIds.delete(data._mutationId);
        return;
      }

      const handler = SSE_HANDLERS[evt];
      if (handler) handler(data);
    });
  }
}

// ---- Event handlers ----

const SSE_HANDLERS = {
  'task:created':   handleTaskMutation,
  'task:updated':   handleTaskMutation,
  'task:approved':  handleTaskMutation,
  'task:deleted':   handleTaskDeleted,
  'project:created':  handleProjectMutation,
  'project:updated':  handleProjectMutation,
  'project:approved': handleProjectMutation,
  'project:deleted':  handleProjectDeleted,
  'shopping:created':  handleShoppingMutation,
  'shopping:updated':  handleShoppingMutation,
  'shopping:approved': handleShoppingMutation,
  'shopping:deleted':  handleShoppingMutation,
  'comment:created':  handleCommentCreated,
  'comment:deleted':  handleCommentDeleted,
  'announcement:created':  handleAnnouncementMutation,
  'announcement:updated':  handleAnnouncementMutation,
  'announcement:deleted':  handleAnnouncementMutation,
  'group:created':  handleGroupMutation,
  'group:updated':  handleGroupMutation,
  'group:deleted':  handleGroupMutation,
};

// -- Task handlers --

function handleTaskMutation(data) {
  const task = data.task;
  if (!task) return;

  // If viewing the project that owns this task, update local state
  if (S.currentProject && S.currentProjectId === task.projectId) {
    const idx = S.currentProject.tasks.findIndex(t => t.id === task.id);
    if (idx !== -1) {
      S.currentProject.tasks[idx] = { ...S.currentProject.tasks[idx], ...task };
    } else {
      S.currentProject.tasks.push(task);
    }
    rerenderTaskList();
  } else if (S.screen === 'dashboard' || S.screen === 'projects') {
    // Task counts changed — re-render list view
    renderCurrentScreen();
  }
}

function handleTaskDeleted(data) {
  if (S.currentProject && S.currentProjectId === data.projectId) {
    S.currentProject.tasks = (S.currentProject.tasks || []).filter(t => t.id !== data.taskId);
    rerenderTaskList();
  } else if (S.screen === 'dashboard' || S.screen === 'projects') {
    renderCurrentScreen();
  }
}

// -- Project handlers --

function handleProjectMutation(data) {
  const project = data.project;
  if (!project) return;

  if (S.currentProjectId === project.id && S.currentProject) {
    // Viewing this project — update fields (but keep tasks array)
    const { tasks, ...rest } = project;
    Object.assign(S.currentProject, rest);
    // Re-render the full detail to reflect name/description/tier changes
    renderProjectDetail();
  } else if (S.screen === 'dashboard' || S.screen === 'projects') {
    renderCurrentScreen();
  }
}

function handleProjectDeleted(data) {
  if (S.currentProjectId === data.projectId) {
    // Currently viewing the deleted project — go back
    S.currentProjectId = null;
    S.currentProject = null;
    window.location.hash = 'projects';
    renderProjects();
    toast('This project was deleted', 'info');
  } else if (S.screen === 'dashboard' || S.screen === 'projects') {
    renderCurrentScreen();
  }
}

// -- Shopping handlers --

function handleShoppingMutation(data) {
  const projectId = data.item?.projectId || data.projectId;
  if (!projectId) return;

  if (S.screen === 'budget') {
    renderBudget();
  } else if (S.currentProjectId === projectId) {
    loadShoppingSection(projectId, `shopping-container-${projectId}`);
  }
}

// -- Comment handlers --

function handleCommentCreated(data) {
  const comment = data.comment;
  if (!comment) return;
  _reloadCommentsIfVisible(comment.targetType, comment.targetId);
}

function handleCommentDeleted(data) {
  // Try to remove from DOM directly
  if (data.commentId) {
    const el = document.querySelector(`.comment[data-id="${data.commentId}"]`);
    if (el) { el.remove(); return; }
  }
  // Fallback: reload if we're on the right target
  if (data.targetType && data.targetId) {
    _reloadCommentsIfVisible(data.targetType, data.targetId);
  }
}

function _reloadCommentsIfVisible(targetType, targetId) {
  // Project-level comments
  if (targetType === 'project' && S.currentProjectId === targetId) {
    const container = document.getElementById('project-comments');
    if (container) renderComments('project', targetId, container);
  }
  // Task-level comments (inside task detail modal)
  if (targetType === 'task') {
    const container = document.getElementById(`task-comments-${targetId}`);
    if (container) renderComments('task', targetId, container);
  }
}

// -- Announcement handlers --

function handleAnnouncementMutation() {
  if (S.screen === 'dashboard') {
    renderCurrentScreen();
  }
}

// -- Group handlers --

function handleGroupMutation() {
  if (S.screen === 'dashboard' || S.screen === 'projects' || S.screen === 'admin') {
    renderCurrentScreen();
  }
}
