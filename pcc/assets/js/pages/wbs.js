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

      // ── Load saved per-project WBS nodes ──
      // WBS nodes are project-specific (no stale check — Nature has been removed
      // from WBS rows; it lives on Activities via the master pick).
      nodes = (w || [])
        .filter(r => (r['Project Code'] || r['ProjectCode']) === code)
        .map(r => {
          const wbsCode = String(r['WBS Code'] || r['Code'] || '').trim();
          const wbsName = String(r['WBS Name'] || r['Name'] || r['Description'] || '').trim();
          return {
            wbsCode,
            wbsName,
            level: (wbsCode.match(/\./g) || []).length,
          };
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

      costCodes = (cc || []).map(r => ({
        code: r['Cost Code'] || r['Code'] || '',
        name: r['Description'] || r['Name'] || '',
      })).filter(c => c.code);

      renderTree();
      renderActivities();
      updateKPIs();

      const staleActs = activities.filter(a => a._stale).length;
      if (staleActs) {
        setStatus(`⚠ ${staleActs} stale activit${staleActs === 1 ? 'y' : 'ies'}`, 'red');
        Utils.toast(`${staleActs} activit${staleActs === 1 ? 'y' : 'ies'} with Nature/Type not in Z12 — reassign WBS to fix`, 'err');
      } else {
        setStatus(nodes.length ? `${nodes.length} node${nodes.length===1?'':'s'} · ${activities.length} activit${activities.length===1?'y':'ies'}` : 'Empty', nodes.length ? 'green' : 'gold');
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

  // ─── WBS tree ─────────────────────────────────────────────────
  // WBS rows = Code + Name only. Nature belongs to Activities via master.
  // Can be typed manually OR picked from M_PL_1_Activities DISTINCT WBS Codes.
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
      c.innerHTML = '<div class="plp-empty">No WBS nodes yet. Click <strong>+ Add WBS Node</strong> or <strong>📚 Pick WBS from master</strong>.</div>';
      return;
    }
    list = list.slice().sort((a, b) => natCmp(a.wbsCode, b.wbsCode));

    c.innerHTML = list.map(n => {
      const lvl = Math.min(n.level || 0, 3);
      const idx = nodes.indexOf(n);
      const actCount = activities.filter(a =>
        a.wbsCode === n.wbsCode || String(a.wbsCode).startsWith(n.wbsCode + '.')
      ).length;

      return `<div class="wbs-node lvl-${lvl}">
        <input class="wbs-code-edit mono" value="${Utils.esc(n.wbsCode)}"
          onchange="PAGE.editNode(${idx},'wbsCode',this.value);PAGE.refresh()"
          placeholder="1.2.3" title="WBS Code (e.g. 1, 1.2, 1.2.3)" />
        <input class="wbs-name-edit" value="${Utils.esc(n.wbsName)}"
          onchange="PAGE.editNode(${idx},'wbsName',this.value)"
          placeholder="Description of this WBS item" style="flex:1" />
        <span class="wbs-meta">${actCount} ${actCount === 1 ? 'activity' : 'activities'}</span>
        <button class="btn-icon danger" onclick="PAGE.removeNode(${idx})" title="Remove">&times;</button>
      </div>`;
    }).join('');
  }

  // ─── WBS Picker (DISTINCT WBS Codes from M_PL_1_Activities) ──
  let _wbsPickerSelected = new Set();

  function openWbsPicker() {
    if (!masterRows.length) {
      Utils.toast('M_PL_1_Activities is empty or not shared publicly', 'err');
      return;
    }
    const overlay = document.getElementById('wbsPickerOverlay');
    if (!overlay) return;
    _wbsPickerSelected = new Set();
    renderWbsPickerTable();
    overlay.style.display = 'flex';
    setTimeout(() => document.getElementById('wpkSearch')?.focus(), 60);
  }

  function closeWbsPicker() {
    const overlay = document.getElementById('wbsPickerOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  function renderWbsPickerTable() {
    const tbody  = document.getElementById('wpkTbody');
    const search = (document.getElementById('wpkSearch')?.value || '').toLowerCase().trim();
    if (!tbody) return;

    // Build DISTINCT list of (WBS Code, description-from-Activity) from master
    const wbsMap = new Map(); // wbsCode → { wbsCode, actCount, natures }
    masterRows.forEach(r => {
      const wbs = String(r['WBS Code'] || '').trim();
      if (!wbs) return;
      if (!wbsMap.has(wbs)) wbsMap.set(wbs, { wbsCode: wbs, actCount: 0, natures: new Set() });
      const e = wbsMap.get(wbs);
      e.actCount++;
      const nat = String(r['Nature of Work'] || '').trim();
      if (nat) e.natures.add(nat);
    });
    let wbsList = [...wbsMap.values()].sort((a, b) => natCmp(a.wbsCode, b.wbsCode));
    if (search) wbsList = wbsList.filter(w => w.wbsCode.toLowerCase().includes(search));
    const existing = new Set(nodes.map(n => n.wbsCode));

    document.getElementById('wpkCount').textContent = `${wbsList.length} of ${wbsMap.size}`;

    if (!wbsList.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">No WBS codes match.</td></tr>';
      return;
    }

    tbody.innerHTML = wbsList.map(w => {
      const sel = _wbsPickerSelected.has(w.wbsCode);
      const already = existing.has(w.wbsCode);
      const natLabels = [...w.natures].sort().join(', ');
      return `<tr class="${sel?'sel':''}${already?' disabled':''}"
          onclick="${already ? '' : `PAGE.toggleWbsRow('${Utils.esc(w.wbsCode)}')`}"
          style="cursor:${already?'default':'pointer'}">
        <td><input type="checkbox" ${sel?'checked':''} ${already?'disabled title="Already added"':''}
          onclick="event.stopPropagation();${already?'':` PAGE.toggleWbsRow('${Utils.esc(w.wbsCode)}')`}"></td>
        <td class="mono" style="color:var(--green);font-weight:700">${Utils.esc(w.wbsCode)}</td>
        <td style="font-size:11px;color:var(--text-dim)">${Utils.esc(natLabels||'—')}</td>
        <td class="mono" style="text-align:right;font-size:10.5px;color:var(--text-faint)">${w.actCount} act${w.actCount===1?'':'s'}${already?' · <span style="color:var(--gold)">added</span>':''}</td>
      </tr>`;
    }).join('');

    document.getElementById('wpkSelectedCount').textContent = `${_wbsPickerSelected.size} selected`;
  }

  function toggleWbsRow(wbsCode) {
    if (_wbsPickerSelected.has(wbsCode)) _wbsPickerSelected.delete(wbsCode);
    else _wbsPickerSelected.add(wbsCode);
    renderWbsPickerTable();
  }

  function confirmWbsPick() {
    let added = 0;
    _wbsPickerSelected.forEach(wbsCode => {
      if (nodes.some(n => n.wbsCode === wbsCode)) return; // skip duplicate
      nodes.push({ wbsCode, wbsName: '', level: (wbsCode.match(/\./g)||[]).length, _stale: false });
      added++;
    });
    closeWbsPicker();
    renderTree();
    renderActivities();
    updateKPIs();
    Utils.toast(`Added ${added} WBS node${added===1?'':'s'}`, 'ok');
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
      t.innerHTML = '<tr><td colspan="9" class="empty-cell">No activities yet — use <strong>📚 Pick from master</strong> to add from M_PL_1_Activities.</td></tr>';
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
      // Nature comes from the activity's master pick — NOT from the parent WBS node
      // (WBS nodes no longer carry Nature)
      const nature = String(a.natureOfWork || '').trim();
      const wbsSelected = wbsOpts.replace(`value="${Utils.esc(a.wbsCode)}"`, `value="${Utils.esc(a.wbsCode)}" selected`);
      const ccSelected  = ccOpts.replace(`value="${Utils.esc(a.costCode)}"`,  `value="${Utils.esc(a.costCode)}" selected`);

      // Stale: Type not valid for the activity's Nature in Z12
      const typeChoices = nature ? (natureMap[nature] || []) : [];
      const staleType = a.typeOfWork && nature && typeChoices.length && !typeChoices.includes(a.typeOfWork);
      const staleCls = staleType ? ' row-stale' : '';
      const staleTag = staleType
        ? `<span class="stale-tag" title="Type not in Z12 for Nature: ${Utils.esc(nature)}">⚠</span>`
        : '';
      const typeDisplay = staleType
        ? `<span class="locked-val stale-val" title="Not in Z12 for Nature: ${Utils.esc(nature)}">⚠ ${Utils.esc(a.typeOfWork)}</span>`
        : `<span class="locked-val">${Utils.esc(a.typeOfWork || '—')}</span>`;
      const uomDisplay = `<span class="locked-val">${Utils.esc(a.unit || '—')}</span>`;

      return `
      <tr class="${staleCls}" data-idx="${i}">
        <td class="mono" style="white-space:nowrap">${i + 1}${staleTag}</td>

        <!-- Activity name — LOCKED from M_PL_1_Activities picker -->
        <td class="locked-cell" title="Locked — picked from M_PL_1_Activities master">${Utils.esc(a.name)}
          ${a.taskCode ? `<div style="font-size:9.5px;color:var(--text-faint);font-family:monospace">${Utils.esc(a.taskCode)}</div>` : ''}
        </td>

        <!-- WBS Code — editable dropdown of project's WBS rows -->
        <td><select class="unit-select wbs-pick" onchange="PAGE.editAct(${i},'wbsCode',this.value);PAGE.refresh()"
            title="Pick parent WBS row — Nature auto-fills">${wbsSelected}</select></td>

        <!-- Nature — read-only, inherited from parent WBS -->
        <td class="locked-cell" style="color:var(--green);font-weight:600;font-size:11px"
            title="Inherited from parent WBS row's Nature">${Utils.esc(nature || '—')}</td>

        <!-- Type of Work — LOCKED from Z12 via master pick -->
        <td class="locked-cell" title="Locked — sourced from Z12 master via M_PL_1_Activities">${typeDisplay}</td>

        <!-- Cost Code — editable -->
        <td><select class="unit-select" onchange="PAGE.editAct(${i},'costCode',this.value)">${ccSelected}</select></td>

        <!-- UoM — LOCKED from Z12 auto-fill -->
        <td class="locked-cell" style="text-align:center" title="Locked — auto-filled from Z12 when activity was picked">${uomDisplay}</td>

        <!-- BOQ Qty — editable -->
        <td><input class="inline-edit num" type="number" step="0.01" min="0" value="${a.boqQty}"
            oninput="PAGE.editAct(${i},'boqQty',this.value)" /></td>

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
  let _pickerSelected = new Map(); // compositeKey → master row object
  let _rowKeyMap      = new Map(); // compositeKey → master row (rebuilt on each render)

  function openMasterPicker() {
    const overlay = document.getElementById('masterPickerOverlay');
    if (!overlay) return;
    if (!masterRows.length) {
      Utils.toast('Master M_PL_1_Activities is empty or not shared publicly', 'err');
      return;
    }
    _pickerSelected = new Map();
    _rowKeyMap      = new Map();
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

    // Build a key→row lookup used by toggleMasterRow (survives across re-renders
    // because it's rebuilt every time renderMasterTable runs)
    _rowKeyMap = new Map();
    tbody.innerHTML = filtered.slice(0, 500).map((r, rowIdx) => {
      const rawCs = String(r['CheckSum'] || r['UUID'] || '').trim();
      const cs = rawCs || `_row_${rowIdx}_${String(r['Activity']||'').slice(0,20)}_${String(r['WBS Code']||'').slice(0,10)}`;
      _rowKeyMap.set(cs, r); // register for toggleMasterRow lookup
      const sel = _pickerSelected.has(cs);
      const already = activities.some(a =>
        // Duplicate check: same CheckSum (if both have one) OR same Activity+WBS combo
        (rawCs && a.checkSum && a.checkSum === rawCs) ||
        (!rawCs && a.name === (r['Activity']||'') && a.wbsCode === (r['WBS Code']||''))
      );
      // Escape the key for use in onclick attr — apostrophes must be escaped
      const csAttr = cs.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      return `<tr class="${sel ? 'sel' : ''}${already ? ' disabled' : ''}" onclick="${already ? '' : `PAGE.toggleMasterRow('${csAttr}')`}" style="cursor:${already?'default':'pointer'}">
        <td><input type="checkbox" ${sel ? 'checked' : ''} ${already ? 'disabled title="Already added"' : ''} onclick="event.stopPropagation();${already?'':` PAGE.toggleMasterRow('${csAttr}')`}"></td>
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

  function toggleMasterRow(key) {
    if (_pickerSelected.has(key)) {
      _pickerSelected.delete(key);
    } else {
      // The key was generated inside renderMasterTable using the filtered-slice rowIdx.
      // We can't reconstruct the exact row from the key alone, so we stored the row
      // in a temporary lookup map built alongside the tbody render.
      const row = _rowKeyMap.get(key);
      if (row) _pickerSelected.set(key, row);
    }
    renderMasterTable();
  }

  function confirmMasterPick() {
    let added = 0, skipped = 0;
    _pickerSelected.forEach((r) => {
      if (!r) { skipped++; return; }
      const rawCs  = String(r['CheckSum'] || r['UUID'] || '').trim();
      const nat    = String(r['Nature of Work'] || '').trim();
      const typ    = String(r['Type of Work']   || '').trim();
      const wbsKey = String(r['WBS Code']       || '').trim();
      // Duplicate check
      const isDup = activities.some(a =>
        (rawCs && a.checkSum === rawCs) ||
        (!rawCs && a.name === (r['Activity']||'') && a.wbsCode === wbsKey)
      );
      if (isDup) { skipped++; return; }
      const uom = typeUomHint[nat + '::' + typ] || natureUomHint[nat] || String(r['Unit'] || '').trim();
      // Link to matching project WBS row; fall back to master WBS Code as placeholder
      const matchWbs = nodes.find(n => n.wbsCode === wbsKey);
      activities.push({
        name:         r['Activity']  || '',
        wbsCode:      matchWbs ? matchWbs.wbsCode : wbsKey,
        costCode:     '',
        unit:         uom,
        boqQty:       0,
        typeOfWork:   typ,
        natureOfWork: nat,
        masterUuid:   r['UUID']      || '',
        checkSum:     rawCs,
        taskCode:     r['Task Code'] || '',
        _stale:       false,
      });
      added++;
    });
    closeMasterPicker();
    renderActivities();
    updateKPIs();
    const unmapped = activities.filter(a => !nodes.some(n => n.wbsCode === a.wbsCode)).length;
    Utils.toast(
      `Added ${added} activit${added===1?'y':'ies'}` +
      (skipped  ? ` · ${skipped} skipped` : '') +
      (unmapped ? ` · ${unmapped} need a WBS row — assign below` : ''),
      'ok'
    );
  }

  function matchedHint(acts) {
    const unmapped = acts.filter(a => !a.wbsCode).length;
    return unmapped ? `${unmapped} need a WBS row` : '';
  }

  function editAct(i, key, val) {
    if (!activities[i]) return;
    // LOCKED fields — sourced from master, cannot be changed after pick
    const LOCKED = ['name', 'typeOfWork', 'unit', 'natureOfWork', 'masterUuid', 'checkSum', 'taskCode'];
    if (LOCKED.includes(key)) return;
    if (key === 'boqQty') val = Number(val) || 0;
    activities[i][key] = val;
    // Nature is carried on the Activity from the master pick — no WBS-derived Nature
  }

  // quickAddActivity intentionally removed — activities must come from master picker

  function editNode(i, key, val) {
    if (!nodes[i]) return;
    nodes[i][key] = val;
    if (key === 'wbsCode') {
      nodes[i].level = (String(val).match(/\./g) || []).length;
    }
    // natureOfWork removed from WBS nodes — no stale check
  }

  function addNode() {
    const existingCodes = nodes.map(n => n.wbsCode).sort(natCmp);
    let next = '1';
    for (let i = 1; i <= 99; i++) {
      if (!existingCodes.includes(String(i))) { next = String(i); break; }
    }
    nodes.push({ wbsCode: next, wbsName: '', level: 0 });
    renderTree();
    renderActivities();
    updateKPIs();
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

    // Validation:
    //  • WBS nodes need a non-empty Code
    //  • Activities need a name and a valid parent WBS Code
    //  • If Activity has a Type, it must be valid for its Nature in Z12 (warn only)
    const badNodeNoCode = nodes.filter(n => !String(n.wbsCode).trim());
    const wbsSet        = new Set(nodes.map(n => n.wbsCode));
    const badActNoName  = activities.filter(a => !String(a.name).trim());
    const badActNoWBS   = activities.filter(a => a.name && a.wbsCode && !wbsSet.has(a.wbsCode));
    const badActBadType = activities.filter(a => {
      if (!a.typeOfWork || !a.natureOfWork) return false;
      const valid = natureMap[a.natureOfWork] || [];
      return valid.length > 0 && !valid.includes(a.typeOfWork);
    });
    const actsNoType = activities.filter(a => a.name && !a.typeOfWork);

    const errors = [];
    if (badNodeNoCode.length) errors.push(`${badNodeNoCode.length} WBS node(s) missing a Code`);
    if (badActNoName.length)  errors.push(`${badActNoName.length} activit${badActNoName.length===1?'y':'ies'} missing a name`);
    if (badActNoWBS.length)   errors.push(`${badActNoWBS.length} activit${badActNoWBS.length===1?'y':'ies'} assigned to a WBS Code that doesn't exist in this project`);
    if (badActBadType.length) errors.push(`${badActBadType.length} activit${badActBadType.length===1?'y':'ies'} with Type not in Z12 for its Nature`);

    if (errors.length) {
      alert('🚫 Save blocked:\n\n• ' + errors.join('\n• '));
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
        nodes: nodes.map(n => ({
          wbsCode:  n.wbsCode,
          wbsName:  n.wbsName,
        })),
        activities: activities.map(a => ({
          name:         a.name,
          wbsCode:      a.wbsCode,
          costCode:     a.costCode,
          unit:         a.unit,
          boqQty:       Number(a.boqQty) || 0,
          natureOfWork: a.natureOfWork || '',
          typeOfWork:   a.typeOfWork   || '',
          masterUuid:   a.masterUuid   || '',
          checkSum:     a.checkSum     || '',
          taskCode:     a.taskCode     || '',
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

  return {
    load, save, exportCSV, filter, refresh,
    addNode, editNode, removeNode,
    editAct, removeActivity,
    openWbsPicker, closeWbsPicker, toggleWbsRow, confirmWbsPick, renderWbsPickerTable,
    openMasterPicker, closeMasterPicker, filterMaster, toggleMasterRow, confirmMasterPick,
    onProjectChange,
  };
})();
