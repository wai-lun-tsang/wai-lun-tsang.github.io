var LE = window.LE = window.LE || {};

LE.MODULE_PALETTE = ['#D85A30', '#1D9E75', '#534AB7', '#C99A2E', '#3D7BD9', '#A64AA1', '#4A9B8E', '#B0563C'];

LE.logoSVG = function (size = 22, strokeWidth = 9) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="42" fill="none" stroke="#1A1A18" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-dasharray="145 264" opacity="0.9" transform="rotate(-90 50 50)"/>
    <circle cx="50" cy="50" r="30" fill="none" stroke="#1A1A18" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-dasharray="141 189" opacity="0.6" transform="rotate(-90 50 50)"/>
    <circle cx="50" cy="50" r="18" fill="none" stroke="#1A1A18" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-dasharray="45 113" transform="rotate(-90 50 50)"/>
  </svg>`;
};

LE.escapeHtml = function (str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
};

LE.moduleColor = function (moduleNode, siblingIndex) {
  if (moduleNode && moduleNode.colorOverride) return moduleNode.colorOverride;
  return LE.MODULE_PALETTE[(siblingIndex || 0) % LE.MODULE_PALETTE.length];
};

// Natural sort: "Item 2" before "Item 10", not lexicographic.
LE.naturalCompare = function (a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
};

LE.sortNodesByMode = function (nodes, mode) {
  const list = nodes.slice();
  if (mode === 'alpha') return list.sort((a, b) => LE.naturalCompare(a.name, b.name));
  if (mode === 'date') return list.sort((a, b) => {
    const da = a.dateEnd || a.dateStart, db = b.dateEnd || b.dateStart;
    if (!da && !db) return (a.order || 0) - (b.order || 0);
    if (!da) return 1;
    if (!db) return -1;
    return new Date(da) - new Date(db);
  });
  return list.sort((a, b) => (a.order || 0) - (b.order || 0)); // manual
};

LE.sortAssessmentsByMode = function (assessments, mode) {
  const list = assessments.slice();
  if (mode === 'alpha') return list.sort((a, b) => LE.naturalCompare(a.name, b.name));
  if (mode === 'deadline') return list.sort((a, b) => {
    if (!a.deadline && !b.deadline) return (a.order || 0) - (b.order || 0);
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return new Date(a.deadline) - new Date(b.deadline);
  });
  return list.sort((a, b) => (a.order || 0) - (b.order || 0)); // manual
};

// Renders a small "Sort: [mode]" selector. onChangeFn is a global function name string called with the new mode.
LE.sortModeSelector = function (currentMode, onChangeFn) {
  const modes = [['manual', 'Manual'], ['alpha', 'Alphabetical'], ['date', 'Date']];
  return `<select class="le-sort-select" onchange="${onChangeFn}this.value)">
    ${modes.map(([v, l]) => `<option value="${v}" ${currentMode === v ? 'selected' : ''}>${l}</option>`).join('')}
  </select>`;
};
LE.sortModeSelectorAssessments = function (currentMode, onChangeFn) {
  const modes = [['manual', 'Manual'], ['alpha', 'Alphabetical'], ['deadline', 'Deadline']];
  return `<select class="le-sort-select" onchange="${onChangeFn}this.value)">
    ${modes.map(([v, l]) => `<option value="${v}" ${currentMode === v ? 'selected' : ''}>${l}</option>`).join('')}
  </select>`;
};

LE.reorderButtons = function (moveUpFn, moveDownFn, isFirst, isLast) {
  return `<span class="le-reorder">
    <button class="le-reorder-btn" ${isFirst ? 'disabled' : ''} onclick="event.stopPropagation(); ${moveUpFn}">▲</button>
    <button class="le-reorder-btn" ${isLast ? 'disabled' : ''} onclick="event.stopPropagation(); ${moveDownFn}">▼</button>
  </span>`;
};
LE.openModal = function (innerHtml) {
  LE.closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'le-modal-backdrop';
  backdrop.id = 'le-modal-backdrop';
  backdrop.innerHTML = `<div class="le-modal">${innerHtml}</div>`;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) LE.closeModal(); });
  document.body.appendChild(backdrop);
};
LE.closeModal = function () {
  const el = document.getElementById('le-modal-backdrop');
  if (el) el.remove();
};

LE.fieldVal = function (id) {
  const el = document.getElementById(id);
  if (!el) return null;
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') return el.value === '' ? null : Number(el.value);
  return el.value === '' ? null : el.value;
};

LE.toLocalDatetimeValue = function (iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
LE.toLocalDateValue = function (iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
LE.fromLocalInput = function (val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d) ? null : d.toISOString();
};

LE.fmtPct = function (pct) {
  if (pct == null || isNaN(pct)) return '—';
  return pct.toFixed(1) + '%';
};
