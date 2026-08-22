/* DocketMaster — Task add/edit modal */

const IMPORTANCE_MARKERS = [
  { v: 10, label: "My Life Depends On It" },
  { v: 5, label: "Genuinely Matters" },
  { v: 0, label: "Neutral" },
  { v: -5, label: "Barely Relevant" },
  { v: -10, label: "Practically Can Ignore" },
];
const PRESETS = [
  { label: "Urgent & Important", urgency: 8, importance: 8 },
  { label: "Important, Not Urgent", urgency: -5, importance: 8 },
  { label: "Urgent, Not Important", urgency: 8, importance: -5 },
  { label: "Neither", urgency: -8, importance: -8 },
];

function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
}

async function openTaskModal({ task = null, defaultDate = null, onSaved = null } = {}) {
  const tags = await DocketDB.getAll("tags");
  tags.sort((a, b) => a.order - b.order);
  const settings = await DocketDB.get("settings", "settings");
  const isNew = !task;
  const t = task || Tasks.blankTask({ scheduledDate: defaultDate, status: defaultDate ? "scheduled" : "backlog" });

  const selectedTag = tags.find(tg => tg.id === t.tagId);
  const tagColor = selectedTag?.color || "#3E7CB1";

  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="modal-backdrop" id="taskModalBackdrop">
      <div class="modal-sheet tag-border" id="taskModalSheet" style="--tag-color:${tagColor}">
        <div class="modal-header">
          <h2>${isNew ? "New task" : "Edit task"}</h2>
          <button class="modal-close" id="taskModalCloseBtn" aria-label="Close">✕</button>
        </div>

        <div class="field">
          <label for="f-title">Title *</label>
          <input type="text" id="f-title" value="${escapeAttr(t.title)}" placeholder="What needs doing?">
        </div>

        <div class="field">
          <label for="f-estimate">Time estimate (minutes) *</label>
          <input type="number" id="f-estimate" min="5" step="5" value="${t.timeEstimateMinutes}">
          <div class="pill-group mt-8" id="estimatePresets">
            ${[15, 30, 45, 60, 90, 120].map(m => `<button type="button" class="pill" data-min="${m}">${m}m</button>`).join("")}
          </div>
        </div>

        <div class="field">
          <label><input type="checkbox" id="f-slot-enabled" ${t.timeSlot ? "checked" : ""}> Specific time slot</label>
          <div class="field-row mt-8" id="slotFields" style="${t.timeSlot ? "" : "display:none"}">
            <div class="field mb-0"><label for="f-slot-start">Start</label><input type="time" id="f-slot-start" value="${t.timeSlot?.start || "09:00"}"></div>
            <div class="field mb-0"><label for="f-slot-end">End</label><input type="time" id="f-slot-end" value="${t.timeSlot?.end || "09:30"}"></div>
          </div>
        </div>

        <div class="field">
          <label for="f-notes">Notes</label>
          <textarea id="f-notes" placeholder="Optional details...">${escapeHtml(t.notes || "")}</textarea>
        </div>

        <div class="field">
          <label>Tag</label>
          <div class="tag-picker" id="tagPicker">
            <div class="tag-chip ${!t.tagId ? "selected" : ""}" data-tag-id="" style="--chip-color:#999"><span class="dot"></span>None</div>
            ${tags.map(tg => `<div class="tag-chip ${t.tagId === tg.id ? "selected" : ""}" data-tag-id="${tg.id}" style="--chip-color:${tg.color}"><span class="dot"></span>${escapeHtml(tg.name)}</div>`).join("")}
          </div>
        </div>

        <div class="field">
          <label>Type (optional)</label>
          <div class="pill-group" id="typePicker">
            <button type="button" class="pill ${!t.type ? "selected" : ""}" data-type="">None</button>
            <button type="button" class="pill ${t.type === "binge" ? "selected" : ""}" data-type="binge">Binge</button>
            <button type="button" class="pill ${t.type === "pomodoro" ? "selected" : ""}" data-type="pomodoro">Pomodoro</button>
          </div>
          <div class="field-row mt-8" id="pomodoroRatioFields" style="${t.type === "pomodoro" ? "" : "display:none"}">
            <div class="field mb-0"><label for="f-work">Work (min)</label><input type="number" id="f-work" min="1" value="${t.pomodoroRatio?.workMin ?? settings.timerDefaults.pomodoroWorkMin}"></div>
            <div class="field mb-0"><label for="f-break">Break (min)</label><input type="number" id="f-break" min="1" value="${t.pomodoroRatio?.breakMin ?? settings.timerDefaults.pomodoroBreakMin}"></div>
          </div>
        </div>

        ${sliderBlockHTML("importance", "Importance", t.importance)}
        ${sliderBlockHTML("urgency", "Urgency", t.urgency)}
        <div class="slider-presets">
          ${PRESETS.map(p => `<button type="button" class="pill btn-sm" data-preset='${JSON.stringify(p)}'>${p.label}</button>`).join("")}
        </div>

        ${isNew ? recurrenceBlockHTML() : ""}

        <div class="btn-row" style="margin-top:20px;">
          <button class="btn btn-primary" id="saveTaskBtn">Save</button>
          ${!isNew ? `<button class="btn" id="scheduleTaskBtn">${t.status === "backlog" ? "Schedule…" : "Move to Backlog"}</button>` : ""}
          ${!isNew ? `<button class="btn btn-danger" id="deleteTaskBtn">Delete</button>` : ""}
          <button class="btn btn-ghost" id="cancelTaskBtn">Cancel</button>
        </div>
      </div>
    </div>
  `;

  // wire up
  document.getElementById("taskModalCloseBtn").onclick = closeModal;
  document.getElementById("cancelTaskBtn").onclick = closeModal;
  document.getElementById("taskModalBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "taskModalBackdrop") closeModal();
  });

  document.getElementById("f-slot-enabled").onchange = (e) => {
    document.getElementById("slotFields").style.display = e.target.checked ? "" : "none";
  };

  document.querySelectorAll("#estimatePresets .pill").forEach(btn => {
    btn.onclick = () => { document.getElementById("f-estimate").value = btn.dataset.min; };
  });

  document.querySelectorAll("#tagPicker .tag-chip").forEach(chip => {
    chip.onclick = () => {
      document.querySelectorAll("#tagPicker .tag-chip").forEach(c => c.classList.remove("selected"));
      chip.classList.add("selected");
      const color = chip.style.getPropertyValue("--chip-color");
      document.getElementById("taskModalSheet").style.setProperty("--tag-color", color);
    };
  });

  document.querySelectorAll("#typePicker .pill").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("#typePicker .pill").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      document.getElementById("pomodoroRatioFields").style.display = btn.dataset.type === "pomodoro" ? "" : "none";
    };
  });

  document.querySelectorAll(".slider-presets .pill").forEach(btn => {
    btn.onclick = () => {
      const p = JSON.parse(btn.dataset.preset);
      document.getElementById("range-importance").value = p.importance;
      document.getElementById("range-urgency").value = p.urgency;
      document.getElementById("val-importance").textContent = p.importance;
      document.getElementById("val-urgency").textContent = p.urgency;
    };
  });

  ["importance", "urgency"].forEach(key => {
    const el = document.getElementById(`range-${key}`);
    el.oninput = () => { document.getElementById(`val-${key}`).textContent = el.value; };
  });

  if (isNew) wireRecurrenceBlock();

  if (!isNew) {
    document.getElementById("deleteTaskBtn").onclick = async () => {
      if (confirm("Delete this task?")) {
        await Tasks.deleteTask(t.id);
        closeModal();
        onSaved?.();
        showToast("Task deleted");
      }
    };
    document.getElementById("scheduleTaskBtn").onclick = async () => {
      if (t.status === "backlog") {
        const date = prompt("Schedule for which date? (YYYY-MM-DD)", docketTodayStr());
        if (date) { await Tasks.scheduleTask(t.id, date); closeModal(); onSaved?.(); showToast("Scheduled"); }
      } else {
        await Tasks.unscheduleTask(t.id);
        closeModal(); onSaved?.(); showToast("Moved to Backlog");
      }
    };
  }

  document.getElementById("saveTaskBtn").onclick = async () => {
    const title = document.getElementById("f-title").value.trim();
    const estimate = parseInt(document.getElementById("f-estimate").value, 10);
    if (!title) { showToast("Title is required"); return; }
    if (!estimate || estimate <= 0) { showToast("Time estimate is required"); return; }

    const slotEnabled = document.getElementById("f-slot-enabled").checked;
    const tagId = document.querySelector("#tagPicker .tag-chip.selected")?.dataset.tagId || null;
    const type = document.querySelector("#typePicker .pill.selected")?.dataset.type || null;

    const patch = {
      title, timeEstimateMinutes: estimate,
      notes: document.getElementById("f-notes").value.trim(),
      timeSlot: slotEnabled ? { start: document.getElementById("f-slot-start").value, end: document.getElementById("f-slot-end").value } : null,
      tagId: tagId || null,
      type: type || null,
      pomodoroRatio: type === "pomodoro" ? {
        workMin: parseInt(document.getElementById("f-work").value, 10) || 50,
        breakMin: parseInt(document.getElementById("f-break").value, 10) || 10,
      } : null,
      importance: parseInt(document.getElementById("range-importance").value, 10),
      urgency: parseInt(document.getElementById("range-urgency").value, 10),
    };

    const recurrenceState = isNew ? readRecurrenceBlock() : null;

    if (isNew && recurrenceState) {
      await Tasks.createSeries({ ...patch, rule: recurrenceState });
      showToast("Recurring task created");
    } else if (isNew) {
      await Tasks.createTask(patch);
      showToast("Task added");
    } else {
      await Tasks.updateTask(t.id, patch);
      showToast("Task updated");
    }
    closeModal();
    onSaved?.();
  };
}

function sliderBlockHTML(key, label, value) {
  return `
    <div class="slider-block">
      <div class="slider-label"><span>${label}</span><span class="slider-value" id="val-${key}">${value}</span></div>
      <div class="slider-track-wrap">
        <input type="range" class="crayon-slider" id="range-${key}" min="-10" max="10" step="1" value="${value}">
        <div class="slider-markers">
          ${IMPORTANCE_MARKERS.map(m => `<span>${m.v}</span>`).join("")}
        </div>
      </div>
    </div>
  `;
}

function recurrenceBlockHTML() {
  return `
    <div class="field">
      <label><input type="checkbox" id="f-recurring"> Make this recurring</label>
      <div id="recurrenceFields" style="display:none; margin-top:10px;">
        <div class="pill-group" id="recurModePicker">
          <button type="button" class="pill selected" data-mode="weekday">Set weekday(s)</button>
          <button type="button" class="pill" data-mode="everyN">Every N days</button>
          <button type="button" class="pill" data-mode="dates">Specific dates</button>
        </div>

        <div id="recur-weekday" class="mt-8">
          <div class="field-row">
            <div class="field mb-0">
              <label for="r-weekday">Weekday</label>
              <select id="r-weekday">
                <option value="0">Sunday</option><option value="1">Monday</option><option value="2">Tuesday</option>
                <option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option>
              </select>
            </div>
            <div class="field mb-0"><label for="r-weeks">Every N weeks</label><input type="number" id="r-weeks" min="1" value="1"></div>
          </div>
        </div>

        <div id="recur-everyN" class="mt-8" style="display:none">
          <div class="field mb-0"><label for="r-days">Every N days</label><input type="number" id="r-days" min="1" value="2"></div>
        </div>

        <div id="recur-dates" class="mt-8" style="display:none">
          <div class="field mb-0"><label for="r-dates">Dates (comma-separated YYYY-MM-DD)</label><input type="text" id="r-dates" placeholder="2026-09-20, 2026-09-27"></div>
        </div>

        <div class="field-row mt-8">
          <div class="field mb-0"><label for="r-start">Start date</label><input type="date" id="r-start" value="${docketTodayStr()}"></div>
          <div class="field mb-0"><label for="r-end">End date (optional)</label><input type="date" id="r-end"></div>
        </div>
        <p class="hint">Specific-dates mode ignores start/end — the list is the whole schedule.</p>
      </div>
    </div>
  `;
}

function wireRecurrenceBlock() {
  const checkbox = document.getElementById("f-recurring");
  checkbox.onchange = () => {
    document.getElementById("recurrenceFields").style.display = checkbox.checked ? "" : "none";
  };
  document.querySelectorAll("#recurModePicker .pill").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("#recurModePicker .pill").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      ["weekday", "everyN", "dates"].forEach(m => {
        document.getElementById(`recur-${m}`).style.display = m === btn.dataset.mode ? "" : "none";
      });
    };
  });
}

function readRecurrenceBlock() {
  const checkbox = document.getElementById("f-recurring");
  if (!checkbox || !checkbox.checked) return null;
  const mode = document.querySelector("#recurModePicker .pill.selected").dataset.mode;
  const startDate = document.getElementById("r-start").value || docketTodayStr();
  const endDate = document.getElementById("r-end").value || null;

  if (mode === "weekday") {
    return { mode, weekday: parseInt(document.getElementById("r-weekday").value, 10), intervalWeeks: parseInt(document.getElementById("r-weeks").value, 10) || 1, startDate, endDate };
  }
  if (mode === "everyN") {
    return { mode, intervalDays: parseInt(document.getElementById("r-days").value, 10) || 1, startDate, endDate };
  }
  if (mode === "dates") {
    const dates = document.getElementById("r-dates").value.split(",").map(s => s.trim()).filter(Boolean);
    return { mode, dates };
  }
  return null;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
function escapeAttr(str) {
  return String(str || "").replace(/"/g, "&quot;");
}

window.openTaskModal = openTaskModal;
window.closeModal = closeModal;
