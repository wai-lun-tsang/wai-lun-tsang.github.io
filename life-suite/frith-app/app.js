/* ===================== F.R.I.T.H. — app logic ===================== */

/* ---------- IndexedDB layer ---------- */
const DB_NAME = "frith-db";
const DB_VERSION = 1;
let dbPromise = null;

function openDB(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains("meta")) db.createObjectStore("meta",{keyPath:"key"});
      if(!db.objectStoreNames.contains("goals")) db.createObjectStore("goals",{keyPath:"id"});
      if(!db.objectStoreNames.contains("milestones")) db.createObjectStore("milestones",{keyPath:"id"});
      if(!db.objectStoreNames.contains("entries")) db.createObjectStore("entries",{keyPath:"date"});
    };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode="readonly"){
  return openDB().then(db=> db.transaction(storeName, mode).objectStore(storeName));
}
function idbGet(store,key){ return tx(store).then(s=> new Promise((res,rej)=>{ const r=s.get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); })); }
function idbGetAll(store){ return tx(store).then(s=> new Promise((res,rej)=>{ const r=s.getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); })); }
function idbPut(store,val){ return tx(store,"readwrite").then(s=> new Promise((res,rej)=>{ const r=s.put(val); r.onsuccess=()=>res(val); r.onerror=()=>rej(r.error); })); }
function idbDelete(store,key){ return tx(store,"readwrite").then(s=> new Promise((res,rej)=>{ const r=s.delete(key); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); })); }

const DEFAULT_SETTINGS = {
  key:"settings",
  projectName:"Project",
  instanceName:"Instance 1",
  startDate:"2026-09-01",
  endDate:"2030-03-24",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London"
};

let SETTINGS = null;
let GOALS = [];
let MILESTONES = [];

async function loadAll(){
  SETTINGS = await idbGet("meta","settings") || {...DEFAULT_SETTINGS};
  GOALS = await idbGetAll("goals");
  MILESTONES = await idbGetAll("milestones");
}
async function saveSettings(){ await idbPut("meta", SETTINGS); }

/* ---------- date / timezone utils ---------- */
function tzDateStr(date, timeZone){
  return new Intl.DateTimeFormat("en-CA",{timeZone, year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
}
function tzTimeStr(date, timeZone){
  return new Intl.DateTimeFormat("en-GB",{timeZone, hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(date);
}
function todayStr(){ return tzDateStr(new Date(), SETTINGS.timezone); }
function parseYMD(s){ const [y,m,d]=s.split("-").map(Number); return new Date(Date.UTC(y,m-1,d)); }
function fmtYMD(d){ return d.toISOString().slice(0,10); }
function addDays(dateStr, n){ const d=parseYMD(dateStr); d.setUTCDate(d.getUTCDate()+n); return fmtYMD(d); }
function daysBetween(a,b){ return Math.round((parseYMD(b)-parseYMD(a))/86400000); }
function weekdayOf(dateStr){ return parseYMD(dateStr).getUTCDay(); } // 0=Sun
function cmpDate(a,b){ return a<b?-1:a>b?1:0; }
function clampDateStr(s, lo, hi){ if(s<lo) return lo; if(s>hi) return hi; return s; }
function fmtHuman(dateStr){
  const d = parseYMD(dateStr);
  return d.toLocaleDateString("en-GB",{timeZone:"UTC",day:"2-digit",month:"short",year:"numeric"});
}
function msUntilMidnight(timeZone){
  const now = new Date();
  const ds = tzDateStr(now, timeZone);
  // find the offset by trial: compute next-midnight in tz by iterating minutes is costly;
  // instead use a binary approach with Date math relative to UTC guess.
  const [y,m,d] = ds.split("-").map(Number);
  // try UTC midnight of next day and adjust using the tz formatter until date rolls over
  let guess = Date.UTC(y,m-1,d) + 24*3600*1000; // naive UTC next-day midnight
  let guessDate = new Date(guess);
  // walk backwards in 15-min steps while tz-date(guess) still equals tomorrow-ish overshoot guard
  // simpler robust approach: binary search over ms offset in [-24h,+24h] from naive guess
  let lo = guess - 24*3600*1000, hi = guess + 24*3600*1000;
  for(let i=0;i<40;i++){
    const mid = Math.floor((lo+hi)/2);
    const midDs = tzDateStr(new Date(mid), timeZone);
    if(midDs <= ds) lo = mid; else hi = mid;
  }
  return hi - now.getTime();
}

/* ---------- goal eligibility ---------- */
function isGoalEligible(goal, dateStr){
  if(goal.mode === "dates"){
    return (goal.dates||[]).includes(dateStr);
  }
  if(!goal.startDate || !goal.endDate) return false;
  if(dateStr < goal.startDate || dateStr > goal.endDate) return false;
  if(goal.mode === "everyN"){
    const n = Math.max(1, parseInt(goal.intervalDays||1,10));
    const diff = daysBetween(goal.startDate, dateStr);
    return diff >= 0 && diff % n === 0;
  }
  if(goal.mode === "weekday"){
    const wd = parseInt(goal.weekday,10);
    if(weekdayOf(dateStr) !== wd) return false;
    // find first occurrence of this weekday on/after startDate
    let first = goal.startDate;
    while(weekdayOf(first) !== wd){ first = addDays(first,1); }
    if(dateStr < first) return false;
    const weeksSince = Math.floor(daysBetween(first,dateStr)/7);
    const n = Math.max(1, parseInt(goal.intervalWeeks||1,10));
    return weeksSince % n === 0;
  }
  return false;
}
function eligibleGoalsFor(dateStr){
  return GOALS.filter(g=> isGoalEligible(g,dateStr));
}

/* ---------- quota goals (period + cycle target, day-agnostic) ---------- */
function quotaCycleBounds(goal, dateStr){
  if(dateStr < goal.periodStart || dateStr > goal.periodEnd) return null;
  const cycleDays = Math.max(1, parseInt(goal.cycleDays||1,10));
  const idx = Math.floor(daysBetween(goal.periodStart, dateStr)/cycleDays);
  const cycleStart = addDays(goal.periodStart, idx*cycleDays);
  let cycleEnd = addDays(cycleStart, cycleDays-1);
  if(cycleEnd > goal.periodEnd) cycleEnd = goal.periodEnd;
  return {cycleStart, cycleEnd, cycleIndex: idx};
}
async function quotaProgressOnDate(goal, dateStr, liveChecklist){
  const bounds = quotaCycleBounds(goal, dateStr);
  if(!bounds) return null;
  const entries = await allEntriesInRange(bounds.cycleStart, dateStr);
  const map = {}; entries.forEach(e=> map[e.date]=e);
  let count = 0;
  let d = bounds.cycleStart;
  while(d <= dateStr){
    let checked;
    if(d === dateStr && liveChecklist){ checked = !!liveChecklist[goal.id]; }
    else { checked = !!(map[d] && map[d].checklist && map[d].checklist[goal.id]); }
    if(checked) count++;
    d = addDays(d,1);
  }
  return {count, target: Math.max(1, parseInt(goal.targetCount||1,10)), cycleStart: bounds.cycleStart, cycleEnd: bounds.cycleEnd, met: count>=Math.max(1, parseInt(goal.targetCount||1,10))};
}
async function pendingQuotaGoalsFor(dateStr, liveChecklist){
  const quotaGoals = GOALS.filter(g=> g.mode==="quota");
  const out = [];
  for(const g of quotaGoals){
    const prog = await quotaProgressOnDate(g, dateStr, liveChecklist);
    if(prog && !prog.met) out.push({goal:g, progress:prog});
  }
  return out;
}
async function computeQuotaCycleStats(goal){
  const today = todayStr();
  const hi = today < goal.periodEnd ? today : goal.periodEnd;
  if(hi < goal.periodStart) return {completedCycles:0, totalElapsedCycles:0, current:null};
  const cycleDays = Math.max(1, parseInt(goal.cycleDays||1,10));
  let completed=0, totalElapsed=0, current=null;
  let cs = goal.periodStart;
  while(cs <= goal.periodEnd){
    let ce = addDays(cs, cycleDays-1);
    if(ce > goal.periodEnd) ce = goal.periodEnd;
    if(ce <= hi){
      const prog = await quotaProgressOnDate(goal, ce, null);
      totalElapsed++;
      if(prog && prog.met) completed++;
    } else if(cs <= hi){
      const prog = await quotaProgressOnDate(goal, hi, null);
      current = prog;
    }
    cs = addDays(ce,1);
  }
  return {completedCycles:completed, totalElapsedCycles:totalElapsed, current};
}

/* ---------- entry helpers ---------- */
function blankEntry(dateStr){
  return {
    date: dateStr,
    status: "draft", // draft | submitted
    checklist: {},   // goalId -> bool
    photo: null,     // Blob (image or video)
    mediaType: "photo", // "photo" | "video"
    photoDesc: "",
    win: "", gratitude:"", learn:"", fix:"", note:"",
    explain: "", explainCountStreak: true,
    submittedAt: null,
    wasLate: false
  };
}
async function getEntry(dateStr){
  const e = await idbGet("entries", dateStr);
  return e || blankEntry(dateStr);
}
async function saveEntry(entry){ await idbPut("entries", entry); }

function checklistComplete(entry, eligible){
  if(eligible.length===0) return true; // nothing eligible = vacuously fine, but doesn't itself grant a "hit" day (handled in scoring)
  return eligible.every(g => entry.checklist && entry.checklist[g.id]);
}
function requiredFilled(entry){
  return !!(entry.win && entry.gratitude && entry.learn && entry.fix && entry.photo);
}
function dayCounts(entry, eligible){
  // "counts" toward streak/progress: submitted, required fields filled, checklist all-or-nothing satisfied,
  // and (not late OR late-but-explain-checked)
  if(entry.status !== "submitted") return false;
  if(!requiredFilled(entry)) return false;
  if(eligible.length>0 && !checklistComplete(entry, eligible)) return false;
  if(entry.wasLate && !entry.explainCountStreak) return false;
  return true;
}

/* ---------- streak / stats calculations ---------- */
async function allEntriesInRange(lo, hi){
  const all = await idbGetAll("entries");
  return all.filter(e=> e.date>=lo && e.date<=hi).sort((a,b)=>cmpDate(a.date,b.date));
}
async function computeStreaks(){
  const start = SETTINGS.startDate, end = SETTINGS.endDate, today = todayStr();
  const hi = today < end ? today : end;
  if(hi < start) return {current:0, best:0};
  const entries = await allEntriesInRange(start, hi);
  const map = {}; entries.forEach(e=> map[e.date]=e);
  let best=0, run=0, current=0;
  let d = start;
  const cutoff = hi;
  const seq = [];
  while(d<=cutoff){ seq.push(d); d = addDays(d,1); }
  for(const ds of seq){
    const e = map[ds];
    const elig = eligibleGoalsFor(ds);
    const hit = e ? dayCounts(e, elig) : false;
    if(hit){ run++; best=Math.max(best,run); } else { run=0; }
  }
  // current streak = trailing run ending at the latest day that has a decided outcome
  // if today isn't submitted yet, don't break the streak on today; start counting from yesterday
  let d2 = today <= end ? today : end;
  if(!map[d2] || !dayCounts(map[d2], eligibleGoalsFor(d2))){
    d2 = addDays(d2,-1);
  }
  let c=0;
  while(d2>=start){
    const e = map[d2];
    const elig = eligibleGoalsFor(d2);
    if(e && dayCounts(e,elig)){ c++; d2=addDays(d2,-1); } else break;
  }
  current = c;
  return {current, best};
}
async function computeGoalStats(){
  const start = SETTINGS.startDate, end = SETTINGS.endDate, today = todayStr();
  const hi = today < end ? today : end;
  const entries = await allEntriesInRange(start, hi);
  const map = {}; entries.forEach(e=> map[e.date]=e);
  const stats = {}; GOALS.filter(g=>g.mode!=="quota").forEach(g=> stats[g.id] = {name:g.name, eligible:0, hit:0});
  let d = start;
  while(d<=hi){
    const elig = eligibleGoalsFor(d);
    const e = map[d];
    elig.forEach(g=>{
      stats[g.id].eligible++;
      if(e && e.checklist && e.checklist[g.id]) stats[g.id].hit++;
    });
    d = addDays(d,1);
  }
  return stats;
}
async function computeConsistency(){
  const start = SETTINGS.startDate, end = SETTINGS.endDate, today = todayStr();
  const hi = today < end ? today : end;
  if(hi<start) return {logged:0, elapsed:0, pct:0};
  const entries = await allEntriesInRange(start, hi);
  let logged=0;
  const elapsed = daysBetween(start,hi)+1;
  for(const e of entries){ if(dayCounts(e, eligibleGoalsFor(e.date))) logged++; }
  return {logged, elapsed, pct: elapsed? Math.round((logged/elapsed)*100):0};
}

/* ---------- app state / router ---------- */
const state = { page:"menu", viewDate:null };
const $app = ()=>document.getElementById("app");

function toast(msg){
  const t=document.createElement("div"); t.className="toast"; t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 2200);
}

async function boot(){
  await loadAll();
  state.viewDate = todayStr();
  render();
  document.getElementById("app").style.display="block";
}

function render(){
  if(state.page==="menu") renderMenu();
  else if(state.page==="log") renderLog();
  else if(state.page==="history") renderHistory();
  else if(state.page==="stats") renderStats();
  else if(state.page==="settings") renderSettings();
}

function goto(page, opts={}){
  state.page = page;
  if(opts.viewDate) state.viewDate = opts.viewDate;
  render();
}

/* ---------- MENU ---------- */
let clockInterval = null;
async function renderMenu(){
  if(clockInterval) clearInterval(clockInterval);
  const today = todayStr();
  const started = today >= SETTINGS.startDate;
  const finished = today > SETTINGS.endDate;
  const {current, best} = await computeStreaks();

  const totalDays = daysBetween(SETTINGS.startDate, SETTINGS.endDate)+1;
  const dayNum = Math.min(Math.max(daysBetween(SETTINGS.startDate,today)+1,1), totalDays);
  const pct = Math.min(100, Math.max(0,(dayNum/totalDays)*100));

  // next milestone
  const upcoming = MILESTONES
    .map(m=> ({...m, d: m.mode==="range" ? m.startDate : m.date}))
    .filter(m=> m.d >= today)
    .sort((a,b)=>cmpDate(a.d,b.d))[0];

  let statusLine, statusSub;
  if(!started){
    statusLine = `T\u2212${daysBetween(today,SETTINGS.startDate)} days until the arc begins`;
    statusSub = `${SETTINGS.startDate} \u2192 ${SETTINGS.endDate}`;
  } else if(finished){
    statusLine = `Arc complete`;
    statusSub = `${SETTINGS.startDate} \u2192 ${SETTINGS.endDate}`;
  } else {
    const daysLeft = daysBetween(today, SETTINGS.endDate);
    const msPart = upcoming ? ` \u00b7 next milestone "${upcoming.name}" in ${daysBetween(today,upcoming.d)}d` : "";
    statusLine = `${daysLeft} days until end${msPart}`;
    statusSub = `Day ${dayNum} of ${totalDays}`;
  }

  // build hit-overlay + milestone marks for the bar (sampled, capped for perf)
  const entries = await allEntriesInRange(SETTINGS.startDate, today<SETTINGS.endDate?today:SETTINGS.endDate);
  const map = {}; entries.forEach(e=>map[e.date]=e);
  let hitSegs = "";
  {
    let d = SETTINGS.startDate; let segStart=null;
    const hi = today<SETTINGS.endDate?today:SETTINGS.endDate;
    while(d<=hi){
      const e = map[d];
      const hit = e ? dayCounts(e, eligibleGoalsFor(d)) : false;
      if(hit && segStart===null) segStart=d;
      if(!hit && segStart!==null){
        hitSegs += barSeg(segStart, addDays(d,-1), totalDays);
        segStart=null;
      }
      d = addDays(d,1);
    }
    if(segStart!==null) hitSegs += barSeg(segStart, hi, totalDays);
  }
  function barSeg(a,b,total){
    const left = (daysBetween(SETTINGS.startDate,a)/total)*100;
    const width = ((daysBetween(a,b)+1)/total)*100;
    return `<div class="bar-hit" style="left:${left}%;width:${width}%"></div>`;
  }
  const msMarks = MILESTONES.map(m=>{
    const dd = m.mode==="range" ? m.startDate : m.date;
    if(dd < SETTINGS.startDate || dd > SETTINGS.endDate) return "";
    const left = (daysBetween(SETTINGS.startDate,dd)/totalDays)*100;
    return `<div class="bar-milestone" style="left:${left}%" title="${escapeHtml(m.name)}"></div>`;
  }).join("");

  $app().innerHTML = `
    <div class="menu-header">
      <h1>${escapeHtml(SETTINGS.projectName)} &mdash; ${escapeHtml(SETTINGS.instanceName)}</h1>
      <div class="clock" id="liveClock"></div>
    </div>

    <div class="status-box">
      <div class="status-line">${statusLine}</div>
      <div class="status-sub">${statusSub}</div>
      <div class="bar">
        <div class="bar-fill" style="width:${pct}%"></div>
        ${hitSegs}
        ${msMarks}
      </div>
      <div class="streak-row">
        <span>Current streak<br><b>${current}d</b></span>
        <span style="text-align:right">Best streak<br><b>${best}d</b></span>
      </div>
    </div>

    <div class="menu-grid">
      <div class="menu-btn" data-go="log">Log</div>
      <div class="menu-btn" data-go="history">History</div>
      <div class="menu-btn" data-go="stats">Stats</div>
      <div class="menu-btn" data-go="settings">Settings</div>
    </div>
  `;
  document.querySelectorAll("[data-go]").forEach(el=>{
    el.onclick = ()=> goto(el.dataset.go, el.dataset.go==="log"?{viewDate:todayStr()}:{});
  });
  const clockEl = document.getElementById("liveClock");
  const tick = ()=>{ clockEl.textContent = `${todayStr()} \u00b7 ${tzTimeStr(new Date(), SETTINGS.timezone)}`; };
  tick();
  clockInterval = setInterval(tick, 1000);
}
function escapeHtml(s){ return (s||"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

/* ---------- LOG PAGE ---------- */
let logCountdownInterval = null;
let currentDraft = null;
let currentQuotaPending = [];
let autosaveTimer = null;
let photoBlobUrl = null;

async function renderLog(){
  if(logCountdownInterval) clearInterval(logCountdownInterval);
  const dateStr = state.viewDate;
  const today = todayStr();
  const isToday = dateStr === today;
  const entry = await getEntry(dateStr);
  const eligible = eligibleGoalsFor(dateStr);
  const locked = entry.status === "submitted";
  const late = dateStr < today; // any day prior to the current tz-day, if unsubmitted, is late
  currentDraft = JSON.parse(JSON.stringify(entry));
  currentQuotaPending = locked ? [] : await pendingQuotaGoalsFor(dateStr, currentDraft.checklist);

  $app().innerHTML = `
    <div class="pagebar">
      <div class="btn active" data-nav="today">Today</div>
      <div class="btn" data-nav="history">History</div>
      <div class="btn" data-nav="stats">Stats</div>
      <div class="btn" data-nav="menu">Menu</div>
    </div>

    <div class="log-header" id="logHeader"></div>

    <div class="day-nav">
      <button class="btn" id="prevBtn">&larr; Prev</button>
      <span class="date">${fmtHuman(dateStr)}${isToday?" (today)":""} ${locked?'<span class="locked-badge">locked</span>':""}</span>
      <button class="btn" id="nextBtn" ${dateStr>=today?"disabled":""}>Next &rarr;</button>
    </div>

    <div id="entryForm"></div>
  `;

  document.querySelectorAll("[data-nav]").forEach(el=>{
    el.onclick = ()=>{
      const n = el.dataset.nav;
      if(n==="today") goto("log", {viewDate: todayStr()});
      else if(n==="menu") goto("menu");
      else goto(n);
    };
  });
  document.getElementById("prevBtn").onclick = ()=> goto("log",{viewDate: addDays(dateStr,-1)});
  document.getElementById("nextBtn").onclick = ()=>{ if(dateStr<today) goto("log",{viewDate: addDays(dateStr,1)}); };

  renderLogHeader(dateStr, isToday, locked);
  renderEntryForm(dateStr, entry, eligible, locked, late);
}

function renderLogHeader(dateStr, isToday, locked){
  const headerEl = document.getElementById("logHeader");
  if(locked){
    headerEl.innerHTML = `<div class="clockbig">Locked</div><div class="sub">submitted ${currentDraft.submittedAt ? new Date(currentDraft.submittedAt).toLocaleString() : ""}</div>`;
    return;
  }
  if(!isToday){
    headerEl.innerHTML = `<div class="clockbig up">TIME'S UP!</div><div class="sub">this day has closed &mdash; explain below to submit</div>`;
    return;
  }
  const update = ()=>{
    const ms = msUntilMidnight(SETTINGS.timezone);
    if(ms<=0){
      headerEl.innerHTML = `<div class="clockbig up">TIME'S UP!</div><div class="sub">today has closed &mdash; explain below to submit</div>`;
      clearInterval(logCountdownInterval);
      renderEntryFormLateToggle();
      return;
    }
    const h = String(Math.floor(ms/3600000)).padStart(2,"0");
    const m = String(Math.floor((ms%3600000)/60000)).padStart(2,"0");
    const s = String(Math.floor((ms%60000)/1000)).padStart(2,"0");
    headerEl.innerHTML = `<div class="clockbig">${h}:${m}:${s}</div><div class="sub">until today closes (${SETTINGS.timezone})</div>`;
  };
  update();
  logCountdownInterval = setInterval(update, 1000);
}
function renderEntryFormLateToggle(){
  // if the countdown flips to TIME'S UP! while the form is open, re-render the form to reveal EXPLAIN
  const dateStr = state.viewDate;
  getEntry(dateStr).then(entry=>{
    const eligible = eligibleGoalsFor(dateStr);
    renderEntryForm(dateStr, currentDraft || entry, eligible, false, true);
  });
}

function renderEntryForm(dateStr, entry, eligible, locked, late){
  const d = currentDraft;
  const formEl = document.getElementById("entryForm");

  const checklistHtml = (eligible.length===0 && currentQuotaPending.length===0)
    ? `<div class="empty-note">No goals are scheduled for this day.</div>`
    : `<div class="checklist">${eligible.map(g=>`
        <label class="check-item ${locked?'disabled':''}">
          <input type="checkbox" data-goal="${g.id}" ${d.checklist[g.id]?"checked":""} ${locked?"disabled":""}>
          <span>${escapeHtml(g.name)}</span>
        </label>`).join("")}${currentQuotaPending.map(q=>`
        <label class="check-item ${locked?'disabled':''}">
          <input type="checkbox" data-quota-goal="${q.goal.id}" ${d.checklist[q.goal.id]?"checked":""} ${locked?"disabled":""}>
          <span>${escapeHtml(q.goal.name)} <span style="opacity:0.6;font-size:12px;">(${q.progress.count}/${q.progress.target} this cycle)</span></span>
        </label>`).join("")}</div>`;

  const photoHtml = `
    <div class="photo-box">
      ${d.photo ?
        (d.mediaType==="video"
          ? `<video class="photo-preview" id="photoPreview" src="${photoUrl(d.photo)}" controls playsinline style="max-width:100%;border-radius:8px;"></video>`
          : `<img class="photo-preview" id="photoPreview" src="${photoUrl(d.photo)}">`)
        : `<div class="empty-note" style="margin-bottom:10px;">No photo or video selected yet.</div>`}
      ${locked ? "" : `<input type="file" accept="image/*,video/*" id="photoInput" style="display:none">
      <button class="btn" id="photoBtn">${d.photo?"Change photo/video":"Choose photo or video"}</button>`}
      <input type="text" id="photoDesc" placeholder="Description (optional)" value="${escapeHtml(d.photoDesc)}" ${locked?"disabled":""} style="margin-top:10px;">
    </div>`;

  const explainNeeded = late && !locked;

  formEl.innerHTML = `
    <div class="section">
      <label class="title">CHECKLIST</label>
      ${checklistHtml}
    </div>

    <div class="section">
      <label class="title">PHOTO / VIDEO <span class="req">*</span></label>
      ${photoHtml}
    </div>

    <div class="section">
      <label class="title">WIN <span class="req">*</span></label>
      <textarea id="f_win" placeholder="One thing that went right today." ${locked?"disabled":""}>${escapeHtml(d.win)}</textarea>
    </div>
    <div class="section">
      <label class="title">GRATITUDE <span class="req">*</span></label>
      <textarea id="f_gratitude" placeholder="Something someone else did that's worth thanking them for." ${locked?"disabled":""}>${escapeHtml(d.gratitude)}</textarea>
    </div>
    <div class="section">
      <label class="title">LEARN <span class="req">*</span></label>
      <textarea id="f_learn" placeholder="Something you learned today." ${locked?"disabled":""}>${escapeHtml(d.learn)}</textarea>
    </div>
    <div class="section">
      <label class="title">FIX <span class="req">*</span></label>
      <textarea id="f_fix" placeholder="One thing to correct tomorrow." ${locked?"disabled":""}>${escapeHtml(d.fix)}</textarea>
    </div>

    ${explainNeeded || (locked && d.wasLate) ? `
    <div class="section explain-box">
      <label class="title">EXPLAIN ${explainNeeded ? '<span class="req">*</span>':''}</label>
      <textarea id="f_explain" placeholder="Why was this entry late?" ${locked?"disabled":""}>${escapeHtml(d.explain)}</textarea>
      <label class="streak-checkbox">
        <input type="checkbox" id="f_explainStreak" ${d.explainCountStreak?"checked":""} ${locked?"disabled":""}>
        Still count this day toward the streak / progress
      </label>
    </div>` : ""}

    <div class="section">
      <label class="title">NOTE</label>
      <textarea id="f_note" placeholder="Anything else worth remembering." ${locked?"disabled":""}>${escapeHtml(d.note)}</textarea>
    </div>

    ${locked ? "" : `
    <button class="btn-grad" id="submitBtn">Submit &amp; lock entry</button>
    <div class="save-status" id="saveStatus">autosaves as you type</div>`}
  `;

  if(locked) return;

  // wire inputs -> draft + autosave
  const bind = (id, key)=>{
    const el = document.getElementById(id);
    if(!el) return;
    el.oninput = ()=>{ d[key] = el.value; scheduleAutosave(dateStr); };
  };
  bind("f_win","win"); bind("f_gratitude","gratitude"); bind("f_learn","learn");
  bind("f_fix","fix"); bind("f_note","note"); bind("photoDesc","photoDesc"); bind("f_explain","explain");

  const streakChk = document.getElementById("f_explainStreak");
  if(streakChk) streakChk.onchange = ()=>{ d.explainCountStreak = streakChk.checked; scheduleAutosave(dateStr); };

  document.querySelectorAll("[data-goal]").forEach(chk=>{
    chk.onchange = ()=>{ d.checklist[chk.dataset.goal] = chk.checked; scheduleAutosave(dateStr); };
  });
  document.querySelectorAll("[data-quota-goal]").forEach(chk=>{
    chk.onchange = async ()=>{
      d.checklist[chk.dataset.quotaGoal] = chk.checked;
      scheduleAutosave(dateStr);
      currentQuotaPending = await pendingQuotaGoalsFor(dateStr, d.checklist);
      renderEntryForm(dateStr, entry, eligible, locked, late);
    };
  });

  const photoBtn = document.getElementById("photoBtn");
  const photoInput = document.getElementById("photoInput");
  if(photoBtn){
    photoBtn.onclick = ()=> photoInput.click();
    photoInput.onchange = async ()=>{
      const file = photoInput.files[0];
      if(!file) return;
      if(file.type.startsWith("video/")){
        if(file.size > 100*1024*1024){
          toast("That video is quite large (over 100MB) — consider a shorter clip if this becomes a daily habit.");
        }
        d.photo = file;
        d.mediaType = "video";
      } else {
        const compressed = await compressImage(file, 1800);
        d.photo = compressed;
        d.mediaType = "photo";
      }
      scheduleAutosave(dateStr);
      renderEntryForm(dateStr, entry, eligible, locked, late);
    };
  }

  const submitBtn = document.getElementById("submitBtn");
  submitBtn.onclick = ()=> handleSubmit(dateStr, eligible, late);
}

function photoUrl(blob){
  if(photoBlobUrl) URL.revokeObjectURL(photoBlobUrl);
  photoBlobUrl = URL.createObjectURL(blob);
  return photoBlobUrl;
}

function compressImage(file, maxDim){
  return new Promise((resolve,reject)=>{
    const img = new Image();
    const reader = new FileReader();
    reader.onload = ()=>{ img.src = reader.result; };
    reader.onerror = reject;
    img.onload = ()=>{
      let {width,height} = img;
      if(width>height && width>maxDim){ height = Math.round(height*maxDim/width); width=maxDim; }
      else if(height>=width && height>maxDim){ width = Math.round(width*maxDim/height); height=maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width=width; canvas.height=height;
      canvas.getContext("2d").drawImage(img,0,0,width,height);
      canvas.toBlob(blob=> resolve(blob), "image/jpeg", 0.85);
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function scheduleAutosave(dateStr){
  const statusEl = document.getElementById("saveStatus");
  if(statusEl) statusEl.textContent = "saving\u2026";
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async ()=>{
    currentDraft.date = dateStr;
    if(currentDraft.status!=="submitted") currentDraft.status="draft";
    await saveEntry(currentDraft);
    const s = document.getElementById("saveStatus");
    if(s) s.textContent = `saved ${new Date().toLocaleTimeString()}`;
  }, 900);
}

async function handleSubmit(dateStr, eligible, late){
  const d = currentDraft;
  if(!requiredFilled(d)){ toast("Fill in Photo, Win, Gratitude, Learn and Fix first."); return; }
  if(late && !d.explain){ toast("Please explain why this entry is late."); return; }
  const ok = confirm("This entry will be locked and can't be edited afterward. Submit?");
  if(!ok) return;
  d.status = "submitted";
  d.submittedAt = new Date().toISOString();
  d.wasLate = late;
  clearTimeout(autosaveTimer);
  await saveEntry(d);
  toast("Entry submitted and locked.");
  goto("log", {viewDate: dateStr});
}

/* ---------- HISTORY PAGE ---------- */
async function dayColor(dateStr, today, entry){
  if(dateStr > today) return "gray";
  if(!entry) return dateStr < today ? "red" : "gray";
  if(entry.status !== "submitted") return dateStr < today ? "red" : "gray";
  const eligible = eligibleGoalsFor(dateStr);
  const complete = requiredFilled(entry) && checklistComplete(entry, eligible);
  if(entry.wasLate && !entry.explainCountStreak) return "gray";
  if(entry.wasLate) return complete ? "blue" : "gray";
  return complete ? "green" : "gray";
}

async function renderHistory(){
  const today = todayStr();
  const entries = await allEntriesInRange(SETTINGS.startDate, SETTINGS.endDate);
  const map = {}; entries.forEach(e=> map[e.date]=e);

  const monthsHtml = [];
  let cursor = firstOfMonth(SETTINGS.startDate);
  const endMonth = firstOfMonth(SETTINGS.endDate);
  while(cursor <= endMonth){
    monthsHtml.push(await renderMonth(cursor, map, today));
    cursor = addMonths(cursor,1);
  }

  $app().innerHTML = `
    <div class="pagebar">
      <div class="btn" data-nav="log">Log</div>
      <div class="btn active" data-nav="history">History</div>
      <div class="btn" data-nav="stats">Stats</div>
      <div class="btn" data-nav="menu">Menu</div>
    </div>
    <h2 class="page-title">History</h2>
    <div class="legend">
      <span><i style="background:var(--green)"></i>on time, complete</span>
      <span><i style="background:var(--blue)"></i>late, allowed &amp; complete</span>
      <span><i style="background:var(--red)"></i>late, unfilled</span>
      <span><i style="background:var(--gray)"></i>future / not counted</span>
    </div>
    <div id="monthsWrap">${monthsHtml.join("")}</div>
    <div class="tooltip-holder" id="tooltipHolder"></div>
  `;
  wireNav();
  document.querySelectorAll(".cal-cell[data-date]").forEach(cell=>{
    cell.onclick = ()=> goto("log", {viewDate: cell.dataset.date});
    let pressTimer;
    cell.addEventListener("touchstart", ()=>{
      pressTimer = setTimeout(()=> toast(cell.dataset.date), 420);
    });
    cell.addEventListener("touchend", ()=> clearTimeout(pressTimer));
    cell.title = cell.dataset.date;
  });
}
function firstOfMonth(dateStr){ const [y,m] = dateStr.split("-").map(Number); return `${y}-${String(m).padStart(2,"0")}-01`; }
function addMonths(dateStr, n){
  const [y,m] = dateStr.split("-").map(Number);
  const total = (y*12 + (m-1)) + n;
  const ny = Math.floor(total/12), nm = total%12;
  return `${ny}-${String(nm+1).padStart(2,"0")}-01`;
}
function daysInMonth(dateStr){ const [y,m]=dateStr.split("-").map(Number); return new Date(Date.UTC(y,m,0)).getUTCDate(); }

async function renderMonth(monthStart, map, today){
  const [y,m] = monthStart.split("-").map(Number);
  const dim = daysInMonth(monthStart);
  const firstWd = weekdayOf(monthStart); // 0=Sun
  const monthName = new Date(Date.UTC(y,m-1,1)).toLocaleDateString("en-GB",{timeZone:"UTC",month:"long",year:"numeric"});

  let cells = "";
  for(let i=0;i<firstWd;i++) cells += `<div class="cal-cell empty"></div>`;
  for(let day=1; day<=dim; day++){
    const ds = `${y}-${String(m).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    if(ds < SETTINGS.startDate || ds > SETTINGS.endDate){
      cells += `<div class="cal-cell empty"></div>`;
      continue;
    }
    const color = await dayColor(ds, today, map[ds]);
    const isFuture = ds > today;
    cells += isFuture
      ? `<div class="cal-cell ${color}">${day}</div>`
      : `<div class="cal-cell ${color}" data-date="${ds}">${day}</div>`;
  }
  return `
    <div class="month-block">
      <div class="month-title">${monthName}</div>
      <div class="day-labels"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
      <div class="week-row" style="display:grid;grid-template-columns:repeat(7,1fr);">${cells}</div>
    </div>`;
}

function wireNav(){
  document.querySelectorAll("[data-nav]").forEach(el=>{
    el.onclick = ()=>{
      const n = el.dataset.nav;
      if(n==="log") goto("log",{viewDate: todayStr()});
      else if(n==="menu") goto("menu");
      else goto(n);
    };
  });
}

/* ---------- STATS PAGE ---------- */
async function renderStats(){
  const {current, best} = await computeStreaks();
  const {logged, elapsed, pct} = await computeConsistency();
  const goalStats = await computeGoalStats();
  const quotaGoals = GOALS.filter(g=> g.mode==="quota");
  const quotaStatsList = [];
  for(const g of quotaGoals){ quotaStatsList.push({goal:g, stats: await computeQuotaCycleStats(g)}); }

  $app().innerHTML = `
    <div class="pagebar">
      <div class="btn" data-nav="log">Log</div>
      <div class="btn" data-nav="history">History</div>
      <div class="btn active" data-nav="stats">Stats</div>
      <div class="btn" data-nav="menu">Menu</div>
    </div>
    <h2 class="page-title">Stats</h2>
    <div class="stat-grid">
      <div class="stat-card"><div class="v">${logged}</div><div class="l">days logged</div></div>
      <div class="stat-card"><div class="v">${current}</div><div class="l">current streak</div></div>
      <div class="stat-card"><div class="v">${best}</div><div class="l">best streak</div></div>
      <div class="stat-card"><div class="v">${pct}%</div><div class="l">consistency (${logged}/${elapsed})</div></div>
    </div>
    <h3 style="font-size:13px;color:var(--pink);margin-bottom:10px;">Goal completion</h3>
    ${Object.values(goalStats).length===0 ? `<div class="empty-note">No goals set up yet &mdash; add some in Settings.</div>` :
      Object.values(goalStats).map(g=>{
        const rate = g.eligible? Math.round((g.hit/g.eligible)*100):0;
        return `<div class="goal-stat">
          <div class="top"><span>${escapeHtml(g.name)}</span><span>${g.hit}/${g.eligible} (${rate}%)</span></div>
          <div class="track"><div class="fill" style="width:${rate}%"></div></div>
        </div>`;
      }).join("")}
    ${quotaStatsList.length>0 ? `
    <h3 style="font-size:13px;color:var(--pink);margin:18px 0 10px;">Quota goal cycles</h3>
    ${quotaStatsList.map(q=>{
      const rate = q.stats.totalElapsedCycles? Math.round((q.stats.completedCycles/q.stats.totalElapsedCycles)*100):0;
      const currentNote = q.stats.current ? ` \u00b7 current cycle ${q.stats.current.count}/${q.stats.current.target}` : "";
      return `<div class="goal-stat">
        <div class="top"><span>${escapeHtml(q.goal.name)}</span><span>${q.stats.completedCycles}/${q.stats.totalElapsedCycles} cycles (${rate}%)${currentNote}</span></div>
        <div class="track"><div class="fill" style="width:${rate}%"></div></div>
      </div>`;
    }).join("")}` : ""}
  `;
  wireNav();
}

/* ---------- SETTINGS PAGE ---------- */
const TIMEZONES = [
  "Europe/London","Europe/Paris","Europe/Berlin","Europe/Madrid","Europe/Rome",
  "America/New_York","America/Chicago","America/Denver","America/Los_Angeles",
  "Asia/Hong_Kong","Asia/Shanghai","Asia/Singapore","Asia/Tokyo","Asia/Seoul",
  "Asia/Kolkata","Asia/Dubai","Australia/Sydney","Pacific/Auckland","UTC"
];
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

async function renderSettings(){
  $app().innerHTML = `
    <div class="pagebar">
      <div class="btn" data-nav="log">Log</div>
      <div class="btn" data-nav="history">History</div>
      <div class="btn" data-nav="stats">Stats</div>
      <div class="btn active" data-nav="menu">Menu</div>
    </div>
    <h2 class="page-title">Settings</h2>

    <div class="settings-group">
      <h3>Project &amp; Instance</h3>
      <div class="field"><label>Project name</label><input type="text" id="s_project" value="${escapeHtml(SETTINGS.projectName)}"></div>
      <div class="field"><label>Instance name</label><input type="text" id="s_instance" value="${escapeHtml(SETTINGS.instanceName)}"></div>
      <div class="row2">
        <div class="field"><label>Start date</label><input type="date" id="s_start" value="${SETTINGS.startDate}"></div>
        <div class="field"><label>End date</label><input type="date" id="s_end" value="${SETTINGS.endDate}"></div>
      </div>
      <div class="empty-note" id="dayCountNote"></div>
      <button class="btn" id="saveProjectBtn" style="margin-top:8px;width:100%;">Save</button>
    </div>

    <div class="settings-group">
      <h3>Timezone</h3>
      <div class="field">
        <select id="s_tz">
          ${TIMEZONES.map(z=>`<option value="${z}" ${z===SETTINGS.timezone?"selected":""}>${z}</option>`).join("")}
        </select>
      </div>
      <button class="btn" id="saveTzBtn" style="width:100%;">Save timezone</button>
    </div>

    <div class="settings-group">
      <h3>Goals</h3>
      <div id="goalsList"></div>
      <button class="add-btn" id="addGoalBtn">+ Add goal</button>
    </div>

    <div class="settings-group">
      <h3>Milestones</h3>
      <div id="milestonesList"></div>
      <button class="add-btn" id="addMilestoneBtn">+ Add milestone</button>
    </div>

    <div class="settings-group">
      <h3>Export</h3>
      <div class="export-row">
        <label><input type="checkbox" id="exp_json" checked> Structured data (JSON)</label>
        <label><input type="checkbox" id="exp_photos" checked> Photos folder</label>
        <label><input type="checkbox" id="exp_summary" checked> Readable summary</label>
      </div>
      <div class="row2">
        <div class="field"><label>From</label><input type="date" id="exp_from" value="${SETTINGS.startDate}"></div>
        <div class="field"><label>To</label><input type="date" id="exp_to" value="${SETTINGS.endDate}"></div>
      </div>
      <button class="btn-grad" id="exportBtn">Export .zip</button>
    </div>

    <div class="settings-group">
      <h3>Full Backup &amp; Restore</h3>
      <div class="empty-note" style="margin-bottom:10px;">A single file containing everything — settings, all goals, all milestones, and every entry ever logged (including photos/videos, embedded directly in the file) — for the whole life of this instance, not limited by the export range above. Keep this somewhere safe; if the app or this device is ever lost, this file is what you'd restore from.</div>
      <button class="btn-grad" id="backupBtn" style="margin-bottom:10px;">Download full backup (.json)</button>
      <input type="file" accept=".json,application/json" id="restoreInput" style="display:none;">
      <button class="btn" id="restoreBtn" style="width:100%;">Restore from backup</button>
    </div>
  `;
  wireNav();
  updateDayCountNote();
  document.getElementById("s_start").oninput = updateDayCountNote;
  document.getElementById("s_end").oninput = updateDayCountNote;

  document.getElementById("saveProjectBtn").onclick = async ()=>{
    SETTINGS.projectName = document.getElementById("s_project").value.trim() || "Project";
    SETTINGS.instanceName = document.getElementById("s_instance").value.trim() || "Instance";
    SETTINGS.startDate = document.getElementById("s_start").value;
    SETTINGS.endDate = document.getElementById("s_end").value;
    await saveSettings();
    toast("Saved.");
  };
  document.getElementById("saveTzBtn").onclick = async ()=>{
    SETTINGS.timezone = document.getElementById("s_tz").value;
    await saveSettings();
    toast("Timezone saved.");
  };

  renderGoalsList();
  renderMilestonesList();

  document.getElementById("addGoalBtn").onclick = ()=> openGoalEditor(null);
  document.getElementById("addMilestoneBtn").onclick = ()=> openMilestoneEditor(null);
  document.getElementById("exportBtn").onclick = runExport;
  document.getElementById("backupBtn").onclick = runFullBackup;
  document.getElementById("restoreBtn").onclick = ()=> document.getElementById("restoreInput").click();
  document.getElementById("restoreInput").onchange = runRestore;
}
function updateDayCountNote(){
  const s = document.getElementById("s_start").value, e = document.getElementById("s_end").value;
  const note = document.getElementById("dayCountNote");
  if(s && e && e>=s) note.textContent = `${daysBetween(s,e)+1} days total`;
  else note.textContent = "";
}

function goalDesc(g){
  if(g.mode==="weekday"){
    const names=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    return `${names[g.weekday]}, every ${g.intervalWeeks} week(s) \u00b7 ${g.startDate} \u2192 ${g.endDate}`;
  }
  if(g.mode==="everyN") return `Every ${g.intervalDays} day(s) \u00b7 ${g.startDate} \u2192 ${g.endDate}`;
  if(g.mode==="dates") return `${(g.dates||[]).length} specific date(s)`;
  if(g.mode==="quota"){
    const cycleDays = parseInt(g.cycleDays||1,10);
    const periodDays = daysBetween(g.periodStart,g.periodEnd)+1;
    const isWhole = cycleDays >= periodDays;
    return isWhole
      ? `${g.targetCount}\u00d7 total \u00b7 ${g.periodStart} \u2192 ${g.periodEnd}`
      : `${g.targetCount}\u00d7 every ${cycleDays} day(s) \u00b7 ${g.periodStart} \u2192 ${g.periodEnd}`;
  }
  return "";
}
function renderGoalsList(){
  const el = document.getElementById("goalsList");
  if(GOALS.length===0){ el.innerHTML = `<div class="empty-note">No goals yet.</div>`; return; }
  el.innerHTML = GOALS.map(g=>`
    <div class="goal-card">
      <div class="head"><b>${escapeHtml(g.name)}</b>
        <span><button class="small-btn" data-edit-goal="${g.id}">edit</button><button class="small-btn" data-del-goal="${g.id}">delete</button></span>
      </div>
      <div class="empty-note">${goalDesc(g)}</div>
    </div>`).join("");
  el.querySelectorAll("[data-edit-goal]").forEach(b=> b.onclick=()=> openGoalEditor(GOALS.find(g=>g.id===b.dataset.editGoal)));
  el.querySelectorAll("[data-del-goal]").forEach(b=> b.onclick=async ()=>{
    if(!confirm("Delete this goal? Past checklist history referencing it will remain but it will no longer appear.")) return;
    await idbDelete("goals", b.dataset.delGoal);
    GOALS = GOALS.filter(g=>g.id!==b.dataset.delGoal);
    renderGoalsList();
  });
}
function msDesc(m){
  if(m.mode==="range") return `${m.startDate} \u2192 ${m.endDate}`;
  return m.date;
}
function renderMilestonesList(){
  const el = document.getElementById("milestonesList");
  if(MILESTONES.length===0){ el.innerHTML = `<div class="empty-note">No milestones yet.</div>`; return; }
  el.innerHTML = MILESTONES.map(m=>`
    <div class="milestone-card">
      <div class="head"><b>${escapeHtml(m.name)}</b>
        <span><button class="small-btn" data-edit-ms="${m.id}">edit</button><button class="small-btn" data-del-ms="${m.id}">delete</button></span>
      </div>
      <div class="empty-note">${msDesc(m)}</div>
    </div>`).join("");
  el.querySelectorAll("[data-edit-ms]").forEach(b=> b.onclick=()=> openMilestoneEditor(MILESTONES.find(m=>m.id===b.dataset.editMs)));
  el.querySelectorAll("[data-del-ms]").forEach(b=> b.onclick=async ()=>{
    if(!confirm("Delete this milestone?")) return;
    await idbDelete("milestones", b.dataset.delMs);
    MILESTONES = MILESTONES.filter(m=>m.id!==b.dataset.delMs);
    renderMilestonesList();
  });
}

function openGoalEditor(existing){
  const g = existing || {id:uid(), name:"", mode:"weekday", weekday:1, intervalWeeks:1, intervalDays:1, startDate:SETTINGS.startDate, endDate:SETTINGS.endDate, dates:[], periodStart:SETTINGS.startDate, periodEnd:SETTINGS.endDate, cycleDays:7, targetCount:3};
  const overlay = document.createElement("div");
  overlay.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:150;display:flex;align-items:flex-end;";
  overlay.innerHTML = `
    <div style="background:var(--panel);border-top:1px solid var(--line);border-radius:16px 16px 0 0;padding:18px 16px 26px;width:100%;max-height:85vh;overflow:auto;">
      <h3 style="margin-top:0;">${existing?"Edit":"Add"} goal</h3>
      <div class="field"><label>Name</label><input type="text" id="g_name" value="${escapeHtml(g.name)}"></div>
      <div class="field"><label>Mode</label>
        <select id="g_mode">
          <option value="weekday" ${g.mode==="weekday"?"selected":""}>Weekday, every N weeks</option>
          <option value="everyN" ${g.mode==="everyN"?"selected":""}>Every N days</option>
          <option value="dates" ${g.mode==="dates"?"selected":""}>Specific dates</option>
          <option value="quota" ${g.mode==="quota"?"selected":""}>Quota (X times per cycle)</option>
        </select>
      </div>
      <div id="g_modeFields"></div>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button class="btn" id="g_cancel" style="flex:1;">Cancel</button>
        <button class="btn-grad" id="g_save" style="flex:1;">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  function renderModeFields(){
    const mode = document.getElementById("g_mode").value;
    const wrap = document.getElementById("g_modeFields");
    if(mode==="weekday"){
      const names=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
      wrap.innerHTML = `
        <div class="field"><label>Weekday</label><select id="g_weekday">${names.map((n,i)=>`<option value="${i}" ${i==g.weekday?"selected":""}>${n}</option>`).join("")}</select></div>
        <div class="field"><label>Repeat every N weeks</label><input type="number" id="g_intervalWeeks" min="1" value="${g.intervalWeeks||1}"></div>
        <div class="row2">
          <div class="field"><label>Start date</label><input type="date" id="g_start" value="${g.startDate||SETTINGS.startDate}"></div>
          <div class="field"><label>End date</label><input type="date" id="g_end" value="${g.endDate||SETTINGS.endDate}"></div>
        </div>`;
    } else if(mode==="everyN"){
      wrap.innerHTML = `
        <div class="field"><label>Every N days</label><input type="number" id="g_intervalDays" min="1" value="${g.intervalDays||1}"></div>
        <div class="row2">
          <div class="field"><label>Start date</label><input type="date" id="g_start" value="${g.startDate||SETTINGS.startDate}"></div>
          <div class="field"><label>End date</label><input type="date" id="g_end" value="${g.endDate||SETTINGS.endDate}"></div>
        </div>`;
    } else if(mode==="dates"){
      wrap.innerHTML = `
        <div class="field"><label>Dates (dd/mm/yyyy, one per line)</label>
        <textarea id="g_dates" style="min-height:100px;">${(g.dates||[]).map(ymdToDDMMYYYY).join("\n")}</textarea></div>`;
    } else if(mode==="quota"){
      const periodDays = (g.periodStart && g.periodEnd) ? daysBetween(g.periodStart,g.periodEnd)+1 : 0;
      const isWhole = parseInt(g.cycleDays||0,10) >= periodDays && periodDays>0;
      wrap.innerHTML = `
        <div class="row2">
          <div class="field"><label>Period start</label><input type="date" id="g_periodStart" value="${g.periodStart||SETTINGS.startDate}"></div>
          <div class="field"><label>Period end</label><input type="date" id="g_periodEnd" value="${g.periodEnd||SETTINGS.endDate}"></div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;margin:10px 0;font-size:13px;">
          <input type="checkbox" id="g_wholePeriod" ${isWhole?"checked":""}> Treat the whole period as one single cycle
        </label>
        <div id="g_cycleWrap" style="${isWhole?"display:none;":""}">
          <div class="field"><label>Cycle length (days)</label><input type="number" id="g_cycleDays" min="1" value="${g.cycleDays||7}"></div>
        </div>
        <div class="field"><label>Target count per cycle</label><input type="number" id="g_targetCount" min="1" value="${g.targetCount||1}"></div>
        <div class="empty-note" style="margin-top:6px;">e.g. \u201C3 weeks, 3 times every week\u201D \u2192 period = 3 weeks, cycle = 7 days, target = 3. \u201CReach 5 times by the end\u201D \u2192 tick \u201Cwhole period as one cycle\u201D, target = 5.</div>`;
      document.getElementById("g_wholePeriod").onchange = (e)=>{
        document.getElementById("g_cycleWrap").style.display = e.target.checked ? "none" : "";
      };
    }
  }
  renderModeFields();
  document.getElementById("g_mode").onchange = renderModeFields;
  document.getElementById("g_cancel").onclick = ()=> overlay.remove();
  document.getElementById("g_save").onclick = async ()=>{
    g.name = document.getElementById("g_name").value.trim() || "Untitled goal";
    g.mode = document.getElementById("g_mode").value;
    if(g.mode==="weekday"){
      g.weekday = parseInt(document.getElementById("g_weekday").value,10);
      g.intervalWeeks = Math.max(1, parseInt(document.getElementById("g_intervalWeeks").value||1,10));
      g.startDate = document.getElementById("g_start").value;
      g.endDate = document.getElementById("g_end").value;
    } else if(g.mode==="everyN"){
      g.intervalDays = Math.max(1, parseInt(document.getElementById("g_intervalDays").value||1,10));
      g.startDate = document.getElementById("g_start").value;
      g.endDate = document.getElementById("g_end").value;
    } else if(g.mode==="dates"){
      const raw = document.getElementById("g_dates").value.split("\n").map(s=>s.trim()).filter(Boolean);
      g.dates = raw.map(ddmmyyyyToYMD).filter(Boolean);
    } else if(g.mode==="quota"){
      g.periodStart = document.getElementById("g_periodStart").value;
      g.periodEnd = document.getElementById("g_periodEnd").value;
      const wholePeriod = document.getElementById("g_wholePeriod").checked;
      g.targetCount = Math.max(1, parseInt(document.getElementById("g_targetCount").value||1,10));
      g.cycleDays = wholePeriod
        ? Math.max(1, daysBetween(g.periodStart,g.periodEnd)+1)
        : Math.max(1, parseInt(document.getElementById("g_cycleDays").value||1,10));
    }
    await idbPut("goals", g);
    const idx = GOALS.findIndex(x=>x.id===g.id);
    if(idx>=0) GOALS[idx]=g; else GOALS.push(g);
    overlay.remove();
    renderGoalsList();
  };
}

function openMilestoneEditor(existing){
  const m = existing || {id:uid(), name:"", mode:"date", date:SETTINGS.startDate, startDate:SETTINGS.startDate, endDate:SETTINGS.endDate};
  const overlay = document.createElement("div");
  overlay.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:150;display:flex;align-items:flex-end;";
  overlay.innerHTML = `
    <div style="background:var(--panel);border-top:1px solid var(--line);border-radius:16px 16px 0 0;padding:18px 16px 26px;width:100%;max-height:85vh;overflow:auto;">
      <h3 style="margin-top:0;">${existing?"Edit":"Add"} milestone</h3>
      <div class="field"><label>Name</label><input type="text" id="m_name" value="${escapeHtml(m.name)}"></div>
      <div class="field"><label>Type</label>
        <select id="m_mode">
          <option value="date" ${m.mode==="date"?"selected":""}>Single date</option>
          <option value="range" ${m.mode==="range"?"selected":""}>Date period</option>
        </select>
      </div>
      <div id="m_modeFields"></div>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button class="btn" id="m_cancel" style="flex:1;">Cancel</button>
        <button class="btn-grad" id="m_save" style="flex:1;">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  function renderFields(){
    const mode = document.getElementById("m_mode").value;
    const wrap = document.getElementById("m_modeFields");
    if(mode==="date"){
      wrap.innerHTML = `<div class="field"><label>Date</label><input type="date" id="m_date" value="${m.date||SETTINGS.startDate}"></div>`;
    } else {
      wrap.innerHTML = `<div class="row2">
        <div class="field"><label>Start</label><input type="date" id="m_start" value="${m.startDate||SETTINGS.startDate}"></div>
        <div class="field"><label>End</label><input type="date" id="m_end" value="${m.endDate||SETTINGS.endDate}"></div></div>`;
    }
  }
  renderFields();
  document.getElementById("m_mode").onchange = renderFields;
  document.getElementById("m_cancel").onclick = ()=> overlay.remove();
  document.getElementById("m_save").onclick = async ()=>{
    m.name = document.getElementById("m_name").value.trim() || "Milestone";
    m.mode = document.getElementById("m_mode").value;
    if(m.mode==="date") m.date = document.getElementById("m_date").value;
    else { m.startDate = document.getElementById("m_start").value; m.endDate = document.getElementById("m_end").value; }
    await idbPut("milestones", m);
    const idx = MILESTONES.findIndex(x=>x.id===m.id);
    if(idx>=0) MILESTONES[idx]=m; else MILESTONES.push(m);
    overlay.remove();
    renderMilestonesList();
  };
}

function ymdToDDMMYYYY(s){ const [y,m,d]=s.split("-"); return `${d}/${m}/${y}`; }
function ddmmyyyyToYMD(s){
  const parts = s.split("/");
  if(parts.length!==3) return null;
  const [d,m,y] = parts;
  if(!d||!m||!y) return null;
  return `${y.padStart(4,"0")}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
}

/* ---------- minimal ZIP writer (store method, no compression) ---------- */
const CRC_TABLE = (()=>{
  const t = new Uint32Array(256);
  for(let n=0;n<256;n++){
    let c=n;
    for(let k=0;k<8;k++) c = (c&1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1);
    t[n]=c>>>0;
  }
  return t;
})();
function crc32(buf){
  let c = 0xFFFFFFFF;
  for(let i=0;i<buf.length;i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function dosDateTime(date){
  const time = ((date.getHours()&0x1F)<<11) | ((date.getMinutes()&0x3F)<<5) | ((date.getSeconds()/2)&0x1F);
  const dosDate = (((date.getFullYear()-1980)&0x7F)<<9) | (((date.getMonth()+1)&0xF)<<5) | (date.getDate()&0x1F);
  return {time, dosDate};
}
async function buildZip(files){
  // files: [{name, data: Uint8Array | Blob}]
  const encoder = new TextEncoder();
  const now = new Date();
  const {time, dosDate} = dosDateTime(now);
  let localParts = [];
  let central = [];
  let offset = 0;

  for(const f of files){
    let data = f.data;
    if(data instanceof Blob) data = new Uint8Array(await data.arrayBuffer());
    const nameBytes = encoder.encode(f.name);
    const crc = crc32(data);
    const size = data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, time, true);
    dv.setUint16(12, dosDate, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, size, true);
    dv.setUint32(22, size, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    localParts.push(local, data);

    const centralEntry = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(centralEntry.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, time, true);
    cdv.setUint16(14, dosDate, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, size, true);
    cdv.setUint32(24, size, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    centralEntry.set(nameBytes, 46);
    central.push(centralEntry);

    offset += local.length + data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  central.forEach(c=> centralSize += c.length);

  const end = new Uint8Array(22);
  const edv = new DataView(end.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(4, 0, true);
  edv.setUint16(6, 0, true);
  edv.setUint16(8, files.length, true);
  edv.setUint16(10, files.length, true);
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, centralStart, true);
  edv.setUint16(20, 0, true);

  return new Blob([...localParts, ...central, end], {type:"application/zip"});
}

/* ---------- export ---------- */
function mediaExt(entry){
  if(entry.mediaType==="video"){
    const type = entry.photo && entry.photo.type ? entry.photo.type : "";
    if(type.includes("webm")) return "webm";
    if(type.includes("quicktime")) return "mov";
    return "mp4";
  }
  return "jpg";
}
/* ---------- full backup (single JSON, everything, photos embedded) ---------- */
function blobToBase64(blob){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = ()=> resolve(reader.result); // data URL, includes "data:<mime>;base64,"
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
function base64ToBlob(dataUrl){
  const [header, base64] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(header)?.[1] || "application/octet-stream";
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], {type: mime});
}

async function runFullBackup(){
  toast("Building full backup\u2026");
  const allEntries = await idbGetAll("entries");
  const entriesOut = [];
  for(const e of allEntries){
    const copy = {...e};
    if(copy.photo instanceof Blob){
      copy.photoDataUrl = await blobToBase64(copy.photo);
    }
    delete copy.photo; // replaced by photoDataUrl above
    entriesOut.push(copy);
  }
  const backup = {
    _frithBackup: true,
    backupVersion: 1,
    exportedAt: new Date().toISOString(),
    settings: SETTINGS,
    goals: GOALS,
    milestones: MILESTONES,
    entries: entriesOut
  };
  const blob = new Blob([JSON.stringify(backup)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${SETTINGS.projectName.replace(/\s+/g,"_")}_${SETTINGS.instanceName.replace(/\s+/g,"_")}_full_backup_${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
  toast("Full backup downloaded.");
}

async function runRestore(e){
  const file = e.target.files[0];
  if(!file) return;
  let backup;
  try{
    backup = JSON.parse(await file.text());
  }catch(err){
    toast("That file doesn't look like a valid backup.");
    return;
  }
  if(!backup._frithBackup){
    toast("That file doesn't look like a FRITH backup.");
    return;
  }
  const ok = confirm(
    "Restore this backup? Settings, goals, milestones, and entries in the file will be written back " +
    "(entries/goals/milestones matching an existing date or id are overwritten; nothing else is deleted first). This can't be undone easily — continue?"
  );
  if(!ok) return;
  toast("Restoring\u2026");

  if(backup.settings) await idbPut("meta", backup.settings);
  if(Array.isArray(backup.goals)) for(const g of backup.goals) await idbPut("goals", g);
  if(Array.isArray(backup.milestones)) for(const m of backup.milestones) await idbPut("milestones", m);
  if(Array.isArray(backup.entries)){
    for(const entry of backup.entries){
      const restored = {...entry};
      if(restored.photoDataUrl){
        restored.photo = base64ToBlob(restored.photoDataUrl);
      } else {
        restored.photo = null;
      }
      delete restored.photoDataUrl;
      await idbPut("entries", restored);
    }
  }
  await loadAll();
  toast("Backup restored.");
  goto("settings");
}

async function runExport(){
  const includeJson = document.getElementById("exp_json").checked;
  const includePhotos = document.getElementById("exp_photos").checked;
  const includeSummary = document.getElementById("exp_summary").checked;
  const from = document.getElementById("exp_from").value;
  const to = document.getElementById("exp_to").value;
  if(!from || !to || from>to){ toast("Check the export date range."); return; }

  toast("Building export\u2026");
  const entries = await allEntriesInRange(from, to);
  const files = [];

  if(includeJson){
    const jsonPayload = {
      exportedAt: new Date().toISOString(),
      range: {from, to},
      settings: SETTINGS, goals: GOALS, milestones: MILESTONES,
      entries: entries.map(e=> ({...e, photo: e.photo ? `photos/${e.date}.${mediaExt(e)}` : null}))
    };
    files.push({name:"data.json", data:new TextEncoder().encode(JSON.stringify(jsonPayload, null, 2))});
  }
  if(includePhotos){
    for(const e of entries){
      if(e.photo) files.push({name:`photos/${e.date}.${mediaExt(e)}`, data:e.photo});
    }
  }
  if(includeSummary){
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(SETTINGS.projectName)} \u2014 ${escapeHtml(SETTINGS.instanceName)}</title>
    <style>body{font-family:Georgia,serif;max-width:700px;margin:40px auto;padding:0 20px;background:#fdfaf6;color:#222;}
    h1{font-size:26px;} .entry{border-bottom:1px solid #ddd;padding:24px 0;} .entry h2{font-size:16px;margin:0 0 10px;color:#8E5FD6;}
    .entry img, .entry video{max-width:100%;border-radius:8px;margin:10px 0;} .label{font-weight:bold;color:#555;font-size:12px;text-transform:uppercase;margin-top:10px;}
    .val{margin:2px 0 0;}</style></head><body>
    <h1>${escapeHtml(SETTINGS.projectName)} \u2014 ${escapeHtml(SETTINGS.instanceName)}</h1>
    <p>${from} to ${to}</p>`;
    for(const e of entries){
      if(e.status!=="submitted") continue;
      html += `<div class="entry"><h2>${e.date}${e.wasLate?" (late)":""}</h2>`;
      if(e.photo) html += e.mediaType==="video"
        ? `<video src="photos/${e.date}.${mediaExt(e)}" controls></video>`
        : `<img src="photos/${e.date}.${mediaExt(e)}">`;
      if(e.photoDesc) html += `<p class="val"><em>${escapeHtml(e.photoDesc)}</em></p>`;
      const rows = [["Win",e.win],["Gratitude",e.gratitude],["Learn",e.learn],["Fix",e.fix],["Note",e.note],["Explain",e.explain]];
      for(const [label,val] of rows){ if(val) html += `<div class="label">${label}</div><p class="val">${escapeHtml(val)}</p>`; }
      html += `</div>`;
    }
    html += `</body></html>`;
    files.push({name:"summary.html", data:new TextEncoder().encode(html)});
  }

  if(files.length===0){ toast("Nothing selected to export."); return; }
  const zipBlob = await buildZip(files);
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${SETTINGS.projectName.replace(/\s+/g,"_")}_${SETTINGS.instanceName.replace(/\s+/g,"_")}_${from}_to_${to}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
  toast("Export downloaded.");
}

/* ---------- boot / load screen ---------- */
window.addEventListener("DOMContentLoaded", async ()=>{
  await loadAll();
  const titleEl = document.getElementById("loadTitle");
  titleEl.textContent = `${SETTINGS.projectName} \u2014 ${SETTINGS.instanceName}`;
  const loadScreen = document.getElementById("loadScreen");
  setTimeout(()=>{ loadScreen.classList.add("ready"); }, 500);
  loadScreen.addEventListener("click", async ()=>{
    loadScreen.style.display="none";
    await boot();
  }, {once:true});

  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  }
});
