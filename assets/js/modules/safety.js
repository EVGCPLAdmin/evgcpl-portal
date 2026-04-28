/* ═══════════════════════════════════════════════════════════════════
   EVGCPL Portal — Safety Module
   /assets/js/modules/safety.js

   Three workflows:
     1. Daily safety checklist (per-site, per-day, persisted to
        DailyChecks tab via Apps Script appendRow)
     2. Incident report form (UUID-stamped, written to Incidents tab)
     3. Incident log (read from Incidents tab, with one-click "Close"
        that writes back via Apps Script updateCell)

   Sheet defaults (overridable via Config):
     SAFETY · Incidents     · safety.incidents
     SAFETY · DailyChecks   · safety.dailyChecks
   ═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  Shell.mount('safety');

  document.getElementById('pageHead').innerHTML = Shell.pageHead({
    crumbs: [{ label:'Home', href:'dashboard.html' }, { label:'Safety' }],
    title:  '🦺 Safety',
    sub:    'Daily checklist · incident log · site safety score',
    actions:`<select id="sfSiteSel" class="btn btn-secondary btn-sm" style="padding-right:1.5rem;cursor:pointer;font-weight:600"><option>Loading sites…</option></select>`,
  });

  // ── Static checklist definition ───────────────────────────────
  const SAFETY_CHECKS = [
    { id:'ppe',        label:'PPE compliance — helmets, vests, boots',           cat:'PPE' },
    { id:'scaffold',   label:'Scaffolding inspected & tagged',                   cat:'Working at Height' },
    { id:'electrical', label:'Electrical panels locked & labelled',              cat:'Electrical' },
    { id:'fire_ext',   label:'Fire extinguishers serviceable & accessible',      cat:'Fire Safety' },
    { id:'first_aid',  label:'First aid kit stocked & accessible',               cat:'Medical' },
    { id:'signage',    label:'Safety signage visible at entry & hazard zones',   cat:'Signage' },
    { id:'toolbox',    label:'Toolbox talk conducted today',                     cat:'Training' },
    { id:'permits',    label:'Work permits issued for hot/confined work',        cat:'Permits' },
    { id:'housekeep',  label:'Housekeeping — walkways clear of debris',          cat:'Housekeeping' },
    { id:'machinery',  label:'Machinery guards in place & functioning',          cat:'Machinery' },
  ];

  // ── State ─────────────────────────────────────────────────────
  let allSites    = [];
  let selectedSite = '';
  let allIncidents = [];   // current snapshot from sheet
  const localStore = 'evgcpl_safety_local_v1';   // fallback for offline

  // ── Load sites ────────────────────────────────────────────────
  API.fetchByBinding('siteops.sites').then(rows => {
    allSites = rows
      .map(r => ({ name: r['Site Name'] || r['Name'] || '', status: (r['Status']||'').toUpperCase() }))
      .filter(s => s.name && s.status === 'ACTIVE')
      .map(s => s.name)
      .sort();
    if (!allSites.length) allSites = ['(no sites configured)'];
    selectedSite = allSites[0];

    const sel = document.getElementById('sfSiteSel');
    sel.innerHTML = allSites.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
    sel.addEventListener('change', () => { selectedSite = sel.value; renderChecklist(); renderKpis(); });

    // Mirror to filter dropdown
    const flt = document.getElementById('sfLogFilter');
    flt.innerHTML = `<option value="">All sites</option>` + allSites.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
    flt.addEventListener('change', renderIncidentLog);

    renderChecklist();
    loadIncidents();
  }).catch(err => {
    if (err && err.name === 'SheetError') API.renderSheetError(err, 'errorSlot');
    else document.getElementById('errorSlot').innerHTML =
      `<div class="alert danger"><span class="alert-icon">⚠</span><div class="alert-body">Could not load sites: ${escapeHtml(err && err.message || '')}</div></div>`;
  });

  // ── Local checklist persistence (per-day, per-site) ───────────
  function getChecks(site) {
    try {
      const key = 'sfchk_' + new Date().toISOString().slice(0,10) + '_' + site;
      return JSON.parse(sessionStorage.getItem(key) || '{}');
    } catch (_) { return {}; }
  }
  function setCheck(site, id, val) {
    const key = 'sfchk_' + new Date().toISOString().slice(0,10) + '_' + site;
    const c = getChecks(site);
    c[id] = val;
    sessionStorage.setItem(key, JSON.stringify(c));
  }
  function clearChecks(site) {
    const key = 'sfchk_' + new Date().toISOString().slice(0,10) + '_' + site;
    sessionStorage.removeItem(key);
  }

  // ── Local incident fallback ───────────────────────────────────
  function getLocalIncidents() {
    try { return JSON.parse(sessionStorage.getItem(localStore) || '[]'); }
    catch (_) { return []; }
  }
  function saveLocalIncidents(arr) {
    sessionStorage.setItem(localStore, JSON.stringify(arr));
  }


  /* ─────────── KPIs ─────────── */
  function renderKpis() {
    const checks = getChecks(selectedSite);
    const done = SAFETY_CHECKS.filter(c => checks[c.id]).length;
    const score = SAFETY_CHECKS.length ? Math.round(done / SAFETY_CHECKS.length * 100) : 0;
    const scoreCls = score === 100 ? 'green' : score >= 60 ? 'orange' : 'red';
    const scoreCol = score === 100 ? '#15803d' : score >= 60 ? '#bf6700' : '#b91c1c';

    const openInc = allIncidents.filter(i => (i.status || '').toUpperCase() !== 'CLOSED');
    const siteInc = allIncidents.filter(i => i.site === selectedSite);

    const el = document.getElementById('sfKpis');
    el.innerHTML = `
      <div class="kpi">
        <div class="kpi-top"><div class="kpi-icon ${scoreCls}">🛡️</div></div>
        <div class="kpi-val" style="color:${scoreCol}">${score}%</div>
        <div class="kpi-label">Safety score · today</div>
        <div style="font-size:.72rem;color:var(--txt3);margin-top:.2rem">${done}/${SAFETY_CHECKS.length} checks done</div>
      </div>
      <div class="kpi">
        <div class="kpi-top"><div class="kpi-icon ${openInc.length > 0 ? 'orange' : 'green'}">⚠</div></div>
        <div class="kpi-val">${openInc.length}</div>
        <div class="kpi-label">Open incidents</div>
        <div style="font-size:.72rem;color:var(--txt3);margin-top:.2rem">Across all sites</div>
      </div>
      <div class="kpi">
        <div class="kpi-top"><div class="kpi-icon">📋</div></div>
        <div class="kpi-val">${allIncidents.length}</div>
        <div class="kpi-label">Total incidents</div>
        <div style="font-size:.72rem;color:var(--txt3);margin-top:.2rem">From sheet</div>
      </div>
      <div class="kpi">
        <div class="kpi-top"><div class="kpi-icon blue">🏗️</div></div>
        <div class="kpi-val">${siteInc.length}</div>
        <div class="kpi-label">At ${escapeHtml(selectedSite || 'site')}</div>
        <div style="font-size:.72rem;color:var(--txt3);margin-top:.2rem">Selected site</div>
      </div>`;
  }

  /* ─────────── CHECKLIST ─────────── */
  function renderChecklist() {
    const checks = getChecks(selectedSite);
    const done = SAFETY_CHECKS.filter(c => checks[c.id]).length;
    const score = SAFETY_CHECKS.length ? Math.round(done / SAFETY_CHECKS.length * 100) : 0;
    const scoreCol = score === 100 ? '#15803d' : score >= 60 ? '#bf6700' : '#b91c1c';

    document.getElementById('sfChecklistTitle').innerHTML = `✓ Daily checklist — <span style="font-weight:500;color:var(--txt2)">${escapeHtml(selectedSite || '')}</span>`;
    document.getElementById('sfChecklistBadge').textContent = `${score}% complete`;

    const fill = document.getElementById('sfProgressFill');
    fill.style.width = score + '%';
    fill.style.background = scoreCol;

    document.getElementById('sfChecklist').innerHTML = SAFETY_CHECKS.map(c => {
      const checked = !!checks[c.id];
      return `<label class="check-item ${checked ? 'done' : ''}">
        <input type="checkbox" ${checked ? 'checked' : ''} data-check="${c.id}"/>
        <span class="lbl">${escapeHtml(c.label)}</span>
        <span class="check-cat">${escapeHtml(c.cat)}</span>
      </label>`;
    }).join('');

    document.querySelectorAll('[data-check]').forEach(cb => {
      cb.addEventListener('change', e => {
        setCheck(selectedSite, e.target.dataset.check, e.target.checked);
        renderChecklist();
        renderKpis();
      });
    });

    renderKpis();
  }

  document.getElementById('sfMarkAll').addEventListener('click', async () => {
    const obj = {};
    SAFETY_CHECKS.forEach(c => obj[c.id] = true);
    const key = 'sfchk_' + new Date().toISOString().slice(0,10) + '_' + selectedSite;
    sessionStorage.setItem(key, JSON.stringify(obj));
    renderChecklist();

    // Persist to DailyChecks sheet
    const status = document.getElementById('sfChecklistStatus');
    status.textContent = 'Saving to sheet…';
    status.style.color = 'var(--txt3)';
    const ts = new Date().toISOString();
    const dt = new Date().toLocaleDateString('en-IN');
    const user = (STATE.get('user') || {}).name || (STATE.get('user') || {}).email || '';
    const row = [ts, selectedSite, dt, user, '100', String(SAFETY_CHECKS.length), ...SAFETY_CHECKS.map(() => 'Yes')];
    const ok = await writeRow('safety.dailyChecks', row);
    if (ok) {
      status.textContent = '✓ Saved to DailyChecks sheet';
      status.style.color = '#15803d';
    } else {
      status.textContent = '⚠ Saved locally only — sheet write failed';
      status.style.color = '#bf6700';
    }
  });

  document.getElementById('sfClearAll').addEventListener('click', () => {
    clearChecks(selectedSite);
    renderChecklist();
  });


  /* ─────────── INCIDENT FORM ─────────── */
  // Pre-fill reporter
  setTimeout(() => {
    const u = STATE.get('user') || {};
    const inp = document.getElementById('incBy');
    if (inp && !inp.value) inp.value = u.name || u.email || '';
  }, 100);

  document.getElementById('incSubmit').addEventListener('click', async () => {
    const type = document.getElementById('incType').value;
    const sev  = document.getElementById('incSev').value;
    const desc = document.getElementById('incDesc').value.trim();
    const emp  = document.getElementById('incEmp').value.trim();
    const by   = document.getElementById('incBy').value.trim();
    const msg  = document.getElementById('incMsg');
    const btn  = document.getElementById('incSubmit');

    const showMsg = (txt, ok) => {
      msg.className = 'submit-msg ' + (ok ? 'ok' : 'bad');
      msg.textContent = txt;
    };

    if (!desc) { showMsg('Please describe the incident.', false); return; }
    if (!by)   { showMsg('Please enter your name in "Reported by".', false); return; }

    btn.disabled = true;
    btn.textContent = '⏳ Submitting…';

    const uuid = 'INC-' + Date.now();
    const dt = new Date().toLocaleDateString('en-IN');
    const ts = new Date().toISOString();
    const row = [ts, uuid, selectedSite, type, sev, desc, by, emp, 'Open', dt];

    const ok = await writeRow('safety.incidents', row);

    btn.disabled = false;
    btn.textContent = '🚨 Submit incident report';

    if (ok) {
      showMsg('✓ Incident saved to sheet', true);
      // Optimistic: prepend to local list immediately
      allIncidents.unshift({ id: uuid, site: selectedSite, type, sev, desc, by, emp, status: 'Open', date: dt });
      renderIncidentLog();
      renderKpis();
      // Clear form
      document.getElementById('incDesc').value = '';
      document.getElementById('incEmp').value = '';
      // Reload after a moment to confirm
      setTimeout(loadIncidents, 1500);
    } else {
      // Save to local store as fallback
      const local = getLocalIncidents();
      local.unshift({ id: uuid, site: selectedSite, type, sev, desc, by, emp, status: 'Open', date: dt, _local: true });
      saveLocalIncidents(local);
      showMsg('⚠ Saved locally — sheet write failed. Check Apps Script.', false);
      allIncidents.unshift({ id: uuid, site: selectedSite, type, sev, desc, by, emp, status: 'Open', date: dt });
      renderIncidentLog();
      renderKpis();
    }
  });


  /* ─────────── INCIDENT LOG ─────────── */
  document.getElementById('sfReloadBtn').addEventListener('click', loadIncidents);

  function loadIncidents() {
    const log = document.getElementById('sfIncidentLog');
    log.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--txt3);font-size:.85rem">⏳ Loading incidents…</div>`;
    API.fetchByBinding('safety.incidents').then(rows => {
      allIncidents = rows
        .filter(r => (r['UUID'] || r['B'] || '').trim())
        .map(r => ({
          id:   r['UUID']           || r['B']  || String(Date.now()),
          ts:   r['Timestamp']      || r['A']  || '',
          site: r['Site']           || r['C']  || '',
          type: r['Type']           || r['D']  || '',
          sev:  r['Severity']       || r['E']  || '',
          desc: r['Description']    || r['F']  || '',
          by:   r['Reported By']    || r['G']  || '',
          emp:  r['Employee Name']  || r['H']  || '',
          status: r['Status']       || r['I']  || 'Open',
          date: r['Date']           || r['J']  || '',
        }))
        .sort((a,b) => (b.ts || '').localeCompare(a.ts || ''));
      // Merge unsynced local fallback
      const localOnly = getLocalIncidents().filter(li => !allIncidents.find(i => i.id === li.id));
      allIncidents = [...localOnly, ...allIncidents];
      renderIncidentLog();
      renderKpis();
    }).catch(err => {
      if (err && err.name === 'SheetError') {
        // Fallback: still show local incidents if any
        const local = getLocalIncidents();
        if (local.length) {
          allIncidents = local;
          renderIncidentLog();
        } else {
          API.renderSheetError(err, 'errorSlot');
          log.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--txt3);font-size:.85rem">No incidents in sheet yet.</div>`;
        }
      }
      renderKpis();
    });
  }

  function renderIncidentLog() {
    const log = document.getElementById('sfIncidentLog');
    const flt = document.getElementById('sfLogFilter')?.value || '';
    let rows = allIncidents;
    if (flt) rows = rows.filter(r => r.site === flt);

    document.getElementById('sfLogBadge').textContent = `${rows.length} incident${rows.length === 1 ? '' : 's'}`;

    if (!rows.length) {
      log.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--txt3);font-size:.85rem">No incidents logged. Use the form above to report one.</div>`;
      return;
    }

    const sevCol = { Low:'#15803d', Medium:'#bf6700', High:'#b91c1c', Critical:'#6a1b9a' };
    const sevBg  = { Low:'rgba(46,125,50,.12)', Medium:'rgba(251,140,0,.15)', High:'rgba(220,38,38,.12)', Critical:'rgba(106,27,154,.12)' };

    log.innerHTML = `<table class="tbl" style="min-width:880px">
      <thead><tr>
        <th>Date</th><th>Site</th><th>Type</th><th>Severity</th>
        <th>Description</th><th>Reported by</th><th>Employee</th><th style="text-align:center">Status</th>
      </tr></thead>
      <tbody>${rows.slice(0, 50).map(i => `
        <tr>
          <td style="font-size:.78rem;white-space:nowrap">${escapeHtml(i.date) || '—'}</td>
          <td style="font-size:.82rem">${escapeHtml(i.site) || '—'}</td>
          <td style="font-size:.82rem">${escapeHtml(i.type) || '—'}</td>
          <td><span class="tag" style="background:${sevBg[i.sev] || 'var(--surface3)'};color:${sevCol[i.sev] || 'var(--txt2)'}">${escapeHtml(i.sev) || '—'}</span></td>
          <td style="font-size:.8rem;max-width:240px" title="${escapeAttr(i.desc)}">${escapeHtml((i.desc||'').slice(0,80))}${i.desc && i.desc.length > 80 ? '…' : ''}</td>
          <td style="font-size:.78rem">${escapeHtml(i.by) || '—'}</td>
          <td style="font-size:.78rem;color:var(--txt3)">${escapeHtml(i.emp) || '—'}</td>
          <td style="text-align:center">
            ${(i.status||'').toUpperCase() === 'OPEN'
              ? `<button class="btn btn-secondary btn-sm" data-close="${escapeAttr(i.id)}" style="background:rgba(46,125,50,.1);color:#15803d;border-color:rgba(46,125,50,.3)">✓ Close</button>`
              : `<span class="tag" style="background:rgba(46,125,50,.12);color:#15803d">✓ Closed</span>`}
          </td>
        </tr>`).join('')}</tbody>
      ${rows.length > 50 ? `<tfoot><tr><td colspan="8" style="text-align:center;color:var(--txt3);padding:.6rem;font-size:.78rem">Showing 50 of ${rows.length} — use filter to narrow</td></tr></tfoot>` : ''}
    </table>`;

    log.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => closeIncident(btn.dataset.close));
    });
  }

  async function closeIncident(id) {
    // Optimistic UI
    const inc = allIncidents.find(i => i.id === id);
    if (inc) inc.status = 'Closed';
    renderIncidentLog();
    renderKpis();

    // Write back via Apps Script updateCell action
    const sheetId = API.getSheetId(API.getBinding('safety.incidents').sheetKey);
    const tab     = API.getBinding('safety.incidents').tab;
    try {
      const res = await fetch(API.APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'updateCell',
          sheetId, tab,
          matchCol: 'B',          // UUID column
          matchVal: id,
          updateCol: 'I',         // Status column
          updateVal: 'Closed',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json || json.success === false) {
        Shell.toast('Marked closed locally — sheet write-back failed', 'warn');
      } else {
        Shell.toast('Incident closed', 'success');
      }
    } catch (e) {
      Shell.toast('Marked closed locally — Apps Script unreachable', 'warn');
    }
  }


  /* ─────────── HELPERS ─────────── */
  // Generic appendRow via Apps Script (CORS-safe pattern)
  async function writeRow(bindingName, row) {
    const b = API.getBinding(bindingName);
    if (!b) return false;
    const sheetId = API.getSheetId(b.sheetKey);
    if (!sheetId) return false;
    try {
      const res = await fetch(API.APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'appendRow', sheetId, tab: b.tab, row }),
      });
      const json = await res.json().catch(() => ({}));
      return json && json.success !== false;
    } catch (_) {
      return false;
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
