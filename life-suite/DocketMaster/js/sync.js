/* DocketMaster — read-only cross-app sync (FRITH / ContactPlus)

   IMPORTANT SAFETY RULES:
   - We only ever call indexedDB.open(name, 1) — the exact confirmed version
     of both source databases — and we NEVER attach an onupgradeneeded
     handler. If a database doesn't exist yet on this origin, opening it
     anyway would silently create an empty one and could stop the real app
     from ever initializing its own schema. So we first check for existence
     via indexedDB.databases() and skip entirely if it's not there or if the
     browser can't tell us (older Safari).
   - This module never writes to frith-db or contactplus-db. Read-only,
     always — confirmed as a deliberate product decision.
*/

const FRITH_DB = "frith-db";
const FRITH_VERSION = 1;
const CONTACTPLUS_DB = "contactplus-db";
const CONTACTPLUS_VERSION = 1;
const LEARNEASY_DB = "learneasy";
const LEARNEASY_VERSION = 1;

async function dbIsPresent(name) {
  if (!indexedDB.databases) return "unknown"; // can't safely check -> treat as unavailable
  try {
    const list = await indexedDB.databases();
    return list.some(d => d.name === name) ? "present" : "absent";
  } catch {
    return "unknown";
  }
}

function openReadOnly(name, version) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    // Deliberately no onupgradeneeded handler — see safety note above.
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
    req.onblocked = () => reject(new Error(name + " open blocked"));
  });
}

function getAllFrom(db, storeName) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) return resolve([]);
    const t = db.transaction(storeName, "readonly");
    const req = t.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function frithAvailable() {
  return (await dbIsPresent(FRITH_DB)) === "present";
}
async function contactPlusAvailable() {
  return (await dbIsPresent(CONTACTPLUS_DB)) === "present";
}
async function learnEasyAvailable() {
  return (await dbIsPresent(LEARNEASY_DB)) === "present";
}

async function readFrithData() {
  const db = await openReadOnly(FRITH_DB, FRITH_VERSION);
  try {
    const [goals, meta] = await Promise.all([
      getAllFrom(db, "goals"),
      getAllFrom(db, "meta"),
    ]);
    const settings = meta.find(m => m.key === "settings");
    return { goals, timezone: settings?.timezone || "Europe/London" };
  } finally {
    db.close();
  }
}

async function readContactPlusData() {
  const db = await openReadOnly(CONTACTPLUS_DB, CONTACTPLUS_VERSION);
  try {
    return await getAllFrom(db, "contacts");
  } finally {
    db.close();
  }
}

async function readLearnEasyData() {
  const db = await openReadOnly(LEARNEASY_DB, LEARNEASY_VERSION);
  try {
    const [nodes, assessments] = await Promise.all([
      getAllFrom(db, "nodes"),
      getAllFrom(db, "assessments"),
    ]);
    return { nodes, assessments };
  } finally {
    db.close();
  }
}

/** Finds any DocketMaster task already imported from a given source item,
    regardless of which date it was originally filed under — used for
    LearnEasy, where deadlines can shift (extensions) and materials aren't
    tied to a recurring date the way FRITH goals are. Uses the compound
    "source" index with a bound range over the sourceDate component. */
async function findExistingBySourceAppAndId(sourceApp, sourceId) {
  return DocketDB.raw.tx("tasks", "readonly", (s) => {
    return new Promise((resolve, reject) => {
      const idx = s.index("source");
      const range = IDBKeyRange.bound([sourceApp, sourceId, ""], [sourceApp, sourceId, "\uffff"]);
      const req = idx.getAll(range);
      req.onsuccess = () => resolve(req.result[0] || null);
      req.onerror = () => reject(req.error);
    });
  });
}

/** LearnEasy's Progress tree groups everything under a module. This finds
    the owning module node for any node by walking up parentId. */
function findModuleFor(nodesById, node) {
  let cur = node;
  while (cur) {
    if (cur.type === "module") return cur;
    cur = cur.parentId ? nodesById[cur.parentId] : null;
  }
  return null;
}

function computeEffectiveDeadline(assessment) {
  if (!assessment.deadline) return null;
  const base = new Date(assessment.deadline).getTime();
  const withExtension = base + (assessment.extensionMinutes || 0) * 60000;
  return new Date(withExtension);
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}
function toTimeStr(d) {
  return d.toISOString().slice(11, 16);
}

/** Groups importable LearnEasy items by module:
    { [moduleId]: { module, assessments: [...], materials: [...] } } */
function groupLearnEasyImportables({ nodes, assessments }) {
  const nodesById = Object.fromEntries(nodes.map(n => [n.id, n]));
  const byModule = {};

  const ensure = (moduleNode) => {
    if (!moduleNode) return null;
    if (!byModule[moduleNode.id]) byModule[moduleNode.id] = { module: moduleNode, assessments: [], materials: [] };
    return byModule[moduleNode.id];
  };

  // Unfinished, non-summative self-directed materials.
  for (const n of nodes) {
    if (n.type !== "material") continue;
    if (n.materialType === "Summative assessment") continue;
    const est = n.timeEstimateMinutes || 0;
    const done = n.timeDoneMinutes || 0;
    if (est > 0 && done >= est) continue; // already finished
    const mod = findModuleFor(nodesById, n);
    const bucket = ensure(mod);
    if (bucket) bucket.materials.push(n);
  }

  // Summative assessment deadlines not yet submitted.
  for (const a of assessments) {
    if (a.submittedAt) continue;
    if (!a.deadline) continue;
    const mod = nodesById[a.moduleId];
    const bucket = ensure(mod);
    if (bucket) bucket.assessments.push(a);
  }

  return byModule;
}

/** Runs a full LearnEasy sync pass (not scoped to a single date — LearnEasy
    items aren't recurring the way FRITH goals are). Safe to call repeatedly;
    existing imports are matched by sourceId and updated in place rather than
    duplicated (e.g. if an assessment's deadline shifts after an extension). */
async function syncLearnEasy() {
  const result = { autoImported: [], autoUpdated: [], pending: [], unavailable: false };
  if (!(await learnEasyAvailable())) { result.unavailable = true; return result; }

  const data = await readLearnEasyData();
  const byModule = groupLearnEasyImportables(data);
  const prefs = await DocketDB.getAll("learneasySync");
  const prefMap = Object.fromEntries(prefs.map(p => [p.id, p.mode]));
  const tags = await DocketDB.getAll("tags");
  const assessmentsTag = tags.find(t => t.name.toLowerCase() === "assessments");
  const learningTag = tags.find(t => t.name.toLowerCase() === "core learning");

  for (const moduleId in byModule) {
    const { module, assessments, materials } = byModule[moduleId];
    const modLabel = module.moduleCode ? `${module.moduleCode}` : module.name;

    const assessMode = prefMap[`${moduleId}::assessments`] || "never";
    if (assessMode !== "never") {
      for (const a of assessments) {
        const deadlineDate = computeEffectiveDeadline(a);
        const existing = await findExistingBySourceAppAndId("learneasy", a.id);
        if (existing) {
          if (assessMode === "auto" && existing.status !== "completed") {
            const patch = { title: `${modLabel} — ${a.name} due`, scheduledDate: toDateStr(deadlineDate), status: "scheduled" };
            await Tasks.updateTask(existing.id, patch);
            result.autoUpdated.push(existing.id);
          }
          continue;
        }
        if (assessMode === "auto") {
          const task = await Tasks.createTask({
            title: `${modLabel} — ${a.name} due`, timeEstimateMinutes: 60,
            status: "scheduled", scheduledDate: toDateStr(deadlineDate),
            tagId: assessmentsTag?.id || null, importance: 8, urgency: 6,
            sourceApp: "learneasy", sourceId: a.id, sourceDate: toDateStr(deadlineDate),
          });
          result.autoImported.push(task);
        } else if (assessMode === "ask") {
          result.pending.push({ kind: "learneasy-assessment", module, item: a, label: `${modLabel} — ${a.name} due (${toDateStr(deadlineDate)})`, deadlineDate });
        }
      }
    }

    const matMode = prefMap[`${moduleId}::materials`] || "never";
    if (matMode !== "never") {
      for (const m of materials) {
        const existing = await findExistingBySourceAppAndId("learneasy", m.id);
        if (existing) continue; // materials don't shift dates the way deadlines do — no update-in-place needed
        const remaining = Math.max(15, (m.timeEstimateMinutes || 30) - (m.timeDoneMinutes || 0));
        const scheduledDate = m.dateEnd ? toDateStr(new Date(m.dateEnd)) : null;
        if (matMode === "auto") {
          const task = await Tasks.createTask({
            title: `${modLabel} — ${m.name}`, timeEstimateMinutes: remaining,
            status: scheduledDate ? "scheduled" : "backlog", scheduledDate,
            tagId: learningTag?.id || null,
            sourceApp: "learneasy", sourceId: m.id, sourceDate: scheduledDate || "unscheduled",
          });
          result.autoImported.push(task);
        } else if (matMode === "ask") {
          result.pending.push({ kind: "learneasy-material", module, item: m, label: `${modLabel} — ${m.name}`, scheduledDate });
        }
      }
    }
  }

  return result;
}

async function alreadyImported(sourceApp, sourceId, sourceDate) {
  const matches = await DocketDB.getByIndex("tasks", "source", [sourceApp, sourceId, sourceDate]);
  return matches.length > 0;
}

/** Returns { autoImported: [...tasks created], pending: [...goals eligible + awaiting user choice] } */
async function syncFrithForDate(dateStr) {
  const result = { autoImported: [], pending: [], unavailable: false };
  if (!(await frithAvailable())) { result.unavailable = true; return result; }

  const { goals } = await readFrithData();
  const syncPrefs = await DocketDB.getAll("frithGoalSync");
  const prefMap = Object.fromEntries(syncPrefs.map(p => [p.goalId, p.mode]));

  for (const goal of goals) {
    const rule = {
      mode: goal.mode, weekday: goal.weekday, intervalWeeks: goal.intervalWeeks,
      intervalDays: goal.intervalDays, dates: goal.dates,
      startDate: goal.startDate, endDate: goal.endDate,
    };
    if (!Recurrence.isEligibleOnDate(rule, dateStr)) continue;

    const mode = prefMap[goal.id] || "never";
    if (mode === "never") continue;
    if (await alreadyImported("frith", goal.id, dateStr)) continue;

    if (mode === "auto") {
      const task = await Tasks.createTask({
        title: goal.name, timeEstimateMinutes: 30, status: "scheduled",
        scheduledDate: dateStr, sourceApp: "frith", sourceId: goal.id, sourceDate: dateStr,
      });
      result.autoImported.push(task);
    } else if (mode === "ask") {
      result.pending.push({ goal, dateStr });
    }
  }
  return result;
}

/** Best-effort recurrence check for a ContactPlus key date against dateStr.
    Reimplemented from the documented field shapes (recurring/date) since
    ContactPlus's exact nextOccurrence() source wasn't available to copy —
    flagged in the README as worth double-checking against ContactPlus directly. */
function keyDateMatchesDate(keyDate, dateStr) {
  if (!keyDate.date) return false;
  const [, m, d] = keyDate.date.split("-");
  const [, dm, dd] = dateStr.split("-");
  if (keyDate.recurring) return m === dm && d === dd;
  return keyDate.date === dateStr;
}

async function syncContactPlusForDate(dateStr) {
  const result = { autoImported: [], pending: [], unavailable: false };
  if (!(await contactPlusAvailable())) { result.unavailable = true; return result; }

  const contacts = await readContactPlusData();
  const syncPrefs = await DocketDB.getAll("contactplusSync");
  const prefMap = Object.fromEntries(syncPrefs.map(p => [p.contactId, p.mode]));
  const tags = await DocketDB.getAll("tags");
  const birthdayTag = tags.find(t => t.name.toLowerCase() === "birthdays");

  for (const contact of contacts) {
    const mode = prefMap[contact.id] || "never";
    if (mode === "never") continue;

    for (const kd of (contact.keyDates || [])) {
      if (!keyDateMatchesDate(kd, dateStr)) continue;
      if (await alreadyImported("contactplus", kd.id, dateStr)) continue;

      const title = `${contact.name} — ${kd.name}`;
      if (mode === "auto") {
        const task = await Tasks.createTask({
          title, timeEstimateMinutes: 15, status: "scheduled", scheduledDate: dateStr,
          tagId: birthdayTag?.id || null,
          sourceApp: "contactplus", sourceId: kd.id, sourceDate: dateStr,
        });
        result.autoImported.push(task);
      } else if (mode === "ask") {
        result.pending.push({ contact, keyDate: kd, dateStr });
      }
    }
  }
  return result;
}

window.Sync = {
  frithAvailable, contactPlusAvailable, learnEasyAvailable,
  readFrithData, readContactPlusData, readLearnEasyData,
  syncFrithForDate, syncContactPlusForDate, syncLearnEasy,
  alreadyImported, findExistingBySourceAppAndId,
  groupLearnEasyImportables, computeEffectiveDeadline, toDateStr,
};
