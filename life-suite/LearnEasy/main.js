var LE = window.LE = window.LE || {};

LE.state = { tab: 'progress', currentNodeId: null };

LE.render = async function () {
  const container = document.getElementById('le-content');
  if (!container) return;
  document.querySelectorAll('.le-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === LE.state.tab));
  try {
    if (LE.state.tab === 'progress') return await LE.renderProgress(container);
    if (LE.state.tab === 'marks') return await LE.renderMarks(container);
    if (LE.state.tab === 'settings') return await LE.renderSettings(container);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="le-empty">Something went wrong rendering this page.<br><span style="font-size:11px;color:var(--muted)">${LE.escapeHtml(err.message || String(err))}</span></div>`;
  }
};

LE.switchTab = function (tab) {
  LE.state.tab = tab;
  LE.closeModal();
  LE.render();
};

function showFatalError(err) {
  console.error('LearnEasy failed to start:', err);
  const container = document.getElementById('le-content');
  if (container) {
    container.innerHTML = `<div class="le-empty">
      LearnEasy couldn't start.<br><br>
      <span style="font-size:12px;color:var(--muted)">${LE.escapeHtml(err && err.message ? err.message : String(err))}</span><br><br>
      <span style="font-size:12px;color:var(--muted)">If you opened this file directly (file://), try running it from a local server instead \u2014 see the README \u2014 some browsers restrict storage on file:// pages.</span>
    </div>`;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.le-tab').forEach(btn => {
    btn.addEventListener('click', () => LE.switchTab(btn.dataset.tab));
  });
  const settingsShortcut = document.getElementById('le-settings-shortcut');
  if (settingsShortcut) settingsShortcut.addEventListener('click', () => LE.switchTab('settings'));

  (async () => {
    try {
      await LE.openDB();
      await LE.seedIfEmpty();
      await LE.migrateRemoveTerm3();
      await LE.render();
    } catch (err) {
      showFatalError(err);
    }
  })();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});
