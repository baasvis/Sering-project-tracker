"use strict";
/* ========================================
   SSE — Real-time event handling
   SSE handlers ONLY update S — subscribers handle re-rendering.
   ======================================== */
var _eventSource = null;
var _reconnectCount = 0;
var _backoffReconnectTimer = null;
// Debounced groups refresh — fetches and sets S.groups, subscribers handle rendering
var _refreshGroupsTimer = null;
function _refreshGroups() {
    if (_refreshGroupsTimer)
        return;
    _refreshGroupsTimer = setTimeout(async () => {
        _refreshGroupsTimer = null;
        try {
            S.groups = await apiGet('/api/groups');
        }
        catch (e) {
            // Silent — don't disrupt the user
        }
    }, 300);
}
// Silently refresh state for the current screen (on SSE reconnect)
async function _silentRefresh() {
    try {
        if (S.screen === 'dashboard') {
            var [announcements, groups] = await Promise.all([
                apiGet('/api/announcements'),
                apiGet('/api/groups')
            ]);
            S.batch({ announcements, groups });
        }
        else if (S.screen === 'projects' && S.currentProjectId) {
            S.currentProject = await apiGet(`/api/projects/${S.currentProjectId}`);
        }
        else if (S.screen === 'projects') {
            S.groups = await apiGet('/api/groups');
        }
        else if (S.screen === 'budget') {
            S._shoppingUpdate = { projectId: null, ts: Date.now() };
        }
        else if (S.screen === 'admin') {
            S.groups = await apiGet('/api/groups');
        }
    }
    catch (e) {
        // Silent refresh failed — don't disrupt the user
    }
}
// Show/hide SSE disconnected indicator
function _showSSEDisconnected(show) {
    var el = document.getElementById('sse-disconnected');
    if (show && !el) {
        el = document.createElement('div');
        el.id = 'sse-disconnected';
        el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:var(--color-danger,#cc0000);color:#fff;text-align:center;padding:4px 8px;font-size:13px;z-index:301;';
        el.textContent = 'Connection lost \u2014 reconnecting\u2026';
        document.body.appendChild(el);
    }
    else if (!show && el) {
        el.remove();
    }
}
function connectSSE() {
    if (_eventSource)
        return;
    _eventSource = new EventSource('/api/events');
    _eventSource.onopen = () => {
        var wasDisconnected = S._sseConnected && _reconnectCount > 0;
        S._sseConnected = true;
        _reconnectCount = 0;
        _showSSEDisconnected(false);
        if (wasDisconnected) {
            _silentRefresh();
        }
    };
    _eventSource.onerror = () => {
        _reconnectCount++;
        if (_reconnectCount > 10) {
            _eventSource.close();
            _eventSource = null;
            S._sseConnected = false;
            var delay = Math.min(30000, 1000 * Math.pow(2, _reconnectCount - 10));
            console.warn(`SSE: reconnect backoff ${delay}ms (attempt ${_reconnectCount})`);
            _showSSEDisconnected(true);
            _backoffReconnectTimer = setTimeout(() => {
                _backoffReconnectTimer = null;
                connectSSE();
            }, delay);
        }
    };
    // Register all event handlers
    var events = [
        'task:created', 'task:updated', 'task:approved', 'task:deleted',
        'project:created', 'project:updated', 'project:approved', 'project:deleted',
        'shopping:created', 'shopping:updated', 'shopping:approved', 'shopping:deleted',
        'tool:created', 'tool:updated', 'tool:approved', 'tool:deleted',
        'comment:created', 'comment:deleted',
        'announcement:created', 'announcement:updated', 'announcement:deleted',
        'group:created', 'group:updated', 'group:deleted',
    ];
    for (var evt of events) {
        _eventSource.addEventListener(evt, (e) => {
            var data;
            try {
                data = JSON.parse(e.data);
            }
            catch {
                return;
            }
            // Self-dedup: skip events from our own mutations
            if (data._mutationId && S._pendingMutationIds.has(data._mutationId)) {
                S._pendingMutationIds.delete(data._mutationId);
                return;
            }
            var handler = SSE_HANDLERS[evt];
            if (handler)
                handler(data);
        });
    }
}
// ---- Event handlers (update S only — subscribers handle rendering) ----
var SSE_HANDLERS = {
    'task:created': handleTaskMutation,
    'task:updated': handleTaskMutation,
    'task:approved': handleTaskMutation,
    'task:deleted': handleTaskDeleted,
    'project:created': handleProjectMutation,
    'project:updated': handleProjectMutation,
    'project:approved': handleProjectMutation,
    'project:deleted': handleProjectDeleted,
    'shopping:created': handleShoppingMutation,
    'shopping:updated': handleShoppingMutation,
    'shopping:approved': handleShoppingMutation,
    'shopping:deleted': handleShoppingMutation,
    'tool:created': handleToolMutation,
    'tool:updated': handleToolMutation,
    'tool:approved': handleToolMutation,
    'tool:deleted': handleToolMutation,
    'comment:created': handleCommentCreated,
    'comment:deleted': handleCommentDeleted,
    'announcement:created': handleAnnouncementMutation,
    'announcement:updated': handleAnnouncementMutation,
    'announcement:deleted': handleAnnouncementMutation,
    'group:created': handleGroupMutation,
    'group:updated': handleGroupMutation,
    'group:deleted': handleGroupMutation,
};
function handleTaskMutation(data) {
    var task = data.task;
    if (!task)
        return;
    if (S.currentProject && S.currentProjectId === task.projectId) {
        var tasks = [...(S.currentProject.tasks || [])];
        var idx = tasks.findIndex((t) => t.id === task.id);
        if (idx !== -1) {
            tasks[idx] = { ...tasks[idx], ...task };
        }
        else {
            tasks.push(task);
        }
        S.currentProject = { ...S.currentProject, tasks };
    }
    // Task counts changed — refresh groups for dashboard/projects
    _refreshGroups();
}
function handleTaskDeleted(data) {
    if (S.currentProject && S.currentProjectId === data.projectId) {
        var tasks = (S.currentProject.tasks || []).filter((t) => t.id !== data.taskId);
        S.currentProject = { ...S.currentProject, tasks };
    }
    _refreshGroups();
}
function handleProjectMutation(data) {
    var project = data.project;
    if (!project)
        return;
    if (S.currentProjectId === project.id && S.currentProject) {
        var { tasks, ...rest } = project;
        S.currentProject = { ...S.currentProject, ...rest };
    }
    _refreshGroups();
}
function handleProjectDeleted(data) {
    if (S.currentProjectId === data.projectId) {
        S.currentProjectId = null;
        S.currentProject = null;
        window.location.hash = 'projects';
        toast('This project was deleted', 'info');
    }
    _refreshGroups();
}
function handleShoppingMutation(data) {
    var projectId = data.item?.projectId || data.projectId;
    if (!projectId)
        return;
    S._shoppingUpdate = { projectId, ts: Date.now() };
}
function handleToolMutation(data) {
    var projectId = data.item?.projectId || data.projectId;
    if (!projectId)
        return;
    S._toolsUpdate = { projectId, ts: Date.now() };
}
function handleCommentCreated(data) {
    var comment = data.comment;
    if (!comment)
        return;
    S._commentUpdate = { action: 'created', targetType: comment.targetType, targetId: comment.targetId, ts: Date.now() };
}
function handleCommentDeleted(data) {
    S._commentUpdate = {
        action: 'deleted',
        commentId: data.commentId,
        targetType: data.targetType,
        targetId: data.targetId,
        ts: Date.now()
    };
}
function handleAnnouncementMutation() {
    apiGet('/api/announcements').then((announcements) => {
        S.announcements = announcements;
    }).catch(() => { });
}
function handleGroupMutation() {
    _refreshGroups();
}
