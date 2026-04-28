/* ═══════════════════════════════════════════════════════════════════
   EVGCPL Portal — Site Operations Module
   /assets/js/modules/site-ops.js

   Sub-route dispatcher:
     #equipment  → Asset master with category/site/own-hire filters
     #store      → MRS-based site-wise inventory
     #sites      → Active sites overview
   ═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  // Pick mount route from the current hash so the parent nav and the
  // active nav-item both highlight correctly. Defaults to 'equipment'.
  const subFromHash = ((location.hash || '').replace(/^#/, '')) || 'equipment';
  Shell.mount(subFromHash);

  const ROUTES = {
    'equipment': { title:'Equipment & Machinery', sub:'Live from AssetMaster', render: renderEquipment },
    'store':     { title:'Site Store',           sub:'MRS · site-wise inventory · live from v2_Purchase', render: renderStore },
    'sites':     { title:'Site Manager',         sub:'Per-site operational dashboard · staff · equipment · live MRS &amp; PO', render: renderSiteManager },
  };

  // ── Hash routing ──────────────────────────────────────────────
  function currentSub() {
    const h = (location.hash || '').replace(/^#/, '');
    return ROUTES[h] ? h : 'equipment';
  }
  function syncTabs() {
    const cur = currentSub();
    document.querySelectorAll('.sub-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.route === cur));
  }
  function syncHead() {
    const cur = currentSub();
    const r = ROUTES[cur];
    document.getElementById('pageHead').innerHTML = Shell.pageHead({
      crumbs: [{ label:'Home', href:'dashboard.html' }, { label:'Site Ops' }, { label:r.title }],
      title:  r.title,
      sub:    r.sub,
      actions:`<button class="btn btn-secondary btn-sm" onclick="location.reload()">↻ Refresh</button>`,
    });
  }
  function dispatch() {
    syncTabs();
    syncHead();
    document.getElementById('errorSlot').innerHTML = '';
    document.getElementById('content').innerHTML =
      `<div style="padding:3rem;text-align:center;color:var(--txt3);font-size:.85rem">Loading…</div>`;
    ROUTES[currentSub()].render();
  }
  window.addEventListener('hashchange', dispatch);
  dispatch();


  /* ═══════════════════════════════════════════════════════════════
     EQUIPMENT
     ═══════════════════════════════════════════════════════════════ */
  function renderEquipment() {
    API.fetchByBinding('siteops.assets').then(rows => {
      // Normalise — try standard columns first, fall back to any present
      const assets = rows.map(r => ({
        name:     r['Asset Name'] || r['Name'] || r['Equipment'] || '—',
        code:     r['Asset Code'] || r['Code'] || '',
        category: r['Category'] || r['Type'] || '',
        site:     r['Site Name'] || r['Site'] || '',
        ownHire:  (r['Own/Hire'] || r['Own / Hire'] || r['Ownership'] || '').toString(),
        status:   (r['Status'] || '').toUpperCase() || 'ACTIVE',
      }));

      const active   = assets.filter(a => a.status === 'ACTIVE');
      const inactive = assets.filter(a => a.status !== 'ACTIVE');
      const ownCount  = active.filter(a => (a.ownHire||'').toUpperCase() === 'OWN').length;
      const hireCount = active.filter(a => (a.ownHire||'').toUpperCase() === 'HIRE').length;

      const allSites = [...new Set(assets.map(a=>a.site).filter(Boolean))].sort();
      const allCats  = [...new Set(assets.map(a=>a.category).filter(Boolean))].sort();

      const siteMap = {};
      active.forEach(a => { const s=a.site||'Unassigned'; siteMap[s]=(siteMap[s]||0)+1; });
      const topSites = Object.entries(siteMap).sort((a,b)=>b[1]-a[1]).slice(0,8);

      const catMap = {};
      active.forEach(a => { const c=a.category||'Uncategorised'; catMap[c]=(catMap[c]||0)+1; });
      const topCats = Object.entries(catMap).sort((a,b)=>b[1]-a[1]).slice(0,6);

      const tabCounts = `
        <span class="count">${assets.length}</span>`;
      const eqTab = document.querySelector('[data-route="equipment"]');
      if (eqTab && !eqTab.querySelector('.count')) eqTab.insertAdjacentHTML('beforeend', tabCounts);

      const root = document.getElementById('content');
      root.innerHTML = `
        <!-- KPIs -->
        <section class="kpi-grid" style="margin-bottom:1.4rem">
          <div class="kpi"><div class="kpi-top"><div class="kpi-icon green">🚜</div><span class="kpi-status live"><span class="pulse"></span>Live</span></div>
            <div class="kpi-val">${active.length}</div><div class="kpi-label">Active units</div></div>
          <div class="kpi"><div class="kpi-top"><div class="kpi-icon orange">🔧</div></div>
            <div class="kpi-val">${inactive.length}</div><div class="kpi-label">Inactive / off-hire</div></div>
          <div class="kpi"><div class="kpi-top"><div class="kpi-icon blue">🏢</div></div>
            <div class="kpi-val">${ownCount}</div><div class="kpi-label">Own assets</div></div>
          <div class="kpi"><div class="kpi-top"><div class="kpi-icon green">📋</div></div>
            <div class="kpi-val">${hireCount}</div><div class="kpi-label">Hired / leased</div></div>
        </section>

        <section style="display:grid;grid-template-columns:1fr 1fr;gap:1.2rem;margin-bottom:1.4rem">
          <div class="card">
            <div class="card-head"><h3>📦 By category (active)</h3></div>
            <div class="card-body">
              ${topCats.length === 0 ? `<div style="text-align:center;color:var(--txt3);font-size:.85rem">No category data</div>` :
                topCats.map(([c,n]) => {
                  const pct = active.length ? Math.round(n/active.length*100) : 0;
                  return `<div style="margin-bottom:.65rem">
                    <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:.25rem">
                      <span style="font-weight:600">${escapeHtml(c)}</span>
                      <span style="color:var(--txt3)">${n} (${pct}%)</span>
                    </div>
                    <div style="background:var(--surface3);border-radius:99px;height:7px;overflow:hidden">
                      <div style="width:${pct}%;height:100%;background:var(--g6);border-radius:99px"></div>
                    </div>
                  </div>`;
                }).join('')}
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h3>🏗️ Site deployment</h3></div>
            <div class="card-body" style="padding:0;overflow-x:auto">
              ${topSites.length === 0 ? `<div style="text-align:center;color:var(--txt3);font-size:.85rem;padding:1.4rem">No site data</div>` : `
                <table class="tbl">
                  <thead><tr><th>Site</th><th style="text-align:center">Units</th><th>Bar</th></tr></thead>
                  <tbody>${topSites.map(([s,n]) => {
                    const pct = active.length ? Math.round(n/active.length*100) : 0;
                    return `<tr>
                      <td style="font-weight:600">${escapeHtml(s)}</td>
                      <td style="text-align:center;font-weight:700">${n}</td>
                      <td style="min-width:100px">
                        <div style="background:var(--surface3);border-radius:99px;height:7px;overflow:hidden">
                          <div style="width:${pct}%;height:100%;background:var(--g5);border-radius:99px"></div>
                        </div>
                      </td>
                    </tr>`;
                  }).join('')}</tbody>
                </table>`}
            </div>
          </div>
        </section>

        <!-- Filter bar -->
        <div style="display:flex;gap:.55rem;align-items:center;flex-wrap:wrap;margin-bottom:.85rem">
          <select id="eqSite" class="filt-sel"><option value="">All sites</option>${allSites.map(s=>`<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('')}</select>
          <select id="eqCat" class="filt-sel"><option value="">All categories</option>${allCats.map(c=>`<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('')}</select>
          <select id="eqOwn" class="filt-sel">
            <option value="">Own &amp; hire</option><option value="OWN">Own only</option><option value="HIRE">Hire only</option>
          </select>
          <input id="eqSearch" class="filt-in" type="text" placeholder="Search asset…"/>
          <span class="tag" id="eqCount">${assets.length} assets</span>
          <button class="btn btn-secondary btn-sm" id="eqCsv" style="margin-left:auto">⬇ CSV</button>
        </div>

        <div class="card">
          <div class="card-body" style="padding:0;overflow-x:auto" id="eqTable">
            ${renderEqTable(assets)}
          </div>
        </div>`;

      // Wire filters
      const apply = () => {
        const site = document.getElementById('eqSite').value;
        const cat  = document.getElementById('eqCat').value;
        const own  = document.getElementById('eqOwn').value;
        const q    = document.getElementById('eqSearch').value.toLowerCase();
        const filtered = assets.filter(a =>
          (!site || a.site === site) &&
          (!cat  || a.category === cat) &&
          (!own  || (a.ownHire||'').toUpperCase() === own) &&
          (!q    || (a.name + a.code + a.category).toLowerCase().includes(q))
        );
        document.getElementById('eqCount').textContent = `${filtered.length} assets`;
        document.getElementById('eqTable').innerHTML = renderEqTable(filtered);
        currentEqFiltered = filtered;
      };
      let currentEqFiltered = assets;
      ['eqSite','eqCat','eqOwn','eqSearch'].forEach(id => {
        document.getElementById(id).addEventListener('input', apply);
        document.getElementById(id).addEventListener('change', apply);
      });
      document.getElementById('eqCsv').addEventListener('click', () => {
        downloadCSV(currentEqFiltered.map(a => ({
          'Name': a.name, 'Code': a.code, 'Category': a.category,
          'Site': a.site, 'Own/Hire': a.ownHire, 'Status': a.status,
        })), `Equipment_${new Date().toISOString().slice(0,10)}.csv`);
      });

      injectFilterStyles();
    }).catch(handleErr);
  }
  function renderEqTable(rows) {
    if (!rows.length) return `<div style="padding:1.6rem;text-align:center;color:var(--txt3);font-size:.85rem">No assets match the filter.</div>`;
    const show = rows.slice(0, 100);
    return `<table class="tbl" style="min-width:560px">
      <thead><tr><th>Name</th><th>Code</th><th>Category</th><th>Site</th><th style="text-align:center">Own/Hire</th><th style="text-align:center">Status</th></tr></thead>
      <tbody>${show.map(a => {
        const stCol = a.status === 'ACTIVE' ? '#15803d' : '#b91c1c';
        const stBg  = a.status === 'ACTIVE' ? 'rgba(46,125,50,.12)' : 'rgba(220,38,38,.12)';
        const ohCol = (a.ownHire||'').toUpperCase() === 'OWN' ? '#1565c0' : '#bf6700';
        const ohBg  = (a.ownHire||'').toUpperCase() === 'OWN' ? 'rgba(30,136,229,.12)' : 'rgba(251,140,0,.15)';
        return `<tr>
          <td style="font-weight:600">${escapeHtml(a.name)}</td>
          <td style="color:var(--txt3);font-size:.78rem">${escapeHtml(a.code) || '—'}</td>
          <td>${escapeHtml(a.category) || '—'}</td>
          <td>${escapeHtml(a.site) || '—'}</td>
          <td style="text-align:center"><span class="tag" style="background:${ohBg};color:${ohCol}">${escapeHtml(a.ownHire) || '—'}</span></td>
          <td style="text-align:center"><span class="tag" style="background:${stBg};color:${stCol}">${escapeHtml(a.status)}</span></td>
        </tr>`;
      }).join('')}</tbody>
      ${rows.length > 100 ? `<tfoot><tr><td colspan="6" style="text-align:center;color:var(--txt3);font-size:.78rem;padding:.6rem">Showing 100 of ${rows.length} assets · use filters to narrow</td></tr></tfoot>` : ''}
    </table>`;
  }


  /* ═══════════════════════════════════════════════════════════════
     SITE STORE (MRS)
     ═══════════════════════════════════════════════════════════════ */
  function renderStore() {
    API.fetchByBinding('siteops.mrs').then(rows => {
      // Dedupe by Request No, drop dummy rows
      const seen = new Set();
      const all = rows.filter(r => {
        const rn = (r['Request No'] || '').trim();
        if (!rn || rn.toLowerCase() === 'dummy') return false;
        if (seen.has(rn)) return false;
        seen.add(rn);
        return true;
      }).map(r => ({
        reqNo:  r['Request No'] || '—',
        site:   r['Requested For (site)'] || r['Site'] || r['F'] || '—',
        part:   r['Part Details'] || r['G'] || '',
        status: (r['MR Approval Status'] || '').trim() || 'Pending',
        ts:     r['Timestamp'] || r['Y'] || '',
      }));

      const total    = all.length;
      const pending  = all.filter(r => !r.status || r.status.toUpperCase() === 'PENDING' || r.status === '').length;
      const approved = all.filter(r => r.status.toUpperCase() === 'APPROVED').length;

      // Site aggregation
      const siteMap = {};
      all.forEach(r => {
        const k = r.site;
        if (!siteMap[k]) siteMap[k] = { site:k, count:0, pending:0, approved:0, rejected:0 };
        siteMap[k].count++;
        const st = r.status.toUpperCase();
        if (st === 'APPROVED') siteMap[k].approved++;
        else if (st === 'REJECTED') siteMap[k].rejected++;
        else siteMap[k].pending++;
      });

      const stTab = document.querySelector('[data-route="store"]');
      if (stTab && !stTab.querySelector('.count')) stTab.insertAdjacentHTML('beforeend', `<span class="count">${total}</span>`);

      const root = document.getElementById('content');
      root.innerHTML = `
        <section class="kpi-grid" style="margin-bottom:1.2rem">
          <div class="kpi"><div class="kpi-top"><div class="kpi-icon green">📦</div><span class="kpi-status live"><span class="pulse"></span>Live</span></div>
            <div class="kpi-val">${total}</div><div class="kpi-label">Total MRS</div></div>
          <div class="kpi"><div class="kpi-top"><div class="kpi-icon orange">⏳</div></div>
            <div class="kpi-val">${pending}</div><div class="kpi-label">Pending</div></div>
          <div class="kpi"><div class="kpi-top"><div class="kpi-icon blue">✓</div></div>
            <div class="kpi-val">${approved}</div><div class="kpi-label">Approved</div></div>
          <div class="kpi"><div class="kpi-top"><div class="kpi-icon green">🏗️</div></div>
            <div class="kpi-val">${Object.keys(siteMap).length}</div><div class="kpi-label">Sites with MRS</div></div>
        </section>

        <div style="display:flex;gap:.55rem;align-items:center;flex-wrap:wrap;margin-bottom:.85rem">
          <select id="stSite" class="filt-sel">
            <option value="">All sites</option>
            ${Object.keys(siteMap).sort().map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('')}
          </select>
          <select id="stStatus" class="filt-sel">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <input id="stSearch" class="filt-in" placeholder="Search…"/>
          <span class="tag" id="stCount">${Object.keys(siteMap).length} sites</span>
          <button class="btn btn-secondary btn-sm" id="stCsv" style="margin-left:auto">⬇ CSV</button>
        </div>

        <div class="card">
          <div class="card-body" style="padding:0;overflow-x:auto;max-height:420px;overflow-y:auto" id="stTable"></div>
        </div>

        <div class="card" style="margin-top:1rem">
          <div class="card-head"><h3>🔍 Search material requests</h3></div>
          <div class="card-body">
            <div style="display:flex;gap:.55rem;flex-wrap:wrap;margin-bottom:.7rem">
              <input id="mrsItemSearch" class="filt-in" placeholder="Search by part description or request no…" style="flex:1;min-width:220px"/>
              <button class="btn btn-primary btn-sm" id="mrsItemBtn">Search</button>
            </div>
            <div id="mrsItemResults" style="font-size:.84rem;color:var(--txt3)">Enter a search term above to find specific material requests.</div>
          </div>
        </div>`;

      injectFilterStyles();
      renderStoreTable();

      function renderStoreTable() {
        const sitef = document.getElementById('stSite').value;
        const sf    = document.getElementById('stStatus').value.toLowerCase();
        const q     = document.getElementById('stSearch').value.toLowerCase();
        let rows = Object.values(siteMap);
        if (sitef) rows = rows.filter(r => r.site === sitef);
        if (q)     rows = rows.filter(r => r.site.toLowerCase().includes(q));
        // Status filter — when applied, also show row-level breakdown
        if (sf) {
          rows = rows.map(r => ({
            ...r,
            count: sf==='pending' ? r.pending : sf==='approved' ? r.approved : r.rejected,
          })).filter(r => r.count > 0);
        }
        rows.sort((a,b) => b.count - a.count);
        document.getElementById('stCount').textContent = `${rows.length} sites`;
        const tableEl = document.getElementById('stTable');
        if (!rows.length) {
          tableEl.innerHTML = `<div style="padding:1.4rem;text-align:center;color:var(--txt3);font-size:.85rem">No matching MRS data.</div>`;
          return;
        }
        tableEl.innerHTML = `<table class="tbl" style="min-width:520px">
          <thead><tr><th>Site</th><th style="text-align:center">Total</th><th style="text-align:center">Pending</th><th style="text-align:center">Approved</th><th style="text-align:center">Rejected</th></tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td style="font-weight:600">${escapeHtml(r.site)}</td>
            <td style="text-align:center;font-weight:700">${r.count}</td>
            <td style="text-align:center"><span class="tag" style="background:rgba(251,140,0,.15);color:#bf6700">${r.pending}</span></td>
            <td style="text-align:center"><span class="tag" style="background:rgba(46,125,50,.12);color:#15803d">${r.approved}</span></td>
            <td style="text-align:center"><span class="tag" style="background:rgba(220,38,38,.12);color:#b91c1c">${r.rejected}</span></td>
          </tr>`).join('')}</tbody>
        </table>`;
      }

      ['stSite','stStatus','stSearch'].forEach(id => {
        document.getElementById(id).addEventListener('input', renderStoreTable);
        document.getElementById(id).addEventListener('change', renderStoreTable);
      });
      document.getElementById('stCsv').addEventListener('click', () => {
        const sf = document.getElementById('stStatus').value.toLowerCase();
        let exp = all;
        if (sf) exp = exp.filter(r => r.status.toLowerCase() === sf);
        downloadCSV(exp.map(r => ({
          'Request No': r.reqNo, 'Site': r.site, 'Part Details': r.part,
          'Status': r.status, 'Timestamp': r.ts,
        })), `SiteStore_${sf || 'all'}_${new Date().toISOString().slice(0,10)}.csv`);
      });

      // Item-level search
      const itemSearchFn = () => {
        const q = document.getElementById('mrsItemSearch').value.trim().toLowerCase();
        const res = document.getElementById('mrsItemResults');
        if (!q) { res.textContent = 'Enter a search term above to find specific material requests.'; return; }
        const hits = all.filter(r => (r.reqNo + r.part + r.site).toLowerCase().includes(q)).slice(0, 30);
        if (!hits.length) { res.innerHTML = `<span style="color:var(--txt3)">No results for "${escapeHtml(q)}".</span>`; return; }
        const stCol = { APPROVED:'#15803d', REJECTED:'#b91c1c', DROPPED:'#6b7280', PENDING:'#bf6700' };
        const stBg  = { APPROVED:'rgba(46,125,50,.12)', REJECTED:'rgba(220,38,38,.12)', DROPPED:'rgba(107,114,128,.12)', PENDING:'rgba(251,140,0,.15)' };
        res.innerHTML = `<div style="overflow:auto"><table class="tbl">
          <thead><tr><th>Request No</th><th>Site</th><th>Part</th><th>Status</th></tr></thead>
          <tbody>${hits.map(r => {
            const st = (r.status || 'Pending').toUpperCase();
            return `<tr>
              <td style="font-weight:700;font-size:.82rem">${escapeHtml(r.reqNo)}</td>
              <td style="font-size:.82rem">${escapeHtml(r.site)}</td>
              <td style="font-size:.8rem;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeAttr(r.part)}">${escapeHtml(r.part) || '—'}</td>
              <td><span class="tag" style="background:${stBg[st] || stBg.PENDING};color:${stCol[st] || stCol.PENDING}">${escapeHtml(r.status)}</span></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`;
      };
      document.getElementById('mrsItemBtn').addEventListener('click', itemSearchFn);
      document.getElementById('mrsItemSearch').addEventListener('keydown', e => {
        if (e.key === 'Enter') itemSearchFn();
      });

    }).catch(handleErr);
  }


  /* ═══════════════════════════════════════════════════════════════
     SITE MANAGER — per-site operational dashboard.

     Aggregates four data sources (sites, employees, assets, MRS, PO)
     into a single per-site view: hero with selector, 4 KPI cards,
     site details, dept breakdown, staff list, equipment list,
     equipment-by-category, plus 7 ops tabs:
       - MRS, POs, Stock, GRN: live portal-rendered tables
       - DPR, Log Sheet, Maintenance: AppSheet deep-link launchers,
         pre-filtered to the selected site (these workflows live in
         the SCM AppSheet for offline mobile capture).
     ═══════════════════════════════════════════════════════════════ */
  let _smSelected = null;
  let _smCache = {};   // keyed: sites, emps, assets, mrs, po — fetched once per session
  let _smOpsTab = 'mrs';

  function renderSiteManager() {
    const root = document.getElementById('content');
    root.innerHTML = `<div style="padding:3rem;text-align:center;color:var(--txt3);font-size:.85rem">⏳ Loading site data…</div>`;

    // We need: sites + employees + assets in parallel for the core view.
    // MRS + PO are loaded lazily when the user opens those tabs.
    Promise.all([
      cachedFetch('sites',  'siteops.sites'),
      cachedFetch('emps',   'hr.employees'),
      cachedFetch('assets', 'siteops.assets'),
    ]).then(([rawSites, rawEmps, rawAssets]) => {
      const sites = rawSites.map(normSiteRow).filter(s => s.name);
      const emps  = rawEmps.map(normEmpRow).filter(e => e.empCode || e.name);
      const assets = rawAssets.map(normAssetRow).filter(a => a.name);
      const active = sites.filter(s => s.status === 'ACTIVE');

      // Pre-select: if site role and matching site exists, pick it; else first active
      if (!_smSelected || !active.find(s => s.name === _smSelected)) {
        const myEmail = (STATE.get('user') || {}).email || '';
        const me = emps.find(u => u.email && u.email.toLowerCase() === myEmail.toLowerCase());
        _smSelected = (me && me.site && active.find(s => s.name === me.site))
          ? me.site : (active[0] && active[0].name) || '';
      }

      drawSiteManager(sites, active, emps, assets);
    }).catch(handleErr);
  }

  function drawSiteManager(sites, active, emps, assets) {
    const root = document.getElementById('content');
    const sel = active.find(s => s.name === _smSelected) || active[0] || {};
    const siteName = sel.name || '';

    const siteEmps   = emps.filter(u => u.status === 'ACTIVE' && u.site === siteName);
    const siteAssets = assets.filter(a => a.site === siteName);

    // Department & category breakdowns
    const deptMap = {};
    siteEmps.forEach(u => { const d = u.dept || 'Other'; deptMap[d] = (deptMap[d] || 0) + 1; });
    const topDepts = Object.entries(deptMap).sort((a, b) => b[1] - a[1]).slice(0, 6);

    const catMap = {};
    siteAssets.forEach(a => { const c = a.category || 'Other'; catMap[c] = (catMap[c] || 0) + 1; });
    const topCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const activeAssets = siteAssets.filter(a => a.status === 'ACTIVE').length;

    const siteOptions = active.map(s =>
      `<option value="${escapeAttr(s.name)}" ${s.name === siteName ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
    ).join('');

    root.innerHTML = `
      <!-- Hero with site selector -->
      <div style="background:linear-gradient(135deg, var(--g9) 0%, var(--g7) 100%);border-radius:var(--rad-lg);padding:1.2rem 1.5rem;margin-bottom:1.2rem;color:#fff;position:relative;overflow:hidden">
        <div style="position:absolute;inset:0;background:radial-gradient(circle at 90% 0%, rgba(240,165,0,.18), transparent 60%);pointer-events:none"></div>
        <div style="position:relative">
          <div style="font-size:.7rem;opacity:.7;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.4rem">Site Manager Dashboard</div>
          <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
            <div style="font-family:'DM Serif Display',serif;font-size:1.4rem;font-weight:700;flex:1;min-width:0">${escapeHtml(siteName || 'Select a Site')}</div>
            <select id="smSiteSel" style="padding:.55rem 1rem;border:none;border-radius:9px;font-family:inherit;font-size:.88rem;font-weight:700;background:rgba(255,255,255,.18);color:#fff;cursor:pointer;min-width:200px;max-width:320px;outline:none">${siteOptions}</select>
          </div>
          ${(sel.city || sel.state || sel.incharge || sel.contact) ? `
            <div style="display:flex;gap:1.2rem;margin-top:.7rem;font-size:.78rem;opacity:.85;flex-wrap:wrap">
              ${sel.city     ? `<span>🏙 ${escapeHtml(sel.city)}</span>` : ''}
              ${sel.state    ? `<span>📍 ${escapeHtml(sel.state)}</span>` : ''}
              ${sel.incharge ? `<span>👤 ${escapeHtml(sel.incharge)}</span>` : ''}
              ${sel.contact  ? `<span>📞 ${escapeHtml(sel.contact)}</span>` : ''}
            </div>` : ''}
        </div>
      </div>

      <!-- KPI strip -->
      <section class="kpi-grid" style="margin-bottom:1.2rem">
        <div class="kpi"><div class="kpi-top"><div class="kpi-icon green">👷</div><span class="kpi-status live"><span class="pulse"></span>Live</span></div>
          <div class="kpi-val">${siteEmps.length}</div>
          <div class="kpi-label">Active staff</div>
          <div style="font-size:.72rem;color:var(--txt3);margin-top:.2rem">At this site</div></div>
        <div class="kpi"><div class="kpi-top"><div class="kpi-icon blue">🚜</div></div>
          <div class="kpi-val">${siteAssets.length}</div>
          <div class="kpi-label">Equipment units</div>
          <div style="font-size:.72rem;color:var(--txt3);margin-top:.2rem">Deployed here</div></div>
        <div class="kpi"><div class="kpi-top"><div class="kpi-icon green">🏢</div></div>
          <div class="kpi-val">${topDepts.length}</div>
          <div class="kpi-label">Departments</div>
          <div style="font-size:.72rem;color:var(--txt3);margin-top:.2rem">Active at site</div></div>
        <div class="kpi"><div class="kpi-top"><div class="kpi-icon orange">⚙</div></div>
          <div class="kpi-val">${activeAssets}</div>
          <div class="kpi-label">Active equipment</div>
          <div style="font-size:.72rem;color:var(--txt3);margin-top:.2rem">Operational units</div></div>
      </section>

      <!-- Two-column: Site Details + Dept breakdown -->
      <section style="display:grid;grid-template-columns:1fr 1fr;gap:1.2rem;margin-bottom:1.4rem">
        <div class="card">
          <div class="card-head">
            <h3>📍 Site details</h3>
            <span class="tag" style="background:rgba(46,125,50,.12);color:#15803d">Live</span>
          </div>
          <div class="card-body">
            <div class="info-grid-3">
              <div class="info-card"><div class="ic-label">Site ID</div><div class="ic-value">${escapeHtml(sel.siteId || '—')}</div></div>
              <div class="info-card"><div class="ic-label">City</div><div class="ic-value">${escapeHtml(sel.city || '—')}</div></div>
              <div class="info-card"><div class="ic-label">State</div><div class="ic-value">${escapeHtml(sel.state || '—')}</div></div>
              <div class="info-card"><div class="ic-label">Site In-Charge</div><div class="ic-value">${escapeHtml(sel.incharge || '—')}</div></div>
              <div class="info-card"><div class="ic-label">Reporting Manager</div><div class="ic-value">${escapeHtml(sel.manager || '—')}</div></div>
              <div class="info-card"><div class="ic-label">Contact</div><div class="ic-value">${escapeHtml(sel.contact || '—')}</div></div>
              ${sel.address ? `<div class="info-card" style="grid-column:1/-1"><div class="ic-label">Address</div><div class="ic-value" style="font-size:.82rem">${escapeHtml(sel.address)}</div></div>` : ''}
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>👷 Workforce by department</h3></div>
          <div class="card-body">
            ${topDepts.length === 0
              ? `<div style="padding:1.5rem;text-align:center;color:var(--txt3);font-size:.85rem">No employees mapped to this site.</div>`
              : topDepts.map(([d, n]) => {
                  const pct = siteEmps.length ? Math.round(n / siteEmps.length * 100) : 0;
                  return `<div style="margin-bottom:.65rem">
                    <div style="display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:.25rem">
                      <span style="font-weight:600">${escapeHtml(d)}</span>
                      <span style="color:var(--txt3)">${n} (${pct}%)</span>
                    </div>
                    <div style="background:var(--surface3);border-radius:99px;height:7px;overflow:hidden">
                      <div style="width:${pct}%;height:100%;background:var(--g6);border-radius:99px"></div>
                    </div>
                  </div>`;
                }).join('')}
          </div>
        </div>
      </section>

      <!-- Staff list -->
      <div class="card" style="margin-bottom:1.4rem">
        <div class="card-head">
          <h3>👷 Staff at site <span style="font-weight:400;color:var(--txt3);font-size:.82rem">(${siteEmps.length})</span></h3>
          <input id="smEmpSearch" class="filt-in" placeholder="Search name / dept / designation…" style="max-width:240px"/>
        </div>
        <div class="card-body" style="padding:0;overflow-x:auto;max-height:380px;overflow-y:auto" id="smEmpTable">${renderSMEmpTable(siteEmps)}</div>
      </div>

      <!-- Equipment list -->
      <div class="card" style="margin-bottom:1.4rem">
        <div class="card-head">
          <h3>🚜 Equipment at site <span style="font-weight:400;color:var(--txt3);font-size:.82rem">(${siteAssets.length})</span></h3>
          <input id="smEqSearch" class="filt-in" placeholder="Search asset / category / code…" style="max-width:240px"/>
        </div>
        <div class="card-body" style="padding:0;overflow-x:auto;max-height:380px;overflow-y:auto" id="smEqTable">${renderSMEquipTable(siteAssets)}</div>
      </div>

      ${topCats.length > 0 ? `
      <!-- Equipment by category -->
      <div class="card" style="margin-bottom:1.4rem">
        <div class="card-head"><h3>⚙ Equipment by category</h3></div>
        <div class="card-body">
          ${topCats.map(([c, n]) => {
            const pct = siteAssets.length ? Math.round(n / siteAssets.length * 100) : 0;
            return `<div style="margin-bottom:.6rem">
              <div style="display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:.2rem">
                <span style="font-weight:600">${escapeHtml(c)}</span>
                <span style="color:var(--txt3)">${n} units</span>
              </div>
              <div style="background:var(--surface3);border-radius:99px;height:6px;overflow:hidden">
                <div style="width:${pct}%;height:100%;background:#1565c0;border-radius:99px"></div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}

      <!-- Operations section -->
      <div style="border-top:2px solid var(--border);margin:1.4rem 0 1rem;display:flex;align-items:center;gap:.7rem">
        <span class="tag" style="background:var(--surface2);color:var(--txt3);font-weight:700;letter-spacing:.06em">SITE OPERATIONS</span>
      </div>

      <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:1rem;border-bottom:1px solid var(--border);padding-bottom:0" id="smOpsTabs">
        <button class="sm-ops-tab" data-tab="mrs">📋 MRS</button>
        <button class="sm-ops-tab" data-tab="po">📦 POs</button>
        <button class="sm-ops-tab" data-tab="stock">🏪 Stock</button>
        <button class="sm-ops-tab" data-tab="grn">📥 GRN</button>
        <button class="sm-ops-tab" data-tab="dpr">📓 DPR</button>
        <button class="sm-ops-tab" data-tab="logsheet">🗒 Log sheet</button>
        <button class="sm-ops-tab" data-tab="maintenance">🔧 Maintenance</button>
      </div>
      <div id="smOpsContent" style="min-height:200px"></div>
    `;

    // Inject ops tab styles once
    if (!document.getElementById('smOpsStyles')) {
      const s = document.createElement('style');
      s.id = 'smOpsStyles';
      s.textContent = `
        .sm-ops-tab { padding:.45rem .9rem; border:none; background:none; font-family:inherit;
          font-size:.8rem; font-weight:600; color:var(--txt3); cursor:pointer;
          border-bottom:2.5px solid transparent; margin-bottom:-1px;
          transition:color var(--t-fast), border-color var(--t-fast); }
        .sm-ops-tab:hover { color:var(--txt); }
        .sm-ops-tab.active { color:var(--g7); border-bottom-color:var(--g7); }
        body.dark .sm-ops-tab.active { color:#7fdc8f; border-bottom-color:#7fdc8f; }
        .sm-ops-tab.disabled { color:var(--txt4); cursor:not-allowed; opacity:.55; }
        .sm-ops-tab.disabled:hover { color:var(--txt4); }
      `;
      document.head.appendChild(s);
    }
    injectFilterStyles();

    // Wire site selector
    document.getElementById('smSiteSel').addEventListener('change', e => {
      _smSelected = e.target.value;
      drawSiteManager(sites, active, emps, assets);
    });

    // Wire searches
    document.getElementById('smEmpSearch').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      const filtered = !q ? siteEmps : siteEmps.filter(u =>
        ((u.name || '') + (u.dept || '') + (u.desig || '') + (u.empCode || '')).toLowerCase().includes(q));
      document.getElementById('smEmpTable').innerHTML = renderSMEmpTable(filtered);
    });
    document.getElementById('smEqSearch').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      const filtered = !q ? siteAssets : siteAssets.filter(a =>
        ((a.name || '') + (a.category || '') + (a.code || '')).toLowerCase().includes(q));
      document.getElementById('smEqTable').innerHTML = renderSMEquipTable(filtered);
    });

    // Wire ops tabs — all 7 are active now
    document.querySelectorAll('#smOpsTabs .sm-ops-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _smOpsTab = btn.dataset.tab;
        document.querySelectorAll('#smOpsTabs .sm-ops-tab').forEach(b =>
          b.classList.toggle('active', b.dataset.tab === _smOpsTab));
        renderSMOpsContent(siteName);
      });
    });

    // Auto-activate the current ops tab
    const startBtn = document.querySelector(`#smOpsTabs .sm-ops-tab[data-tab="${_smOpsTab}"]`);
    if (startBtn) {
      startBtn.classList.add('active');
      renderSMOpsContent(siteName);
    } else {
      _smOpsTab = 'mrs';
      document.querySelector('#smOpsTabs .sm-ops-tab[data-tab="mrs"]').classList.add('active');
      renderSMOpsContent(siteName);
    }
  }

  /* ─── Sub-render: staff table ─── */
  function renderSMEmpTable(rows) {
    if (!rows.length) return `<div style="padding:1.4rem;text-align:center;color:var(--txt3);font-size:.85rem">No staff at this site.</div>`;
    const sorted = [...rows].sort((a,b) => (a.name||'').localeCompare(b.name||''));
    return `<table class="tbl" style="min-width:640px">
      <thead><tr><th>Name</th><th>Emp Code</th><th>Designation</th><th>Department</th><th>Type</th><th>Reporting Manager</th></tr></thead>
      <tbody>${sorted.slice(0, 100).map(u => `<tr>
        <td style="font-weight:600">${escapeHtml(u.name || '—')}</td>
        <td style="font-family:'DM Mono',monospace;font-size:.74rem;color:var(--txt3)">${escapeHtml(u.empCode || '—')}</td>
        <td style="font-size:.82rem">${escapeHtml(u.desig || '—')}</td>
        <td style="font-size:.82rem">${escapeHtml(u.dept || '—')}</td>
        <td><span class="tag" style="background:rgba(46,125,50,.12);color:#15803d">${escapeHtml(u.empType || '—')}</span></td>
        <td style="font-size:.78rem;color:var(--txt3)">${escapeHtml(u.manager || '—')}</td>
      </tr>`).join('')}</tbody>
      ${rows.length > 100 ? `<tfoot><tr><td colspan="6" style="text-align:center;color:var(--txt3);padding:.5rem;font-size:.78rem">Showing 100 of ${rows.length} — use search to narrow</td></tr></tfoot>` : ''}
    </table>`;
  }

  /* ─── Sub-render: equipment table ─── */
  function renderSMEquipTable(rows) {
    if (!rows.length) return `<div style="padding:1.4rem;text-align:center;color:var(--txt3);font-size:.85rem">No equipment at this site.</div>`;
    return `<table class="tbl" style="min-width:580px">
      <thead><tr><th>Asset</th><th>Code</th><th>Category</th><th>Own/Hire</th><th style="text-align:center">Status</th></tr></thead>
      <tbody>${rows.slice(0, 100).map(a => {
        const stCol = a.status === 'ACTIVE' ? '#15803d' : '#b91c1c';
        const stBg  = a.status === 'ACTIVE' ? 'rgba(46,125,50,.12)' : 'rgba(220,38,38,.12)';
        const oh = (a.ownHire || '').toUpperCase();
        const ohCol = oh === 'OWN' ? '#1565c0' : '#bf6700';
        const ohBg  = oh === 'OWN' ? 'rgba(30,136,229,.12)' : 'rgba(251,140,0,.15)';
        return `<tr>
          <td style="font-weight:600">${escapeHtml(a.name)}</td>
          <td style="font-family:'DM Mono',monospace;font-size:.72rem;color:var(--txt3)">${escapeHtml(a.code) || '—'}</td>
          <td style="font-size:.82rem">${escapeHtml(a.category) || '—'}</td>
          <td><span class="tag" style="background:${ohBg};color:${ohCol}">${escapeHtml(a.ownHire) || '—'}</span></td>
          <td style="text-align:center"><span class="tag" style="background:${stBg};color:${stCol}">${escapeHtml(a.status)}</span></td>
        </tr>`;
      }).join('')}</tbody>
      ${rows.length > 100 ? `<tfoot><tr><td colspan="5" style="text-align:center;color:var(--txt3);padding:.5rem;font-size:.78rem">Showing 100 of ${rows.length}</td></tr></tfoot>` : ''}
    </table>`;
  }

  /* ─── Ops tabs: MRS + PO (live), others stubbed ─── */
  function renderSMOpsContent(siteName) {
    const el = document.getElementById('smOpsContent');
    if (!el) return;
    el.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--txt3);font-size:.85rem">⏳ Loading ${_smOpsTab.toUpperCase()}…</div>`;

    if (_smOpsTab === 'mrs') {
      cachedFetch('mrs', 'siteops.mrs').then(rows => {
        const filtered = rows
          .filter(r => {
            const rn = (r['Request No'] || '').trim();
            const rs = (r['Requested For (site)'] || r['Site'] || r['F'] || '').trim();
            return rn && rn.toLowerCase() !== 'dummy' && rs === siteName;
          })
          .map(r => ({
            reqNo: r['Request No'] || '',
            site:  r['Requested For (site)'] || r['Site'] || r['F'] || '',
            part:  r['Part Details'] || r['G'] || '',
            status:(r['MR Approval Status'] || '').trim() || 'Pending',
            ts:    r['Timestamp'] || r['Y'] || '',
          }));
        renderSMOpsMRS(el, filtered);
      }).catch(err => {
        el.innerHTML = err.name === 'SheetError'
          ? `<div class="alert warn"><span class="alert-icon">⚠</span><div class="alert-body">Could not load MRS data. ${escapeHtml(err.message || '')}</div></div>`
          : `<div class="alert danger"><span class="alert-icon">⚠</span><div class="alert-body">${escapeHtml(err && err.message || 'Failed')}</div></div>`;
      });
    }
    else if (_smOpsTab === 'po') {
      cachedFetch('po', 'scm.po').then(rows => {
        const today = new Date(); today.setHours(0,0,0,0);
        const filtered = rows.filter(r => {
          const p = (r['PO No'] || '').trim();
          const s = (r['Site Name'] || '').trim();
          const v = (r['Vendor Name'] || '').trim().toLowerCase();
          return p && p.toLowerCase() !== 'dummy' && v !== 'dummy' && s === siteName;
        }).map(r => {
          const dateRaw = r['PO Date'] || '';
          const jsDate = parsePODate(dateRaw);
          return {
            poNo: r['PO No'] || '',
            poDate: dateRaw,
            ageDays: jsDate ? Math.floor((today - jsDate) / 86400000) : null,
            vendor: r['Vendor Name'] || '',
            status: (r['PO Approval Status'] || '').trim(),
            lock:   (r['Lock'] || '').trim(),
            amount: parseFloat((r['Net Amount'] || '0').toString().replace(/,/g, '')) || 0,
          };
        });
        renderSMOpsPO(el, filtered);
      }).catch(err => {
        el.innerHTML = err.name === 'SheetError'
          ? `<div class="alert warn"><span class="alert-icon">⚠</span><div class="alert-body">Could not load PO data. ${escapeHtml(err.message || '')}</div></div>`
          : `<div class="alert danger"><span class="alert-icon">⚠</span><div class="alert-body">${escapeHtml(err && err.message || 'Failed')}</div></div>`;
      });
    }
    else if (_smOpsTab === 'stock') {
      cachedFetch('stock', 'reports.stockLevels').then(rows => {
        const filtered = rows.filter(r => (r['Site Name'] || '').trim() === siteName);
        renderSMOpsStock(el, filtered);
      }).catch(err => {
        el.innerHTML = err.name === 'SheetError'
          ? `<div class="alert warn"><span class="alert-icon">⚠</span><div class="alert-body">Could not load stock data. ${escapeHtml(err.message || '')}</div></div>`
          : `<div class="alert danger"><span class="alert-icon">⚠</span><div class="alert-body">${escapeHtml(err && err.message || 'Failed')}</div></div>`;
      });
    }
    else if (_smOpsTab === 'grn') {
      Promise.all([
        cachedFetch('si',  'reports.stockIn'),
        cachedFetch('grn', 'reports.grnNo'),
      ]).then(([siRows, grnRows]) => {
        const gMap = {};
        grnRows.forEach(r => {
          const u = (r['UUID'] || '').trim();
          if (u) gMap[u] = { grnNo: r['GRN No (Goods Receipt)'] || '', receivedOn: r['Received On (At)'] || '' };
        });
        const filtered = siRows
          .filter(r => (r['Site Name'] || r['D'] || '').trim() === siteName)
          .map(r => {
            const cs = (r['CheckSum'] || r['UUID'] || '').trim();
            const g  = gMap[cs] || {};
            return {
              siId:   r['SI ID'] || '',
              poNo:   r['PO No'] || r['F'] || '',
              vendor: r['Vendor Name'] || r['G'] || '',
              invNo:  r['Invoice No / ST No'] || r['H'] || '',
              part:   r['Part Description'] || r['N'] || '',
              mrQty:  r['MR Qty'] || r['O'] || '',
              grnQty: r['GRN Qty'] || r['Q'] || '',
              grnNo:  g.grnNo || '',
              receivedOn: g.receivedOn || '',
            };
          });
        renderSMOpsGRN(el, filtered);
      }).catch(err => {
        el.innerHTML = err.name === 'SheetError'
          ? `<div class="alert warn"><span class="alert-icon">⚠</span><div class="alert-body">Could not load GRN data. ${escapeHtml(err.message || '')}</div></div>`
          : `<div class="alert danger"><span class="alert-icon">⚠</span><div class="alert-body">${escapeHtml(err && err.message || 'Failed')}</div></div>`;
      });
    }
    else if (_smOpsTab === 'dpr')         renderSMOpsLauncher(el, 'dpr', siteName);
    else if (_smOpsTab === 'logsheet')    renderSMOpsLauncher(el, 'logsheet', siteName);
    else if (_smOpsTab === 'maintenance') renderSMOpsLauncher(el, 'maintenance', siteName);
  }

  /* ─── AppSheet launcher cards for ops tabs without a portal data source ───
     These three workflows live entirely in their AppSheet apps. We surface
     them here as deep-link cards rather than disabled tabs so site managers
     don't lose context — they can jump straight from the per-site view into
     the right AppSheet view, with the site already filtered on the URL.
  */
  const SM_OPS_LAUNCHERS = {
    dpr: {
      title: '📓 Daily Progress Report (DPR)',
      blurb: 'Site-level daily production, manpower, equipment hours, and progress entries — captured in the SCM AppSheet under the DPR view.',
      cards: [
        { icon:'➕', label:'New DPR entry',     view:'DPR_Form' },
        { icon:'📋', label:'Today\'s DPR',      view:'DPR_Today' },
        { icon:'📊', label:'DPR history',       view:'DPR' },
        { icon:'📈', label:'Production trend',  view:'DPR_Trend' },
      ],
      base: 'https://www.appsheet.com/start/06fd0117-1dd8-445b-aaee-e2ff6e68e36f',
    },
    logsheet: {
      title: '🗒 Equipment Log Sheet',
      blurb: 'Per-shift fuel, hour-meter, operator, idle time and breakdown notes for every active asset on this site. Captured in the SCM AppSheet under the Log Sheet view.',
      cards: [
        { icon:'➕', label:'New log entry',         view:'Logsheet_Form' },
        { icon:'📋', label:'Today\'s log sheets',   view:'Logsheet_Today' },
        { icon:'⏱',  label:'Equipment hours',       view:'Equipment_Hours' },
        { icon:'⛽', label:'Fuel consumption',      view:'Fuel_Log' },
      ],
      base: 'https://www.appsheet.com/start/06fd0117-1dd8-445b-aaee-e2ff6e68e36f',
    },
    maintenance: {
      title: '🔧 Periodic Maintenance',
      blurb: 'Service schedules, due dates, completed maintenance log per asset. Captured in the SCM AppSheet under the Maintenance view. Asset hours roll up from Log Sheet entries to drive due-date predictions.',
      cards: [
        { icon:'📅', label:'Maintenance due',        view:'Maintenance_Due' },
        { icon:'➕', label:'Log a service',          view:'Maintenance_Form' },
        { icon:'📋', label:'Service history',        view:'Maintenance_History' },
        { icon:'⚠',  label:'Overdue items',          view:'Maintenance_Overdue' },
      ],
      base: 'https://www.appsheet.com/start/06fd0117-1dd8-445b-aaee-e2ff6e68e36f',
    },
  };

  function renderSMOpsLauncher(el, key, siteName) {
    const cfg = SM_OPS_LAUNCHERS[key];
    if (!cfg) { el.innerHTML = ''; return; }

    el.innerHTML = `
      <div class="card" style="margin-bottom:1rem">
        <div class="card-body" style="display:flex;align-items:flex-start;gap:1rem;flex-wrap:wrap">
          <div style="font-size:2.2rem;flex-shrink:0">${cfg.title.split(' ')[0]}</div>
          <div style="flex:1;min-width:240px">
            <h3 style="margin:0 0 .25rem;font-size:1rem;color:var(--g8)">${escapeHtml(cfg.title)}</h3>
            <div style="font-size:.82rem;color:var(--txt2);line-height:1.55">${escapeHtml(cfg.blurb)}</div>
            <div style="font-size:.74rem;color:var(--txt3);margin-top:.5rem">
              📍 Filtered to: <b>${escapeHtml(siteName)}</b>
            </div>
          </div>
          <a class="btn btn-primary btn-sm" href="${cfg.base}" target="_blank" rel="noopener" style="flex-shrink:0;align-self:center">Open AppSheet ↗</a>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.7rem">
        ${cfg.cards.map(c => `
          <a class="quick-action" href="${cfg.base}#view=${encodeURIComponent(c.view)}&site=${encodeURIComponent(siteName)}" target="_blank" rel="noopener"
             style="display:flex;align-items:center;gap:.6rem;padding:.85rem 1rem;text-decoration:none;background:var(--surface2);border:1px solid var(--border);border-radius:10px;color:var(--txt2);font-size:.84rem;font-weight:500;transition:all var(--t-fast)">
            <span style="font-size:1.4rem;flex-shrink:0">${c.icon}</span>
            <span style="flex:1">${escapeHtml(c.label)}</span>
            <span style="opacity:.5;font-size:.75rem">↗</span>
          </a>`).join('')}
      </div>
      <div style="margin-top:1rem;padding:.7rem .9rem;background:var(--surface2);border-radius:8px;font-size:.75rem;color:var(--txt3);line-height:1.5">
        💡 These workflows live in the AppSheet app for offline-friendly mobile
        capture by site staff. Deep links above pre-filter to <b>${escapeHtml(siteName)}</b>.
        Once the AppSheet API key is connected, we can surface the same data
        inline here without leaving the portal.
      </div>`;

    if (!document.getElementById('quickActionStyles')) {
      const s = document.createElement('style');
      s.id = 'quickActionStyles';
      s.textContent = `
        .quick-action:hover { background:rgba(46,125,50,.06) !important; border-color:var(--g5) !important; color:var(--g8) !important; }
        body.dark .quick-action:hover { background:rgba(60,185,109,.08) !important; color:#7fdc8f !important; }
      `;
      document.head.appendChild(s);
    }
  }

  function renderSMOpsStock(el, rows) {
    const total = rows.length;
    const totalIn = rows.reduce((s, r) => s + (parseFloat(r['StockIN']) || 0), 0);
    const totalOut = rows.reduce((s, r) => s + (parseFloat(r['Stock Out']) || 0), 0);
    const totalSiteStock = rows.reduce((s, r) => s + (parseFloat(r['Site Stock']) || 0), 0);

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.6rem;margin-bottom:1rem">
        <div class="info-card"><div class="ic-label">📦 Items tracked</div><div class="ic-value">${total}</div></div>
        <div class="info-card"><div class="ic-label">📥 Total IN</div><div class="ic-value" style="color:var(--g7)">${Math.round(totalIn).toLocaleString('en-IN')}</div></div>
        <div class="info-card"><div class="ic-label">📤 Total OUT</div><div class="ic-value" style="color:#bf6700">${Math.round(totalOut).toLocaleString('en-IN')}</div></div>
        <div class="info-card"><div class="ic-label">🏪 Net stock</div><div class="ic-value" style="color:var(--g7)">${Math.round(totalSiteStock).toLocaleString('en-IN')}</div></div>
      </div>
      <div class="card">
        <div class="card-body" style="padding:0;overflow-x:auto;max-height:420px;overflow-y:auto">
          ${total === 0
            ? `<div style="padding:1.5rem;text-align:center;color:var(--txt3);font-size:.85rem">No stock data for this site.</div>`
            : `<table class="tbl">
                <thead><tr>
                  <th>SNo</th><th>Part Details</th>
                  <th style="text-align:right">Stock IN</th>
                  <th style="text-align:right">Transfer In</th>
                  <th style="text-align:right">Stock Out</th>
                  <th style="text-align:right">Site Stock</th>
                </tr></thead>
                <tbody>${rows.slice(0, 200).map(r => `<tr>
                  <td style="font-size:.74rem;color:var(--txt3)">${escapeHtml(r['SNo']) || '—'}</td>
                  <td style="font-size:.8rem;max-width:420px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeAttr(r['Part Details'] || r['Site & Code'] || '')}">${escapeHtml(r['Part Details'] || r['Site & Code'] || '—')}</td>
                  <td style="text-align:right;font-weight:600">${escapeHtml(r['StockIN'] || '0')}</td>
                  <td style="text-align:right">${escapeHtml(r['Stock Transfer (To)'] || '0')}</td>
                  <td style="text-align:right">${escapeHtml(r['Stock Out'] || '0')}</td>
                  <td style="text-align:right;font-weight:700;color:var(--g7)">${escapeHtml(r['Site Stock'] || '0')}</td>
                </tr>`).join('')}</tbody>
                ${rows.length > 200 ? `<tfoot><tr><td colspan="6" style="text-align:center;color:var(--txt3);padding:.5rem;font-size:.78rem">Showing 200 of ${rows.length}</td></tr></tfoot>` : ''}
              </table>`}
        </div>
      </div>`;
  }

  function renderSMOpsGRN(el, rows) {
    const total = rows.length;
    const withGRN = rows.filter(r => r.grnNo).length;
    const pending = total - withGRN;

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.6rem;margin-bottom:1rem">
        <div class="info-card"><div class="ic-label">📋 Stock IN entries</div><div class="ic-value">${total}</div></div>
        <div class="info-card"><div class="ic-label">✓ With GRN</div><div class="ic-value" style="color:#15803d">${withGRN}</div></div>
        <div class="info-card"><div class="ic-label">⏳ GRN pending</div><div class="ic-value" style="color:#bf6700">${pending}</div></div>
      </div>
      <div class="card">
        <div class="card-body" style="padding:0;overflow-x:auto;max-height:420px;overflow-y:auto">
          ${total === 0
            ? `<div style="padding:1.5rem;text-align:center;color:var(--txt3);font-size:.85rem">No goods-received data for this site.</div>`
            : `<table class="tbl">
                <thead><tr>
                  <th>GRN No</th><th>SI ID</th><th>PO No</th><th>Vendor</th><th>Part</th>
                  <th style="text-align:right">MR Qty</th><th style="text-align:right">GRN Qty</th><th>Received</th>
                </tr></thead>
                <tbody>${rows.slice(0, 200).map(r => `<tr>
                  <td style="font-family:'DM Mono',monospace;font-size:.74rem;font-weight:700;color:${r.grnNo ? 'var(--g7)' : 'var(--txt3)'}">${escapeHtml(r.grnNo || 'Pending')}</td>
                  <td style="font-family:'DM Mono',monospace;font-size:.72rem;color:var(--txt3)">${escapeHtml(r.siId) || '—'}</td>
                  <td style="font-size:.78rem">${escapeHtml(r.poNo) || '—'}</td>
                  <td style="font-size:.8rem;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeAttr(r.vendor || '')}">${escapeHtml(r.vendor) || '—'}</td>
                  <td style="font-size:.78rem;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeAttr(r.part || '')}">${escapeHtml(r.part) || '—'}</td>
                  <td style="text-align:right;font-size:.8rem">${escapeHtml(r.mrQty) || '—'}</td>
                  <td style="text-align:right;font-size:.8rem;font-weight:600">${escapeHtml(r.grnQty) || '—'}</td>
                  <td style="font-size:.76rem;color:var(--txt3)">${escapeHtml(r.receivedOn) || '—'}</td>
                </tr>`).join('')}</tbody>
                ${rows.length > 200 ? `<tfoot><tr><td colspan="8" style="text-align:center;color:var(--txt3);padding:.5rem;font-size:.78rem">Showing 200 of ${rows.length}</td></tr></tfoot>` : ''}
              </table>`}
        </div>
      </div>`;
  }

  function renderSMOpsMRS(el, rows) {
    const total    = rows.length;
    const pending  = rows.filter(r => (r.status || '').toUpperCase() === 'PENDING' || !r.status).length;
    const approved = rows.filter(r => (r.status || '').toUpperCase() === 'APPROVED').length;
    const rejected = rows.filter(r => (r.status || '').toUpperCase() === 'REJECTED').length;

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.6rem;margin-bottom:1rem">
        <div class="info-card"><div class="ic-label">📋 Total MRS</div><div class="ic-value">${total}</div></div>
        <div class="info-card"><div class="ic-label">⏳ Pending</div><div class="ic-value" style="color:#bf6700">${pending}</div></div>
        <div class="info-card"><div class="ic-label">✓ Approved</div><div class="ic-value" style="color:#15803d">${approved}</div></div>
        <div class="info-card"><div class="ic-label">✕ Rejected</div><div class="ic-value" style="color:#b91c1c">${rejected}</div></div>
      </div>
      <div class="card">
        <div class="card-body" style="padding:0;overflow-x:auto;max-height:420px;overflow-y:auto">
          ${total === 0
            ? `<div style="padding:1.5rem;text-align:center;color:var(--txt3);font-size:.85rem">No MRS for this site.</div>`
            : `<table class="tbl">
                <thead><tr><th>Request No</th><th>Part Details</th><th>Status</th><th>Timestamp</th></tr></thead>
                <tbody>${rows.slice(0, 200).map(r => {
                  const st = (r.status || 'Pending').toUpperCase();
                  const stColor = { APPROVED:'#15803d', REJECTED:'#b91c1c', PENDING:'#bf6700', DROPPED:'#6b7280' };
                  const stBg = { APPROVED:'rgba(46,125,50,.12)', REJECTED:'rgba(220,38,38,.12)', PENDING:'rgba(251,140,0,.15)', DROPPED:'rgba(107,114,128,.12)' };
                  return `<tr>
                    <td style="font-family:'DM Mono',monospace;font-size:.76rem;font-weight:700;color:var(--g7)">${escapeHtml(r.reqNo)}</td>
                    <td style="font-size:.8rem;max-width:380px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeAttr(r.part)}">${escapeHtml(r.part) || '—'}</td>
                    <td><span class="tag" style="background:${stBg[st] || 'var(--surface3)'};color:${stColor[st] || 'var(--txt2)'}">${escapeHtml(r.status)}</span></td>
                    <td style="font-size:.76rem;color:var(--txt3)">${escapeHtml(r.ts) || '—'}</td>
                  </tr>`;
                }).join('')}</tbody>
                ${rows.length > 200 ? `<tfoot><tr><td colspan="4" style="text-align:center;color:var(--txt3);padding:.5rem;font-size:.78rem">Showing 200 of ${rows.length}</td></tr></tfoot>` : ''}
              </table>`}
        </div>
      </div>`;
  }

  function renderSMOpsPO(el, rows) {
    const total = rows.length;
    const pending = rows.filter(r => (r.status || '').toUpperCase() !== 'REJECTED' && r.lock === 'Released for Approval').length;
    const approved = rows.filter(r => (r.status || '').toUpperCase().includes('APPROVED')).length;
    const totalAmt = rows.reduce((s, r) => s + r.amount, 0);

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.6rem;margin-bottom:1rem">
        <div class="info-card"><div class="ic-label">📦 Total POs</div><div class="ic-value">${total}</div></div>
        <div class="info-card"><div class="ic-label">⏳ Pending</div><div class="ic-value" style="color:#bf6700">${pending}</div></div>
        <div class="info-card"><div class="ic-label">✓ Approved</div><div class="ic-value" style="color:#15803d">${approved}</div></div>
        <div class="info-card"><div class="ic-label">💰 Total spend</div><div class="ic-value" style="color:var(--g7)">${total ? fmtAmt(totalAmt) : '—'}</div></div>
      </div>
      <div class="card">
        <div class="card-body" style="padding:0;overflow-x:auto;max-height:420px;overflow-y:auto">
          ${total === 0
            ? `<div style="padding:1.5rem;text-align:center;color:var(--txt3);font-size:.85rem">No POs for this site.</div>`
            : `<table class="tbl">
                <thead><tr><th>PO No</th><th>Date</th><th>Vendor</th><th style="text-align:right">Amount</th><th>Status</th><th>Age</th></tr></thead>
                <tbody>${rows.sort((a,b) => (b.ageDays||0) - (a.ageDays||0)).slice(0, 200).map(r => {
                  const st = (r.status || '').toUpperCase();
                  const isApproved = st.includes('APPROVED');
                  const isRejected = st.includes('REJECT');
                  const stColor = isApproved ? '#15803d' : isRejected ? '#b91c1c' : '#bf6700';
                  const stBg    = isApproved ? 'rgba(46,125,50,.12)' : isRejected ? 'rgba(220,38,38,.12)' : 'rgba(251,140,0,.15)';
                  const ageBadge = r.ageDays == null ? '—'
                    : r.ageDays > 14 ? `<span class="tag" style="background:rgba(220,38,38,.12);color:#b91c1c">${r.ageDays}d</span>`
                    : r.ageDays > 7  ? `<span class="tag" style="background:rgba(251,140,0,.15);color:#bf6700">${r.ageDays}d</span>`
                    : `<span class="tag">${r.ageDays}d</span>`;
                  return `<tr>
                    <td style="font-family:'DM Mono',monospace;font-size:.76rem;font-weight:700;color:var(--g7)">${escapeHtml(r.poNo)}</td>
                    <td style="font-size:.78rem;color:var(--txt2)">${escapeHtml(r.poDate) || '—'}</td>
                    <td style="font-size:.82rem;font-weight:600">${escapeHtml(r.vendor) || '—'}</td>
                    <td style="text-align:right;font-weight:700">${r.amount ? fmtAmt(r.amount) : '—'}</td>
                    <td><span class="tag" style="background:${stBg};color:${stColor}">${escapeHtml(r.status || 'Pending')}</span></td>
                    <td>${ageBadge}</td>
                  </tr>`;
                }).join('')}</tbody>
                ${rows.length > 200 ? `<tfoot><tr><td colspan="6" style="text-align:center;color:var(--txt3);padding:.5rem;font-size:.78rem">Showing 200 of ${rows.length}</td></tr></tfoot>` : ''}
              </table>`}
        </div>
      </div>`;
  }

  /* ─── Cached fetch helper ─── */
  function cachedFetch(key, bindingName) {
    if (_smCache[key]) return Promise.resolve(_smCache[key]);
    return API.fetchByBinding(bindingName).then(rows => {
      _smCache[key] = rows;
      return rows;
    });
  }

  /* ─── Row normalizers ─── */
  function normSiteRow(r) {
    const rawStatus = (r['Active/Inactive?'] || r['Status'] || '').toUpperCase().trim();
    return {
      siteId:   r['Site ID'] || r['Site Code'] || r['Code'] || '',
      name:     r['Site Name'] || r['Name'] || '',
      city:     r['City'] || '',
      state:    r['State'] || '',
      contact:  r['Contact 1'] || r['Contact'] || '',
      incharge: (r['Site In Charge Name'] || '').replace(/EG\w+\|/g, '').trim(),
      manager:  (r['Reporting Manager Name'] || '').replace(/EG\w+\|/g, '').trim(),
      address:  r['Address'] || '',
      status:   rawStatus === 'ACTIVE' ? 'ACTIVE' : (rawStatus || 'INACTIVE'),
    };
  }
  function normEmpRow(r) {
    const empStatus = (r['Employee Status'] || '').trim().toUpperCase();
    const reportingMgr = r['Reporting Manager'] || '';
    return {
      empCode: r['EMP CODE'] || r['New Employee Code'] || '',
      name:    r['Employee Name'] || '',
      email:   r['Mail ID'] || '',
      dept:    r['Department'] || '',
      desig:   r['DESIGNATION'] || '',
      empType: r['Employee Type'] || '',
      site:    r['Site Name'] || '',
      manager: reportingMgr.replace(/^EG\w+\|/i, '').trim(),
      status:  empStatus === 'CURRENT' ? 'ACTIVE' : 'INACTIVE',
    };
  }
  function normAssetRow(r) {
    return {
      name:     r['Asset Name'] || r['Name'] || r['Equipment'] || '—',
      code:     r['Asset Code'] || r['Code'] || '',
      category: r['Category'] || r['Type'] || '',
      site:     r['Site Name'] || r['Site'] || '',
      ownHire:  (r['Own/Hire'] || r['Own / Hire'] || r['Ownership'] || '').toString(),
      status:   (r['Status'] || '').toUpperCase() || 'ACTIVE',
    };
  }
  function parsePODate(v) {
    if (!v) return null;
    if (typeof v === 'string' && v.startsWith('Date(')) {
      try {
        const p = v.replace('Date(','').replace(')','').split(',').map(Number);
        return new Date(p[0], p[1], p[2]);
      } catch (_) { return null; }
    }
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }
  function fmtAmt(n) {
    if (!n) return '—';
    if (n >= 10000000) return '₹' + (n/10000000).toFixed(1) + 'Cr';
    if (n >= 100000)   return '₹' + (n/100000).toFixed(1) + 'L';
    return '₹' + Math.round(n).toLocaleString('en-IN');
  }


  /* ─────────── SHARED HELPERS ─────────── */
  function handleErr(err) {
    document.getElementById('content').innerHTML = '';
    if (err && err.name === 'SheetError') {
      API.renderSheetError(err, 'errorSlot');
    } else {
      document.getElementById('errorSlot').innerHTML =
        `<div class="alert danger"><div class="alert-icon">⚠</div><div class="alert-body">Could not load: ${escapeHtml(err && err.message || 'unknown')}</div></div>`;
    }
  }
  function downloadCSV(rows, filename) {
    if (!rows.length) { Shell.toast('No rows to export', 'warn'); return; }
    const cols = Object.keys(rows[0]);
    const lines = [cols.join(',')];
    rows.forEach(r => {
      lines.push(cols.map(c => {
        const v = r[c] == null ? '' : String(r[c]);
        return /[",\n]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v;
      }).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }
  function injectFilterStyles() {
    if (document.getElementById('siteOpsFilterStyles')) return;
    const css = `
      .filt-sel, .filt-in {
        padding:.4rem .65rem; border:1px solid var(--border);
        border-radius:8px; background:var(--surface);
        font-family:inherit; font-size:.82rem; color:var(--txt);
      }
      .filt-in { min-width:140px; max-width:240px; }
      .filt-sel:focus, .filt-in:focus { outline:none; border-color:var(--g5); }
    `;
    const style = document.createElement('style');
    style.id = 'siteOpsFilterStyles';
    style.textContent = css;
    document.head.appendChild(style);
  }
})();
