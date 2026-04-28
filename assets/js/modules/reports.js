/* ═══════════════════════════════════════════════════════════════════
   EVGCPL Portal — Reports Module
   /assets/js/modules/reports.js

   A catalogue of pre-built reports, each with its own filter set
   and underlying data source. All sources route through bindings
   (so they're remappable in Config). Run → table → CSV.

   Schedule UI is stubbed for the next session — the wiring is
   intentionally separated so it can be added without touching the
   catalogue or run code.
   ═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  Shell.mount('reports');

  document.getElementById('pageHead').innerHTML = Shell.pageHead({
    crumbs: [{ label:'Home', href:'dashboard.html' }, { label:'Reports' }],
    title:  '📊 Reports',
    sub:    'Select a report · apply filters · download CSV',
  });

  // ── Catalogue ─────────────────────────────────────────────────
  const CATALOGUE = [
    { id:'mrs_summary',           icon:'📋', name:'MRS Summary',
      desc:'Material Request Slips by site, status and date range',
      filters:['site','status_mrs','fy'], roles:['md','admin','purchase','accounts','hr','site','employee'] },
    { id:'po_tracker',            icon:'📦', name:'PO Tracker',
      desc:'Purchase Orders with vendor, site, status and spend',
      filters:['site','vendor','status_po','fy'], roles:['md','admin','purchase','accounts'] },
    { id:'vendor_spend',          icon:'💰', name:'Vendor Spend Summary',
      desc:'Total spend, PO count and pending amounts per vendor',
      filters:['site','fy'], roles:['md','admin','purchase','accounts'] },
    { id:'stock_levels',          icon:'📊', name:'Stock Levels by Site',
      desc:'Current stock quantities per item per site',
      filters:['site'], roles:['md','admin','purchase','site'] },
    { id:'grn_register',          icon:'📥', name:'GRN Register',
      desc:'Goods Received Notes with vendor, PO and quantities',
      filters:['site','vendor'], roles:['md','admin','purchase','site'] },
    { id:'emp_headcount',         icon:'👷', name:'Employee Headcount',
      desc:'Active employees by site and department',
      filters:['site','dept'], roles:['md','admin','hr'] },
    { id:'equipment_deployment',  icon:'🚜', name:'Equipment Deployment',
      desc:'Equipment units by site, category and own/hire status',
      filters:['site','category','ownhire'], roles:['md','admin','purchase','site'] },
    { id:'onboarding_status',     icon:'👶', name:'Onboarding Status',
      desc:'New joiners in the last 90/180 days with onboarding progress',
      filters:['site','period'], roles:['md','admin','hr','employee','site'] },
    { id:'vendor_invoice',        icon:'🧾', name:'Vendor Invoice Status',
      desc:'Invoice payment status per vendor',
      filters:['vendor','status_inv'], roles:['md','admin','purchase','accounts'] },
  ];

  // ── State ─────────────────────────────────────────────────────
  let selectedId = null;
  let resultRows = [];
  let resultCols = [];
  // Master caches (loaded lazily as filters need them)
  const masters = {
    sites: null, vendors: null, employees: null, assets: null,
  };
  // Source data caches (per binding, so we don't re-fetch)
  const sourceCache = {};


  // ── Render catalogue ──────────────────────────────────────────
  const role = STATE.get('role') || 'employee';
  const visible = CATALOGUE.filter(r => r.roles.includes(role));

  document.getElementById('rptGrid').innerHTML = !visible.length
    ? `<div style="grid-column:1/-1;padding:2rem;text-align:center;color:var(--txt3)">No reports available for your role.</div>`
    : visible.map(r => `
      <div class="rpt-card" data-rpt="${r.id}">
        <div class="icon">${r.icon}</div>
        <div class="name">${escapeHtml(r.name)}</div>
        <div class="desc">${escapeHtml(r.desc)}</div>
      </div>
    `).join('');

  document.querySelectorAll('[data-rpt]').forEach(card => {
    card.addEventListener('click', () => selectReport(card.dataset.rpt));
  });

  function selectReport(id) {
    selectedId = id;
    resultRows = []; resultCols = [];
    document.querySelectorAll('.rpt-card').forEach(c =>
      c.classList.toggle('selected', c.dataset.rpt === id));
    const r = CATALOGUE.find(x => x.id === id);
    if (!r) return;
    document.getElementById('rptPanel').style.display = '';
    document.getElementById('rptPanelTitle').textContent = r.name + ' — Filters';
    document.getElementById('rptResultBadge').style.display = 'none';
    document.getElementById('rptDl').style.display = 'none';
    document.getElementById('rptResults').innerHTML = '';
    buildFilters(r);
    refreshScheduleBar();
    document.getElementById('rptPanel').scrollIntoView({ behavior:'smooth', block:'start' });
  }


  /* ─── Schedule UI ───
     Per-report schedule config persists in localStorage under
     RPT_SCHED_KEY. Activation (the actual auto-email) requires an
     Apps Script time-driven trigger reading the same JSON shape from
     a server-side store — that's a separate setup step.
  */
  const RPT_SCHED_KEY = 'evgcpl_rpt_schedules';
  let _schedDraftRecipients = [];

  function loadAllSchedules() {
    try { return JSON.parse(localStorage.getItem(RPT_SCHED_KEY) || '{}'); }
    catch (_) { return {}; }
  }
  function loadSchedule(id) { return loadAllSchedules()[id] || null; }
  function saveSchedule(id, cfg) {
    const all = loadAllSchedules();
    all[id] = { ...cfg, updatedAt: new Date().toISOString() };
    localStorage.setItem(RPT_SCHED_KEY, JSON.stringify(all));
  }
  function deleteSchedule(id) {
    const all = loadAllSchedules();
    delete all[id];
    localStorage.setItem(RPT_SCHED_KEY, JSON.stringify(all));
  }

  function refreshScheduleBar() {
    if (!selectedId) return;
    const cfg = loadSchedule(selectedId);
    const st = document.getElementById('rptSchedStatus');
    const sb = document.getElementById('rptSchedSub');
    const tb = document.getElementById('rptSchedTestBtn');
    if (!cfg || cfg.active === 'off' || !cfg.recipients || !cfg.recipients.length) {
      st.textContent = 'Not scheduled';
      st.style.color = 'var(--txt3)';
      sb.textContent = 'Configure a schedule to auto-email this report';
      tb.style.display = 'none';
    } else {
      const dayLabel = ({ daily:'Every weekday', '0':'Sun', '1':'Mon', '2':'Tue', '3':'Wed', '4':'Thu', '5':'Fri', '6':'Sat' })[String(cfg.freq)] || cfg.freq;
      st.textContent = `✓ Scheduled — ${dayLabel} at ${cfg.time || '08:00'} IST`;
      st.style.color = 'var(--g7)';
      sb.textContent = `Sending to ${cfg.recipients.length} recipient${cfg.recipients.length === 1 ? '' : 's'}`;
      tb.style.display = '';
    }
  }

  function openScheduleModal() {
    if (!selectedId) return;
    const r = CATALOGUE.find(x => x.id === selectedId);
    const cfg = loadSchedule(selectedId) || { freq:'off', time:'08:00', recipients:[] };

    document.getElementById('rptSchedTitle').textContent = r ? r.name : 'Schedule';
    document.getElementById('rptSchedFreq').value = cfg.freq || 'off';
    document.getElementById('rptSchedTime').value = cfg.time || '08:00';
    _schedDraftRecipients = [...(cfg.recipients || [])];
    renderRecipChips();
    document.getElementById('rptSchedModal').style.display = 'flex';
  }

  function renderRecipChips() {
    const wrap = document.getElementById('rptSchedRecipChips');
    if (!wrap) return;
    if (!_schedDraftRecipients.length) {
      wrap.innerHTML = `<span style="font-size:.72rem;color:var(--txt3);font-style:italic">No recipients yet — add at least one to enable</span>`;
      return;
    }
    wrap.innerHTML = _schedDraftRecipients.map((email, i) => `
      <span style="display:inline-flex;align-items:center;gap:.3rem;padding:.18rem .5rem;background:var(--surface3);border-radius:99px;font-size:.74rem">
        ${escapeHtml(email)}
        <button data-idx="${i}" style="background:none;border:none;color:var(--txt3);cursor:pointer;font-size:.85rem;padding:0">×</button>
      </span>`).join('');
    wrap.querySelectorAll('button[data-idx]').forEach(b =>
      b.addEventListener('click', () => {
        _schedDraftRecipients.splice(parseInt(b.dataset.idx), 1);
        renderRecipChips();
      }));
  }

  // Wire schedule controls (run once on module load)
  function wireScheduleControls() {
    document.getElementById('rptSchedBtn').addEventListener('click', openScheduleModal);
    document.getElementById('rptSchedClose').addEventListener('click', () =>
      document.getElementById('rptSchedModal').style.display = 'none');
    document.getElementById('rptSchedModal').addEventListener('click', e => {
      if (e.target.id === 'rptSchedModal') e.target.style.display = 'none';
    });

    document.getElementById('rptSchedRecipAdd').addEventListener('click', () => {
      const inp = document.getElementById('rptSchedRecipInput');
      const v = inp.value.trim().toLowerCase();
      if (!v || !/.+@.+\..+/.test(v)) { Shell.toast('Enter a valid email', 'warn'); return; }
      if (_schedDraftRecipients.includes(v)) { Shell.toast('Already added', 'warn'); return; }
      _schedDraftRecipients.push(v);
      inp.value = '';
      renderRecipChips();
    });
    document.getElementById('rptSchedRecipInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById('rptSchedRecipAdd').click(); }
    });

    document.getElementById('rptSchedSave').addEventListener('click', () => {
      if (!selectedId) return;
      const freq = document.getElementById('rptSchedFreq').value;
      const time = document.getElementById('rptSchedTime').value || '08:00';
      if (freq === 'off') {
        deleteSchedule(selectedId);
        // Also remove from server
        pushScheduleToServer(selectedId, null);
        Shell.toast('Schedule turned off', 'success');
      } else if (!_schedDraftRecipients.length) {
        Shell.toast('Add at least one recipient', 'warn');
        return;
      } else {
        const cfg = {
          active:    'on',
          freq, time,
          recipients:_schedDraftRecipients,
          filters:   currentFilterSnapshot(),
        };
        saveSchedule(selectedId, cfg);
        pushScheduleToServer(selectedId, cfg);
        Shell.toast('Schedule saved · server updated', 'success');
      }
      document.getElementById('rptSchedModal').style.display = 'none';
      refreshScheduleBar();
    });

    document.getElementById('rptSchedDel').addEventListener('click', () => {
      if (!selectedId) return;
      deleteSchedule(selectedId);
      pushScheduleToServer(selectedId, null);
      document.getElementById('rptSchedModal').style.display = 'none';
      refreshScheduleBar();
      Shell.toast('Schedule deleted', 'success');
    });

    document.getElementById('rptSchedTestBtn').addEventListener('click', sendTestEmail);
  }

  // Push schedule to Apps Script for server-side trigger to read.
  // cfg=null means delete. Best-effort — local save always succeeds first.
  function pushScheduleToServer(reportId, cfg) {
    fetch(API.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action:   cfg ? 'saveReportSchedule' : 'deleteReportSchedule',
        reportId,
        config:   cfg,
        savedBy:  (STATE.get('user') || {}).email || '',
      }),
    }).catch(() => {
      // Silent failure — UI already shows local save success.
      // The "Send test now" button will surface the issue if needed.
    });
  }

  // Snapshot current filter values into a plain object — used by Apps Script
  function currentFilterSnapshot() {
    const ids = ['site','vendor','status_mrs','status_po','status_inv','fy','dept','category','ownhire','period'];
    const snap = {};
    ids.forEach(id => {
      const el = document.getElementById('f-' + id);
      if (el && el.value) snap[id] = el.value;
    });
    return snap;
  }

  async function sendTestEmail() {
    if (!selectedId) return;
    const cfg = loadSchedule(selectedId);
    if (!cfg) { Shell.toast('No active schedule', 'warn'); return; }
    Shell.toast('Sending test email…', 'success');
    try {
      const res = await fetch(API.APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action:     'sendReportTest',
          reportId:   selectedId,
          recipients: cfg.recipients,
          filters:    cfg.filters || {},
          subject:    `[Test] ${(CATALOGUE.find(r => r.id === selectedId) || {}).name || selectedId}`,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (json && json.success !== false) {
        Shell.toast('Test email sent', 'success');
      } else {
        Shell.toast(json.message || 'Could not send (handler not deployed?)', 'warn');
      }
    } catch (_) {
      Shell.toast('Apps Script unreachable — handler may not be deployed', 'warn');
    }
  }

  wireScheduleControls();


  // ── Build filter UI for the chosen report ─────────────────────
  async function buildFilters(report) {
    const el = document.getElementById('rptFilters');
    el.innerHTML = `<div style="color:var(--txt3);font-size:.8rem">Loading filter options…</div>`;

    // Resolve any masters this report's filters need
    const needs = report.filters;
    const tasks = [];
    if (needs.includes('site') && masters.sites === null)
      tasks.push(loadMaster('siteops.sites', 'sites', r => ({
        name: r['Site Name'] || r['Name'] || '', status: (r['Status']||'').toUpperCase(),
      })));
    if (needs.includes('vendor') && masters.vendors === null)
      tasks.push(loadMaster('scm.vendor', 'vendors', r => ({
        name: r['Vendor Name'] || r['Name'] || r['Company'] || '',
      })));
    if ((needs.includes('dept') || report.id === 'emp_headcount' || report.id === 'onboarding_status') && masters.employees === null)
      tasks.push(loadMaster('hr.employees', 'employees', normEmployee));
    if ((needs.includes('category') || needs.includes('ownhire') || report.id === 'equipment_deployment') && masters.assets === null)
      tasks.push(loadMaster('siteops.assets', 'assets', r => ({
        name:r['Asset Name']||r['Name']||'', code:r['Asset Code']||r['Code']||'',
        category:r['Category']||r['Type']||'', site:r['Site Name']||r['Site']||'',
        ownHire:(r['Own/Hire']||r['Ownership']||'').toString(), status:(r['Status']||'').toUpperCase()||'ACTIVE',
      })));
    await Promise.all(tasks);

    // Compute option lists
    const sites   = (masters.sites || []).filter(s => s.status === 'ACTIVE').map(s => s.name).filter(Boolean).sort();
    const vendors = (masters.vendors || []).map(v => v.name).filter(Boolean).sort();
    const depts   = [...new Set((masters.employees || []).map(u => u.dept).filter(Boolean))].sort();
    const cats    = [...new Set((masters.assets || []).map(a => a.category).filter(Boolean))].sort();
    const fySet   = getFYSet(3, 1);

    const make = (id, label, options, allLabel) => `
      <div class="rpt-filt">
        <span class="rpt-filt-label">${escapeHtml(label)}</span>
        <select id="f-${id}">
          <option value="">${escapeHtml(allLabel || 'All')}</option>
          ${options.map(o => `<option value="${escapeAttr(o)}">${escapeHtml(o)}</option>`).join('')}
        </select>
      </div>`;

    const parts = [];
    if (needs.includes('site'))       parts.push(make('site', 'Site', sites));
    if (needs.includes('vendor'))     parts.push(make('vendor', 'Vendor', vendors.slice(0, 200)));
    if (needs.includes('status_mrs')) parts.push(make('status_mrs', 'Status', ['Pending','Approved','Rejected','Dropped']));
    if (needs.includes('status_po'))  parts.push(make('status_po', 'Status', ['Pending Approval','Approved','Rejected']));
    if (needs.includes('status_inv')) parts.push(make('status_inv', 'Payment status', ['Pending','Paid']));
    if (needs.includes('fy'))         parts.push(make('fy', 'Financial Year', fySet, 'All FY'));
    if (needs.includes('dept'))       parts.push(make('dept', 'Department', depts));
    if (needs.includes('category'))   parts.push(make('category', 'Category', cats));
    if (needs.includes('ownhire'))    parts.push(make('ownhire', 'Own / Hire', ['Own','Hire']));
    if (needs.includes('period'))     parts.push(make('period', 'Period', ['Last 30 days','Last 60 days','Last 90 days','Last 180 days'], 'Last 90 days'));

    el.innerHTML = parts.length
      ? parts.join('')
      : `<span style="color:var(--txt3);font-size:.84rem">No filters — click "Run report" to load all data.</span>`;
  }


  // ── RUN ───────────────────────────────────────────────────────
  document.getElementById('rptRun').addEventListener('click', runReport);
  document.getElementById('rptDl').addEventListener('click', downloadResults);

  async function runReport() {
    if (!selectedId) return;
    const report = CATALOGUE.find(r => r.id === selectedId);
    if (!report) return;

    const results = document.getElementById('rptResults');
    results.innerHTML = `<div style="text-align:center;padding:2.4rem;color:var(--txt3)"><div style="font-size:1.6rem;margin-bottom:.4rem">⏳</div>Loading report…</div>`;
    document.getElementById('rptDl').style.display = 'none';

    const fv = (id) => document.getElementById('f-' + id)?.value || '';
    const filters = {
      site:     fv('site'),
      vendor:   fv('vendor'),
      stMRS:    fv('status_mrs'),
      stPO:     fv('status_po'),
      stINV:    fv('status_inv'),
      fy:       fv('fy'),
      dept:     fv('dept'),
      category: fv('category'),
      ownhire:  fv('ownhire'),
      period:   fv('period') || 'Last 90 days',
    };

    try {
      switch (report.id) {
        case 'mrs_summary':          await runMrsSummary(filters); break;
        case 'po_tracker':           await runPoTracker(filters); break;
        case 'vendor_spend':         await runVendorSpend(filters); break;
        case 'stock_levels':         await runStockLevels(filters); break;
        case 'grn_register':         await runGrnRegister(filters); break;
        case 'emp_headcount':        await runEmpHeadcount(filters); break;
        case 'equipment_deployment': await runEquipment(filters); break;
        case 'onboarding_status':    await runOnboarding(filters); break;
        case 'vendor_invoice':       await runVendorInvoice(filters); break;
      }
      renderTable();
    } catch (err) {
      if (err && err.name === 'SheetError') {
        API.renderSheetError(err, 'errorSlot');
        results.innerHTML = `<div class="alert warn"><span class="alert-icon">⚠</span><div class="alert-body">Could not load this report. See diagnostic above.</div></div>`;
      } else {
        results.innerHTML = `<div class="alert danger"><span class="alert-icon">⚠</span><div class="alert-body">Error: ${escapeHtml(err && err.message || 'unknown')}</div></div>`;
      }
    }
  }

  /* ─── Individual report runners ─── */

  async function runMrsSummary(f) {
    const raw = await fetchSource('scm.mrs');
    // Dedupe + normalise
    const seen = new Set();
    let rows = raw.filter(r => {
      const n = (r['Request No'] || '').trim();
      if (!n || n.toLowerCase() === 'dummy' || seen.has(n)) return false;
      seen.add(n); return true;
    }).map(r => ({
      reqNo:  r['Request No'] || '',
      site:   r['Requested For (site)'] || r['Site'] || r['F'] || '',
      part:   r['Part Details'] || r['G'] || '',
      status: (r['MR Approval Status'] || r['N'] || '').trim() || 'Pending',
      ts:     r['Timestamp'] || r['Y'] || '',
      fyKey:  getFYKey(parseAnyDate(r['Timestamp'] || r['Y'] || '')),
    }));
    if (f.site)  rows = rows.filter(r => r.site === f.site);
    if (f.stMRS) rows = rows.filter(r => (r.status || 'Pending') === f.stMRS);
    if (f.fy)    rows = rows.filter(r => r.fyKey === f.fy);
    resultRows = rows.map(r => ({
      'Request No': r.reqNo, 'Site': r.site, 'Part Details': r.part,
      'Status': r.status, 'Raised On': fmtDate(r.ts),
    }));
    resultCols = ['Request No','Site','Part Details','Status','Raised On'];
  }

  async function runPoTracker(f) {
    const raw = await fetchSource('scm.po');
    let rows = raw.filter(r => {
      const p = (r['PO No'] || '').trim();
      const v = (r['Vendor Name'] || '').trim().toLowerCase();
      return p && p.toLowerCase() !== 'dummy' && v !== 'dummy';
    }).map(r => ({
      uuid: r['UUID'] || '',
      poNo: r['PO No'] || '',
      poDate: r['PO Date'] || '',
      vendor: r['Vendor Name'] || '',
      site: r['Site Name'] || '',
      preparedBy: r['Prepared By'] || '',
      approver: r['Approver Name'] || '',
      status: (r['PO Approval Status'] || '').trim(),
      lock: (r['Lock'] || '').trim(),
      amount: parseFloat((r['Net Amount']||'0').toString().replace(/,/g,'')) || 0,
      fyKey: getFYKey(parseAnyDate(r['PO Date'] || '')),
    }));
    if (f.site)   rows = rows.filter(r => r.site === f.site);
    if (f.vendor) rows = rows.filter(r => r.vendor.toLowerCase().includes(f.vendor.toLowerCase()));
    if (f.fy)     rows = rows.filter(r => r.fyKey === f.fy);
    if (f.stPO === 'Pending Approval') rows = rows.filter(r => r.status.toUpperCase() !== 'REJECTED' && r.lock === 'Released for Approval');
    if (f.stPO === 'Approved')         rows = rows.filter(r => r.status.toUpperCase().includes('APPROVED'));
    if (f.stPO === 'Rejected')         rows = rows.filter(r => r.status.toUpperCase().includes('REJECT'));
    resultRows = rows.map(r => ({
      'PO No': r.poNo, 'PO Date': fmtDate(r.poDate), 'Vendor': r.vendor, 'Site': r.site,
      'Amount': r.amount, 'Status': r.status || 'Pending', 'Approver': r.approver, 'Prepared By': r.preparedBy,
    }));
    resultCols = ['PO No','PO Date','Vendor','Site','Amount','Status','Approver','Prepared By'];
  }

  async function runVendorSpend(f) {
    const raw = await fetchSource('scm.po');
    let rows = raw.filter(r => {
      const p = (r['PO No'] || '').trim();
      return p && p.toLowerCase() !== 'dummy';
    }).map(r => ({
      vendor: r['Vendor Name'] || '—',
      site:   r['Site Name'] || '',
      status: (r['PO Approval Status'] || '').trim(),
      amount: parseFloat((r['Net Amount']||'0').toString().replace(/,/g,'')) || 0,
      fyKey:  getFYKey(parseAnyDate(r['PO Date'] || '')),
    }));
    if (f.site) rows = rows.filter(r => r.site === f.site);
    if (f.fy)   rows = rows.filter(r => r.fyKey === f.fy);
    const byV = {};
    rows.forEach(r => {
      if (!byV[r.vendor]) byV[r.vendor] = { 'Vendor':r.vendor, 'PO Count':0, 'Total Amount':0, 'Approved Amount':0, 'Pending Amount':0 };
      byV[r.vendor]['PO Count']++;
      byV[r.vendor]['Total Amount'] += r.amount;
      if (r.status.toUpperCase().includes('APPROVED')) byV[r.vendor]['Approved Amount'] += r.amount;
      if (r.status.toUpperCase() !== 'REJECTED' && !r.status.toUpperCase().includes('APPROVED')) byV[r.vendor]['Pending Amount'] += r.amount;
    });
    resultRows = Object.values(byV).sort((a,b) => b['Total Amount'] - a['Total Amount']);
    resultCols = ['Vendor','PO Count','Total Amount','Approved Amount','Pending Amount'];
  }

  async function runStockLevels(f) {
    const raw = await fetchSource('reports.stockLevels');
    let rows = raw.filter(r => (r['SNo'] || r['Site & Code'] || '').toString().trim() !== '');
    if (f.site) rows = rows.filter(r => (r['Site Name']||'').trim() === f.site);
    resultRows = rows.map(r => ({
      'SNo': r['SNo'] || '',
      'Site': r['Site Name'] || '',
      'Part Details': r['Part Details'] || r['Site & Code'] || '',
      'Stock IN': r['StockIN'] || '0',
      'Stock Transfer': r['Stock Transfer (To)'] || '0',
      'Stock Out': r['Stock Out'] || '0',
      'Site Stock': r['Site Stock'] || '0',
    }));
    resultCols = ['SNo','Site','Part Details','Stock IN','Stock Transfer','Stock Out','Site Stock'];
  }

  async function runGrnRegister(f) {
    const [si, grn] = await Promise.all([fetchSource('reports.stockIn'), fetchSource('reports.grnNo')]);
    const gMap = {};
    grn.forEach(r => {
      const u = (r['UUID'] || '').trim();
      if (u) gMap[u] = { grnNo: r['GRN No (Goods Receipt)'] || '', receivedOn: r['Received On (At)'] || '' };
    });
    let rows = si.map(r => {
      const cs = (r['CheckSum'] || r['UUID'] || '').trim();
      const g  = gMap[cs] || {};
      return {
        siId: r['SI ID'] || '',
        site: r['Site Name'] || r['D'] || '',
        poNo: r['PO No'] || r['F'] || '',
        vendor: r['Vendor Name'] || r['G'] || '',
        invNo: r['Invoice No / ST No'] || r['H'] || '',
        partDesc: r['Part Description'] || r['N'] || '',
        mrQty: r['MR Qty'] || r['O'] || '',
        invQty: r['Invoice Qty'] || r['P'] || '',
        grnQty: r['GRN Qty'] || r['Q'] || '',
        grnNo: g.grnNo || '',
        receivedOn: g.receivedOn || r['Received On (At)'] || '',
      };
    });
    if (f.site)   rows = rows.filter(r => r.site === f.site);
    if (f.vendor) rows = rows.filter(r => (r.vendor||'').toLowerCase().includes(f.vendor.toLowerCase()));
    resultRows = rows.map(r => ({
      'GRN No': r.grnNo || 'Pending', 'SI ID': r.siId, 'Site': r.site, 'PO No': r.poNo,
      'Vendor': r.vendor, 'Invoice/ST No': r.invNo, 'Part': r.partDesc,
      'MR Qty': r.mrQty, 'Invoice Qty': r.invQty, 'GRN Qty': r.grnQty,
      'Received On': fmtDate(r.receivedOn),
    }));
    resultCols = ['GRN No','SI ID','Site','PO No','Vendor','Invoice/ST No','Part','MR Qty','Invoice Qty','GRN Qty','Received On'];
  }

  async function runEmpHeadcount(f) {
    if (masters.employees === null) await loadMaster('hr.employees', 'employees', normEmployee);
    let rows = (masters.employees || []).filter(u => u.status === 'ACTIVE');
    if (f.site) rows = rows.filter(u => u.site === f.site);
    if (f.dept) rows = rows.filter(u => u.dept === f.dept);
    resultRows = rows.map(u => ({
      'Emp Code': u.empCode, 'Name': u.name, 'Designation': u.desig,
      'Department': u.dept, 'Site': u.site, 'Type': u.empType,
      'Grade': u.grade, 'DOJ': fmtDate(u.doj),
    }));
    resultCols = ['Emp Code','Name','Designation','Department','Site','Type','Grade','DOJ'];
  }

  async function runEquipment(f) {
    if (masters.assets === null) await loadMaster('siteops.assets', 'assets', r => ({
      name:r['Asset Name']||r['Name']||'', code:r['Asset Code']||r['Code']||'',
      category:r['Category']||r['Type']||'', site:r['Site Name']||r['Site']||'',
      ownHire:(r['Own/Hire']||r['Ownership']||'').toString(), status:(r['Status']||'').toUpperCase()||'ACTIVE',
    }));
    let rows = masters.assets || [];
    if (f.site)     rows = rows.filter(a => a.site === f.site);
    if (f.category) rows = rows.filter(a => a.category === f.category);
    if (f.ownhire)  rows = rows.filter(a => (a.ownHire||'').toLowerCase() === f.ownhire.toLowerCase());
    resultRows = rows.map(a => ({
      'Asset Name': a.name, 'Asset Code': a.code, 'Category': a.category,
      'Site': a.site, 'Own/Hire': a.ownHire, 'Status': a.status,
    }));
    resultCols = ['Asset Name','Asset Code','Category','Site','Own/Hire','Status'];
  }

  async function runOnboarding(f) {
    if (masters.employees === null) await loadMaster('hr.employees', 'employees', normEmployee);
    const days = parseInt((f.period || '90').match(/\d+/)?.[0] || '90');
    const today = new Date(); today.setHours(0,0,0,0);
    let rows = (masters.employees || []).filter(u => {
      if (u.status !== 'ACTIVE') return false;
      const doj = parseAnyDate(u.doj || '');
      return doj && (today - doj) <= days * 86400000;
    });
    if (f.site) rows = rows.filter(u => u.site === f.site);
    resultRows = rows.map(u => {
      const doj = parseAnyDate(u.doj || '');
      const daysIn = doj ? Math.floor((today - doj) / 86400000) : null;
      return {
        'Emp Code': u.empCode, 'Name': u.name, 'Site': u.site, 'Dept': u.dept,
        'DOJ': fmtDate(u.doj), 'Days Since Joining': daysIn != null ? daysIn : '',
      };
    });
    resultCols = ['Emp Code','Name','Site','Dept','DOJ','Days Since Joining'];
  }

  async function runVendorInvoice(f) {
    const raw = await fetchSource('reports.invoice');
    let rows = raw.filter(r => (r['Invoice No'] || r['B'] || '').toString().trim() !== '');
    if (f.vendor) rows = rows.filter(r => (r['Vendor Name']||r['G']||'').toLowerCase().includes(f.vendor.toLowerCase()));
    if (f.stINV)  rows = rows.filter(r => (r['Payment Status']||r['I']||'').toLowerCase() === f.stINV.toLowerCase());
    resultRows = rows.map(r => ({
      'Invoice No':    r['Invoice No']    || r['B'] || '',
      'Invoice Date':  r['Invoice Date']  || r['C'] || '',
      'PO No':         r['PO No']         || r['D'] || '',
      'Vendor':        r['Vendor Name']   || r['G'] || '',
      'Invoice Amount':r['Invoice Amount']|| r['H'] || '',
      'Payment Status':r['Payment Status']|| r['I'] || '',
    }));
    resultCols = ['Invoice No','Invoice Date','PO No','Vendor','Invoice Amount','Payment Status'];
  }


  /* ─── Render result table ─── */
  function renderTable() {
    const results = document.getElementById('rptResults');
    const badge = document.getElementById('rptResultBadge');
    const dl = document.getElementById('rptDl');
    const n = resultRows.length;
    badge.textContent = `${n} record${n === 1 ? '' : 's'}`;
    badge.style.display = '';
    dl.style.display = n > 0 ? '' : 'none';

    if (!n) {
      results.innerHTML = `<div style="text-align:center;padding:2.4rem;color:var(--txt3);background:var(--surface2);border-radius:var(--rad)">
        <div style="font-size:1.6rem;margin-bottom:.5rem">🔍</div>
        <div style="font-weight:600">No records found</div>
        <div style="font-size:.82rem;margin-top:.3rem">Try adjusting your filters</div>
      </div>`;
      return;
    }

    const fmtCell = (col, val) => {
      if (val == null || val === '') return '—';
      if (col === 'Amount' || col.includes('Amount')) {
        const n = parseFloat(val);
        return isNaN(n) ? val : fmtAmt(n);
      }
      return val;
    };

    results.innerHTML = `
      <div class="card">
        <div class="card-body" style="padding:0;overflow-x:auto;max-height:560px;overflow-y:auto">
          <table class="tbl">
            <thead><tr>${resultCols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
            <tbody>${resultRows.slice(0, 500).map(row => `
              <tr>${resultCols.map(c => `<td style="font-size:.8rem;white-space:nowrap">${escapeHtml(String(fmtCell(c, row[c])))}</td>`).join('')}</tr>
            `).join('')}</tbody>
            ${resultRows.length > 500 ? `<tfoot><tr><td colspan="${resultCols.length}" style="text-align:center;color:var(--txt3);padding:.6rem;font-size:.78rem">Showing first 500 of ${resultRows.length} — download CSV for full set</td></tr></tfoot>` : ''}
          </table>
        </div>
      </div>`;
  }

  function downloadResults() {
    if (!resultRows.length) return;
    const r = CATALOGUE.find(x => x.id === selectedId);
    downloadCSV(resultRows, `${r?.id || 'report'}_${new Date().toISOString().slice(0,10)}.csv`);
  }


  /* ─── Helpers ─── */

  // Lazy-loader for masters used by filters
  function loadMaster(bindingName, key, mapper) {
    return API.fetchByBinding(bindingName).then(rows => {
      masters[key] = rows.map(mapper).filter(Boolean);
    }).catch(err => {
      console.warn(`Could not load master ${bindingName}:`, err);
      masters[key] = []; // mark loaded but empty so we don't retry
    });
  }
  function normEmployee(r) {
    return {
      empCode: r['Emp Code'] || r['Employee Code'] || '',
      name:    r['Full Name'] || r['Name'] || '',
      desig:   r['Designation'] || '',
      dept:    r['Department'] || '',
      site:    r['Site'] || r['Site Name'] || '',
      empType: r['Employee Type'] || r['Type'] || '',
      grade:   r['Grade'] || '',
      doj:     r['DOJ'] || r['Date of Joining'] || '',
      status:  (r['Status'] || '').toUpperCase() || 'ACTIVE',
    };
  }

  // Source data cache — reuse across runs of the same session
  function fetchSource(bindingName) {
    if (sourceCache[bindingName]) return Promise.resolve(sourceCache[bindingName]);
    return API.fetchByBinding(bindingName).then(rows => {
      sourceCache[bindingName] = rows;
      return rows;
    });
  }

  function parseAnyDate(v) {
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
  function fmtDate(v) {
    const d = parseAnyDate(v);
    return d ? d.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'}) : '—';
  }
  function fmtAmt(n) {
    if (!n && n !== 0) return '—';
    if (n >= 10000000) return '₹' + (n/10000000).toFixed(1) + 'Cr';
    if (n >= 100000)   return '₹' + (n/100000).toFixed(1) + 'L';
    return '₹' + Math.round(n).toLocaleString('en-IN');
  }
  function getFYKey(date) {
    if (!date) return null;
    const yr = date.getFullYear(), mo = date.getMonth();
    const fyStart = mo >= 3 ? yr : yr - 1;
    return `${String(fyStart).slice(-2)}-${String(fyStart+1).slice(-2)}`;
  }
  function getFYSet(past, future) {
    past = past != null ? past : 3;
    future = future != null ? future : 1;
    const now = new Date();
    const cur = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const list = [];
    for (let i = future; i >= -past; i--) {
      const s = cur + i;
      list.push(`${String(s).slice(-2)}-${String(s+1).slice(-2)}`);
    }
    return list;
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
})();
