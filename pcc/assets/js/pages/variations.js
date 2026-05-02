/* ════════════════════════════════════════════════════════════════
   PAGE · Variations (Step 8)
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function() {
  const TYPES   = ['Scope Change','Design Change','Quantity Deviation','Site Condition','Client Instruction'];
  const STATUSES = ['Draft','Internal Approval','Submitted to Client','Client Approved','Rejected','Implemented'];
  const APPROVES = ['Pending','Approved','Rejected'];

  async function load() {
    if (!window.STATE.activeProject) return;
    const code = window.STATE.activeProject['Project Code'];
    const vr = await API.gviz(window.CONFIG.TABS.VARIATIONS);
    window.STATE.variations = vr.filter(r => r['Project Code'] === code);
    render();
  }

  function statusClass(status) {
    const s = (status || 'Draft').toLowerCase();
    if (s.includes('rejected')) return 'var-status-rejected';
    if (s.includes('implemented')) return 'var-status-implemented';
    if (s.includes('approved')) return 'var-status-approved';
    if (s.includes('submitted')) return 'var-status-submitted';
    if (s.includes('internal')) return 'var-status-internal';
    return 'var-status-draft';
  }

  function render() {
    const body = document.getElementById('variationsBody');
    if (!window.STATE.activeProject) {
      body.innerHTML = `<tr><td colspan="10"><div class="empty"><div class="empty-icon">🔄</div><div class="empty-title">No project selected</div></div></td></tr>`;
      refreshKpis();
      return;
    }
    if (!window.STATE.variations.length) {
      body.innerHTML = `<tr><td colspan="10"><div class="empty"><div class="empty-icon">🔄</div><div class="empty-title">No variations logged</div><div class="empty-sub">Click + New Variation to start tracking scope/design changes.</div></div></td></tr>`;
      refreshKpis();
      return;
    }
    body.innerHTML = window.STATE.variations.map((v, i) => {
      const sCls = statusClass(v['Status']);
      return `<tr>
        <td><span class="row-action" onclick="PAGE.del(${i})">✕</span></td>
        <td style="font-family:'DM Mono';font-size:11px;color:var(--green);font-weight:700">${Utils.esc(v['V-ID'] || '')}</td>
        <td><input type="date" value="${v['Date'] || ''}" oninput="PAGE.update(${i},'Date',this.value)" /></td>
        <td><input type="text" value="${Utils.esc(v['Description'] || '')}" oninput="PAGE.update(${i},'Description',this.value)" placeholder="What changed and why" /></td>
        <td><select onchange="PAGE.update(${i},'Type',this.value)">
          ${TYPES.map(t => `<option ${v['Type'] === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select></td>
        <td><select class="pill ${sCls}" onchange="PAGE.update(${i},'Status',this.value);PAGE.render()">
          ${STATUSES.map(t => `<option ${v['Status'] === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select></td>
        <td><select onchange="PAGE.update(${i},'Internal',this.value)">
          ${APPROVES.map(t => `<option ${v['Internal'] === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select></td>
        <td><select onchange="PAGE.update(${i},'Client',this.value)">
          ${APPROVES.map(t => `<option ${v['Client'] === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select></td>
        <td><input type="number" class="num-cell" value="${v['Cost Impact'] || 0}" oninput="PAGE.update(${i},'Cost Impact',this.value)" /></td>
        <td><input type="number" class="num-cell" value="${v['Time Impact'] || 0}" oninput="PAGE.update(${i},'Time Impact',this.value)" /></td>
      </tr>`;
    }).join('');
    refreshKpis();
  }

  function refreshKpis() {
    const total = window.STATE.variations.length;
    const pending = window.STATE.variations.filter(v => ['Draft','Internal Approval','Submitted to Client'].includes(v['Status'])).length;
    const approved = window.STATE.variations.filter(v => v['Status'] === 'Client Approved' || v['Status'] === 'Implemented').length;
    const impact = window.STATE.variations.filter(v => v['Status'] === 'Client Approved' || v['Status'] === 'Implemented')
      .reduce((s, v) => s + (+v['Cost Impact'] || 0), 0);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('kpiVarTotal', total);
    set('kpiVarPending', pending);
    set('kpiVarApproved', approved);
    set('kpiVarImpact', (impact >= 0 ? '+₹' : '-₹') + Utils.fmt(Math.abs(impact)));
  }
  function update(i, key, val) { window.STATE.variations[i][key] = val; }
  function add() {
    if (!window.STATE.activeProject) return Utils.toast('Select a project first', 'err');
    window.STATE.variations.push({
      'V-ID': 'VAR-' + String(window.STATE.variations.length + 1).padStart(3, '0'),
      'Project Code': window.STATE.activeProject['Project Code'],
      'Date': new Date().toISOString().slice(0, 10),
      'Description': '', 'Type': 'Scope Change',
      'Status': 'Draft', 'Internal': 'Pending', 'Client': 'Pending',
      'Cost Impact': 0, 'Time Impact': 0,
    });
    render();
  }
  function del(i) {
    if (confirm('Delete this variation?')) {
      window.STATE.variations.splice(i, 1);
      render();
    }
  }
  async function save() {
    if (!window.STATE.activeProject) return Utils.toast('Select a project first', 'err');
    Utils.toast('Saving variations…');
    const r = await API.scriptCall('saveVariations', {
      projectCode: window.STATE.activeProject['Project Code'],
      rows: window.STATE.variations,
    });
    Utils.toast(r.success ? `Saved ${window.STATE.variations.length} variations` : ('Save failed: ' + (r.message || 'unknown')), r.success ? 'ok' : 'err');
  }
  return { load, render, update, add, del, save, onProjectChange: load };
})();
