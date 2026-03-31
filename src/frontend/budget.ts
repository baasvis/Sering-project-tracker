/* ========================================
   Budget — Overview of all project costs
   ======================================== */

async function renderBudget(): Promise<void> {
  var app = document.getElementById('app')!;

  // Snapshot which foldouts are open before the re-render wipes the DOM
  const openFoldouts = new Set<string>();
  app.querySelectorAll('.budget-foldout').forEach(el => {
    if ((el as HTMLElement).style.display !== 'none') {
      openFoldouts.add(el.id.replace('foldout-', ''));
    }
  });

  app.innerHTML = '<div class="loading-spinner">Loading budget\u2026</div>';

  var summary: any[];
  try {
    summary = await apiGet('/api/shopping/summary');
  } catch (err: any) {
    app.innerHTML = html`<p class="text-muted">Could not load budget: ${err.message}</p>`;
    return;
  }

  var grandTotal = summary.reduce((sum: number, p: any) => sum + p.total, 0);
  var grandSpent = summary.reduce((sum: number, p: any) => sum + p.spent, 0);
  var grandRemaining = summary.reduce((sum: number, p: any) => sum + p.remaining, 0);

  app.innerHTML = html`
    <div class="budget-page">
      <div class="flex-between mb-lg">
        <h1>Budget</h1>
        <div class="budget-grand-total">
          <div class="budget-summary-line"><span class="text-muted">Total:</span> <span class="budget-grand-total-value">${raw(formatEuro(grandTotal))}</span></div>
          <div class="budget-summary-line"><span class="text-muted">Spent:</span> <span class="budget-spent-value">${raw(formatEuro(grandSpent))}</span></div>
          <div class="budget-summary-line"><span class="text-muted">Remaining:</span> <span class="budget-remaining-value">${raw(formatEuro(grandRemaining))}</span></div>
        </div>
      </div>

      ${raw(summary.length === 0
        ? '<div class="empty-state"><h3>No costs tracked yet</h3><p>Add items to a project\'s shopping list to see them here.</p></div>'
        : html`<div class="budget-projects">
          ${raw(summary.map((p: any) => html`
            <div class="budget-project" id="budget-project-${p.id}">
              <div class="budget-project-header" data-action="toggleBudgetFoldout" data-id="${p.id}">
                <div class="budget-project-info">
                  <span class="budget-project-name">${p.name}</span>
                  <span class="tag tag-group">${p.groupName}</span>
                  <span class="text-muted text-sm">${p.itemCount} item${raw(p.itemCount !== 1 ? 's' : '')}</span>
                </div>
                <div class="budget-project-total">
                  <div class="budget-project-totals-grid">
                    <span class="text-muted text-sm">Total:</span> <span>${raw(formatEuro(p.total))}</span>
                    <span class="text-muted text-sm">Spent:</span> <span>${raw(formatEuro(p.spent))}</span>
                    <span class="text-muted text-sm">Remaining:</span> <span>${raw(formatEuro(p.remaining))}</span>
                  </div>
                  <span class="budget-chevron" id="chevron-${p.id}">&#9654;</span>
                </div>
              </div>
              <div class="budget-foldout" id="foldout-${p.id}" style="display:none">
                ${raw(renderShoppingSection(p.items, p.id, { compact: true }))}
              </div>
            </div>
          `).join(''))}
        </div>`)}
    </div>`;

  // Restore previously open foldouts after DOM replacement
  openFoldouts.forEach(projectId => {
    const foldout = document.getElementById(`foldout-${projectId}`);
    const chevron = document.getElementById(`chevron-${projectId}`);
    if (foldout) foldout.style.display = 'block';
    if (chevron) chevron.innerHTML = '&#9660;';
  });
}

function toggleBudgetFoldout(projectId: string): void {
  var foldout = document.getElementById(`foldout-${projectId}`);
  var chevron = document.getElementById(`chevron-${projectId}`);
  if (!foldout) return;

  var isOpen = foldout.style.display !== 'none';
  foldout.style.display = isOpen ? 'none' : 'block';
  if (chevron) {
    chevron.innerHTML = isOpen ? '&#9654;' : '&#9660;';
  }
}

// ---- onAction registrations ----
onAction('toggleBudgetFoldout', (el: HTMLElement) => toggleBudgetFoldout(el.dataset.id!));

// ---- Reactive subscriptions ----

S.subscribe('_shoppingUpdate', () => {
  if (S.screen !== 'budget') return;
  renderBudget();
});
