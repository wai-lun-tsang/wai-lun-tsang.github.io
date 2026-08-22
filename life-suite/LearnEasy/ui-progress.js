var LE = window.LE = window.LE || {};

LE.CHILD_TYPES = {
  degree: [], // years are fixed curriculum structure; Year 4 only appears via the MEng toggle in Settings
  year: ['module'], // full-year modules go directly under a Year
  term: ['module'],
  module: ['chunk', 'material'],
  chunk: ['chunk', 'material'],
  material: [],
};

LE.TYPE_LABEL = { degree: 'Degree', year: 'Year', term: 'Term', module: 'Module', chunk: 'Chunk', material: 'Material' };

LE.breadcrumbPath = function (nodeId, nodesById) {
  const path = [];
  let cur = nodesById[nodeId];
  while (cur) { path.unshift(cur); cur = nodesById[cur.parentId]; }
  return path;
};

LE.navigateTo = function (nodeId) {
  LE.state.currentNodeId = nodeId;
  LE.render();
};

LE.renderProgress = async function (container) {
  const allNodes = await LE.getAllNodes();
  const { nodesById, childrenByParent } = LE.buildIndexes(allNodes);
  const settings = await LE.getSettings();

  let currentId = LE.state.currentNodeId || settings.defaultStartNodeId;
  if (!currentId || !nodesById[currentId]) {
    const root = allNodes.find(n => n.type === 'degree');
    currentId = root ? root.id : null;
  }
  LE.state.currentNodeId = currentId;

  if (!currentId) {
    container.innerHTML = `<div class="le-empty">No data yet.<br><button class="le-btn" onclick="LE.seedIfEmpty().then(LE.render)">Set up degree</button></div>`;
    return;
  }

  const node = nodesById[currentId];
  const path = LE.breadcrumbPath(currentId, nodesById);
  let kids = (childrenByParent[currentId] || []);
  if (node.type === 'degree') {
    kids = LE.visibleYears(kids, settings.programmeRoute);
  }
  const rollup = LE.rollupNode(currentId, nodesById, childrenByParent);
  const countdown = LE.countdownLabel(node.dateStart, node.dateEnd);
  const ended = countdown && countdown.startsWith('ended');

  const breadcrumbHtml = path.map((n, i) => {
    const isLast = i === path.length - 1;
    return `${i > 0 ? '<span class="sep">›</span>' : ''}<span class="crumb ${isLast ? 'current' : ''}" ${isLast ? '' : `onclick="LE.navigateTo('${n.id}')"`}>${LE.escapeHtml(n.name)}</span>`;
  }).join('');

  let html = `<div class="le-breadcrumb">${breadcrumbHtml}</div>`;
  html += `<div class="le-page-head">
    <h1>${LE.escapeHtml(node.name)}</h1>
    <div style="display:flex;align-items:center;gap:8px">
      ${countdown ? `<span class="le-pill ${ended ? 'ended' : ''}"><i class="ti ti-clock" aria-hidden="true"></i> ${countdown}</span>` : ''}
      <button class="le-btn secondary small" onclick="LE.openNodeForm('${node.type}', '${node.id}', '${node.parentId || ''}')">Edit</button>
    </div>
  </div>`;

  html += `<div class="le-progress-summary">
    <div class="le-progress-bar"><div style="width:${rollup.progressPct}%"></div></div>
    <div class="le-progress-meta">${LE.formatMinutes(rollup.timeDoneMinutes)} done · ${LE.formatMinutes(Math.max(rollup.timeEstimateMinutes - rollup.timeDoneMinutes, 0))} left · ${LE.formatMinutes(rollup.timeEstimateMinutes)} total</div>
  </div>`;

  if (kids.length === 0) {
    html += `<div class="le-empty">Nothing here yet.</div>`;
  } else {
    html += `<div class="le-list">`;
    kids.forEach((k, i) => {
      const kRollup = LE.rollupNode(k.id, nodesById, childrenByParent);
      const isModule = k.type === 'module';
      const color = isModule ? LE.moduleColor(k, i) : '#D8D2C4';
      const kCountdown = LE.countdownLabel(k.dateStart, k.dateEnd);
      const subtitle = k.type === 'module' && k.moduleCode ? `${LE.escapeHtml(k.moduleCode)} · ${LE.escapeHtml(k.name)}` : LE.escapeHtml(k.name);
      html += `<div class="le-card" style="border-left-color:${color}">
        <div class="le-card-main" onclick="LE.navigateTo('${k.id}')" style="cursor:pointer">
          <span class="le-card-title">${subtitle}</span>
          <div class="le-card-bar"><div style="width:${kRollup.progressPct}%;background:${color}"></div></div>
          <span class="le-card-meta">${LE.formatMinutes(kRollup.timeDoneMinutes)} done · ${LE.formatMinutes(Math.max(kRollup.timeEstimateMinutes - kRollup.timeDoneMinutes, 0))} left${kCountdown ? ' · ' + kCountdown : ''}</span>
        </div>
        <button class="le-btn secondary small" onclick="LE.openNodeForm('${k.type}', '${k.id}', '${k.parentId}')">Edit</button>
        <span class="le-chevron" onclick="LE.navigateTo('${k.id}')" style="cursor:pointer">›</span>
      </div>`;
    });
    html += `</div>`;
  }

  const addTypes = LE.CHILD_TYPES[node.type] || [];
  if (addTypes.length) {
    html += `<div class="le-fab-row" style="display:flex;gap:8px;flex-wrap:wrap">`;
    addTypes.forEach(t => {
      html += `<button class="le-btn secondary small" onclick="LE.openNodeForm('${t}', null, '${node.id}')"><i class="ti ti-plus"></i> Add ${LE.TYPE_LABEL[t].toLowerCase()}</button>`;
    });
    html += `</div>`;
  }

  container.innerHTML = html;
};

// ---- node add/edit form ----
LE.openNodeForm = async function (type, nodeId, parentId) {
  const existing = nodeId ? await LE.getNode(nodeId) : null;
  const isNew = !existing;
  const parentNode = parentId ? await LE.getNode(parentId) : null;
  let fields = '';

  if (type === 'module' && parentNode && parentNode.type === 'year') {
    fields += `<p class="le-hint">This module goes directly under ${LE.escapeHtml(parentNode.name)} — a full-year module, shown before Term 1 on the Marks page. Individual assessments can still be assigned to whichever term they're actually due in.</p>`;
  }

  if (type === 'degree') {
    fields += `<div class="le-field"><label>Degree name</label><input id="f-name" value="${LE.escapeHtml(existing?.name || '')}" placeholder="e.g. BSc Computer Science, UCL"></div>
    <p class="le-hint">You can also rename this from Settings.</p>`;
  }
  if (type === 'year' || type === 'term' || type === 'chunk') {
    fields += `<div class="le-field"><label>Name</label><input id="f-name" value="${LE.escapeHtml(existing?.name || '')}" placeholder="e.g. ${type === 'term' ? 'Term 1' : type === 'year' ? 'Year 1' : 'Recursion & induction'}"></div>`;
  }
  if (type === 'term' || type === 'chunk') {
    fields += `<div class="le-field-row">
      <div class="le-field"><label>Start date</label><input type="date" id="f-start" value="${LE.toLocalDateValue(existing?.dateStart)}"></div>
      <div class="le-field"><label>End date</label><input type="date" id="f-end" value="${LE.toLocalDateValue(existing?.dateEnd)}"></div>
    </div>
    <p class="le-hint">Optional. Powers the countdown pill on this ${type}'s page.</p>`;
  }
  if (type === 'module') {
    fields += `<div class="le-field"><label>Module name</label><input id="f-name" value="${LE.escapeHtml(existing?.name || '')}" placeholder="e.g. Principles of programming"></div>
    <div class="le-field-row">
      <div class="le-field"><label>Module code</label><input id="f-code" value="${LE.escapeHtml(existing?.moduleCode || '')}" placeholder="COMP0002"></div>
      <div class="le-field"><label>Credit value</label><input type="number" id="f-credit" value="${existing?.creditValue ?? 15}"></div>
    </div>
    <div class="le-field"><label>Card colour</label>
      <div class="le-color-swatches" id="f-color-swatches">
        ${LE.MODULE_PALETTE.map(c => `<div class="le-swatch ${existing?.colorOverride === c ? 'selected' : ''}" style="background:${c}" onclick="LE.selectSwatch('${c}')"></div>`).join('')}
        <div class="le-swatch ${!existing?.colorOverride ? 'selected' : ''}" style="background:#fff;border:1px solid var(--border)" title="Auto" onclick="LE.selectSwatch('')"></div>
      </div>
      <input type="hidden" id="f-color" value="${existing?.colorOverride || ''}">
    </div>`;
  }
  if (type === 'material') {
    fields += `<div class="le-field"><label>Name</label><input id="f-name" value="${LE.escapeHtml(existing?.name || '')}" placeholder="e.g. 2023 past paper"></div>
    <div class="le-field"><label>Type</label>
      <select id="f-mtype">
        ${['Lecture notes', 'Past paper', 'Problem sheet', 'Seminar', 'Reading', 'Revision', 'Other'].map(o => `<option ${existing?.materialType === o ? 'selected' : ''}>${o}</option>`).join('')}
      </select>
    </div>
    <div class="le-field-row">
      <div class="le-field"><label>Time estimate (min)</label><input type="number" id="f-est" value="${existing?.timeEstimateMinutes ?? 30}"></div>
      <div class="le-field"><label>Time done (min)</label><input type="number" id="f-done" value="${existing?.timeDoneMinutes ?? 0}"></div>
    </div>`;
  }

  const title = isNew ? `Add ${LE.TYPE_LABEL[type].toLowerCase()}` : `Edit ${LE.TYPE_LABEL[type].toLowerCase()}`;
  const canDelete = !isNew && ['module', 'chunk', 'material'].includes(type);
  const html = `<h2>${title}</h2>
    <form onsubmit="return false">${fields}</form>
    <div class="le-modal-actions">
      ${canDelete ? `<button class="le-btn danger" onclick="LE.deleteNodeConfirm('${nodeId}')">Delete</button>` : ''}
      <button class="le-btn secondary" onclick="LE.closeModal()">Cancel</button>
      <button class="le-btn" onclick="LE.saveNodeForm('${type}', ${nodeId ? `'${nodeId}'` : 'null'}, '${parentId}')">Save</button>
    </div>`;
  LE.openModal(html);
};

LE.selectSwatch = function (color) {
  document.getElementById('f-color').value = color;
  document.querySelectorAll('#f-color-swatches .le-swatch').forEach(el => el.classList.remove('selected'));
  event.target.classList.add('selected');
};

LE.saveNodeForm = async function (type, nodeId, parentId) {
  const existing = nodeId ? await LE.getNode(nodeId) : null;
  const siblingsCount = existing ? null : (await LE.getChildren(parentId)).length;

  const node = existing ? { ...existing } : {
    id: LE.uuid(), type, parentId, order: siblingsCount || 0,
    dateStart: null, dateEnd: null, timeEstimateMinutes: 0, timeDoneMinutes: 0, progressPct: 0, colorOverride: null,
  };

  if (['degree', 'year', 'term', 'chunk'].includes(type)) node.name = LE.fieldVal('f-name') || node.name || 'Untitled';
  if (['term', 'chunk'].includes(type)) {
    node.dateStart = LE.fromLocalInput(LE.fieldVal('f-start'));
    node.dateEnd = LE.fromLocalInput(LE.fieldVal('f-end'));
  }
  if (type === 'module') {
    node.name = LE.fieldVal('f-name') || 'Untitled module';
    node.moduleCode = LE.fieldVal('f-code') || '';
    node.creditValue = LE.fieldVal('f-credit') ?? 15;
    const color = LE.fieldVal('f-color');
    node.colorOverride = color || null;
  }
  if (type === 'material') {
    node.name = LE.fieldVal('f-name') || 'Untitled material';
    node.materialType = document.getElementById('f-mtype').value;
    node.timeEstimateMinutes = LE.fieldVal('f-est') ?? 0;
    node.timeDoneMinutes = LE.fieldVal('f-done') ?? 0;
  }

  await LE.saveNode(node);
  LE.closeModal();
  LE.render();
};

LE.deleteNodeConfirm = async function (nodeId) {
  if (!confirm('Delete this and everything inside it? This cannot be undone.')) return;
  const node = await LE.getNode(nodeId);
  await LE.deleteNode(nodeId);
  LE.closeModal();
  if (LE.state.currentNodeId === nodeId) LE.state.currentNodeId = node.parentId;
  LE.render();
};
