/* ════════════════════════════════════════════════════════════════
   PAGE · Machinery (Step 5B)
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function() {
  const MODES = ['Owned', 'Rental'];

  async function load() {
    if (!window.STATE.activeProject) return;
    const code = window.STATE.activeProject['Project Code'];
    const [acts, mc] = await Promise.all([
      API.gviz(window.CONFIG.TABS.ACTIVITIES),
      API.gviz(window.CONFIG.TABS.MACHINERY),
    ]);
    window.STATE.activities = acts.filter(r => r['Project Code'] === code);
    window.STATE.machinery  = mc.filter(r => r['Project Code'] === code);
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

  function total(r) {
    const hpd = +r['Hrs/Day'] || 0, d = +r['Days'] || 0, rate = +r['Rate'] || 0;
    const diesel = +r['Diesel Cost'] || 0, mob = +r['Mob Demob'] || 0;
    const idle = +r['Idle %'] || 0;
    let base;
    if (r['Mode'] === 'Rental') {
      base = (d / 26) * rate + diesel * d + mob;
    } else {
      base = hpd * d * rate + diesel * d + mob;
    }
    return base * (1 + idle / 100);
  }

  function render() {
    const body = document.getElementById('machineryBody');
    if (!window.STATE.activeProject) {
      body.innerHTML = `<tr><td colspan="11"><div class="empty"><div class="empty-icon">🚜</div><div class="empty-title">No project selected</div></div></td></tr>`;
      refreshKpis();
      return;
    }
    if (!window.STATE.machinery.length) {
      body.innerHTML = `<tr><td colspan="11"><div class="empty"><div class="empty-icon">🚜</div><div class="empty-title">No machinery lines yet</div><div class="empty-sub">Click + Add Row to plan equipment per activity.</div></div></td></tr>`;
      refreshKpis();
      return;
    }
    body.innerHTML = window.STATE.machinery.map((r, i) => `
      <tr>
        <td><span class="row-action" onclick="PAGE.del(${i})">✕</span></td>
        <td>${activitySelect(r['Activity Code'], `PAGE.update(${i},'Activity Code',this.value)`)}</td>
        <td><input type="text" value="${Utils.esc(r['Equipment'] || '')}" oninput="PAGE.update(${i},'Equipment',this.value)" placeholder="e.g. Excavator JCB" /></td>
        <td><select onchange="PAGE.update(${i},'Mode',this.value)">
          ${MODES.map(t => `<option ${r['Mode'] === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select></td>
        <td><input type="number" class="num-cell" value="${r['Hrs/Day'] || ''}" oninput="PAGE.update(${i},'Hrs/Day',this.value)" /></td>
        <td><input type="number" class="num-cell" value="${r['Days'] || ''}" oninput="PAGE.update(${i},'Days',this.value)" /></td>
        <td><input type="number" class="num-cell" value="${r['Rate'] || ''}" oninput="PAGE.update(${i},'Rate',this.value)" /></td>
        <td><input type="number" class="num-cell" value="${r['Diesel Cost'] || ''}" oninput="PAGE.update(${i},'Diesel Cost',this.value)" /></td>
        <td><input type="number" class="num-cell" value="${r['Mob Demob'] || ''}" oninput="PAGE.update(${i},'Mob Demob',this.value)" /></td>
        <td><input type="number" class="num-cell" value="${r['Idle %'] || 7}" oninput="PAGE.update(${i},'Idle %',this.value)" /></td>
        <td class="num-bold">₹${Utils.fmt(total(r))}</td>
      </tr>`).join('');
    refreshKpis();
  }
  function refreshKpis() {
    const owned   = window.STATE.machinery.filter(r => r['Mode'] === 'Owned').reduce((s, r) => s + total(r), 0);
    const rental  = window.STATE.machinery.filter(r => r['Mode'] === 'Rental').reduce((s, r) => s + total(r), 0);
    const tot = owned + rental;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('kpiMcCount', window.STATE.machinery.length);
    set('kpiMcOwned', '₹' + Utils.fmt(owned));
    set('kpiMcRental', '₹' + Utils.fmt(rental));
    set('kpiMcTotal', '₹' + Utils.fmt(tot));
    set('mcTotalFoot', Utils.fmt(tot));
  }
  function update(i, key, val) { window.STATE.machinery[i][key] = val; render(); }
  function add() {
    if (!window.STATE.activeProject) return Utils.toast('Select a project first', 'err');
    window.STATE.machinery.push({
      'Project Code': window.STATE.activeProject['Project Code'],
      'Activity Code': '', 'Equipment': '', 'Mode': 'Owned',
      'Hrs/Day': 8, 'Days': 0, 'Rate': 0,
      'Diesel Cost': 0, 'Mob Demob': 0, 'Idle %': 7,
    });
    render();
  }
  function del(i) { window.STATE.machinery.splice(i, 1); render(); }
  async function save() {
    if (!window.STATE.activeProject) return Utils.toast('Select a project first', 'err');
    Utils.toast('Saving machinery…');
    const r = await API.scriptCall('saveMachinery', {
      projectCode: window.STATE.activeProject['Project Code'],
      rows: window.STATE.machinery,
    });
    Utils.toast(r.success ? `Saved ${window.STATE.machinery.length} machinery lines` : ('Save failed: ' + (r.message || 'unknown')), r.success ? 'ok' : 'err');
  }
  return { load, render, update, add, del, save, onProjectChange: load };
})();
