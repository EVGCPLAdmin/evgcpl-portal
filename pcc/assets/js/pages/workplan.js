/* ════════════════════════════════════════════════════════════════
   Workplan · Step 4
   ────────────────────────────────────────────────────────────────
   Schema: BOQ → WBS → Activities hierarchy
   Grid:   12 FY monthly columns (Apr–Mar) per activity
   Qty:    Total Qty = BOQ Qty (carried from BOQ tab)
   Save:   One sheet row per activity with 12 month values
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function () {

  // ── Module state ────────────────────────────────────────────────
  let _ap      = null;   // active project
  let _boq     = [];     // BOQ rows for project
  let _wbs     = [];     // WBS rows for project
  let _acts    = [];     // Activity rows for project
  let _fy      = null;   // { label, months: [{f, lbl}] }

  // Linkage maps (built during load, shared with save)
  let _wbsByBoq  = {};   // boqUuid → [wbsRow, ...]
  let _actsByWbs = {};   // wbsUuid → [actRow, ...]

  // Edit state — key → { Apr, May, ... Mar } monthly quantities
  // key = boqUuid + '||' + wbsUuid + '||' + actName
  let _cells   = {};

  // % Weight per activity key
  let _weights = {};

  // ── FY helpers ──────────────────────────────────────────────────
  function buildFY(ap) {
    const raw = (ap && ap['Start Date']) || '';
    const d   = raw ? new Date(raw) : new Date();
    const ok  = !isNaN(d.getTime());
    const m   = ok ? d.getMonth() : new Date().getMonth(); // 0-based
    const y   = ok ? d.getFullYear() : new Date().getFullYear();
    // Indian FY: April (m=3) starts the year
    const fy0 = m >= 3 ? y : y - 1;
    const fy1 = fy0 + 1;
    const s2  = n => String(n).slice(2);

    return {
      label : `${fy0}-${s2(fy1)}`,
      months: [
        { f:'Apr', lbl:`Apr-${s2(fy0)}` },
        { f:'May', lbl:`May-${s2(fy0)}` },
        { f:'Jun', lbl:`Jun-${s2(fy0)}` },
        { f:'Jul', lbl:`Jul-${s2(fy0)}` },
        { f:'Aug', lbl:`Aug-${s2(fy0)}` },
        { f:'Sep', lbl:`Sep-${s2(fy0)}` },
        { f:'Oct', lbl:`Oct-${s2(fy0)}` },
        { f:'Nov', lbl:`Nov-${s2(fy0)}` },
        { f:'Dec', lbl:`Dec-${s2(fy0)}` },
        { f:'Jan', lbl:`Jan-${s2(fy1)}` },
        { f:'Feb', lbl:`Feb-${s2(fy1)}` },
        { f:'Mar', lbl:`Mar-${s2(fy1)}` },
      ],
    };
  }

  const rk = (boqU, wbsU, act) => `${boqU}||${wbsU}||${act}`;

  function initCells(key, existing) {
    if (!_cells[key]) {
      const c = {};
      (_fy.months).forEach(m => { c[m.f] = 0; });
      if (existing) _fy.months.forEach(m => { c[m.f] = Number(existing[m.f] || existing[m.lbl] || 0); });
      _cells[key] = c;
    }
    return _cells[key];
  }

  function rowTotal(key) {
    const d = _cells[key];
    if (!d) return 0;
    return _fy.months.reduce((s, m) => s + (Number(d[m.f]) || 0), 0);
  }

  // ── Load ────────────────────────────────────────────────────────
  async function load() {
    const ap = window.STATE.activeProject;
    if (!ap) {
      setEl('wpTableWrap', '<div class="tree-empty" style="padding:24px">No project selected — use the project switcher.</div>');
      setStatus('No project', 'gold');
      return;
    }
    _ap = ap;
    _fy = buildFY(ap);

    setEl2('wpProjCode', ap['Project Code'] || '—');
    setEl2('wpFY', 'FY ' + _fy.label);
    setStatus('Loading…', 'gold');

    const code = ap['Project Code'];
    const byP  = r => (g(r,'Project Code') || g(r,'ProjectCode') || '') === code;

    try {
      const [boq, wbs, acts, wp] = await Promise.all([
        API.gviz(window.CONFIG.TABS.BOQ).catch(() => []),
        API.gviz(window.CONFIG.TABS.WBS).catch(() => []),
        API.gviz(window.CONFIG.TABS.ACTIVITIES).catch(() => []),
        API.gviz(window.CONFIG.TABS.WORKPLAN).catch(() => []),
      ]);

      _boq  = (boq  || []).filter(byP);
      _wbs  = (wbs  || []).filter(byP);
      _acts = (acts || []).filter(byP);

      // ── Build linkage maps ────────────────────────────────────
      // WBS.CheckSum → BOQ.UUID
      _wbsByBoq  = {};
      _boq.forEach(r => { _wbsByBoq[g(r,'UUID')] = []; });
      _wbs.forEach(r => {
        const cs = g(r,'CheckSum');
        if (_wbsByBoq[cs]) _wbsByBoq[cs].push(r);
      });

      // Act.CheckSum → WBS.UUID
      _actsByWbs = {};
      _wbs.forEach(r => { _actsByWbs[g(r,'UUID')] = []; });
      _acts.forEach(r => {
        const cs = g(r,'CheckSum');
        if (_actsByWbs[cs]) _actsByWbs[cs].push(r);
      });

      // ── Load existing workplan data into _cells / _weights ────
      _cells = {}; _weights = {};
      const wpForProject = (wp || []).filter(byP);
      wpForProject.forEach(r => {
        const boqU = g(r,'BOQ UUID')  || '';
        const wbsU = g(r,'WBS UUID')  || '';
        const act  = g(r,'Activity')  || '';
        const key  = rk(boqU, wbsU, act);
        initCells(key, r);
        _weights[key] = Number(g(r,'% Weight') || 0);
      });

      renderTable();
      updateKPIs();
      setStatus(`${_boq.length} BOQ · ${_wbs.length} WBS · ${_acts.length} activities · FY ${_fy.label}`, 'green');
    } catch (e) {
      setStatus('Load failed', 'red');
      console.error('[Workplan]', e);
    }
  }

  // ── Render ───────────────────────────────────────────────────────
  function renderTable() {
    const wrap = document.getElementById('wpTableWrap');
    if (!wrap || !_fy) return;

    const mths = _fy.months;
    const N    = mths.length;

    // Table head
    const head = `
    <thead>
      <tr>
        <th rowspan="2" class="wps wps0 wpl">BOQ</th>
        <th rowspan="2" class="wps wps1 wpl">WBS</th>
        <th rowspan="2" class="wps wps2 wpl">Activity</th>
        <th rowspan="2" class="wps wps3">UoM</th>
        <th rowspan="2" class="wps wps4" style="text-align:right">Total Qty</th>
        <th colspan="${N}" class="wpmg" style="text-align:center">
          Monthly Planned Quantities · FY ${_fy.label}
        </th>
        <th rowspan="2" class="wpp">Planned</th>
        <th rowspan="2" class="wpw">% Wt</th>
      </tr>
      <tr>
        ${mths.map(m => `<th class="wpm">${m.lbl}</th>`).join('')}
      </tr>
    </thead>`;

    // Body rows
    let body = '';

    if (!_boq.length) {
      body = `<tr><td colspan="${5+N+2}" class="empty-cell" style="padding:24px">
        No BOQ items found — add items in the BOQ step first.
      </td></tr>`;
    } else {
      _boq.forEach((boqRow, bi) => {
        const boqUuid  = g(boqRow,'UUID')         || `_boq${bi}`;
        const boqItemN = g(boqRow,'BOQ Item #')   || g(boqRow,'S No') || String(bi+1);
        const boqDesc  = g(boqRow,'Description')  || '(no description)';
        const boqQty   = Number(g(boqRow,'Qty'))  || 0;
        const boqUnit  = g(boqRow,'Unit')         || '';
        const boqAmt   = Number(g(boqRow,'Amount'))|| 0;

        const myWbs = _wbsByBoq[boqUuid] || [];

        // BOQ group header row
        body += `
        <tr class="wp-br">
          <td class="wps wps0 wp-br-n">${Utils.esc(boqItemN)}</td>
          <td class="wps wps1"></td>
          <td class="wps wps2 wp-br-d">
            ${Utils.esc(boqDesc)}
            ${boqAmt ? `<span style="font-size:10px;font-weight:400;color:#16a34a;margin-left:8px">₹${fmtNum(boqAmt)}</span>` : ''}
          </td>
          <td class="wps wps3 wp-ar-uom">${Utils.esc(boqUnit)}</td>
          <td class="wps wps4 wp-br-q">${fmtNum(boqQty)}</td>
          ${mths.map(() => '<td style="background:#f0fdf4;border-bottom:1px solid #a7f3d0"></td>').join('')}
          <td style="background:#f0fdf4;border-bottom:1px solid #a7f3d0"></td>
          <td style="background:#f0fdf4;border-bottom:1px solid #a7f3d0"></td>
        </tr>`;

        if (!myWbs.length) {
          body += `<tr class="wp-ir"><td class="wps wps0"></td><td colspan="${4+N+2}" class="wps wps1" style="left:52px">
            No WBS linked to this BOQ item. Go to Project Tree → + WBS to add.
          </td></tr>`;
        } else {
          myWbs.forEach((wbsRow, wi) => {
            const wbsUuid = g(wbsRow,'UUID')     || `_wbs${wi}`;
            const wbsCode = g(wbsRow,'WBS Code') || `WBS-${String(wi+1).padStart(3,'0')}`;
            const wbsName = g(wbsRow,'WBS Name') || g(wbsRow,'Name') || '';
            const myActs  = _actsByWbs[wbsUuid]  || [];

            // WBS sub-header
            body += `
            <tr class="wp-wr">
              <td class="wps wps0"></td>
              <td class="wps wps1 wp-wr-c">${Utils.esc(wbsCode)}</td>
              <td class="wps wps2 wp-wr-n">${Utils.esc(wbsName)}</td>
              <td class="wps wps3"></td>
              <td class="wps wps4"></td>
              ${mths.map(() => '<td style="background:#f8faff;border-bottom:1px solid #e0e7ff"></td>').join('')}
              <td style="background:#f8faff;border-bottom:1px solid #e0e7ff"></td>
              <td style="background:#f8faff;border-bottom:1px solid #e0e7ff"></td>
            </tr>`;

            if (!myActs.length) {
              body += `<tr class="wp-ir"><td class="wps wps0"></td><td class="wps wps1"></td>
                <td colspan="${3+N+2}">No activities — add via Project Tree → + Activity</td></tr>`;
            } else {
              myActs.forEach(actRow => {
                const actName = g(actRow,'Activity')       || '';
                const actUnit = g(actRow,'Unit')           || '';
                const nature  = g(actRow,'Nature of Work') || '';
                const type    = g(actRow,'Type of Work')   || '';
                // Total Qty carried from BOQ (primary) or actRow.BOQ Qty
                const tQty    = boqQty || Number(g(actRow,'BOQ Qty') || 0);
                const key     = rk(boqUuid, wbsUuid, actName);
                const cd      = initCells(key);
                const planTot = rowTotal(key);
                const wt      = _weights[key] || 0;

                const planClass = planTot === 0 ? 'p-nil'
                  : Math.abs(planTot - tQty) < 0.01 ? 'p-ok'
                  : planTot > tQty ? 'p-hi'
                  : 'p-lo';

                body += `
                <tr class="wp-ar" data-key="${key}" data-boq-qty="${tQty}">
                  <td class="wps wps0 wp-ar-uom" style="font-size:10px;color:var(--text-faint)">
                    ${Utils.esc(boqItemN)}
                  </td>
                  <td class="wps wps1 wp-ar-uom" style="font-size:10px;color:var(--text-faint)">
                    ${Utils.esc(wbsCode)}
                  </td>
                  <td class="wps wps2">
                    <div class="wp-ar-name">${Utils.esc(actName)}</div>
                    ${nature ? `<div class="wp-ar-nat">${Utils.esc(nature)}${type?' · '+Utils.esc(type):''}</div>` : ''}
                  </td>
                  <td class="wps wps3 wp-ar-uom">${Utils.esc(actUnit)}</td>
                  <td class="wps wps4 wp-ar-qty">${tQty ? fmtNum(tQty) : '—'}</td>
                  ${mths.map(m => {
                    const val = cd[m.f] || 0;
                    return `<td class="wptd-m">
                      <input type="number" class="wp-mi${val ? ' nz' : ''}"
                             value="${val || ''}" step="0.01" min="0"
                             placeholder="0"
                             data-key="${key}" data-month="${m.f}"
                             oninput="PAGE.updateCell(this)" />
                    </td>`;
                  }).join('')}
                  <td class="wptd-p ${planClass}" id="plan_${key.replace(/[^a-z0-9]/gi,'_')}">
                    ${planTot ? fmtNum(planTot) : '—'}
                  </td>
                  <td class="wptd-m">
                    <input type="number" class="wp-wi" value="${wt || ''}"
                           step="0.1" min="0" max="100" placeholder="%"
                           data-key="${key}"
                           oninput="PAGE.updateWeight(this)" />
                  </td>
                </tr>`;
              });
            }
          });
        }
      });
    }

    wrap.innerHTML = `
    <table class="wp-table" id="wpTable">
      ${head}
      <tbody>${body}</tbody>
    </table>`;
  }

  // ── Cell update ─────────────────────────────────────────────────
  function updateCell(inp) {
    const key   = inp.dataset.key;
    const month = inp.dataset.month;
    const val   = Number(inp.value) || 0;
    if (!_cells[key]) initCells(key);
    _cells[key][month] = val;
    inp.classList.toggle('nz', val > 0);

    // Update planned total display
    const tot      = rowTotal(key);
    const planEl   = document.getElementById('plan_' + key.replace(/[^a-z0-9]/gi, '_'));
    const boqQty   = Number(inp.closest('tr')?.dataset.boqQty || 0);
    if (planEl) {
      planEl.textContent = tot ? fmtNum(tot) : '—';
      planEl.className = 'wptd-p ' +
        (tot === 0 ? 'p-nil' :
         Math.abs(tot - boqQty) < 0.01 ? 'p-ok' :
         tot > boqQty ? 'p-hi' : 'p-lo');
    }
    updateKPIs();
  }

  function updateWeight(inp) {
    const key = inp.dataset.key;
    _weights[key] = Number(inp.value) || 0;
    updateKPIs();
  }

  // ── KPIs ────────────────────────────────────────────────────────
  function updateKPIs() {
    const totalBoqQty  = _boq.reduce((s,r) => s + (Number(g(r,'Qty')) || 0), 0);
    const totalPlanned = Object.values(_cells)
      .reduce((s, d) => s + (_fy?.months || []).reduce((ss, m) => ss + (Number(d[m.f]) || 0), 0), 0);
    const totalWt = Object.values(_weights).reduce((s, w) => s + (Number(w) || 0), 0);

    const d = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    d('kpiBOQ',     _boq.length);
    d('kpiWBS',     _wbs.length);
    d('kpiActs',    _acts.length);
    d('kpiWt',      totalWt.toFixed(1) + '%');
    d('kpiBOQQty',  totalBoqQty > 0 ? fmtNum(totalBoqQty) : '—');
    d('kpiPlanned', totalPlanned > 0 ? fmtNum(totalPlanned) : '—');

    const wtEl = document.getElementById('kpiWt');
    if (wtEl) {
      wtEl.style.color =
        Math.abs(totalWt - 100) < 0.5 ? '#16a34a' :
        totalWt > 100 ? '#dc2626' : '#b45309';
    }
  }

  // ── Save ────────────────────────────────────────────────────────
  async function save() {
    const ap = _ap || window.STATE.activeProject;
    if (!ap) { Utils.toast('Select a project first', 'err'); return; }

    const totalWt = Object.values(_weights).reduce((s, w) => s + (Number(w) || 0), 0);
    if (totalWt > 0 && Math.abs(totalWt - 100) > 0.5) {
      const ok = confirm(`Weights sum to ${totalWt.toFixed(1)}% (not 100%). Save anyway?`);
      if (!ok) return;
    }

    const setBusy = b => {
      ['wpSaveBtn','wpSaveBtnB'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.disabled = b; el.textContent = b ? 'Saving…' : '💾 Save Workplan'; }
      });
    };
    setBusy(true);

    // Build rows: one per activity, with monthly data
    const saveRows = [];
    _boq.forEach((boqRow, bi) => {
      const boqUuid  = g(boqRow,'UUID')        || `_boq${bi}`;
      const boqItemN = g(boqRow,'BOQ Item #')  || g(boqRow,'S No') || String(bi+1);
      const boqDesc  = g(boqRow,'Description') || '';
      const boqQty   = Number(g(boqRow,'Qty')) || 0;
      const boqUnit  = g(boqRow,'Unit')        || '';

      const myWbs = _wbsByBoq[boqUuid] || [];
      myWbs.forEach((wbsRow, wi) => {
        const wbsUuid = g(wbsRow,'UUID')     || `_wbs${wi}`;
        const wbsCode = g(wbsRow,'WBS Code') || '';
        const wbsName = g(wbsRow,'WBS Name') || '';
        const myActs  = _actsByWbs[wbsUuid]  || [];

        myActs.forEach(actRow => {
          const actName = g(actRow,'Activity')       || '';
          const nature  = g(actRow,'Nature of Work') || '';
          const type    = g(actRow,'Type of Work')   || '';
          const unit    = g(actRow,'Unit')           || '';
          const key     = rk(boqUuid, wbsUuid, actName);
          const cd      = _cells[key] || {};
          const planTot = _fy.months.reduce((s,m) => s + (Number(cd[m.f]) || 0), 0);

          const row = {
            'Project Code':   ap['Project Code'],
            'FY':             _fy.label,
            'BOQ Item #':     boqItemN,
            'BOQ UUID':       boqUuid,
            'BOQ Description':boqDesc,
            'WBS Code':       wbsCode,
            'WBS Name':       wbsName,
            'WBS UUID':       wbsUuid,
            'Activity':       actName,
            'Nature of Work': nature,
            'Type of Work':   type,
            'UoM':            unit,
            'Total Qty':      boqQty,
            'Planned Total':  planTot,
            '% Weight':       Number(_weights[key]) || 0,
          };
          _fy.months.forEach(m => { row[m.f] = Number(cd[m.f]) || 0; });
          saveRows.push(row);
        });
      });
    });

    try {
      const r = await API.scriptCall('saveWorkplan', {
        projectCode: ap['Project Code'],
        fy:          _fy.label,
        rows:        saveRows,
      });
      if (r && r.success) {
        Utils.toast(`Saved ${saveRows.length} workplan rows ✓`, 'ok');
        if (window.Shell && Shell.stampSaved) Shell.stampSaved();
      } else {
        Utils.toast((r && r.message) || 'Save failed', 'err');
      }
    } catch (e) {
      Utils.toast('Error: ' + e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  // ── Sync from WBS ───────────────────────────────────────────────
  async function syncFromWBS() {
    Utils.toast('Reloading from WBS…', 'ok');
    await load();
  }

  // ── Helpers ─────────────────────────────────────────────────────
  function g(row, key) {
    if (!row) return '';
    if (row[key] !== undefined && row[key] !== null) return String(row[key]).trim();
    const kl = key.toLowerCase();
    const k  = Object.keys(row).find(k => k.toLowerCase() === kl);
    return k ? String(row[k] || '').trim() : '';
  }

  function fmtNum(v) {
    const n = Number(String(v || '').replace(/,/g, ''));
    return isNaN(n) ? String(v) : n.toLocaleString('en-IN');
  }

  function setEl(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function setEl2(id, txt) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  }

  function setStatus(msg, color) {
    const el = document.getElementById('wpStatus');
    if (el) { el.textContent = msg; el.className = 'pill pill-' + color; }
  }

  function onProjectChange() { load(); }
  function refresh() { return load(); }

  return { load, save, syncFromWBS, updateCell, updateWeight, onProjectChange, refresh };
})();
