/* ═══════════════════════════════════════════════════════════════════
   EVGCPL Portal — Dashboard Module
   /assets/js/modules/dashboard.js
   ═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  Shell.mount('dashboard');

  const u = STATE.get('user') || {};
  const firstName = (u.name || 'Team').split(' ')[0];
  const greeting  = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  })();

  // PAGE HEAD
  document.getElementById('pageHead').innerHTML = Shell.pageHead({
    crumbs: [{ label:'Home', href:'dashboard.html' }, { label:'Dashboard' }],
    title:  greeting + ', ' + firstName,
    sub:    'Evergreen Enterprises · ' + new Date().toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' }),
    actions: `<button class="btn btn-secondary btn-sm" onclick="location.reload()">↻ Refresh</button>`,
  });


  // ── Load all primary data in parallel ─────────────────────────
  Promise.allSettled([
    API.fetchSheet('Sites',    "SELECT A,B,F,G,H,K", API.SHEETS.MASTER),
    API.fetchSheet('Master',   "SELECT A,C,M,N,P,X,Y", API.SHEETS.EMPLOYEE),
    API.fetchSheet('Vendor',   "SELECT A,B,F", API.SHEETS.MASTER),
    API.fetchSheet('SC',       "SELECT A,B,F", API.SHEETS.MASTER),
    API.fetchSheet('Asset',    "SELECT A,B,F", API.SHEETS.MASTER),
  ]).then(results => {
    const [sitesR, empsR, vendR, scR, assetR] = results;

    // Detect first sharing failure for inline guidance
    const firstFail = results.find(r => r.status === 'rejected' && r.reason && r.reason.name === 'SheetError');
    if (firstFail) API.renderSheetError(firstFail.reason, 'errorSlot');

    const sites  = (sitesR.status === 'fulfilled' ? sitesR.value : []) || [];
    const emps   = (empsR.status  === 'fulfilled' ? empsR.value  : []) || [];
    const vends  = (vendR.status  === 'fulfilled' ? vendR.value  : []) || [];
    const scs    = (scR.status    === 'fulfilled' ? scR.value    : []) || [];
    const assets = (assetR.status === 'fulfilled' ? assetR.value : []) || [];

    const isActive = r => (Object.values(r).find(v => /active|inactive/i.test(v)) || '').toUpperCase().includes('ACTIVE');
    const activeSites  = sites.filter(isActive);
    const activeEmps   = emps.filter(e => /Active/i.test(e['Employee Status'] || e['Status'] || 'Active'));
    const activeVends  = vends.filter(isActive);
    const activeScs    = scs.filter(isActive);
    const activeAssets = assets.filter(isActive);

    renderPrimaryKPIs(activeSites, activeEmps, activeAssets, activeVends);
    renderSecondaryKPIs(activeScs.length, vends.length, sites.length);
    renderPinnedRow();
    renderSitesList(activeSites);
    renderDeptBreakup(activeEmps);
  });


  function renderPrimaryKPIs(sites, emps, assets, vends) {
    const el = document.getElementById('kpiPrimary');
    el.innerHTML = `
      ${kpi({ icon:'green',  glyph:'⌂', val:sites.length,  label:'Active sites',     sub:sites.length + ' deployed', status:'live', href:'site-ops.html#sites' })}
      ${kpi({ icon:'orange', glyph:'◍', val:emps.length,   label:'Active employees', sub:'On payroll',               status:'live', href:'hr.html#hr-dashboard' })}
      ${kpi({ icon:'blue',   glyph:'◎', val:assets.length, label:'Active equipment', sub:'In service',               status:'live', href:'site-ops.html#equipment' })}
      ${kpi({ icon:'green',  glyph:'◇', val:vends.length,  label:'Active vendors',   sub:'Supplying',                status:'live', href:'scm.html#vendors' })}
    `;
  }

  function renderSecondaryKPIs(scCount, vendTotal, siteTotal) {
    const el = document.getElementById('kpiSecondary');
    el.innerHTML = `
      ${kpi({ icon:'gold', glyph:'⏱', val:'—', label:'POs pending approval', sub:'Loading…',  status:'warn',  href:'scm.html' })}
      ${kpi({ icon:'gold', glyph:'⏱', val:'—', label:'Pending payments',     sub:'Loading…',  status:'warn',  href:'accounts.html' })}
      ${kpi({ icon:'green',glyph:'◊', val:scCount, label:'Subcontractors',  sub:'Active SCs',  status:'live', href:'scm.html#subcontractors' })}
    `;
    loadPendingPOs();
    loadPendingPayments();
  }

  function loadPendingPOs() {
    API.fetchSheet('PO', "SELECT A,AG,AQ", API.SHEETS.PURCHASE)
      .then(rows => {
        const pending = rows.filter(r => (r['Lock'] || r['AQ'] || '').includes('Released for Approval'));
        const card = document.querySelector('#kpiSecondary .kpi:nth-child(1)');
        if (card) {
          card.querySelector('.kpi-val').textContent = pending.length;
          card.querySelector('.kpi-sub').textContent = pending.length + ' awaiting MD sign-off';
        }
      })
      .catch(err => {
        const card = document.querySelector('#kpiSecondary .kpi:nth-child(1)');
        if (card) {
          card.querySelector('.kpi-val').textContent = '!';
          card.querySelector('.kpi-sub').textContent = 'Sheet error — see below';
          card.querySelector('.kpi-status')?.classList.add('error');
        }
        if (!document.querySelector('#errorSlot .alert')) {
          API.renderSheetError(err, 'errorSlot');
        }
      });
  }

  function loadPendingPayments() {
    API.fetchSheet('PaymentRequest', "SELECT A,AG", API.SHEETS.PAYMENT)
      .then(rows => {
        const pending = rows.filter(r => /(submitted|pending)/i.test(r['Accounts Status'] || r['AG'] || ''));
        const card = document.querySelector('#kpiSecondary .kpi:nth-child(2)');
        if (card) {
          card.querySelector('.kpi-val').textContent = pending.length;
          card.querySelector('.kpi-sub').textContent = pending.length + ' open requests';
        }
      })
      .catch(() => {
        const card = document.querySelector('#kpiSecondary .kpi:nth-child(2)');
        if (card) {
          card.querySelector('.kpi-val').textContent = '!';
          card.querySelector('.kpi-sub').textContent = 'Sheet error';
        }
      });
  }


  function renderPinnedRow() {
    const pinned = STATE.get('pinned') || [];
    const recent = STATE.get('recent') || [];
    const el = document.getElementById('pinnedRow');
    el.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>Pinned</h3>
          <span class="text-xs text-muted">Press ⌘K → ★ to pin</span>
        </div>
        <div class="card-body">
          ${pinned.length === 0
            ? `<div class="text-sm text-muted">No pinned modules yet. Open the command palette (⌘K) and pin the modules you use most.</div>`
            : `<div style="display:flex;gap:.45rem;flex-wrap:wrap">${pinned.map(p => `<a class="tag green" href="${p}.html">${Shell.escapeHtml(p)}</a>`).join('')}</div>`}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Recent</h3></div>
        <div class="card-body">
          ${recent.length === 0
            ? `<div class="text-sm text-muted">Pages you visit will appear here.</div>`
            : recent.slice(0, 5).map(r => `<a class="cmdk-item" href="${r.route}.html" style="padding:.4rem 0">${Shell.escapeHtml(r.label)}</a>`).join('')}
        </div>
      </div>
    `;
  }


  function renderSitesList(sites) {
    const el = document.getElementById('sitesList');
    if (!sites.length) {
      el.innerHTML = `<div class="text-sm text-muted">No active sites loaded.</div>`;
      return;
    }
    const top = sites.slice(0, 8);
    el.innerHTML = `
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Site</th><th>Code</th><th>Region</th></tr></thead>
          <tbody>
            ${top.map(s => `<tr>
              <td><b>${Shell.escapeHtml(s['Site Name'] || s['B'] || '—')}</b></td>
              <td>${Shell.escapeHtml(s['Site Code'] || s['F'] || '')}</td>
              <td>${Shell.escapeHtml(s['Region'] || s['G'] || '')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${sites.length > 8 ? `<div class="text-xs text-muted mt">+ ${sites.length - 8} more</div>` : ''}
    `;
  }


  function renderDeptBreakup(emps) {
    const el = document.getElementById('deptBreakup');
    if (!emps.length) { el.innerHTML = `<div class="text-sm text-muted">No employee data.</div>`; return; }
    const counts = {};
    emps.forEach(e => {
      const d = e['Department'] || e['M'] || 'Unspecified';
      counts[d] = (counts[d] || 0) + 1;
    });
    const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0, 8);
    const max = sorted[0]?.[1] || 1;
    el.innerHTML = sorted.map(([d, n]) => `
      <div style="margin-bottom:.7rem">
        <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:.2rem">
          <span style="color:var(--txt2);font-weight:500">${Shell.escapeHtml(d)}</span>
          <span class="num" style="color:var(--txt3)">${n}</span>
        </div>
        <div style="height:5px;border-radius:99px;background:var(--surface2);overflow:hidden">
          <div style="height:100%;width:${(n/max)*100}%;background:linear-gradient(90deg, var(--g4), var(--g6));border-radius:99px"></div>
        </div>
      </div>
    `).join('');
  }


  /* ─── KPI card helper ──────────────────────────────────────── */
  function kpi({ icon, glyph, val, label, sub, status, href }) {
    const click = href ? ` onclick="location.href='${href}'"` : '';
    const statusHtml = status === 'live'
      ? '<span class="kpi-status live"><span class="pulse"></span>Live</span>'
      : status === 'warn'  ? '<span class="kpi-status warn">Action</span>'
      : status === 'error' ? '<span class="kpi-status error">Error</span>'
      : '';
    return `
      <div class="kpi ${href ? 'clickable':''}"${click}>
        <div class="kpi-top">
          <div class="kpi-icon ${icon}">${glyph}</div>
          ${statusHtml}
        </div>
        <div class="kpi-val tnum">${val}</div>
        <div class="kpi-label">${Shell.escapeHtml(label)}</div>
        ${sub ? `<div class="kpi-sub">${Shell.escapeHtml(sub)}</div>` : ''}
      </div>
    `;
  }
})();
