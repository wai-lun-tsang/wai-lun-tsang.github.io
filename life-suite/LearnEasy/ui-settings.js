var LE = window.LE = window.LE || {};

LE.renderSettings = async function (container) {
  const allNodes = await LE.getAllNodes();
  const { nodesById, childrenByParent } = LE.buildIndexes(allNodes);
  const settings = await LE.getSettings();

  const degree = allNodes.find(n => n.type === 'degree');
  const visibleYearIds = new Set(LE.visibleYears(allNodes.filter(n => n.type === 'year'), settings.programmeRoute).map(y => y.id));

  function depthOptions(nodeId, depth) {
    const node = nodesById[nodeId];
    if (!node) return '';
    if (node.type === 'year' && !visibleYearIds.has(node.id)) return ''; // hidden Year 4 under BSc — data kept, just not selectable
    let out = `<option value="${node.id}" ${settings.defaultStartNodeId === node.id ? 'selected' : ''}>${'—'.repeat(depth)} ${LE.escapeHtml(node.name)}</option>`;
    const kids = (childrenByParent[node.id] || []);
    kids.forEach(k => { out += depthOptions(k.id, depth + 1); });
    return out;
  }
  const startOptions = degree ? depthOptions(degree.id, 0) : '';

  const ext = settings.defaultExtension;

  function extensionFields(bucket, label, hint) {
    const b = ext[bucket];
    return `
      <div class="le-toggle-row">
        <label>Apply to summative ${label}</label>
        <label class="le-switch"><input type="checkbox" id="s-ext-${bucket}-enabled" ${b.enabled ? 'checked' : ''}><span class="slider"></span></label>
      </div>
      <div class="le-field-row">
        <div class="le-field"><label>Mode</label>
          <select id="s-ext-${bucket}-mode">
            <option value="minutes" ${b.mode === 'minutes' ? 'selected' : ''}>Minutes</option>
            <option value="percentage" ${b.mode === 'percentage' ? 'selected' : ''}>% of duration</option>
          </select>
        </div>
        <div class="le-field"><label>Value</label><input type="number" id="s-ext-${bucket}-value" value="${b.value || 0}"></div>
      </div>
      ${hint ? `<p class="le-hint">${hint}</p>` : ''}
    `;
  }

  container.innerHTML = `
    <div class="le-section"><h2>Settings</h2></div>

    <div class="le-marks-cols">
      <div class="le-stat-card">
        <h3>Navigation</h3>
        <div class="le-field">
          <label>Default page on open</label>
          <select id="s-start">${startOptions}</select>
        </div>
      </div>

      <div class="le-stat-card">
        <h3>Degree</h3>
        <div class="le-field">
          <label>Degree name</label>
          <input id="s-degree-name" value="${LE.escapeHtml(degree?.name || '')}" placeholder="e.g. BSc Computer Science, UCL">
        </div>
        <div class="le-field">
          <label>Route</label>
          <select id="s-route" onchange="LE.onRouteChange(this.value)">
            <option value="BSc" ${settings.programmeRoute === 'BSc' ? 'selected' : ''}>BSc (3 year)</option>
            <option value="MEng" ${settings.programmeRoute === 'MEng' ? 'selected' : ''}>MEng (4 year)</option>
          </select>
        </div>
        <p class="le-hint">Switching to MEng adds Year 4 (created once, then just shown/hidden after). Switching back to BSc hides Year 4 everywhere but keeps its data — nothing is deleted.</p>
        <div class="le-field">
          <label>Final Weighted Mark rounding shown</label>
          <select id="s-round">
            <option value="both" ${settings.fwmRoundingDisplay === 'both' ? 'selected' : ''}>Both (2dp and 2sf)</option>
            <option value="2dp" ${settings.fwmRoundingDisplay === '2dp' ? 'selected' : ''}>UCL official (2 decimal places)</option>
            <option value="2sf" ${settings.fwmRoundingDisplay === '2sf' ? 'selected' : ''}>2 significant figures</option>
          </select>
        </div>
      </div>

      <div class="le-stat-card">
        <h3>Default extensions</h3>
        <p class="le-sub" style="margin-bottom:10px">Automatically added to every summative item's deadline before the late-penalty engine runs, on top of any manual per-assessment extension. Assignments and exams are set separately, each in either minutes or a percentage of the assessment's duration (percentage only has an effect on timed formats — see each assessment's format).</p>
        ${extensionFields('assignments', 'assignments', null)}
        <hr class="le-divider">
        ${extensionFields('exams', 'exams', '"Exams" means the timed-online-exam format; in-person exams have no late-submission mechanism to extend.')}
      </div>

      <div class="le-stat-card">
        <h3>Data</h3>
        <button class="le-btn secondary" onclick="LE.exportData('json')">Export JSON</button>
        <button class="le-btn secondary" style="margin-left:8px" onclick="LE.exportData('csv')">Export CSV</button>
        <p class="le-hint">Manual, on-demand only — nothing is ever synced automatically off this device.</p>
        <hr class="le-divider">
        <input type="file" id="s-import-file" accept="application/json,.json" style="display:none" onchange="LE.handleImportFile(this)">
        <button class="le-btn secondary" onclick="document.getElementById('s-import-file').click()">Import JSON backup…</button>
        <p class="le-hint">Replaces <strong>all</strong> current data with the contents of a previously exported JSON file — export a backup first if you're not sure. CSV isn't supported for import; it doesn't carry the tree structure or settings.</p>
      </div>
    </div>

    <div class="le-fab-row"><button class="le-btn" onclick="LE.saveSettingsForm()">Save settings</button></div>
  `;
};

// Instant toggle: switching route immediately creates Year 4 if needed (never deletes it going the other way)
LE.onRouteChange = async function (newRoute) {
  const settings = await LE.getSettings();
  settings.programmeRoute = newRoute;
  await LE.saveSettings(settings);
  if (newRoute === 'MEng') {
    const degree = (await LE.getAllNodes()).find(n => n.type === 'degree');
    if (degree) await LE.createYear(degree.id, 4);
  }
  LE.render();
};

LE.saveSettingsForm = async function () {
  const settings = await LE.getSettings();
  settings.defaultStartNodeId = document.getElementById('s-start').value;
  settings.programmeRoute = document.getElementById('s-route').value;
  settings.fwmRoundingDisplay = document.getElementById('s-round').value;
  settings.defaultExtension = {
    assignments: {
      enabled: document.getElementById('s-ext-assignments-enabled').checked,
      mode: document.getElementById('s-ext-assignments-mode').value,
      value: Number(document.getElementById('s-ext-assignments-value').value) || 0,
    },
    exams: {
      enabled: document.getElementById('s-ext-exams-enabled').checked,
      mode: document.getElementById('s-ext-exams-mode').value,
      value: Number(document.getElementById('s-ext-exams-value').value) || 0,
    },
  };
  await LE.saveSettings(settings);

  const degreeNameInput = document.getElementById('s-degree-name');
  if (degreeNameInput) {
    const degree = (await LE.getAllNodes()).find(n => n.type === 'degree');
    if (degree && degreeNameInput.value.trim()) {
      degree.name = degreeNameInput.value.trim();
      await LE.saveNode(degree);
    }
  }

  LE.render();
};

LE.handleImportFile = async function (input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!confirm('Importing will REPLACE all current data in LearnEasy with the contents of this file. This cannot be undone. Continue?')) {
    input.value = '';
    return;
  }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await LE.importFullBackup(data);
    LE.state.currentNodeId = null; // fall back to the imported default start node
    LE.state.tab = 'progress';
    await LE.render();
    alert('Import complete.');
  } catch (err) {
    alert('Import failed: ' + (err && err.message ? err.message : String(err)));
  }
  input.value = '';
};

LE.exportData = async function (format) {
  const nodes = await LE.getAllNodes();
  const assessments = await LE.getAllAssessments();
  const settings = await LE.getSettings();
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'json') {
    const blob = new Blob([JSON.stringify({ nodes, assessments, settings }, null, 2)], { type: 'application/json' });
    LE.downloadBlob(blob, `learneasy-export-${stamp}.json`);
    return;
  }
  const header = ['module', 'assessment', 'format', 'weight%', 'deadline', 'submittedAt', 'rawMark', 'maxMark', 'penalizedMark'];
  const nodesById = {}; nodes.forEach(n => nodesById[n.id] = n);
  const rows = assessments.map(a => {
    const { mark } = LE.computePenalizedMark(a, settings);
    const mod = nodesById[a.moduleId];
    return [mod ? mod.name : '', a.name, a.assessmentFormat, a.weightWithinModule, a.deadline || '', a.submittedAt || '', a.rawMark ?? '', a.maxMark, mark ?? '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  const csv = [header.join(','), ...rows].join('\n');
  LE.downloadBlob(new Blob([csv], { type: 'text/csv' }), `learneasy-marks-${stamp}.csv`);
};

LE.downloadBlob = function (blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
