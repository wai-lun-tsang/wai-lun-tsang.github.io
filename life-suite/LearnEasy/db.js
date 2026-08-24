// LearnEasy — IndexedDB layer
// Database: learneasy
// Stores: nodes (Progress tree), assessments (Marks, summative only), settings (single record)

var LE = window.LE = window.LE || {};

LE.DB_NAME = 'learneasy';
LE.DB_VERSION = 1;
let _dbPromise = null;

LE.openDB = function () {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(LE.DB_NAME, LE.DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('nodes')) {
        const nodes = db.createObjectStore('nodes', { keyPath: 'id' });
        nodes.createIndex('parentId', 'parentId', { unique: false });
        nodes.createIndex('type', 'type', { unique: false });
        nodes.createIndex('released', 'released', { unique: false });
      }
      if (!db.objectStoreNames.contains('assessments')) {
        const a = db.createObjectStore('assessments', { keyPath: 'id' });
        a.createIndex('moduleId', 'moduleId', { unique: false });
        a.createIndex('homeTermId', 'homeTermId', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return _dbPromise;
};

function tx(storeName, mode) {
  return LE.openDB().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

LE.uuid = function () {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
};

// ---- generic store helpers ----
LE.dbGet = async (store, id) => reqToPromise((await tx(store, 'readonly')).get(id));
LE.dbGetAll = async (store) => reqToPromise((await tx(store, 'readonly')).getAll());
LE.dbPut = async (store, value) => reqToPromise((await tx(store, 'readwrite')).put(value));
LE.dbDelete = async (store, id) => reqToPromise((await tx(store, 'readwrite')).delete(id));
LE.dbGetByIndex = async (store, index, value) =>
  reqToPromise((await tx(store, 'readonly')).index(index).getAll(value));
LE.dbClear = async (store) => reqToPromise((await tx(store, 'readwrite')).clear());

// ---- nodes ----
LE.getNode = (id) => LE.dbGet('nodes', id);
LE.getChildren = (parentId) => LE.dbGetByIndex('nodes', 'parentId', parentId);
LE.getAllNodes = () => LE.dbGetAll('nodes');
LE.saveNode = (node) => LE.dbPut('nodes', node);
LE.deleteNode = async (id) => {
  const children = await LE.getChildren(id);
  for (const c of children) await LE.deleteNode(c.id);
  await LE.dbDelete('nodes', id);
};

// ---- assessments ----
LE.getAssessment = (id) => LE.dbGet('assessments', id);
LE.getAllAssessments = () => LE.dbGetAll('assessments');
LE.getAssessmentsByModule = (moduleId) => LE.dbGetByIndex('assessments', 'moduleId', moduleId);
LE.saveAssessment = (a) => LE.dbPut('assessments', a);
LE.deleteAssessment = async (id) => {
  const a = await LE.getAssessment(id);
  if (a && a.linkedMaterialId) await LE.deleteNode(a.linkedMaterialId);
  await LE.dbDelete('assessments', id);
};

// ---- settings (single record, key='app') ----
LE.DEFAULT_SETTINGS = {
  key: 'app',
  defaultStartNodeId: null,
  programmeRoute: 'BSc',
  fwmRoundingDisplay: 'both',
  defaultExtension: {
    assignments: { enabled: false, mode: 'minutes', value: 0 },
    exams: { enabled: false, mode: 'minutes', value: 0 },
  },
};

function backfillExtensionBucket(bucket) {
  bucket = bucket || {};
  return {
    enabled: !!bucket.enabled,
    mode: bucket.mode === 'percentage' ? 'percentage' : 'minutes',
    value: bucket.value != null ? bucket.value : (bucket.minutes != null ? bucket.minutes : 0), // 'minutes' = old field name, for backward compatibility
  };
}

LE.getSettings = async () => {
  const s = await LE.dbGet('settings', 'app');
  const base = s || { ...LE.DEFAULT_SETTINGS };
  base.defaultExtension = {
    assignments: backfillExtensionBucket(base.defaultExtension && base.defaultExtension.assignments),
    exams: backfillExtensionBucket(base.defaultExtension && base.defaultExtension.exams),
  };
  return base;
};
LE.saveSettings = (s) => LE.dbPut('settings', { ...s, key: 'app' });

// ---- seed: root Degree node + Year 1-3 / Term 1-2 skeleton, only if DB is empty ----
// One-off cleanup for databases seeded by an earlier version that still included Term 3
// (UCL's Term 3 is exam period only, never a taught term). Cascades to any modules/
// chunks/materials/assessments that had been created under a stray Term 3.
LE.migrateRemoveTerm3 = async function () {
  const allNodes = await LE.getAllNodes();
  const term3s = allNodes.filter(n => n.type === 'term' && n.name === 'Term 3');
  for (const t of term3s) {
    const orphanModules = allNodes.filter(n => n.type === 'module' && n.parentId === t.id);
    for (const m of orphanModules) {
      const assessmentsToRemove = await LE.getAssessmentsByModule(m.id);
      for (const a of assessmentsToRemove) await LE.dbDelete('assessments', a.id);
    }
    await LE.deleteNode(t.id); // cascades to modules/chunks/materials under it
  }
};

LE.YEAR_NAMES = { 1: 'Year 1', 2: 'Year 2', 3: 'Year 3', 4: 'Year 4' };
LE.TERM_NAMES = ['Term 1', 'Term 2']; // Term 3 doesn't teach — exam period only, not a taught term

let _seedPromise = null;
LE.seedIfEmpty = function () {
  if (_seedPromise) return _seedPromise; // guards against any duplicate concurrent init call
  _seedPromise = (async () => {
    const nodes = await LE.getAllNodes();
    if (nodes.length > 0) return;

    const degreeId = LE.uuid();
    await LE.saveNode({
      id: degreeId, type: 'degree', parentId: null, name: 'BSc Computer Science, UCL',
      order: 0, dateStart: null, dateEnd: null,
      timeEstimateMinutes: 0, timeDoneMinutes: 0, progressPct: 0, colorOverride: null,
    });

    for (let yn = 1; yn <= 3; yn++) {
      await LE.createYear(degreeId, yn);
    }

    const settings = await LE.getSettings();
    settings.defaultStartNodeId = degreeId;
    await LE.saveSettings(settings);
  })();
  return _seedPromise;
};

// Replaces ALL current data with a previously exported JSON backup (the same shape
// Settings → Export JSON produces: { nodes, assessments, settings }). Destructive —
// callers are responsible for confirming with the user first.
LE.importFullBackup = async (data) => {
  if (!data || typeof data !== 'object' || !Array.isArray(data.nodes)) {
    throw new Error('Not a valid LearnEasy backup file — missing a "nodes" array.');
  }
  await LE.dbClear('nodes');
  await LE.dbClear('assessments');
  await LE.dbClear('settings');

  for (const n of data.nodes) await LE.dbPut('nodes', n);
  for (const a of (data.assessments || [])) await LE.dbPut('assessments', a);
  if (data.settings && typeof data.settings === 'object') {
    await LE.dbPut('settings', { ...data.settings, key: 'app' });
  }

  await LE.seedIfEmpty(); // safety net — only acts if the file somehow had zero nodes
};
// Returns years visible under the current programme route (Year 4 hidden, not deleted, when BSc)
LE.visibleYears = function (allYears, programmeRoute) {
  const maxYear = programmeRoute === 'MEng' ? 4 : 3;
  return allYears.filter(y => (y.yearNumber || 0) <= maxYear).sort((a, b) => a.order - b.order);
};
LE.createYear = async (degreeId, yearNumber) => {
  const existing = (await LE.getChildren(degreeId)).find(n => n.type === 'year' && n.yearNumber === yearNumber);
  if (existing) return existing;

  const yearId = LE.uuid();
  await LE.saveNode({
    id: yearId, type: 'year', parentId: degreeId, name: LE.YEAR_NAMES[yearNumber] || `Year ${yearNumber}`,
    yearNumber, order: yearNumber - 1,
    dateStart: null, dateEnd: null, timeEstimateMinutes: 0, timeDoneMinutes: 0, progressPct: 0, colorOverride: null,
  });
  for (let ti = 0; ti < LE.TERM_NAMES.length; ti++) {
    await LE.saveNode({
      id: LE.uuid(), type: 'term', parentId: yearId, name: LE.TERM_NAMES[ti], order: ti,
      dateStart: null, dateEnd: null, timeEstimateMinutes: 0, timeDoneMinutes: 0, progressPct: 0, colorOverride: null,
    });
  }
  return LE.getNode(yearId);
};
