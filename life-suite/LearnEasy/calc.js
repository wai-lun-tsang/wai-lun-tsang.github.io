// LearnEasy — calculation engine
// Progress tree rollups + UCL-based marks engine (Academic Manual Ch.4)

var LE = window.LE = window.LE || {};

LE.PASS_MARK = 40; // UG modules

// ---------------------------------------------------------------------
// PROGRESS TREE ROLLUPS
// ---------------------------------------------------------------------

// Recursively compute {timeEstimateMinutes, timeDoneMinutes, progressPct} for a node,
// given a map of all nodes by id and a childrenByParent index.
LE.rollupNode = function (nodeId, nodesById, childrenByParent) {
  const node = nodesById[nodeId];
  if (!node) return { timeEstimateMinutes: 0, timeDoneMinutes: 0, progressPct: 0 };
  const kids = childrenByParent[nodeId] || [];
  if (node.type === 'material' || kids.length === 0) {
    const est = node.timeEstimateMinutes || 0;
    const done = node.timeDoneMinutes || 0;
    const pct = est > 0 ? Math.round((Math.min(done, est) / est) * 100) : (done > 0 ? 100 : 0);
    return { timeEstimateMinutes: est, timeDoneMinutes: done, progressPct: pct };
  }
  let est = 0, done = 0;
  for (const c of kids) {
    const r = LE.rollupNode(c.id, nodesById, childrenByParent);
    est += r.timeEstimateMinutes;
    done += r.timeDoneMinutes;
  }
  const pct = est > 0 ? Math.round((done / est) * 100) : 0;
  return { timeEstimateMinutes: est, timeDoneMinutes: done, progressPct: pct };
};

LE.buildIndexes = function (allNodes) {
  const nodesById = {};
  const childrenByParent = {};
  for (const n of allNodes) {
    nodesById[n.id] = n;
    if (!childrenByParent[n.parentId]) childrenByParent[n.parentId] = [];
    childrenByParent[n.parentId].push(n);
  }
  for (const k in childrenByParent) childrenByParent[k].sort((a, b) => (a.order || 0) - (b.order || 0));
  return { nodesById, childrenByParent };
};

LE.formatMinutes = function (mins) {
  mins = Math.round(mins || 0);
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
};

LE.countdownLabel = function (dateStart, dateEnd) {
  if (!dateEnd) return null;
  const now = new Date();
  const end = new Date(dateEnd);
  const diffMs = end - now;
  const diffDays = Math.ceil(diffMs / 86400000);
  if (diffMs >= 0) {
    if (diffDays === 0) return 'ends today';
    if (diffDays === 1) return 'ends tomorrow';
    return `ends in ${diffDays} days`;
  }
  const agoDays = Math.abs(diffDays);
  if (agoDays === 0) return 'ended today';
  if (agoDays === 1) return 'ended 1 day ago';
  return `ended ${agoDays} days ago`;
};

// ---------------------------------------------------------------------
// LATE-PENALTY ENGINE (Academic Manual Ch.4 Part B §3)
// ---------------------------------------------------------------------

LE.ASSESSMENT_FORMATS = [
  { id: 'coursework', label: 'Coursework' },
  { id: 'short_remote', label: 'Timed online exam (short duration)' },
  { id: 'take_home_24', label: 'Take-home paper (24h)' },
  { id: 'take_home_48', label: 'Take-home paper (48h)' },
  { id: 'take_home_72', label: 'Take-home paper (72h)' },
  { id: 'take_home_7day', label: 'Seven-day take-home' },
  { id: 'exam_no_penalty', label: 'In-person exam / in-class activity (no late penalty)' },
];

LE.isExamFormat = function (format) {
  return format === 'short_remote' || format === 'exam_no_penalty';
};

// Base duration (minutes) a percentage-mode extension multiplies against.
// Coursework and in-person exams have no fixed duration to take a percentage of.
LE.baseDurationMinutes = function (format, assessment) {
  switch (format) {
    case 'short_remote': return (assessment && assessment.durationMinutes) || 0;
    case 'take_home_24': return 24 * 60;
    case 'take_home_48': return 48 * 60;
    case 'take_home_72': return 72 * 60;
    case 'take_home_7day': return 7 * 24 * 60;
    default: return 0; // coursework, exam_no_penalty — percentage mode has no effect
  }
};

// Resolves a {mode, value} extension spec into a flat number of minutes for a given assessment.
LE.resolveExtensionMinutes = function (mode, value, format, assessment) {
  value = value || 0;
  if (mode === 'percentage') {
    const base = LE.baseDurationMinutes(format, assessment);
    return base * (value / 100);
  }
  return value; // 'minutes' mode
};

function isWeekday(d) { const w = d.getDay(); return w !== 0 && w !== 6; }

function countWorkingDaysLate(deadline, submitted) {
  let count = 0;
  const cursor = new Date(deadline);
  cursor.setHours(0, 0, 0, 0);
  const submittedDay = new Date(submitted);
  submittedDay.setHours(0, 0, 0, 0);
  // count whole working days strictly between deadline and submission
  const c = new Date(cursor);
  while (c < submittedDay) {
    c.setDate(c.getDate() + 1);
    if (isWeekday(c)) count++;
  }
  return count;
}

function addCalendarMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function floorAtPass(raw, deduction) {
  const result = raw - deduction;
  if (raw >= LE.PASS_MARK) return Math.max(result, LE.PASS_MARK);
  return result;
}

function takeHomePenalty(raw, deadline, submitted, hrDeduct, hrCap) {
  const hrsLate = (submitted - deadline) / 3600000;
  if (hrsLate < hrDeduct) return floorAtPass(raw, 10);
  if (hrsLate < hrCap) return raw >= LE.PASS_MARK ? LE.PASS_MARK : raw;
  return 1;
}

// Returns { mark, note } — mark may be null if not yet gradeable
LE.computePenalizedMark = function (assessment, settings) {
  if (assessment.rawMark == null) return { mark: null, note: 'not yet graded' };
  const raw = assessment.rawMark;
  const format = assessment.assessmentFormat || 'coursework';

  if (format === 'exam_no_penalty') return { mark: raw, note: null };
  if (!assessment.submittedAt || !assessment.deadline) return { mark: raw, note: null };

  let extensionMinutes = LE.resolveExtensionMinutes(assessment.extensionMode || 'minutes', assessment.extensionValue || 0, format, assessment);
  if (settings && settings.defaultExtension) {
    const bucket = LE.isExamFormat(format) ? 'exams' : 'assignments';
    const def = settings.defaultExtension[bucket];
    if (def && def.enabled) {
      extensionMinutes += LE.resolveExtensionMinutes(def.mode || 'minutes', def.value || 0, format, assessment);
    }
  }
  const deadline = new Date(new Date(assessment.deadline).getTime() + extensionMinutes * 60000);
  const submitted = new Date(assessment.submittedAt);

  if (submitted <= deadline) return { mark: raw, note: null };

  switch (format) {
    case 'coursework': {
      const daysLate = countWorkingDaysLate(deadline, submitted);
      if (daysLate <= 2) return { mark: floorAtPass(raw, 10), note: `${daysLate}wd late: -10pp, floor at pass mark` };
      if (daysLate <= 5) return { mark: raw >= LE.PASS_MARK ? LE.PASS_MARK : raw, note: `${daysLate}wd late: capped at pass mark` };
      if (submitted <= addCalendarMonths(deadline, 1)) return { mark: 1, note: '>5wd late, within 1 month: mark = 1' };
      return { mark: 0, note: '>1 month late: mark = 0' };
    }
    case 'short_remote': {
      const minLate = (submitted - deadline) / 60000;
      if (minLate <= 5) return { mark: floorAtPass(raw, 5), note: `${minLate.toFixed(0)}min late: -5pp, floor at pass mark` };
      if (minLate <= 10) return { mark: floorAtPass(raw, 10), note: `${minLate.toFixed(0)}min late: -10pp, floor at pass mark` };
      if (minLate <= 40) return { mark: raw >= LE.PASS_MARK ? LE.PASS_MARK : raw, note: `${minLate.toFixed(0)}min late: capped at pass mark` };
      return { mark: 0, note: '>40min late: not accepted, 0%' };
    }
    case 'take_home_24': return { mark: takeHomePenalty(raw, deadline, submitted, 1, 2), note: 'take-home 24h penalty applied' };
    case 'take_home_48': return { mark: takeHomePenalty(raw, deadline, submitted, 2, 4), note: 'take-home 48h penalty applied' };
    case 'take_home_72': return { mark: takeHomePenalty(raw, deadline, submitted, 3, 6), note: 'take-home 72h penalty applied' };
    case 'take_home_7day': return { mark: takeHomePenalty(raw, deadline, submitted, 7, 14), note: 'seven-day take-home penalty applied' };
    default: return { mark: raw, note: null };
  }
};

// ---------------------------------------------------------------------
// MARKS ENGINE — assessment -> module -> term -> year -> degree
// ---------------------------------------------------------------------

// Assessment-level figures
LE.assessmentFigures = function (assessment, settings) {
  const { mark: penalized } = LE.computePenalizedMark(assessment, settings);
  const max = assessment.maxMark || 100;
  const obtainedPct = penalized == null ? null : (penalized / max) * 100;
  const obtainedModulePct = obtainedPct == null ? 0 : obtainedPct * (assessment.weightWithinModule / 100);
  const totalModulePct = assessment.weightWithinModule || 0;
  return { penalizedMark: penalized, obtainedPct, obtainedModulePct, totalModulePct };
};

// Module-level: both informational
LE.moduleFigures = function (assessments, settings) {
  let sumObtainedCompleted = 0, sumTotalCompleted = 0, sumObtainedAll = 0;
  for (const a of assessments) {
    const f = LE.assessmentFigures(a, settings);
    sumObtainedAll += f.obtainedModulePct;
    if (f.penalizedMark != null) {
      sumObtainedCompleted += f.obtainedModulePct;
      sumTotalCompleted += f.totalModulePct;
    }
  }
  const completedOnly = sumTotalCompleted > 0 ? (sumObtainedCompleted / sumTotalCompleted) * 100 : null;
  const allAssessments = sumObtainedAll; // weights already sum to 100
  return { completedOnly, allAssessments };
};

// Term-level: strict (this term's own modules only) vs inclusive (+ full-year modules of the parent year).
// Both lists are arrays of {id, name, credit, assessments}.
LE.termFigures = function (strictList, inclusiveList, settings) {
  function aggregate(list) {
    let sumCreditsC = 0, sumWeightedC = 0, sumCreditsA = 0, sumWeightedA = 0;
    for (const m of list) {
      const fig = LE.moduleFigures(m.assessments, settings);
      if (fig.completedOnly != null) { sumCreditsC += m.credit; sumWeightedC += fig.completedOnly * m.credit; }
      sumCreditsA += m.credit; sumWeightedA += fig.allAssessments * m.credit;
    }
    return {
      completedOnly: sumCreditsC > 0 ? sumWeightedC / sumCreditsC : null,
      allAssessments: sumCreditsA > 0 ? sumWeightedA / sumCreditsA : null,
    };
  }
  return { strict: aggregate(strictList), inclusive: aggregate(inclusiveList) };
};

// Year-level: PYM (no drops) vs CYM (best-90-of-120 style drop for non-final years)
// modules: [{id, mark(allAssessments %), credit}]
LE.yearFigures = function (modules, isFinalYear) {
  const totalCredits = modules.reduce((s, m) => s + m.credit, 0);
  const pym = totalCredits > 0
    ? modules.reduce((s, m) => s + m.mark * m.credit, 0) / totalCredits
    : null;

  if (isFinalYear || modules.length === 0) {
    return { pym, cym: pym, droppedModuleIds: [] };
  }

  const creditsToKeep = Math.max(totalCredits - 30, 0);
  const { bestSubset, bestMean } = LE.bestCreditSubset(modules, creditsToKeep);
  const keptIds = new Set(bestSubset.map(m => m.id));
  const droppedModuleIds = modules.filter(m => !keptIds.has(m.id)).map(m => m.id);
  return { pym, cym: bestMean, droppedModuleIds };
};

// Brute-force subset search: find subset of modules with total credit as close as possible
// to (>=) targetCredits, maximising the resulting weighted mean.
LE.bestCreditSubset = function (modules, targetCredits) {
  const n = modules.length;
  let best = null;
  const limit = Math.min(n, 20); // guard against pathological input
  for (let mask = 1; mask < (1 << limit); mask++) {
    let credits = 0, weighted = 0;
    const subset = [];
    for (let i = 0; i < limit; i++) {
      if (mask & (1 << i)) { credits += modules[i].credit; weighted += modules[i].mark * modules[i].credit; subset.push(modules[i]); }
    }
    if (credits < targetCredits) continue; // must keep at least target credits
    const mean = weighted / credits;
    if (!best || credits < best.credits || (credits === best.credits && mean > best.mean)) {
      best = { credits, mean, subset };
    }
  }
  if (!best) { // fallback: keep everything
    const credits = modules.reduce((s, m) => s + m.credit, 0);
    const weighted = modules.reduce((s, m) => s + m.mark * m.credit, 0);
    return { bestSubset: modules, bestMean: credits > 0 ? weighted / credits : 0 };
  }
  return { bestSubset: best.subset, bestMean: best.mean };
};

// Degree-level: Final Weighted Mark from year CYMs
LE.YEAR_WEIGHTS = { BSc: [1, 3, 5], MEng: [1, 3, 5, 5] };

LE.degreeFigures = function (yearCYMs, programmeRoute) {
  const weights = LE.YEAR_WEIGHTS[programmeRoute] || LE.YEAR_WEIGHTS.BSc;
  let sumW = 0, sumWeighted = 0;
  const rows = [];
  for (let i = 0; i < weights.length; i++) {
    const cym = yearCYMs[i];
    if (cym == null) continue;
    sumW += weights[i];
    sumWeighted += cym * weights[i];
    rows.push({ year: i + 1, cym, weight: weights[i], contribution: cym * weights[i] });
  }
  const fwm = sumW > 0 ? sumWeighted / sumW : null;
  return {
    rows, totalWeight: sumW, fwm,
    fwm2dp: fwm == null ? null : Number(fwm.toFixed(2)),
    fwm2sf: fwm == null ? null : LE.roundSigFigs(fwm, 2),
  };
};

LE.roundSigFigs = function (num, sig) {
  if (num === 0) return 0;
  const d = Math.ceil(Math.log10(Math.abs(num)));
  const power = sig - d;
  const magnitude = Math.pow(10, power);
  return Math.round(num * magnitude) / magnitude;
};

// Classification with Final Year safety net
LE.classify = function (fwm, finalYearModules) {
  if (fwm == null) return { class: null, note: 'insufficient data' };
  const halfCredits = finalYearModules.reduce((s, m) => s + m.credit, 0) / 2;

  function creditsAtOrAbove(threshold) {
    return finalYearModules.filter(m => m.mark >= threshold).reduce((s, m) => s + m.credit, 0);
  }

  const bands = [
    { name: 'First', std: 69.5, safety: 68.5, safetyThreshold: 70 },
    { name: '2:1', std: 59.5, safety: 58.5, safetyThreshold: 60 },
    { name: '2:2', std: 49.5, safety: 48.5, safetyThreshold: 50 },
  ];
  for (const b of bands) {
    if (fwm >= b.std) return { class: b.name, note: 'standard boundary' };
    if (fwm >= b.safety && creditsAtOrAbove(b.safetyThreshold) >= halfCredits) {
      return { class: b.name, note: 'safety net applied (Final Year performance)' };
    }
  }
  if (fwm >= 40) return { class: 'Third', note: 'standard boundary' };
  return { class: 'Fail', note: 'below 40%' };
};

// Colour band for any obtained %, using the same exact boundaries as classification
LE.colourClass = function (pct) {
  if (pct == null) return 'le-band-none';
  if (pct >= 69.5) return 'le-band-first';
  if (pct >= 59.5) return 'le-band-2-1';
  if (pct >= 49.5) return 'le-band-2-2';
  if (pct >= 40) return 'le-band-third';
  return 'le-band-fail';
};
