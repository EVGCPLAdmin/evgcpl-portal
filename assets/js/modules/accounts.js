/* ═══════════════════════════════════════════════════════════════════
   EVGCPL Portal — Accounts & Payments Module
   /assets/js/modules/accounts.js

   Reads the 42-column PaymentRequest schema from the Payment sheet
   (binding: accounts.payments). Renders a status-classified KPI
   strip, multi-currency cards, status-pill filters, site/entity/
   process dropdowns, search, sortable table, CSV export, and
   AppSheet deep-link grid for row-level edits.

   The status classifier maps every known AppSheet status string
   into one of four buckets (pending/progress/rejected/completed)
   so the KPI counts and filter pills agree even when the underlying
   sheet has slight wording variations.
   ═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  Shell.mount('accounts');

  const APPSHEET_ACCOUNTS_URL = 'https://www.appsheet.com/start/fcdba849-9f9d-435f-8e8a-ea0c975dbd21';

  document.getElementById('pageHead').innerHTML = Shell.pageHead({
    crumbs: [{ label:'Home', href:'dashboard.html' }, { label:'Finance' }, { label:'Accounts & Payments' }],
    title:  '💰 Accounts & Payments',
    sub:    'Payment requests · status tracking · UTR confirmation',
    actions:`
      <button class="btn btn-secondary btn-sm" onclick="location.reload()">↻ Refresh</button>
      <a class="btn btn-primary btn-sm" href="${APPSHEET_ACCOUNTS_URL}" target="_blank" rel="noopener">📱 Open in AppSheet</a>
    `,
  });

  // ── Status classification map ────────────────────────────────
  // Keys are normalised: lowercased, single-spaced. The classifier
  // matches against both AK (Status) and AG (AccountsStatus).
  const STATUS_MAP = {
    // Progress (blue)
    'verified , move to md queue':            { cat:'progress',  icon:'🔄',  label:'Verified, move to MD queue', color:'#2563eb', bg:'#eff6ff' },
    'verified, move to md queue':             { cat:'progress',  icon:'🔄',  label:'Verified, move to MD queue', color:'#2563eb', bg:'#eff6ff' },
    'process payment , move to accounts':     { cat:'progress',  icon:'🔄',  label:'Payment approved by MD',     color:'#2563eb', bg:'#eff6ff' },
    'process payment, move to accounts':      { cat:'progress',  icon:'🔄',  label:'Payment approved by MD',     color:'#2563eb', bg:'#eff6ff' },
    'payment approved by md':                 { cat:'progress',  icon:'🔄',  label:'Payment approved by MD',     color:'#2563eb', bg:'#eff6ff' },
    'payment initiated':                      { cat:'progress',  icon:'▶',   label:'Payment initiated',          color:'#2563eb', bg:'#eff6ff' },
    'payment re-initiated':                   { cat:'progress',  icon:'▶',   label:'Payment re-initiated',       color:'#2563eb', bg:'#eff6ff' },
    // Pending (amber)
    'hold payment (md)':                      { cat:'pending',   icon:'⏸',   label:'On hold by MD',              color:'#d97706', bg:'#fffbeb' },
    'payment on hold by md':                  { cat:'pending',   icon:'⏸',   label:'Payment on hold by MD',      color:'#d97706', bg:'#fffbeb' },
    'send back to accounts (md)':             { cat:'pending',   icon:'←',   label:'Sent back to accounts',      color:'#d97706', bg:'#fffbeb' },
    'send back to respective department (md)':{ cat:'pending',   icon:'←',   label:'Sent back to dept (MD)',     color:'#d97706', bg:'#fffbeb' },
    'pending due to queries':                 { cat:'pending',   icon:'❓',  label:'Pending — queries',           color:'#d97706', bg:'#fffbeb' },
    'pending with accounts':                  { cat:'pending',   icon:'⏳',  label:'Pending with accounts',      color:'#d97706', bg:'#fffbeb' },
    // Rejected (red)
    'reject payment (md)':                    { cat:'rejected',  icon:'✕',   label:'Rejected by MD',             color:'#dc2626', bg:'#fef2f2' },
    'reject payment (accounts)':              { cat:'rejected',  icon:'✕',   label:'Rejected by accounts',       color:'#dc2626', bg:'#fef2f2' },
    'request rejected by md':                 { cat:'rejected',  icon:'✕',   label:'Request rejected by MD',     color:'#dc2626', bg:'#fef2f2' },
    'request rejected by accounts':           { cat:'rejected',  icon:'✕',   label:'Request rejected by acc.',   color:'#dc2626', bg:'#fef2f2' },
    // Completed (green)
    'paid (md_ed)':                           { cat:'completed', icon:'✓',   label:'Paid (initiated in bank)',   color:'#16a34a', bg:'#f0fdf4' },
    'paid(md_ed)':                            { cat:'completed', icon:'✓',   label:'Paid (initiated in bank)',   color:'#16a34a', bg:'#f0fdf4' },
    'paid - md_ed':                           { cat:'completed', icon:'✓',   label:'Paid (initiated in bank)',   color:'#16a34a', bg:'#f0fdf4' },
    'paid (initiated in bank)':               { cat:'completed', icon:'✓',   label:'Paid (initiated in bank)',   color:'#16a34a', bg:'#f0fdf4' },
    'paid':                                   { cat:'completed', icon:'✓',   label:'Paid',                       color:'#16a34a', bg:'#f0fdf4' },
    'payment completed':                      { cat:'completed', icon:'✓',   label:'Paid, UTR available',        color:'#16a34a', bg:'#f0fdf4' },
    'payment complete':                       { cat:'completed', icon:'✓',   label:'Paid, UTR available',        color:'#16a34a', bg:'#f0fdf4' },
    'paid , utr details available':           { cat:'completed', icon:'✓',   label:'Paid, UTR available',        color:'#16a34a', bg:'#f0fdf4' },
    'paid, utr details available':            { cat:'completed', icon:'✓',   label:'Paid, UTR available',        color:'#16a34a', bg:'#f0fdf4' },
    'completed':                              { cat:'completed', icon:'✓',   label:'Completed',                  color:'#16a34a', bg:'#f0fdf4' },
  };

  function classifyStatus(raw) {
    const key = (raw || '').toLowerCase().trim().replace(/\s+/g, ' ');
    if (!key) return { cat:'other', icon:'', label:'—', color:'#9ca3af', bg:'transparent' };
    return STATUS_MAP[key] || { cat:'other', icon:'○', label: raw, color:'#6b7280', bg:'#f9fafb' };
  }

  // ── State ─────────────────────────────────────────────────────
  let allRows = [];
  let activeCat = 'all';
  let sortCol = 'date';
  let sortDir = -1;

  // ── Helpers ───────────────────────────────────────────────────
  // Strip "EG1415|" prefix from name strings
  const stripCode = s => s ? String(s).replace(/^[A-Z]+\d+\|/i, '').trim() : '';
  const normCurrency = s => {
    const m = { 'indian rupee':'INR','us dollar':'USD','usd':'USD','euro':'EUR','gbp':'GBP','aed':'AED','omr':'OMR','qar':'QAR' };
    return m[(s || '').toLowerCase().trim()] || (s || 'INR').toUpperCase().trim().slice(0, 5) || 'INR';
  };
  const numFromStr = s => parseFloat(String(s || '0').replace(/[^0-9.\-]/g, '')) || 0;


  // ── Render quick actions ─────────────────────────────────────
  document.getElementById('accQuickActions').innerHTML = [
    ['➕ New request',          APPSHEET_ACCOUNTS_URL + '#view=PaymentRequest_Form'],
    ['⏳ Pending approvals',    APPSHEET_ACCOUNTS_URL + '#view=Pending Approvals'],
    ['✓ Process payment',      APPSHEET_ACCOUNTS_URL + '#view=Process Payment'],
    ['📄 All requests',         APPSHEET_ACCOUNTS_URL],
    ['📈 Ledger view',          APPSHEET_ACCOUNTS_URL + '#view=Ledger'],
    ['🔗 Open full app',        APPSHEET_ACCOUNTS_URL],
  ].map(([label, url]) =>
    `<a class="quick-action" href="${url}" target="_blank" rel="noopener">${label}</a>`
  ).join('');


  // ── Load data ─────────────────────────────────────────────────
  API.fetchByBinding('accounts.payments').then(rawRows => {
    allRows = rawRows
      .filter(r => (r['Payment To'] || r['J'] || '').trim())
      .map(r => {
        const raw      = r['Status']           || r['AK'] || '';
        const acStatus = r['Accounts Status']  || r['AG'] || '';
        // Pick the more specific status — fall back to AccountsStatus if main is blank
        const st = classifyStatus(raw && raw !== '—' ? raw : acStatus);
        const initiator = stripCode(r['Name of the Intiator'] || r['Initiator'] || r['G'] || '');
        const currency  = normCurrency(r['Currency'] || r['Z'] || '');
        const amount    = numFromStr(r['Amount'] || r['AA']);

        return {
          uuid:        r['UUID']                  || r['A']  || '',
          manualAuto:  r['Manual / Auto']         || r['C']  || '',
          installment: r['Installment']           || r['D']  || '',
          requestId:   r['Request ID']            || r['E']  || '',
          date:        r['Date Of Request']       || r['F']  || '',
          initiator,
          nature:      r['NATURE OF EXPENSES']    || r['H']  || '',
          payTo:       r['Payment To']            || r['J']  || '',
          costCode:    r['CostCode']              || r['K']  || '',
          dept:        r['Department']            || r['L']  || '',
          process:     r['From Which Process']    || r['M']  || '',
          paidTo:      r['Paid To']               || r['N']  || '',
          site:        r['Site Name']             || r['O']  || '',
          company:     r['Company']               || r['P']  || '',
          orderNo:     r['Order No']              || r['Q']  || '',
          billNo:      r['Bill No']               || r['R']  || '',
          poValue:     numFromStr(r['PO Value']      || r['T']),
          invoiceVal:  numFromStr(r['Invoice Value'] || r['U']),
          paidVal:     numFromStr(r['Paid Value']    || r['V']),
          pendingVal:  numFromStr(r['Pending Value'] || r['W']),
          currency,
          amount,
          narrative:   r['Narrative/Comments']    || r['AB'] || '',
          accStatus:   acStatus,
          accDate:     r['Accounts Date']         || r['AH'] || '',
          utr:         r['UTR Details']           || r['AI'] || '',
          remarks:     r['Remarks']               || r['AJ'] || '',
          rawStatus:   raw || acStatus,
          status:      st,
          // searchable concatenation
          _s: [
            r['A'], r['E'], r['F'], initiator, r['J'], r['H'], r['L'], r['M'],
            r['O'], r['P'], r['Q'], r['R'], currency, String(amount), r['AB'],
            r['AH'], r['AI'], r['AJ'], raw, acStatus,
          ].join('|').toLowerCase(),
        };
      });

    renderKpis();
    renderCurrencyCards();
    populateFilters();
    render();

    // Log unmapped statuses so the operator can extend STATUS_MAP
    const others = [...new Set(allRows.filter(r => r.status.cat === 'other' && r.rawStatus).map(r => r.rawStatus))];
    if (others.length) {
      console.log('[Accounts] Unmapped status values — add to STATUS_MAP:', others);
    }
  }).catch(err => {
    document.getElementById('accTbody').innerHTML =
      `<tr><td colspan="21" style="text-align:center;padding:2.4rem;color:var(--txt3)">Could not load PaymentRequest. See diagnostic above.</td></tr>`;
    if (err && err.name === 'SheetError') API.renderSheetError(err, 'errorSlot');
    else document.getElementById('errorSlot').innerHTML =
      `<div class="alert danger"><span class="alert-icon">⚠</span><div class="alert-body">Could not load PaymentRequest: ${escapeHtml(err && err.message || 'unknown')}</div></div>`;
  });


  /* ─────────── KPI cards ─────────── */
  function renderKpis() {
    const buckets = ['pending','progress','rejected','completed'].map(cat => {
      const rows = allRows.filter(r => r.status.cat === cat);
      const total = rows.reduce((s, r) => s + r.amount, 0);
      return { cat, count: rows.length, total };
    });

    const cfg = {
      pending:   { icon:'⏳', cls:'orange', sub:'Needs action' },
      progress:  { icon:'🔄', cls:'blue',   sub:'In pipeline' },
      rejected:  { icon:'✕',  cls:'red',    sub:'Rejected' },
      completed: { icon:'✓',  cls:'green',  sub:'Done' },
    };

    document.getElementById('accKpis').innerHTML = buckets.map(b => `
      <div class="kpi clickable" data-cat="${b.cat}">
        <div class="kpi-top">
          <div class="kpi-icon ${cfg[b.cat].cls}">${cfg[b.cat].icon}</div>
          <span class="kpi-status ${b.cat==='completed' ? 'live' : b.cat==='rejected' ? 'error' : 'warn'}">${cfg[b.cat].sub}</span>
        </div>
        <div class="kpi-val">${b.count}</div>
        <div class="kpi-label">${cap(b.cat)}</div>
        <div style="font-size:.74rem;color:var(--txt3);margin-top:.2rem">${b.total ? '₹' + Math.round(b.total).toLocaleString('en-IN') : '—'}</div>
      </div>`).join('');

    document.querySelectorAll('#accKpis [data-cat]').forEach(el => {
      el.addEventListener('click', () => setCat(el.dataset.cat));
    });
  }

  function renderCurrencyCards() {
    const map = {};
    allRows.filter(r => r.status.cat !== 'other').forEach(r => {
      const c = r.currency || 'INR';
      if (!map[c]) map[c] = { count:0, total:0 };
      map[c].count++; map[c].total += r.amount;
    });
    const keys = Object.keys(map);
    if (keys.length <= 1 && keys[0] === 'INR') return;

    const el = document.getElementById('accCurrencyCards');
    el.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:.7rem;margin-bottom:1.2rem';
    el.innerHTML = keys.map(c => `
      <div class="kpi" style="border-left:3px solid var(--g5)">
        <div class="kpi-top"><div class="kpi-icon green">💱</div><span class="kpi-status live">${escapeHtml(c)}</span></div>
        <div class="kpi-val" style="font-size:1.3rem">${map[c].count}</div>
        <div class="kpi-label">${escapeHtml(c)} requests</div>
        <div style="font-size:.74rem;color:var(--txt3);margin-top:.2rem">${escapeHtml(c)} ${Math.round(map[c].total).toLocaleString('en-IN')}</div>
      </div>`).join('');
  }


  /* ─────────── Filters ─────────── */
  function populateFilters() {
    const fill = (id, vals) => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const seen = new Set();
      vals.filter(Boolean).forEach(v => {
        if (seen.has(v)) return;
        seen.add(v);
      });
      const opts = [...seen].sort();
      const cur = sel.value;
      sel.innerHTML = `<option value="">${sel.options[0]?.text || 'All'}</option>` +
        opts.map(o => `<option value="${escapeAttr(o)}">${escapeHtml(o)}</option>`).join('');
      sel.value = cur;
    };
    fill('accSiteFilter',    allRows.map(r => r.site));
    fill('accEntityFilter',  allRows.map(r => r.company));
    fill('accProcessFilter', allRows.map(r => r.process));
  }

  // Wire filter controls
  document.querySelectorAll('[data-cat]').forEach(btn => {
    if (btn.classList.contains('status-pill')) {
      btn.addEventListener('click', () => setCat(btn.dataset.cat));
    }
  });
  ['accSiteFilter','accEntityFilter','accProcessFilter'].forEach(id =>
    document.getElementById(id).addEventListener('change', render)
  );
  document.getElementById('accSearch').addEventListener('input', debounce(render, 100));
  document.getElementById('accSortCol').addEventListener('change', e => {
    sortCol = e.target.value;
    render();
  });
  document.getElementById('accSortDirBtn').addEventListener('click', () => {
    sortDir = -sortDir;
    document.getElementById('accSortDirBtn').textContent = sortDir === -1 ? '↓ Desc' : '↑ Asc';
    render();
  });
  document.getElementById('accReset').addEventListener('click', () => {
    activeCat = 'all';
    document.querySelectorAll('.status-pill').forEach(p =>
      p.classList.toggle('active', p.dataset.cat === 'all'));
    ['accSearch','accSiteFilter','accEntityFilter','accProcessFilter'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    sortCol = 'date'; sortDir = -1;
    document.getElementById('accSortCol').value = 'date';
    document.getElementById('accSortDirBtn').textContent = '↓ Desc';
    render();
  });
  document.getElementById('accCsv').addEventListener('click', exportCSV);

  // Sortable headers
  document.querySelectorAll('.acc-table thead th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) sortDir = -sortDir;
      else { sortCol = col; sortDir = -1; }
      document.getElementById('accSortCol').value = col;
      document.getElementById('accSortDirBtn').textContent = sortDir === -1 ? '↓ Desc' : '↑ Asc';
      render();
    });
  });

  function setCat(cat) {
    activeCat = cat;
    document.querySelectorAll('.status-pill').forEach(p =>
      p.classList.toggle('active', p.dataset.cat === cat));
    render();
  }


  /* ─────────── Render ─────────── */
  function render() {
    const rows = applyFilters(allRows);
    const cnt = document.getElementById('accRowCount');
    const srch = (document.getElementById('accSearch').value || '').trim();
    cnt.textContent = `${rows.length} record${rows.length === 1 ? '' : 's'}`
      + (activeCat !== 'all' ? ` · ${activeCat}` : '')
      + (srch ? ` · matching "${srch}"` : '');

    const tb = document.getElementById('accTbody');
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="21" style="text-align:center;padding:3rem;color:var(--txt3)">No records match the selected filters.</td></tr>`;
      return;
    }

    tb.innerHTML = rows.map(r => renderRow(r)).join('');
  }

  function applyFilters(rows) {
    const cat   = activeCat;
    const srch  = (document.getElementById('accSearch').value || '').toLowerCase().trim();
    const sf    = document.getElementById('accSiteFilter').value;
    const ef    = document.getElementById('accEntityFilter').value;
    const pf    = document.getElementById('accProcessFilter').value;

    let out = rows.filter(r => cat === 'all' ? r.status.cat !== 'other' : r.status.cat === cat);
    if (sf)   out = out.filter(r => r.site === sf);
    if (ef)   out = out.filter(r => r.company === ef);
    if (pf)   out = out.filter(r => r.process === pf);
    if (srch) out = out.filter(r => r._s.includes(srch));

    return [...out].sort((a, b) => {
      const c = sortCol;
      if (c === 'amount') return sortDir * (a.amount - b.amount);
      if (c === 'date' || c === 'accDate') return sortDir * (parseDate(a[c]) - parseDate(b[c]));
      if (c === 'status') return sortDir * String(a.status.label).localeCompare(String(b.status.label));
      return sortDir * String(a[c] || '').localeCompare(String(b[c] || ''));
    });
  }

  function renderRow(r) {
    const s = r.status;
    const pill = s.label
      ? `<span class="stat-pill" style="background:${s.bg};color:${s.color};border-color:${s.color}33">${s.icon ? s.icon + '&nbsp;' : ''}${escapeHtml(s.label)}</span>`
      : '<span style="color:var(--txt3)">—</span>';

    const recUrl = r.requestId
      ? `${APPSHEET_ACCOUNTS_URL}?view=PaymentRequest&row=${encodeURIComponent(r.requestId)}`
      : APPSHEET_ACCOUNTS_URL;

    const reqIdCell = `
      <td style="white-space:nowrap">
        <div style="display:flex;align-items:center;gap:5px">
          <span style="font-family:'DM Mono',monospace;font-size:.72rem;color:var(--g8);font-weight:600">${escapeHtml(r.requestId) || '—'}</span>
          <a href="${recUrl}" target="_blank" rel="noopener" title="Open in AppSheet"
             style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;background:var(--g7);border-radius:4px;text-decoration:none;font-size:.65rem;color:#fff;flex-shrink:0">↗</a>
        </div>
      </td>`;

    const ma = (r.manualAuto || '').toLowerCase();
    const maBadge = r.manualAuto
      ? `<span style="font-size:.66rem;padding:2px 8px;border-radius:10px;background:${ma.includes('auto')?'#dbeafe':'#ede9fe'};color:${ma.includes('auto')?'#1d4ed8':'#6d28d9'};font-weight:700">${escapeHtml(r.manualAuto)}</span>`
      : '—';

    const fmtAmount = (v, c) => {
      if (!v) return '—';
      const num = Math.round(v).toLocaleString('en-IN');
      return c && c !== 'INR' ? `${escapeHtml(c)}\u00a0${num}` : `₹${num}`;
    };

    const td   = (val, extra) => `<td style="${extra || ''}">${val == null || val === '' ? '—' : escapeHtml(val)}</td>`;
    const tdC  = (val, w, mono) => `<td class="acc-clip" style="max-width:${w}px${mono?';font-family:DM Mono,monospace;font-size:.72rem':''}" title="${escapeAttr(val || '')}">${val == null || val === '' ? '—' : escapeHtml(val)}</td>`;

    return `<tr>
      <td style="text-align:center">${maBadge}</td>
      <td style="text-align:center;color:var(--txt2)">${escapeHtml(r.installment) || '—'}</td>
      ${reqIdCell}
      ${td(r.date, 'white-space:nowrap;color:var(--txt2)')}
      ${tdC(r.initiator, 140)}
      ${tdC(r.nature, 130)}
      ${tdC(r.payTo, 140)}
      ${tdC(r.dept, 110)}
      ${tdC(r.process, 130)}
      ${tdC(r.costCode, 140, true)}
      ${tdC(r.site, 140)}
      ${td(r.company, 'white-space:nowrap')}
      ${tdC(r.orderNo, 130, true)}
      ${td(r.billNo, 'white-space:nowrap;color:var(--txt2)')}
      <td style="text-align:center;font-size:.7rem;font-weight:700;color:var(--g7)">${escapeHtml(r.currency) || 'INR'}</td>
      <td style="text-align:right;font-weight:700;white-space:nowrap;color:${r.amount>0?'var(--g8)':'var(--txt3)'}">${fmtAmount(r.amount, r.currency)}</td>
      <td class="acc-clip acc-clip-wide" title="${escapeAttr(r.narrative)}">${escapeHtml(r.narrative) || '—'}</td>
      <td style="white-space:nowrap">${pill}</td>
      ${td(r.accDate, 'white-space:nowrap;color:var(--txt2)')}
      ${tdC(r.utr, 170)}
      ${tdC(r.remarks, 150)}
    </tr>`;
  }


  /* ─────────── CSV export ─────────── */
  function exportCSV() {
    const rows = applyFilters(allRows);
    if (!rows.length) { Shell.toast('No rows to export', 'warn'); return; }

    const headers = [
      'Manual/Auto','Instalment','Request ID','Date','Initiator',
      'Nature of Expenses','Payment To','Cost Code',
      'Department','Process','Paid To','Site','Company',
      'Order No','Bill No','PO Value','Invoice Value','Paid Value','Pending Value',
      'Currency','Amount','Narrative','Acc Status','Accounts Date','UTR',
      'Remarks','Status',
    ];
    const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [headers.map(esc).join(',')];
    rows.forEach(r => {
      lines.push([
        r.manualAuto, r.installment, r.requestId, r.date, r.initiator,
        r.nature, r.payTo, r.costCode,
        r.dept, r.process, r.paidTo, r.site, r.company,
        r.orderNo, r.billNo, r.poValue, r.invoiceVal, r.paidVal, r.pendingVal,
        r.currency, r.amount, r.narrative, r.accStatus, r.accDate, r.utr,
        r.remarks, r.status.label,
      ].map(esc).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `EVGCPL_Accounts_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  }


  /* ─────────── Helpers ─────────── */
  function parseDate(d) {
    if (!d) return 0;
    if (typeof d === 'string' && d.startsWith('Date(')) {
      try {
        const p = d.replace('Date(','').replace(')','').split(',').map(Number);
        return new Date(p[0], p[1], p[2]).getTime();
      } catch (_) { return 0; }
    }
    // dd-mm-yyyy or dd/mm/yyyy
    const parts = String(d).split(/[-\/]/);
    if (parts.length === 3) {
      const ts = new Date(parts[2], parts[1]-1, parts[0]).getTime();
      if (!isNaN(ts)) return ts;
    }
    const ts = new Date(d).getTime();
    return isNaN(ts) ? 0 : ts;
  }
  function debounce(fn, ms) {
    let t; return function() {
      clearTimeout(t); const a = arguments, c = this;
      t = setTimeout(() => fn.apply(c, a), ms);
    };
  }
  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
