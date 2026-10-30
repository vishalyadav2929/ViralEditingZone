// CapCut-style shell — PATCH ONLY. No caption, template or ASR logic here.
// It only toggles a body class and MOVES existing DOM nodes, so every existing
// click handler keeps working and existing IDs are never renamed or removed.
//
// Scope: the CapCut look is applied on desktop/tablet widths (>=761px), where
// css/capcut-ui.css turns the tool tabs into a side rail and tidies the panels.
// On phones (<=760px) the editor keeps its existing, mobile-tuned layout
// untouched — forcing a fixed bottom toolbar there fought that layout, so a
// proper phone toolbar is left for a dedicated pass. Everything is reversible:
// remove this file + css/capcut-ui.css from app.html and the old editor returns.

const DESKTOP = () => window.matchMedia('(min-width: 761px)').matches;

function apply() {
  const tabs = document.querySelector('.tool-tabs');
  if (!tabs) return;
  // Any tabs that an earlier state parked in a bottom bar come back to the rail.
  const bar = document.querySelector('.capcut-bottombar');
  if (bar) { tabs.append(...bar.querySelectorAll('.tool-tab')); bar.remove(); }
  document.body.classList.toggle('studio', DESKTOP());
}

// Features that do NOT exist yet must never look live. They stay visible but
// disabled, exactly like the dashboard's existing "Soon" tools.
export function markSoon(button) {
  if (button) { button.classList.add('capcut-soon'); button.disabled = true; }
}

function start() { apply(); window.addEventListener('resize', apply); window.addEventListener('orientationchange', apply); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
