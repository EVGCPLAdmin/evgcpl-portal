/* ════════════════════════════════════════════════════════════════
   Step 1 · Project Setup
   - Load project list into sidebar
   - Click row → populate form
   - Save → POST saveProjectSetup
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function() {

  let allProjects = [];
  let companies   = [];
  let employees   = [];
  let gstRowIdx   = 0;

  // Map sheet column → field id
  const FIELD_MAP = {
    'Project Code':           'f_projectCode',
    'Project Name':           'f_projectName',
    'Series':                 'f_series',
    'Private / Govt':         'f_privateGovt',
    'Domestic / Inte':        'f_domesticInt',
    'Awarded Date':           'f_awardedDate',
    'Contract Amount':        'f_contractAmount',
    'Currency':               'f_currency',
    'Start Date':             'f_startDate',
    'End Date':               'f_endDate',
    'Active/Inactive':        'f_active',
    'Company':                'f_company',
    'PAN':                    'f_pan',
    'TAN':                    'f_tan',
    'Site Name':              'f_siteName',
    'Site Code':              'f_siteCode',
    'Site Address Line 1':    'f_addr1',
    'Site Address Line 2':    'f_addr2',
    'City':                   'f_city',
    'State':                  'f_state',
    'Pin Code':               'f_pin',
    'Email ID':               'f_email',
    'Contact 1':              'f_contact1',
    'Contact 2':              'f_contact2',
    'Client Name':            'f_clientName',
    'Work Order Number':      'f_woNumber',
    'WO Date':                'f_woDate',
    'Client GST':             'f_clientGst',
    'Site In Charge Name':    'f_siteIc',
    'Reporting Manager Name': 'f_reportMgr',
    'Planning In-Charge':     'f_planIc',
    'Accounts In-Charge':     'f_accIc',
  };

  async function load() {
    await Promise.all([loadProjects(), loadCompanies(), loadEmployees()]);

    const search = document.getElementById('plpSearch');
    if (search) search.addEventListener('input', Utils.debounce(e => filterList(e.target.value), 200));

    addGSTRow();

    // Restore active project from header state if any
    const ap = window.STATE.activeProject;
    if (ap && ap['Project Code']) populateForm(ap);
  }

  async function loadProjects() {
    try {
      allProjects = await API.gviz(window.CONFIG.TABS.PROJECT);
      allProjects = allProjects.filter(p => p['Project Code']);
      renderList(allProjects);
    } catch (e) {
      console.error('loadProjects', e);
      const c = document.getElementById('projListContainer');
      if (c) c.innerHTML = '<div class="plp-empty">Could not load projects.<br>Check sheet sharing.</div>';
    }
  }

  async function loadCompanies() {
    try {
      // Pull from the master/Company tab if present
      const data = await API.gviz('Company', '1B2wb38KhNwlLoZnsAGWQkO0FdEGFFfsh3ycRRurigq4');
      companies = data.filter(c => c['Company'] || c['Name']);
    } catch (e) {
      companies = [];
    }
    const sel = document.getElementById('f_company');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Select Company —</option>';
    companies.forEach(c => {
      const name = c['Company'] || c['Name'] || '';
      if (!name) return;
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  }

  async function loadEmployees() {
    try {
      // Master employee register
      const data = await API.gviz('Employee', '1HWKZPhKRhcuvxBgyyN8zRt8p-SzYmKjJWiOdCgykBHs');
      employees = data.filter(e => e['Emp Code'] || e['Name']);
    } catch (e) {
      employees = [];
    }
    ['f_siteIc', 'f_reportMgr'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      sel.innerHTML = '<option value="">— Select Employee —</option>';
      employees.forEach(emp => {
        const code = emp['Emp Code'] || emp['Code'] || '';
        const name = emp['Name'] || emp['Employee Name'] || '';
        if (!code && !name) return;
        const val = code ? `${code}|${name}` : name;
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = val;
        sel.appendChild(opt);
      });
    });
  }

  function renderList(list) {
    const c = document.getElementById('projListContainer');
    if (!c) return;
    if (!list.length) {
      c.innerHTML = '<div class="plp-empty">No projects yet.<br>Click + New Project to add one.</div>';
      return;
    }
    const ap = window.STATE.activeProject;
    const apCode = ap ? ap['Project Code'] : null;
    c.innerHTML = list.map(p => {
      const code = Utils.esc(p['Project Code']);
      const name = Utils.esc(p['Project Name'] || '(no name)');
      const isActive = code === apCode;
      return `<div class="plp-row ${isActive ? 'active' : ''}" onclick="PAGE.selectProject('${code}')">
        <span class="plp-code">${code}</span>
        <span class="plp-name">${name}</span>
      </div>`;
    }).join('');
  }

  function filterList(q) {
    const ql = String(q || '').toLowerCase();
    const filtered = allProjects.filter(p =>
      String(p['Project Code'] || '').toLowerCase().includes(ql) ||
      String(p['Project Name'] || '').toLowerCase().includes(ql)
    );
    renderList(filtered);
  }

  function selectProject(code) {
    const p = allProjects.find(x => x['Project Code'] === code);
    if (!p) return;
    window.STATE.activeProject = p;
    window.STATE.months = Utils.genMonths(p['Start Date'], p['End Date']);
    if (window.persistState) window.persistState();
    populateForm(p);
    renderList(allProjects);
    // Refresh header pill
    const codeEl = document.querySelector('.proj-pill .pp-code');
    const nameEl = document.querySelector('.proj-pill .pp-name');
    if (codeEl) codeEl.textContent = p['Project Code'] || '—';
    if (nameEl) nameEl.textContent = p['Project Name'] || '(no name)';
    Utils.toast(`Loaded: ${p['Project Code']}`, 'ok');
  }

  function populateForm(p) {
    Object.keys(FIELD_MAP).forEach(col => {
      const el = document.getElementById(FIELD_MAP[col]);
      if (!el) return;
      let v = p[col];
      if (v == null) v = '';
      if (el.type === 'date') v = toDateInput(v);
      el.value = v;
    });

    // GST rows
    document.getElementById('gstBillingList').innerHTML = '';
    gstRowIdx = 0;
    const gstField = p['GST'] || p['GST Billing IDs'] || '';
    if (gstField) {
      String(gstField).split(/[|,;]/).forEach(g => {
        const t = g.trim();
        if (t) addGSTRow(t);
      });
    }
    if (!document.getElementById('gstBillingList').children.length) addGSTRow();
  }

  function toDateInput(v) {
    if (!v) return '';
    // try parsing common formats: "1-Jan-2025", ISO, "01/01/2025"
    const d = new Date(v);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
    return '';
  }

  function newProject() {
    window.STATE.activeProject = null;
    if (window.persistState) window.persistState();
    // Clear all fields
    Object.values(FIELD_MAP).forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('gstBillingList').innerHTML = '';
    addGSTRow();
    document.getElementById('f_active').value = 'Active';
    document.getElementById('f_currency').value = 'INR';
    renderList(allProjects);
    document.getElementById('f_projectName').focus();
    Utils.toast('Empty form ready — fill and Save', 'ok');
  }

  function addGSTRow(val) {
    const v = val || '';
    const idx = gstRowIdx++;
    const wrap = document.getElementById('gstBillingList');
    const div = document.createElement('div');
    div.className = 'multi-value-row';
    div.dataset.idx = idx;
    div.innerHTML = `
      <span class="tag-label">GST ${idx + 1}</span>
      <input type="text" class="gst-input" value="${Utils.esc(v)}" placeholder="22AAAAA0000A1Z5" maxlength="15" style="text-transform:uppercase" />
      <button class="btn-icon danger" onclick="PAGE.removeGSTRow(this)" title="Remove">&times;</button>
    `;
    wrap.appendChild(div);
  }

  function removeGSTRow(btn) {
    const row = btn.closest('.multi-value-row');
    if (row) row.remove();
    if (!document.getElementById('gstBillingList').children.length) addGSTRow();
  }

  function collectForm() {
    const data = {};
    Object.keys(FIELD_MAP).forEach(col => {
      const el = document.getElementById(FIELD_MAP[col]);
      data[col] = el ? el.value : '';
    });
    // Collect GSTs
    const gsts = Array.from(document.querySelectorAll('.gst-input'))
      .map(i => i.value.trim()).filter(Boolean);
    data['GST'] = gsts.join('|');
    return data;
  }

  async function save() {
    const data = collectForm();
    if (!data['Project Name']) {
      Utils.toast('Project Name is required', 'err');
      return;
    }
    const btn = document.getElementById('saveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const r = await API.scriptCall('saveProjectSetup', data);
      if (r && r.success) {
        Utils.toast('Project saved ✓', 'ok');
        // If new code returned, update form
        if (r.projectCode) {
          document.getElementById('f_projectCode').value = r.projectCode;
        }
        await loadProjects();
      } else {
        Utils.toast((r && r.message) || 'Save failed', 'err');
      }
    } catch (e) {
      Utils.toast('Save error: ' + e.message, 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Save Project'; }
    }
  }

  async function refreshList() {
    await loadProjects();
    Utils.toast(`Loaded ${allProjects.length} projects`, 'ok');
  }

  function onProjectChange() {
    const ap = window.STATE.activeProject;
    if (ap) populateForm(ap);
    renderList(allProjects);
  }

  return {
    load, save, refreshList, onProjectChange,
    selectProject, newProject,
    addGSTRow, removeGSTRow,
  };
})();
