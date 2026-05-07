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
  let activities = [];   // [{name, wbsCode, costCode, unit, boqQty, typeOfWork, natureOfWork, masterUuid, checkSum, taskCode, _stale}]
  let costCodes  = [];

  // ── Master indices ──
  // Z12 (M12_Nature of Work, on V2_MASTER) is the AUTHORITATIVE source for
  // Nature of Work / Type of Work / UOM. M_PL_1_Activities is a secondary
  // catalog used only by the Master Activity Picker.
  let natureMap        = {};        // Nature → [Type, …] (sorted, from Z12)
  let validNatures     = new Set(); // Set<Nature> for validation
  let natureUomHint    = {};        // Nature → UOM (first Z12 row with that Nature)
  let typeUomHint      = {};        // 'Nature::Type' → UOM (Z12-row-level)

  // M_PL_1_Activities — kept for the Master Activity Picker
  let masterRows       = [];
  let masterByCheckSum = {};
  let masterByUuid     = {};
  let validCheckSums   = new Set();

  // Legacy (retained for compatibility with WBS picker code that's no longer
  // the primary path — kept as empty so existing references don't crash)
  let masterWbsList    = [];
  let masterWbsByCode  = {};
  let validWbsCodes    = new Set();

  async function load() {
    const ap = window.STATE.activeProject;
    if (!ap) { Utils.toast('Select a project first', 'err'); return; }
    document.getElementById('kWbsProj').textContent     = ap['Project Code'] || '—';
    document.getElementById('kWbsProjName').textContent = ap['Project Name'] || '(no name)';

    setStatus('Loading…', 'gold');
    const code = ap['Project Code'];

    try {
      // Fetch Z12 master from V2_MASTER sheet (separate from PCC sheet) for
      // the Nature/Type dropdowns. M_PL_1_Activities is still loaded so the
      // Master Activity Picker has something to browse, but the strict
      // Nature/Type vocabulary now comes from Z12 (matching AppSheet).
      const [w, a, cc, mAct, z12] = await Promise.all([
        API.gviz(window.CONFIG.TABS.WBS),
        API.gviz(window.CONFIG.TABS.ACTIVITIES),
        API.gviz(window.CONFIG.TABS.COSTCODE),
        API.gviz(window.CONFIG.TABS.M_ACTIVITIES).catch(() => []),
        API.gviz(window.CONFIG.Z12_TAB, window.CONFIG.Z12_SHEET_ID).catch(() => []),
      ]);

      buildMasterIndices({ mAct: mAct || [], z12: z12 || [] });

      // ── Load saved per-project nodes, mark stale if Nature unknown ──
      // (Stale = Nature isn't in Z12 master.)
      nodes = (w || [])
        .filter(r => (r['Project Code'] || r['ProjectCode']) === code)
        .map(r => {
          const wbsCode = String(r['WBS Code'] || r['Code'] || '').trim();
          const wbsName = String(r['WBS Name'] || r['Name']  || r['Description'] || '').trim();
          const nature  = String(r['Nature of Work'] || '').trim();
          const stale   = !!(nature && !validNatures.has(nature));
          return { wbsCode, wbsName, natureOfWork: nature, _stale: stale };
        })
        .filter(n => n.wbsCode);

      // ── Load saved per-project activities ──
      activities = (a || [])
        .filter(r => (r['Project Code'] || r['ProjectCode']) === code)
        .map(r => {
          const checkSum   = String(r['CheckSum']   || '').trim();
          const masterUuid = String(r['Master UUID'] || r['UUID'] || '').trim();
          const m = masterByCheckSum[checkSum] || masterByUuid[masterUuid] || null;

          // Nature/Type can come from saved row OR from master link
          const nature = String((m && m['Nature of Work']) || r['Nature of Work'] || '').trim();
          const type   = String((m && m['Type of Work'])   || r['Type of Work']   || '').trim();

          // Stale if Nature isn't in Z12 master, OR if Type isn't valid for that Nature
          const validTypesForNat = nature ? (natureMap[nature] || []) : [];
          const stale = (!!nature && !validNatures.has(nature)) ||
                        (!!type && !!nature && validTypesForNat.length > 0 && !validTypesForNat.includes(type));

          return {
            name:        m ? (m['Activity'] || '') : (r['Activity'] || r['Activity Name'] || r['Name'] || ''),
            wbsCode:     m ? (m['WBS Code'] || '') : (r['WBS Code'] || ''),
            costCode:    r['Cost Code'] || r['CostCode'] || '',
            unit:        m ? (m['Unit'] || 'CUM') : (r['Unit'] || 'CUM'),
            boqQty:      Number(r['BOQ Qty'] || r['Quantity'] || 0),
            typeOfWork:  type,
            natureOfWork: nature,                                // explicitly stored
            masterUuid:  m ? (m['UUID']     || '') : masterUuid,
            checkSum:    m ? (m['CheckSum'] || '') : checkSum,
            taskCode:    m ? (m['Task Code']|| '') : (r['Task Code'] || ''),
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

  // ── Build master indices ──────────────────────────────────────
  // Z12 (M12_Nature of Work) is the authoritative source for Nature/Type/UOM.
  // M_PL_1_Activities is kept as a secondary catalog for the Activity Picker.
  function buildMasterIndices({ mAct, z12 }) {
    masterRows = mAct;
    masterByCheckSum = {};
    masterByUuid     = {};
    natureMap        = {};
    validNatures     = new Set();
    natureUomHint    = {};        // Nature → UOM (when unique across Z12 rows)
    typeUomHint      = {};        // 'Nature::Type' → UOM (most specific)
    validCheckSums   = new Set();

    // ── Z12: build Nature → [Type, …] map ──
    z12.forEach(r => {
      const active = String(r['Active/Inactive?'] || '').toLowerCase();
      // Skip explicitly inactive rows
      if (active === 'inactive' || active === 'no' || active === 'false') return;

      const nat = String(r['Nature of Work'] || '').trim();
      const typ = String(r['Type of Work']   || '').trim();
      const uom = String(r['UOM']            || '').trim();
      if (!nat) return;

      validNatures.add(nat);
      if (!natureMap[nat]) natureMap[nat] = new Set();
      if (typ) natureMap[nat].add(typ);
      if (uom) {
        if (typ) typeUomHint[nat + '::' + typ] = uom;
        // Nature-level UOM hint: use first non-empty seen
        if (!natureUomHint[nat]) natureUomHint[nat] = uom;
      }
    });
    // Sort Type lists alphabetically
    Object.keys(natureMap).forEach(k => {
      natureMap[k] = [...natureMap[k]].sort();
    });

    // ── M_PL_1_Activities: index by CheckSum/UUID for the Activity Picker ──
    mAct.forEach(r => {
      const cs   = String(r['CheckSum'] || '').trim();
      const uuid = String(r['UUID']     || '').trim();
      if (cs)   masterByCheckSum[cs]   = r;
      if (uuid) masterByUuid[uuid]     = r;
      if (cs)   validCheckSums.add(cs);
    });

    // Convenience: a flat sorted list of the Z12-derived natures for dropdowns
    masterWbsList = []; // not used in Z12 model
    masterWbsByCode = {};

    window.STATE.masterActivities = mAct;
    window.STATE.natureMap        = natureMap;
    window.STATE.z12Nature        = z12; // raw rows for downstream pages
  }

  function setStatus(msg, color) {
    const el = document.getElementById('wbsStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = 'pill pill-' + (color || 'green');
  }

  // ─── WBS tree (editable; Nature dropdown sourced from Z12) ─────
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
      c.innerHTML = '<div class="plp-empty">No WBS nodes yet. Click <strong>+ Add WBS Node</strong> to start.</div>';
      return;
    }
    list = list.slice().sort((a, b) => natCmp(a.wbsCode, b.wbsCode));
    const natureOpts = buildNatureOptions();

    c.innerHTML = list.map(n => {
      const lvl = Math.min(n.level || 0, 3);
      const idx = nodes.indexOf(n);
      const actCount = activities.filter(a =>
        a.wbsCode === n.wbsCode || String(a.wbsCode).startsWith(n.wbsCode + '.')
      ).length;
      const staleCls = n._stale ? ' wbs-stale' : '';
      const staleTip = n._stale
        ? ' title="⚠ This Nature is not in Z12 master — pick a valid one before saving"'
        : '';
      // Mark the saved Nature as selected even if "stale" so the user sees it
      const natureSelected = natureOpts.replace(
        `value="${Utils.esc(n.natureOfWork)}"`,
        `value="${Utils.esc(n.natureOfWork)}" selected`
      );

      return `<div class="wbs-node lvl-${lvl}${staleCls}"${staleTip}>
        <input class="wbs-code-edit mono" value="${Utils.esc(n.wbsCode)}"
          onchange="PAGE.editNode(${idx},'wbsCode',this.value);PAGE.refresh()"
          placeholder="1.2.3" title="WBS Code (hierarchical, e.g. 1, 1.2)" />
        <input class="wbs-name-edit" value="${Utils.esc(n.wbsName)}"
          onchange="PAGE.editNode(${idx},'wbsName',this.value)"
          placeholder="Description of this WBS scope" />
        <select class="wbs-nature unit-select" onchange="PAGE.editNode(${idx},'natureOfWork',this.value);PAGE.refresh()" title="Nature of Work — sourced from Z12 master (M12_Nature of Work)">
          ${natureSelected}
        </select>
        <span class="wbs-meta">${actCount} ${actCount === 1 ? 'activity' : 'activities'}</span>
        <button class="btn-icon danger" onclick="PAGE.removeNode(${idx})" title="Remove">&times;</button>
      </div>`;
    }).join('');
  }

  // Helper: build <option> list of Z12 Natures
  function buildNatureOptions() {
    const natures = Object.keys(natureMap).sort();
    return '<option value="">— pick Nature —</option>' +
      natures.map(n => `<option value="${Utils.esc(n)}">${Utils.esc(n)}</option>`).join('');
  }

  // Public refresh hook called from inline onchanges
  function refresh() {
    renderTree();
    renderActivities();
    updateKPIs();
  }

  // ─── Activities table (locked except Cost Code + BOQ Qty) ─────
  function renderActivities() {
    const t = document.getElementById('actTbody');
    if (!t) return;
    if (!activities.length) {
      t.innerHTML = '<tr><td colspan="9" class="empty-cell">No activities yet. Click <strong>+ Add activity</strong> below or <strong>📚 Pick from master</strong> to import from M_PL_1_Activities.</td></tr>';
      return;
    }
    const ccOpts = ['<option value="">— CC —</option>'].concat(
      costCodes.map(c => `<option value="${Utils.esc(c.code)}">${Utils.esc(c.code)} · ${Utils.esc(c.name)}</option>`)
    ).join('');
    const wbsOpts = ['<option value="">— pick WBS —</option>']
      .concat(nodes.slice().sort((a, b) => natCmp(a.wbsCode, b.wbsCode))
        .map(n => `<option value="${Utils.esc(n.wbsCode)}" data-nature="${Utils.esc(n.natureOfWork||'')}">${Utils.esc(n.wbsCode)} · ${Utils.esc(n.wbsName).slice(0,40)}</option>`))
      .join('');

    t.innerHTML = activities.map((a, i) => {
      // Inherit Nature from parent WBS row (canonical) — overrides activity-level Nature
      const parentNode = nodes.find(n => n.wbsCode === a.wbsCode);
      const nature = (parentNode && parentNode.natureOfWork) || a.natureOfWork || '';
      // Type-of-Work options from Z12 filtered by parent Nature
      const typeChoices = nature ? (natureMap[nature] || []) : [];
      const typeOpts = typeChoices.length
        ? '<option value="">— pick Type —</option>' +
          typeChoices.map(t => `<option value="${Utils.esc(t)}">${Utils.esc(t)}</option>`).join('')
        : `<option value="">${nature ? '(no Types in Z12 for this Nature)' : '(pick a WBS first)'}</option>`;
      // If saved typeOfWork doesn't match any current option, surface it as stale
      const staleType = a.typeOfWork && nature && typeChoices.length && !typeChoices.includes(a.typeOfWork);
      const finalTypeOpts = staleType
        ? `<option value="${Utils.esc(a.typeOfWork)}" selected>⚠ ${Utils.esc(a.typeOfWork)} (not in Z12)</option>` + typeOpts
        : typeOpts.replace(`value="${Utils.esc(a.typeOfWork)}"`, `value="${Utils.esc(a.typeOfWork)}" selected`);

      const wbsSelected = wbsOpts.replace(`value="${Utils.esc(a.wbsCode)}"`, `value="${Utils.esc(a.wbsCode)}" selected`);
      const ccSelected  = ccOpts.replace(`value="${Utils.esc(a.costCode)}"`,  `value="${Utils.esc(a.costCode)}" selected`);

      const staleCls = a._stale ? ' row-stale' : '';
      const staleTag = a._stale
        ? `<span class="stale-tag" title="Nature/Type not in Z12 master — fix before saving">⚠</span>`
        : '';

      return `
      <tr class="${staleCls}" data-idx="${i}">
        <td class="mono">${i + 1}${staleTag}</td>
        <td><input class="inline-edit desc" value="${Utils.esc(a.name)}"
            oninput="PAGE.editAct(${i},'name',this.value)" placeholder="Activity description" /></td>
        <td><select class="unit-select wbs-pick" onchange="PAGE.editAct(${i},'wbsCode',this.value);PAGE.refresh()" title="Pick parent WBS row — Nature auto-fills">${wbsSelected}</select></td>
        <td style="color:var(--green);font-weight:600;font-size:11px" title="Inherited from WBS row">${Utils.esc(nature || '—')}</td>
        <td><select class="unit-select" onchange="PAGE.editAct(${i},'typeOfWork',this.value);PAGE.refresh()" ${typeChoices.length ? '' : 'disabled'} title="Type of Work — filtered by parent WBS Nature, from Z12 master">${finalTypeOpts}</select></td>
        <td><select class="unit-select" onchange="PAGE.editAct(${i},'costCode',this.value)">${ccSelected}</select></td>
        <td><input class="inline-edit mono" value="${Utils.esc(a.unit)}" oninput="PAGE.editAct(${i},'unit',this.value)" placeholder="UoM" title="Auto-fills from Z12 when Type is picked — editable" style="width:64px" /></td>
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

  // ─── Activity master picker (browses M_PL_1_Activities) ───────
  let _pickerSelected = new Set();

  function openMasterPicker() {
    const overlay = document.getElementById('masterPickerOverlay');
    if (!overlay) return;
    if (!masterRows.length) {
      Utils.toast('Master M_PL_1_Activities is empty or not shared publicly', 'err');
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

    // WBS filter shows ALL distinct WBS codes from the master catalog
    // (sorted hierarchically). User can narrow down without project gating.
    const allMasterWbs = [...new Set(masterRows.map(r => String(r['WBS Code'] || '').trim()).filter(Boolean))].sort(natCmp);
    if (wbsSel) {
      wbsSel.innerHTML = '<option value="">All WBS Codes</option>' +
        allMasterWbs.map(c => `<option value="${Utils.esc(c)}">${Utils.esc(c)}</option>`).join('');
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

    // Track already-added activities (by CheckSum) to disable them
    const existing = new Set(activities.map(a => a.checkSum).filter(Boolean));

    let filtered = masterRows.filter(r => {
      const wbs = String(r['WBS Code'] || '').trim();
      const nat = String(r['Nature of Work'] || '');
      const typ = String(r['Type of Work']   || '');
      // Optional WBS filter (when user picked one) — does NOT enforce project membership
      if (fWbs && wbs !== fWbs) return false;
      if (fNat && nat !== fNat) return false;
      if (fTyp && typ !== fTyp) return false;
      if (search) {
        const hay = [r['Activity'], nat, typ, r['Task Code'], wbs].join(' ').toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    document.getElementById('mpCount').textContent = `${filtered.length.toLocaleString()} of ${masterRows.length}`;

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No activities match the filters.</td></tr>';
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
      const nat = String(r['Nature of Work'] || '').trim();
      const typ = String(r['Type of Work']   || '').trim();
      // Find a project WBS row with the same Nature; if found, link there
      const matchWbs = nodes.find(n => n.natureOfWork === nat);
      activities.push({
        name:         r['Activity']        || '',
        wbsCode:      matchWbs ? matchWbs.wbsCode : '',
        costCode:     '',
        unit:         r['Unit']            || (typeUomHint[nat + '::' + typ] || natureUomHint[nat] || ''),
        boqQty:       0,
        typeOfWork:   typ,
        natureOfWork: nat,
        masterUuid:   r['UUID']            || '',
        checkSum:     r['CheckSum']        || '',
        taskCode:     r['Task Code']       || '',
        _stale:       !!nat && !validNatures.has(nat),
      });
      added++;
    });
    closeMasterPicker();
    renderActivities();
    updateKPIs();
    const note = matchedHint(activities);
    Utils.toast(`Added ${added} activit${added === 1 ? 'y' : 'ies'}${skipped ? ` · ${skipped} skipped (duplicate)` : ''}${note ? ' · ' + note : ''}`, 'ok');
  }

  function matchedHint(activities) {
    const unmapped = activities.filter(a => !a.wbsCode).length;
    return unmapped ? `${unmapped} need a WBS row` : '';
  }

  function editAct(i, key, val) {
    if (!activities[i]) return;
    if (key === 'boqQty') val = Number(val) || 0;
    activities[i][key] = val;

    // When WBS Code changes → re-derive Nature, possibly invalidate Type
    if (key === 'wbsCode') {
      const parent = nodes.find(n => n.wbsCode === val);
      const newNature = (parent && parent.natureOfWork) || '';
      activities[i].natureOfWork = newNature;
      // If saved Type isn't valid for the new Nature, clear it
      const valid = newNature ? (natureMap[newNature] || []) : [];
      if (activities[i].typeOfWork && !valid.includes(activities[i].typeOfWork)) {
        activities[i].typeOfWork = '';
      }
      activities[i]._stale = !!newNature && !validNatures.has(newNature);
    }

    // When Type changes → auto-fill UOM from Z12 if available, refresh stale flag
    if (key === 'typeOfWork') {
      const nat = activities[i].natureOfWork || '';
      const hint = typeUomHint[nat + '::' + val] || natureUomHint[nat];
      if (hint && (!activities[i].unit || activities[i].unit === 'CUM')) {
        activities[i].unit = hint;
      }
      const validForNat = nat ? (natureMap[nat] || []) : [];
      activities[i]._stale = (!!nat && !validNatures.has(nat)) ||
                             (!!val && validForNat.length > 0 && !validForNat.includes(val));
    }
  }

  function editNode(i, key, val) {
    if (!nodes[i]) return;
    nodes[i][key] = val;
    if (key === 'wbsCode') {
      nodes[i].level = (String(val).match(/\./g) || []).length;
    }
    if (key === 'natureOfWork') {
      nodes[i]._stale = !!val && !validNatures.has(val);
    }
  }

  function addNode() {
    // Suggest the next sequential code
    const existingCodes = nodes.map(n => n.wbsCode).sort(natCmp);
    let next = '1';
    for (let i = 1; i <= 99; i++) {
      if (!existingCodes.includes(String(i))) { next = String(i); break; }
    }
    nodes.push({ wbsCode: next, wbsName: '', natureOfWork: '', level: 0, _stale: false });
    renderTree();
    renderActivities();
    updateKPIs();
  }

  function quickAddActivity() {
    activities.push({
      name: '', wbsCode: '', costCode: '', unit: '', boqQty: 0,
      typeOfWork: '', natureOfWork: '',
      masterUuid: '', checkSum: '', taskCode: '',
      _stale: false,
    });
    renderActivities();
    updateKPIs();
    // Focus the new row's Activity name
    setTimeout(() => {
      const rows = document.querySelectorAll('#actTbody tr input.desc');
      if (rows.length) rows[rows.length - 1].focus();
    }, 50);
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

  // ─── Save with Z12 validation ─────────────────────────────────
  async function save() {
    const ap = window.STATE.activeProject;
    if (!ap) { Utils.toast('Select a project first', 'err'); return; }

    // Validation rules:
    //  • Every WBS node must have a non-empty WBS Code and a Nature in Z12
    //  • Every Activity must have a non-empty name, a parent WBS that exists,
    //    and (if Type is set) the Type must be in Z12 for that Nature
    //  • Activities don't strictly require a Type, but Save warns if missing
    const badNodeNoCode   = nodes.filter(n => !String(n.wbsCode).trim());
    const badNodeNoNature = nodes.filter(n => String(n.wbsCode).trim() && !n.natureOfWork);
    const badNodeBadNat   = nodes.filter(n => n.natureOfWork && !validNatures.has(n.natureOfWork));

    const wbsSet = new Set(nodes.map(n => n.wbsCode));
    const badActNoName    = activities.filter(a => !String(a.name).trim());
    const badActNoWBS     = activities.filter(a => a.name && !wbsSet.has(a.wbsCode));
    const badActBadType   = activities.filter(a => {
      if (!a.typeOfWork) return false;
      const parent = nodes.find(n => n.wbsCode === a.wbsCode);
      const nature = (parent && parent.natureOfWork) || a.natureOfWork || '';
      const valid = nature ? (natureMap[nature] || []) : [];
      return valid.length > 0 && !valid.includes(a.typeOfWork);
    });
    const actsNoType = activities.filter(a => a.name && !a.typeOfWork);

    const errors = [];
    if (badNodeNoCode.length)   errors.push(`${badNodeNoCode.length} WBS node(s) missing a Code`);
    if (badNodeNoNature.length) errors.push(`${badNodeNoNature.length} WBS node(s) missing Nature: ${badNodeNoNature.slice(0,3).map(n=>n.wbsCode).join(', ')}${badNodeNoNature.length>3?'…':''}`);
    if (badNodeBadNat.length)   errors.push(`${badNodeBadNat.length} WBS node(s) with Nature not in Z12: ${badNodeBadNat.slice(0,3).map(n=>n.natureOfWork).join(', ')}${badNodeBadNat.length>3?'…':''}`);
    if (badActNoName.length)    errors.push(`${badActNoName.length} activit${badActNoName.length===1?'y':'ies'} missing a name`);
    if (badActNoWBS.length)     errors.push(`${badActNoWBS.length} activit${badActNoWBS.length===1?'y':'ies'} pointing to a WBS Code that doesn't exist`);
    if (badActBadType.length)   errors.push(`${badActBadType.length} activit${badActBadType.length===1?'y':'ies'} with Type not in Z12 for its Nature`);

    if (errors.length) {
      alert('🚫 Save blocked — fix these issues first:\n\n• ' + errors.join('\n• '));
      Utils.toast('Save blocked — see issues', 'err');
      return;
    }

    if (actsNoType.length) {
      const ok = confirm(`${actsNoType.length} activit${actsNoType.length===1?'y':'ies'} have no Type of Work. Save anyway?`);
      if (!ok) return;
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
        activities: activities.map(a => {
          // Re-derive nature from parent WBS to ensure consistency
          const parent = nodes.find(n => n.wbsCode === a.wbsCode);
          const nature = (parent && parent.natureOfWork) || a.natureOfWork || '';
          return {
            name:         a.name,
            wbsCode:      a.wbsCode,
            costCode:     a.costCode,
            unit:         a.unit,
            boqQty:       Number(a.boqQty) || 0,
            natureOfWork: nature,
            typeOfWork:   a.typeOfWork || '',
            masterUuid:   a.masterUuid || '',
            checkSum:     a.checkSum   || '',
            taskCode:     a.taskCode   || '',
          };
        }),
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

  return {
    load, save, exportCSV, filter, refresh,
    // Tree
    addNode, editNode, removeNode,
    // Activities
    quickAddActivity, editAct, removeActivity,
    // Master picker (for browsing M_PL_1_Activities)
    openMasterPicker, closeMasterPicker, filterMaster, toggleMasterRow, confirmMasterPick,
    onProjectChange,
  };
})();
