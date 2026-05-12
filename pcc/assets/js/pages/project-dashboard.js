/* ════════════════════════════════════════════════════════════════
   Project Dashboard  ·  Timeline + Cost Progress Monitor
   ────────────────────────────────────────────────────────────────
   Data sources:
     • Project tab   → dates, contract amount
     • BOQ tab       → budgeted cost
     • Workplan tab  → planned S-curve (Start, End, % Weight)
     • Manpower/Machinery/Materials → resource cost totals
     • Variations    → approved scope changes
   Actuals: placeholder until DPR / actual-cost tab is wired
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function () {

  let _sCurveChart = null;
  let _costChart   = null;

  // ── Load ──────────────────────────────────────────────────────
  async function load() {
    const ap = window.STATE.activeProject;
    if (!ap) { showEmpty('No project selected. Use the project switcher.'); return; }

    document.getElementById('dProjCode').textContent = ap['Project Code'] || '—';
    document.getElementById('dProjName').textContent = ap['Project Name'] || '—';
    document.getElementById('dContract').textContent = fmtCr(ap['Contract Amount'] || 0);

    const code = ap['Project Code'];

    try {
      const [boq, workplan, manpower, machinery, materials, overheads, variations] = await Promise.all([
        API.gviz(window.CONFIG.TABS.BOQ).catch(()=>[]),
        API.gviz(window.CONFIG.TABS.WORKPLAN).catch(()=>[]),
        API.gviz(window.CONFIG.TABS.MANPOWER).catch(()=>[]),
        API.gviz(window.CONFIG.TABS.MACHINERY).catch(()=>[]),
        API.gviz(window.CONFIG.TABS.MATERIALS).catch(()=>[]),
        API.gviz(window.CONFIG.TABS.OVERHEADS).catch(()=>[]),
        API.gviz(window.CONFIG.TABS.VARIATIONS).catch(()=>[]),
      ]);

      const byP = r => (r['Project Code']||r['ProjectCode']||'') === code;
      const boqRows  = (boq     ||[]).filter(byP);
      const wpRows   = (workplan||[]).filter(byP);
      const mpRows   = (manpower||[]).filter(byP);
      const mcRows   = (machinery||[]).filter(byP);
      const mtRows   = (materials||[]).filter(byP);
      const ohRows   = (overheads||[]).filter(byP);
      const varRows  = (variations||[]).filter(byP);

      const startDate = parseDate(ap['Start Date']);
      const endDate   = parseDate(ap['End Date']);
      const today     = new Date();

      // ── Timeline KPIs ────────────────────────────────────────
      const totalDays   = endDate ? daysBetween(startDate, endDate) : 0;
      const elapsedDays = startDate ? Math.max(0, Math.min(daysBetween(startDate, today), totalDays)) : 0;
      const pctTime     = totalDays > 0 ? (elapsedDays / totalDays * 100) : 0;
      const remainDays  = Math.max(0, totalDays - elapsedDays);

      setEl('dStartDate',    fmtDate(startDate));
      setEl('dEndDate',      fmtDate(endDate));
      setEl('dTotalDays',    totalDays ? totalDays + ' days' : '—');
      setEl('dElapsedDays',  elapsedDays + ' days');
      setEl('dRemainDays',   remainDays + ' days');
      setEl('dPctTime',      pctTime.toFixed(1) + '%');
      setBar('barTime', pctTime);

      // ── Cost KPIs ────────────────────────────────────────────
      const budgetedCost = boqRows.reduce((s,r) => s + (Number(r['Amount'])||Number(r['Rate']||0)*Number(r['Qty']||0)), 0);
      const mpCost   = _sumField(mpRows, ['Total Cost','Total','Amount','Cost']);
      const mcCost   = _sumField(mcRows, ['Total Cost','Total','Amount','Cost']);
      const mtCost   = _sumField(mtRows, ['Total Cost','Total','Amount','Cost']);
      const ohCost   = _sumField(ohRows, ['Total Cost','Total','Amount','Cost']);
      const resourceCost = mpCost + mcCost + mtCost + ohCost;

      // Approved variations (sum positive scope additions)
      const varTotal = varRows.filter(r=>/approved/i.test(r['Status']||'')).reduce((s,r)=>s+Number(r['Amount']||r['Value']||0),0);

      // Placeholder actual cost (will connect to DPR actuals later)
      const actualCost = 0; // PLACEHOLDER
      const pctCostBurned = resourceCost > 0 && actualCost > 0 ? (actualCost / resourceCost * 100) : 0;

      setEl('dBudgetedCost', fmtCr(resourceCost || budgetedCost));
      setEl('dResourceCost', fmtCr(resourceCost));
      setEl('dActualCost',   actualCost > 0 ? fmtCr(actualCost) : '— (awaiting actuals)');
      setEl('dVariations',   varTotal ? fmtCr(varTotal) : '₹0');
      setBar('barCost', pctCostBurned);

      // ── Performance indices ──────────────────────────────────
      // Workplan planned progress at today
      const months = _buildMonthAxis(startDate, endDate);
      const planned = _buildPlannedCurve(wpRows, months);
      const pctPlan = months.length > 0 ? _plannedAtToday(planned, months, today) : 0;

      // SPI = actual % / planned %  (placeholder actual = demo)
      const pctActual = 0; // PLACEHOLDER — will come from DPR
      const spi = pctPlan > 0 ? (pctActual / pctPlan) : null;
      const cpi = (actualCost > 0 && resourceCost > 0) ? (budgetedCost * (pctActual/100) / actualCost) : null;

      renderPerformance(spi, cpi, pctTime, pctActual, pctPlan, budgetedCost, actualCost, resourceCost);

      // ── Deviation alerts ─────────────────────────────────────
      renderDeviations({ pctTime, pctActual, pctPlan, spi, cpi, remainDays, endDate, today, varTotal });

      // ── BOQ breakdown ────────────────────────────────────────
      renderBOQBreakdown(boqRows);

      // ── WBS progress ─────────────────────────────────────────
      renderWBSProgress(wpRows);

      // ── Charts ───────────────────────────────────────────────
      renderSCurve(months, planned, pctActual, pctTime);
      renderCostBurn(months, resourceCost, actualCost, startDate, endDate, today);

    } catch (e) {
      console.error('[Dashboard]', e);
      showEmpty('Failed to load dashboard data: ' + e.message);
    }
  }

  // ── Performance Cards ─────────────────────────────────────────
  function renderPerformance(spi, cpi, pctTime, pctActual, pctPlan, budget, actual, resource) {
    const spiVal = spi != null ? spi.toFixed(2) : '—';
    const cpiVal = cpi != null ? cpi.toFixed(2) : '—';
    const pctPlannedStr = pctPlan > 0 ? pctPlan.toFixed(1)+'%' : '—';

    const spiColor = spi==null?'grey': spi>=0.95?'green': spi>=0.80?'gold':'red';
    const cpiColor = cpi==null?'grey': cpi>=0.95?'green': cpi>=0.80?'gold':'red';

    setEl('dSPI',      spiVal);
    setEl('dCPI',      cpiVal);
    setEl('dPctPlan',  pctPlannedStr);
    setEl('dPctActual','— (placeholder)');

    const spiEl = document.getElementById('dSPI');
    const cpiEl = document.getElementById('dCPI');
    if (spiEl) spiEl.style.color = _perfColor(spiColor);
    if (cpiEl) cpiEl.style.color = _perfColor(cpiColor);

    // EAC — Estimate at Completion
    const eac = (cpi && cpi > 0 && resource > 0) ? (resource / cpi) : null;
    setEl('dEAC', eac ? fmtCr(eac) : '— (no actuals yet)');
    const eacEl = document.getElementById('dEAC');
    if (eacEl && eac && resource > 0) {
      const over = eac > resource * 1.05;
      eacEl.style.color = over ? '#dc2626' : '#16a34a';
    }
  }

  // ── Deviation Alerts ──────────────────────────────────────────
  function renderDeviations({ pctTime, pctActual, pctPlan, spi, cpi, remainDays, endDate, today, varTotal }) {
    const container = document.getElementById('deviationAlerts');
    if (!container) return;

    const alerts = [];

    // Timeline deviation
    if (pctActual > 0 && pctPlan > 0) {
      const timeDev = pctActual - pctPlan;
      if (timeDev >= 5) alerts.push({ kind:'ok',    icon:'🟢', msg:`Schedule: <strong>Ahead by ${timeDev.toFixed(1)}%</strong> of planned progress` });
      else if (timeDev >= -5) alerts.push({ kind:'ok',   icon:'🟡', msg:`Schedule: <strong>On track</strong> (within ±5% of plan)` });
      else alerts.push({ kind:'warn', icon:'🔴', msg:`Schedule: <strong>Behind by ${Math.abs(timeDev).toFixed(1)}%</strong> — ${(-timeDev*remainDays/100).toFixed(0)} days at risk` });
    }

    // Time elapsed vs work done
    if (pctTime > 60 && pctActual === 0) {
      alerts.push({ kind:'warn', icon:'⚠️', msg:`<strong>${pctTime.toFixed(0)}% of project time elapsed</strong> — connect actuals to track real progress` });
    } else if (pctTime > 80 && pctActual < 70) {
      alerts.push({ kind:'crit', icon:'🔴', msg:`Critical: only ${pctTime.toFixed(0)}% time left but progress is ${pctActual.toFixed(0)}%` });
    }

    // Deadline proximity
    if (remainDays < 30 && remainDays >= 0) {
      alerts.push({ kind:'crit', icon:'⏰', msg:`<strong>${remainDays} days to deadline</strong> — monitor daily` });
    } else if (remainDays < 60 && remainDays >= 0) {
      alerts.push({ kind:'warn', icon:'⏰', msg:`<strong>${remainDays} days remaining</strong> — project entering critical window` });
    }

    // Variations
    if (varTotal > 0) {
      alerts.push({ kind:'info', icon:'📋', msg:`Approved variations: <strong>${fmtCr(varTotal)}</strong> — scope has changed` });
    }

    // No actuals connected
    if (pctActual === 0) {
      alerts.push({ kind:'info', icon:'💡', msg:`Actual cost & progress data not yet connected — <strong>dashboard shows planned values only</strong>` });
    }

    if (!alerts.length) {
      alerts.push({ kind:'ok', icon:'🟢', msg:`All indicators within acceptable range` });
    }

    const kindBg = { ok:'#f0fdf4', warn:'#fefce8', crit:'#fef2f2', info:'rgba(99,102,241,.06)' };
    const kindBorder = { ok:'#86efac', warn:'#fde047', crit:'#fca5a5', info:'rgba(99,102,241,.3)' };
    const kindText = { ok:'#166534', warn:'#854d0e', crit:'#991b1b', info:'#4338ca' };

    container.innerHTML = alerts.map(a => `
      <div style="
        padding:10px 14px;border-radius:8px;margin-bottom:8px;
        background:${kindBg[a.kind]};border-left:3px solid ${kindBorder[a.kind]};
        font-size:12.5px;color:${kindText[a.kind]};line-height:1.5;
      ">
        <span style="margin-right:6px">${a.icon}</span>${a.msg}
      </div>`).join('');
  }

  // ── BOQ Breakdown ─────────────────────────────────────────────
  function renderBOQBreakdown(boqRows) {
    const el = document.getElementById('boqBreakdown');
    if (!el) return;
    if (!boqRows.length) { el.innerHTML = '<div class="tree-empty">No BOQ data yet</div>'; return; }
    const sorted = boqRows.slice().sort((a,b) => (Number(b['Amount'])||0) - (Number(a['Amount'])||0));
    const total  = sorted.reduce((s,r)=>s+(Number(r['Amount'])||0),0);
    el.innerHTML = sorted.map(r => {
      const amt = Number(r['Amount'])||0;
      const pct = total > 0 ? (amt/total*100) : 0;
      return `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
          <span style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%">${Utils.esc(r['Description']||'Item '+r['S No']||'—')}</span>
          <span class="mono" style="font-size:11px;color:var(--green);font-weight:700">${fmtCr(amt)} <span style="color:var(--text-faint)">(${pct.toFixed(1)}%)</span></span>
        </div>
        <div style="height:6px;border-radius:3px;background:var(--border);overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--green);border-radius:3px;transition:width .4s"></div>
        </div>
      </div>`;
    }).join('');
  }

  // ── WBS Progress ──────────────────────────────────────────────
  function renderWBSProgress(wpRows) {
    const el = document.getElementById('wbsProgress');
    if (!el) return;
    if (!wpRows.length) { el.innerHTML = '<div class="tree-empty">No Workplan data yet</div>'; return; }
    // Group by WBS Code
    const wbsMap = {};
    wpRows.forEach(r => {
      const wbs = r['WBS Code'] || 'Unassigned';
      if (!wbsMap[wbs]) wbsMap[wbs] = { weight:0, count:0 };
      wbsMap[wbs].weight += Number(r['% Weight']||0);
      wbsMap[wbs].count++;
    });
    el.innerHTML = Object.entries(wbsMap).map(([code, d]) => `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span class="mono" style="font-size:11px;font-weight:700;color:var(--green);min-width:70px">${Utils.esc(code)}</span>
        <div style="flex:1;height:8px;border-radius:4px;background:var(--border);overflow:hidden;position:relative">
          <div style="height:100%;width:${Math.min(d.weight,100)}%;background:linear-gradient(90deg,var(--green),#34d399);border-radius:4px"></div>
        </div>
        <span style="font-size:11px;color:var(--text-faint);min-width:40px;text-align:right">${d.weight.toFixed(0)}%</span>
        <span style="font-size:10px;color:var(--text-faint)">${d.count} act${d.count===1?'':'s'}</span>
      </div>`).join('');
  }

  // ── S-Curve Chart ─────────────────────────────────────────────
  function renderSCurve(months, planned, pctActual, pctTime) {
    const canvas = document.getElementById('sCurveChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (_sCurveChart) { _sCurveChart.destroy(); _sCurveChart = null; }

    // Build placeholder actual data (0 until actuals are connected)
    // Using a simple demo: if project has started, show a slight behind-schedule curve
    const actualData = months.map((m, i) => {
      const planPct = planned[i] || 0;
      if (i === months.length - 1 && pctTime < 100) return null; // future
      if (planPct === 0) return 0;
      // Placeholder: actual = 0 (no data yet)
      return null;
    });

    // Trend line: linear regression on non-null actual points
    const trendData = _computeTrend(actualData, months);

    _sCurveChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: months,
        datasets: [
          {
            label: 'Planned Progress %',
            data: planned,
            borderColor: '#1e8038',
            backgroundColor: 'rgba(30,128,56,.08)',
            borderWidth: 2.5,
            pointRadius: 3,
            fill: true,
            tension: 0.4,
          },
          {
            label: 'Actual Progress % (placeholder)',
            data: actualData,
            borderColor: '#f59e0b',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [],
            pointRadius: 4,
            pointStyle: 'circle',
            fill: false,
            tension: 0.2,
            spanGaps: false,
          },
          {
            label: 'Trend (projected)',
            data: trendData,
            borderColor: '#ef4444',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
            tension: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 14 } },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${ctx.raw != null ? ctx.raw.toFixed(1)+'%' : 'N/A'}`,
            },
          },
          annotation: _todayAnnotation(months),
        },
        scales: {
          x: { ticks: { font: { size: 10 }, maxRotation: 45 }, grid: { color: 'rgba(0,0,0,.05)' } },
          y: {
            min: 0, max: 100,
            ticks: { font: { size: 10 }, callback: v => v + '%' },
            grid: { color: 'rgba(0,0,0,.05)' },
            title: { display: true, text: 'Cumulative Progress %', font: { size: 10 } },
          },
        },
      },
    });
  }

  // ── Cost Burn Chart ───────────────────────────────────────────
  function renderCostBurn(months, budgetTotal, actualCost, startDate, endDate, today) {
    const canvas = document.getElementById('costBurnChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (_costChart) { _costChart.destroy(); _costChart = null; }

    if (months.length === 0 || budgetTotal === 0) return;

    // Planned burn: linear distribution of budget over project duration
    const monthlyBudget = budgetTotal / months.length;
    const plannedBurn   = months.map((_, i) => +(((i+1) * monthlyBudget).toFixed(0)));

    // Actual burn: placeholder (0 for all months)
    const actualBurn = months.map(() => null);

    _costChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: months,
        datasets: [
          {
            label: 'Planned Cumulative Cost (₹)',
            data: plannedBurn,
            type: 'line',
            borderColor: '#1e8038',
            backgroundColor: 'transparent',
            borderWidth: 2.5,
            pointRadius: 3,
            fill: false,
            tension: 0.1,
            yAxisID: 'y',
          },
          {
            label: 'Actual Cost (₹) — placeholder',
            data: actualBurn,
            type: 'bar',
            backgroundColor: 'rgba(245,158,11,.5)',
            borderColor: '#f59e0b',
            borderWidth: 1,
            yAxisID: 'y',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 14 } },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${ctx.raw != null ? fmtCr(ctx.raw) : 'No data'}`,
            },
          },
        },
        scales: {
          x: { ticks: { font: { size: 10 }, maxRotation: 45 }, grid: { color: 'rgba(0,0,0,.04)' } },
          y: {
            ticks: { font: { size: 10 }, callback: v => '₹' + fmtNum(v) },
            grid: { color: 'rgba(0,0,0,.04)' },
            title: { display: true, text: 'Cumulative Cost (₹)', font: { size: 10 } },
          },
        },
      },
    });
  }

  // ── Helpers ────────────────────────────────────────────────────
  function _buildMonthAxis(start, end) {
    if (!start || !end) return [];
    const months = [];
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    const last = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cur <= last) {
      months.push(cur.toISOString().slice(0,7));
      cur.setMonth(cur.getMonth() + 1);
    }
    return months;
  }

  function _buildPlannedCurve(wpRows, months) {
    if (!months.length) return [];
    const totalWeight = wpRows.reduce((s,r)=>s+Number(r['% Weight']||0),0) || 100;
    const monthly = {};
    months.forEach(m => monthly[m] = 0);
    wpRows.forEach(r => {
      const w = Number(r['% Weight']||0);
      if (!w) return;
      const s = parseDate(r['Start']); const e = parseDate(r['End']);
      if (!s || !e) return;
      // Distribute weight evenly over each month the activity spans
      const actMonths = _monthsBetween(s, e);
      if (!actMonths.length) return;
      const perMonth = w / actMonths.length;
      actMonths.forEach(m => { if (monthly[m] !== undefined) monthly[m] += perMonth; });
    });
    // Cumulate
    let cum = 0;
    return months.map(m => { cum += monthly[m]||0; return +(cum / totalWeight * 100).toFixed(1); });
  }

  function _plannedAtToday(planned, months, today) {
    const ym = today.toISOString().slice(0,7);
    const idx = months.indexOf(ym);
    if (idx < 0) return planned[planned.length-1] || 0;
    return planned[idx] || 0;
  }

  function _monthsBetween(s, e) {
    const result = [];
    const cur = new Date(s.getFullYear(), s.getMonth(), 1);
    const last = new Date(e.getFullYear(), e.getMonth(), 1);
    while (cur <= last) { result.push(cur.toISOString().slice(0,7)); cur.setMonth(cur.getMonth()+1); }
    return result;
  }

  function _computeTrend(actualData, months) {
    const points = actualData.map((v,i)=>({x:i,y:v})).filter(p=>p.y!=null);
    if (points.length < 2) return months.map(()=>null);
    const n = points.length;
    const sumX = points.reduce((s,p)=>s+p.x,0);
    const sumY = points.reduce((s,p)=>s+p.y,0);
    const sumXX= points.reduce((s,p)=>s+p.x*p.x,0);
    const sumXY= points.reduce((s,p)=>s+p.x*p.y,0);
    const denom = n*sumXX - sumX*sumX;
    if (!denom) return months.map(()=>null);
    const m_slope = (n*sumXY - sumX*sumY)/denom;
    const b_int   = (sumY - m_slope*sumX)/n;
    // Only draw trend from last actual point forward
    const lastIdx = Math.max(...points.map(p=>p.x));
    return months.map((_,i) => {
      if (i < lastIdx) return null;
      return +Math.min(100, Math.max(0, m_slope*i + b_int)).toFixed(1);
    });
  }

  function _todayAnnotation(months) {
    // chartjs-plugin-annotation — optional, skip if not loaded
    return {};
  }

  function _sumField(rows, fields) {
    return rows.reduce((s,r) => {
      for (const f of fields) { const v = Number(r[f]); if (!isNaN(v) && v) return s+v; }
      return s;
    }, 0);
  }

  function parseDate(v) {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function daysBetween(a, b) {
    if (!a || !b) return 0;
    return Math.round((b - a) / 86400000);
  }

  function fmtDate(d) {
    if (!d) return '—';
    return d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
  }

  function fmtCr(v) {
    const n = Number(v) || 0;
    if (n >= 1e7) return '₹' + (n/1e7).toFixed(2) + ' Cr';
    if (n >= 1e5) return '₹' + (n/1e5).toFixed(2) + ' L';
    return '₹' + fmtNum(n);
  }

  function fmtNum(v) {
    return Number(v||0).toLocaleString('en-IN');
  }

  function _perfColor(c) {
    return { green:'#16a34a', gold:'#b45309', red:'#dc2626', grey:'#9ca3af' }[c] || '#9ca3af';
  }

  function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function setBar(id, pct) {
    const el = document.getElementById(id);
    if (el) el.style.width = Math.min(100, Math.max(0, pct)).toFixed(1) + '%';
  }

  function showEmpty(msg) {
    const c = document.getElementById('dashContent');
    if (c) c.innerHTML = `<div class="tree-empty" style="margin:40px auto;max-width:400px;text-align:center">${msg}</div>`;
  }

  function onProjectChange() { load(); }
  function filter() {}
  function refresh() { return load(); }

  return { load, refresh, onProjectChange, filter };
})();
