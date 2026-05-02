/* ════════════════════════════════════════════════════════════════
   Step 1 · Project Setup
   - Sidebar: live project list from sheet
   - Master sheet: Site lookup auto-fills address, contacts, ICs, PAN/TAN/GST
   - Master sheet: Company dropdown from 1-BillingMaster
   - Employee Register: Site In-Charge and Reporting Manager dropdowns
═══════════════════════════════════════════════════════════════ */

window.PAGE = (function() {

  let allProjects = [];
  let companies   = [];   // [{name, pan, tan, gstSummary}]
  let sites       = [];   // [{name, code, addr1, addr2, city, state, pin, email, contact1, contact2, pan, tan, gst, siteIc, reportMgr, planIc, accIc}]
  let employees   = [];
  let gstRowIdx   = 0;

  // FIELD_MAP — sheet column to <input id>. Keep alphabetic-by-section.
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
    await Promise.all([
      loadProjects(),
      loadMasterCompanies(),
      loadMasterSites(),
      loadEmployees(),
    ]);

    const search = document.getElementById('plpSearch');
    if (search) search.addEventListener('input', Utils.debounce(e => filterList(e.target.value), 200));

    // When user types/changes Site Name, try to auto-fill from Master
    const siteInput = document.getElementById('f_siteName');
    if (siteInput) {
      // Replace the plain text input with a datalist-backed input for autocomplete
      siteInput.setAttribute('list', 'sitesDatalist');
      ensureDatalist();
      siteInput.addEventListener('change', onSiteSelected);
      siteInput.addEventListener('blur',   onSiteSelected);
    }

    addGSTRow();

    // Restore active project from header state if any
    const ap = window.STATE.activeProject;
    if (ap && ap['Project Code']) populateForm(ap);
  }

  function ensureDatalist() {
    let dl = document.getElementById('sitesDatalist');
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = 'sitesDatalist';
      document.body.appendChild(dl);
    }
    dl.innerHTML = sites.map(s =>
      `<option value="${Utils.esc(s.name)}">${Utils.esc(s.code || '')}</option>`
    ).join('');
  }

  // ─── Sheet loaders ─────────────────────────────────────────
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

  async function loadMasterCompanies() {
    const C = window.CONFIG;
    try {
      const data = await API.gviz(C.MASTER_TABS.BILLING, C.MASTER_SHEET_ID);
      companies = (data || [])
        .map(r => ({
          name: r['Billing Name'] || r['Company'] || r['Name'] || '',
          pan:  r['PAN'] || '',
          tan:  r['TAN'] || '',
          gst:  r['GST'] || '',
        }))
        .filter(c => c.name);
    } catch (e) {
      companies = [];
    }
    const sel = document.getElementById('f_company');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Select Company —</option>';
    companies.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.name;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
    // Auto-fill PAN/TAN on company select if blank
    sel.addEventListener('change', () => {
      const c = companies.find(x => x.name === sel.value);
      if (!c) return;
      const panEl = document.getElementById('f_pan');
      const tanEl = document.getElementById('f_tan');
      if (panEl && !panEl.value && c.pan) panEl.value = c.pan;
      if (tanEl && !tanEl.value && c.tan) tanEl.value = c.tan;
    });
  }

  async function loadMasterSites() {
    const C = window.CONFIG;
    try {
      const data = await API.gviz(C.MASTER_TABS.SITE, C.MASTER_SHEET_ID);
      // The site master uses these columns (from past sessions):
      // SITE_ID, SITE_NAME, PAN, TAN, GST, ADDR1, ADDR2, ADDR3, ADDRESS,
      // CITY, STATE, PIN, EMAIL, CONTACT1, CONTACT2, CONTACT3,
      // SITE_INCHARGE, REPORTING_MGR, PLANNING_IC, ACCOUNTS_IC, etc.
      sites = (data || [])
        .map(r => ({
          name:      r['Site Name'] || r['SiteName'] || r['Name'] || '',
          code:      r['Site ID']   || r['SiteID']   || r['Code'] || r['Series'] || '',
          pan:       r['PAN'] || '',
          tan:       r['TAN'] || '',
          gst:       r['GST'] || '',
          addr1:     r['Address Line 1'] || r['Addr1'] || r['Site Address Line 1'] || '',
          addr2:     r['Address Line 2'] || r['Addr2'] || r['Site Address Line 2'] || '',
          city:      r['City']  || '',
          state:     r['State'] || '',
          pin:       r['PIN Code'] || r['Pin Code'] || r['PIN'] || '',
          email:     r['Email'] || r['Email ID'] || '',
          contact1:  r['Contact 1'] || r['Contact1'] || r['Phone 1'] || '',
          contact2:  r['Contact 2'] || r['Contact2'] || r['Phone 2'] || '',
          siteIc:    r['Site In-Charge'] || r['Site Incharge'] || r['SiteInCharge'] || '',
          reportMgr: r['Reporting Manager'] || r['ReportingManager'] || '',
          planIc:    r['Planning In-Charge'] || r['Planning Incharge'] || '',
          accIc:     r['Accounts In-Charge'] || r['Accounts Incharge'] || '',
          status:    r['Status'] || r['Active/Inactive?'] || 'Active',
        }))
        .filter(s => s.name && /active/i.test(String(s.status || 'Active')));
      ensureDatalist();
    } catch (e) {
      console.warn('loadMasterSites', e.message);
      sites = [];
    }
  }

  async function loadEmployees() {
    const C = window.CONFIG;
    try {
      const data = await API.gviz(C.EMPLOYEE_TAB, C.EMPLOYEE_SHEET_ID);
      employees = (data || [])
        .map(r => ({
          code: r['Emp Code'] || r['EmpCode'] || r['Employee Code'] || r['Code'] || '',
          name: r['Name'] || r['Employee Name'] || r['Full Name'] || '',
        }))
        .filter(e => e.code || e.name);
    } catch (e) {
      employees = [];
    }
    ['f_siteIc', 'f_reportMgr'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      sel.innerHTML = '<option value="">— Select Employee —</option>';
      employees.forEach(emp => {
        const val = emp.code ? `${emp.code}|${emp.name}` : emp.name;
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = val;
        sel.appendChild(opt);
      });
    });
  }

  // ─── Site auto-fill ────────────────────────────────────────
  function onSiteSelected() {
    const inp = document.getElementById('f_siteName');
    if (!inp) return;
    const value = (inp.value || '').trim();
    if (!value) return;
    // Match by name (case-insensitive, exact)
    const s = sites.find(x => x.name.toLowerCase() === value.toLowerCase());
    if (!s) return;

    // Only fill blanks — don't overwrite if user has typed something
    setIfEmpty('f_siteCode', s.code);
    setIfEmpty('f_addr1',    s.addr1);
    setIfEmpty('f_addr2',    s.addr2);
    setIfEmpty('f_city',     s.city);
    setIfEmpty('f_state',    s.state);
    setIfEmpty('f_pin',      s.pin);
    setIfEmpty('f_email',    s.email);
    setIfEmpty('f_contact1', s.contact1);
    setIfEmpty('f_contact2', s.contact2);
    setIfEmpty('f_pan',      s.pan);
    setIfEmpty('f_tan',      s.tan);
    setIfEmpty('f_planIc',   s.planIc);
    setIfEmpty('f_accIc',    s.accIc);
    // Site IC and Reporting Manager — values may include the "code|name" format
    if (s.siteIc)    setSelectIfEmpty('f_siteIc',    s.siteIc);
    if (s.reportMgr) setSelectIfEmpty('f_reportMgr', s.reportMgr);

    Utils.toast(`Loaded site details: ${s.code || s.name}`, 'ok');
    // Normalize the input back to the canonical name
    inp.value = s.name;
  }

  function setIfEmpty(id, val) {
    const el = document.getElementById(id);
    if (!el || el.value || !val) return;
    el.value = val;
  }
  function setSelectIfEmpty(id, val) {
    const el = document.getElementById(id);
    if (!el || el.value || !val) return;
    // If the option doesn't exist yet, add it as a fallback
    const exists = Array.from(el.options).some(o => o.value === val);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val;
      el.appendChild(opt);
    }
    el.value = val;
  }

  // ─── List rendering ────────────────────────────────────────
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
    const d = new Date(v);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
    return '';
  }

  function newProject() {
    window.STATE.activeProject = null;
    if (window.persistState) window.persistState();
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
