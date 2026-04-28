/* ═══════════════════════════════════════════════════════════════════
   EVGCPL Portal — SCM Dashboard Module
   /assets/js/modules/scm.js

   Live PO dashboard. Reads scm.po binding, computes KPIs, pending
   table with age-flagged POs, monthly trend chart per FY, top-5
   vendor and per-site spend breakdowns. All sortable. CSV export
   for any filtered slice.
   ═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  Shell.mount('scm');

  // ── Page head ─────────────────────────────────────────────────
  document.getElementById('pageHead').innerHTML = Shell.pageHead({
    crumbs: [{ label:'Home', href:'dashboard.html' }, { label:'Procurement' }, { label:'SCM Dashboard' }],
    title:  'SCM Dashboard',
    sub:    'Live PO tracker · approvals · spend analytics',
    actions:`<button class="btn btn-secondary btn-sm" onclick="location.reload()">↻ Refresh</button>`,
  });

  const APPSHEET_BASE = 'https://www.appsheet.com/start/06fd0117-1dd8-445b-aaee-e2ff6e68e36f';

  // ── State ─────────────────────────────────────────────────────
  let allPOs = [];
  let pendingPOs = [];
  let siteData = [];
  let vendorData = [];
  let monthData = [];
  let selectedFY = currentFYKey();
  const sort = {
    pending: { col: 'ageDays', dir: -1 },
    site:    { col: 'amount',  dir: -1 },
    vendor:  { col: 'amount',  dir: -1 },
    all:     { col: 'jsDate',  dir: -1 },
  };

  // ── Render KPI shells with values ─────────────────────────────
  function renderKpis(total, pending, approved, rejected) {
    const grid = document.getElementById('scmKpis');
    grid.innerHTML = `
      <div class="kpi clickable" data-jump="all">
        <div class="kpi-top"><div class="kpi-icon green">📋</div><span class="kpi-status live"><span class="pulse"></span>Live</span></div>
        <div class="kpi-val">${total}</div>
        <div class="kpi-label">Total POs</div>
      </div>
      <div class="kpi clickable" data-jump="pending">
        <div class="kpi-top"><div class="kpi-icon orange">⏳</div><span class="kpi-status warn">${pending} pending</span></div>
        <div class="kpi-val">${pending}</div>
        <div class="kpi-label">Pending approval</div>
      </div>
      <div class="kpi clickable" data-jump="approved">
        <div class="kpi-top"><div class="kpi-icon blue">✅</div></div>
        <div class="kpi-val">${approved}</div>
        <div class="kpi-label">Approved</div>
      </div>
      <div class="kpi clickable" data-jump="rejected">
        <div class="kpi-top"><div class="kpi-icon red">✕</div></div>
        <div class="kpi-val">${rejected}</div>
        <div class="kpi-label">Rejected</div>
      </div>`;
    grid.querySelectorAll('[data-jump]').forEach(el => {
      el.addEventListener('click', () => jumpTo(el.dataset.jump));
    });
  }

  // ── Load PO data ──────────────────────────────────────────────
  API.fetchByBinding('scm.po')
    .then(rows => {
      const today = new Date(); today.setHours(0,0,0,0);
      allPOs = rows.filter(r => {
        const poNo = (r['PO No'] || '').trim();
        const vendor = (r['Vendor Name'] || '').trim().toLowerCase();
        return poNo && poNo.toLowerCase() !== 'dummy' && vendor !== 'dummy';
      }).map(r => {
        const dateRaw = r['PO Date'] || '';
        const jsDate = parsePODate(dateRaw);
        return {
          uuid:    r['UUID'] || '',
          poNo:    r['PO No'] || '',
          poDate:  dateRaw,
          jsDate,
          ageDays: jsDate ? Math.floor((today - jsDate) / 86400000) : null,
          monthKey:   jsDate ? `${jsDate.getFullYear()}-${String(jsDate.getMonth()+1).padStart(2,'0')}` : null,
          monthLabel: jsDate ? jsDate.toLocaleDateString('en-IN', {month:'short', year:'2-digit'}) : '—',
          fyKey:   jsDate ? getFYKey(jsDate) : null,
          vendor:  r['Vendor Name'] || '—',
          site:    r['Site Name'] || '—',
          preparedBy: r['Prepared By'] || '—',
          approver: r['Approver Name'] || '—',
          status:  (r['PO Approval Status'] || '').trim(),
          lock:    (r['Lock'] || '').trim(),
          amount:  parseFloat((r['Net Amount'] || '0').toString().replace(/,/g, '')) || 0,
          quote:   r['Quote(Attachment)'] || '',
        };
      });

      // KPIs
      const total    = allPOs.length;
      const pending  = allPOs.filter(r => r.status.toUpperCase() !== 'REJECTED' && r.lock === 'Released for Approval').length;
      const approved = allPOs.filter(r => r.status.toUpperCase().includes('APPROVED')).length;
      const rejected = allPOs.filter(r => r.status.toUpperCase().includes('REJECT')).length;
      renderKpis(total, pending, approved, rejected);

      pendingPOs = allPOs.filter(r => r.status.toUpperCase() !== 'REJECTED' && r.lock === 'Released for Approval');
      const overdue = pendingPOs.filter(r => r.ageDays != null && r.ageDays > 7).length;
      const ob = document.getElementById('scmOverdueBadge');
      if (overdue > 0) {
        ob.style.display = 'inline-flex';
        ob.textContent = `🔴 ${overdue} overdue >7 days`;
      }
      document.getElementById('scmPendingBadge').textContent = `${pendingPOs.length} awaiting`;

      // Site aggregation
      const siteMap = {};
      allPOs.forEach(r => {
        const k = r.site;
        if (!siteMap[k]) siteMap[k] = { site:k, count:0, amount:0 };
        siteMap[k].count++; siteMap[k].amount += r.amount;
      });
      siteData = Object.values(siteMap);

      // Vendor aggregation — top 5 by amount
      const vendorMap = {};
      allPOs.forEach(r => {
        const k = r.vendor;
        if (!vendorMap[k]) vendorMap[k] = { vendor:k, count:0, amount:0 };
        vendorMap[k].count++; vendorMap[k].amount += r.amount;
      });
      vendorData = Object.values(vendorMap).sort((a,b)=>b.amount-a.amount).slice(0,5);

      // Monthly aggregation
      const monthMap = {};
      allPOs.forEach(r => {
        if (!r.monthKey) return;
        if (!monthMap[r.monthKey]) monthMap[r.monthKey] = { key:r.monthKey, label:r.monthLabel, fyKey:r.fyKey, count:0, amount:0 };
        monthMap[r.monthKey].count++; monthMap[r.monthKey].amount += r.amount;
      });
      monthData = Object.values(monthMap).sort((a,b)=>a.key.localeCompare(b.key));

      // FY dropdown
      const fySet = [...new Set(monthData.map(m => m.fyKey).filter(Boolean))].sort().reverse();
      selectedFY = fySet.includes(currentFYKey()) ? currentFYKey() : (fySet[0] || currentFYKey());
      const fySel = document.getElementById('scmFySelect');
      fySel.innerHTML = fySet.map(fy => `<option value="${fy}" ${fy===selectedFY?'selected':''}>FY ${fy}</option>`).join('');
      fySel.addEventListener('change', () => { selectedFY = fySel.value; renderMonthChart(); });

      // All-FY dropdown for the deep-link section
      const allFySel = document.getElementById('scmAllFy');
      allFySel.innerHTML = '<option value="">All FY</option>' + fySet.map(fy => `<option value="${fy}">${fy}</option>`).join('');

      renderPendingTable();
      renderSiteTable();
      renderVendorTable();
      renderMonthChart();
    })
    .catch(err => {
      // Show inline error with sharing-doctor cross-link
      if (err && err.name === 'SheetError') {
        API.renderSheetError(err, 'errorSlot');
      } else {
        document.getElementById('errorSlot').innerHTML =
          `<div class="alert danger"><div class="alert-icon">⚠</div><div class="alert-body">Could not load PO data: ${escapeHtml(err && err.message || 'unknown error')}</div></div>`;
      }
      document.getElementById('scmKpis').innerHTML = '';
      document.getElementById('scmPendingTable').innerHTML = `<div style="padding:2rem;text-align:center;color:var(--txt3);font-size:.85rem">Could not load POs.</div>`;
    });

  // ── Wire CSV + close buttons ──────────────────────────────────
  document.getElementById('scmPendingCsv').addEventListener('click', () => downloadFiltered('pending'));
  document.getElementById('scmAllCsv').addEventListener('click', () => downloadFiltered(currentAllFilter()));
  document.getElementById('scmAllClose').addEventListener('click', () => {
    document.getElementById('scmAllSection').style.display = 'none';
  });
  document.getElementById('scmAllSearch').addEventListener('input', renderAllTable);
  document.getElementById('scmAllFy').addEventListener('change', renderAllTable);


  /* ─────────── PENDING TABLE ─────────── */
  function renderPendingTable() {
    const el = document.getElementById('scmPendingTable');
    if (pendingPOs.length === 0) {
      el.innerHTML = `<div style="padding:2.4rem;text-align:center;color:var(--txt3);font-size:.85rem">✓ No POs currently released for approval</div>`;
      return;
    }
    const sorted = [...pendingPOs].sort((a,b) => sortBy(a, b, sort.pending));
    const trs = sorted.map(r => `
      <tr>
        <td>
          <div style="font-weight:700;color:var(--g7);font-size:.84rem">${escapeHtml(r.poNo)}</div>
          <div style="font-size:.7rem;color:var(--txt3)">${fmtDate(r.poDate)}</div>
        </td>
        <td>${escapeHtml(r.vendor)}</td>
        <td>${escapeHtml(r.site)}</td>
        <td style="font-weight:700;color:var(--g8)">${fmtAmtFull(r.amount)}</td>
        <td>${ageBadge(r.ageDays)}</td>
        <td style="font-size:.78rem;color:var(--txt3)">${escapeHtml(r.approver)}</td>
        <td>
          <div style="display:flex;gap:.35rem;flex-wrap:wrap">
            <a class="btn btn-secondary btn-sm" href="${APPSHEET_BASE}?tblName=PO&rowKey=${encodeURIComponent(r.uuid)}" target="_blank" rel="noopener">📋 Open</a>
            ${r.quote ? `<a class="btn btn-secondary btn-sm" href="${escapeAttr(r.quote)}" target="_blank" rel="noopener">📎 Quote</a>` : ''}
          </div>
        </td>
      </tr>`).join('');
    el.innerHTML = `
      <table class="tbl" style="min-width:680px">
        <thead><tr>
          ${sortTh('PO No / Date','poNo','pending')}
          ${sortTh('Vendor','vendor','pending')}
          ${sortTh('Site','site','pending')}
          ${sortTh('Amount','amount','pending')}
          ${sortTh('Age','ageDays','pending')}
          ${sortTh('Approver','approver','pending')}
          <th>Actions</th>
        </tr></thead>
        <tbody>${trs}</tbody>
      </table>`;
    wireSortHeaders(el, 'pending', renderPendingTable);
  }

  /* ─────────── SITE TABLE ─────────── */
  function renderSiteTable() {
    const el = document.getElementById('scmSiteTable');
    const sorted = [...siteData].sort((a,b) => sortBy(a, b, sort.site));
    document.getElementById('scmSiteBadge').textContent = `${sorted.length} sites`;
    const totalAmt = sorted.reduce((s,r) => s+r.amount, 0);
    const maxAmt = Math.max(...sorted.map(r=>r.amount), 1);
    const trs = sorted.map(r => {
      const pct = Math.round((r.amount/maxAmt)*100);
      return `<tr>
        <td style="font-weight:600">${escapeHtml(r.site)}</td>
        <td style="text-align:center">${r.count}</td>
        <td style="font-weight:700;color:var(--g7)">${fmtAmt(r.amount)}</td>
        <td style="min-width:100px">
          <div style="background:var(--surface3);border-radius:99px;height:7px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:var(--g5);border-radius:99px"></div>
          </div>
        </td>
      </tr>`;
    }).join('');
    el.innerHTML = `
      <table class="tbl" style="min-width:360px">
        <thead><tr>
          ${sortTh('Site','site','site')}
          ${sortTh('POs','count','site')}
          ${sortTh('Amount','amount','site')}
          <th>Bar</th>
        </tr></thead>
        <tbody>${trs}</tbody>
        <tfoot><tr style="background:var(--surface2);font-weight:700">
          <td>TOTAL</td>
          <td style="text-align:center">${siteData.reduce((s,r)=>s+r.count,0)}</td>
          <td style="color:var(--g7)">${fmtAmt(totalAmt)}</td>
          <td></td>
        </tr></tfoot>
      </table>`;
    wireSortHeaders(el, 'site', renderSiteTable);
  }

  /* ─────────── VENDOR TABLE (TOP 5) ─────────── */
  function renderVendorTable() {
    const el = document.getElementById('scmVendorTable');
    const sorted = [...vendorData].sort((a,b) => sortBy(a, b, sort.vendor));
    document.getElementById('scmVendorBadge').textContent = `Top 5 of ${vendorData.length || '—'}`;
    const maxAmt = Math.max(...sorted.map(r=>r.amount), 1);
    const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
    const trs = sorted.map((r,i) => {
      const pct = Math.round((r.amount/maxAmt)*100);
      return `<tr>
        <td style="text-align:center">${medals[i]||(i+1)}</td>
        <td style="font-weight:600">${escapeHtml(r.vendor)}</td>
        <td style="text-align:center">${r.count}</td>
        <td style="font-weight:700;color:var(--g7)">${fmtAmt(r.amount)}</td>
        <td style="min-width:80px">
          <div style="background:var(--surface3);border-radius:99px;height:7px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:var(--gold);border-radius:99px"></div>
          </div>
        </td>
      </tr>`;
    }).join('');
    el.innerHTML = `
      <table class="tbl" style="min-width:340px">
        <thead><tr>
          <th>#</th>
          ${sortTh('Vendor','vendor','vendor')}
          ${sortTh('POs','count','vendor')}
          ${sortTh('Amount','amount','vendor')}
          <th>Bar</th>
        </tr></thead>
        <tbody>${trs}</tbody>
      </table>`;
    wireSortHeaders(el, 'vendor', renderVendorTable);
  }

  /* ─────────── MONTHLY TREND CHART ─────────── */
  function renderMonthChart() {
    const el = document.getElementById('scmMonthChart');
    const fy = selectedFY;
    const startYr = 2000 + parseInt(fy.split('-')[0]);
    const slots = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(startYr, 3 + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const label = d.toLocaleDateString('en-IN', {month:'short', year:'2-digit'});
      slots.push({ key, label, count:0, amount:0 });
    }
    monthData.filter(m => m.fyKey === fy).forEach(m => {
      const slot = slots.find(s => s.key === m.key);
      if (slot) { slot.count = m.count; slot.amount = m.amount; }
    });
    const maxAmt = Math.max(...slots.map(s => s.amount), 1);
    const fyTotal = slots.reduce((s,m) => s+m.amount, 0);
    const fyCount = slots.reduce((s,m) => s+m.count, 0);
    const currentMo = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
    document.getElementById('scmMonthBadge').textContent = `${fmtAmt(fyTotal)} · ${fyCount} POs`;

    if (fyTotal === 0) {
      el.innerHTML = `<div style="padding:2.4rem;text-align:center;color:var(--txt3);font-size:.85rem">No PO data for FY ${fy}</div>`;
      return;
    }

    const bars = slots.map(m => {
      const hPct = Math.round((m.amount / maxAmt) * 140);
      const isCurr = m.key === currentMo;
      const isEmpty = m.amount === 0;
      const barCol = isCurr ? 'var(--gold)' : 'var(--g6)';
      return `
        <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:42px;max-width:78px">
          <div style="font-size:.66rem;font-weight:700;color:${isEmpty?'var(--txt4)':'var(--g7)'}">${isEmpty ? '—' : fmtAmt(m.amount)}</div>
          <div style="width:100%;display:flex;align-items:flex-end;height:140px">
            ${hPct > 0 ? `
              <div style="width:100%;background:${barCol};border-radius:6px 6px 0 0;height:${hPct}px;position:relative" title="${m.label}: ${fmtAmtFull(m.amount)} · ${m.count} POs">
                <div style="position:absolute;bottom:-18px;left:50%;transform:translateX(-50%);background:${isCurr?'var(--gold)':'var(--g7)'};color:#fff;font-size:.6rem;font-weight:700;padding:1px 5px;border-radius:99px;white-space:nowrap">${m.count}</div>
              </div>
            ` : `<div style="width:100%;height:4px;background:var(--surface3);border-radius:4px;align-self:flex-end"></div>`}
          </div>
          <div style="margin-top:18px;font-size:.7rem;font-weight:${isCurr?'700':'500'};color:${isCurr?'var(--g7)':'var(--txt2)'};white-space:nowrap">${m.label}</div>
        </div>`;
    }).join('');

    el.innerHTML = `<div style="display:flex;align-items:flex-end;gap:6px;padding:.4rem 0 1rem;overflow-x:auto">${bars}</div>`;
  }

  /* ─────────── ALL POs DEEP LINK ─────────── */
  function jumpTo(filter) {
    const sec = document.getElementById('scmAllSection');
    sec.style.display = '';
    sec.dataset.filter = filter;
    document.getElementById('scmAllTitle').textContent =
      ({ all:'📋 All POs', pending:'⏳ Pending POs', approved:'✅ Approved POs', rejected:'✕ Rejected POs' })[filter] || '📋 All POs';
    renderAllTable();
    sec.scrollIntoView({ behavior:'smooth', block:'start' });
  }
  function currentAllFilter() {
    return document.getElementById('scmAllSection').dataset.filter || 'all';
  }
  function renderAllTable() {
    const el = document.getElementById('scmAllTable');
    if (!el || !allPOs.length) return;
    const filter = currentAllFilter();
    const q = (document.getElementById('scmAllSearch').value || '').toLowerCase();
    const fy = document.getElementById('scmAllFy').value || '';
    let rows = allPOs;
    if (filter === 'pending')  rows = rows.filter(r => r.status.toUpperCase() !== 'REJECTED' && r.lock === 'Released for Approval');
    else if (filter === 'approved') rows = rows.filter(r => r.status.toUpperCase().includes('APPROVED'));
    else if (filter === 'rejected') rows = rows.filter(r => r.status.toUpperCase().includes('REJECT'));
    if (fy) rows = rows.filter(r => r.fyKey === fy);
    if (q)  rows = rows.filter(r => r.poNo.toLowerCase().includes(q) || r.vendor.toLowerCase().includes(q) || r.site.toLowerCase().includes(q));

    document.getElementById('scmAllBadge').textContent = `${rows.length} rows`;
    if (!rows.length) {
      el.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--txt3);font-size:.85rem">No matching POs</div>`;
      return;
    }
    const sorted = rows.sort((a,b) => sortBy(a, b, sort.all));
    el.innerHTML = `
      <table class="tbl" style="min-width:780px">
        <thead><tr>
          <th>PO No</th><th>Date</th><th>Vendor</th><th>Site</th>
          <th>Amount</th><th>Status</th><th>Age</th><th>Approver</th>
        </tr></thead>
        <tbody>${sorted.map(r => `<tr>
          <td><a href="${APPSHEET_BASE}?tblName=PO&rowKey=${encodeURIComponent(r.uuid)}" target="_blank" rel="noopener" style="color:var(--g7);font-weight:700">${escapeHtml(r.poNo)}</a></td>
          <td>${fmtDate(r.poDate)}</td>
          <td>${escapeHtml(r.vendor)}</td>
          <td>${escapeHtml(r.site)}</td>
          <td style="font-weight:700">${fmtAmtFull(r.amount)}</td>
          <td>${statusBadge(r.status)}</td>
          <td>${ageBadge(r.ageDays)}</td>
          <td style="font-size:.78rem;color:var(--txt3)">${escapeHtml(r.approver)}</td>
        </tr>`).join('')}</tbody>
      </table>`;
  }
  function downloadFiltered(filter) {
    let rows = allPOs;
    if (filter === 'pending')  rows = rows.filter(r => r.status.toUpperCase() !== 'REJECTED' && r.lock === 'Released for Approval');
    else if (filter === 'approved') rows = rows.filter(r => r.status.toUpperCase().includes('APPROVED'));
    else if (filter === 'rejected') rows = rows.filter(r => r.status.toUpperCase().includes('REJECT'));
    const csv = rows.map(r => ({
      'PO No': r.poNo, 'PO Date': fmtDate(r.poDate), 'Vendor': r.vendor, 'Site': r.site,
      'Amount': r.amount, 'Status': r.status, 'Age (Days)': r.ageDays != null ? r.ageDays : '', 'Approver': r.approver
    }));
    downloadCSV(csv, `POs_${filter}_${new Date().toISOString().slice(0,10)}.csv`);
  }


  /* ─────────── HELPERS ─────────── */
  function sortBy(a, b, state) {
    const va = a[state.col] != null ? a[state.col] : '';
    const vb = b[state.col] != null ? b[state.col] : '';
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * state.dir;
    return String(va).localeCompare(String(vb)) * state.dir;
  }
  function sortTh(label, col, key) {
    const s = sort[key];
    const arrow = s.col === col ? (s.dir === 1 ? ' ▲' : ' ▼') : ' ↕';
    return `<th data-col="${col}" data-key="${key}" style="cursor:pointer;user-select:none;white-space:nowrap">${escapeHtml(label)}<span style="opacity:.45;font-size:.66rem"> ${arrow}</span></th>`;
  }
  function wireSortHeaders(scope, key, rerender) {
    scope.querySelectorAll(`th[data-key="${key}"]`).forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (sort[key].col === col) sort[key].dir *= -1;
        else { sort[key].col = col; sort[key].dir = -1; }
        rerender();
      });
    });
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
  function fmtDate(v) {
    const d = parsePODate(v);
    return d ? d.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'}) : '—';
  }
  function fmtAmt(n) {
    if (!n) return '—';
    if (n >= 10000000) return '₹' + (n/10000000).toFixed(1) + 'Cr';
    if (n >= 100000)   return '₹' + (n/100000).toFixed(1) + 'L';
    return '₹' + Math.round(n).toLocaleString('en-IN');
  }
  function fmtAmtFull(n) {
    return n ? '₹' + Math.round(n).toLocaleString('en-IN') : '—';
  }
  function ageBadge(days) {
    if (days == null) return '—';
    if (days > 14) return `<span class="tag" style="background:rgba(220,38,38,.12);color:#b91c1c">${days}d</span>`;
    if (days > 7)  return `<span class="tag" style="background:rgba(251,140,0,.15);color:#bf6700">${days}d</span>`;
    return `<span class="tag">${days}d</span>`;
  }
  function statusBadge(status) {
    const s = (status || '').toUpperCase();
    if (s.includes('APPROVED')) return `<span class="tag" style="background:rgba(46,125,50,.12);color:#15803d">Approved</span>`;
    if (s.includes('REJECT'))   return `<span class="tag" style="background:rgba(220,38,38,.12);color:#b91c1c">Rejected</span>`;
    if (s) return `<span class="tag">${escapeHtml(status)}</span>`;
    return `<span class="tag">Pending</span>`;
  }
  function getFYKey(date) {
    if (!date) return null;
    const yr = date.getFullYear(), mo = date.getMonth();
    const fyStart = mo >= 3 ? yr : yr - 1;
    return `${String(fyStart).slice(-2)}-${String(fyStart+1).slice(-2)}`;
  }
  function currentFYKey() { return getFYKey(new Date()); }

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
    const url  = URL.createObjectURL(blob);
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
