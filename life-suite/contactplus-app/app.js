/* ===================== ContactPlus — app logic ===================== */

/* ---------- IndexedDB layer ---------- */
const DB_NAME = "contactplus-db";
const DB_VERSION = 1;
let dbPromise = null;

function openDB(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains("contacts")) db.createObjectStore("contacts",{keyPath:"id"});
      if(!db.objectStoreNames.contains("timeline")) db.createObjectStore("timeline",{keyPath:"id"});
      if(!db.objectStoreNames.contains("relationships")) db.createObjectStore("relationships",{keyPath:"id"});
      if(!db.objectStoreNames.contains("groups")) db.createObjectStore("groups",{keyPath:"id"});
      if(!db.objectStoreNames.contains("alignmentTiers")) db.createObjectStore("alignmentTiers",{keyPath:"id"});
      if(!db.objectStoreNames.contains("tags")) db.createObjectStore("tags",{keyPath:"id"});
    };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
  return dbPromise;
}
function tx(store, mode="readonly"){ return openDB().then(db=> db.transaction(store, mode).objectStore(store)); }
function idbGet(store,key){ return tx(store).then(s=> new Promise((res,rej)=>{ const r=s.get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); })); }
function idbGetAll(store){ return tx(store).then(s=> new Promise((res,rej)=>{ const r=s.getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); })); }
function idbPut(store,val){ return tx(store,"readwrite").then(s=> new Promise((res,rej)=>{ const r=s.put(val); r.onsuccess=()=>res(val); r.onerror=()=>rej(r.error); })); }
function idbDelete(store,key){ return tx(store,"readwrite").then(s=> new Promise((res,rej)=>{ const r=s.delete(key); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); })); }

function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

const DEFAULT_ALIGNMENT_TIERS = [
  {name:"Hostile", color:"#A32D2D"},
  {name:"Archenemies", color:"#B4432F"},
  {name:"Enemies", color:"#C15F3B"},
  {name:"Rivals", color:"#8F8B80"},
  {name:"Neutral", color:"#7a7566"},
  {name:"Friendly", color:"#7FA84F"},
  {name:"Friends", color:"#4F8F3B"},
  {name:"Buddies", color:"#2D6E1F"},
  {name:"Lover", color:"#D4537E"},
  {name:"Family", color:"#378ADD"},
].map((t,i)=>({id:uid(), order:i, ...t}));

const DEFAULT_TAGS = [
  {name:"Family", color:"#378ADD"},
  {name:"Important date", color:"#D4537E"},
  {name:"Just conversation", color:"#7a7566"},
].map((t,i)=>({id:uid(), order:i, ...t}));

let ALIGNMENT_TIERS = [];
let TAGS = [];
let GROUPS = [];
let CONTACTS = [];

async function seedIfEmpty(){
  const existingTiers = await idbGetAll("alignmentTiers");
  if(existingTiers.length===0){
    for(const t of DEFAULT_ALIGNMENT_TIERS) await idbPut("alignmentTiers", t);
  }
  const existingTags = await idbGetAll("tags");
  if(existingTags.length===0){
    for(const t of DEFAULT_TAGS) await idbPut("tags", t);
  }
}
async function loadAll(){
  await seedIfEmpty();
  ALIGNMENT_TIERS = (await idbGetAll("alignmentTiers")).sort((a,b)=>a.order-b.order);
  TAGS = (await idbGetAll("tags")).sort((a,b)=>a.order-b.order);
  GROUPS = await idbGetAll("groups");
  CONTACTS = await idbGetAll("contacts");
}

/* ---------- date utils ---------- */
function parseYMD(s){ const [y,m,d]=s.split("-").map(Number); return new Date(Date.UTC(y,m-1,d)); }
function fmtYMD(d){ return d.toISOString().slice(0,10); }
function todayStr(){ return fmtYMD(new Date()); }
function fmtHuman(dateStr){
  const d = parseYMD(dateStr);
  return d.toLocaleDateString("en-GB",{timeZone:"UTC",day:"2-digit",month:"short",year:"numeric"});
}
function ordinal(n){
  const s=["th","st","nd","rd"], v=n%100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}
function nextOccurrence(dateStr, fromStr){
  // next date (>= fromStr) that shares month/day with dateStr, if recurring
  const [,m,d] = dateStr.split("-").map(Number);
  const [fy] = fromStr.split("-").map(Number);
  let candidate = `${fy}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  if(candidate < fromStr) candidate = `${fy+1}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  return candidate;
}
function keyDateNumberFor(kd, occurrenceYear){
  if(!kd.numbered) return null;
  const startYear = kd.startYear || parseInt(kd.date.split("-")[0],10);
  const startNumber = kd.startNumber || 1;
  return startNumber + (occurrenceYear - startYear);
}

/* ---------- escaping ---------- */
function esc(s){ return (s||"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

/* ---------- photo helpers ---------- */
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
const _avatarUrlCache = {}; // contactId -> {blob, url}
function avatarSrc(c){
  if(!c.photo) return null;
  const cached = _avatarUrlCache[c.id];
  if(cached && cached.blob === c.photo) return cached.url;
  if(cached) URL.revokeObjectURL(cached.url);
  const url = URL.createObjectURL(c.photo);
  _avatarUrlCache[c.id] = {blob:c.photo, url};
  return url;
}
function avatarHtml(c, sizeClass){
  const src = avatarSrc(c);
  if(src) return `<div class="${sizeClass}" style="overflow:hidden;padding:0;"><img src="${src}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;"></div>`;
  return `<div class="${sizeClass}">${contactInitials(c)}</div>`;
}

/* ---------- contact model helpers ---------- */
function blankContact(){
  return {
    id: uid(), firstName:"", lastName:"", phone:"", email:"", headline:"",
    groupIds:[], alignmentTierId:"", socialLinks:[], keyDates:[], photo:null
  };
}
function fullName(c){ return [c.firstName, c.lastName].filter(Boolean).join(" ").trim(); }
function tierById(id){ return ALIGNMENT_TIERS.find(t=>t.id===id); }
function tagById(id){ return TAGS.find(t=>t.id===id); }
function groupById(id){ return GROUPS.find(g=>g.id===id); }

async function getRelationshipsFor(contactId){
  const all = await idbGetAll("relationships");
  return all.filter(r=> r.a===contactId || r.b===contactId);
}
async function getTimelineFor(contactId){
  const all = await idbGetAll("timeline");
  return all.filter(e=> e.contactId===contactId).sort((a,b)=> b.date.localeCompare(a.date) || b.createdAt-a.createdAt);
}
async function deleteContactCascade(contactId){
  await idbDelete("contacts", contactId);
  const rels = await idbGetAll("relationships");
  for(const r of rels){ if(r.a===contactId || r.b===contactId) await idbDelete("relationships", r.id); }
  const entries = await idbGetAll("timeline");
  for(const e of entries){ if(e.contactId===contactId) await idbDelete("timeline", e.id); }
}

/* ---------- router ---------- */
const state = { page:"list", contactId:null, mmBaseId:null, mmDegree:1 };
const $app = ()=>document.getElementById("app");
function toast(msg){
  const t=document.createElement("div"); t.className="toast"; t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 2200);
}
function goto(page, opts={}){
  state.page = page;
  Object.assign(state, opts);
  render();
}
async function render(){
  if(state.page==="list") await renderList();
  else if(state.page==="profile") await renderProfile();
  else if(state.page==="dates") await renderDates();
  else if(state.page==="mindmap") await renderMindmap();
  else if(state.page==="settings") await renderSettings();
}
function topTabs(active){
  return `<div class="tabbar">
    <div class="tab ${active==='list'?'active':''}" data-go="list">Contacts</div>
    <div class="tab ${active==='dates'?'active':''}" data-go="dates">Key dates</div>
    <div class="tab ${active==='mindmap'?'active':''}" data-go="mindmap">Relations</div>
    <div class="tab ${active==='settings'?'active':''}" data-go="settings">Settings</div>
  </div>`;
}
function wireTabs(){
  document.querySelectorAll("[data-go]").forEach(el=>{
    el.onclick = ()=> goto(el.dataset.go);
  });
}

/* ---------- CONTACT LIST ---------- */
let listGroupFilter = "";
let listSearch = "";

async function renderList(){
  CONTACTS = (await idbGetAll("contacts")).sort((a,b)=> fullName(a).localeCompare(fullName(b)));
  const filtered = CONTACTS.filter(c=>{
    if(listGroupFilter && !(c.groupIds||[]).includes(listGroupFilter)) return false;
    if(listSearch && !fullName(c).toLowerCase().includes(listSearch.toLowerCase())) return false;
    return true;
  });

  $app().innerHTML = `
    <div class="topbar">
      <div class="app-title"><span class="plus-badge">+</span> ContactPlus</div>
    </div>
    ${topTabs("list")}
    <input type="text" class="search" id="searchBox" placeholder="Search contacts..." value="${esc(listSearch)}">
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
      <button class="btn btn-small ${listGroupFilter===''?'':''}" data-filter="" style="${listGroupFilter===''?'background:var(--ink);color:var(--bg);':''}">All</button>
      ${GROUPS.map(g=>`<button class="btn btn-small" data-filter="${g.id}" style="${listGroupFilter===g.id?'background:var(--ink);color:var(--bg);':''}">${esc(g.name)}</button>`).join("")}
    </div>
    <div id="rows">
      ${filtered.length===0 ? `<div class="empty-note">No contacts yet. Tap + Add contact to start.</div>` :
        filtered.map(c=>{
          const tier = tierById(c.alignmentTierId);
          const subParts = [];
          if(c.headline) subParts.push(c.headline);
          return `<div class="contact-row" data-open="${c.id}">
            ${avatarHtml(c, "avatar")}
            <div><div class="c-name">${esc(fullName(c))||"(unnamed)"}</div><div class="c-sub">${esc(subParts.join(" · "))}</div></div>
            <div class="dot" style="background:${tier?tier.color:'#00000000'}"></div>
          </div>`;
        }).join("")}
    </div>
    <button class="btn-main" id="addContactBtn" style="margin-top:16px;">+ Add contact</button>
  `;
  wireTabs();
  document.getElementById("searchBox").oninput = (e)=>{ listSearch=e.target.value; renderListRowsOnly(filtered.length?null:null); render(); };
  document.querySelectorAll("[data-filter]").forEach(b=> b.onclick=()=>{ listGroupFilter=b.dataset.filter; render(); });
  document.querySelectorAll("[data-open]").forEach(r=> r.onclick=()=> goto("profile", {contactId:r.dataset.open}));
  document.getElementById("addContactBtn").onclick = async ()=>{
    const c = blankContact();
    await idbPut("contacts", c);
    goto("profile", {contactId:c.id, editing:true});
  };
}
function renderListRowsOnly(){ /* placeholder for potential perf optimization */ }
function initials(name){
  if(!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0]||"") + (parts[1]?.[0]||"")).toUpperCase();
}
function contactInitials(c){
  const i = (c.firstName?.[0]||"") + (c.lastName?.[0]||"");
  return i ? i.toUpperCase() : "?";
}

/* ---------- CONTACT PROFILE ---------- */
async function renderProfile(){
  const c = await idbGet("contacts", state.contactId);
  if(!c){ goto("list"); return; }
  const tier = tierById(c.alignmentTierId);
  const rels = await getRelationshipsFor(c.id);
  const timeline = await getTimelineFor(c.id);
  const editing = !!state.editing;

  $app().innerHTML = `
    <div class="topbar">
      <button class="btn btn-small" id="backBtn">&larr; Back</button>
      ${editing ? `<button class="btn btn-small btn-danger" id="deleteContactBtn">Delete</button>` : ""}
      <button class="btn btn-small" id="editBtn">${editing?"Done":"Edit"}</button>
    </div>

    <div class="profile-card" style="--al:${tier?tier.color:'#1B1B1B'}">
      <div class="profile-head">
        ${avatarHtml(c, "avatar avatar-lg")}
        <div style="flex:1;">
          ${editing ? `<div style="display:flex;gap:6px;">
              <input type="text" id="f_firstName" placeholder="First name" value="${esc(c.firstName)}" style="flex:1;">
              <input type="text" id="f_lastName" placeholder="Last name" value="${esc(c.lastName)}" style="flex:1;">
            </div>` : `<div class="pname headline" style="font-size:20px;">${esc(fullName(c))||"(unnamed)"}</div>`}
          ${editing ? `
            <select id="f_alignment">
              <option value="">No alignment set</option>
              ${ALIGNMENT_TIERS.map(t=>`<option value="${t.id}" ${t.id===c.alignmentTierId?"selected":""}>${esc(t.name)}</option>`).join("")}
            </select>` :
            (tier ? `<span class="align-tag">${esc(tier.name)}</span>` : "")}
        </div>
      </div>

      ${editing ? `
        <div style="display:flex;gap:6px;margin-bottom:10px;">
          <input type="file" accept="image/*" id="photoInput" style="display:none;">
          <button class="btn btn-small" id="choosePhotoBtn" type="button">${c.photo?"Change photo":"Add photo"}</button>
          ${c.photo ? `<button class="btn btn-small btn-danger" id="removePhotoBtn" type="button">Remove photo</button>` : ""}
        </div>
      ` : ""}

      ${editing ? `
        <label class="field-label">Phone (with country code)</label>
        <input type="tel" id="f_phone" placeholder="+44 7700 900123" value="${esc(c.phone)}">
        <label class="field-label">Email</label>
        <input type="email" id="f_email" placeholder="name@example.com" value="${esc(c.email)}">
        <label class="field-label">Headline</label>
        <input type="text" id="f_headline" placeholder="Coursemate, Chemistry" value="${esc(c.headline)}">
        <label class="field-label">Groups</label>
        <div id="groupChips">${renderGroupChips(c)}</div>
        <button class="btn btn-small" id="manageGroupsBtn" type="button">Manage in Settings</button>
      ` : `
        ${c.phone ? `<div class="info-row"><span class="ico">&#9742;</span> <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></div>` : ""}
        ${c.email ? `<div class="info-row"><span class="ico">&#9993;</span> <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>` : ""}
        ${c.headline ? `<div class="info-row"><span class="ico">&#10022;</span> ${esc(c.headline)}</div>` : ""}
        ${(c.groupIds||[]).length ? `<div style="margin-top:6px;">${(c.groupIds||[]).map(gid=>{const g=groupById(gid); return g?`<span class="chip">${esc(g.name)}</span>`:"";}).join("")}</div>` : ""}
      `}

      <div class="divider"></div>
      <div class="section-label" style="margin-top:0;">Social links</div>
      <div id="socialLinksWrap">${renderSocialLinks(c, editing)}</div>
      ${editing ? `<button class="btn btn-small" id="addSocialBtn" type="button">+ Add link</button>` : ""}
    </div>

    ${editing ? `<button class="btn-main" id="saveProfileBtn" style="margin-bottom:16px;">Save</button>` : ""}

    <div class="section-label">Key dates</div>
    <div id="keyDatesWrap">${renderKeyDates(c)}</div>
    <button class="btn btn-small" id="addKeyDateBtn">+ Add key date</button>

    <div class="section-label">Relationships</div>
    <div id="relWrap">${await renderRelList(c, rels)}</div>
    <button class="btn btn-small" id="addRelBtn">+ Add relationship</button>

    <div class="section-label">Timeline</div>
    <div id="timelineAdd">
      <label class="field-label">Date</label>
      <input type="date" id="newEntryDate" value="${todayStr()}" max="${todayStr()}">
      <label class="field-label">Entry</label>
      <textarea id="newEntryText" placeholder="What did they say or share — today, or looking back?"></textarea>
      <div id="newEntryTags">${TAGS.map(t=>`<label style="display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;font-size:12px;"><input type="checkbox" data-tag="${t.id}" style="width:14px;height:14px;"> <span style="color:${t.color}">${esc(t.name)}</span></label>`).join("")}</div>
      <label style="display:flex;align-items:center;gap:8px;margin:8px 0 2px;font-size:14px;"><input type="checkbox" id="newEntryAsKeyDate" style="width:16px;height:16px;"> Also add this date to Key Dates</label>
      <button class="btn btn-small" id="addEntryBtn" style="margin-top:6px;">Add entry</button>
    </div>
    <div id="timelineList">${renderTimelineList(timeline)}</div>
  `;

  document.getElementById("backBtn").onclick = ()=> goto("list");
  const deleteBtn = document.getElementById("deleteContactBtn");
  if(deleteBtn) deleteBtn.onclick = async ()=>{
    const ok = confirm(`Delete ${fullName(c) || "this contact"}? This also removes their relationship links and timeline entries. This can't be undone.`);
    if(!ok) return;
    await deleteContactCascade(c.id);
    toast("Contact deleted.");
    goto("list");
  };
  document.getElementById("editBtn").onclick = async ()=>{
    if(editing){
      await saveProfileFields(c);
    }
    goto("profile", {contactId:c.id, editing: !editing});
  };
  if(editing){
    const saveBtn = document.getElementById("saveProfileBtn");
    if(saveBtn) saveBtn.onclick = async ()=>{ await saveProfileFields(c); goto("profile", {contactId:c.id, editing:false}); };
    const choosePhotoBtn = document.getElementById("choosePhotoBtn");
    if(choosePhotoBtn) choosePhotoBtn.onclick = ()=> document.getElementById("photoInput").click();
    const photoInput = document.getElementById("photoInput");
    if(photoInput) photoInput.onchange = async ()=>{
      const file = photoInput.files[0];
      if(!file) return;
      const compressed = await compressImage(file, 1200);
      await saveProfileFields(c);
      c.photo = compressed;
      await idbPut("contacts", c);
      goto("profile",{contactId:c.id, editing:true});
    };
    const removePhotoBtn = document.getElementById("removePhotoBtn");
    if(removePhotoBtn) removePhotoBtn.onclick = async ()=>{
      await saveProfileFields(c);
      c.photo = null;
      await idbPut("contacts", c);
      goto("profile",{contactId:c.id, editing:true});
    };
    const addSocialBtn = document.getElementById("addSocialBtn");
    if(addSocialBtn) addSocialBtn.onclick = async ()=>{
      await saveProfileFields(c);
      c.socialLinks = c.socialLinks||[];
      c.socialLinks.push({platform:"", url:""});
      await idbPut("contacts", c);
      goto("profile",{contactId:c.id, editing:true});
    };
    document.querySelectorAll("[data-rm-social]").forEach(b=> b.onclick=async ()=>{
      await saveProfileFields(c);
      c.socialLinks.splice(parseInt(b.dataset.rmSocial,10),1);
      await idbPut("contacts", c);
      goto("profile",{contactId:c.id, editing:true});
    });
    document.querySelectorAll("[data-toggle-group]").forEach(chip=> chip.onclick=async ()=>{
      await saveProfileFields(c);
      const gid = chip.dataset.toggleGroup;
      c.groupIds = c.groupIds||[];
      const idx = c.groupIds.indexOf(gid);
      if(idx>=0) c.groupIds.splice(idx,1); else c.groupIds.push(gid);
      await idbPut("contacts", c);
      goto("profile",{contactId:c.id, editing:true});
    });
  }

  document.getElementById("addKeyDateBtn").onclick = async ()=>{ if(editing) await saveProfileFields(c); openKeyDateEditor(c, null); };
  document.querySelectorAll("[data-edit-kd]").forEach(b=> b.onclick=async ()=>{ if(editing) await saveProfileFields(c); openKeyDateEditor(c, c.keyDates.find(k=>k.id===b.dataset.editKd)); });
  document.querySelectorAll("[data-del-kd]").forEach(b=> b.onclick=async ()=>{
    if(editing) await saveProfileFields(c);
    c.keyDates = c.keyDates.filter(k=>k.id!==b.dataset.delKd);
    await idbPut("contacts", c);
    goto("profile",{contactId:c.id, editing});
  });

  document.getElementById("addRelBtn").onclick = async ()=>{ if(editing) await saveProfileFields(c); openRelationshipEditor(c, null); };
  document.querySelectorAll("[data-edit-rel]").forEach(b=> b.onclick=async ()=>{
    if(editing) await saveProfileFields(c);
    const rel = (await idbGetAll("relationships")).find(r=>r.id===b.dataset.editRel);
    openRelationshipEditor(c, rel);
  });

  document.getElementById("addEntryBtn").onclick = async ()=>{
    const text = document.getElementById("newEntryText").value.trim();
    if(!text){ toast("Write something first."); return; }
    const entryDate = document.getElementById("newEntryDate").value || todayStr();
    if(editing) await saveProfileFields(c);
    const tagIds = Array.from(document.querySelectorAll("[data-tag]:checked")).map(el=>el.dataset.tag);
    const alsoKeyDate = document.getElementById("newEntryAsKeyDate").checked;
    await idbPut("timeline", {id:uid(), contactId:c.id, date:entryDate, text, tagIds, createdAt:Date.now()});
    if(alsoKeyDate){
      const prefillName = text.length>40 ? text.slice(0,40)+"\u2026" : text;
      const kdPrefill = {
        id: uid(), name: prefillName, date: entryDate,
        recurring:false, numbered:false, startNumber:1,
        startYear: parseInt(entryDate.split("-")[0],10)
      };
      goto("profile",{contactId:c.id, editing});
      openKeyDateEditor(c, kdPrefill);
      return;
    }
    goto("profile",{contactId:c.id, editing});
    toast("Entry added.");
  };
  document.querySelectorAll("[data-edit-entry]").forEach(b=> b.onclick=async ()=>{
    const entry = timeline.find(e=>e.id===b.dataset.editEntry);
    if(entry) openTimelineEntryEditor(c, entry);
  });
  document.querySelectorAll("[data-del-entry]").forEach(b=> b.onclick=async ()=>{
    if(!confirm("Delete this timeline entry? This can't be undone.")) return;
    await idbDelete("timeline", b.dataset.delEntry);
    goto("profile",{contactId:c.id, editing});
    toast("Entry deleted.");
  });
}

function renderGroupChips(c){
  if(GROUPS.length===0) return `<div class="empty-note">No groups yet — add some in Settings.</div>`;
  return GROUPS.map(g=>{
    const on = (c.groupIds||[]).includes(g.id);
    return `<span class="chip" data-toggle-group="${g.id}" style="cursor:pointer;${on?'background:var(--ink);color:var(--bg);':''}">${esc(g.name)}</span>`;
  }).join("");
}
function renderSocialLinks(c, editing){
  const links = c.socialLinks||[];
  if(!editing){
    if(links.length===0) return `<div class="empty-note">None added.</div>`;
    return links.filter(l=>l.url).map(l=>`<div class="info-row"><span class="ico">&#128279;</span> <a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.platform||l.url)}</a></div>`).join("");
  }
  if(links.length===0) return `<div class="empty-note">None yet.</div>`;
  return links.map((l,i)=>`
    <div style="display:flex;gap:6px;margin-bottom:6px;">
      <input type="text" style="flex:1;margin-bottom:0;" placeholder="Platform" value="${esc(l.platform)}" data-social-platform="${i}">
      <input type="text" style="flex:2;margin-bottom:0;" placeholder="https://..." value="${esc(l.url)}" data-social-url="${i}">
      <button class="btn btn-small" data-rm-social="${i}" type="button">&times;</button>
    </div>`).join("");
}
function renderKeyDates(c){
  const dates = (c.keyDates||[]).slice().sort((a,b)=> a.date.localeCompare(b.date));
  if(dates.length===0) return `<div class="empty-note">No key dates yet.</div>`;
  return dates.map(kd=>{
    const thisYear = parseInt(todayStr().split("-")[0],10);
    const num = keyDateNumberFor(kd, thisYear);
    return `<div class="rel-row">
      <span>${esc(kd.name)} — ${fmtHuman(kd.date)}${kd.recurring?" (yearly)":""}${num?` · ${ordinal(num)}`:""}</span>
      <span><button class="btn btn-small" data-edit-kd="${kd.id}">edit</button> <button class="btn btn-small btn-danger" data-del-kd="${kd.id}">del</button></span>
    </div>`;
  }).join("");
}
async function renderRelList(c, rels){
  if(rels.length===0) return `<div class="empty-note">No relationships mapped yet.</div>`;
  const rows = await Promise.all(rels.map(async r=>{
    const otherId = r.a===c.id ? r.b : r.a;
    const other = await idbGet("contacts", otherId);
    const otherName = other ? fullName(other) : "(deleted)";
    let arrow = "&harr;";
    if(r.direction==="A>B") arrow = r.a===c.id ? "&rarr;" : "&larr;";
    if(r.direction==="B>A") arrow = r.a===c.id ? "&larr;" : "&rarr;";
    return `<div class="rel-row" data-edit-rel="${r.id}" style="cursor:pointer;">
      <span>${arrow} <b>${esc(otherName)}</b> <span class="rel-arrow">${esc(r.description||"")}</span></span>
    </div>`;
  }));
  return rows.join("");
}
function openTimelineEntryEditor(c, entry){
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="sheet">
      <h3>Edit timeline entry</h3>
      <label class="field-label">Date</label>
      <input type="date" id="te_date" value="${entry.date}" max="${todayStr()}">
      <label class="field-label">Entry</label>
      <textarea id="te_text">${esc(entry.text)}</textarea>
      <label class="field-label">Tags</label>
      <div id="te_tags">${TAGS.map(t=>`<label style="display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;font-size:12px;"><input type="checkbox" data-te-tag="${t.id}" ${(entry.tagIds||[]).includes(t.id)?"checked":""} style="width:14px;height:14px;"> <span style="color:${t.color}">${esc(t.name)}</span></label>`).join("")}</div>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button class="btn btn-danger" id="te_delete" type="button">Delete</button>
        <button class="btn" id="te_cancel" style="flex:1;">Cancel</button>
        <button class="btn-main" id="te_save" style="flex:1;">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById("te_cancel").onclick = ()=> overlay.remove();
  document.getElementById("te_delete").onclick = async ()=>{
    if(!confirm("Delete this timeline entry? This can't be undone.")) return;
    await idbDelete("timeline", entry.id);
    overlay.remove();
    goto("profile",{contactId:c.id, editing:state.editing});
    toast("Entry deleted.");
  };
  document.getElementById("te_save").onclick = async ()=>{
    const text = document.getElementById("te_text").value.trim();
    if(!text){ toast("Entry can't be empty."); return; }
    entry.date = document.getElementById("te_date").value || entry.date;
    entry.text = text;
    entry.tagIds = Array.from(document.querySelectorAll("[data-te-tag]:checked")).map(el=>el.dataset.teTag);
    await idbPut("timeline", entry);
    overlay.remove();
    goto("profile",{contactId:c.id, editing:state.editing});
    toast("Entry updated.");
  };
}
function renderTimelineList(timeline){
  if(timeline.length===0) return `<div class="empty-note">No timeline entries yet.</div>`;
  return timeline.map(e=>`
    <div class="timeline-entry">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <div class="t-date">${fmtHuman(e.date)}</div>
        <span><button class="btn btn-small" data-edit-entry="${e.id}">edit</button> <button class="btn btn-small btn-danger" data-del-entry="${e.id}">del</button></span>
      </div>
      <div class="t-text">${esc(e.text)}</div>
      <div class="t-tags">${(e.tagIds||[]).map(tid=>{const t=tagById(tid); return t?`<span class="chip" style="border-color:${t.color};color:${t.color};">${esc(t.name)}</span>`:"";}).join("")}</div>
    </div>`).join("");
}

async function saveProfileFields(c){
  c.firstName = document.getElementById("f_firstName").value.trim();
  c.lastName = document.getElementById("f_lastName").value.trim();
  c.alignmentTierId = document.getElementById("f_alignment").value;
  c.phone = document.getElementById("f_phone").value.trim();
  c.email = document.getElementById("f_email").value.trim();
  c.headline = document.getElementById("f_headline").value.trim();
  document.querySelectorAll("[data-social-platform]").forEach(el=>{
    c.socialLinks[parseInt(el.dataset.socialPlatform,10)].platform = el.value;
  });
  document.querySelectorAll("[data-social-url]").forEach(el=>{
    c.socialLinks[parseInt(el.dataset.socialUrl,10)].url = el.value;
  });
  await idbPut("contacts", c);
}

/* ---------- key date editor ---------- */
function openKeyDateEditor(c, existing){
  const kd = existing || {id:uid(), name:"", date:todayStr(), recurring:false, numbered:false, startNumber:1, startYear:parseInt(todayStr().split("-")[0],10)};
  const isNew = !(c.keyDates||[]).some(k=>k.id===kd.id);
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="sheet">
      <h3>${isNew?"Add":"Edit"} key date</h3>
      <label class="field-label">Name</label>
      <input type="text" id="kd_name" value="${esc(kd.name)}" placeholder="Birthday">
      <label class="field-label">Date</label>
      <input type="date" id="kd_date" value="${kd.date}">
      <label style="display:flex;align-items:center;gap:8px;margin:8px 0;"><input type="checkbox" id="kd_recurring" ${kd.recurring?"checked":""}> Recurring annually</label>
      <div id="numberedWrap" style="${kd.recurring?"":"display:none;"}">
        <label style="display:flex;align-items:center;gap:8px;margin:8px 0;"><input type="checkbox" id="kd_numbered" ${kd.numbered?"checked":""}> Numbered (e.g. 1st, 2nd...)</label>
        <div id="numberFields" style="${kd.numbered?"":"display:none;"}">
          <label class="field-label">Starting number</label>
          <input type="number" id="kd_startNumber" value="${kd.startNumber||1}" min="1">
          <label class="field-label">Starting year</label>
          <input type="number" id="kd_startYear" value="${kd.startYear||parseInt(kd.date.split('-')[0],10)}">
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button class="btn" id="kd_cancel" style="flex:1;">Cancel</button>
        <button class="btn-main" id="kd_save" style="flex:1;">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById("kd_recurring").onchange = (e)=>{ document.getElementById("numberedWrap").style.display = e.target.checked?"":"none"; };
  document.getElementById("numberedWrap").querySelector("#kd_numbered")?.addEventListener("change",(e)=>{
    document.getElementById("numberFields").style.display = e.target.checked?"":"none";
  });
  document.getElementById("kd_cancel").onclick = ()=> overlay.remove();
  document.getElementById("kd_save").onclick = async ()=>{
    kd.name = document.getElementById("kd_name").value.trim() || "Date";
    kd.date = document.getElementById("kd_date").value;
    kd.recurring = document.getElementById("kd_recurring").checked;
    kd.numbered = kd.recurring && !!document.getElementById("kd_numbered")?.checked;
    kd.startNumber = parseInt(document.getElementById("kd_startNumber")?.value || 1, 10);
    kd.startYear = parseInt(document.getElementById("kd_startYear")?.value || kd.date.split("-")[0], 10);
    c.keyDates = c.keyDates || [];
    const idx = c.keyDates.findIndex(x=>x.id===kd.id);
    if(idx>=0) c.keyDates[idx]=kd; else c.keyDates.push(kd);
    await idbPut("contacts", c);
    overlay.remove();
    goto("profile",{contactId:c.id, editing:state.editing});
  };
}

/* ---------- relationship editor ---------- */
async function openRelationshipEditor(c, existing){
  const others = (await idbGetAll("contacts")).filter(x=>x.id!==c.id);
  const r = existing || {id:uid(), a:c.id, b:others[0]?.id||"", direction:"double", description:""};
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="sheet">
      <h3>${existing?"Edit":"Add"} relationship</h3>
      <label class="field-label">With</label>
      <select id="rel_other">
        ${others.map(o=>`<option value="${o.id}" ${(o.id===r.a||o.id===r.b)&&o.id!==c.id?"selected":""}>${esc(fullName(o))}</option>`).join("")}
      </select>
      <label class="field-label">Direction</label>
      <select id="rel_direction">
        <option value="double" ${r.direction==="double"?"selected":""}>Double-sided (mutual)</option>
        <option value="A>B" ${r.direction==="A>B"?"selected":""}>${esc(fullName(c))} &rarr; them</option>
        <option value="B>A" ${r.direction==="B>A"?"selected":""}>Them &rarr; ${esc(fullName(c))}</option>
      </select>
      <label class="field-label">Description</label>
      <input type="text" id="rel_desc" placeholder="sister, introduced me to, manager..." value="${esc(r.description)}">
      <div style="display:flex;gap:8px;margin-top:14px;">
        ${existing ? `<button class="btn btn-danger" id="rel_delete" type="button">Delete</button>` : ""}
        <button class="btn" id="rel_cancel" style="flex:1;">Cancel</button>
        <button class="btn-main" id="rel_save" style="flex:1;">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById("rel_cancel").onclick = ()=> overlay.remove();
  if(existing){
    document.getElementById("rel_delete").onclick = async ()=>{
      await idbDelete("relationships", r.id);
      overlay.remove();
      goto("profile",{contactId:c.id, editing:state.editing});
    };
  }
  document.getElementById("rel_save").onclick = async ()=>{
    const otherId = document.getElementById("rel_other").value;
    r.a = c.id; r.b = otherId;
    r.direction = document.getElementById("rel_direction").value;
    r.description = document.getElementById("rel_desc").value.trim();
    await idbPut("relationships", r);
    overlay.remove();
    goto("profile",{contactId:c.id, editing:state.editing});
  };
}

/* ---------- KEY DATES combined page + ICS export ---------- */
let datesWindowDays = 90; // default view window; 0 = show all upcoming

async function renderDates(){
  CONTACTS = await idbGetAll("contacts");
  const today = todayStr();
  const windowEnd = datesWindowDays>0 ? addDaysStr(today, datesWindowDays) : null;
  const items = [];
  CONTACTS.forEach(c=>{
    (c.keyDates||[]).forEach(kd=>{
      let occDate = kd.date;
      if(kd.recurring) occDate = nextOccurrence(kd.date, today);
      if(occDate < today) return;
      if(windowEnd && occDate > windowEnd) return;
      const year = parseInt(occDate.split("-")[0],10);
      const num = keyDateNumberFor(kd, year);
      items.push({contactName:fullName(c), contactId:c.id, name:kd.name, date:occDate, num});
    });
  });
  items.sort((a,b)=> a.date.localeCompare(b.date));

  $app().innerHTML = `
    <div class="topbar"><div class="app-title"><span class="plus-badge">+</span> ContactPlus</div></div>
    ${topTabs("dates")}
    <div class="section-label" style="margin-top:0;">Upcoming key dates</div>
    <label class="field-label">Show dates within</label>
    <select id="datesWindowSelect">
      <option value="30" ${datesWindowDays===30?"selected":""}>Next 30 days</option>
      <option value="90" ${datesWindowDays===90?"selected":""}>Next 3 months</option>
      <option value="180" ${datesWindowDays===180?"selected":""}>Next 6 months</option>
      <option value="365" ${datesWindowDays===365?"selected":""}>Next year</option>
      <option value="0" ${datesWindowDays===0?"selected":""}>All upcoming</option>
    </select>
    ${items.length===0 ? `<div class="empty-note">No key dates in this window.</div>` :
      items.map(it=>`<div class="rel-row" data-open="${it.contactId}" style="cursor:pointer;">
        <span><b>${esc(it.contactName)}</b> — ${esc(it.name)}${it.num?` (${ordinal(it.num)})`:""}</span>
        <span class="rel-arrow">${fmtHuman(it.date)}</span>
      </div>`).join("")}

    <div class="settings-group" style="margin-top:20px;">
      <h3>Export to calendar (.ics)</h3>
      <p style="font-size:12px;color:var(--muted);margin:0 0 8px;">Export uses its own date range below, independent of the view filter above.</p>
      <label class="field-label">From</label>
      <input type="date" id="exp_from" value="${today}">
      <label class="field-label">To</label>
      <input type="date" id="exp_to" value="${addDaysStr(today,180)}">
      <button class="btn-main" id="exportIcsBtn" style="margin-top:8px;">Export .ics</button>
    </div>
  `;
  wireTabs();
  document.getElementById("datesWindowSelect").onchange = (e)=>{ datesWindowDays = parseInt(e.target.value,10); render(); };
  document.querySelectorAll("[data-open]").forEach(r=> r.onclick=()=> goto("profile",{contactId:r.dataset.open}));
  document.getElementById("exportIcsBtn").onclick = exportICS;
}
function addDaysStr(dateStr, n){ const d=parseYMD(dateStr); d.setUTCDate(d.getUTCDate()+n); return fmtYMD(d); }

async function exportICS(){
  const from = document.getElementById("exp_from").value;
  const to = document.getElementById("exp_to").value;
  if(!from || !to || to<from){ toast("Check the date range."); return; }
  CONTACTS = await idbGetAll("contacts");
  const events = [];
  CONTACTS.forEach(c=>{
    (c.keyDates||[]).forEach(kd=>{
      if(kd.recurring){
        let d = nextOccurrence(kd.date, from);
        while(d<=to){
          const year = parseInt(d.split("-")[0],10);
          const num = keyDateNumberFor(kd, year);
          events.push({summary:`${fullName(c)} — ${kd.name}${num?` (${ordinal(num)})`:""}`, date:d});
          const [,m,dd] = d.split("-");
          d = `${year+1}-${m}-${dd}`;
        }
      } else if(kd.date>=from && kd.date<=to){
        events.push({summary:`${fullName(c)} — ${kd.name}`, date:kd.date});
      }
    });
  });
  if(events.length===0){ toast("No key dates in that range."); return; }
  let ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//ContactPlus//EN\r\n";
  events.forEach(ev=>{
    const dateCompact = ev.date.replace(/-/g,"");
    ics += `BEGIN:VEVENT\r\nUID:${uid()}@contactplus\r\nDTSTART;VALUE=DATE:${dateCompact}\r\nSUMMARY:${icsEscape(ev.summary)}\r\nEND:VEVENT\r\n`;
  });
  ics += "END:VCALENDAR\r\n";
  const blob = new Blob([ics], {type:"text/calendar"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `contactplus_dates_${from}_to_${to}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
  toast("Calendar file exported.");
}
function icsEscape(s){ return (s||"").replace(/[\\,;]/g, m=>"\\"+m); }

/* ---------- MINDMAP ---------- */
async function renderMindmap(){
  CONTACTS = (await idbGetAll("contacts")).sort((a,b)=>fullName(a).localeCompare(fullName(b)));
  if(!state.mmBaseId && CONTACTS.length) state.mmBaseId = CONTACTS[0].id;

  $app().innerHTML = `
    <div class="topbar"><div class="app-title"><span class="plus-badge">+</span> ContactPlus</div></div>
    ${topTabs("mindmap")}
    ${CONTACTS.length===0 ? `<div class="empty-note">Add some contacts first.</div>` : `
    <label class="field-label">Base contact</label>
    <select id="mm_base">
      ${CONTACTS.map(c=>`<option value="${c.id}" ${c.id===state.mmBaseId?"selected":""}>${esc(fullName(c))}</option>`).join("")}
    </select>
    <div class="stepper">
      <button id="mm_dec">&minus;</button>
      <div class="val">Degree ${state.mmDegree}</div>
      <button id="mm_inc">+</button>
    </div>
    <div class="mindmap-wrap" id="mmCanvas"></div>
    `}
  `;
  wireTabs();
  if(CONTACTS.length===0) return;
  document.getElementById("mm_base").onchange = (e)=>{ state.mmBaseId = e.target.value; render(); };
  document.getElementById("mm_dec").onclick = ()=>{ state.mmDegree = Math.max(0, state.mmDegree-1); render(); };
  document.getElementById("mm_inc").onclick = ()=>{ state.mmDegree = Math.min(5, state.mmDegree+1); render(); };
  await drawMindmap();
}

async function drawMindmap(){
  const canvas = document.getElementById("mmCanvas");
  const W = canvas.clientWidth || 600, H = 360;
  const rels = await idbGetAll("relationships");
  const byId = {}; CONTACTS.forEach(c=> byId[c.id]=c);

  // BFS from base up to state.mmDegree
  const degreeOf = {}; degreeOf[state.mmBaseId] = 0;
  let frontier = [state.mmBaseId];
  for(let d=1; d<=state.mmDegree; d++){
    const next = [];
    frontier.forEach(nid=>{
      rels.forEach(r=>{
        if(r.a===nid && !(r.b in degreeOf)){ degreeOf[r.b]=d; next.push(r.b); }
        if(r.b===nid && !(r.a in degreeOf)){ degreeOf[r.a]=d; next.push(r.a); }
      });
    });
    frontier = next;
  }
  const includedIds = Object.keys(degreeOf).filter(id=> byId[id]);
  const edges = rels.filter(r=> includedIds.includes(r.a) && includedIds.includes(r.b));

  // layout: rings by degree
  const cx=W/2, cy=H/2, ringGap=Math.min(W,H)/2/Math.max(1,state.mmDegree||1)*0.85;
  const byDegree = {};
  includedIds.forEach(id=>{ const d=degreeOf[id]; (byDegree[d]=byDegree[d]||[]).push(id); });
  const pos = {};
  Object.keys(byDegree).forEach(dStr=>{
    const d = parseInt(dStr,10);
    const ids = byDegree[d];
    const r = d===0 ? 0 : Math.max(70, d*ringGap);
    ids.forEach((id,i)=>{
      const angle = (2*Math.PI*i/ids.length) - Math.PI/2;
      pos[id] = { x: cx + r*Math.cos(angle), y: cy + r*Math.sin(angle) };
    });
  });

  let arrowsSvg = `<svg class="arrows" viewBox="0 0 ${W} ${H}"><defs>
    <marker id="mmArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#1B1B1B"/></marker>
  </defs>`;
  edges.forEach(r=>{
    const p1 = pos[r.a], p2 = pos[r.b];
    if(!p1||!p2) return;
    const markerEnd = (r.direction==="A>B" || r.direction==="double") ? `marker-end="url(#mmArrow)"` : "";
    const markerStart = (r.direction==="B>A" || r.direction==="double") ? `marker-start="url(#mmArrow)"` : "";
    arrowsSvg += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#1B1B1B" stroke-width="1.6" ${markerEnd} ${markerStart}/>`;
    const mx=(p1.x+p2.x)/2, my=(p1.y+p2.y)/2;
    if(r.description) arrowsSvg += `<text x="${mx}" y="${my-4}" font-family="Patrick Hand" font-size="10" fill="#7a7566" text-anchor="middle">${esc(r.description)}</text>`;
  });
  arrowsSvg += `</svg>`;

  let bubblesHtml = "";
  includedIds.forEach(id=>{
    const c = byId[id];
    const p = pos[id];
    const size = id===state.mmBaseId ? 74 : 62;
    bubblesHtml += `<div class="bubble" style="width:${size}px;height:${size}px;left:${p.x-size/2}px;top:${p.y-size/2}px;">
      <div class="bn">${esc(fullName(c))}</div>
      <div class="br">${esc(c.headline||"")}</div>
    </div>`;
  });

  canvas.innerHTML = arrowsSvg + bubblesHtml;
}

/* ---------- SETTINGS ---------- */
async function renderSettings(){
  GROUPS = await idbGetAll("groups");
  ALIGNMENT_TIERS = (await idbGetAll("alignmentTiers")).sort((a,b)=>a.order-b.order);
  TAGS = (await idbGetAll("tags")).sort((a,b)=>a.order-b.order);

  $app().innerHTML = `
    <div class="topbar"><div class="app-title"><span class="plus-badge">+</span> ContactPlus</div></div>
    ${topTabs("settings")}

    <div class="settings-group">
      <h3>Groups</h3>
      <div id="groupsList">${GROUPS.map(g=>`
        <div class="tier-row">
          <input type="text" class="group-name-input" data-group-id="${g.id}" value="${esc(g.name)}" style="flex:1;margin-bottom:0;">
          <button class="btn btn-small" data-save-group="${g.id}">save</button>
          <button class="btn btn-small btn-danger" data-rm-group="${g.id}">delete</button>
        </div>`).join("") || `<div class="empty-note">No groups yet.</div>`}
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;">
        <input type="text" id="newGroupName" placeholder="New group name" style="flex:1;margin-bottom:0;">
        <button class="btn" id="addGroupBtn">Add</button>
      </div>
    </div>

    <div class="settings-group">
      <h3>Alignment tiers</h3>
      <div id="tiersList">${ALIGNMENT_TIERS.map((t,i)=>tierRowHtml("alignmentTiers", t, i, ALIGNMENT_TIERS.length)).join("")}</div>
      <button class="btn btn-small" id="addTierBtn" style="margin-top:8px;">+ Add tier</button>
    </div>

    <div class="settings-group">
      <h3>Timeline tags</h3>
      <div id="tagsList">${TAGS.map((t,i)=>tierRowHtml("tags", t, i, TAGS.length)).join("")}</div>
      <button class="btn btn-small" id="addTagBtn" style="margin-top:8px;">+ Add tag</button>
    </div>

    <div class="settings-group">
      <h3>Contacts import / export</h3>
      <p style="font-size:13px;color:var(--muted);margin:0 0 8px;">Standard fields only (name, phone, email) — private notes, relationships, and alignment never leave this app.</p>
      <button class="btn" id="exportVcfBtn" style="width:100%;margin-bottom:8px;">Export all as .vcf</button>
      <input type="file" id="importVcfInput" accept=".vcf,text/vcard" style="display:none;">
      <button class="btn" id="importVcfBtn" style="width:100%;">Import .vcf</button>
    </div>
  `;
  wireTabs();

  document.getElementById("addGroupBtn").onclick = async ()=>{
    const name = document.getElementById("newGroupName").value.trim();
    if(!name) return;
    await idbPut("groups", {id:uid(), name});
    render();
  };
  document.querySelectorAll("[data-save-group]").forEach(b=> b.onclick=async ()=>{
    const input = document.querySelector(`.group-name-input[data-group-id="${b.dataset.saveGroup}"]`);
    const name = input.value.trim();
    if(!name){ toast("Group name can't be empty."); return; }
    await idbPut("groups", {id:b.dataset.saveGroup, name});
    toast("Group renamed.");
    render();
  });
  document.querySelectorAll("[data-rm-group]").forEach(b=> b.onclick=async ()=>{
    await idbDelete("groups", b.dataset.rmGroup);
    render();
  });

  wireTierList("alignmentTiers", ALIGNMENT_TIERS);
  wireTierList("tags", TAGS);
  document.getElementById("addTierBtn").onclick = ()=> openTierEditor("alignmentTiers", null, ALIGNMENT_TIERS.length);
  document.getElementById("addTagBtn").onclick = ()=> openTierEditor("tags", null, TAGS.length);

  document.getElementById("exportVcfBtn").onclick = exportVCF;
  document.getElementById("importVcfBtn").onclick = ()=> document.getElementById("importVcfInput").click();
  document.getElementById("importVcfInput").onchange = importVCF;
}

function tierRowHtml(store, t, i, total){
  return `<div class="tier-row">
    <span class="tier-swatch" style="background:${t.color}"></span>
    <span class="tn">${esc(t.name)}</span>
    <button class="btn btn-small" data-move-up="${t.id}" data-store="${store}" ${i===0?"disabled":""}>&uarr;</button>
    <button class="btn btn-small" data-move-down="${t.id}" data-store="${store}" ${i===total-1?"disabled":""}>&darr;</button>
    <button class="btn btn-small" data-edit-tier="${t.id}" data-store="${store}">edit</button>
    <button class="btn btn-small" data-del-tier="${t.id}" data-store="${store}">del</button>
  </div>`;
}
function wireTierList(store, list){
  document.querySelectorAll(`[data-move-up][data-store="${store}"]`).forEach(b=> b.onclick=()=> reorderTier(store, list, b.dataset.moveUp, -1));
  document.querySelectorAll(`[data-move-down][data-store="${store}"]`).forEach(b=> b.onclick=()=> reorderTier(store, list, b.dataset.moveDown, 1));
  document.querySelectorAll(`[data-edit-tier][data-store="${store}"]`).forEach(b=> b.onclick=()=> openTierEditor(store, list.find(t=>t.id===b.dataset.editTier), list.length));
  document.querySelectorAll(`[data-del-tier][data-store="${store}"]`).forEach(b=> b.onclick=async ()=>{
    await idbDelete(store, b.dataset.delTier);
    render();
  });
}
async function reorderTier(store, list, id, dir){
  const idx = list.findIndex(t=>t.id===id);
  const swapIdx = idx+dir;
  if(swapIdx<0 || swapIdx>=list.length) return;
  const a = list[idx], b = list[swapIdx];
  const tmp = a.order; a.order = b.order; b.order = tmp;
  await idbPut(store, a); await idbPut(store, b);
  render();
}
function openTierEditor(store, existing, nextOrder){
  const t = existing || {id:uid(), name:"", color:"#7a7566", order:nextOrder};
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="sheet">
      <h3>${existing?"Edit":"Add"} ${store==="tags"?"tag":"tier"}</h3>
      <label class="field-label">Name</label>
      <input type="text" id="t_name" value="${esc(t.name)}">
      <label class="field-label">Colour</label>
      <input type="text" id="t_color" value="${t.color}" placeholder="#RRGGBB">
      <input type="color" id="t_colorPicker" value="${t.color}" style="width:100%;height:40px;padding:2px;">
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button class="btn" id="t_cancel" style="flex:1;">Cancel</button>
        <button class="btn-main" id="t_save" style="flex:1;">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById("t_colorPicker").oninput = (e)=>{ document.getElementById("t_color").value = e.target.value; };
  document.getElementById("t_cancel").onclick = ()=> overlay.remove();
  document.getElementById("t_save").onclick = async ()=>{
    t.name = document.getElementById("t_name").value.trim() || "Untitled";
    t.color = document.getElementById("t_color").value.trim() || "#7a7566";
    await idbPut(store, t);
    overlay.remove();
    render();
  };
}

/* ---------- vCard import / export ---------- */
async function exportVCF(){
  const all = await idbGetAll("contacts");
  if(all.length===0){ toast("No contacts to export."); return; }
  let vcf = "";
  all.forEach(c=>{
    vcf += "BEGIN:VCARD\r\nVERSION:3.0\r\n";
    vcf += `N:${vcfEscape(c.lastName)};${vcfEscape(c.firstName)};;;\r\n`;
    vcf += `FN:${vcfEscape(fullName(c))||"Unnamed"}\r\n`;
    if(c.phone) vcf += `TEL;TYPE=CELL:${vcfEscape(c.phone)}\r\n`;
    if(c.email) vcf += `EMAIL:${vcfEscape(c.email)}\r\n`;
    vcf += "END:VCARD\r\n";
  });
  const blob = new Blob([vcf], {type:"text/vcard"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download="contactplus_contacts.vcf";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
  toast("Exported.");
}
function vcfEscape(s){ return (s||"").replace(/[\\,;]/g, m=>"\\"+m); }

async function importVCF(e){
  const file = e.target.files[0];
  if(!file) return;
  const text = await file.text();
  const cards = text.split(/BEGIN:VCARD/i).slice(1);
  let count=0;
  for(const block of cards){
    const nField = /^N:(.*)$/im.exec(block);
    const fn = /^FN:(.*)$/im.exec(block);
    const tel = /TEL[^:]*:(.*)/i.exec(block);
    const email = /EMAIL[^:]*:(.*)/i.exec(block);
    if(!fn && !nField) continue;
    const c = blankContact();
    if(nField){
      const parts = nField[1].split(";");
      c.lastName = (parts[0]||"").trim();
      c.firstName = (parts[1]||"").trim();
    }
    if(!c.firstName && !c.lastName && fn){
      const nameParts = fn[1].trim().split(/\s+/);
      c.firstName = nameParts[0]||"";
      c.lastName = nameParts.slice(1).join(" ");
    }
    c.phone = tel ? tel[1].trim() : "";
    c.email = email ? email[1].trim() : "";
    await idbPut("contacts", c);
    count++;
  }
  toast(`Imported ${count} contact(s).`);
  render();
}

/* ---------- boot ---------- */
window.addEventListener("DOMContentLoaded", async ()=>{
  await loadAll();
  render();
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  }
});
