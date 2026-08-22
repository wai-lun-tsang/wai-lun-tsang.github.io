/* DocketMaster — task CRUD + recurring series materialization

   A "task series" (taskSeries store) is a recurring template — same idea as
   FRITH's goals store. When Day/Week view needs a date, it checks which
   series are eligible for that date (Recurrence.isEligibleOnDate) and
   materializes a real row in `tasks` for that occurrence if one doesn't
   already exist (keyed by seriesId + scheduledDate), the same split FRITH
   uses between `goals` (template) and `entries` (per-day record).
*/

function blankTask(overrides = {}) {
  return {
    id: docketUid(),
    title: "",
    timeEstimateMinutes: 30,
    notes: "",
    timeSlot: null, // { start: "HH:MM", end: "HH:MM" } | null
    tagId: null,
    type: null, // "binge" | "pomodoro" | null
    pomodoroRatio: null, // { workMin, breakMin } | null (falls back to settings default)
    importance: 0,
    urgency: 0,
    status: "backlog", // "backlog" | "scheduled" | "completed"
    scheduledDate: null, // "YYYY-MM-DD" | null
    seriesId: null,
    sourceApp: null, // "frith" | "contactplus" | null
    sourceId: null,
    sourceDate: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  };
}

async function createTask(fields) {
  const task = blankTask(fields);
  await DocketDB.put("tasks", task);
  return task;
}

async function updateTask(id, patch) {
  const existing = await DocketDB.get("tasks", id);
  if (!existing) throw new Error("Task not found: " + id);
  const updated = { ...existing, ...patch };
  await DocketDB.put("tasks", updated);
  return updated;
}

async function deleteTask(id) {
  await DocketDB.delete("tasks", id);
}

async function completeTask(id, completed = true) {
  return updateTask(id, {
    status: completed ? "completed" : (await DocketDB.get("tasks", id)).scheduledDate ? "scheduled" : "backlog",
    completedAt: completed ? new Date().toISOString() : null,
  });
}

async function scheduleTask(id, dateStr, timeSlot = null) {
  return updateTask(id, { status: "scheduled", scheduledDate: dateStr, timeSlot: timeSlot });
}

async function unscheduleTask(id) {
  return updateTask(id, { status: "backlog", scheduledDate: null, timeSlot: null });
}

async function getBacklogTasks() {
  const all = await DocketDB.getByIndex("tasks", "status", "backlog");
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function getActiveTasksForQuadrant() {
  const all = await DocketDB.getAll("tasks");
  return all.filter(t => t.status !== "completed");
}

/** Ensures any eligible series occurrences for dateStr exist as real task rows. */
async function materializeSeriesForDate(dateStr) {
  const series = await DocketDB.getAll("taskSeries");
  const existingForDate = await DocketDB.getByIndex("tasks", "scheduledDate", dateStr);
  const existingSeriesIds = new Set(existingForDate.filter(t => t.seriesId).map(t => t.seriesId));

  for (const s of series) {
    if (existingSeriesIds.has(s.id)) continue;
    if (!Recurrence.isEligibleOnDate(s.rule, dateStr)) continue;
    await createTask({
      title: s.title,
      timeEstimateMinutes: s.timeEstimateMinutes,
      notes: s.notes || "",
      tagId: s.tagId || null,
      type: s.type || null,
      pomodoroRatio: s.pomodoroRatio || null,
      importance: s.importance || 0,
      urgency: s.urgency || 0,
      status: "scheduled",
      scheduledDate: dateStr,
      seriesId: s.id,
    });
  }
}

async function getTasksForDate(dateStr) {
  await materializeSeriesForDate(dateStr);
  const tasks = await DocketDB.getByIndex("tasks", "scheduledDate", dateStr);
  return tasks.sort((a, b) => {
    const aStart = a.timeSlot?.start || "99:99";
    const bStart = b.timeSlot?.start || "99:99";
    return aStart.localeCompare(bStart);
  });
}

async function getTasksForRange(fromDate, toDate) {
  let d = new Date(fromDate + "T00:00:00Z");
  const end = new Date(toDate + "T00:00:00Z");
  const byDate = {};
  while (d <= end) {
    const ds = d.toISOString().slice(0, 10);
    byDate[ds] = await getTasksForDate(ds);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return byDate;
}

async function createSeries(fields) {
  const series = {
    id: docketUid(),
    title: fields.title,
    timeEstimateMinutes: fields.timeEstimateMinutes || 30,
    notes: fields.notes || "",
    tagId: fields.tagId || null,
    type: fields.type || null,
    pomodoroRatio: fields.pomodoroRatio || null,
    importance: fields.importance || 0,
    urgency: fields.urgency || 0,
    rule: fields.rule, // { mode, weekday, intervalWeeks, intervalDays, dates, startDate, endDate }
  };
  await DocketDB.put("taskSeries", series);
  return series;
}

window.Tasks = {
  blankTask, createTask, updateTask, deleteTask, completeTask,
  scheduleTask, unscheduleTask, getBacklogTasks, getActiveTasksForQuadrant,
  getTasksForDate, getTasksForRange, materializeSeriesForDate, createSeries,
};
