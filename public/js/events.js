"use strict";
/* ========================================
   Events — Central event delegation
   Replaces all inline onclick="" handlers
   to allow strict CSP (no unsafe-inline)
   ======================================== */
// All action handlers registered here. Each key is a data-action value.
var ACTION_HANDLERS = {};
// Register an action handler
function onAction(name, handler) {
    ACTION_HANDLERS[name] = handler;
}
// Central click delegation — catches all clicks on [data-action] elements
document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el)
        return;
    const action = el.dataset.action;
    const handler = ACTION_HANDLERS[action];
    if (!handler)
        return;
    // Stop propagation if the element requests it
    if (el.dataset.stop !== undefined)
        e.stopPropagation();
    handler(el, e);
});
// Central change delegation — for file inputs
document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-on-change]');
    if (!el)
        return;
    const handler = ACTION_HANDLERS[el.dataset.onChange];
    if (handler)
        handler(el, e);
});
