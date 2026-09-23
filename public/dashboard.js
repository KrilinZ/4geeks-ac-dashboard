let ALL = [];
let META = { generatedAt: null, cacheAgeSeconds: null };
let authToken = localStorage.getItem('dashboardToken');

// ---- Authentication ----
function checkAuth(){
  if(!authToken){
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    return false;
  }
  // BOTH #login-screen and #dashboard start as display:none in index.html.
  // This branch used to just `return true` without showing anything, so a
  // visitor holding a token (i.e. anyone who had already logged in, since
  // handleLogin reloads the page) got a permanently blank white page --
  // no console error, data fetched fine, nothing ever made visible.
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  return true;
}

function handleLogin(e){
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  fetch('/api/login', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body: JSON.stringify({ username, password })
  })
  .then(r=>{
    if(!r.ok) throw new Error('Invalid credentials');
    return r.json();
  })
  .then(data=>{
    authToken = data.token;
    localStorage.setItem('dashboardToken', authToken);
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    location.reload();
  })
  .catch(e=>{
    document.getElementById('login-error').textContent = e.message;
    document.getElementById('login-error').style.display = 'block';
  });
}

function handleLogout(){
  localStorage.removeItem('dashboardToken');
  authToken = null;
  location.reload();
}

// ---- Dashboard ----
const BUCKET_LABEL = { 'Won':'Won', 'Lost - Classified':'Lost (classified)', 'Lost - Unclassified':'Lost (no reason)', 'Active / Other':'Active / Other' };
const BUCKET_CLASS = { 'Won':'b-won', 'Lost - Classified':'b-lostc', 'Lost - Unclassified':'b-lostu', 'Active / Other':'b-other' };
const REGIONS = ['USA','Spain','LATAM'];

const state = { region:'all', bucket:'all', source:'all', medium:'all', campaign:'all', location:'all', course:'all', assignTo:'all', reason:'all', q:'', dateFrom:'', dateTo:'', admissionsScore:'all', leadSentiment:'all', admissionsConversationType:'all', classification:'all', dealQuality:'all' };
let sortState = { field:'date', dir:'desc' };
function syncStateFromUrl(){
  const params = new URLSearchParams(location.search);
  Object.keys(state).forEach(k=>{ if(params.has(k)) state[k] = params.get(k); });
}
function syncStateToUrl(){
  const params = new URLSearchParams();
  Object.entries(state).forEach(([k,v])=>{ if(v && v!=='all') params.set(k, v); });
  const qs = params.toString();
  history.replaceState(null, '', qs ? `${location.pathname}?${qs}` : location.pathname);
}
function showToast(msg){
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=> t.remove(), 2200);
}

async function loadData(region){
  const url = region && region!=='all' ? `/api/summary?region=${encodeURIComponent(region)}` : '/api/summary';
  let data = null;
  for(let attempt=0; attempt<180; attempt++){
    const res = await fetch(url);
    if(res.status===202){
      const body = await res.json().catch(()=>({}));
      document.getElementById('freshness').textContent = body.lastError ? `Loading from ActiveCampaign… (retrying after error: ${body.lastError})` : 'Loading from ActiveCampaign… (first load can take a few minutes)';
      await new Promise(r=>setTimeout(r, 3000));
      continue;
    }
    if(!res.ok){
      const err = await res.json().catch(()=>({error:res.statusText}));
      // Surface the failure in the freshness line only. The big red box (and a
      // link to /api/schema) was alarming in local dev where AC simply isn't
      // configured; the init() catch shows a friendly explanation instead.
      throw new Error(err.error||res.statusText);
    }
    data = await res.json();
    break;
  }
  if(!data) throw new Error('Timed out waiting for ActiveCampaign data');
  ALL = data.records;
  META = { generatedAt: data.generatedAt, cacheAgeSeconds: data.cacheAgeSeconds };
  renderFreshness();
}

function renderFreshness(){
  const el = document.getElementById('freshness');
  const t = META.generatedAt ? new Date(META.generatedAt).toLocaleString() : '—';
  el.innerHTML = `Data as of ${t} (cached ${META.cacheAgeSeconds ?? '?'}s ago) <button id="btn-refresh">Refresh now</button> <button id="btn-copy-link" class="ghost">Copy link to this view</button>`;
  document.getElementById('btn-refresh').addEventListener('click', async ()=>{
    document.getElementById('btn-refresh').textContent = 'Refreshing…';
    await fetch('/api/refresh', { method:'POST' });
    await loadData(state.region);
    buildFilters();
    renderAll();
  });
  document.getElementById('btn-copy-link').addEventListener('click', async ()=>{
    syncStateToUrl();
    try{ await navigator.clipboard.writeText(location.href); showToast('Link copied to clipboard'); }
    catch(e){ showToast('Could not copy link'); }
  });
}

function uniq(field){ const s=new Set(); ALL.forEach(r=>{ if(r[field]) s.add(r[field]); }); return Array.from(s).sort(); }
// The Lost Reasons field is a multiselect on the AC side (a deal can have 2+
// reasons checked), so `r.reasons` is always an array (possibly empty) while
// `r.reason` is a comma-joined display string. Anywhere we count/filter/group
// by reason we need to explode that array per-deal instead of treating the
// joined string as one atomic value -- otherwise "A" and "A, B" look like two
// unrelated reasons instead of both counting toward reason "A".
function uniqReasons(){ const s=new Set(); ALL.forEach(r=>{ (r.reasons||[]).forEach(x=>{ if(x) s.add(x); }); }); return Array.from(s).sort(); }
function countByReasons(rows){ const m={}; rows.forEach(r=>{ (r.reasons||[]).forEach(x=>{ if(x) m[x]=(m[x]||0)+1; }); }); return m; }

function filtered(){
  return ALL.filter(r=>{
    if(state.region!=='all' && r.region!==state.region) return false;
    if(state.bucket!=='all' && r.bucket!==state.bucket) return false;
    if(state.source!=='all' && r.source!==state.source) return false;
    if(state.medium!=='all' && r.medium!==state.medium) return false;
    if(state.campaign!=='all' && r.campaign!==state.campaign) return false;
    if(state.location!=='all' && r.location!==state.location) return false;
    if(state.course!=='all' && r.course!==state.course) return false;
    if(state.assignTo!=='all' && r.assignTo!==state.assignTo) return false;
    if(state.reason!=='all' && !(r.reasons||[]).includes(state.reason)) return false;
    if(state.admissionsScore!=='all' && r.admissionsScore!==state.admissionsScore) return false;
    if(state.leadSentiment!=='all' && r.leadSentiment!==state.leadSentiment) return false;
    if(state.admissionsConversationType!=='all' && r.admissionsConversationType!==state.admissionsConversationType) return false;
    if(state.classification!=='all' && r.classification!==state.classification) return false;
    if(state.dealQuality!=='all' && r.dealQuality!==state.dealQuality) return false;
    if(state.dateFrom && (!r.date || r.date < state.dateFrom)) return false;
    if(state.dateTo && (!r.date || r.date > state.dateTo)) return false;
    if(state.q){
      const q = state.q.toLowerCase();
      const hay = [r.name,r.email,r.id,r.campaign,r.location,r.course,r.reason].join(' ').toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });
}

function fmtPct(n,d){ return d? (n/d*100).toFixed(1)+'%' : '0%'; }
function countBy(rows, field){ const m={}; rows.forEach(r=>{ const k=r[field]||'(none)'; m[k]=(m[k]||0)+1; }); return m; }

function selectHtml(id,label,field,extraOptions){
  const opts = extraOptions || uniq(field).map(v=>({v,l:v}));
  return `<div class="filt"><label>${label}</label><select id="${id}">
    <option value="all">All</option>
    ${opts.map(o=>`<option value="${o.v}">${o.l}</option>`).join('')}
  </select></div>`;
}

function buildFilters(){
    const el = document.getElementById('filters');
    el.innerHTML = `
        <div class="filters-row">
              ${selectHtml('f-region','Region','', REGIONS.map(v=>({v,l:v})))}
                    ${selectHtml('f-bucket','Status bucket','bucket', Object.keys(BUCKET_LABEL).map(v=>({v,l:BUCKET_LABEL[v]})))}
                          ${selectHtml('f-reason','Lost reason','', uniqReasons().map(v=>({v,l:v})))}
                                ${selectHtml('f-admissionsConversationType','Admissions conversation type','admissionsConversationType')}
                                      <div class="filt"><label>Search</label><input type="text" id="f-q" placeholder="name, email, id, campaign..."></div>
                                            <button class="toggle-more" id="toggle-more">More filters &#9662;</button>
                                                  <div class="filt" style="margin-left:auto;"><label>&nbsp;</label><button class="ghost" id="f-reset">Reset filters</button></div>
                                                      </div>
                                                          <div class="filters-more" id="filters-more">
                                                                <div class="section-lab">Admissions</div>
                                                                      ${selectHtml('f-admissionsScore','Admission code test score','admissionsScore')}
                                                                            ${selectHtml('f-leadSentiment','Lead sentiment','leadSentiment')}
                                                                                  ${selectHtml('f-dealQuality','Deal quality','dealQuality')}
                                                                                        ${selectHtml('f-classification','Classification','classification')}
                                                                                              <div class="section-lab">Attribution</div>
                                                                                                    ${selectHtml('f-source','UTM Source','source')}
                                                                                                          ${selectHtml('f-medium','UTM Medium','medium')}
                                                                                                                ${selectHtml('f-campaign','Campaign','campaign')}
                                                                                                                      <div class="section-lab">Other</div>
                                                                                                                            ${selectHtml('f-location','Location','location')}
                                                                                                                                  ${selectHtml('f-course','Course','course')}
                                                                                                                                        ${selectHtml('f-assignTo','Owner','assignTo')}
                                                                                                                                              <div class="filt"><label>From date</label><input type="date" id="f-from"></div>
                                                                                                                                                    <div class="filt"><label>To date</label><input type="date" id="f-to"></div>
                                                                                                                                                        </div>
                                                                                                                                                          `;
    document.getElementById('toggle-more').addEventListener('click', ()=>{
          document.getElementById('filters-more').classList.toggle('open');
          document.getElementById('toggle-more').classList.toggle('open');
    });
    ['region','bucket','source','medium','campaign','location','course','assignTo','reason','admissionsScore','leadSentiment','admissionsConversationType','classification','dealQuality'].forEach(k=>{
          const elx = document.getElementById('f-'+k); if(elx && state[k]) elx.value = state[k];
    });
    if(state.dateFrom) document.getElementById('f-from').value = state.dateFrom;
    if(state.dateTo) document.getElementById('f-to').value = state.dateTo;
    if(state.q) document.getElementById('f-q').value = state.q;
    ['region','bucket','source','medium','campaign','location','course','assignTo','reason','admissionsScore','leadSentiment','admissionsConversationType','classification','dealQuality'].forEach(k=>{
          document.getElementById('f-'+k).addEventListener('change', async e=>{
                  state[k]=e.target.value;
                  if(k==='region'){ await loadData(state.region==='all'?undefined:state.region); }
                  renderAll();
          });
    });
    document.getElementById('f-from').addEventListener('change', e=>{ state.dateFrom=e.target.value; renderAll(); });
    document.getElementById('f-to').addEventListener('change', e=>{ state.dateTo=e.target.value; renderAll(); });
    document.getElementById('f-q').addEventListener('input', e=>{ state.q=e.target.value; renderAll(); });
    document.getElementById('f-reset').addEventListener('click', async ()=>{
          Object.keys(state).forEach(k=> state[k] = (k==='q'||k==='dateFrom'||k==='dateTo') ? '' : 'all');
          document.querySelectorAll('#filters select').forEach(s=>s.value='all');
          document.getElementById('f-from').value=''; document.getElementById('f-to').value=''; document.getElementById('f-q').value='';
          await loadData();
          renderAll();
    });
}

function jumpToIndividual(field, value){
  state[field]=value;
  const sel = document.getElementById('f-'+field);
  if(sel) sel.value = value;
  document.querySelector('.tab[data-tab=individual]').click();
}

function renderKpis(rows){
  const total = rows.length;
  const won = rows.filter(r=>r.bucket==='Won').length;
  const lostc = rows.filter(r=>r.bucket==='Lost - Classified').length;
  const lostu = rows.filter(r=>r.bucket==='Lost - Unclassified').length;
  const other = rows.filter(r=>r.bucket==='Active / Other').length;
  document.getElementById('kpis').innerHTML = `
    <div class="kpi"><div class="val">${total.toLocaleString()}</div><div class="lbl">Deals in view</div></div>
    <div class="kpi won"><div class="val">${won}</div><div class="lbl">Won</div></div>
    <div class="kpi lostc"><div class="val">${lostc}</div><div class="lbl">Lost — classified</div></div>
    <div class="kpi lostu"><div class="val">${lostu}</div><div class="lbl">Lost — no reason</div></div>
    <div class="kpi other"><div class="val">${other}</div><div class="lbl">Active / other</div></div>
    <div class="kpi"><div class="val">${fmtPct(lostc+lostu,total)}</div><div class="lbl">Loss rate</div></div>
  `;
}

function renderBarList(elId, rows, field, topN, jumpField, countsOverride){
  const counts = countsOverride || countBy(rows, field);
  const total = rows.length || 1;
  const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,topN);
  const max = top.length ? top[0][1] : 1;
  document.getElementById(elId).innerHTML = top.map(([k,v])=>`
    <div class="barrow">
      <div class="lab clickable" title="${k}" data-field="${jumpField}" data-value="${k}">${k}</div>
      <div class="track"><div class="fill" style="width:${(v/max*100).toFixed(1)}%"></div></div>
      <div class="num">${v} (${fmtPct(v,total)})</div>
    </div>
  `).join('') || '<span class="muted">No data</span>';
  document.getElementById(elId).querySelectorAll('.clickable').forEach(elx=>{
    elx.addEventListener('click', ()=> jumpToIndividual(elx.dataset.field, elx.dataset.value));
  });
}

let weeklyChart, sourceChart;
function renderOverview(rows){
  const el = document.getElementById('tab-overview');
  el.innerHTML = `
    <div class="panel"><h2>Weekly volume by outcome</h2><canvas id="chart-weekly" height="80"></canvas></div>
    <div class="grid2">
      <div class="panel"><h2>Top locations</h2><div id="loc-bars"></div></div>
      <div class="panel"><h2>Top campaigns</h2><div id="camp-bars"></div></div>
    </div>
    <div class="grid2">
      <div class="panel"><h2>Source mix</h2><canvas id="chart-source" height="180"></canvas></div>
      <div class="panel"><h2>Course mix</h2><div id="course-bars"></div></div>
    </div>
  `;
  const weeks = Array.from(new Set(rows.map(r=>r.week).filter(Boolean))).sort();
  const buckets = Object.keys(BUCKET_LABEL);
  const colors = {'Won':'#3fd68a','Lost - Classified':'#ff6b6b','Lost - Unclassified':'#ff9d6b','Active / Other':'#6d8dff'};
  const datasets = buckets.map(b=>({ label: BUCKET_LABEL[b], data: weeks.map(w=> rows.filter(r=>r.week===w && r.bucket===b).length), backgroundColor: colors[b] }));
  if(weeklyChart) weeklyChart.destroy();
  weeklyChart = new Chart(document.getElementById('chart-weekly'), { type:'bar', data:{ labels:weeks, datasets },
    options:{ responsive:true, plugins:{legend:{labels:{color:'#e8ecf5'}}}, scales:{ x:{stacked:true, ticks:{color:'#8b95ac'}, grid:{color:'#2a3348'}}, y:{stacked:true, ticks:{color:'#8b95ac'}, grid:{color:'#2a3348'}} } } });

  renderBarList('loc-bars', rows, 'location', 8, 'location');
  renderBarList('camp-bars', rows, 'campaign', 8, 'campaign');
  renderBarList('course-bars', rows, 'course', 6, 'course');

  const srcCounts = countBy(rows,'source');
  const top = Object.entries(srcCounts).sort((a,b)=>b[1]-a[1]).slice(0,8);
  if(sourceChart) sourceChart.destroy();
  sourceChart = new Chart(document.getElementById('chart-source'), { type:'doughnut',
    data:{ labels: top.map(t=>t[0]||'(none)'), datasets:[{ data: top.map(t=>t[1]), backgroundColor:['#6d8dff','#9b7bff','#3fd68a','#ffb648','#ff6b6b','#ff9d6b','#5b6584','#8b95ac'] }] },
    options:{ plugins:{legend:{position:'right', labels:{color:'#e8ecf5', boxWidth:12, font:{size:11}}}} } });
}

function renderRegions(){
  const el = document.getElementById('tab-regions');
  el.innerHTML = `<div class="panel"><h2>Loading region comparison…</h2></div>`;
  // Regions tab always compares against the FULL unfiltered dataset for the current region selector context
  const cols = REGIONS.map(region=>{
    const rows = ALL.filter(r=>r.region===region);
    const total = rows.length;
    const won = rows.filter(r=>r.bucket==='Won').length;
    const lostc = rows.filter(r=>r.bucket==='Lost - Classified').length;
    const lostu = rows.filter(r=>r.bucket==='Lost - Unclassified').length;
    return `<div class="panel">
      <h2>${region} <span class="count-tag">n=${total}</span></h2>
      <div class="barrow"><div class="lab">Won</div><div class="track"><div class="fill" style="background:#3fd68a;width:${fmtPct(won,total)}"></div></div><div class="num">${won}</div></div>
      <div class="barrow"><div class="lab">Lost (classified)</div><div class="track"><div class="fill" style="background:#ff6b6b;width:${fmtPct(lostc,total)}"></div></div><div class="num">${lostc}</div></div>
      <div class="barrow"><div class="lab">Lost (no reason)</div><div class="track"><div class="fill" style="background:#ff9d6b;width:${fmtPct(lostu,total)}"></div></div><div class="num">${lostu}</div></div>
      <h3 style="margin-top:14px">Top lost reasons</h3>
      <div id="reg-reason-${region}"></div>
      <h3 style="margin-top:14px">Top campaigns</h3>
      <div id="reg-camp-${region}"></div>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="grid3">${cols}</div>`;
  REGIONS.forEach(region=>{
    const rows = ALL.filter(r=>r.region===region && (r.bucket==='Lost - Classified'));
    renderBarList(`reg-reason-${region}`, rows, 'reason', 5, 'reason', countByReasons(rows));
    renderBarList(`reg-camp-${region}`, ALL.filter(r=>r.region===region), 'campaign', 5, 'campaign');
  });
}

function renderGrouped(rows){
  const el = document.getElementById('tab-grouped');
  el.innerHTML = `
    <div class="panel">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;">
        <h2 style="margin:0">Group by</h2>
        <select id="grp-field">
          <option value="region">Region</option>
          <option value="source">UTM Source</option>
          <option value="medium">UTM Medium</option>
          <option value="campaign">Campaign</option>
          <option value="location">Location</option>
          <option value="course">Course</option>
          <option value="week">Week</option>
          <option value="assignTo">Owner</option>
          <option value="reason">Reason</option>
          <option value="bucket">Status bucket</option>
          <option value="leadSentiment">Lead sentiment</option>
          <option value="classification">Classification</option>
          <option value="dealQuality">Deal quality</option>
        </select>
        <span class="pill count-tag">${rows.length} deals in current filter</span>
      </div>
      <div class="scrollbox"><table id="grp-table"></table></div>
    </div>
  `;
  const sel = document.getElementById('grp-field');
  sel.addEventListener('change', ()=> drawGroupTable(rows, sel.value));
  drawGroupTable(rows, sel.value);
}

function drawGroupTable(rows, field){
  const groups = {};
  rows.forEach(r=>{
          const keys = field==='reason' ? ((r.reasons&&r.reasons.length)?r.reasons:['(none)']) : [r[field] || '(none)'];
          keys.forEach(k=>{
                    if(!groups[k]) groups[k] = {total:0,won:0,lostc:0,lostu:0,other:0};
                    groups[k].total++;
                    if(r.bucket==='Won') groups[k].won++;
                    else if(r.bucket==='Lost - Classified') groups[k].lostc++;
                    else if(r.bucket==='Lost - Unclassified') groups[k].lostu++;
                    else groups[k].other++;
          });
  });
  const entries = Object.entries(groups).sort((a,b)=>b[1].total-a[1].total);
  const table = document.getElementById('grp-table');
  table.innerHTML = `
    <thead><tr><th>${field}</th><th>Total</th><th>Won</th><th>Lost (classified)</th><th>Lost (no reason)</th><th>Active/Other</th><th>Loss rate</th></tr></thead>
    <tbody>${entries.map(([k,v])=>`
      <tr>
        <td class="clickable" data-field="${field}" data-value="${k}">${k}</td>
        <td>${v.total}</td><td>${v.won}</td><td>${v.lostc}</td><td>${v.lostu}</td><td>${v.other}</td>
        <td>${fmtPct(v.lostc+v.lostu, v.total)}</td>
      </tr>`).join('')}</tbody>
  `;
  table.querySelectorAll('.clickable').forEach(elx=>{
    elx.addEventListener('click', ()=> jumpToIndividual(elx.dataset.field, elx.dataset.value));
  });
}

const IND_COLS = [['id','ID'],['name','Name'],['email','Email'],['date','Date'],['region','Region'],['course','Course'],['source','Source'],['campaign','Campaign'],['location','Location'],['assignTo','Owner'],['dealValue','Value'],['bucket','Bucket'],['reason','Reason'],['admissionsConversationType','Adm. Type'],['admissionsScore','Adm. Score'],['leadSentiment','Sentiment'],['classification','Classification'],['dealQuality','Deal Quality'],['feedback','Feedback']];

function renderIndividual(rows){
  const el = document.getElementById('tab-individual');
  el.innerHTML = `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <h2 style="margin:0">Individual deals <span class="count-tag">(${rows.length} matching filters)</span></h2>
        <button id="btn-export" class="ghost">Export filtered CSV</button>
      </div>
      <div class="scrollbox"><table id="ind-table"></table></div>
    </div>
  `;
  document.getElementById('btn-export').addEventListener('click', ()=> exportCsv(rows));
  drawIndividualTable(rows);
}

function drawIndividualTable(rows){
  let sorted = rows.slice().sort((a,b)=>{
    const f = sortState.field; let av=a[f], bv=b[f];
    if(av==null) av=''; if(bv==null) bv='';
    if(av<bv) return sortState.dir==='asc'?-1:1;
    if(av>bv) return sortState.dir==='asc'?1:-1;
    return 0;
  });
  const capped = sorted.slice(0,500);
  const table = document.getElementById('ind-table');
  table.innerHTML = `
    <thead><tr>${IND_COLS.map(([f,l])=>`<th data-field="${f}">${l}${sortState.field===f?(sortState.dir==='asc'?' ▲':' ▼'):''}</th>`).join('')}</tr></thead>
    <tbody>${capped.map(r=>`
      <tr data-deal-id="${r.id}" class="lead-row-clickable">
        <td>${r.id}</td><td>${r.name||'<span class=muted>—</span>'}</td><td>${r.email||'<span class=muted>—</span>'}</td>
        <td>${r.date||'-'}</td><td>${r.region||'-'}</td><td>${r.course||'-'}</td><td>${r.source||'-'}</td>
        <td>${r.campaign||'-'}</td><td>${r.location||'-'}</td><td>${r.assignTo||'<span class=muted>unassigned</span>'}</td>
        <td>${r.dealValue ? '$'+Number(r.dealValue).toLocaleString() : '-'}</td>
        <td><span class="badge ${BUCKET_CLASS[r.bucket]}">${BUCKET_LABEL[r.bucket]}</span></td>
        <td>${r.reason||'-'}</td>
        <td>${r.admissionsConversationType||'-'}</td>
        <td>${r.admissionsScore||'-'}</td>
        <td>${r.leadSentiment||'-'}</td>
        <td>${r.classification||'-'}</td>
        <td>${r.dealQuality||'-'}</td>
        <td>${r.feedback||'-'}</td>
      </tr>`).join('')}</tbody>
  `;
  if(sorted.length>500){
    const note = document.createElement('div');
    note.className='muted'; note.style.padding='8px 10px';
    note.textContent = `Showing first 500 of ${sorted.length} rows — narrow with filters or export CSV for the full set.`;
    table.parentElement.appendChild(note);
  }
  table.querySelectorAll('th').forEach(th=>{
    th.addEventListener('click', ()=>{
      const f = th.dataset.field;
      if(sortState.field===f) sortState.dir = sortState.dir==='asc'?'desc':'asc';
      else { sortState.field=f; sortState.dir='asc'; }
      drawIndividualTable(rows);
    });
  });
  // Add click handlers to rows to open lead modal
  table.querySelectorAll('.lead-row-clickable').forEach(row=>{
    row.addEventListener('click', (e)=>{
      if(e.target.tagName==='TH') return; // don't open modal on header click
      const dealId = row.dataset.dealId;
      if(dealId) openLeadModal(dealId);
    });
    row.style.cursor = 'pointer';
  });
}

function exportCsv(rows){
  const cols = IND_COLS.map(c=>c[0]);
  const lines = [cols.join(',')];
  rows.forEach(r=>{
    lines.push(cols.map(c=>{
      let v = r[c]==null? '' : String(r[c]).replace(/"/g,'""');
      if(v.includes(',')||v.includes('"')) v = `"${v}"`;
      return v;
    }).join(','));
  });
  const blob = new Blob([lines.join('\n')], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'deals_filtered.csv';
  a.click();
}

let aiHistory = [];
let sessionAdsData = {}; // Store ads data from uploads

function buildAIContext(rows){
  const top = (field, n)=> Object.entries(countBy(rows, field)).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k,v])=>({value:k, count:v}));
  const lostRows = rows.filter(r=>r.bucket==='Lost - Classified');
  return {
    activeFilters: state,
    totalDeals: rows.length,
    kpis: {
      won: rows.filter(r=>r.bucket==='Won').length,
      lostClassified: lostRows.length,
      lostUnclassified: rows.filter(r=>r.bucket==='Lost - Unclassified').length,
      activeOther: rows.filter(r=>r.bucket==='Active / Other').length,
    },
    byRegion: countBy(rows,'region'),
    byBucket: countBy(rows,'bucket'),
    topSources: top('source',10),
    topMediums: top('medium',10),
    topCampaigns: top('campaign',10),
    topLocations: top('location',10),
    topCourses: top('course',10),
    topOwners: top('assignTo',10),
    topLostReasons: Object.entries(countByReasons(lostRows)).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>({reason:k,count:v})),
    byWeek: countBy(rows,'week'),
    sampleDeals: rows.slice(0,25).map(r=>({date:r.date, region:r.region, course:r.course, source:r.source, medium:r.medium, campaign:r.campaign, location:r.location, bucket:r.bucket, reason:r.reason, feedback:r.feedback, dealValue:r.dealValue})),
  };
}

async function askAI(rows){
  const qEl = document.getElementById('ai-question');
  const question = (qEl.value||'').trim();
  if(!question) return;
  const entry = { question, loading:true };
  aiHistory.push(entry);
  renderAIHistory();
  qEl.value = '';
  try{
    const context = buildAIContext(rows);
    // Pass conversation history (all previous Q&A pairs) for context
    const conversationHistory = aiHistory.slice(0, -1).filter(h => h.answer); // Exclude current loading entry

    const res = await fetch('/api/ask', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({
        question,
        context,
        history: conversationHistory,
        adsData: sessionAdsData
      }),
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || res.statusText);
    entry.loading = false;
    entry.answer = data.answer || '(no answer returned)';
  } catch(e){
    entry.loading = false;
    entry.error = e.message;
  }
  renderAIHistory();
}

function renderAIHistory(){
  const el = document.getElementById('ai-history');
  if(!el) return;
  el.innerHTML = aiHistory.slice().reverse().map(h=>`
  <div class="ai-entry">
  <div class="ai-q">${h.question}</div>
  <div class="ai-answer${h.loading?' loading':''}">${h.loading ? 'Thinking…' : (h.error ? `<span style="color:#ff6b6b">${h.error}</span>` : h.answer)}</div>
  </div>
  `).join('');
}

function renderAI(rows){
  const el = document.getElementById('tab-ai');
  el.innerHTML = `
  <div class="panel">
  <h2>Ask AI about this view <span class="count-tag">(${rows.length} deals in current filter)</span></h2>
  <div class="ai-box">
  <textarea id="ai-question" placeholder="e.g. Why is LATAM losing more deals in June? Which campaigns convert best? Summarize this view for a leadership update."></textarea>
  <div class="ai-suggestions">
  <button class="ghost" data-q="Summarize this view: key trends, the biggest problem, and one concrete recommendation.">Summarize this view</button>
  <button class="ghost" data-q="What are the top reasons deals are lost here, and what should we do about each one?">Top loss reasons + fixes</button>
  <button class="ghost" data-q="Which sources and campaigns are performing best and worst in this filtered view?">Best/worst campaigns</button>
  <button class="ghost" data-q="Are there any notable trends over time (by week) in this data?">Trends over time</button>
  </div>
  <div><button id="ai-ask">Ask</button></div>
  </div>
  <div id="ai-history" class="ai-history"></div>
  </div>
  `;
  document.querySelectorAll('.ai-suggestions button').forEach(b=>{
    b.addEventListener('click', ()=>{
      document.getElementById('ai-question').value = b.dataset.q;
      askAI(rows);
    });
  });
  document.getElementById('ai-ask').addEventListener('click', ()=> askAI(rows));
  document.getElementById('ai-question').addEventListener('keydown', e=>{
    if(e.key==='Enter' && (e.metaKey||e.ctrlKey)) askAI(rows);
  });
  renderAIHistory();
}

// ---- Lead Coach Modal ----

async function openLeadModal(dealId){
  const modal = document.createElement('div');
  modal.className = 'lead-modal';
  modal.innerHTML = `<div class="lead-modal-content"><div style="padding:20px;text-align:center;"><p>Loading lead details…</p></div></div>`;
  document.body.appendChild(modal);

  try{
    const res = await fetch('/api/lead-coach', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ leadId: Number(dealId) }),
    });
    if(!res.ok){
      const err = await res.json().catch(()=>({error:res.statusText}));
      modal.querySelector('.lead-modal-content').innerHTML = `<div style="padding:20px;color:#ff6b6b;">Error loading lead: ${err.error||res.statusText}</div>`;
      return;
    }
    const data = await res.json();
    await renderLeadModal(modal, data);
  }catch(e){
    modal.querySelector('.lead-modal-content').innerHTML = `<div style="padding:20px;color:#ff6b6b;">Error: ${e.message}</div>`;
  }
}

async function renderLeadModal(modal, data){
  const { lead, aiCoaching } = data;
  // Normalise so a partial payload can never throw while rendering the modal
  // (engagement.timeline.length used to blow up if timeline was missing).
  const engagement = lead.engagement || {};
  if (!Array.isArray(engagement.timeline)) engagement.timeline = [];

  // Load existing notes for this lead
  let leadNotesData = { notes: '', tags: [], emailSent: false, actions: [] };
  try {
    const notesRes = await fetch(`/api/lead-notes/${lead.contactId}`);
    if (notesRes.ok) {
      leadNotesData = await notesRes.json();
    }
  } catch (e) {
    console.warn('Could not load lead notes:', e.message);
  }

  const coachingText = aiCoaching.fullAnalysis;
  // Parse coaching text for sections
  const lines = coachingText.split('\n');
  let analysis = '', nextSteps = '', emailTemplate = '', smsTemplate = '';
  let currentSection = '';
  for(let i=0; i<lines.length; i++){
    const line = lines[i];
    if(line.startsWith('**Analysis:')) currentSection='analysis';
    else if(line.startsWith('**Next Steps:')) currentSection='nextSteps';
    else if(line.startsWith('**EMAIL TEMPLATE:')) currentSection='email';
    else if(line.startsWith('**SMS TEMPLATE:')) currentSection='sms';
    else if(currentSection==='analysis') analysis += line + '\n';
    else if(currentSection==='nextSteps') nextSteps += line + '\n';
    else if(currentSection==='email') emailTemplate += line + '\n';
    else if(currentSection==='sms') smsTemplate += line + '\n';
  }

  analysis = analysis.trim();
  nextSteps = nextSteps.trim();
  emailTemplate = emailTemplate.trim();
  smsTemplate = smsTemplate.trim();

  modal.querySelector('.lead-modal-content').innerHTML = `
    <header class="lead-modal-header">
      <h2>${lead.name}</h2>
      <button class="lead-modal-close">✕</button>
    </header>

    <div class="lead-modal-body">
      <div class="section">
        <h3>📋 Lead Info</h3>
        <div class="info-grid">
          <div><strong>Email:</strong> ${lead.email||'—'}</div>
          <div><strong>Phone:</strong> ${lead.phone||'—'}</div>
          <div><strong>Course:</strong> ${lead.course||'—'}</div>
          <div><strong>Region:</strong> ${lead.region||'—'}</div>
          <div><strong>Deal Value:</strong> $${Number(lead.dealValue).toLocaleString()}</div>
          <div><strong>Stage:</strong> ${lead.dealStage||'—'}</div>
          <div><strong>Status:</strong> <span class="badge ${BUCKET_CLASS[lead.dealStatus] || 'b-other'}">${lead.dealStatus}</span></div>
          <div><strong>Owner:</strong> ${lead.assignedTo||'Unassigned'}</div>
        </div>
      </div>

      <div class="section">
        <h3>📊 Engagement Timeline</h3>
        ${engagement.trackingAvailable ? `
          <div class="engagement-stats">
            <div class="stat"><span class="label">Emails Sent:</span> <span class="value">${engagement.emailsSent ?? '—'}</span></div>
            <div class="stat"><span class="label">Likely Opens:</span> <span class="value">${engagement.emailsOpened} (${engagement.emailOpenRate}%)</span></div>
            <div class="stat"><span class="label">Likely Clicks:</span> <span class="value">${engagement.linksClicked}</span></div>
            <div class="stat"><span class="label">Last Email:</span> <span class="value">${engagement.lastEmailDate||'—'}</span></div>
          </div>
          ${Array.isArray(engagement.scores) && engagement.scores.length ? `
            <div class="engagement-stats" style="margin-top:8px">
              ${engagement.scores.map(s=>{
                const tone = s.interpretation ? s.interpretation.tone : null;
                const colour = tone==='great'?'#2ea043':tone==='good'?'#3fb950':tone==='ok'?'#d29922':tone==='weak'?'#bb8009':tone==='bad'?'#f85149':'#8b949e';
                return `
                <div class="stat">
                  <span class="label">${s.name}:</span>
                  <span class="value" ${s.isEngagementScore?`style="color:${colour};font-weight:600"`:''}>
                    ${s.value}${s.interpretation?` — ${s.interpretation.label}`:''}
                  </span>
                  ${s.interpretation?`<div class="muted" style="font-size:.8em">${s.interpretation.meaning}</div>`:''}
                </div>`;
              }).join('')}
            </div>
          ` : ''}
          ${engagement.engagementBasis === 'campaign-aggregate' ? `
            <p class="muted" style="font-size:0.85em;margin-top:6px">
              ⚠️ "Likely" figures are inferred from each campaign's overall open/click rates —
              ActiveCampaign's API does not expose per-recipient opens. Treat as a signal, not as
              confirmation this person opened.
            </p>
          ` : ''}
          ${engagement.timeline.length > 0 ? `
            <div class="timeline">
              ${engagement.timeline.slice(0,10).map(evt=>`
                <div class="timeline-item">
                  <span class="date">${evt.date}</span>
                  <span class="action">${evt.detail}</span>
                </div>
              `).join('')}
            </div>
          ` : '<p class="muted">No engagement events recorded</p>'}
        ` : '<p class="muted">Email tracking not available for this lead</p>'}
      </div>

      <div class="section">
        <h3>⭐ Scoring</h3>
        <div class="scores-grid">
          ${lead.customFields.admissionsScore ? `<div class="score-box"><div class="label">Admissions</div><div class="value">${lead.customFields.admissionsScore}/100</div></div>` : ''}
          ${lead.customFields.dealQuality ? `<div class="score-box"><div class="label">Deal Quality</div><div class="value">${lead.customFields.dealQuality}/10</div></div>` : ''}
          ${lead.customFields.leadSentiment ? `<div class="score-box"><div class="label">Sentiment</div><div class="value">${lead.customFields.leadSentiment}</div></div>` : ''}
          ${lead.customFields.classification ? `<div class="score-box"><div class="label">Classification</div><div class="value">${lead.customFields.classification}</div></div>` : ''}
        </div>
        ${lead.customFields.conversationType ? `<p><strong>Conv. Type:</strong> ${lead.customFields.conversationType}</p>` : ''}
        ${lead.customFields.feedback ? `<p><strong>Feedback:</strong> ${lead.customFields.feedback}</p>` : ''}
      </div>

      <div class="section coach-section">
        <h3>🤖 AI Coach</h3>
        <div class="coach-analysis">
          <p><strong>Analysis:</strong></p>
          <p>${analysis || coachingText}</p>
        </div>
        ${nextSteps ? `
          <p><strong>Suggested Next Steps:</strong></p>
          <div class="next-steps">${nextSteps.split('\n').filter(l=>l.trim()).map(l=>`<div>• ${l.replace(/^[-•*]\s*/, '')}</div>`).join('')}</div>
        ` : ''}

        <div class="templates">
          ${emailTemplate ? `
            <div class="template">
              <h4>📧 Email Template</h4>
              <pre>${emailTemplate}</pre>
              <button class="copy-btn" data-text="${encodeURIComponent(emailTemplate)}">Copy Email</button>
            </div>
          ` : ''}
          ${smsTemplate ? `
            <div class="template">
              <h4>📱 SMS Template</h4>
              <pre>${smsTemplate}</pre>
              <button class="copy-btn" data-text="${encodeURIComponent(smsTemplate)}">Copy SMS</button>
            </div>
          ` : ''}
        </div>
      </div>

      <div class="section">
        <h3>📝 Notes &amp; Actions</h3>
        <div style="margin-bottom:10px;">
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <input type="checkbox" id="lead-email-sent" ${leadNotesData.emailSent ? 'checked' : ''}>
            <span>Email sent</span>
          </label>
        </div>
        <textarea id="lead-notes-text" placeholder="Add notes about this lead (admissions rep actions, follow-ups, etc.)" style="width:100%;min-height:80px;padding:8px;border:1px solid #ccc;border-radius:4px;font-family:monospace;font-size:12px;">${leadNotesData.notes}</textarea>
        <button id="lead-notes-save" style="margin-top:8px;">Save Notes</button>
      </div>
    </div>
  `;

  modal.querySelector('.lead-modal-close').addEventListener('click', ()=> modal.remove());
  modal.addEventListener('click', (e)=>{
    if(e.target===modal) modal.remove();
  });

  modal.querySelectorAll('.copy-btn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const text = decodeURIComponent(btn.dataset.text);
      try{
        await navigator.clipboard.writeText(text);
        showToast('Copied to clipboard!');
        btn.textContent = '✓ Copied!';
        setTimeout(()=>{ btn.textContent = btn.textContent.replace('Copied!', btn.dataset.original || 'Copy'); }, 2000);
      }catch(e){
        showToast('Failed to copy');
      }
    });
  });

  // Save lead notes
  const saveNotesBtn = modal.querySelector('#lead-notes-save');
  if (saveNotesBtn) {
    saveNotesBtn.addEventListener('click', async () => {
      const notes = modal.querySelector('#lead-notes-text')?.value || '';
      const emailSent = modal.querySelector('#lead-email-sent')?.checked || false;

      try {
        const res = await fetch('/api/lead-notes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            leadId: lead.id,
            contactId: lead.contactId,
            notes,
            emailSent,
          }),
        });

        if (res.ok) {
          showToast('Notes saved!');
          saveNotesBtn.textContent = '✓ Saved';
          setTimeout(() => { saveNotesBtn.textContent = 'Save Notes'; }, 2000);
        }
      } catch (e) {
        showToast('Failed to save notes');
        console.error('Error saving notes:', e);
      }
    });
  }
}

// ---- Recommendations Tab ----

async function renderRecommendations(){
  const el = document.getElementById('tab-recommendations');
  el.innerHTML = `<div class="panel"><div style="padding:20px;text-align:center;"><p>Loading recommendations…</p></div></div>`;

  try{
    // Send filtered records to get recommendations based on current filter state
    const filteredRecords = filtered();
    const res = await fetch('/api/recommendations', {
      method:'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({ filteredRecords })
    });
    if(!res.ok){
      const err = await res.json().catch(()=>({error:res.statusText}));
      el.innerHTML = `<div class="panel"><h2 style="color:#ff6b6b;">Error loading recommendations: ${err.error||res.statusText}</h2></div>`;
      return;
    }
    const data = await res.json();

    el.innerHTML = `
      <div class="panel">
        <h2>🎯 Lead Recommendations</h2>
        <div class="summary-cards">
          <div class="card"><div class="val">${data.summary.totalDeals}</div><div class="lbl">Total Deals</div></div>
          <div class="card"><div class="val">${data.summary.active}</div><div class="lbl">Active</div></div>
          <div class="card"><div class="val">${data.summary.won}</div><div class="lbl">Won</div></div>
          <div class="card"><div class="val">${data.summary.lost}</div><div class="lbl">Lost</div></div>
        </div>
      </div>
      ${data.groups.map((group, idx)=>`
        <div class="panel recommendation-group">
          <div class="group-header">
            <h3>${getGroupEmoji(group.name)} ${getGroupLabel(group.name)}</h3>
            <span class="count-tag">${group.count} leads</span>
          </div>
          <div class="group-content">
            <p class="recommendation-text">${group.recommendation || 'No recommendation generated'}</p>
            <details class="group-leads">
              <summary>View ${group.count} leads in this group</summary>
              <div class="leads-list">
                ${group.leads.map(l=>`
                  <div class="lead-item">
                    <div class="name">${l.name||'—'}</div>
                    <div class="email">${l.email||'—'}</div>
                    <div class="meta">
                      ${l.admissionsScore ? `<span>Score: ${l.admissionsScore}</span>` : ''}
                      ${l.leadSentiment ? `<span>Sentiment: ${l.leadSentiment}</span>` : ''}
                    </div>
                  </div>
                `).join('')}
              </div>
            </details>
          </div>
        </div>
      `).join('')}
    `;
  }catch(e){
    el.innerHTML = `<div class="panel"><h2 style="color:#ff6b6b;">Error: ${e.message}</h2></div>`;
  }
}

function getGroupLabel(name){
  const labels = {
    needsContact: 'Needs Contact',
    needsFollowUp: 'Needs Follow-up',
    atRisk: 'At Risk',
    readyToClose: 'Ready to Close',
    wonRecently: 'Won Recently',
    lostNeedAnalysis: 'Lost (No Reason)',
  };
  return labels[name] || name;
}

function getGroupEmoji(name){
  const emojis = {
    needsContact: '📞',
    needsFollowUp: '📧',
    atRisk: '⚠️',
    readyToClose: '🎯',
    wonRecently: '✅',
    lostNeedAnalysis: '❌',
  };
  return emojis[name] || '📋';
}

// ---- Ads Performance (live from 4Geeks Center) ----
let adsChart;
let adsChartLeads;
let adsRegion = null; // ads-tab local region: 'US' | 'ES' | 'LATAM'
let adsStart = null;  // ads-tab date range (its OWN, independent of lead filters)
let adsEnd = null;
let adsLang = 'es';   // ads-tab UI language: 'es' | 'en' (SOLO afecta a marketing)
let adsCur = null;    // ads-tab display currency: null=nativa | 'EUR' | 'USD'
const REGION_TO_CENTER_F = { USA:'US', Spain:'ES', LATAM:'LATAM', all:'US' };
const ADS_NATIVE_CUR = { US:'USD', ES:'EUR', LATAM:'USD', CL:'CLP' };
// Tipo de cambio para el conversor EUR/USD del panel (aprox., editable). La fuente
// de datos sigue en la moneda nativa de cada región; esto es solo conversión de
// visualización, y se avisa cuando la moneda mostrada ≠ nativa.
const ADS_RATE_EUR_USD = 1.08;

// Etiquetas de región por idioma (España→Spain en EN).
const ADS_REGION_LABELS = { es:{US:'USA',ES:'España',LATAM:'LATAM',CL:'Chile'}, en:{US:'USA',ES:'Spain',LATAM:'LATAM',CL:'Chile'} };
function adsRegionLabel(rg){ return (ADS_REGION_LABELS[adsLang]||ADS_REGION_LABELS.es)[rg] || rg; }

// Diccionario i18n del panel de marketing.
const ADS_TR = {
  es:{ live:'en vivo · 4Geeks Center', loading:'Cargando…', month:'Mes', from:'Desde', to:'Hasta',
    p_thisWeek:'Esta semana', p_lastWeek:'Semana pasada', p_thisMonth:'Este mes', p_lastMonth:'Mes pasado', p_90:'90 días',
    liveDot:'En vivo', sampleDot:'DATOS DE EJEMPLO', cacheDot:'caché (Center no respondió)',
    region:'Región', currency:'Moneda', period:'Periodo', converted:'convertido',
    errNeedKey:'🔌 Falta conectar 4Geeks Center', errLoad:'⚠️ No se pudieron cargar los anuncios', errNet:'⚠️ Error de red',
    spend:'Gasto', impressions:'Impresiones', clicks:'Clicks', leads:'Leads', paidLeads:'Leads de pago', orgLeads:'Leads orgánicos',
    salesPaid:'Ventas (pago)', cpl:'CPL', cpa:'CPA', roas:'ROAS', revenuePaid:'Ingresos (pago)', activeCampaigns:'Campañas activas',
    topSource:'Fuente top (leads)', topCampaign:'Campaña top (ventas)',
    investTitle:'Inversión & ROI — Gasto y CPL por día', efficiency:'Eficiencia', spendWord:'gasto', conversions:'conversiones', paidSales:'ventas de pago',
    channelTitle:'Rendimiento por canal', paidTag:'de pago',
    channelNote:'Solo canales con gasto. Las fuentes orgánicas (SEO, IA, referral…) están abajo en «Conversión por campaña».',
    roiTitle:'Campañas — ROI detallado', convTitle:'Conversión por campaña', withLeads:'con leads',
    dailyTitle:'Informe diario — Leads por día', landingsTitle:'Calidad de landings (Google)',
    targetTitle:'Generación de leads vs objetivo', emailTitle:'Email marketing',
    emailNd:'N/D — 4Geeks Center no expone campañas de email por país (igual que el panel original).',
    funnelsTitle:'Funnels de email (automatizaciones)', campDetailTitle:'Detalle por campaña', campWithSpend:'campañas con gasto',
    pendingIn:'Pendiente en 4Geeks Center', gapLandings:'Calidad de landings', gapTarget:'Leads vs objetivo', gapFunnels:'Funnels de email',
    allTab:'Todas', noCampChannel:'Sin campañas con gasto en este canal para el periodo seleccionado.', noTarget:'sin objetivo',
    th_channel:'Canal', th_spend:'Gasto', th_impr:'Impr.', th_clicks:'Clicks', th_ctr:'CTR', th_cpc:'CPC', th_leads:'Leads',
    th_sales:'Ventas', th_conv:'% Conv', th_cpl:'CPL', th_cpa:'CPA', th_revenue:'Ingresos', th_roas:'ROAS', th_campaign:'Campaña',
    th_created:'Alta', th_status:'Estado', th_is:'IS', th_isTitle:'Impression Share — cuota de impresiones (solo Search/Shopping)',
    th_landing:'Landing', th_quality:'Calidad (QS)', th_experience:'Experiencia', th_keywords:'Keywords', th_program:'Programa',
    th_target:'Objetivo', th_funnel:'Funnel', th_location:'Sede', th_contacts:'Contactos', th_completed:'Completados',
    th_withSale:'Con venta', th_attribRev:'Ingresos atrib.', th_leadsSales:'Leads → Ventas',
    st_active:'Activa', st_paused:'Pausada', st_ended:'Finalizada', le_good:'Buena', le_avg:'Media', le_poor:'Pobre',
    sortTitle:'Ordenar por esta columna',
    defsNote:'CPL = gasto ÷ leads · CPA = gasto ÷ ventas de pago · ROAS = ingresos ÷ gasto. <b>Ventas e Ingresos</b> son de campañas de <b>pago</b> (won_paid, por valor de matrícula en won_date) — el total del negocio (incl. orgánico) es mayor.',
    convHint:'Moneda convertida (aprox. 1€ = 1,08$); la fuente sigue en la moneda nativa de la región.',
    uploadSummary:'➕ Subir exports manuales (opcional — alimentan AI Insights)',
    uploadNote:'Sube exports de Meta o Google Ads (CSV o imágenes) para tenerlos junto al embudo. Se consideran en las preguntas de AI Insights.',
    dropText:'Arrastra CSV o imágenes aquí, o pulsa para elegir', chartSpend:'Gasto', chartCPL:'CPL', chartLeads:'Leads' },
  en:{ live:'live · 4Geeks Center', loading:'Loading…', month:'Month', from:'From', to:'To',
    p_thisWeek:'This week', p_lastWeek:'Last week', p_thisMonth:'This month', p_lastMonth:'Last month', p_90:'90 days',
    liveDot:'Live', sampleDot:'SAMPLE DATA', cacheDot:'cache (Center did not respond)',
    region:'Region', currency:'Currency', period:'Period', converted:'converted',
    errNeedKey:'🔌 Connect 4Geeks Center', errLoad:'⚠️ Could not load ads', errNet:'⚠️ Network error',
    spend:'Spend', impressions:'Impressions', clicks:'Clicks', leads:'Leads', paidLeads:'Paid leads', orgLeads:'Organic leads',
    salesPaid:'Sales (paid)', cpl:'CPL', cpa:'CPA', roas:'ROAS', revenuePaid:'Revenue (paid)', activeCampaigns:'Active campaigns',
    topSource:'Top source (leads)', topCampaign:'Top campaign (sales)',
    investTitle:'Investment & ROI — Spend and CPL per day', efficiency:'Efficiency', spendWord:'spend', conversions:'conversions', paidSales:'paid sales',
    channelTitle:'Channel performance', paidTag:'paid',
    channelNote:'Only channels with spend. Organic sources (SEO, AI, referral…) are below in “Conversion by campaign”.',
    roiTitle:'Campaigns — detailed ROI', convTitle:'Conversion by campaign', withLeads:'with leads',
    dailyTitle:'Daily report — Leads per day', landingsTitle:'Landing quality (Google)',
    targetTitle:'Lead generation vs target', emailTitle:'Email marketing',
    emailNd:'N/A — 4Geeks Center does not expose email campaigns by country (same as the original panel).',
    funnelsTitle:'Email funnels (automations)', campDetailTitle:'Campaign detail', campWithSpend:'campaigns with spend',
    pendingIn:'Pending in 4Geeks Center', gapLandings:'Landing quality', gapTarget:'Leads vs target', gapFunnels:'Email funnels',
    allTab:'All', noCampChannel:'No campaigns with spend in this channel for the selected period.', noTarget:'no target',
    th_channel:'Channel', th_spend:'Spend', th_impr:'Impr.', th_clicks:'Clicks', th_ctr:'CTR', th_cpc:'CPC', th_leads:'Leads',
    th_sales:'Sales', th_conv:'% Conv', th_cpl:'CPL', th_cpa:'CPA', th_revenue:'Revenue', th_roas:'ROAS', th_campaign:'Campaign',
    th_created:'Created', th_status:'Status', th_is:'IS', th_isTitle:'Impression Share — achieved share of impressions (Search/Shopping only)',
    th_landing:'Landing', th_quality:'Quality (QS)', th_experience:'Experience', th_keywords:'Keywords', th_program:'Program',
    th_target:'Target', th_funnel:'Funnel', th_location:'Location', th_contacts:'Contacts', th_completed:'Completed',
    th_withSale:'With sale', th_attribRev:'Attrib. revenue', th_leadsSales:'Leads → Sales',
    st_active:'Active', st_paused:'Paused', st_ended:'Ended', le_good:'Good', le_avg:'Average', le_poor:'Poor',
    sortTitle:'Sort by this column',
    defsNote:'CPL = spend ÷ leads · CPA = spend ÷ paid sales · ROAS = revenue ÷ spend. <b>Sales and Revenue</b> are from <b>paid</b> campaigns (won_paid, by enrollment value at won_date) — total business (incl. organic) is higher.',
    convHint:'Currency converted (approx. 1€ = 1.08$); the source stays in each region’s native currency.',
    uploadSummary:'➕ Upload manual exports (optional — feed AI Insights)',
    uploadNote:'Upload Meta or Google Ads exports (CSV or images) to keep them next to the funnel. They are considered in AI Insights questions.',
    dropText:'Drag CSV or images here, or click to choose', chartSpend:'Spend', chartCPL:'CPL', chartLeads:'Leads' },
};
function tr(){ return ADS_TR[adsLang] || ADS_TR.es; }

// Conversión de moneda SOLO para visualización (EUR/USD). Devuelve el importe en
// `adsCur` si está fijado y difiere de la moneda nativa; si no, sin tocar.
function adsConvert(n, fromCur){
  if(n==null||isNaN(n)) return n;
  if(!adsCur || adsCur===fromCur) return n;
  if(fromCur==='EUR' && adsCur==='USD') return n*ADS_RATE_EUR_USD;
  if(fromCur==='USD' && adsCur==='EUR') return n/ADS_RATE_EUR_USD;
  return n; // otras monedas (p.ej. CLP): sin conversión
}
function adsMoney(n, cur){
  if(n==null || isNaN(n)) return '—';
  let val = Number(n), disp = cur;
  if(adsCur && (adsCur==='EUR'||adsCur==='USD') && (cur==='EUR'||cur==='USD')){ val = adsConvert(val, cur); disp = adsCur; }
  const sym = disp==='EUR' ? '€' : '$';
  return sym + val.toLocaleString(undefined, { maximumFractionDigits: Math.abs(val) < 100 ? 1 : 0 });
}
function adsNum(n){ return (n==null||isNaN(n)) ? '—' : Number(n).toLocaleString(); }
function adsRoas(n){ return (n==null||isNaN(n)) ? '—' : Number(n).toFixed(2)+'×'; }
function adsPct(n){ return (n==null||isNaN(n)) ? '—' : Number(n).toFixed(2)+'%'; }
// Impression Share (cuota de impresiones): decimal 0-1 de Center; null = N/D
// (no Search/Shopping). Convención del origen: <10% se muestra como "<10%".
function adsIS(v){ if(v==null||isNaN(v)) return '—'; const n=Number(v); if(n<=0) return '—'; if(n<0.10) return '<10%'; return Math.round(n*100)+'%'; }
function qsBadge(q){ if(q==null||isNaN(q)) return '—'; const n=Number(q); const cls = n>=8?'b-won':n>=5?'b-lostu':'b-lostc'; return `<span class="badge ${cls}">${n.toFixed(1)}/10</span>`; }
function landingExp(e){ const T=tr(); const m={ABOVE_AVERAGE:T.le_good,AVERAGE:T.le_avg,BELOW_AVERAGE:T.le_poor}; const l=m[String(e||'').toUpperCase()]; if(!l) return e?`<span class="badge b-other">${e}</span>`:'—'; const cls=l===T.le_good?'b-won':l===T.le_avg?'b-lostu':'b-lostc'; return `<span class="badge ${cls}">${l}</span>`; }
// Rangos rápidos para el filtro de fechas del tab de Ads (fecha LOCAL, no UTC).
function adsIsoDate(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function adsPresetRanges(){
  const today = new Date();
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay()+6)%7)); // lunes de esta semana
  const lastMon = new Date(monday); lastMon.setDate(monday.getDate()-7);
  const lastSun = new Date(monday); lastSun.setDate(monday.getDate()-1);
  const mStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const pmStart = new Date(today.getFullYear(), today.getMonth()-1, 1);
  const pmEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  return [
    {key:'p_thisWeek', start:adsIsoDate(monday), end:adsIsoDate(today)},
    {key:'p_lastWeek', start:adsIsoDate(lastMon), end:adsIsoDate(lastSun)},
    {key:'p_thisMonth', start:adsIsoDate(mStart), end:adsIsoDate(today)},
    {key:'p_lastMonth', start:adsIsoDate(pmStart), end:adsIsoDate(pmEnd)},
    {key:'p_90', start:adsIsoDate(new Date(today.getTime()-90*86400000)), end:adsIsoDate(today)},
  ];
}
// Si el rango actual es un mes natural completo → devuelve "YYYY-MM" para el <input month>.
function adsMonthValue(){
  if(!adsStart||!adsEnd) return '';
  const s=adsStart.split('-'), e=adsEnd.split('-');
  if(s.length<3||s[2]!=='01'||s[0]!==e[0]||s[1]!==e[1]) return '';
  const last=new Date(Number(s[0]), Number(s[1]), 0).getDate();
  return Number(e[2])===last ? `${s[0]}-${s[1]}` : '';
}
// Cabeceras ordenables (clic) en TODAS las tablas de Ads. Idempotente (marca los
// th ya cableados). Ordena números (limpia €/$/%/×/comas) o texto; deja fija la
// fila TOTAL abajo; alterna asc/desc y pinta la flecha del sentido.
function makeAdsTablesSortable(root){
  if(!root) return;
  root.querySelectorAll('.ads-tablewrap table').forEach(tbl=>{
    const ths = [...tbl.querySelectorAll('thead th')];
    ths.forEach((th, idx)=>{
      if(th.dataset.sortable) return;
      th.dataset.sortable = '1';
      th.style.cursor = 'pointer';
      th.title = tr().sortTitle;
      th.addEventListener('click', ()=>{
        const tbody = tbl.querySelector('tbody'); if(!tbody) return;
        const all = [...tbody.querySelectorAll('tr')];
        const total = all.find(r => /^\s*total/i.test((r.cells[0] && r.cells[0].textContent) || ''));
        const rows = all.filter(r => r !== total);
        const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
        ths.forEach(h=>{ h.dataset.dir=''; const old=h.querySelector('.sort-ind'); if(old) old.remove(); });
        th.dataset.dir = dir;
        const parse = (s)=>{ s=(s||'').trim(); const cut=s.split('→')[0]; const t=cut.replace(/[€$%×,\s]/g,''); const n=parseFloat(t); return (t!=='' && !isNaN(n)) ? n : cut.toLowerCase(); };
        rows.sort((a,b)=>{ const av=parse(a.cells[idx] && a.cells[idx].textContent), bv=parse(b.cells[idx] && b.cells[idx].textContent); if(av<bv) return dir==='asc'?-1:1; if(av>bv) return dir==='asc'?1:-1; return 0; });
        rows.forEach(r=> tbody.appendChild(r));
        if(total) tbody.appendChild(total);
        const ind=document.createElement('span'); ind.className='sort-ind'; ind.textContent = dir==='asc'?' ▲':' ▼'; th.appendChild(ind);
      });
    });
  });
}

// Rich per-campaign table ("Detalle por campaña" like the Center origin).
let adsCampAll = [];
let adsCampCur = 'USD';
function adsStatusBadge(st){
  const s = String(st||'').toUpperCase();
  if(s.includes('ENABLE')||s.includes('ACTIV')) return `<span class="badge b-won">${tr().st_active}</span>`;
  if(s.includes('PAUSE')) return `<span class="badge b-lostu">${tr().st_paused}</span>`;
  if(s.includes('REMOVE')||s.includes('END')) return `<span class="badge b-lostc">${tr().st_ended}</span>`;
  return `<span class="badge b-other">${st||'—'}</span>`;
}
function renderCampTable(channel){
  const el = document.getElementById('ads-camp-table'); if(!el) return;
  const cur = adsCampCur;
  let rows = adsCampAll.slice();
  if(channel && channel!=='Todas') rows = rows.filter(c=> String(c.channel||'').toLowerCase().includes(channel.toLowerCase()));
  rows.sort((a,b)=> (Number(b.spend)||0)-(Number(a.spend)||0));
  if(!rows.length){ el.innerHTML = `<p class="muted" style="padding:16px;">${tr().noCampChannel}</p>`; return; }
  const t = rows.reduce((a,c)=>({spend:a.spend+(+c.spend||0),impr:a.impr+(+c.impressions||0),clicks:a.clicks+(+c.clicks||0),leads:a.leads+(+c.leads||0),won:a.won+(+c.won||0),rev:a.rev+(+c.revenue||0)}),{spend:0,impr:0,clicks:0,leads:0,won:0,rev:0});
  const tctr=t.impr?t.clicks/t.impr*100:null, tcpc=t.clicks?t.spend/t.clicks:null, tcpl=t.leads?t.spend/t.leads:null, tcpa=t.won?t.spend/t.won:null, troas=t.spend?t.rev/t.spend:null;
  // IS del TOTAL: media PONDERADA por impresiones elegibles (no se suma), como el origen.
  const tIsDen=rows.reduce((a,c)=> a+((c.impression_share!=null && +c.elig_impr>0)?+c.elig_impr:0),0);
  const tIsNum=rows.reduce((a,c)=> a+((c.impression_share!=null && +c.elig_impr>0)?(+c.impression_share)*(+c.elig_impr):0),0);
  const tIs=tIsDen>0?tIsNum/tIsDen:null;
  el.innerHTML = `<table>
    <thead><tr><th>${tr().th_campaign}</th><th>${tr().th_created}</th><th>${tr().th_status}</th><th>${tr().th_spend}</th><th>${tr().th_impr}</th><th title="${tr().th_isTitle}">${tr().th_is}</th><th>${tr().th_clicks}</th><th>${tr().th_ctr}</th><th>${tr().th_cpc}</th><th>${tr().th_leads}</th><th>${tr().th_cpl}</th><th>${tr().th_sales}</th><th>${tr().th_cpa}</th><th>${tr().th_revenue}</th><th>${tr().th_roas}</th></tr></thead>
    <tbody>${rows.map(c=>`<tr>
      <td title="${(c.campaign||'').replace(/"/g,'&quot;')}" style="max-width:230px;overflow:hidden;text-overflow:ellipsis;">${c.campaign||'—'}</td>
      <td>${c.start_date||'—'}</td>
      <td>${adsStatusBadge(c.status)}</td>
      <td>${adsMoney(c.spend,cur)}</td>
      <td>${adsNum(c.impressions)}</td>
      <td>${adsIS(c.impression_share)}</td>
      <td>${adsNum(c.clicks)}</td>
      <td>${adsPct(c.ctr)}</td>
      <td>${adsMoney(c.cpc,cur)}</td>
      <td>${adsNum(c.leads)}</td>
      <td>${adsMoney(c.cpl,cur)}</td>
      <td>${adsNum(c.won)}</td>
      <td>${adsMoney(c.cpa,cur)}</td>
      <td>${adsMoney(c.revenue,cur)}</td>
      <td>${adsRoas(c.roas)}</td>
    </tr>`).join('')}
      <tr style="font-weight:700;border-top:2px solid var(--border);"><td>TOTAL</td><td></td><td></td><td>${adsMoney(t.spend,cur)}</td><td>${adsNum(t.impr)}</td><td>${adsIS(tIs)}</td><td>${adsNum(t.clicks)}</td><td>${adsPct(tctr)}</td><td>${adsMoney(tcpc,cur)}</td><td>${adsNum(t.leads)}</td><td>${adsMoney(tcpl,cur)}</td><td>${adsNum(t.won)}</td><td>${adsMoney(tcpa,cur)}</td><td>${adsMoney(t.rev,cur)}</td><td>${adsRoas(troas)}</td></tr>
    </tbody></table>`;
  makeAdsTablesSortable(document.getElementById('ads-body'));
}

async function renderAds(){
  const el = document.getElementById('tab-ads');
  if(!adsRegion) adsRegion = REGION_TO_CENTER_F[state.region] || 'US';
  const nativeCur = ADS_NATIVE_CUR[adsRegion] || 'USD';
  const dispCur = adsCur || nativeCur;
  el.innerHTML = `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
        <h2 style="margin:0">Ads Performance <span class="count-tag">${tr().live}</span></h2>
        <div class="ads-toolbar">
          <div class="ads-seg">${['US','ES','LATAM'].map(rg=>`<button class="ghost ads-rg ${rg===adsRegion?'active':''}" data-rg="${rg}">${adsRegionLabel(rg)}</button>`).join('')}</div>
          <div class="ads-seg">${['EUR','USD'].map(cc=>`<button class="ghost ads-cur ${dispCur===cc?'active':''}" data-cur="${cc}">${cc}</button>`).join('')}</div>
          <div class="ads-seg">${['es','en'].map(lg=>`<button class="ghost ads-lang ${adsLang===lg?'active':''}" data-lang="${lg}">${lg.toUpperCase()}</button>`).join('')}</div>
        </div>
      </div>
      <div class="ads-daterow">
        <div class="filt"><label>${tr().month}</label><input type="month" id="ads-month" value="${adsMonthValue()}"></div>
        <div class="filt"><label>${tr().from}</label><input type="date" id="ads-from" value="${adsStart||''}"></div>
        <div class="filt"><label>${tr().to}</label><input type="date" id="ads-to" value="${adsEnd||''}"></div>
        ${adsPresetRanges().map(p=>`<button class="ghost ads-preset ${(adsStart===p.start&&adsEnd===p.end)?'active':''}" data-start="${p.start}" data-end="${p.end}">${tr()[p.key]}</button>`).join('')}
      </div>
      <div id="ads-freshness" class="muted" style="font-size:11.5px;margin:8px 0 0;">${tr().loading}</div>
    </div>
    <div id="ads-body"></div>
  `;
  // Cambiar de país CONSERVA el filtro de fechas (adsStart/adsEnd son de módulo);
  // renderAds vuelve a pintar con ese rango y recalcula el preset resaltado.
  el.querySelectorAll('.ads-rg').forEach(b=> b.addEventListener('click', ()=>{ adsRegion=b.dataset.rg; renderAds(); }));
  el.querySelectorAll('.ads-cur').forEach(b=> b.addEventListener('click', ()=>{ adsCur=b.dataset.cur; renderAds(); }));
  el.querySelectorAll('.ads-lang').forEach(b=> b.addEventListener('click', ()=>{ adsLang=b.dataset.lang; renderAds(); }));
  const applyDates = ()=>{
    adsStart = document.getElementById('ads-from').value || null;
    adsEnd = document.getElementById('ads-to').value || null;
    renderAds();
  };
  document.getElementById('ads-from').addEventListener('change', applyDates);
  document.getElementById('ads-to').addEventListener('change', applyDates);
  el.querySelectorAll('.ads-preset').forEach(b=> b.addEventListener('click', ()=>{
    adsStart = b.dataset.start; adsEnd = b.dataset.end; renderAds();
  }));
  const monthEl = document.getElementById('ads-month');
  if(monthEl) monthEl.addEventListener('change', ()=>{
    const v = monthEl.value; if(!v) return;                 // "YYYY-MM"
    const [y,m] = v.split('-').map(Number);
    const mm = String(m).padStart(2,'0');
    const last = new Date(y, m, 0).getDate();               // último día del mes
    adsStart = `${y}-${mm}-01`;
    adsEnd = `${y}-${mm}-${String(last).padStart(2,'0')}`;
    renderAds();
  });
  await loadAds();
}

async function loadAds(){
  const body = document.getElementById('ads-body');
  const fresh = document.getElementById('ads-freshness');
  const params = new URLSearchParams({ region: adsRegion });
  if(adsStart) params.set('start_date', adsStart);
  if(adsEnd) params.set('end_date', adsEnd);
  let data;
  try{
    const res = await fetch('/api/ads-performance?'+params.toString());
    data = await res.json().catch(()=>({}));
    if(!res.ok){
      fresh.textContent='';
      body.innerHTML = `<div class="panel" style="text-align:center;padding:34px;">
        <p style="font-size:15px;font-weight:600;">${data.needsKey ? tr().errNeedKey : tr().errLoad}</p>
        <p class="muted">${data.error||res.statusText}</p></div>` + adsUploadSectionHtml();
      wireAdsUpload();
      return;
    }
  }catch(e){
    fresh.textContent='';
    body.innerHTML = `<div class="panel" style="text-align:center;padding:34px;"><p>${tr().errNet}</p><p class="muted">${e.message}</p></div>`;
    return;
  }

  const cur = data.currency || 'USD';
  const T = tr();
  const c = data._cache || {};
  // Reflect the effective period in the date inputs (first load = 90d default).
  if(data.period){
    if(!adsStart && data.period.start_date){ adsStart = data.period.start_date; const f=document.getElementById('ads-from'); if(f && !f.value) f.value = adsStart; }
    if(!adsEnd && data.period.end_date){ adsEnd = data.period.end_date; const t=document.getElementById('ads-to'); if(t && !t.value) t.value = adsEnd; }
  }
  const dot = c.demo ? `<span style="color:var(--amber)">● ${T.sampleDot}</span>`
            : c.stale ? `<span style="color:var(--amber)">● ${T.cacheDot}</span>`
            : `<span style="color:#22A06B">● ${T.liveDot}</span>`;
  const per = data.period && (data.period.start_date||data.period.end_date)
    ? ` · ${T.period} ${data.period.start_date||'…'} → ${data.period.end_date||'…'}` : '';
  const dispCurF = adsCur || cur;
  const convTag = (dispCurF!==cur && (dispCurF==='EUR'||dispCurF==='USD') && (cur==='EUR'||cur==='USD')) ? ` <span title="${T.convHint}" style="cursor:help;text-decoration:underline dotted">(${T.converted})</span>` : '';
  fresh.innerHTML = `${dot} — ${T.region} <b>${adsRegionLabel(data.region)||data.region}</b> · ${T.currency} ${dispCurF}${convTag}${per}` + (data.generatedAt ? ` · ${new Date(data.generatedAt).toLocaleString()}` : '');

  const s = data.summary||{};
  // Marketing highlights de campañas y fuentes (mismos datos en vivo).
  const cps = (data.campaignsPerf && data.campaignsPerf.campaigns) || [];
  const chs = data.channels || [];
  const leadsPago = chs.filter(c=>(c.spend||0)>0).reduce((a,c)=>a+(c.leads||0),0);
  const leadsOrg  = chs.filter(c=>!((c.spend||0)>0)).reduce((a,c)=>a+(c.leads||0),0);
  const activeCamp = cps.filter(c=>/enable|activ/i.test(String(c.status||''))).length;
  // Ventas / Ingresos / CPA se muestran en atribución de PAGO (won_paid), para
  // que cuadren con la tabla de campañas y con el origen ("paid won"). CPA se
  // recalcula de las cifras mostradas, como en Center.
  const cpaPaid = s.wonPaid ? s.spend/s.wonPaid : null;
  // ROAS coherente = ingresos (de pago) ÷ gasto. summary.roas mezcla ingresos
  // TOTALES con gasto, así que lo recalculamos de las cifras mostradas.
  const roasPaid = s.spend ? (s.revenue||0)/s.spend : null;
  const topFuente = chs.slice().sort((a,b)=>(b.leads||0)-(a.leads||0))[0];
  const topCamp = cps.slice().sort((a,b)=>((b.won||0)-(a.won||0))||((b.revenue||0)-(a.revenue||0)))[0];
  const topCampName = topCamp ? (topCamp.campaign||'—') : '—';
  const esc = (x)=>String(x||'').replace(/"/g,'&quot;');
  const kpis = `<div class="kpis" style="margin-top:16px;">
    <div class="kpi"><div class="val">${adsMoney(s.spend,cur)}</div><div class="lbl">${T.spend}</div></div>
    <div class="kpi"><div class="val">${adsNum(s.impressions)}</div><div class="lbl">${T.impressions}</div></div>
    <div class="kpi"><div class="val">${adsNum(s.clicks)}</div><div class="lbl">${T.clicks}</div></div>
    <div class="kpi"><div class="val">${adsNum(s.leads)}</div><div class="lbl">${T.leads}</div></div>
    <div class="kpi"><div class="val">${adsNum(leadsPago)}</div><div class="lbl">${T.paidLeads}</div></div>
    <div class="kpi"><div class="val">${adsNum(leadsOrg)}</div><div class="lbl">${T.orgLeads}</div></div>
    <div class="kpi won"><div class="val">${adsNum(s.wonPaid)}</div><div class="lbl">${T.salesPaid}</div></div>
    <div class="kpi"><div class="val">${adsMoney(s.cpl,cur)}</div><div class="lbl">${T.cpl}</div></div>
    <div class="kpi other"><div class="val">${adsMoney(cpaPaid,cur)}</div><div class="lbl">${T.cpa}</div></div>
    <div class="kpi"><div class="val">${adsRoas(roasPaid)}</div><div class="lbl">${T.roas}</div></div>
    <div class="kpi"><div class="val">${adsMoney(s.revenue,cur)}</div><div class="lbl">${T.revenuePaid}</div></div>
    <div class="kpi"><div class="val">${adsNum(activeCamp)}</div><div class="lbl">${T.activeCampaigns}</div></div>
    <div class="kpi"><div class="val" style="font-size:18px;line-height:1.25;">${topFuente?topFuente.name:'—'}</div><div class="lbl">${T.topSource}</div></div>
    <div class="kpi"><div class="val" style="font-size:12.5px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(topCampName)}">${topCampName}</div><div class="lbl">${T.topCampaign}</div></div>
  </div>`;

  const daily = data.daily||[];

  // ── Inversión & ROI (gasto + CPL por día + eficiencia) ──
  const investmentSection = daily.length ? `<div class="panel"><h2>${T.investTitle}</h2>
    <canvas id="chart-ads" height="80"></canvas>
    <p class="muted" style="font-size:.85em;margin:10px 0 0;">${T.efficiency}: <b>${adsMoney(s.spend,cur)}</b> ${T.spendWord} · CPL ${adsMoney(s.cpl,cur)} · CPA ${adsMoney(cpaPaid,cur)} · ROAS ${adsRoas(roasPaid)} · CTR ${adsPct(s.ctr)} · ${adsNum(s.conversions)} ${T.conversions} · ${adsNum(s.wonPaid)} ${T.paidSales}</p>
  </div>` : '';

  // ── Rendimiento por canal — SOLO canales de pago (spend>0), como el origen.
  // Las fuentes orgánicas / no atribuidas a gasto (SEO, IA, referral, y los leads
  // etiquetados "Google Ads"/"Meta Ads" sin gasto casado) NO se mezclan aquí: van
  // en «Conversión por campaña». Así cada cosa es claramente de pago u orgánica.
  const channels = data.channels||[];
  const paidChannels = channels.filter(c=>(c.spend||0)>0);
  const channelsTable = paidChannels.length ? `<div class="panel"><h2>${T.channelTitle} <span class="count-tag">${T.paidTag}</span></h2><div class="ads-tablewrap"><table>
    <thead><tr><th>${T.th_channel}</th><th>${T.th_spend}</th><th>${T.th_impr}</th><th>${T.th_clicks}</th><th>${T.th_ctr}</th><th>${T.th_cpc}</th><th>${T.th_leads}</th><th>${T.th_sales}</th><th>${T.th_conv}</th><th>${T.th_cpl}</th><th>${T.th_cpa}</th><th>${T.th_revenue}</th><th>${T.th_roas}</th></tr></thead>
    <tbody>${paidChannels.map(ch=>{ const ctr=ch.impressions?ch.clicks/ch.impressions*100:null; const cpc=ch.clicks?ch.spend/ch.clicks:null; const conv=(ch.conv!=null?ch.conv:(ch.leads?ch.won/ch.leads*100:null)); return `<tr><td>${ch.name}</td><td>${adsMoney(ch.spend,cur)}</td><td>${adsNum(ch.impressions)}</td><td>${adsNum(ch.clicks)}</td><td>${adsPct(ctr)}</td><td>${adsMoney(cpc,cur)}</td><td>${adsNum(ch.leads)}</td><td>${adsNum(ch.won)}</td><td>${adsPct(conv)}</td><td>${adsMoney(ch.cpl,cur)}</td><td>${adsMoney(ch.cpa,cur)}</td><td>${adsMoney(ch.revenue,cur)}</td><td>${adsRoas(ch.roas)}</td></tr>`; }).join('')}</tbody>
  </table></div><p class="muted" style="font-size:.8em;margin:8px 0 0;">${T.channelNote}</p></div>` : '';

  // ── Campañas — ROI detallado ──
  const cpsAll = (data.campaignsPerf && data.campaignsPerf.campaigns) || [];
  const roiTable = cpsAll.length ? `<div class="panel"><h2>${T.roiTitle}</h2><div class="ads-tablewrap"><table>
    <thead><tr><th>${T.th_campaign}</th><th>${T.th_channel}</th><th>${T.th_sales}</th><th>${T.th_revenue}</th><th>${T.th_spend}</th><th>${T.th_cpa}</th><th>${T.th_roas}</th></tr></thead>
    <tbody>${cpsAll.slice().sort((a,b)=>((+b.revenue||0)-(+a.revenue||0))||((+b.spend||0)-(+a.spend||0))).map(c=>`<tr><td title="${esc(c.campaign)}" style="max-width:240px;overflow:hidden;text-overflow:ellipsis;">${c.campaign||'—'}</td><td>${c.channel||'—'}</td><td>${adsNum(c.won)}</td><td>${adsMoney(c.revenue,cur)}</td><td>${adsMoney(c.spend,cur)}</td><td>${adsMoney(c.cpa,cur)}</td><td>${adsRoas(c.roas)}</td></tr>`).join('')}</tbody>
  </table></div></div>` : '';

  // ── Conversión por campaña (leads → ventas, por canal) ──
  const convCamps = (data.campaigns||[]).filter(c=>(c.leads||0)>0).sort((a,b)=>(+b.leads||0)-(+a.leads||0));
  const conversionSection = convCamps.length ? `<div class="panel"><h2>${T.convTitle} <span class="count-tag">${convCamps.length} ${T.withLeads}</span></h2><div class="ads-tablewrap"><table>
    <thead><tr><th>${T.th_channel}</th><th>${T.th_campaign}</th><th>${T.th_leadsSales}</th><th>${T.th_revenue}</th></tr></thead>
    <tbody>${convCamps.map(c=>`<tr><td>${c.channel||'—'}</td><td title="${esc(c.name)}" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;">${c.name}</td><td>${adsNum(c.leads)} → ${adsNum(c.won)}</td><td>${adsMoney(c.revenue,cur)}</td></tr>`).join('')}</tbody>
  </table></div></div>` : '';

  // ── Informe diario — Leads por día ──
  const leadsDailySection = daily.length ? `<div class="panel"><h2>${T.dailyTitle}</h2><canvas id="chart-ads-leads" height="70"></canvas></div>` : '';

  // ── Calidad de landings (Google) ──
  const landings = (data.landings && data.landings.campaigns) || [];
  const landingsSection = landings.length ? `<div class="panel"><h2>${T.landingsTitle}</h2><div class="ads-tablewrap"><table>
    <thead><tr><th>${T.th_campaign}</th><th>${T.th_landing}</th><th>${T.th_quality}</th><th>${T.th_experience}</th><th>${T.th_keywords}</th></tr></thead>
    <tbody>${landings.map(l=>`<tr><td title="${esc(l.campaign)}" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;">${l.campaign||'—'}</td><td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;">${String(l.landing||'').replace(/^https?:\/\//,'')||'—'}</td><td>${qsBadge(l.quality_score)}</td><td>${landingExp(l.landing_exp)}</td><td>${adsNum(l.keywords)}</td></tr>`).join('')}</tbody>
  </table></div></div>` : '';

  // ── Generación de leads vs objetivo (por programa) ──
  const captacion = (data.leadProgress && data.leadProgress.captacion) || [];
  const monthLabel = (data.leadProgress && data.leadProgress.month_label) || '';
  const targetSection = captacion.length ? `<div class="panel"><h2>${T.targetTitle}${monthLabel?` <span class="count-tag">${monthLabel}</span>`:''}</h2><div class="ads-tablewrap"><table>
    <thead><tr><th>${T.th_program}</th><th>${T.th_leads}</th><th>${T.th_target}</th><th>${T.th_sales}</th></tr></thead>
    <tbody>${captacion.map(c=>`<tr><td>${c.course||'—'}</td><td>${adsNum(c.acumulado)}</td><td>${(c.objetivo?adsNum(c.objetivo):`<span class="muted">${T.noTarget}</span>`)}</td><td>${adsNum(c.vendidos)}</td></tr>`).join('')}</tbody>
  </table></div></div>` : '';

  // ── Funnels de email (automatizaciones) ──
  const funnels = ((data.emailFunnels && data.emailFunnels.automations) || []).filter(f=>f.aplica_al_pais!==false);
  const funnelsSection = funnels.length ? `<div class="panel"><h2>${T.funnelsTitle} <span class="count-tag">${funnels.length}</span></h2><div class="ads-tablewrap"><table>
    <thead><tr><th>${T.th_funnel}</th><th>${T.th_location}</th><th>${T.th_contacts}</th><th>${T.th_completed}</th><th>${T.th_withSale}</th><th>${T.th_attribRev}</th></tr></thead>
    <tbody>${funnels.map(f=>`<tr><td title="${esc(f.name)}" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;">${f.name||'—'}</td><td>${f.scope||'—'}</td><td>${adsNum(f.contactos)}</td><td>${adsNum(f.completados)}</td><td>${adsNum(f.con_venta)}</td><td>${adsMoney(f.revenue_atribuido,cur)}</td></tr>`).join('')}</tbody>
  </table></div></div>` : '';

  // ── Email marketing (el panel original muestra N/D) ──
  const emailSection = `<div class="panel"><h2>${T.emailTitle}</h2><p class="muted" style="margin:0;">${T.emailNd}</p></div>`;

  const missing = [];
  if(!landings.length) missing.push(T.gapLandings);
  if(!captacion.length) missing.push(T.gapTarget);
  if(!funnels.length) missing.push(T.gapFunnels);
  const gapsSection = missing.length ? `<div class="panel" style="background:var(--bg-gray);"><p class="muted" style="margin:0;font-size:.88em;">${T.pendingIn}: ${missing.join(' · ')}.</p></div>` : '';

  // "Detalle por campaña" — la tabla rica igual que el origen.
  adsCampAll = cpsAll;
  adsCampCur = cur;
  // Platform tabs in a fixed order; a platform shows if it appears in the
  // campaigns OR in the channel breakdown, so TikTok is a tab for regions that
  // run it (e.g. España) even when its campaign rows are sparse.
  const PLATFORM_ORDER = ['Google','Meta','TikTok'];
  const presentNames = [...adsCampAll.map(c=>c.channel), ...(data.channels||[]).map(c=>c.name)].map(x=>String(x||'').toLowerCase());
  const platformTabs = PLATFORM_ORDER.filter(p => presentNames.some(n => n.includes(p.toLowerCase())));
  const campTabs = ['Todas', ...platformTabs];
  const campaignPanel = adsCampAll.length ? `<div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
      <h2 style="margin:0">${T.campDetailTitle} <span class="count-tag">${adsCampAll.length} ${T.campWithSpend}</span></h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${campTabs.map(t=>`<button class="ghost ads-ct ${t==='Todas'?'active':''}" data-ch="${t}">${t==='Todas'?T.allTab:t}</button>`).join('')}
      </div>
    </div>
    <div class="ads-tablewrap" style="margin-top:12px;" id="ads-camp-table"></div>
  </div>` : '';

  const notaOrigen = (data.definitions && data.definitions.nota) ? data.definitions.nota : 'mismos números que los paneles de Marketing de 4Geeks Center';
  const defs = `<p class="muted" style="font-size:.82em;margin:4px 0 14px;">${T.defsNote} ${notaOrigen}.</p>`;

  body.innerHTML = kpis + investmentSection + channelsTable + roiTable + campaignPanel + landingsSection + conversionSection + leadsDailySection + targetSection + emailSection + funnelsSection + gapsSection + defs + adsUploadSectionHtml();

  if(adsCampAll.length){
    renderCampTable('Todas');
    document.querySelectorAll('.ads-ct').forEach(b=> b.addEventListener('click', ()=>{
      document.querySelectorAll('.ads-ct').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      renderCampTable(b.dataset.ch);
    }));
  }

  if(daily.length){
    // Gasto (barras) + CPL por día (línea), como en el origen.
    if(adsChart) adsChart.destroy();
    const cplDaily = daily.map(d => (d.leads ? adsConvert(d.spend,cur)/d.leads : null));
    adsChart = new Chart(document.getElementById('chart-ads'), {
      data:{ labels: daily.map(d=>d.date), datasets:[
        { type:'bar', label:T.chartSpend, data: daily.map(d=>adsConvert(d.spend,cur)), backgroundColor:'rgba(35,129,255,.35)', borderColor:'#2381FF', yAxisID:'y' },
        { type:'line', label:T.chartCPL, data: cplDaily, borderColor:'#E5484D', backgroundColor:'rgba(229,72,77,.10)', yAxisID:'y1', tension:.3, spanGaps:true },
      ]},
      options:{ responsive:true, interaction:{mode:'index',intersect:false}, plugins:{legend:{labels:{color:'#5C6470'}}},
        scales:{
          x:{ticks:{color:'#8A93A0'},grid:{color:'#E6E9EF'}},
          y:{position:'left',ticks:{color:'#8A93A0'},grid:{color:'#E6E9EF'},title:{display:true,text:T.chartSpend,color:'#8A93A0'}},
          y1:{position:'right',ticks:{color:'#8A93A0'},grid:{drawOnChartArea:false},title:{display:true,text:T.chartCPL,color:'#8A93A0'}},
        } }
    });
    // Leads por día.
    if(adsChartLeads) adsChartLeads.destroy();
    adsChartLeads = new Chart(document.getElementById('chart-ads-leads'), {
      type:'bar',
      data:{ labels: daily.map(d=>d.date), datasets:[
        { label:T.chartLeads, data: daily.map(d=>d.leads), backgroundColor:'rgba(34,160,107,.5)', borderColor:'#22A06B' },
      ]},
      options:{ responsive:true, plugins:{legend:{labels:{color:'#5C6470'}}},
        scales:{ x:{ticks:{color:'#8A93A0'},grid:{color:'#E6E9EF'}}, y:{ticks:{color:'#8A93A0'},grid:{color:'#E6E9EF'}} } }
    });
  }
  wireAdsUpload();
  makeAdsTablesSortable(body);
}

function adsUploadSectionHtml(){
  return `<div class="panel"><details><summary style="cursor:pointer;font-weight:600;color:var(--body);">${tr().uploadSummary}</summary>
    <p class="ads-note">${tr().uploadNote}</p>
    <div class="upload-zone" id="dropZone"><p class="t1">${tr().dropText}</p><input type="file" id="fileInput" accept=".csv,image/*" multiple style="display:none;"></div>
    <div id="fileList"></div>
  </details></div>`;
}

function wireAdsUpload(){
  const dropZone = document.getElementById('dropZone');
  if(!dropZone) return;
  const fileInput = document.getElementById('fileInput');
  const fileList = document.getElementById('fileList');
  const files = [];
  function platformFor(name){
    if(/google/i.test(name)) return {cls:'google', label:'Google Ads'};
    if(/meta|facebook|fb/i.test(name)) return {cls:'meta', label:'Meta Ads'};
    return {cls:'meta', label:'Ads'};
  }
  function parseCSV(csvText){
    const lines = csvText.trim().split('\n');
    if(lines.length<2) return null;
    const headers = lines[0].split(',').map(h=>h.trim());
    const data=[];
    for(let i=1;i<lines.length;i++){ const values=lines[i].split(',').map(v=>v.trim()); const row={}; headers.forEach((h,idx)=>{row[h]=values[idx]||'';}); data.push(row); }
    return data;
  }
  async function processFile(file){
    const platform = platformFor(file.name);
    try{
      const text = await file.text();
      let data = (file.type==='text/csv'||file.name.endsWith('.csv')) ? parseCSV(text) : { filename:file.name, size:file.size, type:file.type };
      if(data){
        sessionAdsData[file.name] = { platform:platform.label, data, uploadedAt:new Date().toISOString() };
        await fetch('/api/ads-data', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ filename:file.name, platform:platform.label, data: typeof data==='string'?data:JSON.stringify(data) }) });
      }
    }catch(e){ console.error('Error processing file:', e.message); }
  }
  function renderFileList(){
    fileList.innerHTML = files.map((f,i)=>{ const p=platformFor(f.name); return `<div class="file-row"><span class="plat ${p.cls}">${p.label[0]}</span><span class="name">${f.name}</span><span class="muted">${(f.size/1024).toFixed(1)} KB</span><button class="ghost remove-file" data-i="${i}">Quitar</button></div>`; }).join('') || '<p class="muted" style="margin-top:8px;">Sin ficheros subidos.</p>';
    fileList.querySelectorAll('.remove-file').forEach(btn=>{ btn.addEventListener('click', ()=>{ const file=files[Number(btn.dataset.i)]; delete sessionAdsData[file.name]; files.splice(Number(btn.dataset.i),1); renderFileList(); }); });
  }
  async function addFiles(list){ for(let f of Array.from(list)){ files.push(f); await processFile(f); } renderFileList(); showToast(`Cargados ${files.length} fichero(s) de ads — úsalos en AI Insights`); }
  dropZone.addEventListener('click', ()=> fileInput.click());
  fileInput.addEventListener('change', e=> addFiles(e.target.files));
  dropZone.addEventListener('dragover', e=>{ e.preventDefault(); dropZone.classList.add('drag'); });
  dropZone.addEventListener('dragleave', ()=> dropZone.classList.remove('drag'));
  dropZone.addEventListener('drop', e=>{ e.preventDefault(); dropZone.classList.remove('drag'); addFiles(e.dataTransfer.files); });
  renderFileList();
}


document.getElementById('tabs').addEventListener('click', e=>{
  const t = e.target.closest('.tab');
  if(!t) return;
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  ['overview','recommendations','regions','grouped','individual','ads','ai'].forEach(name=>{
    document.getElementById('tab-'+name).style.display = (name===t.dataset.tab) ? 'block':'none';
  });
  renderAll();
});

function renderAll(){
  syncStateToUrl();
  const rows = filtered();
  const active = document.querySelector('.tab.active').dataset.tab;
  // The KPI bar and filters describe LEADS (ActiveCampaign). They're noise on
  // the Ads Performance tab (which has its own region switch and pulls from
  // Center), and on mobile they pushed the tab bar off-screen. Hide them there.
  const leadChrome = active !== 'ads';
  const kpisEl = document.getElementById('kpis');
  const filtersEl = document.getElementById('filters');
  if(kpisEl) kpisEl.style.display = leadChrome ? '' : 'none';
  if(filtersEl) filtersEl.style.display = leadChrome ? '' : 'none';
  if(leadChrome) renderKpis(rows);
  if(active==='overview') renderOverview(rows);
  if(active==='recommendations') renderRecommendations();
  if(active==='regions') renderRegions();
  if(active==='grouped') renderGrouped(rows);
  if(active==='individual') renderIndividual(rows);
  if(active==='ai') renderAI(rows);
  if(active==='ads') renderAds();
}

(async function init(){
  try{
    if(!checkAuth()){
      // Setup login form
      document.getElementById('login-form').addEventListener('submit', handleLogin);
      return;
    }

    // Auth OK - load dashboard
    syncStateFromUrl();
    document.getElementById('btn-logout').addEventListener('click', handleLogout);

    // Render the shell + active tab IMMEDIATELY. Ads Performance pulls live
    // from 4Geeks Center and must never wait on (or be blocked by) the
    // ActiveCampaign load -- that load polls for a couple of minutes on a cold
    // cache, which previously left the Ads tab blank the whole time.
    buildFilters();
    renderAll();

    // Load ActiveCampaign lead data in the BACKGROUND; refresh the lead views
    // and filters once it's ready (or show a friendly note if AC is down).
    loadData(state.region && state.region!=='all' ? state.region : undefined)
      .then(()=>{ buildFilters(); renderAll(); })
      .catch(e=>{
        console.warn('ActiveCampaign no disponible:', e.message);
        const f = document.getElementById('freshness');
        if(f) f.innerHTML = '<span class="muted">ActiveCampaign no disponible aquí — las pestañas de leads están vacías. <b>Ads Performance</b> tira en vivo de 4Geeks Center.</span>';
      });
  }catch(e){
    console.error(e);
  }
})();
