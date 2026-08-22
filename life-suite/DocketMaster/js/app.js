/* DocketMaster — app init, routing, tab bar */

let activeView = "backlog";

async function renderCurrentView() {
  const root = document.getElementById("view-root");
  root.innerHTML = "";
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.view === activeView));

  switch (activeView) {
    case "backlog": return Views.renderBacklog(root);
    case "quadrant": return Views.renderQuadrant(root);
    case "day": return Views.renderDay(root);
    case "week": return Views.renderWeek(root);
    case "timer": return Views.renderTimer(root);
    case "settings": return Views.renderSettings(root);
  }
}

function setActiveView(view) {
  if (activeView === "settings" && view !== "settings" && typeof settingsSubView !== "undefined") {
    settingsSubView = null; // reset any Settings sub-screen when navigating away
  }
  activeView = view;
  renderCurrentView();
}

async function init() {
  await seedIfNeeded();

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.onclick = () => setActiveView(btn.dataset.view);
  });

  document.getElementById("addTaskBtn").onclick = () => {
    const defaultDate = activeView === "day" ? undefined : null;
    openTaskModal({ onSaved: renderCurrentView });
  };

  await renderCurrentView();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(err => console.warn("Service worker registration failed:", err));
  }

  // "On open" catch-up summary — checks for tasks that were due (scheduled for
  // a past date, not completed) since the app was last opened.
  showCatchUpSummaryIfNeeded();
}

async function showCatchUpSummaryIfNeeded() {
  const today = docketTodayStr();
  const allTasks = await DocketDB.getAll("tasks");
  const overdue = allTasks.filter(t => t.status === "scheduled" && t.scheduledDate && t.scheduledDate < today);
  if (overdue.length > 0) {
    showToast(`${overdue.length} task${overdue.length > 1 ? "s were" : " was"} due while you were away`, 3500);
  }
}

document.addEventListener("DOMContentLoaded", init);
