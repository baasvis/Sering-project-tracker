/* ========================================
   SSE — Real-time event handling
   ======================================== */

let _eventSource = null;
let _reconnectCount = 0;

function connectSSE() {
  if (_eventSource) return;

  _eventSource = new EventSource('/api/events');

  _eventSource.onopen = () => {
    if (S._sseConnected) {
      // Reconnection — re-fetch current screen to catch missed events
      renderCurrentScreen();
    }
    S._sseConnected = true;
    _reconnectCount = 0;
  };

  _eventSource.onerror = () => {
    _reconnectCount++;
    // After 10 consecutive failures, close and stop reconnecting
    // (EventSource auto-reconnects, but we cap runaway reconnection)
    if (_reconnectCount > 10) {
      _eventSource.close();
      _eventSource = null;
      S._sseConnected = false;
      console.warn('SSE: too many reconnect failures, giving up. Reload to reconnect.');
    }
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
  'task:created':    handleTaskMutation,
  'task:updated':    handleTaskMutation,
  'task:approved':   handleTaskMutation,
  'task:deleted':    handleTaskDeleted,
  'project:created':   handleProjectMutation,
  'project:updated':   handleProjectMutation,
  'project:approved':  handleProjectMutation,
  'project:deleted':   handleProjectDeleted,
  'shopping:created':  handleShoppingMutation,
  'shopping:updated':  handleShoppingMutation,
  'shopping:approved': handleShoppingMutation,
  'shopping:deleted':  handleShoppingMutation,
  'comment:created':   handleCommentCreated,
  'comment:deleted':   handleCommentDeleted,
  'announcement:created':  handleAnnouncementMutation,
  'announcement:updated':  handleAnnouncementMutation,
  'announcement:deleted':  handleAnnouncementMutation,
  'group:created':  handleGroupMutation,
  'group:updated':  handleGroupMutation,
  'group:deleted':  handleGroupMutation,
};

function handleTaskMutation(data) {
  const task = data.task;
  if (!task) return;

  if (S.currentProject && S.currentProjectId === task.projectId) {
    const idx = S.currentProject.tasks.findIndex(t => t.id === task.id);
    if (idx !== -1) {
      S.currentProject.tasks[idx] = { ...S.currentProject.tasks[idx], ...task };
    } else {
      S.currentProject.tasks.push(task);
    }
    rerenderTaskList();
  } else if (S.screen === 'dashboard' || S.screen === 'projects') {
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

function handleProjectMutation(data) {
  const project = data.project;
  if (!project) return;

  if (S.currentProjectId === project.id && S.currentProject) {
    const { tasks, ...rest } = project;
    Object.assign(S.currentProject, rest);
    renderProjectDetail();
  } else if (S.screen === 'dashboard' || S.screen === 'projects') {
    renderCurrentScreen();
  }
}

function handleProjectDeleted(data) {
  if (S.currentProjectId === data.projectId) {
    S.currentProjectId = null;
    S.currentProject = null;
    window.location.hash = 'projects';
    renderProjects();
    toast('This project was deleted', 'info');
  } else if (S.screen === 'dashboard' || S.screen === 'projects') {
    renderCurrentScreen();
  }
}

function handleShoppingMutation(data) {
  const projectId = data.item?.projectId || data.projectId;
  if (!projectId) return;

  if (S.screen === 'budget') {
    renderBudget();
  } else if (S.currentProjectId === projectId) {
    loadShoppingSection(projectId, `shopping-container-${projectId}`);
  }
}

function handleCommentCreated(data) {
  const comment = data.comment;
  if (!comment) return;
  _reloadCommentsIfVisible(comment.targetType, comment.targetId);
}

function handleCommentDeleted(data) {
  if (data.commentId) {
    const el = document.querySelector(`.comment[data-id="${data.commentId}"]`);
    if (el) { el.remove(); return; }
  }
  if (data.targetType && data.targetId) {
    _reloadCommentsIfVisible(data.targetType, data.targetId);
  }
}

function _reloadCommentsIfVisible(targetType, targetId) {
  if (targetType === 'project' && S.currentProjectId === targetId) {
    const container = document.getElementById('project-comments');
    if (container) renderComments('project', targetId, container);
  }
  if (targetType === 'task') {
    const container = document.getElementById(`task-comments-${targetId}`);
    if (container) renderComments('task', targetId, container);
  }
}

function handleAnnouncementMutation() {
  if (S.screen === 'dashboard') renderCurrentScreen();
}

function handleGroupMutation() {
  if (S.screen === 'dashboard' || S.screen === 'projects' || S.screen === 'admin') {
    renderCurrentScreen();
  }
}
