/* ════════════════════════════════════════════════════════════════
   PAGE · Materials (Step 5C)
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function() {

  async function load() {
    if (!window.STATE.activeProject) return;
    const code = window.STATE.activeProject['Project Code'];
    const [acts, mt] = await Promise.all([
      API.gviz(window.CONFIG.TABS.ACTIVITIES),
      API.gviz(window.CONFIG.TABS.MATERIALS),
    ]);
    window.STATE.activities = acts.filter(r => r['Project Code'] === code);
    window.STATE.materials  = mt.filter(r => r['Project Code'] === code);
    render();
  }

  function activitySelect(currentCode, onchange) {
    if (!window.STATE.activities.length) {
      return `<input type="text" value="${Utils.esc(currentCode || '')}" placeholder="Activity Code" oninput="${onchange}" />`;
    }
    return `<select onchange="${onchange}">
      <option value="">— Select —</option>
      ${window.STATE.activities.map(a => {
        const c = a['Task Code'] || a['Activity Code'] || '';
        const n = a['Activity'] || a['Description'] || c;
        return `<option value="${Utils.esc(c)}" ${c === currentCode ? 'selected' : ''}>${Utils.esc(c)} · ${Utils.esc(String(n).slice(0, 40))}</option>`;
      }).join('')}
    </select>`;
  }

  function finalQty(r) {
    return (+r['BOQ Qty'] || 0) * (1 + (+r['Wastage %'] || 0) / 100);
  }
  function total(r) {
    return finalQty(r) * (+r['Unit Rate'] || 0) * (1 + (+r['Procurement %'] || 0) / 100);
  }

  function render() {
    const body = document.getElementById('materialsBody');
    if (!window.STATE.activeProject) {
      body.innerHTML = `<tr><td colspan="10"><div class="empty"><div class="empty-icon">🧱</div><div class="empty-title">No project selected</div></div></td></tr>`;
      refreshKpis();
      return;
    }
    if (!window.STATE.materials.length) {
      body.innerHTML = `<tr><td colspan="10"><div class="empty"><div class="empty-icon">🧱</div><div class="empty-title">No materials yet</div><div class="empty-sub">Click + Add Row to add materials per activity.</div></div></td></tr>`;
      refreshKpis();
      return;
    }
    body.innerHTML = window.STATE.materials.map((r, i) => `
      <tr>
        <td><span class="row-action" onclick="PAGE.del(${i})">✕</span></td>
        <td>${activitySelect(r['Activity Code'], `PAGE.update(${i},'Activity Code',this.value)`)}</td>
        <td><input type="text" value="${Utils.esc(r['Material'] || '')}" oninput="PAGE.update(${i},'Material',this.value)" placeholder="e.g. Cement OPC 53" /></td>
        <td><input type="text" value="${Utils.esc(r['Unit'] || '')}" oninput="PAGE.update(${i},'Unit',this.value)" placeholder="MT" /></td>
        <td><input type="number" class="num-cell" value="${r['BOQ Qty'] || ''}" oninput="PAGE.update(${i},'BOQ Qty',this.value)" /></td>
        <td><input type="number" class="num-cell" value="${r['Wastage %'] || 2}" oninput="PAGE.update(${i},'Wastage %',this.value)" /></td>
        <td class="num">${Utils.fmt2(finalQty(r))}</td>
        <td><input type="number" class="num-cell" value="${r['Unit Rate'] || ''}" oninput="PAGE.update(${i},'Unit Rate',this.value)" /></td>
        <td><input type="number" class="num-cell" value="${r['Procurement %'] || 3}" oninput="PAGE.update(${i},'Procurement %',this.value)" /></td>
        <td class="num-bold">₹${Utils.fmt(total(r))}</td>
      </tr>`).join('');
    refreshKpis();
  }
  function refreshKpis() {
    const base = window.STATE.materials.reduce((s, r) => s + (+r['BOQ Qty'] || 0) * (+r['Unit Rate'] || 0), 0);
    const tot  = window.STATE.materials.reduce((s, r) => s + total(r), 0);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('kpiMtCount', window.STATE.materials.length);
    set('kpiMtBase', '₹' + Utils.fmt(base));
    set('kpiMtWastage', '₹' + Utils.fmt(tot - base));
    set('kpiMtTotal', '₹' + Utils.fmt(tot));
    set('mtTotalFoot', Utils.fmt(tot));
  }
  function update(i, key, val) { window.STATE.materials[i][key] = val; render(); }
  function add() {
    if (!window.STATE.activeProject) return Utils.toast('Select a project first', 'err');
    window.STATE.materials.push({
      'Project Code': window.STATE.activeProject['Project Code'],
      'Activity Code': '', 'Material': '', 'Unit': '',
      'BOQ Qty': 0, 'Wastage %': 2, 'Unit Rate': 0, 'Procurement %': 3,
    });
    render();
  }
  function del(i) { window.STATE.materials.splice(i, 1); render(); }
  async function save() {
    if (!window.STATE.activeProject) return Utils.toast('Select a project first', 'err');
    Utils.toast('Saving materials…');
    const r = await API.scriptCall('saveMaterials', {
      projectCode: window.STATE.activeProject['Project Code'],
      rows: window.STATE.materials,
    });
    Utils.toast(r.success ? `Saved ${window.STATE.materials.length} material lines` : ('Save failed: ' + (r.message || 'unknown')), r.success ? 'ok' : 'err');
  }
  return { load, render, update, add, del, save, onProjectChange: load };
})();
