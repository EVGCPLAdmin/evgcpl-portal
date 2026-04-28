/* ═══════════════════════════════════════════════════════════════════
   EVGCPL Portal — HR Module
   /assets/js/modules/hr.js
   Sub-routes via hash: #hr-dashboard, #my-profile, #my-team, ...
   ═══════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  // Map current hash to active top-level route group ("hr-dashboard")
  const subRoute = (location.hash || '#hr-dashboard').slice(1);
  Shell.mount(subRoute);

  // Page head depends on sub-route
  const HEADS = {
    'hr-dashboard': { title:'HR Dashboard',  sub:'Headcount, attrition, joiners and leavers across all sites' },
    'my-profile':   { title:'My Profile',    sub:'Your details, leave balance, payslips and documents' },
    'my-team':      { title:'My Team',       sub:'People reporting to you' },
    'onboarding':   { title:'Onboarding',    sub:'New joiner status and checklist' },
    'policies':     { title:'Policies Hub',  sub:'Company policies, handbooks and forms' },
  };

  function renderHead() {
    const r = (location.hash || '#hr-dashboard').slice(1);
    const h = HEADS[r] || HEADS['hr-dashboard'];
    document.getElementById('pageHead').innerHTML = Shell.pageHead({
      crumbs: [
        { label:'Home', href:'dashboard.html' },
        { label:'HR & People', href:'hr.html' },
        { label: h.title },
      ],
      title: h.title,
      sub:   h.sub,
    });
    // tab active state
    document.querySelectorAll('.hr-tab').forEach(a => {
      a.classList.toggle('active', a.dataset.route === r);
    });
  }


  function render() {
    const r = (location.hash || '#hr-dashboard').slice(1);
    renderHead();
    const root = document.getElementById('hrContent');
    if (r === 'hr-dashboard')   return renderHRDashboard(root);
    if (r === 'my-profile')     return renderMyProfile(root);
    if (r === 'my-team')        return renderMyTeam(root);
    if (r === 'onboarding')     return renderOnboarding(root);
    if (r === 'policies')       return renderPolicies(root);
    root.innerHTML = '<div class="text-muted">Section not found.</div>';
  }


  /* ──── HR Dashboard ──── */
  function renderHRDashboard(root) {
    root.innerHTML = `
      <section class="kpi-grid" id="hrKPIs">
        <div class="kpi"><div class="skel" style="height:80px"></div></div>
        <div class="kpi"><div class="skel" style="height:80px"></div></div>
        <div class="kpi"><div class="skel" style="height:80px"></div></div>
        <div class="kpi"><div class="skel" style="height:80px"></div></div>
      </section>
      <section style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.4rem">
        <div class="card">
          <div class="card-head"><h3>Department breakup</h3></div>
          <div class="card-body" id="hrDept"><div class="skel" style="height:140px"></div></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Designation breakup</h3></div>
          <div class="card-body" id="hrDesig"><div class="skel" style="height:140px"></div></div>
        </div>
      </section>
      <div id="errorSlot"></div>
    `;

    API.fetchSheet('Master', "SELECT A,C,M,N,P,X", API.SHEETS.EMPLOYEE)
      .then(emps => {
        const active = emps.filter(e => /Active/i.test(e['Employee Status'] || e['Status'] || 'Active'));
        const male   = active.filter(e => /male/i.test(e['Gender'] || e['X'] || '')).length;
        const female = active.filter(e => /female/i.test(e['Gender'] || e['X'] || '')).length;

        document.getElementById('hrKPIs').innerHTML = `
          ${kpi({ icon:'green',  glyph:'⚇', val:active.length, label:'Total active', status:'live' })}
          ${kpi({ icon:'blue',   glyph:'♂', val:male,  label:'Male' })}
          ${kpi({ icon:'orange', glyph:'♀', val:female, label:'Female' })}
          ${kpi({ icon:'gold',   glyph:'＋', val:'—',  label:'Joining this month', status:'warn' })}
        `;

        renderBreakup('hrDept',  active, e => e['Department']  || e['M'] || 'Unspecified');
        renderBreakup('hrDesig', active, e => e['Designation'] || e['N'] || 'Unspecified');
      })
      .catch(err => API.renderSheetError(err, 'errorSlot'));
  }

  function renderBreakup(id, rows, keyFn) {
    const counts = {};
    rows.forEach(r => { const k = keyFn(r); counts[k] = (counts[k] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0, 10);
    const max = sorted[0]?.[1] || 1;
    document.getElementById(id).innerHTML = sorted.map(([k, n]) => `
      <div style="margin-bottom:.7rem">
        <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:.2rem">
          <span style="color:var(--txt2);font-weight:500">${Shell.escapeHtml(k)}</span>
          <span class="num" style="color:var(--txt3)">${n}</span>
        </div>
        <div style="height:5px;border-radius:99px;background:var(--surface2);overflow:hidden">
          <div style="height:100%;width:${(n/max)*100}%;background:linear-gradient(90deg, var(--g4), var(--g6));border-radius:99px"></div>
        </div>
      </div>
    `).join('');
  }


  /* ──── My Profile ────
     Email-keyed lookup against `hr.employees`. Renders gradient hero
     banner, quick-stats grid, leave + payslips two-column row, mess
     card (if matched), and live Documents grid via Apps Script
     `listHRDocs` action keyed off the UUID lookup tab.
  */
  // HR document type catalogue — folder name on Drive maps to display.
  const HR_DOCS_TYPES = [
    { folder:'Photo',                 label:'Photo',             icon:'📸' },
    { folder:'OfferLetter',           label:'Offer Letter',      icon:'📄' },
    { folder:'AppoitmentOrder',       label:'Appointment Order', icon:'📋' },
    { folder:'SalaryBreakUp',         label:'Salary Breakup',    icon:'💰' },
    { folder:'BankProof',             label:'Bank Proof',        icon:'🏦' },
    { folder:'Aadhar',                label:'Aadhar Card',       icon:'🪪' },
    { folder:'UAN',                   label:'UAN Card',          icon:'🔵' },
    { folder:'Onboarding Documents',  label:'Onboarding Docs',   icon:'📁' },
  ];
  const HR_DOCS_FOLDER_ID = '1I1ESOw_0EncSMt3nLZV2P7I106aniLY-';

  // Cache the employee fetch so My Profile + My Team reuse one round-trip
  let _hrEmpCache = null;
  function getEmployees() {
    if (_hrEmpCache) return Promise.resolve(_hrEmpCache);
    return API.fetchByBinding('hr.employees').then(rows => {
      _hrEmpCache = rows.map(r => normEmployee(r)).filter(u => u.empCode || u.name);
      return _hrEmpCache;
    });
  }

  // Normalise a raw Employee Register row to the shape used everywhere
  function normEmployee(r) {
    const empStatus = (r['Employee Status'] || '').trim().toUpperCase();
    const reportingMgr = r['Reporting Manager'] || '';
    const siteIC       = r['Site In-Charge Name'] || '';
    return {
      empCode:    r['EMP CODE']      || r['New Employee Code'] || '',
      name:       r['Employee Name'] || '',
      email:      (r['Mail ID']      || '').trim(),
      dept:       r['Department']    || '',
      desig:      r['DESIGNATION']   || '',
      grade:      r['Grade']         || '',
      empType:    r['Employee Type'] || '',
      site:       r['Site Name']     || '',
      payroll:    r['PayRoll']       || '',
      doj:        r['DOJ MM/DD/YYYY'] || r['DOJ'] || '',
      expEG:      r['Year of Experience in Evergreen till current date'] || '',
      expTotal:   r['TOTAL YEAR EXPERIENCE'] || '',
      plEligible: r['PL Eligible?']  || '',
      plBalance:  r['PL Avalable as of Today'] || r['PL Available as of Today'] || '',
      role:       r['Role (User Type)'] || '',
      empStatus,
      siteIC:      siteIC.replace(/^EG\w+\|/i, '').trim(),
      siteICCode: (siteIC.match(/^(EG\w+)\|/i) || [])[1]?.toUpperCase() || '',
      manager:     reportingMgr.replace(/^EG\w+\|/i, '').trim(),
      managerCode:(reportingMgr.match(/^(EG\w+)\|/i) || [])[1]?.toUpperCase() || reportingMgr.trim().toUpperCase(),
      // Status: ONLY 'CURRENT' = active per legacy code
      status:    empStatus === 'CURRENT' ? 'ACTIVE' : 'INACTIVE',
    };
  }

  function fmtIndDate(v) {
    if (!v) return '—';
    let d;
    if (typeof v === 'string' && v.startsWith('Date(')) {
      try {
        const p = v.replace('Date(','').replace(')','').split(',').map(Number);
        d = new Date(p[0], p[1], p[2]);
      } catch (_) { return '—'; }
    } else {
      d = new Date(v);
    }
    if (!d || isNaN(d.getTime()) || d.getTime() === 0) return '—';
    return d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
  }

  function renderMyProfile(root) {
    const u = STATE.get('user') || {};
    const myEmail = (u.email || '').toLowerCase();

    if (!myEmail) {
      root.innerHTML = `
        <div class="alert warn">
          <span class="alert-icon">⚠</span>
          <span class="alert-body">Sign in with Google to view your profile.</span>
        </div>`;
      return;
    }

    root.innerHTML = `
      <div id="profileShell">
        <div class="card card-pad">
          <div class="skel" style="height:160px;border-radius:var(--rad-lg)"></div>
        </div>
      </div>
      <div id="errorSlot"></div>
    `;

    getEmployees().then(emps => {
      const emp = emps.find(e => e.email && e.email.toLowerCase() === myEmail);

      if (!emp) {
        root.innerHTML = `
          <div class="alert warn">
            <span class="alert-icon">⚠</span>
            <div class="alert-body">
              <b>No employee record found.</b><br/>
              Your login email <code>${Shell.escapeHtml(myEmail)}</code> doesn't match any "Mail ID" entry in the Employee Register. Contact HR if you believe this is incorrect.
            </div>
          </div>`;
        return;
      }

      const photoKey = `evg_photo_${emp.empCode || 'demo'}`;
      const savedPhoto = (() => {
        try { return localStorage.getItem(photoKey); } catch (_) { return null; }
      })();
      const avatarContent = savedPhoto
        ? `<img src="${Shell.escapeHtml(savedPhoto)}" alt="Profile photo"/>`
        : `<span>${Shell.escapeHtml((emp.name || '?').charAt(0).toUpperCase())}</span>`;

      // Build hero + body
      document.getElementById('profileShell').innerHTML = `
        <div class="profile-hero">
          <div class="profile-hero-banner"></div>
          <div class="profile-hero-body">
            <div class="profile-avatar-wrap">
              <div class="profile-avatar" id="profileAvatarEl">${avatarContent}</div>
              <label class="profile-upload-btn" title="Change photo">
                📷<input type="file" accept="image/*" style="display:none" id="profilePhotoInput"/>
              </label>
            </div>
            <div style="flex:1;min-width:0;padding-top:.4rem">
              <div style="color:#fff;font-family:'DM Serif Display',serif;font-size:1.4rem;line-height:1.2">${Shell.escapeHtml(emp.name || u.name || 'Employee')}</div>
              <div style="color:rgba(255,255,255,.7);font-size:.84rem;margin:.2rem 0 .55rem">${Shell.escapeHtml(emp.desig || '—')} &nbsp;·&nbsp; ${Shell.escapeHtml(emp.dept || 'Evergreen Enterprises')}</div>
              <div style="display:flex;flex-wrap:wrap;gap:.35rem">
                ${emp.empCode ? `<span class="profile-pill mono">${Shell.escapeHtml(emp.empCode)}</span>` : ''}
                ${emp.grade   ? `<span class="profile-pill">Grade ${Shell.escapeHtml(emp.grade)}</span>` : ''}
                ${emp.empType ? `<span class="profile-pill">${Shell.escapeHtml(emp.empType)}</span>` : ''}
                ${emp.site    ? `<span class="profile-pill">📍 ${Shell.escapeHtml(emp.site)}</span>` : ''}
                ${emp.role    ? `<span class="profile-pill">🛡 ${Shell.escapeHtml(emp.role)}</span>` : ''}
              </div>
            </div>
            <div style="text-align:right;padding-top:.4rem;flex-shrink:0">
              <div style="color:rgba(255,255,255,.7);font-size:.78rem">${Shell.escapeHtml(emp.email || u.email || '')}</div>
              <div style="color:rgba(255,255,255,.5);font-size:.72rem;margin-top:.25rem">Joined ${fmtIndDate(emp.doj)}</div>
              ${emp.plBalance ? `<div style="margin-top:.45rem;font-size:.72rem;background:rgba(255,255,255,.12);color:#fff;padding:.2rem .6rem;border-radius:8px;display:inline-block">🌴 ${Shell.escapeHtml(emp.plBalance)} PL days</div>` : ''}
            </div>
          </div>
        </div>

        <!-- Quick stats -->
        <div class="info-grid-3" style="margin-bottom:1.4rem">
          ${[
            ['🏢', 'Department',     emp.dept || '—'],
            ['🎯', 'Designation',    emp.desig || '—'],
            ['📊', 'Grade',          emp.grade || '—'],
            ['⏱',  'EG Experience',  (emp.expEG || emp.expTotal) ? `${emp.expEG || emp.expTotal} yrs` : '—'],
            ['📅', 'Date of Joining', fmtIndDate(emp.doj)],
            ['💼', 'Employee Type',  emp.empType || '—'],
          ].map(([icon, label, val]) => `
            <div class="info-card">
              <div class="ic-label">${icon} ${Shell.escapeHtml(label)}</div>
              <div class="ic-value">${Shell.escapeHtml(val)}</div>
            </div>`).join('')}
        </div>

        <!-- Two-column: Leave + Payslips -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.2rem;margin-bottom:1.4rem">
          <div class="card">
            <div class="card-head"><h3>🌴 Leave balance</h3></div>
            <div class="card-body">
              <div style="display:flex;flex-direction:column;gap:.55rem">
                <div style="display:flex;justify-content:space-between;align-items:center;padding:.55rem .8rem;background:var(--surface2);border-radius:8px">
                  <span style="font-size:.82rem;color:var(--txt2)">PL Eligible?</span>
                  <span style="font-weight:700;font-size:.85rem">${Shell.escapeHtml(emp.plEligible || '—')}</span>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;padding:.55rem .8rem;background:rgba(46,125,50,.08);border-radius:8px">
                  <span style="font-size:.82rem;color:#15803d">PL Available Today</span>
                  <span style="font-weight:700;font-size:1.1rem;color:#15803d">${Shell.escapeHtml(emp.plBalance || '—')}</span>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;padding:.55rem .8rem;background:var(--surface2);border-radius:8px">
                  <span style="font-size:.82rem;color:var(--txt2)">Payroll</span>
                  <span style="font-weight:600;font-size:.85rem">${Shell.escapeHtml(emp.payroll || '—')}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-head">
              <h3>💰 Pay slips</h3>
              <span class="tag">Phase 3</span>
            </div>
            <div class="card-body">
              ${[(_recentMonth(0)), (_recentMonth(-1)), (_recentMonth(-2))].map(m => `
                <div class="payslip-row">
                  <div style="font-size:.82rem;font-weight:600">${Shell.escapeHtml(m)}</div>
                  <button class="btn btn-secondary btn-sm" disabled style="opacity:.5">⬇ PDF</button>
                </div>`).join('')}
              <div style="font-size:.72rem;color:var(--txt3);margin-top:.5rem">Live in Phase 3 · Payroll integration pending.</div>
            </div>
          </div>
        </div>

        <!-- Mess (loaded async) -->
        <div id="profileMessSlot"></div>

        <!-- Documents -->
        <div class="card" id="profileDocsCard" style="margin-bottom:1.4rem">
          <div class="card-head">
            <h3>📂 My documents</h3>
            <span class="tag" id="profileDocsBadge">—</span>
          </div>
          <div class="card-body">
            <div id="profileDocsStatus" style="font-size:.82rem;color:var(--txt3);padding:.2rem 0 .8rem">
              ⏳ Looking up your employee record…
            </div>
            <div id="profileDocsGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.7rem"></div>
          </div>
        </div>
      `;

      // Photo upload handler — saves base64 to localStorage (legacy parity)
      const photoInput = document.getElementById('profilePhotoInput');
      if (photoInput) {
        photoInput.addEventListener('change', e => {
          const f = e.target.files && e.target.files[0];
          if (!f) return;
          const reader = new FileReader();
          reader.onload = () => {
            try {
              localStorage.setItem(photoKey, reader.result);
              document.getElementById('profileAvatarEl').innerHTML =
                `<img src="${Shell.escapeHtml(reader.result)}" alt="Profile photo"/>`;
              Shell.toast('Photo updated', 'success');
            } catch (err) {
              Shell.toast('Could not save photo (storage full?)', 'warn');
            }
          };
          reader.readAsDataURL(f);
        });
      }

      // Mess card (best-effort)
      loadMessCard(emp);

      // Documents grid
      loadProfileDocs(emp);
    }).catch(err => {
      if (err && err.name === 'SheetError') API.renderSheetError(err, 'errorSlot');
      else document.getElementById('errorSlot').innerHTML =
        `<div class="alert danger"><span class="alert-icon">⚠</span><div class="alert-body">Could not load employees: ${Shell.escapeHtml(err && err.message || 'unknown')}</div></div>`;
    });
  }

  function _recentMonth(offset) {
    const d = new Date();
    d.setMonth(d.getMonth() + offset);
    return d.toLocaleDateString('en-IN', { month:'short', year:'numeric' });
  }

  function loadMessCard(emp) {
    const slot = document.getElementById('profileMessSlot');
    if (!slot || !emp.empCode) return;
    API.fetchByBinding('hr.mess').then(rows => {
      const me = rows.find(r =>
        (r['EMP CODE'] || r['Emp Code'] || r['empCode'] || r['A'] || '').toString().trim().toUpperCase() === emp.empCode.toUpperCase()
      );
      if (!me) return; // silent — not everyone has mess data
      slot.innerHTML = `
        <div class="card" style="margin-bottom:1.4rem">
          <div class="card-head">
            <h3>🏠 Mess &amp; accommodation</h3>
            <span class="tag green">Live from register</span>
          </div>
          <div class="card-body">
            <div class="info-grid-3">
              ${[
                ['Accommodation',         me['Accommodation']       || me['Accommodation Type'] || '—'],
                ['Mess Type',             me['Mess Details']        || me['Mess Type']         || '—'],
                ['Assigned Site',         me['Site Name']           || me['Site']              || '—'],
                ['Per Day Food Allowance',(me['Per Day Food']       || me['Per Day Food Allowance']) ? '₹' + (me['Per Day Food'] || me['Per Day Food Allowance']) : '—'],
                ['Special Site Allowance',me['Special Site Allowance'] || '—'],
                ['Effective From',        fmtIndDate(me['From Date'] || me['Effective From'] || '')],
              ].map(([l, v]) => `
                <div class="info-card">
                  <div class="ic-label">${Shell.escapeHtml(l)}</div>
                  <div class="ic-value">${Shell.escapeHtml(v)}</div>
                </div>`).join('')}
            </div>
          </div>
        </div>`;
    }).catch(() => { /* silent — mess tab is optional */ });
  }

  async function loadProfileDocs(emp) {
    const grid    = document.getElementById('profileDocsGrid');
    const status  = document.getElementById('profileDocsStatus');
    const badgeEl = document.getElementById('profileDocsBadge');
    if (!grid || !status) return;

    status.innerHTML = '⏳ Looking up your UUID…';

    let uuid = null;
    try {
      const rows = await API.fetchByBinding('hr.personalDetails');
      const myEmail = (emp.email || '').toLowerCase().trim();
      const hit = rows.find(r => {
        const e = (r['Mail ID'] || r['F'] || '').toString().trim().toLowerCase();
        return e && e === myEmail;
      });
      uuid = hit && (hit['UUID'] || hit['A']);
    } catch (e) {
      status.innerHTML = `<span style="color:#b91c1c">⚠ UUID lookup failed: ${Shell.escapeHtml(e.message || 'unknown')}</span>`;
      return;
    }

    if (!uuid) {
      status.innerHTML = `
        <span style="color:#b91c1c">⚠ No UUID found for <b>${Shell.escapeHtml(emp.email || '')}</b>.</span>
        <span style="color:var(--txt3)">Employee record exists (${Shell.escapeHtml(emp.empCode || '—')}) but the <code>0A_EmployeePersonalDetails</code> tab may not have this email yet. Contact HR.</span>`;
      return;
    }

    status.innerHTML = `<span style="color:var(--g7)">✓ UUID <code>${Shell.escapeHtml(uuid)}</code> · loading documents…</span>`;

    // Skeleton cards
    grid.innerHTML = HR_DOCS_TYPES.map(t => `
      <div class="doc-card empty" id="dc-${cssId(t.folder)}">
        <span class="doc-icon">${t.icon}</span>
        <div class="doc-info">
          <div class="doc-label">${Shell.escapeHtml(t.label)}</div>
          <div class="doc-meta">⏳ Checking…</div>
        </div>
      </div>`).join('');

    // Fire all type lookups in parallel
    let uploaded = 0;
    await Promise.all(HR_DOCS_TYPES.map(async (t) => {
      const card = document.getElementById('dc-' + cssId(t.folder));
      if (!card) return;
      try {
        const url = `${API.APPS_SCRIPT_URL}?action=listHRDocs&folderId=${HR_DOCS_FOLDER_ID}&subFolder=${encodeURIComponent(t.folder)}&prefix=${encodeURIComponent(uuid)}`;
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        const files = (data && data.files) || [];
        if (files.length) {
          uploaded++;
          const f = files[0];
          card.classList.remove('empty');
          card.classList.add('uploaded');
          card.innerHTML = `
            <span class="doc-icon">${t.icon}</span>
            <div class="doc-info">
              <div class="doc-label">${Shell.escapeHtml(t.label)}</div>
              <div class="doc-meta">${files.length} file${files.length===1?'':'s'} · <a href="${Shell.escapeHtml(f.url || f.webViewLink || '#')}" target="_blank" rel="noopener">Open ↗</a></div>
            </div>`;
        } else {
          card.querySelector('.doc-meta').innerHTML = '<span style="color:var(--txt3)">Not uploaded</span>';
        }
      } catch (_) {
        card.querySelector('.doc-meta').innerHTML = '<span style="color:#b91c1c">Lookup failed</span>';
      }
    }));

    badgeEl.textContent = `${uploaded}/${HR_DOCS_TYPES.length} uploaded`;
    status.innerHTML = `<span style="color:var(--g7)">✓ ${uploaded}/${HR_DOCS_TYPES.length} document categories on record</span>`;
  }
  function cssId(s) { return String(s).replace(/[^a-z0-9]/gi, '_'); }


  /* ──── My Team ────
     Match logic per user memory: managerCode === myEmpCode (primary)
     OR siteICCode === myEmpCode (secondary), with name fallback for
     legacy rows missing the EG-prefix.
  */
  function renderMyTeam(root) {
    const u = STATE.get('user') || {};
    const myEmail = (u.email || '').toLowerCase();

    root.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>👥 People reporting to you</h3></div>
        <div class="card-body" id="teamShell">
          <div class="skel" style="height:140px"></div>
        </div>
      </div>
      <div id="errorSlot"></div>`;

    getEmployees().then(emps => {
      const me = emps.find(e => e.email && e.email.toLowerCase() === myEmail);
      const shell = document.getElementById('teamShell');

      if (!me) {
        shell.innerHTML = `<div style="text-align:center;color:var(--txt3);font-size:.84rem;padding:1.5rem">
          No employee record found for your login email <code>${Shell.escapeHtml(myEmail)}</code>.<br/>
          <span style="font-size:.76rem">Sign in with the email registered in the Employee Register, or contact HR.</span>
        </div>`;
        return;
      }

      const myCode = (me.empCode || '').toUpperCase().trim();
      const myName = (me.name || '').toLowerCase().trim();

      const reportees = emps.filter(emp => {
        if (emp.status !== 'ACTIVE') return false;
        if (emp.empCode && emp.empCode === me.empCode) return false; // exclude self
        const mCode = (emp.managerCode || '').toUpperCase().trim();
        const sCode = (emp.siteICCode  || '').toUpperCase().trim();
        const mName = (emp.manager     || '').toLowerCase().trim();
        return (myCode && (mCode === myCode || sCode === myCode))
            || (myName && mName === myName);
      });

      const debugLine = `
        <div style="font-size:.72rem;color:var(--txt3);margin-bottom:.7rem">
          Matching against your empCode <code>${Shell.escapeHtml(myCode || '—')}</code>
          (manager) or site in-charge code. Total active employees scanned: ${emps.filter(e=>e.status==='ACTIVE').length}.
        </div>`;

      if (!reportees.length) {
        shell.innerHTML = `${debugLine}
          <div style="text-align:center;color:var(--txt3);font-size:.84rem;padding:1rem">
            No direct reportees found.<br/>
            <span style="font-size:.76rem">Check that your empCode appears in the <code>Reporting Manager</code> column of others' rows in the Employee Register, prefixed with <code>EG</code>.</span>
          </div>`;
        return;
      }

      // Group by site for a quick visual breakdown
      const bySite = {};
      reportees.forEach(r => {
        const k = r.site || 'Unassigned';
        bySite[k] = (bySite[k] || 0) + 1;
      });
      const siteSummary = Object.entries(bySite).sort((a,b) => b[1]-a[1])
        .map(([s, n]) => `<span class="tag">${Shell.escapeHtml(s)}: ${n}</span>`).join(' ');

      shell.innerHTML = `
        ${debugLine}
        <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:.85rem">
          <span style="font-size:.84rem;color:var(--txt2)"><b>${reportees.length}</b> direct reportee${reportees.length === 1 ? '' : 's'}</span>
          ${siteSummary}
          <button class="btn btn-secondary btn-sm" id="teamCsv" style="margin-left:auto">⬇ CSV</button>
        </div>
        <div style="overflow-x:auto">
          <table class="tbl" style="min-width:680px">
            <thead>
              <tr>
                <th>Name</th><th>Emp Code</th><th>Designation</th>
                <th>Department</th><th>Site</th><th>Type</th>
              </tr>
            </thead>
            <tbody>
              ${reportees.sort((a,b) => (a.name || '').localeCompare(b.name || '')).map(r => `
                <tr>
                  <td style="font-weight:600">${Shell.escapeHtml(r.name || '—')}</td>
                  <td style="font-family:'DM Mono',monospace;font-size:.74rem;color:var(--txt3)">${Shell.escapeHtml(r.empCode || '—')}</td>
                  <td style="font-size:.82rem">${Shell.escapeHtml(r.desig || '—')}</td>
                  <td style="font-size:.82rem">${Shell.escapeHtml(r.dept || '—')}</td>
                  <td style="font-size:.82rem">${Shell.escapeHtml(r.site || '—')}</td>
                  <td><span class="tag" style="background:rgba(46,125,50,.12);color:#15803d">${Shell.escapeHtml(r.empType || '—')}</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;

      document.getElementById('teamCsv').addEventListener('click', () => {
        const cols = ['Emp Code','Name','Designation','Department','Site','Type'];
        const rows = reportees.map(r => ({
          'Emp Code': r.empCode, 'Name': r.name, 'Designation': r.desig,
          'Department': r.dept, 'Site': r.site, 'Type': r.empType,
        }));
        const lines = [cols.join(',')];
        rows.forEach(rr => lines.push(cols.map(c => {
          const v = rr[c] == null ? '' : String(rr[c]);
          return /[",\n]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v;
        }).join(',')));
        const blob = new Blob([lines.join('\n')], { type:'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `My_Team_${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
      });
    }).catch(err => {
      if (err && err.name === 'SheetError') API.renderSheetError(err, 'errorSlot');
      else document.getElementById('teamShell').innerHTML =
        `<div class="alert danger"><span class="alert-icon">⚠</span><div class="alert-body">Could not load employees: ${Shell.escapeHtml(err && err.message || 'unknown')}</div></div>`;
    });
  }

  /* ──── Onboarding (placeholder) ──── */
  /* ──── Onboarding portal ────
     Track new joiner onboarding (12 standard steps) for everyone who
     joined in the last 90 days. State source-of-truth:
       1. OnboardingChecklist sheet (loaded once, latest-wins per emp+step)
       2. sessionStorage (instant local cache, prevents flicker)
     Toggling a step writes a row to the sheet via Apps Script appendRow.
  */
  const OB_STEPS = [
    { id:'offer',      icon:'📄', label:'Offer letter issued',           dept:'HR' },
    { id:'id_card',    icon:'🪪', label:'Employee ID card created',      dept:'HR' },
    { id:'email',      icon:'📧', label:'Work email setup',              dept:'IT' },
    { id:'bank',       icon:'🏦', label:'Bank details collected',        dept:'Accounts' },
    { id:'pf',         icon:'📑', label:'PF / ESI enrolment',            dept:'HR' },
    { id:'medical',    icon:'🏥', label:'Medical insurance added',       dept:'HR' },
    { id:'induction',  icon:'🎓', label:'Induction completed',           dept:'HR' },
    { id:'site_brief', icon:'🏗️', label:'Site briefing done',            dept:'Site Manager' },
    { id:'ppe',        icon:'🦺', label:'PPE kit issued',                dept:'Safety' },
    { id:'access',     icon:'🔑', label:'System / portal access',        dept:'IT' },
    { id:'document',   icon:'📂', label:'Documents collected (ID/PAN/Aadhar)', dept:'HR' },
    { id:'exit',       icon:'✅', label:'Onboarding complete',           dept:'HR' },
  ];
  const OB_DEPT_COL = {
    'HR':           '#15803d',
    'IT':           '#1565c0',
    'Accounts':     '#6a1b9a',
    'Site Manager': '#bf6700',
    'Safety':       '#b91c1c',
  };
  const OB_PERIOD_DAYS = 90;
  const OB_LOCAL_KEY = (eid) => 'evgcpl_ob_' + eid;
  let _obJoiners = [];
  let _obOpenEid = null;
  let _obSiteFilter = '';
  let _obStatusFilter = ''; // '' | complete | inprogress | notstarted

  function obGetChecks(eid) {
    try { return JSON.parse(sessionStorage.getItem(OB_LOCAL_KEY(eid)) || '{}'); }
    catch (_) { return {}; }
  }
  function obSetCheck(eid, stepId, val) {
    const c = obGetChecks(eid);
    c[stepId] = !!val;
    sessionStorage.setItem(OB_LOCAL_KEY(eid), JSON.stringify(c));
  }

  function renderOnboarding(root) {
    root.innerHTML = `
      <section class="kpi-grid" id="obKPIs" style="margin-bottom:1rem">
        <div class="kpi"><div class="skel" style="height:80px"></div></div>
        <div class="kpi"><div class="skel" style="height:80px"></div></div>
        <div class="kpi"><div class="skel" style="height:80px"></div></div>
        <div class="kpi"><div class="skel" style="height:80px"></div></div>
      </section>

      <div id="errorSlot"></div>

      <div class="card" style="margin-bottom:1rem">
        <div class="card-body" style="padding:.7rem 1rem">
          <div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:flex-end">
            <div style="display:flex;flex-direction:column;gap:.25rem">
              <label style="font-size:.66rem;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.05em">Site</label>
              <select id="obSiteSel" style="padding:.4rem .6rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);font-family:inherit;font-size:.78rem;color:var(--txt);min-width:160px"><option value="">All sites</option></select>
            </div>
            <div style="display:flex;flex-direction:column;gap:.25rem">
              <label style="font-size:.66rem;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.05em">Status</label>
              <div style="display:flex;gap:4px">
                <button class="btn btn-sm ob-stat-btn active" data-stat="">All</button>
                <button class="btn btn-sm ob-stat-btn" data-stat="complete">✓ Complete</button>
                <button class="btn btn-sm ob-stat-btn" data-stat="inprogress">In progress</button>
                <button class="btn btn-sm ob-stat-btn" data-stat="notstarted">Not started</button>
              </div>
            </div>
            <div id="obCount" style="margin-left:auto;font-size:.78rem;color:var(--txt3);align-self:center"></div>
          </div>
        </div>
      </div>

      <div id="obList" style="margin-bottom:1.2rem">
        <div class="skel" style="height:160px"></div>
      </div>

      <div id="obEmpty" style="display:none;background:rgba(46,125,50,.06);border-radius:var(--rad);padding:2.4rem;text-align:center;color:var(--g8)">
        <div style="font-size:2.2rem;margin-bottom:.4rem">🎉</div>
        <div style="font-weight:700">No new joiners in the last ${OB_PERIOD_DAYS} days</div>
        <div style="font-size:.82rem;color:var(--txt3);margin-top:.3rem">New employees will appear here automatically.</div>
      </div>

      <!-- Modal -->
      <div id="obModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;align-items:center;justify-content:center;padding:1rem">
        <div style="background:var(--surface);border-radius:16px;width:100%;max-width:560px;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3)">
          <div style="background:linear-gradient(135deg,var(--g9),var(--g7));padding:1.1rem 1.4rem;color:#fff;display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:.7rem;opacity:.7;text-transform:uppercase;letter-spacing:.08em">Onboarding checklist</div>
              <div id="obModalName" style="font-size:1.1rem;font-weight:700"></div>
              <div id="obModalMeta" style="font-size:.74rem;opacity:.85;margin-top:.15rem"></div>
            </div>
            <button id="obModalClose" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:1.05rem;display:flex;align-items:center;justify-content:center">✕</button>
          </div>
          <div style="padding:.9rem 1.4rem;border-bottom:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem">
              <span style="font-size:.8rem;color:var(--txt2)" id="obProgLabel">0 of ${OB_STEPS.length} steps complete</span>
              <span style="font-size:.8rem;font-weight:700;color:var(--g7)" id="obProgPct">0%</span>
            </div>
            <div style="background:var(--surface3);border-radius:99px;height:8px;overflow:hidden">
              <div id="obProgBar" style="height:100%;background:var(--g6);border-radius:99px;transition:width .4s ease-out;width:0%"></div>
            </div>
          </div>
          <div id="obStepsList" style="overflow-y:auto;flex:1;padding:.4rem 1rem"></div>
          <div style="padding:.85rem 1.4rem;border-top:1px solid var(--border);display:flex;gap:.6rem;justify-content:flex-end">
            <button id="obModalCloseBtn" class="btn btn-secondary btn-sm">Close</button>
            <button id="obMarkAll" class="btn btn-primary btn-sm">Mark all complete ✓</button>
          </div>
        </div>
      </div>
    `;

    // Inject styles only once
    if (!document.getElementById('obStyles')) {
      const s = document.createElement('style');
      s.id = 'obStyles';
      s.textContent = `
        .ob-stat-btn {
          background:var(--surface); border:1px solid var(--border); color:var(--txt2);
          padding:.32rem .7rem; border-radius:99px; font-family:inherit; font-size:.74rem;
          cursor:pointer; white-space:nowrap; transition:all var(--t-fast);
        }
        .ob-stat-btn:hover { border-color:var(--g6); color:var(--txt); }
        .ob-stat-btn.active { background:var(--g7); border-color:var(--g7); color:#fff; }
        body.dark .ob-stat-btn.active { background:#3cb96d; border-color:#3cb96d; }
        .ob-card {
          background:var(--surface); border:1px solid var(--border); border-radius:var(--rad);
          padding:1rem; cursor:pointer; transition:transform var(--t-fast), box-shadow var(--t-fast), border-color var(--t-fast);
        }
        .ob-card:hover { border-color:var(--g6); box-shadow:0 4px 14px rgba(26,96,56,.1); transform:translateY(-1px); }
        .ob-avatar {
          width:42px; height:42px; border-radius:50%; background:var(--g8); color:#fff;
          display:flex; align-items:center; justify-content:center;
          font-weight:700; font-size:1rem; flex-shrink:0;
        }
        .ob-step-row {
          display:flex; align-items:center; gap:.7rem;
          padding:.55rem .25rem; border-bottom:1px solid var(--border); cursor:pointer;
          transition:background var(--t-fast);
        }
        .ob-step-row:last-child { border-bottom:none; }
        .ob-step-row:hover { background:var(--surface2); }
        .ob-step-row input[type="checkbox"] {
          width:18px; height:18px; cursor:pointer; accent-color:var(--g7); flex-shrink:0;
        }
        .ob-step-row.done .lbl { text-decoration:line-through; color:var(--txt3); font-weight:400; }
        .ob-step-row .lbl { flex:1; font-size:.84rem; font-weight:600; color:var(--txt); }
        .ob-step-row .icon { font-size:1.1rem; flex-shrink:0; }
        .ob-step-row .dept-tag {
          font-size:.62rem; font-weight:700; padding:2px 7px; border-radius:99px;
          white-space:nowrap; flex-shrink:0;
        }
      `;
      document.head.appendChild(s);
    }

    // Load employees + existing checklist progress
    Promise.all([
      API.fetchByBinding('hr.employees'),
      API.fetchByBinding('hr.onboardingChecklist').catch(() => []), // tolerate missing tab on first run
    ]).then(([emps, checklistRows]) => {
      // Hydrate sessionStorage from sheet (latest-wins per emp+step)
      hydrateChecksFromSheet(checklistRows || []);

      const today = new Date(); today.setHours(0,0,0,0);
      _obJoiners = emps.map(normEmployeeForOB)
        .filter(u => u && u.status === 'ACTIVE')
        .filter(u => {
          const doj = parseAnyDate(u.doj);
          return doj && (today - doj) <= OB_PERIOD_DAYS * 86400000;
        })
        .sort((a, b) => (parseAnyDate(b.doj) || 0) - (parseAnyDate(a.doj) || 0));

      // Site dropdown
      const sites = [...new Set(_obJoiners.map(u => u.site).filter(Boolean))].sort();
      const sel = document.getElementById('obSiteSel');
      sel.innerHTML = '<option value="">All sites</option>' + sites.map(s => `<option value="${Shell.escapeHtml(s)}">${Shell.escapeHtml(s)}</option>`).join('');

      // Wire filters
      sel.addEventListener('change', () => { _obSiteFilter = sel.value; renderOBList(); });
      document.querySelectorAll('.ob-stat-btn').forEach(b =>
        b.addEventListener('click', () => {
          _obStatusFilter = b.dataset.stat;
          document.querySelectorAll('.ob-stat-btn').forEach(x => x.classList.toggle('active', x === b));
          renderOBList();
        }));

      // Modal wiring
      document.getElementById('obModalClose').addEventListener('click', closeOBModal);
      document.getElementById('obModalCloseBtn').addEventListener('click', closeOBModal);
      document.getElementById('obMarkAll').addEventListener('click', markAllOB);
      document.getElementById('obModal').addEventListener('click', e => {
        if (e.target.id === 'obModal') closeOBModal();
      });
      document.addEventListener('keydown', obKeydownHandler);

      renderOBList();
      renderOBKpis();

      // Total active for KPI
      const allActive = emps.filter(e => /Active/i.test(e['Employee Status'] || e['Status'] || 'Active')).length;
      document.getElementById('obKPIs').dataset.totalActive = allActive;
      renderOBKpis(); // re-render with totalActive available
    }).catch(err => {
      if (err && err.name === 'SheetError') {
        API.renderSheetError(err, 'errorSlot');
      } else {
        document.getElementById('errorSlot').innerHTML =
          `<div class="alert danger"><span class="alert-icon">⚠</span><div class="alert-body">Could not load employees: ${Shell.escapeHtml(err && err.message || 'unknown')}</div></div>`;
      }
      document.getElementById('obList').innerHTML = '';
    });
  }

  function hydrateChecksFromSheet(rows) {
    // OnboardingChecklist columns: A=Timestamp B=EmpId C=Name D=Site E=Dept
    //                              F=StepId G=StepLabel H=Status I=MarkedBy J=MarkedByEmail
    // Latest-wins per (eid, stepId)
    const latest = {};
    rows.forEach(r => {
      const eid    = r['Employee ID'] || r['B'] || '';
      const stepId = r['Step ID']     || r['F'] || '';
      const status = r['Status']      || r['H'] || '';
      const ts     = r['Timestamp']   || r['A'] || '';
      if (!eid || !stepId) return;
      const k = eid + '|' + stepId;
      if (!latest[k] || (ts > latest[k].ts)) {
        latest[k] = { eid, stepId, done: /complete/i.test(status), ts };
      }
    });
    Object.values(latest).forEach(({ eid, stepId, done }) => {
      obSetCheck(eid, stepId, done);
    });
  }

  function normEmployeeForOB(r) {
    const status = (r['Employee Status'] || r['Status'] || 'Active').toUpperCase();
    return {
      id:    r['Mail ID']         || r['Email'] || r['Emp Code'] || r['EMP_CODE'] || '',
      empCode: r['Emp Code']      || r['EMP_CODE'] || '',
      name:  r['Full Name']       || r['Name']  || '',
      desig: r['Designation']     || '',
      dept:  r['Department']      || '',
      site:  r['Site']            || r['Site Name'] || '',
      doj:   r['DOJ']             || r['Date of Joining'] || '',
      status: status === 'ACTIVE' ? 'ACTIVE' : status,
    };
  }

  function obProgress(eid) {
    const checks = obGetChecks(eid);
    const done = OB_STEPS.filter(s => checks[s.id]).length;
    return { done, total: OB_STEPS.length, pct: Math.round((done / OB_STEPS.length) * 100) };
  }

  function renderOBKpis() {
    const total = _obJoiners.length;
    let cmpCt = 0, ipCt = 0;
    _obJoiners.forEach(u => {
      const eid = obEid(u);
      const { done, total: T } = obProgress(eid);
      if (done === T) cmpCt++;
      else if (done > 0) ipCt++;
    });
    const totalActive = parseInt(document.getElementById('obKPIs')?.dataset.totalActive || '—');
    const el = document.getElementById('obKPIs');
    if (!el) return;
    el.innerHTML = `
      <div class="kpi"><div class="kpi-top"><div class="kpi-icon green">👥</div></div>
        <div class="kpi-val">${total}</div>
        <div class="kpi-label">New joiners (${OB_PERIOD_DAYS} days)</div></div>
      <div class="kpi"><div class="kpi-top"><div class="kpi-icon blue">✅</div></div>
        <div class="kpi-val">${cmpCt}</div>
        <div class="kpi-label">Onboarding complete</div></div>
      <div class="kpi"><div class="kpi-top"><div class="kpi-icon orange">⏳</div></div>
        <div class="kpi-val">${ipCt}</div>
        <div class="kpi-label">In progress</div></div>
      <div class="kpi"><div class="kpi-top"><div class="kpi-icon">📊</div></div>
        <div class="kpi-val">${isNaN(totalActive) ? '—' : totalActive}</div>
        <div class="kpi-label">Total active employees</div></div>
    `;
  }

  function renderOBList() {
    const list = document.getElementById('obList');
    const empty = document.getElementById('obEmpty');
    if (!list) return;

    const today = new Date(); today.setHours(0,0,0,0);
    let rows = _obJoiners;
    if (_obSiteFilter) rows = rows.filter(u => u.site === _obSiteFilter);
    if (_obStatusFilter) rows = rows.filter(u => {
      const { done, total } = obProgress(obEid(u));
      if (_obStatusFilter === 'complete')   return done === total;
      if (_obStatusFilter === 'inprogress') return done > 0 && done < total;
      if (_obStatusFilter === 'notstarted') return done === 0;
      return true;
    });

    document.getElementById('obCount').textContent = `${rows.length} of ${_obJoiners.length} new joiners`;

    if (_obJoiners.length === 0) {
      list.style.display = 'none';
      empty.style.display = 'block';
      return;
    }
    list.style.display = '';
    empty.style.display = 'none';

    if (!rows.length) {
      list.innerHTML = `<div style="padding:1.4rem;text-align:center;color:var(--txt3);font-size:.85rem">No joiners match the current filter.</div>`;
      return;
    }

    list.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem">
      ${rows.map(u => {
        const eid = obEid(u);
        const { done, total, pct } = obProgress(eid);
        const doj = parseAnyDate(u.doj);
        const daysAgo = doj ? Math.floor((today - doj) / 86400000) : null;
        const colour = pct === 100 ? '#15803d' : pct >= 50 ? '#1565c0' : '#bf6700';
        return `<div class="ob-card" data-eid="${Shell.escapeHtml(eid)}" data-name="${Shell.escapeHtml(u.name||'')}">
          <div style="display:flex;align-items:center;gap:.7rem;margin-bottom:.7rem">
            <div class="ob-avatar">${Shell.escapeHtml((u.name || '?').charAt(0).toUpperCase())}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:.88rem;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${Shell.escapeHtml(u.name || '—')}</div>
              <div style="font-size:.7rem;color:var(--txt3)">${Shell.escapeHtml(u.desig || u.dept || '—')} · ${Shell.escapeHtml(u.site || '—')}</div>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem">
            <span style="font-size:.7rem;color:var(--txt3)">Joined ${daysAgo != null ? daysAgo + 'd ago' : '—'}</span>
            <span style="font-size:.72rem;font-weight:700;color:${colour}">${done}/${total} steps</span>
          </div>
          <div style="background:var(--surface3);border-radius:99px;height:6px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${colour};border-radius:99px;transition:width .4s ease-out"></div>
          </div>
          ${pct === 100 ? '<div style="font-size:.68rem;color:#15803d;font-weight:700;margin-top:.45rem">✓ Onboarding complete</div>' : ''}
        </div>`;
      }).join('')}
    </div>`;

    list.querySelectorAll('[data-eid]').forEach(card => {
      card.addEventListener('click', () => openOBModal(card.dataset.eid, card.dataset.name));
    });
  }

  function obEid(u) { return u.id || u.empCode || u.name || ''; }

  function openOBModal(eid, name) {
    _obOpenEid = eid;
    document.getElementById('obModalName').textContent = name || '—';
    const u = _obJoiners.find(x => obEid(x) === eid);
    document.getElementById('obModalMeta').textContent = u ? `${u.desig || u.dept || ''}${u.site ? ' · ' + u.site : ''}` : '';
    document.getElementById('obModal').style.display = 'flex';
    renderOBSteps(eid);
  }
  function closeOBModal() {
    document.getElementById('obModal').style.display = 'none';
    _obOpenEid = null;
    renderOBList();
    renderOBKpis();
  }
  function obKeydownHandler(e) {
    if (e.key === 'Escape' && _obOpenEid) closeOBModal();
  }

  function renderOBSteps(eid) {
    const checks = obGetChecks(eid);
    const done = OB_STEPS.filter(s => checks[s.id]).length;
    const pct = Math.round((done / OB_STEPS.length) * 100);
    document.getElementById('obProgLabel').textContent = `${done} of ${OB_STEPS.length} steps complete`;
    document.getElementById('obProgPct').textContent = pct + '%';
    document.getElementById('obProgBar').style.width = pct + '%';

    document.getElementById('obStepsList').innerHTML = OB_STEPS.map(s => {
      const checked = !!checks[s.id];
      const dc = OB_DEPT_COL[s.dept] || '#666';
      return `<label class="ob-step-row ${checked ? 'done' : ''}">
        <input type="checkbox" ${checked ? 'checked' : ''} data-step="${s.id}"/>
        <span class="icon">${s.icon}</span>
        <span class="lbl">${Shell.escapeHtml(s.label)}</span>
        <span class="dept-tag" style="background:${dc}1f;color:${dc}">${Shell.escapeHtml(s.dept)}</span>
      </label>`;
    }).join('');

    document.querySelectorAll('#obStepsList input[data-step]').forEach(cb => {
      cb.addEventListener('change', e => {
        toggleOBStep(_obOpenEid, e.target.dataset.step, e.target.checked);
      });
    });
  }

  function toggleOBStep(eid, stepId, checked) {
    obSetCheck(eid, stepId, checked);
    renderOBSteps(eid);
    // Write-back to sheet (best-effort)
    const u = _obJoiners.find(x => obEid(x) === eid);
    const me = STATE.get('user') || {};
    const step = OB_STEPS.find(s => s.id === stepId);
    const row = [
      new Date().toISOString(),
      eid,
      u?.name || eid,
      u?.site || '',
      u?.dept || '',
      stepId,
      step?.label || stepId,
      checked ? 'Completed' : 'Pending',
      me.name || 'HR',
      me.email || '',
    ];
    appendOnboardingRow(row);
  }

  async function markAllOB() {
    if (!_obOpenEid) return;
    const u = _obJoiners.find(x => obEid(x) === _obOpenEid);
    const me = STATE.get('user') || {};
    const ts = new Date().toISOString();
    // Update local state immediately
    OB_STEPS.forEach(s => obSetCheck(_obOpenEid, s.id, true));
    renderOBSteps(_obOpenEid);
    // Fire writes serially-but-optimistically; don't block UI
    OB_STEPS.forEach(s => appendOnboardingRow([
      ts, _obOpenEid, u?.name || _obOpenEid, u?.site || '', u?.dept || '',
      s.id, s.label, 'Completed', me.name || 'HR', me.email || '',
    ]));
    Shell.toast('All steps marked complete · sheet writes queued', 'success');
  }

  function appendOnboardingRow(row) {
    const b = API.getBinding('hr.onboardingChecklist');
    if (!b) return Promise.resolve(false);
    const sid = API.getSheetId(b.sheetKey);
    if (!sid) return Promise.resolve(false);
    return fetch(API.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'appendRow', sheetId: sid, tab: b.tab, row }),
    }).then(r => r.json().catch(() => ({}))).then(j => j && j.success !== false).catch(() => false);
  }

  function parseAnyDate(v) {
    if (!v) return null;
    if (typeof v === 'string' && v.startsWith('Date(')) {
      try {
        const p = v.replace('Date(','').replace(')','').split(',').map(Number);
        return new Date(p[0], p[1], p[2]);
      } catch (_) { return null; }
    }
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }

  /* ──── Policies Hub ──── */
  /* ──── Policy Hub ────
     Six category tiles + searchable, filterable file grid backed by
     a Drive folder. HR/MD/admin can upload (drag-drop or file picker).
     Files are listed via Apps Script `listPolicyFiles` and uploaded
     via `uploadPolicyFile` — both use the JSON+text/plain CORS-safe
     pattern documented in the canonical project memory.
  */
  const POLICY_CATS = [
    { icon:'👥',  label:'HR Policies',         desc:'Leave · Attendance · Conduct · Grievance' },
    { icon:'🦺',  label:'Safety Policies',     desc:'HSE · PPE · Emergency · Incident' },
    { icon:'💻',  label:'IT Policies',         desc:'Data Security · Usage · BYOD · Password' },
    { icon:'💰',  label:'Finance & Accounts',  desc:'Procurement · Travel · Expenses · Audit' },
    { icon:'🏗',  label:'Site Operations',     desc:'SOP · Quality · Equipment · Handover' },
    { icon:'📜',  label:'Compliance & Legal',  desc:'Statutory · ESG · ISO · Certifications' },
  ];
  // Drive folder ID — replace with the live folder ID via Config in future
  const POLICY_DRIVE_FOLDER_ID = '1ZZxpHJ9nRYJSr6SFn_ZHfRSr6f-policyFolderID';

  let _polFiles = [];
  let _polCatFilter = '';

  function renderPolicies(root) {
    const role = STATE.get('role') || 'employee';
    const canUpload = ['md', 'admin', 'hr'].includes(role);

    root.innerHTML = `
      ${canUpload ? `
        <div id="polDropZone" class="card" style="border:2px dashed var(--g5);background:rgba(46,125,50,.04);cursor:pointer;margin-bottom:1.2rem;transition:all var(--t-fast)">
          <div class="card-body" style="text-align:center;padding:2rem 1rem">
            <div style="font-size:2.4rem;margin-bottom:.5rem">📂</div>
            <div style="font-weight:700;color:var(--g8);font-size:.95rem;margin-bottom:.3rem">Drop files here or click to upload</div>
            <div style="font-size:.78rem;color:var(--txt3)">PDF · Word · PowerPoint · Excel · max 10 MB per file</div>
            <input id="polFileInput" type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt" style="display:none"/>
            <div id="polUploadStatus" style="margin-top:.75rem;display:flex;gap:.4rem;justify-content:center;flex-wrap:wrap"></div>
          </div>
        </div>` : ''}

      <!-- Category tiles -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:.85rem;margin-bottom:1.4rem" id="polCatGrid">
        ${POLICY_CATS.map(c => `
          <div class="card pol-cat-card" data-cat="${Shell.escapeHtml(c.label)}" style="cursor:pointer">
            <div class="card-body" style="display:flex;align-items:center;gap:1rem;padding:.9rem 1rem">
              <div style="font-size:2rem;flex-shrink:0">${c.icon}</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:.88rem;color:var(--g8)">${Shell.escapeHtml(c.label)}</div>
                <div style="font-size:.74rem;color:var(--txt3);margin-top:.15rem">${Shell.escapeHtml(c.desc)}</div>
              </div>
              <span class="tag pol-cat-count" data-count="${Shell.escapeHtml(c.label)}">—</span>
            </div>
          </div>`).join('')}
      </div>

      <!-- Files list -->
      <div class="card">
        <div class="card-head">
          <h3>📄 Policy documents</h3>
          <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
            <input id="polSearch" type="text" class="filt-in" placeholder="Search…" style="min-width:200px"/>
            <select id="polCatSel" class="filt-sel">
              <option value="">All categories</option>
              ${POLICY_CATS.map(c => `<option value="${Shell.escapeHtml(c.label)}">${Shell.escapeHtml(c.label)}</option>`).join('')}
            </select>
            <span class="tag" id="polCount">—</span>
          </div>
        </div>
        <div id="polFilesList" style="padding:0">
          <div style="padding:2.5rem;text-align:center;color:var(--txt3);font-size:.85rem">
            <div style="font-size:1.6rem;margin-bottom:.5rem">⏳</div>
            Loading documents from Drive…
          </div>
        </div>
      </div>
    `;

    // Inject pol-card hover style + filt-* if missing
    if (!document.getElementById('polStyles')) {
      const s = document.createElement('style');
      s.id = 'polStyles';
      s.textContent = `
        .pol-cat-card { transition:transform var(--t-fast), box-shadow var(--t-fast), border-color var(--t-fast); }
        .pol-cat-card:hover { transform:translateY(-1px); border-color:var(--g6); box-shadow:0 4px 14px rgba(26,96,56,.1); }
        .pol-cat-card.active { border-color:var(--g7); background:rgba(46,125,50,.04); }
        body.dark .pol-cat-card.active { background:rgba(60,185,109,.08); }
        .pol-file-row { display:flex; align-items:center; gap:.7rem; padding:.7rem 1rem; border-bottom:1px solid var(--border); }
        .pol-file-row:last-child { border-bottom:none; }
        .pol-file-row:hover { background:var(--surface2); }
        .pol-file-icon { font-size:1.4rem; flex-shrink:0; }
        .pol-file-name { font-weight:600; font-size:.86rem; }
        .pol-file-meta { font-size:.7rem; color:var(--txt3); margin-top:.15rem; }
        .filt-sel, .filt-in {
          padding:.4rem .65rem; border:1px solid var(--border);
          border-radius:8px; background:var(--surface);
          font-family:inherit; font-size:.82rem; color:var(--txt);
        }
        .filt-sel:focus, .filt-in:focus { outline:none; border-color:var(--g5); }
      `;
      document.head.appendChild(s);
    }

    // Wire upload (HR/MD/admin only)
    if (canUpload) {
      const dz = document.getElementById('polDropZone');
      const fi = document.getElementById('polFileInput');
      dz.addEventListener('click', () => fi.click());
      dz.addEventListener('dragover', e => {
        e.preventDefault();
        dz.style.background = 'rgba(46,125,50,.12)';
        dz.style.borderColor = 'var(--g7)';
      });
      dz.addEventListener('dragleave', () => {
        dz.style.background = 'rgba(46,125,50,.04)';
        dz.style.borderColor = 'var(--g5)';
      });
      dz.addEventListener('drop', e => {
        e.preventDefault();
        dz.style.background = 'rgba(46,125,50,.04)';
        dz.style.borderColor = 'var(--g5)';
        handlePolicyFiles(e.dataTransfer.files);
      });
      fi.addEventListener('change', e => handlePolicyFiles(e.target.files));
    }

    // Wire category tile click → filter to that cat
    document.querySelectorAll('.pol-cat-card').forEach(c => {
      c.addEventListener('click', () => {
        const cat = c.dataset.cat;
        _polCatFilter = (_polCatFilter === cat) ? '' : cat;
        document.getElementById('polCatSel').value = _polCatFilter;
        document.querySelectorAll('.pol-cat-card').forEach(x =>
          x.classList.toggle('active', x.dataset.cat === _polCatFilter));
        renderPolFiles();
      });
    });

    // Wire search + select
    document.getElementById('polSearch').addEventListener('input', renderPolFiles);
    document.getElementById('polCatSel').addEventListener('change', e => {
      _polCatFilter = e.target.value;
      document.querySelectorAll('.pol-cat-card').forEach(x =>
        x.classList.toggle('active', x.dataset.cat === _polCatFilter));
      renderPolFiles();
    });

    loadPolicyFiles();
  }

  function loadPolicyFiles() {
    fetch(`${API.APPS_SCRIPT_URL}?action=listPolicyFiles&folderId=${POLICY_DRIVE_FOLDER_ID}`)
      .then(r => r.json().catch(() => ({})))
      .then(data => {
        _polFiles = (data && data.files) || [];
        renderPolFiles();
      })
      .catch(() => {
        _polFiles = [];
        const list = document.getElementById('polFilesList');
        if (list) list.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--txt3);font-size:.85rem">
          Could not reach Apps Script. Verify the <code>listPolicyFiles</code> action is deployed.
        </div>`;
      });
  }

  function renderPolFiles() {
    const list = document.getElementById('polFilesList');
    if (!list) return;

    // Update per-category counts
    const counts = {};
    _polFiles.forEach(f => {
      const c = f.category || classifyPolicy(f.name);
      counts[c] = (counts[c] || 0) + 1;
    });
    document.querySelectorAll('.pol-cat-count').forEach(el => {
      el.textContent = counts[el.dataset.count] || 0;
    });

    const q = (document.getElementById('polSearch')?.value || '').toLowerCase();
    let rows = _polFiles;
    if (_polCatFilter) rows = rows.filter(f => (f.category || classifyPolicy(f.name)) === _polCatFilter);
    if (q) rows = rows.filter(f => (f.name || '').toLowerCase().includes(q));

    document.getElementById('polCount').textContent = `${rows.length} file${rows.length === 1 ? '' : 's'}`;

    if (!rows.length) {
      list.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--txt3);font-size:.85rem">
        ${_polFiles.length === 0 ? 'No policy documents uploaded yet.' : 'No documents match the current filter.'}
      </div>`;
      return;
    }

    list.innerHTML = rows.map(f => {
      const ico = fileIcon(f.name);
      const cat = f.category || classifyPolicy(f.name);
      const size = f.sizeBytes ? humanSize(f.sizeBytes) : '';
      const dt = f.createdAt ? fmtIndDate(f.createdAt) : '';
      return `<div class="pol-file-row">
        <span class="pol-file-icon">${ico}</span>
        <div style="flex:1;min-width:0;overflow:hidden">
          <div class="pol-file-name" title="${Shell.escapeHtml(f.name)}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${Shell.escapeHtml(f.name)}</div>
          <div class="pol-file-meta">${Shell.escapeHtml(cat)}${size ? ' · ' + size : ''}${dt ? ' · ' + dt : ''}</div>
        </div>
        <a class="btn btn-secondary btn-sm" href="${Shell.escapeHtml(f.url || f.webViewLink || '#')}" target="_blank" rel="noopener">Open ↗</a>
      </div>`;
    }).join('');
  }

  function classifyPolicy(name) {
    const n = (name || '').toLowerCase();
    if (/(hr|leave|attendance|conduct|grievance|hand[-\s]?book)/.test(n)) return 'HR Policies';
    if (/(safety|hse|ppe|incident|emergency)/.test(n))                   return 'Safety Policies';
    if (/(it[-\s]|data|password|byod|cyber|usage)/.test(n))              return 'IT Policies';
    if (/(finance|accounts|procurement|travel|expense|audit)/.test(n))   return 'Finance & Accounts';
    if (/(site|sop|quality|equipment|handover)/.test(n))                 return 'Site Operations';
    if (/(compliance|legal|esg|iso|cert)/.test(n))                       return 'Compliance & Legal';
    return 'HR Policies';
  }

  function fileIcon(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    if (['pdf'].includes(ext)) return '📕';
    if (['doc','docx'].includes(ext)) return '📘';
    if (['xls','xlsx','csv'].includes(ext)) return '📗';
    if (['ppt','pptx'].includes(ext)) return '📙';
    if (['jpg','jpeg','png','gif','webp'].includes(ext)) return '🖼';
    return '📄';
  }
  function humanSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024*1024) return (b/1024).toFixed(0) + ' KB';
    return (b/(1024*1024)).toFixed(1) + ' MB';
  }

  function handlePolicyFiles(fileList) {
    if (!fileList || !fileList.length) return;
    const status = document.getElementById('polUploadStatus');
    Array.from(fileList).forEach(f => {
      if (f.size > 10 * 1024 * 1024) {
        addUploadChip(status, `✕ ${f.name} too large`, 'error');
        return;
      }
      const chip = addUploadChip(status, `⏳ ${f.name}…`, 'progress');
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        const cat = classifyPolicy(f.name);
        try {
          const res = await fetch(API.APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
              action:    'uploadPolicyFile',
              folderId:  POLICY_DRIVE_FOLDER_ID,
              fileName:  f.name,
              mimeType:  f.type || 'application/octet-stream',
              category:  cat,
              base64Data:base64,
            }),
          });
          const json = await res.json().catch(() => ({}));
          if (json && json.success !== false) {
            chip.textContent = `✓ ${f.name}`;
            chip.dataset.kind = 'success';
            chip.style.background = 'rgba(46,125,50,.12)';
            chip.style.color = '#15803d';
            setTimeout(loadPolicyFiles, 800);
          } else {
            chip.textContent = `✕ ${f.name}`;
            chip.dataset.kind = 'error';
            chip.style.background = 'rgba(220,38,38,.12)';
            chip.style.color = '#b91c1c';
          }
        } catch (e) {
          chip.textContent = `✕ ${f.name} (offline)`;
          chip.dataset.kind = 'error';
          chip.style.background = 'rgba(220,38,38,.12)';
          chip.style.color = '#b91c1c';
        }
      };
      reader.readAsDataURL(f);
    });
  }
  function addUploadChip(parent, txt, kind) {
    const span = document.createElement('span');
    span.style.cssText = 'font-size:.74rem;padding:.2rem .55rem;border-radius:8px;background:var(--surface3);color:var(--txt2)';
    span.textContent = txt;
    span.dataset.kind = kind;
    parent.appendChild(span);
    return span;
  }


  /* KPI helper (duplicated locally so module is self-contained) */
  function kpi({ icon, glyph, val, label, sub, status }) {
    const statusHtml = status === 'live'
      ? '<span class="kpi-status live"><span class="pulse"></span>Live</span>'
      : status === 'warn'  ? '<span class="kpi-status warn">Action</span>'
      : '';
    return `
      <div class="kpi">
        <div class="kpi-top">
          <div class="kpi-icon ${icon}">${glyph}</div>
          ${statusHtml}
        </div>
        <div class="kpi-val tnum">${val}</div>
        <div class="kpi-label">${Shell.escapeHtml(label)}</div>
        ${sub ? `<div class="kpi-sub">${Shell.escapeHtml(sub)}</div>` : ''}
      </div>
    `;
  }


  /* Hash navigation — re-render on hash change */
  window.addEventListener('hashchange', render);
  render();
})();
