/* ════════════════════════════════════════════════════════════════
   Step 2 · BOQ
   ────────────────────────────────────────────────────────────────
   Schema (matches AppSheet PL11_BOQ):
     uuid           → UUID            (PCC generates "PL-BOQ-{random}")
     checkSum       → CheckSum        (= Project UUID)
     boqItemNum     → BOQ Item #      (auto-sequential per project)
     desc           → Description     (required)
     unit           → Unit            (adaptive dropdown)
     qty            → Qty             (working quantity)
     tenderQty      → Tender Qty      (from contract)
     actualQty      → Actual Qty      (measured / executed)
     rate           → Rate            (standard/primary rate)
     contractorRate → Contractor Rate (EG internal / sub-contractor cost)
     clientRate     → Client Rate     (billed to client)
     _amt           → Amount          (Qty × Rate — PCC computes, sends static)

   NEVER written by PCC (formula columns in sheet):
     BOQ ID · BOQ ID (Description) · Project Code · Project Name
     Site Name · UserEmail · SystemEmail · Timestamp
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function () {

  // ── State ──────────────────────────────────────────────────────
  let items        = [];  // full item list
  let visibleItems = null; // filtered subset

  // ── Render ─────────────────────────────────────────────────────
  function render() {
    const list  = visibleItems || items;
    const tbody = document.getElementById('boqTbody');

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="11" class="empty-cell">No items — type below or use the AI assistant →</td></tr>';
    } else {
      tbody.innerHTML = list.map((it, vi) => {
        const ri = items.indexOf(it); // real index in items[]
        return `
        <tr>
          <td>
            <span class="boq-id-chip" title="BOQ Item #">${it.boqItemNum || (ri + 1)}</span>
          </td>
          <td>
            <input class="ie desc" value="${Utils.esc(it.desc)}"
                   oninput="PAGE.edit(${ri},'desc',this.value)"
                   placeholder="Work description…" />
          </td>
          <td>
            <input class="ie unit unit-adaptive" list="unitOptions"
                   value="${Utils.esc(it.unit)}"
                   oninput="PAGE.edit(${ri},'unit',this.value)"
                   placeholder="Unit…" />
          </td>
          <!-- Quantities -->
          <td><input class="ie num" type="number" step="0.01" min="0"
                     value="${it.tenderQty || ''}"
                     oninput="PAGE.edit(${ri},'tenderQty',this.value)"
                     placeholder="0" /></td>
          <td><input class="ie num" type="number" step="0.01" min="0"
                     value="${it.qty || ''}"
                     oninput="PAGE.edit(${ri},'qty',this.value)"
                     placeholder="0" /></td>
          <td><input class="ie num" type="number" step="0.01" min="0"
                     value="${it.actualQty || ''}"
                     oninput="PAGE.edit(${ri},'actualQty',this.value)"
                     placeholder="0" /></td>
          <!-- Rates -->
          <td><input class="ie num" type="number" step="0.01" min="0"
                     value="${it.rate || ''}"
                     oninput="PAGE.edit(${ri},'rate',this.value)"
                     placeholder="0" /></td>
          <td><input class="ie num" type="number" step="0.01" min="0"
                     value="${it.contractorRate || ''}"
                     oninput="PAGE.edit(${ri},'contractorRate',this.value)"
                     placeholder="0" /></td>
          <td><input class="ie num" type="number" step="0.01" min="0"
                     value="${it.clientRate || ''}"
                     oninput="PAGE.edit(${ri},'clientRate',this.value)"
                     placeholder="0" /></td>
          <!-- Amount (read-only, computed) -->
          <td class="amt-cell">
            ${it._amt ? Utils.fmt2(it._amt) : '—'}
          </td>
          <td>
            <button class="btn-icon danger" onclick="PAGE.removeRow(${ri})" title="Remove">×</button>
          </td>
          <td style="text-align:center">
            <button class="btn btn-secondary btn-sm"
                    style="font-size:10px;padding:2px 7px;color:#166534;border-color:#a7f3d0"
                    onclick="PAGE.openWbsDrawer(${ri})"
                    title="Add/view WBS items for this BOQ">+WBS</button>
          </td>
        </tr>`;
      }).join('');
    }

    // Totals
    const stdAmt        = items.reduce((s, x) => s + (x._amt || 0), 0);
    const clientTotal   = items.reduce((s, x) => s + (Number(x.clientRate) || 0) * (Number(x.tenderQty) || 0), 0);
    const contractorTot = items.reduce((s, x) => s + (Number(x.contractorRate) || 0) * (Number(x.qty) || 0), 0);
    const tenderTotal   = items.reduce((s, x) => s + (Number(x.rate) || 0) * (Number(x.tenderQty) || 0), 0);

    setEl('boqRowCount',          items.length);
    setEl('boqAmtTotal',          '₹ ' + Utils.fmt2(stdAmt));
    setEl('boqClientTotal',       '₹ ' + Utils.fmt2(clientTotal));
    setEl('boqContractorTotal',   '₹ ' + Utils.fmt2(contractorTot));
    setEl('kBoqCount',            items.length);
    setEl('kBoqClientTotal',      Utils.fmt(clientTotal));
    setEl('kBoqContractorTotal',  Utils.fmt(contractorTot));
    setEl('kBoqTenderTotal',      Utils.fmt(tenderTotal));
  }

  function edit(idx, key, val) {
    if (!items[idx]) return;
    const numKeys = ['qty','tenderQty','actualQty','rate','contractorRate','clientRate'];
    items[idx][key] = numKeys.includes(key) ? Number(val) || 0 : val;
    // Recompute Amount = Qty × Rate (standard)
    items[idx]._amt = (Number(items[idx].qty) || 0) * (Number(items[idx].rate) || 0);
    render();
  }

  // ── Load ───────────────────────────────────────────────────────
  async function load() {
    const ap = window.STATE.activeProject;
    if (!ap) { Utils.toast('Select a project first', 'err'); return; }

    setEl('kBoqProj',     ap['Project Code'] || '—');
    setEl('kBoqProjName', ap['Project Name'] || '(no name)');
    setStatus('Loading…', 'gold');

    try {
      const data = await API.gviz(window.CONFIG.TABS.BOQ);
      const code = ap['Project Code'];
      items = (data || [])
        .filter(r => (r['Project Code'] || r['ProjectCode'] || '') === code)
        .map((r, i) => ({
          uuid:           r['UUID']            || r['uuid']            || '',
          checkSum:       r['CheckSum']        || r['Checksum']        || '',
          boqItemNum:     Number(r['BOQ Item #'] || r['BOQ Item'] || r['S No'] || (i + 1)),
          desc:           r['Description']     || '',
          unit:           r['Unit']            || '',
          qty:            Number(r['Qty']             || r['Quantity'] || 0),
          tenderQty:      Number(r['Tender Qty']       || 0),
          actualQty:      Number(r['Actual Qty']       || 0),
          rate:           Number(r['Rate']             || 0),
          contractorRate: Number(r['Contractor Rate']  || 0),
          clientRate:     Number(r['Client Rate']      || 0),
          _amt:           0,
        }));
      items.forEach(it => { it._amt = (it.qty || 0) * (it.rate || 0); });
      render();
      setStatus(items.length ? `${items.length} items` : 'Empty', items.length ? 'green' : 'gold');
    } catch (e) {
      setStatus('Load failed', 'red');
      Utils.toast('Could not fetch BOQ rows: ' + e.message, 'err');
    }
  }

  // ── Quick add ──────────────────────────────────────────────────
  function quickAdd() {
    const inp  = document.getElementById('quickAddInput');
    const desc = (inp.value || '').trim();
    if (!desc) return;
    const nextNum = Math.max(0, ...items.map(it => it.boqItemNum || 0)) + 1;
    items.push({
      uuid: '', checkSum: '',
      boqItemNum: nextNum,
      desc, unit: 'Running Meter',
      qty: 0, tenderQty: 0, actualQty: 0,
      rate: 0, contractorRate: 0, clientRate: 0,
      _amt: 0,
    });
    inp.value = '';
    visibleItems = null;
    document.getElementById('boqFilter').value = '';
    render();
  }

  function removeRow(idx) {
    items.splice(idx, 1);
    // Renumber sequentially
    items.forEach((it, i) => { it.boqItemNum = i + 1; });
    visibleItems = null;
    document.getElementById('boqFilter').value = '';
    render();
  }

  function clearAll() {
    if (!items.length) return;
    if (!confirm(`Clear all ${items.length} BOQ items? (Local only — save to persist.)`)) return;
    items = []; visibleItems = null; render();
  }

  function filter(q) {
    const ql = String(q || '').toLowerCase();
    visibleItems = ql ? items.filter(it => String(it.desc).toLowerCase().includes(ql)) : null;
    render();
  }

  // ── CSV ────────────────────────────────────────────────────────
  function exportCSV() {
    if (!items.length) { Utils.toast('Nothing to export', 'err'); return; }
    const ap = window.STATE.activeProject || {};
    const hdr = 'BOQ Item #,Description,Unit,Tender Qty,Working Qty,Actual Qty,Rate,Contractor Rate,Client Rate,Amount';
    const rows = items.map(it =>
      [it.boqItemNum, q(it.desc), it.unit,
       it.tenderQty, it.qty, it.actualQty,
       it.rate, it.contractorRate, it.clientRate,
       it._amt.toFixed(2)].join(',')
    );
    const blob = new Blob([hdr + '\n' + rows.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `BOQ_${ap['Project Code'] || 'project'}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    function q(s) { return /[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : s; }
  }

  function importCSV(ev) {
    const f = ev.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = e => {
      const lines = String(e.target.result).split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) return;
      const hdr = lines[0].split(',').map(s => s.trim().toLowerCase());
      const idx = k => hdr.findIndex(h => h.includes(k));
      const di = idx('desc'); const ui = idx('unit');
      const qi = idx('working') >= 0 ? idx('working') : idx('qty');
      const ti = idx('tender'); const ai = idx('actual');
      const ri = idx('rate') >= 0 ? hdr.findIndex(h => h==='rate' || h==='standard rate') : -1;
      const cri = idx('contractor'); const cli = idx('client');

      const nextStart = Math.max(0, ...items.map(it => it.boqItemNum || 0));
      const added = [];
      lines.slice(1).forEach((line, li) => {
        const p = parseCsv(line);
        const desc = di >= 0 ? p[di] : p[1] || '';
        if (!desc) return;
        added.push({
          uuid: '', checkSum: '',
          boqItemNum: nextStart + added.length + 1,
          desc: desc.trim(),
          unit: (ui >= 0 ? p[ui] : 'Running Meter').trim() || 'Running Meter',
          qty:            qi  >= 0 ? Number(p[qi])  || 0 : 0,
          tenderQty:      ti  >= 0 ? Number(p[ti])  || 0 : 0,
          actualQty:      ai  >= 0 ? Number(p[ai])  || 0 : 0,
          rate:           ri  >= 0 ? Number(p[ri])  || 0 : 0,
          contractorRate: cri >= 0 ? Number(p[cri]) || 0 : 0,
          clientRate:     cli >= 0 ? Number(p[cli]) || 0 : 0,
          _amt: 0,
        });
        added[added.length - 1]._amt =
          added[added.length - 1].qty * added[added.length - 1].rate;
      });
      items = items.concat(added);
      render();
      Utils.toast(`Imported ${added.length} rows`, 'ok');
      ev.target.value = '';
    };
    reader.readAsText(f);
  }

  function parseCsv(line) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') { q = !q; }
      else if (c === ',' && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  // ── AI assistant ───────────────────────────────────────────────
  async function askAI(preset) {
    const inp = document.getElementById('aiInput');
    const txt = (preset || inp.value || '').trim();
    if (!txt) return;
    if (!preset) inp.value = '';
    appendMsg(txt, 'user');
    const typing = appendMsg('<span class="typing-dots"><span></span><span></span><span></span></span>', 'bot');
    document.getElementById('aiSend').disabled = true;
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{ role: 'user', content:
            `You are a BOQ assistant for Indian civil construction.
Return ONLY JSON — no markdown, no preamble:
{"message":"<short reply>","items":[{"desc":"…","unit":"Running Meter|Kilogram|Numbers|Square Meter|Cubic Meter|Metric Ton|Lump Sum","tenderQty":<number>,"qty":<number>,"rate":<INR std rate>,"contractorRate":<INR>,"clientRate":<INR>}]}
Max 6 items. Scope: ${txt}` }],
        }),
      });
      const data = await r.json();
      const raw  = ((data.content || []).find(b => b.type === 'text') || {}).text || '{}';
      let parsed;
      try { parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
      catch { parsed = { message: 'Could not parse — try again.', items: [] }; }

      typing.innerHTML = Utils.esc(parsed.message || '');
      (parsed.items || []).forEach(it => {
        const safe = JSON.stringify(it).replace(/'/g, '&apos;').replace(/"/g, '&quot;');
        const card = document.createElement('div');
        card.className = 'ai-sug-item';
        card.innerHTML = `
          <span class="desc">${Utils.esc(it.desc)}</span>
          <span class="meta">${Utils.esc(it.unit||'—')} · ₹${Utils.fmt(it.rate||0)}</span>
          <button class="add-btn" data-item='${safe}' onclick="PAGE._addAISug(this)">+</button>`;
        typing.appendChild(card);
      });
    } catch (e) {
      typing.innerHTML = '⚠ AI unavailable.';
    } finally {
      document.getElementById('aiSend').disabled = false;
      document.getElementById('aiChatArea').scrollTop = 9999;
    }
  }

  function _addAISug(btn) {
    try {
      const it = JSON.parse(btn.getAttribute('data-item').replace(/&quot;/g,'"').replace(/&apos;/g,"'"));
      const nextNum = Math.max(0, ...items.map(x => x.boqItemNum || 0)) + 1;
      const qty = Number(it.qty || it.tenderQty || 0);
      const rate = Number(it.rate || 0);
      items.push({
        uuid:'', checkSum:'',
        boqItemNum: nextNum,
        desc:           it.desc            || '',
        unit:           it.unit            || 'Running Meter',
        qty,
        tenderQty:      Number(it.tenderQty     || qty),
        actualQty:      0,
        rate,
        contractorRate: Number(it.contractorRate || 0),
        clientRate:     Number(it.clientRate     || 0),
        _amt: qty * rate,
      });
      render();
      Utils.toast(`Added: ${String(it.desc).slice(0,36)}`, 'ok');
    } catch (e) { Utils.toast('Could not add suggestion', 'err'); }
  }

  function appendMsg(html, who) {
    const area = document.getElementById('aiChatArea');
    const div  = document.createElement('div');
    div.className = 'ai-msg ' + (who === 'user' ? 'user' : 'bot');
    div.innerHTML = html;
    area.appendChild(div);
    area.scrollTop = 9999;
    return div;
  }

  // ── Save ───────────────────────────────────────────────────────
  async function save() {
    const ap = window.STATE.activeProject;
    if (!ap)         { Utils.toast('Select a project first', 'err'); return; }
    if (!items.length){ Utils.toast('Nothing to save', 'err');       return; }

    const btn    = document.getElementById('saveBtn');
    const btnBot = document.getElementById('saveBtnBot');
    const setBusy = (b) => {
      if (btn)    { btn.disabled = b;    btn.textContent    = b ? 'Saving…' : '💾 Save BOQ'; }
      if (btnBot) { btnBot.disabled = b; btnBot.textContent = b ? 'Saving…' : '💾 Save BOQ'; }
    };
    setBusy(true);

    try {
      const payload = {
        projectCode:  ap['Project Code'] || '',
        projectUuid:  ap['UUID'] || ap['uuid'] || '',
        projectName:  ap['Project Name'] || '',
        siteName:     ap['Site Name']    || '',
        userEmail:    (window.STATE.user && (window.STATE.user.email || window.STATE.user.Email)) || '',
        rows: items.map((it, i) => ({
          'UUID':            it.uuid     || '',
          'CheckSum':        it.checkSum || '',
          'BOQ Item #':      it.boqItemNum || (i + 1),
          'Description':     it.desc,
          'Unit':            it.unit,
          'Qty':             Number(it.qty)            || 0,
          'Tender Qty':      Number(it.tenderQty)      || 0,
          'Actual Qty':      Number(it.actualQty)      || 0,
          'Rate':            Number(it.rate)            || 0,
          'Contractor Rate': Number(it.contractorRate)  || 0,
          'Client Rate':     Number(it.clientRate)      || 0,
          'Amount':          Number(it._amt)            || 0,
        })),
      };

      const r = await API.scriptCall('saveBOQ', payload);
      if (r && r.success) {
        // Apply backend-assigned UUIDs + BOQ Item # back to local state
        if (r.assignedRows && Array.isArray(r.assignedRows)) {
          r.assignedRows.forEach(a => {
            const item = items[a.index];
            if (item) {
              if (a.uuid)       item.uuid       = a.uuid;
              if (a.checkSum)   item.checkSum   = a.checkSum;
              if (a.boqItemNum) item.boqItemNum = a.boqItemNum;
            }
          });
        }
        render();
        Utils.toast(`Saved ${items.length} BOQ items ✓`, 'ok');
        if (window.Shell && Shell.stampSaved) Shell.stampSaved();
      } else {
        Utils.toast((r && r.message) || 'Save failed', 'err');
      }
    } catch (e) {
      Utils.toast('Save error: ' + e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  // ── WBS Drawer ────────────────────────────────────────────────
  // Opens from right — shows existing WBS for a BOQ item + form to add new
  let _wbsDrawerBoqIdx = -1;
  let _wbsForBoq       = [];  // WBS rows loaded for the active BOQ

  async function openWbsDrawer(boqIdx) {
    const it = items[boqIdx];
    if (!it) return;
    _wbsDrawerBoqIdx = boqIdx;

    // Update drawer subtitle
    const sub = document.getElementById('wbsDrawerSub');
    if (sub) sub.textContent = `BOQ ${it.boqItemNum || (boqIdx+1)} · ${String(it.desc || '').slice(0,40)}`;

    // Clear form
    ['wbsDrawerDesc','wbsDrawerUnit','wbsDrawerQty'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    // Load existing WBS for this BOQ from sheet
    _wbsForBoq = [];
    const listEl = document.getElementById('wbsDrawerList');
    if (listEl) listEl.innerHTML = '<div style="font-size:12px;color:var(--text-faint);font-style:italic">Loading…</div>';

    if (it.uuid) {
      try {
        const ap = window.STATE.activeProject;
        const code = ap && ap['Project Code'];
        const wbsAll = await API.gviz(window.CONFIG.TABS.WBS).catch(() => []);
        _wbsForBoq = (wbsAll || []).filter(r => {
          const cs = String(r['CheckSum'] || '').trim();
          return cs === it.uuid;
        });
      } catch (e) { /* show empty */ }
    }

    if (listEl) {
      if (!_wbsForBoq.length) {
        listEl.innerHTML = '<div style="font-size:12px;color:var(--text-faint);font-style:italic">No WBS items yet — add one below.</div>';
      } else {
        listEl.innerHTML = _wbsForBoq.map((r, i) => {
          const desc = String(r['Description'] || r['WBS Name'] || '').slice(0, 36);
          const unit = String(r['Unit'] || '');
          const qty  = Number(r['Qty'] || 0);
          const act  = String(r['Activity #'] || (i+1));
          return `
          <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;
                      border:1px solid var(--border);border-radius:6px;margin-bottom:6px;
                      background:var(--surface2);font-size:12px">
            <span class="mono" style="font-size:10px;color:#1e3a8a;font-weight:700;min-width:28px">#${act}</span>
            <span style="flex:1;font-weight:500">${Utils.esc(desc)}</span>
            <span class="mono" style="font-size:10.5px;color:var(--text-dim)">${Utils.esc(unit)}${qty ? ' · '+qty : ''}</span>
          </div>`;
        }).join('');
      }
    }

    // Open drawer
    document.getElementById('wbsDrawer').style.transform = 'translateX(0)';
    document.getElementById('wbsDrawerOverlay').style.display = 'block';
    setTimeout(() => document.getElementById('wbsDrawerDesc')?.focus(), 200);
  }

  function closeWbsDrawer() {
    document.getElementById('wbsDrawer').style.transform = 'translateX(100%)';
    document.getElementById('wbsDrawerOverlay').style.display = 'none';
    _wbsDrawerBoqIdx = -1;
  }

  async function wbsDrawerSave() {
    const it = items[_wbsDrawerBoqIdx];
    if (!it) return;

    const desc = (document.getElementById('wbsDrawerDesc')?.value || '').trim();
    const unit = (document.getElementById('wbsDrawerUnit')?.value || '').trim();
    const qty  = Number(document.getElementById('wbsDrawerQty')?.value || 0);

    if (!desc) { Utils.toast('Description is required', 'err'); return; }

    const ap = window.STATE.activeProject;
    if (!ap) { Utils.toast('No active project', 'err'); return; }

    const btn = document.getElementById('wbsDrawerSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    // Build full existing WBS payload + new row
    const allNodes = _wbsForBoq.map((r, i) => ({
      uuid:        String(r['UUID']       || ''),
      checkSum:    String(r['CheckSum']   || ''),
      boqId:       String(r['BOQ ID']     || ''),
      boqIdDesc:   String(r['BOQ ID (Description)'] || ''),
      description: String(r['Description']|| r['WBS Name'] || ''),
      unit:        String(r['Unit']       || ''),
      qty:         Number(r['Qty'])        || 0,
    }));

    // Compute BOQ ID and BOQ ID (Description) from the BOQ item
    const boqId     = it.uuid ? (it.uuid + '-' + (it.boqItemNum || (_wbsDrawerBoqIdx+1))) : '';
    const boqIdDesc = boqId ? (boqId + ' : ' + (it.desc || '')) : '';

    allNodes.push({
      uuid: '', checkSum: it.uuid || '',
      boqId, boqIdDesc,
      description: desc, unit, qty,
    });

    try {
      const r = await API.scriptCall('saveWBS', {
        projectCode: ap['Project Code'],
        projectName: ap['Project Name'] || '',
        siteName:    ap['Site Name']    || '',
        userEmail:   (window.STATE.user && (window.STATE.user.email || window.STATE.user.Email)) || '',
        nodes: allNodes,
        activities: [],
      });

      if (r && r.success) {
        Utils.toast('WBS item added ✓', 'ok');
        // Reload the WBS list in the drawer
        await openWbsDrawer(_wbsDrawerBoqIdx);
      } else {
        Utils.toast((r && r.message) || 'Save failed', 'err');
      }
    } catch (e) {
      Utils.toast('Error: ' + e.message, 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Add WBS Item'; }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────
  function setEl(id, val) { const e = document.getElementById(id); if (e) e.textContent = val; }
  function setStatus(msg, color) {
    const el = document.getElementById('boqStatus');
    if (el) { el.textContent = msg; el.className = 'pill pill-' + (color || 'green'); }
  }

  function onProjectChange() { load(); }

  return {
    load, save, render, edit,
    removeRow, quickAdd, clearAll, filter,
    importCSV, exportCSV,
    askAI, _addAISug,
    openWbsDrawer, closeWbsDrawer, wbsDrawerSave,
    onProjectChange,
  };
})();
