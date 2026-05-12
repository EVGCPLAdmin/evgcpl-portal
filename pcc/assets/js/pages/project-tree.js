/* ════════════════════════════════════════════════════════════════
   Project Tree
   ────────────────────────────────────────────────────────────────
   Hierarchy:
     Project  →  BOQ items  →  WBS nodes  →  Activities
   Linkage (where it exists):
     BOQ.CheckSum  = Project.UUID  (or Project Code as fallback)
     WBS.CheckSum  = BOQ.UUID      (or BOQ S No as fallback)
     Activity.CheckSum = WBS.UUID
   ════════════════════════════════════════════════════════════════ */

window.PAGE = (function () {

  // ── State ──────────────────────────────────────────────────────
  let project    = null;   // the active project object
  let boqRows    = [];     // all BOQ rows for this project
  let wbsRows    = [];     // all WBS rows
  let actRows    = [];     // all Activity rows
  let _expanded  = {};     // nodeId → true/false (collapsed state)

  // ── Load ───────────────────────────────────────────────────────
  async function load() {
    const ap = window.STATE.activeProject;
    if (!ap) { setStatus('No project selected', 'gold'); return; }
    project = ap;
    const code = ap['Project Code'];
    document.getElementById('treeProjCode').textContent = code || '—';
    document.getElementById('treeProjName').textContent = ap['Project Name'] || '(no name)';
    setStatus('Loading…', 'gold');

    try {
      const [boq, wbs, act] = await Promise.all([
        API.gviz(window.CONFIG.TABS.BOQ).catch(() => []),
        API.gviz(window.CONFIG.TABS.WBS).catch(() => []),
        API.gviz(window.CONFIG.TABS.ACTIVITIES).catch(() => []),
      ]);

      const byProject = r => (r['Project Code'] || r['ProjectCode'] || '') === code;
      boqRows = (boq || []).filter(byProject);
      wbsRows = (wbs || []).filter(byProject);
      actRows = (act || []).filter(byProject);

      renderTree();
      setStatus(`${boqRows.length} BOQ · ${wbsRows.length} WBS · ${actRows.length} activities`, 'green');
    } catch (e) {
      setStatus('Load failed: ' + e.message, 'red');
      console.error('[ProjectTree]', e);
    }
  }

  // ── Render ─────────────────────────────────────────────────────
  function renderTree() {
    const c = document.getElementById('projectTree');
    if (!c || !project) return;

    // Project identity row
    const projId = project['UUID'] || project['Project Code'] || '';

    // Build BOQ nodes — link to project via CheckSum or Project Code
    // BOQ rows that belong to this project (already filtered).
    // Compute a synthetic UUID for BOQ rows that don't have one.
    const boqNodes = boqRows.map((r, i) => {
      const uuid = v(r, 'UUID') || v(r, 'uuid');
      const cs   = v(r, 'CheckSum') || v(r, 'Checksum');
      return {
        uuid:      uuid || `_boq_${i}_${v(r,'S No') || i}`,
        checkSum:  cs   || projId,          // links to project
        sNo:       v(r, 'S No')   || String(i + 1),
        desc:      v(r, 'Description') || '(no description)',
        unit:      v(r, 'Unit')   || '',
        qty:       v(r, 'Qty')    || '',
        rate:      v(r, 'Rate')   || '',
        amount:    v(r, 'Amount') || '',
        _raw: r,
      };
    });

    // Build WBS nodes — link to BOQ via CheckSum → BOQ.UUID
    const wbsNodes = wbsRows.map((r, i) => {
      const uuid = v(r, 'UUID') || v(r, 'uuid');
      const cs   = v(r, 'CheckSum') || v(r, 'Checksum');
      return {
        uuid:    uuid || `_wbs_${i}`,
        checkSum: cs || '',             // = parent BOQ.UUID (if linked)
        code:    v(r, 'WBS Code') || ('WBS-' + String(i + 1).padStart(3, '0')),
        name:    v(r, 'WBS Name') || v(r, 'Name') || '(unnamed)',
        _raw: r,
      };
    });

    // Build Activity nodes — link to WBS via CheckSum → WBS.UUID
    const actNodes = actRows.map((r, i) => ({
      checkSum:    v(r, 'CheckSum') || v(r, 'Checksum') || '',
      name:        v(r, 'Activity') || '(unnamed)',
      nature:      v(r, 'Nature of Work') || '',
      type:        v(r, 'Type of Work')   || '',
      unit:        v(r, 'Unit')           || '',
      costCode:    v(r, 'Cost Code')      || '',
      boqQty:      v(r, 'BOQ Qty')        || '',
      taskCode:    v(r, 'Task Code')      || '',
      _raw: r,
    }));

    // ── Assign WBS to BOQ ──
    // If WBS has a CheckSum that matches a BOQ UUID → linked
    // If not → attach to "unlinked" bucket shown under all BOQs
    const wbsByBoq   = {};   // boqUuid → [wbsNode]
    const wbsUnlinked = [];
    const boqUuidSet = new Set(boqNodes.map(b => b.uuid));

    wbsNodes.forEach(w => {
      if (w.checkSum && boqUuidSet.has(w.checkSum)) {
        (wbsByBoq[w.checkSum] = wbsByBoq[w.checkSum] || []).push(w);
      } else {
        wbsUnlinked.push(w);
      }
    });

    // ── Assign Activities to WBS ──
    const actsByWbs = {};   // wbsUuid → [actNode]
    const actUnlinked = [];
    const wbsUuidSet = new Set(wbsNodes.map(w => w.uuid));

    actNodes.forEach(a => {
      if (a.checkSum && wbsUuidSet.has(a.checkSum)) {
        (actsByWbs[a.checkSum] = actsByWbs[a.checkSum] || []).push(a);
      } else {
        actUnlinked.push(a);
      }
    });

    // ── HTML ──
    const projNodeId = 'proj_' + (project['Project Code'] || 'x');
    const isOpen = id => _expanded[id] !== false;  // default = open

    let html = `
    <div class="tree-project" id="${projNodeId}">
      <div class="tree-row level-0" onclick="PAGE.toggle('${projNodeId}')">
        <span class="tree-chevron">${isOpen(projNodeId) ? '▼' : '▶'}</span>
        <span class="tree-icon">📁</span>
        <span class="tree-label">
          <strong>${Utils.esc(project['Project Code'] || '—')}</strong>
          <span class="tree-meta"> · ${Utils.esc(project['Project Name'] || '(no name)')}</span>
        </span>
        <span class="tree-badges">
          ${badge(boqNodes.length, 'BOQ', 'green')}
          ${badge(wbsNodes.length, 'WBS', 'blue')}
          ${badge(actNodes.length, 'Activities', 'gold')}
        </span>
      </div>

      ${isOpen(projNodeId) ? renderBoqLevel(boqNodes, wbsByBoq, actsByWbs, wbsUnlinked, actUnlinked) : ''}
    </div>`;

    c.innerHTML = html;
  }

  function renderBoqLevel(boqNodes, wbsByBoq, actsByWbs, wbsUnlinked, actUnlinked) {
    const isOpen = id => _expanded[id] !== false;
    if (!boqNodes.length && !wbsUnlinked.length && !actUnlinked.length) {
      return `<div class="tree-empty">No BOQ items yet — go to Step 2 (BOQ) to add them.</div>`;
    }

    let html = `<div class="tree-children">`;

    boqNodes.forEach((b, bi) => {
      const nodeId = 'boq_' + b.uuid;
      const myWbs = wbsByBoq[b.uuid] || [];
      const totalActs = myWbs.reduce((n, w) => n + (actsByWbs[w.uuid] || []).length, 0);
      const amt = b.amount ? ' · ₹' + fmtNum(b.amount) : '';

      html += `
      <div class="tree-boq" id="${nodeId}">
        <div class="tree-row level-1" onclick="PAGE.toggle('${nodeId}')">
          <span class="tree-chevron">${isOpen(nodeId) ? '▼' : '▶'}</span>
          <span class="tree-icon">📋</span>
          <span class="tree-sno mono">${Utils.esc(b.sNo)}</span>
          <span class="tree-label">
            <strong>${Utils.esc(b.desc)}</strong>
            <span class="tree-meta">${Utils.esc(b.unit)} ${b.qty ? '· Qty: ' + b.qty : ''}${amt}</span>
          </span>
          <span class="tree-badges">
            ${badge(myWbs.length, 'WBS', 'blue')}
            ${badge(totalActs, 'act', 'gold')}
          </span>
        </div>
        ${isOpen(nodeId) ? renderWbsLevel(myWbs, actsByWbs, b.uuid) : ''}
      </div>`;
    });

    // Unlinked WBS (no BOQ link)
    if (wbsUnlinked.length) {
      const nodeId = 'boq_unlinked';
      html += `
      <div class="tree-boq unlinked" id="${nodeId}">
        <div class="tree-row level-1 unlinked-row" onclick="PAGE.toggle('${nodeId}')">
          <span class="tree-chevron">${isOpen(nodeId) ? '▼' : '▶'}</span>
          <span class="tree-icon">📋</span>
          <span class="tree-sno mono" style="color:var(--gold)">—</span>
          <span class="tree-label">
            <strong style="color:var(--gold)">WBS not linked to any BOQ item</strong>
            <span class="tree-meta"> · assign BOQ link to enable full tree</span>
          </span>
          ${badge(wbsUnlinked.length, 'WBS', 'gold')}
        </div>
        ${isOpen(nodeId) ? renderWbsLevel(wbsUnlinked, actsByWbs, null) : ''}
      </div>`;
    }

    html += `</div>`;
    return html;
  }

  function renderWbsLevel(wbsNodes, actsByWbs, boqUuid) {
    if (!wbsNodes.length) {
      return `<div class="tree-children"><div class="tree-empty">No WBS items linked to this BOQ — go to Step 3 (WBS) to add.</div></div>`;
    }
    const isOpen = id => _expanded[id] !== false;
    let html = `<div class="tree-children">`;

    wbsNodes.forEach(w => {
      const nodeId = 'wbs_' + w.uuid;
      const myActs = actsByWbs[w.uuid] || [];

      html += `
      <div class="tree-wbs" id="${nodeId}">
        <div class="tree-row level-2" onclick="PAGE.toggle('${nodeId}')">
          <span class="tree-chevron">${isOpen(nodeId) ? '▼' : '▶'}</span>
          <span class="tree-icon">🌳</span>
          <span class="tree-sno mono green">${Utils.esc(w.code)}</span>
          <span class="tree-label">
            <strong>${Utils.esc(w.name)}</strong>
          </span>
          ${badge(myActs.length, 'act', myActs.length ? 'green' : 'grey')}
        </div>
        ${isOpen(nodeId) ? renderActLevel(myActs, w) : ''}
      </div>`;
    });

    html += `</div>`;
    return html;
  }

  function renderActLevel(acts, wbsNode) {
    if (!acts.length) {
      return `<div class="tree-children"><div class="tree-empty">No activities — go to Step 3 (WBS) and click 📚 Add activities.</div></div>`;
    }
    return `
    <div class="tree-children">
      <table class="tree-acts-table">
        <thead>
          <tr>
            <th>#</th><th>Activity</th><th>Nature</th>
            <th>Type of Work</th><th>UoM</th><th style="text-align:right">BOQ Qty</th><th>Cost Code</th>
          </tr>
        </thead>
        <tbody>
          ${acts.map((a, i) => `
          <tr>
            <td class="mono">${i + 1}</td>
            <td>
              <strong>${Utils.esc(a.name)}</strong>
              ${a.taskCode ? `<div class="task-sub">${Utils.esc(a.taskCode)}</div>` : ''}
            </td>
            <td style="color:var(--green);font-weight:600;font-size:11px">${Utils.esc(a.nature || '—')}</td>
            <td style="font-size:11px">${Utils.esc(a.type || '—')}</td>
            <td class="mono">${Utils.esc(a.unit || '—')}</td>
            <td class="mono" style="text-align:right">${a.boqQty || '—'}</td>
            <td style="font-size:11px;color:var(--text-faint)">${Utils.esc(a.costCode || '—')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

  // ── Helpers ────────────────────────────────────────────────────
  // Get a field value case-insensitively from a gviz row object
  function v(row, key) {
    if (!row) return '';
    // Direct match first
    if (row[key] !== undefined && row[key] !== null) return String(row[key]).trim();
    // Case-insensitive fallback
    const kl = key.toLowerCase();
    const found = Object.keys(row).find(k => k.toLowerCase() === kl);
    return found ? String(row[found] || '').trim() : '';
  }

  function badge(count, label, color) {
    const bg = { green:'#dcfce7', blue:'#dbeafe', gold:'#fef9c3', grey:'rgba(0,0,0,.05)' };
    const fg = { green:'#166534', blue:'#1e3a8a', gold:'#92400e', grey:'#888' };
    return `<span class="tree-badge" style="background:${bg[color]||bg.grey};color:${fg[color]||fg.grey}">${count} ${label}</span>`;
  }

  function fmtNum(v) {
    const n = Number(String(v).replace(/,/g, ''));
    return isNaN(n) ? v : n.toLocaleString('en-IN');
  }

  function setStatus(msg, color) {
    const el = document.getElementById('treeStatus');
    if (el) { el.textContent = msg; el.className = 'pill pill-' + color; }
  }

  // ── Toggle collapse ────────────────────────────────────────────
  function toggle(nodeId) {
    _expanded[nodeId] = !(_expanded[nodeId] !== false);
    renderTree();
  }

  // ── Expand / Collapse all ──────────────────────────────────────
  function expandAll() {
    getAllNodeIds().forEach(id => { _expanded[id] = true; });
    renderTree();
  }

  function collapseAll() {
    getAllNodeIds().forEach(id => { _expanded[id] = false; });
    renderTree();
  }

  function getAllNodeIds() {
    const ids = [];
    if (project) ids.push('proj_' + (project['Project Code'] || 'x'));
    boqRows.forEach((r, i) => {
      const uuid = v(r, 'UUID') || `_boq_${i}_${v(r,'S No') || i}`;
      ids.push('boq_' + uuid);
    });
    ids.push('boq_unlinked');
    wbsRows.forEach((r, i) => {
      const uuid = v(r, 'UUID') || `_wbs_${i}`;
      ids.push('wbs_' + uuid);
    });
    return ids;
  }

  function onProjectChange() { load(); }
  function filter() {}        // no-op (tree is full view)
  function refresh() { load(); }

  return { load, toggle, expandAll, collapseAll, onProjectChange, filter, refresh };
})();
