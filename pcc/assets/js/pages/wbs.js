/* ════════════════════════════════════════════════════════════════
   Step 3 · WBS — STRICT MASTER MODE
   ────────────────────────────────────────────────────────────────
   Rules:
     • WBS nodes are picked from DISTINCT(WBS Code) on M_PL_1_Activities.
       Nature of Work auto-fills from the master (the most common Nature
       associated with that WBS Code wins ties go to first-seen).
     • Activities can ONLY be added via the Master Picker — no free typing.
     • Activity/WBS Code/Nature/Type/Unit are locked after pick.
       Only Cost Code + BOQ Qty are editable on the per-project Activities row.
     • Save validates every row against master; blocks if any are stale.
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function() {

  // ── State ──
  let nodes      = [];   // [{wbsCode, wbsName, natureOfWork, level, _stale}]
  let activities = [];   // [{name, wbsCode, costCode, unit, boqQty, typeOfWork, masterUuid, checkSum, taskCode, _stale}]
  let costCodes  = [];

  // Master indices — built once on load
  let masterRows         = [];    // raw rows of M_PL_1_Activities
  let masterByCheckSum   = {};    // checkSum → master row
  let masterByUuid       = {};    // UUID → master row
  let masterWbsList      = [];    // [{wbsCode, wbsName, natureOfWork, count}]   (deduplicated)
  let masterWbsByCode    = {};    // wbsCode → masterWbsList entry
  let natureMap          = {};    // Nature → [Type, …] (DISTINCT)
  let validWbsCodes      = new Set();
  let validCheckSums     = new Set();

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

      buildMasterIndices(mAct || []);

      // ── Load saved per-project nodes, mark stale if not in master ──
      nodes = (w || [])
        .filter(r => (r['Project Code'] || r['ProjectCode']) === code)
        .map(r => {
          const wbsCode = String(r['WBS Code'] || r['Code'] || '').trim();
          const masterEntry = masterWbsByCode[wbsCode];
          const stale = !masterEntry;
          // If valid in master, prefer master's Nature (canonical) over saved value
          const nature = masterEntry ? masterEntry.natureOfWork
                                     : String(r['Nature of Work'] || '').trim();
          const wbsName = masterEntry ? masterEntry.wbsName
                                      : (r['WBS Name'] || r['Name'] || '');
          return { wbsCode, wbsName, natureOfWork: nature, _stale: stale };
        })
        .filter(n => n.wbsCode);

      // ── Load saved per-project activities, mark stale if no master link ──
      activities = (a || [])
        .filter(r => (r['Project Code'] || r['ProjectCode']) === code)
        .map(r => {
          const checkSum   = String(r['CheckSum']   || '').trim();
          const masterUuid = String(r['Master UUID'] || r['UUID'] || '').trim();
          // Resolve via CheckSum first (preferred), then UUID
          const m = masterByCheckSum[checkSum] || masterByUuid[masterUuid] || null;
          const stale = !m;
          return {
            name:        m ? (m['Activity'] || '')      : (r['Activity'] || r['Activity Name'] || r['Name'] || ''),
            wbsCode:     m ? (m['WBS Code'] || '')      : (r['WBS Code'] || ''),
            costCode:    r['Cost Code'] || r['CostCode'] || '',           // editable, not from master
            unit:        m ? (m['Unit'] || 'CUM')       : (r['Unit'] || 'CUM'),
            boqQty:      Number(r['BOQ Qty'] || r['Quantity'] || 0),       // editable, not from master
            typeOfWork:  m ? (m['Type of Work'] || '')  : String(r['Type of Work'] || '').trim(),
            masterUuid:  m ? (m['UUID']     || '')      : masterUuid,
            checkSum:    m ? (m['CheckSum'] || '')      : checkSum,
            taskCode:    m ? (m['Task Code']|| '')      : (r['Task Code'] || ''),
            _stale: stale,
          };
        })
        .filter(x => x.name);

      // Derive level from dot count for tree indenting
      nodes.forEach(n => { n.level = (n.wbsCode.match(/\./g) || []).length; });

      costCodes = (cc || []).map(r => ({
        code: r['Cost Code'] || r['Code'] || '',
        name: r['Description'] || r['Name'] || '',
      })).filter(c => c.code);

      renderTree();
      renderActivities();
      updateKPIs();

      const staleNodes = nodes.filter(n => n._stale).length;
      const staleActs  = activities.filter(a => a._stale).length;
      if (staleNodes || staleActs) {
        setStatus(`⚠ ${staleNodes + staleActs} stale rows`, 'red');
        Utils.toast(`${staleNodes + staleActs} row(s) not in master — fix before saving`, 'err');
      } else {
        setStatus(nodes.length ? 'Loaded · master-valid' : 'Empty', nodes.length ? 'green' : 'gold');
      }
    } catch (e) {
      console.error(e);
      setStatus('Load failed', 'red');
      Utils.toast('Could not fetch WBS', 'err');
    }
  }

  // ── Build master indices (one-time per load) ──────────────────
  function buildMasterIndices(rows) {
    masterRows = rows;
    masterByCheckSum = {};
    masterByUuid     = {};
    natureMap        = {};
    validWbsCodes    = new Set();
    validCheckSums   = new Set();

    // Aggregator for WBS → most common Nature pairing
    const wbsAgg = {}; // wbsCode → { wbsName, natureCounts: {nature: count}, count }

    rows.forEach(r => {
      const cs   = String(r['CheckSum'] || '').trim();
      const uuid = String(r['UUID']     || '').trim();
      if (cs)   masterByCheckSum[cs]   = r;
      if (uuid) masterByUuid[uuid]     = r;
      if (cs)   validCheckSums.add(cs);

      const wbs    = String(r['WBS Code']        || '').trim();
      const nat    = String(r['Nature of Work']  || '').trim();
      const typ    = String(r['Type of Work']    || '').trim();

      if (wbs) {
        validWbsCodes.add(wbs);
        if (!wbsAgg[wbs]) wbsAgg[wbs] = { wbsName: '', natureCounts: {}, count: 0 };
        wbsAgg[wbs].count += 1;
        if (nat) wbsAgg[wbs].natureCounts[nat] = (wbsAgg[wbs].natureCounts[nat] || 0) + 1;
      }

      if (nat) {
        if (!natureMap[nat]) natureMap[nat] = new Set();
        if (typ) natureMap[nat].add(typ);
      }
    });

    // For each WBS Code, pick the Nature with highest count (ties → first seen)
    masterWbsList = Object.entries(wbsAgg)
      .map(([wbsCode, agg]) => {
        let topNat = '';
        let topCnt = -1;
        Object.entries(agg.natureCounts).forEach(([n, c]) => {
          if (c > topCnt) { topCnt = c; topNat = n; }
        });
        return {
          wbsCode,
          wbsName: agg.wbsName || wbsCode, // master has no separate WBS Name column; reuse code
          natureOfWork: topNat,
          count: agg.count,
        };
      })
      .sort((a, b) => natCmp(a.wbsCode, b.wbsCode));

    masterWbsByCode = {};
    masterWbsList.forEach(m => { masterWbsByCode[m.wbsCode] = m; });

    // Convert nature → set into nature → sorted array
    Object.keys(natureMap).forEach(k => {
      natureMap[k] = [...natureMap[k]].sort();
    });

    window.STATE.masterActivities = rows;
    window.STATE.natureMap        = natureMap;
    window.STATE.masterWbsList    = masterWbsList;
  }

  function setStatus(msg, color) {
    const el = document.getElementById('wbsStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = 'pill pill-' + (color || 'green');
  }

  // ─── WBS tree (read-only after pick) ───────────────────────────
  function renderTree(filter) {
    const c = document.getElementById('wbsTree');
    if (!c) return;
    let list = nodes;
    if (filter) {
      const ql = filter.toLowerCase();
      list = nodes.filter(n =>
        n.wbsCode.toLowerCase().includes(ql) ||
        String(n.wbsName).toLowerCase().includes(ql) ||
        String(n.natureOfWork).toLowerCase().includes(ql)
      );
    }
    if (!list.length) {
      c.innerHTML = '<div class="plp-empty">No WBS nodes yet. Click <strong>+ Pick WBS from master</strong> to start.</div>';
      return;
    }
    list = list.slice().sort((a, b) => natCmp(a.wbsCode, b.wbsCode));

    c.innerHTML = list.map(n => {
      const lvl = Math.min(n.level || 0, 3);
      const idx = nodes.indexOf(n);
      const actCount = activities.filter(a =>
        a.wbsCode === n.wbsCode || String(a.wbsCode).startsWith(n.wbsCode + '.')
      ).length;
      const staleCls = n._stale ? ' wbs-stale' : '';
      const staleTip = n._stale ? ' title="⚠ This WBS Code is not in M_PL_1_Activities — re-pick from master before saving"' : '';

      return `<div class="wbs-node lvl-${lvl}${staleCls}"${staleTip}>
        <span class="wbs-code">${Utils.esc(n.wbsCode)}</span>
        <span class="wbs-name">${Utils.esc(n.wbsName)}</span>
        <span class="wbs-nature-readonly" title="Nature inherited from master">${Utils.esc(n.natureOfWork || '—')}</span>
        <span class="wbs-meta">${actCount} ${actCount === 1 ? 'activity' : 'activities'}</span>
        <button class="btn-icon danger" onclick="PAGE.removeNode(${idx})" title="Remove">&times;</button>
      </div>`;
    }).join('');
  }

  // ─── Activities table (locked except Cost Code + BOQ Qty) ─────
  function renderActivities() {
    const t = document.getElementById('actTbody');
    if (!t) return;
    if (!activities.length) {
      t.innerHTML = '<tr><td colspan="9" class="empty-cell">No activities yet — use <strong>📚 Pick from master</strong> below.</td></tr>';
      return;
    }
    const ccOpts = ['<option value="">— CC —</option>'].concat(
      costCodes.map(c => `<option value="${Utils.esc(c.code)}">${Utils.esc(c.code)} · ${Utils.esc(c.name)}</option>`)
    ).join('');

    t.innerHTML = activities.map((a, i) => {
      const parentNode = nodes.find(n => n.wbsCode === a.wbsCode);
      const nature = (parentNode && parentNode.natureOfWork) || '';
      const staleCls = a._stale ? ' row-stale' : '';
      const staleTag = a._stale
        ? `<span class="stale-tag" title="No matching master row — re-pick">⚠ stale</span>`
        : '';

      return `
      <tr class="${staleCls}" data-idx="${i}">
        <td class="mono">${i + 1}${staleTag}</td>
        <td class="locked-cell" title="Locked from master">${Utils.esc(a.name)}</td>
        <td class="locked-cell mono" style="font-size:11px;color:var(--green);font-weight:600" title="Locked from master">${Utils.esc(a.wbsCode || '—')}</td>
        <td class="locked-cell" style="color:var(--green);font-weight:600" title="Inherited from WBS">${Utils.esc(nature || '—')}</td>
        <td class="locked-cell" title="Locked from master">${Utils.esc(a.typeOfWork || '—')}</td>
        <td><select class="unit-select" onchange="PAGE.editAct(${i},'costCode',this.value)">${ccOpts.replace(`value="${Utils.esc(a.costCode)}"`, `value="${Utils.esc(a.costCode)}" selected`)}</select></td>
        <td class="locked-cell mono" title="Locked from master">${Utils.esc(a.unit)}</td>
        <td><input class="inline-edit num" type="number" step="0.01" min="0" value="${a.boqQty}" oninput="PAGE.editAct(${i},'boqQty',this.value)" /></td>
        <td><button class="btn-icon danger" onclick="PAGE.removeActivity(${i})" title="Remove">&times;</button></td>
      </tr>
    `;
    }).join('');
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

  function filter(q) { renderTree(q); }

  // ─── WBS picker (DISTINCT WBS Codes from master) ──────────────
  let _wbsPickerSelected = new Set();

  function openWbsPicker() {
    const overlay = document.getElementById('wbsPickerOverlay');
    if (!overlay) {
      Utils.toast('WBS picker not available — refresh page', 'err');
      return;
    }
    if (!masterWbsList.length) {
      Utils.toast('Master M_PL_1_Activities is empty or not shared publicly', 'err');
      return;
    }
    _wbsPickerSelected = new Set();
    populateWbsPickerFilters();
    renderWbsPicker();
    overlay.style.display = 'flex';
    setTimeout(() => document.getElementById('wpkSearch')?.focus(), 60);
  }

  function closeWbsPicker() {
    const overlay = document.getElementById('wbsPickerOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  function renderWbsPicker() {
    const tbody = document.getElementById('wpkTbody');
    const search = (document.getElementById('wpkSearch')?.value || '').toLowerCase().trim();
    const fNat   = document.getElementById('wpkNatureFilter')?.value || '';
    if (!tbody) return;

    // Already-added WBS Codes (so we can disable them)
    const existing = new Set(nodes.map(n => n.wbsCode));

    let filtered = masterWbsList;
    if (fNat) filtered = filtered.filter(m => m.natureOfWork === fNat);
    if (search) {
      filtered = filtered.filter(m => {
        const hay = (m.wbsCode + ' ' + m.wbsName + ' ' + m.natureOfWork).toLowerCase();
        return hay.includes(search);
      });
    }

    document.getElementById('wpkCount').textContent = `${filtered.length.toLocaleString()} of ${masterWbsList.length}`;

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">No WBS codes match the filters.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.slice(0, 500).map(m => {
      const sel = _wbsPickerSelected.has(m.wbsCode);
      const already = existing.has(m.wbsCode);
      return `<tr class="${sel ? 'sel' : ''}${already ? ' disabled' : ''}" onclick="${already ? '' : `PAGE.toggleWbsRow('${Utils.esc(m.wbsCode)}')`}">
        <td><input type="checkbox" ${sel ? 'checked' : ''} ${already ? 'disabled title="Already added"' : ''} onclick="event.stopPropagation();PAGE.toggleWbsRow('${Utils.esc(m.wbsCode)}')"></td>
        <td class="mono" style="color:var(--green);font-weight:700">${Utils.esc(m.wbsCode)}</td>
        <td>${Utils.esc(m.wbsName)}</td>
        <td style="color:var(--green);font-weight:600">${Utils.esc(m.natureOfWork || '—')}</td>
        <td class="mono" style="text-align:right;font-size:10.5px;color:var(--text-faint)">${m.count} act${m.count === 1 ? '' : 's'}${already ? ' · <span style="color:var(--gold)">already added</span>' : ''}</td>
      </tr>`;
    }).join('') + (filtered.length > 500
      ? `<tr><td colspan="5" style="text-align:center;color:var(--text-faint);padding:10px">… ${filtered.length - 500} more — refine filters</td></tr>`
      : '');

    document.getElementById('wpkSelectedCount').textContent = `${_wbsPickerSelected.size} selected`;
  }

  function toggleWbsRow(wbsCode) {
    if (_wbsPickerSelected.has(wbsCode)) _wbsPickerSelected.delete(wbsCode);
    else _wbsPickerSelected.add(wbsCode);
    renderWbsPicker();
  }

  function confirmWbsPick() {
    let added = 0;
    _wbsPickerSelected.forEach(wbsCode => {
      const m = masterWbsByCode[wbsCode];
      if (!m) return;
      // Skip if already exists
      if (nodes.some(n => n.wbsCode === wbsCode)) return;
      nodes.push({
        wbsCode:      m.wbsCode,
        wbsName:      m.wbsName,
        natureOfWork: m.natureOfWork,
        level:        (m.wbsCode.match(/\./g) || []).length,
      });
      added++;
    });
    closeWbsPicker();
    renderTree();
    renderActivities();
    updateKPIs();
    Utils.toast(`Added ${added} WBS node${added === 1 ? '' : 's'}`, 'ok');
  }

  function populateWbsPickerFilters() {
    const natSel = document.getElementById('wpkNatureFilter');
    if (!natSel) return;
    const natures = [...new Set(masterWbsList.map(m => m.natureOfWork).filter(Boolean))].sort();
    natSel.innerHTML = '<option value="">All Natures</option>' +
      natures.map(n => `<option value="${Utils.esc(n)}">${Utils.esc(n)}</option>`).join('');
  }

  // ─── Activity master picker (existing — locked schema) ────────
  let _pickerSelected = new Set();

  function openMasterPicker() {
    const overlay = document.getElementById('masterPickerOverlay');
    if (!overlay) return;
    if (!masterRows.length) {
      Utils.toast('Master M_PL_1_Activities is empty or not shared publicly', 'err');
      return;
    }
    if (!nodes.length) {
      Utils.toast('Add at least one WBS node first (top of page)', 'err');
      return;
    }
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
    const wbsSel = document.getElementById('mpWbsFilter');
    if (!natSel) return;

    // WBS filter restricted to WBS codes already added to this project (strict)
    const projectWbsCodes = nodes.map(n => n.wbsCode).sort(natCmp);
    if (wbsSel) {
      wbsSel.innerHTML = '<option value="">All project WBS</option>' +
        projectWbsCodes.map(c => `<option value="${Utils.esc(c)}">${Utils.esc(c)}</option>`).join('');
    }

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
    const fNat   = document.getElementById('mpNatureFilter')?.value || '';
    const fTyp   = document.getElementById('mpTypeFilter')?.value || '';
    const fWbs   = document.getElementById('mpWbsFilter')?.value || '';
    if (!tbody) return;

    // STRICT: only show master rows whose WBS Code is among the project's WBS nodes
    const projectWbsCodes = new Set(nodes.map(n => n.wbsCode));
    const existing = new Set(activities.map(a => a.checkSum).filter(Boolean));

    let filtered = masterRows.filter(r => {
      const wbs = String(r['WBS Code'] || '').trim();
      // STRICT: WBS Code MUST be in the project. If no nodes yet, show nothing.
      if (!projectWbsCodes.has(wbs)) return false;
      const nat = String(r['Nature of Work'] || '');
      const typ = String(r['Type of Work']   || '');
      if (fWbs && wbs !== fWbs) return false;
      if (fNat && nat !== fNat) return false;
      if (fTyp && typ !== fTyp) return false;
      if (search) {
        const hay = [r['Activity'], nat, typ, r['Task Code'], wbs].join(' ').toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    document.getElementById('mpCount').textContent = `${filtered.length.toLocaleString()} of ${projectWbsCodes.size ? masterRows.filter(r => projectWbsCodes.has(String(r['WBS Code']||'').trim())).length : 0}`;

    if (!filtered.length) {
      const msg = !projectWbsCodes.size
        ? 'Add WBS nodes first — activities can only be picked under those codes.'
        : 'No activities match the filters.';
      tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">${msg}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.slice(0, 500).map(r => {
      const cs = String(r['CheckSum'] || '');
      const sel = _pickerSelected.has(cs);
      const already = existing.has(cs);
      return `<tr class="${sel ? 'sel' : ''}${already ? ' disabled' : ''}" onclick="${already ? '' : `PAGE.toggleMasterRow('${Utils.esc(cs)}')`}">
        <td><input type="checkbox" ${sel ? 'checked' : ''} ${already ? 'disabled title="Already added"' : ''} onclick="event.stopPropagation();PAGE.toggleMasterRow('${Utils.esc(cs)}')"></td>
        <td><strong>${Utils.esc(r['Activity'] || '')}</strong>${already ? ' <span style="color:var(--gold);font-size:10.5px">· already added</span>' : ''}</td>
        <td class="mono" style="color:var(--green);font-weight:600">${Utils.esc(r['WBS Code'] || '')}</td>
        <td style="color:var(--green);font-weight:600">${Utils.esc(r['Nature of Work'] || '')}</td>
        <td>${Utils.esc(r['Type of Work'] || '')}</td>
        <td class="mono">${Utils.esc(r['Unit'] || '')}</td>
        <td class="mono" style="font-size:10px;color:var(--text-faint)">${Utils.esc(r['Task Code'] || '')}</td>
      </tr>`;
    }).join('') + (filtered.length > 500
      ? `<tr><td colspan="7" style="text-align:center;color:var(--text-faint);padding:10px">… ${filtered.length - 500} more — refine filters</td></tr>`
      : '');

    document.getElementById('mpSelectedCount').textContent = `${_pickerSelected.size} selected`;
  }

  function toggleMasterRow(checkSum) {
    if (_pickerSelected.has(checkSum)) _pickerSelected.delete(checkSum);
    else _pickerSelected.add(checkSum);
    renderMasterTable();
  }

  function confirmMasterPick() {
    let added = 0, skipped = 0;
    _pickerSelected.forEach(cs => {
      const r = masterByCheckSum[cs];
      if (!r) { skipped++; return; }
      // Skip duplicates
      if (activities.some(a => a.checkSum === cs)) { skipped++; return; }
      activities.push({
        name:        r['Activity']        || '',
        wbsCode:     r['WBS Code']        || '',
        costCode:    '',                                  // editable
        unit:        r['Unit']            || 'CUM',      // locked from master
        boqQty:      0,                                  // editable
        typeOfWork:  r['Type of Work']    || '',         // locked from master
        masterUuid:  r['UUID']            || '',
        checkSum:    r['CheckSum']        || '',
        taskCode:    r['Task Code']       || '',
      });
      added++;
    });
    closeMasterPicker();
    renderActivities();
    updateKPIs();
    Utils.toast(`Added ${added} activit${added === 1 ? 'y' : 'ies'}${skipped ? ` · ${skipped} skipped (duplicates)` : ''}`, 'ok');
  }

  function editAct(i, key, val) {
    if (!activities[i]) return;
    // STRICT: only Cost Code + BOQ Qty are editable
    if (key !== 'costCode' && key !== 'boqQty') {
      Utils.toast(`${key} is locked — re-pick from master to change`, 'err');
      renderActivities();
      return;
    }
    activities[i][key] = (key === 'boqQty') ? Number(val) : val;
  }

  function removeActivity(i) {
    if (!confirm(`Remove "${activities[i]?.name || 'this activity'}" from project?`)) return;
    activities.splice(i, 1);
    renderActivities();
    updateKPIs();
  }

  function removeNode(i) {
    const n = nodes[i];
    if (!n) return;
    const linked = activities.filter(a => a.wbsCode === n.wbsCode || String(a.wbsCode).startsWith(n.wbsCode + '.')).length;
    if (linked && !confirm(`This WBS has ${linked} linked activit${linked === 1 ? 'y' : 'ies'}. Remove anyway?`)) return;
    nodes.splice(i, 1);
    renderTree();
    renderActivities();
    updateKPIs();
  }

  function exportCSV() {
    const ap = window.STATE.activeProject || {};
    const lines = ['Type,WBS Code,WBS Name,Nature of Work,Activity,Type of Work,Cost Code,Unit,BOQ Qty,Master UUID,CheckSum'];
    nodes.forEach(n => lines.push(['WBS', n.wbsCode, q(n.wbsName), q(n.natureOfWork || ''), '', '', '', '', '', '', ''].join(',')));
    activities.forEach(a => {
      const parent = nodes.find(n => n.wbsCode === a.wbsCode);
      const nature = (parent && parent.natureOfWork) || '';
      lines.push(['Activity', a.wbsCode, '', q(nature), q(a.name), q(a.typeOfWork || ''), a.costCode, a.unit, a.boqQty, a.masterUuid, a.checkSum].join(','));
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

  // ─── Save with strict validation ──────────────────────────────
  async function save() {
    const ap = window.STATE.activeProject;
    if (!ap) { Utils.toast('Select a project first', 'err'); return; }

    // STRICT: validate every row against master before saving.
    const badNodes = nodes.filter(n => !validWbsCodes.has(n.wbsCode));
    const badActs  = activities.filter(a => !a.checkSum || !validCheckSums.has(a.checkSum));

    if (badNodes.length || badActs.length) {
      const msg = [
        badNodes.length ? `${badNodes.length} WBS node(s) not in master: ${badNodes.slice(0,3).map(n=>n.wbsCode).join(', ')}${badNodes.length>3?'…':''}` : '',
        badActs.length  ? `${badActs.length} activit${badActs.length===1?'y':'ies'} missing master link: ${badActs.slice(0,3).map(a=>a.name).join(', ')}${badActs.length>3?'…':''}` : '',
      ].filter(Boolean).join('\n');
      alert('🚫 Save blocked — fix these strict-master violations first:\n\n' + msg + '\n\nRemove the offending rows or re-pick them from the master.');
      Utils.toast('Save blocked — stale rows present', 'err');
      return;
    }

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

  // Public method called by the WBS picker filter inputs
  function renderWbsPickerNow() {
    populateWbsPickerFilters();
    renderWbsPicker();
  }

  return {
    load, save, exportCSV, filter,
    // Tree
    removeNode,
    // Activities
    editAct, removeActivity,
    // Pickers
    openWbsPicker, closeWbsPicker, toggleWbsRow, confirmWbsPick, renderWbsPickerNow,
    openMasterPicker, closeMasterPicker, filterMaster, toggleMasterRow, confirmMasterPick,
    onProjectChange,
  };
})();
