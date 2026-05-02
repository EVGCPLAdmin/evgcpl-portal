/* ════════════════════════════════════════════════════════════════
   Step 3 · WBS
   - Tree rendered from "WBS" tab (level inferred from code dots)
   - Activities table from "Activities" tab
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function() {

  let nodes      = [];   // [{wbsCode, wbsName, parent, level}]
  let activities = [];   // [{name, wbsCode, costCode, unit, boqQty}]
  let costCodes  = [];

  async function load() {
    const ap = window.STATE.activeProject;
    if (!ap) { Utils.toast('Select a project first', 'err'); return; }
    document.getElementById('kWbsProj').textContent     = ap['Project Code'] || '—';
    document.getElementById('kWbsProjName').textContent = ap['Project Name'] || '(no name)';

    setStatus('Loading…', 'gold');
    const code = ap['Project Code'];

    try {
      const [w, a, cc] = await Promise.all([
        API.gviz(window.CONFIG.TABS.WBS),
        API.gviz(window.CONFIG.TABS.ACTIVITIES),
        API.gviz(window.CONFIG.TABS.COSTCODE),
      ]);
      nodes = (w || [])
        .filter(r => (r['Project Code'] || r['ProjectCode']) === code)
        .map(r => ({
          wbsCode: String(r['WBS Code'] || r['Code'] || '').trim(),
          wbsName: r['WBS Name'] || r['Name'] || r['Description'] || '',
        }))
        .filter(n => n.wbsCode);

      activities = (a || [])
        .filter(r => (r['Project Code'] || r['ProjectCode']) === code)
        .map(r => ({
          name:     r['Activity'] || r['Activity Name'] || r['Name'] || '',
          wbsCode:  r['WBS Code'] || r['WBS'] || '',
          costCode: r['Cost Code'] || r['CostCode'] || '',
          unit:     r['Unit'] || 'CUM',
          boqQty:   Number(r['BOQ Qty'] || r['Quantity'] || 0),
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
    c.innerHTML = list.map(n => {
      const lvl = Math.min(n.level || 0, 3);
      // Count activities under this node (exact match + children prefix)
      const actCount = activities.filter(a =>
        a.wbsCode === n.wbsCode || String(a.wbsCode).startsWith(n.wbsCode + '.')
      ).length;
      return `<div class="wbs-node lvl-${lvl}">
        <span class="wbs-code">${Utils.esc(n.wbsCode)}</span>
        <span class="wbs-name">${Utils.esc(n.wbsName)}</span>
        <span class="wbs-meta">${actCount} ${actCount === 1 ? 'activity' : 'activities'}</span>
      </div>`;
    }).join('');
  }

  function renderActivities() {
    const t = document.getElementById('actTbody');
    if (!t) return;
    if (!activities.length) {
      t.innerHTML = '<tr><td colspan="7" class="empty-cell">No activities yet.</td></tr>';
      return;
    }
    const wbsOpts = ['<option value="">— WBS —</option>'].concat(
      nodes.slice().sort((a, b) => natCmp(a.wbsCode, b.wbsCode))
        .map(n => `<option value="${Utils.esc(n.wbsCode)}">${Utils.esc(n.wbsCode)} · ${Utils.esc(n.wbsName)}</option>`)
    ).join('');
    const ccOpts = ['<option value="">— CC —</option>'].concat(
      costCodes.map(c => `<option value="${Utils.esc(c.code)}">${Utils.esc(c.code)} · ${Utils.esc(c.name)}</option>`)
    ).join('');

    t.innerHTML = activities.map((a, i) => `
      <tr>
        <td class="mono">${i + 1}</td>
        <td><input class="inline-edit desc" value="${Utils.esc(a.name)}" oninput="PAGE.editAct(${i},'name',this.value)" /></td>
        <td><select class="unit-select" onchange="PAGE.editAct(${i},'wbsCode',this.value)">${wbsOpts.replace(`value="${Utils.esc(a.wbsCode)}"`, `value="${Utils.esc(a.wbsCode)}" selected`)}</select></td>
        <td><select class="unit-select" onchange="PAGE.editAct(${i},'costCode',this.value)">${ccOpts.replace(`value="${Utils.esc(a.costCode)}"`, `value="${Utils.esc(a.costCode)}" selected`)}</select></td>
        <td><input class="inline-edit" value="${Utils.esc(a.unit)}" oninput="PAGE.editAct(${i},'unit',this.value)" /></td>
        <td><input class="inline-edit num" type="number" step="0.01" value="${a.boqQty}" oninput="PAGE.editAct(${i},'boqQty',this.value)" /></td>
        <td><button class="btn-icon danger" onclick="PAGE.removeActivity(${i})" title="Remove">&times;</button></td>
      </tr>
    `).join('');
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
    nodes.push({
      wbsCode: code.trim(),
      wbsName: name.trim(),
      level:  (code.match(/\./g) || []).length,
    });
    renderTree();
    renderActivities();
    updateKPIs();
  }

  function quickAddActivity() {
    const inp = document.getElementById('quickActInput');
    const name = inp.value.trim();
    if (!name) return;
    activities.push({ name, wbsCode: '', costCode: '', unit: 'CUM', boqQty: 0 });
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
    const lines = ['Type,Code,Name,WBS Code,Cost Code,Unit,BOQ Qty'];
    nodes.forEach(n => lines.push(['WBS', n.wbsCode, q(n.wbsName), '', '', '', ''].join(',')));
    activities.forEach(a => lines.push(['Activity', '', q(a.name), a.wbsCode, a.costCode, a.unit, a.boqQty].join(',')));
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
        nodes:      nodes.map(n => ({ wbsCode: n.wbsCode, wbsName: n.wbsName })),
        activities: activities.map(a => ({
          name: a.name, wbsCode: a.wbsCode, costCode: a.costCode,
          unit: a.unit, boqQty: Number(a.boqQty) || 0,
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
    load, save, exportCSV,
    addNode, quickAddActivity, editAct, removeActivity, filter,
    onProjectChange,
  };
})();
