/* ════════════════════════════════════════════════════════════════
   PAGE · Manpower (Step 5A)
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function() {
  const TYPES = ['Skilled', 'Semi-Skilled', 'Helper', 'Supervisor'];

  async function load() {
    if (!window.STATE.activeProject) return;
    const code = window.STATE.activeProject['Project Code'];
    const [acts, mp] = await Promise.all([
      API.gviz(window.CONFIG.TABS.ACTIVITIES),
      API.gviz(window.CONFIG.TABS.MANPOWER),
    ]);
    window.STATE.activities = acts.filter(r => r['Project Code'] === code);
    window.STATE.manpower   = mp.filter(r => r['Project Code'] === code);
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

  function direct(r) {
    const w = +r['Workers'] || 0, d = +r['Days'] || 0, dr = +r['Daily Rate'] || 0;
    const buf = +r['Buffer %'] || 0;
    return w * d * dr * (1 + buf / 100);
  }
  function total(r) {
    return direct(r) * (1 + (+r['Indirect %'] || 0) / 100);
  }

  function render() {
    const body = document.getElementById('manpowerBody');
    if (!window.STATE.activeProject) {
      body.innerHTML = `<tr><td colspan="11"><div class="empty"><div class="empty-icon">👥</div><div class="empty-title">No project selected</div></div></td></tr>`;
      refreshKpis();
      return;
    }
    if (!window.STATE.manpower.length) {
      body.innerHTML = `<tr><td colspan="11"><div class="empty"><div class="empty-icon">👥</div><div class="empty-title">No manpower lines yet</div><div class="empty-sub">Click + Add Row to plan workers per activity.</div></div></td></tr>`;
      refreshKpis();
      return;
    }
    body.innerHTML = window.STATE.manpower.map((r, i) => `
      <tr>
        <td><span class="row-action" onclick="PAGE.del(${i})">✕</span></td>
        <td>${activitySelect(r['Activity Code'], `PAGE.update(${i},'Activity Code',this.value)`)}</td>
        <td><select onchange="PAGE.update(${i},'Type',this.value)">
          ${TYPES.map(t => `<option ${r['Type'] === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select></td>
        <td><input type="number" class="num-cell" value="${r['Workers'] || ''}" oninput="PAGE.update(${i},'Workers',this.value)" /></td>
        <td><input type="number" class="num-cell" value="${r['Days'] || ''}" oninput="PAGE.update(${i},'Days',this.value)" /></td>
        <td><input type="number" class="num-cell" value="${r['Daily Rate'] || ''}" oninput="PAGE.update(${i},'Daily Rate',this.value)" /></td>
        <td><input type="number" class="num-cell" value="${r['Productivity'] || ''}" oninput="PAGE.update(${i},'Productivity',this.value)" /></td>
        <td><input type="number" class="num-cell" value="${r['Buffer %'] || 5}" oninput="PAGE.update(${i},'Buffer %',this.value)" /></td>
        <td class="num">₹${Utils.fmt(direct(r))}</td>
        <td><input type="number" class="num-cell" value="${r['Indirect %'] || 25}" oninput="PAGE.update(${i},'Indirect %',this.value)" /></td>
        <td class="num-bold">₹${Utils.fmt(total(r))}</td>
      </tr>`).join('');
    refreshKpis();
  }

  function refreshKpis() {
    const workers = window.STATE.manpower.reduce((s, r) => s + (+r['Workers'] || 0), 0);
    const dir = window.STATE.manpower.reduce((s, r) => s + direct(r), 0);
    const tot = window.STATE.manpower.reduce((s, r) => s + total(r), 0);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('kpiMpWorkers', workers);
    set('kpiMpDirect', '₹' + Utils.fmt(dir));
    set('kpiMpIndirect', '₹' + Utils.fmt(tot - dir));
    set('kpiMpTotal', '₹' + Utils.fmt(tot));
    set('mpDirectFoot', Utils.fmt(dir));
    set('mpTotalFoot', Utils.fmt(tot));
  }

  function update(i, key, val) { window.STATE.manpower[i][key] = val; render(); }
  function add() {
    if (!window.STATE.activeProject) return Utils.toast('Select a project first', 'err');
    window.STATE.manpower.push({
      'Project Code': window.STATE.activeProject['Project Code'],
      'Activity Code': '', 'Type': 'Helper',
      'Workers': 0, 'Days': 0, 'Daily Rate': 0,
      'Productivity': 0, 'Buffer %': 5, 'Indirect %': 25,
    });
    render();
  }
  function del(i) { window.STATE.manpower.splice(i, 1); render(); }
  async function save() {
    if (!window.STATE.activeProject) return Utils.toast('Select a project first', 'err');
    Utils.toast('Saving manpower…');
    const r = await API.scriptCall('saveManpower', {
      projectCode: window.STATE.activeProject['Project Code'],
      rows: window.STATE.manpower,
    });
    Utils.toast(r.success ? `Saved ${window.STATE.manpower.length} manpower lines` : ('Save failed: ' + (r.message || 'unknown')), r.success ? 'ok' : 'err');
  }

  return { load, render, update, add, del, save, onProjectChange: load };
})();
