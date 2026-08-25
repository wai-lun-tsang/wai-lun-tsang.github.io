/* ============================================================
   GinkgoBooks — app.js
   Plain vanilla JS, IndexedDB-only, no frameworks, no server.
   ============================================================ */

const DB_NAME = "ginkgobooks-db";
const DB_VERSION = 1;
const STORES = ["books", "statuses", "segments", "meta"];

const DEFAULT_STATUSES = [
  { name: "Owned",   isTerminal: false, order: 0 },
  { name: "Reading", isTerminal: false, order: 1 },
  { name: "Finished", isTerminal: true, order: 2 },
  { name: "DNF",      isTerminal: true, order: 3 }, // Did Not Finish — stopped before completing
];

let db = null;

/* ---------------- IndexedDB plumbing ---------------- */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const _db = e.target.result;
      if (!_db.objectStoreNames.contains("books")) _db.createObjectStore("books", { keyPath: "id" });
      if (!_db.objectStoreNames.contains("statuses")) _db.createObjectStore("statuses", { keyPath: "id" });
      if (!_db.objectStoreNames.contains("segments")) _db.createObjectStore("segments", { keyPath: "id" });
      if (!_db.objectStoreNames.contains("meta")) _db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(storeNames, mode = "readonly") {
  return db.transaction(storeNames, mode);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAll(store) {
  return reqToPromise(tx(store).objectStore(store).getAll());
}
function get(store, key) {
  return reqToPromise(tx(store).objectStore(store).get(key));
}
function put(store, value) {
  return reqToPromise(tx(store, "readwrite").objectStore(store).put(value));
}
function del(store, key) {
  return reqToPromise(tx(store, "readwrite").objectStore(store).delete(key));
}
function clearStore(store) {
  return reqToPromise(tx(store, "readwrite").objectStore(store).clear());
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
function nowIso() {
  return new Date().toISOString();
}

/* ---------------- Seed defaults on first run ---------------- */

async function seedIfNeeded() {
  const statuses = await getAll("statuses");
  if (statuses.length === 0) {
    for (const s of DEFAULT_STATUSES) {
      await put("statuses", { id: newId("st"), name: s.name, isTerminal: s.isTerminal, order: s.order });
    }
  }
  const settings = await get("meta", "settings");
  if (!settings) {
    await put("meta", { key: "settings", defaultSegmentMinutes: 50 });
  }
}

/* ---------------- In-memory cache (re-read after every mutation) ---------------- */

const cache = { books: [], statuses: [], segments: [], settings: null };

async function refreshCache() {
  const [books, statuses, segments, settings] = await Promise.all([
    getAll("books"), getAll("statuses"), getAll("segments"), get("meta", "settings"),
  ]);
  cache.books = books;
  cache.statuses = statuses.sort((a, b) => a.order - b.order);
  cache.segments = segments;
  cache.settings = settings;
}

function statusById(id) {
  return cache.statuses.find((s) => s.id === id) || null;
}

/* ---------------- Pace / segment engine ----------------
   Pace is never stored — recomputed on the fly from completed
   segments each time, the same approach FRITH uses for streaks. */

const FALLBACK_PACE_PAGES = 1;    // minutes per page, used until real data exists
const FALLBACK_PACE_DURATION = 1; // minutes per minute (1:1) — duration books track real time directly

function computePace(bookId, totalUnit) {
  const done = cache.segments.filter(
    (s) => s.bookId === bookId && s.actualMinutes != null && s.actualEndPosition != null
  );
  let totalMin = 0, totalPos = 0;
  for (const s of done) {
    totalMin += s.actualMinutes;
    totalPos += (s.actualEndPosition - s.startPosition);
  }
  if (totalPos > 0 && totalMin > 0) return totalMin / totalPos; // minutes per position-unit
  return totalUnit === "duration" ? FALLBACK_PACE_DURATION : FALLBACK_PACE_PAGES;
}

function currentPosition(bookId) {
  const segs = cache.segments.filter((s) => s.bookId === bookId).sort((a, b) => a.index - b.index);
  if (segs.length === 0) return 0;
  const last = segs[segs.length - 1];
  if (last.status === "completed" && last.actualEndPosition != null) return last.actualEndPosition;
  return last.status === "completed" ? last.endPositionPlanned : last.startPosition;
}

function nextSegmentIndex(bookId) {
  const segs = cache.segments.filter((s) => s.bookId === bookId);
  return segs.length === 0 ? 0 : Math.max(...segs.map((s) => s.index)) + 1;
}

async function generateNextSegment(book) {
  const targetMinutes = book.targetMinutesOverride || cache.settings.defaultSegmentMinutes || 50;
  const pace = computePace(book.id, book.totalUnit); // minutes per position-unit
  const startPosition = currentPosition(book.id);
  let positionCovered = pace > 0 ? targetMinutes / pace : 0;
  let endPositionPlanned = startPosition + positionCovered;

  const total = book.totalUnit === "pages" ? book.totalPages : book.totalUnit === "duration" ? book.totalMinutes : null;
  if (total != null) endPositionPlanned = Math.min(endPositionPlanned, total);

  const segment = {
    id: newId("s"),
    bookId: book.id,
    index: nextSegmentIndex(book.id),
    targetMinutes,
    startPosition,
    endPositionPlanned,
    status: "pending",
    actualEndPosition: null,
    actualMinutes: null,
    completedAt: null,
    completedBy: null,
    createdAt: nowIso(),
  };
  await put("segments", segment);
  await refreshCache();
  return segment;
}

async function completeSegmentManually(segmentId, actualEndPosition, actualMinutes) {
  const seg = cache.segments.find((s) => s.id === segmentId);
  if (!seg) return;
  seg.status = "completed";
  seg.actualEndPosition = actualEndPosition;
  seg.actualMinutes = actualMinutes;
  seg.completedAt = nowIso();
  seg.completedBy = "manual";
  await put("segments", seg);
  await refreshCache();
}

// Called when a book's status is set to a terminal status (e.g. Finished, DNF).
// Auto-closes remaining pending segments without fabricating measured pace data —
// they're excluded from pace calculations since actualMinutes/actualEndPosition stay null.
async function autoCloseRemainingSegments(bookId) {
  const pending = cache.segments.filter((s) => s.bookId === bookId && s.status === "pending");
  for (const seg of pending) {
    seg.status = "completed";
    seg.completedAt = nowIso();
    seg.completedBy = "auto";
    await put("segments", seg);
  }
  if (pending.length) await refreshCache();
}

/* ---------------- Books CRUD ---------------- */

async function saveBookFromForm() {
  const id = $("#bf-id").value || newId("b");
  const isNew = !$("#bf-id").value;
  const unit = document.querySelector('input[name="bf-total-unit"]:checked').value || null;

  const book = {
    id,
    title: $("#bf-title").value.trim(),
    author: $("#bf-author").value.trim(),
    formatLabel: $("#bf-format").value.trim(),
    statusId: $("#bf-status").value,
    tags: $("#bf-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
    totalUnit: unit || null,
    totalPages: unit === "pages" ? (parseInt($("#bf-total-pages").value, 10) || null) : null,
    totalMinutes: unit === "duration" ? (parseInt($("#bf-total-minutes").value, 10) || null) : null,
    targetMinutesOverride: parseInt($("#bf-target-override").value, 10) || null,
    createdAt: isNew ? nowIso() : (await get("books", id)).createdAt,
  };
  await put("books", book);
  await refreshCache();
  return book;
}

// Bulk add: one line per book, "Title" or "Title, Author". Everything else
// (format, total length, per-book tags) is left blank/null for later editing —
// status and tags below apply to the whole batch.
function parseBulkLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const commaIdx = trimmed.indexOf(",");
  if (commaIdx === -1) return { title: trimmed, author: "" };
  return { title: trimmed.slice(0, commaIdx).trim(), author: trimmed.slice(commaIdx + 1).trim() };
}

async function bulkAddBooks(rawText, statusId, tags) {
  const lines = rawText.split("\n").map(parseBulkLine).filter((b) => b && b.title);
  const createdAt = nowIso();
  for (const line of lines) {
    await put("books", {
      id: newId("b"),
      title: line.title,
      author: line.author,
      formatLabel: "",
      statusId,
      tags: tags.slice(),
      totalUnit: null,
      totalPages: null,
      totalMinutes: null,
      targetMinutesOverride: null,
      createdAt,
    });
  }
  await refreshCache();
  return lines.length;
}

async function deleteBook(bookId) {
  await del("books", bookId);
  const segs = cache.segments.filter((s) => s.bookId === bookId);
  for (const s of segs) await del("segments", s.id);
  await refreshCache();
}

/* ---------------- Statuses CRUD (settings) ---------------- */

async function addStatus(name, isTerminal) {
  const order = cache.statuses.length ? Math.max(...cache.statuses.map((s) => s.order)) + 1 : 0;
  await put("statuses", { id: newId("st"), name, isTerminal, order });
  await refreshCache();
}
async function updateStatus(id, patch) {
  const s = statusById(id);
  if (!s) return;
  Object.assign(s, patch);
  await put("statuses", s);
  await refreshCache();
}
async function deleteStatus(id) {
  const inUse = cache.books.some((b) => b.statusId === id);
  if (inUse) {
    toast("Can't delete a status that's still assigned to a book.");
    return;
  }
  await del("statuses", id);
  await refreshCache();
}

/* ---------------- Import / export ---------------- */

async function exportData() {
  const [books, statuses, segments, settings] = await Promise.all([
    getAll("books"), getAll("statuses"), getAll("segments"), get("meta", "settings"),
  ]);
  const payload = {
    exportedFrom: "GinkgoBooks",
    dbName: DB_NAME,
    dbVersion: DB_VERSION,
    exportedAt: nowIso(),
    books, statuses, segments,
    meta: settings ? [settings] : [],
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ginkgobooks-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importData(file) {
  const text = await file.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    toast("That file isn't valid JSON.");
    return;
  }
  if (!payload || !Array.isArray(payload.books) || !Array.isArray(payload.statuses) || !Array.isArray(payload.segments)) {
    toast("That file doesn't look like a GinkgoBooks export.");
    return;
  }
  const ok = confirm("This replaces ALL current GinkgoBooks data with the contents of this file. This can't be undone. Continue?");
  if (!ok) return;

  await Promise.all(STORES.map((s) => clearStore(s)));
  for (const b of payload.books) await put("books", b);
  for (const s of payload.statuses) await put("statuses", s);
  for (const seg of payload.segments) await put("segments", seg);
  for (const m of (payload.meta || [])) await put("meta", m);
  await seedIfNeeded(); // fills in defaults if the export was missing settings
  await refreshCache();
  toast("Import complete.");
  renderAll();
}

/* ---------------- UI helpers ---------------- */

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

let toastTimer = null;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

function showView(viewId) {
  $all(".view").forEach((v) => v.classList.add("hidden"));
  $(`#${viewId}`).classList.remove("hidden");
}

/* ---------------- Rendering: Library ---------------- */

function renderStatusFilterOptions() {
  const sel = $("#filter-status");
  const current = sel.value;
  sel.innerHTML = `<option value="">All statuses</option>` +
    cache.statuses.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  sel.value = current;
}
function renderTagFilterOptions() {
  const sel = $("#filter-tag");
  const current = sel.value;
  const tags = new Set();
  cache.books.forEach((b) => (b.tags || []).forEach((t) => tags.add(t)));
  sel.innerHTML = `<option value="">All shelves</option>` +
    Array.from(tags).sort().map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  sel.value = current;
}

function bookProgressText(book) {
  const pos = currentPosition(book.id);
  const total = book.totalUnit === "pages" ? book.totalPages : book.totalUnit === "duration" ? book.totalMinutes : null;
  const unitLabel = book.totalUnit === "pages" ? "pp" : book.totalUnit === "duration" ? "min" : "";
  if (total) {
    const pct = Math.min(100, Math.round((pos / total) * 100));
    return { pct, caption: `${pos}/${total}${unitLabel} · ${pct}%` };
  }
  return { pct: null, caption: pos > 0 ? `${pos}${unitLabel} so far` : "not started" };
}

function renderLibrary() {
  renderStatusFilterOptions();
  renderTagFilterOptions();

  const statusFilter = $("#filter-status").value;
  const tagFilter = $("#filter-tag").value;

  let books = [...cache.books].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  if (statusFilter) books = books.filter((b) => b.statusId === statusFilter);
  if (tagFilter) books = books.filter((b) => (b.tags || []).includes(tagFilter));

  const list = $("#library-list");
  list.innerHTML = "";
  $("#library-empty").classList.toggle("hidden", cache.books.length !== 0);

  books.forEach((book) => {
    const status = statusById(book.statusId);
    const { pct, caption } = bookProgressText(book);
    const card = document.createElement("div");
    card.className = "book-card";
    card.innerHTML = `
      <div class="status-chip">${escapeHtml(status ? status.name : "—")}</div>
      <h3>${escapeHtml(book.title || "Untitled")}</h3>
      <div class="author">${escapeHtml(book.author || "")}${book.formatLabel ? " · " + escapeHtml(book.formatLabel) : ""}</div>
      <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct != null ? pct : 0}%"></div></div>
      <div class="progress-caption">${caption}</div>
    `;
    card.addEventListener("click", () => openBookDetail(book.id));
    list.appendChild(card);
  });
}

/* ---------------- Rendering: Book form ---------------- */

function renderStatusSelectOptions(selectEl, selectedId) {
  selectEl.innerHTML = cache.statuses.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  if (selectedId) selectEl.value = selectedId;
}

function openBookForm(bookId) {
  const form = $("#book-form");
  form.reset();
  renderStatusSelectOptions($("#bf-status"), null);

  if (bookId) {
    const book = cache.books.find((b) => b.id === bookId);
    $("#book-form-title").textContent = "Edit book";
    $("#bf-id").value = book.id;
    $("#bf-title").value = book.title || "";
    $("#bf-author").value = book.author || "";
    $("#bf-format").value = book.formatLabel || "";
    renderStatusSelectOptions($("#bf-status"), book.statusId);
    $("#bf-tags").value = (book.tags || []).join(", ");
    const unitVal = book.totalUnit || "";
    const radio = document.querySelector(`input[name="bf-total-unit"][value="${unitVal}"]`);
    if (radio) radio.checked = true;
    $("#bf-total-pages").value = book.totalPages || "";
    $("#bf-total-minutes").value = book.totalMinutes || "";
    $("#bf-target-override").value = book.targetMinutesOverride || "";
    $("#btn-delete-book").classList.remove("hidden");
  } else {
    $("#book-form-title").textContent = "Add book";
    $("#bf-id").value = "";
    const defaultStatus = cache.statuses[0];
    if (defaultStatus) $("#bf-status").value = defaultStatus.id;
    $("#btn-delete-book").classList.add("hidden");
  }
  showView("view-book-form");
}

/* ---------------- Rendering: Book detail ---------------- */

let currentBookId = null;

function openBookDetail(bookId) {
  currentBookId = bookId;
  renderBookDetail();
  showView("view-book-detail");
}

function renderBookDetail() {
  const book = cache.books.find((b) => b.id === currentBookId);
  if (!book) { showView("view-library"); return; }

  $("#bd-title").textContent = book.title || "Untitled";
  $("#bd-author").textContent = [book.author, book.formatLabel].filter(Boolean).join(" · ");

  renderStatusSelectOptions($("#bd-status"), book.statusId);

  $("#bd-tags").innerHTML = (book.tags || [])
    .map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("");

  const { pct, caption } = bookProgressText(book);
  $("#bd-progress-figures").textContent = caption;
  const rect = $("#bd-clip-rect");
  const fillHeight = pct != null ? (pct / 100) * 44 : 0; // leaf visual is ~44 units tall inside the 52 viewBox
  rect.setAttribute("y", 46 - fillHeight);
  rect.setAttribute("height", fillHeight);

  renderSegmentsList(book);
}

function renderSegmentsList(book) {
  const segs = cache.segments.filter((s) => s.bookId === book.id).sort((a, b) => a.index - b.index);
  const container = $("#segments-list");
  container.innerHTML = "";

  if (segs.length === 0) {
    container.innerHTML = `<p class="hint">No segments yet — generate the first one below.</p>`;
    return;
  }

  segs.forEach((seg) => {
    const row = document.createElement("div");
    row.className = "segment-row" + (seg.status === "completed" ? " completed" : "");
    const unitLabel = book.totalUnit === "pages" ? "pp" : book.totalUnit === "duration" ? "min" : "";

    if (seg.status === "completed") {
      const src = seg.completedBy === "docketmaster" ? "via DocketMaster" : seg.completedBy === "auto" ? "auto-closed" : "manual";
      row.innerHTML = `
        <div class="segment-info">
          <span class="idx">#${seg.index + 1}</span> ·
          ${seg.startPosition}${unitLabel} → ${seg.actualEndPosition != null ? seg.actualEndPosition : "—"}${unitLabel}
          ${seg.actualMinutes != null ? ` · ${seg.actualMinutes} min` : ""} · ${src}
        </div>`;
    } else {
      row.innerHTML = `
        <div class="segment-info">
          <span class="idx">#${seg.index + 1}</span> ·
          ${seg.startPosition}${unitLabel} → ~${Math.round(seg.endPositionPlanned)}${unitLabel} planned
          (~${seg.targetMinutes} min)
        </div>
        <div class="segment-complete-form">
          <input type="number" placeholder="end ${unitLabel}" class="seg-end-input" value="${Math.round(seg.endPositionPlanned)}">
          <input type="number" placeholder="minutes" class="seg-min-input" value="${seg.targetMinutes}">
          <button class="btn btn-primary btn-complete-seg">Mark complete</button>
        </div>`;
      row.querySelector(".btn-complete-seg").addEventListener("click", async () => {
        const endPos = parseFloat(row.querySelector(".seg-end-input").value);
        const mins = parseFloat(row.querySelector(".seg-min-input").value);
        if (isNaN(endPos) || isNaN(mins)) { toast("Enter both a valid end position and minutes."); return; }
        await completeSegmentManually(seg.id, endPos, mins);
        renderBookDetail();
        renderLibrary();
      });
    }
    container.appendChild(row);
  });
}

/* ---------------- Rendering: Settings ---------------- */

function renderSettings() {
  const list = $("#statuses-list");
  list.innerHTML = "";
  cache.statuses.forEach((s) => {
    const row = document.createElement("div");
    row.className = "status-row";
    row.innerHTML = `
      <div>
        <span class="status-name">${escapeHtml(s.name)}</span>
        <div class="status-flags">${s.isTerminal ? "terminal — auto-closes segments" : "non-terminal"}</div>
      </div>
      <div class="status-actions">
        <button class="btn-rename">Rename</button>
        <button class="btn-toggle-terminal">${s.isTerminal ? "Unset terminal" : "Set terminal"}</button>
        <button class="btn-delete-status">Delete</button>
      </div>`;
    row.querySelector(".btn-rename").addEventListener("click", async () => {
      const name = prompt("Rename status", s.name);
      if (name && name.trim()) { await updateStatus(s.id, { name: name.trim() }); renderSettings(); renderLibrary(); }
    });
    row.querySelector(".btn-toggle-terminal").addEventListener("click", async () => {
      await updateStatus(s.id, { isTerminal: !s.isTerminal });
      renderSettings();
    });
    row.querySelector(".btn-delete-status").addEventListener("click", async () => {
      if (confirm(`Delete status "${s.name}"?`)) { await deleteStatus(s.id); renderSettings(); }
    });
    list.appendChild(row);
  });

  $("#settings-default-minutes").value = cache.settings ? cache.settings.defaultSegmentMinutes : 50;

  renderStatusSelectOptions($("#bulk-add-status"), $("#bulk-add-status").value || (cache.statuses[0] && cache.statuses[0].id));
}

/* ---------------- Misc ---------------- */

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderAll() {
  renderLibrary();
  renderSettings();
}

/* ---------------- Event wiring ---------------- */

function wireEvents() {
  $("#btn-go-library").addEventListener("click", () => { showView("view-library"); renderLibrary(); });
  $("#btn-go-settings").addEventListener("click", () => { showView("view-settings"); renderSettings(); });

  $("#btn-add-book").addEventListener("click", () => openBookForm(null));
  $("#btn-cancel-book-form").addEventListener("click", () => showView("view-library"));

  $("#book-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const book = await saveBookFromForm();
    renderLibrary();
    openBookDetail(book.id);
  });

  $("#btn-delete-book").addEventListener("click", async () => {
    const id = $("#bf-id").value;
    if (!id) return;
    if (confirm("Delete this book and all its segments? This can't be undone.")) {
      await deleteBook(id);
      showView("view-library");
      renderLibrary();
    }
  });

  $("#btn-edit-book").addEventListener("click", () => openBookForm(currentBookId));

  $("#bd-status").addEventListener("change", async (e) => {
    const book = cache.books.find((b) => b.id === currentBookId);
    book.statusId = e.target.value;
    await put("books", book);
    await refreshCache();
    const status = statusById(book.statusId);
    if (status && status.isTerminal) {
      await autoCloseRemainingSegments(book.id);
      toast(`Marked "${status.name}" — remaining segments closed.`);
    }
    renderBookDetail();
    renderLibrary();
  });

  $("#btn-generate-segment").addEventListener("click", async () => {
    const book = cache.books.find((b) => b.id === currentBookId);
    await generateNextSegment(book);
    renderBookDetail();
  });

  $("#filter-status").addEventListener("change", renderLibrary);
  $("#filter-tag").addEventListener("change", renderLibrary);

  $("#status-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#new-status-name").value.trim();
    if (!name) return;
    await addStatus(name, $("#new-status-terminal").checked);
    $("#status-add-form").reset();
    renderSettings();
  });

  $("#settings-default-minutes").addEventListener("change", async (e) => {
    const val = parseInt(e.target.value, 10);
    if (!val || val < 1) { toast("Enter a valid number of minutes."); return; }
    cache.settings.defaultSegmentMinutes = val;
    await put("meta", cache.settings);
    toast("Default segment length updated.");
  });

  $("#bulk-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("#bulk-add-text").value;
    const statusId = $("#bulk-add-status").value;
    const tags = $("#bulk-add-tags").value.split(",").map((t) => t.trim()).filter(Boolean);
    const count = await bulkAddBooks(text, statusId, tags);
    if (count === 0) { toast("No book titles found — one per line."); return; }
    $("#bulk-add-form").reset();
    toast(`Added ${count} book${count === 1 ? "" : "s"}.`);
    renderLibrary();
  });

  $("#btn-export").addEventListener("click", exportData);
  $("#btn-import").addEventListener("click", () => $("#import-file-input").click());
  $("#import-file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (file) await importData(file);
    e.target.value = "";
  });
}

/* ---------------- Boot ---------------- */

async function boot() {
  db = await openDB();
  await seedIfNeeded();
  await refreshCache();
  wireEvents();
  renderAll();
  showView("view-library");

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline shell is a nice-to-have, not critical */ });
  }
}

boot();
