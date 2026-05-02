/* ════════════════════════════════════════════════════════════════
   PAGE · Cost Summary (Steps 6 & 7 — Total Project Budget)
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function() {

  // Re-use formulas from the resource pages (inline copies — no cross-page imports)
  const mpTotal = r => {
    const w = +r['Workers'] || 0, d = +r['Days'] || 0, dr = +r['Daily Rate'] || 0;
    const buf = +r['Buffer %'] || 0, ind = +r['Indirect %'] || 0;
    return w * d * dr * (1 + buf / 100) * (1 + ind / 100);
  };
  const mcTotal = r => {
    const hpd = +r['Hrs/Day'] || 0, d = +r['Days'] || 0, rate = +r['Rate'] || 0;
    const diesel = +r['Diesel Cost'] || 0, mob = +r['Mob Demob'] || 0;
    const idle = +r['Idle %'] || 0;
    let base = r['Mode'] === 'Rental'
      ? (d / 26) * rate + diesel * d + mob
      : hpd * d * rate + diesel * d + mob;
    return base * (1 + idle / 100);
  };
  const mtTotal = r => {
    const fq = (+r['BOQ Qty'] || 0) * (1 + (+r['Wastage %'] || 0) / 100);
    return fq * (+r['Unit Rate'] || 0) * (1 + (+r['Procurement %'] || 0) / 100);
  };
  const ohTotal = r => (+r['Monthly Cost'] || 0) * (+r['Months'] || 0);

  async function load() {
    if (!window.STATE.activeProject) { recompute(); return; }
    const code = window.STATE.activeProject['Project Code'];
    const [acts, mp, mc, mt, oh] = await Promise.all([
      API.gviz(window.CONFIG.TABS.ACTIVITIES),
      API.gviz(window.CONFIG.TABS.MANPOWER),
      API.gviz(window.CONFIG.TABS.MACHINERY),
      API.gviz(window.CONFIG.TABS.MATERIALS),
      API.gviz(window.CONFIG.TABS.OVERHEADS),
    ]);
    window.STATE.activities = acts.filter(r => r['Project Code'] === code);
    window.STATE.manpower   = mp.filter(r => r['Project Code'] === code);
    window.STATE.machinery  = mc.filter(r => r['Project Code'] === code);
    window.STATE.materials  = mt.filter(r => r['Project Code'] === code);
    window.STATE.overheads  = oh.filter(r => r['Project Code'] === code);
    recompute();
  }

  function recompute() {
    const mp = window.STATE.manpower.reduce((s, r) => s + mpTotal(r), 0);
    const mc = window.STATE.machinery.reduce((s, r) => s + mcTotal(r), 0);
    const mt = window.STATE.materials.reduce((s, r) => s + mtTotal(r), 0);
    const ah = mp + mc + mt;
    const oh = window.STATE.overheads.reduce((s, r) => s + ohTotal(r), 0);
    const buffPct = +document.getElementById('bufferPct').value || 0;
    const subtotal = ah + oh;
    const buffer = subtotal * buffPct / 100;
    const grand = subtotal + buffer;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('sumManpower',  '₹' + Utils.fmt(mp));
    set('sumMachinery', '₹' + Utils.fmt(mc));
    set('sumMaterials', '₹' + Utils.fmt(mt));
    set('sumActivity',  '₹' + Utils.fmt(ah));
    set('sumOverheads', '₹' + Utils.fmt(oh));
    set('sumGrand',     '₹' + Utils.fmt(grand));

    const directOh = window.STATE.overheads.filter(r => (r['Type'] || '').toLowerCase() === 'direct').reduce((s, r) => s + ohTotal(r), 0);
    const indirectOh = window.STATE.overheads.filter(r => (r['Type'] || '').toLowerCase() === 'indirect').reduce((s, r) => s + ohTotal(r), 0);

    const rows = [
      ['Manpower (5A)',        'Workers × Rate × Days + indirect',          mp,        grand ? mp/grand*100 : 0,        ''],
      ['Machinery (5B)',       'Owned + Rental + Mob/Demob',                 mc,        grand ? mc/grand*100 : 0,        ''],
      ['Materials (5C)',       'Qty × Rate + Wastage + Procurement',         mt,        grand ? mt/grand*100 : 0,        ''],
      ['Activity Cost',        'Step 6 · Sum of resource costs',              ah,       grand ? ah/grand*100 : 0,        'subtotal'],
      ['Direct Overheads',     'Site office, staff, utilities',               directOh, grand ? directOh/grand*100 : 0, ''],
      ['Indirect Overheads',   'PMC, insurance, taxes, HO 5%',                indirectOh, grand ? indirectOh/grand*100 : 0, ''],
      ['Subtotal',             'Activity + Overheads',                        subtotal, grand ? subtotal/grand*100 : 0, 'subtotal'],
      [`Buffer (${buffPct}%)`, '5–10% for unexpected costs',                   buffer,   grand ? buffer/grand*100 : 0,    ''],
      ['Total Project Budget', 'Step 7 · Submitted for top management approval', grand,    100,                              'totals'],
    ];
    document.getElementById('summaryBody').innerHTML = rows.map(([n, ref, amt, pct, cls]) => `
      <tr class="${cls || ''}">
        <td>${Utils.esc(n)}</td>
        <td style="color:var(--text-faint);font-size:11px">${Utils.esc(ref)}</td>
        <td class="num-bold">₹${Utils.fmt(amt)}</td>
        <td class="num">${pct ? pct.toFixed(1) + '%' : '—'}</td>
      </tr>`).join('');

    // Activity-wise breakdown
    const actMap = {};
    const acc = (rows, getter, key) => rows.forEach(r => {
      const k = r['Activity Code'] || '(unassigned)';
      if (!actMap[k]) actMap[k] = { mp: 0, mc: 0, mt: 0 };
      actMap[k][key] += getter(r);
    });
    acc(window.STATE.manpower,  mpTotal, 'mp');
    acc(window.STATE.machinery, mcTotal, 'mc');
    acc(window.STATE.materials, mtTotal, 'mt');
    const actRows = Object.entries(actMap).map(([code, v]) => {
      const act = window.STATE.activities.find(a => (a['Task Code'] || a['Activity Code']) === code);
      const desc = act ? (act['Activity'] || act['Description'] || '—') : '—';
      const qty = act ? (Number(act['Qty']) || 0) : 0;
      const t = v.mp + v.mc + v.mt;
      return { code, desc, qty, mp: v.mp, mc: v.mc, mt: v.mt, total: t, perUnit: qty > 0 ? t / qty : 0 };
    });
    document.getElementById('actBreakdownBody').innerHTML = actRows.length === 0
      ? `<tr><td colspan="8"><div class="empty"><div class="empty-icon">📊</div><div class="empty-title">No resource lines yet</div><div class="empty-sub">Add manpower / machinery / materials to see activity-wise costs.</div></div></td></tr>`
      : actRows.map(r => `
        <tr>
          <td style="font-family:'DM Mono';font-size:11px;color:var(--green);font-weight:700">${Utils.esc(r.code)}</td>
          <td style="font-size:12px">${Utils.esc(r.desc)}</td>
          <td class="num">${Utils.fmt2(r.qty)}</td>
          <td class="num">₹${Utils.fmt(r.mp)}</td>
          <td class="num">₹${Utils.fmt(r.mc)}</td>
          <td class="num">₹${Utils.fmt(r.mt)}</td>
          <td class="num-bold">₹${Utils.fmt(r.total)}</td>
          <td class="num">${r.perUnit ? '₹' + Utils.fmt2(r.perUnit) : '—'}</td>
        </tr>`).join('');
  }

  function exportCSV() {
    if (!window.STATE.activeProject) return Utils.toast('Select a project first', 'err');
    const rows = [['Component', 'Reference', 'Amount', '% of Total']];
    document.querySelectorAll('#summaryBody tr').forEach(tr => {
      const cells = tr.querySelectorAll('td');
      rows.push([cells[0]?.innerText, cells[1]?.innerText, cells[2]?.innerText, cells[3]?.innerText]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${window.STATE.activeProject['Project Code']}_Budget_Summary.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    Utils.toast('Exported budget summary CSV', 'ok');
  }

  async function approve() {
    if (!window.STATE.activeProject) return Utils.toast('Select a project first', 'err');
    const grand = document.getElementById('sumGrand').textContent;
    if (!confirm(`Submit ${window.STATE.activeProject['Project Code']} budget (${grand}) for top management approval?`)) return;
    const r = await API.scriptCall('submitBudgetApproval', {
      projectCode: window.STATE.activeProject['Project Code'],
      total: grand,
      submittedBy: 'Portal User',
      submittedAt: new Date().toISOString(),
    });
    Utils.toast(r.success ? 'Submitted for approval' : 'Submission failed', r.success ? 'ok' : 'err');
  }

  return { load, recompute, exportCSV, approve, onProjectChange: load };
})();
