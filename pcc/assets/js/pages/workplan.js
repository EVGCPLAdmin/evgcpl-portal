/* ════════════════════════════════════════════════════════════════
   PAGE · Workplan (Step 4)
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function() {

  async function load() {
    if (!window.STATE.activeProject) return;
    const code = window.STATE.activeProject['Project Code'];
    const [acts, wp] = await Promise.all([
      API.gviz(window.CONFIG.TABS.ACTIVITIES),
      API.gviz(window.CONFIG.TABS.WORKPLAN),
    ]);
    window.STATE.activities = acts.filter(r => r['Project Code'] === code);
    window.STATE.workplan   = parseWorkplan(wp.filter(r => r['Project Code'] === code));
    if (!window.STATE.workplan.length && window.STATE.activities.length) {
      window.STATE.workplan = window.STATE.activities.map(a => ({
        actCode: a['Task Code'] || a['Activity Code'] || '',
        actDesc: a['Activity'] || a['Description'] || '',
        unit: a['Unit'] || '',
        boqQty: Number(a['Qty']) || 0,
        months: {},
      }));
    }
    render();
  }

  function parseWorkplan(rows) {
    const grouped = {};
    rows.forEach(r => {
      const k = r['Activity Code'] || r['Task Code'] || '';
      if (!grouped[k]) grouped[k] = {
        actCode: k,
        actDesc: r['Description'] || '',
        unit:    r['Unit'] || '',
        boqQty:  Number(r['BOQ Qty']) || 0,
        months:  {},
      };
      if (r['Month'] && r['Planned Qty'] != null && r['Planned Qty'] !== '') {
        grouped[k].months[r['Month']] = Number(r['Planned Qty']) || 0;
      }
    });
    return Object.values(grouped);
  }

  function render() {
    const wrap = document.getElementById('workplanGridWrap');
    if (!window.STATE.activeProject) {
      wrap.innerHTML = `<div class="empty">
        <div class="empty-icon">📅</div>
        <div class="empty-title">No project selected</div>
        <div class="empty-sub">Click the project pill in the header to choose a project.</div>
      </div>`;
      refreshKpis(0, 0, 0, 0);
      return;
    }
    if (!window.STATE.workplan.length) {
      wrap.innerHTML = `<div class="empty">
        <div class="empty-icon">∅</div>
        <div class="empty-title">No activities defined</div>
        <div class="empty-sub">Add Activities under WBS in the Setup pages first. They'll appear here automatically.</div>
      </div>`;
      refreshKpis(0, 0, 0, 0);
      return;
    }
    const months = window.STATE.months;
    let html = `<table class="month-grid"><thead><tr>
      <th class="sticky-l" style="width:200px;text-align:left;padding-left:14px">Activity</th>
      <th style="width:60px">Unit</th>
      <th style="width:90px">BOQ Qty</th>`;
    months.forEach(m => { html += `<th>${Utils.monthLabel(m)}</th>`; });
    html += `<th style="width:90px;background:var(--gold);color:#fff">Total</th></tr></thead><tbody>`;
    window.STATE.workplan.forEach((r, idx) => {
      const total = months.reduce((s, m) => s + (Number(r.months[m]) || 0), 0);
      html += `<tr><td class="sticky-l label" title="${Utils.esc(r.actDesc)}">
        <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--green);font-weight:700">${Utils.esc(r.actCode)}</div>
        <div style="font-size:10.5px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px">${Utils.esc(r.actDesc)}</div>
      </td>
      <td style="font-size:10px;color:var(--text-faint)">${Utils.esc(r.unit)}</td>
      <td style="font-family:'DM Mono';font-size:10px;color:var(--text-dim)">${Utils.fmt2(r.boqQty)}</td>`;
      months.forEach(m => {
        const v = r.months[m] || '';
        html += `<td><input type="number" step="0.01" value="${v}"
          oninput="PAGE.updateCell(${idx},'${m}',this.value)" placeholder="0" /></td>`;
      });
      html += `<td class="total-cell">${Utils.fmt2(total)}</td></tr>`;
    });
    html += `<tr class="row-total"><td class="sticky-l label" style="background:var(--green-d);color:#fff;padding-left:14px">TOTAL</td><td></td><td></td>`;
    months.forEach(m => {
      const sum = window.STATE.workplan.reduce((s, r) => s + (Number(r.months[m]) || 0), 0);
      html += `<td style="font-family:'DM Mono';font-weight:700">${Utils.fmt2(sum)}</td>`;
    });
    const grand = window.STATE.workplan.reduce((s, r) =>
      s + months.reduce((s2, m) => s2 + (Number(r.months[m]) || 0), 0), 0);
    html += `<td style="background:var(--gold);color:#fff;font-family:'DM Mono';font-weight:700">${Utils.fmt2(grand)}</td></tr>`;
    html += `</tbody></table>`;
    wrap.innerHTML = html;

    const totalBOQ = window.STATE.workplan.reduce((s, r) => s + (Number(r.boqQty) || 0), 0);
    const cov = totalBOQ > 0 ? Math.round(grand / totalBOQ * 100) : 0;
    refreshKpis(window.STATE.workplan.length, grand, cov, months.length);
  }
  function refreshKpis(act, qty, cov, months) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('kpiWpAct', act);
    set('kpiWpQty', Utils.fmt2(qty));
    set('kpiWpCov', cov ? cov + '%' : '—');
    set('kpiWpMonths', months);
  }
  function updateCell(idx, month, val) {
    window.STATE.workplan[idx].months[month] = val === '' ? 0 : Number(val) || 0;
    render();
  }
  function addMonth() {
    const last = window.STATE.months[window.STATE.months.length - 1];
    if (!last) {
      const d = new Date(); d.setDate(1);
      window.STATE.months.push(d.toISOString().slice(0, 7));
    } else {
      const [y, m] = last.split('-').map(Number);
      const d = new Date(y, m, 1);
      window.STATE.months.push(d.toISOString().slice(0, 7));
    }
    window.persistState();
    render();
  }
  async function save() {
    if (!window.STATE.activeProject) return Utils.toast('Select a project first', 'err');
    const code = window.STATE.activeProject['Project Code'];
    const rows = [];
    window.STATE.workplan.forEach(a => {
      Object.entries(a.months).forEach(([month, qty]) => {
        if (qty != null && qty !== '' && Number(qty) !== 0) {
          rows.push({
            'Project Code': code,
            'Activity Code': a.actCode,
            'Description': a.actDesc, 'Unit': a.unit,
            'BOQ Qty': a.boqQty, 'Month': month,
            'Planned Qty': Number(qty),
          });
        }
      });
    });
    Utils.toast('Saving workplan…');
    const r = await API.scriptCall('saveWorkplan', { projectCode: code, rows });
    Utils.toast(r.success ? `Saved ${rows.length} workplan entries` : ('Save failed: ' + (r.message || 'unknown')), r.success ? 'ok' : 'err');
  }

  return { load, render, updateCell, addMonth, save, onProjectChange: load };
})();
