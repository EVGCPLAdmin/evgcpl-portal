/* ════════════════════════════════════════════════════════════════
   PAGE · Workplan (Step 4) — per-activity schedule
   ────────────────────────────────────────────────────────────────
   Schema (one row per activity):
     WBS Code · Nature of Work · Activity · UoM · Qty
     Start · End · Duration · % Weight · Responsibility
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function() {

  let rows = []; // [{wbsCode, natureOfWork, activity, unit, qty, start, end, duration, weight, responsibility, masterUuid, checkSum}]
  let employeeChoices = []; // for Responsibility dropdown

  async function load() {
    if (!window.STATE.activeProject) {
      document.getElementById('wpTbody').innerHTML =
        '<tr><td colspan="11" class="empty-cell">No project selected. Click the project pill in the header to choose one.</td></tr>';
      refreshKpis();
      return;
    }
    const code = window.STATE.activeProject['Project Code'];

    try {
      // Pull Activities (per-project), WBS (for Nature lookup), Workplan (existing data),
      // and Employee register (for Responsibility dropdown).
      const [acts, wbs, wp, emps] = await Promise.all([
        API.gviz(window.CONFIG.TABS.ACTIVITIES),
        API.gviz(window.CONFIG.TABS.WBS),
        API.gviz(window.CONFIG.TABS.WORKPLAN).catch(() => []),
        loadEmployees().catch(() => []),
      ]);

      const activities = (acts || []).filter(r => r['Project Code'] === code);
      const wbsByCode  = {};
      (wbs || []).filter(r => r['Project Code'] === code).forEach(r => {
        wbsByCode[r['WBS Code'] || ''] = r;
      });
      const wpByKey = {};
      (wp || []).filter(r => r['Project Code'] === code).forEach(r => {
        // Key on whichever activity identifier is most stable
        const key = (r['Master UUID'] || r['Task Code'] || r['Activity'] || '').trim();
        if (key) wpByKey[key] = r;
      });

      employeeChoices = emps;

      rows = activities.map(a => {
        const wbsRow = wbsByCode[a['WBS Code'] || ''] || {};
        const nature = String(wbsRow['Nature of Work'] || '').trim();
        const masterUuid = String(a['Master UUID'] || a['UUID'] || '').trim();
        const taskCode   = String(a['Task Code'] || '').trim();
        const checkSum   = String(a['CheckSum'] || '').trim();
        const wpKey  = masterUuid || taskCode || (a['Activity'] || '').trim();
        const ex = wpByKey[wpKey] || {};

        return {
          wbsCode:        a['WBS Code'] || '',
          natureOfWork:   nature,
          activity:       a['Activity'] || a['Activity Name'] || '',
          unit:           a['Unit'] || ex['UoM'] || '',
          qty:            Number(a['BOQ Qty'] || ex['Qty'] || 0),
          typeOfWork:     a['Type of Work'] || '',
          start:          ex['Start'] || '',
          end:            ex['End']   || '',
          duration:       Number(ex['Duration'] || 0),
          weight:         Number(ex['% Weight'] || ex['Weight %'] || 0),
          responsibility: ex['Responsibility'] || '',
          masterUuid, taskCode, checkSum,
        };
      });

      // Auto-compute durations on load (in case Start/End existed but Duration didn't)
      rows.forEach(r => { r.duration = computeDuration(r.start, r.end); });

      render();
      refreshKpis();
    } catch (e) {
      console.error('[Workplan] load failed:', e);
      document.getElementById('wpTbody').innerHTML =
        `<tr><td colspan="11" class="empty-cell" style="color:#c43">Load failed: ${Utils.esc(e.message)}</td></tr>`;
    }
  }

  async function loadEmployees() {
    // Pull from EVGCPL Employee Register if exposed via gviz; tolerant of missing tab
    if (!window.CONFIG.EMPLOYEE_SHEET_ID) return [];
    try {
      const url = `https://docs.google.com/spreadsheets/d/${window.CONFIG.EMPLOYEE_SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(window.CONFIG.EMPLOYEE_TAB)}`;
      const res = await fetch(url);
      const txt = await res.text();
      const m = txt.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/);
      if (!m) return [];
      const data = JSON.parse(m[1]);
      const cols = (data.table?.cols || []).map(c => (c.label || '').trim());
      const idxName = cols.findIndex(c => /name/i.test(c));
      const idxCode = cols.findIndex(c => /emp.*code|employee.*id/i.test(c));
      return (data.table?.rows || [])
        .map(r => {
          const cells = r.c || [];
          const name = idxName >= 0 ? (cells[idxName]?.v ?? '') : '';
          const code = idxCode >= 0 ? (cells[idxCode]?.v ?? '') : '';
          return name ? { name: String(name).trim(), code: String(code).trim() } : null;
        })
        .filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  function render() {
    const t = document.getElementById('wpTbody');
    if (!rows.length) {
      t.innerHTML = '<tr><td colspan="11" class="empty-cell">No activities yet — define them in the WBS step first, then click "Sync from WBS".</td></tr>';
      return;
    }
    const empOpts = employeeChoices.length
      ? '<option value="">— pick —</option>' +
        employeeChoices.map(e => `<option value="${Utils.esc(e.name)}">${Utils.esc(e.name)}${e.code?` (${Utils.esc(e.code)})`:''}</option>`).join('')
      : '';

    t.innerHTML = rows.map((r, i) => `
      <tr>
        <td class="mono">${i + 1}</td>
        <td class="mono" style="font-size:11px;color:var(--green);font-weight:600">${Utils.esc(r.wbsCode || '')}</td>
        <td style="color:var(--green);font-weight:600;font-size:11.5px">${Utils.esc(r.natureOfWork || '—')}</td>
        <td>
          <div style="font-weight:600">${Utils.esc(r.activity)}</div>
          ${r.typeOfWork ? `<div style="font-size:10px;color:var(--text-faint)">${Utils.esc(r.typeOfWork)}</div>` : ''}
        </td>
        <td class="mono" style="font-size:10.5px;color:var(--text-dim)">${Utils.esc(r.unit || '')}</td>
        <td><input type="number" class="inline-edit num" step="0.01" value="${r.qty || 0}" oninput="PAGE.edit(${i},'qty',this.value)"></td>
        <td><input type="date" class="inline-edit" value="${Utils.esc(r.start || '')}" onchange="PAGE.edit(${i},'start',this.value)"></td>
        <td><input type="date" class="inline-edit" value="${Utils.esc(r.end || '')}"   onchange="PAGE.edit(${i},'end',this.value)"></td>
        <td class="mono" id="wpDur-${i}" style="text-align:right;color:${r.duration>0?'var(--text)':'var(--text-faint)'}">${r.duration || 0}</td>
        <td><input type="number" class="inline-edit num" step="0.1" min="0" max="100" value="${r.weight || 0}" oninput="PAGE.edit(${i},'weight',this.value)"></td>
        <td>
          ${empOpts
            ? `<select class="unit-select" onchange="PAGE.edit(${i},'responsibility',this.value)">${empOpts.replace(`value="${Utils.esc(r.responsibility)}"`, `value="${Utils.esc(r.responsibility)}" selected`)}</select>`
            : `<input class="inline-edit" value="${Utils.esc(r.responsibility || '')}" oninput="PAGE.edit(${i},'responsibility',this.value)" placeholder="Owner name">`
          }
        </td>
      </tr>
    `).join('');
  }

  function edit(i, key, val) {
    if (!rows[i]) return;
    if (key === 'qty' || key === 'weight') val = Number(val) || 0;
    rows[i][key] = val;
    if (key === 'start' || key === 'end') {
      rows[i].duration = computeDuration(rows[i].start, rows[i].end);
      const cell = document.getElementById('wpDur-' + i);
      if (cell) {
        cell.textContent = rows[i].duration;
        cell.style.color = rows[i].duration > 0 ? 'var(--text)' : 'var(--text-faint)';
      }
    }
    refreshKpis();
  }

  function computeDuration(start, end) {
    if (!start || !end) return 0;
    const s = new Date(start), e = new Date(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
    return Math.max(0, Math.round((e - s) / 86400000) + 1);
  }

  function refreshKpis() {
    document.getElementById('kpiWpAct').textContent = rows.length;
    const wt = rows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
    document.getElementById('kpiWpWt').textContent = (Math.round(wt * 10) / 10) + '%';
    const wtPill = document.getElementById('wpWeightPill');
    if (wtPill) {
      wtPill.textContent = `Weight: ${(Math.round(wt*10)/10)}%`;
      wtPill.className = 'pill ' + (Math.abs(wt - 100) < 0.5 ? 'pill-green' : (wt > 100 ? 'pill-red' : 'pill-gold'));
    }
    const totalDur = rows.reduce((s, r) => s + (Number(r.duration) || 0), 0);
    document.getElementById('kpiWpDur').textContent = totalDur;

    const starts = rows.map(r => r.start).filter(Boolean).sort();
    const ends   = rows.map(r => r.end).filter(Boolean).sort();
    if (starts.length && ends.length) {
      document.getElementById('kpiWpSpan').textContent = `${starts[0]} → ${ends[ends.length-1]}`;
    } else {
      document.getElementById('kpiWpSpan').textContent = '—';
    }
  }

  async function refreshFromWBS() {
    Utils.toast('Re-loading from WBS…');
    await load();
  }

  async function save() {
    if (!window.STATE.activeProject) return Utils.toast('Select a project first', 'err');
    const code = window.STATE.activeProject['Project Code'];

    // Sanity check on weights
    const totalWt = rows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
    if (totalWt > 0 && Math.abs(totalWt - 100) > 0.5) {
      const ok = confirm(`Weights sum to ${totalWt.toFixed(1)}% (not 100%). Save anyway?`);
      if (!ok) return;
    }

    Utils.toast('Saving workplan…');
    const payload = {
      projectCode: code,
      rows: rows.map(r => ({
        wbsCode:        r.wbsCode,
        natureOfWork:   r.natureOfWork,
        activity:       r.activity,
        unit:           r.unit,
        qty:            Number(r.qty) || 0,
        start:          r.start || '',
        end:            r.end   || '',
        duration:       Number(r.duration) || 0,
        weight:         Number(r.weight)   || 0,
        responsibility: r.responsibility || '',
        masterUuid:     r.masterUuid || '',
        taskCode:       r.taskCode   || '',
        checkSum:       r.checkSum   || '',
      })),
    };
    try {
      const r = await API.scriptCall('saveWorkplan', payload);
      Utils.toast(r.success ? `Saved ${rows.length} workplan rows` : ('Save failed: ' + (r.message || 'unknown')), r.success ? 'ok' : 'err');
    } catch (e) {
      Utils.toast('Save error: ' + e.message, 'err');
    }
  }

  return { load, save, refreshFromWBS, edit, onProjectChange: load };
})();
