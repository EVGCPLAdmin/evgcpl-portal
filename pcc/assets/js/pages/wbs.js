/* ════════════════════════════════════════════════════════════════
   Step 3 · WBS  (PL12_WBS schema)
   ────────────────────────────────────────────────────────────────
   Schema:
     CheckSum              = BOQ.UUID  (FK to PL11_BOQ)
     UUID                  = PCC-WBS-{random}  (key, write once)
     Project Code          = mapped via BOQ
     BOQ ID                = mapped via BOQ
     BOQ ID (Description)  = mapped via BOQ
     Activity #            = sequential per BOQ (auto)
     Description           = user input (required)
     Unit                  = adaptive dropdown
     Qty                   = decimal (required)
     Project Name          = mapped via BOQ
     Site Name             = mapped via BOQ
     UserEmail/SystemEmail = login email (backend)
     Timestamp             = server-stamped

   NEVER WRITE: WBS Code · Related PL13_Activities
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function () {

  // ── Module state ─────────────────────────────────────────────
  let _ap    = null;    // active project
  let _boq   = [];      // BOQ rows for project
  let _items = [];      // WBS items: [{_id, uuid, checkSum, boqId, boqIdDesc, actNum, desc, unit, qty, isNew}]
  let _tmpN  = 0;

  const tmpId = () => '_tmp_' + (++_tmpN) + '_' + Date.now().toString(36);
  const g     = (r, k) => {
    if (!r) return '';
    if (r[k] !== undefined && r[k] !== null) return String(r[k]).trim();
    const kl = k.toLowerCase();
    const f  = Object.keys(r).find(x => x.toLowerCase() === kl);
    return f ? String(r[f] || '').trim() : '';
  };

  // ── Load ─────────────────────────────────────────────────────
  async function load() {
    const ap = window.STATE.activeProject;
    if (!ap) {
      document.getElementById('wbsPanels').innerHTML =
        '<div class="tree-empty" style="padding:24px">No project selected — use the project switcher.</div>';
      setStatus('No project', 'gold');
      return;
    }
    _ap = ap;
    setEl('kWbsProj',     ap['Project Code'] || '—');
    setEl('kWbsProjName', ' · ' + (ap['Project Name'] || '(no name)'));
    setStatus('Loading…', 'gold');

    const code  = ap['Project Code'];
    const byP   = r => (g(r,'Project Code') || g(r,'ProjectCode') || '') === code;

    try {
      const [boq, wbs] = await Promise.all([
        API.gviz(window.CONFIG.TABS.BOQ).catch(() => []),
        API.gviz(window.CONFIG.TABS.WBS).catch(() => []),
      ]);

      _boq   = (boq || []).filter(byP);
      const wbsRaw = (wbs || []).filter(byP);

      // Build WBS items from sheet data
      _items = wbsRaw.map(r => ({
        _id:      g(r,'UUID') || tmpId(),
        uuid:     g(r,'UUID')             || '',
        checkSum: g(r,'CheckSum')         || '',   // = BOQ UUID
        boqId:    g(r,'BOQ ID')           || '',
        boqIdDesc:g(r,'BOQ ID (Description)') || '',
        actNum:   Number(g(r,'Activity #')) || 0,
        desc:     g(r,'Description')      || g(r,'WBS Name') || '',
        unit:     g(r,'Unit')             || '',
        qty:      Number(g(r,'Qty'))      || 0,
        isNew:    false,
      }));

      render();
      updateKPIs();
      setStatus(`${_boq.length} BOQ · ${_items.length} WBS rows`, _items.length ? 'green' : 'gold');
    } catch (e) {
      setStatus('Load failed', 'red');
      console.error('[WBS]', e);
    }
  }

  // ── Render ───────────────────────────────────────────────────
  function render() {
    const container = document.getElementById('wbsPanels');
    if (!container) return;

    if (!_boq.length) {
      container.innerHTML = '<div class="tree-empty" style="padding:24px">No BOQ items — add items in Step 2 (BOQ) first.</div>';
      return;
    }

    let html = '';

    _boq.forEach((boqRow, bi) => {
      const boqUuid   = g(boqRow,'UUID')         || `_boq${bi}`;
      const boqItemN  = g(boqRow,'BOQ Item #')   || g(boqRow,'S No') || String(bi + 1);
      const boqDesc   = g(boqRow,'Description')  || '(no description)';
      const boqId     = g(boqRow,'BOQ ID')        || (boqUuid + '-' + boqItemN);
      const boqIdDesc = g(boqRow,'BOQ ID (Description)') || (boqId + ' : ' + boqDesc);
      const boqUnit   = g(boqRow,'Unit')          || '';
      const boqQty    = Number(g(boqRow,'Qty'))   || 0;
      const boqAmt    = Number(g(boqRow,'Amount'))|| 0;

      const myWbs = _items.filter(w => w.checkSum === boqUuid);

      // Action buttons in header
      const addCacheKey = 'wbs_add_' + boqUuid;
      window._WBS_CACHE = window._WBS_CACHE || {};
      window._WBS_CACHE[addCacheKey] = { boqUuid, boqId, boqIdDesc };

      html += `
      <div class="boq-group">
        <div class="boq-group-header">
          <div class="boq-grp-left">
            <span class="boq-grp-n">${Utils.esc(boqItemN)}</span>
            <span class="boq-grp-desc">${Utils.esc(boqDesc)}</span>
            <span class="boq-grp-meta">
              ${boqUnit ? Utils.esc(boqUnit) : ''}
              ${boqQty  ? ' · ' + fmtNum(boqQty) : ''}
              ${boqAmt  ? ' · ₹' + fmtNum(boqAmt) : ''}
            </span>
          </div>
          <div class="boq-grp-right">
            <span class="pill ${myWbs.length ? 'pill-green' : 'pill-gold'}" style="font-size:10px">
              ${myWbs.length} WBS
            </span>
            <button class="btn btn-secondary btn-sm"
                    onclick="PAGE.addWBS('${boqUuid}', window._WBS_CACHE['${addCacheKey}'])">
              + Add WBS
            </button>
          </div>
        </div>

        ${myWbs.length ? `
        <table class="wbs-table">
          <thead>
            <tr>
              <th class="num">#</th>
              <th class="act">Act #</th>
              <th>Description <span style="color:#86efac;font-weight:400">(required)</span></th>
              <th class="uom">Unit</th>
              <th class="qty">Qty</th>
              <th class="del"></th>
            </tr>
          </thead>
          <tbody>
            ${myWbs.map((w, wi) => {
              const idx = _items.indexOf(w);
              return `
              <tr>
                <td class="num">${wi + 1}</td>
                <td class="act">${w.actNum || (wi + 1)}</td>
                <td>
                  <input class="wbs-ie" type="text"
                         value="${Utils.esc(w.desc)}"
                         placeholder="Work scope description…"
                         oninput="PAGE.editItem(${idx},'desc',this.value)" />
                </td>
                <td>
                  <input class="wbs-ie" type="text" list="wbsUnitOptions"
                         value="${Utils.esc(w.unit)}"
                         placeholder="Unit…"
                         oninput="PAGE.editItem(${idx},'unit',this.value)"
                         autocomplete="off" />
                </td>
                <td>
                  <input class="wbs-ie num" type="number" step="0.01" min="0"
                         value="${w.qty || ''}"
                         placeholder="0"
                         oninput="PAGE.editItem(${idx},'qty',this.value)" />
                </td>
                <td>
                  <button class="btn-icon danger"
                          onclick="PAGE.removeItem(${idx})" title="Remove">×</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>` : `
        <div class="wbs-empty">
          No WBS items yet — click <strong>+ Add WBS</strong> to add work packages under this BOQ item.
        </div>`}
      </div>`;
    });

    container.innerHTML = html;
    updateKPIs();
  }

  // ── Item CRUD ─────────────────────────────────────────────────
  function addWBS(boqUuid, ctx) {
    const existing = _items.filter(w => w.checkSum === boqUuid);
    const nextAct  = existing.length + 1;
    _items.push({
      _id:       tmpId(),
      uuid:      '',
      checkSum:  boqUuid,
      boqId:     ctx.boqId      || '',
      boqIdDesc: ctx.boqIdDesc  || '',
      actNum:    nextAct,
      desc:      '',
      unit:      '',
      qty:       0,
      isNew:     true,
    });
    render();
  }

  function editItem(idx, field, val) {
    if (!_items[idx]) return;
    _items[idx][field] = field === 'qty' ? (Number(val) || 0) : val;
  }

  function removeItem(idx) {
    _items.splice(idx, 1);
    // Renumber actNums per BOQ
    const boqGroups = {};
    _items.forEach(w => {
      if (!boqGroups[w.checkSum]) boqGroups[w.checkSum] = 0;
      boqGroups[w.checkSum]++;
      w.actNum = boqGroups[w.checkSum];
    });
    render();
  }

  // ── Save ─────────────────────────────────────────────────────
  async function save() {
    const ap = _ap || window.STATE.activeProject;
    if (!ap) { Utils.toast('Select a project first', 'err'); return; }

    const invalid = _items.filter(w => !w.desc.trim());
    if (invalid.length) {
      Utils.toast(`${invalid.length} WBS item(s) missing Description — fill in before saving`, 'err');
      return;
    }

    const setBusy = b => {
      ['wbsSaveBtn','wbsSaveBtnB'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.disabled = b; el.textContent = b ? 'Saving…' : '💾 Save WBS'; }
      });
    };
    setBusy(true);

    // Reassign Activity # sequentially per BOQ before sending
    const actNByBoq = {};
    const rows = _items.map(w => {
      if (!actNByBoq[w.checkSum]) actNByBoq[w.checkSum] = 0;
      actNByBoq[w.checkSum]++;
      return {
        uuid:       w.uuid     || '',
        checkSum:   w.checkSum || '',
        boqId:      w.boqId    || '',
        boqIdDesc:  w.boqIdDesc|| '',
        activityNum:actNByBoq[w.checkSum],
        description:w.desc     || '',
        unit:       w.unit     || '',
        qty:        Number(w.qty) || 0,
      };
    });

    try {
      const r = await API.scriptCall('saveWBS', {
        projectCode: ap['Project Code'],
        projectName: ap['Project Name'] || '',
        siteName:    ap['Site Name']    || '',
        userEmail:   (window.STATE.user && (window.STATE.user.email || window.STATE.user.Email)) || '',
        nodes: rows,
        activities: [],   // Activities managed via Project Tree
      });

      if (r && r.success) {
        // Apply assigned UUIDs + actNums back to local state
        if (r.assignedNodes && Array.isArray(r.assignedNodes)) {
          r.assignedNodes.forEach(a => {
            const item = _items.find(w =>
              (w.uuid && w.uuid === a.oldUuid) ||
              (w._id  && w._id  === a.tempId)
            );
            if (item) {
              if (a.uuid)      item.uuid    = a.uuid;
              if (a.actNum)    item.actNum  = a.actNum;
              item.isNew = false;
            }
          });
        }
        render();
        Utils.toast(`Saved ${rows.length} WBS rows ✓`, 'ok');
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

  // ── Helpers ───────────────────────────────────────────────────
  function updateKPIs() {
    const covered = _boq.filter(r => {
      const boqUuid = g(r,'UUID');
      return _items.some(w => w.checkSum === boqUuid);
    }).length;
    setEl('kpiBOQCount',   _boq.length);
    setEl('kpiWBSCount',   _items.length);
    setEl('kpiBOQCovered', covered);
  }

  function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  }

  function setStatus(msg, color) {
    // status shown in page-head subtitle or fallback to toast
    const el = document.querySelector('.ph-sub');
    if (el) {
      const existSpan = el.querySelector('.wp-status');
      if (existSpan) existSpan.remove();
      const sp = document.createElement('span');
      sp.className = 'wp-status pill pill-' + color;
      sp.style.marginLeft = '10px';
      sp.textContent = msg;
      el.appendChild(sp);
    }
  }

  function fmtNum(v) {
    const n = Number(String(v || '').replace(/,/g, ''));
    return isNaN(n) ? String(v) : n.toLocaleString('en-IN');
  }

  function onProjectChange() { load(); }
  function refresh() { return load(); }

  return { load, save, addWBS, editItem, removeItem, onProjectChange, refresh };
})();
