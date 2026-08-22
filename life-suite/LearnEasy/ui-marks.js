var LE = window.LE = window.LE || {};

LE.finalYearNumberFor = function (route) { return route === 'MEng' ? 4 : 3; };

LE.renderMarks = async function (container) {
  const allNodes = await LE.getAllNodes();
  const { nodesById } = LE.buildIndexes(allNodes);
  const settings = await LE.getSettings();
  const assessments = await LE.getAllAssessments();

  const years = LE.visibleYears(allNodes.filter(n => n.type === 'year'), settings.programmeRoute);
  const modules = allNodes.filter(n => n.type === 'module');
  const assessmentsByModule = {};
  for (const a of assessments) (assessmentsByModule[a.moduleId] = assessmentsByModule[a.moduleId] || []).push(a);

  const finalYearNumber = LE.finalYearNumberFor(settings.programmeRoute);

  let html = '';
  const yearCYMs = [];
  let finalYearModulesForClassification = [];

  years.forEach(year => {
    const isFinalYear = year.yearNumber === finalYearNumber;
    const terms = allNodes.filter(n => n.type === 'term' && n.parentId === year.id).sort((a, b) => a.order - b.order);
    const fullYearModules = modules.filter(m => m.parentId === year.id).sort((a, b) => (a.order || 0) - (b.order || 0));
    const yearCreditTotal = LE.yearModuleCreditTotal(year.id, allNodes);

    // Year-level PYM/CYM needs every module belonging to this year, full-year or per-term, once each.
    const allYearModules = fullYearModules.concat(
      terms.flatMap(t => modules.filter(m => m.parentId === t.id))
    ).map(m => {
      const fig = LE.moduleFigures(assessmentsByModule[m.id] || [], settings);
      return { id: m.id, name: m.name, credit: m.creditValue || 15, mark: fig.allAssessments || 0 };
    });
    const yf = LE.yearFigures(allYearModules, isFinalYear);
    yearCYMs.push(yf.cym);
    if (isFinalYear) finalYearModulesForClassification = allYearModules;

    html += `<div class="le-section"><h2>${LE.escapeHtml(year.name)}${isFinalYear ? ' (Final Year)' : ''}</h2></div>`;
    html += `<div class="le-marks-cols">
      <div class="le-stat-card">
        <h3>Progression Year Mean vs Classification Year Mean</h3>
        <div class="le-stat-row"><span class="label">Progression Year Mean</span><span class="value ${LE.colourClass(yf.pym)}">${LE.fmtPct(yf.pym)}</span></div>
        <div class="le-stat-row"><span class="label">Classification Year Mean</span><span class="value ${LE.colourClass(yf.cym)}">${LE.fmtPct(yf.cym)}</span></div>
        ${yf.droppedModuleIds && yf.droppedModuleIds.length ? `<p class="le-hint">Dropped: ${yf.droppedModuleIds.map(id => LE.escapeHtml(nodesById[id]?.name || '?')).join(', ')}</p>` : ''}
      </div>
    </div>`;

    if (fullYearModules.length) {
      html += `<div class="le-list" style="padding-top:0">`;
      fullYearModules.forEach(m => { html += LE.renderModuleBlock(m, assessmentsByModule[m.id] || [], settings); });
      html += `</div>`;
    }
    if (yearCreditTotal >= LE.YEAR_CREDIT_CAP) {
      html += `<p class="le-hint" style="padding:0 18px 8px">This year is already at ${yearCreditTotal} of ${LE.YEAR_CREDIT_CAP} credits — no more modules can be added.</p>`;
    } else {
      html += `<div class="le-fab-row"><button class="le-btn secondary small" onclick="LE.openNodeForm('module', null, '${year.id}')"><i class="ti ti-plus"></i> Add full-year module</button></div>`;
    }

    terms.forEach(term => {
      const termModules = modules.filter(m => m.parentId === term.id).sort((a, b) => (a.order || 0) - (b.order || 0));
      const strictList = termModules.map(m => ({ id: m.id, credit: m.creditValue || 15, assessments: assessmentsByModule[m.id] || [] }));
      const inclusiveList = strictList.concat(fullYearModules.map(m => ({ id: m.id, credit: m.creditValue || 15, assessments: assessmentsByModule[m.id] || [] })));
      const tf = LE.termFigures(strictList, inclusiveList, settings);

      html += `<div class="le-section" style="padding-top:8px"><p class="le-sub" style="margin-bottom:8px"><strong style="color:var(--text)">${LE.escapeHtml(term.name)}</strong></p></div>`;
      html += `<div class="le-marks-cols two">
        <div class="le-stat-card">
          <h3>Strict (this term only)</h3>
          <div class="le-stat-row"><span class="label">Completed-only</span><span class="value ${LE.colourClass(tf.strict.completedOnly)}">${LE.fmtPct(tf.strict.completedOnly)}</span></div>
          <div class="le-stat-row"><span class="label">All assessments</span><span class="value ${LE.colourClass(tf.strict.allAssessments)}">${LE.fmtPct(tf.strict.allAssessments)}</span></div>
        </div>
        <div class="le-stat-card">
          <h3>Inclusive (+ full-year modules)</h3>
          <div class="le-stat-row"><span class="label">Completed-only</span><span class="value ${LE.colourClass(tf.inclusive.completedOnly)}">${LE.fmtPct(tf.inclusive.completedOnly)}</span></div>
          <div class="le-stat-row"><span class="label">All assessments</span><span class="value ${LE.colourClass(tf.inclusive.allAssessments)}">${LE.fmtPct(tf.inclusive.allAssessments)}</span></div>
        </div>
      </div>`;

      html += `<div class="le-list" style="padding-top:0">`;
      if (termModules.length === 0) html += `<p class="le-hint" style="padding:0 0 8px">No modules under this term yet.</p>`;
      termModules.forEach(m => { html += LE.renderModuleBlock(m, assessmentsByModule[m.id] || [], settings); });
      html += `</div>`;
      if (yearCreditTotal >= LE.YEAR_CREDIT_CAP) {
        html += `<p class="le-hint" style="padding:0 18px 8px">This year is already at ${yearCreditTotal} of ${LE.YEAR_CREDIT_CAP} credits — no more modules can be added.</p>`;
      } else {
        html += `<div class="le-fab-row"><button class="le-btn secondary small" onclick="LE.openNodeForm('module', null, '${term.id}')"><i class="ti ti-plus"></i> Add module</button></div>`;
      }
    });
  });

  // ---- Degree, at the bottom ----
  const df = LE.degreeFigures(yearCYMs, settings.programmeRoute);
  const classification = finalYearModulesForClassification.length ? LE.classify(df.fwm, finalYearModulesForClassification) : { class: null, note: 'insufficient data' };

  html += `<div class="le-section"><h2>Degree</h2><p class="le-sub">Summative only. ${settings.programmeRoute} route — change in Settings.</p></div>`;
  html += `<div class="le-marks-cols">
    <div class="le-stat-card">
      <h3>Final Weighted Mark</h3>
      ${df.rows.map(r => `<div class="le-stat-row"><span class="label">Year ${r.year} CYM × ${r.weight}</span><span class="value ${LE.colourClass(r.cym)}">${LE.fmtPct(r.cym)}</span></div>`).join('')}
      ${settings.fwmRoundingDisplay !== '2sf' ? `<div class="le-stat-row"><span class="label">FWM (2dp, UCL official)</span><span class="value ${LE.colourClass(df.fwm)}">${df.fwm2dp != null ? df.fwm2dp.toFixed(2) + '%' : '—'}</span></div>` : ''}
      ${settings.fwmRoundingDisplay !== '2dp' ? `<div class="le-stat-row"><span class="label">FWM (2sf)</span><span class="value ${LE.colourClass(df.fwm)}">${df.fwm2sf != null ? df.fwm2sf + '%' : '—'}</span></div>` : ''}
      <div class="le-stat-row"><span class="label">Classification</span><span class="value">${classification.class || '—'}</span></div>
      ${df.rows.length ? `<div class="le-formula">FWM = (${df.rows.map(r => `${r.cym.toFixed(2)}×${r.weight}`).join(' + ')}) ÷ ${df.totalWeight} = ${df.fwm != null ? df.fwm.toFixed(2) : '—'}%</div>` : ''}
      ${classification.note ? `<p class="le-hint">${classification.note}</p>` : ''}
    </div>
  </div>`;

  container.innerHTML = html;
};

LE.renderModuleBlock = function (m, modAssessments, settings) {
  const fig = LE.moduleFigures(modAssessments, settings);
  const sortMode = m.assessmentSortMode || 'manual';
  const sorted = LE.sortAssessmentsByMode(modAssessments, sortMode);
  const weightTotal = modAssessments.reduce((s, a) => s + (a.weightWithinModule || 0), 0);

  let html = `<div class="le-module-block">
    <div class="head">
      <span class="name">${m.moduleCode ? LE.escapeHtml(m.moduleCode) + ' · ' : ''}${LE.escapeHtml(m.name)}</span>
      <span class="pct ${LE.colourClass(fig.allAssessments)}">${LE.fmtPct(fig.allAssessments)} of 100%</span>
    </div>`;
  if (sorted.length > 1) {
    html += `<div class="le-list-head" style="padding:0 0 6px">
      <span class="le-hint" style="margin-top:0">Sort</span>
      ${LE.sortModeSelectorAssessments(sortMode, `LE.changeAssessmentSortMode('${m.id}',`)}
    </div>`;
  }
  sorted.forEach((a, i) => {
    const af = LE.assessmentFigures(a, settings);
    const { note } = LE.computePenalizedMark(a, settings);
    const extLabel = a.extensionMode === 'percentage' ? `+${a.extensionValue || 0}%` : (a.extensionValue ? `+${a.extensionValue}min` : '');
    const reorder = sortMode === 'manual'
      ? LE.reorderButtons(`LE.moveAssessment('${a.id}','${m.id}','up')`, `LE.moveAssessment('${a.id}','${m.id}','down')`, i === 0, i === sorted.length - 1)
      : '';
    html += `<div class="le-assessment-row">
      <div class="row1">
        ${reorder}
        <span class="name">${LE.escapeHtml(a.name)}</span>
        <span class="value ${LE.colourClass(af.obtainedPct)}">${af.penalizedMark != null ? af.penalizedMark.toFixed(1) : '—'} / ${a.maxMark}</span>
      </div>
      <div class="meta">
        weight ${a.weightWithinModule}% · obtained ${LE.fmtPct(af.obtainedPct)} · module % ${af.obtainedModulePct.toFixed(1)}/${af.totalModulePct}
        ${a.deadline ? ' · due ' + new Date(a.deadline).toLocaleString() : ''}
        ${extLabel ? ' · ' + extLabel + ' extension' : ''}
        ${note ? ' · ' + note : ''}
      </div>
      <div class="actions">
        <button class="le-btn secondary small" onclick="LE.openAssessmentForm('${a.id}', '${m.id}')">Edit</button>
        <button class="le-btn danger small" onclick="LE.deleteAssessmentConfirm('${a.id}')">Delete</button>
      </div>
    </div>`;
  });
  if (weightTotal >= 100) {
    html += `<p class="le-hint">Assessment weights already total ${weightTotal}% of this module — no more can be added without editing an existing one first.</p>`;
  } else {
    html += `<button class="le-btn secondary small" onclick="LE.openAssessmentForm(null, '${m.id}')"><i class="ti ti-plus"></i> Add assessment</button>`;
  }
  html += `</div>`;
  return html;
};

LE.changeAssessmentSortMode = async function (moduleId, mode) {
  const module = await LE.getNode(moduleId);
  module.assessmentSortMode = mode;
  await LE.saveNode(module);
  LE.render();
};

LE.moveAssessment = async function (assessmentId, moduleId, direction) {
  const module = await LE.getNode(moduleId);
  if ((module.assessmentSortMode || 'manual') !== 'manual') return;
  const siblings = await LE.getAssessmentsByModule(moduleId);
  const sorted = LE.sortAssessmentsByMode(siblings, 'manual');
  const idx = sorted.findIndex(a => a.id === assessmentId);
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (idx === -1 || swapIdx < 0 || swapIdx >= sorted.length) return;
  const a = sorted[idx], b = sorted[swapIdx];
  const tmp = a.order || 0; a.order = b.order || 0; b.order = tmp;
  await LE.saveAssessment(a);
  await LE.saveAssessment(b);
  LE.render();
};

// ---- assessment form ----
LE.openAssessmentForm = async function (assessmentId, moduleId) {
  const existing = assessmentId ? await LE.getAssessment(assessmentId) : null;
  const isNew = !existing;
  const allNodes = await LE.getAllNodes();
  const module = allNodes.find(n => n.id === moduleId);
  const parent = allNodes.find(n => n.id === module.parentId);
  const year = parent.type === 'year' ? parent : allNodes.find(n => n.id === parent.parentId);
  const yearTerms = allNodes.filter(n => n.type === 'term' && n.parentId === year.id);
  const defaultHomeTerm = parent.type === 'term' ? parent.id : (yearTerms[0] && yearTerms[0].id);

  const format = existing?.assessmentFormat || 'coursework';
  const extMode = existing?.extensionMode || 'minutes';

  const html = `<h2>${isNew ? 'Add' : 'Edit'} assessment</h2>
    <form onsubmit="return false">
      <div class="le-field"><label>Name</label><input id="a-name" value="${LE.escapeHtml(existing?.name || '')}" placeholder="e.g. Coursework 1"></div>
      <div class="le-field-row">
        <div class="le-field"><label>Weight within module (%)</label><input type="number" id="a-weight" value="${existing?.weightWithinModule ?? ''}"></div>
        <div class="le-field"><label>Max mark</label><input type="number" id="a-max" value="${existing?.maxMark ?? 100}"></div>
      </div>
      <div class="le-field"><label>Assessment format</label>
        <select id="a-format" onchange="LE.onAssessmentFormatChange()">${LE.ASSESSMENT_FORMATS.map(f => `<option value="${f.id}" ${format === f.id ? 'selected' : ''}>${f.label}</option>`).join('')}</select>
      </div>
      <div class="le-field" id="a-duration-field" style="display:${format === 'short_remote' ? '' : 'none'}">
        <label>Exam duration (minutes)</label>
        <input type="number" id="a-duration" value="${existing?.durationMinutes ?? ''}">
        <p class="le-hint">Needed to compute a percentage-based extension for a timed exam.</p>
      </div>
      <div class="le-field"><label>Home term (for term views)</label>
        <select id="a-homeTerm">${yearTerms.map(t => `<option value="${t.id}" ${(existing?.homeTermId || defaultHomeTerm) === t.id ? 'selected' : ''}>${LE.escapeHtml(t.name)}</option>`).join('')}</select>
      </div>
      <div class="le-field-row">
        <div class="le-field"><label>Deadline</label><input type="datetime-local" id="a-deadline" value="${LE.toLocalDatetimeValue(existing?.deadline)}"></div>
      </div>
      <div class="le-field"><label>Extension</label>
        <div class="le-field-row">
          <select id="a-ext-mode" style="max-width:130px">
            <option value="minutes" ${extMode === 'minutes' ? 'selected' : ''}>Minutes</option>
            <option value="percentage" ${extMode === 'percentage' ? 'selected' : ''}>% of duration</option>
          </select>
          <input type="number" id="a-ext-value" value="${existing?.extensionValue ?? 0}">
        </div>
        <p class="le-hint">Percentage mode has no effect on Coursework or In-person exam formats — there's no fixed duration to take a percentage of.</p>
      </div>
      <div class="le-field"><label>Submitted at (leave blank if not yet submitted)</label><input type="datetime-local" id="a-submitted" value="${LE.toLocalDatetimeValue(existing?.submittedAt)}"></div>
      <div class="le-field"><label>Raw mark (leave blank until graded)</label><input type="number" id="a-raw" value="${existing?.rawMark ?? ''}"></div>
      <p class="le-hint">The penalized mark (after any late deduction) is computed automatically and used everywhere else in the app.</p>
    </form>
    <div class="le-modal-actions">
      ${!isNew ? `<button class="le-btn danger" onclick="LE.deleteAssessmentConfirm('${assessmentId}')">Delete</button>` : ''}
      <button class="le-btn secondary" onclick="LE.closeModal()">Cancel</button>
      <button class="le-btn" onclick="LE.saveAssessmentForm(${isNew ? 'null' : `'${assessmentId}'`}, '${moduleId}')">Save</button>
    </div>`;
  LE.openModal(html);
};

LE.onAssessmentFormatChange = function () {
  const format = document.getElementById('a-format').value;
  document.getElementById('a-duration-field').style.display = format === 'short_remote' ? '' : 'none';
};

LE.saveAssessmentForm = async function (assessmentId, moduleId) {
  const existing = assessmentId ? await LE.getAssessment(assessmentId) : null;
  const a = existing ? { ...existing } : { id: LE.uuid(), moduleId, linkedMaterialId: null, order: (await LE.getAssessmentsByModule(moduleId)).length };
  a.name = LE.fieldVal('a-name') || 'Untitled assessment';
  a.weightWithinModule = LE.fieldVal('a-weight') ?? 0;
  a.maxMark = LE.fieldVal('a-max') ?? 100;
  a.assessmentFormat = document.getElementById('a-format').value;
  a.durationMinutes = LE.fieldVal('a-duration');
  a.homeTermId = document.getElementById('a-homeTerm').value;
  a.deadline = LE.fromLocalInput(LE.fieldVal('a-deadline'));
  a.extensionMode = document.getElementById('a-ext-mode').value;
  a.extensionValue = LE.fieldVal('a-ext-value') ?? 0;
  a.submittedAt = LE.fromLocalInput(LE.fieldVal('a-submitted'));
  a.rawMark = LE.fieldVal('a-raw');

  await LE.saveAssessment(a);
  await LE.syncAssessmentToProgress(a, moduleId);
  LE.closeModal();
  LE.render();
};

LE.deleteAssessmentConfirm = async function (assessmentId) {
  if (!confirm('Delete this assessment? Its linked Progress item will also be removed.')) return;
  await LE.deleteAssessment(assessmentId);
  LE.closeModal();
  LE.render();
};

// Summative assessments auto-sync to a linked Material node under the same module
LE.syncAssessmentToProgress = async function (assessment, moduleId) {
  const settings = await LE.getSettings();
  const { mark } = LE.computePenalizedMark(assessment, settings);
  let material = assessment.linkedMaterialId ? await LE.getNode(assessment.linkedMaterialId) : null;
  if (!material) {
    const siblingCount = (await LE.getChildren(moduleId)).length;
    material = {
      id: LE.uuid(), type: 'material', parentId: moduleId, order: siblingCount,
      timeEstimateMinutes: 60, timeDoneMinutes: 0, colorOverride: null,
    };
  }
  material.name = assessment.name;
  material.materialType = 'Summative assessment';
  material.dateEnd = assessment.deadline;
  material.timeDoneMinutes = mark != null ? material.timeEstimateMinutes : material.timeDoneMinutes;
  material.linkedAssessmentId = assessment.id;
  await LE.saveNode(material);
  if (!assessment.linkedMaterialId) {
    assessment.linkedMaterialId = material.id;
    await LE.saveAssessment(assessment);
  }
};
