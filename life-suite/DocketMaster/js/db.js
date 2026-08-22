/* DocketMaster — local data layer (IndexedDB) */

const DB_NAME = "docketmaster-db";
const DB_VERSION = 2;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains("tasks")) {
        const tasks = db.createObjectStore("tasks", { keyPath: "id" });
        tasks.createIndex("status", "status", { unique: false });
        tasks.createIndex("scheduledDate", "scheduledDate", { unique: false });
        tasks.createIndex("source", ["sourceApp", "sourceId", "sourceDate"], { unique: false });
        tasks.createIndex("seriesId", "seriesId", { unique: false });
      }

      if (!db.objectStoreNames.contains("taskSeries")) {
        db.createObjectStore("taskSeries", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("tags")) {
        db.createObjectStore("tags", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains("frithGoalSync")) {
        db.createObjectStore("frithGoalSync", { keyPath: "goalId" });
      }

      if (!db.objectStoreNames.contains("contactplusSync")) {
        db.createObjectStore("contactplusSync", { keyPath: "contactId" });
      }

      if (!db.objectStoreNames.contains("learneasySync")) {
        // keyPath "id" = `${moduleId}::${category}` where category is "assessments" | "materials"
        db.createObjectStore("learneasySync", { keyPath: "id" });
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

async function tx(storeNames, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    const stores = Array.isArray(storeNames)
      ? Object.fromEntries(storeNames.map(n => [n, t.objectStore(n)]))
      : t.objectStore(storeNames);
    let result;
    Promise.resolve(fn(stores)).then(r => { result = r; }).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  async getAll(store) {
    return tx(store, "readonly", (s) => reqToPromise(s.getAll()));
  },
  async get(store, key) {
    return tx(store, "readonly", (s) => reqToPromise(s.get(key)));
  },
  async put(store, value) {
    return tx(store, "readwrite", (s) => reqToPromise(s.put(value)));
  },
  async delete(store, key) {
    return tx(store, "readwrite", (s) => reqToPromise(s.delete(key)));
  },
  async getByIndex(store, indexName, value) {
    return tx(store, "readonly", (s) => reqToPromise(s.index(indexName).getAll(value)));
  },
  async clear(store) {
    return tx(store, "readwrite", (s) => reqToPromise(s.clear()));
  },
  raw: { openDB, tx, reqToPromise }
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function todayStr(tz) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Europe/London" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

window.DocketDB = DB;
window.docketUid = uid;
window.docketTodayStr = todayStr;
