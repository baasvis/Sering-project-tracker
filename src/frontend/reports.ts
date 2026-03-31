/* ========================================
   Reports — Problem/comment report button
   ======================================== */

// Insert floating report button into the DOM
function initReportButton(): void {
  if (document.getElementById('report-fab')) return;
  var btn = document.createElement('button');
  btn.id = 'report-fab';
  btn.className = 'report-fab';
  btn.title = 'Report a problem';
  btn.textContent = '!';
  btn.addEventListener('click', showReportModal);
  document.body.appendChild(btn);
}

async function showReportModal(): Promise<void> {
  var backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = html`<div class="modal report-modal">
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
      <button class="btn btn-secondary" data-action="closeModal">Cancel</button>
      <button class="btn btn-primary" id="report-submit-btn" data-action="submitReport" disabled>Send Report</button>
    </div>
  </div>`;
  backdrop.addEventListener('click', (e: Event) => { if (e.target === backdrop) closeModal(backdrop); });
  openModal(backdrop, 'Report a Problem');

  // Focus the textarea
  (document.getElementById('report-description') as HTMLTextAreaElement).focus();

  // Capture screenshot (hide the modal while capturing)
  var modal = backdrop.querySelector('.modal') as HTMLElement;
  modal.style.visibility = 'hidden';
  backdrop.style.background = 'transparent';

  try {
    var canvas = await html2canvas(document.body, {
      scale: 0.7,
      useCORS: true,
      logging: false,
      ignoreElements: (el: HTMLElement) => el.classList.contains('modal-backdrop') || el.id === 'toast-container'
    });
    (window as any)._reportScreenshot = canvas.toDataURL('image/jpeg', 0.6);

    var preview = document.getElementById('report-screenshot-preview');
    if (preview) {
      preview.innerHTML = html`<img src="${safeDataImageSrc((window as any)._reportScreenshot)}" alt="Screenshot preview">`;
    }
  } catch (err: any) {
    console.warn('Screenshot capture failed:', err);
    (window as any)._reportScreenshot = null;
    var preview = document.getElementById('report-screenshot-preview');
    if (preview) {
      preview.innerHTML = '<span class="text-muted text-sm">Screenshot capture failed — report will be sent without it.</span>';
    }
  }

  modal.style.visibility = '';
  backdrop.style.background = '';
  (document.getElementById('report-submit-btn') as HTMLButtonElement).disabled = false;
}

async function submitReport(): Promise<void> {
  var description = (document.getElementById('report-description') as HTMLTextAreaElement).value.trim();
  if (!description) return toast('Please describe the problem', 'error');

  var reporterName = S.isAdmin ? (S.adminEmail || 'Admin') : S.visitorName;
  if (!reporterName) return toast('Please set your name first', 'error');

  var btn = document.getElementById('report-submit-btn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    await apiPost('/api/reports', {
      description,
      screenshotData: (window as any)._reportScreenshot || null,
      reporterName,
      currentPage: window.location.hash || '#dashboard'
    });

    { var bd = document.querySelector('.modal-backdrop') as HTMLElement | null; if (bd) closeModal(bd); }
    (window as any)._reportScreenshot = null;
    toast('Report sent — thank you!', 'success');
  } catch (err: any) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Send Report';
  }
}

// ---- onAction registrations ----
onAction('submitReport', () => submitReport());
