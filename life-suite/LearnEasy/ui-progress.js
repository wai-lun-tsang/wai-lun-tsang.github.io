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
    const sortMode = node.childSortMode || 'manual';
    const normalKids = kids.filter(k => !LE.isAssessmentLinked(k));
    const assessmentKids = kids.filter(k => LE.isAssessmentLinked(k));
    const sortedNormal = LE.sortNodesByMode(normalKids, sortMode);
    const sortedAssessment = LE.sortNodesByMode(assessmentKids, sortMode);

    html += `<div class="le-list-head">
      <span class="le-hint" style="margin-top:0">Sort</span>
      ${LE.sortModeSelector(sortMode, `LE.changeChildSortMode('${node.id}',`)}
    </div>`;

    html += LE.renderNodeGroup(sortedNormal, node.id, false, sortMode, nodesById, childrenByParent);

    if (sortedAssessment.length) {
      html += `<div class="le-group-separator"><span class="line"></span><span class="label">Assessments</span><span class="line"></span></div>`;
      html += LE.renderNodeGroup(sortedAssessment, node.id, true, sortMode, nodesById, childrenByParent);
    }
  }

  let addTypes = LE.CHILD_TYPES[node.type] || [];
  if (addTypes.includes('module')) {
    const yearId = node.type === 'year' ? node.id : (node.type === 'term' ? node.parentId : null);
    if (yearId != null) {
      const creditTotal = LE.yearModuleCreditTotal(yearId, allNodes);
      if (creditTotal >= LE.YEAR_CREDIT_CAP) {
        addTypes = addTypes.filter(t => t !== 'module');
        html += `<p class="le-hint" style="padding:0 18px">This year is already at ${creditTotal} of ${LE.YEAR_CREDIT_CAP} credits — no more modules can be added.</p>`;
      }
    }
  }
  if (addTypes.length) {
    html += `<div class="le-fab-row" style="display:flex;gap:8px;flex-wrap:wrap">`;
    addTypes.forEach(t => {
      const label = node.type === 'year' && t === 'module' ? 'Add full-year module' : `Add ${LE.TYPE_LABEL[t].toLowerCase()}`;
      html += `<button class="le-btn secondary small" onclick="LE.openNodeForm('${t}', null, '${node.id}')"><i class="ti ti-plus"></i> ${label}</button>`;
    });
    html += `</div>`;
  }

  container.innerHTML = html;
};

LE.renderNodeGroup = function (sortedKids, parentId, isAssessmentGroup, sortMode, nodesById, childrenByParent) {
  let html = `<div class="le-list">`;
  sortedKids.forEach((k, i) => {
    const kRollup = LE.rollupNode(k.id, nodesById, childrenByParent);
    const isModule = k.type === 'module';
    const isMaterial = k.type === 'material';
    const color = isModule ? LE.moduleColor(k, i) : '#D8D2C4';
    const kCountdown = LE.countdownLabel(k.dateStart, k.dateEnd);
    const subtitle = k.type === 'module' && k.moduleCode ? `${LE.escapeHtml(k.moduleCode)} · ${LE.escapeHtml(k.name)}` : LE.escapeHtml(k.name);
    const clickAction = isMaterial
      ? `LE.openNodeForm('material', '${k.id}', '${k.parentId}')`
      : `LE.navigateTo('${k.id}')`;
    const reorder = sortMode === 'manual'
      ? LE.reorderButtons(
          `LE.moveNode('${k.id}','${parentId}',${isAssessmentGroup},'up')`,
          `LE.moveNode('${k.id}','${parentId}',${isAssessmentGroup},'down')`,
          i === 0, i === sortedKids.length - 1)
      : '';
    html += `<div class="le-card" style="border-left-color:${color}">
      <div class="le-card-main" onclick="${clickAction}" style="cursor:pointer">
        <span class="le-card-title">${subtitle}</span>
        <div class="le-card-bar"><div style="width:${kRollup.progressPct}%;background:${color}"></div></div>
        <span class="le-card-meta">${LE.formatMinutes(kRollup.timeDoneMinutes)} done · ${LE.formatMinutes(Math.max(kRollup.timeEstimateMinutes - kRollup.timeDoneMinutes, 0))} left${kCountdown ? ' · ' + kCountdown : ''}</span>
      </div>
      ${reorder}
      <button class="le-btn secondary small" onclick="LE.openNodeForm('${k.type}', '${k.id}', '${k.parentId}')">Edit</button>
      ${!isMaterial ? `<span class="le-chevron" onclick="LE.navigateTo('${k.id}')" style="cursor:pointer">›</span>` : ''}
    </div>`;
  });
  html += `</div>`;
  return html;
};

LE.changeChildSortMode = async function (nodeId, mode) {
  const node = await LE.getNode(nodeId);
  node.childSortMode = mode;
  await LE.saveNode(node);
  LE.render();
};

LE.moveNode = async function (nodeId, parentId, isAssessmentGroup, direction) {
  const parent = await LE.getNode(parentId);
  if ((parent.childSortMode || 'manual') !== 'manual') return;
  const allChildren = await LE.getChildren(parentId);
  const group = allChildren.filter(c => LE.isAssessmentLinked(c) === isAssessmentGroup);
  const sorted = LE.sortNodesByMode(group, 'manual');
  const idx = sorted.findIndex(n => n.id === nodeId);
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (idx === -1 || swapIdx < 0 || swapIdx >= sorted.length) return;
  const a = sorted[idx], b = sorted[swapIdx];
  const tmp = a.order || 0; a.order = b.order || 0; b.order = tmp;
  await LE.saveNode(a);
  await LE.saveNode(b);
  LE.render();
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
  if (type === 'material' && isNew) {
    fields += `<div class="le-field"><label>Name</label><input id="f-name" value="" placeholder="e.g. 2023 past paper"></div>
    <div class="le-field"><label>Type</label>
      <select id="f-mtype">
        ${['Lecture notes', 'Past paper', 'Problem sheet', 'Seminar', 'Reading', 'Revision', 'Other'].map(o => `<option>${o}</option>`).join('')}
      </select>
    </div>
    <div class="le-field-row">
      <div class="le-field"><label>Time estimate (min)</label><input type="number" id="f-est" value="30"></div>
      <div class="le-field"><label>Time done (min)</label><input type="number" id="f-done" value="0"></div>
    </div>`;
  } else if (type === 'material' && !isNew) {
    fields += `<p style="margin:0 0 12px;font-size:14px;font-weight:500">${LE.escapeHtml(existing.name)}</p>
    ${existing.linkedAssessmentId ? `<p class="le-hint" style="margin-top:-8px">Synced from a summative assessment — edit its name, deadline, or mark from the Marks page. Only time logged here is editable.</p>` : ''}
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
  const isNew = !existing;
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
    if (isNew) {
      node.name = LE.fieldVal('f-name') || 'Untitled material';
      node.materialType = document.getElementById('f-mtype') ? document.getElementById('f-mtype').value : 'Other';
    }
    // editing an existing material only ever touches time, regardless of what's in the form
    node.timeEstimateMinutes = LE.fieldVal('f-est') ?? node.timeEstimateMinutes ?? 0;
    node.timeDoneMinutes = LE.fieldVal('f-done') ?? node.timeDoneMinutes ?? 0;
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
