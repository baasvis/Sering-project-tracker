/* ========================================
   SSE — Real-time event handling
   ======================================== */

let _eventSource = null;
let _reconnectCount = 0;
let _renderDebounceTimer = null;
let _backoffReconnectTimer = null;

// Debounced renderCurrentScreen — coalesces rapid SSE events into a single render
function _debouncedRender() {
  if (_renderDebounceTimer) return;
  _renderDebounceTimer = setTimeout(() => {
    _renderDebounceTimer = null;
    renderCurrentScreen();
  }, 300);
}

// Refresh groups data and do targeted re-render (no loading spinner)
let _refreshGroupsTimer = null;
let _refreshGroupsAbort = null;
async function _refreshGroupsAndRerender() {
  // Debounce: multiple events in quick succession → single fetch
  if (_refreshGroupsTimer) return;
  _refreshGroupsTimer = setTimeout(async () => {
    _refreshGroupsTimer = null;
    // Capture screen at time of dispatch to avoid writing to wrong screen
    const screenAtDispatch = S.screen;
    try {
      S.groups = await apiGet('/api/groups');
      // Only re-render if still on the same screen
      if (S.screen !== screenAtDispatch) return;
      if (S.screen === 'dashboard') {
        rerenderDashboardProjects();
      } else if (S.screen === 'projects' && !S.currentProjectId) {
        _allProjectsCached = S.groups.flatMap(g => (g.projects || []).filter(p => p.approved !== false));
        rerenderProjectFilters();
      }
    } catch (e) {
      // Silent — don't disrupt the user
    }
  }, 300);
}

// Silently refresh data for the current screen without showing a loading spinner
async function _silentRefresh() {
  try {
    if (S.screen === 'dashboard') {
      const [announcements, groups] = await Promise.all([
        apiGet('/api/announcements'),
        apiGet('/api/groups')
      ]);
      S.announcements = announcements;
      S.groups = groups;
      rerenderDashboardProjects();
    } else if (S.screen === 'projects' && S.currentProjectId) {
      const project = await apiGet(`/api/projects/${S.currentProjectId}`);
      S.currentProject = project;
      rerenderTaskList();
    } else if (S.screen === 'projects') {
      S.groups = await apiGet('/api/groups');
      rerenderProjectFilters();
    } else if (S.screen === 'budget') {
      renderBudget();
    } else if (S.screen === 'admin') {
      renderAdmin();
    }
  } catch (e) {
    // Silent refresh failed — don't disrupt the user
  }
}

// Show/hide SSE disconnected indicator
function _showSSEDisconnected(show) {
  let el = document.getElementById('sse-disconnected');
  if (show && !el) {
    el = document.createElement('div');
    el.id = 'sse-disconnected';
    el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:var(--color-danger,#cc0000);color:#fff;text-align:center;padding:4px 8px;font-size:13px;z-index:301;';
    el.textContent = 'Connection lost — reconnecting\u2026';
    document.body.appendChild(el);
  } else if (!show && el) {
    el.remove();
  }
}

function connectSSE() {
  if (_eventSource) return;

  _eventSource = new EventSource('/api/events');

  _eventSource.onopen = () => {
    const wasDisconnected = S._sseConnected && _reconnectCount > 0;
    S._sseConnected = true;
    _reconnectCount = 0;
    _showSSEDisconnected(false);
    if (wasDisconnected) {
      // Reconnection — silently refresh data without blanking the page
      _silentRefresh();
    }
  };

  _eventSource.onerror = () => {
    _reconnectCount++;
    // After 10 consecutive failures, back off with exponential delay then retry
    if (_reconnectCount > 10) {
      _eventSource.close();
      _eventSource = null;
      S._sseConnected = false;
      const delay = Math.min(30000, 1000 * Math.pow(2, _reconnectCount - 10));
      console.warn(`SSE: reconnect backoff ${delay}ms (attempt ${_reconnectCount})`);
      _showSSEDisconnected(true);
      _backoffReconnectTimer = setTimeout(() => {
        _backoffReconnectTimer = null;
        connectSSE();
      }, delay);
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
    // Task counts changed — refresh groups silently and re-render cards
    _refreshGroupsAndRerender();
  }
}

function handleTaskDeleted(data) {
  if (S.currentProject && S.currentProjectId === data.projectId) {
    S.currentProject.tasks = (S.currentProject.tasks || []).filter(t => t.id !== data.taskId);
    rerenderTaskList();
  } else if (S.screen === 'dashboard' || S.screen === 'projects') {
    _refreshGroupsAndRerender();
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
    _refreshGroupsAndRerender();
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
    _refreshGroupsAndRerender();
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
  if (S.screen === 'dashboard') {
    _debouncedRender();
  }
}

function handleGroupMutation() {
  if (S.screen === 'admin') {
    _debouncedRender();
  } else if (S.screen === 'dashboard' || S.screen === 'projects') {
    _refreshGroupsAndRerender();
  }
}
