// CapCut-style shell — PATCH ONLY. No caption, template or ASR logic here.
// It only MOVES existing DOM nodes, so every existing click handler keeps working.
// Existing IDs are never renamed, removed or recreated.

const isMobile = () => window.matchMedia('(max-width: 760px)').matches;

function buildBottomBar() {
  // Find the editor's existing tool tabs (Media, Clips, Captions, Text, ...)
  const tabs = document.querySelector('.tool-tabs');
  if (!tabs || document.querySelector('.capcut-bottombar')) return;
  const bar = document.createElement('div');
  bar.className = 'capcut-bottombar';
  bar.setAttribute('aria-label', 'Editor tools');
  document.body.appendChild(bar);

  const placeTabs = () => {
    // Move the SAME tab buttons (not clones) so listeners survive.
    if (isMobile()) bar.append(...tabs.querySelectorAll('.tool-tab'));
    else tabs.append(...bar.querySelectorAll('.tool-tab'));
  };
  placeTabs();
  window.addEventListener('resize', placeTabs);

  // When a panel opens on mobile, show it as a bottom sheet.
  tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.tool-tab');
    if (!tab || !isMobile()) return;
    const panelId = tab.getAttribute('aria-controls');
    const panel = panelId && document.getElementById(panelId);
    if (panel) panel.classList.add('sheet-open');
  });
  document.addEventListener('click', (e) => {
    // Tapping outside a sheet closes it; tapping a tab is handled above.
    if (!isMobile() || e.target.closest('.panel-b') || e.target.closest('.tool-tab')) return;
    document.querySelectorAll('.panel-b.sheet-open').forEach(p => p.classList.remove('sheet-open'));
  });
}

// Features that do NOT exist yet must never look live. They stay visible
// but disabled, exactly like the dashboard's existing "Soon" tools.
export function markSoon(button) {
  if (button) { button.classList.add('capcut-soon'); button.disabled = true; }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', buildBottomBar);
} else {
  buildBottomBar();
}
