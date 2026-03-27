/* ========================================
   Reports — Problem/comment report button
   ======================================== */

// Insert floating report button into the DOM
function initReportButton() {
  if (document.getElementById('report-fab')) return;
  const btn = document.createElement('button');
  btn.id = 'report-fab';
  btn.className = 'report-fab';
  btn.title = 'Report a problem';
  btn.textContent = '!';
  btn.addEventListener('click', showReportModal);
  document.body.appendChild(btn);
}

async function showReportModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal report-modal">
    <h2>Report a Problem</h2>
    <p class="text-muted text-sm">Describe the issue and a screenshot of the current page will be attached automatically.</p>
    <div class="form-group">
      <label>What went wrong?</label>
      <textarea id="report-description" rows="4" maxlength="2000" placeholder="Describe the problem you're experiencing..."></textarea>
    </div>
    <div class="form-group">
      <label>Screenshot preview</label>
      <div id="report-screenshot-preview" class="report-screenshot-preview">
        <div class="loading-spinner"></div>
        <span class="text-muted text-sm">Capturing screenshot...</span>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
      <button class="btn btn-primary" id="report-submit-btn" onclick="submitReport()" disabled>Send Report</button>
    </div>
  </div>`;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);

  // Focus the textarea
  document.getElementById('report-description').focus();

  // Capture screenshot (hide the modal while capturing)
  const modal = backdrop.querySelector('.modal');
  modal.style.visibility = 'hidden';
  backdrop.style.background = 'transparent';

  try {
    const canvas = await html2canvas(document.body, {
      scale: 0.7,
      useCORS: true,
      logging: false,
      ignoreElements: el => el.classList.contains('modal-backdrop') || el.id === 'toast-container'
    });
    window._reportScreenshot = canvas.toDataURL('image/jpeg', 0.6);

    const preview = document.getElementById('report-screenshot-preview');
    if (preview) {
      preview.innerHTML = `<img src="${window._reportScreenshot}" alt="Screenshot preview">`;
    }
  } catch (err) {
    console.warn('Screenshot capture failed:', err);
    window._reportScreenshot = null;
    const preview = document.getElementById('report-screenshot-preview');
    if (preview) {
      preview.innerHTML = '<span class="text-muted text-sm">Screenshot capture failed — report will be sent without it.</span>';
    }
  }

  modal.style.visibility = '';
  backdrop.style.background = '';
  document.getElementById('report-submit-btn').disabled = false;
}

async function submitReport() {
  const description = document.getElementById('report-description').value.trim();
  if (!description) return toast('Please describe the problem', 'error');

  const reporterName = S.isAdmin ? (S.adminEmail || 'Admin') : S.visitorName;
  if (!reporterName) return toast('Please set your name first', 'error');

  const btn = document.getElementById('report-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    await apiPost('/api/reports', {
      description,
      screenshotData: window._reportScreenshot || null,
      reporterName,
      currentPage: window.location.hash || '#dashboard'
    });

    document.querySelector('.modal-backdrop')?.remove();
    window._reportScreenshot = null;
    toast('Report sent — thank you!', 'success');
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Send Report';
  }
}
