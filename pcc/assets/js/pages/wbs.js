/* ════════════════════════════════════════════════════════════════
   Step 3 · WBS & Activities
   ────────────────────────────────────────────────────────────────
   Clear separation:
     +WBS      → right-side drawer → Description, Unit, Qty
                 saved to PL12_WBS (CheckSum = BOQ.UUID)
     +Activity → Master picker modal → ALWAYS from M_PL_1_Activities
                 saved to PL13_Activities (CheckSum = WBS.UUID)

   Hierarchy displayed:  BOQ → WBS → Activities
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function () {

  // ── State ───────────────────────────────────────────────────────
  let _ap         = null;
  let _boq        = [];  // BOQ rows
  let _wbs        = [];  // WBS rows  (PL12_WBS)
  let _acts       = [];  // Activity rows (PL13_Activities)
  let _masterActs = [];  // M_PL_1_Activities catalog

  // Dirty tracking — tracks pending changes to save
  let _wbsDirty   = false;
  let _actsDirty  = false;

  // Drawer state — which BOQ is the +WBS drawer for
  let _drawerBoqUuid   = '';
  let _drawerBoqDesc   = '';
  let _drawerBoqId     = '';
  let _drawerBoqIdDesc = '';

  // Master picker state — which WBS the picker is adding to
  let _pickerWbsUuid  = '';
  let _pickerWbsLabel = '';
  let _mpSelected     = new Set();  // indices into _mpRows
  let _mpRows         = [];         // filtered master rows

  // Expand/collapse state per WBS UUID
  const _expanded = {};
  const isOpen = uuid => _expanded[uuid] !== false;

  const g = (r, k) => {
    if (!r) return '';
    if (r[k] !== undefined && r[k] !== null) return String(r[k]).trim();
    const kl = k.toLowerCase();
    const f  = Object.keys(r).find(x => x.toLowerCase() === kl);
    return f ? String(r[f] || '').trim() : '';
  };

  // ── Load ────────────────────────────────────────────────────────
  async function load() {
    const ap = window.STATE.activeProject;
    if (!ap) {
      document.getElementById('wbsPanels').innerHTML =
        '<div class="tree-empty" style="padding:24px">No project selected — use the project switcher.</div>';
      return;
    }
    _ap = ap;
    setEl('kWbsProj', ap['Project Code'] || '—');

    const code = ap['Project Code'];
    const byP  = r => (g(r,'Project Code') || g(r,'ProjectCode') || '') === code;

    try {
      const [boq, wbs, acts, mActs] = await Promise.all([
        API.gviz(window.CONFIG.TABS.BOQ).catch(() => []),
        API.gviz(window.CONFIG.TABS.WBS).catch(() => []),
        API.gviz(window.CONFIG.TABS.ACTIVITIES).catch(() => []),
        API.gviz(window.CONFIG.TABS.M_ACTIVITIES).catch(() => []),
      ]);

      _boq        = (boq   || []).filter(byP);
      _wbs        = (wbs   || []).filter(byP);
      _acts       = (acts  || []).filter(byP);
      _masterActs = mActs  || [];
      _wbsDirty   = false;
      _actsDirty  = false;

      render();
    } catch (e) {
      console.error('[WBS]', e);
      document.getElementById('wbsPanels').innerHTML =
        `<div class="tree-empty" style="padding:24px;color:#c43">Load failed: ${Utils.esc(e.message)}</div>`;
    }
  }

  // ── Render ──────────────────────────────────────────────────────
  function render() {
    const container = document.getElementById('wbsPanels');
    if (!container) return;

    // Build maps
    const wbsByBoq  = {};  // boqUuid → [wbsRow]
    const actsByWbs = {};  // wbsUuid → [actRow]

    _boq.forEach(r => { wbsByBoq[g(r,'UUID')] = []; });
    _wbs.forEach(r => {
      const cs = g(r,'CheckSum');
      if (wbsByBoq[cs]) wbsByBoq[cs].push(r);
    });
    _wbs.forEach(r => { actsByWbs[g(r,'UUID')] = []; });
    _acts.forEach(r => {
      const cs = g(r,'CheckSum');
      if (actsByWbs[cs]) actsByWbs[cs].push(r);
    });

    setEl('kpiBOQ', _boq.length);
    setEl('kpiWBS', _wbs.length);
    setEl('kpiAct', _acts.length);

    if (!_boq.length) {
      container.innerHTML = '<div class="tree-empty" style="padding:24px">No BOQ items — add items in Step 2 (BOQ) first.</div>';
      return;
    }

    let html = '';

    _boq.forEach((boqRow, bi) => {
      const boqUuid  = g(boqRow,'UUID')        || `_boq${bi}`;
      const boqItemN = g(boqRow,'BOQ Item #')  || g(boqRow,'S No') || String(bi + 1);
      const boqDesc  = g(boqRow,'Description') || '(no description)';
      const boqUnit  = g(boqRow,'Unit')        || '';
      const boqQty   = Number(g(boqRow,'Qty')) || 0;
      const boqAmt   = Number(g(boqRow,'Amount'))|| 0;
      const boqId    = g(boqRow,'BOQ ID')      || (boqUuid + '-' + boqItemN);
      const boqIdDesc= g(boqRow,'BOQ ID (Description)') || (boqId + ' : ' + boqDesc);
      const myWbs    = wbsByBoq[boqUuid] || [];

      // Cache boq context for onclick (avoids escaping issues)
      window._WBS_CACHE = window._WBS_CACHE || {};
      const ck = 'addWbs_' + boqUuid;
      window._WBS_CACHE[ck] = { boqUuid, boqDesc, boqId, boqIdDesc };

      html += `
      <div class="wbs-boq-card">
        <div class="wbs-boq-hdr">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="wbs-boq-badge">${Utils.esc(boqItemN)}</span>
            <span class="wbs-boq-title">${Utils.esc(boqDesc)}</span>
            <span class="wbs-boq-meta">${boqUnit ? Utils.esc(boqUnit) : ''}${boqQty ? ' · ' + fmtNum(boqQty) : ''}${boqAmt ? ' · ₹' + fmtNum(boqAmt) : ''}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="pill ${myWbs.length ? 'pill-green' : 'pill-gold'}" style="font-size:10px">${myWbs.length} WBS</span>
            <button class="btn btn-primary btn-sm"
                    onclick="PAGE.openWbsDrawer(window._WBS_CACHE['${ck}'])"
                    style="font-size:11px">+ Add WBS</button>
          </div>
        </div>

        ${!myWbs.length ? `
        <div style="padding:12px 16px;font-size:12px;color:var(--text-faint);font-style:italic">
          No WBS items yet — click <strong>+ Add WBS</strong> to add work packages.
        </div>` : myWbs.map(wbsRow => {
          const wbsUuid = g(wbsRow,'UUID')        || '';
          const actNum  = g(wbsRow,'Activity #')  || '';
          const wbsDesc = g(wbsRow,'Description') || g(wbsRow,'WBS Name') || '(unnamed)';
          const wbsUnit = g(wbsRow,'Unit')        || '';
          const wbsQty  = Number(g(wbsRow,'Qty')) || 0;
          const myActs  = actsByWbs[wbsUuid] || [];
          const open    = isOpen(wbsUuid);

          const ckWbs = 'addAct_' + wbsUuid;
          window._WBS_CACHE[ckWbs] = { wbsUuid, wbsLabel: (actNum ? '#'+actNum+' · ' : '') + wbsDesc };

          return `
          <div class="wbs-item">
            <div class="wbs-item-hdr" onclick="PAGE.toggleWbs('${wbsUuid}')">
              <span class="wbs-chevron">${open ? '▼' : '▶'}</span>
              <span class="wbs-act-num">${actNum || '—'}</span>
              <span class="wbs-desc">${Utils.esc(wbsDesc)}</span>
              <span class="wbs-unit">${Utils.esc(wbsUnit)}</span>
              <span class="wbs-qty">${wbsQty ? fmtNum(wbsQty) : '—'}</span>
              <span class="pill ${myActs.length ? 'pill-green' : 'pill-gold'}" style="font-size:10px;margin-left:8px">${myActs.length} act</span>
              <button class="btn btn-secondary btn-sm"
                      onclick="event.stopPropagation();PAGE.openMasterPicker(window._WBS_CACHE['${ckWbs}'])"
                      style="font-size:11px;color:#1e3a8a;border-color:#c7d2fe;margin-left:8px">
                + Activity
              </button>
            </div>
            ${open ? `
            <div class="act-section">
              ${!myActs.length ? `<div class="act-empty">No activities yet — click <strong>+ Activity</strong> to add from Masters.</div>` : `
              <table class="act-table">
                <thead>
                  <tr>
                    <th style="width:28px">#</th>
                    <th>Activity</th>
                    <th style="width:140px">Nature of Work</th>
                    <th style="width:150px">Type of Work</th>
                    <th style="width:70px">UoM</th>
                    <th style="width:90px;text-align:right">BOQ Qty</th>
                    <th style="width:36px"></th>
                  </tr>
                </thead>
                <tbody>
                  ${myActs.map((a, ai) => {
                    const actIdx = _acts.indexOf(a);
                    return `
                    <tr>
                      <td style="text-align:center;font-size:10px;color:var(--text-faint)">${ai+1}</td>
                      <td><div class="act-name">${Utils.esc(g(a,'Activity')||'—')}</div></td>
                      <td><span class="act-nature">${Utils.esc(g(a,'Nature of Work')||'—')}</span></td>
                      <td><span class="act-type">${Utils.esc(g(a,'Type of Work')||'—')}</span></td>
                      <td class="act-uom">${Utils.esc(g(a,'Unit')||'—')}</td>
                      <td class="act-boqqty">${g(a,'BOQ Qty')||'—'}</td>
                      <td class="act-del">
                        <button class="btn-icon danger" title="Remove"
                                onclick="PAGE.removeActivity(${actIdx})">×</button>
                      </td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>`}
            </div>` : ''}
          </div>`;
        }).join('')}
      </div>`;
    });

    container.innerHTML = html;
  }

  function toggleWbs(uuid) {
    _expanded[uuid] = !isOpen(uuid);
    render();
  }

  function removeActivity(idx) {
    if (idx < 0 || idx >= _acts.length) return;
    _acts.splice(idx, 1);
    _actsDirty = true;
    render();
  }

  // ── WBS Drawer ──────────────────────────────────────────────────
  function openWbsDrawer(ctx) {
    _drawerBoqUuid   = ctx.boqUuid   || '';
    _drawerBoqDesc   = ctx.boqDesc   || '';
    _drawerBoqId     = ctx.boqId     || '';
    _drawerBoqIdDesc = ctx.boqIdDesc || '';

    const sub = document.getElementById('wdSub');
    if (sub) sub.textContent = _drawerBoqDesc.slice(0,48);

    // Clear form
    ['wdDesc','wdUnit','wdQty'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    document.getElementById('wbsDrawer').classList.add('wd-open');
    document.getElementById('wbsDrawerOverlay').style.display = 'block';
    setTimeout(() => document.getElementById('wdDesc')?.focus(), 200);
  }

  function closeWbsDrawer() {
    document.getElementById('wbsDrawer').classList.remove('wd-open');
    document.getElementById('wbsDrawerOverlay').style.display = 'none';
  }

  async function saveWbsFromDrawer() {
    const desc = (document.getElementById('wdDesc')?.value || '').trim();
    const unit = (document.getElementById('wdUnit')?.value || '').trim();
    const qty  = Number(document.getElementById('wdQty')?.value  || 0);

    if (!desc) { Utils.toast('Description is required', 'err'); return; }
    if (!_ap)  { Utils.toast('No active project', 'err'); return; }

    const btn = document.getElementById('wdSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    // Existing WBS for this BOQ (as nodes for the save call)
    const existingForBoq = _wbs
      .filter(r => g(r,'CheckSum') === _drawerBoqUuid)
      .map(r => ({
        uuid:        g(r,'UUID'),
        checkSum:    g(r,'CheckSum'),
        boqId:       g(r,'BOQ ID'),
        boqIdDesc:   g(r,'BOQ ID (Description)'),
        description: g(r,'Description') || g(r,'WBS Name'),
        unit:        g(r,'Unit'),
        qty:         Number(g(r,'Qty')) || 0,
      }));

    existingForBoq.push({
      uuid: '', checkSum: _drawerBoqUuid,
      boqId: _drawerBoqId, boqIdDesc: _drawerBoqIdDesc,
      description: desc, unit, qty,
    });

    try {
      const r = await API.scriptCall('saveWBS', {
        projectCode: _ap['Project Code'],
        projectName: _ap['Project Name'] || '',
        siteName:    _ap['Site Name']    || '',
        userEmail:   (window.STATE.user && (window.STATE.user.email || window.STATE.user.Email)) || '',
        nodes: existingForBoq,
        activities: [],
      });

      if (r && r.success) {
        Utils.toast('WBS item added ✓', 'ok');
        closeWbsDrawer();
        await load();
      } else {
        Utils.toast((r && r.message) || 'Save failed', 'err');
      }
    } catch (e) {
      Utils.toast('Error: ' + e.message, 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Add WBS Item'; }
    }
  }

  // ── Master Activity Picker ──────────────────────────────────────
  function openMasterPicker(ctx) {
    _pickerWbsUuid  = ctx.wbsUuid   || '';
    _pickerWbsLabel = ctx.wbsLabel  || '—';
    _mpSelected     = new Set();

    const lbl = document.getElementById('mpWbsLabel');
    if (lbl) lbl.textContent = _pickerWbsLabel;

    const search = document.getElementById('mpSearch');
    if (search) search.value = '';

    document.getElementById('mpModal').classList.add('mp-open');
    _buildMasterTable('');
    setTimeout(() => document.getElementById('mpSearch')?.focus(), 100);
  }

  function closeMasterPicker() {
    document.getElementById('mpModal').classList.remove('mp-open');
    _mpSelected = new Set();
    _mpRows     = [];
  }

  function filterMaster() {
    _buildMasterTable(document.getElementById('mpSearch')?.value || '');
  }

  function _buildMasterTable(q) {
    const tbody = document.getElementById('mpTbody');
    if (!tbody) return;
    const ql  = q.toLowerCase();
    let rows  = _masterActs;
    if (ql) rows = rows.filter(r =>
      (g(r,'Activity')||'').toLowerCase().includes(ql) ||
      (g(r,'Nature of Work')||'').toLowerCase().includes(ql) ||
      (g(r,'Type of Work')||'').toLowerCase().includes(ql)
    );
    _mpRows = rows;

    const totalSel = _mpSelected.size;
    setEl('mpSelCount', totalSel + ' selected');
    setEl('mpCount', rows.length + ' of ' + _masterActs.length);

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--text-faint)">No matches</td></tr>';
      return;
    }

    tbody.innerHTML = rows.slice(0, 400).map((r, i) => {
      const isSel = _mpSelected.has(i);
      return `
      <tr class="${isSel ? 'mp-selected' : ''}" onclick="PAGE._mpToggle(${i})">
        <td style="text-align:center">
          <input type="checkbox" ${isSel ? 'checked' : ''} onclick="event.stopPropagation();PAGE._mpToggle(${i})" />
        </td>
        <td><strong class="act-name">${Utils.esc(g(r,'Activity')||'—')}</strong></td>
        <td><span class="act-nature">${Utils.esc(g(r,'Nature of Work')||'—')}</span></td>
        <td><span class="act-type">${Utils.esc(g(r,'Type of Work')||'—')}</span></td>
        <td class="act-uom">${Utils.esc(g(r,'Unit')||'—')}</td>
      </tr>`;
    }).join('');
  }

  function _mpToggle(i) {
    if (_mpSelected.has(i)) _mpSelected.delete(i);
    else _mpSelected.add(i);
    setEl('mpSelCount', _mpSelected.size + ' selected');
    // Update row class + checkbox
    const rows = document.getElementById('mpTbody')?.querySelectorAll('tr');
    if (rows && rows[i]) {
      rows[i].classList.toggle('mp-selected', _mpSelected.has(i));
      const cb = rows[i].querySelector('input[type=checkbox]');
      if (cb) cb.checked = _mpSelected.has(i);
    }
  }

  function confirmMasterPick() {
    if (!_mpSelected.size) { Utils.toast('Select at least one activity', 'err'); return; }
    if (!_pickerWbsUuid)   { Utils.toast('No WBS selected', 'err'); return; }

    let added = 0;
    _mpSelected.forEach(i => {
      const r    = _mpRows[i];
      if (!r) return;
      const act  = g(r,'Activity') || '';
      // Avoid duplicate activities in same WBS
      const exists = _acts.some(a => g(a,'Activity') === act && g(a,'CheckSum') === _pickerWbsUuid);
      if (!exists) {
        _acts.push({
          'Project Code':   _ap ? _ap['Project Code'] : '',
          'Activity':       act,
          'CheckSum':       _pickerWbsUuid,
          'Nature of Work': g(r,'Nature of Work') || '',
          'Type of Work':   g(r,'Type of Work')   || '',
          'Unit':           g(r,'Unit')            || '',
          'BOQ Qty':        Number(g(r,'BOQ Qty')) || 0,
          'Master UUID':    g(r,'UUID')            || '',
          'Task Code':      g(r,'Task Code')       || '',
          '_isNew':         true,
        });
        added++;
      }
    });

    _actsDirty = true;
    closeMasterPicker();
    render();
    Utils.toast(`Added ${added} activit${added === 1 ? 'y' : 'ies'} ✓`, 'ok');
  }

  // ── Save ────────────────────────────────────────────────────────
  async function save() {
    if (!_ap) { Utils.toast('Select a project first', 'err'); return; }

    const setBusy = b => {
      ['wbsSaveBtn','wbsSaveBtnB'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.disabled = b; el.textContent = b ? 'Saving…' : '💾 Save All'; }
      });
    };
    setBusy(true);

    // Build WBS nodes from _wbs
    const nodes = _wbs.map(r => ({
      uuid:        g(r,'UUID'),
      checkSum:    g(r,'CheckSum'),
      boqId:       g(r,'BOQ ID'),
      boqIdDesc:   g(r,'BOQ ID (Description)'),
      description: g(r,'Description') || g(r,'WBS Name'),
      unit:        g(r,'Unit'),
      qty:         Number(g(r,'Qty')) || 0,
    }));

    // Build activities from _acts
    const activities = _acts.map(r => ({
      parentRef:    g(r,'CheckSum'),
      name:         g(r,'Activity'),
      natureOfWork: g(r,'Nature of Work'),
      typeOfWork:   g(r,'Type of Work'),
      unit:         g(r,'Unit'),
      costCode:     g(r,'Cost Code'),
      boqQty:       Number(g(r,'BOQ Qty')) || 0,
      masterUuid:   g(r,'Master UUID'),
      taskCode:     g(r,'Task Code'),
    }));

    try {
      const r = await API.scriptCall('saveWBS', {
        projectCode: _ap['Project Code'],
        projectName: _ap['Project Name'] || '',
        siteName:    _ap['Site Name']    || '',
        userEmail:   (window.STATE.user && (window.STATE.user.email || window.STATE.user.Email)) || '',
        nodes, activities,
      });
      if (r && r.success) {
        _wbsDirty = false; _actsDirty = false;
        Utils.toast(`Saved ${nodes.length} WBS + ${activities.length} activities ✓`, 'ok');
        if (window.Shell && Shell.stampSaved) Shell.stampSaved();
        await load();
      } else {
        Utils.toast((r && r.message) || 'Save failed', 'err');
      }
    } catch (e) {
      Utils.toast('Error: ' + e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────
  function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  }
  function fmtNum(v) {
    const n = Number(String(v || '').replace(/,/g, ''));
    return isNaN(n) ? String(v) : n.toLocaleString('en-IN');
  }
  function onProjectChange() { load(); }
  function refresh() { return load(); }

  return {
    load, save, render, toggleWbs, removeActivity,
    openWbsDrawer, closeWbsDrawer, saveWbsFromDrawer,
    openMasterPicker, closeMasterPicker, filterMaster,
    _mpToggle, confirmMasterPick,
    onProjectChange, refresh,
  };
})();
