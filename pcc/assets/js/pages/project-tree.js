/* ════════════════════════════════════════════════════════════════
   Project Tree  ·  Read + Write
   ────────────────────────────────────────────────────────────────
   Tree levels:
     📁 Project  →  📋 BOQ  →  🌳 WBS  →  🔧 Activity

   Drawer opens for:
     +BOQ      → add under project
     +WBS      → add under a BOQ row
     +Activity → add under a WBS row
     click row → edit that row (same form, pre-filled)
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function () {

  // ── Data state ─────────────────────────────────────────────────
  let project    = null;
  let boqRows    = [];
  let wbsRows    = [];
  let actRows    = [];
  let costCodes  = [];
  let masterActs = [];   // M_PL_1_Activities catalog
  let z12        = [];   // Z12 Nature/Type/UoM

  // Collapse state — nodeId → boolean (default: open)
  let _expanded  = {};

  // ── Drawer state ───────────────────────────────────────────────
  // mode: 'boq' | 'wbs' | 'activity'
  // ctx:  context object — who is the parent / what is being edited
  let _drawer = { open: false, mode: null, ctx: {} };

  // ── Load ───────────────────────────────────────────────────────
  async function load() {
    const ap = window.STATE.activeProject;
    if (!ap) { setStatus('No project selected', 'gold'); return; }
    project = ap;
    document.getElementById('treeProjCode').textContent = ap['Project Code'] || '—';
    document.getElementById('treeProjName').textContent = ap['Project Name'] || '(no name)';
    setStatus('Loading…', 'gold');
    const code = ap['Project Code'];
    try {
      const [boq, wbs, act, cc, mAct, z12raw] = await Promise.all([
        API.gviz(window.CONFIG.TABS.BOQ).catch(() => []),
        API.gviz(window.CONFIG.TABS.WBS).catch(() => []),
        API.gviz(window.CONFIG.TABS.ACTIVITIES).catch(() => []),
        API.gviz(window.CONFIG.TABS.COSTCODE).catch(() => []),
        API.gviz(window.CONFIG.TABS.M_ACTIVITIES).catch(() => []),
        API.gviz(window.CONFIG.Z12_TAB, window.CONFIG.Z12_SHEET_ID).catch(() => []),
      ]);
      const byProj = r => (r['Project Code'] || r['ProjectCode'] || '') === code;
      boqRows    = (boq  || []).filter(byProj);
      wbsRows    = (wbs  || []).filter(byProj);
      actRows    = (act  || []).filter(byProj);
      costCodes  = (cc   || []).map(r => ({ code: v(r,'Cost Code')||v(r,'Code')||'', name: v(r,'Description')||v(r,'Name')||'' })).filter(c => c.code);
      masterActs = mAct  || [];
      z12        = z12raw|| [];
      renderTree();
      setStatus(`${boqRows.length} BOQ · ${wbsRows.length} WBS · ${actRows.length} activities`, 'green');
    } catch (e) {
      setStatus('Load failed: ' + e.message, 'red');
    }
  }

  async function refresh() { await load(); }

  // ── Tree renderer ──────────────────────────────────────────────
  function renderTree(filter) {
    const c = document.getElementById('projectTree');
    if (!c || !project) return;
    const projId = v(project, 'UUID') || v(project, 'Project Code') || '';

    // Build typed node lists
    const boqNodes = boqRows.map((r, i) => ({
      uuid:    v(r,'UUID') || `_boq${i}`,
      checkSum:v(r,'CheckSum') || projId,
      sNo:     v(r,'S No') || String(i+1),
      desc:    v(r,'Description') || '',
      unit:    v(r,'Unit') || '',
      qty:     v(r,'Qty')  || '',
      rate:    v(r,'Rate') || '',
      amount:  v(r,'Amount') || '',
      _raw: r,
    }));

    const wbsNodes = wbsRows.map((r, i) => ({
      uuid:    v(r,'UUID') || `_wbs${i}`,
      checkSum:v(r,'CheckSum') || '',
      code:    v(r,'WBS Code') || `WBS-${String(i+1).padStart(3,'0')}`,
      name:    v(r,'WBS Name') || v(r,'Name') || '',
      _raw: r,
    }));

    const actNodes = actRows.map((r, i) => ({
      checkSum:    v(r,'CheckSum') || '',
      name:        v(r,'Activity') || '',
      nature:      v(r,'Nature of Work') || '',
      type:        v(r,'Type of Work')   || '',
      unit:        v(r,'Unit')           || '',
      costCode:    v(r,'Cost Code')      || '',
      boqQty:      v(r,'BOQ Qty')        || '',
      taskCode:    v(r,'Task Code')      || '',
      masterUuid:  v(r,'Master UUID')    || '',
      _raw: r,
    }));

    // Build linkage maps
    const boqUuids = new Set(boqNodes.map(b => b.uuid));
    const wbsByBoq = {}; boqNodes.forEach(b => wbsByBoq[b.uuid] = []);
    const wbsOrphan = [];
    wbsNodes.forEach(w => {
      if (w.checkSum && boqUuids.has(w.checkSum)) wbsByBoq[w.checkSum].push(w);
      else wbsOrphan.push(w);
    });

    const wbsUuids = new Set(wbsNodes.map(w => w.uuid));
    const actsByWbs = {}; wbsNodes.forEach(w => actsByWbs[w.uuid] = []);
    const actOrphan = [];
    actNodes.forEach(a => {
      if (a.checkSum && wbsUuids.has(a.checkSum)) actsByWbs[a.checkSum].push(a);
      else actOrphan.push(a);
    });

    const isOpen = id => _expanded[id] !== false;
    const projNodeId = 'proj_' + (project['Project Code'] || 'x');

    let html = `
    <div class="tree-project" id="${projNodeId}">
      <div class="tree-row level-0">
        <button class="tree-toggle" onclick="PAGE.toggle('${projNodeId}')">${isOpen(projNodeId)?'▼':'▶'}</button>
        <span class="tree-icon">📁</span>
        <span class="tree-label">
          <strong>${Utils.esc(project['Project Code']||'—')}</strong>
          <span class="tree-meta"> · ${Utils.esc(project['Project Name']||'')}</span>
        </span>
        <span class="tree-badges">
          ${badge(boqNodes.length,'BOQ','green')}
          ${badge(wbsNodes.length,'WBS','blue')}
          ${badge(actNodes.length,'act','gold')}
        </span>
        <button class="tree-add-btn" onclick="PAGE.openDrawer('boq',{mode:'add',parentId:'${projId}'})" title="Add BOQ item">+ BOQ</button>
      </div>
      ${isOpen(projNodeId) ? `<div class="tree-children">${renderBOQLevel(boqNodes,wbsByBoq,actsByWbs,wbsOrphan,actOrphan)}</div>` : ''}
    </div>`;

    c.innerHTML = html;
  }

  function renderBOQLevel(boqNodes, wbsByBoq, actsByWbs, wbsOrphan, actOrphan) {
    if (!boqNodes.length && !wbsOrphan.length)
      return `<div class="tree-empty">No BOQ items yet — click <strong>+ BOQ</strong> above.</div>`;

    const isOpen = id => _expanded[id] !== false;
    let html = '';

    boqNodes.forEach(b => {
      const nodeId = 'boq_' + b.uuid;
      const myWbs  = wbsByBoq[b.uuid] || [];
      const myActs = myWbs.reduce((n,w) => n + (actsByWbs[w.uuid]||[]).length, 0);
      const amt    = b.amount ? ' · ₹' + fmtNum(b.amount) : '';

      html += `
      <div class="tree-boq" id="${nodeId}">
        <div class="tree-row level-1">
          <button class="tree-toggle" onclick="PAGE.toggle('${nodeId}')">${isOpen(nodeId)?'▼':'▶'}</button>
          <span class="tree-icon">📋</span>
          <span class="tree-sno mono">${Utils.esc(b.sNo)}</span>
          <span class="tree-label" onclick="PAGE.openDrawer('boq',{mode:'edit',row:${JSON.stringify(b).replace(/"/g,"'")}})" style="cursor:pointer" title="Click to edit">
            <strong>${Utils.esc(b.desc||'(no description)')}</strong>
            <span class="tree-meta">${Utils.esc(b.unit)} ${b.qty?'· Qty: '+b.qty:''}${amt}</span>
          </span>
          <span class="tree-badges">${badge(myWbs.length,'WBS','blue')}${badge(myActs,'act','gold')}</span>
          <button class="tree-add-btn" onclick="PAGE.openDrawer('wbs',{mode:'add',boqUuid:'${b.uuid}',boqDesc:'${Utils.esc(b.desc)}'})" title="Add WBS node">+ WBS</button>
          <button class="tree-edit-btn" onclick="PAGE.openDrawer('boq',{mode:'edit',uuid:'${b.uuid}',sNo:'${b.sNo}',desc:'${Utils.esc(b.desc)}',unit:'${Utils.esc(b.unit)}',qty:'${b.qty}',rate:'${b.rate}',amount:'${b.amount}',checkSum:'${b.checkSum}'})" title="Edit">✏️</button>
        </div>
        ${isOpen(nodeId) ? `<div class="tree-children">${renderWBSLevel(myWbs, actsByWbs, b.uuid)}</div>` : ''}
      </div>`;
    });

    if (wbsOrphan.length) {
      const nodeId = 'boq_orphan';
      html += `
      <div class="tree-boq unlinked" id="${nodeId}">
        <div class="tree-row level-1 unlinked-row">
          <button class="tree-toggle" onclick="PAGE.toggle('${nodeId}')">${isOpen(nodeId)?'▼':'▶'}</button>
          <span class="tree-icon">📋</span>
          <span class="tree-label" style="color:var(--gold)"><strong>WBS not linked to a BOQ</strong><span class="tree-meta"> · assign a BOQ to link</span></span>
          ${badge(wbsOrphan.length,'WBS','gold')}
        </div>
        ${isOpen(nodeId) ? `<div class="tree-children">${renderWBSLevel(wbsOrphan, actsByWbs, null)}</div>` : ''}
      </div>`;
    }
    return html;
  }

  function renderWBSLevel(wbsNodes, actsByWbs, boqUuid) {
    if (!wbsNodes.length)
      return `<div class="tree-empty">No WBS items — click <strong>+ WBS</strong> to add.</div>`;
    const isOpen = id => _expanded[id] !== false;
    let html = '';
    wbsNodes.forEach(w => {
      const nodeId = 'wbs_' + w.uuid;
      const myActs = actsByWbs[w.uuid] || [];
      html += `
      <div class="tree-wbs" id="${nodeId}">
        <div class="tree-row level-2">
          <button class="tree-toggle" onclick="PAGE.toggle('${nodeId}')">${isOpen(nodeId)?'▼':'▶'}</button>
          <span class="tree-icon">🌳</span>
          <span class="tree-sno mono green">${Utils.esc(w.code)}</span>
          <span class="tree-label" onclick="PAGE.openDrawer('wbs',{mode:'edit',uuid:'${w.uuid}',wbsCode:'${Utils.esc(w.code)}',wbsName:'${Utils.esc(w.name)}',boqUuid:'${w.checkSum}'})" style="cursor:pointer" title="Click to edit">
            <strong>${Utils.esc(w.name||'(unnamed)')}</strong>
          </span>
          ${badge(myActs.length,'act', myActs.length?'green':'grey')}
          <button class="tree-add-btn" onclick="PAGE.openDrawer('activity',{mode:'add',wbsUuid:'${w.uuid}',wbsCode:'${Utils.esc(w.code)}',wbsName:'${Utils.esc(w.name)}'})" title="Add activity">+ Activity</button>
          <button class="tree-edit-btn" onclick="PAGE.openDrawer('wbs',{mode:'edit',uuid:'${w.uuid}',wbsCode:'${Utils.esc(w.code)}',wbsName:'${Utils.esc(w.name)}',boqUuid:'${w.checkSum}'})" title="Edit">✏️</button>
        </div>
        ${isOpen(nodeId) ? `<div class="tree-children">${renderActLevel(myActs, w)}</div>` : ''}
      </div>`;
    });
    return html;
  }

  function renderActLevel(acts, wbsNode) {
    if (!acts.length)
      return `<div class="tree-empty">No activities — click <strong>+ Activity</strong> above.</div>`;
    return `
    <div class="tree-acts-wrap">
      <table class="tree-acts-table">
        <thead>
          <tr>
            <th>#</th><th>Activity</th><th>Nature</th>
            <th>Type of Work</th><th>UoM</th>
            <th style="text-align:right">BOQ Qty</th><th>Cost Code</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${acts.map((a, i) => `
          <tr onclick="PAGE.openDrawer('activity',{mode:'edit',idx:${i},wbsUuid:'${Utils.esc(wbsNode.uuid)}',wbsCode:'${Utils.esc(wbsNode.code)}',wbsName:'${Utils.esc(wbsNode.name)}',name:'${Utils.esc(a.name)}',nature:'${Utils.esc(a.nature)}',type:'${Utils.esc(a.type)}',unit:'${Utils.esc(a.unit)}',costCode:'${Utils.esc(a.costCode)}',boqQty:'${a.boqQty}',taskCode:'${Utils.esc(a.taskCode)}',masterUuid:'${Utils.esc(a.masterUuid)}',checkSum:'${Utils.esc(a.checkSum)}'})" style="cursor:pointer" title="Click to edit">
            <td class="mono">${i+1}</td>
            <td><strong>${Utils.esc(a.name)}</strong>${a.taskCode?`<div class="task-sub">${Utils.esc(a.taskCode)}</div>`:''}</td>
            <td style="color:var(--green);font-weight:600;font-size:11px">${Utils.esc(a.nature||'—')}</td>
            <td style="font-size:11px">${Utils.esc(a.type||'—')}</td>
            <td class="mono">${Utils.esc(a.unit||'—')}</td>
            <td class="mono" style="text-align:right">${a.boqQty||'—'}</td>
            <td style="font-size:11px;color:var(--text-faint)">${Utils.esc(a.costCode||'—')}</td>
            <td><span class="edit-hint">✏️</span></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

  // ── Drawer ─────────────────────────────────────────────────────
  function openDrawer(mode, ctx) {
    _drawer = { open: true, mode, ctx: ctx || {} };
    renderDrawer();
    document.getElementById('treeDrawer').classList.add('open');
    document.getElementById('projectTree').classList.add('tree-narrowed');
  }

  function closeDrawer() {
    _drawer = { open: false, mode: null, ctx: {} };
    document.getElementById('treeDrawer').classList.remove('open');
    document.getElementById('projectTree').classList.remove('tree-narrowed');
  }

  function renderDrawer() {
    const panel = document.getElementById('drawerContent');
    const { mode, ctx } = _drawer;
    const isEdit = ctx.mode === 'edit';

    let title = '', subtitle = '', body = '';

    if (mode === 'boq') {
      title    = isEdit ? '✏️ Edit BOQ Item' : '📋 Add BOQ Item';
      subtitle = isEdit
        ? `Editing: ${ctx.desc || '—'}`
        : `Project: ${project['Project Code'] || '—'}`;
      body = renderBOQForm(ctx, isEdit);
    } else if (mode === 'wbs') {
      title    = isEdit ? '✏️ Edit WBS Node' : '🌳 Add WBS Node';
      subtitle = isEdit
        ? `Editing: ${ctx.wbsName || ctx.wbsCode || '—'}`
        : `Under BOQ: ${ctx.boqDesc || ctx.boqUuid || '—'}`;
      body = renderWBSForm(ctx, isEdit);
    } else if (mode === 'activity') {
      title    = isEdit ? '✏️ Edit Activity' : '🔧 Add Activity';
      subtitle = `Under WBS: ${ctx.wbsCode || '—'} · ${ctx.wbsName || ''}`;
      body = renderActivityForm(ctx, isEdit);
    }

    panel.innerHTML = `
      <div class="drawer-header">
        <div>
          <div class="drawer-title">${title}</div>
          <div class="drawer-sub">${subtitle}</div>
        </div>
        <button class="btn-icon" onclick="PAGE.closeDrawer()" title="Close">×</button>
      </div>
      <div class="drawer-body">${body}</div>
      <div class="drawer-footer">
        <button class="btn btn-secondary" onclick="PAGE.closeDrawer()">Cancel</button>
        <button class="btn btn-primary" id="drawerSaveBtn" onclick="PAGE.drawerSave()">
          💾 ${isEdit ? 'Update' : 'Save'}
        </button>
      </div>`;
  }

  // ── BOQ Form ── (fields to be filled per spec)
  function renderBOQForm(ctx, isEdit) {
    return `
    <div class="drawer-form" id="drawerForm" data-mode="boq">
      <!-- ── Fields will be added per spec ── -->
      <div class="form-note info">📋 BOQ form fields will be populated per spec.</div>

      <div class="field">
        <label>Description <span class="req">*</span></label>
        <input type="text" id="df_desc" value="${Utils.esc(ctx.desc||'')}" placeholder="Work item description" />
      </div>
      <div class="form-grid cols-2">
        <div class="field">
          <label>Unit</label>
          <input type="text" id="df_unit" value="${Utils.esc(ctx.unit||'')}" placeholder="CUM / RMT / SQM…" />
        </div>
        <div class="field">
          <label>Qty</label>
          <input type="number" id="df_qty" value="${ctx.qty||''}" step="0.01" min="0" />
        </div>
      </div>
      <div class="form-grid cols-2">
        <div class="field">
          <label>Rate</label>
          <input type="number" id="df_rate" value="${ctx.rate||''}" step="0.01" min="0" oninput="PAGE._calcAmt()" />
        </div>
        <div class="field">
          <label>Amount</label>
          <input type="number" id="df_amount" value="${ctx.amount||''}" step="0.01" readonly />
        </div>
      </div>
      <!-- Hidden context -->
      <input type="hidden" id="df_uuid"     value="${ctx.uuid||''}" />
      <input type="hidden" id="df_checkSum" value="${ctx.checkSum||v(project,'UUID')||''}" />
      <input type="hidden" id="df_sNo"      value="${ctx.sNo||''}" />
    </div>`;
  }

  // ── WBS Form ── (fields to be filled per spec)
  function renderWBSForm(ctx, isEdit) {
    return `
    <div class="drawer-form" id="drawerForm" data-mode="wbs">
      <div class="form-note info">🌳 WBS form fields will be populated per spec.</div>

      <div class="field">
        <label>WBS Name <span class="req">*</span></label>
        <input type="text" id="df_wbsName" value="${Utils.esc(ctx.wbsName||'')}" placeholder="Description of this WBS scope" />
      </div>
      <div class="field">
        <label>WBS Code</label>
        <input type="text" id="df_wbsCode" value="${Utils.esc(ctx.wbsCode||'')}" readonly placeholder="Auto-generated on save" />
        <div class="field-note">Auto-generated by backend.</div>
      </div>
      <!-- Hidden context -->
      <input type="hidden" id="df_uuid"    value="${ctx.uuid||''}" />
      <input type="hidden" id="df_boqUuid" value="${ctx.boqUuid||''}" />
    </div>`;
  }

  // ── Activity Form ── (fields to be filled per spec)
  function renderActivityForm(ctx, isEdit) {
    const ccOpts = ['<option value="">— Cost Code —</option>']
      .concat(costCodes.map(c =>
        `<option value="${Utils.esc(c.code)}" ${c.code===ctx.costCode?'selected':''}>${Utils.esc(c.code)} · ${Utils.esc(c.name)}</option>`
      )).join('');

    return `
    <div class="drawer-form" id="drawerForm" data-mode="activity">
      <div class="form-note info">🔧 Activity form fields will be populated per spec.</div>

      <div class="field">
        <label>Activity <span class="req">*</span></label>
        ${isEdit
          ? `<input type="text" id="df_actName" value="${Utils.esc(ctx.name||'')}" readonly />
             <div class="field-note">Locked — from M_PL_1_Activities master.</div>`
          : `<div style="display:flex;gap:.5rem;align-items:center">
               <input type="text" id="df_actName" value="" readonly placeholder="Pick from master →" style="flex:1" />
               <button class="btn btn-secondary btn-sm" onclick="PAGE.openMasterPicker()">📚 Pick</button>
             </div>`
        }
      </div>
      <div class="form-grid cols-2">
        <div class="field">
          <label>Nature of Work</label>
          <input type="text" id="df_nature" value="${Utils.esc(ctx.nature||'')}" readonly />
        </div>
        <div class="field">
          <label>Type of Work</label>
          <input type="text" id="df_type" value="${Utils.esc(ctx.type||'')}" readonly />
        </div>
      </div>
      <div class="form-grid cols-2">
        <div class="field">
          <label>UoM</label>
          <input type="text" id="df_unit" value="${Utils.esc(ctx.unit||'')}" readonly />
        </div>
        <div class="field">
          <label>BOQ Qty</label>
          <input type="number" id="df_boqQty" value="${ctx.boqQty||''}" step="0.01" min="0" />
        </div>
      </div>
      <div class="field">
        <label>Cost Code</label>
        <select id="df_costCode">${ccOpts}</select>
      </div>
      <!-- Hidden context -->
      <input type="hidden" id="df_wbsUuid"    value="${ctx.wbsUuid||''}" />
      <input type="hidden" id="df_masterUuid" value="${ctx.masterUuid||''}" />
      <input type="hidden" id="df_checkSum"   value="${ctx.checkSum||''}" />
      <input type="hidden" id="df_taskCode"   value="${ctx.taskCode||''}" />
    </div>`;
  }

  // ── Amount auto-calc in BOQ form ───────────────────────────────
  function _calcAmt() {
    const qty    = Number(document.getElementById('df_qty')?.value  || 0);
    const rate   = Number(document.getElementById('df_rate')?.value || 0);
    const amtEl  = document.getElementById('df_amount');
    if (amtEl) amtEl.value = (qty * rate).toFixed(2);
  }

  // ── Drawer Save dispatcher ─────────────────────────────────────
  async function drawerSave() {
    const form = document.getElementById('drawerForm');
    if (!form) return;
    const mode = form.dataset.mode;
    const btn  = document.getElementById('drawerSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
      if (mode === 'boq')      await _saveBOQFromDrawer();
      else if (mode === 'wbs') await _saveWBSFromDrawer();
      else                     await _saveActivityFromDrawer();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = `💾 ${_drawer.ctx.mode==='edit'?'Update':'Save'}`; }
    }
  }

  async function _saveBOQFromDrawer() {
    const ap = window.STATE.activeProject;
    const qty  = Number(document.getElementById('df_qty')?.value  || 0);
    const rate = Number(document.getElementById('df_rate')?.value || 0);
    const row  = {
      uuid:     document.getElementById('df_uuid')?.value     || '',
      checkSum: document.getElementById('df_checkSum')?.value || v(ap,'UUID') || '',
      sno:      document.getElementById('df_sNo')?.value      || '',
      desc:     document.getElementById('df_desc')?.value     || '',
      unit:     document.getElementById('df_unit')?.value     || '',
      qty, rate, amt: qty * rate,
    };
    if (!row.desc) { Utils.toast('Description is required', 'err'); return; }

    // Collect all BOQ rows for this project, replace/add this one
    const existing = boqRows.map((r, i) => ({
      uuid:     v(r,'UUID') || '',
      checkSum: v(r,'CheckSum') || '',
      sno:      v(r,'S No') || String(i+1),
      desc:     v(r,'Description') || '',
      unit:     v(r,'Unit') || '',
      qty:      Number(v(r,'Qty') || 0),
      rate:     Number(v(r,'Rate') || 0),
      amt:      Number(v(r,'Amount') || 0),
    }));

    const idx = row.uuid ? existing.findIndex(e => e.uuid === row.uuid) : -1;
    if (idx >= 0) existing[idx] = { ...existing[idx], ...row };
    else existing.push(row);

    const r = await API.scriptCall('saveBOQ', {
      projectCode: ap['Project Code'],
      projectUuid: v(ap,'UUID') || '',
      rows: existing,
    });
    if (r && r.success) {
      Utils.toast(_drawer.ctx.mode==='edit' ? 'BOQ updated ✓' : 'BOQ item added ✓', 'ok');
      closeDrawer();
      await load();
    } else {
      Utils.toast((r && r.message) || 'Save failed', 'err');
    }
  }

  async function _saveWBSFromDrawer() {
    const ap = window.STATE.activeProject;
    const wbsName = document.getElementById('df_wbsName')?.value || '';
    const uuid    = document.getElementById('df_uuid')?.value    || '';
    const boqUuid = document.getElementById('df_boqUuid')?.value || '';
    if (!wbsName) { Utils.toast('WBS Name is required', 'err'); return; }

    // Build full WBS + activities payload (all existing + the one being added/edited)
    const allNodes = wbsRows.map((r, i) => ({
      uuid:    v(r,'UUID') || '',
      tempId:  '',
      wbsCode: v(r,'WBS Code') || '',
      wbsName: v(r,'WBS Name') || v(r,'Name') || '',
      boqRef:  v(r,'CheckSum') || '',
    }));

    const thisNode = { uuid, tempId: uuid ? '' : `_tmp_${Date.now()}`, wbsCode: '', wbsName, boqRef: boqUuid };
    const nodeIdx = uuid ? allNodes.findIndex(n => n.uuid === uuid) : -1;
    if (nodeIdx >= 0) allNodes[nodeIdx] = thisNode;
    else allNodes.push(thisNode);

    const allActs = actRows.map(r => ({
      parentRef:    v(r,'CheckSum') || '',
      name:         v(r,'Activity') || '',
      natureOfWork: v(r,'Nature of Work') || '',
      typeOfWork:   v(r,'Type of Work') || '',
      unit:         v(r,'Unit') || '',
      costCode:     v(r,'Cost Code') || '',
      boqQty:       Number(v(r,'BOQ Qty') || 0),
      masterUuid:   v(r,'Master UUID') || '',
      taskCode:     v(r,'Task Code') || '',
    }));

    const r = await API.scriptCall('saveWBS', {
      projectCode: ap['Project Code'],
      nodes: allNodes,
      activities: allActs,
    });
    if (r && r.success) {
      Utils.toast(_drawer.ctx.mode==='edit' ? 'WBS updated ✓' : 'WBS node added ✓', 'ok');
      closeDrawer();
      await load();
    } else {
      Utils.toast((r && r.message) || 'Save failed', 'err');
    }
  }

  async function _saveActivityFromDrawer() {
    const ap      = window.STATE.activeProject;
    const actName = document.getElementById('df_actName')?.value    || '';
    const wbsUuid = document.getElementById('df_wbsUuid')?.value    || '';
    const masterUuid= document.getElementById('df_masterUuid')?.value|| '';
    const checkSum= document.getElementById('df_checkSum')?.value   || '';
    const taskCode= document.getElementById('df_taskCode')?.value   || '';
    const nature  = document.getElementById('df_nature')?.value     || '';
    const type    = document.getElementById('df_type')?.value       || '';
    const unit    = document.getElementById('df_unit')?.value       || '';
    const boqQty  = Number(document.getElementById('df_boqQty')?.value || 0);
    const costCode= document.getElementById('df_costCode')?.value   || '';

    if (!actName) { Utils.toast('Pick an activity from master first', 'err'); return; }

    const allNodes = wbsRows.map(r => ({
      uuid:    v(r,'UUID') || '',
      tempId:  '',
      wbsCode: v(r,'WBS Code') || '',
      wbsName: v(r,'WBS Name') || '',
      boqRef:  v(r,'CheckSum') || '',
    }));

    const allActs = actRows.map(r => ({
      parentRef:    v(r,'CheckSum') || '',
      name:         v(r,'Activity') || '',
      natureOfWork: v(r,'Nature of Work') || '',
      typeOfWork:   v(r,'Type of Work') || '',
      unit:         v(r,'Unit') || '',
      costCode:     v(r,'Cost Code') || '',
      boqQty:       Number(v(r,'BOQ Qty') || 0),
      masterUuid:   v(r,'Master UUID') || '',
      taskCode:     v(r,'Task Code') || '',
    }));

    // If edit mode, find and replace the existing activity
    const isEdit = _drawer.ctx.mode === 'edit';
    const thisAct = { parentRef: wbsUuid, name: actName, natureOfWork: nature,
                      typeOfWork: type, unit, costCode, boqQty, masterUuid, taskCode };

    if (isEdit && checkSum) {
      const idx = allActs.findIndex(a => a.name===actName && a.parentRef===wbsUuid);
      if (idx>=0) allActs[idx] = thisAct;
    } else {
      allActs.push(thisAct);
    }

    const r = await API.scriptCall('saveWBS', {
      projectCode: ap['Project Code'],
      nodes: allNodes,
      activities: allActs,
    });
    if (r && r.success) {
      Utils.toast(isEdit ? 'Activity updated ✓' : 'Activity added ✓', 'ok');
      closeDrawer();
      await load();
    } else {
      Utils.toast((r && r.message) || 'Save failed', 'err');
    }
  }

  // ── Master Activity Picker (for Activity form) ─────────────────
  let _mpSelected = null;

  function openMasterPicker() {
    const overlay = document.getElementById('mpOverlay');
    if (!overlay) return;
    _mpSelected = null;
    _buildMPTable('');
    overlay.style.display = 'flex';
    setTimeout(() => document.getElementById('mpSearch')?.focus(), 60);
  }

  function closeMasterPicker() {
    const overlay = document.getElementById('mpOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  function filterMaster() { _buildMPTable(document.getElementById('mpSearch')?.value||''); }

  function _buildMPTable(q) {
    const tbody = document.getElementById('mpTbody');
    if (!tbody) return;
    const ql = q.toLowerCase();
    let rows = masterActs;
    if (ql) rows = rows.filter(r =>
      (r['Activity']||'').toLowerCase().includes(ql) ||
      (r['Nature of Work']||'').toLowerCase().includes(ql) ||
      (r['Type of Work']||'').toLowerCase().includes(ql)
    );
    document.getElementById('mpCount').textContent = rows.length + ' of ' + masterActs.length;
    tbody.innerHTML = rows.slice(0,300).map((r,i) => {
      const act = r['Activity']||''; const nat = r['Nature of Work']||''; const typ = r['Type of Work']||'';
      return `<tr onclick="PAGE._mpPick(${i})" style="cursor:pointer">
        <td><strong>${Utils.esc(act)}</strong></td>
        <td style="color:var(--green);font-size:11px">${Utils.esc(nat)}</td>
        <td style="font-size:11px">${Utils.esc(typ)}</td>
        <td class="mono">${Utils.esc(r['Unit']||'')}</td>
      </tr>`;
    }).join('');
    _mpRowCache = rows;
  }

  let _mpRowCache = [];
  function _mpPick(i) {
    const r = _mpRowCache[i];
    if (!r) return;
    // Fill drawer form fields
    const setV = (id, val) => { const el = document.getElementById(id); if (el) el.value = val||''; };
    setV('df_actName',    r['Activity']||'');
    setV('df_nature',     r['Nature of Work']||'');
    setV('df_type',       r['Type of Work']||'');
    setV('df_unit',       r['Unit']||'');
    setV('df_masterUuid', r['UUID']||'');
    setV('df_taskCode',   r['Task Code']||'');
    setV('df_checkSum',   r['CheckSum']||'');
    closeMasterPicker();
    Utils.toast('Activity selected: ' + (r['Activity']||''), 'ok');
  }

  // ── Helpers ────────────────────────────────────────────────────
  function v(row, key) {
    if (!row || !key) return '';
    if (row[key] !== undefined && row[key] !== null) return String(row[key]).trim();
    const kl = key.toLowerCase();
    const found = Object.keys(row).find(k => k.toLowerCase() === kl);
    return found ? String(row[found]||'').trim() : '';
  }

  function badge(count, label, color) {
    const map = { green:['#dcfce7','#166534'], blue:['#dbeafe','#1e3a8a'], gold:['#fef9c3','#92400e'], grey:['rgba(0,0,0,.05)','#888'] };
    const [bg,fg] = map[color] || map.grey;
    return `<span class="tree-badge" style="background:${bg};color:${fg}">${count} ${label}</span>`;
  }

  function fmtNum(v) {
    const n = Number(String(v).replace(/,/g,''));
    return isNaN(n) ? v : n.toLocaleString('en-IN');
  }

  function setStatus(msg, color) {
    const el = document.getElementById('treeStatus');
    if (el) { el.textContent = msg; el.className = 'pill pill-' + color; }
  }

  function toggle(nodeId) {
    _expanded[nodeId] = !(_expanded[nodeId] !== false);
    renderTree();
  }

  function expandAll()  { _getAllIds().forEach(id => { _expanded[id] = true;  }); renderTree(); }
  function collapseAll(){ _getAllIds().forEach(id => { _expanded[id] = false; }); renderTree(); }

  function _getAllIds() {
    const ids = [];
    if (project) ids.push('proj_' + (project['Project Code']||'x'));
    boqRows.forEach((r,i) => ids.push('boq_' + (v(r,'UUID')||`_boq${i}`)));
    ids.push('boq_orphan');
    wbsRows.forEach((r,i) => ids.push('wbs_' + (v(r,'UUID')||`_wbs${i}`)));
    return ids;
  }

  function onProjectChange() { load(); }
  function filter() {}

  return {
    load, refresh, toggle, expandAll, collapseAll,
    openDrawer, closeDrawer, renderDrawer, drawerSave,
    openMasterPicker, closeMasterPicker, filterMaster,
    _mpPick, _calcAmt, onProjectChange, filter,
  };
})();
