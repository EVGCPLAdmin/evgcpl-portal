/* ════════════════════════════════════════════════════════════════
   Step 2 · BOQ
   Inline-editable table + AI suggestion panel.
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function() {

  let items = [];   // [{sno, desc, unit, qty, rate, _amt}]
  let visibleItems = null;  // filtered view

  const UNITS = ['CUM','SQM','RMT','NOS','KG','MT','LM','HR','LS','CFT','SFT','MM','MTR'];

  async function load() {
    const ap = window.STATE.activeProject;
    if (!ap) {
      Utils.toast('Select a project first', 'err');
      return;
    }
    document.getElementById('kBoqProj').textContent     = ap['Project Code'] || '—';
    document.getElementById('kBoqProjName').textContent = ap['Project Name'] || '(no name)';

    setStatus('Loading…', 'gold');
    try {
      const data = await API.gviz(window.CONFIG.TABS.BOQ);
      const code = ap['Project Code'];
      items = data
        .filter(r => (r['Project Code'] || r['ProjectCode']) === code)
        .map((r, i) => ({
          uuid: r['UUID']     || r['uuid']     || '',  // preserved from sheet; backend fills on first save
          checkSum: r['CheckSum'] || r['Checksum'] || '', // = Project.UUID
          sno:  Number(r['S No'] || r['Sno'] || (i + 1)),
          desc: r['Description'] || r['Item Description'] || '',
          unit: r['Unit'] || 'CUM',
          qty:  Number(r['Qty'] || r['Quantity'] || 0),
          rate: Number(r['Rate'] || 0),
        }));
      items.forEach(it => it._amt = (Number(it.qty) || 0) * (Number(it.rate) || 0));
      render();
      setStatus(items.length ? 'Loaded' : 'Empty', items.length ? 'green' : 'gold');
    } catch (e) {
      setStatus('Load failed', 'red');
      Utils.toast('Could not fetch BOQ rows', 'err');
    }
  }

  function setStatus(msg, color) {
    const el = document.getElementById('boqStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = 'pill pill-' + (color || 'green');
  }

  function render() {
    const list = visibleItems || items;
    const tbody = document.getElementById('boqTbody');
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No items yet — type below or use AI assistant on the right.</td></tr>';
    } else {
      tbody.innerHTML = list.map((it, i) => {
        const realIdx = items.indexOf(it);
        const unitOpts = UNITS.map(u => `<option ${u === it.unit ? 'selected' : ''}>${u}</option>`).join('');
        return `<tr>
          <td class="mono">${i + 1}</td>
          <td><input class="inline-edit desc" value="${Utils.esc(it.desc)}" oninput="PAGE.edit(${realIdx},'desc',this.value)" /></td>
          <td><select class="unit-select" onchange="PAGE.edit(${realIdx},'unit',this.value)">${unitOpts}</select></td>
          <td><input class="inline-edit num" type="number" step="0.01" value="${it.qty}" oninput="PAGE.edit(${realIdx},'qty',this.value)" /></td>
          <td><input class="inline-edit num" type="number" step="0.01" value="${it.rate}" oninput="PAGE.edit(${realIdx},'rate',this.value)" /></td>
          <td class="mono right gold-num">${Utils.fmt2(it._amt)}</td>
          <td><button class="btn-icon danger" onclick="PAGE.removeRow(${realIdx})" title="Remove">&times;</button></td>
        </tr>`;
      }).join('');
    }

    const total = items.reduce((s, x) => s + (x._amt || 0), 0);
    document.getElementById('boqRowCount').textContent  = items.length;
    document.getElementById('boqTotalVal').textContent  = '₹ ' + Utils.fmt2(total);
    document.getElementById('kBoqCount').textContent    = items.length;
    document.getElementById('kBoqTotal').textContent    = Utils.fmt(total);
    document.getElementById('kBoqAvg').textContent      = items.length ? Utils.fmt(total / items.length) : '0';
  }

  function edit(idx, key, val) {
    if (!items[idx]) return;
    items[idx][key] = (key === 'desc' || key === 'unit') ? val : Number(val);
    items[idx]._amt = (Number(items[idx].qty) || 0) * (Number(items[idx].rate) || 0);
    // Light update — only refresh footer + amount cell would be ideal but full re-render is OK
    render();
  }

  function removeRow(idx) {
    items.splice(idx, 1);
    items.forEach((it, i) => it.sno = i + 1);
    visibleItems = null;
    document.getElementById('boqFilter').value = '';
    render();
  }

  function quickAdd() {
    const inp = document.getElementById('quickAddInput');
    const desc = inp.value.trim();
    if (!desc) return;
    items.push({ sno: items.length + 1, desc, unit: 'CUM', qty: 0, rate: 0, _amt: 0 });
    inp.value = '';
    visibleItems = null;
    document.getElementById('boqFilter').value = '';
    render();
  }

  function clearAll() {
    if (!items.length) return;
    if (!confirm(`Clear all ${items.length} BOQ items? This is local only — save to persist.`)) return;
    items = [];
    visibleItems = null;
    render();
  }

  function filter(q) {
    const ql = String(q || '').toLowerCase();
    if (!ql) { visibleItems = null; }
    else { visibleItems = items.filter(it => String(it.desc).toLowerCase().includes(ql)); }
    render();
  }

  /* ─── CSV import / export ─── */
  function importCSV(ev) {
    const f = ev.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = e => {
      const lines = String(e.target.result).split(/\r?\n/).filter(Boolean);
      if (!lines.length) return;
      const header = lines[0].split(',').map(s => s.trim().toLowerCase());
      const di = header.findIndex(h => h === 'description' || h === 'desc' || h === 'item description');
      const ui = header.findIndex(h => h === 'unit' || h === 'uom');
      const qi = header.findIndex(h => h === 'qty' || h === 'quantity');
      const ri = header.findIndex(h => h === 'rate' || h === 'unit rate');
      const dataLines = lines.slice(1);
      const added = [];
      dataLines.forEach(line => {
        const parts = parseCsvLine(line);
        if (!parts.length) return;
        const desc = di >= 0 ? parts[di] : parts[1] || '';
        if (!desc) return;
        added.push({
          sno:  items.length + added.length + 1,
          desc: desc.trim(),
          unit: (ui >= 0 ? (parts[ui] || 'CUM') : 'CUM').trim().toUpperCase(),
          qty:  qi >= 0 ? Number(parts[qi]) || 0 : 0,
          rate: ri >= 0 ? Number(parts[ri]) || 0 : 0,
        });
      });
      added.forEach(it => it._amt = it.qty * it.rate);
      items = items.concat(added);
      render();
      Utils.toast(`Imported ${added.length} rows`, 'ok');
      ev.target.value = '';
    };
    r.readAsText(f);
  }

  function parseCsvLine(line) {
    // Handles quoted commas
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') { q = !q; }
      else if (c === ',' && !q) { out.push(cur); cur = ''; }
      else { cur += c; }
    }
    out.push(cur);
    return out;
  }

  function exportCSV() {
    if (!items.length) { Utils.toast('Nothing to export', 'err'); return; }
    const ap = window.STATE.activeProject || {};
    const lines = ['S.No,Description,Unit,Qty,Rate,Amount'];
    items.forEach((it, i) => {
      lines.push([i + 1, q(it.desc), it.unit, it.qty, it.rate, it._amt.toFixed(2)].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BOQ_${ap['Project Code'] || 'project'}_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    function q(s) { return /[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : s; }
  }

  /* ─── AI assistant ─── */
  async function askAI(presetText) {
    const inp = document.getElementById('aiInput');
    const txt = (presetText || inp.value || '').trim();
    if (!txt) return;
    if (!presetText) inp.value = '';

    appendMsg(txt, 'user');
    const typing = appendMsg('<span class="typing-dots"><span></span><span></span><span></span></span>', 'bot');

    const btn = document.getElementById('aiSend');
    btn.disabled = true;

    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{ role: 'user', content:
            `You are a BOQ assistant for Indian civil construction. Given this scope, return JSON ONLY:
{"message":"<short conversational reply>","items":[{"desc":"…","unit":"CUM|SQM|RMT|NOS|KG|MT|LS","qty":<number>,"rate":<INR rate>}]}
No markdown, no preamble, no code fences. Up to 6 items.

Scope: ${txt}` }],
        }),
      });
      const data = await r.json();
      let raw = '{}';
      const txtBlock = (data.content || []).find(b => b.type === 'text');
      if (txtBlock) raw = txtBlock.text;
      let parsed;
      try { parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
      catch { parsed = { message: 'I had trouble formatting suggestions — please try again.', items: [] }; }

      typing.innerHTML = Utils.esc(parsed.message || '');
      if (parsed.items && parsed.items.length) {
        const card = document.createElement('div');
        card.className = 'ai-suggestion-card';
        card.innerHTML = `<div class="sc-title">Suggested items — click + to add</div>` +
          parsed.items.map(it => {
            const safe = JSON.stringify(it).replace(/'/g, '&apos;').replace(/"/g, '&quot;');
            return `<div class="ai-sug-item">
              <span class="desc">${Utils.esc(it.desc)}</span>
              <span class="meta">${Utils.esc(it.unit || 'CUM')} &middot; ₹${Utils.fmt(it.rate || 0)}</span>
              <button class="add-btn" data-item='${safe}' onclick="PAGE._addAISugFromBtn(this)">+</button>
            </div>`;
          }).join('');
        typing.appendChild(card);
      }
    } catch (e) {
      typing.innerHTML = '⚠ Could not reach the AI. Check your connection.';
    } finally {
      btn.disabled = false;
      const area = document.getElementById('aiChatArea');
      area.scrollTop = 9999;
    }
  }

  function _addAISugFromBtn(btn) {
    try {
      const it = JSON.parse(btn.getAttribute('data-item').replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
      items.push({
        sno:  items.length + 1,
        desc: it.desc || '',
        unit: it.unit || 'CUM',
        qty:  Number(it.qty) || 0,
        rate: Number(it.rate) || 0,
        _amt: (Number(it.qty) || 0) * (Number(it.rate) || 0),
      });
      render();
      Utils.toast(`Added: ${it.desc.slice(0, 36)}…`, 'ok');
    } catch (e) {
      Utils.toast('Could not parse suggestion', 'err');
    }
  }

  function appendMsg(html, who) {
    const area = document.getElementById('aiChatArea');
    const div = document.createElement('div');
    div.className = 'ai-msg ' + (who === 'user' ? 'user' : 'bot');
    div.innerHTML = html;
    area.appendChild(div);
    area.scrollTop = 9999;
    return div;
  }

  /* ─── Save ─── */
  async function save() {
    const ap = window.STATE.activeProject;
    if (!ap) { Utils.toast('Select a project first', 'err'); return; }
    if (!items.length) { Utils.toast('Nothing to save', 'err'); return; }

    const btn = document.getElementById('saveBtn');
    btn.disabled = true; btn.textContent = 'Saving…';

    try {
      const ap = window.STATE.activeProject;
      if (!ap) { Utils.toast('Select a project first', 'err'); return; }
      const payload = {
        projectCode:  ap['Project Code'],
        projectUuid:  ap['UUID'] || ap['uuid'] || '',   // for CheckSum = Project.UUID
        rows: items.map((it, i) => ({
          uuid:     it.uuid || '',    // empty = new; backend generates
          checkSum: it.checkSum || '', // = Project.UUID; backend fills if empty
          sno:      i + 1,
          desc:     it.desc,
          unit:     it.unit,
          qty:      Number(it.qty)  || 0,
          rate:     Number(it.rate) || 0,
          amt:      (Number(it.qty) || 0) * (Number(it.rate) || 0),
        })),
      };
      const r = await API.scriptCall('saveBOQ', payload);
      if (r && r.success) {
        // Apply backend-assigned UUIDs so subsequent saves use them
        if (r.assignedRows && Array.isArray(r.assignedRows)) {
          r.assignedRows.forEach(a => {
            const item = items.find((it, idx) => idx === a.index || it.uuid === a.uuid);
            if (item && a.uuid) { item.uuid = a.uuid; item.checkSum = a.checkSum || item.checkSum; }
          });
        }
        Utils.toast(`Saved ${items.length} BOQ items`, 'ok');
        if (window.Shell && Shell.stampSaved) Shell.stampSaved();
      } else {
        Utils.toast((r && r.message) || 'Save failed', 'err');
      }
    } catch (e) {
      Utils.toast('Save error: ' + e.message, 'err');
    } finally {
      btn.disabled = false; btn.textContent = 'Save BOQ';
    }
  }

  function onProjectChange() { load(); }

  return {
    load, save, render,
    edit, removeRow, quickAdd, clearAll, filter,
    importCSV, exportCSV,
    askAI, _addAISugFromBtn,
    onProjectChange,
  };
})();
