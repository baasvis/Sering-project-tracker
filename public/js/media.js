/* ========================================
   Media — Photo upload, voice recorder, display
   ======================================== */

// Render media items (photos + voice notes)
function renderMediaItems(mediaList) {
  if (!mediaList || mediaList.length === 0) return '';

  return `<div class="media-grid">${mediaList.map(m => {
    if (m.type === 'photo') {
      return `<img src="/api/media/${m.id}/file" class="media-thumb"
                onclick="openLightbox('/api/media/${m.id}/file')"
                alt="${esc(m.originalName)}">`;
    }
    if (m.type === 'voice') {
      return `<div class="voice-note">
        <button class="voice-note-btn" onclick="playVoice(this, '/api/media/${m.id}/file')">&#9654;</button>
        <span class="voice-note-duration">${esc(m.originalName)}</span>
      </div>`;
    }
    return '';
  }).join('')}</div>`;
}

// Render upload buttons (photo + voice)
function renderMediaUploadButtons(parentType, parentId) {
  return `<div class="media-upload-area">
    <label class="media-upload-btn">
      &#128247; Photo
      <input type="file" accept="image/*" style="display:none"
             onchange="uploadPhoto(this, '${parentType}', '${parentId}')">
    </label>
    <button class="media-upload-btn" onclick="toggleVoiceRecorder(this, '${parentType}', '${parentId}')">
      &#127908; Voice
    </button>
  </div>`;
}

// Get uploader identity
function getUploaderName() {
  return S.isAdmin ? (S.adminEmail || 'Admin') : S.visitorName;
}

// Upload a photo
async function uploadPhoto(input, parentType, parentId) {
  const file = input.files[0];
  if (!file) return;

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
    await apiUpload('/api/media', formData);
    toast('Photo uploaded', 'success');
    renderCurrentScreen();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Voice recording
let activeRecorder = null;
let recordingChunks = [];

function toggleVoiceRecorder(btn, parentType, parentId) {
  if (activeRecorder && activeRecorder.state === 'recording') {
    activeRecorder.stop();
    btn.textContent = '🎤 Voice';
    return;
  }

  if (!getUploaderName()) {
    toast('Please enter your name first', 'error');
    return;
  }

  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const recorder = new MediaRecorder(stream);
    activeRecorder = recorder;
    recordingChunks = [];

    recorder.ondataavailable = e => { if (e.data.size > 0) recordingChunks.push(e.data); };

    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(recordingChunks, { type: 'audio/webm' });
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
        await apiUpload('/api/media', formData);
        toast('Voice note uploaded', 'success');
        renderCurrentScreen();
      } catch (err) {
        toast(err.message, 'error');
      }
      activeRecorder = null;
    };

    recorder.start();
    btn.textContent = '⏹ Stop';
    btn.classList.add('recording');

    // Auto-stop after 60 seconds (keeps voice notes under 2MB limit)
    setTimeout(() => {
      if (recorder.state === 'recording') {
        recorder.stop();
        btn.textContent = '🎤 Voice';
      }
    }, 60000);
  }).catch(() => {
    toast('Microphone access denied', 'error');
  });
}

// Play voice note
function playVoice(btn, url) {
  const audio = new Audio(url);
  btn.textContent = '⏸';
  audio.play();
  audio.onended = () => { btn.innerHTML = '&#9654;'; };
}

// Lightbox for images
function openLightbox(src) {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `<img src="${src}">`;
  lb.onclick = () => lb.remove();
  document.body.appendChild(lb);
}
