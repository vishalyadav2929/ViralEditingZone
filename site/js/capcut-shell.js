// CapCut-style shell — PATCH ONLY. No caption, template or ASR logic here.
// It only toggles a body class; css/capcut-ui.css does the rest by RESTYLING existing
// elements in place (no DOM is moved), so every existing click handler keeps working
// and existing IDs are never renamed, removed or recreated.
//
// With body.studio set, capcut-ui.css turns the tool tabs into a side rail on
// desktop/tablet and into a fixed bottom tool bar on phones, and tidies the panels.
// Fully reversible: remove this file + css/capcut-ui.css from app.html and the old
// editor returns, because styles.css / app.js were never edited for this.

function apply() { if (document.querySelector('.tool-tabs')) document.body.classList.add('studio'); }

// Features that do NOT exist yet must never look live. They stay visible but
// disabled, exactly like the dashboard's existing "Soon" tools.
export function markSoon(button) {
  if (button) { button.classList.add('capcut-soon'); button.disabled = true; }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
else apply();
