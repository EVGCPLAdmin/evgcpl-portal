/* ════════════════════════════════════════════════════════════════
   PAGE · Overheads (Running Costs)
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function() {
  const CATS = {
    direct:   ['Site Office','Staff Salaries','Utilities','Temporary Structures','Safety Measures','Mess & Camp','Vehicles','Other'],
    indirect: ['Project Management','Insurance','Taxes','Head Office (5%)','Bank Charges','Audit & Legal','Other'],
  };

  async function load() {
    if (!window.STATE.activeProject) return;
    const code = window.STATE.activeProject['Project Code'];
    const oh = await API.gviz(window.CONFIG.TABS.OVERHEADS);
    window.STATE.overheads = oh.filter(r => r['Project Code'] === code);
    render();
  }

  function total(r) {
    return (+r['Monthly Cost'] || 0) * (+r['Months'] || 0);
  }

  function render() {
    const body = document.getElementById('overheadsBody');
    if (!window.STATE.activeProject) {
      body.innerHTML = `<tr><td colspan="7"><div class="empty"><div class="empty-icon">🏢</div><div class="empty-title">No project selected</div></div></td></tr>`;
      refreshKpis();
      return;
    }
    if (!window.STATE.overheads.length) {
      body.innerHTML = `<tr><td colspan="7"><div class="empty"><div class="empty-icon">🏢</div><div class="empty-title">No overheads yet</div><div class="empty-sub">Add Direct (site running) or Indirect (HO/insurance) overheads.</div></div></td></tr>`;
      refreshKpis();
      return;
    }
    body.innerHTML = window.STATE.overheads.map((r, i) => {
      const type = (r['Type'] || 'direct').toLowerCase();
      const cats = CATS[type] || [];
      return `<tr>
        <td><span class="row-action" onclick="PAGE.del(${i})">✕</span></td>
        <td><select onchange="PAGE.update(${i},'Type',this.value);PAGE.render()">
          <option value="direct"   ${type === 'direct' ? 'selected' : ''}>Direct</option>
          <option value="indirect" ${type === 'indirect' ? 'selected' : ''}>Indirect</option>
        </select></td>
        <td><select onchange="PAGE.update(${i},'Category',this.value)">
          ${cats.map(c => `<option ${r['Category'] === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select></td>
        <td><input type="text" value="${Utils.esc(r['Description'] || '')}" oninput="PAGE.update(${i},'Description',this.value)" placeholder="Optional detail" /></td>
        <td><input type="number" class="num-cell" value="${r['Monthly Cost'] || ''}" oninput="PAGE.update(${i},'Monthly Cost',this.value)" /></td>
        <td><input type="number" class="num-cell" value="${r['Months'] || window.STATE.months.length}" oninput="PAGE.update(${i},'Months',this.value)" /></td>
        <td class="num-bold">₹${Utils.fmt(total(r))}</td>
      </tr>`;
    }).join('');
    refreshKpis();
  }
  function refreshKpis() {
    const direct   = window.STATE.overheads.filter(r => (r['Type'] || '').toLowerCase() === 'direct').reduce((s, r) => s + total(r), 0);
    const indirect = window.STATE.overheads.filter(r => (r['Type'] || '').toLowerCase() === 'indirect').reduce((s, r) => s + total(r), 0);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('kpiOhDirect', '₹' + Utils.fmt(direct));
    set('kpiOhIndirect', '₹' + Utils.fmt(indirect));
    set('kpiOhMonths', window.STATE.months.length);
    set('kpiOhTotal', '₹' + Utils.fmt(direct + indirect));
    set('ohTotalFoot', Utils.fmt(direct + indirect));
  }
  function update(i, key, val) { window.STATE.overheads[i][key] = val; render(); }
  function add(type) {
    if (!window.STATE.activeProject) return Utils.toast('Select a project first', 'err');
    const cats = CATS[type] || [];
    window.STATE.overheads.push({
      'Project Code': window.STATE.activeProject['Project Code'],
      'Type': type, 'Category': cats[0] || 'Other',
      'Description': '', 'Monthly Cost': 0,
      'Months': window.STATE.months.length || 12,
    });
    render();
  }
  function del(i) { window.STATE.overheads.splice(i, 1); render(); }
  async function save() {
    if (!window.STATE.activeProject) return Utils.toast('Select a project first', 'err');
    Utils.toast('Saving overheads…');
    const r = await API.scriptCall('saveOverheads', {
      projectCode: window.STATE.activeProject['Project Code'],
      rows: window.STATE.overheads,
    });
    Utils.toast(r.success ? `Saved ${window.STATE.overheads.length} overhead lines` : ('Save failed: ' + (r.message || 'unknown')), r.success ? 'ok' : 'err');
  }
  return { load, render, update, add, del, save, onProjectChange: load };
})();
