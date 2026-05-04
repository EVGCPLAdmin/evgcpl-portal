/* ════════════════════════════════════════════════════════════════
   Step 3 · WBS
   - Tree rendered from "WBS" tab (level inferred from code dots)
   - Activities table from "Activities" tab
   - Nature of Work / Type of Work driven by M_PL_1_Activities master
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function() {

  let nodes      = [];   // [{wbsCode, wbsName, natureOfWork, parent, level}]
  let activities = [];   // [{name, wbsCode, costCode, unit, boqQty, typeOfWork}]
  let costCodes  = [];

  // Master: { 'Earthwork': ['Excavation', 'Filling', ...], 'Concrete': [...] }
  let natureMap  = {};

  async function load() {
    const ap = window.STATE.activeProject;
    if (!ap) { Utils.toast('Select a project first', 'err'); return; }
    document.getElementById('kWbsProj').textContent     = ap['Project Code'] || '—';
    document.getElementById('kWbsProjName').textContent = ap['Project Name'] || '(no name)';

    setStatus('Loading…', 'gold');
    const code = ap['Project Code'];

    try {
      const [w, a, cc, mAct] = await Promise.all([
        API.gviz(window.CONFIG.TABS.WBS),
        API.gviz(window.CONFIG.TABS.ACTIVITIES),
        API.gviz(window.CONFIG.TABS.COSTCODE),
        API.gviz(window.CONFIG.TABS.M_ACTIVITIES).catch(() => []),
      ]);

      // Build natureMap from DISTINCT(Nature of Work, Type of Work) across the
      // entire org-wide master. M_PL_1_Activities is project-aware but we use
      // it here as a global lookup — every project sees every nature/type.
      // Cache on STATE so other pages can reuse without re-fetching.
      natureMap = {};
      (mAct || []).forEach(r => {
        const nat = String(r['Nature of Work'] || '').trim();
        const typ = String(r['Type of Work']   || '').trim();
        if (!nat) return;
        if (!natureMap[nat]) natureMap[nat] = new Set();
        if (typ) natureMap[nat].add(typ);
      });
      // Convert sets to sorted arrays
      Object.keys(natureMap).forEach(k => {
        natureMap[k] = [...natureMap[k]].sort();
      });
      window.STATE.natureMap     = natureMap;
      window.STATE.masterActivities = mAct || []; // raw rows for downstream pages

      nodes = (w || [])
        .filter(r => (r['Project Code'] || r['ProjectCode']) === code)
        .map(r => ({
          wbsCode:       String(r['WBS Code'] || r['Code'] || '').trim(),
          wbsName:       r['WBS Name'] || r['Name'] || r['Description'] || '',
          natureOfWork:  String(r['Nature of Work'] || r['Nature'] || '').trim(),
        }))
        .filter(n => n.wbsCode);

      activities = (a || [])
        .filter(r => (r['Project Code'] || r['ProjectCode']) === code)
        .map(r => ({
          name:        r['Activity'] || r['Activity Name'] || r['Name'] || '',
          wbsCode:     r['WBS Code'] || r['WBS'] || '',
          costCode:    r['Cost Code'] || r['CostCode'] || '',
          unit:        r['Unit'] || 'CUM',
          boqQty:      Number(r['BOQ Qty'] || r['Quantity'] || 0),
          typeOfWork:  String(r['Type of Work'] || r['Type'] || '').trim(),
          masterUuid:  String(r['Master UUID'] || r['UUID'] || '').trim(),
          checkSum:    String(r['CheckSum'] || '').trim(),
          taskCode:    String(r['Task Code'] || '').trim(),
        }))
        .filter(x => x.name);

      costCodes = (cc || []).map(r => ({
        code: r['Cost Code'] || r['Code'] || '',
        name: r['Description'] || r['Name'] || '',
      })).filter(c => c.code);

      // Derive level from dot count in code: "1" → 0, "1.2" → 1, "1.2.3" → 2
      nodes.forEach(n => { n.level = (n.wbsCode.match(/\./g) || []).length; });

      renderTree();
      renderActivities();
      updateKPIs();
      setStatus(nodes.length ? 'Loaded' : 'Empty', nodes.length ? 'green' : 'gold');
    } catch (e) {
      console.error(e);
      setStatus('Load failed', 'red');
      Utils.toast('Could not fetch WBS', 'err');
    }
  }

  function setStatus(msg, color) {
    const el = document.getElementById('wbsStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = 'pill pill-' + (color || 'green');
  }

  function renderTree(filter) {
    const c = document.getElementById('wbsTree');
    if (!c) return;
    let list = nodes;
    if (filter) {
      const ql = filter.toLowerCase();
      list = nodes.filter(n =>
        n.wbsCode.toLowerCase().includes(ql) ||
        String(n.wbsName).toLowerCase().includes(ql)
      );
    }
    if (!list.length) {
      c.innerHTML = '<div class="plp-empty">No WBS nodes — click "+ Add Node" to start.</div>';
      return;
    }
    // Sort by code
    list = list.slice().sort((a, b) => natCmp(a.wbsCode, b.wbsCode));
    const natureKeys = Object.keys(natureMap).sort();
    const natureOpts = ['<option value="">— Nature of Work —</option>']
      .concat(natureKeys.map(k => `<option value="${Utils.esc(k)}">${Utils.esc(k)}</option>`))
      .join('');

    c.innerHTML = list.map(n => {
      const lvl = Math.min(n.level || 0, 3);
      // Count activities under this node (exact match + children prefix)
      const actCount = activities.filter(a =>
        a.wbsCode === n.wbsCode || String(a.wbsCode).startsWith(n.wbsCode + '.')
      ).length;
      const idx = nodes.indexOf(n);
      const natureSelected = n.natureOfWork
        ? natureOpts.replace(`value="${Utils.esc(n.natureOfWork)}"`, `value="${Utils.esc(n.natureOfWork)}" selected`)
        : natureOpts;
      return `<div class="wbs-node lvl-${lvl}">
        <span class="wbs-code">${Utils.esc(n.wbsCode)}</span>
        <span class="wbs-name">${Utils.esc(n.wbsName)}</span>
        <select class="wbs-nature unit-select" onchange="PAGE.editNode(${idx},'natureOfWork',this.value);PAGE.renderActivitiesPublic()" title="Nature of Work — drives Type-of-Work choices on activities under this WBS">
          ${natureSelected}
        </select>
        <span class="wbs-meta">${actCount} ${actCount === 1 ? 'activity' : 'activities'}</span>
      </div>`;
    }).join('');
  }

  // Public alias for cross-call from the inline onchange
  function renderActivitiesPublic() { renderActivities(); }

  function editNode(i, key, val) {
    if (!nodes[i]) return;
    nodes[i][key] = val;
  }

  function renderActivities() {
    const t = document.getElementById('actTbody');
    if (!t) return;
    if (!activities.length) {
      t.innerHTML = '<tr><td colspan="8" class="empty-cell">No activities yet.</td></tr>';
      return;
    }
    const wbsOpts = ['<option value="">— WBS —</option>'].concat(
      nodes.slice().sort((a, b) => natCmp(a.wbsCode, b.wbsCode))
        .map(n => `<option value="${Utils.esc(n.wbsCode)}">${Utils.esc(n.wbsCode)} · ${Utils.esc(n.wbsName)}</option>`)
    ).join('');
    const ccOpts = ['<option value="">— CC —</option>'].concat(
      costCodes.map(c => `<option value="${Utils.esc(c.code)}">${Utils.esc(c.code)} · ${Utils.esc(c.name)}</option>`)
    ).join('');

    // For each activity, determine the parent WBS node's Nature of Work,
    // then build the Type-of-Work dropdown filtered by that Nature.
    t.innerHTML = activities.map((a, i) => {
      const parentNode = nodes.find(n => n.wbsCode === a.wbsCode);
      const nature = (parentNode && parentNode.natureOfWork) || '';
      const typeChoices = nature ? (natureMap[nature] || []) : [];

      const typeOpts = typeChoices.length
        ? `<option value="">— Type of Work —</option>` +
          typeChoices.map(t => `<option value="${Utils.esc(t)}"${t === a.typeOfWork ? ' selected' : ''}>${Utils.esc(t)}</option>`).join('')
        : `<option value="">${nature ? '(no types defined)' : '(pick WBS first)'}</option>`;

      // If selected typeOfWork no longer matches the current Nature, show it as a stale option (disabled style)
      const stale = a.typeOfWork && !typeChoices.includes(a.typeOfWork);
      const typeSelectClass = stale ? 'unit-select stale' : 'unit-select';
      const typeSelectOpts  = stale
        ? `<option value="${Utils.esc(a.typeOfWork)}" selected>⚠ ${Utils.esc(a.typeOfWork)} (stale)</option>` + typeOpts
        : typeOpts;

      return `
      <tr data-idx="${i}">
        <td class="mono">${i + 1}</td>
        <td><input class="inline-edit desc" value="${Utils.esc(a.name)}" oninput="PAGE.editAct(${i},'name',this.value)" /></td>
        <td><select class="unit-select" onchange="PAGE.editAct(${i},'wbsCode',this.value);PAGE.refreshActivityRow(${i})">${wbsOpts.replace(`value="${Utils.esc(a.wbsCode)}"`, `value="${Utils.esc(a.wbsCode)}" selected`)}</select></td>
        <td title="${Utils.esc(nature || '— pick a WBS row that has a Nature of Work —')}" style="font-size:10.5px;color:${nature?'var(--green)':'var(--text-faint)'};font-weight:${nature?600:400};white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis">${Utils.esc(nature || '—')}</td>
        <td><select class="${typeSelectClass}" onchange="PAGE.editAct(${i},'typeOfWork',this.value)" ${typeChoices.length ? '' : 'disabled'}>${typeSelectOpts}</select></td>
        <td><select class="unit-select" onchange="PAGE.editAct(${i},'costCode',this.value)">${ccOpts.replace(`value="${Utils.esc(a.costCode)}"`, `value="${Utils.esc(a.costCode)}" selected`)}</select></td>
        <td><input class="inline-edit" value="${Utils.esc(a.unit)}" oninput="PAGE.editAct(${i},'unit',this.value)" /></td>
        <td><input class="inline-edit num" type="number" step="0.01" value="${a.boqQty}" oninput="PAGE.editAct(${i},'boqQty',this.value)" /></td>
        <td><button class="btn-icon danger" onclick="PAGE.removeActivity(${i})" title="Remove">&times;</button></td>
      </tr>
    `;
    }).join('');
  }

  // Re-render a single activity row after the WBS dropdown changes (so the
  // Nature column and Type dropdown refresh without redrawing the whole table)
  function refreshActivityRow(i) {
    if (!activities[i]) return;
    // Reset stale typeOfWork if it doesn't fit the new Nature
    const parentNode = nodes.find(n => n.wbsCode === activities[i].wbsCode);
    const nature = (parentNode && parentNode.natureOfWork) || '';
    const valid = nature ? (natureMap[nature] || []) : [];
    if (activities[i].typeOfWork && !valid.includes(activities[i].typeOfWork)) {
      // Don't auto-clear — keep it but mark stale (renderActivities will show ⚠)
    }
    renderActivities();
  }

  function updateKPIs() {
    document.getElementById('kWbsNodes').textContent = nodes.length;
    document.getElementById('kWbsActs').textContent  = activities.length;
    const maxLvl = nodes.reduce((m, n) => Math.max(m, (n.level || 0) + 1), 0);
    document.getElementById('kWbsDepth').textContent = maxLvl;
  }

  function natCmp(a, b) {
    const A = String(a).split('.').map(Number);
    const B = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      const x = A[i] || 0, y = B[i] || 0;
      if (x !== y) return x - y;
    }
    return 0;
  }

  function filter(q) {
    renderTree(q);
  }

  function addNode() {
    const code = prompt('WBS Code (e.g. 1, 1.2, 1.2.3):');
    if (!code) return;
    const name = prompt('WBS Name:');
    if (!name) return;
    // Show available Natures so the user knows what's valid
    const natureKeys = Object.keys(natureMap).sort();
    let natPrompt = 'Nature of Work (leave blank to assign later):';
    if (natureKeys.length) natPrompt += '\n\nAvailable: ' + natureKeys.join(', ');
    const nature = (prompt(natPrompt) || '').trim();
    nodes.push({
      wbsCode:      code.trim(),
      wbsName:      name.trim(),
      natureOfWork: nature,
      level:        (code.match(/\./g) || []).length,
    });
    renderTree();
    renderActivities();
    updateKPIs();
  }

  function quickAddActivity() {
    const inp = document.getElementById('quickActInput');
    const name = inp.value.trim();
    if (!name) return;
    activities.push({
      name, wbsCode: '', costCode: '', unit: 'CUM', boqQty: 0, typeOfWork: '',
      masterUuid: '', checkSum: '', taskCode: '',
    });
    inp.value = '';
    renderActivities();
    updateKPIs();
  }

  function editAct(i, key, val) {
    if (!activities[i]) return;
    activities[i][key] = (key === 'boqQty') ? Number(val) : val;
  }

  function removeActivity(i) {
    activities.splice(i, 1);
    renderActivities();
    updateKPIs();
  }

  function exportCSV() {
    const ap = window.STATE.activeProject || {};
    const lines = ['Type,Code,Name,WBS Code,Nature of Work,Type of Work,Cost Code,Unit,BOQ Qty'];
    nodes.forEach(n => lines.push(['WBS', n.wbsCode, q(n.wbsName), '', q(n.natureOfWork || ''), '', '', '', ''].join(',')));
    activities.forEach(a => {
      const parent = nodes.find(n => n.wbsCode === a.wbsCode);
      const nature = (parent && parent.natureOfWork) || '';
      lines.push(['Activity', '', q(a.name), a.wbsCode, q(nature), q(a.typeOfWork || ''), a.costCode, a.unit, a.boqQty].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `WBS_${ap['Project Code'] || 'project'}_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
    function q(s) { return /[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : s; }
  }

  async function save() {
    const ap = window.STATE.activeProject;
    if (!ap) { Utils.toast('Select a project first', 'err'); return; }
    const btn = document.getElementById('saveBtn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const r = await API.scriptCall('saveWBS', {
        projectCode: ap['Project Code'],
        nodes:      nodes.map(n => ({
          wbsCode:      n.wbsCode,
          wbsName:      n.wbsName,
          natureOfWork: n.natureOfWork || '',
        })),
        activities: activities.map(a => ({
          name:        a.name,
          wbsCode:     a.wbsCode,
          costCode:    a.costCode,
          unit:        a.unit,
          boqQty:      Number(a.boqQty) || 0,
          typeOfWork:  a.typeOfWork || '',
          masterUuid:  a.masterUuid || '',
          checkSum:    a.checkSum   || '',
          taskCode:    a.taskCode   || '',
        })),
      });
      if (r && r.success) Utils.toast(`Saved ${nodes.length} nodes and ${activities.length} activities`, 'ok');
      else Utils.toast((r && r.message) || 'Save failed', 'err');
    } catch (e) {
      Utils.toast('Save error: ' + e.message, 'err');
    } finally {
      btn.disabled = false; btn.textContent = 'Save WBS';
    }
  }

  function onProjectChange() { load(); }

  // ─── Master picker (M_PL_1_Activities) ──────────────────────────
  let _pickerSelected = new Set(); // CheckSums

  function openMasterPicker() {
    const overlay = document.getElementById('masterPickerOverlay');
    if (!overlay) return;
    _pickerSelected = new Set();
    populateMasterFilters();
    renderMasterTable();
    overlay.style.display = 'flex';
    setTimeout(() => document.getElementById('mpSearch').focus(), 60);
  }

  function closeMasterPicker() {
    const overlay = document.getElementById('masterPickerOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  function populateMasterFilters() {
    const natSel = document.getElementById('mpNatureFilter');
    const typSel = document.getElementById('mpTypeFilter');
    if (!natSel) return;
    const natures = Object.keys(natureMap).sort();
    natSel.innerHTML = '<option value="">All Natures</option>' +
      natures.map(n => `<option value="${Utils.esc(n)}">${Utils.esc(n)}</option>`).join('');
    natSel.onchange = () => {
      const nat = natSel.value;
      const types = nat ? (natureMap[nat] || []) : [...new Set(Object.values(natureMap).flat())].sort();
      typSel.innerHTML = '<option value="">All Types</option>' +
        types.map(t => `<option value="${Utils.esc(t)}">${Utils.esc(t)}</option>`).join('');
      filterMaster();
    };
    natSel.dispatchEvent(new Event('change'));
  }

  function filterMaster() { renderMasterTable(); }

  function renderMasterTable() {
    const tbody  = document.getElementById('mpTbody');
    const search = (document.getElementById('mpSearch')?.value || '').toLowerCase().trim();
    const fNat   =  document.getElementById('mpNatureFilter')?.value || '';
    const fTyp   =  document.getElementById('mpTypeFilter')?.value || '';
    if (!tbody) return;

    const all = window.STATE.masterActivities || [];
    const filtered = all.filter(r => {
      const nat = String(r['Nature of Work'] || '');
      const typ = String(r['Type of Work']   || '');
      if (fNat && nat !== fNat) return false;
      if (fTyp && typ !== fTyp) return false;
      if (search) {
        const hay = [r['Activity'], nat, typ, r['Task Code'], r['Project Code']].join(' ').toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    document.getElementById('mpCount').textContent = `${filtered.length.toLocaleString()} shown`;

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No activities match the filters.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.slice(0, 500).map(r => {
      const cs = String(r['CheckSum'] || r['UUID'] || '');
      const sel = _pickerSelected.has(cs);
      return `<tr class="${sel ? 'sel' : ''}" onclick="PAGE.toggleMasterRow('${Utils.esc(cs)}')">
        <td><input type="checkbox" ${sel ? 'checked' : ''} onclick="event.stopPropagation();PAGE.toggleMasterRow('${Utils.esc(cs)}')"></td>
        <td><strong>${Utils.esc(r['Activity'] || '')}</strong></td>
        <td style="color:var(--green);font-weight:600">${Utils.esc(r['Nature of Work'] || '')}</td>
        <td>${Utils.esc(r['Type of Work'] || '')}</td>
        <td class="mono">${Utils.esc(r['Unit'] || '')}</td>
        <td class="mono" style="font-size:10px;color:var(--text-faint)">${Utils.esc(r['Task Code'] || '')}</td>
        <td style="font-size:10.5px;color:var(--text-dim)">${Utils.esc(r['Project Code'] || '')}</td>
      </tr>`;
    }).join('') + (filtered.length > 500
      ? `<tr><td colspan="7" style="text-align:center;color:var(--text-faint);padding:10px">… ${filtered.length - 500} more matches — refine filters to see them ·</td></tr>`
      : '');

    document.getElementById('mpSelectedCount').textContent = `${_pickerSelected.size} selected`;
  }

  function toggleMasterRow(checkSum) {
    if (_pickerSelected.has(checkSum)) _pickerSelected.delete(checkSum);
    else _pickerSelected.add(checkSum);
    renderMasterTable();
  }

  function confirmMasterPick() {
    const all = window.STATE.masterActivities || [];
    const ap  = window.STATE.activeProject || {};
    const projectCode = ap['Project Code'] || '';

    let added = 0;
    _pickerSelected.forEach(cs => {
      const r = all.find(x => String(x['CheckSum'] || x['UUID'] || '') === cs);
      if (!r) return;
      activities.push({
        name:        r['Activity'] || '',
        wbsCode:     r['WBS Code'] || '',
        costCode:    '',
        unit:        r['Unit'] || 'CUM',
        boqQty:      0,
        typeOfWork:  r['Type of Work'] || '',
        // Provenance fields — keep so save can write back to master via UUID
        masterUuid: r['UUID']     || '',
        checkSum:   r['CheckSum'] || '',
        taskCode:   r['Task Code']|| '',
      });
      added++;
    });
    closeMasterPicker();
    renderActivities();
    updateKPIs();
    Utils.toast(`Added ${added} activit${added === 1 ? 'y' : 'ies'} from master`, 'ok');
  }

  return {
    load, save, exportCSV,
    addNode, quickAddActivity, editAct, editNode, removeActivity, filter,
    refreshActivityRow, renderActivitiesPublic,
    openMasterPicker, closeMasterPicker, filterMaster, toggleMasterRow, confirmMasterPick,
    onProjectChange,
  };
})();
