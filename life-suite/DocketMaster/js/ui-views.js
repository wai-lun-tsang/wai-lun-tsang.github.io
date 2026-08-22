/* DocketMaster — view renderers */

function showToast(msg, ms = 2200) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("show"), ms);
}

async function tagLookup() {
  const tags = await DocketDB.getAll("tags");
  return Object.fromEntries(tags.map(t => [t.id, t]));
}

function taskBubbleHTML(task, tags) {
  const tag = tags[task.tagId];
  const color = tag?.color || "#3E7CB1";
  const timeLabel = task.timeSlot ? `${task.timeSlot.start}` : `${task.timeEstimateMinutes}m`;
  return `
    <div class="bubble-row" data-task-id="${task.id}">
      <button class="bubble-check ${task.status === "completed" ? "checked" : ""}" data-check-id="${task.id}" aria-label="Complete task">${task.status === "completed" ? "✓" : ""}</button>
      <div class="bubble ${task.status === "completed" ? "completed" : ""}" style="--tag-color:${color}" data-open-id="${task.id}">
        <span class="dot"></span>
        <span class="title">${escapeHtml(task.title)}</span>
        <span class="time">${timeLabel}</span>
        <span class="stamp" data-stamp-id="${task.id}">✓ done</span>
      </div>
    </div>
  `;
}

function wireTaskBubbles(container, onChange) {
  container.querySelectorAll("[data-check-id]").forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.dataset.checkId;
      const task = await DocketDB.get("tasks", id);
      const completing = task.status !== "completed";
      await Tasks.completeTask(id, completing);
      const settings = await DocketDB.get("settings", "settings");
      if (completing && settings.completion.stamp) {
        const stamp = container.querySelector(`[data-stamp-id="${id}"]`);
        if (stamp) { stamp.classList.add("play"); setTimeout(() => stamp.classList.remove("play"), 550); }
      }
      if (completing && settings.completion.sound) beep(1046, 180);
      setTimeout(onChange, completing ? 350 : 0);
    };
  });
  container.querySelectorAll("[data-open-id]").forEach(el => {
    el.onclick = async () => {
      const task = await DocketDB.get("tasks", el.dataset.openId);
      openTaskModal({ task, onSaved: onChange });
    };
  });
}

/* ---------------- BACKLOG ---------------- */
async function renderBacklog(root) {
  await runLearnEasySync();
  const tasks = await Tasks.getBacklogTasks();
  const tags = await tagLookup();
  root.innerHTML = `
    <h2 class="view-title">Backlog</h2>
    <p class="view-subtitle">Everything new starts here. Schedule it to a day when you're ready.</p>
    <div id="backlogList"></div>
  `;
  const list = document.getElementById("backlogList");
  if (tasks.length === 0) {
    list.innerHTML = `<div class="empty-state"><span class="big">📥</span>Nothing in the backlog. Tap + to add a task.</div>`;
    return;
  }
  list.innerHTML = tasks.map(t => taskBubbleHTML(t, tags)).join("");
  wireTaskBubbles(list, () => renderBacklog(root));
}

/* ---------------- QUADRANT ---------------- */
async function renderQuadrant(root) {
  const tasks = await Tasks.getActiveTasksForQuadrant();
  const tags = await tagLookup();
  root.innerHTML = `
    <h2 class="view-title">Quadrant</h2>
    <p class="view-subtitle">Read-only triage plot. Tap a dot to open and adjust its sliders.</p>
    <div class="card quadrant-card">
      <div class="quadrant-svg-wrap card-inner"><svg id="quadSvg" viewBox="0 0 300 260" style="width:100%;"></svg></div>
      <p class="quadrant-legend">→ urgency &nbsp;·&nbsp; ↑ importance</p>
    </div>
    <div id="quadEmptyNote"></div>
  `;
  const svg = document.getElementById("quadSvg");
  const cx = (u) => 150 + (u / 10) * 130;
  const cy = (i) => 130 - (i / 10) * 110;

  let dots = "";
  for (const t of tasks) {
    const color = tags[t.tagId]?.color || "#3E7CB1";
    dots += `<circle class="quadrant-dot" data-open-id="${t.id}" cx="${cx(t.urgency)}" cy="${cy(t.importance)}" r="8" fill="${color}" stroke="#2B2B2B" stroke-width="1.5"/>`;
  }

  svg.innerHTML = `
    <g filter="url(#crayon-rough)" stroke="#2B2B2B" stroke-width="2.5" fill="none">
      <line x1="20" y1="130" x2="280" y2="130"/>
      <line x1="150" y1="10" x2="150" y2="250"/>
    </g>
    <text x="150" y="10" font-family="Quicksand" font-size="10" fill="#8a8374" text-anchor="middle">+10</text>
    <text x="150" y="248" font-family="Quicksand" font-size="10" fill="#8a8374" text-anchor="middle">−10</text>
    <text x="272" y="124" font-family="Quicksand" font-size="10" fill="#8a8374" text-anchor="middle">+10</text>
    <text x="28" y="124" font-family="Quicksand" font-size="10" fill="#8a8374" text-anchor="middle">−10</text>
    ${dots}
  `;

  svg.querySelectorAll("[data-open-id]").forEach(el => {
    el.onclick = async () => {
      const task = await DocketDB.get("tasks", el.dataset.openId);
      openTaskModal({ task, onSaved: () => renderQuadrant(root) });
    };
  });

  if (tasks.length === 0) {
    document.getElementById("quadEmptyNote").innerHTML = `<div class="empty-state">No active tasks yet. Add sliders when creating a task and they'll plot here.</div>`;
  }
}

/* ---------------- DAY ---------------- */
let currentDayDate = docketTodayStr();

async function renderDay(root, dateStr = currentDayDate) {
  currentDayDate = dateStr;
  await attemptAutoSync(dateStr);
  await runLearnEasySync();
  const tasks = await Tasks.getTasksForDate(dateStr);
  const tags = await tagLookup();
  const label = new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  root.innerHTML = `
    <h2 class="view-title">Day</h2>
    <div class="day-nav">
      <button class="btn btn-sm" id="dayPrev">← Prev</button>
      <span class="date-label">${label}</span>
      <button class="btn btn-sm" id="dayNext">Next →</button>
    </div>
    <div id="dayList"></div>
  `;
  const list = document.getElementById("dayList");
  if (tasks.length === 0) {
    list.innerHTML = `<div class="empty-state"><span class="big">📅</span>Nothing scheduled for this day.</div>`;
  } else {
    list.innerHTML = tasks.map(t => taskBubbleHTML(t, tags)).join("");
    wireTaskBubbles(list, () => renderDay(root, currentDayDate));
  }

  document.getElementById("dayPrev").onclick = () => renderDay(root, shiftDate(dateStr, -1));
  document.getElementById("dayNext").onclick = () => renderDay(root, shiftDate(dateStr, 1));
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ---------------- WEEK ---------------- */
let currentWeekAnchor = docketTodayStr();

async function renderWeek(root, anchorDate = currentWeekAnchor) {
  currentWeekAnchor = anchorDate;
  const settings = await DocketDB.get("settings", "settings");
  const weekStart = getWeekStart(anchorDate, settings.weekStartsOn);
  const dates = Array.from({ length: 7 }, (_, i) => shiftDate(weekStart, i));

  for (const d of dates) await attemptAutoSync(d);
  await runLearnEasySync();

  const byDate = await Tasks.getTasksForRange(dates[0], dates[6]);
  const tags = await tagLookup();
  const today = docketTodayStr();

  root.innerHTML = `
    <h2 class="view-title">Week</h2>
    <div class="day-nav">
      <button class="btn btn-sm" id="weekPrev">← Prev</button>
      <span class="date-label">${dates[0]} – ${dates[6]}</span>
      <button class="btn btn-sm" id="weekNext">Next →</button>
    </div>
    <div class="week-grid" id="weekGrid"></div>
  `;

  const grid = document.getElementById("weekGrid");
  grid.innerHTML = dates.map(d => {
    const dayName = new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    const items = byDate[d] || [];
    return `
      <div class="card week-day-card">
        <div class="card-inner">
          <div class="week-day-header">
            <span class="day-name ${d === today ? "today" : ""}">${dayName}</span>
            <button class="btn btn-sm btn-ghost" data-add-date="${d}">+ add</button>
          </div>
          ${items.length ? items.map(t => taskBubbleHTML(t, tags)).join("") : `<p class="muted" style="font-size:0.85rem;">No tasks</p>`}
        </div>
      </div>
    `;
  }).join("");

  wireTaskBubbles(grid, () => renderWeek(root, currentWeekAnchor));
  grid.querySelectorAll("[data-add-date]").forEach(btn => {
    btn.onclick = () => openTaskModal({ defaultDate: btn.dataset.addDate, onSaved: () => renderWeek(root, currentWeekAnchor) });
  });

  document.getElementById("weekPrev").onclick = () => renderWeek(root, shiftDate(anchorDate, -7));
  document.getElementById("weekNext").onclick = () => renderWeek(root, shiftDate(anchorDate, 7));
}

function getWeekStart(dateStr, weekStartsOn) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  const diff = (day - weekStartsOn + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

const dismissedSyncPrompts = new Set(); // in-memory, per app-session only

async function runLearnEasySync() {
  try {
    const result = await Sync.syncLearnEasy();
    const total = result.autoImported.length + result.autoUpdated.length;
    if (result.autoImported.length > 0) showToast(`Synced ${result.autoImported.length} item${result.autoImported.length > 1 ? "s" : ""} from LearnEasy`);
    else if (result.autoUpdated.length > 0) showToast(`Updated ${result.autoUpdated.length} deadline${result.autoUpdated.length > 1 ? "s" : ""} from LearnEasy`);

    const pending = result.pending.filter(p => !dismissedSyncPrompts.has(`learneasy-${p.item.id}`));
    if (pending.length > 0) showAskSyncPrompt(pending.map(p => ({ ...p, app: "learneasy" })), null);
  } catch (err) {
    console.warn("LearnEasy sync attempt failed:", err);
  }
}

async function attemptAutoSync(dateStr) {
  try {
    const frithResult = await Sync.syncFrithForDate(dateStr);
    const cpResult = await Sync.syncContactPlusForDate(dateStr);
    const total = frithResult.autoImported.length + cpResult.autoImported.length;
    if (total > 0) showToast(`Synced ${total} item${total > 1 ? "s" : ""} from ${frithResult.autoImported.length ? "FRITH" : ""}${frithResult.autoImported.length && cpResult.autoImported.length ? " & " : ""}${cpResult.autoImported.length ? "ContactPlus" : ""}`);
    let pending = [...frithResult.pending.map(p => ({ ...p, app: "frith" })), ...cpResult.pending.map(p => ({ ...p, app: "contactplus" }))];
    pending = pending.filter(p => !dismissedSyncPrompts.has(pendingKey(p)));
    if (pending.length > 0) showAskSyncPrompt(pending, dateStr);
  } catch (err) {
    console.warn("Sync attempt failed:", err);
  }
}

function pendingKey(p) {
  if (p.app === "frith") return `frith-${p.goal.id}-${p.dateStr}`;
  if (p.app === "contactplus") return `contactplus-${p.keyDate.id}-${p.dateStr}`;
  return `learneasy-${p.item.id}`;
}
function pendingLabel(p) {
  if (p.app === "frith") return p.goal.name;
  if (p.app === "contactplus") return `${p.contact.name} — ${p.keyDate.name}`;
  return p.label;
}
function pendingSourceName(p) {
  if (p.app === "frith") return "FRITH";
  if (p.app === "contactplus") return "ContactPlus";
  return "LearnEasy";
}

function showAskSyncPrompt(pending, dateStr) {
  if (document.getElementById("syncAskBanner")) return;
  const root = document.getElementById("view-root");
  const banner = document.createElement("div");
  banner.id = "syncAskBanner";
  banner.className = "card";
  banner.innerHTML = `
    <div class="card-inner">
      <strong>Import from ${pendingSourceName(pending[0])}?</strong>
      <div style="margin-top:8px;">
        ${pending.map((p, i) => `
          <label style="display:block; margin-bottom:6px; font-size:0.88rem;">
            <input type="checkbox" class="ask-sync-check" data-idx="${i}" checked>
            ${escapeHtml(pendingLabel(p))}
          </label>
        `).join("")}
      </div>
      <div class="btn-row">
        <button class="btn btn-sm btn-primary" id="confirmAskSync">Import selected</button>
        <button class="btn btn-sm btn-ghost" id="dismissAskSync">Not now</button>
      </div>
    </div>
  `;
  root.prepend(banner);
  document.getElementById("dismissAskSync").onclick = () => {
    pending.forEach(p => dismissedSyncPrompts.add(pendingKey(p)));
    banner.remove();
  };
  document.getElementById("confirmAskSync").onclick = async () => {
    const checked = [...banner.querySelectorAll(".ask-sync-check:checked")].map(c => parseInt(c.dataset.idx, 10));
    const tags = await DocketDB.getAll("tags");
    const birthdayTag = tags.find(t => t.name.toLowerCase() === "birthdays");
    const assessmentsTag = tags.find(t => t.name.toLowerCase() === "assessments");
    const learningTag = tags.find(t => t.name.toLowerCase() === "core learning");

    for (const idx of checked) {
      const p = pending[idx];
      if (p.app === "frith") {
        await Tasks.createTask({ title: p.goal.name, timeEstimateMinutes: 30, status: "scheduled", scheduledDate: p.dateStr, sourceApp: "frith", sourceId: p.goal.id, sourceDate: p.dateStr });
      } else if (p.app === "contactplus") {
        await Tasks.createTask({ title: `${p.contact.name} — ${p.keyDate.name}`, timeEstimateMinutes: 15, status: "scheduled", scheduledDate: p.dateStr, tagId: birthdayTag?.id || null, sourceApp: "contactplus", sourceId: p.keyDate.id, sourceDate: p.dateStr });
      } else if (p.kind === "learneasy-assessment") {
        const ds = toDateStrLocal(p.deadlineDate);
        await Tasks.createTask({ title: p.label.replace(/ \(.+\)$/, ""), timeEstimateMinutes: 60, status: "scheduled", scheduledDate: ds, tagId: assessmentsTag?.id || null, importance: 8, urgency: 6, sourceApp: "learneasy", sourceId: p.item.id, sourceDate: ds });
      } else if (p.kind === "learneasy-material") {
        const remaining = Math.max(15, (p.item.timeEstimateMinutes || 30) - (p.item.timeDoneMinutes || 0));
        const ds = p.scheduledDate || null;
        await Tasks.createTask({ title: p.label, timeEstimateMinutes: remaining, status: ds ? "scheduled" : "backlog", scheduledDate: ds, tagId: learningTag?.id || null, sourceApp: "learneasy", sourceId: p.item.id, sourceDate: ds || "unscheduled" });
      }
    }
    pending.forEach(p => dismissedSyncPrompts.add(pendingKey(p)));
    banner.remove();
    showToast("Imported");
    renderCurrentView();
  };
}

function toDateStrLocal(d) {
  return d.toISOString().slice(0, 10);
}

/* ---------------- TIMER ---------------- */
let dockTimer = null;

async function renderTimer(root) {
  const settings = await DocketDB.get("settings", "settings");
  if (!dockTimer) {
    dockTimer = new DocketTimer();
    dockTimer.configure(settings.alerts);
  }

  root.innerHTML = `
    <h2 class="view-title">Time &amp; Timer</h2>
    <div class="timer-card idle" id="timerCard">
      <div class="clock-current" id="clockCurrent">--:--:--</div>
      <div class="label" id="timerLabel">IDLE</div>
      <div class="big-clock" id="timerClock">00:00</div>
      <div class="linked-task" id="linkedTaskLine"></div>
      <div class="timer-controls" id="timerControls"></div>
      <div class="timer-toggle-row">
        <button class="timer-toggle" id="toggleSound">🔊 sound</button>
        <button class="timer-toggle" id="toggleVisual">✨ visual</button>
        <button class="timer-toggle" id="toggleVibrate">📳 vibrate</button>
      </div>
    </div>

    <div class="card manual-timer-setup">
      <div class="card-inner">
        <strong>Manual override</strong>
        <div class="field-row mt-8">
          <div class="field mb-0">
            <label for="manualMinutes">Binge minutes</label>
            <input type="number" id="manualMinutes" min="1" value="25">
          </div>
          <div class="field mb-0">
            <label for="manualPomodoroWork">Pomodoro work/break</label>
            <div class="row">
              <input type="number" id="manualWork" min="1" value="${settings.timerDefaults.pomodoroWorkMin}" style="width:70px;">
              <span>/</span>
              <input type="number" id="manualBreak" min="1" value="${settings.timerDefaults.pomodoroBreakMin}" style="width:70px;">
            </div>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn btn-sm" id="startManualBinge">Start Binge</button>
          <button class="btn btn-sm" id="startManualPomodoro">Start Pomodoro</button>
        </div>
      </div>
    </div>
  `;

  updateToggleButtons(settings.alerts);

  document.getElementById("toggleSound").onclick = () => toggleAlert("sound");
  document.getElementById("toggleVisual").onclick = () => toggleAlert("visual");
  document.getElementById("toggleVibrate").onclick = () => toggleAlert("vibrate");

  document.getElementById("startManualBinge").onclick = () => {
    dockTimer.startBinge(parseInt(document.getElementById("manualMinutes").value, 10) || 25, null, false);
  };
  document.getElementById("startManualPomodoro").onclick = () => {
    dockTimer.startPomodoro({
      workMin: parseInt(document.getElementById("manualWork").value, 10) || 50,
      breakMin: parseInt(document.getElementById("manualBreak").value, 10) || 10,
    }, null, false);
  };

  dockTimer.on("change", renderTimerState);
  dockTimer.on("ring", () => showToast(dockTimer.phase === "break" ? "Break time!" : "Back to work!"));

  clearInterval(renderTimer._clockInterval);
  renderTimer._clockInterval = setInterval(async () => {
    const s = await DocketDB.get("settings", "settings");
    const clockEl = document.getElementById("clockCurrent");
    if (clockEl) clockEl.textContent = currentTimeInZone(s.timezone) + " (" + s.timezone.split("/").pop().replace("_", " ") + ")";
  }, 1000);

  // default mode: auto-sync to current scheduled task if nothing running
  if (!dockTimer.mode) {
    const settingsNow = await DocketDB.get("settings", "settings");
    const current = await findCurrentScheduledTask(settingsNow.timezone);
    if (current) {
      const tags = await tagLookup();
      const tagName = tags[current.tagId]?.name;
      if (current.type === "pomodoro") {
        dockTimer.startPomodoro(current.pomodoroRatio || settingsNow.timerDefaults, current.id, true);
      } else {
        dockTimer.startBinge(current.timeEstimateMinutes, current.id, true);
      }
      showToast(`Auto-synced to: ${current.title}`);
    }
  }
  renderTimerState(dockTimer.snapshot());
}

async function renderTimerState(snap) {
  const card = document.getElementById("timerCard");
  const label = document.getElementById("timerLabel");
  const clock = document.getElementById("timerClock");
  const controls = document.getElementById("timerControls");
  const linkedLine = document.getElementById("linkedTaskLine");
  if (!card) return;

  card.classList.remove("working", "breaktime", "idle");
  if (!snap.mode) {
    card.classList.add("idle");
    label.textContent = "IDLE";
    clock.textContent = "00:00";
  } else if (snap.mode === "binge") {
    card.classList.add("working");
    label.textContent = "WORKING";
    clock.textContent = formatClock(snap.remainingSec);
  } else {
    card.classList.add(snap.phase === "work" ? "working" : "breaktime");
    label.textContent = snap.phase === "work" ? "WORKING" : "BREAK";
    clock.textContent = formatClock(snap.remainingSec);
  }

  linkedLine.textContent = "";
  if (snap.linkedTaskId) {
    const task = await DocketDB.get("tasks", snap.linkedTaskId);
    if (task) linkedLine.textContent = (snap.isAuto ? "Auto-synced: " : "Tracking: ") + task.title;
  }

  controls.innerHTML = "";
  if (snap.mode) {
    const pauseBtn = document.createElement("button");
    pauseBtn.className = "btn btn-sm";
    pauseBtn.textContent = snap.running ? "Pause" : "Resume";
    pauseBtn.onclick = () => snap.running ? dockTimer.pause() : dockTimer.resume();
    const resetBtn = document.createElement("button");
    resetBtn.className = "btn btn-sm";
    resetBtn.textContent = "Reset";
    resetBtn.onclick = () => dockTimer.reset();
    controls.append(pauseBtn, resetBtn);
  }
}

function updateToggleButtons(alerts) {
  document.getElementById("toggleSound").classList.toggle("off", !alerts.sound);
  document.getElementById("toggleVisual").classList.toggle("off", !alerts.visual);
  document.getElementById("toggleVibrate").classList.toggle("off", !alerts.vibrate);
}

async function toggleAlert(key) {
  const settings = await DocketDB.get("settings", "settings");
  settings.alerts[key] = !settings.alerts[key];
  await DocketDB.put("settings", settings);
  dockTimer.configure(settings.alerts);
  updateToggleButtons(settings.alerts);
}

/* ---------------- SETTINGS ---------------- */
let settingsSubView = null; // null | "learneasy-import"

async function renderSettings(root) {
  if (settingsSubView === "learneasy-import") {
    return renderLearnEasyImportPage(root);
  }

  const settings = await DocketDB.get("settings", "settings");
  const tags = await DocketDB.getAll("tags");
  tags.sort((a, b) => a.order - b.order);
  const frithOk = await Sync.frithAvailable();
  const cpOk = await Sync.contactPlusAvailable();
  const leOk = await Sync.learnEasyAvailable();

  root.innerHTML = `
    <h2 class="view-title">Settings</h2>

    <div class="settings-section">
      <h3>Week &amp; time</h3>
      <div class="card"><div class="card-inner">
        <div class="field">
          <label for="s-weekstart">Week starts on</label>
          <select id="s-weekstart">
            <option value="0" ${settings.weekStartsOn === 0 ? "selected" : ""}>Sunday</option>
            <option value="1" ${settings.weekStartsOn === 1 ? "selected" : ""}>Monday</option>
          </select>
        </div>
        <div class="field mb-0">
          <label for="s-timezone">Timer/clock timezone</label>
          <input type="text" id="s-timezone" value="${settings.timezone}" placeholder="Europe/London">
          <p class="hint">IANA timezone name, e.g. Europe/London, Asia/Tokyo.</p>
        </div>
      </div></div>
    </div>

    <div class="settings-section">
      <h3>Completion feedback</h3>
      <div class="card"><div class="card-inner">
        <label class="row"><input type="checkbox" id="s-stamp" ${settings.completion.stamp ? "checked" : ""}> Crayon stamp animation</label>
        <label class="row mt-8"><input type="checkbox" id="s-compsound" ${settings.completion.sound ? "checked" : ""}> Completion sound</label>
      </div></div>
    </div>

    <div class="settings-section">
      <h3>Tags</h3>
      <div class="card"><div class="card-inner" id="tagList"></div>
        <div class="btn-row"><button class="btn btn-sm" id="addTagBtn">+ Add tag</button></div>
      </div>
    </div>

    <div class="settings-section">
      <h3>FRITH sync</h3>
      <div class="card"><div class="card-inner" id="frithSyncBlock"></div></div>
    </div>

    <div class="settings-section">
      <h3>ContactPlus sync</h3>
      <div class="card"><div class="card-inner" id="cpSyncBlock"></div></div>
    </div>

    <div class="settings-section">
      <h3>LearnEasy sync</h3>
      <p class="hint" style="margin:-2px 0 10px;">Grouped by module rather than by individual item — deadlines and unfinished materials each get their own toggle per module.</p>
      <div class="card"><div class="card-inner" id="learneasySyncBlock"></div>
        <div class="btn-row"><button class="btn btn-sm" id="openLearnEasyImportBtn">Open detailed import screen →</button></div>
      </div>
    </div>

    <div class="settings-section">
      <h3>Calendar (.ics)</h3>
      <div class="card"><div class="card-inner">
        <div class="field">
          <label for="icsRangeStart">Export range: from</label>
          <div class="field-row">
            <input type="date" id="icsRangeStart" value="${docketTodayStr()}">
            <input type="date" id="icsRangeEnd" value="${shiftDate(docketTodayStr(), 7)}">
          </div>
        </div>
        <div class="btn-row">
          <button class="btn btn-sm" id="exportIcsBtn">Export .ics</button>
          <label class="btn btn-sm" style="cursor:pointer;">Import .ics<input type="file" id="importIcsFile" accept=".ics" style="display:none;"></label>
        </div>
      </div></div>
    </div>

    <div class="settings-section">
      <h3>Backup</h3>
      <div class="card"><div class="card-inner">
        <div class="btn-row">
          <button class="btn btn-sm" id="exportBackupBtn">Export full backup (JSON)</button>
          <label class="btn btn-sm" style="cursor:pointer;">Import backup<input type="file" id="importBackupFile" accept=".json" style="display:none;"></label>
        </div>
        <p class="hint">Manual, on-demand only — nothing syncs automatically or in the background.</p>
      </div></div>
    </div>
  `;

  // week/time
  document.getElementById("s-weekstart").onchange = async (e) => {
    settings.weekStartsOn = parseInt(e.target.value, 10);
    await DocketDB.put("settings", settings);
  };
  document.getElementById("s-timezone").onchange = async (e) => {
    settings.timezone = e.target.value.trim() || "Europe/London";
    await DocketDB.put("settings", settings);
  };
  document.getElementById("s-stamp").onchange = async (e) => {
    settings.completion.stamp = e.target.checked;
    await DocketDB.put("settings", settings);
  };
  document.getElementById("s-compsound").onchange = async (e) => {
    settings.completion.sound = e.target.checked;
    await DocketDB.put("settings", settings);
  };

  renderTagList(tags);
  document.getElementById("addTagBtn").onclick = async () => {
    const name = prompt("Tag name?");
    if (!name) return;
    const color = prompt("Hex color? (e.g. #3E7CB1)", "#3E7CB1") || "#3E7CB1";
    await DocketDB.put("tags", { id: docketUid(), name, color, order: tags.length });
    renderSettings(root);
  };

  await renderFrithSyncBlock(frithOk);
  await renderContactPlusSyncBlock(cpOk);
  await renderLearnEasySyncBlock(leOk);

  document.getElementById("openLearnEasyImportBtn").onclick = () => {
    settingsSubView = "learneasy-import";
    renderSettings(root);
  };

  document.getElementById("exportIcsBtn").onclick = async () => {
    const from = document.getElementById("icsRangeStart").value;
    const to = document.getElementById("icsRangeEnd").value;
    const byDate = await Tasks.getTasksForRange(from, to);
    const all = Object.values(byDate).flat();
    ICS.downloadICS(ICS.tasksToICS(all));
    showToast("Exported .ics");
  };
  document.getElementById("importIcsFile").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const tasks = ICS.icsToTasks(text);
    for (const t of tasks) await DocketDB.put("tasks", t);
    showToast(`Imported ${tasks.length} event(s)`);
  };

  document.getElementById("exportBackupBtn").onclick = () => Backup.exportBackup();
  document.getElementById("importBackupFile").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const res = await Backup.importBackup(text, "merge");
      showToast(`Imported ${res.tasksImported} tasks`);
      renderSettings(root);
    } catch (err) {
      showToast("Import failed: " + err.message);
    }
  };
}

function renderTagList(tags) {
  const list = document.getElementById("tagList");
  list.innerHTML = tags.map(t => `
    <div class="tag-row">
      <span class="tag-swatch" style="background:${t.color}"></span>
      <span style="flex:1;">${escapeHtml(t.name)}</span>
      <button class="btn btn-sm btn-ghost" data-edit-tag="${t.id}">Edit</button>
      <button class="btn btn-sm btn-ghost" data-del-tag="${t.id}">Delete</button>
    </div>
  `).join("");
  list.querySelectorAll("[data-edit-tag]").forEach(btn => {
    btn.onclick = async () => {
      const tag = tags.find(t => t.id === btn.dataset.editTag);
      const name = prompt("Tag name?", tag.name);
      if (!name) return;
      const color = prompt("Hex color?", tag.color) || tag.color;
      await DocketDB.put("tags", { ...tag, name, color });
      renderSettings(document.getElementById("view-root"));
    };
  });
  list.querySelectorAll("[data-del-tag]").forEach(btn => {
    btn.onclick = async () => {
      if (confirm("Delete this tag? Tasks using it will show as untagged.")) {
        await DocketDB.delete("tags", btn.dataset.delTag);
        renderSettings(document.getElementById("view-root"));
      }
    };
  });
}

async function renderFrithSyncBlock(available) {
  const block = document.getElementById("frithSyncBlock");
  if (!available) {
    block.innerHTML = `<p class="unavailable-note">FRITH not detected on this origin yet. This activates automatically once DocketMaster and FRITH are hosted under the same GitHub Pages site. You can still use the manual backup import as a stopgap.</p>`;
    return;
  }
  const { goals } = await Sync.readFrithData();
  const prefs = await DocketDB.getAll("frithGoalSync");
  const prefMap = Object.fromEntries(prefs.map(p => [p.goalId, p.mode]));

  block.innerHTML = goals.map(g => `
    <div class="sync-row">
      <span class="name">${escapeHtml(g.name)}</span>
      <div class="pill-group">
        ${["never", "auto", "ask"].map(m => `<button type="button" class="pill btn-sm sync-mode-btn" data-goal="${g.id}" data-mode="${m}" ${((prefMap[g.id] || "never") === m) ? "" : ""} style="${((prefMap[g.id] || "never") === m) ? "background:#3E7CB1;color:#fff;border-color:#3E7CB1;" : ""}">${m}</button>`).join("")}
      </div>
    </div>
  `).join("") || `<p class="muted">No goals found in FRITH yet.</p>`;

  block.querySelectorAll(".sync-mode-btn").forEach(btn => {
    btn.onclick = async () => {
      await DocketDB.put("frithGoalSync", { goalId: btn.dataset.goal, mode: btn.dataset.mode });
      renderFrithSyncBlock(true);
    };
  });
}

async function renderContactPlusSyncBlock(available) {
  const block = document.getElementById("cpSyncBlock");
  if (!available) {
    block.innerHTML = `<p class="unavailable-note">ContactPlus not detected on this origin yet. This activates automatically once DocketMaster and ContactPlus are hosted under the same GitHub Pages site. You can still use the manual backup import as a stopgap.</p>`;
    return;
  }
  const contacts = await Sync.readContactPlusData();
  const prefs = await DocketDB.getAll("contactplusSync");
  const prefMap = Object.fromEntries(prefs.map(p => [p.contactId, p.mode]));

  block.innerHTML = contacts.map(c => `
    <div class="sync-row">
      <span class="name">${escapeHtml(c.name)} <span class="muted">(${(c.keyDates || []).length} key date${(c.keyDates || []).length === 1 ? "" : "s"})</span></span>
      <div class="pill-group">
        ${["never", "auto", "ask"].map(m => `<button type="button" class="pill btn-sm sync-mode-btn-cp" data-contact="${c.id}" data-mode="${m}" style="${((prefMap[c.id] || "never") === m) ? "background:#3E7CB1;color:#fff;border-color:#3E7CB1;" : ""}">${m}</button>`).join("")}
      </div>
    </div>
  `).join("") || `<p class="muted">No contacts found in ContactPlus yet.</p>`;

  block.querySelectorAll(".sync-mode-btn-cp").forEach(btn => {
    btn.onclick = async () => {
      await DocketDB.put("contactplusSync", { contactId: btn.dataset.contact, mode: btn.dataset.mode });
      renderContactPlusSyncBlock(true);
    };
  });
}

async function renderLearnEasySyncBlock(available) {
  const block = document.getElementById("learneasySyncBlock");
  if (!available) {
    block.innerHTML = `<p class="unavailable-note">LearnEasy not detected on this origin yet. This activates automatically once DocketMaster and LearnEasy are hosted under the same GitHub Pages site.</p>`;
    return;
  }
  const data = await Sync.readLearnEasyData();
  const nodesById = Object.fromEntries(data.nodes.map(n => [n.id, n]));
  const modules = data.nodes.filter(n => n.type === "module");
  const prefs = await DocketDB.getAll("learneasySync");
  const prefMap = Object.fromEntries(prefs.map(p => [p.id, p.mode]));

  function countFor(moduleId, category) {
    if (category === "assessments") {
      return data.assessments.filter(a => a.moduleId === moduleId && !a.submittedAt && a.deadline).length;
    }
    let count = 0;
    for (const n of data.nodes) {
      if (n.type !== "material" || n.materialType === "Summative assessment") continue;
      const est = n.timeEstimateMinutes || 0, done = n.timeDoneMinutes || 0;
      if (est > 0 && done >= est) continue;
      let cur = n;
      while (cur && cur.type !== "module") cur = cur.parentId ? nodesById[cur.parentId] : null;
      if (cur && cur.id === moduleId) count++;
    }
    return count;
  }

  function rowHTML(moduleId, category, label, count) {
    const key = `${moduleId}::${category}`;
    const current = prefMap[key] || "never";
    return `
      <div class="sync-row">
        <span class="name">${escapeHtml(label)} <span class="muted">(${count})</span></span>
        <div class="pill-group">
          ${["never", "auto", "ask"].map(m => `<button type="button" class="pill btn-sm le-sync-btn" data-key="${key}" data-mode="${m}" style="${current === m ? "background:#3E7CB1;color:#fff;border-color:#3E7CB1;" : ""}">${m}</button>`).join("")}
        </div>
      </div>
    `;
  }

  block.innerHTML = modules.map(mod => {
    const label = mod.moduleCode ? `${mod.moduleCode} — ${mod.name}` : mod.name;
    return `
      <div style="margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid rgba(0,0,0,0.08);">
        <strong style="font-size:0.85rem;">${escapeHtml(label)}</strong>
        ${rowHTML(mod.id, "assessments", "Assessment deadlines", countFor(mod.id, "assessments"))}
        ${rowHTML(mod.id, "materials", "Unfinished materials", countFor(mod.id, "materials"))}
      </div>
    `;
  }).join("") || `<p class="muted">No modules found in LearnEasy yet.</p>`;

  block.querySelectorAll(".le-sync-btn").forEach(btn => {
    btn.onclick = async () => {
      await DocketDB.put("learneasySync", { id: btn.dataset.key, mode: btn.dataset.mode });
      renderLearnEasySyncBlock(true);
    };
  });
}

async function renderLearnEasyImportPage(root) {
  root.innerHTML = `
    <div class="day-nav">
      <button class="btn btn-sm" id="backToSettingsBtn">← Back to Settings</button>
      <span class="date-label">Import from LearnEasy</span>
      <span></span>
    </div>
    <div id="leImportBody"></div>
  `;
  document.getElementById("backToSettingsBtn").onclick = () => {
    settingsSubView = null;
    renderSettings(root);
  };

  const body = document.getElementById("leImportBody");
  const available = await Sync.learnEasyAvailable();
  if (!available) {
    body.innerHTML = `<div class="empty-state"><span class="big">📚</span>LearnEasy not detected on this origin yet. This screen fills in automatically once DocketMaster and LearnEasy are hosted under the same GitHub Pages site.</div>`;
    return;
  }

  const data = await Sync.readLearnEasyData();
  const byModule = Sync.groupLearnEasyImportables(data);
  const moduleIds = Object.keys(byModule);

  if (moduleIds.length === 0) {
    body.innerHTML = `<div class="empty-state">Nothing importable right now — no pending deadlines or unfinished materials in LearnEasy.</div>`;
    return;
  }

  let html = `<p class="view-subtitle">Tick individual items and import exactly what you want, one by one — separate from the module-level Auto/Ask toggles.</p>`;

  for (const moduleId of moduleIds) {
    const { module, assessments, materials } = byModule[moduleId];
    const modLabel = module.moduleCode ? `${module.moduleCode} — ${module.name}` : module.name;

    html += `<div class="card"><div class="card-inner">
      <strong style="font-family:'Permanent Marker',cursive; font-size:0.95rem;">${escapeHtml(modLabel)}</strong>`;

    if (assessments.length === 0 && materials.length === 0) {
      html += `<p class="muted" style="font-size:0.85rem; margin-top:8px;">Nothing pending in this module.</p>`;
    }

    if (assessments.length > 0) {
      html += `<p class="hint" style="margin:10px 0 4px;">Assessment deadlines</p>`;
      for (const a of assessments) {
        const deadlineDate = Sync.computeEffectiveDeadline(a);
        const existing = await Sync.findExistingBySourceAppAndId("learneasy", a.id);
        html += leItemRowHTML({
          key: `assessment:${a.id}`,
          label: `${escapeHtml(a.name)} — due ${Sync.toDateStr(deadlineDate)}`,
          sub: a.assessmentFormat ? escapeHtml(a.assessmentFormat) + (a.weightWithinModule ? ` · ${a.weightWithinModule}%` : "") : "",
          imported: !!existing,
        });
      }
    }

    if (materials.length > 0) {
      html += `<p class="hint" style="margin:10px 0 4px;">Unfinished materials</p>`;
      for (const m of materials) {
        const existing = await Sync.findExistingBySourceAppAndId("learneasy", m.id);
        const remaining = Math.max(15, (m.timeEstimateMinutes || 30) - (m.timeDoneMinutes || 0));
        html += leItemRowHTML({
          key: `material:${m.id}`,
          label: escapeHtml(m.name),
          sub: `${remaining}m remaining${m.dateEnd ? " · due " + Sync.toDateStr(new Date(m.dateEnd)) : ""}`,
          imported: !!existing,
        });
      }
    }

    html += `</div></div>`;
  }

  body.innerHTML = html;

  body.querySelectorAll("[data-le-check]").forEach(cb => {
    cb.onchange = updateImportSelectedCount;
  });

  const bar = document.createElement("div");
  bar.className = "btn-row";
  bar.style = "position:sticky; bottom:8px; margin-top:16px;";
  bar.innerHTML = `<button class="btn btn-primary" id="importSelectedLeBtn">Import selected (0)</button>`;
  body.appendChild(bar);
  document.getElementById("importSelectedLeBtn").onclick = () => confirmLearnEasyImport(data, byModule);

  function updateImportSelectedCount() {
    const n = body.querySelectorAll("[data-le-check]:checked").length;
    const btn = document.getElementById("importSelectedLeBtn");
    if (btn) btn.textContent = `Import selected (${n})`;
  }
}

function leItemRowHTML({ key, label, sub, imported }) {
  return `
    <label class="row" style="padding:6px 0; ${imported ? "opacity:0.55;" : ""}">
      <input type="checkbox" data-le-check="${key}" ${imported ? "disabled" : ""}>
      <span style="flex:1; font-size:0.88rem;">
        ${label}
        ${sub ? `<span class="muted" style="display:block; font-size:0.75rem;">${sub}</span>` : ""}
      </span>
      ${imported ? `<span class="muted" style="font-size:0.72rem;">✓ imported</span>` : ""}
    </label>
  `;
}

async function confirmLearnEasyImport(data, byModule) {
  const body = document.getElementById("leImportBody");
  const checked = [...body.querySelectorAll("[data-le-check]:checked")].map(c => c.dataset.leCheck);
  if (checked.length === 0) { showToast("Nothing selected"); return; }

  const tags = await DocketDB.getAll("tags");
  const assessmentsTag = tags.find(t => t.name.toLowerCase() === "assessments");
  const learningTag = tags.find(t => t.name.toLowerCase() === "core learning");

  // flatten all module items for lookup by id
  const allAssessments = {};
  const allMaterials = {};
  const moduleOf = {};
  for (const moduleId in byModule) {
    const { module, assessments, materials } = byModule[moduleId];
    assessments.forEach(a => { allAssessments[a.id] = a; moduleOf[a.id] = module; });
    materials.forEach(m => { allMaterials[m.id] = m; moduleOf[m.id] = module; });
  }

  let count = 0;
  for (const key of checked) {
    const [kind, id] = key.split(":");
    const module = moduleOf[id];
    const modLabel = module?.moduleCode ? module.moduleCode : module?.name || "";

    if (kind === "assessment") {
      const a = allAssessments[id];
      const deadlineDate = Sync.computeEffectiveDeadline(a);
      const ds = Sync.toDateStr(deadlineDate);
      await Tasks.createTask({
        title: `${modLabel} — ${a.name} due`, timeEstimateMinutes: 60,
        status: "scheduled", scheduledDate: ds,
        tagId: assessmentsTag?.id || null, importance: 8, urgency: 6,
        sourceApp: "learneasy", sourceId: a.id, sourceDate: ds,
      });
      count++;
    } else if (kind === "material") {
      const m = allMaterials[id];
      const remaining = Math.max(15, (m.timeEstimateMinutes || 30) - (m.timeDoneMinutes || 0));
      const ds = m.dateEnd ? Sync.toDateStr(new Date(m.dateEnd)) : null;
      await Tasks.createTask({
        title: `${modLabel} — ${m.name}`, timeEstimateMinutes: remaining,
        status: ds ? "scheduled" : "backlog", scheduledDate: ds,
        tagId: learningTag?.id || null,
        sourceApp: "learneasy", sourceId: m.id, sourceDate: ds || "unscheduled",
      });
      count++;
    }
  }

  showToast(`Imported ${count} item${count > 1 ? "s" : ""}`);
  renderLearnEasyImportPage(document.getElementById("view-root"));
}

window.Views = { renderBacklog, renderQuadrant, renderDay, renderWeek, renderTimer, renderSettings };
