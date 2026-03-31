"use strict";
/* ========================================
   Media — Photo upload, voice recorder, display
   ======================================== */
// Render media items (photos + voice notes)
function renderMediaItems(mediaList) {
    if (!mediaList || mediaList.length === 0)
        return '';
    return html `<div class="media-grid">${raw(mediaList.map((m) => {
        const deleteBtn = S.isAdmin
            ? html `<button class="media-delete-btn" data-action="deleteMedia" data-id="${m.id}" data-stop title="Delete">${raw('&#10005;')}</button>`
            : '';
        if (m.type === 'photo') {
            return html `<div class="media-item">
        <img src="/api/media/${m.id}/file" class="media-thumb" loading="lazy"
              data-action="openLightbox" data-src="/api/media/${m.id}/file"
              alt="${m.originalName}">
        ${raw(deleteBtn)}
      </div>`;
        }
        if (m.type === 'voice') {
            return html `<div class="media-item">
        <div class="voice-note">
          <button class="voice-note-btn" data-action="playVoice" data-src="/api/media/${m.id}/file">${raw('&#9654;')}</button>
          <span class="voice-note-duration">${m.originalName}</span>
        </div>
        ${raw(deleteBtn)}
      </div>`;
        }
        return '';
    }).join(''))}</div>`;
}
// Render upload buttons (photo + voice)
function renderMediaUploadButtons(parentType, parentId) {
    return html `<div class="media-upload-area">
    <label class="media-upload-btn">
      ${raw('&#128247;')} Photo
      <input type="file" accept="image/*" style="display:none"
             data-on-change="uploadPhoto" data-parent-type="${parentType}" data-parent-id="${parentId}">
    </label>
    <button class="media-upload-btn" data-action="toggleVoiceRecorder" data-parent-type="${parentType}" data-parent-id="${parentId}">
      ${raw('&#127908;')} Voice
    </button>
  </div>`;
}
// Get uploader identity
function getUploaderName() {
    return S.isAdmin ? (S.adminEmail || 'Admin') : S.visitorName;
}
// Upload a photo
async function uploadPhoto(input, parentType, parentId) {
    const file = input.files?.[0];
    if (!file)
        return;
    if (!getUploaderName()) {
        toast('Please enter your name first', 'error');
        return;
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('parentType', parentType);
    formData.append('parentId', parentId);
    formData.append('uploaderName', getUploaderName());
    try {
        const newMedia = await apiUpload('/api/media', formData);
        toast('Photo uploaded', 'success');
        // Append to nearest media grid instead of full re-render
        const uploadArea = input.closest('.media-upload-area');
        if (uploadArea) {
            let grid = uploadArea.previousElementSibling;
            if (!grid || !grid.classList.contains('media-grid')) {
                grid = document.createElement('div');
                grid.className = 'media-grid';
                uploadArea.parentNode.insertBefore(grid, uploadArea);
            }
            grid.insertAdjacentHTML('beforeend', html `<img src="/api/media/${newMedia.id}/file" class="media-thumb"
              data-action="openLightbox" data-src="/api/media/${newMedia.id}/file"
              alt="${newMedia.originalName}">`);
        }
    }
    catch (err) {
        toast(err.message, 'error');
    }
}
// Voice recording — single recorder instance, properly cleaned up
var activeRecorder = null;
var recordingChunks = [];
var recordingTimeout = null;
function stopActiveRecorder() {
    if (recordingTimeout) {
        clearTimeout(recordingTimeout);
        recordingTimeout = null;
    }
    if (activeRecorder && activeRecorder.state === 'recording') {
        activeRecorder.stop();
    }
    activeRecorder = null;
}
function toggleVoiceRecorder(btn, parentType, parentId) {
    if (activeRecorder && activeRecorder.state === 'recording') {
        activeRecorder.stop();
        btn.textContent = '\uD83C\uDF99 Voice';
        btn.classList.remove('recording');
        return;
    }
    if (!getUploaderName()) {
        toast('Please enter your name first', 'error');
        return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast('Microphone not supported in this browser', 'error');
        return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        // Clean up any previous recorder
        stopActiveRecorder();
        const recorder = new MediaRecorder(stream);
        activeRecorder = recorder;
        recordingChunks = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0)
            recordingChunks.push(e.data); };
        recorder.onstop = async () => {
            stream.getTracks().forEach(t => t.stop());
            btn.textContent = '\uD83C\uDF99 Voice';
            btn.classList.remove('recording');
            const blob = new Blob(recordingChunks, { type: 'audio/webm' });
            recordingChunks = [];
            if (blob.size > 2 * 1024 * 1024) {
                toast('Voice note too long (max ~60 seconds)', 'error');
                activeRecorder = null;
                return;
            }
            const formData = new FormData();
            formData.append('file', blob, 'voice-note.webm');
            formData.append('parentType', parentType);
            formData.append('parentId', parentId);
            formData.append('uploaderName', getUploaderName());
            try {
                const newMedia = await apiUpload('/api/media', formData);
                toast('Voice note uploaded', 'success');
                const uploadArea = btn.closest('.media-upload-area');
                if (uploadArea) {
                    let grid = uploadArea.previousElementSibling;
                    if (!grid || !grid.classList.contains('media-grid')) {
                        grid = document.createElement('div');
                        grid.className = 'media-grid';
                        uploadArea.parentNode.insertBefore(grid, uploadArea);
                    }
                    grid.insertAdjacentHTML('beforeend', html `<div class="voice-note">
              <button class="voice-note-btn" data-action="playVoice" data-src="/api/media/${newMedia.id}/file">${raw('&#9654;')}</button>
              <span class="voice-note-duration">${newMedia.originalName}</span>
            </div>`);
                }
            }
            catch (err) {
                toast(err.message, 'error');
            }
            activeRecorder = null;
        };
        recorder.start();
        btn.textContent = '\u23F9 Stop';
        btn.classList.add('recording');
        // Auto-stop after 60 seconds
        recordingTimeout = setTimeout(() => {
            if (recorder.state === 'recording')
                recorder.stop();
        }, 60000);
    }).catch(() => {
        toast('Microphone access denied', 'error');
    });
}
// Play voice note — track single active audio to prevent overlapping playback
var _activeAudio = null;
var _activeAudioBtn = null;
function playVoice(btn, url) {
    // If same button clicked again, toggle pause/resume
    if (_activeAudio && _activeAudioBtn === btn) {
        if (_activeAudio.paused) {
            _activeAudio.play();
            btn.textContent = '\u23f8';
        }
        else {
            _activeAudio.pause();
            btn.innerHTML = '&#9654;';
        }
        return;
    }
    // Stop any currently playing audio
    if (_activeAudio) {
        _activeAudio.pause();
        _activeAudio.src = '';
        if (_activeAudioBtn)
            _activeAudioBtn.innerHTML = '&#9654;';
    }
    const audio = new Audio(url);
    _activeAudio = audio;
    _activeAudioBtn = btn;
    btn.textContent = '\u23f8';
    audio.play();
    audio.onended = () => {
        btn.innerHTML = '&#9654;';
        _activeAudio = null;
        _activeAudioBtn = null;
    };
    audio.onerror = () => {
        btn.innerHTML = '&#9654;';
        _activeAudio = null;
        _activeAudioBtn = null;
    };
}
// Delete media (admin only)
async function deleteMedia(id) {
    if (!confirm('Delete this file?'))
        return;
    try {
        await apiDelete(`/api/media/${id}`);
        toast('File deleted', 'success');
        renderCurrentScreen();
    }
    catch (err) {
        toast(err.message, 'error');
    }
}
// Lightbox for images
function openLightbox(src) {
    _modalTriggerEl = document.activeElement;
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', 'Image lightbox');
    lb.tabIndex = 0;
    lb.innerHTML = html `<img src="${src}" alt="Enlarged image">`;
    lb.onclick = () => { lb.remove(); if (_modalTriggerEl) {
        _modalTriggerEl.focus();
        _modalTriggerEl = null;
    } };
    document.body.appendChild(lb);
    lb.focus();
}
// --- onAction registrations ---
onAction('deleteMedia', (el) => deleteMedia(el.dataset.id));
onAction('openLightbox', (el) => openLightbox(el.dataset.src));
onAction('playVoice', (el) => playVoice(el, el.dataset.src));
onAction('toggleVoiceRecorder', (el) => toggleVoiceRecorder(el, el.dataset.parentType, el.dataset.parentId));
onAction('uploadPhoto', (el) => uploadPhoto(el, el.dataset.parentType, el.dataset.parentId));
