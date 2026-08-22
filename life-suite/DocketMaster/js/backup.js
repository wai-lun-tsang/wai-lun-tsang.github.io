/* DocketMaster — manual full-data backup (JSON export/import)
   On-demand only, per the suite's no-background-sync convention. Also doubles
   as the "manual import" fallback for FRITH/ContactPlus data when same-origin
   auto-read isn't available (e.g. local file:// testing).
*/

async function exportBackup() {
  const [tasks, taskSeries, tags, settings, frithGoalSync, contactplusSync] = await Promise.all([
    DocketDB.getAll("tasks"),
    DocketDB.getAll("taskSeries"),
    DocketDB.getAll("tags"),
    DocketDB.getAll("settings"),
    DocketDB.getAll("frithGoalSync"),
    DocketDB.getAll("contactplusSync"),
  ]);
  const payload = {
    app: "DocketMaster", version: 1, exportedAt: new Date().toISOString(),
    tasks, taskSeries, tags, settings, frithGoalSync, contactplusSync,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `docketmaster-backup-${docketTodayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importBackup(jsonText, mode = "merge") {
  const data = JSON.parse(jsonText);
  if (data.app !== "DocketMaster") throw new Error("This file doesn't look like a DocketMaster backup.");

  if (mode === "replace") {
    await Promise.all(["tasks", "taskSeries", "tags", "settings", "frithGoalSync", "contactplusSync"].map(s => DocketDB.clear(s)));
  }

  for (const t of data.tasks || []) await DocketDB.put("tasks", t);
  for (const s of data.taskSeries || []) await DocketDB.put("taskSeries", s);
  for (const tag of data.tags || []) await DocketDB.put("tags", tag);
  for (const s of data.settings || []) await DocketDB.put("settings", s);
  for (const p of data.frithGoalSync || []) await DocketDB.put("frithGoalSync", p);
  for (const p of data.contactplusSync || []) await DocketDB.put("contactplusSync", p);

  return {
    tasksImported: (data.tasks || []).length,
    seriesImported: (data.taskSeries || []).length,
  };
}

/** Manual JSON import fallback for a raw FRITH goals export (array of goal objects)
    or a raw ContactPlus contacts export (array of contact objects), used when
    same-origin auto-read isn't available. Just stages the data for the sync
    prompt — doesn't create tasks directly, so the per-goal/per-contact toggle
    rules still apply. */
async function importExternalGoalsJSON(jsonText) {
  const goals = JSON.parse(jsonText);
  if (!Array.isArray(goals)) throw new Error("Expected a JSON array of FRITH goals.");
  window.__manualFrithGoals = goals; // staged in memory for this session
  return goals.length;
}

async function importExternalContactsJSON(jsonText) {
  const contacts = JSON.parse(jsonText);
  if (!Array.isArray(contacts)) throw new Error("Expected a JSON array of ContactPlus contacts.");
  window.__manualContactPlusContacts = contacts;
  return contacts.length;
}

window.Backup = { exportBackup, importBackup, importExternalGoalsJSON, importExternalContactsJSON };
