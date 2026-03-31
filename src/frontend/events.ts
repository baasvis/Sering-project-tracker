/* ========================================
   Events — Central event delegation
   Replaces all inline onclick="" handlers
   to allow strict CSP (no unsafe-inline)
   ======================================== */

// All action handlers registered here. Each key is a data-action value.
var ACTION_HANDLERS: Record<string, (el: HTMLElement, e: Event) => void> = {};

// Register an action handler
function onAction(name: string, handler: (el: HTMLElement, e: Event) => void): void {
  ACTION_HANDLERS[name] = handler;
}

// Central click delegation — catches all clicks on [data-action] elements
document.addEventListener('click', (e: MouseEvent) => {
  const el = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
  if (!el) return;

  const action = el.dataset.action!;
  const handler = ACTION_HANDLERS[action];
  if (!handler) return;

  // Stop propagation if the element requests it
  if (el.dataset.stop !== undefined) e.stopPropagation();

  handler(el, e);
});

// Central change delegation — for file inputs
document.addEventListener('change', (e: Event) => {
  const el = (e.target as HTMLElement).closest('[data-on-change]') as HTMLElement | null;
  if (!el) return;
  const handler = ACTION_HANDLERS[el.dataset.onChange!];
  if (handler) handler(el, e);
});
