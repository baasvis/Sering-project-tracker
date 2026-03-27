/* ========================================
   Comments — Thread rendering + posting
   ======================================== */

// Render a comment section for any target
async function renderComments(targetType, targetId, container) {
  let comments = [];
  try {
    comments = await apiGet(`/api/comments?targetType=${targetType}&targetId=${targetId}`);
  } catch (err) {
    container.innerHTML = '<p class="text-muted">Could not load comments.</p>';
    return;
  }

  const authorName = S.isAdmin ? (S.adminEmail || 'Admin') : S.visitorName;

  container.innerHTML = `
    <div class="comments-section">
      <h3>Comments (${comments.length})</h3>
      <div class="comment-list">
        ${comments.length === 0 ? '<p class="text-muted text-sm">No comments yet. Be the first!</p>' : ''}
        ${comments.map(c => renderComment(c)).join('')}
      </div>
      <div class="comment-form">
        <textarea id="comment-input-${targetId}" placeholder="Write a comment..." rows="2"></textarea>
        <div class="comment-form-actions">
          <button class="btn btn-primary"
                  onclick="postComment('${targetType}', '${targetId}')">Send</button>
        </div>
      </div>
    </div>`;
}

function renderComment(c) {
  const initial = (c.authorName || '?')[0].toUpperCase();
  const canDelete = S.isAdmin;

  return `<div class="comment" data-id="${c.id}">
    <div class="comment-avatar">${initial}</div>
    <div class="comment-content">
      <div class="comment-header">
        <span class="comment-author">${esc(c.authorName)}</span>
        <span class="comment-time">${timeAgo(c.createdAt)}</span>
        ${canDelete ? `<button class="comment-delete" onclick="deleteComment('${c.id}')">delete</button>` : ''}
      </div>
      ${c.body ? `<div class="comment-body">${esc(c.body)}</div>` : ''}
      ${renderMediaItems(c.media || [])}
    </div>
  </div>`;
}

async function postComment(targetType, targetId) {
  return withDedup(`postComment-${targetId}`, async () => {
    const input = document.getElementById(`comment-input-${targetId}`);
    const body = input.value.trim();
    if (!body) return;

    const authorName = S.isAdmin ? (S.adminEmail || 'Admin') : S.visitorName;
    if (!authorName) {
      toast('Please enter your name first', 'error');
      return;
    }

    try {
      await apiPost('/api/comments', { targetType, targetId, authorName, body });
      input.value = '';
      // Re-render comments
      const container = input.closest('.comments-section').parentElement;
      await renderComments(targetType, targetId, container);
      toast('Comment posted', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function deleteComment(id) {
  if (!confirm('Delete this comment?')) return;
  try {
    await apiDelete(`/api/comments/${id}`);
    document.querySelector(`.comment[data-id="${id}"]`)?.remove();
    toast('Comment deleted');
  } catch (err) {
    toast(err.message, 'error');
  }
}
