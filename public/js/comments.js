"use strict";
/* ========================================
   Comments — Thread rendering + posting
   ======================================== */
// Render a comment section for any target
async function renderComments(targetType, targetId, container) {
    let comments = [];
    try {
        comments = await apiGet(`/api/comments?targetType=${targetType}&targetId=${targetId}`);
    }
    catch (err) {
        container.innerHTML = '<p class="text-muted">Could not load comments.</p>';
        return;
    }
    const authorName = S.isAdmin ? (S.adminEmail || 'Admin') : S.visitorName;
    container.innerHTML = html `
    <div class="comments-section">
      <h3>Comments (${String(comments.length)})</h3>
      <div class="comment-list">
        ${raw(comments.length === 0 ? '<p class="text-muted text-sm">No comments yet. Be the first!</p>' : '')}
        ${raw(comments.map((c) => renderComment(c)).join(''))}
      </div>
      <div class="comment-form">
        <textarea id="comment-input-${targetId}" placeholder="Write a comment..." rows="2"></textarea>
        <div class="comment-form-actions">
          <button class="btn btn-primary"
                  data-action="postComment" data-target-type="${targetType}" data-id="${targetId}">Send</button>
        </div>
      </div>
    </div>`;
}
function renderComment(c) {
    const initial = (c.authorName || '?')[0].toUpperCase();
    const canDelete = S.isAdmin;
    return html `<div class="comment" data-id="${c.id}">
    <div class="comment-avatar">${initial}</div>
    <div class="comment-content">
      <div class="comment-header">
        <span class="comment-author">${c.authorName}</span>
        <span class="comment-time">${timeAgo(c.createdAt)}</span>
        ${raw(canDelete ? html `<button class="comment-delete" data-action="deleteComment" data-id="${c.id}">delete</button>` : '')}
      </div>
      ${raw(c.body ? html `<div class="comment-body">${c.body}</div>` : '')}
      ${raw(renderMediaItems(c.media || []))}
    </div>
  </div>`;
}
async function postComment(targetType, targetId) {
    return withDedup(`postComment-${targetId}`, async () => {
        // Extract value as a plain string before the await — do not hold DOM refs across async boundaries.
        const inputEl = document.getElementById(`comment-input-${targetId}`);
        const body = inputEl ? inputEl.value.trim() : '';
        if (!body)
            return;
        const authorName = S.isAdmin ? (S.adminEmail || 'Admin') : S.visitorName;
        if (!authorName) {
            toast('Please enter your name first', 'error');
            return;
        }
        try {
            const created = await apiPost('/api/comments', { targetType, targetId, authorName, body });
            // Re-query the input fresh after the await — the prior reference may be detached
            // if an SSE event triggered a re-render during the network round-trip.
            const freshInput = document.getElementById(`comment-input-${targetId}`);
            if (freshInput)
                freshInput.value = '';
            const commentList = freshInput
                ? freshInput.closest('.comments-section')?.querySelector('.comment-list')
                : null;
            if (commentList) {
                // Remove the "No comments yet" placeholder if present.
                commentList.querySelector('p.text-muted')?.remove();
                // Immediately append the new comment using the server response — no extra fetch needed.
                commentList.insertAdjacentHTML('beforeend', renderComment({ ...created, media: created.media || [] }));
                // Update the "Comments (N)" heading.
                const heading = commentList.closest('.comments-section')?.querySelector('h3');
                if (heading) {
                    const current = parseInt(heading.textContent.replace(/\D/g, ''), 10) || 0;
                    heading.textContent = `Comments (${current + 1})`;
                }
            }
            // If commentList is null, the container was replaced by an unrelated SSE re-render
            // while we were awaiting. That re-render fetched server data which already includes
            // the committed comment, so it is already visible.
            toast('Comment posted', 'success');
        }
        catch (err) {
            toast(err.message, 'error');
        }
    });
}
async function deleteComment(id) {
    if (!confirm('Delete this comment?'))
        return;
    try {
        await apiDelete(`/api/comments/${id}`);
        document.querySelector(`.comment[data-id="${id}"]`)?.remove();
        toast('Comment deleted');
    }
    catch (err) {
        toast(err.message, 'error');
    }
}
// --- Action registrations ---
onAction('postComment', (el) => postComment(el.dataset.targetType, el.dataset.id));
onAction('deleteComment', (el) => deleteComment(el.dataset.id));
// ---- Reactive subscriptions ----
S.subscribe('_commentUpdate', (update) => {
    if (!update)
        return;
    // Optimized path: remove a single comment DOM node if visible
    if (update.action === 'deleted' && update.commentId) {
        const el = document.querySelector(`.comment[data-id="${update.commentId}"]`);
        if (el) {
            el.remove();
            return;
        }
    }
    // Reload full comment section if target is visible
    if (update.targetType === 'project' && S.currentProjectId === update.targetId) {
        const container = document.getElementById('project-comments');
        if (container)
            renderComments('project', update.targetId, container);
    }
    if (update.targetType === 'task') {
        const container = document.getElementById(`task-comments-${update.targetId}`);
        if (container)
            renderComments('task', update.targetId, container);
    }
    if (update.targetType === 'announcement' && S.currentAnnouncementId === update.targetId) {
        const container = document.getElementById('announcement-comments');
        if (container)
            renderComments('announcement', update.targetId, container);
    }
});
