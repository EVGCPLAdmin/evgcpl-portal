/* ════════════════════════════════════════════════════════════════
   Step 4 · Workplan
   ────────────────────────────────────────────────────────────────
   One editable row per WBS item. No activity dependency.
   BOQ items are group headers. Monthly cells are tied to WBS.
   Saves immediately — does not require activities to exist.

   Key:       boqUuid + '||' + wbsUuid
   Save row:  one per WBS, with 12 monthly planned quantities
   Total Qty: carried from BOQ (reference column, read-only)
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function () {

  // ── State ────────────────────────────────────────────────────
  let _ap  = null;
  let _boq = [];
  let _wbs = [];
  let _fy  = null;

  let _wbsByBoq = {};  // boqUuid → [wbsRow, ...]
  let _cells    = {};  // key → { Apr:0, May:0, … Mar:0 }
  let _weights  = {};  // key → %weight number

  const rk = (b, w) => `${b}||${w}`;

  function initCells(key, src) {
    if (!_cells[key]) {
      const c = {};
      (_fy.months).forEach(m => { c[m.f] = src ? (Number(g(src, m.f)) || 0) : 0; });
      _cells[key] = c;
    }
    return _cells[key];
  }

  function rowTotal(key) {
    const d = _cells[key];
    if (!d) return 0;
    return _fy.months.reduce((s, m) => s + (Number(d[m.f]) || 0), 0);
  }

  // ── FY ───────────────────────────────────────────────────────
  function buildFY(ap) {
    const raw = (ap && ap['Start Date']) || '';
    const d   = raw ? new Date(raw) : new Date();
    const m   = isNaN(d.getTime()) ? new Date().getMonth() : d.getMonth();
    const y   = isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear();
    const fy0 = m >= 3 ? y : y - 1;
    const fy1 = fy0 + 1;
    const s2  = n => String(n).slice(2);
    return {
      label : `${fy0}-${s2(fy1)}`,
      months: [
        {f:'Apr',lbl:`Apr-${s2(fy0)}`},{f:'May',lbl:`May-${s2(fy0)}`},
        {f:'Jun',lbl:`Jun-${s2(fy0)}`},{f:'Jul',lbl:`Jul-${s2(fy0)}`},
        {f:'Aug',lbl:`Aug-${s2(fy0)}`},{f:'Sep',lbl:`Sep-${s2(fy0)}`},
        {f:'Oct',lbl:`Oct-${s2(fy0)}`},{f:'Nov',lbl:`Nov-${s2(fy0)}`},
        {f:'Dec',lbl:`Dec-${s2(fy0)}`},{f:'Jan',lbl:`Jan-${s2(fy1)}`},
        {f:'Feb',lbl:`Feb-${s2(fy1)}`},{f:'Mar',lbl:`Mar-${s2(fy1)}`},
      ],
    };
  }

  // ── Load ─────────────────────────────────────────────────────
  async function load() {
    const ap = window.STATE.activeProject;
    if (!ap) {
      document.getElementById('wpTableWrap').innerHTML =
        '<div class="tree-empty" style="padding:24px">No project selected.</div>';
      setStatus('No project', 'gold'); return;
    }
    _ap = ap;
    _fy = buildFY(ap);
    setEl('wpProjCode', ap['Project Code'] || '—');
    setEl('wpFY', 'FY ' + _fy.label);
    setStatus('Loading…', 'gold');

    const code = ap['Project Code'];
    const byP  = r => (g(r,'Project Code') || g(r,'ProjectCode') || '') === code;

    try {
      const [boq, wbs, wp] = await Promise.all([
        API.gviz(window.CONFIG.TABS.BOQ).catch(() => []),
        API.gviz(window.CONFIG.TABS.WBS).catch(() => []),
        API.gviz(window.CONFIG.TABS.WORKPLAN).catch(() => []),
      ]);

      _boq = (boq || []).filter(byP);
      _wbs = (wbs || []).filter(byP);

      // Build BOQ → WBS linkage  (WBS.CheckSum = BOQ.UUID)
      _wbsByBoq = {};
      _boq.forEach(r => { _wbsByBoq[g(r,'UUID')] = []; });
      _wbs.forEach(r => {
        const cs = g(r,'CheckSum');
        if (_wbsByBoq[cs]) _wbsByBoq[cs].push(r);
        else {
          // WBS whose BOQ UUID isn't in _wbsByBoq — add anyway
          if (!_wbsByBoq[cs]) _wbsByBoq[cs] = [];
          _wbsByBoq[cs].push(r);
        }
      });

      // Load existing workplan rows → populate _cells and _weights
      _cells = {}; _weights = {};
      (wp || []).filter(byP).forEach(r => {
        const boqU = g(r,'BOQ UUID');
        const wbsU = g(r,'WBS UUID');
        if (!boqU && !wbsU) return;
        const key  = rk(boqU, wbsU);
        initCells(key, r);
        _weights[key] = Number(g(r,'% Weight')) || 0;
      });

      renderTable();
      updateKPIs();
      setStatus(`${_boq.length} BOQ · ${_wbs.length} WBS · FY ${_fy.label}`, 'green');
    } catch (e) {
      setStatus('Load failed', 'red');
      console.error('[Workplan]', e);
    }
  }

  // ── Render ───────────────────────────────────────────────────
  function renderTable() {
    const wrap = document.getElementById('wpTableWrap');
    if (!wrap || !_fy) return;
    const mths = _fy.months;
    const N    = mths.length;

    const head = `
    <thead>
      <tr>
        <th rowspan="2" class="wps wps0 wpl">BOQ</th>
        <th rowspan="2" class="wps wps1 wpl">WBS / Scope</th>
        <th rowspan="2" class="wps wps2">UoM</th>
        <th rowspan="2" class="wps wps3" style="text-align:right">BOQ Qty</th>
        <th colspan="${N}" class="wpmg" style="text-align:center">
          Monthly Planned Quantities · FY ${_fy.label}
        </th>
        <th rowspan="2" class="wpp">Planned</th>
        <th rowspan="2" class="wpw">% Wt</th>
      </tr>
      <tr>${mths.map(m => `<th class="wpm">${m.lbl}</th>`).join('')}</tr>
    </thead>`;

    let body = '';

    if (!_boq.length) {
      body = `<tr><td colspan="${4+N+2}" class="empty-cell" style="padding:24px">
        No BOQ items — add items in Step 2 (BOQ) first.
      </td></tr>`;
    } else {
      _boq.forEach((boqRow, bi) => {
        const boqUuid  = g(boqRow,'UUID')        || `_boq${bi}`;
        const boqItemN = g(boqRow,'BOQ Item #')  || g(boqRow,'S No') || String(bi+1);
        const boqDesc  = g(boqRow,'Description') || '(no description)';
        const boqUnit  = g(boqRow,'Unit')        || '';
        const boqQty   = Number(g(boqRow,'Qty')) || 0;
        const myWbs    = _wbsByBoq[boqUuid]      || [];

        // BOQ group header row
        body += `
        <tr class="wp-br">
          <td class="wps wps0 wp-br-n">${Utils.esc(boqItemN)}</td>
          <td class="wps wps1 wp-br-d">
            ${Utils.esc(boqDesc)}
            <span style="font-size:10px;font-weight:400;color:#4ade80;margin-left:6px">BOQ</span>
          </td>
          <td class="wps wps2 wp-ar-uom">${Utils.esc(boqUnit)}</td>
          <td class="wps wps3 wp-br-q">${boqQty ? fmtNum(boqQty) : '—'}</td>
          ${mths.map(() => '<td style="background:#f0fdf4;border-bottom:1px solid #a7f3d0"></td>').join('')}
          <td style="background:#f0fdf4;border-bottom:1px solid #a7f3d0"></td>
          <td style="background:#f0fdf4;border-bottom:1px solid #a7f3d0"></td>
        </tr>`;

        if (!myWbs.length) {
          body += `<tr class="wp-ir">
            <td class="wps wps0"></td>
            <td colspan="${3+N+2}">
              No WBS items — add via Step 3 (WBS) first.
            </td>
          </tr>`;
        } else {
          myWbs.forEach((wbsRow, wi) => {
            const wbsUuid = g(wbsRow,'UUID')        || `_wbs${wi}`;
            const wbsDesc = g(wbsRow,'Description') || g(wbsRow,'WBS Name') || '(unnamed)';
            const wbsUnit = g(wbsRow,'Unit')        || boqUnit;
            const wbsQty  = Number(g(wbsRow,'Qty')) || 0;
            const actNum  = g(wbsRow,'Activity #')  || (wi+1);
            const key     = rk(boqUuid, wbsUuid);
            const cd      = initCells(key);
            const planTot = rowTotal(key);
            const wt      = _weights[key] || 0;
            const refQty  = wbsQty || boqQty;

            const planClass = planTot === 0 ? 'p-nil'
              : Math.abs(planTot - refQty) < 0.01 ? 'p-ok'
              : planTot > refQty ? 'p-hi' : 'p-lo';

            const planId = 'plan_' + key.replace(/[^a-z0-9]/gi,'_');

            body += `
            <tr class="wp-ar" data-key="${key}" data-ref-qty="${refQty}">
              <td class="wps wps0 wp-ar-uom mono" style="font-size:10px;color:var(--text-faint)">
                ${Utils.esc(boqItemN)}
              </td>
              <td class="wps wps1">
                <div class="wp-ar-name">
                  <span class="mono" style="font-size:10px;color:#1e3a8a;font-weight:700;margin-right:6px">#${actNum}</span>
                  ${Utils.esc(wbsDesc)}
                </div>
              </td>
              <td class="wps wps2 wp-ar-uom">${Utils.esc(wbsUnit)}</td>
              <td class="wps wps3 wp-ar-qty">${refQty ? fmtNum(refQty) : '—'}</td>
              ${mths.map(m => {
                const val = cd[m.f] || 0;
                return `<td class="wptd-m">
                  <input type="number" class="wp-mi${val?' nz':''}"
                         value="${val||''}" step="0.01" min="0" placeholder="0"
                         data-key="${key}" data-month="${m.f}"
                         oninput="PAGE.updateCell(this)" />
                </td>`;
              }).join('')}
              <td class="wptd-p ${planClass}" id="${planId}">
                ${planTot ? fmtNum(planTot) : '—'}
              </td>
              <td class="wptd-m">
                <input type="number" class="wp-wi" value="${wt||''}"
                       step="0.1" min="0" max="100" placeholder="%"
                       data-key="${key}" oninput="PAGE.updateWeight(this)" />
              </td>
            </tr>`;
          });
        }
      });
    }

    wrap.innerHTML = `
    <table class="wp-table" id="wpTable">
      <colgroup>
        <col style="width:52px">  <!-- BOQ # -->
        <col style="min-width:180px;width:220px"> <!-- WBS -->
        <col style="width:65px">  <!-- UoM -->
        <col style="width:90px">  <!-- BOQ Qty -->
        ${mths.map(() => '<col style="width:68px">').join('')}
        <col style="width:90px">  <!-- Planned -->
        <col style="width:65px">  <!-- % Wt -->
      </colgroup>
      ${head}
      <tbody>${body}</tbody>
    </table>`;
  }

  // ── Cell update ──────────────────────────────────────────────
  function updateCell(inp) {
    const key   = inp.dataset.key;
    const month = inp.dataset.month;
    const val   = Number(inp.value) || 0;
    if (!_cells[key]) initCells(key);
    _cells[key][month] = val;
    inp.classList.toggle('nz', val > 0);

    const tot    = rowTotal(key);
    const planEl = document.getElementById('plan_' + key.replace(/[^a-z0-9]/gi,'_'));
    const refQty = Number(inp.closest('tr')?.dataset.refQty || 0);
    if (planEl) {
      planEl.textContent = tot ? fmtNum(tot) : '—';
      planEl.className = 'wptd-p ' +
        (tot === 0 ? 'p-nil' :
         Math.abs(tot - refQty) < 0.01 ? 'p-ok' :
         tot > refQty ? 'p-hi' : 'p-lo');
    }
    updateKPIs();
  }

  function updateWeight(inp) {
    _weights[inp.dataset.key] = Number(inp.value) || 0;
    updateKPIs();
  }

  // ── KPIs ─────────────────────────────────────────────────────
  function updateKPIs() {
    const totalBoqQty  = _boq.reduce((s,r) => s + (Number(g(r,'Qty')) || 0), 0);
    const totalPlanned = Object.values(_cells)
      .reduce((s,d) => s + (_fy?.months||[]).reduce((ss,m) => ss + (Number(d[m.f])||0), 0), 0);
    const totalWt = Object.values(_weights).reduce((s,w) => s + (Number(w)||0), 0);

    setEl('kpiBOQ',      _boq.length);
    setEl('kpiWBS',      _wbs.length);
    setEl('kpiActs',     Object.keys(_cells).length);
    setEl('kpiBOQQty',   totalBoqQty > 0 ? fmtNum(totalBoqQty) : '—');
    setEl('kpiPlanned',  totalPlanned > 0 ? fmtNum(totalPlanned) : '—');
    setEl('kpiWt',       totalWt.toFixed(1) + '%');

    const wtEl = document.getElementById('kpiWt');
    if (wtEl) wtEl.style.color =
      Math.abs(totalWt - 100) < 0.5 ? '#16a34a' : totalWt > 100 ? '#dc2626' : '#b45309';
  }

  // ── Save ─────────────────────────────────────────────────────
  async function save() {
    const ap = _ap || window.STATE.activeProject;
    if (!ap) { Utils.toast('Select a project first', 'err'); return; }
    if (!_fy) { Utils.toast('FY not set', 'err'); return; }

    const totalWt = Object.values(_weights).reduce((s,w) => s + (Number(w)||0), 0);
    if (totalWt > 0 && Math.abs(totalWt - 100) > 5) {
      if (!confirm(`% Weight total is ${totalWt.toFixed(1)}% (expected ~100%). Save anyway?`)) return;
    }

    const setBusy = b => {
      ['wpSaveBtn','wpSaveBtnB'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.disabled = b; el.textContent = b ? 'Saving…' : '💾 Save Workplan'; }
      });
    };
    setBusy(true);

    // ── Build one save row per WBS item ───────────────────────
    const saveRows = [];

    _boq.forEach((boqRow, bi) => {
      const boqUuid  = g(boqRow,'UUID')        || `_boq${bi}`;
      const boqItemN = g(boqRow,'BOQ Item #')  || g(boqRow,'S No') || String(bi+1);
      const boqDesc  = g(boqRow,'Description') || '';
      const boqQty   = Number(g(boqRow,'Qty')) || 0;
      const boqUnit  = g(boqRow,'Unit')        || '';
      const myWbs    = _wbsByBoq[boqUuid]      || [];

      myWbs.forEach((wbsRow, wi) => {
        const wbsUuid = g(wbsRow,'UUID')        || `_wbs${wi}`;
        const wbsCode = g(wbsRow,'WBS Code')    || '';
        const wbsDesc = g(wbsRow,'Description') || g(wbsRow,'WBS Name') || '';
        const wbsUnit = g(wbsRow,'Unit')        || boqUnit;
        const wbsQty  = Number(g(wbsRow,'Qty')) || 0;
        const actNum  = g(wbsRow,'Activity #')  || (wi+1);
        const key     = rk(boqUuid, wbsUuid);
        const cd      = _cells[key] || {};
        const planTot = _fy.months.reduce((s,m) => s + (Number(cd[m.f])||0), 0);

        const row = {
          'Project Code':    ap['Project Code'],
          'FY':              _fy.label,
          'BOQ Item #':      boqItemN,
          'BOQ UUID':        boqUuid,
          'BOQ Description': boqDesc,
          'WBS UUID':        wbsUuid,
          'WBS Code':        wbsCode,
          'WBS Name':        wbsDesc,
          'Activity #':      actNum,
          'UoM':             wbsUnit,
          'Total Qty':       boqQty,
          'WBS Qty':         wbsQty,
          'Planned Total':   planTot,
          '% Weight':        Number(_weights[key]) || 0,
        };
        _fy.months.forEach(m => { row[m.f] = Number(cd[m.f]) || 0; });
        saveRows.push(row);
      });
    });

    if (!saveRows.length) {
      Utils.toast('No WBS items to save — add WBS items in Step 3 first', 'err');
      setBusy(false); return;
    }

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

  // ── Helpers ──────────────────────────────────────────────────
  const g = (r, k) => {
    if (!r) return '';
    if (r[k] !== undefined && r[k] !== null) return String(r[k]).trim();
    const kl = k.toLowerCase();
    const f  = Object.keys(r).find(x => x.toLowerCase() === kl);
    return f ? String(r[f]||'').trim() : '';
  };
  function fmtNum(v) {
    const n = Number(String(v||'').replace(/,/g,''));
    return isNaN(n) ? String(v) : n.toLocaleString('en-IN');
  }
  function setEl(id, val) { const e=document.getElementById(id); if(e) e.textContent=String(val); }
  function setStatus(msg, color) {
    const el = document.getElementById('wpStatus');
    if (el) { el.textContent = msg; el.className = 'pill pill-'+color; }
  }
  function syncFromWBS() { return load(); }
  function onProjectChange() { load(); }
  function refresh() { return load(); }

  return { load, save, syncFromWBS, updateCell, updateWeight, onProjectChange, refresh };
})();
