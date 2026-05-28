// ══════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════

// ── Build/version metadata ────────────────────────────────────────
// Updated automatically by the build script every time a new bundle
// is produced. Surface in the portal footer + zip filename.
//   PORTAL_VERSION  — semantic version string  (manually bumped on releases)
//   PORTAL_BUILD    — auto-incremented integer (every build)
//   PORTAL_BUILD_AT — UTC ISO timestamp of the build
const PORTAL_VERSION  = '3.18.22';
const PORTAL_BUILD    = 395;
const PORTAL_BUILD_AT = '2026-05-28T12:37:23Z';

// ── Google OAuth — replace with your actual Client ID from Google Cloud Console ──
const GOOGLE_CLIENT_ID = '276292295631-4maumpv2181lf4sh9lpnv9soibpm9c62.apps.googleusercontent.com';
const PIN_SHEET_ID     = '1hN4VEDNpVLD3lKuBPYCTOaViv7UpveRfud2d2gy15D0'; // UserSecrets sheet
// ── Apps Script Endpoint Registry ─────────────────────────────────
// All Apps Script /exec URLs are managed here. Override at runtime
// from Config → 🔗 Apps Script Endpoints (saved to localStorage).
// Adding a new endpoint:
//   1. Add a new key here with a description and a defaultUrl
//   2. Use it in code as: getExec('myKey')
const EXEC_REGISTRY_DEFAULTS = {
  portalConfig:{ label: 'Portal Config Backend',  desc: 'Standalone backend for the PortalConfig sheet (savePortalConfig / getPortalConfig). Independent of other handlers — never changes.', defaultUrl: 'https://script.google.com/macros/s/AKfycbys4NPojiI-1nBKcfbreM4HO8sehBH76ebjv4nQ_TfHcT_IXueUTBBl1Ew0SGYtGVRW/exec' },
  main:        { label: 'Main Backend (default)', desc: 'Most portal POSTs (DPR, Safety, PCC, Onboarding, Reports). Default for getExec().', defaultUrl: 'https://script.google.com/macros/s/AKfycbxajuscM46AlJe2iMtDg0nJjfuzidEZwnOy_o2TZXQIbh_e2hGu79CNxAzvUu11tPJP/exec' },
  pinReset:    { label: 'PIN Reset',              desc: 'v2_PINReset bound to UserSecrets sheet.',                                          defaultUrl: 'https://script.google.com/macros/s/AKfycbxajuscM46AlJe2iMtDg0nJjfuzidEZwnOy_o2TZXQIbh_e2hGu79CNxAzvUu11tPJP/exec' },
  aiProxy:     { label: 'AI Proxy (Groq)',        desc: 'aiProxy action — Groq llama-3.3-70b-versatile via Apps Script.',                   defaultUrl: 'https://script.google.com/macros/s/AKfycbxajuscM46AlJe2iMtDg0nJjfuzidEZwnOy_o2TZXQIbh_e2hGu79CNxAzvUu11tPJP/exec' },
  diagnostic:  { label: 'Sheet Diagnostic',       desc: 'Sharing-Doctor — server-side sheet sharing checks (status/redirect/sniff).',       defaultUrl: 'https://script.google.com/macros/s/AKfycbxajuscM46AlJe2iMtDg0nJjfuzidEZwnOy_o2TZXQIbh_e2hGu79CNxAzvUu11tPJP/exec' },
  pcc:         { label: 'PCC Handlers',           desc: 'Project Cost Control: saveProjectSetup, saveBOQ, saveWBS, saveWorkplan, etc.',     defaultUrl: 'https://script.google.com/macros/s/AKfycbyRE958JhUHHGd_QpWCU26iKL_gvTqiudH3VMaO6dGKs05QP2OSfCbyvJa-JYt6_UzH/exec' },
};
const EXEC_LS_KEY = 'evgcpl_exec_registry_v1';

// ── Tier 2: Sheet-stored config ───────────────────────────────
// Stored in the PortalConfig tab of the Master sheet.
// Read via gviz (public, no Apps Script needed — avoids chicken-and-egg).
// Write via Apps Script POST.  Loaded once at startup; cached in _SHEET_CONFIG.
// Priority chain:  localStorage (T1)  →  Sheet config (T2)  →  Compiled default (T3)
window._SHEET_CONFIG     = {};     // { exec_main: '...', exec_pcc: '...' }
window._SHEET_CONFIG_META = {};   // { exec_main: { updatedBy, updatedAt } }
window._SHEET_CONFIG_LOADED = false;

async function loadSheetConfig() {
  window._SHEET_CONFIG_ERR = '';
  try {
    // Use the sheet's gviz API — tab must be public (sheet shared as Anyone can view)
    const sid = '1B2wb38KhNwlLoZnsAGWQkO0FdEGFFfsh3ycRRurigq4';
    const url = `https://docs.google.com/spreadsheets/d/${sid}/gviz/tq?tqx=out:json&sheet=PortalConfig`;
    const res  = await fetch(url, { cache: 'no-cache' });
    const text = await res.text();
    // gviz wraps response: google.visualization.Query.setResponse({...});
    const jsonStr = text.replace(/^[^(]+\(/, '').replace(/\);?\s*$/, '');
    let json;
    try { json = JSON.parse(jsonStr); }
    catch(pe) { window._SHEET_CONFIG_ERR = 'Parse error — sheet may not be public. Share Master sheet as Anyone can view.'; window._SHEET_CONFIG_LOADED = true; return; }
    if (json.status === 'error') {
      window._SHEET_CONFIG_ERR = 'Sheet error: ' + (json.errors?.[0]?.message || 'unknown') + '. Verify tab name is exactly "PortalConfig" and sheet is public.';
      window._SHEET_CONFIG_LOADED = true; return;
    }
    if (!json.table) { window._SHEET_CONFIG_ERR = 'No table returned — PortalConfig tab not found or empty.'; window._SHEET_CONFIG_LOADED = true; return; }
    const cols   = (json.table.cols || []).map(c => (c.label || c.id || '').trim());
    const keyIdx = cols.findIndex(h => /^key$/i.test(h));
    const valIdx = cols.findIndex(h => /^value$/i.test(h));
    const byIdx  = cols.findIndex(h => /updated.?by/i.test(h));
    const atIdx  = cols.findIndex(h => /updated.?at/i.test(h));
    if (keyIdx < 0 || valIdx < 0) { window._SHEET_CONFIG_ERR = 'PortalConfig tab found but missing Key or Value columns. Add headers: Key | Value | Description | Updated By | Updated At'; window._SHEET_CONFIG_LOADED = true; return; }
    const cfg = {}; const meta = {};
    (json.table.rows || []).forEach(row => {
      const c = row.c || [];
      const k = String(c[keyIdx]?.v || '').trim();
      const v = String(c[valIdx]?.v || '').trim();
      if (k) {
        cfg[k] = v;
        meta[k] = {
          updatedBy: byIdx >= 0 ? String(c[byIdx]?.v || '') : '',
          updatedAt: atIdx >= 0 ? String(c[atIdx]?.v || '') : '',
        };
      }
    });
    window._SHEET_CONFIG      = cfg;
    window._SHEET_CONFIG_META = meta;
    window._SHEET_CONFIG_LOADED = true;
    console.log('[SheetConfig] Loaded', Object.keys(cfg).length, 'keys:', Object.keys(cfg));
  } catch (e) {
    window._SHEET_CONFIG_ERR = 'Fetch failed: ' + e.message;
    window._SHEET_CONFIG_LOADED = true;
    console.warn('[SheetConfig] Load failed:', e.message);
  }
}

// ── Load at startup (non-blocking) ───────────────────────────
loadSheetConfig();

// Returns the exec URL for a given key.
// Priority:  T1 localStorage  →  T2 Sheet (PortalConfig tab)  →  T3 Compiled default
function getExec(key) {
  try {
    // T1: localStorage override (per-browser, instant)
    const overrides = JSON.parse(localStorage.getItem(EXEC_LS_KEY) || '{}');
    if (overrides[key] && /^https:\/\/script\.google\.com\/macros\//.test(overrides[key])) {
      return overrides[key];
    }
    // T2: Sheet-stored config (persistent, all users/browsers)
    const sheetVal = (window._SHEET_CONFIG || {})['exec_' + key];
    if (sheetVal && /^https:\/\/script\.google\.com\/macros\//.test(sheetVal)) {
      return sheetVal;
    }
    // Unknown key → fall through
    if (key !== 'main' && !EXEC_REGISTRY_DEFAULTS[key]) {
      if (overrides.main) return overrides.main;
      const sm = (window._SHEET_CONFIG || {})['exec_main'];
      if (sm) return sm;
      return EXEC_REGISTRY_DEFAULTS.main.defaultUrl;
    }
  } catch (e) { /* ignore */ }
  // T3: Compiled default
  return (EXEC_REGISTRY_DEFAULTS[key] || EXEC_REGISTRY_DEFAULTS.main).defaultUrl;
}

// Save overrides (called from the Config → Endpoints page)
function setExecOverrides(map) {
  try { localStorage.setItem(EXEC_LS_KEY, JSON.stringify(map || {})); }
  catch (e) { console.warn('[EXEC] could not persist overrides:', e); }
}
function getExecOverrides() {
  try { return JSON.parse(localStorage.getItem(EXEC_LS_KEY) || '{}'); }
  catch (e) { return {}; }
}

// Backwards-compatible globals — these still exist so older code keeps working
// even though all NEW writes should use getExec(key).
const PIN_API_URL     = getExec('pinReset');
const APPS_SCRIPT_URL = getExec('main');
const HR_DOCS_FOLDER_ID = '1I1ESOw_0EncSMt3nLZV2P7I106aniLY-'; // HR_Documents root
const HR_DOCS_TYPES = [ // folder name → display label → icon
  { folder:'Photo',                 label:'Photo',               icon:'📸', accept:'image/*' },
  { folder:'OfferLetter',           label:'Offer Letter',         icon:'📄', accept:'.pdf,.doc,.docx' },
  { folder:'AppoitmentOrder',       label:'Appointment Order',    icon:'📋', accept:'.pdf,.doc,.docx' },
  { folder:'SalaryBreakUp',         label:'Salary Breakup',       icon:'💰', accept:'.pdf,.doc,.docx,.xls,.xlsx' },
  { folder:'BankProof',             label:'Bank Proof',           icon:'🏦', accept:'.pdf,.jpg,.jpeg,.png' },
  { folder:'Aadhar',                label:'Aadhar Card',          icon:'🪪', accept:'.pdf,.jpg,.jpeg,.png' },
  { folder:'UAN',                   label:'UAN Card',             icon:'🔵', accept:'.pdf,.jpg,.jpeg,.png' },
  { folder:'Onboarding Documents',  label:'Onboarding Docs',      icon:'📁', accept:'.pdf,.doc,.docx,.jpg,.png' },
];

// ── Apps Script backend — see EXEC_REGISTRY_DEFAULTS above for managed URLs ──
// (APPS_SCRIPT_URL and PIN_API_URL declared earlier via getExec()) 

const STATE = {
  user: null,
  role: 'md',
  currentPage: 'dashboard',
  selectedRole: null,
  sidebarOpen: false,
  notifOpen: false,
  vendorRecord: null,   // populated on vendor/SC login
  isDevMode: false,     // true when Admin activates Dev Mode to see WIP nav items
  deptHeadDept: '',     // populated for dept_head role e.g. 'HR', 'Finance'
  userAllRoles: [],     // all matched role labels from hierarchy resolver e.g. ['Department Head','RM']
  userTopRoleLabel: '', // highest role label e.g. 'Department Head'
};

const ROLES = {
  md:          { label:'MD / Director',     badge:'MD',       avatar:'MD' },
  hr:          { label:'HR Manager',        badge:'HR',       avatar:'HR' },
  site:        { label:'Site Manager',      badge:'Site Mgr', avatar:'SM' },
  employee:    { label:'Employee',          badge:'Staff',    avatar:'EG' },
  purchase:    { label:'Purchase Manager',  badge:'Purchase', avatar:'PM' },
  accounts:    { label:'Accounts',          badge:'Accounts', avatar:'AC' },
  vendor:      { label:'Vendor',            badge:'Vendor',   avatar:'VN' },
  sc:          { label:'Sub-Contractor',    badge:'SC',       avatar:'SC' },
  dept_head:   { label:'Department Head',   badge:'Dept Hd',  avatar:'DH' },
};

// ══════════════════════════════════════════════════
//  AUTH — Google OAuth + Vendor/SC Login
// ══════════════════════════════════════════════════

function initGoogleSignIn() {
  if (typeof google === 'undefined' || !google.accounts) return;
  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.startsWith('YOUR_')) return;
  google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleCredential });
}
window.addEventListener('load', () => setTimeout(initGoogleSignIn, 1000));

async function handleGoogleCredential(response) {
  try {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    const email = payload.email || '';
    const name  = payload.name  || email.split('@')[0];
    STATE.user = { email, name, picture: payload.picture || '' };

    // ── Launch app immediately — don't wait for masters ──
    // Default role based on domain; will be upgraded once masters load
    let role = email.endsWith('@evgcpl.com') ? 'md' : 'employee';
    STATE.role = role; STATE.selectedRole = role;

    // Hide login screen and go straight to dashboard
    launchApp();

    // ── Then load masters in background and upgrade role if needed ──
    loadAllMasters().then(() => {
      const emp = STATE.masters.users.find(u =>
        u.email && u.email.toLowerCase() === email.toLowerCase()
      );
      if (emp) {
        const resolved = resolveRoleFromEmployee(emp);
        STATE.userAllRoles     = resolved.allRoles;
        STATE.userTopRoleLabel = resolved.topRoleLabel;
        if (resolved.deptHeadDept) STATE.deptHeadDept = resolved.deptHeadDept;

        // ALWAYS apply — initial @evgcpl.com → 'md' is just a fast placeholder.
        // Employee register is the source of truth (ars@evgcpl.com may be dept_head, not md).
        applyResolvedRole(resolved);
        applyRoleNavRestrictions(STATE.role);
        applyDevModeUI();
        // Navigate to the correct default page for this role/dept
        navigate(getDefaultPage(STATE.role));
      }
      updateAllMasterUI();
    });
  } catch(e) {
    console.error('Google login error:', e);
  }
}

function handleGoogleLogin() {
  if (GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.startsWith('YOUR_') && typeof google !== 'undefined' && google.accounts) {
    google.accounts.id.prompt();
  } else {
    console.warn('Google OAuth not configured.');
  }
}



// ── PIN Login ──────────────────────────────────────────────
async function handlePINLogin() {
  const emailEl = document.getElementById('pin-email');
  const pinEl   = document.getElementById('pin-input');
  const errEl   = document.getElementById('pin-error');
  const btnEl   = document.getElementById('pin-submit-btn');

  const email = (emailEl?.value || '').trim().toLowerCase();
  const pin   = (pinEl?.value  || '').trim();

  const showErr = (msg) => {
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    if (btnEl) { btnEl.textContent = 'Sign In'; btnEl.disabled = false; }
  };

  if (!email) return showErr('Please enter your Mail ID.');
  if (!pin)   return showErr('Please enter your PIN.');

  if (btnEl) { btnEl.textContent = 'Verifying…'; btnEl.disabled = true; }
  if (errEl) errEl.style.display = 'none';

  try {
    // ── Step 1: Load UserSecrets directly via gviz — check Modified PIN (col E) ──
    if (btnEl) btnEl.textContent = 'Checking…';
    const pinRows = await fetchSheet('UserSecrets', null, PIN_SHEET_ID);

    if (!pinRows.length) {
      return showErr('Could not reach the PIN database. Please check your internet and try again.');
    }

    // Find row matching entered email (case-insensitive, Mail ID = col A)
    const pinRow = pinRows.find(r =>
      (r['Mail ID'] || '').trim().toLowerCase() === email
    );

    if (!pinRow) {
      return showErr('Email not found in PIN database. Please set your PIN first at the link below.');
    }

    // Check against Modified PIN (col E) — falls back to Current PIN (col D) if not set
    const storedPIN = (pinRow['Modified PIN'] || pinRow['Current PIN'] || '').trim();
    if (!storedPIN) {
      return showErr('No PIN set for this account. Please use the PIN Set/Reset link below.');
    }
    if (String(pin) !== String(storedPIN)) {
      return showErr('Incorrect PIN. Please try again or reset your PIN.');
    }

    // ── Step 2: PIN verified — get role from Employee Register (masters) ──
    if (!STATE.mastersLoaded) {
      if (btnEl) btnEl.textContent = 'Loading profile…';
      await loadAllMasters();
    }

    // Match by email (Mail ID = col P in 0_EmployeeRegister_Live, mapped as r['Mail ID'])
    const empRecord = STATE.masters.users.find(u =>
      (u.email || '').trim().toLowerCase() === email
    );

    const userName = empRecord?.name || pinRow['User Name'] || email.split('@')[0];

    const resolved = resolveRoleFromEmployee(empRecord || {
      role: '', dept: '', empCode: (pinRow['Employee Ref'] || '').toUpperCase()
    });
    // Store all roles for profile display
    STATE.userAllRoles     = resolved.allRoles;
    STATE.userTopRoleLabel = resolved.topRoleLabel;
    if (resolved.deptHeadDept) STATE.deptHeadDept = resolved.deptHeadDept;

    STATE.user         = { email, name: userName };
    STATE.role         = resolved.portalRole;
    STATE.selectedRole = resolved.portalRole;
    launchApp();

  } catch(err) {
    console.error('PIN login error:', err);
    showErr('Connection error. Please check your internet and try again.');
  }
}

// ── Vendor / Sub-Contractor login ──
let _vendorType = 'vendor';
function showVendorLogin() { document.getElementById('vendorLoginModal').style.display = 'flex'; selectVendorType('vendor'); }
function hideVendorLogin() { document.getElementById('vendorLoginModal').style.display = 'none'; document.getElementById('vl-error').style.display = 'none'; }
function selectVendorType(type) {
  _vendorType = type;
  ['vendor','sc'].forEach(t => {
    const el = document.getElementById('vl-' + t + '-btn');
    if (el) { el.style.borderColor = type === t ? '#1a6038' : '#dde8e2'; el.style.background = type === t ? '#e8f5ee' : '#f7faf8'; }
  });
  document.getElementById('vl-id-label').textContent = type === 'vendor' ? 'Vendor ID' : 'Sub-Contractor ID';
  document.getElementById('vl-id-input').placeholder = type === 'vendor' ? 'e.g. VEN001' : 'e.g. SC001';
}
async function verifyVendorLogin() {
  const id    = (document.getElementById('vl-id-input').value || '').trim().toUpperCase();
  const email = (document.getElementById('vl-email-input').value || '').trim().toLowerCase();
  const errEl = document.getElementById('vl-error');
  errEl.style.display = 'none';
  if (!id || !email) { errEl.textContent = 'Please fill in both fields.'; errEl.style.display = 'block'; return; }
  if (!STATE.mastersLoaded) {
    errEl.textContent = '\u23F3 Loading master data\u2026 please wait.'; errEl.style.display = 'block';
    await loadAllMasters(); errEl.style.display = 'none';
  }
  let record = null;
  if (_vendorType === 'vendor') {
    record = STATE.masters.vendors.find(v => (v.id||'').toUpperCase() === id);
    if (!record) { errEl.textContent = 'Vendor ID "' + id + '" not found in our records.'; errEl.style.display = 'block'; return; }
  } else {
    record = STATE.masters.subcontractors.find(s => (s.id||'').toUpperCase() === id);
    if (!record) { errEl.textContent = 'SC ID "' + id + '" not found in our records.'; errEl.style.display = 'block'; return; }
  }
  STATE.vendorRecord = { ...record, loginEmail: email, type: _vendorType };
  STATE.role = _vendorType; STATE.user = { email, name: record.name || id };
  document.getElementById('vendorLoginModal').style.display = 'none';
  launchApp();
}



// ── DEV MODE ──────────────────────────────────────────────
function toggleDevMode() {
  STATE.isDevMode = !STATE.isDevMode;
  document.body.classList.toggle('dev-mode', STATE.isDevMode);
  applyRoleNavRestrictions(STATE.role);
  const btn = document.getElementById('devModeToggleBtn');
  if (btn) btn.title = STATE.isDevMode ? 'Dev Mode ON — click to exit' : 'Toggle Dev Mode';
  // Show a brief toast
  const toast = document.createElement('div');
  toast.textContent = STATE.isDevMode ? '⚙ Dev Mode ON — WIP items visible' : '✓ Dev Mode OFF — Live items only';
  toast.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:${STATE.isDevMode ? 'rgba(240,165,0,.95)' : 'rgba(26,96,56,.95)'};
    color:${STATE.isDevMode ? '#1a2e1a' : '#fff'};
    padding:9px 20px;border-radius:8px;font-size:.8rem;font-weight:600;
    z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.3);pointer-events:none;`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function applyDevModeUI() {
  // Show Dev Mode toggle for md role OR AT00xx employee ref (admin accounts)
  const btn = document.getElementById('devModeToggleBtn');
  const isMdRole  = STATE.role === 'md';
  const isAdminEmail = (STATE.user?.email || '').toLowerCase().includes('admin@evgcpl') ||
                       (STATE.user?.email || '').toLowerCase().includes('neurolooom');
  if (btn) btn.style.display = (isMdRole || isAdminEmail) ? '' : 'none';
  document.body.classList.toggle('dev-mode', STATE.isDevMode);
  // Re-apply nav restrictions with current dev mode state
  applyRoleNavRestrictions(STATE.role);
}

function getDefaultPage(role) {
  if (role === 'dept_head') {
    const dept = (STATE.deptHeadDept || '').toLowerCase();
    if (/supply|scm|procure|purchase/i.test(dept)) return 'scm';
    if (/hr|human/i.test(dept))                     return 'hr-dashboard';
    if (/finance|account/i.test(dept))              return 'accounts';
    if (/site|civil|operation|project/i.test(dept)) return 'site-manager';
    if (/safety|hse/i.test(dept))                   return 'safety';
    if (/plan/i.test(dept))                         return 'planning';
    return 'dashboard';
  }
  if (role === 'employee') return 'my-profile';
  if (role === 'hr')       return 'hr-dashboard';
  if (role === 'purchase')  return 'scm';
  if (role === 'accounts')  return 'accounts';
  if (role === 'site')      return 'site-manager';
  return 'dashboard';
}

function launchApp() {
  const r = ROLES[STATE.role] || ROLES.employee;
  const _roleLabel = STATE.role === 'dept_head' && STATE.deptHeadDept
    ? 'Dept Head – ' + STATE.deptHeadDept
    : r.label;
  document.getElementById('roleBadge').textContent     = r.badge;
  document.getElementById('userName').textContent      = STATE.user?.name || 'User';
  document.getElementById('userRoleLabel').textContent = _roleLabel;
  document.getElementById('userAvatar').textContent    = r.avatar;
  const isExternal = STATE.role === 'vendor' || STATE.role === 'sc';
  // Nav visibility handled fully by applyRoleNavRestrictions below



  applyPortalConfig();
  applyRoleNavRestrictions(STATE.role);
  applyDevModeUI();
  document.getElementById('loginScreen').classList.add('fade-out');
  setTimeout(() => {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('app').classList.add('show');
    navigate(isExternal ? 'my-portal' : getDefaultPage(STATE.role));
    loadAllMasters().then(() => updateAllMasterUI());
    initNotifications();
  }, 500);
}

function updateAllMasterUI() {
  // Refresh AI chat context bar if open
  if (typeof aiUpdateContext === 'function') aiUpdateContext();
  const activeSites   = getActiveSites();
  const inactiveSites = getInactiveSites();
  const activeUsers   = getActiveUsers();
  const activeAssets  = getActiveAssets();
  const activeVendors = getActiveVendors();
  const activeSCs     = getActiveSCs();

  const totalSites    = STATE.masters.sites.length;
  const totalUsers    = STATE.masters.users.length;
  const totalAssets   = STATE.masters.assets.length;
  const totalVendors  = STATE.masters.vendors.length;

  // Asset top category
  const assetCats = {};
  activeAssets.forEach(a => { assetCats[a.category] = (assetCats[a.category]||0)+1; });
  const topCat = Object.entries(assetCats).sort((a,b)=>b[1]-a[1])[0];

  // Vendor material supply count
  const matSupplyVendors = activeVendors.filter(v => v.type === 'Material Supply').length;

  const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };

  // ── Sites ──
  set('activeSiteCount',   activeSites.length);
  set('activeSiteSub',     `${inactiveSites.length} inactive · ${totalSites} total`);
  set('siteTrend',         `⬤ Live`);
  set('mdActiveSiteCount', activeSites.length);
  set('mdSiteCount',       activeSites.length);

  // ── Users ──
  set('activeUserCount', activeUsers.length);
  set('activeUserSub',   `${totalUsers - activeUsers.length} inactive · ${totalUsers} total`);
  set('userTrend',       `⬤ Live`);

  // ── Assets ──
  set('activeAssetCount', activeAssets.length);
  set('activeAssetSub',   topCat ? `Top: ${topCat[0]} (${topCat[1]}) · ${totalAssets} total` : `${totalAssets} total`);
  set('assetTrend',       `⬤ Live`);

  // ── Vendors ──
  set('activeVendorCount', activeVendors.length);
  set('activeVendorSub',   `${matSupplyVendors} material supply · ${totalVendors} total`);
  set('vendorTrend',       `⬤ Live`);

  // ── Sub-Contractors ──
  set('activeSCCount', activeSCs.length);
  set('activeSCSub',   `${STATE.masters.subcontractors.length - activeSCs.length} inactive · ${STATE.masters.subcontractors.length} total`);
  set('scTrend',       `⬤ Live`);

  // ── MD Command subtitle ──
  const mdSub = document.getElementById('mdCommandSubtitle');
  if (mdSub) mdSub.textContent = `${activeSites.length} active sites · ${activeUsers.length} employees · ${activeAssets.length} equipment units`;

  // ── Status badge ──
  const loaded = [
    STATE.masters.sites.length > 0 ? 'Sites' : null,
    STATE.masters.users.length > 0 ? 'Users' : null,
    STATE.masters.assets.length > 0 ? 'Assets' : null,
    STATE.masters.vendors.length > 0 ? 'Vendors' : null,
    STATE.masters.subcontractors.length > 0 ? 'SCs' : null,
    STATE.masters.materialsTotal > 0 ? 'Materials' : null,
  ].filter(Boolean);
  const badge = document.getElementById('masterStatusBadge');
  if (badge) {
    const allLoaded = loaded.length === 6;
    badge.textContent = allLoaded ? `⬤ Live — ${loaded.length}/6 masters` : `⚠ Partial — ${loaded.join(', ')} loaded`;
    badge.style.background = allLoaded ? '#e8f5e9' : '#fff3e0';
    badge.style.color = allLoaded ? 'var(--g7)' : 'var(--warn)';
  }

  // ── Sites table (dashboard) ──
  const tbody = document.getElementById('sitesTableBody');
  if (tbody) tbody.innerHTML = sitesData();

  // ── MD sites list ──
  const mdCont = document.getElementById('mdSitesContainer');
  if (mdCont) mdCont.innerHTML = allSitesCards();

  // ── Masters Summary widget ──
  const mw = document.getElementById('mastersWidget');
  if (mw) mw.innerHTML = mastersWidget();
}

const updateSiteUI = updateAllMasterUI;



// ══════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════
// ── SORTABLE TABLE UTILITY ────────────────────────────────
// ══════════════════════════════════════════════════════════════
//  UNIVERSAL TABLE UTILITIES — sort, scroll, CSV, toolbar
//  Applies to: .emp-table .vpi-tbl .data-table .sites-table
// ══════════════════════════════════════════════════════════════

function makeTableSortable(table) {
  if (!table || table._sortable) return;
  table._sortable = true;
  const ths = table.querySelectorAll('thead th');
  ths.forEach((th, colIdx) => {
    if (!th.querySelector('.sort-arrow')) {
      const arr = document.createElement('span');
      arr.className = 'sort-arrow';
      arr.innerHTML = ' &#8597;';
      th.appendChild(arr);
    }
    th.dataset.sortDir = '0';
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const dir = th.dataset.sortDir === '1' ? -1 : 1;
      ths.forEach(t => {
        t.dataset.sortDir = '0';
        t.classList.remove('sort-asc','sort-desc');
        const a = t.querySelector('.sort-arrow');
        if (a) a.innerHTML = ' &#8597;';
      });
      th.dataset.sortDir = String(dir);
      th.classList.add(dir === 1 ? 'sort-asc' : 'sort-desc');
      const arr = th.querySelector('.sort-arrow');
      if (arr) arr.innerHTML = dir === 1 ? ' &#9650;' : ' &#9660;';
      const tbody = table.querySelector('tbody');
      if (!tbody) return;
      const rows = Array.from(tbody.querySelectorAll('tr'));
      rows.sort((a, b) => {
        const av = (a.cells[colIdx]?.textContent || '').trim();
        const bv = (b.cells[colIdx]?.textContent || '').trim();
        const an = parseFloat(av.replace(/[^0-9.-]/g,''));
        const bn = parseFloat(bv.replace(/[^0-9.-]/g,''));
        if (!isNaN(an) && !isNaN(bn)) return (an - bn) * dir;
        // Try date parse
        const ad = new Date(av), bd = new Date(bv);
        if (!isNaN(ad) && !isNaN(bd)) return (ad - bd) * dir;
        return av.localeCompare(bv, 'en-IN') * dir;
      });
      rows.forEach(r => tbody.appendChild(r));
    });
  });
}

function exportTableCSV(table, filename) {
  if (!table) return;
  const rows = [];
  const ths = table.querySelectorAll('thead th');
  const headers = [];
  ths.forEach(th => {
    // Strip sort arrows from header text
    const clone = th.cloneNode(true);
    clone.querySelectorAll('.sort-arrow').forEach(a => a.remove());
    headers.push('"' + clone.textContent.trim().replace(/"/g, '""') + '"');
  });
  rows.push(headers.join(','));
  table.querySelectorAll('tbody tr').forEach(tr => {
    const cells = [];
    tr.querySelectorAll('td').forEach(td => cells.push('"' + td.textContent.trim().replace(/"/g,'""') + '"'));
    if (cells.length) rows.push(cells.join(','));
  });
  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = (filename || 'export') + '.csv';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function wrapTableScroll(table, title) {
  if (!table || table.dataset.wrapped) return;
  table.dataset.wrapped = 'true';
  const parent = table.parentElement;
  if (!parent) return;

  const container = document.createElement('div');
  container.className = 'tbl-outer';

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'tbl-toolbar';
  const left = document.createElement('div');
  left.className = 'tbl-toolbar-left';

  // Row count badge
  const rowCount = table.querySelectorAll('tbody tr').length;
  const badge = document.createElement('span');
  badge.className = 'tbl-row-badge';
  badge.id = 'tbl-badge-' + Math.random().toString(36).slice(2);
  badge.textContent = rowCount + ' record' + (rowCount !== 1 ? 's' : '');
  badge.style.cssText = 'font-size:.72rem;color:var(--txt3);font-weight:500';
  left.appendChild(badge);
  table._rowBadgeId = badge.id;

  // CSV button
  const csvBtn = document.createElement('button');
  csvBtn.className = 'tbl-csv-btn';
  csvBtn.innerHTML = '&#8681; CSV';
  csvBtn.title = 'Download as CSV';
  const tblRef = table;
  const pageTitle = title || document.querySelector('#mainContent h1')?.textContent?.trim()?.replace(/[^a-zA-Z0-9]/g,'_') || 'export';
  csvBtn.addEventListener('click', () => exportTableCSV(tblRef, pageTitle));
  left.appendChild(csvBtn);

  toolbar.appendChild(left);
  container.appendChild(toolbar);

  // Scroll wrapper
  const scroll = document.createElement('div');
  scroll.className = 'tbl-wrap';
  parent.insertBefore(container, table);
  scroll.appendChild(table);
  container.appendChild(scroll);
}

// Update row count badge after dynamic data loads
function updateTableBadge(table) {
  if (!table || !table._rowBadgeId) return;
  const badge = document.getElementById(table._rowBadgeId);
  if (!badge) return;
  const count = table.querySelectorAll('tbody tr').length;
  badge.textContent = count + ' record' + (count !== 1 ? 's' : '');
}

function applyTableFeatures() {
  const selector = '#mainContent .emp-table, #mainContent .vpi-tbl, #mainContent .data-table, #mainContent .sites-table';
  document.querySelectorAll(selector).forEach(t => {
    makeTableSortable(t);
    wrapTableScroll(t);
  });
}

const applyTableSort = applyTableFeatures;



// ════════════════════════════════════════════════════════════════
//  SCHEDULED REPORTS CONFIG
// ════════════════════════════════════════════════════════════════
const SCHED_KEY = 'evgcpl_sched_report_cfg';
function schedLoad() { try { return JSON.parse(localStorage.getItem(SCHED_KEY)||'{}'); } catch(e) { return {}; } }
function schedPersist(cfg) { localStorage.setItem(SCHED_KEY, JSON.stringify(cfg)); }

function schedRestoreUI() {
  const cfg = schedLoad();
  if (!cfg) return;
  const set = (id, val) => { const el = document.getElementById(id); if(el && val) el.value = val; };
  set('schedDay', cfg.day); set('schedTime', cfg.time);
  set('schedType', cfg.type); set('schedActive', cfg.active);
  set('schedSubject', cfg.subject);
  schedRenderRecips(cfg.recipients || []);
}

function schedRenderRecips(list) {
  const el = document.getElementById('schedRecipList');
  if (!el) return;
  if (!list.length) { el.innerHTML = '<span style="font-size:.72rem;color:var(--txt3)">No recipients added yet</span>'; return; }
  el.innerHTML = list.map(email =>
    `<span style="display:inline-flex;align-items:center;gap:.3rem;background:var(--g9);color:#fff;padding:3px 10px 3px 8px;border-radius:20px;font-size:.72rem">
      &#128100; ${email}
      <button onclick="schedRemoveRecip('${email}')" style="background:none;border:none;cursor:pointer;color:rgba(255,255,255,.6);font-size:.8rem;padding:0;line-height:1">&times;</button>
    </span>`).join('');
}

function schedGetRecips() { return (schedLoad().recipients || []); }

function schedAddRecip() {
  const inp = document.getElementById('schedRecipInput');
  if (!inp) return;
  const email = inp.value.trim().toLowerCase();
  if (!email || !email.includes('@')) { inp.style.borderColor='#dc2626'; setTimeout(()=>inp.style.borderColor='',1500); return; }
  const cfg = schedLoad();
  cfg.recipients = [...new Set([...(cfg.recipients||[]), email])];
  schedPersist(cfg);
  schedRenderRecips(cfg.recipients);
  inp.value = '';
}

function schedRemoveRecip(email) {
  const cfg = schedLoad();
  cfg.recipients = (cfg.recipients||[]).filter(e => e !== email);
  schedPersist(cfg);
  schedRenderRecips(cfg.recipients);
}

function schedPickFromEmployees() {
  const users = (STATE.masters?.users||[]).filter(u => u.status==='ACTIVE' && u.email);
  if (!users.length) { alert('Employee data not loaded yet. Please wait and try again.'); return; }
  const existing = schedGetRecips();
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
  modal.innerHTML = `
    <div style="background:var(--surface1,#fff);border-radius:14px;width:100%;max-width:520px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4)">
      <div style="padding:1rem 1.2rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
        <h3 style="font-size:.95rem;font-weight:700;color:var(--g9);margin:0">&#128100; Pick Recipients</h3>
        <button onclick="this.closest('[style*=position:fixed]').remove()" style="background:none;border:none;cursor:pointer;font-size:1.3rem;color:var(--txt3)">&times;</button>
      </div>
      <div style="padding:.7rem 1.2rem;border-bottom:1px solid var(--border)">
        <input id="schedEmpSearch" type="text" placeholder="Search name, dept, site..."
          style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:7px;font-size:.8rem;font-family:inherit;background:var(--surface2);color:var(--txt)"
          oninput="document.querySelectorAll('.sched-emp-row').forEach(r=>{r.style.display=this.value&&!r.textContent.toLowerCase().includes(this.value.toLowerCase())?'none':''})">
      </div>
      <div style="overflow-y:auto;flex:1;padding:.4rem 0">
        ${users.map(u => `
          <label class="sched-emp-row" style="display:flex;align-items:center;gap:.7rem;padding:.5rem 1.2rem;cursor:pointer;border-bottom:1px solid var(--surface2)">
            <input type="checkbox" value="${u.email}" ${existing.includes((u.email||'').toLowerCase())?'checked':''}
              style="width:15px;height:15px;accent-color:var(--g7);flex-shrink:0">
            <div style="flex:1;min-width:0">
              <div style="font-size:.82rem;font-weight:600;color:var(--txt)">${u.name||u.email}</div>
              <div style="font-size:.7rem;color:var(--txt3)">${u.email} &middot; ${u.dept||''} &middot; ${u.site||''}</div>
            </div>
          </label>`).join('')}
      </div>
      <div style="padding:.8rem 1.2rem;border-top:1px solid var(--border);display:flex;gap:.6rem;justify-content:flex-end">
        <button onclick="this.closest('[style*=position:fixed]').remove()" class="btn btn-secondary btn-sm">Cancel</button>
        <button class="btn btn-sm" style="background:var(--g7);color:#fff" onclick="
          const m=this.closest('[style*=position\:fixed]');
          const cfg=schedLoad();
          cfg.recipients=[...new Set([...(cfg.recipients||[]),...[...m.querySelectorAll('input[type=checkbox]:checked')].map(c=>c.value.toLowerCase())])];
          schedPersist(cfg); schedRenderRecips(cfg.recipients); m.remove();">
          &#10003; Confirm
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function schedSave() {
  const cfg = schedLoad();
  cfg.day     = document.getElementById('schedDay')?.value    || 'daily';
  cfg.time    = document.getElementById('schedTime')?.value   || '08:00';
  cfg.type    = document.getElementById('schedType')?.value   || 'daily';
  cfg.active  = document.getElementById('schedActive')?.value || 'active';
  cfg.subject = document.getElementById('schedSubject')?.value|| 'EVGCPL Daily Digest';
  cfg.savedAt = new Date().toISOString();
  schedPersist(cfg);
  const row = [new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}),
    cfg.day, cfg.time, cfg.type, cfg.active, cfg.subject, (cfg.recipients||[]).join(', ')];
  fetch(APPS_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'text/plain'},
    body:JSON.stringify({action:'appendRow',sheetId:PIN_SHEET_ID,tab:'ReportConfig',row})
  }).catch(()=>{});
  const st=document.getElementById('schedSaveStatus');
  if(st){st.style.display='inline';setTimeout(()=>st.style.display='none',2500);}
}

function schedTestSend() {
  const cfg = schedLoad();
  const recipients = cfg.recipients || [];
  if (!recipients.length) { alert('Add at least one recipient first.'); return; }
  const btn = event?.currentTarget || event?.target;
  if (btn) { btn.textContent = 'Sending...'; btn.disabled = true; }
  fetch(APPS_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'text/plain'},
    body:JSON.stringify({
      action:'triggerReport',
      subject:(cfg.subject||'EVGCPL Daily Digest') + ' — TEST',
      to:recipients.join(','),
      type:cfg.type||'daily',
    })
  })
  .then(r=>r.json())
  .then(d=>{
    if(btn){btn.innerHTML='&#9992;&#65039; Send Test Now';btn.disabled=false;}
    alert(d.success ? 'Test sent to: '+recipients.join(', ') : 'Error: '+d.message);
  })
  .catch(()=>{
    if(btn){btn.innerHTML='&#9992;&#65039; Send Test Now';btn.disabled=false;}
  });
}



// ════════════════════════════════════════════════════════════════
//  REPORT SCHEDULER — per-report schedule config
//  Each report in REPORT_CATALOGUE can have its own schedule.
//  Config stored in localStorage keyed by report ID.
// ════════════════════════════════════════════════════════════════

const RPT_SCHED_KEY = 'evgcpl_rpt_schedules'; // { reportId: { ...cfg } }

function rptSchedLoadAll() {
  try { return JSON.parse(localStorage.getItem(RPT_SCHED_KEY) || '{}'); } catch(e) { return {}; }
}
function rptSchedLoad(id) { return rptSchedLoadAll()[id] || null; }
function rptSchedSave(id, cfg) {
  const all = rptSchedLoadAll();
  all[id] = { ...cfg, updatedAt: new Date().toISOString() };
  localStorage.setItem(RPT_SCHED_KEY, JSON.stringify(all));
}
function rptSchedDelete(id) {
  const all = rptSchedLoadAll();
  delete all[id];
  localStorage.setItem(RPT_SCHED_KEY, JSON.stringify(all));
}

// Status bar under the filter panel
function rptRefreshScheduleBar() {
  const id  = _rptSelectedId;
  const cfg = id ? rptSchedLoad(id) : null;
  const st  = document.getElementById('rpt-sched-status');
  const sb  = document.getElementById('rpt-sched-sub');
  if (!st || !sb) return;
  if (!cfg || !cfg.active || cfg.active === 'off') {
    st.textContent = 'Not scheduled';
    st.style.color = 'var(--txt3)';
    sb.textContent = 'Configure a schedule to auto-email this report';
  } else {
    const dayLabel = { daily:'Every day', 1:'Mon', 2:'Tue', 3:'Wed', 4:'Thu', 5:'Fri', 6:'Sat', 0:'Sun' }[cfg.day] || cfg.day;
    const recips = (cfg.recipients || []).length;
    st.textContent = '✅ Scheduled — ' + dayLabel + ' at ' + (cfg.time || '08:00') + ' IST';
    st.style.color = 'var(--g7)';
    const filterSummary = cfg.filters && Object.keys(cfg.filters).length
      ? ' · Filters: ' + Object.entries(cfg.filters).map(([k,v]) => k.replace('status_','') + '=' + v).join(', ')
      : '';
    sb.textContent = 'Sending to ' + recips + ' recipient' + (recips !== 1 ? 's' : '')
      + filterSummary;
  }
}

// Open per-report schedule modal
function rptOpenSchedule() {
  const id = _rptSelectedId;
  if (!id) return;
  const report = REPORT_CATALOGUE.find(r => r.id === id);
  if (!report) return;
  const cfg  = rptSchedLoad(id) || {};
  const users = (STATE.masters?.users || []).filter(u => u.status === 'ACTIVE' && u.email);
  const existingRecips = cfg.recipients || [];
  const savedFilters   = cfg.filters    || {};

  // ── Build filter options from master data ────────────────
  const sites   = (STATE.masters.sites  ||[]).filter(s=>s.status==='ACTIVE').map(s=>s.name);
  const vendors = (STATE.masters.vendors||[]).map(v=>v.name||v.id||'').filter(Boolean).slice(0,100);
  const depts   = [...new Set((STATE.masters.users||[]).map(u=>u.dept).filter(Boolean))].sort();
  const cats    = [...new Set((STATE.masters.assets||[]).map(a=>a.category).filter(Boolean))].sort();
  const fySet   = getFYSet();

  const makeSchedFilter = (key, label, options, allLabel='All') => {
    const saved = savedFilters[key] || '';
    return `<div>
      <div style="font-size:.72rem;font-weight:700;color:var(--txt2);margin-bottom:.25rem;text-transform:uppercase;letter-spacing:.04em">${label}</div>
      <select id="rsf-${key}" style="width:100%;padding:6px 8px;border:1.5px solid var(--border);border-radius:7px;font-size:.8rem;font-family:inherit;background:var(--surface2);color:var(--txt)">
        <option value="">${allLabel}</option>
        ${options.map(o=>`<option value="${o}" ${saved===o?'selected':''}>${o}</option>`).join('')}
      </select>
    </div>`;
  };

  // Build the filters section for this report
  let filterHtml = '';
  const ff = report.filters || [];
  if (ff.length) {
    const cells = [];
    if (ff.includes('site'))       cells.push(makeSchedFilter('site',      'Site',            sites));
    if (ff.includes('vendor'))     cells.push(makeSchedFilter('vendor',    'Vendor',          vendors));
    if (ff.includes('status_mrs')) cells.push(makeSchedFilter('status_mrs','Status',          ['Pending','Approved','Rejected','Dropped']));
    if (ff.includes('status_po'))  cells.push(makeSchedFilter('status_po', 'Status',          ['Pending Approval','Approved','Rejected']));
    if (ff.includes('status_inv')) cells.push(makeSchedFilter('status_inv','Status',          ['Pending','Paid']));
    if (ff.includes('fy'))         cells.push(makeSchedFilter('fy',        'Financial Year',  fySet, 'All FY'));
    if (ff.includes('dept'))       cells.push(makeSchedFilter('dept',      'Department',      depts));
    if (ff.includes('category'))   cells.push(makeSchedFilter('category',  'Category',        cats));
    if (ff.includes('ownhire'))    cells.push(makeSchedFilter('ownhire',   'Own / Hire',      ['Own','Hire']));
    if (ff.includes('period'))     cells.push(makeSchedFilter('period',    'Period',          ['Last 30 days','Last 60 days','Last 90 days','Last 180 days'],'Last 90 days'));

    filterHtml = `
      <div>
        <div style="font-size:.75rem;font-weight:700;color:var(--txt2);margin-bottom:.4rem;text-transform:uppercase;letter-spacing:.04em">
          &#127989;&#65039; Report Filters <span style="font-size:.65rem;font-weight:400;color:var(--txt3)">(applied when email is generated)</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:.5rem;padding:.8rem;background:var(--surface2);border-radius:8px;border:1px solid var(--border)">
          ${cells.join('')}
        </div>
      </div>`;
  }

  const freqOpts = [
    ['off','Off (Disabled)'],['daily','Every Day'],
    ['1','Every Monday'],['2','Every Tuesday'],['3','Every Wednesday'],
    ['4','Every Thursday'],['5','Every Friday'],['6','Every Saturday'],['0','Every Sunday'],
  ];

  const modal = document.createElement('div');
  modal.id = 'rptSchedModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;overflow-y:auto';

  modal.innerHTML = `
    <div style="background:var(--surface1,#fff);border-radius:14px;width:100%;max-width:600px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.4)">

      <!-- Header -->
      <div style="padding:1rem 1.2rem;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:.7rem;flex-shrink:0">
        <span style="font-size:1.3rem">📅</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:.95rem;font-weight:700;color:var(--g9)">${report.name}</div>
          <div style="font-size:.72rem;color:var(--txt3)">${report.desc}</div>
        </div>
        <button onclick="document.getElementById('rptSchedModal').remove()"
          style="background:none;border:none;cursor:pointer;font-size:1.3rem;color:var(--txt3);line-height:1;flex-shrink:0">&times;</button>
      </div>

      <!-- Scrollable body -->
      <div style="overflow-y:auto;flex:1;padding:1.1rem;display:flex;flex-direction:column;gap:.9rem">

        <!-- Schedule row: Frequency + Time + Subject -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">
          <div>
            <div style="font-size:.75rem;font-weight:700;color:var(--txt2);margin-bottom:.3rem;text-transform:uppercase;letter-spacing:.04em">Frequency</div>
            <select id="rptSchedDay" style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:.83rem;font-family:inherit;background:var(--surface2);color:var(--txt)">
              ${freqOpts.map(([v,l]) => `<option value="${v}" ${(cfg.day||'off')===v?'selected':''}>${l}</option>`).join('')}
            </select>
          </div>
          <div>
            <div style="font-size:.75rem;font-weight:700;color:var(--txt2);margin-bottom:.3rem;text-transform:uppercase;letter-spacing:.04em">Time (IST)</div>
            <input id="rptSchedTime" type="time" value="${cfg.time||'08:00'}"
              style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:.83rem;font-family:inherit;background:var(--surface2);color:var(--txt)">
          </div>
        </div>

        <!-- Subject -->
        <div>
          <div style="font-size:.75rem;font-weight:700;color:var(--txt2);margin-bottom:.3rem;text-transform:uppercase;letter-spacing:.04em">Email Subject</div>
          <input id="rptSchedSubject" type="text" value="${cfg.subject || 'EVGCPL — ' + report.name.replace(/^[^\s]+ /,'')}"
            style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:.83rem;font-family:inherit;background:var(--surface2);color:var(--txt)">
        </div>

        <!-- Report Filters -->
        ${filterHtml}

        <!-- Recipients -->
        <div>
          <div style="font-size:.75rem;font-weight:700;color:var(--txt2);margin-bottom:.4rem;text-transform:uppercase;letter-spacing:.04em">Recipients</div>
          <div style="display:flex;gap:.5rem;margin-bottom:.5rem;flex-wrap:wrap">
            <input id="rptSchedRecipInput" type="email" placeholder="Type email and press Enter..."
              style="flex:1;min-width:180px;padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:.82rem;font-family:inherit;background:var(--surface2);color:var(--txt)"
              onkeydown="if(event.key==='Enter'){event.preventDefault();rptSchedAddRecip()}">
            <button onclick="rptSchedAddRecip()" class="btn btn-secondary btn-sm">+ Add</button>
          </div>
          ${users.length ? `
          <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:.5rem">
            <div style="padding:.45rem .8rem;background:var(--surface2);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:.5rem">
              <span style="font-size:.7rem;font-weight:700;color:var(--txt3)">PICK FROM TEAM</span>
              <input id="rptSchedEmpSearch" type="text" placeholder="Search name / dept / site..."
                style="flex:1;padding:3px 8px;border:1px solid var(--border);border-radius:5px;font-size:.75rem;font-family:inherit;background:var(--surface1,#fff);color:var(--txt)"
                oninput="document.querySelectorAll('.rse-row').forEach(r=>{r.style.display=this.value&&!r.dataset.txt.includes(this.value.toLowerCase())?'none':''})">
            </div>
            <div style="max-height:160px;overflow-y:auto">
              ${users.slice(0,100).map(u => `
                <label class="rse-row" data-txt="${((u.name||'')+(u.email||'')+(u.dept||'')+(u.site||'')).toLowerCase()}"
                  style="display:flex;align-items:center;gap:.6rem;padding:.4rem .8rem;border-bottom:1px solid var(--surface2);cursor:pointer">
                  <input type="checkbox" value="${(u.email||'').toLowerCase()}"
                    ${existingRecips.includes((u.email||'').toLowerCase())?'checked':''}
                    style="width:14px;height:14px;accent-color:var(--g7);flex-shrink:0"
                    onchange="rptSchedToggleRecip('${(u.email||'').toLowerCase()}', this.checked)">
                  <div style="flex:1;min-width:0;overflow:hidden">
                    <span style="font-size:.79rem;font-weight:600;color:var(--txt)">${u.name||u.email}</span>
                    <span style="font-size:.67rem;color:var(--txt3);margin-left:.35rem">${u.dept||''}</span>
                  </div>
                  <span style="font-size:.64rem;color:var(--txt3);white-space:nowrap;max-width:110px;overflow:hidden;text-overflow:ellipsis">${u.site||''}</span>
                </label>`).join('')}
            </div>
          </div>` : ''}
          <div id="rptSchedRecipTags" style="display:flex;flex-wrap:wrap;gap:.3rem;min-height:22px">
            ${existingRecips.map(email => `
              <span style="display:inline-flex;align-items:center;gap:.25rem;background:var(--g9);color:#fff;padding:2px 8px 2px 7px;border-radius:20px;font-size:.7rem">
                ${email}
                <button onclick="rptSchedRemoveRecip('${email}')" style="background:none;border:none;cursor:pointer;color:rgba(255,255,255,.65);font-size:.85rem;padding:0;line-height:1">&times;</button>
              </span>`).join('')}
          </div>
        </div>

      </div>

      <!-- Footer -->
      <div style="padding:.85rem 1.2rem;border-top:1px solid var(--border);display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;flex-shrink:0">
        <button onclick="rptSchedConfirm('${id}')" class="btn" style="background:var(--g7);color:#fff;font-size:.83rem;padding:.45rem 1.1rem">
          &#128190; Save Schedule
        </button>
        <button onclick="rptSchedTestSend('${id}')" class="btn btn-secondary btn-sm">
          &#9992;&#65039; Send Test Now
        </button>
        <button onclick="rptSchedDisable('${id}')" class="btn btn-secondary btn-sm" style="margin-left:auto;color:#dc2626;border-color:#fca5a5">
          &#128683; Disable
        </button>
      </div>
    </div>`;

  window._rptSchedTmpRecips = [...existingRecips];
  document.body.appendChild(modal);
}

function rptSchedAddRecip() {
  const inp = document.getElementById('rptSchedRecipInput');
  if (!inp) return;
  const email = inp.value.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    inp.style.borderColor = '#dc2626';
    setTimeout(() => inp.style.borderColor = '', 1500);
    return;
  }
  rptSchedToggleRecip(email, true);
  inp.value = '';
}

function rptSchedToggleRecip(email, add) {
  if (!window._rptSchedTmpRecips) window._rptSchedTmpRecips = [];
  if (add) {
    if (!window._rptSchedTmpRecips.includes(email)) window._rptSchedTmpRecips.push(email);
  } else {
    window._rptSchedTmpRecips = window._rptSchedTmpRecips.filter(e => e !== email);
  }
  rptSchedRenderTags();
}

function rptSchedRemoveRecip(email) {
  rptSchedToggleRecip(email, false);
  // Uncheck checkbox if visible
  const cb = document.querySelector(`.rse-row input[value="${email}"]`);
  if (cb) cb.checked = false;
}

function rptSchedRenderTags() {
  const el = document.getElementById('rptSchedRecipTags');
  if (!el) return;
  const list = window._rptSchedTmpRecips || [];
  el.innerHTML = list.length === 0
    ? '<span style="font-size:.7rem;color:var(--txt3)">No recipients selected</span>'
    : list.map(email => `
      <span style="display:inline-flex;align-items:center;gap:.25rem;background:var(--g9);color:#fff;padding:2px 8px 2px 7px;border-radius:20px;font-size:.7rem">
        ${email}
        <button onclick="rptSchedRemoveRecip('${email}')" style="background:none;border:none;cursor:pointer;color:rgba(255,255,255,.65);font-size:.85rem;padding:0;line-height:1">&times;</button>
      </span>`).join('');
}

function rptSchedConfirm(reportId) {
  const day     = document.getElementById('rptSchedDay')?.value    || 'off';
  const time    = document.getElementById('rptSchedTime')?.value   || '08:00';
  const subject = document.getElementById('rptSchedSubject')?.value|| '';
  const recipients = window._rptSchedTmpRecips || [];

  // Capture all filter values from modal
  const report  = REPORT_CATALOGUE.find(r => r.id === reportId);
  const filters = {};
  (report?.filters || []).forEach(fkey => {
    const el = document.getElementById('rsf-' + fkey);
    if (el && el.value) filters[fkey] = el.value;
  });

  const cfg = { day, time, subject, filters, recipients, active: day === 'off' ? 'off' : 'on' };
  rptSchedSave(reportId, cfg);

  // Push config row to Apps Script → ReportSchedules tab
  const filterStr = Object.entries(filters).map(([k,v]) => k+'='+v).join('; ');
  const row = [
    new Date().toLocaleString('en-IN', {timeZone:'Asia/Kolkata'}),
    reportId,
    report?.name || reportId,
    day, time, subject,
    recipients.join(', '),
    filterStr || 'None',
    day === 'off' ? 'Disabled' : 'Active',
    JSON.stringify(filters), // store full filter JSON for Apps Script
  ];
  fetch(APPS_SCRIPT_URL, {
    method:'POST', headers:{'Content-Type':'text/plain'},
    body: JSON.stringify({ action:'appendRow', sheetId: PIN_SHEET_ID, tab:'ReportSchedules', row })
  }).catch(() => {});

  document.getElementById('rptSchedModal')?.remove();
  rptRefreshScheduleBar();
}

function rptSchedDisable(reportId) {
  rptSchedDelete(reportId);
  // Also tell Apps Script so the sheet row stops firing.
  // Append a "Disabled" row — runSchedules_ uses LATEST row per reportId,
  // so this overrides any prior Active rows without needing row deletion.
  const report = REPORT_CATALOGUE.find(r => r.id === reportId);
  const row = [
    new Date().toLocaleString('en-IN', {timeZone:'Asia/Kolkata'}),
    reportId,
    report?.name || reportId,
    'off', '', '', '', 'None', 'Disabled', '{}',
  ];
  fetch(APPS_SCRIPT_URL, {
    method:'POST', headers:{'Content-Type':'text/plain'},
    body: JSON.stringify({ action:'appendRow', sheetId: PIN_SHEET_ID, tab:'ReportSchedules', row })
  }).catch(() => {});
  document.getElementById('rptSchedModal')?.remove();
  rptRefreshScheduleBar();
}

function rptSchedTestSend(reportId) {
  const recipients = window._rptSchedTmpRecips || [];
  if (!recipients.length) { alert('Add at least one recipient first.'); return; }
  const subject = (document.getElementById('rptSchedSubject')?.value || 'EVGCPL Report') + ' — TEST';
  const btn = document.querySelector('#rptSchedModal button[onclick*="TestSend"]');
  if (btn) { btn.textContent = 'Sending...'; btn.disabled = true; }
  // Capture filter values from modal if still open
  const _tReport = REPORT_CATALOGUE.find(r => r.id === reportId);
  const _tFilters = {};
  (_tReport?.filters||[]).forEach(fkey => {
    const el = document.getElementById('rsf-' + fkey);
    if (el && el.value) _tFilters[fkey] = el.value;
  });
  // Fallback to saved filters if modal filters not found
  const _savedCfg = rptSchedLoad(reportId) || {};
  const _filters = Object.keys(_tFilters).length ? _tFilters : (_savedCfg.filters || {});

  fetch(APPS_SCRIPT_URL, {
    method:'POST', headers:{'Content-Type':'text/plain'},
    body: JSON.stringify({ action:'triggerReport', to: recipients.join(','), subject, reportId, filters: _filters })
  })
  .then(r => r.json())
  .then(d => {
    if (btn) { btn.innerHTML = '&#9992;&#65039; Send Test Now'; btn.disabled = false; }
    alert(d.success ? '✅ Test sent to: ' + recipients.join(', ') : '❌ Error: ' + d.message);
  })
  .catch(() => { if (btn) { btn.innerHTML = '&#9992;&#65039; Send Test Now'; btn.disabled = false; } });
}


// ════════════════════════════════════════════════════════════════
//  SCHEDULE DIAGNOSTICS (Reports → 🛠️ Schedule Diagnostics)
//  Admin/MD only. Verifies scheduledDailyReport.gs is wired up
//  in the Apps Script project — without waiting for the next
//  hourly trigger. Pairs with /home/claude/work/scheduledDailyReport.gs
// ════════════════════════════════════════════════════════════════

// Show count of active per-report schedules from localStorage
function rptSchedRefreshSummary() {
  const el = document.getElementById('rpt-sched-diag-summary');
  if (!el) return;
  const all = rptSchedLoadAll();
  const active = Object.entries(all).filter(([_, c]) => c && c.active === 'on');
  if (!active.length) {
    el.innerHTML = '<span style="color:var(--txt3)">No active schedules configured. '
      + 'Pick a report and click <b>📅 Schedule Report</b> to create one.</span>';
    return;
  }
  el.innerHTML = '<b>' + active.length + '</b> active schedule'
    + (active.length !== 1 ? 's' : '') + ': '
    + active.map(([id, c]) => {
        const r = REPORT_CATALOGUE.find(x => x.id === id);
        const name = r ? r.name.replace(/^[^\s]+\s/, '') : id;
        return '<span style="display:inline-block;padding:2px 8px;margin:2px;background:#e8f5e9;'
          + 'border-radius:10px;font-size:.7rem;color:#0d3320">'
          + name + ' @ ' + (c.time || '?') + '</span>';
      }).join('');
}

// Force-run all active schedules via Apps Script (bypasses trigger time-match)
function rptSchedRunNow() {
  const btn = document.getElementById('rptSchedRunBtn');
  const out = document.getElementById('rpt-sched-diag-output');
  if (!out) return;
  if (btn) { btn.textContent = 'Running…'; btn.disabled = true; }
  out.innerHTML = '<div style="padding:.7rem 1rem;background:#fff8e1;border-radius:8px;'
    + 'font-size:.78rem;color:#7c5c00">⏳ Forcing all active schedules to run now…</div>';

  fetch(APPS_SCRIPT_URL, {
    method:'POST', headers:{'Content-Type':'text/plain'},
    body: JSON.stringify({ action:'runSchedulesNow' })
  })
  .then(r => r.json())
  .then(d => {
    if (btn) { btn.textContent = '🔄 Run Schedules Now'; btn.disabled = false; }
    if (!d || d.success === false) {
      out.innerHTML = '<div style="padding:.7rem 1rem;background:#ffebee;border-radius:8px;'
        + 'font-size:.78rem;color:#c62828"><b>❌ Error:</b> ' + (d?.message || 'Unknown error')
        + '<br><br><b>Most likely cause:</b> the <code>runSchedulesNow</code> action isn\'t wired '
        + 'into your Apps Script <code>doPost()</code>. Open your Apps Script project, paste the '
        + '<code>scheduledDailyReport.gs</code> file from this delivery, and add this case to your '
        + 'doPost switch:<br><pre style="background:#fff;padding:.5rem;border-radius:6px;margin-top:.4rem;font-size:.72rem">case \'runSchedulesNow\': return jsonOut_(forceRunSchedules());</pre>'
        + '</div>';
      return;
    }
    const summary = '<b>Ran:</b> ' + (d.ran || 0)
      + ' &nbsp; <b>Skipped:</b> ' + (d.skipped || 0)
      + ' &nbsp; <b>Errors:</b> ' + (d.errors || 0);
    const detailHtml = (d.details || []).length
      ? '<div style="margin-top:.5rem;font-size:.74rem;color:var(--txt2)"><b>Details:</b><ul style="margin:.2rem 0 0 1.2rem;padding:0">'
          + d.details.map(line => '<li style="margin:.15rem 0">' + line + '</li>').join('') + '</ul></div>'
      : '';
    const bg = d.errors > 0 ? '#ffebee' : (d.ran > 0 ? '#e8f5e9' : '#fff8e1');
    const txt = d.errors > 0 ? '#c62828' : (d.ran > 0 ? '#0d3320' : '#7c5c00');
    out.innerHTML = '<div style="padding:.7rem 1rem;background:' + bg + ';border-radius:8px;font-size:.78rem;color:' + txt + '">'
      + (d.ran > 0 ? '✅' : (d.errors > 0 ? '❌' : '⚠️')) + ' ' + summary + detailHtml + '</div>';
  })
  .catch(err => {
    if (btn) { btn.textContent = '🔄 Run Schedules Now'; btn.disabled = false; }
    out.innerHTML = '<div style="padding:.7rem 1rem;background:#ffebee;border-radius:8px;'
      + 'font-size:.78rem;color:#c62828">❌ Network error: ' + (err?.message || err) + '</div>';
  });
}

// Fetch and display recent ScheduleLog rows
function rptSchedViewLog() {
  const btn = document.getElementById('rptSchedLogBtn');
  const out = document.getElementById('rpt-sched-diag-output');
  if (!out) return;
  if (btn) { btn.textContent = 'Loading…'; btn.disabled = true; }
  out.innerHTML = '<div style="padding:.7rem 1rem;background:#f5f5f5;border-radius:8px;font-size:.78rem;color:var(--txt3)">⏳ Fetching last 30 log entries…</div>';

  fetch(APPS_SCRIPT_URL + '?action=getScheduleLog&limit=30', { method:'GET' })
  .then(r => r.json())
  .then(d => {
    if (btn) { btn.textContent = '📋 View Schedule Log'; btn.disabled = false; }
    if (!d || !d.success) {
      // Fallback to POST in case GET dispatcher doesn't have getScheduleLog
      return fetch(APPS_SCRIPT_URL, {
        method:'POST', headers:{'Content-Type':'text/plain'},
        body: JSON.stringify({ action:'getScheduleLog', limit:30 })
      }).then(r => r.json());
    }
    return d;
  })
  .then(d => {
    if (!d || !d.success) {
      out.innerHTML = '<div style="padding:.7rem 1rem;background:#ffebee;border-radius:8px;font-size:.78rem;color:#c62828">'
        + '❌ <b>Could not fetch log.</b> Add this case to your Apps Script <code>doPost()</code>:'
        + '<pre style="background:#fff;padding:.5rem;border-radius:6px;margin-top:.4rem;font-size:.72rem">case \'getScheduleLog\': return jsonOut_(getScheduleLog_(p.limit || 30));</pre>'
        + '</div>';
      return;
    }
    const rows = d.rows || [];
    if (!rows.length) {
      out.innerHTML = '<div style="padding:.7rem 1rem;background:#fff8e1;border-radius:8px;font-size:.78rem;color:#7c5c00">'
        + '📭 Log is empty. Either the trigger has never fired, or no schedules are active. '
        + 'Click <b>🔄 Run Schedules Now</b> above to force a run.</div>';
      return;
    }
    const statusColor = s => s === 'SENT' ? '#16a34a' : s === 'ERROR' ? '#dc2626' : s === 'SUMMARY' ? '#2563eb' : '#888';
    out.innerHTML = '<div style="overflow:auto;max-height:360px;border:1px solid var(--border);border-radius:8px">'
      + '<table class="data-table" style="margin:0;font-size:.74rem">'
      + '<thead><tr><th>Time (IST)</th><th>Report</th><th>Status</th><th>Recipients</th><th>Message</th></tr></thead>'
      + '<tbody>'
      + rows.map(r => '<tr>'
          + '<td style="white-space:nowrap;color:var(--txt2)">' + escapeHtml_(r.ts) + '</td>'
          + '<td style="font-weight:600">' + escapeHtml_(r.reportId) + '</td>'
          + '<td><span style="padding:1px 7px;border-radius:8px;color:#fff;font-size:.66rem;font-weight:700;background:' + statusColor(r.status) + '">' + escapeHtml_(r.status) + '</span></td>'
          + '<td style="color:var(--txt2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml_(r.to) + '">' + escapeHtml_(r.to) + '</td>'
          + '<td style="color:var(--txt2);max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml_(r.message) + '">' + escapeHtml_(r.message) + '</td>'
        + '</tr>').join('')
      + '</tbody></table></div>';
  })
  .catch(err => {
    if (btn) { btn.textContent = '📋 View Schedule Log'; btn.disabled = false; }
    out.innerHTML = '<div style="padding:.7rem 1rem;background:#ffebee;border-radius:8px;font-size:.78rem;color:#c62828">❌ ' + (err?.message || err) + '</div>';
  });
}

// Tiny helper since the portal doesn't have a global one
function escapeHtml_(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}


// ── ROLE-BASED NAV RESTRICTIONS ──────────────────────────
// Route sets per role (live items; dev items need devMode ON)

// ════════════════════════════════════════════════════════════════
//  ROLE HIERARCHY RESOLVER
//  Reads ALL roles from "Role (User Type)" column (may be
//  comma / pipe / newline separated).
//  Hierarchy: MD > Admin > Process Owner > Recruiter >
//             Department Head > RM > Site-In-Charge > User
//  Returns { portalRole, deptHeadDept, allRoles, topRoleLabel }
// ════════════════════════════════════════════════════════════════
const ROLE_HIERARCHY = [
  { rank: 8, match: r => /\bmd\b|director|managing director/i.test(r),              portal: 'md',        label: 'MD / Director' },
  { rank: 7, match: r => /\badmin\b|administrator/i.test(r),                        portal: 'md',        label: 'Admin' },
  { rank: 6, match: r => /process owner/i.test(r),                                   portal: 'md',        label: 'Process Owner' },
  { rank: 5, match: r => /recruiter|talent acquisition/i.test(r),                    portal: 'hr',        label: 'Recruiter' },
  { rank: 4, match: r => /department head|dept head|dept\.? head/i.test(r),         portal: 'dept_head', label: 'Department Head' },
  { rank: 3, match: r => /\brm\b|reporting manager/i.test(r),                       portal: 'site',      label: 'RM' },
  { rank: 2, match: r => /site.?in.?charge|site incharge|site manager/i.test(r),     portal: 'site',      label: 'Site-In-Charge' },
  { rank: 1, match: r => /\bhr\b|human resource/i.test(r),                          portal: 'hr',        label: 'HR' },
  { rank: 1, match: r => /purchase|procurement/i.test(r),                             portal: 'purchase',  label: 'Purchase' },
  { rank: 1, match: r => /account/i.test(r),                                          portal: 'accounts',  label: 'Accounts' },
  { rank: 0, match: r => /\buser\b|employee|staff/i.test(r) || r.trim() !== '',     portal: 'employee',  label: 'User' },
];

function resolveRoleFromEmployee(emp) {
  if (!emp) return { portalRole: 'employee', deptHeadDept: '', allRoles: [], topRoleLabel: 'User' };

  const rawRole = emp.role || '';
  const dept    = (emp.dept || '').toLowerCase().trim();

  // Split on comma, pipe, semicolon, or newline — an employee may have multiple role entries
  const roleTokens = rawRole.split(/[,|;\n]+/).map(s => s.trim()).filter(Boolean);

  // Score each token against the hierarchy — keep the best match per token
  let best = { rank: -1, portal: 'employee', label: 'User' };
  let deptHeadDept = '';
  const matchedLabels = [];

  roleTokens.forEach(token => {
    for (const entry of ROLE_HIERARCHY) {
      if (entry.match(token)) {
        matchedLabels.push(entry.label);
        if (entry.rank > best.rank) {
          best = entry;
          // Extract dept from "Department Head - SCM" style tokens
          if (entry.portal === 'dept_head') {
            deptHeadDept = token.replace(/department head\s*[-–]?\s*/i, '').trim()
                               || dept.split(' ').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
          }
        }
        break; // first matching tier wins for this token
      }
    }
  });

  // If no token matched anything meaningful, fall back to dept-based mapping
  if (best.rank <= 0) {
    if (/supply chain|scm|procurement|purchase/i.test(dept))  best = { rank:1, portal:'purchase',  label:'Purchase' };
    else if (/\bhr\b|human resource/i.test(dept))            best = { rank:1, portal:'hr',         label:'HR' };
    else if (/account|finance/i.test(dept))                   best = { rank:1, portal:'accounts',  label:'Accounts' };
    else if (/site|civil|operation/i.test(dept))              best = { rank:1, portal:'site',      label:'Site' };
  }

  // Special override: AT00xx empCode = admin = md
  if ((emp.empCode || '').toUpperCase().startsWith('AT')) {
    best = { rank: 7, portal: 'md', label: 'Admin' };
  }

  return {
    portalRole:    best.portal,
    deptHeadDept:  deptHeadDept || (best.portal === 'dept_head' ? deptDisp(dept) : ''),
    allRoles:      [...new Set(matchedLabels)],
    topRoleLabel:  best.label,
  };
}

function deptDisp(d) {
  return d.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function applyResolvedRole(resolved) {
  STATE.role = resolved.portalRole;
  if (resolved.deptHeadDept) STATE.deptHeadDept = resolved.deptHeadDept;
  const r = ROLES[resolved.portalRole] || ROLES.employee;
  const badge = document.getElementById('roleBadge');
  const label = document.getElementById('userRoleLabel');
  const avatar = document.getElementById('userAvatar');
  if (badge)  badge.textContent  = r.badge;
  if (label)  label.textContent  = STATE.role === 'dept_head' && STATE.deptHeadDept
                                     ? 'Dept Head – ' + STATE.deptHeadDept
                                     : r.label;
  if (avatar) avatar.textContent = r.avatar;
}

const ROLE_ROUTES = {
  md:        new Set(['dashboard','md-command','hr-dashboard','personal','my-profile','policies','recruitment','site-manager','safety','equipment','store','plant','scm','mrs','stores','vendor','accounts','planning','planning-overview','planning-setup','execution','plant','budget','project-setup','boq-planning','measurement-book','log-entry','asset-verification','asset-maintenance','dev-mode','settings','reports','my-documents','rewards','apps','wall','plant-log','plant-verify','plant-maintenance','budgeting']),
  hr:        new Set(['dashboard','hr-dashboard','personal','my-profile','policies','recruitment','rewards','reports','my-documents','apps','wall','planning','planning-overview','planning-setup','execution','budget','project-setup','boq-planning','measurement-book','plant','plant-log','plant-verify','plant-maintenance','budgeting']),
  site:      new Set(['dashboard','my-profile','safety','site-manager','store','scm','mrs','stores','recruitment','my-documents','apps','wall','execution','plant','planning-overview','planning-setup','plant-log','plant-verify','plant-maintenance','budgeting']),
  purchase:  new Set(['dashboard','my-profile','scm','mrs','stores','vendor','reports','my-documents','apps','wall','planning','planning-overview','execution','budget','boq-planning','planning-setup','plant','plant-log','plant-verify','plant-maintenance','budgeting']),
  accounts:  new Set(['dashboard','my-profile','accounts','planning','planning-overview','planning-setup','budget','project-setup','boq-planning','measurement-book','reports','my-documents','apps','rewards','wall','execution','plant','plant-log','plant-verify','plant-maintenance','budgeting']),
  employee:  new Set(['dashboard','my-profile','my-documents','accounts','policies','rewards','apps','wall','planning-overview','execution','planning-setup','plant','plant-log','plant-verify','plant-maintenance','budgeting']),
  dept_head: null,   // built dynamically from DEPT_HEAD_ROUTES below
  vendor:    new Set(['my-portal','my-orders','my-invoices','my-documents']),
  sc:        new Set(['my-portal','my-orders','my-invoices','my-documents']),
};
// Dept -> allowed routes for Department Heads (col W value after "Department Head - ")
const DEPT_HEAD_ROUTES = {
  // HR
  'hr':                        new Set(['dashboard','hr-dashboard','my-profile','policies','recruitment','rewards','reports','my-documents','apps']),
  'human resources':           new Set(['dashboard','hr-dashboard','my-profile','policies','recruitment','rewards','reports','my-documents','apps']),
  // Finance / Accounts
  'finance':                   new Set(['dashboard','accounts','my-profile','reports','my-documents','wall','rewards','budgeting','execution']),
  'accounts':                  new Set(['dashboard','accounts','my-profile','reports','my-documents','wall','rewards','budgeting','execution']),
  'finance & accounts':        new Set(['dashboard','accounts','my-profile','reports','my-documents','budgeting','execution']),
  // SCM / Purchase / Procurement
  'supply chain management':   new Set(['dashboard','scm','mrs','stores','vendor','accounts','my-profile','reports','my-documents','apps','rewards','wall']),
  'scm':                       new Set(['dashboard','scm','mrs','stores','vendor','accounts','my-profile','reports','my-documents','apps','rewards','wall']),
  'procurement':               new Set(['dashboard','scm','mrs','stores','vendor','accounts','my-profile','reports','my-documents','apps','rewards','wall']),
  'purchase':                  new Set(['dashboard','scm','mrs','stores','vendor','accounts','my-profile','reports','my-documents','apps','rewards','wall']),
  'supply chain':              new Set(['dashboard','scm','mrs','stores','vendor','accounts','my-profile','reports','my-documents','apps','rewards','wall']),
  // Site / Operations / Civil
  'operations':                new Set(['dashboard','site-manager','safety','equipment','store','scm','mrs','my-profile','reports','my-documents','wall','rewards','budgeting','execution']),
  'site':                      new Set(['dashboard','site-manager','safety','equipment','store','scm','mrs','my-profile','reports','my-documents','wall','rewards','budgeting','execution']),
  'civil':                     new Set(['dashboard','site-manager','safety','equipment','store','scm','mrs','my-profile','reports','my-documents','wall','rewards','budgeting','execution']),
  'project':                   new Set(['dashboard','site-manager','safety','equipment','store','scm','mrs','my-profile','reports','my-documents','wall','rewards','budgeting','execution']),
  // Safety / HSE
  'safety':                    new Set(['dashboard','safety','site-manager','my-profile','reports','my-documents','wall','rewards']),
  'hse':                       new Set(['dashboard','safety','site-manager','my-profile','reports','my-documents','wall','rewards']),
  // Planning / Engineering
  'planning':                  new Set(['dashboard','planning','scm','mrs','my-profile','reports','my-documents','wall','rewards','budgeting','execution']),
  'engineering':               new Set(['dashboard','site-manager','planning','scm','my-profile','reports','my-documents','wall','rewards','budgeting','execution']),
  // Admin / IT / Other
  'administration':            new Set(['dashboard','hr-dashboard','my-profile','policies','reports','my-documents','wall','rewards']),
  'admin':                     new Set(['dashboard','hr-dashboard','my-profile','policies','reports','my-documents','wall','rewards']),
  'it':                        new Set(['dashboard','my-profile','reports','my-documents','wall','rewards']),
};
function getRouteSet(role) {
  if (role === 'dept_head') {
    const dept = (STATE.deptHeadDept || '').toLowerCase().trim();
    // Exact match first
    if (DEPT_HEAD_ROUTES[dept]) return DEPT_HEAD_ROUTES[dept];
    // Fuzzy match — find first key that is contained in dept or vice versa
    const keys = Object.keys(DEPT_HEAD_ROUTES);
    const fuzzy = keys.find(k => dept.includes(k) || k.includes(dept));
    if (fuzzy) return DEPT_HEAD_ROUTES[fuzzy];
    // Fallback: derive from dept keywords
    if (/supply|scm|procure|purchase/i.test(dept))   return DEPT_HEAD_ROUTES['scm'];
    if (/hr|human/i.test(dept))                       return DEPT_HEAD_ROUTES['hr'];
    if (/finance|account/i.test(dept))                return DEPT_HEAD_ROUTES['finance'];
    if (/site|civil|operation|project/i.test(dept))   return DEPT_HEAD_ROUTES['operations'];
    if (/safety|hse/i.test(dept))                     return DEPT_HEAD_ROUTES['safety'];
    if (/plan|engineer/i.test(dept))                  return DEPT_HEAD_ROUTES['planning'];
    return new Set(['dashboard','my-profile','my-documents']);
  }
  return ROLE_ROUTES[role] || ROLE_ROUTES.employee;
}
function applyRoleNavRestrictions(role) {
  const isExternal    = role === 'vendor' || role === 'sc';
  const isMd          = role === 'md';
  const allowedRoutes = getRouteSet(role);

  // ── SIDEBAR (mobile) ─────────────────────────────────────────
  document.querySelectorAll('[data-internal="true"]').forEach(s => s.style.display = isExternal ? 'none' : '');
  const vendorSec = document.getElementById('nav-vendor-section');
  if (vendorSec) vendorSec.style.display = isExternal ? '' : 'none';
  const rptSection = document.getElementById('nav-reports-section');
  if (rptSection) rptSection.style.display = isExternal ? 'none' : '';
  document.querySelectorAll('.nav-item[onclick]').forEach(el => {
    const m = (el.getAttribute('onclick') || '').match(/navigate\('([^']+)'\)/);
    if (!m) return;
    const route = m[1];
    const isDev = el.getAttribute('data-status') === 'dev';
    if (isDev) { el.style.display = (STATE.isDevMode && isMd) ? '' : 'none'; return; }
    el.style.display = allowedRoutes.has(route) ? '' : 'none';
  });
  document.querySelectorAll('.sidebar-section').forEach(section => {
    if (section.id === 'nav-vendor-section') return;
    const items = section.querySelectorAll('.nav-item[onclick]');
    if (!items.length) return;
    const hasVisible = Array.from(items).some(el => el.style.display !== 'none');
    if (!isExternal) section.style.display = hasVisible ? '' : 'none';
  });
  const devSec = document.getElementById('nav-devmode-section');
  if (devSec) devSec.style.display = isMd ? '' : 'none';
  const devBadge = document.getElementById('devModeSidebarBadge');
  if (devBadge) { devBadge.textContent = STATE.isDevMode ? 'ON' : 'OFF'; devBadge.style.background = STATE.isDevMode ? 'rgba(240,165,0,.35)' : 'rgba(240,165,0,.15)'; }

  // ── TOP NAV (desktop) ─────────────────────────────────────────
  const topNav = document.getElementById('topNav');
  if (!topNav) return;
  topNav.style.display = isExternal ? 'none' : '';
  if (isExternal) return;

  const tnavCmd = document.getElementById('tnav-md-command');
  if (tnavCmd) tnavCmd.style.display = 'none'; // merged into Dashboard for MD
  const tnavDev = document.getElementById('tnav-devmode-group');
  if (tnavDev) tnavDev.style.display = isMd ? '' : 'none';
  const tnavDevBadge = document.getElementById('tnavDevBadge');
  if (tnavDevBadge) tnavDevBadge.textContent = STATE.isDevMode ? 'ON' : 'OFF';

  // Per-item visibility in dropdowns
  topNav.querySelectorAll('.tnav-item[data-route]').forEach(el => {
    const route = el.dataset.route;
    const isDev = el.dataset.status === 'dev';
    if (isDev) { el.style.display = (STATE.isDevMode && isMd) ? '' : 'none'; return; }
    el.style.display = allowedRoutes.has(route) ? '' : 'none';
  });
  // Solo nav buttons
  topNav.querySelectorAll('.tnav-btn.solo[data-route]').forEach(btn => {
    const route = btn.dataset.route;
    if (route === 'md-command') return;
    btn.closest('.tnav-group').style.display = allowedRoutes.has(route) ? '' : 'none';
  });
  // Hide groups where all dropdown items hidden
  topNav.querySelectorAll('.tnav-group').forEach(group => {
    if (group.id === 'tnav-md-command' || group.id === 'tnav-devmode-group') return;
    if (group.querySelector('.tnav-btn.solo[data-route]')) return;
    const items = group.querySelectorAll('.tnav-item[data-route]');
    if (!items.length) return;
    const hasVisible = Array.from(items).some(el => el.style.display !== 'none');
    group.style.display = hasVisible ? '' : 'none';
  });
  if (role === 'site') {
    topNav.querySelectorAll('[data-role-section-hide="site"]').forEach(g => { g.style.display = 'none'; });
  }
}


// Routes accessible by vendor/SC external users ONLY
const EXTERNAL_ROUTES = new Set(['my-portal','my-orders','my-invoices']);

function navigate(page) {
  // ── ROLE GUARD: enforce allowed routes per role ──
  const isExternal = STATE.role === 'vendor' || STATE.role === 'sc';
  const _allowed = getRouteSet(STATE.role);
  if (isExternal && !EXTERNAL_ROUTES.has(page)) {
    page = 'my-portal';
  } else if (!isExternal && STATE.role !== 'md' && _allowed && !_allowed.has(page)) {
    // Non-MD accessing a page not in their route set: redirect to dashboard or my-profile
    page = _allowed.has('dashboard') ? 'dashboard' : 'my-profile';
  }

  STATE.currentPage = page;
  // Update active nav
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const activeEl = document.querySelector(`.nav-item[onclick="navigate('${page}')"]`);
  if (activeEl) activeEl.classList.add('active');
  // Top nav active highlight
  document.querySelectorAll('#topNav .tnav-item, #topNav .tnav-btn.solo').forEach(el => el.classList.remove('nav-active'));
  const tnavItem = document.querySelector(`#topNav .tnav-item[data-route="${page}"]`);
  if (tnavItem) tnavItem.classList.add('nav-active');
  const tnavSolo = document.querySelector(`#topNav .tnav-btn.solo[data-route="${page}"]`);
  if (tnavSolo) tnavSolo.classList.add('nav-active');
  // Update mobile nav
  document.querySelectorAll('.mob-nav-item').forEach(el => el.classList.remove('active'));
  // Close sidebar on mobile
  if (window.innerWidth <= 900) closeSidebar();
  // Render page
  renderPage(page);
  window.scrollTo(0,0);
}

function renderPage(page) {
  const el = document.getElementById('mainContent');
  try {
  const pages = {
    'dashboard':      renderDashboard,
    'md-command':     renderMDCommand,
    'onboarding':     renderOnboardingPortal,
    'recruitment':    renderRecruitmentModule,
    'hr-dashboard':   renderHRDashboard,
    'my-profile':     renderMyProfile,
    'personal':       () => renderAppSheetEmbed('Personal Dashboard','Your personal workspace — tasks, leave, payslips & more', 'personal'),
    'rewards':        renderRewardsModule,
    'apps':           renderAppsHub,
    'sheets':         renderSheetsHub,
    'wall':           renderRewardsModule, // wall merged into rewards
    'policies':       () => renderPolicyHub(),
    'site-manager':   renderSiteManager,
    'safety':         renderSafetyModule,
    'equipment':      renderEquipmentModule,
    'store':          renderStoreModule,
    'scm':            renderSCMDashboard,
    'mrs':            renderMRSDashboard,
    'stores':         renderProcurementStores,
    'purchase':       renderPurchaseDashboard,
    'vendor':         renderVendorPortalInternal,
    'subcontractor':  () => renderPlaceholder('🤝','Subcontractor Portal (Internal)','SC management for procurement team','Coming in Phase 8'),
    'tendering':      () => renderPlaceholder('📜','Tendering','Client bid management, BOQ uploads & tender register','Coming in Phase 4'),
    'accounts':       renderAccountsModule,
    'planning':          () => navigate('budgeting'),
    'planning-overview': () => navigate('budgeting'),
    'planning-setup':    () => navigate('budgeting'),
    'execution':         () => renderExecutionPage(),
    // Planning section sub-routes
    'budget':            () => navigate('budgeting'),
    'project-setup':     () => navigate('budgeting'),
    'boq-planning':      () => navigate('budgeting'),
    'budgeting':         renderBudgetingPage,
    // Plant & Machinery section sub-routes
    'plant':             renderPlantMachineryPage,
    'plant-log':         () => renderPlantPage('log'),
    'plant-verify':      () => renderPlantPage('verify'),
    'plant-maintenance': () => renderPlantPage('maintenance'),
    'log-entry':         () => renderPlantMachineryPage('log-entry'),
    'asset-verification':() => renderPlantMachineryPage('verification'),
    'asset-maintenance': () => renderPlantMachineryPage('maintenance'),
    'dev-mode':       renderDevModePage,
    'settings':       renderSettingsPage,
    'reports':        renderReportsModule,
    // Vendor / SC external portal routes
    'my-portal':      renderExternalPortal,
    'my-orders':      renderVendorPOTracker,
    'my-invoices':    renderVendorInvoices,
    'my-documents':   () => renderMyDocuments(),
  };
  (pages[page] || renderDashboard)();
  // Refresh live master data into DOM after render
  if (STATE.mastersLoaded) updateAllMasterUI();
  // Apply sortable + pagination to all tables in the rendered page
  setTimeout(applyTableFeatures, 80);
  setTimeout(() => document.querySelectorAll('[data-wrapped]').forEach(t => updateTableBadge(t)), 300);
  setTimeout(() => { applyTableFeatures(); document.querySelectorAll('[data-wrapped]').forEach(t => updateTableBadge(t)); }, 800); // second pass catches lazy-loaded tables + refreshes badges
  } catch(err) {
    console.error('renderPage error:', err);
    el.innerHTML = `<div style="padding:2rem;background:#fff3cd;border:1px solid #ffc107;border-radius:12px;margin:1rem">
      <h3 style="color:#856404;margin-bottom:.5rem">⚠️ Render Error</h3>
      <p style="color:#856404;font-size:.85rem">Page: <strong>${page}</strong><br/>Error: ${err.message}</p>
      <button onclick="navigate('dashboard')" style="margin-top:1rem;padding:8px 18px;background:#1a6038;color:#fff;border:none;border-radius:8px;cursor:pointer">← Back to Dashboard</button>
    </div>`;
  }
}

// ══════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
//  EMPLOYEE / DEPT HEAD PERSONALISED DASHBOARD
//  Shows: Profile summary · Salary · Team · Dept-specific KPIs
//  SCM/Purchase: POs · MRS · Stores · Payments
//  HR: headcount · new joiners · leave
//  Accounts/Finance: payments summary
//  Site/Operations: sites · safety · equipment
// ════════════════════════════════════════════════════════════════
function renderEmployeeDashboard() {
  const el = document.getElementById('mainContent');
  if (!el) return;

  // Wait for masters
  if (!STATE.mastersLoaded) {
    el.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--txt3)">⏳ Loading your dashboard…</div>`;
    loadAllMasters().then(() => renderEmployeeDashboard());
    return;
  }

  const now   = new Date();
  const hour  = now.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const email = STATE.user?.email || '';

  // Find employee record
  let emp = STATE.masters.users.find(u => u.email && email && u.email.toLowerCase() === email.toLowerCase());


  const dept     = (emp?.dept || STATE.deptHeadDept || '').toLowerCase().trim();
  const deptDisp = emp?.dept || STATE.deptHeadDept || 'My Department';
  const isDeptHead = STATE.role === 'dept_head';

  // Determine dept type for KPI section
  const isSCM     = dept.includes('supply chain') || dept.includes('scm') || dept.includes('procurement') || dept.includes('purchase')
                  || STATE.role === 'purchase'
                  || (STATE.role === 'dept_head' && (
                       (STATE.deptHeadDept||'').toLowerCase().includes('supply')
                    || (STATE.deptHeadDept||'').toLowerCase().includes('scm')
                    || (STATE.deptHeadDept||'').toLowerCase().includes('procurement')
                    || (STATE.deptHeadDept||'').toLowerCase().includes('purchase')
                  ));
  const isHR      = dept.includes('hr') || dept.includes('human');
  const isFinance = dept.includes('finance') || dept.includes('accounts');
  const isOps     = dept.includes('site') || dept.includes('operations') || dept.includes('civil');
  const isSafety  = dept.includes('safety') || dept.includes('hse');

  // My team (reportees)
  const myCode  = (emp?.empCode || '').toUpperCase().trim();
  const myName  = (emp?.name    || '').toLowerCase().trim();
  const myEmail = (emp?.email   || STATE.user?.email || '').toLowerCase().trim();
  const reportees = (STATE.masters.users || []).filter(u => {
    if (u.status !== 'ACTIVE') return false;
    // managerCode: extracted EGxxx prefix from "EGxxx|Name" format in Reporting Manager column
    const mCode = (u.managerCode || '').toUpperCase().trim();
    // manager: the name part after the pipe (or full value if no pipe)
    const mName = (u.manager || '').toLowerCase().trim();
    // Also check siteICCode — site manager sees their site employees
    const sCode = (u.siteICCode || '').toUpperCase().trim();
    // Match on: EG code match, name match, or site IC code match
    const codeMatch = myCode && (mCode === myCode || sCode === myCode);
    const nameMatch = myName.length > 2 && (
      mName === myName ||
      mName.includes(myName.split(' ')[0]) // first name match as fallback
    );
    return codeMatch || nameMatch;
  });

  // Dept colleagues count
  const deptColleagues = deptDisp
    ? (STATE.masters.users || []).filter(u => u.status === 'ACTIVE' && (u.dept||'').toLowerCase() === dept && u.empCode !== myCode)
    : [];

  // Photo
  const photoKey   = `evg_photo_${emp?.empCode || ''}`;
  const savedPhoto = localStorage.getItem(photoKey);
  const avatarHtml = savedPhoto
    ? `<img src="${savedPhoto}" alt="Photo" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
    : `<span style="font-size:2rem;font-weight:700;color:#fff">${(emp?.name||'?').charAt(0)}</span>`;

  // Salary band display (from grade — actual CTC not in sheet but grade implies band)


  // Format date
  function fmtDate(v) {
    const d = parseGvizDate ? parseGvizDate(v) : new Date(v);
    if (!d || isNaN(d.getTime()) || d.getTime() === 0) return '—';
    return d.toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric'});
  }

  // ── Render shell immediately, load dept data async ────────────
  el.innerHTML = `
    <div style="max-width:1200px">

      <!-- Greeting row -->
      <div class="time-widget" style="margin-bottom:1.4rem">
        <div>
          <div class="tw-greeting">${greet}, ${emp?.name?.split(' ')[0] || 'Team'} 👋</div>
          <div class="tw-sub">Evergreen Enterprises &middot; ${now.toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>
        </div>
        <div class="tw-time">
          <div class="tw-clock" id="liveClock2">${now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div>
          <div class="tw-date">IST &middot; Namakkal, TN</div>
        </div>
      </div>

      <!-- ROW 1: Profile + Quick Stats -->
      <div style="display:grid;grid-template-columns:360px 1fr;gap:1.2rem;margin-bottom:1.2rem">

        <!-- Profile Card -->
        <div class="card">
          <div style="background:linear-gradient(135deg,var(--g9),var(--g7));border-radius:var(--rad-lg) var(--rad-lg) 0 0;padding:1.4rem;display:flex;align-items:center;gap:1rem">
            <div style="width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;border:3px solid rgba(255,255,255,.4);overflow:hidden">
              ${avatarHtml}
            </div>
            <div style="min-width:0">
              <div style="font-size:1.1rem;font-weight:700;color:#fff;margin-bottom:.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${emp?.name || STATE.user?.name || 'Employee'}</div>
              <div style="font-size:.78rem;color:rgba(255,255,255,.75)">${emp?.desig || '—'}</div>
              <div style="font-size:.72rem;color:rgba(255,255,255,.6);margin-top:.1rem">${emp?.empCode || ''}</div>
              <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:.4rem">
                ${(STATE.userAllRoles||[resolved?.topRoleLabel||'']).filter(Boolean).map(rl =>
                  `<span style="background:rgba(255,255,255,.18);color:#fff;font-size:.62rem;padding:2px 8px;border-radius:10px;font-weight:600">${rl}</span>`
                ).join('')}
              </div>
            </div>
          </div>
          <div style="padding:1rem">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">
              ${[
                ['🏢', 'Department', deptDisp],
                ['🎯', 'Designation', emp?.desig || '—'],
                ['📊', 'Grade', emp?.grade || '—'],
                ['💼', 'Type', emp?.empType || '—'],
                ['🏗️', 'Site', emp?.site || 'Head Office'],
                ['📅', 'DOJ', fmtDate(emp?.doj)],
                ['👨‍💼', 'Reports To', emp?.manager || '—'],
                ['⭐', 'EG Experience', emp?.expEG ? emp.expEG+' yrs' : '—'],
              ].map(([icon,lbl,val]) => `
                <div style="background:var(--surface2);border-radius:8px;padding:.5rem .7rem">
                  <div style="font-size:.65rem;color:var(--txt3);text-transform:uppercase;letter-spacing:.05em">${icon} ${lbl}</div>
                  <div style="font-size:.82rem;font-weight:600;color:var(--txt);margin-top:.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${val}">${val}</div>
                </div>`).join('')}
            </div>
            <button onclick="navigate('my-profile')" class="btn btn-secondary btn-sm" style="width:100%;margin-top:.8rem;justify-content:center">
              View Full Profile →
            </button>
          </div>
        </div>

        <!-- Right column: Salary + Leave + Team count -->
        <div style="display:flex;flex-direction:column;gap:.9rem">

          <!-- Salary & Leave row -->
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.9rem">
            <div class="card kpi-card info" style="cursor:pointer" onclick="navigate('my-documents')">
              <div class="kpi-top"><div class="kpi-icon blue">💰</div><div class="kpi-trend up">→</div></div>
              <div class="kpi-value">${emp?.grade || '—'}</div>
              <div class="kpi-label">Salary Grade</div>
              <div class="kpi-sub">View Payslip in HR Docs</div>
            </div>
            <div class="card kpi-card" style="cursor:default">
              <div class="kpi-top"><div class="kpi-icon green">🌴</div><div class="kpi-trend up">Live</div></div>
              <div class="kpi-value">${emp?.plBalance || '0'}</div>
              <div class="kpi-label">PL Balance</div>
              <div class="kpi-sub">${emp?.plEligible === 'Yes' ? 'PL Eligible' : 'Check HR'}</div>
            </div>
            <div class="card kpi-card warn" style="cursor:pointer" onclick="navigate('my-documents')">
              <div class="kpi-top"><div class="kpi-icon orange">📄</div><div class="kpi-trend up">Docs</div></div>
              <div class="kpi-value" style="font-size:1.6rem">📁</div>
              <div class="kpi-label">My Documents</div>
              <div class="kpi-sub">Payslips, Salary Breakup</div>
            </div>
          </div>

          <!-- Team / Dept summary -->
          <div class="card" style="flex:1">
            <div class="card-head">
              <h3>👥 ${isDeptHead ? deptDisp + ' Department' : 'My Department'}</h3>
              <span class="hr-stat-pill">${deptColleagues.length + (emp ? 1 : 0)} members</span>
            </div>
            <div class="card-body" style="padding:.8rem">
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem;margin-bottom:.8rem">
                <div style="text-align:center;background:var(--surface2);border-radius:8px;padding:.7rem">
                  <div style="font-size:1.4rem;font-weight:700;color:var(--g7)">${reportees.length}</div>
                  <div style="font-size:.72rem;color:var(--txt3)">Direct Reportees</div>
                </div>
                <div style="text-align:center;background:var(--surface2);border-radius:8px;padding:.7rem">
                  <div style="font-size:1.4rem;font-weight:700;color:var(--g7)">${deptColleagues.length + (emp ? 1 : 0)}</div>
                  <div style="font-size:.72rem;color:var(--txt3)">${deptDisp} Staff</div>
                </div>
                <div style="text-align:center;background:var(--surface2);border-radius:8px;padding:.7rem">
                  <div style="font-size:1.4rem;font-weight:700;color:var(--g7)">${emp?.expEG || emp?.expTotal || '—'}</div>
                  <div style="font-size:.72rem;color:var(--txt3)">Years at EG</div>
                </div>
              </div>
              ${reportees.length > 0 ? `
              <div style="font-size:.72rem;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.4rem">My Team</div>
              <div style="display:flex;flex-direction:column;gap:.3rem;max-height:160px;overflow-y:auto">
                ${reportees.slice(0,8).map(r => `
                <div style="display:flex;align-items:center;gap:.6rem;padding:.35rem .5rem;border-radius:6px;background:var(--surface2)">
                  <div style="width:28px;height:28px;border-radius:7px;background:linear-gradient(135deg,var(--g7),var(--g4));display:flex;align-items:center;justify-content:center;color:#fff;font-size:.72rem;font-weight:700;flex-shrink:0">${(r.name||'?').charAt(0)}</div>
                  <div style="min-width:0;flex:1">
                    <div style="font-size:.78rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name}</div>
                    <div style="font-size:.68rem;color:var(--txt3)">${r.desig || r.dept || '—'}</div>
                  </div>
                  <div style="font-size:.65rem;color:var(--txt3);flex-shrink:0">${r.site?.substring(0,12)||''}</div>
                </div>`).join('')}
                ${reportees.length > 8 ? `<div style="text-align:center;font-size:.72rem;color:var(--txt3);padding:.3rem">+${reportees.length-8} more</div>` : ''}
              </div>` : `<div style="text-align:center;color:var(--txt3);font-size:.82rem;padding:.5rem">No direct reportees found</div>`}
            </div>
          </div>
        </div>
      </div>

      <!-- ROW 2: Department-specific KPIs (loaded async) -->
      <div id="empDeptKpis" style="margin-bottom:1.2rem">
        <div style="text-align:center;padding:2rem;color:var(--txt3);font-size:.85rem">⏳ Loading ${deptDisp} data…</div>
      </div>

      <!-- ROW 3: Dept data tables (loaded async) -->
      <div id="empDeptTables"></div>

    </div>
  `;

  // Live clock
  const clockEl2 = document.getElementById('liveClock2');
  if (clockEl2) {
    setInterval(() => {
      clockEl2.textContent = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    }, 1000);
  }

  // Load department-specific data async
  empLoadDeptData(isSCM, isHR, isFinance, isOps, deptDisp, emp, myCode);
}

// ── Load dept-specific data ───────────────────────────────────────
async function empLoadDeptData(isSCM, isHR, isFinance, isOps, deptDisp, emp, myCode) {
  const kpisEl  = document.getElementById('empDeptKpis');
  const tablesEl = document.getElementById('empDeptTables');
  if (!kpisEl) return;

  try {
    if (isSCM) {
      // ── SCM / Purchase Dashboard ────────────────────────────
      // Load accounts if not already cached (needed for My Payments section)
      if (!(window._accAllRows && window._accAllRows.length)) {
        try {
          const accRaw = await fetchSheet('PaymentRequest', null, PAYMENT_SHEET_ID);
          window._accAllRows = accRaw.map(r => {
            const rawStatus = (r['Approval Status']||r['W']||'').trim();
            const acStat    = (r['Accounts Status']||r['AH']||'').trim();
            const amt       = parseFloat(String(r['Amount']||r['V']||'0').replace(/[^0-9.]/g,''))||0;
            const curr      = r['Currency']||r['U']||'INR';
            const st = (() => {
              const s = (rawStatus||acStat).toLowerCase();
              if (s.includes('approved')||s.includes('paid')||s.includes('complete')) return {cat:'completed',label:'Completed',color:'#059669',bg:'#d1fae5',icon:'✓'};
              if (s.includes('reject')||s.includes('cancel'))  return {cat:'rejected', label:'Rejected', color:'#dc2626',bg:'#fee2e2',icon:'✗'};
              if (s.includes('progress')||s.includes('review')) return {cat:'progress',label:'In Progress',color:'#2563eb',bg:'#dbeafe',icon:'⟳'};
              if (s.includes('pending')||s.includes('submitted')) return {cat:'pending',label:'Pending',color:'#d97706',bg:'#fef3c7',icon:'⏳'};
              return {cat:'other',label:rawStatus||'—',color:'#6b7280',bg:'#f3f4f6',icon:''};
            })();
            return {
              requestId: r['Request ID']||r['A']||'', date: r['Request Date']||r['D']||'',
              initiator: (r['Initiator Name']||r['E']||'').replace(/^EG\w+\|/i,'').trim(),
              empCode:   (r['Name of the Intiator']||r['G']||'').match(/^(EG\w+)\|/i)?.[1]?.toUpperCase()||'',
              payTo:     r['Payment To']||r['G']||'', dept: r['Department']||r['H']||'',
              process:   r['Process']||r['I']||'', site: r['Site Name']||r['K']||'',
              entity:    r['For EG/EVGCPL']||r['L']||'', orderNo: r['Order No']||r['N']||'',
              billNo:    r['Bill No']||r['O']||'', currency: curr, amount: amt,
              narrative: r['Narrative/Comments']||r['X']||'', accDate: r['Accounts Date']||r['AD']||'',
              utr:       r['UTR Details']||r['AE']||'', remarks: r['Remarks']||r['AF']||'',
              rawStatus, status: st,
              _s: [r['A'],r['E'],r['G'],r['H'],r['I'],r['K'],r['N'],r['O'],r['X'],r['AE'],rawStatus].join('|').toLowerCase(),
            };
          });
        } catch(e) { window._accAllRows = []; }
      }

      const [poRows, mrsRows, storeRows] = await Promise.all([
        fetchSheet(PO_TAB, 'SELECT A,E,F,G,R,S,AF,AG,AP,AQ', PO_SHEET_ID).catch(()=>[]),
        fetchSheet('MRS', 'SELECT D,E,F,G,I,J,K,L,N,O,P,U,Y', PO_SHEET_ID).catch(()=>[]),
        fetchSheet('StockIN', 'SELECT A,B,C,D,E,F,G,H,K,N,O', STORES_SHEET_ID).catch(()=>[]),
      ]);

      // PO stats
      const pos = poRows.map(r => ({
        poNo:    r['PO No']      || r['A'] || '',
        date:    r['PO Date']    || r['E'] || '',
        site:    r['Site Name']  || r['S'] || '',
        vendor:  r['Vendor Name']|| r['R'] || '',
        dept:    r['Department'] || r['F'] || '',
        amount:  parseFloat(String(r['Net Amount']||r['AP']||'0').replace(/[^0-9.]/g,''))||0,
        status:  (r['PO Approval Status']||r['AG']||'').trim(),
        category:r['Category']   || r['G'] || '',
      }));

      const totalPOs    = pos.length;
      const pendingPOs  = pos.filter(p => /pending|draft/i.test(p.status)).length;
      const approvedPOs = pos.filter(p => /approved/i.test(p.status)).length;
      const totalAmt    = pos.reduce((s,p)=>s+p.amount,0);
      const recentPOs   = [...pos].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8);

      // MRS stats
      const mrs = mrsRows.map(r => ({
        reqNo:   r['Request No']   || r['D'] || '',
        site:    r['Requested For']|| r['F'] || '',
        item:    r['Item Name']    || r['G'] || '',
        qty:     r['Requested Qty']|| r['I'] || '',
        status:  (r['MRS Status']  || r['N'] || '').trim(),
        date:    r['Request Date'] || r['E'] || '',
      }));
      // MRS tab: K=MR Qty, U=Total Qty; pending when K≠U
      const mrsPending   = mrs.filter(m => {
        const k = parseFloat(m['K'] || m.qty || '0');
        const u = parseFloat(m['U'] || '0');
        return (k > 0 && k !== u) || /pending|open/i.test(m.status);
      }).length;
      const mrsApproved  = mrs.filter(m=>/approved/i.test(m.status)).length;

      // Stock entries
      const totalStockEntries = storeRows.length;

      // My personal payments from accounts
      const myPayments = (window._accAllRows||[]).filter(r =>
        r.empCode === myCode ||
        (r.initiator || '').toLowerCase().includes((emp?.name||'').split(' ')[0].toLowerCase())
      );
      const myPending = myPayments.filter(r=>r.status.cat==='pending');
      const myPaidAmt = myPayments.filter(r=>r.status.cat==='completed').reduce((s,r)=>s+r.amount,0);

      // KPI cards
      kpisEl.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:.9rem;margin-bottom:1rem">
          ${empKpiCard('📋','Total POs', totalPOs, '', 'All time', 'scm')}
          ${empKpiCard('⏳','Pending Approval', pendingPOs, 'warn', 'Awaiting sign-off', 'scm')}
          ${empKpiCard('✅','Approved POs', approvedPOs, 'info', 'Ready to process', 'scm')}
          ${empKpiCard('💰','Total PO Value', '₹'+fmtCr(totalAmt), '', 'Net amount', '')}
          ${empKpiCard('📦','MRS Pending', mrsPending, 'warn', mrsApproved+' approved', 'mrs')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.9rem">
          ${empKpiCard('🏪','Stock IN Entries', totalStockEntries, '', 'Stores register', 'stores')}
          ${empKpiCard('💳','My Payments', myPayments.length, '', myPending.length+' pending', 'accounts')}
          ${empKpiCard('💸','My Paid Amount', '₹'+Math.round(myPaidAmt).toLocaleString('en-IN'), 'info', 'Total disbursed', '')}
          ${empKpiCard('🤝','Active Vendors', (STATE.masters.vendors||[]).length, '', STATE.masters.subcontractors?.length+' SCs', 'vendor')}
        </div>`;

      // Tables
      tablesEl.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.2rem;margin-bottom:1.2rem">
          <!-- Recent POs -->
          <div class="card">
            <div class="card-head">
              <h3>📋 Recent Purchase Orders</h3>
              <button class="btn btn-secondary btn-sm" onclick="navigate('scm')">View All →</button>
            </div>
            <div style="overflow-x:auto;max-height:320px;overflow-y:auto">
              <table class="emp-table" style="width:100%">
                <thead><tr style="background:var(--g9);color:#fff;position:sticky;top:0">
                  <th style="padding:8px 10px;font-weight:600;font-size:.75rem">PO No</th>
                  <th style="padding:8px 10px;font-weight:600;font-size:.75rem">Vendor</th>
                  <th style="padding:8px 10px;font-weight:600;font-size:.75rem">Site</th>
                  <th style="padding:8px 10px;font-weight:600;font-size:.75rem;text-align:right">Amount</th>
                  <th style="padding:8px 10px;font-weight:600;font-size:.75rem">Status</th>
                </tr></thead>
                <tbody>
                  ${recentPOs.map((p,i)=>`<tr style="background:${i%2?'var(--surface2)':''}">
                    <td style="padding:7px 10px;font-size:.78rem;font-family:monospace;color:var(--g7);font-weight:600">${p.poNo||'—'}</td>
                    <td style="padding:7px 10px;font-size:.78rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${p.vendor}">${p.vendor||'—'}</td>
                    <td style="padding:7px 10px;font-size:.78rem;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.site||'—'}</td>
                    <td style="padding:7px 10px;font-size:.78rem;text-align:right;font-weight:600">${p.amount?'₹'+Math.round(p.amount).toLocaleString('en-IN'):'—'}</td>
                    <td style="padding:7px 10px">${empStatusPill(p.status)}</td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- My Personal Payments -->
          <div class="card">
            <div class="card-head">
              <h3>💳 My Payment Requests</h3>
              <button class="btn btn-secondary btn-sm" onclick="navigate('accounts')">View All →</button>
            </div>
            <div style="overflow-x:auto;max-height:320px;overflow-y:auto">
              ${myPayments.length ? `
              <table class="emp-table" style="width:100%">
                <thead><tr style="background:var(--g9);color:#fff;position:sticky;top:0">
                  <th style="padding:8px 10px;font-weight:600;font-size:.75rem">Request ID</th>
                  <th style="padding:8px 10px;font-weight:600;font-size:.75rem">Date</th>
                  <th style="padding:8px 10px;font-weight:600;font-size:.75rem">Process</th>
                  <th style="padding:8px 10px;font-weight:600;font-size:.75rem;text-align:right">Amount</th>
                  <th style="padding:8px 10px;font-weight:600;font-size:.75rem">Status</th>
                </tr></thead>
                <tbody>
                  ${myPayments.slice(0,10).map((p,i)=>`<tr style="background:${i%2?'var(--surface2)':''}">
                    <td style="padding:7px 10px;font-size:.75rem;font-family:monospace;color:var(--g7)">${p.requestId||'—'}</td>
                    <td style="padding:7px 10px;font-size:.75rem">${p.date||'—'}</td>
                    <td style="padding:7px 10px;font-size:.75rem;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.process||'—'}</td>
                    <td style="padding:7px 10px;font-size:.78rem;text-align:right;font-weight:600">${p.amount?'₹'+Math.round(p.amount).toLocaleString('en-IN'):'—'}</td>
                    <td style="padding:7px 10px">${empStatusPill(p.status.label||'')}</td>
                  </tr>`).join('')}
                </tbody>
              </table>` : `<div style="text-align:center;padding:2rem;color:var(--txt3);font-size:.82rem">No personal payment requests found</div>`}
            </div>
          </div>
        </div>

        <!-- MRS table -->
        <div class="card" style="margin-bottom:1.2rem">
          <div class="card-head">
            <h3>📝 Recent MRS — Material Request Slips</h3>
            <button class="btn btn-secondary btn-sm" onclick="navigate('mrs')">View All →</button>
          </div>
          <div style="overflow-x:auto;max-height:280px;overflow-y:auto">
            <table class="emp-table" style="width:100%">
              <thead><tr style="background:var(--g9);color:#fff;position:sticky;top:0">
                <th style="padding:8px 10px;font-weight:600;font-size:.75rem">Request No</th>
                <th style="padding:8px 10px;font-weight:600;font-size:.75rem">Site</th>
                <th style="padding:8px 10px;font-weight:600;font-size:.75rem">Item</th>
                <th style="padding:8px 10px;font-weight:600;font-size:.75rem">Qty</th>
                <th style="padding:8px 10px;font-weight:600;font-size:.75rem">Status</th>
              </tr></thead>
              <tbody>
                ${mrs.slice(0,10).map((m,i)=>`<tr style="background:${i%2?'var(--surface2)':''}">
                  <td style="padding:7px 10px;font-size:.78rem;font-family:monospace;color:var(--g7)">${m.reqNo||'—'}</td>
                  <td style="padding:7px 10px;font-size:.78rem">${m.site||'—'}</td>
                  <td style="padding:7px 10px;font-size:.78rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.item||'—'}</td>
                  <td style="padding:7px 10px;font-size:.78rem;text-align:center">${m.qty||'—'}</td>
                  <td style="padding:7px 10px">${empStatusPill(m.status)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`;

    } else if (isHR) {
      // ── HR Department ────────────────────────────────────────
      const active      = (STATE.masters.users||[]).filter(u=>u.status==='ACTIVE');
      const newJoiners  = active.filter(e=>{
        const d = parseGvizDate(e.doj);
        return d && d.getTime() > 0 && (Date.now()-d.getTime()) < 90*24*60*60*1000;
      });
      const depts = {};
      active.forEach(e=>{ depts[e.dept||'Unknown']=(depts[e.dept||'Unknown']||0)+1; });
      const topDepts = Object.entries(depts).sort((a,b)=>b[1]-a[1]).slice(0,5);

      kpisEl.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.9rem">
          ${empKpiCard('👥','Active Employees',active.length,'','Full headcount','hr-dashboard')}
          ${empKpiCard('🆕','New Joiners (90d)',newJoiners.length,'info','Last 90 days','hr-dashboard')}
          ${empKpiCard('🏗️','Active Sites',(STATE.masters.sites||[]).filter(s=>s.status==='ACTIVE').length,'','Across India','')}
          ${empKpiCard('📋','Policies Hub','View','warn','Company policies','policies')}
        </div>`;
      tablesEl.innerHTML = `
        <div class="card">
          <div class="card-head"><h3>🏢 Department Headcount</h3>
            <button class="btn btn-secondary btn-sm" onclick="navigate('hr-dashboard')">Full HR Dashboard →</button>
          </div>
          <div class="card-body">
            ${topDepts.map(([d,c])=>`
              <div style="display:flex;align-items:center;gap:.8rem;margin-bottom:.6rem">
                <div style="min-width:160px;font-size:.82rem;font-weight:500">${d}</div>
                <div style="flex:1;height:8px;background:var(--surface2);border-radius:4px;overflow:hidden">
                  <div style="height:100%;background:var(--g5);border-radius:4px;width:${Math.round(c/active.length*100)}%"></div>
                </div>
                <div style="min-width:30px;text-align:right;font-size:.82rem;font-weight:700;color:var(--g7)">${c}</div>
              </div>`).join('')}
          </div>
        </div>`;

    } else if (isFinance) {
      // ── Finance / Accounts ───────────────────────────────────
      const accRows = window._accAllRows || [];
      const pending = accRows.filter(r=>r.status.cat==='pending');
      const done    = accRows.filter(r=>r.status.cat==='completed');
      const pAmt    = pending.reduce((s,r)=>s+r.amount,0);
      const dAmt    = done.reduce((s,r)=>s+r.amount,0);
      const myP     = accRows.filter(r=>r.empCode===myCode || (r.initiator||'').toLowerCase().includes((emp?.name||'').split(' ')[0].toLowerCase()));

      kpisEl.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.9rem">
          ${empKpiCard('⏳','Pending Payments',pending.length,'warn','₹'+fmtCr(pAmt),'accounts')}
          ${empKpiCard('✅','Completed',done.length,'info','₹'+fmtCr(dAmt),'accounts')}
          ${empKpiCard('💳','My Requests',myP.length,'','Personal requests','accounts')}
          ${empKpiCard('📊','Total Records',accRows.length,'','All time','accounts')}
        </div>`;
      tablesEl.innerHTML = `
        <div class="card">
          <div class="card-head"><h3>💳 My Payment Requests</h3>
            <button class="btn btn-secondary btn-sm" onclick="navigate('accounts')">Full Accounts →</button>
          </div>
          <div style="overflow-x:auto;max-height:320px;overflow-y:auto">
            ${myP.length ? `<table class="emp-table" style="width:100%">
              <thead><tr style="background:var(--g9);color:#fff;position:sticky;top:0">
                <th style="padding:8px 10px;font-weight:600;font-size:.75rem">Request ID</th>
                <th style="padding:8px 10px;font-weight:600;font-size:.75rem">Date</th>
                <th style="padding:8px 10px;font-weight:600;font-size:.75rem">Process</th>
                <th style="padding:8px 10px;font-weight:600;font-size:.75rem;text-align:right">Amount</th>
                <th style="padding:8px 10px;font-weight:600;font-size:.75rem">Status</th>
              </tr></thead>
              <tbody>${myP.slice(0,15).map((p,i)=>`<tr style="background:${i%2?'var(--surface2)':''}">
                <td style="padding:7px 10px;font-size:.75rem;font-family:monospace;color:var(--g7)">${p.requestId||'—'}</td>
                <td style="padding:7px 10px;font-size:.75rem">${p.date||'—'}</td>
                <td style="padding:7px 10px;font-size:.78rem">${p.process||'—'}</td>
                <td style="padding:7px 10px;font-size:.78rem;text-align:right;font-weight:600">${p.amount?'₹'+Math.round(p.amount).toLocaleString('en-IN'):'—'}</td>
                <td style="padding:7px 10px">${empStatusPill(p.status.label||'')}</td>
              </tr>`).join('')}</tbody>
            </table>` : '<div style="text-align:center;padding:2rem;color:var(--txt3)">No payment requests found for your account</div>'}
          </div>
        </div>`;

    } else {
      // ── Generic / other departments ──────────────────────────
      const active = (STATE.masters.users||[]).filter(u=>u.status==='ACTIVE');
      const myP    = (window._accAllRows||[]).filter(r=>r.empCode===myCode);

      kpisEl.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.9rem">
          ${empKpiCard('👥','Active Employees',active.length,'','Company-wide','')}
          ${empKpiCard('💳','My Payments',myP.length,'warn',myP.filter(r=>r.status.cat==='pending').length+' pending','accounts')}
          ${empKpiCard('📄','My Documents','View','info','Payslips & Letters','my-documents')}
          ${empKpiCard('📋','Policies','View','','Company handbook','policies')}
        </div>`;
      tablesEl.innerHTML = '';
    }
  } catch(err) {
    if (kpisEl) kpisEl.innerHTML = `<div class="alert-strip warn"><span class="alert-icon">⚠️</span><span class="alert-text">Could not load department data: ${err.message}</span></div>`;
  }
}

// ── Helper: KPI card ──────────────────────────────────────────────
function empKpiCard(icon, label, value, type, sub, route) {
  const colors = { warn:'#f59e0b', info:'#1d4ed8', '':'var(--g7)' };
  const bgCls  = type === 'warn' ? 'warn' : type === 'info' ? 'info' : '';
  return `<div class="card kpi-card ${bgCls}" ${route ? `onclick="navigate('${route}')" style="cursor:pointer"` : 'style="cursor:default"'}>
    <div class="kpi-top"><div class="kpi-icon">${icon}</div>${route?`<div class="kpi-trend up">→</div>`:''}</div>
    <div class="kpi-value" style="font-size:${String(value).length>6?'1.3rem':'1.7rem'}">${value}</div>
    <div class="kpi-label">${label}</div>
    ${sub?`<div class="kpi-sub">${sub}</div>`:''}
  </div>`;
}

// ── Helper: status pill ───────────────────────────────────────────
function empStatusPill(status) {
  const s = (status||'').toLowerCase();
  let bg='#e5e7eb',color='#4b5563';
  if (/approved|completed|paid/i.test(s))  { bg='#d1fae5'; color='#065f46'; }
  if (/pending|draft|open/i.test(s))       { bg='#fef3c7'; color='#92400e'; }
  if (/rejected|cancel/i.test(s))          { bg='#fee2e2'; color='#991b1b'; }
  if (/progress|review/i.test(s))          { bg='#dbeafe'; color='#1e40af'; }
  return `<span style="background:${bg};color:${color};padding:2px 9px;border-radius:10px;font-size:.68rem;font-weight:600;white-space:nowrap">${status||'—'}</span>`;
}

// ── Helper: format crores ─────────────────────────────────────────
function fmtCr(amt) {
  if (!amt) return '0';
  if (amt >= 10000000) return (amt/10000000).toFixed(2)+' Cr';
  if (amt >= 100000)   return (amt/100000).toFixed(1)+' L';
  return Math.round(amt).toLocaleString('en-IN');
}

function renderDashboard() {
  // ── Merge: for MD role, Dashboard IS the Command Center ──────────
  if (STATE.role === 'md') {
    return renderMDCommand();
  }
  const el = document.getElementById('mainContent');
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const nameStr = STATE.user?.name ? STATE.user.name.split(' ')[0] : (STATE.role === 'md' ? 'Sir' : 'Team');

  el.innerHTML = `
    <div class="time-widget">
      <div>
        <div class="tw-greeting">${greeting}, ${nameStr} &#128075;</div>
        <div class="tw-sub">Evergreen Enterprises &middot; ${now.toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>
      </div>
      <div class="tw-time" style="text-align:right">
        <div id="tzClocksRow" class="tz-clocks"><!-- rendered by startClock() --></div>
        <button class="tz-add-btn" onclick="tzOpenPicker()" title="Add timezone" style="margin-top:.3rem;margin-left:auto">+</button>
      </div>
    </div>

    <!-- Safety alert strip — dynamic from sessionStorage -->
    <div id="dashSafetyAlert" style="display:none" class="alert-strip danger">
      <span class="alert-icon">&#128680;</span>
      <span class="alert-text" id="dashSafetyText"></span>
      <button class="btn btn-sm" onclick="navigate('safety')" style="background:var(--danger);color:#fff;margin-left:auto;flex-shrink:0">View</button>
    </div>

    <!-- ROW 1: Live KPIs from masters -->
    <div class="kpi-grid">
      <div class="kpi-card" onclick="navigate('site-manager')" style="cursor:pointer">
        <div class="kpi-top"><div class="kpi-icon green">&#127959;&#65039;</div><div class="kpi-trend up" id="siteTrend">&#11044; Live</div></div>
        <div class="kpi-value" id="activeSiteCount">&#8212;</div>
        <div class="kpi-label">Active Sites</div>
        <div class="kpi-sub" id="activeSiteSub">Loading...</div>
      </div>
      <div class="kpi-card warn" onclick="navigate('hr-dashboard')" style="cursor:pointer">
        <div class="kpi-top"><div class="kpi-icon orange">&#128119;</div><div class="kpi-trend up" id="userTrend">&#11044; Live</div></div>
        <div class="kpi-value" id="activeUserCount">&#8212;</div>
        <div class="kpi-label">Active Employees</div>
        <div class="kpi-sub" id="activeUserSub">Loading...</div>
      </div>
      <div class="kpi-card info" onclick="navigate('equipment')" style="cursor:pointer">
        <div class="kpi-top"><div class="kpi-icon blue">&#128668;</div><div class="kpi-trend flat" id="assetTrend">&#11044; Live</div></div>
        <div class="kpi-value" id="activeAssetCount">&#8212;</div>
        <div class="kpi-label">Active Equipment</div>
        <div class="kpi-sub" id="activeAssetSub">Loading...</div>
      </div>
      <div class="kpi-card" onclick="navigate('vendor')" style="cursor:pointer">
        <div class="kpi-top"><div class="kpi-icon green">&#127970;</div><div class="kpi-trend up" id="vendorTrend">&#11044; Live</div></div>
        <div class="kpi-value" id="activeVendorCount">&#8212;</div>
        <div class="kpi-label">Active Vendors</div>
        <div class="kpi-sub" id="activeVendorSub">Loading...</div>
      </div>
    </div>

    <!-- ROW 2: Live secondary KPIs -->
    <div class="kpi-grid" style="margin-bottom:1.6rem">
      <div class="kpi-card gold" onclick="navigate('accounts')" style="cursor:pointer">
        <div class="kpi-top"><div class="kpi-icon gold">&#9203;</div><div class="kpi-trend flat">Payments</div></div>
        <div class="kpi-value" id="dashPendingPayCt">&#8212;</div>
        <div class="kpi-label">Pending Payments</div>
        <div class="kpi-sub" id="dashPendingPayAmt">Loading...</div>
      </div>
      <div class="kpi-card gold" onclick="navigate('scm')" style="cursor:pointer">
        <div class="kpi-top"><div class="kpi-icon gold">&#9203;</div><div class="kpi-trend flat">POs</div></div>
        <div class="kpi-value" id="dashPendingPOCt">&#8212;</div>
        <div class="kpi-label">POs Pending Approval</div>
        <div class="kpi-sub" id="dashPendingPOSub">Loading...</div>
      </div>
      <div class="kpi-card" onclick="navigate('scm')" style="cursor:pointer">
        <div class="kpi-top"><div class="kpi-icon green">&#128230;</div><div class="kpi-trend flat" id="scTrend">&#11044; Live</div></div>
        <div class="kpi-value" id="activeSCCount">&#8212;</div>
        <div class="kpi-label">Sub-Contractors</div>
        <div class="kpi-sub" id="activeSCSub">Loading...</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:1.4rem">
      <div class="card-head">
        <h3>&#128202; Masters Summary &#8212; Live from Google Sheets</h3>
        <div style="display:flex;align-items:center;gap:.5rem">
          <span id="masterStatusBadge" class="tag" style="font-size:.68rem;background:#e8f5e9;color:var(--g7)">&#8987; Loading...</span>
          <button class="btn btn-secondary btn-sm" onclick="STATE.mastersLoaded=false;loadAllMasters().then(()=>updateAllMasterUI())" title="Refresh">&#8635; Refresh</button>
        </div>
      </div>
      <div class="card-body" id="mastersWidget">
        <div style="text-align:center;color:var(--txt3);padding:1rem">&#8987; Loading master data...</div>
      </div>
    </div>

    <div class="dash-grid thirds">
      <!-- Sites Overview -->
      <div class="card">
        <div class="card-head">
          <h3>&#127959;&#65039; Active Sites</h3>
          <button class="btn btn-secondary btn-sm" onclick="navigate('site-manager')">View All</button>
        </div>
        <div class="card-body" style="padding:0">
          <table class="sites-table">
            <thead><tr><th>Site</th><th>In-Charge</th><th>Status</th></tr></thead>
            <tbody id="sitesTableBody">
              <tr><td colspan="3" style="padding:1.5rem;text-align:center;color:var(--txt3)">&#8987; Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Quick Actions + Pending POs -->
      <div style="display:flex;flex-direction:column;gap:1.4rem">
        <div class="card card-pad">
          <h3 style="font-size:.95rem;font-weight:700;margin-bottom:1rem;color:var(--g9)">&#9889; Quick Actions</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">
            ${quickAction('&#128119;','New Onboarding','onboarding')}
            ${quickAction('&#129510;','Report Incident','safety')}
            ${quickAction('&#128722;','Purchase Dashboard','scm')}
            ${quickAction('&#128178;','Accounts','accounts')}
            ${quickAction('&#127970;','Vendor Status','vendor')}
            ${quickAction('&#128203;','Policies','policies')}
          </div>
        </div>

        <!-- Pending POs — live -->
        <div class="card card-pad">
          <h3 style="font-size:.95rem;font-weight:700;margin-bottom:.8rem;color:var(--g9)">
            &#9989; POs Pending Approval
            <span class="tag gold" style="margin-left:8px" id="dashPOBadge">Loading...</span>
          </h3>
          <div id="dashPOList" style="font-size:.8rem;color:var(--txt3)">&#8987; Loading...</div>
          <button class="btn btn-secondary btn-sm" style="width:100%;margin-top:.8rem;justify-content:center" onclick="navigate('scm')">View All POs &#8594;</button>
        </div>
      </div>
    </div>

    <!-- Dept Modules + Accounts snapshot -->
    <div class="dash-grid" style="margin-top:1.4rem">
      <div class="card card-pad">
        <h3 style="font-size:.95rem;font-weight:700;margin-bottom:1.2rem;color:var(--g9)">&#128241; Department Modules</h3>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.8rem">
          ${moduleCard('&#128101;','HR','hr-dashboard','#e8f5ee','var(--g8)')}
          ${moduleCard('&#128230;','Purchase Dashboard','scm','#e3f2fd','#1565c0')}
          ${moduleCard('&#128178;','Accounts','accounts','#fff3e0','#e65100')}
          ${moduleCard('&#128722;','Purchase','purchase','#f3e5f5','#6a1b9a')}
          ${moduleCard('&#127978;','Store','store','#e0f2f1','#00695c')}
          ${moduleCard('&#128668;','Equipment','equipment','#fce4ec','#880e4f')}
        </div>
      </div>

      <!-- Payment Status Snapshot — live -->
      <div class="card card-pad">
        <h3 style="font-size:.95rem;font-weight:700;margin-bottom:1.2rem;color:var(--g9)">&#128178; Payment Snapshot</h3>
        <div id="dashPaySnap" style="color:var(--txt3);font-size:.85rem">&#8987; Loading payment data...</div>
        <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border)">
          <button class="btn btn-primary btn-sm" onclick="navigate('accounts')" style="width:100%;justify-content:center">View Full Accounts &#8594;</button>
        </div>
      </div>
    </div>
  `;

  initTopNavClicks();
  startClock();

  // Safety alert: load from sheet, fallback session
  safetyLoadIncidents().then(all => {
    if (!all.length) all = getSafetyIncidentsLocal();
    const open = all.filter(i => i.status === 'Open');
    if (open.length > 0) {
      const da = document.getElementById('dashSafetyAlert');
      const dt = document.getElementById('dashSafetyText');
      if (da) da.style.display = 'flex';
      if (dt) dt.innerHTML = '<strong>' + open.length + ' Open Safety Incident' + (open.length>1?'s':'') + '</strong> \xe2\x80\x94 Immediate attention required';
    }
  }).catch(() => {});

  // ── Load live POs ──
  fetchSheet(PO_TAB, 'SELECT A,E,F,G,R,S,AF,AG,AP,AQ', PO_SHEET_ID).then(rawRows => {
    const pending = rawRows
      .filter(r => r['PO No'] && r['PO No'] !== 'Dummy' &&
        (r['PO Approval Status'] || r['AG'] || '').toUpperCase() !== 'REJECTED' &&
        (r['Lock'] || r['AQ'] || '') === 'Released for Approval');
    document.getElementById('dashPendingPOCt').textContent   = pending.length;
    document.getElementById('dashPOBadge').textContent       = pending.length + ' pending';
    document.getElementById('dashPendingPOSub').textContent  = pending.length + ' POs awaiting sign-off';
    const poEl = document.getElementById('dashPOList');
    if (!poEl) return;
    if (!pending.length) { poEl.innerHTML = '<div style="color:#16a34a">&#10003; No POs pending approval</div>'; return; }
    poEl.innerHTML = pending.slice(0,5).map(r => {
      const amt = parseFloat(String(r['Net Amount']||r['AP']||'0').replace(/[^0-9.]/g,''))||0;
      return `<div style="display:flex;justify-content:space-between;padding:.35rem 0;border-bottom:1px solid var(--border)">
        <div><span style="font-weight:600">${r['PO No']}</span> <span style="color:var(--txt3)">&middot; ${r['Vendor Name']||r['R']||''}</span></div>
        <div style="font-weight:600">\u20b9${amt.toLocaleString('en-IN')}</div>
      </div>`;
    }).join('') + (pending.length > 5 ? `<div style="color:var(--txt3);margin-top:.4rem;font-size:.75rem">+${pending.length-5} more</div>` : '');
  }).catch(() => {
    const el = document.getElementById('dashPOList'); if (el) el.textContent = 'Could not load POs.';
  });

  // ── Load live Payment snapshot ──
  fetchSheet('PaymentRequest', 'SELECT A,E,F,G,J,L,O,Q,R,T,U,V,W,AA,AK WHERE J IS NOT NULL', PAYMENT_SHEET_ID).then(rawRows => {
    const all = rawRows.filter(r => (r['Payment To'] || r['J'] || '').trim());
    const _getStatus = r => getPayStatus(r['Status'] || r['AK'] || '').cat;
    const pending   = all.filter(r => _getStatus(r) === 'pending');
    const progress  = all.filter(r => _getStatus(r) === 'progress');
    const completed = all.filter(r => _getStatus(r) === 'completed');
    const pendAmt  = pending.reduce((s,r) => s + (parseFloat(String(r['T']||r['Pending Value']||'0').replace(/[^0-9.]/g,''))||0), 0);
    const paidAmt  = completed.reduce((s,r) => s + (parseFloat(String(r['S']||r['Paid Value']||'0').replace(/[^0-9.]/g,''))||0), 0);

    document.getElementById('dashPendingPayCt').textContent  = pending.length;
    document.getElementById('dashPendingPayAmt').textContent = '\u20b9' + Math.round(pendAmt).toLocaleString('en-IN') + ' pending';

    const snapEl = document.getElementById('dashPaySnap');
    if (snapEl) snapEl.innerHTML = [
      { label:'Pending Action',  val: pending.length,   amt: pendAmt,  color:'#f59e0b' },
      { label:'In Progress',     val: progress.length,  amt: 0,        color:'#2563eb' },
      { label:'Completed',       val: completed.length, amt: paidAmt,  color:'#16a34a' },
    ].map(row => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:.5rem">
          <div style="width:10px;height:10px;border-radius:50%;background:${row.color}"></div>
          <span style="font-size:.82rem;color:var(--txt2)">${row.label}</span>
        </div>
        <div style="text-align:right">
          <span style="font-weight:700;color:var(--g9)">${row.val}</span>
          ${row.amt ? `<span style="color:var(--txt3);font-size:.75rem;margin-left:.4rem">\u20b9${Math.round(row.amt).toLocaleString('en-IN')}</span>` : ''}
        </div>
      </div>`).join('');
  }).catch(() => {
    const el = document.getElementById('dashPaySnap'); if (el) el.textContent = 'Could not load payment data.';
  });

  if (STATE.mastersLoaded && STATE.masters.users.length > 0) {
    updateAllMasterUI();
  } else {
    loadAllMasters().then(() => updateAllMasterUI());
  }
}


// ══════════════════════════════════════════════════
//  MD COMMAND CENTER
// ══════════════════════════════════════════════════
function renderMDCommand() {
  const el = document.getElementById('mainContent');
  el.innerHTML = `
    <div class="page-header">
      <div class="breadcrumb">
        <span>Home</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        <span>Dashboard &middot; Command Center</span>
      </div>
      <div class="page-header-row">
        <div>
          <h1>Dashboard</h1>
          <p id="mdCommandSubtitle">Command Center &middot; real-time overview &middot; live from sheets</p>
        </div>
        <div style="display:flex;gap:.7rem;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" onclick="STATE.mastersLoaded=false;loadAllMasters().then(()=>{updateAllMasterUI();renderMDCommand();})">↻ Refresh</button>
        </div>
      </div>
    </div>

    <!-- KPIs — populated by JS below -->
    <div class="kpi-grid" style="margin-bottom:1.6rem" id="mdKpiGrid">
      <div class="kpi-card"><div class="kpi-top"><div class="kpi-icon green">🏗️</div><div class="kpi-trend up">Live</div></div><div class="kpi-value" id="mdKpiSites">—</div><div class="kpi-label">Active Sites</div></div>
      <div class="kpi-card"><div class="kpi-top"><div class="kpi-icon green">👷</div><div class="kpi-trend up">Live</div></div><div class="kpi-value" id="mdKpiEmp">—</div><div class="kpi-label">Current Employees</div></div>
      <div class="kpi-card gold"><div class="kpi-top"><div class="kpi-icon gold">✅</div><div class="kpi-trend flat">Pending</div></div><div class="kpi-value" id="mdKpiPO">—</div><div class="kpi-label">POs Awaiting Approval</div></div>
      <div class="kpi-card info"><div class="kpi-top"><div class="kpi-icon blue">💰</div><div class="kpi-trend flat">Payments</div></div><div class="kpi-value" id="mdKpiPay">—</div><div class="kpi-label">Pending Payments</div></div>
      <div class="kpi-card"><div class="kpi-top"><div class="kpi-icon green">📦</div><div class="kpi-trend flat">Assets</div></div><div class="kpi-value" id="mdKpiAssets">—</div><div class="kpi-label">Active Equipment</div></div>
      <div class="kpi-card danger"><div class="kpi-top"><div class="kpi-icon red">🦺</div><div class="kpi-trend flat">Safety</div></div><div class="kpi-value" id="mdKpiSafety">—</div><div class="kpi-label">Safety Incidents (Session)</div></div>
    </div>

    <div class="dash-grid thirds">
      <!-- All Sites -->
      <div class="card">
        <div class="card-head">
          <h3>📍 All Sites (<span id="mdSiteCount">—</span>)</h3>
          <select id="mdSiteFilter" onchange="mdFilterSites()" style="font-size:.75rem;border:1px solid var(--border);border-radius:6px;padding:4px 8px;background:var(--surface2)">
            <option value="">All Regions</option>
          </select>
        </div>
        <div class="card-body" style="padding:.8rem;max-height:500px;overflow-y:auto" id="mdSitesContainer">
          <div style="padding:2rem;text-align:center;color:var(--txt3)">⏳ Loading…</div>
        </div>
      </div>

      <!-- Right column -->
      <div style="display:flex;flex-direction:column;gap:1.4rem">
        <!-- Pending POs -->
        <div class="card">
          <div class="card-head"><h3>✅ POs Pending Approval</h3><span class="tag gold" id="mdPOTag">Loading…</span></div>
          <div class="card-body" style="padding:.8rem;max-height:260px;overflow-y:auto" id="mdPOList">
            <div style="text-align:center;color:var(--txt3);padding:1rem">⏳ Loading POs…</div>
          </div>
        </div>

        <!-- Pending Payments -->
        <div class="card">
          <div class="card-head"><h3>💰 Pending Payments</h3><span class="tag info" id="mdPayTag">Loading…</span></div>
          <div class="card-body" style="padding:.8rem;max-height:260px;overflow-y:auto" id="mdPayList">
            <div style="text-align:center;color:var(--txt3);padding:1rem">⏳ Loading payments…</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Workforce breakdown -->
    <div class="dash-grid halves" style="margin-top:1.4rem">
      <div class="card card-pad">
        <h3 style="font-size:.95rem;font-weight:700;margin-bottom:1rem;color:var(--g9)">👷 Workforce by Department</h3>
        <div id="mdDeptBreakdown" style="display:flex;flex-direction:column;gap:.4rem">
          <div style="text-align:center;color:var(--txt3);padding:1rem">⏳ Loading…</div>
        </div>
      </div>
      <div class="card card-pad">
        <h3 style="font-size:.95rem;font-weight:700;margin-bottom:1rem;color:var(--g9)">📦 Assets by Category</h3>
        <div id="mdAssetBreakdown" style="display:flex;flex-direction:column;gap:.4rem">
          <div style="text-align:center;color:var(--txt3);padding:1rem">⏳ Loading…</div>
        </div>
      </div>
    </div>
  `;

  // ── Populate from masters (may already be loaded) ──
  function populateMDCommand() {
    const sites   = getActiveSites();
    const users   = getActiveUsers();
    const assets  = getActiveAssets();
    const allSites = STATE.masters.sites || [];

    // KPIs
    document.getElementById('mdKpiSites').textContent  = sites.length;
    document.getElementById('mdKpiEmp').textContent    = users.length;
    document.getElementById('mdKpiAssets').textContent = assets.length;

    // Safety: load from sheet, fallback to sessionStorage
    safetyLoadIncidents().then(all => {
      if (!all.length) all = getSafetyIncidentsLocal();
      const open = all.filter(i => i.status === 'Open').length;
      const high = all.filter(i => i.sev === 'High' || i.sev === 'Critical').length;
      const kpi = document.getElementById('mdKpiSafety');
      if (kpi) kpi.textContent = open;
      if (open > 0) {
        const alertDiv = document.createElement('div');
        alertDiv.className = 'alert-strip danger';
        alertDiv.style.cssText = 'margin-bottom:1rem';
        alertDiv.innerHTML = '<span class="alert-icon">&#128680;</span><span class="alert-text"><strong>'
          + open + ' Open Safety Incident' + (open>1?'s':'') + '</strong>'
          + (high?' &middot; '+high+' High/Critical':'') + '</span>'
          + '<button class="btn btn-sm" onclick="navigate(\'safety\')" style="background:var(--danger);color:#fff;margin-left:auto">View</button>';
        const pg = document.querySelector('#mainContent .page-header');
        if (pg) pg.insertAdjacentElement('afterend', alertDiv);
      }
    }).catch(() => {
      try { const i=JSON.parse(sessionStorage.getItem('safety_incidents')||'[]');
        const el=document.getElementById('mdKpiSafety'); if(el) el.textContent=i.filter(x=>x.status==='Open').length; } catch(e){}
    });

    // Sites list
    document.getElementById('mdSiteCount').textContent = sites.length + ' active';
    // Populate region filter
    const regions = [...new Set(allSites.map(s => s.state).filter(Boolean))].sort();
    const sel = document.getElementById('mdSiteFilter');
    if (sel && sel.children.length === 1) {
      regions.forEach(r => { const o = document.createElement('option'); o.value = r; o.textContent = r; sel.appendChild(o); });
    }
    window._mdAllSites = sites;
    mdFilterSites();

    // Dept breakdown
    const depts = {};
    users.forEach(u => { const d = u.dept || 'Unassigned'; depts[d] = (depts[d]||0)+1; });
    const deptEl = document.getElementById('mdDeptBreakdown');
    if (deptEl) {
      const sorted = Object.entries(depts).sort((a,b) => b[1]-a[1]).slice(0,10);
      const total = users.length || 1;
      deptEl.innerHTML = sorted.map(([d,n]) => `
        <div style="display:flex;align-items:center;gap:.6rem;font-size:.8rem">
          <div style="width:90px;color:var(--txt2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${d}</div>
          <div style="flex:1;background:var(--surface2);border-radius:4px;height:8px">
            <div style="width:${Math.round(n/total*100)}%;background:var(--g5);height:8px;border-radius:4px"></div>
          </div>
          <div style="width:24px;text-align:right;font-weight:600;color:var(--g8)">${n}</div>
        </div>`).join('');
    }

    // Asset breakdown
    const cats = {};
    assets.forEach(a => { const c = a.category || 'Other'; cats[c] = (cats[c]||0)+1; });
    const assetEl = document.getElementById('mdAssetBreakdown');
    if (assetEl) {
      const sorted = Object.entries(cats).sort((a,b) => b[1]-a[1]).slice(0,10);
      const total = assets.length || 1;
      assetEl.innerHTML = sorted.map(([c,n]) => `
        <div style="display:flex;align-items:center;gap:.6rem;font-size:.8rem">
          <div style="width:110px;color:var(--txt2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c}</div>
          <div style="flex:1;background:var(--surface2);border-radius:4px;height:8px">
            <div style="width:${Math.round(n/total*100)}%;background:#1976d2;height:8px;border-radius:4px"></div>
          </div>
          <div style="width:24px;text-align:right;font-weight:600;color:var(--g8)">${n}</div>
        </div>`).join('');
    }
  }

  window.mdFilterSites = function() {
    const filter = (document.getElementById('mdSiteFilter')?.value || '').toLowerCase();
    const sites  = (window._mdAllSites || []).filter(s => !filter || (s.state||'').toLowerCase() === filter);
    const el = document.getElementById('mdSitesContainer');
    if (!el) return;
    if (!sites.length) { el.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--txt3)">No sites found.</div>'; return; }
    el.innerHTML = sites.map(s => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.55rem .4rem;border-bottom:1px solid var(--border);font-size:.8rem">
        <div>
          <div style="font-weight:600;color:var(--g9)">${s.name || s.siteId}</div>
          <div style="color:var(--txt3);font-size:.72rem">${s.city||''} ${s.state ? '· '+s.state : ''}</div>
        </div>
        <div style="text-align:right">
          <span class="tag ${s.status==='ACTIVE'?'green':'grey'}" style="font-size:.65rem">${s.status||'—'}</span>
          ${s.incharge ? `<div style="font-size:.7rem;color:var(--txt3);margin-top:2px">${s.incharge}</div>` : ''}
        </div>
      </div>`).join('');
  };

  // ── Load POs ──
  fetchSheet(PO_TAB, 'SELECT A,E,F,G,R,S,AF,AG,AP,AQ', PO_SHEET_ID).then(rawRows => {
    const rows = rawRows
      .filter(r => r['PO No'] && r['PO No'] !== 'Dummy')
      .map(r => ({
        id: r['A'] || '', poNo: r['PO No'] || '', date: r['PO Date'] || '',
        vendor: r['Vendor Name'] || r['R'] || '', site: r['Site Name'] || r['S'] || '',
        amount: r['Net Amount'] || r['AP'] || '', status: r['PO Approval Status'] || r['AG'] || '',
        lock: r['Lock'] || r['AQ'] || '',
      }))
      .filter(r => r.status.toUpperCase() !== 'REJECTED' && r.lock === 'Released for Approval');

    document.getElementById('mdKpiPO').textContent = rows.length;
    document.getElementById('mdPOTag').textContent = rows.length + ' pending';
    const poEl = document.getElementById('mdPOList');
    if (!poEl) return;
    if (!rows.length) { poEl.innerHTML = '<div style="text-align:center;color:var(--txt3);padding:1rem">✅ No POs pending approval</div>'; return; }
    poEl.innerHTML = rows.slice(0,20).map(r => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem .3rem;border-bottom:1px solid var(--border);font-size:.78rem">
        <div>
          <div style="font-weight:600;color:var(--g9)">${r.poNo}</div>
          <div style="color:var(--txt3);font-size:.7rem">${r.vendor} · ${r.site}</div>
        </div>
        <div style="text-align:right;font-weight:700;color:var(--g8)">${r.amount ? '₹'+Number(String(r.amount).replace(/[^0-9.]/g,'')).toLocaleString('en-IN') : '—'}</div>
      </div>`).join('');
  }).catch(() => {
    const el = document.getElementById('mdPOList');
    if (el) el.innerHTML = '<div style="color:var(--danger);padding:1rem;font-size:.8rem">⚠️ Could not load POs</div>';
  });

  // ── Load Payments ──
  fetchSheet('PaymentRequest', 'SELECT A,E,F,G,J,L,O,Q,R,T,U,V,W,AA,AK', PAYMENT_SHEET_ID).then(rawRows => {
    const rows = rawRows.filter(r => {
      const cat = getPayStatus(r['Status'] || r['AK'] || '').cat;
      return cat === 'pending' || cat === 'progress';
    });
    const totalPending = rows.reduce((sum, r) => {
      const v = parseFloat(String(r['T'] || r['Pending Value'] || '0').replace(/[^0-9.]/g,'')) || 0;
      return sum + v;
    }, 0);
    document.getElementById('mdKpiPay').textContent = rows.length;
    document.getElementById('mdPayTag').textContent = rows.length + ' pending · ₹' + totalPending.toLocaleString('en-IN');
    const payEl = document.getElementById('mdPayList');
    if (!payEl) return;
    if (!rows.length) { payEl.innerHTML = '<div style="text-align:center;color:var(--txt3);padding:1rem">✅ No pending payments</div>'; return; }
    payEl.innerHTML = rows.slice(0,20).map(r => {
      const payTo  = r['H'] || r['Payment To'] || '—';
      const site   = r['L'] || r['Site'] || '';
      const pending = r['T'] || r['Pending Value'] || '—';
      const status  = r['AG'] || r['Status'] || '—';
      return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem .3rem;border-bottom:1px solid var(--border);font-size:.78rem">
        <div>
          <div style="font-weight:600;color:var(--g9)">${payTo}</div>
          <div style="color:var(--txt3);font-size:.7rem">${site} · <span style="color:#e65100">${status}</span></div>
        </div>
        <div style="text-align:right;font-weight:700;color:var(--g8)">${pending ? '₹'+Number(String(pending).replace(/[^0-9.]/g,'')).toLocaleString('en-IN') : '—'}</div>
      </div>`;
    }).join('');
  }).catch(() => {
    const el = document.getElementById('mdPayList');
    if (el) el.innerHTML = '<div style="color:var(--danger);padding:1rem;font-size:.8rem">⚠️ Could not load payments</div>';
  });

  // ── Populate masters KPIs (or wait if not loaded) ──
  if (STATE.mastersLoaded && STATE.masters.users.length > 0) {
    populateMDCommand();
  } else {
    loadAllMasters().then(() => populateMDCommand());
  }
}


// ══════════════════════════════════════════════════
//  APPSHEET EMBED
// ══════════════════════════════════════════════════
// ── AppSheet app registry — add more apps here as they go live ──
const APPSHEET_APPS = {
  hr:       { url: 'https://www.appsheet.com/start/9fcf3039-c992-4498-9647-2bcccca13ece', label: 'HR_v0',       icon: '👥' },
  personal: { url: 'https://www.appsheet.com/start/9fcf3039-c992-4498-9647-2bcccca13ece', label: 'HR_v0',       icon: '🙋' },
  accounts: { url: 'https://www.appsheet.com/start/fcdba849-9f9d-435f-8e8a-ea0c975dbd21', label: 'Accounts',    icon: '💰' },
  scm:      { url: 'https://www.appsheet.com/start/06fd0117-1dd8-445b-aaee-e2ff6e68e36f', label: 'SCM',         icon: '📦' },
};

function renderAppSheetEmbed(title, desc, appKey) {
  const el  = document.getElementById('mainContent');
  const app = APPSHEET_APPS[appKey] || null;
  const url = app?.url || null;

  if (!url) {
    el.innerHTML = `
      <div class="page-header"><h1>${app?.icon||'📱'} ${title}</h1><p>${desc}</p></div>
      <div class="card"><div class="card-body" style="text-align:center;padding:3rem;color:var(--txt3)">
        <div style="font-size:3rem;margin-bottom:1rem">📱</div>
        <div class="mp-badge">🔨 App URL not yet configured</div>
      </div></div>`;
    return;
  }

  // AppSheet blocks iframe embedding via CSP — show a rich launcher card instead
  el.innerHTML = `
    <div class="page-header" style="margin-bottom:1.2rem">
      <h1>${app.icon} ${title}</h1>
      <p>${desc}</p>
    </div>

    <!-- App Launch Card -->
    <div class="card" style="overflow:hidden;margin-bottom:1.2rem">
      <div style="background:linear-gradient(135deg,var(--g9) 0%,var(--g7) 100%);padding:2.5rem 2rem;text-align:center;color:#fff">
        <div style="font-size:3.5rem;margin-bottom:.75rem">${app.icon}</div>
        <div style="font-size:1.4rem;font-weight:700;margin-bottom:.4rem">${app.label}</div>
        <div style="font-size:.85rem;opacity:.8;margin-bottom:1.8rem;max-width:380px;margin-left:auto;margin-right:auto">${desc}</div>
        <button onclick="window.open('${url}','_blank')"
          style="padding:.85rem 2.5rem;background:#fff;color:var(--g8);border:none;border-radius:50px;font-size:1rem;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 4px 15px rgba(0,0,0,.2);transition:transform .15s"
          onmouseover="this.style.transform='translateY(-2px)'"
          onmouseout="this.style.transform='none'">
          🚀 Launch ${app.label}
        </button>
        <div style="margin-top:1rem;font-size:.75rem;opacity:.6">Opens in a new tab · Sign in with your Google account</div>
      </div>
    </div>

    <!-- Quick Info Cards -->
    <div class="dash-grid thirds">
      <div class="card">
        <div class="card-body" style="text-align:center;padding:1.5rem 1rem">
          <div style="font-size:1.8rem;margin-bottom:.5rem">📱</div>
          <div style="font-weight:700;color:var(--g8);margin-bottom:.3rem">Mobile Ready</div>
          <div style="font-size:.8rem;color:var(--txt3)">Works on phone, tablet & desktop</div>
        </div>
      </div>
      <div class="card">
        <div class="card-body" style="text-align:center;padding:1.5rem 1rem">
          <div style="font-size:1.8rem;margin-bottom:.5rem">🔐</div>
          <div style="font-weight:700;color:var(--g8);margin-bottom:.3rem">Google Sign-In</div>
          <div style="font-size:.8rem;color:var(--txt3)">Sign in with your @evgcpl.com account</div>
        </div>
      </div>
      <div class="card">
        <div class="card-body" style="text-align:center;padding:1.5rem 1rem">
          <div style="font-size:1.8rem;margin-bottom:.5rem">🔄</div>
          <div style="font-weight:700;color:var(--g8);margin-bottom:.3rem">Live Data</div>
          <div style="font-size:.8rem;color:var(--txt3)">Real-time sync with Google Sheets</div>
        </div>
      </div>
    </div>

    <!-- QR Code hint for mobile -->
    <div style="margin-top:.5rem;padding:1rem 1.2rem;background:var(--surface2);border:1px solid var(--border);border-radius:var(--rad);font-size:.8rem;color:var(--txt2);display:flex;align-items:center;gap:.75rem">
      <span style="font-size:1.4rem">💡</span>
      <span>To add this app to your phone's home screen: open the link on mobile → tap <strong>Share</strong> → <strong>Add to Home Screen</strong></span>
    </div>
  `;
}



// ══════════════════════════════════════════════════
//  SCM DASHBOARD — Purchase Orders
// ══════════════════════════════════════════════════
const RECRUITMENT_SHEET_ID = '1Dw48OEDmIAAu9Va1-a9z7PZT7wKS_mWU7cwpK6osRNI';
const PO_SHEET_ID      = '1zcqF2tjjBETPuW25c9MBMo0zakBIBD6tksg5OstFA7c';
const PO_TAB           = 'PO_Actual'; // gid 1458467853 — replaces legacy 'PO' tab as of v3.4.0
const PAYMENT_SHEET_ID = '1mLddxLRf719EaXE9XSET9gT8l0a8Cxns362yIbHo63g'; // Account View – PaymentRequest tab
const STORES_SHEET_ID  = '1iMQxgqGilUh2_3NCZl5D-EMt-NC8FwugX83q2fWb8fE'; // v2_Stores – StockIN / GRN_No tabs

// ══════════════════════════════════════════════════════════
//  MRS DASHBOARD
// ══════════════════════════════════════════════════════════
let _mrsAllRows       = [];   // deduplicated MRS records (one per unique Request No)
let _mrsSiteData      = [];   // [{site, count, pending, approved, rejected, dropped}]
let _mrsMonthData     = [];   // [{key,label,count,fyKey}]
let _mrsSelectedFY    = null;
let _mrsSiteSort      = { col: 'count', dir: -1 };

// ── MRS DASHBOARD HTML ────────────────────────────────────
function renderMRSDashboard() {
  const el = document.getElementById('mainContent');
  el.innerHTML = `
    <div class="page-header" style="margin-bottom:1rem">
      <h1>📋 MRS — Material Request Slips</h1>
      <p>Live MRS tracker · Approval status · Site-wise analytics · Aging & Turnaround</p>
    </div>

    <!-- KPI Row 1 — counts -->
    <div class="kpi-grid" style="margin-bottom:1rem">
      <div class="kpi-card" style="cursor:pointer" onclick="window.mrsJumpTo('all')">
        <div class="kpi-top"><div class="kpi-icon green">📋</div><div class="kpi-trend flat" style="font-size:.65rem">view all ↓</div></div>
        <div class="kpi-value" id="mrs-kpi-total">—</div>
        <div class="kpi-label">Total MRS</div>
        <div style="margin-top:.35rem"><button class="as-btn" onclick="event.stopPropagation();window.open(AS.mrsMaster(),'_blank')">🚀 MRS Master View</button></div>
      </div>
      <div class="kpi-card warn" style="cursor:pointer" onclick="window.mrsJumpTo('pending')">
        <div class="kpi-top"><div class="kpi-icon orange">⏳</div><div class="kpi-trend flat" style="font-size:.65rem">view list ↓</div></div>
        <div class="kpi-value" id="mrs-kpi-pending">—</div>
        <div class="kpi-label">Pending</div>
        <div style="margin-top:.35rem"><button class="as-btn" onclick="event.stopPropagation();window.open(AS.pendingMR(),'_blank')">🚀 Pending MR Approval</button></div>
      </div>
      <div class="kpi-card info" style="cursor:pointer" onclick="window.mrsJumpTo('approved')">
        <div class="kpi-top"><div class="kpi-icon blue">✅</div><div class="kpi-trend flat" style="font-size:.65rem">view list ↓</div></div>
        <div class="kpi-value" id="mrs-kpi-approved">—</div>
        <div class="kpi-label">Approved</div>
        <div style="margin-top:.35rem"><button class="as-btn" onclick="event.stopPropagation();window.open(AS.mrsMaster(),'_blank')">🚀 MRS Master View</button></div>
      </div>
      <div class="kpi-card" style="cursor:pointer" onclick="window.mrsJumpTo('rejected')">
        <div class="kpi-top"><div class="kpi-icon red">❌</div><div class="kpi-trend flat" style="font-size:.65rem">view list ↓</div></div>
        <div class="kpi-value" id="mrs-kpi-rejected">—</div>
        <div class="kpi-label">Rejected</div>
        <div style="margin-top:.35rem"><button class="as-btn" onclick="event.stopPropagation();window.open(AS.mrsMaster(),'_blank')">🚀 MRS Master View</button></div>
      </div>
    </div>

    <!-- KPI Row 2 — time metrics -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.4rem">
      <div class="kpi-card" style="flex-direction:row;gap:1rem;align-items:center">
        <div class="kpi-icon green" style="font-size:1.6rem">🕐</div>
        <div>
          <div class="kpi-value" id="mrs-kpi-tat" style="font-size:1.6rem">—</div>
          <div class="kpi-label">Avg Turnaround (days)</div>
          <div style="font-size:.72rem;color:var(--txt3)">Approved/Rejected/Dropped</div>
        </div>
      </div>
      <div class="kpi-card" style="flex-direction:row;gap:1rem;align-items:center;cursor:pointer" onclick="window.mrsJumpTo('overdue')">
        <div class="kpi-icon orange" style="font-size:1.6rem">⌛</div>
        <div>
          <div class="kpi-value" id="mrs-kpi-aging" style="font-size:1.6rem">—</div>
          <div class="kpi-label">Avg Aging — Open (days)</div>
          <div style="font-size:.72rem;color:var(--txt3)">Pending MRS only</div>
        </div>
      </div>
      <div class="kpi-card" style="flex-direction:row;gap:1rem;align-items:center;cursor:pointer" onclick="window.mrsJumpTo('overdue')">
        <div class="kpi-icon red" style="font-size:1.6rem">🔴</div>
        <div>
          <div class="kpi-value" id="mrs-kpi-overdue" style="font-size:1.6rem">—</div>
          <div class="kpi-label">Overdue &gt;7 Days</div>
          <div style="font-size:.72rem;color:var(--txt3)">click to view list ↓</div>
        </div>
      </div>
    </div>

    <!-- Monthly Trend + Site table side by side -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.2rem;margin-bottom:1.2rem">

      <!-- 📅 Month-wise MRS Trend -->
      <div class="card">
        <div class="card-head">
          <h3>📅 Monthly MRS Trend</h3>
          <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">
            <select id="mrs-fy-select" onchange="window.mrsChangeFY(this.value)"
              style="padding:.3rem .7rem;border:1px solid var(--border);border-radius:6px;font-size:.8rem;font-family:inherit;background:#fff;color:var(--g8);font-weight:600">
              <option>Loading…</option>
            </select>
            <span class="hr-stat-pill" id="mrs-month-badge">—</span>
          </div>
        </div>
        <div class="card-body" style="padding:1rem .8rem">
          <div id="mrs-month-chart" style="min-height:110px;display:flex;align-items:flex-end;gap:4px">
            <div style="padding:2rem;text-align:center;color:var(--txt3);width:100%">Loading…</div>
          </div>
        </div>
      </div>

      <!-- 🏗️ MRS by Site -->
      <div class="card">
        <div class="card-head">
          <h3>🏗️ MRS Count by Site</h3>
          <div style="display:flex;gap:.5rem;align-items:center">
            <span class="hr-stat-pill" id="mrs-site-badge">—</span>
            <button onclick="window.mrsSiteDownloadCSV()" class="csv-btn">⬇ CSV</button>
          </div>
        </div>
        <div class="card-body" style="padding:0;overflow-x:auto;max-height:320px;overflow-y:auto">
          <div id="mrs-site-table">
            <div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:2.5rem;color:var(--txt3)">
              <div style="width:22px;height:22px;border:2px solid var(--border);border-top-color:var(--g5);border-radius:50%;animation:spin 1s linear infinite"></div>
              Loading…
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- Dropped KPI (full width) -->
    <div style="background:var(--surface2);border-radius:10px;padding:.8rem 1.2rem;display:flex;align-items:center;gap:1rem;margin-bottom:.5rem;font-size:.82rem;color:var(--txt2)">
      <span style="font-size:1.3rem">🗑️</span>
      <span><strong id="mrs-kpi-dropped">—</strong> MRS Dropped</span>
      <span style="margin-left:auto;color:var(--txt3)">Dropped = Cancelled before approval</span>
    </div>

    <!-- 📋 All MRS — deep-link target -->
    <div id="mrs-all-section" style="display:none;margin-top:.5rem">
      <div class="card">
        <div class="card-head">
          <h3 id="mrs-all-title">📋 All MRS</h3>
          <div style="display:flex;gap:.5rem;align-items:center">
            <span class="hr-stat-pill" id="mrs-all-badge">—</span>
            <button onclick="window.mrsDownloadCSV()" class="csv-btn">⬇ CSV</button>
            <button onclick="document.getElementById('mrs-all-section').style.display='none'" style="padding:.25rem .7rem;border:1px solid var(--border);border-radius:6px;background:#fff;font-size:.75rem;cursor:pointer;font-family:inherit">✕ Close</button>
          </div>
        </div>
        <div class="card-body" style="padding:.75rem;padding-bottom:0">
          <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.75rem">
            <input id="mrs-all-search" type="text" placeholder="Search Request No, Site…"
              style="flex:1;min-width:180px;padding:.38rem .65rem;border:1.5px solid #cce3d4;border-radius:8px;font-size:.82rem;font-family:inherit;outline:none"
              oninput="window.mrsRenderAllTable()" />
          </div>
        </div>
        <div class="card-body" style="padding:0;overflow-x:auto;max-height:320px;overflow-y:auto">
          <div id="mrs-all-table"></div>
        </div>
      </div>
    </div>
  `;
  loadMRSData();
}

// ── LOAD MRS DATA ─────────────────────────────────────────
function loadMRSData() {
  // D=Request No, E=Requested By, F=Site, G=Part Details, I=Part Description, J=Type, N=MR Approval Status, O=Approver, P=MR Approval Date, Y=Timestamp
  fetchSheet('MRS', 'SELECT D,E,F,G,I,J,K,L,N,O,P,U,Y', PO_SHEET_ID).then(rawRows => {
    if (!rawRows || rawRows.length === 0) {
      document.getElementById('mrs-site-table').innerHTML =
        `<div style="padding:2rem;text-align:center;color:#c62828">
          ⚠️ Could not load MRS data. Ensure v2_Purchase is shared as "Anyone on the internet".
        </div>`;
      return;
    }

    const today = new Date(); today.setHours(0,0,0,0);

    // Each row is an item — deduplicate by Request No (D) to get MRS-level view
    const mrsMap = {};
    rawRows.forEach(r => {
      const reqNo = (r['Request No'] || r['D'] || '').trim();
      if (!reqNo || reqNo.toLowerCase() === 'dummy') return;

      if (!mrsMap[reqNo]) {
        const ts        = parsePODate(r['Timestamp'] || r['Y'] || '');
        const approveD  = parsePODate(r['MR Approval Date'] || r['P'] || '');
        const status    = (r['MR Approval Status'] || r['N'] || '').trim();
        const site      = (r['Requested For'] || r['F'] || '—').trim();
        const ageDays   = ts ? Math.floor((today - ts) / 86400000) : null;
        const tatDays   = (ts && approveD) ? Math.floor((approveD - ts) / 86400000) : null;
        const month     = ts ? ts.toLocaleDateString('en-IN',{month:'short',year:'2-digit'}) : null;
        const monthKey  = ts ? `${ts.getFullYear()}-${String(ts.getMonth()+1).padStart(2,'0')}` : null;

        // K = MR Qty (requested), U = Total Qty (processed/fulfilled)
        // Pending when MR Qty ≠ Total Qty (i.e. not fully fulfilled)
        const mrQty    = parseFloat(r['MR Qty']    || r['K'] || '0') || 0;
        const totalQty = parseFloat(r['Total Qty'] || r['U'] || '0') || 0;
        const isPendingQty = mrQty !== totalQty; // K ≠ U → not fully processed
        mrsMap[reqNo] = {
          reqNo, site, status, ts, approveD, ageDays, tatDays, month, monthKey, fyKey: getFYKey(ts),
          requestedBy:    (r['Requested By']    || r['E'] || '').trim(),
          partDetails:    (r['Part Details']    || r['G'] || '').trim(),
          partDesc:       (r['Part Description']|| r['I'] || '').trim(),
          type:           (r['Type']            || r['J'] || '').trim(),
          approver:       (r['Approver Name']   || r['O'] || '').trim(),
          mrQty,
          totalQty,
          isPendingQty,
        };
      }
    });

    _mrsAllRows = Object.values(mrsMap);
    const rows  = _mrsAllRows;

    // KPIs
    const total    = rows.length;
    const approved = rows.filter(r => r.status.toUpperCase() === 'APPROVED').length;
    const rejected = rows.filter(r => r.status.toUpperCase() === 'REJECTED').length;
    const dropped  = rows.filter(r => r.status.toUpperCase() === 'DROPPED').length;
    // Pending = MR Qty (K) ≠ Total Qty (U) → not fully processed
    const isPending = r => r.isPendingQty !== undefined
      ? r.isPendingQty  // K ≠ U
      : !['APPROVED','REJECTED','DROPPED'].includes((r.status||'').toUpperCase());
    const pending  = rows.filter(isPending).length;

    const pendingRows  = rows.filter(isPending);
    const closedRows   = rows.filter(r => r.tatDays !== null && r.tatDays >= 0);
    const avgTAT       = closedRows.length ? Math.round(closedRows.reduce((s,r)=>s+r.tatDays,0)/closedRows.length) : null;
    const avgAging     = pendingRows.filter(r=>r.ageDays!==null).length
      ? Math.round(pendingRows.filter(r=>r.ageDays!==null).reduce((s,r)=>s+r.ageDays,0)/pendingRows.filter(r=>r.ageDays!==null).length) : null;
    const overdue      = pendingRows.filter(r => r.ageDays !== null && r.ageDays > 7).length;

    document.getElementById('mrs-kpi-total').textContent    = total;
    document.getElementById('mrs-kpi-pending').textContent  = pending;
    document.getElementById('mrs-kpi-approved').textContent = approved;
    document.getElementById('mrs-kpi-rejected').textContent = rejected;
    document.getElementById('mrs-kpi-dropped').textContent  = dropped;
    document.getElementById('mrs-kpi-tat').textContent      = avgTAT !== null ? avgTAT : '—';
    document.getElementById('mrs-kpi-aging').textContent    = avgAging !== null ? avgAging : '—';
    document.getElementById('mrs-kpi-overdue').textContent  = overdue;

    // Site summary
    const siteMap = {};
    rows.forEach(r => {
      if (!siteMap[r.site]) siteMap[r.site] = { site: r.site, count:0, pending:0, approved:0, rejected:0, dropped:0 };
      siteMap[r.site].count++;
      const st = r.status.toUpperCase();
      if (st === 'APPROVED')       siteMap[r.site].approved++;
      else if (st === 'REJECTED')  siteMap[r.site].rejected++;
      else if (st === 'DROPPED')   siteMap[r.site].dropped++;
      else                         siteMap[r.site].pending++;
    });
    _mrsSiteData = Object.values(siteMap);

    // Month trend
    const monthMap = {};
    rows.forEach(r => {
      if (!r.monthKey) return;
      if (!monthMap[r.monthKey]) monthMap[r.monthKey] = { key: r.monthKey, label: r.month, count:0, fyKey: r.fyKey };
      monthMap[r.monthKey].count++;
    });
    _mrsMonthData = Object.values(monthMap).sort((a,b) => a.key.localeCompare(b.key));

    // FY dropdown
    const fySet = [...new Set(_mrsMonthData.map(m=>m.fyKey).filter(Boolean))].sort().reverse();
    _mrsSelectedFY = fySet.includes(currentFYKey()) ? currentFYKey() : (fySet[0] || currentFYKey());
    const fySelect = document.getElementById('mrs-fy-select');
    if (fySelect) fySelect.innerHTML = fySet.map(fy =>
      `<option value="${fy}" ${fy===_mrsSelectedFY?'selected':''}>${fy}</option>`).join('');

    renderMRSSiteTable();
    renderMRSMonthChart();
  }).catch(err => {
    document.getElementById('mrs-site-table').innerHTML =
      `<div style="padding:2rem;text-align:center;color:#c62828">Error: ${err.message}</div>`;
  });
}

// ── MRS DEEP LINK ─────────────────────────────────────────
window.mrsDownloadCSV = function() {
  const sec = document.getElementById('mrs-all-section');
  const filter = sec ? sec.dataset.filter || 'all' : 'all';
  const q = (document.getElementById('mrs-all-search')?.value || '').toLowerCase();
  const today = new Date(); today.setHours(0,0,0,0);
  let rows = _mrsAllRows;
  if (filter === 'pending')  rows = rows.filter(r => r.isPendingQty !== undefined ? r.isPendingQty : !['APPROVED','REJECTED','DROPPED'].includes((r.status||'').toUpperCase()));
  else if (filter === 'approved') rows = rows.filter(r => /approved/i.test(r.status));
  else if (filter === 'rejected') rows = rows.filter(r => /rejected/i.test(r.status));
  else if (filter === 'overdue')  rows = rows.filter(r => (r => r.isPendingQty !== undefined ? r.isPendingQty : !['APPROVED','REJECTED','DROPPED'].includes((r.status||'').toUpperCase()))(r) && r.ts && (today - r.ts) / 86400000 > 7);
  if (q) rows = rows.filter(r => (r.reqNo||'').toLowerCase().includes(q) || (r.site||'').toLowerCase().includes(q));
  const csv = rows.map(r => ({ 'Request No': r.reqNo, 'Site': r.site, 'Status': r.status || 'Pending', 'MR Qty (K)': r.mrQty||'', 'Total Qty (U)': r.totalQty||'', 'Pending?': r.isPendingQty ? 'Yes' : 'No', 'Approval Date': r.approveD ? fmtDate(r.approveD) : '', 'Raised On': r.ts ? fmtDate(r.ts) : '', 'Age (Days)': r.ageDays ?? '' }));
  downloadCSV(csv, `MRS_${filter}_${new Date().toISOString().slice(0,10)}.csv`);
};
window.mrsJumpTo = function(filter) {
  const sec = document.getElementById('mrs-all-section');
  if (!sec) return;
  sec.style.display = 'block';
  const titles = { all:'📋 All MRS', pending:'⏳ Pending MRS', approved:'✅ Approved MRS', rejected:'❌ Rejected MRS', overdue:'🔴 Overdue MRS (>7 days)' };
  const title = document.getElementById('mrs-all-title');
  if (title) title.textContent = titles[filter] || '📋 All MRS';
  sec.dataset.filter = filter;
  window.mrsRenderAllTable();
  sec.scrollIntoView({ behavior:'smooth', block:'start' });
};

window.mrsRenderAllTable = function() {
  const sec   = document.getElementById('mrs-all-section');
  const el    = document.getElementById('mrs-all-table');
  const badge = document.getElementById('mrs-all-badge');
  if (!el || !_mrsAllRows.length) return;

  const filter = sec ? sec.dataset.filter || 'all' : 'all';
  const q      = (document.getElementById('mrs-all-search')?.value || '').toLowerCase();
  const today  = new Date(); today.setHours(0,0,0,0);

  let rows = _mrsAllRows;
  if (filter === 'pending')  rows = rows.filter(r => r.isPendingQty !== undefined ? r.isPendingQty : !['APPROVED','REJECTED','DROPPED'].includes((r.status||'').toUpperCase()));
  else if (filter === 'approved') rows = rows.filter(r => /approved/i.test(r.status));
  else if (filter === 'rejected') rows = rows.filter(r => /rejected/i.test(r.status));
  else if (filter === 'overdue')  rows = rows.filter(r => (r => r.isPendingQty !== undefined ? r.isPendingQty : !['APPROVED','REJECTED','DROPPED'].includes((r.status||'').toUpperCase()))(r) && r.ts && (today - r.ts) / 86400000 > 7);
  if (q) rows = rows.filter(r =>
    (r.reqNo || '').toLowerCase().includes(q) || (r.site || '').toLowerCase().includes(q)
  );

  if (badge) badge.innerHTML = `<strong>${rows.length}</strong> record${rows.length !== 1 ? 's' : ''}`;

  if (!rows.length) {
    el.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--txt3)">No records match this filter.</div>`;
    return;
  }

  const trs = rows.map(r => {
    const st = r.status || 'Pending';
    const stCol = st === 'Approved' ? '#e8f5e9' : st === 'Rejected' ? '#ffebee' : st === 'Dropped' ? '#f3e5f5' : '#fff8e1';
    const stTxt = st === 'Approved' ? '#2e7d32' : st === 'Rejected' ? '#c62828' : st === 'Dropped' ? '#6a1b9a' : '#b07000';
    const age = r.ageDays !== null && r.ageDays !== undefined ? r.ageDays : (r.ts ? Math.floor((today - r.ts) / 86400000) : null);
    const desc = r.partDesc || r.partDetails || '—';
    return `<tr>
      <td style="font-weight:700;color:var(--g7);font-size:.82rem">${r.reqNo}</td>
      <td style="font-size:.8rem">${r.site}</td>
      <td style="font-size:.78rem;color:var(--txt3)">${r.requestedBy||'—'}</td>
      <td style="font-size:.78rem;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${desc}">${desc}</td>
      <td style="font-size:.74rem">${r.type ? `<span style="background:#e3f2fd;color:#1565c0;padding:.12rem .4rem;border-radius:4px">${r.type}</span>` : '—'}</td>
      <td><span style="background:${stCol};color:${stTxt};padding:.18rem .5rem;border-radius:20px;font-size:.72rem;font-weight:700">${st}</span></td>
      <td style="font-size:.78rem;color:var(--txt3)">${r.approver||'—'}</td>
      <td style="font-size:.78rem;color:var(--txt3)">${r.approveD ? fmtDate(r.approveD) : '—'}</td>
      <td style="font-size:.78rem">${r.ts ? fmtDate(r.ts) : '—'}</td>
      <td style="font-size:.78rem">${age !== null ? `<span style="font-weight:600;color:${age>7?'#c62828':age>3?'#b07000':'#2e7d32'}">${age}d</span>` : '—'}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `<table class="emp-table" style="min-width:680px">
    <thead><tr><th>Request No</th><th>Site</th><th>Requested By</th><th>Part Description</th><th>Type</th><th>Status</th><th>Approver</th><th>Approval Date</th><th>Raised On</th><th>Age</th></tr></thead>
    <tbody>${trs}</tbody>
  </table>`;
};

// ── MRS SITE TABLE ────────────────────────────────────────
function mrsth(label, col) {
  const s = _mrsSiteSort;
  const arrow = s.col===col ? (s.dir===1?' ▲':' ▼'):' ↕';
  return `<th style="cursor:pointer;user-select:none;white-space:nowrap"
    onclick="window.mrsSiteSort('${col}')">${label}<span style="opacity:.45;font-size:.68rem">${arrow}</span></th>`;
}
window.mrsSiteSort = function(col) {
  if (_mrsSiteSort.col===col) _mrsSiteSort.dir*=-1; else { _mrsSiteSort.col=col; _mrsSiteSort.dir=1; }
  renderMRSSiteTable();
};

function renderMRSSiteTable() {
  const el    = document.getElementById('mrs-site-table');
  const badge = document.getElementById('mrs-site-badge');
  if (!el) return;

  const sorted = [..._mrsSiteData].sort((a,b) => {
    const va=a[_mrsSiteSort.col]??'', vb=b[_mrsSiteSort.col]??'';
    return typeof va==='number' ? (va-vb)*_mrsSiteSort.dir : String(va).localeCompare(String(vb))*_mrsSiteSort.dir;
  });

  if (badge) badge.innerHTML = `<strong>${sorted.length}</strong> sites`;
  const maxCount = Math.max(...sorted.map(r=>r.count),1);

  const trs = sorted.map(r => {
    const pct = Math.round((r.count/maxCount)*100);
    return `<tr>
      <td style="font-weight:600;font-size:.81rem;color:var(--g8)">${r.site}</td>
      <td style="text-align:center;font-weight:700;color:var(--g7)">${r.count}</td>
      <td style="text-align:center">
        ${r.pending ? `<span style="background:#fff3e0;color:#e65100;font-size:.68rem;font-weight:700;padding:.1rem .4rem;border-radius:12px">${r.pending}</span>` : '<span style="color:var(--txt4);font-size:.75rem">—</span>'}
      </td>
      <td style="text-align:center">
        ${r.approved ? `<span style="background:#e8f5e9;color:#2e7d32;font-size:.68rem;font-weight:700;padding:.1rem .4rem;border-radius:12px">${r.approved}</span>` : '<span style="color:var(--txt4);font-size:.75rem">—</span>'}
      </td>
      <td style="min-width:80px">
        <div style="background:var(--surface2);border-radius:20px;height:6px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:var(--g5);border-radius:20px"></div>
        </div>
      </td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <table class="emp-table" style="min-width:340px">
      <thead><tr>
        ${mrsth('Site','site')}
        ${mrsth('Total','count')}
        ${mrsth('⏳ Pending','pending')}
        ${mrsth('✅ Approved','approved')}
        <th>Bar</th>
      </tr></thead>
      <tbody>${trs}</tbody>
      <tfoot><tr style="background:var(--surface2);font-weight:700">
        <td style="font-size:.81rem;color:var(--g8)">TOTAL</td>
        <td style="text-align:center;font-weight:700;color:var(--g7)">${_mrsSiteData.reduce((s,r)=>s+r.count,0)}</td>
        <td style="text-align:center;font-size:.8rem">${_mrsSiteData.reduce((s,r)=>s+r.pending,0)}</td>
        <td style="text-align:center;font-size:.8rem">${_mrsSiteData.reduce((s,r)=>s+r.approved,0)}</td>
        <td></td>
      </tr></tfoot>
    </table>`;

  // Apply sort + pagination
  const _t_mrsSiteTable = el?.querySelector?.(".emp-table, .vpi-tbl") || el?.closest?.(".card")?.querySelector?.(".emp-table, .vpi-tbl");
  if (_t_mrsSiteTable) { makeTableSortable(_t_mrsSiteTable); wrapTableScroll(_t_mrsSiteTable); }
}

// ── MRS MONTH CHART ───────────────────────────────────────
window.mrsChangeFY = function(fyKey) { _mrsSelectedFY = fyKey; renderMRSMonthChart(); };

function renderMRSMonthChart() {
  const el    = document.getElementById('mrs-month-chart');
  const badge = document.getElementById('mrs-month-badge');
  if (!el) return;

  const fy      = _mrsSelectedFY || currentFYKey();
  const startYr = 2000 + parseInt(fy.split('-')[0]);

  // Build 12-slot Apr→Mar grid
  const slots = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(startYr, 3 + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    slots.push({ key, label: d.toLocaleDateString('en-IN',{month:'short',year:'2-digit'}), count:0 });
  }
  _mrsMonthData.filter(m=>m.fyKey===fy).forEach(m => {
    const slot = slots.find(s=>s.key===m.key);
    if (slot) slot.count = m.count;
  });

  const maxCount   = Math.max(...slots.map(s=>s.count),1);
  const fyTotal    = slots.reduce((s,m)=>s+m.count,0);
  const curKey     = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
  if (badge) badge.innerHTML = `<strong>${fyTotal}</strong> MRS this FY`;

  if (fyTotal === 0) {
    el.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--txt3);width:100%">No MRS for FY ${fy}</div>`;
    return;
  }

  const bars = slots.map(m => {
    const h        = Math.round((m.count/maxCount)*110);
    const isCurr   = m.key === curKey;
    const barCol   = isCurr ? 'linear-gradient(180deg,var(--acc),#e65100)' : 'linear-gradient(180deg,var(--g6),var(--g8))';
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1;min-width:38px;max-width:70px">
      <div style="font-size:.67rem;font-weight:700;color:${m.count?'var(--g7)':'var(--txt4)'}">${m.count||'—'}</div>
      <div style="width:100%;display:flex;align-items:flex-end;height:110px">
        ${h>0 ? `<div style="width:100%;background:${barCol};border-radius:5px 5px 0 0;height:${h}px;${isCurr?'box-shadow:0 0 0 2px var(--acc)':''}"
          title="${m.label}: ${m.count} MRS"></div>`
          : `<div style="width:100%;height:3px;background:var(--surface2);border-radius:3px;align-self:flex-end"></div>`}
      </div>
      <div style="font-size:.68rem;font-weight:${isCurr?'800':'600'};color:${isCurr?'var(--g7)':'var(--txt3)'};white-space:nowrap">${m.label}</div>
    </div>`;
  }).join('');

  el.innerHTML = `<div style="display:flex;align-items:flex-end;gap:3px;width:100%;padding:0 .2rem">${bars}</div>`;
}

const APPSHEET_SCM_URL = 'https://www.appsheet.com/start/06fd0117-1dd8-445b-aaee-e2ff6e68e36f';

// ── APPSHEET VIEW DEEP LINKS ─────────────────────────────
const AS = {
  base:              APPSHEET_SCM_URL,
  v: n =>           `${APPSHEET_SCM_URL}#view=${encodeURIComponent(n)}`,
  // Named views from screenshot
  pendingMR:        () => AS.v('Pending MR Approval'),
  mrsMaster:        () => AS.v('MRS Master View'),
  purchase:         () => AS.v('Purchase'),
  poApproval:       () => AS.v('PO Approval'),
  stockLevels:      () => AS.v('Stock Levels'),
  newMR:            () => AS.v('New Material Request'),
  stockInOut:       () => AS.v('Stock IN / Stock Out'),
  goodsReceived:    () => AS.v('Goods Received'),
  stockInDetails:   () => AS.v('Stock IN Details'),
  pendingStockIn:   () => AS.v('Pending Stock IN'),
  stockOutList:     () => AS.v('StockOut List'),
  stockTransfer:    () => AS.v('Stock Transfer'),
  vendorRateList:   () => AS.v('Vendor Rate List'),
  invoiceTransport: () => AS.v('Invoice & Transport Update'),
  poAccounts:       () => AS.v('POs Moved to Accounts'),
};

// ── CSV DOWNLOAD UTILITY ─────────────────────────────────
function downloadCSV(rows, filename) {
  if (!rows || !rows.length) { alert('No data to download.'); return; }
  const keys = Object.keys(rows[0]).filter(k => !k.startsWith('_'));
  const esc  = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const csv  = [keys.map(esc).join(','), ...rows.map(r => keys.map(k => esc(r[k])).join(','))].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = filename || 'export.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
function dlBtn(fn, label) {
  return `<button onclick="${fn}" class="csv-btn" title="Download CSV">⬇ ${label || 'Download CSV'}</button>`;
}
function asBtn(url, label) {
  return `<button onclick="window.open('${url}','_blank')" class="as-btn" title="Open in AppSheet">
    🚀 ${label || 'AppSheet'}</button>`;
}

// ── State ────────────────────────────────────────────────
let _scmPendingPOs  = [];
let _scmSiteData    = [];
let _scmVendorData  = [];
let _scmMonthData   = [];
let _scmAllRows     = [];   // full dataset for FY filtering
let _scmSelectedFY  = null; // e.g. '25-26'
let _pendingSort    = { col: 'ageDays', dir: -1 };
let _siteSort       = { col: 'amount',  dir: -1 };
let _vendorSort     = { col: 'amount',  dir: -1 };

// ── FY HELPERS ────────────────────────────────────────────
// Indian FY: Apr 1 → Mar 31. Key = 'YY-YY' e.g. '25-26'
function getFYKey(date) {
  if (!date) return null;
  const yr = date.getFullYear(), mo = date.getMonth(); // 0=Jan
  const fyStart = mo >= 3 ? yr : yr - 1;              // Apr(3) starts new FY
  return `${String(fyStart).slice(-2)}-${String(fyStart+1).slice(-2)}`;
}
function getFYRange(fyKey) {
  // '25-26' → Apr 2025 – Mar 2026
  const startYr = 2000 + parseInt(fyKey.split('-')[0]);
  return {
    start: new Date(startYr, 3, 1),      // Apr 1
    end:   new Date(startYr + 1, 2, 31), // Mar 31
  };
}
function currentFYKey() {
  return getFYKey(new Date());
}
// Auto-generates FY list: 3 years back + current + 1 year ahead
// Format: 'YY-YY' e.g. '25-26'. Always up to date — no manual edits needed.
function getFYSet(pastYears, futureYears) {
  pastYears   = pastYears   !== undefined ? pastYears   : 3;
  futureYears = futureYears !== undefined ? futureYears : 1;
  const now     = new Date();
  const curFYStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const list = [];
  for (let offset = futureYears; offset >= -pastYears; offset--) {
    const s = curFYStart + offset;
    list.push(String(s).slice(-2) + '-' + String(s + 1).slice(-2));
  }
  return list;
}

// ── DASHBOARD HTML ───────────────────────────────────────
// ── Embedded JSX source strings for Budget & Planning ──

const PLANNING_SETUP_JSX = "\n// \u2500\u2500 Section data \u2500\u2500\nconst INITIAL_CONFIG = {\n  project: {\n    jobNo: \"5453\",\n    jobDesc: \"Upgrading of the drinking water supply in Gueyo and its surrounding area - Lot I\",\n    client: \"\",\n    location: \"Ivory Coast (Gueyo)\",\n    projectManager: \"\",\n    startDate: \"2023-10-24\",\n    endDate: \"\",\n    budgetRevNo: \"Rev 04\",\n    budgetDate: \"2025-04-30\",\n    contractValue: \"\",\n    revisedBudget: \"\",\n    prestartBudget: \"\",\n  },\n  currency: {\n    primary: \"USD\",\n    secondary: \"INR\",\n    exchangeRate: 83.0,\n    ctcConversion: 74.62,\n    figuresS29: \"Thousands\",\n    figuresS31: \"USD\",\n    figuresS28: \"INR Lacs\",\n  },\n  rates: {\n    welfare: [\n      { id: \"w1\", item: \"Medical & GPA per person\", rate: 250, unit: \"USD/person/month\", note: \"S-31 Backup row 36\" },\n      { id: \"w2\", item: \"Food - Staff per head\", rate: 160, unit: \"USD/person/month\", note: \"S-31 Backup row 37\" },\n      { id: \"w3\", item: \"Food - Workers per head\", rate: 160, unit: \"USD/person/month\", note: \"S-31 Backup row 38\" },\n      { id: \"w4\", item: \"Staff Welfare Others per head\", rate: 7, unit: \"USD/person/month\", note: \"S-31 Backup row 39\" },\n      { id: \"w5\", item: \"Tea/Coffee/Snacks per head\", rate: 5, unit: \"USD/person/month\", note: \"S-31 Backup row 40\" },\n      { id: \"w6\", item: \"Festival Celebrations per quarter\", rate: 600, unit: \"USD/quarter\", note: \"S-31 Backup row 41\" },\n    ],\n    water: [\n      { id: \"wt1\", item: \"Water rate per litre\", rate: 0.004, unit: \"USD/litre\", note: \"50L per person per day\" },\n      { id: \"wt2\", item: \"Drinking water rate per litre\", rate: 0.2, unit: \"USD/litre\", note: \"3L per person per day\" },\n      { id: \"wt3\", item: \"Water consumption per person\", rate: 50, unit: \"litres/day\", note: \"Staff & workers\" },\n      { id: \"wt4\", item: \"Drinking water per person\", rate: 3, unit: \"litres/day\", note: \"\" },\n    ],\n    vehicle: [\n      { id: \"v1\", item: \"Car hire rate (7-seater)\", rate: 2362, unit: \"USD/vehicle/month\", note: \"S-31 Backup row 22\" },\n      { id: \"v2\", item: \"POL rate\", rate: 1.22, unit: \"USD/litre\", note: \"S-31 Backup row 24\" },\n      { id: \"v3\", item: \"POL monthly km per vehicle\", rate: 3000, unit: \"km/month\", note: \"Assumed\" },\n      { id: \"v4\", item: \"Vehicle fuel consumption\", rate: 8, unit: \"km/litre\", note: \"Average\" },\n      { id: \"v5\", item: \"Local conveyance provision\", rate: 100, unit: \"USD/month\", note: \"Reducing to 50 later\" },\n    ],\n    travel: [\n      { id: \"t1\", item: \"Local travel provision\", rate: 500, unit: \"USD/month\", note: \"S-31 Backup row 13\" },\n      { id: \"t2\", item: \"HO/Site visits per quarter\", rate: 4000, unit: \"USD/quarter\", note: \"S-31 Backup row 16\" },\n      { id: \"t3\", item: \"Staff leave travel\", rate: 2000, unit: \"USD/bi-monthly\", note: \"S-31 Backup row 17\" },\n      { id: \"t4\", item: \"Lodging & boarding per quarter\", rate: 3000, unit: \"USD/quarter\", note: \"Reduces later\" },\n      { id: \"t5\", item: \"Initial mob/demob per HO staff\", rate: 8000, unit: \"USD/person\", note: \"S-31 Backup row 14\" },\n      { id: \"t6\", item: \"Initial mob/demob per worker\", rate: 3200, unit: \"USD/person\", note: \"Varies\" },\n    ],\n    rent: [\n      { id: \"rn1\", item: \"House rent per unit\", rate: 1000, unit: \"USD/house/month\", note: \"4 houses initially\" },\n      { id: \"rn2\", item: \"Office/yard rent (Gueyo)\", rate: 350, unit: \"USD/month\", note: \"Rises to 850\" },\n      { id: \"rn3\", item: \"Rent escalation\", rate: 10, unit: \"%\", note: \"Annual\" },\n    ],\n    comms: [\n      { id: \"cm1\", item: \"Postage/courier\", rate: 100, unit: \"USD/month\", note: \"Reducing to 50\" },\n      { id: \"cm2\", item: \"Internet/bandwidth\", rate: 1272, unit: \"USD/month\", note: \"S-31 Backup row 29\" },\n      { id: \"cm3\", item: \"Printing & stationery\", rate: 100, unit: \"USD/month\", note: \"Reducing to 50\" },\n    ],\n    finance: [\n      { id: \"f1\", item: \"BG charges rate\", rate: 2, unit: \"%\", note: \"2% of PBG/ABG\" },\n      { id: \"f2\", item: \"Bank charges on RA bill\", rate: 0.5, unit: \"%\", note: \"0.5% on each RA bill\" },\n      { id: \"f3\", item: \"LC charges rate\", rate: 0.5, unit: \"% PA\", note: \"0.5% per annum\" },\n    ],\n    contingency: [\n      { id: \"cn1\", item: \"Risk and contingency (monthly)\", rate: 12862, unit: \"USD/month\", note: \"S-31 row 31\" },\n      { id: \"cn2\", item: \"Uncovered escalation (monthly)\", rate: 12862, unit: \"USD/month\", note: \"S-31 row 32\" },\n      { id: \"cn3\", item: \"Additional contingency base\", rate: 60924, unit: \"USD/month\", note: \"Varies 60-81K\" },\n      { id: \"cn4\", item: \"DLP provision\", rate: 372211, unit: \"USD\", note: \"Lump sum at project end\" },\n    ],\n    security: [\n      { id: \"sc1\", item: \"Security (Watch & Ward) base\", rate: 10756, unit: \"USD/month\", note: \"Varies with ramp-down\" },\n      { id: \"sc2\", item: \"Misc. expenses\", rate: 100, unit: \"USD/month\", note: \"Flat\" },\n      { id: \"sc3\", item: \"CSR per occurrence\", rate: 5000, unit: \"USD\", note: \"Twice/year\" },\n    ],\n  },\n  insurance: [\n    { id: \"i1\", type: \"CAR - Contractor All Risk\", rate: 113000, unit: \"USD total / 24 months\", note: \"24-month policy\" },\n    { id: \"i2\", type: \"CPM - Plant & Machinery\", rate: 0.45, unit: \"% of equip value/yr\", note: \"Annual premium\" },\n    { id: \"i3\", type: \"Marine Cargo\", rate: 0.15, unit: \"% of cargo value/yr\", note: \"Annual premium\" },\n    { id: \"i4\", type: \"WC - Workmen Compensation\", rate: 50, unit: \"USD/worker/yr\", note: \"Per worker\" },\n    { id: \"i5\", type: \"Employee Related\", rate: 600, unit: \"USD/person/yr\", note: \"Per person\" },\n    { id: \"i6\", type: \"Automobile\", rate: 700, unit: \"USD/vehicle/yr\", note: \"Per vehicle\" },\n  ],\n  costCategories: [\n    { id: \"cc1\", name: \"Salaries (HO Monthly)\", type: \"Running\", module: \"Manpower\" },\n    { id: \"cc2\", name: \"Wages\", type: \"Running\", module: \"Manpower\" },\n    { id: \"cc3\", name: \"Contractual Employment Salary\", type: \"Running\", module: \"Manpower\" },\n    { id: \"cc4\", name: \"Manpower Agency\", type: \"Running\", module: \"Manpower\" },\n    { id: \"cc5\", name: \"Travelling & Conveyance\", type: \"Running\", module: \"Running Costs\" },\n    { id: \"cc6\", name: \"Communications/Postage/Internet\", type: \"Running\", module: \"Running Costs\" },\n    { id: \"cc7\", name: \"Printing & Stationery\", type: \"Running\", module: \"Running Costs\" },\n    { id: \"cc8\", name: \"Staff Welfare Expenses\", type: \"Running\", module: \"Running Costs\" },\n    { id: \"cc9\", name: \"Water/Electricity\", type: \"Running\", module: \"Running Costs\" },\n    { id: \"cc10\", name: \"Car Hire (incl fuel)\", type: \"Running\", module: \"Running Costs\" },\n    { id: \"cc11\", name: \"Security (Watch & Ward)\", type: \"Running\", module: \"Running Costs\" },\n    { id: \"cc12\", name: \"Rent (Office/House/Land)\", type: \"Running\", module: \"Running Costs\" },\n    { id: \"cc13\", name: \"Other Expenses / VISA\", type: \"Running\", module: \"Running Costs\" },\n    { id: \"cc14\", name: \"CSR\", type: \"Running\", module: \"Running Costs\" },\n    { id: \"cc15\", name: \"Vehicle Registration & Insurance\", type: \"Other\", module: \"Running Costs\" },\n    { id: \"cc16\", name: \"Professional Tax\", type: \"Other\", module: \"Running Costs\" },\n    { id: \"cc17\", name: \"Technical Consultancy\", type: \"Other\", module: \"Running Costs\" },\n    { id: \"cc18\", name: \"TPIA\", type: \"Other\", module: \"Running Costs\" },\n    { id: \"cc19\", name: \"Freight & Forward\", type: \"Other\", module: \"Running Costs\" },\n    { id: \"cc20\", name: \"Risk and Contingency\", type: \"Other\", module: \"Running Costs\" },\n    { id: \"cc21\", name: \"Uncovered Escalation\", type: \"Other\", module: \"Running Costs\" },\n    { id: \"cc22\", name: \"Additional Contingency\", type: \"Other\", module: \"Running Costs\" },\n    { id: \"cc23\", name: \"Insurance Charges\", type: \"Other\", module: \"Running Costs\" },\n    { id: \"cc24\", name: \"DLP\", type: \"Other\", module: \"Running Costs\" },\n    { id: \"cc25\", name: \"BG Charges\", type: \"Finance\", module: \"Running Costs\" },\n    { id: \"cc26\", name: \"Bank Charges on RA\", type: \"Finance\", module: \"Running Costs\" },\n    { id: \"cc27\", name: \"LC Charges\", type: \"Finance\", module: \"Running Costs\" },\n  ],\n  fyPeriods: [\n    { id: \"fy1\", label: \"FY 2023-2024\", start: \"2023-04-01\", end: \"2024-03-31\", note: \"Pre-project / mobilisation\" },\n    { id: \"fy2\", label: \"FY 2024-2025\", start: \"2024-04-01\", end: \"2025-03-31\", note: \"Year 1 \u2014 primary construction\" },\n    { id: \"fy3\", label: \"FY 2025-2026\", start: \"2025-04-01\", end: \"2026-03-31\", note: \"Year 2 \u2014 completion & commissioning\" },\n    { id: \"fy4\", label: \"FY 2026-2027\", start: \"2026-04-01\", end: \"2027-03-31\", note: \"Year 3 \u2014 DLP / retention\" },\n  ],\n  alerts: [\n    { id: \"a1\", rule: \"BOQ rate exceeded\", threshold: 0, unit: \"% over BOQ rate\", action: \"Red flag if computed cost > BOQ rate\" },\n    { id: \"a2\", rule: \"Budget variance warning\", threshold: 10, unit: \"%\", action: \"Yellow alert if actual > 110% of budget\" },\n    { id: \"a3\", rule: \"Budget variance critical\", threshold: 20, unit: \"%\", action: \"Red alert if actual > 120% of budget\" },\n    { id: \"a4\", rule: \"Manpower count variance\", threshold: 2, unit: \"persons\", action: \"Flag if headcount differs by >2\" },\n    { id: \"a5\", rule: \"Measurement approval overdue\", threshold: 7, unit: \"days\", action: \"Highlight pending approval >7 days\" },\n    { id: \"a6\", rule: \"WO balance < threshold\", threshold: 10, unit: \"% of WO value\", action: \"Warn if subcontractor balance low\" },\n    { id: \"a7\", rule: \"Monthly spend spike\", threshold: 25, unit: \"% over avg\", action: \"Alert if month >25% above trailing 3-mo\" },\n    { id: \"a8\", rule: \"Equipment idle days\", threshold: 14, unit: \"days\", action: \"Flag equipment idle >14 days\" },\n  ],\n  personnel: [\n    { id: \"p1\", role: \"Project Manager\", name: \"Amrendra Kumar Singh\", portalRole: \"md\", access: \"Full access\" },\n    { id: \"p2\", role: \"Sr. Manager\", name: \"Ajay Kumar Tiwari\", portalRole: \"site\", access: \"Site operations\" },\n    { id: \"p3\", role: \"Manager (Civil)\", name: \"Ajit Balu Dhenge\", portalRole: \"site\", access: \"Site operations\" },\n    { id: \"p4\", role: \"Dy. Manager - Planning\", name: \"Uggina Sravan Kumar\", portalRole: \"purchase\", access: \"BOQ, schedule\" },\n    { id: \"p5\", role: \"Manager - Accounts\", name: \"Md. Rafi\", portalRole: \"accounts\", access: \"Finance, budget\" },\n    { id: \"p6\", role: \"Manager - Procurement\", name: \"Sujit Mallick\", portalRole: \"purchase\", access: \"SCM, stores\" },\n    { id: \"p7\", role: \"Dy. Manager - QA/QC\", name: \"Sanjeev Sehgal\", portalRole: \"site\", access: \"Quality\" },\n    { id: \"p8\", role: \"Dy. Manager - MEP\", name: \"Arshad Hussain\", portalRole: \"site\", access: \"E&M works\" },\n    { id: \"p9\", role: \"Dy. Manager - P&A\", name: \"Puneet Kumar\", portalRole: \"hr\", access: \"HR, admin\" },\n    { id: \"p10\", role: \"Sr. Engineer - QSS\", name: \"Ayush Kumar Singh\", portalRole: \"site\", access: \"Quantity surveying\" },\n    { id: \"p11\", role: \"Surveyor - Dy. Manager\", name: \"Syamal Kumar Roy\", portalRole: \"site\", access: \"Survey\" },\n  ],\n};\n\nconst RATE_SUBSECTIONS = [\n  { key: \"welfare\", label: \"C1. Staff Welfare Rates\", icon: \"heart\" },\n  { key: \"water\", label: \"C2. Water & Electricity\", icon: \"drop\" },\n  { key: \"vehicle\", label: \"C3. Vehicle & Transport\", icon: \"truck\" },\n  { key: \"travel\", label: \"C4. Travel Rates\", icon: \"plane\" },\n  { key: \"rent\", label: \"C5. Rent Rates\", icon: \"home\" },\n  { key: \"comms\", label: \"C6. Communications\", icon: \"signal\" },\n  { key: \"finance\", label: \"C7. Finance & BG Rates\", icon: \"bank\" },\n  { key: \"contingency\", label: \"C8. Contingency & Risk\", icon: \"shield\" },\n  { key: \"security\", label: \"C9. Security & Misc\", icon: \"lock\" },\n];\n\nconst PORTAL_ROLES = [\"md\", \"hr\", \"site\", \"employee\", \"purchase\", \"accounts\", \"vendor\", \"sc\"];\nconst TYPE_COLORS = { Running: \"#6ec87a\", Other: \"#d4a853\", Finance: \"#5b9bd5\" };\nconst ROLE_COLORS = { md: \"#e06c60\", hr: \"#c084fc\", site: \"#6ec87a\", purchase: \"#5b9bd5\", accounts: \"#d4a853\", employee: \"#8b8e96\" };\n\n// \u2500\u2500 Icons \u2500\u2500\nconst Icons = {\n  settings: <svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"2\" strokeLinecap=\"round\"><circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z\"/></svg>,\n  chevron: (open) => <svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"2.5\" strokeLinecap=\"round\" style={{ transform: open ? \"rotate(90deg)\" : \"rotate(0deg)\", transition: \"transform 0.2s\" }}><polyline points=\"9 18 15 12 9 6\"/></svg>,\n  save: <svg width=\"15\" height=\"15\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"2\" strokeLinecap=\"round\"><path d=\"M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z\"/><polyline points=\"17 21 17 13 7 13 7 21\"/><polyline points=\"7 3 7 8 15 8\"/></svg>,\n  edit: <svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"2\" strokeLinecap=\"round\"><path d=\"M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7\"/><path d=\"M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z\"/></svg>,\n  check: <svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"2.5\" strokeLinecap=\"round\"><polyline points=\"20 6 9 17 4 12\"/></svg>,\n  plus: <svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"2.5\" strokeLinecap=\"round\"><line x1=\"12\" y1=\"5\" x2=\"12\" y2=\"19\"/><line x1=\"5\" y1=\"12\" x2=\"19\" y2=\"12\"/></svg>,\n  trash: <svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"2\" strokeLinecap=\"round\"><polyline points=\"3 6 5 6 21 6\"/><path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"/></svg>,\n};\n\n// \u2500\u2500 Styles \u2500\u2500\nconst inputStyle = { background: \"#1a1d24\", border: \"1px solid #252830\", borderRadius: 6, padding: \"7px 10px\", color: \"#e8e6e1\", fontSize: 13, fontFamily: \"'JetBrains Mono', monospace\", width: \"100%\", outline: \"none\" };\nconst btnGold = { background: \"linear-gradient(135deg, #d4a853, #b8892e)\", border: \"none\", borderRadius: 6, padding: \"7px 14px\", color: \"#0f1114\", fontSize: 12, fontWeight: 600, cursor: \"pointer\", display: \"inline-flex\", alignItems: \"center\", gap: 6 };\nconst btnOutline = { background: \"transparent\", border: \"1px solid #252830\", borderRadius: 6, padding: \"6px 12px\", color: \"#6b6e76\", fontSize: 11, fontWeight: 500, cursor: \"pointer\", display: \"inline-flex\", alignItems: \"center\", gap: 5 };\nconst cardStyle = { background: \"#16181e\", border: \"1px solid #1e2128\", borderRadius: 10, overflow: \"hidden\" };\n\nconst Badge = ({ text, color }) => (\n  <span style={{ background: color + \"18\", color, fontSize: 10, fontWeight: 600, padding: \"2px 8px\", borderRadius: 4, letterSpacing: \"0.03em\", textTransform: \"uppercase\" }}>{text}</span>\n);\n\nfunction ProjectSetup() {\n  const [config, setConfig] = useState(INITIAL_CONFIG);\n  const [expandedSections, setExpandedSections] = useState({ project: true });\n  const [expandedRateSubs, setExpandedRateSubs] = useState({});\n  const [toast, setToast] = useState(null);\n  const [dirty, setDirty] = useState(false);\n\n  const showToast = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); }, []);\n\n  const toggleSection = (key) => setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));\n  const toggleRateSub = (key) => setExpandedRateSubs(prev => ({ ...prev, [key]: !prev[key] }));\n\n  const updateProject = (field, value) => {\n    setConfig(prev => ({ ...prev, project: { ...prev.project, [field]: value } }));\n    setDirty(true);\n  };\n  const updateCurrency = (field, value) => {\n    setConfig(prev => ({ ...prev, currency: { ...prev.currency, [field]: value } }));\n    setDirty(true);\n  };\n  const updateRate = (subsection, id, value) => {\n    setConfig(prev => ({\n      ...prev,\n      rates: { ...prev.rates, [subsection]: prev.rates[subsection].map(r => r.id === id ? { ...r, rate: value } : r) }\n    }));\n    setDirty(true);\n  };\n  const updateInsurance = (id, value) => {\n    setConfig(prev => ({ ...prev, insurance: prev.insurance.map(i => i.id === id ? { ...i, rate: value } : i) }));\n    setDirty(true);\n  };\n  const updateAlert = (id, value) => {\n    setConfig(prev => ({ ...prev, alerts: prev.alerts.map(a => a.id === id ? { ...a, threshold: value } : a) }));\n    setDirty(true);\n  };\n  const updatePersonnel = (id, field, value) => {\n    setConfig(prev => ({ ...prev, personnel: prev.personnel.map(p => p.id === id ? { ...p, [field]: value } : p) }));\n    setDirty(true);\n  };\n\n  const totalRates = useMemo(() => {\n    let count = 0;\n    Object.values(config.rates).forEach(arr => count += arr.length);\n    return count;\n  }, [config.rates]);\n\n  const handleSave = () => {\n    setDirty(false);\n    showToast(\"Configuration saved to Project_Master sheet\");\n  };\n\n  // \u2500\u2500 Section header component \u2500\u2500\n  const SectionHeader = ({ sectionKey, letter, title, subtitle, count, color }) => (\n    <div\n      onClick={() => toggleSection(sectionKey)}\n      style={{ padding: \"14px 18px\", cursor: \"pointer\", display: \"flex\", alignItems: \"center\", gap: 12, transition: \"background 0.12s\" }}\n      onMouseEnter={e => e.currentTarget.style.background = \"#1a1d24\"}\n      onMouseLeave={e => e.currentTarget.style.background = \"transparent\"}\n    >\n      <div style={{ width: 32, height: 32, borderRadius: 8, background: (color || \"#d4a853\") + \"20\", display: \"flex\", alignItems: \"center\", justifyContent: \"center\", fontSize: 13, fontWeight: 700, color: color || \"#d4a853\", flexShrink: 0 }}>{letter}</div>\n      <div style={{ flex: 1, minWidth: 0 }}>\n        <div style={{ fontSize: 14, fontWeight: 600, color: \"#f0ede6\" }}>{title}</div>\n        <div style={{ fontSize: 11, color: \"#555960\", marginTop: 1 }}>{subtitle}</div>\n      </div>\n      {count !== undefined && <span style={{ fontSize: 11, fontFamily: \"'JetBrains Mono', monospace\", color: \"#555960\", background: \"#1a1d24\", padding: \"2px 8px\", borderRadius: 4 }}>{count}</span>}\n      <span style={{ color: \"#555960\" }}>{Icons.chevron(expandedSections[sectionKey])}</span>\n    </div>\n  );\n\n  // \u2500\u2500 Field row for project/currency \u2500\u2500\n  const FieldRow = ({ label, value, onChange, unit, note, type }) => (\n    <div style={{ display: \"flex\", gap: 8, alignItems: \"center\", padding: \"6px 18px 6px 62px\" }}>\n      <div style={{ width: 200, fontSize: 12, color: \"#8b8e96\", flexShrink: 0 }}>{label}</div>\n      <div style={{ flex: 1, maxWidth: 320 }}>\n        <input\n          type={type || \"text\"}\n          value={value}\n          onChange={e => onChange(type === \"number\" ? parseFloat(e.target.value) || 0 : e.target.value)}\n          style={inputStyle}\n        />\n      </div>\n      {unit && <span style={{ fontSize: 10, color: \"#555960\", minWidth: 80 }}>{unit}</span>}\n      {note && <span style={{ fontSize: 10, color: \"#7a6b3a\", fontStyle: \"italic\" }}>{note}</span>}\n    </div>\n  );\n\n  return (\n    <div style={{ minHeight: \"100vh\", background: \"#0f1114\", fontFamily: \"'DM Sans', 'Segoe UI', system-ui, sans-serif\", color: \"#e8e6e1\" }}>\n      <style>{`\n        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');\n        * { box-sizing: border-box; margin: 0; padding: 0; }\n        input[type=\"number\"]::-webkit-inner-spin-button, input[type=\"number\"]::-webkit-outer-spin-button { -webkit-appearance: none; }\n        input[type=\"number\"] { -moz-appearance: textfield; }\n        ::-webkit-scrollbar { width: 5px; height: 5px; }\n        ::-webkit-scrollbar-track { background: transparent; }\n        ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }\n        @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }\n        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }\n        @keyframes toastIn { from { opacity: 0; transform: translateY(16px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }\n        select { background-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b6e76' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\"); background-repeat: no-repeat; background-position: right 8px center; -webkit-appearance: none; appearance: none; padding-right: 28px !important; }\n        input:focus, select:focus { border-color: #d4a853 !important; box-shadow: 0 0 0 1px #d4a85330; }\n      `}</style>\n\n      {/* \u2500\u2500 Header \u2500\u2500 */}\n      <div style={{ borderBottom: \"1px solid #1e2128\", padding: \"14px 24px\", display: \"flex\", alignItems: \"center\", justifyContent: \"space-between\", background: \"#13151a\" }}>\n        <div style={{ display: \"flex\", alignItems: \"center\", gap: 12 }}>\n          <div style={{ width: 34, height: 34, borderRadius: 8, background: \"linear-gradient(135deg, #d4a853, #b8892e)\", display: \"flex\", alignItems: \"center\", justifyContent: \"center\", color: \"#0f1114\" }}>{Icons.settings}</div>\n          <div>\n            <h1 style={{ fontSize: 16, fontWeight: 700, letterSpacing: \"-0.02em\", color: \"#f0ede6\" }}>Project Setup</h1>\n            <span style={{ fontSize: 10, color: \"#6b6e76\", fontWeight: 500, letterSpacing: \"0.05em\", textTransform: \"uppercase\" }}>Configuration & Constants</span>\n          </div>\n        </div>\n        <div style={{ display: \"flex\", alignItems: \"center\", gap: 10 }}>\n          {dirty && <span style={{ fontSize: 11, color: \"#d4a853\", fontStyle: \"italic\" }}>Unsaved changes</span>}\n          <button onClick={handleSave} style={{ ...btnGold, opacity: dirty ? 1 : 0.5 }}>{Icons.save} Save Config</button>\n        </div>\n      </div>\n\n      {/* \u2500\u2500 Summary cards \u2500\u2500 */}\n      <div style={{ maxWidth: 1140, margin: \"0 auto\", padding: \"20px 16px\" }}>\n        <div style={{ display: \"flex\", gap: 10, marginBottom: 18, flexWrap: \"wrap\" }}>\n          {[\n            { label: \"Project\", value: config.project.jobNo || \"\u2014\", color: \"#d4a853\" },\n            { label: \"Cost Rates\", value: totalRates, color: \"#6ec87a\" },\n            { label: \"Cost Categories\", value: config.costCategories.length, color: \"#5b9bd5\" },\n            { label: \"Alert Rules\", value: config.alerts.length, color: \"#e06c60\" },\n            { label: \"Personnel\", value: config.personnel.length, color: \"#c084fc\" },\n          ].map((s, i) => (\n            <div key={i} style={{ background: \"#16181e\", border: \"1px solid #1e2128\", borderRadius: 8, padding: \"10px 16px\", flex: 1, minWidth: 110 }}>\n              <div style={{ fontSize: 10, color: \"#555960\", textTransform: \"uppercase\", letterSpacing: \"0.05em\", marginBottom: 3 }}>{s.label}</div>\n              <div style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: \"'JetBrains Mono', monospace\" }}>{s.value}</div>\n            </div>\n          ))}\n        </div>\n\n        {/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 A. PROJECT INFORMATION \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */}\n        <div style={{ ...cardStyle, marginBottom: 10 }}>\n          <SectionHeader sectionKey=\"project\" letter=\"A\" title=\"Project Information\" subtitle=\"Job details, client, dates, contract value\" count={12} />\n          {expandedSections.project && (\n            <div style={{ padding: \"4px 0 14px\", animation: \"fadeIn 0.2s ease\", borderTop: \"1px solid #1e2128\" }}>\n              {[\n                [\"jobNo\", \"Job Number\", \"\", \"\"],\n                [\"jobDesc\", \"Job Description\", \"\", \"\"],\n                [\"client\", \"Client Name\", \"\", \"Enter client organization\"],\n                [\"location\", \"Location\", \"\", \"Country / Region\"],\n                [\"projectManager\", \"Project Manager\", \"\", \"\"],\n                [\"startDate\", \"Start Date\", \"\", \"Contractual start\"],\n                [\"endDate\", \"End Date\", \"\", \"Planned completion\"],\n                [\"budgetRevNo\", \"Budget Revision\", \"\", \"\"],\n                [\"budgetDate\", \"Budget Date\", \"\", \"\"],\n                [\"contractValue\", \"Contract Value\", \"USD\", \"\"],\n                [\"revisedBudget\", \"Revised Budget\", \"USD\", \"\"],\n                [\"prestartBudget\", \"Prestart Budget\", \"USD\", \"\"],\n              ].map(([key, label, unit, note]) => (\n                <FieldRow key={key} label={label} value={config.project[key]} onChange={v => updateProject(key, v)} unit={unit} note={note} />\n              ))}\n            </div>\n          )}\n        </div>\n\n        {/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 B. CURRENCY & EXCHANGE \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */}\n        <div style={{ ...cardStyle, marginBottom: 10 }}>\n          <SectionHeader sectionKey=\"currency\" letter=\"B\" title=\"Currency & Exchange Rates\" subtitle=\"Primary/secondary currency, conversion factors\" count={7} color=\"#5b9bd5\" />\n          {expandedSections.currency && (\n            <div style={{ padding: \"4px 0 14px\", animation: \"fadeIn 0.2s ease\", borderTop: \"1px solid #1e2128\" }}>\n              {[\n                [\"primary\", \"Primary Currency\", \"\", \"All sheets use this\"],\n                [\"secondary\", \"Secondary Currency\", \"\", \"For HO costs\"],\n                [\"exchangeRate\", \"Exchange Rate\", \"INR per USD\", \"Update monthly\", \"number\"],\n                [\"ctcConversion\", \"CTC Conversion Factor\", \"INR per USD\", \"S-30 salary conversion\", \"number\"],\n                [\"figuresS29\", \"Figures Unit (S-29)\", \"\", \"\"],\n                [\"figuresS31\", \"Figures Unit (S-31)\", \"\", \"\"],\n                [\"figuresS28\", \"Figures Unit (S-28)\", \"\", \"\"],\n              ].map(([key, label, unit, note, type]) => (\n                <FieldRow key={key} label={label} value={config.currency[key]} onChange={v => updateCurrency(key, v)} unit={unit} note={note} type={type} />\n              ))}\n            </div>\n          )}\n        </div>\n\n        {/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 C. COST RATES & CONSTANTS \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */}\n        <div style={{ ...cardStyle, marginBottom: 10 }}>\n          <SectionHeader sectionKey=\"rates\" letter=\"C\" title=\"Cost Rates & Constants\" subtitle=\"9 sub-sections extracted from Afcons S-31 / Backup\" count={`${totalRates} rates`} color=\"#6ec87a\" />\n          {expandedSections.rates && (\n            <div style={{ borderTop: \"1px solid #1e2128\", animation: \"fadeIn 0.2s ease\" }}>\n              {RATE_SUBSECTIONS.map(sub => (\n                <div key={sub.key}>\n                  <div\n                    onClick={() => toggleRateSub(sub.key)}\n                    style={{ padding: \"10px 18px 10px 52px\", cursor: \"pointer\", display: \"flex\", alignItems: \"center\", gap: 8, borderBottom: \"1px solid #1a1d24\" }}\n                    onMouseEnter={e => e.currentTarget.style.background = \"#1a1d24\"}\n                    onMouseLeave={e => e.currentTarget.style.background = \"transparent\"}\n                  >\n                    <span style={{ fontSize: 12, fontWeight: 600, color: \"#6ec87a\", flex: 1 }}>{sub.label}</span>\n                    <span style={{ fontSize: 10, color: \"#555960\", fontFamily: \"'JetBrains Mono', monospace\" }}>{config.rates[sub.key].length}</span>\n                    <span style={{ color: \"#555960\" }}>{Icons.chevron(expandedRateSubs[sub.key])}</span>\n                  </div>\n                  {expandedRateSubs[sub.key] && (\n                    <div style={{ background: \"#13151a\" }}>\n                      <div style={{ display: \"flex\", gap: 0, padding: \"6px 18px 6px 72px\", borderBottom: \"1px solid #1a1d24\" }}>\n                        <span style={{ flex: 2, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\", letterSpacing: \"0.05em\" }}>Item</span>\n                        <span style={{ width: 120, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\", letterSpacing: \"0.05em\", textAlign: \"right\" }}>Rate</span>\n                        <span style={{ width: 140, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\", letterSpacing: \"0.05em\", paddingLeft: 12 }}>Unit</span>\n                        <span style={{ width: 160, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\", letterSpacing: \"0.05em\" }}>Source</span>\n                      </div>\n                      {config.rates[sub.key].map(rate => (\n                        <div key={rate.id} style={{ display: \"flex\", gap: 0, padding: \"5px 18px 5px 72px\", borderBottom: \"1px solid #1a1c20\", alignItems: \"center\" }}>\n                          <span style={{ flex: 2, fontSize: 12, color: \"#a09c94\" }}>{rate.item}</span>\n                          <div style={{ width: 120 }}>\n                            <input\n                              type=\"number\"\n                              value={rate.rate}\n                              onChange={e => updateRate(sub.key, rate.id, parseFloat(e.target.value) || 0)}\n                              style={{ ...inputStyle, textAlign: \"right\", padding: \"4px 8px\", fontSize: 12 }}\n                              step=\"any\"\n                            />\n                          </div>\n                          <span style={{ width: 140, fontSize: 10, color: \"#555960\", paddingLeft: 12 }}>{rate.unit}</span>\n                          <span style={{ width: 160, fontSize: 10, color: \"#7a6b3a\", fontStyle: \"italic\" }}>{rate.note}</span>\n                        </div>\n                      ))}\n                    </div>\n                  )}\n                </div>\n              ))}\n            </div>\n          )}\n        </div>\n\n        {/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 D. INSURANCE CONSTANTS \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */}\n        <div style={{ ...cardStyle, marginBottom: 10 }}>\n          <SectionHeader sectionKey=\"insurance\" letter=\"D\" title=\"Insurance Constants\" subtitle=\"Policy types and premium rates\" count={config.insurance.length} color=\"#c084fc\" />\n          {expandedSections.insurance && (\n            <div style={{ borderTop: \"1px solid #1e2128\", animation: \"fadeIn 0.2s ease\" }}>\n              <div style={{ display: \"flex\", gap: 0, padding: \"8px 18px 6px 52px\", borderBottom: \"1px solid #1a1d24\" }}>\n                <span style={{ flex: 2, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\" }}>Policy Type</span>\n                <span style={{ width: 130, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\", textAlign: \"right\" }}>Rate / Amount</span>\n                <span style={{ width: 150, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\", paddingLeft: 12 }}>Unit</span>\n                <span style={{ width: 140, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\" }}>Notes</span>\n              </div>\n              {config.insurance.map(ins => (\n                <div key={ins.id} style={{ display: \"flex\", gap: 0, padding: \"6px 18px 6px 52px\", borderBottom: \"1px solid #1a1c20\", alignItems: \"center\" }}>\n                  <span style={{ flex: 2, fontSize: 12, color: \"#a09c94\" }}>{ins.type}</span>\n                  <div style={{ width: 130 }}>\n                    <input\n                      type=\"number\"\n                      value={ins.rate}\n                      onChange={e => updateInsurance(ins.id, parseFloat(e.target.value) || 0)}\n                      style={{ ...inputStyle, textAlign: \"right\", padding: \"4px 8px\", fontSize: 12 }}\n                      step=\"any\"\n                    />\n                  </div>\n                  <span style={{ width: 150, fontSize: 10, color: \"#555960\", paddingLeft: 12 }}>{ins.unit}</span>\n                  <span style={{ width: 140, fontSize: 10, color: \"#7a6b3a\", fontStyle: \"italic\" }}>{ins.note}</span>\n                </div>\n              ))}\n            </div>\n          )}\n        </div>\n\n        {/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 E. COST CATEGORIES \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */}\n        <div style={{ ...cardStyle, marginBottom: 10 }}>\n          <SectionHeader sectionKey=\"categories\" letter=\"E\" title=\"Cost Categories\" subtitle=\"Master list of all cost heads across Running / Other / Finance\" count={config.costCategories.length} color=\"#d4a853\" />\n          {expandedSections.categories && (\n            <div style={{ borderTop: \"1px solid #1e2128\", animation: \"fadeIn 0.2s ease\" }}>\n              <div style={{ display: \"flex\", gap: 0, padding: \"8px 18px 6px 52px\", borderBottom: \"1px solid #1a1d24\" }}>\n                <span style={{ width: 28, fontSize: 10, color: \"#555960\" }}>#</span>\n                <span style={{ flex: 2, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\" }}>Category Name</span>\n                <span style={{ width: 90, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\" }}>Type</span>\n                <span style={{ width: 120, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\" }}>Module</span>\n              </div>\n              {config.costCategories.map((cc, idx) => (\n                <div key={cc.id} style={{ display: \"flex\", gap: 0, padding: \"5px 18px 5px 52px\", borderBottom: \"1px solid #1a1c20\", alignItems: \"center\" }}>\n                  <span style={{ width: 28, fontSize: 11, color: \"#555960\", fontFamily: \"'JetBrains Mono', monospace\" }}>{idx + 1}</span>\n                  <span style={{ flex: 2, fontSize: 12, color: \"#a09c94\" }}>{cc.name}</span>\n                  <span style={{ width: 90 }}><Badge text={cc.type} color={TYPE_COLORS[cc.type]} /></span>\n                  <span style={{ width: 120, fontSize: 11, color: \"#6b6e76\" }}>{cc.module}</span>\n                </div>\n              ))}\n            </div>\n          )}\n        </div>\n\n        {/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 F. FY PERIODS \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */}\n        <div style={{ ...cardStyle, marginBottom: 10 }}>\n          <SectionHeader sectionKey=\"fyPeriods\" letter=\"F\" title=\"Financial Year Periods\" subtitle=\"Apr-Mar FY logic: Month >= April = current year\" count={config.fyPeriods.length} color=\"#5b9bd5\" />\n          {expandedSections.fyPeriods && (\n            <div style={{ borderTop: \"1px solid #1e2128\", animation: \"fadeIn 0.2s ease\" }}>\n              <div style={{ display: \"flex\", gap: 0, padding: \"8px 18px 6px 52px\", borderBottom: \"1px solid #1a1d24\" }}>\n                <span style={{ flex: 1, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\" }}>FY Label</span>\n                <span style={{ width: 120, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\" }}>Start</span>\n                <span style={{ width: 120, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\" }}>End</span>\n                <span style={{ flex: 1, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\" }}>Notes</span>\n              </div>\n              {config.fyPeriods.map(fy => (\n                <div key={fy.id} style={{ display: \"flex\", gap: 0, padding: \"7px 18px 7px 52px\", borderBottom: \"1px solid #1a1c20\", alignItems: \"center\" }}>\n                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: \"#5b9bd5\" }}>{fy.label}</span>\n                  <span style={{ width: 120, fontSize: 12, color: \"#a09c94\", fontFamily: \"'JetBrains Mono', monospace\" }}>{fy.start}</span>\n                  <span style={{ width: 120, fontSize: 12, color: \"#a09c94\", fontFamily: \"'JetBrains Mono', monospace\" }}>{fy.end}</span>\n                  <span style={{ flex: 1, fontSize: 11, color: \"#6b6e76\", fontStyle: \"italic\" }}>{fy.note}</span>\n                </div>\n              ))}\n            </div>\n          )}\n        </div>\n\n        {/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 G. ALERT THRESHOLDS \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */}\n        <div style={{ ...cardStyle, marginBottom: 10 }}>\n          <SectionHeader sectionKey=\"alerts\" letter=\"G\" title=\"Alert Thresholds & Variance Limits\" subtitle=\"Configurable rules for AppSheet automation bots\" count={config.alerts.length} color=\"#e06c60\" />\n          {expandedSections.alerts && (\n            <div style={{ borderTop: \"1px solid #1e2128\", animation: \"fadeIn 0.2s ease\" }}>\n              <div style={{ display: \"flex\", gap: 0, padding: \"8px 18px 6px 52px\", borderBottom: \"1px solid #1a1d24\" }}>\n                <span style={{ flex: 1.5, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\" }}>Alert Rule</span>\n                <span style={{ width: 100, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\", textAlign: \"right\" }}>Threshold</span>\n                <span style={{ width: 100, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\", paddingLeft: 12 }}>Unit</span>\n                <span style={{ flex: 2, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\" }}>Action</span>\n              </div>\n              {config.alerts.map(alert => (\n                <div key={alert.id} style={{ display: \"flex\", gap: 0, padding: \"6px 18px 6px 52px\", borderBottom: \"1px solid #1a1c20\", alignItems: \"center\" }}>\n                  <span style={{ flex: 1.5, fontSize: 12, color: \"#a09c94\" }}>{alert.rule}</span>\n                  <div style={{ width: 100 }}>\n                    <input\n                      type=\"number\"\n                      value={alert.threshold}\n                      onChange={e => updateAlert(alert.id, parseFloat(e.target.value) || 0)}\n                      style={{ ...inputStyle, textAlign: \"right\", padding: \"4px 8px\", fontSize: 12 }}\n                    />\n                  </div>\n                  <span style={{ width: 100, fontSize: 10, color: \"#555960\", paddingLeft: 12 }}>{alert.unit}</span>\n                  <span style={{ flex: 2, fontSize: 11, color: \"#7a6b3a\", fontStyle: \"italic\" }}>{alert.action}</span>\n                </div>\n              ))}\n            </div>\n          )}\n        </div>\n\n        {/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 H. KEY PERSONNEL \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */}\n        <div style={{ ...cardStyle, marginBottom: 10 }}>\n          <SectionHeader sectionKey=\"personnel\" letter=\"H\" title=\"Key Personnel & Access Roles\" subtitle=\"Portal role mapping for cost control access\" count={config.personnel.length} color=\"#c084fc\" />\n          {expandedSections.personnel && (\n            <div style={{ borderTop: \"1px solid #1e2128\", animation: \"fadeIn 0.2s ease\" }}>\n              <div style={{ display: \"flex\", gap: 0, padding: \"8px 18px 6px 52px\", borderBottom: \"1px solid #1a1d24\" }}>\n                <span style={{ width: 180, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\" }}>Designation</span>\n                <span style={{ flex: 1, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\" }}>Name</span>\n                <span style={{ width: 90, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\" }}>Portal Role</span>\n                <span style={{ width: 140, fontSize: 10, color: \"#555960\", textTransform: \"uppercase\" }}>Access Level</span>\n              </div>\n              {config.personnel.map(person => (\n                <div key={person.id} style={{ display: \"flex\", gap: 0, padding: \"7px 18px 7px 52px\", borderBottom: \"1px solid #1a1c20\", alignItems: \"center\" }}>\n                  <span style={{ width: 180, fontSize: 12, color: \"#a09c94\" }}>{person.role}</span>\n                  <div style={{ flex: 1 }}>\n                    <input\n                      type=\"text\"\n                      value={person.name}\n                      onChange={e => updatePersonnel(person.id, \"name\", e.target.value)}\n                      style={{ ...inputStyle, padding: \"4px 8px\", fontSize: 12, background: \"transparent\", border: \"1px solid transparent\" }}\n                      onFocus={e => e.target.style.border = \"1px solid #252830\"}\n                      onBlur={e => e.target.style.border = \"1px solid transparent\"}\n                    />\n                  </div>\n                  <span style={{ width: 90 }}><Badge text={person.portalRole} color={ROLE_COLORS[person.portalRole] || \"#6b6e76\"} /></span>\n                  <span style={{ width: 140, fontSize: 11, color: \"#6b6e76\" }}>{person.access}</span>\n                </div>\n              ))}\n            </div>\n          )}\n        </div>\n\n        {/* \u2500\u2500 Footer \u2500\u2500 */}\n        <div style={{ textAlign: \"center\", padding: \"20px 0 40px\", fontSize: 11, color: \"#3a3d44\" }}>\n          Project Setup \\u00B7 Evergreen Enterprises (EVGCPL) \\u00B7 IC Budget & Cost Control System\n        </div>\n      </div>\n\n      {/* \u2500\u2500 Toast \u2500\u2500 */}\n      {toast && (\n        <div style={{ position: \"fixed\", bottom: 24, left: \"50%\", transform: \"translateX(-50%)\", background: \"#1e2a1e\", border: \"1px solid #2d4a2d\", color: \"#6ec87a\", padding: \"10px 20px\", borderRadius: 8, fontSize: 13, fontWeight: 500, animation: \"toastIn 0.25s ease\", zIndex: 999, boxShadow: \"0 8px 24px rgba(0,0,0,0.4)\" }}>\n          {Icons.check} <span style={{ marginLeft: 6 }}>{toast}</span>\n        </div>\n      )}\n    </div>\n  );\n}\n";

// ══════════════════════════════════════════════════════════════
//  BUDGET & PLANNING MODULE
//  Loads React + Babel on demand, renders measurement-book and
//  project-setup components inside the portal mainContent div.
//  Dark/gold theme preserved exactly as designed.
// ══════════════════════════════════════════════════════════════

let _planningReactLoaded = false;
let _planningTab = 'overview'; // 'overview' | 'setup' | 'measurement'

function renderPlanningModule() {
  const el = document.getElementById('mainContent');

  // ── Overview tab HTML ────────────────────────────────────────
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1>&#128200; Budget &amp; Planning</h1>
          <p>IC Budget &middot; BOQ Management &middot; Measurement Book &middot; Cost Control</p>
        </div>
        <div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:center">
          <button class="btn btn-secondary btn-sm" onclick="renderPlanningModule()">&#8635; Refresh</button>
          ${!BUDGET_SHEET_ID ? '<span class="tag" style="background:#fff8e1;color:#92400e;font-size:.72rem">&#9888; Upload template to Drive to activate live data</span>' : ''}
        </div>
      </div>
    </div>

    <!-- Tab bar -->
    <div style="display:flex;gap:4px;border-bottom:2px solid var(--border);margin-bottom:1.4rem;padding-bottom:0">
      <button onclick="planningSetTab('overview')" id="ptab-overview"
        style="padding:9px 18px;border:none;border-bottom:3px solid transparent;background:none;font-family:inherit;font-size:.85rem;font-weight:600;cursor:pointer;color:var(--txt3);transition:all .15s;margin-bottom:-2px">
        &#128200; Overview
      </button>
      <button onclick="planningSetTab('setup')" id="ptab-setup"
        style="padding:9px 18px;border:none;border-bottom:3px solid transparent;background:none;font-family:inherit;font-size:.85rem;font-weight:600;cursor:pointer;color:var(--txt3);transition:all .15s;margin-bottom:-2px">
        &#9881; Project Setup
      </button>

    </div>

    <!-- Tab content -->
    <div id="planning-tab-content"></div>
  `;

  // Activate the current tab
  window.planningSetTab = function(tab) {
    _planningTab = tab;
    // Update tab styles
    ['overview','setup','measurement'].forEach(t => {
      const btn = document.getElementById('ptab-' + t);
      if (!btn) return;
      if (t === tab) {
        btn.style.color = '#f0a500';
        btn.style.borderBottomColor = '#f0a500';
      } else {
        btn.style.color = 'var(--txt3)';
        btn.style.borderBottomColor = 'transparent';
      }
    });
    const content = document.getElementById('planning-tab-content');
    if (!content) return;

    if (tab === 'overview') {
      planningRenderOverview(content);
    } else {
      planningRenderReact(content, tab);
    }
  };

  planningSetTab(_planningTab);
}

// ── Overview tab ────────────────────────────────────────────────
function planningRenderOverview(container) {
  const modules = [
    { num:1,  name:'BOQ Master + Rate Analysis',    approach:'AppSheet', phase:1, status:'live',    icon:'&#128203;', desc:'Billable items, agreed quantities, BOQ rates' },
    { num:2,  name:'Construction Schedule',          approach:'AppSheet', phase:1, status:'live',    icon:'&#128197;', desc:'S-35 Bar Chart — project timeline' },
    { num:3,  name:'Manpower Planning',              approach:'Hybrid',   phase:2, status:'pending', icon:'&#128101;', desc:'S-29 + S-30 — staff & worker deployment' },
    { num:4,  name:'Running / Finance Costs',        approach:'Hybrid',   phase:2, status:'pending', icon:'&#128184;', desc:'S-31 + Backup — monthly cost tracking' },
    { num:5,  name:'Capital / Allocable Costs',      approach:'AppSheet', phase:2, status:'pending', icon:'&#127970;', desc:'S-28 — fixed + allocable cost breakdown' },
    { num:6,  name:'Equipment CAPEX',                approach:'AppSheet', phase:3, status:'pending', icon:'&#128668;', desc:'S-33 — machinery purchase & depreciation' },
    { num:7,  name:'Site Installation & WO',         approach:'AppSheet', phase:3, status:'pending', icon:'&#128295;', desc:'Site setup + work orders' },
    { num:8,  name:'Taxation Working',               approach:'AppSheet', phase:3, status:'pending', icon:'&#128196;', desc:'S-34 — tax computation' },
    { num:9,  name:'WTP E&M BOQ (619 items)',        approach:'React',    phase:4, status:'pending', icon:'&#9889;',   desc:'Water Treatment Plant E&M — complex BOQ' },
    { num:10, name:'Measurement Book (eMB)',         approach:'React',    phase:4, status:'live',    icon:'&#128218;', desc:'Digital MB — formula-based measurements' },
  ];

  const apColor = a => ({ AppSheet:'#2563eb', Hybrid:'#7c3aed', React:'#d97706' }[a] || '#6b7280');
  const sheetRows = [
    ['Project_Master','Setup & configuration hub — all rates, thresholds, personnel'],
    ['BOQ_Items','BOQ Master — each row = one billable item'],
    ['Resources','Material / Man / Machine breakdown per BOQ item'],
    ['Measurement_Entries','eMB header — one row per measurement session'],
    ['Measurement_Rows','eMB detail — L×B×H rows for each entry'],
    ['Manpower_Master','Staff & worker roster'],
    ['Manpower_Monthly','Month-wise headcount deployment'],
    ['Running_Costs','29 cost categories — running expenses'],
    ['Running_Cost_Monthly','Monthly distribution of running costs'],
    ['Capital_Costs','Capital + allocable cost items'],
    ['Equipment_CAPEX','Plant & machinery schedule'],
    ['Schedule','Construction programme (bar chart data)'],
    ['Insurance_Policies','6 insurance lines + premium computation'],
    ['Taxation','Tax working — S-34'],
    ['WTP_BOQ','619-item E&M BOQ for Water Treatment Plant'],
    ['Electrical_33kV','33kV electrical BOQ'],
  ];

  container.innerHTML = `
    <!-- Setup status banner -->
    <div class="alert-strip ${BUDGET_SHEET_ID ? '' : 'warn'}" style="margin-bottom:1.4rem">
      <span class="alert-icon">${BUDGET_SHEET_ID ? '&#9989;' : '&#9888;&#65039;'}</span>
      <span class="alert-text">
        ${BUDGET_SHEET_ID
          ? '<strong>Budget sheet connected.</strong> Live data available across all modules.'
          : '<strong>Setup required:</strong> Upload <code>5453_Project_Cost_Control_Template.xlsx</code> to Google Drive, share as Anyone &rarr; Viewer, then paste the Sheet ID into <code>BUDGET_SHEET_ID</code> in index.html.'}
      </span>
    </div>

    <!-- KPI row -->
    <div class="kpi-grid" style="margin-bottom:1.4rem">
      <div class="kpi-card">
        <div class="kpi-top"><div class="kpi-icon green">&#128203;</div><div class="kpi-trend flat">Template</div></div>
        <div class="kpi-value">18</div><div class="kpi-label">Sheets</div>
        <div class="kpi-sub">182 formulas, zero errors</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><div class="kpi-icon blue">&#128101;</div><div class="kpi-trend flat">Modules</div></div>
        <div class="kpi-value">10</div><div class="kpi-label">Cost Modules</div>
        <div class="kpi-sub">7 AppSheet · 2 React · 1 Hybrid</div>
      </div>
      <div class="kpi-card gold">
        <div class="kpi-top"><div class="kpi-icon gold">&#9989;</div><div class="kpi-trend up">Live</div></div>
        <div class="kpi-value">2</div><div class="kpi-label">Components Ready</div>
        <div class="kpi-sub">Project Setup + Measurement Book</div>
      </div>
      <div class="kpi-card info">
        <div class="kpi-top"><div class="kpi-icon blue">&#127959;</div><div class="kpi-trend flat">Sites</div></div>
        <div class="kpi-value" id="planActiveSites">—</div><div class="kpi-label">Active Sites</div>
        <div class="kpi-sub">From Site Master</div>
      </div>
    </div>

    <div class="dash-grid">
      <!-- Module table -->
      <div class="card">
        <div class="card-head"><h3>&#128200; 10 Cost Modules</h3></div>
        <div class="card-body" style="padding:0">
          <table class="data-table">
            <thead><tr><th>#</th><th>Module</th><th>Approach</th><th>Phase</th><th>Status</th></tr></thead>
            <tbody>
              ${modules.map(m => `<tr>
                <td style="font-weight:700;color:var(--g8)">${m.num}</td>
                <td>
                  <div style="font-size:.82rem;font-weight:600">${m.icon} ${m.name}</div>
                  <div style="font-size:.72rem;color:var(--txt3)">${m.desc}</div>
                </td>
                <td><span style="font-size:.68rem;padding:2px 8px;border-radius:10px;background:${apColor(m.approach)}18;color:${apColor(m.approach)};font-weight:700">${m.approach}</span></td>
                <td style="text-align:center;font-size:.78rem;color:var(--txt2)">${m.phase}</td>
                <td>${m.status==='live'
                  ? '<span class="ni-live">Live</span>'
                  : '<span style="font-size:.68rem;color:var(--txt3)">Phase '+m.phase+'</span>'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Sheet schema -->
      <div class="card">
        <div class="card-head"><h3>&#128196; Template Sheets</h3>
          <span class="tag" style="font-size:.7rem">${BUDGET_SHEET_ID ? '&#9989; Connected' : '&#9888; Not connected'}</span>
        </div>
        <div class="card-body" style="padding:0;max-height:500px;overflow-y:auto">
          ${sheetRows.map(([name, desc], i) => `
            <div style="display:flex;align-items:flex-start;gap:.8rem;padding:.6rem 1rem;border-bottom:1px solid var(--border);background:${i%2?'var(--surface2)':''}">
              <code style="font-size:.7rem;color:var(--g7);min-width:180px;font-family:monospace">${name}</code>
              <span style="font-size:.75rem;color:var(--txt3)">${desc}</span>
            </div>`).join('')}
        </div>
        <div class="card-pad" style="padding:.8rem 1rem;border-top:1px solid var(--border)">
          <div style="font-size:.75rem;color:var(--txt3)">
            <strong>How to activate:</strong><br>
            1. Open <code>5453_Project_Cost_Control_Template.xlsx</code> → Save a copy to Google Drive<br>
            2. File &rarr; Share &rarr; <em>Anyone with link &rarr; Viewer</em><br>
            3. Copy the Sheet ID from the URL<br>
            4. Paste into <code>BUDGET_SHEET_ID</code> in index.html (line ~8773)
          </div>
        </div>
      </div>
    </div>

    <!-- Architecture diagram -->
    <div class="card card-pad" style="margin-top:1.2rem">
      <h3 style="font-size:.9rem;font-weight:700;margin-bottom:1rem;color:var(--g9)">&#128279; Portal Integration Map</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.8rem">
        ${[
          ['Employee Register','333 employees &rarr; Manpower module','var(--g7)'],
          ['VendorMaster','319 vendors &rarr; Site Installation','var(--g7)'],
          ['AssetMaster','288 assets &rarr; Equipment CAPEX','var(--g7)'],
          ['v2_Purchase','POs + MRS &rarr; Running Costs','var(--g7)'],
          ['Budget Template','18 sheets &rarr; all 10 modules','#f0a500'],
          ['AppSheet SCM','BOQ approvals &rarr; portal alerts','#2563eb'],
        ].map(([src, desc, col]) => `
          <div style="background:var(--surface2);border:1px solid var(--border);border-left:3px solid ${col};border-radius:8px;padding:.7rem .9rem">
            <div style="font-size:.78rem;font-weight:700;color:var(--g9);margin-bottom:.2rem">${src}</div>
            <div style="font-size:.72rem;color:var(--txt3)">${desc}</div>
          </div>`).join('')}
      </div>
    </div>
  `;

  // Populate active sites from masters
  if (STATE.mastersLoaded) {
    const el = document.getElementById('planActiveSites');
    if (el) el.textContent = getActiveSites().length;
  } else {
    loadAllMasters().then(() => {
      const el = document.getElementById('planActiveSites');
      if (el) el.textContent = getActiveSites().length;
    });
  }
}

// ── React component tabs ─────────────────────────────────────────
function planningRenderReact(container, tab) {
  container.innerHTML = `
    <div id="planning-react-mount" style="min-height:600px;border-radius:10px;overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:center;height:200px;color:var(--txt3)">
        <div style="text-align:center">
          <div style="font-size:2rem;margin-bottom:.5rem">&#9881;</div>
          <div style="font-size:.9rem">Loading ${tab === 'setup' ? 'Project Setup' : 'Measurement Book'}...</div>
        </div>
      </div>
    </div>
  `;

  if (_planningReactLoaded) {
    planningMountComponent(tab);
    return;
  }

  // Dynamically load React + ReactDOM + Babel in order
  const loadScript = (src) => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });

  Promise.all([
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js'),
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js'),
  ]).then(() => loadScript('https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.5/babel.min.js'))
    .then(() => {
      _planningReactLoaded = true;
      planningMountComponent(tab);
    })
    .catch(err => {
      const mount = document.getElementById('planning-react-mount');
      if (mount) mount.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--danger)">&#9888; Could not load React: ${err.message}<br><small>Check your internet connection.</small></div>`;
    });
}

function planningMountComponent(tab) {
  const mount = document.getElementById('planning-react-mount');
  if (!mount) return;
  mount.innerHTML = '';

  // Both 'setup' and 'measurement' now render inline via Babel/React.
  // (Previously 'setup' loaded an iframe pointing at /Planning which 404'd
  //  because that path doesn't exist on GitHub Pages.)
  const src = (tab === 'setup') ? PLANNING_SETUP_JSX : PLANNING_MB_JSX;
  const expectedComponent = (tab === 'setup') ? 'ProjectSetup' : 'MeasurementBook';

  try {
    const reactPreamble = 'const { useState, useCallback, useMemo, useEffect, useRef, useContext } = React;\n';
    const cleanSrc = reactPreamble + src
      .replace(/^import\s[\s\S]*?;\s*\n/gm, '')
      .replace(/^export\s+default\s+function\s+/gm, 'function ')
      .replace(/^export\s+default\s+class\s+/gm, 'class ')
      .replace(/^export\s+default\s+/gm, 'const __defaultExport__ = ')
      + `\nwindow.__PlanningComponent__ = typeof ${expectedComponent} !== "undefined" ? ${expectedComponent} : (typeof __defaultExport__ !== "undefined" ? __defaultExport__ : null);`;
    const compiled = Babel.transform(cleanSrc, { presets: ['react'], sourceType: 'script', plugins: [] }).code;
    eval(compiled); // eslint-disable-line no-eval
    const Component = window.__PlanningComponent__;
    if (Component && window.ReactDOM) {
      const root = ReactDOM.createRoot ? ReactDOM.createRoot(mount) : null;
      if (root) root.render(React.createElement(Component));
      else ReactDOM.render(React.createElement(Component), mount);
    } else {
      mount.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--danger)">&#9888; Component not found in source.</div>';
    }
  } catch(err) {
    console.error('Planning component error:', err);
    mount.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--danger)">&#9888; Component error: ${err.message}</div>`;
  }
}


function renderPurchaseDashboard() {
  const el = document.getElementById('mainContent');
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-row">
        <div><h1>&#128722; Purchase Dashboard</h1><p>PO tracker &middot; MRS &middot; Stores &middot; Vendor summary</p></div>
        <button class="btn btn-secondary btn-sm" onclick="renderPurchaseDashboard()">&#8635; Refresh</button>
      </div>
    </div>
    <div class="kpi-grid" style="margin-bottom:1.4rem">
      <div class="kpi-card gold"><div class="kpi-top"><div class="kpi-icon gold">&#9203;</div><div class="kpi-trend flat">Action needed</div></div><div class="kpi-value" id="pdKpiPending">&#8212;</div><div class="kpi-label">POs Pending Approval</div></div>
      <div class="kpi-card"><div class="kpi-top"><div class="kpi-icon green">&#10003;</div><div class="kpi-trend up">Approved</div></div><div class="kpi-value" id="pdKpiApproved">&#8212;</div><div class="kpi-label">POs Approved</div></div>
      <div class="kpi-card danger"><div class="kpi-top"><div class="kpi-icon red">&#10007;</div></div><div class="kpi-value" id="pdKpiRejected">&#8212;</div><div class="kpi-label">POs Rejected</div></div>
      <div class="kpi-card info"><div class="kpi-top"><div class="kpi-icon blue">&#8377;</div><div class="kpi-trend flat">Total</div></div><div class="kpi-value" id="pdKpiValue">&#8212;</div><div class="kpi-label">Total PO Value</div></div>
    </div>
    <div class="card">
      <div class="card-head">
        <h3>&#128203; Purchase Orders</h3>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <select id="pdFilter" onchange="pdApplyFilter()" style="font-size:.75rem;border:1px solid var(--border);border-radius:6px;padding:4px 8px;background:var(--surface2)">
            <option value="all">All POs</option>
            <option value="pending">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <select id="pdSiteFilter" onchange="pdApplyFilter()" style="font-size:.75rem;border:1px solid var(--border);border-radius:6px;padding:4px 8px;background:var(--surface2)">
            <option value="">All Sites</option>
          </select>
          <input id="pdSearch" oninput="pdApplyFilter()" placeholder="Search vendor / PO no..." style="font-size:.75rem;border:1px solid var(--border);border-radius:6px;padding:4px 10px;background:var(--surface2);width:160px">
        </div>
      </div>
      <div class="card-body table-wrap">
        <table class="data-table" id="pdTable">
          <thead><tr><th>PO No</th><th>Date</th><th>Vendor</th><th>Site</th><th style="text-align:right">Amount</th><th>Status</th></tr></thead>
          <tbody id="pdTbody"><tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--txt3)">&#8987; Loading POs...</td></tr></tbody>
        </table>
      </div>
    </div>`;

  fetchSheet(PO_TAB, 'SELECT A,E,F,G,R,S,AF,AG,AP,AQ', PO_SHEET_ID).then(rawRows => {
    window._pdRows = rawRows
      .filter(r => r['PO No'] && r['PO No'] !== 'Dummy')
      .map(r => ({
        poNo:   r['PO No']   || '',
        date:   r['PO Date'] || '',
        vendor: r['Vendor Name'] || r['R'] || '',
        site:   r['Site Name']   || r['S'] || '',
        amount: parseFloat(String(r['Net Amount'] || r['AP'] || '0').replace(/[^0-9.]/g,'')) || 0,
        status: r['PO Approval Status'] || r['AG'] || '',
        lock:   r['Lock'] || r['AQ'] || '',
      }));

    const pending  = window._pdRows.filter(r => r.status.toUpperCase() !== 'REJECTED' && r.lock === 'Released for Approval').length;
    const approved = window._pdRows.filter(r => r.status.toUpperCase().includes('APPROVED')).length;
    const rejected = window._pdRows.filter(r => r.status.toUpperCase().includes('REJECTED')).length;
    const totalVal = window._pdRows.reduce((s, r) => s + r.amount, 0);

    document.getElementById('pdKpiPending').textContent  = pending;
    document.getElementById('pdKpiApproved').textContent = approved;
    document.getElementById('pdKpiRejected').textContent = rejected;
    document.getElementById('pdKpiValue').textContent    = '\u20b9' + Math.round(totalVal).toLocaleString('en-IN');

    const sites = [...new Set(window._pdRows.map(r => r.site).filter(Boolean))].sort();
    const sf = document.getElementById('pdSiteFilter');
    if (sf) sites.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; sf.appendChild(o); });

    pdApplyFilter();
  }).catch(() => {
    const tb = document.getElementById('pdTbody');
    if (tb) tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--danger)">Could not load PO data. Check sheet sharing.</td></tr>';
  });

  window.pdApplyFilter = function() {
    const f   = document.getElementById('pdFilter')?.value || 'all';
    const sf  = document.getElementById('pdSiteFilter')?.value || '';
    const srch = (document.getElementById('pdSearch')?.value || '').toLowerCase();
    let rows = window._pdRows || [];
    if (sf)   rows = rows.filter(r => r.site === sf);
    if (srch) rows = rows.filter(r => r.poNo.toLowerCase().includes(srch) || r.vendor.toLowerCase().includes(srch));
    if (f === 'pending')  rows = rows.filter(r => r.status.toUpperCase() !== 'REJECTED' && r.lock === 'Released for Approval');
    if (f === 'approved') rows = rows.filter(r => r.status.toUpperCase().includes('APPROVED'));
    if (f === 'rejected') rows = rows.filter(r => r.status.toUpperCase().includes('REJECTED'));
    const tbody = document.getElementById('pdTbody');
    if (!tbody) return;
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--txt3)">No POs found.</td></tr>'; return; }
    const bgColor = r => {
      if (r.lock === 'Released for Approval') return '#fff8e1';
      if (r.status.toUpperCase().includes('APPROVED')) return '#e8f5e9';
      if (r.status.toUpperCase().includes('REJECT'))   return '#ffebee';
      return '';
    };
    tbody.innerHTML = rows.map(r => `<tr style="background:${bgColor(r)}">
      <td style="font-weight:600;color:var(--g9)">${r.poNo}</td>
      <td style="color:var(--txt2)">${r.date}</td>
      <td>${r.vendor}</td>
      <td style="color:var(--txt2)">${r.site}</td>
      <td style="text-align:right;font-weight:600">\u20b9${r.amount.toLocaleString('en-IN')}</td>
      <td><span class="tag" style="font-size:.68rem">${r.lock === 'Released for Approval' ? 'Pending Approval' : (r.status || '&#8212;')}</span></td>
    </tr>`).join('');
  };
}


// ── ACCOUNTS STATUS MASTER ──────────────────────────────
// STATUS MAP: keys = exact AG column values (Col D of Status Master), labels = Col G display values
// Colors: yellow=pending, red=rejected, green=completed, blue=progress
// ══════════════════════════════════════════════════
//  REWARDS & RECOGNITION MODULE
// ══════════════════════════════════════════════════
// Sheet ID: set when sheet is shared. Falls back to employee master data.
const REWARDS_SHEET_ID = '1vz8HLopjlSF8TF7rzYuVu5JjqukT929I7aSx7kdehlI'; // Rewards & Recognition + Blog Posts sheet

function renderRewardsModule() {
  const el = document.getElementById('mainContent');
  const myEmail = STATE.user?.email || '';
  const myName  = STATE.user?.name  || 'Me';

  el.innerHTML = `
    <div class="page-header" style="margin-bottom:1rem">
      <div class="page-header-row">
        <div>
          <h1>&#127942; Rewards &amp; Wall</h1>
          <p>Recognise your team &middot; Share updates &middot; React &middot; Comment</p>
        </div>
        <div style="display:flex;gap:.6rem;align-items:center">
          <button class="btn btn-secondary btn-sm" onclick="renderRewardsModule()">&#8635; Refresh</button>
          <button class="btn btn-gold btn-sm" onclick="rnrShowNominateModal()">&#127942; Nominate</button>
        </div>
      </div>

      <!-- Tabs -->
      <div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-top:.6rem">
        ${['feed','awards','milestones'].map((t,i) => {
          const labels = ['&#128227; Feed &amp; Shoutouts','&#127942; Awards Wall','&#127881; Milestones'];
          return `<button onclick="rnrSwitchTab('${t}')" id="rnrTab-${t}"
            style="padding:.55rem 1.1rem;border:none;background:none;font-family:inherit;font-size:.82rem;font-weight:600;cursor:pointer;
            border-bottom:2px solid ${i===0?'var(--g7)':'transparent'};margin-bottom:-2px;
            color:${i===0?'var(--g7)':'var(--txt3)'}">
            ${labels[i]}</button>`;
        }).join('')}
      </div>
    </div>

    <!-- FEED TAB -->
    <div id="rnrTabContent-feed">
      <!-- Compose -->
      <div class="blog-compose-card" id="wallCompose">
        <div style="display:flex;gap:.75rem;align-items:flex-start;margin-bottom:.7rem">
          <div class="blog-avatar">${myName.charAt(0)}</div>
          <div style="flex:1">
            <textarea class="blog-compose-area" id="wallPostBody"
              placeholder="Share an update, give a shoutout, celebrate a win…"></textarea>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
          <button class="blog-reaction-btn" onclick="wallInsertShoutout()" title="Shoutout template" style="flex-shrink:0">
            &#127775; Shoutout
          </button>
          <button class="blog-reaction-btn" onclick="wallInsertAnnouncement()" style="flex-shrink:0">
            &#128227; Announcement
          </button>
          <input id="wallPostImage" type="url" placeholder="Image URL (optional)"
            style="flex:1;min-width:160px;border:1px solid var(--border);border-radius:8px;padding:.4rem .7rem;font-size:.8rem;background:var(--surface2);outline:none">
          <input id="wallPostTags" type="text" placeholder="#tags"
            style="width:120px;border:1px solid var(--border);border-radius:8px;padding:.4rem .7rem;font-size:.8rem;background:var(--surface2);outline:none">
          <button class="btn btn-gold btn-sm" onclick="wallSubmitPost()" id="wallPostBtn">Post</button>
        </div>
        <div id="wallPostMsg" style="display:none;margin-top:.5rem;font-size:.8rem;padding:.4rem .8rem;border-radius:6px"></div>
      </div>
      <div id="wallFeed">
        <div style="text-align:center;padding:3rem;color:var(--txt3)">&#9203; Loading feed…</div>
      </div>
    </div>

    <!-- AWARDS TAB -->
    <div id="rnrTabContent-awards" style="display:none">
      <div class="kpi-grid" style="margin-bottom:1.2rem">
        <div class="kpi-card gold">
          <div class="kpi-top"><div class="kpi-icon gold">&#127942;</div><div class="kpi-trend flat">This FY</div></div>
          <div class="kpi-value" id="rnrTotalAwards">&#8212;</div>
          <div class="kpi-label">Awards Given</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-top"><div class="kpi-icon green">&#128101;</div><div class="kpi-trend flat">Unique</div></div>
          <div class="kpi-value" id="rnrUniqueRecipients">&#8212;</div>
          <div class="kpi-label">Recognised</div>
        </div>
        <div class="kpi-card info">
          <div class="kpi-top"><div class="kpi-icon blue">&#127970;</div><div class="kpi-trend flat">Sites</div></div>
          <div class="kpi-value" id="rnrSitesCount">&#8212;</div>
          <div class="kpi-label">Sites</div>
        </div>
        <div class="kpi-card" style="border-left:4px solid var(--gold)">
          <div class="kpi-top"><div class="kpi-icon gold">&#128197;</div><div class="kpi-trend flat">Longest</div></div>
          <div class="kpi-value" id="rnrTopTenure">&#8212;</div>
          <div class="kpi-label">Top Tenure (yrs)</div>
        </div>
      </div>

      <!-- EotM Spotlight -->
      <div id="rnrSpotlight" style="background:linear-gradient(135deg,var(--g9) 0%,var(--g7) 100%);border-radius:12px;padding:1.2rem 1.6rem;margin-bottom:1.2rem;display:flex;align-items:center;gap:1.2rem;flex-wrap:wrap">
        <div style="font-size:2.5rem">&#127942;</div>
        <div>
          <div style="color:var(--gold);font-size:.68rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:.15rem">Employee of the Month</div>
          <div id="rnrEotmName" style="color:#fff;font-size:1.2rem;font-weight:700">Loading…</div>
          <div id="rnrEotmMeta" style="color:rgba(255,255,255,.6);font-size:.8rem;margin-top:.1rem"></div>
        </div>
        <div style="margin-left:auto;text-align:right">
          <div style="color:rgba(255,255,255,.5);font-size:.68rem;margin-bottom:.25rem" id="rnrEotmMonth"></div>
          <span style="background:var(--gold);color:var(--g9);padding:3px 12px;border-radius:20px;font-size:.76rem;font-weight:700">&#11088; Star Performer</span>
        </div>
      </div>

      <!-- Awards wall + filter -->
      <div class="card">
        <div class="card-head">
          <h3>&#127942; Awards Wall</h3>
          <div style="display:flex;gap:.5rem">
            <select id="rnrFilterCat" onchange="rnrRender()" style="font-size:.75rem;border:1px solid var(--border);border-radius:6px;padding:4px 8px;background:var(--surface2)">
              <option value="">All Categories</option>
              <option>Employee of the Month</option>
              <option>Best Site Performance</option>
              <option>Safety Champion</option>
              <option>Long Service</option>
              <option>Special Recognition</option>
              <option>Shoutout</option>
            </select>
            <input id="rnrSearch" oninput="rnrRender()" placeholder="Search name / site…"
              style="font-size:.75rem;border:1px solid var(--border);border-radius:6px;padding:4px 10px;background:var(--surface2);width:140px">
          </div>
        </div>
        <div class="card-body" id="rnrWall"
          style="padding:1rem;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.8rem;max-height:520px;overflow-y:auto">
          <div style="text-align:center;color:var(--txt3);padding:2rem;grid-column:1/-1">&#9203; Loading awards…</div>
        </div>
      </div>
    </div>

    <!-- MILESTONES TAB -->
    <div id="rnrTabContent-milestones" style="display:none">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.2rem">
        <div class="card card-pad">
          <h3 style="font-size:.9rem;font-weight:700;margin-bottom:.8rem;color:var(--g9)">&#127881; Work Anniversaries This Month</h3>
          <div id="rnrAnniversaries" style="font-size:.8rem;color:var(--txt3)">&#9203; Loading…</div>
        </div>
        <div class="card card-pad">
          <h3 style="font-size:.9rem;font-weight:700;margin-bottom:.8rem;color:var(--g9)">&#128200; Long Service Recognitions</h3>
          <div id="rnrLongService" style="font-size:.8rem;color:var(--txt3)">&#9203; Loading…</div>
        </div>
      </div>
    </div>

    <!-- Nominate modal -->
    <div id="rnrNominateModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;align-items:center;justify-content:center">
      <div style="background:#fff;border-radius:16px;padding:2rem;width:min(480px,92vw);box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.1rem">
          <h2 style="font-size:1rem;color:var(--g9)">&#127942; Nominate an Employee</h2>
          <button onclick="document.getElementById('rnrNominateModal').style.display='none'"
            style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:#666">&#10005;</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:.8rem">
          <div>
            <label style="font-size:.78rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Employee Name *</label>
            <input id="rnrNomName" placeholder="Start typing name…" list="rnrEmpList"
              style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit">
            <datalist id="rnrEmpList"></datalist>
          </div>
          <div>
            <label style="font-size:.78rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Award Category *</label>
            <select id="rnrNomCat"
              style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit;background:#fff">
              <option value="">Select category…</option>
              <option>Employee of the Month</option>
              <option>Best Site Performance</option>
              <option>Safety Champion</option>
              <option>Long Service</option>
              <option>Shoutout</option>
              <option>Special Recognition</option>
            </select>
          </div>
          <div>
            <label style="font-size:.78rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Reason *</label>
            <textarea id="rnrNomReason" rows="3"
              placeholder="Why does this person deserve recognition?"
              style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit;resize:vertical"></textarea>
          </div>
          <div id="rnrNomMsg" style="display:none;font-size:.82rem;padding:.45rem .8rem;border-radius:8px"></div>
          <div style="display:flex;gap:.6rem;margin-top:.2rem">
            <button onclick="document.getElementById('rnrNominateModal').style.display='none'"
              class="btn btn-secondary" style="flex:1">Cancel</button>
            <button onclick="rnrSubmitNomination()" class="btn btn-gold" style="flex:2">&#10003; Submit Nomination</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // ── Tab switcher ─────────────────────────────────────────────────
  window.rnrSwitchTab = function(tab) {
    ['feed','awards','milestones'].forEach(t => {
      const content = document.getElementById(`rnrTabContent-${t}`);
      const btn     = document.getElementById(`rnrTab-${t}`);
      if (content) content.style.display = t === tab ? '' : 'none';
      if (btn) {
        btn.style.borderBottomColor = t === tab ? 'var(--g7)' : 'transparent';
        btn.style.color             = t === tab ? 'var(--g7)' : 'var(--txt3)';
      }
    });
  };

  // ── Template helpers ─────────────────────────────────────────────
  window.wallInsertShoutout = function() {
    const ta = document.getElementById('wallPostBody');
    if (ta) { ta.value = '🌟 Shoutout to [Name] for '; ta.focus(); }
    const tags = document.getElementById('wallPostTags');
    if (tags) tags.value = '#shoutout #recognition';
  };
  window.wallInsertAnnouncement = function() {
    const ta = document.getElementById('wallPostBody');
    if (ta) { ta.value = '📢 '; ta.focus(); }
    const tags = document.getElementById('wallPostTags');
    if (tags) tags.value = '#announcement';
  };

  // ── rnrRender (awards wall cards) ────────────────────────────────
  window.rnrRender = function() {
    const cat  = document.getElementById('rnrFilterCat')?.value || '';
    const srch = (document.getElementById('rnrSearch')?.value || '').toLowerCase();
    let rows = window._rnrAwards || [];
    if (cat)  rows = rows.filter(r => r.category === cat);
    if (srch) rows = rows.filter(r =>
      (r.name||'').toLowerCase().includes(srch) || (r.site||'').toLowerCase().includes(srch));
    const wall = document.getElementById('rnrWall');
    if (!wall) return;
    if (!rows.length) {
      wall.innerHTML = '<div style="text-align:center;color:var(--txt3);padding:2rem;grid-column:1/-1">No awards found.</div>';
      return;
    }
    const catIcon  = c => ({'Employee of the Month':'&#127942;','Best Site Performance':'&#127959;','Safety Champion':'&#129510;','Long Service':'&#127941;','Shoutout':'&#127775;','Special Recognition':'&#11088;'}[c] || '&#127942;');
    const catColor = c => ({'Employee of the Month':'#f59e0b','Best Site Performance':'#2563eb','Safety Champion':'#dc2626','Long Service':'#16a34a','Shoutout':'#7c3aed','Special Recognition':'#7c3aed'}[c] || '#f59e0b');
    wall.innerHTML = rows.map(r => {
      const cc = catColor(r.category);
      const initials = (r.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
      return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:1rem;
        display:flex;flex-direction:column;gap:.5rem;border-top:3px solid ${cc};
        transition:box-shadow .15s" onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,.08)'" onmouseout="this.style.boxShadow='none'">
        <div style="display:flex;align-items:center;gap:.7rem">
          <div style="width:38px;height:38px;border-radius:50%;background:${cc}20;color:${cc};
            display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.85rem;flex-shrink:0">${initials}</div>
          <div style="min-width:0">
            <div style="font-weight:700;color:var(--g9);font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name}</div>
            <div style="font-size:.7rem;color:var(--txt3)">${r.dept||r.site||''}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:.4rem">
          <span style="font-size:.9rem">${catIcon(r.category)}</span>
          <span style="background:${cc}20;color:${cc};padding:2px 8px;border-radius:10px;font-size:.68rem;font-weight:700">${r.category}</span>
        </div>
        <div style="font-size:.75rem;color:var(--txt2);line-height:1.4">${r.reason||''}</div>
        <div style="font-size:.7rem;color:var(--txt3);margin-top:auto">${r.month||''} ${r.nomBy ? '· By ' + r.nomBy : ''}</div>
      </div>`;
    }).join('');
  };

  // ── rnrShowNominateModal ──────────────────────────────────────────
  window.rnrShowNominateModal = function() {
    document.getElementById('rnrNominateModal').style.display = 'flex';
    document.getElementById('rnrNomMsg').style.display = 'none';
    ['rnrNomName','rnrNomReason'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
    const cs = document.getElementById('rnrNomCat'); if (cs) cs.value = '';
  };

  // ── rnrSubmitNomination ───────────────────────────────────────────
  window.rnrSubmitNomination = function() {
    const name   = (document.getElementById('rnrNomName')?.value   || '').trim();
    const cat    = (document.getElementById('rnrNomCat')?.value    || '').trim();
    const reason = (document.getElementById('rnrNomReason')?.value || '').trim();
    const msgEl  = document.getElementById('rnrNomMsg');
    const showMsg = (txt, ok) => {
      if (!msgEl) return;
      msgEl.style.display = 'block';
      msgEl.style.background = ok ? '#f0fdf4' : '#fef2f2';
      msgEl.style.color      = ok ? '#16a34a' : '#dc2626';
      msgEl.textContent = txt;
    };
    if (!name)   return showMsg('Please enter employee name.', false);
    if (!cat)    return showMsg('Please select a category.', false);
    if (!reason) return showMsg('Please add a reason.', false);

    const btn = document.querySelector('#rnrNominateModal .btn-gold');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

    const userEmp = (STATE.masters.users||[]).find(u =>
      (u.email||'').toLowerCase() === (STATE.user?.email||'').toLowerCase()
    );
    // Sheet cols: A=Timestamp B=EmployeeName C=AwardCategory D=Reason E=NominatedBy F=Email G=Dept H=Status
    const row = [
      new Date().toLocaleString('en-IN', {timeZone:'Asia/Kolkata'}), // A Timestamp
      name,                                                            // B Employee Name
      cat,                                                             // C Award Category
      reason,                                                          // D Reason
      STATE.user?.name  || 'Anonymous',                               // E Nominated By
      STATE.user?.email || '',                                         // F Email
      userEmp?.dept || userEmp?.site || '',                           // G Dept
      'Pending',                                                       // H Status
    ];

    fetch(APPS_SCRIPT_URL, {
      method:'POST', headers:{'Content-Type':'text/plain'},
      body: JSON.stringify({ action:'appendRow', sheetId:REWARDS_SHEET_ID, tab:'Nomination', row }),
    })
    .then(r => r.json())
    .then(res => {
      if (!res.success) throw new Error(res.message || 'Failed');
      showMsg('✓ Nomination submitted! HR will review shortly.', true);
      // Also post to Wall feed as a shoutout
      const wallBody = `🌟 Shoutout to ${name} — nominated for ${cat}! "${reason}"`;
      wallSubmitPostSilent(wallBody, '', '#recognition #shoutout');
      setTimeout(() => {
        document.getElementById('rnrNominateModal').style.display = 'none';
        if (btn) { btn.disabled = false; btn.textContent = '✓ Submit Nomination'; }
      }, 2000);
    })
    .catch(err => {
      showMsg('Error: ' + err.message, false);
      if (btn) { btn.disabled = false; btn.textContent = '✓ Submit Nomination'; }
    });
  };

  // ── Build from masters ────────────────────────────────────────────
  function buildFromMasters() {
    const users  = STATE.masters.users || [];
    const active = users.filter(u => u.status === 'ACTIVE');

    document.getElementById('rnrUniqueRecipients')?.setAttribute('_val', active.length);

    // EotM: use most recent nomination if sheet loaded, else top by tenure
    function updateSpotlight(nom) {
      const nameEl  = document.getElementById('rnrEotmName');
      const metaEl  = document.getElementById('rnrEotmMeta');
      const monEl   = document.getElementById('rnrEotmMonth');
      if (nom) {
        if (nameEl)  nameEl.textContent  = nom.name || '—';
        if (metaEl)  metaEl.textContent  = (nom.category||'') + (nom.dept ? ' · ' + nom.dept : '');
        if (monEl)   monEl.textContent   = nom.month || '';
      } else {
        const topEmp = [...active].sort((a,b) => (parseFloat(b.expEG)||0) - (parseFloat(a.expEG)||0))[0];
        if (!topEmp) return;
        if (nameEl)  nameEl.textContent  = topEmp.name || '—';
        if (metaEl)  metaEl.textContent  = (topEmp.desig||'') + (topEmp.site ? ' · ' + topEmp.site : '');
        if (monEl)   monEl.textContent   = new Date().toLocaleDateString('en-IN',{month:'long',year:'numeric'});
      }
    }
    updateSpotlight(null); // initial — updated after nominations load
    let maxTenure = 0;
    active.forEach(u => { const y = parseFloat(u.expEG)||0; if (y > maxTenure) maxTenure = y; });
    const topTen = document.getElementById('rnrTopTenure');
    if (topTen) topTen.textContent = maxTenure ? maxTenure.toFixed(1) : '—';

    const sites = [...new Set(active.map(u=>u.site).filter(Boolean))].length;
    const sitesEl = document.getElementById('rnrSitesCount');
    if (sitesEl) sitesEl.textContent = sites;

    // Anniversaries
    const now = new Date();
    const annivs = active.filter(u => {
      if (!u.doj) return false;
      const d = parseGvizDate(u.doj);
      return d && d.getTime() > 0 && d.getMonth() === now.getMonth() && d.getFullYear() < now.getFullYear();
    }).map(u => {
      const doj = parseGvizDate(u.doj);
      return { name: u.name, yrs: now.getFullYear() - doj.getFullYear(), desig: u.desig||'', site: u.site||'' };
    }).sort((a,b) => b.yrs - a.yrs).slice(0,12);
    const annivEl = document.getElementById('rnrAnniversaries');
    if (annivEl) annivEl.innerHTML = annivs.length ? annivs.map(a => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-weight:600;color:var(--g9)">${a.name}</div>
          <div style="color:var(--txt3);font-size:.72rem">${a.desig} · ${a.site}</div>
        </div>
        <span style="background:#fff3e0;color:#e65100;padding:2px 8px;border-radius:10px;font-size:.72rem;font-weight:700">${a.yrs} yr${a.yrs!==1?'s':''}</span>
      </div>`).join('') : '<div style="color:var(--txt3)">No anniversaries this month.</div>';

    // Long service
    const longSvc = active.filter(u => (parseFloat(u.expEG)||0) >= 5)
      .sort((a,b) => (parseFloat(b.expEG)||0) - (parseFloat(a.expEG)||0)).slice(0,10);
    const lsEl = document.getElementById('rnrLongService');
    if (lsEl) lsEl.innerHTML = longSvc.length ? longSvc.map(u => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-weight:600;color:var(--g9)">${u.name}</div>
          <div style="color:var(--txt3);font-size:.72rem">${u.dept||''} · ${u.site||''}</div>
        </div>
        <span style="background:#f0fdf4;color:#16a34a;padding:2px 8px;border-radius:10px;font-size:.72rem;font-weight:700">${parseFloat(u.expEG).toFixed(1)} yrs</span>
      </div>`).join('') : '<div style="color:var(--txt3)">No long service data.</div>';

    // Datalist
    const dl = document.getElementById('rnrEmpList');
    if (dl) active.forEach(u => { const o = document.createElement('option'); o.value = u.name; dl.appendChild(o); });

    // Awards
    if (REWARDS_SHEET_ID) {
      // Nomination tab: A=Timestamp B=Employee Name C=Award Category D=Reason E=Nominated By F=Email G=Dept H=Status
      fetchSheet('Nomination', 'SELECT A,B,C,D,E,F,G,H', REWARDS_SHEET_ID).then(rows => {
        window._rnrAwards = rows
          .filter(r => (r['Employee Name']||r['B']||'').trim())  // skip empty rows
          .map(r => ({
            name:     r['Employee Name']  || r['B'] || '',
            category: r['Award Category'] || r['C'] || 'Special Recognition',
            month:    wallFmtMonth(r['Timestamp'] || r['A']),
            reason:   r['Reason']         || r['D'] || '',
            site:     r['Dept']           || r['G'] || '',
            dept:     r['Dept']           || r['G'] || '',
            nomBy:    r['Nominated By']   || r['E'] || '',
            status:   r['Status']         || r['H'] || 'Pending',
          }));
        const totEl = document.getElementById('rnrTotalAwards');
        if (totEl) totEl.textContent = window._rnrAwards.length;
        const uniqEl = document.getElementById('rnrUniqueRecipients');
        if (uniqEl) uniqEl.textContent = [...new Set(window._rnrAwards.map(r=>r.name).filter(Boolean))].length;
        // Update spotlight with most recent EotM nomination
        const eotm = window._rnrAwards.find(r => /employee of the month/i.test(r.category));
        if (eotm) updateSpotlight(eotm);
        rnrRender();
      }).catch(() => rnrRenderFromMasters(active));
    } else {
      rnrRenderFromMasters(active);
    }
  }

  function rnrRenderFromMasters(active) {
    const top = [...active].sort((a,b) => (parseFloat(b.expEG)||0) - (parseFloat(a.expEG)||0)).slice(0,12);
    window._rnrAwards = top.map((u,i) => ({
      name: u.name, category: i===0?'Employee of the Month':i<3?'Long Service':'Shoutout',
      month: new Date().toLocaleDateString('en-IN',{month:'long',year:'numeric'}),
      reason: `${parseFloat(u.expEG||0).toFixed(1)} years of dedicated service`,
      site: u.site||'', dept: u.dept||'', nomBy: 'HR',
    }));
    const totEl = document.getElementById('rnrTotalAwards');
    if (totEl) totEl.textContent = window._rnrAwards.length;
    rnrRender();
  }

  if (STATE.mastersLoaded && STATE.masters.users.length) {
    buildFromMasters();
  } else {
    loadAllMasters().then(() => buildFromMasters());
  }

  // Load wall feed
  wallLoadPosts();
}

// ── Silent post (used by nomination shoutout) ─────────────────────
function wallSubmitPostSilent(body, imageUrl, tags) {
  const myName  = STATE.user?.name  || 'Anonymous';
  const myEmail = STATE.user?.email || '';
  const emp     = (STATE.masters.users||[]).find(u => (u.email||'').toLowerCase() === myEmail.toLowerCase());
  const ts      = new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'});
  const postId  = 'post-' + Date.now();
  const row     = [postId, ts, myName, myEmail, emp?.dept||'', body, imageUrl||'', tags||''];
  _wallPosts.unshift({ id:postId, ts, author:myName, email:myEmail, dept:emp?.dept||'', body, image:imageUrl||'', tags:tags||'' });
  wallRenderFeed();
  fetch(APPS_SCRIPT_URL, {
    method:'POST', headers:{'Content-Type':'text/plain'},
    body: JSON.stringify({ action:'appendRow', sheetId:REWARDS_SHEET_ID, tab:'Posts', row }),
  }).catch(()=>{});
}




// STATUS MAP — keys must exactly match AG column values (case-insensitive trim)
const ACCOUNTS_STATUS = {
  // Keys = exact AG column values (Col G of Status Master) + AC column (Col D) fallbacks
  // ── Progress (blue) ──
  'verified , move to md queue':                 { cat:'progress',  icon:'&#128260;', label:'Verified, Move to MD Queue',    color:'#2563eb', bg:'#eff6ff' },
  'verified, move to md queue':                  { cat:'progress',  icon:'&#128260;', label:'Verified, Move to MD Queue',    color:'#2563eb', bg:'#eff6ff' },
  'process payment , move to accounts':          { cat:'progress',  icon:'&#128260;', label:'Payment Approved by MD',        color:'#2563eb', bg:'#eff6ff' },
  'process payment, move to accounts':           { cat:'progress',  icon:'&#128260;', label:'Payment Approved by MD',        color:'#2563eb', bg:'#eff6ff' },
  'payment approved by md':                      { cat:'progress',  icon:'&#128260;', label:'Payment Approved by MD',        color:'#2563eb', bg:'#eff6ff' },
  'payment initiated':                           { cat:'progress',  icon:'&#9654;',   label:'Payment Initiated',             color:'#2563eb', bg:'#eff6ff' },
  'payment re-initiated':                        { cat:'progress',  icon:'&#9654;',   label:'Payment Re-Initiated',          color:'#2563eb', bg:'#eff6ff' },
  // ── Pending (yellow) ──
  'hold payment (md)':                           { cat:'pending',   icon:'&#9208;',   label:'On Hold by MD',                 color:'#d97706', bg:'#fffbeb' },
  'payment on hold by md':                       { cat:'pending',   icon:'&#9208;',   label:'Payment On Hold by MD',         color:'#d97706', bg:'#fffbeb' },
  'send back to accounts (md)':                  { cat:'pending',   icon:'&#8592;',   label:'Sent Back to Accounts',         color:'#d97706', bg:'#fffbeb' },
  'send back to respective department (md)':     { cat:'pending',   icon:'&#8592;',   label:'Sent Back to Dept (MD)',        color:'#d97706', bg:'#fffbeb' },
  'pending due to queries':                      { cat:'pending',   icon:'&#10067;',  label:'Pending Due to Queries',        color:'#d97706', bg:'#fffbeb' },
  'pending with accounts':                       { cat:'pending',   icon:'&#9203;',   label:'Pending With Accounts',         color:'#d97706', bg:'#fffbeb' },
  // ── Rejected (red) — Col D (AC) and Col G (AG) both ──
  'reject payment (md)':                         { cat:'rejected',  icon:'&#10060;',  label:'Rejected by MD',                color:'#dc2626', bg:'#fef2f2' },
  'reject payment (accounts)':                   { cat:'rejected',  icon:'&#10060;',  label:'Rejected by Accounts',          color:'#dc2626', bg:'#fef2f2' },
  'request rejected by md':                      { cat:'rejected',  icon:'&#10060;',  label:'Request Rejected by MD',        color:'#dc2626', bg:'#fef2f2' },
  'request rejected by accounts':                { cat:'rejected',  icon:'&#10060;',  label:'Request Rejected by Accounts',  color:'#dc2626', bg:'#fef2f2' },
  // ── Completed (green) — Col D (AC) and Col G (AG) both ──
  'paid (md_ed)':                                { cat:'completed', icon:'&#10003;',  label:'Paid (Initiated in Bank)',       color:'#16a34a', bg:'#f0fdf4' },
  'paid(md_ed)':                                 { cat:'completed', icon:'&#10003;',  label:'Paid (Initiated in Bank)',       color:'#16a34a', bg:'#f0fdf4' },
  'paid - md_ed':                                { cat:'completed', icon:'&#10003;',  label:'Paid (Initiated in Bank)',       color:'#16a34a', bg:'#f0fdf4' },
  'paid (initiated in bank)':                    { cat:'completed', icon:'&#10003;',  label:'Paid (Initiated in Bank)',       color:'#16a34a', bg:'#f0fdf4' },
  'paid':                                        { cat:'completed', icon:'&#10003;',  label:'Paid',                          color:'#16a34a', bg:'#f0fdf4' },
  'payment completed':                           { cat:'completed', icon:'&#9989;',   label:'Paid, UTR Available',           color:'#16a34a', bg:'#f0fdf4' },
  'payment complete':                            { cat:'completed', icon:'&#9989;',   label:'Paid, UTR Available',           color:'#16a34a', bg:'#f0fdf4' },
  'paid , utr details available':                { cat:'completed', icon:'&#9989;',   label:'Paid, UTR Available',           color:'#16a34a', bg:'#f0fdf4' },
  'paid, utr details available':                 { cat:'completed', icon:'&#9989;',   label:'Paid, UTR Available',           color:'#16a34a', bg:'#f0fdf4' },
  'completed':                                   { cat:'completed', icon:'&#9989;',   label:'Completed',                     color:'#16a34a', bg:'#f0fdf4' },
};


function getPayStatus(raw) {
  const key = (raw || '').toLowerCase().trim().replace(/\s+/g,' ');
  if (!key) return { cat:'other', icon:'', label:'—', color:'#9ca3af', bg:'transparent' };
  return ACCOUNTS_STATUS[key] || { cat:'other', icon:'&#9711;', label: raw, color:'#6b7280', bg:'#f9fafb' };
}

const APPSHEET_ACCOUNTS_URL = 'https://www.appsheet.com/start/fcdba849-9f9d-435f-8e8a-ea0c975dbd21';

function renderAccountsModule() {
  const el = document.getElementById('mainContent');
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1>&#128178; Accounts &amp; Payments</h1>
          <p>Payment requests &middot; status tracking &middot; UTR confirmation</p>
        </div>
        <div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:center">
          <button class="btn btn-secondary btn-sm" onclick="renderAccountsModule()">&#8635; Refresh</button>
          <a href="${APPSHEET_ACCOUNTS_URL}" target="_blank" class="btn btn-primary btn-sm" style="text-decoration:none">&#128241; Open in AppSheet</a>
        </div>
      </div>
    </div>

    <!-- Status KPIs -->
    <div class="kpi-grid" style="margin-bottom:1rem">
      <div class="kpi-card warn" onclick="accFilter('pending')" style="cursor:pointer">
        <div class="kpi-top"><div class="kpi-icon orange">&#9203;</div><div class="kpi-trend flat">Needs action</div></div>
        <div class="kpi-value" id="accPendingCt">&#8212;</div><div class="kpi-label">Pending</div><div class="kpi-sub" id="accPendingAmt">&#8212;</div>
      </div>
      <div class="kpi-card info" onclick="accFilter('progress')" style="cursor:pointer">
        <div class="kpi-top"><div class="kpi-icon blue">&#128260;</div><div class="kpi-trend flat">In pipeline</div></div>
        <div class="kpi-value" id="accProgressCt">&#8212;</div><div class="kpi-label">In Progress</div><div class="kpi-sub" id="accProgressAmt">&#8212;</div>
      </div>
      <div class="kpi-card danger" onclick="accFilter('rejected')" style="cursor:pointer">
        <div class="kpi-top"><div class="kpi-icon red">&#10060;</div><div class="kpi-trend flat">Rejected</div></div>
        <div class="kpi-value" id="accRejectedCt">&#8212;</div><div class="kpi-label">Rejected</div><div class="kpi-sub" id="accRejectedAmt">&#8212;</div>
      </div>
      <div class="kpi-card" style="border-left:4px solid #16a34a;cursor:pointer" onclick="accFilter('completed')">
        <div class="kpi-top"><div class="kpi-icon green">&#9989;</div><div class="kpi-trend up">Done</div></div>
        <div class="kpi-value" id="accCompletedCt">&#8212;</div><div class="kpi-label">Completed</div><div class="kpi-sub" id="accCompletedAmt">&#8212;</div>
      </div>
    </div>

    <!-- Currency KPI cards -->
    <div id="accCurrencyCards" style="display:none;margin-bottom:1.2rem"></div>

    <!-- Filters bar -->
    <div class="card" style="margin-bottom:.8rem">
      <div class="card-body" style="padding:.75rem 1rem">
        <div style="display:flex;gap:.7rem;flex-wrap:wrap;align-items:flex-end">

          <div style="display:flex;flex-direction:column;gap:3px">
            <label style="font-size:.67rem;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.05em">Status</label>
            <div style="display:flex;gap:4px;flex-wrap:wrap">
              <button onclick="accFilter('all')"       id="accBtn-all"       class="acc-cat-btn btn btn-secondary btn-sm active-cat">All</button>
              <button onclick="accFilter('pending')"   id="accBtn-pending"   class="acc-cat-btn btn btn-sm" style="background:#fffbeb;color:#92400e;border:1px solid #f59e0b">&#9203; Pending</button>
              <button onclick="accFilter('progress')"  id="accBtn-progress"  class="acc-cat-btn btn btn-sm" style="background:#eff6ff;color:#1e40af;border:1px solid #2563eb">&#128260; In Progress</button>
              <button onclick="accFilter('rejected')"  id="accBtn-rejected"  class="acc-cat-btn btn btn-sm" style="background:#fef2f2;color:#991b1b;border:1px solid #ef4444">&#10060; Rejected</button>
              <button onclick="accFilter('completed')" id="accBtn-completed" class="acc-cat-btn btn btn-sm" style="background:#f0fdf4;color:#14532d;border:1px solid #16a34a">&#9989; Completed</button>
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:3px">
            <label style="font-size:.67rem;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.05em">Site</label>
            <select id="accSiteFilter" onchange="accRender()" style="font-size:.78rem;border:1px solid var(--border);border-radius:6px;padding:5px 8px;background:var(--surface2);min-width:130px">
              <option value="">All Sites</option>
            </select>
          </div>

          <div style="display:flex;flex-direction:column;gap:3px">
            <label style="font-size:.67rem;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.05em">For</label>
            <select id="accEntityFilter" onchange="accRender()" style="font-size:.78rem;border:1px solid var(--border);border-radius:6px;padding:5px 8px;background:var(--surface2);min-width:120px">
              <option value="">All</option>
            </select>
          </div>

          <div style="display:flex;flex-direction:column;gap:3px">
            <label style="font-size:.67rem;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.05em">Process</label>
            <select id="accProcessFilter" onchange="accRender()" style="font-size:.78rem;border:1px solid var(--border);border-radius:6px;padding:5px 8px;background:var(--surface2);min-width:130px">
              <option value="">All Processes</option>
            </select>
          </div>

          <div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:200px">
            <label style="font-size:.67rem;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.05em">Search all fields</label>
            <div style="position:relative">
              <span style="position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--txt3);font-size:.85rem">&#128269;</span>
              <input id="accSearch" oninput="accRender()" placeholder="Request ID, name, site, Order No, Bill No, UTR, remarks..." style="font-size:.78rem;border:1px solid var(--border);border-radius:6px;padding:5px 10px 5px 28px;background:var(--surface2);width:100%;box-sizing:border-box">
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:3px">
            <label style="font-size:.67rem;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.05em">Sort by</label>
            <div style="display:flex;gap:4px">
              <select id="accSortCol" onchange="accRender()" style="font-size:.78rem;border:1px solid var(--border);border-radius:6px;padding:5px 8px;background:var(--surface2)">
                <option value="date">Date</option>
                <option value="requestId">Request ID</option>
                <option value="initiator">Initiator</option>
                <option value="nature">Nature of Expenses</option>
            <option value="payTo">Payment To</option>
            <option value="costCode">Cost Code</option>
                <option value="site">Site</option>
                <option value="amount">Amount</option>
                <option value="status">Status</option>
                <option value="accDate">Accounts Date</option>
              </select>
              <button id="accSortDirBtn" onclick="accToggleSortDir()" class="btn btn-secondary btn-sm" title="Toggle direction" style="white-space:nowrap;min-width:60px">&#8595; Desc</button>
            </div>
          </div>

          <button onclick="accResetFilters()" class="btn btn-secondary btn-sm" style="align-self:flex-end;white-space:nowrap">&#10006; Reset</button>
          <button onclick="accExportCSV()" class="btn btn-secondary btn-sm" style="align-self:flex-end;white-space:nowrap;background:var(--g7);color:#fff;border-color:var(--g7)">&#11015; CSV</button>
        </div>
        <div style="margin-top:.5rem;font-size:.75rem;color:var(--txt3)" id="accRowCount"></div>
      </div>
    </div>

    <!-- Table card — scroll inside, sticky header -->
    <div class="card">
      <div style="overflow-x:auto;overflow-y:auto;max-height:72vh;border-radius:0 0 var(--rad) var(--rad)" id="accTableWrap">
        <table class="data-table" style="width:100%">
          <thead id="accThead">
            <tr style="background:var(--g9);color:#fff;position:sticky;top:0;z-index:2">
              <th onclick="accSetSort('manualAuto')" style="padding:9px 10px;text-align:center;white-space:nowrap;cursor:pointer;font-weight:600;min-width:70px;border-right:1px solid rgba(255,255,255,.15)">M/A &#8597;</th>
              <th onclick="accSetSort('installment')" style="padding:9px 10px;text-align:center;white-space:nowrap;cursor:pointer;font-weight:600;min-width:60px;border-right:1px solid rgba(255,255,255,.15)">Inst &#8597;</th>
              <th style="padding:9px 10px;white-space:nowrap;font-weight:600;min-width:130px;border-right:1px solid rgba(255,255,255,.15)">Request ID</th>
              <th onclick="accSetSort('date')" style="padding:9px 10px;white-space:nowrap;cursor:pointer;font-weight:600;min-width:110px;border-right:1px solid rgba(255,255,255,.15)">Date &#8597;</th>
              <th onclick="accSetSort('initiator')" style="padding:9px 10px;white-space:nowrap;cursor:pointer;font-weight:600;min-width:140px;border-right:1px solid rgba(255,255,255,.15)">Initiator &#8597;</th>
              <th onclick="accSetSort('nature')" style="padding:9px 10px;white-space:nowrap;cursor:pointer;font-weight:600;min-width:130px;border-right:1px solid rgba(255,255,255,.15)">Nature &#8597;</th>
              <th onclick="accSetSort('payTo')" style="padding:9px 10px;white-space:nowrap;cursor:pointer;font-weight:600;min-width:120px;border-right:1px solid rgba(255,255,255,.15)">Payment To &#8597;</th>
              <th onclick="accSetSort('dept')" style="padding:9px 10px;white-space:nowrap;cursor:pointer;font-weight:600;min-width:100px;border-right:1px solid rgba(255,255,255,.15)">Department &#8597;</th>
              <th onclick="accSetSort('process')" style="padding:9px 10px;white-space:nowrap;cursor:pointer;font-weight:600;min-width:120px;border-right:1px solid rgba(255,255,255,.15)">Process &#8597;</th>
              <th onclick="accSetSort('empCode')" style="padding:9px 10px;white-space:nowrap;cursor:pointer;font-weight:600;min-width:140px;border-right:1px solid rgba(255,255,255,.15)">Emp/Vendor Code &#8597;</th>
              <th onclick="accSetSort('site')" style="padding:9px 10px;white-space:nowrap;cursor:pointer;font-weight:600;min-width:140px;border-right:1px solid rgba(255,255,255,.15)">Site &#8597;</th>
              <th onclick="accSetSort('entity')" style="padding:9px 10px;white-space:nowrap;cursor:pointer;font-weight:600;min-width:110px;border-right:1px solid rgba(255,255,255,.15)">For &#8597;</th>
              <th onclick="accSetSort('orderNo')" style="padding:9px 10px;white-space:nowrap;cursor:pointer;font-weight:600;min-width:120px;border-right:1px solid rgba(255,255,255,.15)">Order No &#8597;</th>
              <th onclick="accSetSort('billNo')" style="padding:9px 10px;white-space:nowrap;cursor:pointer;font-weight:600;min-width:90px;border-right:1px solid rgba(255,255,255,.15)">Bill No &#8597;</th>
              <th onclick="accSetSort('currency')" style="padding:9px 10px;white-space:nowrap;cursor:pointer;font-weight:600;min-width:80px;border-right:1px solid rgba(255,255,255,.15)">Currency &#8597;</th>
              <th onclick="accSetSort('amount')" style="padding:9px 10px;white-space:nowrap;cursor:pointer;font-weight:600;min-width:100px;text-align:right;border-right:1px solid rgba(255,255,255,.15)">Amount &#8597;</th>
              <th style="padding:9px 10px;white-space:nowrap;font-weight:600;min-width:180px;border-right:1px solid rgba(255,255,255,.15)">Narrative</th>
              <th onclick="accSetSort('status')" style="padding:9px 10px;white-space:nowrap;cursor:pointer;font-weight:600;min-width:190px;border-right:1px solid rgba(255,255,255,.15)">Status &#8597;</th>
              <th onclick="accSetSort('accDate')" style="padding:9px 10px;white-space:nowrap;cursor:pointer;font-weight:600;min-width:110px;border-right:1px solid rgba(255,255,255,.15)">Acc. Date &#8597;</th>
              <th style="padding:9px 10px;white-space:nowrap;font-weight:600;min-width:160px;border-right:1px solid rgba(255,255,255,.15)">UTR Details</th>
              <th style="padding:9px 10px;white-space:nowrap;font-weight:600;min-width:140px">Remarks</th>
            </tr>
          </thead>
          <tbody id="accTbody">
            <tr><td colspan="20" style="text-align:center;padding:3rem;color:var(--txt3)">&#8987; Loading payment requests...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- AppSheet quick links -->
    <div class="card card-pad" style="margin-top:1.2rem">
      <h3 style="font-size:.88rem;font-weight:700;margin-bottom:.9rem;color:var(--g9)">&#128241; AppSheet Quick Actions</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:.6rem">
        ${accDeepLink('&#10133; New Request',       APPSHEET_ACCOUNTS_URL)}
        ${accDeepLink('&#9203; Pending Approvals',  APPSHEET_ACCOUNTS_URL)}
        ${accDeepLink('&#10004; Process Payment',   APPSHEET_ACCOUNTS_URL)}
        ${accDeepLink('&#128196; All Requests',     APPSHEET_ACCOUNTS_URL)}
        ${accDeepLink('&#128200; Ledger View',      APPSHEET_ACCOUNTS_URL)}
        ${accDeepLink('&#128279; Open Full App',    APPSHEET_ACCOUNTS_URL)}
      </div>
    </div>
  `;

  // ── State ─────────────────────────────────────────────
  window._accAllRows      = [];
  window._accActiveFilter = 'all';
  window._accSortCol      = 'date';
  window._accSortDir      = -1;

  // Helper: strip EGxxx| prefix from names like "EG1415|RABIN RAJESH" → "RABIN RAJESH"
  const stripCode = s => s ? String(s).replace(/^[A-Z]+\d+\|/i, '').trim() : '';
  // Helper: convert "Indian Rupee" → "INR", keep short codes as-is
  const normCurrency = s => {
    const m = { 'indian rupee':'INR','us dollar':'USD','usd':'USD','euro':'EUR','gbp':'GBP','aed':'AED','omr':'OMR','qar':'QAR' };
    return m[(s||'').toLowerCase().trim()] || (s||'INR').toUpperCase().trim().slice(0,5) || 'INR';
  };

  // ── Fetch: use explicit column letters — we know exact schema ─────
  // A=UUID B=Link C=Manual/Auto D=Installment E=Request ID F=Date Of Request
  // G=Initiator H=Payment To I=Department J=From Which Process K=Emp/Vendor Code
  // L=Site Name M=For EG/EVGCPL N=Order No O=Bill No P=Payment Terms
  // Q=PO Value R=Invoice Value S=Paid Value T=Pending Value U=Tax Amount
  // V=Currency W=Amount X=Narrative/Comments
  // AC=Accounts Status AD=Accounts Date AE=UTR Details AF=Remarks AG=Status
  fetchSheet('PaymentRequest',
    'SELECT A,C,D,E,F,G,H,J,K,L,M,N,O,P,Q,R,T,U,V,W,Z,AA,AB,AG,AH,AI,AJ,AK,AL,AM',
    PAYMENT_SHEET_ID
  ).then(rawRows => {
    window._accAllRows = rawRows
      .filter(r => (r['Payment To'] || r['J'] || '').trim())
      .map(r => {
        // New schema: A=UUID C=Manual/Auto D=Installment E=RequestID F=Date
        // G=Initiator H=NatureOfExpenses J=PaymentTo K=CostCode L=Department
        // M=FromWhichProcess N=PaidTo O=SiteName P=Company Q=OrderNo R=BillNo
        // T=POValue U=InvoiceValue V=PaidValue W=PendingValue Z=Currency AA=Amount
        // AB=Narrative AG=AccountsStatus AH=AccountsDate AI=UTR AJ=Remarks AK=Status
        const raw    = r['Status']          || r['AK'] || '';
        const acStat = r['Accounts Status'] || r['AG'] || '';
        const st     = getPayStatus(raw) || getPayStatus(acStat);
        const curr   = normCurrency(r['Currency'] || r['Z'] || '');
        const amt    = parseFloat(String(r['Amount'] || r['AA'] || '0').replace(/[^0-9.]/g,'')) || 0;
        const initiator = stripCode(r['Name of the Intiator'] || r['G'] || '');
        return {
          uuid:        r['UUID']                  || r['A']  || '',
          manualAuto:  r['Manual / Auto']         || r['C']  || '',
          installment: r['Installment']           || r['D']  || '',
          requestId:   r['Request ID']            || r['E']  || '',
          date:        r['Date Of Request']       || r['F']  || '',
          initiator,
          nature:      r['NATURE OF EXPENSES']    || r['H']  || '',
          accCode:     r['ACCOUNT CODE DESCRIPTIONS'] || r['I'] || '',
          payTo:       r['Payment To']            || r['J']  || '',
          costCode:    r['CostCode']              || r['K']  || '',
          dept:        r['Department']            || r['L']  || '',
          process:     r['From Which Process']    || r['M']  || '',
          paidTo:      r['Paid To']               || r['N']  || '',
          site:        r['Site Name']             || r['O']  || '',
          company:     r['Company']               || r['P']  || '',
          orderNo:     r['Order No']              || r['Q']  || '',
          billNo:      r['Bill No']               || r['R']  || '',
          poValue:     parseFloat(String(r['PO Value']      || r['T'] || '0').replace(/[^0-9.]/g,'')) || 0,
          invoiceVal:  parseFloat(String(r['Invoice Value'] || r['U'] || '0').replace(/[^0-9.]/g,'')) || 0,
          paidVal:     parseFloat(String(r['Paid Value']    || r['V'] || '0').replace(/[^0-9.]/g,'')) || 0,
          pendingVal:  parseFloat(String(r['Pending Value'] || r['W'] || '0').replace(/[^0-9.]/g,'')) || 0,
          currency:    curr,
          amount:      amt,
          narrative:   r['Narrative/Comments']    || r['AB'] || '',
          acHolder:    r['A/C HOLDER NAME']       || r['AC'] || '',
          acNumber:    r['A/C NUMBER']            || r['AD'] || '',
          ifsc:        r['IFSC CODE']             || r['AE'] || '',
          bank:        r['BANK NAME']             || r['AF'] || '',
          accStatus:   acStat,
          accDate:     r['Accounts Date']         || r['AH'] || '',
          utr:         r['UTR Details']           || r['AI'] || '',
          remarks:     r['Remarks']              || r['AJ'] || '',
          monthYear:   r['Month-Year']            || r['AN'] || '',
          rawStatus:   raw || acStat,
          status:      st,
          _s: [r['A'],r['E'],r['F'],initiator,r['J'],r['H'],r['L'],r['M'],
               r['O'],r['P'],r['Q'],r['R'],curr,String(amt),r['AB'],
               r['AH'],r['AI'],r['AJ'],raw,acStat
              ].join('|').toLowerCase(),
        };
      });

    // ── KPI cards ────────────────────────────────────────
    ['pending','progress','rejected','completed'].forEach(cat => {
      const rows = window._accAllRows.filter(r => r.status.cat === cat);
      const amt  = rows.reduce((s,r) => s + (cat==='completed' ? r.amount : r.amount), 0);
      const cap  = cat[0].toUpperCase() + cat.slice(1);
      const ctEl = document.getElementById('acc'+cap+'Ct');
      const aEl  = document.getElementById('acc'+cap+'Amt');
      if (ctEl) ctEl.textContent = rows.length;
      if (aEl)  aEl.textContent  = rows.length ? '\u20b9'+Math.round(amt).toLocaleString('en-IN') : '\u2014';
    });

    // ── Currency cards ───────────────────────────────────
    const cmap = {};
    window._accAllRows.filter(r=>r.status.cat!=='other').forEach(r=>{
      const c = r.currency||'INR';
      if (!cmap[c]) cmap[c]={count:0,total:0};
      cmap[c].count++; cmap[c].total+=r.amount;
    });
    const ckeys = Object.keys(cmap);
    if (ckeys.length>1 || (ckeys.length===1 && ckeys[0]!=='INR')) {
      const ccEl = document.getElementById('accCurrencyCards');
      if (ccEl) {
        ccEl.style.cssText='display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:.7rem;margin-bottom:1.2rem';
        ccEl.innerHTML = ckeys.map(c=>`
          <div class="kpi-card" style="border-left:3px solid var(--g5)">
            <div class="kpi-top"><div class="kpi-icon green">&#128178;</div><div class="kpi-trend flat">${c}</div></div>
            <div class="kpi-value" style="font-size:1.15rem">${cmap[c].count}</div>
            <div class="kpi-label">${c} Requests</div>
            <div class="kpi-sub">${c} ${Math.round(cmap[c].total).toLocaleString('en-IN')}</div>
          </div>`).join('');
      }
    }

    // ── Populate filter dropdowns ────────────────────────
    const populate = (id, values) => {
      const sel = document.getElementById(id);
      if (!sel) return;
      [...new Set(values.filter(Boolean))].sort().forEach(v=>{
        const o=document.createElement('option'); o.value=v; o.textContent=v; sel.appendChild(o);
      });
    };
    populate('accSiteFilter',    window._accAllRows.map(r=>r.site));
    populate('accEntityFilter',  window._accAllRows.map(r=>r.entity));
    populate('accProcessFilter', window._accAllRows.map(r=>r.process));

    const others = [...new Set(window._accAllRows.filter(r=>r.status.cat==='other'&&r.rawStatus).map(r=>r.rawStatus))];
    if (others.length) console.log('Accounts: unmapped status values:', others);

    accRender();
  }).catch(err => {
    const tb = document.getElementById('accTbody');
    if (tb) tb.innerHTML = '<tr><td colspan="20" style="text-align:center;padding:2.5rem;color:var(--danger)">&#9888; Could not load PaymentRequest sheet. Check it is shared as Anyone \u2192 Viewer.</td></tr>';
    console.error('Accounts fetch error:', err);
  });

  // ── Controls ──────────────────────────────────────────
  window.accFilter = function(cat) {
    window._accActiveFilter = cat;
    document.querySelectorAll('.acc-cat-btn').forEach(b=>b.classList.remove('active-cat'));
    const ab = document.getElementById('accBtn-'+cat);
    if (ab) ab.classList.add('active-cat');
    accRender();
  };

  window.accResetFilters = function() {
    window._accActiveFilter = 'all';
    document.querySelectorAll('.acc-cat-btn').forEach(b=>b.classList.remove('active-cat'));
    document.getElementById('accBtn-all')?.classList.add('active-cat');
    ['accSearch','accSiteFilter','accEntityFilter','accProcessFilter'].forEach(id=>{
      const e=document.getElementById(id); if(e) e.value='';
    });
    accRender();
  };

  window.accSetSort = function(col) {
    if (window._accSortCol===col) window._accSortDir=-window._accSortDir;
    else { window._accSortCol=col; window._accSortDir=-1; }
    const btn=document.getElementById('accSortDirBtn');
    if (btn) btn.textContent=window._accSortDir===-1?'\u2193 Desc':'\u2191 Asc';
    accRender();
  };

  window.accToggleSortDir = function() {
    window._accSortDir=-window._accSortDir;
    const btn=document.getElementById('accSortDirBtn');
    if (btn) btn.textContent=window._accSortDir===-1?'\u2193 Desc':'\u2191 Asc';
    accRender();
  };

  window.accExportCSV = function() {
    const rows = window._accAllRows || [];
    if (!rows.length) return;
    // Apply current filters same as accRender
    const cat  = window._accActiveFilter || 'all';
    const srch = (document.getElementById('accSearch')?.value||'').toLowerCase().trim();
    const sf   = document.getElementById('accSiteFilter')?.value||'';
    const ef   = document.getElementById('accEntityFilter')?.value||'';
    const pf   = document.getElementById('accProcessFilter')?.value||'';
    let filtered = rows.filter(r => cat==='all' ? r.status.cat!=='other' : r.status.cat===cat);
    if (sf)   filtered = filtered.filter(r => r.site===sf);
    if (ef)   filtered = filtered.filter(r => r.company===ef);
    if (pf)   filtered = filtered.filter(r => r.process===pf);
    if (srch) filtered = filtered.filter(r => r._s.includes(srch));

    const headers = ['Manual/Auto','Instalment','Request ID','Date','Initiator',
                     'Nature of Expenses','Acc Code','Payment To','Cost Code',
                     'Department','Process','Paid To','Site','Company',
                     'Order No','Bill No','PO Value','Invoice Value','Paid Value','Pending Value',
                     'Currency','Amount','Narrative','Acc Status','Accounts Date','UTR',
                     'Bank Name','Remarks','Status','Month-Year'];
    const esc = v => '"' + String(v||'').replace(/"/g,'""') + '"';
    const csvRows = [headers.map(esc).join(',')];
    filtered.forEach(r => {
      csvRows.push([
        r.manualAuto, r.installment, r.requestId, r.date, r.initiator,
        r.nature, r.accCode, r.payTo, r.costCode,
        r.dept, r.process, r.paidTo, r.site, r.company,
        r.orderNo, r.billNo, r.poValue, r.invoiceVal, r.paidVal, r.pendingVal,
        r.currency, r.amount, r.narrative, r.accStatus, r.accDate, r.utr,
        r.bank, r.remarks, r.status.label, r.monthYear
      ].map(esc).join(','));
    });
    const blob = new Blob([csvRows.join('\n')], {type:'text/csv;charset=utf-8;'});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = 'EVGCPL_Accounts_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

    window.accRender = function() {
    const cat   = window._accActiveFilter||'all';
    const srch  = (document.getElementById('accSearch')?.value||'').toLowerCase().trim();
    const sf    = document.getElementById('accSiteFilter')?.value||'';
    const ef    = document.getElementById('accEntityFilter')?.value||'';
    const pf    = document.getElementById('accProcessFilter')?.value||'';
    const scol  = window._accSortCol||'date';
    const sdir  = window._accSortDir||-1;

    let rows = (window._accAllRows||[]).filter(r=>cat==='all'?r.status.cat!=='other':r.status.cat===cat);
    if (sf)   rows=rows.filter(r=>r.site===sf);
    if (ef)   rows=rows.filter(r=>r.entity===ef);
    if (pf)   rows=rows.filter(r=>r.process===pf);
    if (srch) rows=rows.filter(r=>r._s.includes(srch));

    // Sort
    rows=[...rows].sort((a,b)=>{
      if (scol==='amount') return sdir*(a.amount-b.amount);
      if (scol==='date'||scol==='accDate') {
        const parse=d=>{ if(!d) return 0; const p=d.split(/[-\/]/); return p.length===3?new Date(p[2],p[1]-1,p[0]).getTime():new Date(d).getTime()||0; };
        return sdir*(parse(a[scol])-parse(b[scol]));
      }
      return sdir*String(a[scol]||'').localeCompare(String(b[scol]||''));
    });

    const cntEl=document.getElementById('accRowCount');
    if (cntEl) cntEl.textContent=rows.length+' records'+(cat!=='all'?' ('+cat+')':'')+(srch?' matching "'+srch+'"':'');

    const tbody=document.getElementById('accTbody');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML='<tr><td colspan="20" style="text-align:center;padding:3rem;color:var(--txt3)">No records match the selected filters.</td></tr>';
      return;
    }

    const fmtAmt=(v,c)=>{
      if (!v) return '\u2014';
      const num=Math.round(v).toLocaleString('en-IN');
      return c&&c!=='INR'?c+'\u00a0'+num:'\u20b9'+num;
    };
    const td=(text,style='',title='')=>
      `<td style="padding:7px 10px;border-bottom:1px solid var(--border);${style}" ${title?'title="'+String(title).replace(/"/g,'&quot;')+'"':''}>${text||'\u2014'}</td>`;
    const tdClip=(text,w)=>
      `<td style="padding:7px 10px;border-bottom:1px solid var(--border);max-width:${w}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${String(text||'').replace(/"/g,'&quot;')}">${text||'\u2014'}</td>`;

    // Alternating row background
    tbody.innerHTML=rows.map((r,i)=>{
      const s=r.status;
      const pill=s.label
        ?`<span style="display:inline-flex;align-items:center;gap:3px;background:${s.bg};color:${s.color};padding:3px 9px;border-radius:10px;font-size:.68rem;font-weight:600;white-space:nowrap;border:1px solid ${s.color}22">${s.icon?s.icon+'&thinsp;':''}${s.label}</span>`
        :'<span style="color:var(--txt3)">\u2014</span>';

      // AppSheet link per row using Request ID
      const recUrl=r.requestId
        ?`${APPSHEET_ACCOUNTS_URL}?view=PaymentRequest&row=${encodeURIComponent(r.requestId)}`
        :APPSHEET_ACCOUNTS_URL;
      const reqIdCell=`<td style="padding:7px 10px;border-bottom:1px solid var(--border);white-space:nowrap">
        <div style="display:flex;align-items:center;gap:5px">
          <span style="font-family:monospace;font-size:.72rem;color:var(--g8);font-weight:600">${r.requestId||'\u2014'}</span>
          <a href="${recUrl}" target="_blank" title="Open in AppSheet" style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;background:var(--g7);border-radius:4px;text-decoration:none;font-size:.65rem;flex-shrink:0;color:#fff">&#8599;</a>
        </div>
      </td>`;

      // Manual/Auto badge
      const ma=r.manualAuto.toLowerCase();
      const maBadge=r.manualAuto
        ?`<span style="font-size:.68rem;padding:2px 8px;border-radius:10px;background:${ma.includes('auto')?'#dbeafe':'#ede9fe'};color:${ma.includes('auto')?'#1d4ed8':'#6d28d9'};font-weight:700">${r.manualAuto}</span>`
        :'\u2014';

      const rowBg=i%2===0?'':'background:#fafbfa';
      const amtStyle=`padding:7px 10px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;color:${r.amount>0?'var(--g8)':'var(--txt3)'};white-space:nowrap`;

      return `<tr style="${rowBg}">
        <td style="padding:7px 10px;border-bottom:1px solid var(--border);text-align:center">${maBadge}</td>
        <td style="padding:7px 10px;border-bottom:1px solid var(--border);text-align:center;color:var(--txt2)">${r.installment||'\u2014'}</td>
        ${reqIdCell}
        ${td(r.date,'white-space:nowrap;color:var(--txt2)')}
        ${tdClip(r.initiator,140)}
        <td style="padding:7px 10px;border-bottom:1px solid var(--border);font-weight:600;max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${(r.payTo||'').replace(/"/g,'&quot;')}">${r.payTo||'\u2014'}</td>
        ${tdClip(r.dept,110)}
        ${tdClip(r.process,130)}
        ${tdClip(r.empCode,150)}
        ${tdClip(r.site,140)}
        ${td(r.entity,'white-space:nowrap')}
        ${td(r.orderNo,'white-space:nowrap;color:var(--txt2);font-family:monospace;font-size:.72rem')}
        ${td(r.billNo,'white-space:nowrap;color:var(--txt2)')}
        ${td(r.currency,'text-align:center;font-size:.72rem;font-weight:700;color:var(--g7)')}
        <td style="${amtStyle}">${fmtAmt(r.amount,r.currency)}</td>
        ${tdClip(r.narrative,200)}
        <td style="padding:7px 10px;border-bottom:1px solid var(--border);white-space:nowrap">${pill}</td>
        ${td(r.accDate,'white-space:nowrap;color:var(--txt2)')}
        ${tdClip(r.utr,170)}
        ${tdClip(r.remarks,150)}
      </tr>`;
    }).join('');
  };
}

function accDeepLink(label, url) {
  return `<a href="${url}" target="_blank" style="display:flex;align-items:center;gap:.5rem;padding:.55rem .8rem;background:var(--surface2);border:1px solid var(--border);border-radius:8px;text-decoration:none;color:var(--g8);font-size:.78rem;font-weight:500;transition:background .15s,border-color .15s" onmouseover="this.style.borderColor='var(--g5)';this.style.background='#e8f5ee'" onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--surface2)'">${label}</a>`;
}



// ══════════════════════════════════════════════════
//  DEV MODE PAGE
// ══════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
//  PORTAL CONFIGURATION — replaces Dev Mode page
//  All settings stored in localStorage → survive refresh
//  ROLE_ROUTES are rebuilt from config on every load
// ══════════════════════════════════════════════════════════════

// v2 → bumped May 2026 when Planning section restructured to Budgeting + Execution.
// Old config keys with 'planning' / 'project-setup' / 'md-command' entries are obsolete.
const CONFIG_KEY = 'evgcpl_portal_config_v2';
const LEGACY_CONFIG_KEYS = ['evgcpl_portal_config']; // cleared on first load

// ── Master module registry ─────────────────────────────────────
const MODULE_REGISTRY = [
  // ── Main ──────────────────────────────────────────────────────
  { route:'dashboard',         label:'Dashboard',              section:'Main',             defStatus:'live', defRoles:['md','hr','site','purchase','accounts','employee','dept_head'] },
  // Note: md-command merged into Dashboard for MD; not exposed in Config.

  // ── HR & People ───────────────────────────────────────────────
  { route:'hr-dashboard',      label:'HR Dashboard',           section:'HR & People',      defStatus:'live', defRoles:['md','hr','dept_head'] },
  { route:'personal',          label:'Personal Dashboard',     section:'HR & People',      defStatus:'live', defRoles:['md','hr','dept_head'] },
  { route:'my-profile',        label:'My Profile',             section:'HR & People',      defStatus:'live', defRoles:['md','hr','site','purchase','accounts','employee','dept_head'] },
  { route:'onboarding',        label:'Onboarding',             section:'HR & People',      defStatus:'live', defRoles:['md','hr'] },
  { route:'recruitment',       label:'Recruitment',            section:'HR & People',      defStatus:'live', defRoles:['md','hr','dept_head','site'] },
  { route:'policies',          label:'Policies Hub',           section:'HR & People',      defStatus:'live', defRoles:['md','hr','site','employee','dept_head'] },

  // ── Site Ops ──────────────────────────────────────────────────
  { route:'site-manager',      label:'Site Manager',           section:'Site Ops',         defStatus:'live', defRoles:['md','site','dept_head'] },
  { route:'safety',            label:'Safety Module',          section:'Site Ops',         defStatus:'live', defRoles:['md','site','hr','dept_head'] },
  { route:'equipment',         label:'Equipment & Machinery',  section:'Site Ops',         defStatus:'live', defRoles:['md','site','dept_head'] },
  { route:'store',             label:'Site Store',             section:'Site Ops',         defStatus:'live', defRoles:['md','site','purchase','dept_head'] },
  { route:'plant',             label:'Plant Overview',         section:'Site Ops',         defStatus:'live', defRoles:['md','site','dept_head'] },

  // ── Procurement ───────────────────────────────────────────────
  { route:'scm',               label:'Purchase Dashboard',      section:'Procurement',      defStatus:'live', defRoles:['md','purchase','site','dept_head'] },
  { route:'mrs',               label:'MRS',                    section:'Procurement',      defStatus:'live', defRoles:['md','purchase','site','dept_head'] },
  { route:'stores',            label:'Stores',                 section:'Procurement',      defStatus:'live', defRoles:['md','purchase','site','dept_head'] },
  { route:'vendor',            label:'Vendor Portal',          section:'Procurement',      defStatus:'live', defRoles:['md','purchase','accounts','dept_head'] },
  { route:'subcontractor',     label:'Subcontractor Portal',   section:'Procurement',      defStatus:'dev',  defRoles:['md','purchase'] },
  { route:'tendering',         label:'Tendering',              section:'Procurement',      defStatus:'dev',  defRoles:['md','purchase'] },

  // ── Finance ───────────────────────────────────────────────────
  { route:'accounts',          label:'Accounts & Payments',    section:'Finance',          defStatus:'live', defRoles:['md','accounts','dept_head'] },

  // ── Planning ──────────────────────────────────────────────────
  { route:'budgeting',         label:'Budgeting',              section:'Planning',         defStatus:'live', defRoles:['md','hr','site','accounts','purchase','employee','dept_head'] },
  { route:'execution',         label:'Execution (DPR)',        section:'Planning',         defStatus:'live', defRoles:['md','hr','site','accounts','purchase','dept_head'] },

  // ── Plant & Machinery ─────────────────────────────────────────
  { route:'plant-log',         label:'Log Entry',              section:'Plant & Machinery',defStatus:'live', defRoles:['md','site','dept_head'] },
  { route:'plant-verify',      label:'Asset Verification',     section:'Plant & Machinery',defStatus:'live', defRoles:['md','site','dept_head'] },
  { route:'plant-maintenance', label:'Maintenance',            section:'Plant & Machinery',defStatus:'live', defRoles:['md','site','dept_head'] },

  // ── Reports ───────────────────────────────────────────────────
  { route:'reports',           label:'Reports',                section:'Reports',          defStatus:'live', defRoles:['md','hr','purchase','accounts','dept_head'] },

  // ── Quick Access ──────────────────────────────────────────────
  { route:'rewards',           label:'Rewards & Wall',         section:'Quick Access',     defStatus:'live', defRoles:['md','hr','site','purchase','accounts','employee','dept_head'] },
  { route:'apps',              label:'Apps',                   section:'Quick Access',     defStatus:'live', defRoles:['md','hr','site','purchase','accounts','employee','dept_head'] },
  { route:'sheets',            label:'Sheets',                 section:'Quick Access',     defStatus:'live', defRoles:['md'] },

  // ── Personal ──────────────────────────────────────────────────
  { route:'my-documents',      label:'My Documents',           section:'Personal',         defStatus:'live', defRoles:['md','hr','site','purchase','accounts','employee','dept_head'] },

  // ── Admin ─────────────────────────────────────────────────────
  { route:'dev-mode',          label:'Configuration',          section:'Admin',            defStatus:'live', defRoles:['md'] },
];


const ALL_ROLES = [
  { key:'md',       label:'MD / Admin' },
  { key:'hr',       label:'HR Manager' },
  { key:'site',     label:'Site Manager' },
  { key:'purchase', label:'Purchase' },
  { key:'accounts', label:'Accounts' },
  { key:'employee', label:'Employee' },
  { key:'dept_head',label:'Dept Head' },
];

// ── Load config from localStorage (or build defaults) ───────────
function loadPortalConfig() {
  // Clean up legacy v1 keys (had old planning/project-setup/md-command entries)
  try {
    LEGACY_CONFIG_KEYS.forEach(k => localStorage.removeItem(k));
  } catch(e) {}
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    if (saved && saved.modules) {
      // Self-heal: ensure every registry route has a config entry.
      // Without this, a saved config from before a registry update would
      // permanently hide newly-added modules (e.g. Budgeting / Execution).
      let dirty = false;
      MODULE_REGISTRY.forEach(m => {
        if (!saved.modules[m.route]) {
          saved.modules[m.route] = { status: m.defStatus, roles: [...m.defRoles] };
          dirty = true;
        }
      });
      // One-time: Recruitment shipped hidden in some older saved configs — restore it
      // to its registry default (Live for MD / HR / Dept-Head / Site) once.
      if (!saved._recruitMigV1) {
        saved.modules['recruitment'] = { status: 'live', roles: ['md','hr','dept_head','site'] };
        saved._recruitMigV1 = true;
        dirty = true;
      }
      if (dirty) {
        try { localStorage.setItem(CONFIG_KEY, JSON.stringify(saved)); } catch(e) {}
      }
      return saved;
    }
  } catch(e) {}
  return buildDefaultConfig();
}

function buildDefaultConfig() {
  const modules = {};
  MODULE_REGISTRY.forEach(m => {
    modules[m.route] = { status: m.defStatus, roles: [...m.defRoles] };
  });
  return { modules, savedAt: new Date().toISOString() };
}

function savePortalConfig(cfg) {
  cfg.savedAt = new Date().toISOString();
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

// ── Apply config → rebuild ROLE_ROUTES dynamically ───────────────
function applyPortalConfig() {
  const cfg = loadPortalConfig();
  // Rebuild ROLE_ROUTES from config
  ALL_ROLES.forEach(({ key }) => {
    const allowed = new Set();
    MODULE_REGISTRY.forEach(m => {
      const mc = cfg.modules[m.route] || { status: m.defStatus, roles: m.defRoles };
      // md always gets every live module regardless of config roles
      if (mc.status === 'live' && (key === 'md' || mc.roles.includes(key))) {
        allowed.add(m.route);
      }
    });
    // md also always gets dashboard and critical routes
    if (key === 'md') {
      ['dashboard','md-command','budgeting','execution','accounts','reports'].forEach(r => allowed.add(r));
    }
    ROLE_ROUTES[key] = allowed;
  });
  // dept_head stays null (dynamic) but update DEPT_HEAD_ROUTES too
  // Sync nav item data-status attributes from config
  MODULE_REGISTRY.forEach(m => {
    const mc = cfg.modules[m.route] || { status: m.defStatus, roles: m.defRoles };
    const navEl = document.querySelector(`.nav-item[onclick*="navigate('${m.route}')"]`);
    if (navEl) navEl.setAttribute('data-status', mc.status === 'dev' ? 'dev' : 'live');
  });
}

// ── Render Configuration page ─────────────────────────────────────
// ════════════════════════════════════════════════════════════════════
//  SETTINGS PAGE — Sheet IDs · Tab/Query Bindings · Apps Scripts list
//  Admin-only. Uses localStorage overrides so changes apply without a
//  rebuild. Lives at route 'settings' (sidebar link added too).
// ════════════════════════════════════════════════════════════════════
const SETTINGS_LS_KEY = 'evgcpl_settings_overrides';

// Canonical Sheet ID directory — lifted from the bundle's existing
// constants. Editing here in the UI saves to localStorage; runtime
// fetches read from getSheetId('PIN') etc which checks overrides first.
const SHEETS_DIRECTORY = [
  { key:'PIN',     label:'UserSecrets / PIN store',  defaultId:'1hN4VEDNpVLD3lKuBPYCTOaViv7UpveRfud2d2gy15D0', tabs:['UserSecrets','ReportConfig','ReportSchedules'], notes:'Login PIN authentication' },
  { key:'EMP',     label:'Employee Register',         defaultId:'1HWKZPhKRhcuvxBgyyN8zRt8p-SzYmKjJWiOdCgykBHs', tabs:['0_EmployeeRegister_Live'], notes:'333 employees' },
  { key:'PO',      label:'Purchase / Master',         defaultId:'1zcqF2tjjBETPuW25c9MBMo0zakBIBD6tksg5OstFA7c', tabs:['MRS','PO_Actual','SiteMaster','VendorMaster'], notes:'SCM dashboard data — primary PO tab is now PO_Actual (gid 1458467853)' },
  { key:'PAYMENT', label:'Account View / Payments',   defaultId:'1mLddxLRf719EaXE9XSET9gT8l0a8Cxns362yIbHo63g', tabs:['PaymentRequest'], notes:'42-column PaymentRequest schema' },
  { key:'STORES',  label:'v2_Stores',                 defaultId:'1iMQxgqGilUh2_3NCZl5D-EMt-NC8FwugX83q2fWb8fE', tabs:['StockIN','GRN_No','StockLevels'], notes:'Stores & GRN' },
  { key:'V2',      label:'v2_Master',                 defaultId:'1fhSO4WBYp0LNXPxe9I9zr5qsIPs9CIDFpUixBogPnsM', tabs:['DPR','LogSheet','Maintenance','Verification'], notes:'Site DPR & plant data' },
  { key:'SAFETY',  label:'Safety',                    defaultId:'1B8P0PawV43ksazbzhKsil1X6-INOfxx9PFvGycNOvDY', tabs:['Incidents','Checklist'], notes:'Incidents & SHE checklist' },
  { key:'REWARDS', label:'Rewards & Recognition',     defaultId:'1vz8HLopjlSF8TF7rzYuVu5JjqukT929I7aSx7kdehlI', tabs:['Nomination','BlogPosts'], notes:'R&R + wall posts' },
  { key:'BUDGET',  label:'IC Budget Template',        defaultId:'', tabs:['BOQ_Items','Project_Master','Resources'], notes:'Pending — upload template to Drive first' },
];

// Apps Scripts deployed for the portal. Same exec URL handles all
// actions via doGet / doPost; the .gs files in the apps-script/ folder
// are reference copies only.
const APPS_SCRIPTS = [
  {
    name: 'EVGCPL Portal Backend',
    file: 'apps-script/SafetyHandlers.gs',
    execUrl: getExec('main'),
    purpose: 'Primary write-back endpoint',
    actions: [
      'appendRow      — adds rows to any sheet/tab (used by Safety, Reports, DPR)',
      'updateCell     — patches single cells (Safety incident close)',
      'listHRDocs     — Drive folder listing for My Profile',
      'listPolicyFiles — Policy Hub document index',
      'uploadPolicyFile — Policy Hub upload',
      'sendReportTest — manual report email trigger',
      'getScheduleLog — Reports module recent send log',
    ],
  },
  {
    name: 'AI Proxy (Groq + Gemini)',
    file: 'apps-script/AiProxy.gs',
    execUrl: '— same as Portal Backend —',
    purpose: 'AI Chat panel — answers questions using portal data',
    actions: [
      'aiProxy — routes Q&A to Groq (preferred) or Gemini (fallback)',
      'Set GROQ_API_KEY in Script Properties → console.groq.com',
      'Domain selector in chat: All / Accounts / Purchase / Stores / Site / HR / Safety',
      'Each domain attaches relevant CSV rows to the prompt automatically',
      'Model: llama-3.3-70b-versatile · 128K context · ~500 tok/sec',
    ],
  },
  {
    name: 'PIN Reset (v2_PINReset)',
    file: '— external project —',
    execUrl: getExec('main'),
    purpose: 'Standalone PIN-set/reset flow (also linked from login page)',
    actions: [
      'Hosted at evgcpladmin.github.io/password/',
      'Writes to UserSecrets sheet · Modified PIN column',
    ],
  },
  {
    name: 'Sheet Diagnostic',
    file: 'apps-script/SheetDiagnostic.gs',
    execUrl: '— same as Portal Backend —',
    purpose: 'Server-side reachability probe (used by Sharing Doctor)',
    actions: [
      'diagnoseSheet  — verifies a sheetId/tab is accessible from the server',
      'Bypasses CORS limitations of in-browser checks',
    ],
  },
  {
    name: 'Scheduled Reports',
    file: 'apps-script/ScheduledReports.gs',
    execUrl: '— time-driven trigger —',
    purpose: 'Runs hourly via Apps Script trigger; no exec URL needed',
    actions: [
      'sendScheduledReports — checks ReportSchedules tab, fires due reports',
      'setupTriggers       — one-time setup helper (run once after deploy)',
    ],
  },
];

function loadSettingsOverrides() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_LS_KEY) || '{}'); }
  catch (e) { return {}; }
}
function saveSettingsOverrides(obj) {
  try { localStorage.setItem(SETTINGS_LS_KEY, JSON.stringify(obj)); }
  catch (e) { console.warn('Settings save failed:', e); }
}
function getSheetId(key) {
  const ov = loadSettingsOverrides().sheets || {};
  if (ov[key]) return ov[key];
  const def = SHEETS_DIRECTORY.find(s => s.key === key);
  return def ? def.defaultId : '';
}

function renderSettingsPage() {
  const el = document.getElementById('mainContent');
  const ov = loadSettingsOverrides();
  ov.sheets = ov.sheets || {};

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1>&#128295; Settings</h1>
          <p>Sheet IDs &middot; Tab overrides &middot; Apps Scripts &middot; Admin only</p>
        </div>
        <div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap">
          <button onclick="settingsResetAll()" class="btn btn-secondary btn-sm">&#8635; Reset to Defaults</button>
          <button onclick="settingsExport()" class="btn btn-secondary btn-sm">&#11015; Export</button>
        </div>
      </div>
    </div>

    <!-- Help banner -->
    <div class="alert-strip" style="margin-bottom:1rem">
      <span class="alert-icon">&#8505;&#65039;</span>
      <span class="alert-text">
        <b>How overrides work.</b> Edits save to your browser's localStorage and override the bundled defaults on the next data fetch. Per-user, no rebuild needed. To roll out a change company-wide, update the canonical constants in <code>assets/js/portal-bundle.js</code> and redeploy.
      </span>
    </div>

    <!-- Tab bar -->
    <div style="display:flex;gap:4px;border-bottom:2px solid var(--border);margin-bottom:1.4rem">
      <button onclick="settingsSetTab('sheets')" id="stab-sheets"
        class="settings-tab active"
        style="padding:9px 18px;border:none;border-bottom:3px solid var(--g7);background:none;font-family:inherit;font-size:.85rem;font-weight:600;cursor:pointer;color:var(--g7);margin-bottom:-2px">
        &#128203; Sheet IDs
      </button>
      <button onclick="settingsSetTab('appscripts')" id="stab-appscripts"
        class="settings-tab"
        style="padding:9px 18px;border:none;border-bottom:3px solid transparent;background:none;font-family:inherit;font-size:.85rem;font-weight:600;cursor:pointer;color:var(--txt3);margin-bottom:-2px">
        &#9881; Apps Scripts
      </button>
      <button onclick="settingsSetTab('diagnostics')" id="stab-diagnostics"
        class="settings-tab"
        style="padding:9px 18px;border:none;border-bottom:3px solid transparent;background:none;font-family:inherit;font-size:.85rem;font-weight:600;cursor:pointer;color:var(--txt3);margin-bottom:-2px">
        &#129658; Diagnostics
      </button>
    </div>

    <div id="settings-tab-content"></div>
  `;

  window.settingsSetTab = function(tab) {
    document.querySelectorAll('.settings-tab').forEach(b => {
      b.style.color = 'var(--txt3)';
      b.style.borderBottomColor = 'transparent';
      b.classList.remove('active');
    });
    const btn = document.getElementById('stab-' + tab);
    if (btn) {
      btn.style.color = 'var(--g7)';
      btn.style.borderBottomColor = 'var(--g7)';
      btn.classList.add('active');
    }
    const c = document.getElementById('settings-tab-content');
    if (!c) return;
    if (tab === 'sheets')      settingsRenderSheets(c);
    if (tab === 'appscripts')  settingsRenderAppsScripts(c);
    if (tab === 'diagnostics') settingsRenderDiagnostics(c);
  };
  settingsSetTab('sheets');
}

function settingsRenderSheets(container) {
  const ov = loadSettingsOverrides();
  const sheets = ov.sheets || {};
  container.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>&#128203; Sheet IDs &amp; Tab Overrides</h3>
        <span style="font-size:.75rem;color:var(--txt3)">${SHEETS_DIRECTORY.length} sheets registered</span>
      </div>
      <div style="overflow-x:auto">
        <table class="data-table" style="width:100%">
          <thead>
            <tr style="background:var(--g9);color:#fff">
              <th style="padding:10px 12px;text-align:left;min-width:160px">Sheet</th>
              <th style="padding:10px 12px;text-align:left;min-width:340px">Sheet ID</th>
              <th style="padding:10px 12px;text-align:left;min-width:240px">Tabs</th>
              <th style="padding:10px 12px;text-align:left">Notes</th>
              <th style="padding:10px 12px;text-align:center;min-width:80px">Open</th>
            </tr>
          </thead>
          <tbody>
            ${SHEETS_DIRECTORY.map((s,i) => {
              const overridden = !!sheets[s.key];
              const currentId  = sheets[s.key] || s.defaultId || '';
              return `<tr style="border-bottom:1px solid var(--border);${i%2?'background:var(--surface2)':''}">
                <td style="padding:10px 12px">
                  <div style="font-weight:700;color:var(--g9)">${s.label}</div>
                  <div style="font-size:.7rem;color:var(--txt3);margin-top:2px">key: <code>${s.key}</code></div>
                </td>
                <td style="padding:10px 12px">
                  <input type="text" value="${currentId}"
                    placeholder="${s.defaultId || '— not set —'}"
                    onchange="settingsSetSheetId('${s.key}', this.value)"
                    style="width:100%;font-family:'DM Mono',monospace;font-size:.78rem;padding:6px 9px;border:1px solid ${overridden?'#f0a500':'var(--border)'};border-radius:6px;background:var(--surface2);color:var(--txt)">
                  ${overridden ? '<div style="font-size:.7rem;color:#f0a500;margin-top:3px">&#9888; Overridden — <a href="#" onclick="settingsClearSheetId(\''+s.key+'\');return false" style="color:var(--g7)">reset</a></div>' : ''}
                </td>
                <td style="padding:10px 12px;font-size:.75rem;color:var(--txt2)">
                  ${s.tabs.map(t => `<span class="tag" style="margin:2px;font-size:.68rem">${t}</span>`).join('')}
                </td>
                <td style="padding:10px 12px;font-size:.78rem;color:var(--txt3)">${s.notes||''}</td>
                <td style="padding:10px 12px;text-align:center">
                  ${currentId
                    ? `<a href="https://docs.google.com/spreadsheets/d/${currentId}/edit" target="_blank" rel="noopener" style="color:var(--g7);text-decoration:none;font-size:1rem" title="Open in Google Sheets">&#8599;</a>`
                    : '<span style="color:var(--txt3)">—</span>'}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function settingsRenderAppsScripts(container) {
  container.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>&#9881; Deployed Apps Scripts</h3>
        <span style="font-size:.75rem;color:var(--txt3)">${APPS_SCRIPTS.length} scripts</span>
      </div>
      <div style="padding:.5rem">
        ${APPS_SCRIPTS.map((s,i) => `
          <div style="padding:1rem 1rem;border-bottom:${i<APPS_SCRIPTS.length-1?'1px solid var(--border)':'none'}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap">
              <div style="flex:1;min-width:260px">
                <div style="font-size:1rem;font-weight:700;color:var(--g9)">${s.name}</div>
                <div style="font-size:.78rem;color:var(--txt3);margin-top:2px">
                  <code style="font-family:'DM Mono',monospace">${s.file}</code> &middot; ${s.purpose}
                </div>
              </div>
              ${s.execUrl.startsWith('https://')
                ? `<a href="${s.execUrl}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="white-space:nowrap;text-decoration:none">&#8599; Open Exec URL</a>`
                : `<span class="tag" style="font-size:.7rem">${s.execUrl}</span>`}
            </div>
            ${s.execUrl.startsWith('https://') ? `
              <div style="margin-top:.6rem;padding:.5rem .7rem;background:var(--surface2);border-radius:6px;font-family:'DM Mono',monospace;font-size:.72rem;color:var(--txt2);word-break:break-all;display:flex;align-items:center;gap:.5rem">
                <span style="flex:1">${s.execUrl}</span>
                <button onclick="navigator.clipboard.writeText('${s.execUrl}');this.textContent='&#10003; Copied'" class="btn btn-secondary btn-sm" style="font-size:.7rem;padding:3px 9px;white-space:nowrap">Copy</button>
              </div>
            ` : ''}
            <div style="margin-top:.7rem;font-size:.75rem;color:var(--txt2)">
              <div style="font-weight:600;color:var(--txt);margin-bottom:.3rem">Actions / Functions:</div>
              <ul style="margin:0;padding-left:1.2rem;line-height:1.6">
                ${s.actions.map(a => `<li><code style="font-family:'DM Mono',monospace;font-size:.72rem">${a}</code></li>`).join('')}
              </ul>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="alert-strip" style="margin-top:1.2rem">
      <span class="alert-icon">&#9881;</span>
      <span class="alert-text">
        <b>To redeploy:</b> open the <a href="https://script.google.com" target="_blank" rel="noopener" style="color:var(--g7)">Apps Script editor</a>, paste the corresponding <code>.gs</code> file from <code>apps-script/</code>, then Deploy &gt; Manage Deployments &gt; Edit pencil &gt; New Version &gt; Deploy. The exec URL stays the same.
      </span>
    </div>
  `;
}

function settingsRenderDiagnostics(container) {
  container.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>&#129658; Sharing Doctor</h3>
      </div>
      <div style="padding:1rem">
        <p style="font-size:.85rem;color:var(--txt2);margin-bottom:1rem">
          The Sharing Doctor runs a server-side diagnostic on every active Sheet ID using the portal's Apps Script as the network probe. It tells you exactly which sheets are reachable and which are blocked — bypassing CORS limitations of in-browser checks.
        </p>
        <div style="display:flex;gap:.6rem;align-items:center;margin-bottom:1rem">
          <button onclick="settingsRunDoctor()" class="btn btn-primary btn-sm" id="doctorBtn">&#9658; Run Diagnostic</button>
          <span id="doctorStatus" style="font-size:.78rem;color:var(--txt3)"></span>
        </div>
        <div id="doctorResults"></div>
      </div>
    </div>
  `;
}

window.settingsSetSheetId = function(key, val) {
  const ov = loadSettingsOverrides();
  ov.sheets = ov.sheets || {};
  if (val && val.trim()) ov.sheets[key] = val.trim();
  else delete ov.sheets[key];
  saveSettingsOverrides(ov);
  // Re-render to refresh state of override badges
  settingsRenderSheets(document.getElementById('settings-tab-content'));
};

window.settingsClearSheetId = function(key) {
  const ov = loadSettingsOverrides();
  if (ov.sheets) { delete ov.sheets[key]; saveSettingsOverrides(ov); }
  settingsRenderSheets(document.getElementById('settings-tab-content'));
};

window.settingsResetAll = function() {
  if (!confirm('Clear ALL local overrides and revert to bundled defaults?')) return;
  localStorage.removeItem(SETTINGS_LS_KEY);
  renderSettingsPage();
};

window.settingsExport = function() {
  const ov = loadSettingsOverrides();
  const txt = JSON.stringify(ov, null, 2);
  navigator.clipboard.writeText(txt).then(() => {
    alert('Overrides copied to clipboard:\n\n' + txt);
  }).catch(() => prompt('Copy this:', txt));
};

window.settingsRunDoctor = function() {
  const btn = document.getElementById('doctorBtn');
  const status = document.getElementById('doctorStatus');
  const results = document.getElementById('doctorResults');
  if (btn) { btn.disabled = true; btn.textContent = '&#8635; Running...'; }
  if (status) status.textContent = 'Probing each sheet via Apps Script…';

  const checks = SHEETS_DIRECTORY
    .filter(s => (loadSettingsOverrides().sheets?.[s.key] || s.defaultId))
    .map(s => {
      const id = loadSettingsOverrides().sheets?.[s.key] || s.defaultId;
      return fetch(`${APPS_SCRIPT_URL}?action=diagnoseSheet&sheetId=${encodeURIComponent(id)}&tab=${encodeURIComponent(s.tabs[0]||'')}`)
        .then(r => r.text())
        .then(t => { try { return JSON.parse(t); } catch(e) { return { ok:false, error:'Bad JSON: '+t.slice(0,80) }; } })
        .catch(e => ({ ok:false, error: e.message }))
        .then(res => ({ ...s, result: res }));
    });

  Promise.all(checks).then(rows => {
    if (btn) { btn.disabled = false; btn.textContent = '&#9658; Re-run'; }
    if (status) status.textContent = `${rows.length} sheets probed.`;
    if (results) {
      results.innerHTML = `<table class="data-table" style="width:100%;margin-top:.6rem">
        <thead>
          <tr style="background:var(--g9);color:#fff">
            <th style="padding:8px 10px;text-align:left">Sheet</th>
            <th style="padding:8px 10px;text-align:center">Status</th>
            <th style="padding:8px 10px;text-align:left">Detail</th>
          </tr>
        </thead><tbody>
        ${rows.map(r => {
          const ok = r.result && r.result.ok;
          const detail = ok ? `Rows: ${r.result.rowCount ?? '?'}` : (r.result?.error || 'Unreachable');
          return `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:8px 10px"><b>${r.label}</b><br><code style="font-size:.7rem;color:var(--txt3)">${r.key}</code></td>
            <td style="padding:8px 10px;text-align:center">
              <span class="tag" style="background:${ok?'#dcfce7':'#fee2e2'};color:${ok?'#166534':'#991b1b'};font-weight:700">${ok?'✓ OK':'✗ FAIL'}</span>
            </td>
            <td style="padding:8px 10px;font-size:.78rem;color:var(--txt2)">${detail}</td>
          </tr>`;
        }).join('')}
        </tbody></table>`;
    }
  });
};


// ── Apps Script Endpoints sub-page ─────────────────────────────
// Renders the card inline inside Configuration. Saves overrides via
// setExecOverrides(); reads via getExecOverrides() / getExec(key).
function renderExecEndpointsCard() {
  const overrides = getExecOverrides();
  const keys = Object.keys(EXEC_REGISTRY_DEFAULTS);
  const editedCount = keys.filter(k => overrides[k] && overrides[k] !== EXEC_REGISTRY_DEFAULTS[k].defaultUrl).length;

  const rows = keys.map(k => {
    const meta = EXEC_REGISTRY_DEFAULTS[k];
    const current = overrides[k] || meta.defaultUrl;
    const overridden = !!(overrides[k] && overrides[k] !== meta.defaultUrl);
    return `
      <div class="exec-row" data-key="${k}" style="display:grid;grid-template-columns:170px 1fr auto auto;gap:.7rem;align-items:center;padding:.55rem .9rem;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-weight:700;font-size:.86rem;color:var(--g9)">${meta.label}</div>
          <code style="font-size:.66rem;color:var(--txt3)">${k}</code>
        </div>
        <div style="min-width:0">
          <input type="url" id="execIn-${k}" value="${current.replace(/"/g,'&quot;')}"
            placeholder="https://script.google.com/macros/s/.../exec"
            spellcheck="false"
            style="width:100%;padding:.45rem .7rem;font-family:'Consolas','JetBrains Mono',monospace;font-size:11px;border:1.5px solid ${overridden ? '#f0a500' : 'var(--border)'};border-radius:6px;background:var(--surface2);color:var(--txt)">
          <div style="font-size:.7rem;color:var(--txt3);margin-top:.25rem">${meta.desc}</div>
        </div>
        <span id="execStatus-${k}" style="font-size:.66rem;padding:3px 9px;border-radius:8px;background:var(--surface2);color:var(--txt3);font-weight:600;white-space:nowrap">unknown</span>
        <div style="display:flex;gap:.3rem">
          <button onclick="execTestOne('${k}')" class="btn btn-secondary btn-sm" title="Ping with action: __ping__" style="font-size:.7rem;padding:4px 10px">▶︎ Test</button>
          <button onclick="execResetOne('${k}')" class="btn btn-secondary btn-sm" title="Reset to default" style="font-size:.7rem;padding:4px 8px">↻</button>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="card" style="margin-bottom:1.2rem;border-left:4px solid #6366f1">
      <div class="card-head" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.6rem">
        <div>
          <h3 style="margin:0;font-size:1rem">&#128279; Apps Script Endpoints</h3>
          <div style="font-size:.74rem;color:var(--txt3);margin-top:.15rem">
            All <code>/exec</code> URLs in one place. Paste a new deployment URL and Save &amp; Apply &mdash; no code changes needed.
            ${editedCount ? `<span style="color:#f0a500;font-weight:700">&middot; ${editedCount} override${editedCount===1?'':'s'} active</span>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap">
          <button onclick="execTestAll()" class="btn btn-secondary btn-sm" style="font-size:.74rem">▶︎ Test all</button>
          <button onclick="execCopyDiagnostics()" class="btn btn-secondary btn-sm" style="font-size:.74rem" title="After Test all, copy detailed diagnostics for sharing">📋 Copy diag</button>
          <button onclick="execResetAll()" class="btn btn-secondary btn-sm" style="font-size:.74rem">Reset all</button>
          <button onclick="execSaveAll()" class="btn btn-primary btn-sm" id="execSaveBtn" style="font-size:.74rem">&#10003; Save endpoints</button>
        </div>
      </div>
      <div style="padding:.2rem 0">
        ${rows}
      </div>
      <div style="padding:.55rem 1rem;font-size:.7rem;color:var(--txt3);background:var(--surface2);border-top:1px solid var(--border);display:flex;align-items:center;gap:.5rem">
        <span>&#128161;</span>
        <span><strong>How to deploy a new version:</strong> Apps Script Editor &rarr; Deploy &rarr; Manage Deployments &rarr; ✏️ on the active deployment &rarr; New version &rarr; Deploy. The exec URL stays the same; only redeploy is needed for the new code to be live.</span>
      </div>
    </div>`;
}

// Save the input values to localStorage and refresh the runtime values.
window.execSaveAll = function() {
  const map = {};
  Object.keys(EXEC_REGISTRY_DEFAULTS).forEach(k => {
    const inp = document.getElementById('execIn-' + k);
    if (!inp) return;
    const v = inp.value.trim();
    // Only persist if it differs from default and looks like an exec URL
    if (v && v !== EXEC_REGISTRY_DEFAULTS[k].defaultUrl) {
      if (!/^https:\/\/script\.google\.com\/macros\//.test(v)) {
        alert(`"${k}" doesn't look like a Google Apps Script exec URL. Skipping.`);
        return;
      }
      map[k] = v;
    }
  });
  setExecOverrides(map);
  // Update runtime globals so subsequent calls see the new URLs without reload
  try {
    /* eslint-disable */
    eval('PIN_API_URL = getExec(\'pinReset\')');
    eval('APPS_SCRIPT_URL = getExec(\'main\')');
    /* eslint-enable */
  } catch(e) { /* const reassignment will fail in strict mode — that's OK, the next page-load will pick up new values */ }
  // If the PCC iframe is currently mounted, reload it so it picks up the new SCRIPT_URL
  const pccFrame = document.getElementById('pccFrame');
  if (pccFrame) {
    try { pccFrame.contentWindow.location.reload(); } catch (e) { /* cross-origin safety */ }
  }
  const btn = document.getElementById('execSaveBtn');
  if (btn) {
    btn.innerHTML = '&#10003; Saved! Reload any open module';
    btn.style.background = '#16a34a';
    setTimeout(() => { renderDevModePage(); }, 900);
  }
};

window.execResetOne = function(key) {
  const def = EXEC_REGISTRY_DEFAULTS[key]?.defaultUrl;
  const inp = document.getElementById('execIn-' + key);
  if (inp && def) {
    inp.value = def;
    inp.style.borderColor = 'var(--border)';
  }
};

window.execResetAll = function() {
  if (!confirm('Reset ALL endpoint URLs to their compiled-in defaults?')) return;
  setExecOverrides({});
  renderDevModePage();
};

// Ping an endpoint with action: '__ping__' and update its status pill.
// Surfaces detailed diagnostics on failure so deployment issues are visible.
window.execTestOne = async function(key) {
  const inp = document.getElementById('execIn-' + key);
  const statusEl = document.getElementById('execStatus-' + key);
  if (!inp || !statusEl) return;
  const url = inp.value.trim();
  if (!/^https:\/\/script\.google\.com\/macros\//.test(url)) {
    setStatus('invalid url', '#fef2f2', '#dc2626');
    statusEl.title = `URL must match: https://script.google.com/macros/s/.../exec\nGot: ${url}`;
    return;
  }
  setStatus('testing…', '#fef9c3', '#92400e');
  const t0 = performance.now();
  let resInfo = { url, ms: 0 };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: '__ping__' }),
      redirect: 'follow',
    });
    resInfo.ms = Math.round(performance.now() - t0);
    resInfo.status = res.status;
    resInfo.statusText = res.statusText;
    resInfo.contentType = res.headers.get('content-type') || '';
    resInfo.finalUrl = res.url;
    // Read body
    const body = await res.text();
    resInfo.bodySnippet = body.slice(0, 200);
    if (res.ok) {
      // Differentiate green (real JSON response) vs amber (HTML — likely auth wall)
      if (resInfo.contentType.includes('json') || /^[\s]*[{\[]/.test(body)) {
        setStatus(`✓ ${resInfo.ms}ms`, '#dcfce7', '#166534');
        statusEl.title = `OK — JSON response\n${body.slice(0, 150)}`;
      } else if (resInfo.contentType.includes('html')) {
        // Apps Script returned an HTML page — usually means redirected to auth or "Page not found"
        const looksLikeAuth = /sign in|accounts\.google\.com|authentic/i.test(body);
        const looksLikeNotFound = /not found|doesn't exist/i.test(body);
        if (looksLikeAuth) {
          setStatus('✗ needs auth', '#fef2f2', '#dc2626');
          statusEl.title = `Deployment requires Google sign-in.\nFix: Apps Script → Deploy → Manage Deployments → ✏️ → Who has access: "Anyone"\n\nURL: ${url}`;
        } else if (looksLikeNotFound) {
          setStatus('✗ not found', '#fef2f2', '#dc2626');
          statusEl.title = `Apps Script returned "not found" — wrong URL or deployment removed.\n\nURL: ${url}`;
        } else {
          setStatus(`⚠ HTML ${resInfo.ms}ms`, '#fef9c3', '#92400e');
          statusEl.title = `Got HTML response (expected JSON).\nDeployment may exist but doPost isn't returning JSON.\n\nBody: ${body.slice(0, 200)}`;
        }
      } else {
        setStatus(`✓ ${resInfo.ms}ms`, '#dcfce7', '#166534');
        statusEl.title = `OK\n${body.slice(0, 150)}`;
      }
    } else {
      setStatus(`✗ HTTP ${res.status}`, '#fef2f2', '#dc2626');
      statusEl.title = `${res.status} ${res.statusText}\n\nBody: ${body.slice(0, 200)}\n\nURL: ${url}`;
    }
  } catch (e) {
    resInfo.ms = Math.round(performance.now() - t0);
    resInfo.error = e.message || String(e);
    // CORS or DNS or refused connection lands here
    setStatus('✗ network', '#fef2f2', '#dc2626');
    statusEl.title = `Network error: ${resInfo.error}\n\nCommon causes:\n• Deployment "Who has access" not set to "Anyone"\n• URL typo / deployment was deleted\n• CORS pre-flight failed (server returns >302)\n\nURL: ${url}`;
  }
  // Stash diagnostics for the copy-diag button
  statusEl.dataset.diag = JSON.stringify(resInfo, null, 2);

  function setStatus(text, bg, fg) {
    statusEl.textContent = text;
    statusEl.style.background = bg;
    statusEl.style.color = fg;
    statusEl.style.cursor = 'help';
  }
};

// Copy diagnostics to clipboard for sharing
window.execCopyDiagnostics = async function() {
  const lines = ['EVGCPL Endpoint Test Diagnostics\n' + new Date().toISOString() + '\n'];
  Object.keys(EXEC_REGISTRY_DEFAULTS).forEach(k => {
    const inp = document.getElementById('execIn-' + k);
    const statusEl = document.getElementById('execStatus-' + k);
    if (!inp || !statusEl) return;
    lines.push(`── ${k} ──`);
    lines.push(`URL: ${inp.value.trim()}`);
    lines.push(`Status: ${statusEl.textContent}`);
    if (statusEl.dataset.diag) {
      try {
        const d = JSON.parse(statusEl.dataset.diag);
        if (d.status)       lines.push(`HTTP: ${d.status} ${d.statusText || ''}`);
        if (d.contentType)  lines.push(`Content-Type: ${d.contentType}`);
        if (d.finalUrl && d.finalUrl !== d.url) lines.push(`Redirected to: ${d.finalUrl}`);
        if (d.error)        lines.push(`Error: ${d.error}`);
        if (d.bodySnippet)  lines.push(`Body (first 200 chars): ${d.bodySnippet}`);
      } catch (e) {}
    }
    lines.push('');
  });
  const text = lines.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    alert('Diagnostics copied to clipboard — paste into chat to share.');
  } catch (e) {
    // Fallback: show in a textarea so user can copy manually
    const w = window.open('', '_blank', 'width=700,height=500');
    w.document.write('<pre style="font-family:monospace;font-size:11px;padding:20px;white-space:pre-wrap">' +
      text.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])) + '</pre>');
  }
};

window.execTestAll = async function() {
  for (const k of Object.keys(EXEC_REGISTRY_DEFAULTS)) {
    await execTestOne(k);
  }
};

// ══════════════════════════════════════════════════════════════
//  TIER 2 — Sheet-stored config  (PortalConfig tab, Master sheet)
//  Persistent · shared across all users and browsers
//  Write via Apps Script · Read via gviz on startup
// ══════════════════════════════════════════════════════════════

function renderSheetConfigCard() {
  const keys     = Object.keys(EXEC_REGISTRY_DEFAULTS);
  const cfg      = window._SHEET_CONFIG || {};
  const meta     = window._SHEET_CONFIG_META || {};
  const loaded   = window._SHEET_CONFIG_LOADED;
  const hasData  = Object.keys(cfg).length > 0;

  // Source badge for each key — shows which tier is currently active
  function sourceBadge(k) {
    const lsVal    = (getExecOverrides())[k];
    const sheetVal = cfg['exec_' + k];
    const defVal   = EXEC_REGISTRY_DEFAULTS[k]?.defaultUrl;
    if (lsVal && lsVal !== defVal)            return '<span style="font-size:9px;padding:2px 7px;border-radius:8px;background:#fef9c3;color:#92400e;font-weight:700">T1 localStorage</span>';
    if (sheetVal && /^https:/.test(sheetVal)) return '<span style="font-size:9px;padding:2px 7px;border-radius:8px;background:#dcfce7;color:#166534;font-weight:700">T2 Sheet</span>';
    return '<span style="font-size:9px;padding:2px 7px;border-radius:8px;background:rgba(0,0,0,.05);color:#6b7280;font-weight:600">T3 Default</span>';
  }

  const rows = keys.map(k => {
    const sheetVal  = cfg['exec_' + k] || '';
    const m         = meta['exec_' + k] || {};
    const lastInfo  = m.updatedBy ? `${m.updatedAt || ''} by ${m.updatedBy}` : 'Not yet saved';
    return `
    <div style="display:grid;grid-template-columns:170px 1fr auto auto;gap:.7rem;align-items:center;padding:.6rem .9rem;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-weight:700;font-size:.84rem;color:var(--g9)">${EXEC_REGISTRY_DEFAULTS[k].label}</div>
        <code style="font-size:.66rem;color:var(--txt3)">${k}</code>
        <div style="margin-top:3px">${sourceBadge(k)}</div>
      </div>
      <div style="min-width:0">
        <input type="text" id="sheetCfgIn-${k}"
          value="${(sheetVal).replace(/"/g,'&quot;')}"
          placeholder="Paste exec URL here — https://script.google.com/macros/s/.../exec"
          spellcheck="false" autocomplete="off"
          style="width:100%;padding:.45rem .7rem;font-family:'Consolas','JetBrains Mono',monospace;font-size:11px;
                 border:1.5px solid ${sheetVal ? '#16a34a' : 'var(--border)'};
                 border-radius:6px;background:#fff;color:#111;cursor:text" />
        <div style="font-size:.68rem;color:var(--txt3);margin-top:.2rem">
          Last saved: <em>${lastInfo}</em>
        </div>
      </div>
      <span id="sheetCfgSt-${k}" style="font-size:.65rem;padding:3px 8px;border-radius:8px;background:var(--surface2);color:var(--txt3);font-weight:600;white-space:nowrap">—</span>
      <button onclick="sheetConfigSaveOne('${k}')" class="btn btn-primary btn-sm" style="font-size:.7rem;white-space:nowrap">💾 Save</button>
    </div>`;
  }).join('');

  return `
  <div class="card" style="margin-bottom:1.2rem;border-left:4px solid var(--green)">
    <div class="card-head" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.6rem">
      <div>
        <h3 style="margin:0;font-size:1rem">🗄 Sheet Config <span style="font-size:.72rem;font-weight:400;color:var(--txt3);margin-left:.5rem">PortalConfig tab · Master Sheet</span></h3>
        <div style="font-size:.74rem;color:var(--txt3);margin-top:.15rem">
          Persistent · shared across <strong>all users and browsers</strong> ·
          fetched on every page load ·
          ${!loaded ? '<em style="color:#f0a500">Loading from sheet…</em>' :
            hasData ? `<span style="color:#16a34a">✓ ${Object.keys(cfg).length} keys loaded from sheet</span>` :
            window._SHEET_CONFIG_ERR ? `<span style="color:#dc2626">⚠ ${window._SHEET_CONFIG_ERR}</span>` :
            '<span style="color:#9ca3af">PortalConfig tab not found — will be created on first save</span>'}
        <a href="https://docs.google.com/spreadsheets/d/1B2wb38KhNwlLoZnsAGWQkO0FdEGFFfsh3ycRRurigq4/edit#gid=0"
           target="_blank" rel="noopener"
           style="font-size:.68rem;color:var(--g7);margin-left:.5rem">Open Master Sheet ↗</a>
        </div>
      </div>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap">
        <button onclick="sheetConfigReload()" class="btn btn-secondary btn-sm" style="font-size:.74rem">🔄 Reload from Sheet</button>
        <button onclick="sheetConfigSaveAll()" class="btn btn-primary btn-sm" style="font-size:.74rem" id="sheetCfgSaveAllBtn">💾 Save All</button>
      </div>
    </div>
    <div style="padding:.2rem 0">${rows}</div>
    <div style="padding:.6rem 1rem;font-size:.72rem;color:var(--txt3);background:var(--surface2);border-top:1px solid var(--border)">
      <strong>Priority chain:</strong>
      &nbsp;🟠 T1 localStorage override (this browser only, from the card above)
      &nbsp;→&nbsp; 🟢 T2 Sheet config (this card, all users)
      &nbsp;→&nbsp; ⚫ T3 Compiled default (fallback)
      &nbsp;·&nbsp;
      <em>T1 wins even if T2 is set — clear the T1 override to use T2.</em>
    </div>
  </div>`;
}

// Save one key to the PortalConfig sheet
window.sheetConfigSaveOne = async function(key) {
  const inp = document.getElementById('sheetCfgIn-' + key);
  const st  = document.getElementById('sheetCfgSt-' + key);
  if (!inp || !st) return;
  const val = inp.value.trim();
  if (val && !/^https:\/\/script\.google\.com\/macros\//.test(val)) {
    alert(`"${key}" must be a valid Google Apps Script exec URL (https://script.google.com/macros/s/.../exec)`);
    return;
  }
  st.textContent = 'Saving…'; st.style.color = '#92400e';
  try {
    // savePortalConfig is hosted in the standalone PortalConfig backend.
    // Priority chain: portalConfig (dedicated) → pcc (legacy) → main (fallback)
    let writeUrl = '';
    for (const k of ['portalConfig', 'pcc', 'main']) {
      const u = getExec(k);
      if (u && /^https:\/\/script\.google\.com\/macros\//.test(u)) { writeUrl = u; break; }
    }
    if (!writeUrl) {
      st.textContent = '✗ No backend URL configured';
      st.style.color = '#dc2626';
      alert('Deploy the PortalConfigBackend Apps Script first, then paste its URL into the T1 override card under "Portal Config Backend".');
      return;
    }
    const userEmail = (window.STATE && STATE.user && STATE.user.email) || 'unknown';
    const r = await fetch(writeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action:    'savePortalConfig',
        key:       'exec_' + key,
        value:     val,
        updatedBy: userEmail,
      }),
    });
    const data = await r.json();
    if (data.success) {
      window._SHEET_CONFIG['exec_' + key] = val;
      window._SHEET_CONFIG_META['exec_' + key] = {
        updatedBy: userEmail,
        updatedAt: new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }),
      };
      inp.style.borderColor = val ? 'var(--green)' : 'var(--border)';
      st.textContent = '✓ Saved'; st.style.color = '#16a34a';
      setTimeout(() => renderDevModePage(), 1200);
    } else {
      st.textContent = '✗ ' + (data.message || 'Failed'); st.style.color = '#dc2626';
    }
  } catch (e) {
    st.textContent = '✗ Error'; st.style.color = '#dc2626';
    st.title = e.message;
  }
};

// Save all inputs to sheet
window.sheetConfigSaveAll = async function() {
  const keys = Object.keys(EXEC_REGISTRY_DEFAULTS);
  const btn  = document.getElementById('sheetCfgSaveAllBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  for (const k of keys) { await sheetConfigSaveOne(k); }
  if (btn) { btn.disabled = false; btn.textContent = '💾 Save All'; }
};

// Reload sheet config and re-render the Config page
window.sheetConfigReload = async function() {
  const btn = document.getElementById ? document.querySelector('[onclick="sheetConfigReload()"]') : null;
  if (btn) btn.textContent = '🔄 Reloading…';
  window._SHEET_CONFIG = {}; window._SHEET_CONFIG_META = {}; window._SHEET_CONFIG_LOADED = false;
  await loadSheetConfig();
  renderDevModePage();
};


function renderDevModePage() {
  const el = document.getElementById('mainContent');
  const cfg = loadPortalConfig();
  const devOn = STATE.isDevMode;
  const sections = [...new Set(MODULE_REGISTRY.map(m => m.section))];

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1>&#9881; Configuration</h1>
          <p>Module visibility &middot; Role access &middot; Dev Mode &middot; Admin only</p>
        </div>
        <div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap">
          <button onclick="cfgResetToDefaults()" class="btn btn-secondary btn-sm">&#8635; Reset Defaults</button>
          <button onclick="cfgSaveAndApply()" class="btn btn-primary btn-sm" id="cfgSaveBtn">&#10003; Save &amp; Apply</button>
        </div>
      </div>
    </div>

    <!-- Dev Mode master toggle -->
    <div class="card card-pad" style="margin-bottom:1.2rem;border-left:4px solid ${devOn ? '#f0a500' : 'var(--border)'}">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem">
        <div>
          <div style="font-size:1rem;font-weight:700;color:var(--g9)">
            Dev Mode &nbsp;
            <span style="font-size:.78rem;padding:3px 10px;border-radius:10px;background:${devOn ? 'rgba(240,165,0,.2)' : 'var(--surface2)'};color:${devOn ? '#f0a500' : 'var(--txt3)'};font-weight:700">${devOn ? 'ON' : 'OFF'}</span>
          </div>
          <div style="font-size:.8rem;color:var(--txt3);margin-top:.2rem">When ON, modules marked <em>Dev</em> are visible in the sidebar for this session only.</div>
        </div>
        <button onclick="toggleDevMode();renderDevModePage()" class="btn btn-sm"
          style="background:${devOn ? '#f0a500' : 'var(--g7)'};color:${devOn ? '#0d3320' : '#fff'};border:none;padding:.55rem 1.4rem;font-weight:700">
          ${devOn ? '&#10005; Turn OFF' : '&#9881; Turn ON'}
        </button>
      </div>
    </div>

    <!-- Apps Script Endpoints — Tier 1: localStorage override -->
    ${renderExecEndpointsCard()}

    <!-- Apps Script Endpoints — Tier 2: Sheet-stored (PortalConfig tab) -->
    ${renderSheetConfigCard()}

    <!-- Legend -->
    <div style="display:flex;gap:.8rem;flex-wrap:wrap;margin-bottom:1rem;font-size:.75rem;color:var(--txt3)">
      <span>Status:</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:50%;background:#16a34a;display:inline-block"></span>Live — visible to assigned roles</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:50%;background:#f0a500;display:inline-block"></span>Dev — visible only in Dev Mode (md only)</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:50%;background:#9ca3af;display:inline-block"></span>Off — hidden from all users</span>
    </div>

    <!-- Search bar -->
    <div class="card card-pad" style="margin-bottom:1rem;padding:.7rem 1rem">
      <div style="display:flex;align-items:center;gap:.7rem;flex-wrap:wrap">
        <div style="position:relative;flex:1;min-width:240px">
          <span style="position:absolute;left:.7rem;top:50%;transform:translateY(-50%);color:var(--txt3);font-size:.95rem">&#128270;</span>
          <input id="cfgSearch" type="search" placeholder="Filter modules… (e.g. dpr, payment, hr)"
            oninput="cfgSearchFilter(this.value)"
            style="width:100%;padding:.55rem .8rem .55rem 2.1rem;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:.86rem;background:var(--surface2);color:var(--txt)">
        </div>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap">
          <button onclick="cfgExpandAll(true)" class="btn btn-secondary btn-sm" style="font-size:.74rem">&#9662; Expand all</button>
          <button onclick="cfgExpandAll(false)" class="btn btn-secondary btn-sm" style="font-size:.74rem">&#9656; Collapse all</button>
          <button onclick="cfgBulkAll('live')" class="btn btn-secondary btn-sm" style="font-size:.74rem">All Live</button>
          <button onclick="cfgBulkAll('off')"  class="btn btn-secondary btn-sm" style="font-size:.74rem">All Off</button>
        </div>
      </div>
    </div>

    <!-- Module + Role matrix — hierarchical -->
    <div class="card" style="overflow:visible">
      <div class="card-head">
        <h3>&#128203; Module Registry &amp; Role Access</h3>
        <span style="font-size:.75rem;color:var(--txt3)">${MODULE_REGISTRY.length} modules &middot; ${[...new Set(MODULE_REGISTRY.map(m=>m.section))].length} sections &middot; ${ALL_ROLES.length} roles</span>
      </div>
      <div id="cfgSectionsBody" style="padding:.4rem .6rem 1rem">
        ${sections.map((sectionName, si) => {
          const sectionModules = MODULE_REGISTRY.filter(m => m.section === sectionName);
          const counts = { live:0, dev:0, off:0 };
          sectionModules.forEach(m => {
            const mc = cfg.modules[m.route] || { status: m.defStatus, roles: m.defRoles };
            counts[mc.status] = (counts[mc.status] || 0) + 1;
          });
          const totalRoles = sectionModules.length * ALL_ROLES.length;
          const grantedRoles = sectionModules.reduce((sum, m) => {
            const mc = cfg.modules[m.route] || { status: m.defStatus, roles: m.defRoles };
            return sum + mc.roles.length;
          }, 0);
          const allLive = counts.live === sectionModules.length;
          const allOff  = counts.off  === sectionModules.length;
          const sectionState = allLive ? 'live' : allOff ? 'off' : 'mixed';
          const sectionColor = allLive ? '#16a34a' : allOff ? '#9ca3af' : '#f0a500';
          // Default expanded = section has any non-default state; otherwise first 2 sections expanded
          const expanded = (counts.dev > 0 || counts.off > 0) || si < 2;

          return `
          <div class="cfg-section" data-section="${sectionName}" data-section-key="${sectionName.replace(/\s+/g,'_')}" style="border:1px solid var(--border);border-radius:10px;margin-bottom:.6rem;overflow:hidden;background:var(--surface)">
            <!-- Section header -->
            <div onclick="cfgToggleSection('${sectionName.replace(/\s+/g,'_')}')"
                 style="display:flex;align-items:center;gap:.7rem;padding:.7rem 1rem;cursor:pointer;background:linear-gradient(90deg,var(--surface2),var(--surface));border-bottom:1px solid ${expanded?'var(--border)':'transparent'};transition:background .15s"
                 onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background='linear-gradient(90deg,var(--surface2),var(--surface))'">
              <span class="cfg-chev" id="cfgchev-${sectionName.replace(/\s+/g,'_')}" style="display:inline-block;width:14px;font-size:.78rem;color:var(--txt3);transition:transform .2s;transform:rotate(${expanded?90:0}deg)">&#9656;</span>
              <span style="font-size:.95rem;font-weight:700;color:var(--g9);flex:1">${sectionName}</span>
              <span style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:12px;background:${sectionColor}20;color:${sectionColor};font-size:.7rem;font-weight:700">
                <span style="width:7px;height:7px;border-radius:50%;background:${sectionColor};display:inline-block"></span>
                ${sectionState === 'live' ? 'All Live' : sectionState === 'off' ? 'All Off' : 'Mixed'}
              </span>
              <span style="font-size:.7rem;color:var(--txt3);white-space:nowrap">${sectionModules.length} module${sectionModules.length>1?'s':''}</span>
              ${counts.live ? `<span style="font-size:.66rem;padding:2px 7px;border-radius:8px;background:#dcfce7;color:#166534;font-weight:600">${counts.live} live</span>` : ''}
              ${counts.dev  ? `<span style="font-size:.66rem;padding:2px 7px;border-radius:8px;background:#fef3c7;color:#92400e;font-weight:600">${counts.dev} dev</span>`  : ''}
              ${counts.off  ? `<span style="font-size:.66rem;padding:2px 7px;border-radius:8px;background:#f3f4f6;color:#4b5563;font-weight:600">${counts.off} off</span>`  : ''}
              <span style="font-size:.66rem;color:var(--txt3);white-space:nowrap">&middot; ${grantedRoles}/${totalRoles} role grants</span>
              <button onclick="event.stopPropagation();cfgBulkSection('${sectionName.replace(/'/g,"\\'")}','live')" title="Set all in section to Live"
                style="font-size:.66rem;padding:3px 9px;border:1px solid #16a34a40;background:#16a34a10;color:#15803d;border-radius:6px;cursor:pointer;font-weight:600">All Live</button>
              <button onclick="event.stopPropagation();cfgBulkSection('${sectionName.replace(/'/g,"\\'")}','off')" title="Set all in section to Off"
                style="font-size:.66rem;padding:3px 9px;border:1px solid #9ca3af40;background:#9ca3af10;color:#4b5563;border-radius:6px;cursor:pointer;font-weight:600">All Off</button>
            </div>

            <!-- Section body (modules) -->
            <div class="cfg-section-body" id="cfgbody-${sectionName.replace(/\s+/g,'_')}" style="display:${expanded?'block':'none'}">
              ${sectionModules.map((m) => {
                const mc = cfg.modules[m.route] || { status: m.defStatus, roles: [...m.defRoles] };
                const statusColor = mc.status === 'live' ? '#16a34a' : mc.status === 'dev' ? '#f0a500' : '#9ca3af';
                const statusBg    = mc.status === 'live' ? '#dcfce7' : mc.status === 'dev' ? '#fef3c7' : '#f3f4f6';
                const isProtected = (m.route === 'dev-mode'); // dev-mode is md-only by design
                return `
                <div class="cfg-row" data-route="${m.route}" data-label="${m.label.toLowerCase()}" id="cfgrow-${m.route}"
                  style="display:grid;grid-template-columns:minmax(180px,1fr) auto auto auto;gap:.8rem;align-items:center;padding:.6rem 1rem .6rem 2.2rem;border-bottom:1px solid var(--border);transition:background .15s">

                  <!-- Module label + route -->
                  <div style="min-width:0">
                    <div style="font-weight:600;color:var(--g9);font-size:.86rem">${m.label}</div>
                    <code style="font-size:.66rem;color:var(--txt3);font-family:'JetBrains Mono',monospace">/${m.route}</code>
                  </div>

                  <!-- Status pill + dropdown -->
                  <div style="display:flex;align-items:center;gap:.4rem">
                    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColor}"></span>
                    <select onchange="cfgSetStatus('${m.route}',this.value);cfgRefreshSectionHeader('${sectionName.replace(/\s+/g,'_')}')"
                      style="font-size:.74rem;padding:4px 8px;border:1.5px solid ${statusColor}50;border-radius:6px;background:${statusBg};color:${statusColor};font-weight:700;cursor:pointer;outline:none">
                      <option value="live" ${mc.status==='live'?'selected':''}>&#9679; Live</option>
                      <option value="dev"  ${mc.status==='dev' ?'selected':''}>&#9679; Dev</option>
                      <option value="off"  ${mc.status==='off' ?'selected':''}>&#9679; Off</option>
                    </select>
                  </div>

                  <!-- Role chips (compact) -->
                  <div style="display:flex;gap:.25rem;flex-wrap:wrap;justify-content:flex-end;max-width:380px">
                    ${ALL_ROLES.map(r => {
                      const on = mc.roles.includes(r.key);
                      const disabled = isProtected && r.key !== 'md';
                      return `<label
                        title="${r.label}${disabled?' (locked: dev-mode is md-only)':''}"
                        style="display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border:1.2px solid ${on?'#16a34a':'var(--border)'};border-radius:12px;background:${on?'#dcfce7':'var(--surface2)'};color:${on?'#166534':'var(--txt3)'};font-size:.68rem;font-weight:600;cursor:${disabled?'not-allowed':'pointer'};opacity:${disabled?.4:1};user-select:none;transition:all .12s">
                        <input type="checkbox" ${on?'checked':''} ${disabled?'disabled':''}
                          onchange="cfgToggleRole('${m.route}','${r.key}',this.checked);cfgRefreshSectionHeader('${sectionName.replace(/\s+/g,'_')}')"
                          style="width:11px;height:11px;accent-color:#16a34a;cursor:${disabled?'not-allowed':'pointer'};margin:0">
                        ${r.label.split(' ')[0]}
                      </label>`;
                    }).join('')}
                  </div>

                  <!-- Open page -->
                  <button onclick="navigate('${m.route}')" class="btn btn-secondary btn-sm"
                    title="Open ${m.label}"
                    style="font-size:.66rem;padding:3px 10px;white-space:nowrap">&#8599; Open</button>
                </div>`;
              }).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>
      <div id="cfgEmptyState" style="display:none;padding:2rem;text-align:center;color:var(--txt3);font-size:.86rem">
        <div style="font-size:1.6rem;margin-bottom:.4rem">&#128269;</div>
        No modules match the filter.
      </div>
    </div>

    <!-- Scheduled Reports -->
    <div class="card card-pad" style="margin-top:1.2rem" id="schedReportCard">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:.5rem">
        <h3 style="font-size:.9rem;font-weight:700;color:var(--g9)">&#128228; Scheduled Email Reports</h3>
        <span id="schedSaveStatus" style="font-size:.72rem;color:var(--g7);display:none">&#10003; Saved</span>
      </div>

      <!-- Recipients -->
      <div style="margin-bottom:1rem">
        <label style="font-size:.78rem;font-weight:600;color:var(--txt2);display:block;margin-bottom:.4rem">&#128101; Recipients</label>
        <div style="display:flex;gap:.5rem;margin-bottom:.4rem;flex-wrap:wrap">
          <input id="schedRecipInput" type="email" placeholder="email@example.com"
            style="flex:1;min-width:200px;padding:6px 10px;border:1px solid var(--border);border-radius:7px;font-size:.8rem;font-family:inherit;background:var(--surface2);color:var(--txt)"
            onkeydown="if(event.key==='Enter'){event.preventDefault();schedAddRecip()}">
          <button onclick="schedAddRecip()" class="btn btn-secondary btn-sm">+ Add</button>
          <button onclick="schedPickFromEmployees()" class="btn btn-secondary btn-sm">&#128100; Pick from Team</button>
        </div>
        <div id="schedRecipList" style="display:flex;flex-wrap:wrap;gap:.35rem;min-height:28px;padding:4px 0">
          <span style="font-size:.72rem;color:var(--txt3)">No recipients added yet</span>
        </div>
      </div>

      <!-- Trigger time -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:.7rem;margin-bottom:1rem">
        <div>
          <label style="font-size:.78rem;font-weight:600;color:var(--txt2);display:block;margin-bottom:.3rem">&#128197; Day of Week</label>
          <select id="schedDay" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:7px;font-size:.8rem;font-family:inherit;background:var(--surface2);color:var(--txt)">
            <option value="daily">Every Day</option>
            <option value="1">Monday</option>
            <option value="2">Tuesday</option>
            <option value="3">Wednesday</option>
            <option value="4">Thursday</option>
            <option value="5">Friday</option>
            <option value="6">Saturday</option>
            <option value="0">Sunday</option>
          </select>
        </div>
        <div>
          <label style="font-size:.78rem;font-weight:600;color:var(--txt2);display:block;margin-bottom:.3rem">&#128336; Time (IST)</label>
          <select id="schedTime" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:7px;font-size:.8rem;font-family:inherit;background:var(--surface2);color:var(--txt)">
            ${['06:00','07:00','08:00','09:00','10:00','18:00','20:00'].map(t =>
              `<option value="${t}" ${t==='08:00'?'selected':''}>${t} IST</option>`
            ).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:.78rem;font-weight:600;color:var(--txt2);display:block;margin-bottom:.3rem">&#128203; Report Type</label>
          <select id="schedType" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:7px;font-size:.8rem;font-family:inherit;background:var(--surface2);color:var(--txt)">
            <option value="daily">Daily Digest</option>
            <option value="safety">Safety Incidents Only</option>
            <option value="po">PO Approvals Only</option>
            <option value="full">Full Summary (All Modules)</option>
          </select>
        </div>
        <div>
          <label style="font-size:.78rem;font-weight:600;color:var(--txt2);display:block;margin-bottom:.3rem">&#9989; Status</label>
          <select id="schedActive" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:7px;font-size:.8rem;font-family:inherit;background:var(--surface2);color:var(--txt)">
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </div>
      </div>

      <!-- Subject prefix -->
      <div style="margin-bottom:1rem">
        <label style="font-size:.78rem;font-weight:600;color:var(--txt2);display:block;margin-bottom:.3rem">&#128231; Email Subject Prefix</label>
        <input id="schedSubject" type="text" value="EVGCPL Daily Digest"
          style="width:100%;max-width:400px;padding:6px 10px;border:1px solid var(--border);border-radius:7px;font-size:.8rem;font-family:inherit;background:var(--surface2);color:var(--txt)">
      </div>

      <div style="display:flex;align-items:center;gap:.7rem;flex-wrap:wrap">
        <button onclick="schedSave()" class="btn" style="background:var(--g7);color:#fff;font-size:.8rem">&#128190; Save Config</button>
        <button onclick="schedTestSend()" class="btn btn-secondary btn-sm">&#9992;&#65039; Send Test Now</button>
        <span style="font-size:.72rem;color:var(--txt3)">Trigger must be installed in Apps Script Editor → Triggers → <code>scheduledDailyReport</code> → Time-driven</span>
      </div>
    </div>

    <!-- Pending items -->
    <div class="card card-pad" style="margin-top:1.2rem">
      <h3 style="font-size:.9rem;font-weight:700;margin-bottom:1rem;color:var(--g9)">&#128203; Open Items</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:.6rem">
        ${[
          ['HIGH','#dc2626','Upload Budget template → Drive → set BUDGET_SHEET_ID'],
          ['HIGH','#dc2626','Deploy appendRow in Apps Script (safety sheet writes)'],
          ['MED', '#d97706','My Team card — live debug: reportee empCode matching'],
          ['MED', '#d97706','OAuth External audience for 260 Gmail users'],
          ['MED', '#d97706','CNAME: intranet.evgcpl.com → GitHub Pages'],
          ['MED', '#d97706','Onboarding forms — checklist + document upload flow'],
          ['LOW', '#2563eb','Safety: Close incident write-back to sheet'],
          ['LOW', '#2563eb','Rewards sheet: create + share + plug in ID'],
                  ].map(([p,c,t]) => `
          <div style="display:flex;align-items:flex-start;gap:.5rem;padding:.55rem .75rem;background:var(--surface2);border:1px solid ${c}30;border-left:3px solid ${c};border-radius:7px">
            <span style="font-size:.62rem;padding:1px 6px;border-radius:6px;background:${c}18;color:${c};font-weight:700;white-space:nowrap;margin-top:1px">${p}</span>
            <span style="font-size:.76rem;color:var(--txt2);line-height:1.4">${t}</span>
          </div>`).join('')}
      </div>
    </div>
    <div style="font-size:.72rem;color:var(--txt3);margin-top:.7rem;text-align:right">
      Last saved: ${cfg.savedAt ? new Date(cfg.savedAt).toLocaleString('en-IN') : 'Never'}
    </div>
  `;

  // ── In-page config state ──────────────────────────────────────
  window._cfgDraft = JSON.parse(JSON.stringify(cfg)); // deep copy
  setTimeout(schedRestoreUI, 50); // restore sched config after DOM renders

  window.cfgSetStatus = function(route, status) {
    window._cfgDraft.modules[route].status = status;
    // Update row color in table
    const sel = document.querySelector(`#cfgrow-${route} select`);
    if (sel) {
      const c = status === 'live' ? '#16a34a' : status === 'dev' ? '#f0a500' : '#9ca3af';
      sel.style.color = c;
    }
    cfgMarkDirty();
  };

  window.cfgToggleRole = function(route, role, checked) {
    const roles = window._cfgDraft.modules[route].roles;
    if (checked && !roles.includes(role)) roles.push(role);
    if (!checked) {
      const idx = roles.indexOf(role);
      if (idx > -1) roles.splice(idx, 1);
    }
    cfgMarkDirty();
  };

  window.cfgMarkDirty = function() {
    const btn = document.getElementById('cfgSaveBtn');
    if (btn) { btn.textContent = '&#10003; Save & Apply *'; btn.style.background = '#f0a500'; btn.style.color = '#0d3320'; }
  };

  window.cfgSaveAndApply = function() {
    savePortalConfig(window._cfgDraft);
    applyPortalConfig();
    applyRoleNavRestrictions(STATE.role);
    const btn = document.getElementById('cfgSaveBtn');
    if (btn) { btn.innerHTML = '&#10003; Saved!'; btn.style.background = '#16a34a'; btn.style.color = '#fff'; setTimeout(() => renderDevModePage(), 800); }
    // Show toast
    const t = document.createElement('div');
    t.innerHTML = '&#10003; Configuration saved &amp; applied';
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(26,96,56,.95);color:#fff;padding:9px 20px;border-radius:8px;font-size:.82rem;font-weight:600;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.3);pointer-events:none';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  };

  window.cfgResetToDefaults = function() {
    if (!confirm('Reset all module visibility and role access to defaults?')) return;
    const def = buildDefaultConfig();
    savePortalConfig(def);
    applyPortalConfig();
    applyRoleNavRestrictions(STATE.role);
    renderDevModePage();
  };

  // ── Hierarchical Config UI helpers ──────────────────────────────
  window.cfgToggleSection = function(sectionKey) {
    const body = document.getElementById('cfgbody-' + sectionKey);
    const chev = document.getElementById('cfgchev-' + sectionKey);
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    if (chev) chev.style.transform = `rotate(${open ? 0 : 90}deg)`;
    // Tweak the divider beneath the header
    const head = body.previousElementSibling;
    if (head) head.style.borderBottom = open ? '1px solid transparent' : '1px solid var(--border)';
  };

  window.cfgExpandAll = function(open) {
    document.querySelectorAll('#cfgSectionsBody .cfg-section').forEach(sec => {
      const key = sec.dataset.sectionKey;
      const body = document.getElementById('cfgbody-' + key);
      const chev = document.getElementById('cfgchev-' + key);
      if (!body) return;
      body.style.display = open ? 'block' : 'none';
      if (chev) chev.style.transform = `rotate(${open ? 90 : 0}deg)`;
      const head = body.previousElementSibling;
      if (head) head.style.borderBottom = open ? '1px solid var(--border)' : '1px solid transparent';
    });
  };

  // Bulk set ALL modules in one section to a given status
  window.cfgBulkSection = function(sectionName, status) {
    MODULE_REGISTRY.filter(m => m.section === sectionName).forEach(m => {
      window._cfgDraft.modules[m.route].status = status;
    });
    cfgMarkDirty();
    // Re-render the page to reflect new state cleanly
    renderDevModePage();
  };

  // Bulk set EVERY module to a given status
  window.cfgBulkAll = function(status) {
    if (!confirm(`Set ALL ${MODULE_REGISTRY.length} modules to "${status}"?`)) return;
    MODULE_REGISTRY.forEach(m => {
      window._cfgDraft.modules[m.route].status = status;
    });
    cfgMarkDirty();
    renderDevModePage();
  };

  // Search filter across modules
  window.cfgSearchFilter = function(q) {
    const query = (q || '').trim().toLowerCase();
    let visibleCount = 0;
    document.querySelectorAll('#cfgSectionsBody .cfg-section').forEach(sec => {
      let sectionHasMatch = false;
      sec.querySelectorAll('.cfg-row').forEach(row => {
        const label = row.dataset.label || '';
        const route = row.dataset.route || '';
        const match = !query || label.includes(query) || route.includes(query);
        row.style.display = match ? 'grid' : 'none';
        if (match) { sectionHasMatch = true; visibleCount++; }
      });
      // If query is active, expand sections with matches and hide empty ones
      if (query) {
        sec.style.display = sectionHasMatch ? 'block' : 'none';
        if (sectionHasMatch) {
          const key = sec.dataset.sectionKey;
          const body = document.getElementById('cfgbody-' + key);
          const chev = document.getElementById('cfgchev-' + key);
          if (body) body.style.display = 'block';
          if (chev) chev.style.transform = 'rotate(90deg)';
        }
      } else {
        sec.style.display = 'block';
      }
    });
    const empty = document.getElementById('cfgEmptyState');
    if (empty) empty.style.display = (query && visibleCount === 0) ? 'block' : 'none';
  };

  // Recompute the chips on a section header after a status/role change
  window.cfgRefreshSectionHeader = function(sectionKey) {
    // Cheapest path: re-render. Page state (draft, scroll) is preserved via _cfgDraft.
    // But to avoid losing scroll position on every checkbox click, we update in place.
    const sec = document.querySelector(`.cfg-section[data-section-key="${sectionKey}"]`);
    if (!sec) return;
    const sectionName = sec.dataset.section;
    const sectionModules = MODULE_REGISTRY.filter(m => m.section === sectionName);
    const counts = { live:0, dev:0, off:0 };
    let granted = 0;
    sectionModules.forEach(m => {
      const mc = window._cfgDraft.modules[m.route] || { status: m.defStatus, roles: m.defRoles };
      counts[mc.status] = (counts[mc.status] || 0) + 1;
      granted += mc.roles.length;
    });
    const total = sectionModules.length * ALL_ROLES.length;
    const allLive = counts.live === sectionModules.length;
    const allOff  = counts.off  === sectionModules.length;
    const state = allLive ? 'live' : allOff ? 'off' : 'mixed';
    const color = allLive ? '#16a34a' : allOff ? '#9ca3af' : '#f0a500';

    const head = sec.firstElementChild;
    if (!head) return;
    // Replace state pill
    const pills = head.querySelectorAll('span');
    if (pills.length >= 2) {
      // pill index 1 = state badge wrapper containing dot+label
      const statePill = pills[1];
      statePill.style.background = color + '20';
      statePill.style.color = color;
      const dot = statePill.querySelector('span');
      if (dot) dot.style.background = color;
      // Replace text content (last text node)
      const txt = state === 'live' ? 'All Live' : state === 'off' ? 'All Off' : 'Mixed';
      // Remove existing text nodes and re-append with the dot
      Array.from(statePill.childNodes).forEach(n => { if (n.nodeType === 3) n.remove(); });
      statePill.appendChild(document.createTextNode(' ' + txt));
    }
    // Update count chips by simply finding chips and replacing/recreating them
    const headerChildren = Array.from(head.children);
    headerChildren.forEach(c => {
      if (c.dataset && c.dataset.cfgCount) c.remove();
    });
    // Re-render counts inline (lightweight DOM)
    const insertAfterTitle = headerChildren.find(c => c.style && c.style.background && c.style.background.includes('20'));
    if (insertAfterTitle) {
      const insertAt = insertAfterTitle.nextSibling;
      const mkChip = (label, bg, fg) => {
        const s = document.createElement('span');
        s.dataset.cfgCount = '1';
        s.style.cssText = `font-size:.66rem;padding:2px 7px;border-radius:8px;background:${bg};color:${fg};font-weight:600`;
        s.textContent = label;
        return s;
      };
      // Find anchor: counts go between modules-count and grants-count
      // Easiest: just rebuild that horizontal row by re-rendering the whole page on save
      // For now, mark dirty so user knows to save — chips refresh on save
    }
    cfgMarkDirty();
  };
}



// ══════════════════════════════════════════════════
//  NOTIFICATIONS — Live from POs + Payments + Safety
// ══════════════════════════════════════════════════
let _notifItems = [];
let _notifLoaded = false;

async function loadNotifications() {
  _notifItems = [];

  // ── 1. Pending Payments ──
  try {
    const pays = await fetchSheet('PaymentRequest', 'SELECT A,E,F,H,L,W,AG', PAYMENT_SHEET_ID);
    pays.filter(r => {
      const cat = getPayStatus(r['Status'] || r['AK'] || '').cat;
      return cat === 'pending' && (r['Payment To'] || r['J']);
    }).slice(0, 15).forEach(r => {
      const amt = parseFloat(String(r['Amount'] || r['W'] || '0').replace(/[^0-9.-]/g,'')) || 0;
      const st  = getPayStatus(r['Status'] || r['AK'] || '');
      _notifItems.push({
        id: 'pay-' + (r['UUID'] || r['A'] || Math.random()),
        type: 'payment', icon: '&#128178;',
        title: st.label || 'Payment Pending',
        body: (r['Payment To'] || r['J'] || '') +
              (r['Site Name'] || r['O'] ? ' &middot; ' + (r['Site Name'] || r['O']) : '') +
              (amt ? ' &middot; &#8377;' + Math.round(amt).toLocaleString('en-IN') : ''),
        time: r['Date Of Request'] || r['F'] || '',
        color: '#d97706', bg: '#fffbeb', route: 'accounts', unread: true,
      });
    });
  } catch(e) { console.warn('Notif: Payment load failed', e.message); }

  // ── 2. Pending POs ──
  try {
    const pos = await fetchSheet(PO_TAB, 'SELECT A,E,F,R,S,AG', PO_SHEET_ID);
    pos.filter(r => {
      const status = (r['PO Approval Status'] || r['AG'] || '').toLowerCase();
      return r['PO No'] && r['PO No'] !== 'Dummy' &&
             !status.includes('reject') && !status.includes('approv');
    }).slice(0, 10).forEach(r => {
      const amt = parseFloat(String(r['Net Amount'] || r['S'] || '0').replace(/[^0-9.-]/g,'')) || 0;
      _notifItems.push({
        id: 'po-' + (r['A'] || Math.random()),
        type: 'po', icon: '&#128722;',
        title: 'PO Pending Approval',
        body: (r['PO No'] || r['E'] || '') +
              (amt ? ' &middot; &#8377;' + Math.round(amt).toLocaleString('en-IN') : ''),
        time: r['PO Date'] || r['F'] || '',
        color: '#2563eb', bg: '#eff6ff', route: 'scm', unread: true,
      });
    });
  } catch(e) { console.warn('Notif: PO load failed', e.message); }

  // ── 3. Open Safety Incidents ──
  try {
    const rows = await fetchSheet('Incidents', 'SELECT B,C,D,E,F,I,J', SAFETY_SHEET_ID);
    rows.filter(r => (r['Status'] || r['I'] || '').toLowerCase() === 'open')
      .slice(0, 8).forEach(r => {
        const sev = r['Severity'] || r['E'] || '';
        const sevColor = {Low:'#2563eb',Medium:'#d97706',High:'#dc2626',Critical:'#7c3aed'}[sev] || '#6b7280';
        _notifItems.push({
          id: 'inc-' + (r['UUID'] || r['B'] || Math.random()),
          type: 'safety', icon: '&#129510;',
          title: 'Open Safety Incident' + (sev ? ' — ' + sev : ''),
          body: (r['Site'] || r['C'] || '') +
                (r['Type'] || r['D'] ? ' &middot; ' + (r['Type'] || r['D']) : ''),
          time: r['Date'] || r['J'] || '',
          color: sevColor, bg: sevColor + '18', route: 'safety', unread: true,
        });
      });
  } catch(e) { console.warn('Notif: Safety load failed', e.message); }

  // Sort unread first
  _notifItems.sort((a, b) => (b.unread ? 1 : 0) - (a.unread ? 1 : 0));
  _notifLoaded = true;
  return _notifItems;
}

function renderNotifPanel() {
  const listEl = document.getElementById('notifListContainer');
  if (!listEl) return;

  const unread = _notifItems.filter(n => n.unread).length;
  // Update bell dot
  const dot = document.querySelector('.notif-dot');
  if (dot) {
    dot.style.display = unread > 0 ? 'block' : 'none';
    dot.textContent = unread > 9 ? '9+' : String(unread || '');
  }

  if (!_notifLoaded || !_notifItems.length) {
    listEl.innerHTML = `
      <div style="text-align:center;padding:2rem 1rem;color:var(--txt3)">
        <div style="font-size:1.8rem;margin-bottom:.5rem">&#128276;</div>
        <div style="font-size:.82rem">No pending notifications</div>
        <div style="font-size:.72rem;margin-top:.3rem;color:var(--txt4)">PO approvals, payment alerts &amp; safety incidents appear here</div>
        <button onclick="refreshNotifications()" class="btn btn-secondary btn-sm" style="margin-top:.8rem">&#8635; Refresh</button>
      </div>`;
    return;
  }

  listEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:0 0 .5rem;margin-bottom:.5rem;border-bottom:1px solid var(--border)">
      <span style="font-size:.75rem;font-weight:600;color:var(--txt2)">${_notifItems.length} alerts &middot; ${unread} unread</span>
      <button onclick="refreshNotifications()" class="btn btn-secondary btn-sm" style="font-size:.68rem;padding:2px 8px">&#8635;</button>
    </div>
    ${_notifItems.map(n => `
      <div onclick="navigate('${n.route}');toggleNotifPanel()"
        style="padding:.7rem .8rem;border-radius:8px;margin-bottom:.4rem;border:1px solid ${n.unread ? n.color+'30' : 'var(--border)'};background:${n.unread ? n.bg : 'var(--surface2)'};cursor:pointer;transition:opacity .15s"
        onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
        <div style="display:flex;align-items:flex-start;gap:.6rem">
          <div style="width:28px;height:28px;border-radius:6px;background:${n.color}20;color:${n.color};display:flex;align-items:center;justify-content:center;font-size:.85rem;flex-shrink:0">${n.icon}</div>
          <div style="min-width:0;flex:1">
            <div style="font-size:.8rem;font-weight:${n.unread ? 700 : 500};color:var(--g9);margin-bottom:2px">${n.title}</div>
            <div style="font-size:.72rem;color:var(--txt3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n.body}</div>
            ${n.time ? `<div style="font-size:.68rem;color:var(--txt4);margin-top:3px">${n.time}</div>` : ''}
          </div>
          ${n.unread ? `<div style="width:7px;height:7px;border-radius:50%;background:${n.color};flex-shrink:0;margin-top:4px"></div>` : ''}
        </div>
      </div>`).join('')}
  `;
}

async function refreshNotifications() {
  const listEl = document.getElementById('notifListContainer');
  if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--txt3)">&#8987; Loading...</div>';
  await loadNotifications();
  renderNotifPanel();
}

function initNotifications() {
  setTimeout(() => loadNotifications().then(renderNotifPanel).catch(() => {}), 3000);
}

// Patch toggleNotifPanel to auto-load on first open
(function() {
  const _orig = window.toggleNotifPanel;
  window.toggleNotifPanel = function() {
    _orig && _orig();
    if (STATE.notifOpen) {
      if (!_notifLoaded) refreshNotifications();
      else renderNotifPanel();
    }
  };
})();

function renderSCMDashboard() {
  const el = document.getElementById('mainContent');
  el.innerHTML = `
    <div class="page-header" style="margin-bottom:1rem">
      <h1>📦 Purchase Dashboard</h1>
      <p>Live PO tracker · Approvals · Spend analytics</p>
    </div>

    <!-- KPI Row -->
    <div class="kpi-grid" style="margin-bottom:1.4rem">
      <div class="kpi-card" style="cursor:pointer" onclick="window.scmJumpTo('all')">
        <div class="kpi-top"><div class="kpi-icon green">📋</div><div class="kpi-trend flat" style="font-size:.65rem">view all ↓</div></div>
        <div class="kpi-value" id="scm-kpi-total">—</div>
        <div class="kpi-label">Total POs</div>
        <div style="margin-top:.35rem"><button class="as-btn" onclick="event.stopPropagation();window.open(AS.purchase(),'_blank')">🚀 Purchase View</button></div>
      </div>
      <div class="kpi-card warn" style="cursor:pointer" onclick="window.scmJumpTo('pending')">
        <div class="kpi-top"><div class="kpi-icon orange">⏳</div><div class="kpi-trend flat" style="font-size:.65rem">view list ↓</div></div>
        <div class="kpi-value" id="scm-kpi-pending">—</div>
        <div class="kpi-label">Pending Approval</div>
        <div style="margin-top:.35rem"><button class="as-btn" onclick="event.stopPropagation();window.open(AS.poApproval(),'_blank')">🚀 PO Approval</button></div>
      </div>
      <div class="kpi-card info" style="cursor:pointer" onclick="window.scmJumpTo('approved')">
        <div class="kpi-top"><div class="kpi-icon blue">✅</div><div class="kpi-trend flat" style="font-size:.65rem">view list ↓</div></div>
        <div class="kpi-value" id="scm-kpi-approved">—</div>
        <div class="kpi-label">Approved</div>
        <div style="margin-top:.35rem"><button class="as-btn" onclick="event.stopPropagation();window.open(AS.purchase(),'_blank')">🚀 Purchase View</button></div>
      </div>
      <div class="kpi-card" style="cursor:pointer" onclick="window.scmJumpTo('rejected')">
        <div class="kpi-top"><div class="kpi-icon red">❌</div><div class="kpi-trend flat" style="font-size:.65rem">view list ↓</div></div>
        <div class="kpi-value" id="scm-kpi-rejected">—</div>
        <div class="kpi-label">Rejected</div>
        <div style="margin-top:.35rem"><button class="as-btn" onclick="event.stopPropagation();window.open(AS.purchase(),'_blank')">🚀 Purchase View</button></div>
      </div>
    </div>

    <!-- ⏳ Pending Approval — with Age flags -->
    <div class="card" id="scm-pending-section" style="margin-bottom:1.4rem">
      <div class="card-head">
        <h3>⏳ Pending Approval</h3>
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          <span class="hr-stat-pill" id="scm-pending-badge">Loading…</span>
          <span id="scm-overdue-badge" style="display:none;background:#fdecea;color:#c62828;font-size:.72rem;font-weight:700;padding:.2rem .6rem;border-radius:20px"></span>
          <button onclick="window.scmPendingDownloadCSV()" class="csv-btn">⬇ CSV</button>
          <button onclick="window.open(APPSHEET_SCM_URL,'_blank')"
            style="padding:.35rem .9rem;background:var(--g7);color:#fff;border:none;border-radius:6px;font-size:.78rem;font-weight:600;cursor:pointer;font-family:inherit">
            🚀 Open in AppSheet
          </button>
        </div>
      </div>
      <div class="card-body" style="padding:0;overflow-x:auto">
        <div id="scm-pending-table">
          <div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:2.5rem;color:var(--txt3)">
            <div style="width:24px;height:24px;border:2px solid var(--border);border-top-color:var(--g5);border-radius:50%;animation:spin 1s linear infinite"></div>
            Loading POs…
          </div>
        </div>
      </div>
    </div>

    <!-- 📅 Month-wise PO Trend -->
    <div class="card" style="margin-bottom:1.4rem">
      <div class="card-head">
        <h3>📅 Monthly PO Trend</h3>
        <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">
          <select id="scm-fy-select" onchange="window.scmChangeFY(this.value)"
            style="padding:.3rem .7rem;border:1px solid var(--border);border-radius:6px;font-size:.8rem;font-family:inherit;background:#fff;color:var(--g8);font-weight:600">
            <option value="">Loading…</option>
          </select>
          <span class="hr-stat-pill" id="scm-month-badge">—</span>
        </div>
      </div>
      <div class="card-body" style="padding:1.2rem 1rem">
        <div id="scm-month-chart" style="min-height:120px;display:flex;align-items:flex-end;gap:6px;overflow-x:auto">
          <div style="padding:2rem;text-align:center;color:var(--txt3);width:100%">Loading…</div>
        </div>
        <div id="scm-month-legend" style="margin-top:.75rem;font-size:.72rem;color:var(--txt3);display:flex;justify-content:space-between">
        </div>
      </div>
    </div>

    <!-- Two-column row: Site + Vendor -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.2rem;margin-bottom:1rem">

      <!-- 🏗️ Site Spend -->
      <div class="card">
        <div class="card-head">
          <h3>🏗️ Spend by Site</h3>
          <span class="hr-stat-pill" id="scm-site-badge">—</span>
        </div>
        <div class="card-body" style="padding:0;overflow-x:auto">
          <div id="scm-site-table"><div style="padding:2rem;text-align:center;color:var(--txt3)">Loading…</div></div>
        </div>
      </div>

      <!-- 🏢 Top 5 Vendors -->
      <div class="card">
        <div class="card-head">
          <h3>🏢 Top 5 Vendors by Spend</h3>
          <span class="hr-stat-pill" id="scm-vendor-badge">—</span>
        </div>
        <div class="card-body" style="padding:0;overflow-x:auto">
          <div id="scm-vendor-table"><div style="padding:2rem;text-align:center;color:var(--txt3)">Loading…</div></div>
        </div>
      </div>

    </div>

    <!-- 📋 All POs — deep-link target -->
    <div class="card" id="scm-all-section" style="margin-bottom:1.4rem;display:none">
      <div class="card-head">
        <h3 id="scm-all-title">📋 All POs</h3>
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          <span class="hr-stat-pill" id="scm-all-badge">—</span>
          <button onclick="window.scmDownloadCSV()" class="csv-btn">⬇ CSV</button>
          <button onclick="document.getElementById('scm-all-section').style.display='none'" style="padding:.25rem .7rem;border:1px solid var(--border);border-radius:6px;background:#fff;font-size:.75rem;cursor:pointer;font-family:inherit">✕ Close</button>
        </div>
      </div>
      <div class="card-body" style="padding:.75rem;padding-bottom:0">
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.75rem">
          <input id="scm-all-search" type="text" placeholder="Search PO No, Vendor, Site…"
            style="flex:1;min-width:180px;padding:.38rem .65rem;border:1.5px solid #cce3d4;border-radius:8px;font-size:.82rem;font-family:inherit;outline:none"
            oninput="window.scmRenderAllTable()" />
          <select id="scm-all-fy" onchange="window.scmRenderAllTable()"
            style="padding:.38rem .65rem;border:1.5px solid #cce3d4;border-radius:8px;font-size:.82rem;font-family:inherit;outline:none;background:#fff">
            <option value="">All FY</option>
          </select>
        </div>
      </div>
      <div class="card-body" style="padding:0;overflow-x:auto;max-height:320px;overflow-y:auto">
        <div id="scm-all-table"></div>
      </div>
    </div>
  `;
  loadPOData();
}

// ── LOAD DATA ────────────────────────────────────────────
function loadPOData() {
  fetchSheet(PO_TAB, 'SELECT A,E,F,G,J,R,S,AF,AG,AP,AQ', PO_SHEET_ID).then(rawRows => {
    if (!rawRows || rawRows.length === 0) {
      document.getElementById('scm-pending-table').innerHTML =
        `<div style="padding:2rem;text-align:center;color:#c62828">
          ⚠️ Could not load PO data. Open v2_Purchase → Share → set to
          <strong>"Anyone on the internet"</strong> → Viewer.
        </div>`;
      return;
    }

    const today = new Date(); today.setHours(0,0,0,0);

    const rows = rawRows.filter(r => {
      const poNo   = (r['PO No'] || '').trim();
      const vendor = (r['Vendor Name'] || '').trim().toLowerCase();
      return poNo && poNo.toLowerCase() !== 'dummy' && vendor !== 'dummy';
    }).map(r => {
      const dateRaw = r['PO Date'] || '';
      const jsDate  = parsePODate(dateRaw);
      const ageDays = jsDate ? Math.floor((today - jsDate) / 86400000) : null;
      return {
        uuid:       r['UUID'] || '',
        poNo:       r['PO No'] || '',
        poDate:     dateRaw,
        jsDate,
        ageDays,
        monthKey:   jsDate ? `${jsDate.getFullYear()}-${String(jsDate.getMonth()+1).padStart(2,'0')}` : null,
        monthLabel: jsDate ? jsDate.toLocaleDateString('en-IN', {month:'short', year:'2-digit'}) : '—',
        vendor:     r['Vendor Name'] || '—',
        site:       r['Site Name'] || '—',
        preparedBy: r['Prepared By'] || '—',
        approver:   r['Approver Name'] || '—',
        status:     (r['PO Approval Status'] || '').trim(),
        lock:       (r['Lock'] || '').trim(),
        amount:     parseFloat((r['Net Amount']||'0').toString().replace(/,/g,''))||0,
        quote:      r['Quote(Attachment)'] || '',
      };
    });

    // KPIs
    const total    = rows.length;
    const pending  = rows.filter(r => r.status.toUpperCase() !== 'REJECTED' && r.lock === 'Released for Approval').length;
    const approved = rows.filter(r => r.status.toUpperCase().includes('APPROVED')).length;
    const rejected = rows.filter(r => r.status.toUpperCase().includes('REJECT')).length;

    document.getElementById('scm-kpi-total').textContent    = total;
    document.getElementById('scm-kpi-pending').textContent  = pending;
    document.getElementById('scm-kpi-approved').textContent = approved;
    document.getElementById('scm-kpi-rejected').textContent = rejected;
    document.getElementById('scm-pending-badge').innerHTML  = `<strong>${pending}</strong> awaiting`;

    // Aged pending badge
    _scmPendingPOs = rows.filter(r => r.status.toUpperCase() !== 'REJECTED' && r.lock === 'Released for Approval');
    const overdue  = _scmPendingPOs.filter(r => r.ageDays !== null && r.ageDays > 7).length;
    const ob = document.getElementById('scm-overdue-badge');
    if (ob && overdue > 0) {
      ob.style.display = '';
      ob.textContent   = `🔴 ${overdue} overdue >7 days`;
    }

    // Site summary
    const siteMap = {};
    rows.forEach(r => {
      if (!siteMap[r.site]) siteMap[r.site] = { site: r.site, count: 0, amount: 0 };
      siteMap[r.site].count++;
      siteMap[r.site].amount += r.amount;
    });
    _scmSiteData = Object.values(siteMap);

    // Vendor summary — top 5 by amount
    const vendorMap = {};
    rows.forEach(r => {
      if (!vendorMap[r.vendor]) vendorMap[r.vendor] = { vendor: r.vendor, count: 0, amount: 0 };
      vendorMap[r.vendor].count++;
      vendorMap[r.vendor].amount += r.amount;
    });
    _scmVendorData = Object.values(vendorMap).sort((a,b) => b.amount - a.amount).slice(0, 5);

    _scmAllRows = rows;

    // Month-wise — group ALL months, FY filtering done in renderMonthChart
    const monthMap = {};
    rows.forEach(r => {
      if (!r.monthKey) return;
      if (!monthMap[r.monthKey]) monthMap[r.monthKey] = {
        key: r.monthKey, label: r.monthLabel, count: 0, amount: 0,
        fyKey: getFYKey(r.jsDate)
      };
      monthMap[r.monthKey].count++;
      monthMap[r.monthKey].amount += r.amount;
    });
    _scmMonthData = Object.values(monthMap).sort((a,b) => a.key.localeCompare(b.key));

    // Populate FY dropdown with all FYs found in data
    const fySet = [...new Set(_scmMonthData.map(m => m.fyKey).filter(Boolean))].sort().reverse();
    _scmSelectedFY = fySet.includes(currentFYKey()) ? currentFYKey() : (fySet[0] || currentFYKey());
    const fySelect = document.getElementById('scm-fy-select');
    if (fySelect) {
      fySelect.innerHTML = fySet.map(fy =>
        `<option value="${fy}" ${fy === _scmSelectedFY ? 'selected' : ''}>FY ${fy}</option>`
      ).join('');
    }

    renderPendingTable();
    renderSiteTable();
    renderVendorTable();
    renderMonthChart();

    // Populate All POs FY dropdown
    const fySet2 = [...new Set(_scmAllRows.map(r => getFYKey(r.jsDate)).filter(Boolean))].sort().reverse();
    const allFySel = document.getElementById('scm-all-fy');
    if (allFySel) allFySel.innerHTML = '<option value="">All FY</option>' +
      fySet2.map(fy => `<option value="${fy}">${fy}</option>`).join('');
  }).catch(err => {
    document.getElementById('scm-pending-table').innerHTML =
      `<div style="padding:2rem;text-align:center;color:#c62828">Error: ${err.message}</div>`;
  });
}

// ── SCM DEEP LINK ────────────────────────────────────────
window.scmDownloadCSV = function() {
  const sec = document.getElementById('scm-all-section');
  const filter = sec ? sec.dataset.filter || 'all' : 'all';
  const q  = (document.getElementById('scm-all-search')?.value || '').toLowerCase();
  const fy = document.getElementById('scm-all-fy')?.value || '';
  let rows = _scmAllRows;
  if (filter === 'pending')  rows = rows.filter(r => r.status.toUpperCase() !== 'REJECTED' && r.lock === 'Released for Approval');
  else if (filter === 'approved') rows = rows.filter(r => r.status.toUpperCase().includes('APPROVED'));
  else if (filter === 'rejected') rows = rows.filter(r => r.status.toUpperCase().includes('REJECT'));
  if (fy) rows = rows.filter(r => r.jsDate && getFYKey(r.jsDate) === fy);
  if (q)  rows = rows.filter(r => r.poNo.toLowerCase().includes(q) || r.vendor.toLowerCase().includes(q) || r.site.toLowerCase().includes(q));
  const csv = rows.map(r => ({ 'PO No': r.poNo, 'PO Date': fmtDate(r.poDate), 'Vendor': r.vendor, 'Site': r.site, 'Amount': r.amount, 'Status': r.status, 'Age (Days)': r.ageDays ?? '', 'Approver': r.approver }));
  downloadCSV(csv, `POs_${filter}_${new Date().toISOString().slice(0,10)}.csv`);
};
window.scmJumpTo = function(filter) {
  const sec = document.getElementById('scm-all-section');
  if (!sec) return;
  sec.style.display = 'block';
  const titles = { all:'📋 All POs', pending:'⏳ Pending POs', approved:'✅ Approved POs', rejected:'❌ Rejected POs' };
  const title = document.getElementById('scm-all-title');
  if (title) title.textContent = titles[filter] || '📋 All POs';
  // Store active filter for render
  sec.dataset.filter = filter;
  window.scmRenderAllTable();
  sec.scrollIntoView({ behavior:'smooth', block:'start' });
};

window.scmRenderAllTable = function() {
  const sec = document.getElementById('scm-all-section');
  const el  = document.getElementById('scm-all-table');
  const badge = document.getElementById('scm-all-badge');
  if (!el || !_scmAllRows.length) return;

  const filter = sec ? sec.dataset.filter || 'all' : 'all';
  const q      = (document.getElementById('scm-all-search')?.value || '').toLowerCase();
  const fy     = document.getElementById('scm-all-fy')?.value || '';

  let rows = _scmAllRows;
  // Status filter
  if (filter === 'pending')  rows = rows.filter(r => r.status.toUpperCase() !== 'REJECTED' && r.lock === 'Released for Approval');
  else if (filter === 'approved') rows = rows.filter(r => r.status.toUpperCase().includes('APPROVED'));
  else if (filter === 'rejected') rows = rows.filter(r => r.status.toUpperCase().includes('REJECT'));
  // FY filter
  if (fy) rows = rows.filter(r => r.jsDate && getFYKey(r.jsDate) === fy);
  // Search
  if (q) rows = rows.filter(r =>
    r.poNo.toLowerCase().includes(q) || r.vendor.toLowerCase().includes(q) ||
    r.site.toLowerCase().includes(q)  || r.approver.toLowerCase().includes(q)
  );

  if (badge) badge.innerHTML = `<strong>${rows.length}</strong> record${rows.length !== 1 ? 's' : ''}`;

  if (!rows.length) {
    el.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--txt3)">No records match your filter.</div>`;
    return;
  }

  const trs = rows.map(r => {
    const appLink = `${APPSHEET_SCM_URL}?tblName=PO&rowKey=${encodeURIComponent(r.uuid)}`;
    const stCol = r.status.toUpperCase().includes('APPROVED') ? '#e8f5e9' : r.status.toUpperCase().includes('REJECT') ? '#ffebee' : r.lock === 'Released for Approval' ? '#fff8e1' : '#f0f4f1';
    const stTxt = r.status.toUpperCase().includes('APPROVED') ? '#2e7d32' : r.status.toUpperCase().includes('REJECT') ? '#c62828' : r.lock === 'Released for Approval' ? '#b07000' : 'var(--txt2)';
    return `<tr>
      <td><div style="font-weight:700;color:var(--g7);font-size:.82rem">${r.poNo}</div><div style="font-size:.72rem;color:var(--txt3)">${fmtDate(r.poDate)}</div></td>
      <td style="font-size:.82rem">${r.vendor}</td>
      <td style="font-size:.82rem">${r.site}</td>
      <td style="font-weight:700;font-size:.85rem">${fmtAmtFull(r.amount)}</td>
      <td><span style="background:${stCol};color:${stTxt};padding:.18rem .5rem;border-radius:20px;font-size:.72rem;font-weight:700">${r.status || 'Pending'}</span></td>
      <td>${ageBadge(r.ageDays)}</td>
      <td style="font-size:.78rem;color:var(--txt3)">${r.approver}</td>
      <td><div style="display:flex;gap:.4rem">
        <button onclick="window.open('${appLink}','_blank')" style="padding:.25rem .6rem;background:var(--g7);color:#fff;border:none;border-radius:5px;font-size:.72rem;cursor:pointer;font-family:inherit">📋 Open</button>
        ${r.quote ? `<button onclick="window.open('${r.quote}','_blank')" style="padding:.25rem .6rem;background:#e3f2fd;color:#1565c0;border:none;border-radius:5px;font-size:.72rem;cursor:pointer;font-family:inherit">📎 Quote</button>` : ''}
      </div></td>
    </tr>`;
  }).join('');

  el.innerHTML = `<table class="emp-table" style="min-width:780px">
    <thead><tr>
      <th>PO No / Date</th><th>Vendor</th><th>Site</th>
      <th>Amount</th><th>Status</th><th>Age</th><th>Approver</th><th>Actions</th>
    </tr></thead>
    <tbody>${trs}</tbody>
  </table>`;
};

// ── HELPERS ──────────────────────────────────────────────
function parsePODate(v) {
  if (!v) return null;
  if (typeof v === 'string' && v.startsWith('Date(')) {
    try {
      const p = v.replace('Date(','').replace(')','').split(',').map(Number);
      return new Date(p[0], p[1], p[2]);
    } catch(e) { return null; }
  }
  const d = new Date(v);
  return isNaN(d) ? null : d;
}
function fmtDate(v) {
  const d = parsePODate(v);
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
}
function fmtAmt(n) {
  if (!n) return '—';
  if (n >= 10000000) return '₹' + (n/10000000).toFixed(1) + 'Cr';
  if (n >= 100000)   return '₹' + (n/100000).toFixed(1) + 'L';
  return '₹' + n.toLocaleString('en-IN', {maximumFractionDigits:0});
}
function fmtAmtFull(n) {
  return n ? '₹' + n.toLocaleString('en-IN', {maximumFractionDigits:0}) : '—';
}
function ageBadge(days) {
  if (days === null) return '';
  if (days > 14) return `<span style="background:#fdecea;color:#c62828;font-size:.68rem;font-weight:700;padding:.15rem .45rem;border-radius:20px;margin-left:4px">🔴 ${days}d</span>`;
  if (days > 7)  return `<span style="background:#fff3e0;color:#e65100;font-size:.68rem;font-weight:700;padding:.15rem .45rem;border-radius:20px;margin-left:4px">🟠 ${days}d</span>`;
  return `<span style="background:#f1f8e9;color:#558b2f;font-size:.68rem;padding:.15rem .45rem;border-radius:20px;margin-left:4px">${days}d</span>`;
}

// ── SORT HEADER ──────────────────────────────────────────
function sortTh(label, col, stateKey) {
  const s = stateKey === 'pending' ? _pendingSort : stateKey === 'vendor' ? _vendorSort : _siteSort;
  const arrow = s.col === col ? (s.dir === 1 ? ' ▲' : ' ▼') : ' ↕';
  return `<th style="cursor:pointer;user-select:none;white-space:nowrap"
    onclick="window.scmSort('${stateKey}','${col}')">${label}<span style="opacity:.45;font-size:.68rem">${arrow}</span></th>`;
}
window.scmSort = function(stateKey, col) {
  const map = { pending: [_pendingSort, renderPendingTable], site: [_siteSort, renderSiteTable], vendor: [_vendorSort, renderVendorTable] };
  if (!map[stateKey]) return;
  const [state, fn] = map[stateKey];
  if (state.col === col) state.dir *= -1; else { state.col = col; state.dir = 1; }
  fn();
};

// ── PENDING TABLE ────────────────────────────────────────
function renderPendingTable() {
  const el = document.getElementById('scm-pending-table');
  if (!el) return;
  if (_scmPendingPOs.length === 0) {
    el.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--txt3)">✅ No POs currently released for approval</div>`;
    return;
  }
  const sorted = [..._scmPendingPOs].sort((a,b) => {
    const va = a[_pendingSort.col] ?? ''; const vb = b[_pendingSort.col] ?? '';
    return typeof va === 'number' ? (va-vb)*_pendingSort.dir : String(va).localeCompare(String(vb))*_pendingSort.dir;
  });
  const trs = sorted.map(r => {
    const appLink = `${APPSHEET_SCM_URL}?tblName=PO&rowKey=${encodeURIComponent(r.uuid)}`;
    return `<tr>
      <td>
        <div style="font-weight:700;color:var(--g7);font-size:.82rem">${r.poNo}</div>
        <div style="font-size:.72rem;color:var(--txt3)">${fmtDate(r.poDate)}</div>
      </td>
      <td style="font-size:.82rem">${r.vendor}</td>
      <td style="font-size:.82rem">${r.site}</td>
      <td style="font-weight:700;color:var(--g8);font-size:.85rem">${fmtAmtFull(r.amount)}</td>
      <td>${ageBadge(r.ageDays)}</td>
      <td style="font-size:.78rem;color:var(--txt3)">${r.approver}</td>
      <td>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap">
          <button onclick="window.open('${appLink}','_blank')"
            style="padding:.25rem .65rem;background:var(--g7);color:#fff;border:none;border-radius:5px;font-size:.72rem;cursor:pointer;font-family:inherit">📋 Open PO</button>
          ${r.quote ? `<button onclick="window.open('${r.quote}','_blank')"
            style="padding:.25rem .65rem;background:#e3f2fd;color:#1565c0;border:none;border-radius:5px;font-size:.72rem;cursor:pointer;font-family:inherit">📎 Quote</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
  el.innerHTML = `
    <table class="emp-table" style="min-width:680px">
      <thead><tr>
        ${sortTh('PO No / Date','poNo','pending')}
        ${sortTh('Vendor','vendor','pending')}
        ${sortTh('Site','site','pending')}
        ${sortTh('Amount','amount','pending')}
        ${sortTh('Age','ageDays','pending')}
        ${sortTh('Approver','approver','pending')}
        <th>Actions</th>
      </tr></thead>
      <tbody>${trs}</tbody>
    </table>`;

  // Apply sort + pagination
  const _t_pendingTable = el?.querySelector?.(".emp-table, .vpi-tbl") || el?.closest?.(".card")?.querySelector?.(".emp-table, .vpi-tbl");
  if (_t_pendingTable) { makeTableSortable(_t_pendingTable); wrapTableScroll(_t_pendingTable); }
}

// ── SITE TABLE ───────────────────────────────────────────
function renderSiteTable() {
  const el = document.getElementById('scm-site-table');
  const badge = document.getElementById('scm-site-badge');
  if (!el) return;
  const sorted = [..._scmSiteData].sort((a,b) => {
    const va = a[_siteSort.col]??''; const vb = b[_siteSort.col]??'';
    return typeof va==='number' ? (va-vb)*_siteSort.dir : String(va).localeCompare(String(vb))*_siteSort.dir;
  });
  if (badge) badge.innerHTML = `<strong>${sorted.length}</strong> sites`;
  const totalAmt = sorted.reduce((s,r)=>s+r.amount,0);
  const maxAmt   = Math.max(...sorted.map(r=>r.amount),1);
  const trs = sorted.map(r => {
    const pct = Math.round((r.amount/maxAmt)*100);
    return `<tr>
      <td style="font-weight:600;font-size:.82rem;color:var(--g8)">${r.site}</td>
      <td style="text-align:center;font-size:.82rem">${r.count}</td>
      <td style="font-weight:700;color:var(--g7);font-size:.83rem">${fmtAmt(r.amount)}</td>
      <td style="min-width:100px">
        <div style="background:var(--surface2);border-radius:20px;height:7px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:var(--g5);border-radius:20px"></div>
        </div>
      </td>
    </tr>`;
  }).join('');
  el.innerHTML = `
    <table class="emp-table" style="min-width:360px">
      <thead><tr>
        ${sortTh('Site','site','site')}
        ${sortTh('POs','count','site')}
        ${sortTh('Amount','amount','site')}
        <th>Bar</th>
      </tr></thead>
      <tbody>${trs}</tbody>
      <tfoot><tr style="background:var(--surface2);font-weight:700">
        <td style="font-size:.82rem;color:var(--g8)">TOTAL</td>
        <td style="text-align:center;font-size:.82rem">${_scmSiteData.reduce((s,r)=>s+r.count,0)}</td>
        <td style="font-weight:700;color:var(--g7);font-size:.83rem">${fmtAmt(totalAmt)}</td>
        <td></td>
      </tr></tfoot>
    </table>`;

  // Apply sort + pagination
  const _t_siteTable = el?.querySelector?.(".emp-table, .vpi-tbl") || el?.closest?.(".card")?.querySelector?.(".emp-table, .vpi-tbl");
  if (_t_siteTable) { makeTableSortable(_t_siteTable); wrapTableScroll(_t_siteTable); }
}

// ── VENDOR TABLE (TOP 5) ─────────────────────────────────
function renderVendorTable() {
  const el = document.getElementById('scm-vendor-table');
  const badge = document.getElementById('scm-vendor-badge');
  if (!el) return;
  const sorted = [..._scmVendorData].sort((a,b) => {
    const va = a[_vendorSort.col]??''; const vb = b[_vendorSort.col]??'';
    return typeof va==='number' ? (va-vb)*_vendorSort.dir : String(va).localeCompare(String(vb))*_vendorSort.dir;
  });
  if (badge) badge.innerHTML = `Top 5 of <strong>${_scmVendorData.length || '—'}</strong>`;
  const maxAmt = Math.max(...sorted.map(r=>r.amount),1);
  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
  const trs = sorted.map((r,i) => {
    const pct = Math.round((r.amount/maxAmt)*100);
    return `<tr>
      <td style="font-size:.9rem;text-align:center">${medals[i]||i+1}</td>
      <td style="font-weight:600;font-size:.82rem;color:var(--g8)">${r.vendor}</td>
      <td style="text-align:center;font-size:.82rem">${r.count}</td>
      <td style="font-weight:700;color:var(--g7);font-size:.83rem">${fmtAmt(r.amount)}</td>
      <td style="min-width:80px">
        <div style="background:var(--surface2);border-radius:20px;height:7px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:var(--acc);border-radius:20px"></div>
        </div>
      </td>
    </tr>`;
  }).join('');
  el.innerHTML = `
    <table class="emp-table" style="min-width:340px">
      <thead><tr>
        <th>#</th>
        ${sortTh('Vendor','vendor','vendor')}
        ${sortTh('POs','count','vendor')}
        ${sortTh('Amount','amount','vendor')}
        <th>Bar</th>
      </tr></thead>
      <tbody>${trs}</tbody>
    </table>`;

  // Apply sort + pagination
  const _t_vendorTable = el?.querySelector?.(".emp-table, .vpi-tbl") || el?.closest?.(".card")?.querySelector?.(".emp-table, .vpi-tbl");
  if (_t_vendorTable) { makeTableSortable(_t_vendorTable); wrapTableScroll(_t_vendorTable); }
}

// ── MONTH TREND CHART ────────────────────────────────────
// Called by FY dropdown onchange
window.scmChangeFY = function(fyKey) {
  _scmSelectedFY = fyKey;
  renderMonthChart();
};

function renderMonthChart() {
  const el    = document.getElementById('scm-month-chart');
  const badge = document.getElementById('scm-month-badge');
  const leg   = document.getElementById('scm-month-legend');
  if (!el) return;

  // Build the 12-month Apr–Mar grid for the selected FY
  const fy = _scmSelectedFY || currentFYKey();
  const startYr = 2000 + parseInt(fy.split('-')[0]);

  // Generate all 12 month slots Apr(startYr) → Mar(startYr+1)
  const slots = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(startYr, 3 + i, 1);           // Apr=3, wraps to next year via JS Date
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const label = d.toLocaleDateString('en-IN', {month:'short', year:'2-digit'});
    slots.push({ key, label, count: 0, amount: 0 });
  }

  // Fill slots from _scmMonthData filtered to this FY
  const fyMonths = _scmMonthData.filter(m => m.fyKey === fy);
  fyMonths.forEach(m => {
    const slot = slots.find(s => s.key === m.key);
    if (slot) { slot.count = m.count; slot.amount = m.amount; }
  });

  const maxAmt      = Math.max(...slots.map(s => s.amount), 1);
  const fyTotal     = slots.reduce((s, m) => s + m.amount, 0);
  const fyPOCount   = slots.reduce((s, m) => s + m.count, 0);
  const currentMoKey = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;

  if (badge) badge.innerHTML = `${fmtAmt(fyTotal)} · ${fyPOCount} POs`;

  if (fyTotal === 0) {
    el.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--txt3);width:100%">No PO data for FY ${fy}</div>`;
    return;
  }

  const bars = slots.map(m => {
    const hPct    = Math.round((m.amount / maxAmt) * 140);
    const isCurr  = m.key === currentMoKey;
    const isEmpty = m.amount === 0;
    const barCol  = isCurr
      ? 'linear-gradient(180deg,var(--acc),#e65100)'
      : 'linear-gradient(180deg,var(--g6),var(--g8))';
    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:44px;max-width:80px">
        <div style="font-size:.68rem;font-weight:700;color:${isEmpty?'var(--txt4)':'var(--g7)'}">${isEmpty ? '—' : fmtAmt(m.amount)}</div>
        <div style="width:100%;display:flex;align-items:flex-end;height:140px">
          ${hPct > 0 ? `
          <div style="width:100%;background:${barCol};border-radius:6px 6px 0 0;height:${hPct}px;position:relative;cursor:default;${isCurr?'box-shadow:0 0 0 2px var(--acc)':''}"
            title="${m.label}: ${fmtAmtFull(m.amount)} · ${m.count} POs">
            <div style="position:absolute;bottom:-18px;left:50%;transform:translateX(-50%);
              background:${isCurr?'var(--acc)':'var(--g7)'};color:#fff;font-size:.62rem;font-weight:700;
              padding:.1rem .3rem;border-radius:20px;white-space:nowrap">${m.count}</div>
          </div>` : `<div style="width:100%;height:4px;background:var(--surface2);border-radius:4px;align-self:flex-end"></div>`}
        </div>
        <div style="margin-top:20px;font-size:.7rem;font-weight:${isCurr?'800':'600'};color:${isCurr?'var(--g7)':'var(--txt2)'};white-space:nowrap">${m.label}</div>
      </div>`;
  }).join('');

  el.innerHTML = `<div style="display:flex;align-items:flex-end;gap:4px;padding:0 .25rem;width:100%">${bars}</div>`;

  if (leg) leg.innerHTML = `
    <div style="display:flex;gap:1.4rem;flex-wrap:wrap;padding-top:.5rem;border-top:1px solid var(--border);align-items:center">
      <span style="display:flex;align-items:center;gap:5px">
        <span style="display:inline-block;width:14px;height:10px;background:linear-gradient(var(--g6),var(--g8));border-radius:3px"></span>
        <span>Net Amount (bar height)</span>
      </span>
      <span style="display:flex;align-items:center;gap:5px">
        <span style="display:inline-block;width:14px;height:10px;background:var(--g7);border-radius:3px"></span>
        <span>PO Count (label on bar)</span>
      </span>
      <span style="display:flex;align-items:center;gap:5px">
        <span style="display:inline-block;width:14px;height:10px;background:linear-gradient(var(--acc),#e65100);border-radius:3px"></span>
        <span>Current month</span>
      </span>
    </div>`;
}

// ══════════════════════════════════════════════════
//  PLACEHOLDER
// ══════════════════════════════════════════════════
// ══════════════════════════════════════════════════
//  MY DOCUMENTS
// ══════════════════════════════════════════════════

// Fetch UUID for logged-in user from EmployeePersonalDetails tab
async function fetchMyUUID() {
  if (STATE.masters.personalDetailsLoaded) {
    const email = (STATE.user?.email || '').toLowerCase();
    return (STATE.masters.personalDetails.find(r => r.email === email) || {}).uuid || null;
  }
  try {
    // Col A=UUID, Col F=Mail ID
    const rows = await fetchSheet('0A_EmployeePersonalDetails', 'SELECT A,F', EMP_SHEET_ID);
    STATE.masters.personalDetails = rows.map(r => ({
      uuid:  (r['UUID'] || r['A'] || r[Object.keys(r)[0]] || '').trim(),
      email: (r['Mail ID'] || r['F'] || r[Object.keys(r)[5]] || '').trim().toLowerCase(),
    })).filter(r => r.uuid && r.email);
    STATE.masters.personalDetailsLoaded = true;
    const email = (STATE.user?.email || '').toLowerCase();
    return (STATE.masters.personalDetails.find(r => r.email === email) || {}).uuid || null;
  } catch(e) {
    console.warn('Personal details fetch failed:', e.message);
    return null;
  }
}

async function renderMyDocuments() {
  const el = document.getElementById('mainContent');
  if (!el) return;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">📂 My Documents</div>
        <div class="page-subtitle">Your personal HR documents — view or upload</div>
      </div>
    </div>
    <div id="my-docs-uuid-status" style="display:flex;align-items:center;gap:.6rem;padding:.75rem 1rem;background:var(--surface2);border-radius:10px;margin-bottom:1.2rem;font-size:.82rem;color:var(--txt3)">
      <div style="width:18px;height:18px;border:2px solid var(--border);border-top-color:var(--g5);border-radius:50%;animation:spin 1s linear infinite;flex-shrink:0"></div>
      Looking up your employee record…
    </div>
    <div id="my-docs-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem"></div>
  `;

  // Get UUID
  const uuid = await fetchMyUUID();
  const statusEl = document.getElementById('my-docs-uuid-status');

  if (!uuid) {
    if (statusEl) statusEl.innerHTML = `<span style="color:#c62828">⚠️ No employee record found for your email. Contact HR.</span>`;
    return;
  }

  if (statusEl) statusEl.style.display = 'none';

  // Render each doc type card
  const grid = document.getElementById('my-docs-grid');
  if (!grid) return;

  // Render skeleton cards first
  grid.innerHTML = HR_DOCS_TYPES.map(t => `
    <div class="card" id="doc-card-${t.folder.replace(/\s/g,'_')}">
      <div class="card-body" style="display:flex;flex-direction:column;gap:.6rem;align-items:center;padding:1.2rem;text-align:center">
        <div style="font-size:2.2rem">${t.icon}</div>
        <div style="font-weight:700;font-size:.88rem;color:var(--g8)">${t.label}</div>
        <div style="width:20px;height:20px;border:2px solid var(--border);border-top-color:var(--g5);border-radius:50%;animation:spin 1s linear infinite;margin:.4rem 0"></div>
      </div>
    </div>`).join('');

  // Fetch file list for all doc types in parallel
  Promise.all(HR_DOCS_TYPES.map(async (t) => {
    const cardId = `doc-card-${t.folder.replace(/\s/g,'_')}`;
    try {
      const url = `${APPS_SCRIPT_URL}?action=listHRDocs&folderId=${HR_DOCS_FOLDER_ID}&subFolder=${encodeURIComponent(t.folder)}&prefix=${encodeURIComponent(uuid)}`;
      const res  = await fetch(url);
      const data = await res.json();
      const files = data.files || [];
      renderDocCard(cardId, t, uuid, files);
    } catch(e) {
      renderDocCard(cardId, t, uuid, [], true);
    }
  }));
}

function renderDocCard(cardId, docType, uuid, files, error = false) {
  const card = document.getElementById(cardId);
  if (!card) return;

  const hasFiles = files.length > 0;

  card.innerHTML = `
    <div class="card-body" style="display:flex;flex-direction:column;gap:.6rem;align-items:center;padding:1.2rem;text-align:center">
      <div style="font-size:2.2rem">${docType.icon}</div>
      <div style="font-weight:700;font-size:.88rem;color:var(--g8)">${docType.label}</div>

      ${error ? `<div style="font-size:.74rem;color:var(--txt3)">Unable to load</div>` :
        hasFiles ?
          files.map(f => `
            <a href="${f.webViewLink}" target="_blank"
              style="width:100%;padding:.45rem .75rem;background:#e8f5e9;color:#2e7d32;border:1.5px solid #a5d6a7;border-radius:8px;font-size:.78rem;font-weight:600;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:.35rem">
              👁 View ${f.name.length > 22 ? f.name.slice(0,20)+'…' : f.name}
            </a>`).join('') :
          `<div style="font-size:.74rem;color:var(--txt3);margin:.2rem 0">No document uploaded yet</div>
           <label style="width:100%;padding:.45rem .75rem;background:var(--g7);color:#fff;border-radius:8px;font-size:.78rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:.35rem">
             ⬆ Upload
             <input type="file" accept="${docType.accept}" style="display:none"
               onchange="window.uploadHRDoc(event,'${docType.folder}','${uuid}','${cardId}')"/>
           </label>`
      }
    </div>`;
}

window.uploadHRDoc = async function(event, folderName, uuid, cardId) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { alert('File too large — max 10MB'); return; }

  const card = document.getElementById(cardId);
  const label = card?.querySelector('label');
  if (label) label.textContent = '⏳ Uploading…';

  try {
    const b64 = await new Promise((res,rej) => {
      const r = new FileReader();
      r.onload = e => res(e.target.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });

    const res  = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action:    'uploadHRDoc',
        folderId:  HR_DOCS_FOLDER_ID,
        subFolder: folderName,
        prefix:    uuid,
        fileName:  file.name,
        mimeType:  file.type || 'application/octet-stream',
        data:      b64,
      }),
    });
    const json = await res.json();

    if (json.status === 'ok') {
      // Refresh this card
      const docType = HR_DOCS_TYPES.find(t => t.folder === folderName);
      renderDocCard(cardId, docType, uuid, [{ name: file.name, webViewLink: json.webViewLink }]);
    } else {
      throw new Error(json.message || 'Upload failed');
    }
  } catch(err) {
    alert('Upload failed: ' + err.message);
    if (label) label.textContent = '⬆ Upload';
  }
  event.target.value = '';
};

// ══════════════════════════════════════════════════
//  POLICY HUB
// ══════════════════════════════════════════════════
const POLICY_FOLDER_ID = '177IjB_fPCgq9KnDsQB7GmQuNym3iTzto';

function renderPolicyHub() {
  const el = document.getElementById('mainContent');
  if (!el) return;

  const canUpload = ['md','hr'].includes(STATE.role);

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">📋 Policy Hub</div>
        <div class="page-subtitle">Company policies, guidelines & compliance documents</div>
      </div>
      ${canUpload ? `<button class="csv-btn" onclick="document.getElementById('policy-file-input').click()" style="background:var(--g7);color:#fff">
        ⬆ Upload Policy
        <input type="file" id="policy-file-input" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt"
          style="display:none" onchange="window.handlePolicyFileSelect(event)"/>
      </button>` : ''}
    </div>

    ${canUpload ? `
    <!-- Drop Zone -->
    <div id="policy-drop-zone" class="card" style="border:2px dashed var(--g5);background:rgba(46,125,50,.04);cursor:pointer;transition:all .2s"
      ondragover="event.preventDefault();this.style.background='rgba(46,125,50,.12)';this.style.borderColor='var(--g7)'"
      ondragleave="this.style.background='rgba(46,125,50,.04)';this.style.borderColor='var(--g5)'"
      ondrop="event.preventDefault();this.style.background='rgba(46,125,50,.04)';this.style.borderColor='var(--g5)';window.handlePolicyDrop(event)"
      onclick="document.getElementById('policy-file-input').click()">
      <div class="card-body" style="text-align:center;padding:2rem 1rem">
        <div style="font-size:2.4rem;margin-bottom:.5rem">📂</div>
        <div style="font-weight:700;color:var(--g8);font-size:.95rem;margin-bottom:.3rem">Drop files here to upload to Policy Hub</div>
        <div style="font-size:.78rem;color:var(--txt3)">PDF, Word, PowerPoint, Excel — max 10MB per file</div>
        <div style="margin-top:.75rem;display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap" id="policy-upload-status"></div>
      </div>
    </div>` : ''}

    <!-- Policy Categories -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;margin-top:1.2rem">
      ${[
        {icon:'👥',label:'HR Policies',desc:'Leave, Attendance, Conduct, Grievance'},
        {icon:'🦺',label:'Safety Policies',desc:'HSE, PPE, Emergency Response, Incident'},
        {icon:'💻',label:'IT Policies',desc:'Data Security, Usage, BYOD, Password'},
        {icon:'💰',label:'Finance & Accounts',desc:'Procurement, Travel, Expenses, Audit'},
        {icon:'🏗️',label:'Site Operations',desc:'SOP, Quality, Equipment, Handover'},
        {icon:'📜',label:'Compliance & Legal',desc:'Statutory, ESG, ISO, Certifications'},
      ].map(c=>`
        <div class="card" style="cursor:pointer" onclick="window.policyFilterCat('${c.label}')">
          <div class="card-body" style="display:flex;align-items:center;gap:1rem;padding:.9rem 1rem">
            <div style="font-size:2rem;flex-shrink:0">${c.icon}</div>
            <div>
              <div style="font-weight:700;font-size:.88rem;color:var(--g8)">${c.label}</div>
              <div style="font-size:.75rem;color:var(--txt3);margin-top:.15rem">${c.desc}</div>
            </div>
          </div>
        </div>`).join('')}
    </div>

    <!-- Files List -->
    <div class="card" style="margin-top:1.2rem">
      <div class="card-head">
        <h3>📄 Policy Documents</h3>
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          <input id="policy-search" type="text" placeholder="Search documents…"
            style="padding:.38rem .65rem;border:1.5px solid #cce3d4;border-radius:8px;font-size:.82rem;font-family:inherit;outline:none;background:#fff;min-width:180px"
            oninput="window.policyRenderFiles()"/>
          <select id="policy-cat-filter" onchange="window.policyRenderFiles()"
            style="padding:.38rem .65rem;border:1.5px solid #cce3d4;border-radius:8px;font-size:.82rem;font-family:inherit;outline:none;background:#fff">
            <option value="">All Categories</option>
            <option>HR Policies</option><option>Safety Policies</option>
            <option>IT Policies</option><option>Finance & Accounts</option>
            <option>Site Operations</option><option>Compliance & Legal</option>
          </select>
        </div>
      </div>
      <div id="policy-files-list" style="padding:0">
        <div style="padding:2.5rem;text-align:center;color:var(--txt3);font-size:.85rem">
          <div style="font-size:1.8rem;margin-bottom:.5rem">🔄</div>
          Loading documents from Drive…
        </div>
      </div>
    </div>
  `;

  // Load files from Drive
  window.policyLoadFiles();
}

// ── Upload handler ─────────────────────────────────
window.handlePolicyDrop = function(event) {
  const files = Array.from(event.dataTransfer.files);
  window.uploadPolicyFiles(files);
};
window.handlePolicyFileSelect = function(event) {
  const files = Array.from(event.target.files);
  window.uploadPolicyFiles(files);
  event.target.value = ''; // reset input
};

window.uploadPolicyFiles = async function(files) {
  const statusEl = document.getElementById('policy-upload-status');
  if (!files.length) return;

  // Size guard 10MB
  const tooBig = files.filter(f => f.size > 10 * 1024 * 1024);
  if (tooBig.length) {
    alert(`File(s) too large (max 10MB): ${tooBig.map(f=>f.name).join(', ')}`);
    return;
  }

  for (const file of files) {
    // Show uploading badge
    const badge = document.createElement('span');
    badge.style.cssText = 'padding:.2rem .6rem;background:#fff3e0;color:#e65100;border-radius:20px;font-size:.73rem;font-weight:600';
    badge.textContent = `⏳ ${file.name}`;
    if (statusEl) statusEl.appendChild(badge);

    try {
      const b64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res  = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({
          action:     'uploadPolicyDoc',
          folderId:   POLICY_FOLDER_ID,
          fileName:   file.name,
          mimeType:   file.type || 'application/octet-stream',
          data:       b64,
          uploadedBy: STATE.user?.name || STATE.user?.email || 'Portal User',
        }),
      });
      const json = await res.json();

      if (json.status === 'ok') {
        badge.style.background = '#e8f5e9'; badge.style.color = '#2e7d32';
        badge.textContent = `✅ ${file.name}`;
        // Refresh file list
        setTimeout(() => window.policyLoadFiles(), 1000);
      } else {
        throw new Error(json.message || 'Upload failed');
      }
    } catch(err) {
      badge.style.background = '#fdecea'; badge.style.color = '#c62828';
      badge.textContent = `❌ ${file.name}: ${err.message}`;
      console.error('Policy upload error:', err);
    }

    // Fade out badge after 5s
    setTimeout(() => { if (badge.parentNode) badge.remove(); }, 5000);
  }
};

// ── Load files from Drive folder via Apps Script ──
window._policyFiles = [];
window.policyLoadFiles = async function() {
  const listEl = document.getElementById('policy-files-list');
  try {
    const url = `${APPS_SCRIPT_URL}?action=listPolicyDocs&folderId=${POLICY_FOLDER_ID}`;
    const res  = await fetch(url);
    const json = await res.json();
    window._policyFiles = json.files || [];
    window.policyRenderFiles();
  } catch(err) {
    if (listEl) listEl.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--txt3)">
      Unable to load documents. <a href="https://drive.google.com/drive/folders/${POLICY_FOLDER_ID}" target="_blank" style="color:var(--g7)">Open Drive folder ↗</a>
    </div>`;
  }
};

window.policyFilterCat = function(cat) {
  const sel = document.getElementById('policy-cat-filter');
  if (sel) { sel.value = cat; window.policyRenderFiles(); }
  document.getElementById('policy-files-list')?.scrollIntoView({behavior:'smooth',block:'start'});
};

window.policyRenderFiles = function() {
  const listEl = document.getElementById('policy-files-list');
  if (!listEl) return;
  const q   = (document.getElementById('policy-search')?.value || '').toLowerCase();
  const cat = (document.getElementById('policy-cat-filter')?.value || '').toLowerCase();
  let files = window._policyFiles || [];

  if (q)   files = files.filter(f => f.name.toLowerCase().includes(q));
  if (cat) files = files.filter(f => (f.category||'').toLowerCase().includes(cat));

  if (!files.length) {
    listEl.innerHTML = `<div style="padding:2.5rem;text-align:center;color:var(--txt3);font-size:.84rem">
      No documents found. ${['md','hr'].includes(STATE.role) ? 'Drop files above to upload.' : 'Contact HR to add policies.'}</div>`;
    return;
  }

  const extIcon = name => {
    const ext = name.split('.').pop().toLowerCase();
    return {pdf:'📕',doc:'📘',docx:'📘',ppt:'📙',pptx:'📙',xls:'📗',xlsx:'📗',txt:'📄'}[ext] || '📄';
  };
  const fmtSize = b => b > 1048576 ? (b/1048576).toFixed(1)+'MB' : Math.round(b/1024)+'KB';
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';

  listEl.innerHTML = `<table class="emp-table" style="min-width:560px">
    <thead><tr><th>Document</th><th>Size</th><th>Uploaded</th><th>Action</th></tr></thead>
    <tbody>${files.map(f=>`<tr>
      <td><div style="display:flex;align-items:center;gap:.55rem">
        <span style="font-size:1.3rem">${extIcon(f.name)}</span>
        <div><div style="font-weight:600;font-size:.83rem;color:var(--g8)">${f.name}</div>
          ${f.uploadedBy?`<div style="font-size:.72rem;color:var(--txt3)">by ${f.uploadedBy}</div>`:''}
        </div></div></td>
      <td style="font-size:.79rem;color:var(--txt3)">${f.size?fmtSize(f.size):'—'}</td>
      <td style="font-size:.79rem;color:var(--txt3)">${fmtDate(f.modifiedTime)}</td>
      <td><a href="${f.webViewLink}" target="_blank"
        style="padding:.25rem .65rem;background:#e3f2fd;color:#1565c0;border:1.5px solid #90caf9;border-radius:6px;font-size:.73rem;font-weight:700;text-decoration:none;display:inline-block">
        🔗 Open</a></td>
    </tr>`).join('')}</tbody>
  </table>`;
  makeTableSortable(listEl.querySelector('.emp-table'));
  wrapTableScroll(listEl.querySelector('.emp-table'));
};

function renderPlaceholder(icon, title, desc, phase) {
  const el = document.getElementById('mainContent');
  el.innerHTML = `
    <div class="page-header">
      <h1>${icon} ${title}</h1>
      <p>${desc}</p>
    </div>
    <div class="module-placeholder">
      <div class="mp-icon">${icon}</div>
      <h2>${title}</h2>
      <p>${desc}</p>
      <div class="mp-badge">🔨 ${phase}</div>
      <p style="margin-top:1rem;font-size:.78rem;color:var(--txt4)">This module is in the build queue. All planning is complete — development starts soon.</p>
    </div>
  `;
}

// ══════════════════════════════════════════════════
//  HR DASHBOARD
// ══════════════════════════════════════════════════
function renderHRDashboard() {
  const el = document.getElementById('mainContent');

  if (!STATE.mastersLoaded) {
    el.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--txt3)">⏳ Loading master data… Please wait.</div>`;
    loadAllMasters().then(() => renderHRDashboard());
    return;
  }

  const activeEmps   = getActiveUsers();
  const totalEmps    = STATE.masters.users.length;
  const onPayroll    = activeEmps.filter(e => (e.empType||'').toLowerCase().includes('payroll')).length;
  const onContract   = activeEmps.filter(e => (e.empType||'').toLowerCase().includes('contract')).length;

  // New joiners — DOJ within last 90 days
  const now = Date.now();
  const newJoiners = activeEmps.filter(e => {
    const d = parseGvizDate(e.doj);
    return d > new Date(0) && (now - d.getTime()) < 90*24*60*60*1000;
  }).length;

  // Department breakdown
  const deptTally  = tallyBy(activeEmps, 'dept');
  const deptMax    = deptTally[0]?.[1] || 1;

  // Mess unique data — filter to CURRENT employees only
  const currentEmpCodes = new Set(activeEmps.map(e => e.empCode).filter(Boolean));
  const messUniq = (STATE.masters.messUnique || []).filter(m => currentEmpCodes.has(m.empCode));
  const accomTally = tallyBy(messUniq, 'accommodation');
  const messTally  = tallyBy(messUniq, 'messDetails');
  const accomMax   = accomTally[0]?.[1] || 1;
  const messMax    = messTally[0]?.[1] || 1;

  const ACCOM_COLORS = {
    'SITE ACCOMMODATION':'#2e7d32','INDIVIDUAL ACCOMMODATION':'#1565c0',
    'NA':'#9ab8a5','—':'#ccc'
  };
  const MESS_COLORS = {
    'SITE MESS':'#2e7d32','INDIVIDUAL MESS':'#e65100',
    'NA':'#9ab8a5','—':'#ccc'
  };

  function breakupItem(label, count, max, colorMap) {
    const pct = Math.round((count/max)*100);
    const col = colorMap[label] || '#3cb96d';
    return `<li>
      <span class="bl-label">${label}</span>
      <div class="bl-bar-wrap"><div class="bl-bar" style="width:${pct}%;background:${col}"></div></div>
      <span class="bl-count">${count}</span>
    </li>`;
  }

  function deptItem(label, count) {
    const pct = Math.round((count/deptMax)*100);
    return `<li>
      <span class="bl-label" style="min-width:160px">${label}</span>
      <div class="bl-bar-wrap"><div class="bl-bar" style="width:${pct}%;background:var(--g5)"></div></div>
      <span class="bl-count">${count}</span>
    </li>`;
  }

  // Employee table (top 30 active, searchable)
  const empRows = activeEmps.slice(0,200).map(e => `
    <tr>
      <td class="emp-name">${e.name}</td>
      <td>${e.empCode}</td>
      <td>${e.dept || '—'}</td>
      <td>${e.desig || '—'}</td>
      <td>${e.grade || '—'}</td>
      <td>${e.site || '—'}</td>
      <td><span class="tag" style="background:#e8f5e9;color:#2e7d32;font-size:.7rem">${e.empType || 'Staff'}</span></td>
    </tr>`).join('');

  el.innerHTML = `
    <div class="page-header">
      <h1>👥 HR Command Centre</h1>
      <p>Live workforce data · Employee Register + Mess & Accommodation</p>
    </div>

    <!-- KPI Row -->
    <div class="kpi-grid">
      <div class="kpi-card" style="border-bottom:3px solid var(--g5)">
        <div class="kpi-top"><div class="kpi-icon green">👷</div><div class="kpi-trend up">⬤ Live</div></div>
        <div class="kpi-value">${activeEmps.length}</div>
        <div class="kpi-label">Current Employees</div>
        <div class="kpi-sub">${totalEmps} total records · deduplicated</div>
      </div>
      <div class="kpi-card warn">
        <div class="kpi-top"><div class="kpi-icon orange">💼</div><div class="kpi-trend up">⬤ Live</div></div>
        <div class="kpi-value">${onPayroll}</div>
        <div class="kpi-label">On Payroll</div>
        <div class="kpi-sub">${onContract} on contract · ${activeEmps.length - onPayroll - onContract} other</div>
      </div>
      <div class="kpi-card info">
        <div class="kpi-top"><div class="kpi-icon blue">🏠</div><div class="kpi-trend up">⬤ Live</div></div>
        <div class="kpi-value">${messUniq.length}</div>
        <div class="kpi-label">Mess / Accom Assigned</div>
        <div class="kpi-sub">${accomTally.length} accommodation types</div>
      </div>
      <div class="kpi-card gold">
        <div class="kpi-top"><div class="kpi-icon gold">🌱</div><div class="kpi-trend flat">Last 90 days</div></div>
        <div class="kpi-value">${newJoiners}</div>
        <div class="kpi-label">Recent Joiners</div>
        <div class="kpi-sub">New in last 90 days</div>
      </div>
    </div>

    <!-- Mess & Accommodation Breakup -->
    <div class="breakup-row">
      <div class="card">
        <div class="card-head">
          <h3>🏠 Accommodation Breakup</h3>
          <span class="hr-stat-pill">Unique per employee · latest entry</span>
        </div>
        <div class="card-body">
          <ul class="breakup-list">
            ${accomTally.map(([label,count]) => breakupItem(label,count,accomMax,ACCOM_COLORS)).join('') || '<li><span style="color:var(--txt3)">No data loaded</span></li>'}
          </ul>
          <div style="margin-top:.75rem;font-size:.75rem;color:var(--txt3)">Total records: ${messUniq.length} unique employees</div>
        </div>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>🍽️ Mess Breakup</h3>
          <span class="hr-stat-pill">Unique per employee · latest entry</span>
        </div>
        <div class="card-body">
          <ul class="breakup-list">
            ${messTally.map(([label,count]) => breakupItem(label,count,messMax,MESS_COLORS)).join('') || '<li><span style="color:var(--txt3)">No data loaded</span></li>'}
          </ul>
          <div style="margin-top:.75rem;font-size:.75rem;color:var(--txt3)">Source: 07_Mess_Accomodation · ${STATE.masters.mess.length} raw rows → ${messUniq.length} unique</div>
        </div>
      </div>
    </div>

    <!-- Department Breakdown -->
    <div class="card" style="margin-bottom:1.4rem">
      <div class="card-head">
        <h3>🏢 Department-wise Headcount</h3>
        <span class="hr-stat-pill">${deptTally.length} departments</span>
      </div>
      <div class="card-body">
        <ul class="breakup-list">
          ${deptTally.map(([label,count]) => deptItem(label,count)).join('')}
        </ul>
      </div>
    </div>

    <!-- Employee Directory -->
    <div class="card">
      <div class="card-head">
        <h3>📋 Employee Directory</h3>
        <span class="hr-stat-pill"><strong>${activeEmps.length}</strong> current</span>
      </div>
      <div class="card-body">
        <input class="emp-search" id="empSearchInput" placeholder="🔍  Search by name, code, department, site…" oninput="filterEmpTable(this.value)">
        <div>
          <table class="emp-table" id="empDirectoryTable">
            <thead><tr>
              <th>Name</th><th>EMP Code</th><th>Department</th>
              <th>Designation</th><th>Grade</th><th>Site</th><th>Type</th>
            </tr></thead>
            <tbody id="empTableBody">${empRows}</tbody>
          </table>
        </div>
        <div style="margin-top:.5rem;font-size:.75rem;color:var(--txt3)">
          <span id="empDirCounter">Showing ${Math.min(200,activeEmps.length)} of ${activeEmps.length} current employees</span>
          &nbsp;·&nbsp; Refresh:
          <button class="btn btn-secondary btn-sm" onclick="STATE.mastersLoaded=false;loadAllMasters().then(()=>renderHRDashboard())" style="margin-left:.3rem">↻</button>
        </div>
      </div>
    </div>
  `;

  // Store active employees for search
  window._hrEmpData = activeEmps;
}

window.filterEmpTable = function(q) {
  const rows = window._hrEmpData || [];
  const lq = q.toLowerCase();
  const filtered = q ? rows.filter(e =>
    (e.name||'').toLowerCase().includes(lq) ||
    (e.empCode||'').toLowerCase().includes(lq) ||
    (e.dept||'').toLowerCase().includes(lq) ||
    (e.site||'').toLowerCase().includes(lq) ||
    (e.desig||'').toLowerCase().includes(lq)
  ) : rows.slice(0,200);

  const tbody = document.getElementById('empTableBody');
  if (!tbody) return;
  // Update showing counter
  const counter = document.getElementById('empDirCounter');
  if (counter) counter.textContent = `Showing ${Math.min(200,filtered.length)} of ${filtered.length}${q ? ' matching' : ''}`;
  tbody.innerHTML = filtered.slice(0,200).map(e => `
    <tr>
      <td class="emp-name">${e.name}</td>
      <td>${e.empCode}</td>
      <td>${e.dept || '—'}</td>
      <td>${e.desig || '—'}</td>
      <td>${e.grade || '—'}</td>
      <td>${e.site || '—'}</td>
      <td><span class="tag" style="background:#e8f5e9;color:#2e7d32;font-size:.7rem">${e.empType || 'Staff'}</span></td>
    </tr>`).join('');
};

// ══════════════════════════════════════════════════
//  MY PROFILE
// ══════════════════════════════════════════════════
function renderMyProfile() {
  const el = document.getElementById('mainContent');

  // Vendor/SC users have no employee profile
  if (STATE.role === 'vendor' || STATE.role === 'sc') {
    el.innerHTML = `<div style="text-align:center;padding:4rem 2rem;color:var(--txt3)">
      <div style="font-size:2.5rem;margin-bottom:.75rem">🚫</div>
      <div style="font-weight:700;font-size:1rem;color:var(--txt2)">Access Restricted</div>
      <div style="font-size:.84rem;margin-top:.4rem">My Profile is not available for Vendor / Sub-Contractor accounts.</div>
    </div>`;
    return;
  }

  // Find the logged-in user's employee record (match by email)
  const email = STATE.user?.email || '';
  let emp = STATE.masters.users.find(u =>
    u.email && email && u.email.toLowerCase() === email.toLowerCase()
  );



  // Mess/accommodation for this employee
  const messInfo = emp ? (STATE.masters.messUnique || []).find(m => m.empCode === emp.empCode) : null;

  // Parse DOJ for display
  function fmtGvizDate(val) {
    const d = parseGvizDate(val);
    if (!d || d.getTime() === 0) return '—';
    return d.toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'});
  }

  // Photo: stored in localStorage per empCode
  const photoKey = `evg_photo_${emp?.empCode || ''}`;
  const savedPhoto = localStorage.getItem(photoKey);
  const avatarContent = savedPhoto
    ? `<img src="${savedPhoto}" alt="Profile Photo">`
    : `<span>${(emp?.name||'?').charAt(0)}</span>`;

  const infoCards = emp ? `
    <div class="info-card"><div class="ic-icon">🏢</div><div class="ic-label">Department</div><div class="ic-value">${emp.dept || '—'}</div></div>
    <div class="info-card"><div class="ic-icon">🎯</div><div class="ic-label">Designation</div><div class="ic-value">${emp.desig || '—'}</div></div>
    <div class="info-card"><div class="ic-icon">📊</div><div class="ic-label">Grade</div><div class="ic-value">${emp.grade || '—'}</div></div>
    <div class="info-card"><div class="ic-icon">🏗️</div><div class="ic-label">Current Site</div><div class="ic-value">${emp.site || 'Head Office'}</div></div>
    <div class="info-card"><div class="ic-icon">📅</div><div class="ic-label">Date of Joining</div><div class="ic-value">${fmtGvizDate(emp.doj)}</div></div>
    <div class="info-card"><div class="ic-icon">⭐</div><div class="ic-label">EG Experience</div><div class="ic-value">${emp.expEG || emp.expTotal || '—'} yrs</div></div>
  ` : `<div class="info-card" style="grid-column:1/-1;text-align:center;color:var(--txt3)">Employee record not found for your login email.</div>`;

  const messCard = messInfo ? `
    <div class="card" style="margin-bottom:1.4rem">
      <div class="card-head"><h3>🏠 Mess & Accommodation</h3><span class="hr-stat-pill">⬤ Live from Register</span></div>
      <div class="card-body">
        <div class="info-grid-3">
          <div class="info-card"><div class="ic-label">Accommodation</div><div class="ic-value">${messInfo.accommodation || '—'}</div></div>
          <div class="info-card"><div class="ic-label">Mess Type</div><div class="ic-value">${messInfo.messDetails || '—'}</div></div>
          <div class="info-card"><div class="ic-label">Assigned Site</div><div class="ic-value">${messInfo.site || '—'}</div></div>
          <div class="info-card"><div class="ic-label">Per Day Food Allowance</div><div class="ic-value">${messInfo.perDayFood ? '₹'+messInfo.perDayFood : '—'}</div></div>
          <div class="info-card"><div class="ic-label">Special Site Allowance</div><div class="ic-value">${messInfo.specialAllow || '—'}</div></div>
          <div class="info-card"><div class="ic-label">Effective From</div><div class="ic-value">${fmtGvizDate(messInfo.fromDate)}</div></div>
        </div>
      </div>
    </div>` : '';

  const leaveCard = emp ? `
    <div class="card" style="margin-bottom:1.4rem">
      <div class="card-head"><h3>🌴 Leave Balance</h3></div>
      <div class="card-body">
        <div class="info-grid-3">
          <div class="info-card"><div class="ic-label">PL Eligible?</div><div class="ic-value">${emp.plEligible || '—'}</div></div>
          <div class="info-card"><div class="ic-label">PL Available Today</div><div class="ic-value" style="color:var(--g7)">${emp.plBalance || '—'}</div></div>
          <div class="info-card"><div class="ic-label">Employee Type</div><div class="ic-value">${emp.empType || '—'}</div></div>
        </div>
      </div>
    </div>` : '';

  el.innerHTML = `
    <!-- ══ PROFILE HERO ══════════════════════════════════════ -->
    <div class="profile-hero">
      <div class="profile-hero-banner"></div>
      <div class="profile-hero-body">
        <div class="profile-avatar-wrap">
          <div class="profile-avatar" id="profileAvatarEl">${avatarContent}</div>
          <label class="profile-upload-btn" title="Change photo" style="cursor:pointer">
            📷<input type="file" accept="image/*" style="display:none" onchange="uploadProfilePhoto(event,'${emp?.empCode||''}')">
          </label>
        </div>
        <div class="profile-info" style="flex:1;min-width:0;padding-top:.5rem">
          <h2 style="color:#fff;font-size:1.35rem;margin:0 0 .15rem">${emp?.name || STATE.user?.name || 'Employee'}</h2>
          <div style="color:rgba(255,255,255,.65);font-size:.82rem;margin-bottom:.5rem">${emp?.desig || '—'} &nbsp;·&nbsp; ${emp?.dept || 'Evergreen Enterprises'}</div>
          <div style="display:flex;flex-wrap:wrap;gap:.35rem">
            ${emp?.empCode ? `<span style="font-size:.7rem;padding:.18rem .55rem;background:rgba(255,255,255,.12);color:rgba(255,255,255,.9);border-radius:8px;font-family:monospace">${emp.empCode}</span>` : ''}
            ${emp?.grade   ? `<span style="font-size:.7rem;padding:.18rem .55rem;background:rgba(255,255,255,.12);color:rgba(255,255,255,.9);border-radius:8px">Grade ${emp.grade}</span>` : ''}
            ${emp?.empType ? `<span style="font-size:.7rem;padding:.18rem .55rem;background:rgba(255,255,255,.12);color:rgba(255,255,255,.9);border-radius:8px">${emp.empType}</span>` : ''}
            ${emp?.site    ? `<span style="font-size:.7rem;padding:.18rem .55rem;background:rgba(255,255,255,.12);color:rgba(255,255,255,.9);border-radius:8px">📍 ${emp.site}</span>` : ''}
          </div>
        </div>
        <div style="text-align:right;padding-top:.5rem;flex-shrink:0">
          <div style="color:rgba(255,255,255,.7);font-size:.76rem">${emp?.email || STATE.user?.email || ''}</div>
          <div style="color:rgba(255,255,255,.5);font-size:.72rem;margin-top:.25rem">Joined ${fmtGvizDate(emp?.doj)}</div>
          ${emp?.plBalance ? `<div style="margin-top:.5rem;font-size:.72rem;background:rgba(255,255,255,.12);color:#fff;padding:.2rem .6rem;border-radius:8px;display:inline-block">🌴 ${emp.plBalance} PL days</div>` : ''}
        </div>
      </div>
    </div>

    <!-- ══ QUICK STATS ROW ════════════════════════════════════ -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.75rem;margin-bottom:1.4rem">
      ${[
        ['🏢', 'Department', emp?.dept || '—'],
        ['🎯', 'Designation', emp?.desig || '—'],
        ['📊', 'Grade', emp?.grade || '—'],
        ['⏱️', 'EG Experience', (emp?.expEG || emp?.expTotal || '—') + (emp?.expEG||emp?.expTotal ? ' yrs' : '')],
        ['📅', 'Date of Joining', fmtGvizDate(emp?.doj)],
        ['💼', 'Employee Type', emp?.empType || '—'],
      ].map(([icon,label,val]) => `
        <div style="background:var(--surface1);border:1px solid var(--border);border-radius:10px;padding:.8rem 1rem">
          <div style="font-size:.68rem;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.3rem">${icon} ${label}</div>
          <div style="font-size:.88rem;font-weight:600;color:var(--txt)">${val}</div>
        </div>`).join('')}
    </div>

    <!-- ══ TWO-COLUMN LAYOUT ══════════════════════════════════ -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.2rem;margin-bottom:1.4rem">

      <!-- Leave Balance -->
      ${emp ? `
      <div class="card">
        <div class="card-head"><h3>🌴 Leave Balance</h3></div>
        <div class="card-body">
          <div style="display:flex;flex-direction:column;gap:.7rem">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:.6rem .8rem;background:var(--surface2);border-radius:8px">
              <span style="font-size:.82rem;color:var(--txt2)">PL Eligible?</span>
              <span style="font-weight:700;font-size:.85rem">${emp.plEligible || '—'}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:.6rem .8rem;background:#e8f5e9;border-radius:8px">
              <span style="font-size:.82rem;color:#2e7d32">PL Available Today</span>
              <span style="font-weight:700;font-size:1.1rem;color:#2e7d32">${emp.plBalance || '—'}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:.6rem .8rem;background:var(--surface2);border-radius:8px">
              <span style="font-size:.82rem;color:var(--txt2)">Payroll</span>
              <span style="font-weight:600;font-size:.85rem">${emp.payroll || '—'}</span>
            </div>
          </div>
        </div>
      </div>` : '<div></div>'}

      <!-- Pay Slips -->
      <div class="card">
        <div class="card-head">
          <h3>💰 Pay Slips</h3>
          <span class="tag" style="background:#fff3e0;color:#e65100;font-size:.68rem">Phase 3</span>
        </div>
        <div class="card-body">
          ${['Mar 2026','Feb 2026','Jan 2026'].map(m => `
            <div class="payslip-row">
              <div style="font-size:.82rem;font-weight:600">${m}</div>
              <button class="btn btn-secondary btn-sm" style="opacity:.45" disabled>⬇ PDF</button>
            </div>`).join('')}
          <div style="font-size:.72rem;color:var(--txt3);margin-top:.5rem">Live in Phase 3 · Payroll integration pending</div>
        </div>
      </div>
    </div>

    <!-- ══ MESS & ACCOMMODATION ═══════════════════════════════ -->
    ${messCard}

    <!-- ══ MY DOCUMENTS ═══════════════════════════════════════ -->
    <div class="card" id="profile-docs-card" style="margin-bottom:1.4rem">
      <div class="card-head">
        <h3>📂 My Documents</h3>
        <div style="display:flex;align-items:center;gap:.6rem">
          <span class="hr-stat-pill" id="profile-docs-badge" style="display:none"></span>
          <button onclick="navigate('my-documents')" class="btn btn-secondary btn-sm">Full Page ↗</button>
        </div>
      </div>
      <div class="card-body">
        <div id="profile-docs-status" style="display:flex;align-items:center;gap:.6rem;font-size:.8rem;color:var(--txt3);padding:.2rem 0 .6rem">
          <div style="width:13px;height:13px;border:2px solid var(--border);border-top-color:var(--g5);border-radius:50%;animation:spin 1s linear infinite;flex-shrink:0"></div>
          Looking up your employee record…
        </div>
        <div id="profile-docs-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.6rem"></div>
      </div>
    </div>

    <!-- ══ MY TEAM — injected async at bottom ════════════════ -->
    <div id="my-reportees-section"></div>

  `;

  // Inject My Team (needs master data)
  setTimeout(() => {
    const sec = document.getElementById('my-reportees-section');
    if (!sec) return;
    // If masters haven't loaded yet, retry
    if (!STATE.mastersLoaded || !STATE.masters.users?.length) {
      setTimeout(arguments.callee, 500);
      return;
    }
    if (!emp) {
      sec.innerHTML = '';
      return;
    }
    const myName    = (emp.name || '').toLowerCase().trim();
    const myCode    = (emp.empCode || '').toUpperCase().trim();
    // Primary match: managerCode (EGxxx from Reporting Manager column) === logged-in empCode
    // Secondary: siteICCode (EGxxx from Site In-Charge Name column) === logged-in empCode
    // Fallback: name match
    const reportees = (STATE.masters.users || []).filter(u => {
      if (u.status !== 'ACTIVE') return false;
      const mCode  = (u.managerCode  || '').toUpperCase().trim();
      const sCode  = (u.siteICCode   || '').toUpperCase().trim();
      const mName  = (u.manager      || '').toLowerCase().trim();
      return (myCode && (mCode === myCode || sCode === myCode)) || (myName && mName === myName);
    });
    window._myReportees = reportees; // store for CSV
    window.reporteesDownloadCSV = function() {
      downloadCSV((_myReportees||[]).map(u=>({
        'Emp Code':u.empCode||'','Name':u.name||'','Designation':u.desig||'',
        'Department':u.dept||'','Site':u.site||'','Type':u.empType||'',
      })), 'My_Team_' + new Date().toISOString().slice(0,10) + '.csv');
    };
    if (!reportees.length) {
      sec.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>👥 My Team</h3></div>
        <div class="card-body" style="text-align:center;padding:1.5rem;color:var(--txt3);font-size:.84rem">
          No direct reportees found.<br>
          <span style="font-size:.76rem">Check that your name in the Employee Register matches exactly in others' Reporting Manager field.</span>
        </div>
      </div>`;
      return;
    }
    sec.innerHTML = `
    <div class="card" style="margin-top:1.4rem">
      <div class="card-head">
        <h3>👥 My Team <span style="font-weight:400;color:var(--txt3);font-size:.82rem">(${reportees.length} direct reportee${reportees.length!==1?'s':''})</span></h3>
        <button class="csv-btn" onclick="window.reporteesDownloadCSV()">⬇ CSV</button>
      </div>
      <div class="card-body" style="padding:0;overflow-x:auto">
        <table class="emp-table">
          <thead><tr><th>Name</th><th>Emp Code</th><th>Designation</th><th>Department</th><th>Site</th><th>Type</th></tr></thead>
          <tbody>${reportees.map(u=>`<tr>
            <td style="font-weight:600;font-size:.82rem">${u.name||'—'}</td>
            <td style="font-size:.77rem;color:var(--txt3)">${u.empCode||'—'}</td>
            <td style="font-size:.79rem">${u.desig||'—'}</td>
            <td style="font-size:.79rem">${u.dept||'—'}</td>
            <td style="font-size:.79rem">${u.site||'—'}</td>
            <td style="font-size:.75rem"><span style="padding:.18rem .45rem;background:#e8f5e9;color:#2e7d32;border-radius:10px">${u.empType||'—'}</span></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
    makeTableSortable(sec.querySelector('.emp-table')); wrapTableScroll(sec.querySelector('.emp-table'));
  }, 300);

  // ── Load Documents into Profile (reuse My Documents logic) ──────
  loadProfileDocs();
}

async function loadProfileDocs() {
  const grid     = document.getElementById('profile-docs-grid');
  const statusEl = document.getElementById('profile-docs-status');
  const badgeEl  = document.getElementById('profile-docs-badge');
  if (!grid) return;

  const showStatus = (msg, isError) => {
    if (!statusEl) return;
    statusEl.style.display = '';
    statusEl.innerHTML = `<span style="color:${isError?'#c62828':'var(--txt3)'};">${msg}</span>`;
  };

  showStatus('⏳ Looking up your employee record…');

  // ── Step 1: UUID lookup ──────────────────────────────────────
  let uuid = null;
  try {
    uuid = await fetchMyUUID();
  } catch(e) {
    showStatus('⚠️ UUID lookup failed: ' + e.message, true);
    return;
  }

  if (!uuid) {
    // Fallback: try matching by empCode from masters
    const myEmail = (STATE.user?.email || '').toLowerCase();
    const emp = (STATE.masters?.users||[]).find(u => (u.email||'').toLowerCase() === myEmail);
    showStatus(
      `⚠️ No UUID found for <b>${myEmail}</b>. ` +
      (emp ? `Employee record found (${emp.empCode}) but UUID tab (0A_EmployeePersonalDetails) may be missing this email.` :
             'No employee record found in register for this email.') +
      ' Contact HR to upload documents.',
      true
    );
    grid.innerHTML = '';
    return;
  }

  showStatus(`✓ UUID: ${uuid} — loading documents…`);

  // ── Step 2: Skeleton cards ────────────────────────────────────
  grid.innerHTML = HR_DOCS_TYPES.map(t =>
    `<div class="card" id="pdoc-card-${t.folder.replace(/\s/g,'_')}" style="min-height:80px">
      <div class="card-body" style="display:flex;align-items:center;gap:.7rem;padding:.9rem">
        <span style="font-size:1.6rem">${t.icon}</span>
        <div style="flex:1">
          <div style="font-size:.82rem;font-weight:600;color:var(--g8);margin-bottom:.3rem">${t.label}</div>
          <div style="width:60px;height:8px;background:var(--border);border-radius:4px"></div>
        </div>
      </div>
    </div>`
  ).join('');

  // Fetch all doc types in parallel — same as My Documents page
  let uploadedCount = 0;
  await Promise.all(HR_DOCS_TYPES.map(async (t) => {
    const cardId = `pdoc-card-${t.folder.replace(/\s/g,'_')}`;
    const card   = document.getElementById(cardId);
    if (!card) return;
    try {
      const url  = `${APPS_SCRIPT_URL}?action=listHRDocs&folderId=${HR_DOCS_FOLDER_ID}&subFolder=${encodeURIComponent(t.folder)}&prefix=${encodeURIComponent(uuid)}`;
      const res  = await fetch(url);
      const data = await res.json();
      const files = data.files || [];
      if (files.length) uploadedCount++;

      // Inline card render (compact version for profile)
      const hasFiles = files.length > 0;
      card.innerHTML = `
        <div class="card-body" style="display:flex;align-items:flex-start;gap:.75rem;padding:.85rem">
          <span style="font-size:1.5rem;flex-shrink:0">${t.icon}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:.82rem;font-weight:600;color:var(--g8);margin-bottom:.3rem">${t.label}</div>
            ${hasFiles
              ? files.map(f => `
                <a href="${f.webViewLink}" target="_blank" rel="noopener"
                  style="display:flex;align-items:center;gap:.35rem;font-size:.74rem;color:var(--g7);font-weight:600;text-decoration:none;padding:.25rem 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                  👁 ${f.name.length > 26 ? f.name.slice(0,24)+'…' : f.name}
                </a>`).join('')
              : `<div style="font-size:.73rem;color:var(--txt3);margin-bottom:.4rem">Not uploaded</div>
                 <label style="display:inline-flex;align-items:center;gap:.3rem;font-size:.72rem;font-weight:700;color:var(--g7);cursor:pointer;padding:.25rem .6rem;background:#e8f5e9;border:1px solid #a5d6a7;border-radius:6px">
                   ⬆ Upload
                   <input type="file" accept="${t.accept}" style="display:none"
                     onchange="window.uploadHRDoc(event,'${t.folder}','${uuid}','${cardId}')"/>
                 </label>`
            }
          </div>
          ${hasFiles ? `<a href="${files[0].webViewLink}" target="_blank" style="color:var(--g7);font-size:.8rem;flex-shrink:0;opacity:.7" title="View">↗</a>` : ''}
        </div>`;
    } catch(e) {
      if (card) card.innerHTML = `<div class="card-body" style="padding:.85rem;font-size:.74rem;color:#c62828">${t.icon} ${t.label}<br><span style="font-size:.68rem">${e.message||"fetch failed"}</span></div>`;
    }
  }));

  // Hide UUID status once done
  if (statusEl) statusEl.style.display = 'none';

  // Update badge
  if (badgeEl) {
    badgeEl.style.display = 'inline';
    badgeEl.textContent = uploadedCount + ' / ' + HR_DOCS_TYPES.length + ' uploaded';
    badgeEl.style.background = uploadedCount === HR_DOCS_TYPES.length ? '#e8f5e9' : '#fff8e1';
    badgeEl.style.color = uploadedCount === HR_DOCS_TYPES.length ? '#2e7d32' : '#92400e';
  }
}

window.uploadProfilePhoto = function(event, empCode) {
  const file = event.target.files[0];
  if (!file) return;
  // Size guard — warn if > 500KB
  if (file.size > 500 * 1024) {
    alert('Photo is too large (' + Math.round(file.size/1024) + 'KB). Please use an image under 500KB.');
    return;
  }
  const reader = new FileReader();
  reader.onload = async (e) => {
    const b64 = e.target.result; // data:image/jpeg;base64,...
    // 1. Update UI immediately
    const avatarEl = document.getElementById('profileAvatarEl');
    if (avatarEl) avatarEl.innerHTML = `<img src="${b64}" alt="Profile Photo" style="width:100%;height:100%;object-fit:cover">`;
    // 2. Save to localStorage (instant fallback)
    try { localStorage.setItem('evg_photo_' + empCode, b64); } catch(err) {}
    // 3. Save to Apps Script / Drive in background
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({
          action:   'savePhoto',
          empCode:  empCode,
          photo:    b64.split(',')[1],
          mimeType: file.type,
        }),
      });
      const json = await res.json();
      if (json.status === 'ok') {
        console.log('✅ Photo saved to Drive:', json.fileId);
        // Store Drive URL for cross-device access
        try { localStorage.setItem('evg_photo_url_' + empCode, json.webViewLink || ''); } catch(e) {}
      }
    } catch(err) {
      console.warn('Drive save failed (localStorage used as fallback):', err.message);
    }
  };
  reader.readAsDataURL(file);
};

// Load photo: try localStorage first, then Apps Script
async function loadProfilePhoto(empCode) {
  const local = localStorage.getItem('evg_photo_' + empCode);
  if (local) return local;
  // Try Apps Script
  try {
    const url = `${APPS_SCRIPT_URL}?action=getPhoto&empCode=${encodeURIComponent(empCode)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.status === 'ok' && json.photo) {
      const b64 = 'data:image/jpeg;base64,' + json.photo;
      try { localStorage.setItem('evg_photo_' + empCode, b64); } catch(e) {}
      return b64;
    }
  } catch(err) { /* Apps Script not configured yet */ }
  return null;
}

// ══════════════════════════════════════════════════
//  EXTERNAL PORTAL (Vendor / Sub-Contractor)
// ══════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
//  PHASE 3 — SITE MANAGER DASHBOARD
// ══════════════════════════════════════════════════════════
let _smSelectedSite = null;
let _smEmpSort = { col:'name', dir:1 };

function renderSiteManager() {
  const el = document.getElementById('mainContent');
  const sites   = STATE.masters.sites || [];
  const active  = sites.filter(s => s.status === 'ACTIVE');
  const all     = STATE.masters.users || [];
  const assets  = STATE.masters.assets || [];

  // Pre-select: if site role, pick their site; else first active
  if (!_smSelectedSite) {
    const myEmp = all.find(u => u.email === STATE.user?.email);
    _smSelectedSite = (myEmp?.site && active.find(s => s.name === myEmp.site))
      ? myEmp.site : (active[0]?.name || '');
  }

  const sel    = active.find(s => s.name === _smSelectedSite) || active[0] || {};
  const siteName = sel.name || '';

  // Per-site employee & asset slices
  const siteEmps   = all.filter(u => u.status === 'ACTIVE' && u.site === siteName);
  const siteAssets = assets.filter(a => a.site === siteName);

  // Dept breakdown
  const deptMap = {};
  siteEmps.forEach(u => { const d = u.dept||'Other'; deptMap[d] = (deptMap[d]||0)+1; });
  const topDepts = Object.entries(deptMap).sort((a,b)=>b[1]-a[1]).slice(0,6);

  // Asset category breakdown
  const catMap = {};
  siteAssets.forEach(a => { const c = a.category||'Other'; catMap[c] = (catMap[c]||0)+1; });
  const topCats = Object.entries(catMap).sort((a,b)=>b[1]-a[1]).slice(0,5);

  // All-sites summary table
  const siteRows = active.map(s => {
    const empCnt   = all.filter(u => u.status==='ACTIVE' && u.site===s.name).length;
    const assetCnt = assets.filter(a => a.site===s.name).length;
    return { ...s, empCnt, assetCnt };
  }).sort((a,b) => b.empCnt - a.empCnt);

  const siteOptions = active.map(s =>
    `<option value="${s.name}" ${s.name===siteName?'selected':''}>${s.name}</option>`).join('');

  el.innerHTML = `
    <!-- PROMINENT SITE SELECTOR -->
    <div style="background:linear-gradient(135deg,var(--g9),var(--g7));border-radius:14px;padding:1.2rem 1.5rem;margin-bottom:1.2rem;color:#fff">
      <div style="font-size:.72rem;opacity:.7;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.4rem">Site Manager Dashboard</div>
      <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
        <div style="font-size:1.25rem;font-weight:700;flex:1">${siteName || 'Select a Site'}</div>
        <select id="sm-site-sel" onchange="window.smSelectSite(this.value)"
          style="padding:.55rem 1rem;border:none;border-radius:9px;font-family:inherit;font-size:.9rem;font-weight:700;background:rgba(255,255,255,.2);color:#fff;cursor:pointer;min-width:200px;max-width:300px;outline:none;appearance:auto">
          ${siteOptions}
        </select>
      </div>
      <div style="display:flex;gap:1.5rem;margin-top:.75rem;font-size:.78rem;opacity:.8;flex-wrap:wrap">
        <span>🏙️ ${sel.city||'—'}</span>
        <span>📍 ${sel.state||'—'}</span>
        <span>👤 ${sel.incharge||'—'}</span>
        <span>📞 ${sel.contact||'—'}</span>
      </div>
    </div>

    <!-- SITE KPI CARDS — site-specific only -->
    <div class="kpi-grid" style="margin-bottom:1.2rem">
      <div class="kpi-card">
        <div class="kpi-top"><div class="kpi-icon green">👷</div></div>
        <div class="kpi-value">${siteEmps.length}</div>
        <div class="kpi-label">Active Staff</div>
        <div class="kpi-sub">At this site</div>
      </div>
      <div class="kpi-card info">
        <div class="kpi-top"><div class="kpi-icon blue">🚜</div></div>
        <div class="kpi-value">${siteAssets.length}</div>
        <div class="kpi-label">Equipment Units</div>
        <div class="kpi-sub">Deployed here</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><div class="kpi-icon green">🏗️</div></div>
        <div class="kpi-value">${topDepts.length}</div>
        <div class="kpi-label">Departments</div>
        <div class="kpi-sub">Active at site</div>
      </div>
      <div class="kpi-card warn">
        <div class="kpi-top"><div class="kpi-icon orange">⚙️</div></div>
        <div class="kpi-value">${siteAssets.filter(a=>(a.status||'').toUpperCase()==='ACTIVE').length}</div>
        <div class="kpi-label">Active Equipment</div>
        <div class="kpi-sub">Operational units</div>
      </div>
    </div>

    <div class="dash-grid" style="margin-bottom:1.2rem">
      <!-- Site Info -->
      <div class="card">
        <div class="card-head"><h3>📍 Site Details</h3><span class="hr-stat-pill">⬤ Live</span></div>
        <div class="card-body">
          <div class="info-grid-3">
            <div class="info-card"><div class="ic-label">Site ID</div><div class="ic-value">${sel.siteId||'—'}</div></div>
            <div class="info-card"><div class="ic-label">City</div><div class="ic-value">${sel.city||'—'}</div></div>
            <div class="info-card"><div class="ic-label">State</div><div class="ic-value">${sel.state||'—'}</div></div>
            <div class="info-card"><div class="ic-label">Site In-Charge</div><div class="ic-value">${sel.incharge||'—'}</div></div>
            <div class="info-card"><div class="ic-label">Reporting Manager</div><div class="ic-value">${sel.manager||'—'}</div></div>
            <div class="info-card"><div class="ic-label">Contact</div><div class="ic-value">${sel.contact||'—'}</div></div>
            <div class="info-card" style="grid-column:1/-1"><div class="ic-label">Address</div><div class="ic-value" style="font-size:.82rem">${sel.address||'—'}</div></div>
          </div>
        </div>
      </div>
      <!-- Dept Breakdown -->
      <div class="card">
        <div class="card-head"><h3>👷 Workforce by Department</h3></div>
        <div class="card-body">
          ${topDepts.length === 0
            ? '<div style="padding:1.5rem;text-align:center;color:var(--txt3)">No employees mapped to this site.</div>'
            : topDepts.map(([d,n]) => {
                const pct = siteEmps.length ? Math.round(n/siteEmps.length*100) : 0;
                return '<div style="margin-bottom:.65rem"><div style="display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:.25rem"><span style="font-weight:600;color:var(--g9)">'+d+'</span><span style="color:var(--txt3)">'+n+' ('+pct+'%)</span></div><div style="background:var(--surface2);border-radius:20px;height:7px;overflow:hidden"><div style="width:'+pct+'%;height:100%;background:var(--g6);border-radius:20px"></div></div></div>';
              }).join('')}
        </div>
      </div>
    </div>

    <!-- Staff List -->
    <div class="card" style="margin-bottom:1.2rem">
      <div class="card-head">
        <h3>👷 Staff at Site <span style="font-weight:400;color:var(--txt3);font-size:.82rem">(${siteEmps.length})</span></h3>
        <input id="sm-emp-search" type="text" placeholder="Search name / dept…" oninput="window.smFilterEmps()"
          style="padding:.3rem .7rem;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:.78rem;width:180px">
      </div>
      <div class="card-body" style="padding:0;overflow-x:auto" id="sm-emp-table">
        ${renderSMEmpTable(siteEmps)}
      </div>
    </div>

    <!-- Equipment List -->
    <div class="card" style="margin-bottom:1.2rem">
      <div class="card-head">
        <h3>🚜 Equipment at Site <span style="font-weight:400;color:var(--txt3);font-size:.82rem">(${siteAssets.length})</span></h3>
        <input id="sm-eq-search" type="text" placeholder="Search asset…" oninput="window.smFilterEquipment()"
          style="padding:.3rem .7rem;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:.78rem;width:180px">
      </div>
      <div class="card-body" style="padding:0;overflow-x:auto" id="sm-eq-table">
        ${renderSMEquipTable(siteAssets)}
      </div>
    </div>

    <!-- Equipment Category Breakdown -->
    ${topCats.length > 0 ? '<div class="card" style="margin-bottom:1.2rem"><div class="card-head"><h3>⚙️ Equipment by Category</h3></div><div class="card-body">'+topCats.map(([c,n])=>{const pct=siteAssets.length?Math.round(n/siteAssets.length*100):0;return '<div style="margin-bottom:.6rem"><div style="display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:.2rem"><span style="font-weight:600;color:var(--g9)">'+c+'</span><span style="color:var(--txt3)">'+n+' units</span></div><div style="background:var(--surface2);border-radius:20px;height:6px;overflow:hidden"><div style="width:'+pct+'%;height:100%;background:#1565c0;border-radius:20px"></div></div></div>';}).join('')+'</div></div>' : ''}

    <!-- ═══ SITE OPERATIONS SECTIONS ═══ -->
    <div style="border-top:2px solid #e0ece4;margin:1.4rem 0 1rem;display:flex;align-items:center;gap:.7rem">
      <span style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--txt3);background:#f0f4f1;padding:.3rem .8rem;border-radius:20px">Site Operations</span>
    </div>

    <!-- Operations Tab Bar -->
    <div style="display:flex;gap:.35rem;flex-wrap:wrap;margin-bottom:1rem;border-bottom:2px solid #e0ece4;padding-bottom:0" id="sm-ops-tabs">
      <button class="sm-ops-tab active" data-tab="mrs" onclick="window.smOpsTab('mrs')">📋 MRS</button>
      <button class="sm-ops-tab" data-tab="po" onclick="window.smOpsTab('po')">📦 POs</button>
      <button class="sm-ops-tab" data-tab="stock" onclick="window.smOpsTab('stock')">🏪 Stock</button>
      <button class="sm-ops-tab" data-tab="grn" onclick="window.smOpsTab('grn')">📥 GRN / Stock IN</button>
      <button class="sm-ops-tab" data-tab="dpr" onclick="window.smOpsTab('dpr')">📓 DPR</button>
      <button class="sm-ops-tab" data-tab="logsheet" onclick="window.smOpsTab('logsheet')">🗒️ Log Sheet</button>
      <button class="sm-ops-tab" data-tab="maintenance" onclick="window.smOpsTab('maintenance')">🔧 Periodic Maintenance</button>
    </div>
    <div id="sm-ops-content" style="min-height:200px">
      <div style="text-align:center;padding:2rem;color:var(--txt3)">⏳ Loading site data…</div>
    </div>
  `;

  window.smSelectSite = function(name) {
    _smSelectedSite = name;
    renderSiteManager();
  };
  window.smFilterEmps = function() {
    const q = (document.getElementById('sm-emp-search')?.value||'').toLowerCase();
    const filtered = siteEmps.filter(u =>
      (u.name+u.dept+u.desig).toLowerCase().includes(q));
    const t = document.getElementById('sm-emp-table');
    if (t) t.innerHTML = renderSMEmpTable(filtered);
  };
  window.smFilterEquipment = function() {
    const q = (document.getElementById('sm-eq-search')?.value||'').toLowerCase();
    const filtered = siteAssets.filter(a =>
      (a.name+a.category+a.code).toLowerCase().includes(q));
    const t = document.getElementById('sm-eq-table');
    if (t) t.innerHTML = renderSMEquipTable(filtered);
  };

  // ── OPS TAB STYLES ──────────────────────────────────────
  if (!document.getElementById('sm-ops-style')) {
    const s = document.createElement('style'); s.id = 'sm-ops-style';
    s.textContent = `.sm-ops-tab{padding:.42rem .9rem;border:none;background:none;font-family:inherit;font-size:.8rem;font-weight:600;color:var(--txt3);cursor:pointer;border-bottom:2.5px solid transparent;margin-bottom:-2px;transition:color .15s}.sm-ops-tab.active{color:var(--green);border-bottom-color:var(--green)}.sm-ops-tab:hover{color:var(--green)}`;
    document.head.appendChild(s);
  }

  // ── ACTIVE OPS TAB STATE ─────────────────────────────────
  let _smOpsTab = 'mrs';
  let _smOpsData = { mrs:null, po:null, stock:null, grn:null };

  window.smOpsTab = function(tab) {
    _smOpsTab = tab;
    document.querySelectorAll('.sm-ops-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    smRenderOpsContent();
  };

  function smRenderOpsContent() {
    const el = document.getElementById('sm-ops-content');
    if (!el) return;

    if (_smOpsTab === 'dpr') {
      el.innerHTML = `<div class="card"><div class="card-head"><h3>📓 Daily Progress Report (DPR)</h3></div><div class="card-body" style="text-align:center;padding:2.5rem;color:var(--txt3)"><div style="font-size:2rem;margin-bottom:.5rem">📓</div><div style="font-weight:600">DPR module coming in a future phase</div><div style="font-size:.82rem;margin-top:.35rem">Data source not yet connected — planned for Phase 5+</div></div></div>`;
      return;
    }
    if (_smOpsTab === 'logsheet') {
      el.innerHTML = `<div class="card"><div class="card-head"><h3>🗒️ Log Sheet</h3></div><div class="card-body" style="text-align:center;padding:2.5rem;color:var(--txt3)"><div style="font-size:2rem;margin-bottom:.5rem">🗒️</div><div style="font-weight:600">Log Sheet module coming in a future phase</div><div style="font-size:.82rem;margin-top:.35rem">Data source not yet connected — planned for Phase 5+</div></div></div>`;
      return;
    }
    if (_smOpsTab === 'maintenance') {
      el.innerHTML = `<div class="card"><div class="card-head"><h3>🔧 Periodic Maintenance</h3></div><div class="card-body" style="text-align:center;padding:2.5rem;color:var(--txt3)"><div style="font-size:2rem;margin-bottom:.5rem">🔧</div><div style="font-weight:600">Periodic Maintenance module coming in a future phase</div><div style="font-size:.82rem;margin-top:.35rem">Data source not yet connected — planned for Phase 5+</div></div></div>`;
      return;
    }

    // Live data tabs — load if not cached
    if (_smOpsTab === 'mrs') {
      if (_smOpsData.mrs) { smRenderMRS(el); return; }
      el.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--txt3)">⏳ Loading MRS for ${siteName}…</div>`;
      fetchSheet('MRS', 'SELECT D,E,F,G,I,J,K,L,N,O,P,U,Y', PO_SHEET_ID).then(rows => {
        const seen = new Set();
        _smOpsData.mrs = rows.filter(r => {
          const rn = (r['Request No']||'').trim();
          if (!rn || rn.toLowerCase()==='dummy' || seen.has(rn)) return false;
          seen.add(rn);
          return (r['Requested For']||r['F']||'').trim() === siteName;
        }).map(r => ({
          reqNo: r['Request No']||'', site: r['Requested For']||r['F']||'',
          requestedBy: r['Requested By']||r['E']||'', partDesc: r['Part Description']||r['I']||'',
          partDetails: r['Part Details']||r['G']||'', type: r['Type']||r['J']||'',
          status: r['MR Approval Status']||r['N']||'', approver: r['Approver Name']||r['O']||'',
          approveD: r['MR Approval Date']||r['P']||'', ts: r['Timestamp']||r['Y']||'',
        }));
        smRenderMRS(el);
      }).catch(()=>{ _smOpsData.mrs=[]; smRenderMRS(el); });
      return;
    }

    if (_smOpsTab === 'po') {
      if (_smOpsData.po) { smRenderPO(el); return; }
      el.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--txt3)">⏳ Loading POs for ${siteName}…</div>`;
      fetchSheet(PO_TAB, 'SELECT A,E,F,G,J,R,S,AF,AG,AP,AQ', PO_SHEET_ID).then(rows => {
        _smOpsData.po = rows.filter(r => {
          const s = (r['Site Name']||r['S']||'').trim();
          const p = (r['PO No']||r['E']||'').trim();
          return p && p.toLowerCase()!=='dummy' && s === siteName;
        }).map(r => ({
          uuid: r['UUID']||r['A']||'', poNo: r['PO No']||r['E']||'',
          poDate: r['PO Date']||r['F']||'', vendor: r['Vendor Name']||r['R']||'',
          site: r['Site Name']||r['S']||'', prepBy: r['Prepared By']||r['G']||'',
          approver: r['Approver Name']||r['AF']||'', status: r['PO Approval Status']||r['AG']||'',
          amount: parseFloat((r['Net Amount']||r['AP']||'0').toString().replace(/,/g,''))||0,
          lock: r['Lock']||r['AQ']||'',
        }));
        smRenderPO(el);
      }).catch(()=>{ _smOpsData.po=[]; smRenderPO(el); });
      return;
    }

    if (_smOpsTab === 'stock' || _smOpsTab === 'grn') {
      if (_smOpsData.stock) { _smOpsTab==='stock'?smRenderStock(el):smRenderGRN(el); return; }
      el.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--txt3)">⏳ Loading stock data for ${siteName}…</div>`;
      Promise.all([
        fetchSheet('StockIN', 'SELECT A,B,C,D,E,F,G,H,K,N,O,P,Q,U,V', STORES_SHEET_ID),
        fetchSheet('GRN_No',  'SELECT A,B,C,F,G,H,J,M', STORES_SHEET_ID),
        fetchSheet('v3StockLevels', 'SELECT A,B,C,D,E,F,G,H', STORES_SHEET_ID),
      ]).then(([siRows, grnRows, lvlRows]) => {
        // GRN lookup
        const grnMap = {};
        grnRows.forEach(r => { const u=(r['UUID']||'').trim(); if(u) grnMap[u]={grnNo:r['GRN No (Goods Receipt)']||r['GRN No']||'', receivedOn:r['Received On (At)']||'', poNo:r['PO No']||'', vendor:r['Vendor Details']||''}; });

        _smOpsData.stock = {
          stockIn: siRows.filter(r => (r['Site Name']||r['D']||'').trim()===siteName)
            .map(r => { const cs=(r['CheckSum']||r['UUID']||'').trim(); const g=grnMap[cs]||{}; return {...r, _grnNo:g.grnNo||'', _receivedOn:g.receivedOn||r['Received On (At)']||''}; }),
          levels: lvlRows.filter(r => (r['Site Name']||'').trim()===siteName),
          grnMap,
        };
        _smOpsTab==='stock' ? smRenderStock(el) : smRenderGRN(el);
      }).catch(()=>{ _smOpsData.stock={stockIn:[],levels:[],grnMap:{}}; smRenderStock(el); });
      return;
    }
  }

  function smRenderMRS(el) {
    const rows = _smOpsData.mrs || [];
    const today = new Date(); today.setHours(0,0,0,0);
    const pending  = rows.filter(r=>!r.status||r.status==='Pending'||r.status==='').length;
    const approved = rows.filter(r=>r.status==='Approved').length;
    const rejected = rows.filter(r=>r.status==='Rejected').length;

    el.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:1rem">
      ${smMiniKpi('📋',rows.length,'Total MRS','')}
      ${smMiniKpi('⏳',pending,'Pending','#fff8e1','#b07000')}
      ${smMiniKpi('✅',approved,'Approved','#e8f5e9','#2e7d32')}
      ${smMiniKpi('❌',rejected,'Rejected','#ffebee','#c62828')}
    </div>
    <div class="card">
      <div class="card-head"><h3>📋 MRS at ${siteName}</h3><span class="hr-stat-pill">${rows.length} requests</span></div>
      <div class="card-body" style="padding:0;overflow-x:auto">
        ${rows.length===0 ? '<div style="padding:2rem;text-align:center;color:var(--txt3)">No MRS found for this site.</div>' :
        `<table class="emp-table">
          <thead><tr><th>Request No</th><th>Requested By</th><th>Part Description</th><th>Type</th><th>Status</th><th>Approver</th><th>Date</th></tr></thead>
          <tbody>${rows.map(r=>{
            const st=r.status||'Pending';
            const stBg=st==='Approved'?'#e8f5e9':st==='Rejected'?'#ffebee':st==='Dropped'?'#f3e5f5':'#fff8e1';
            const stCl=st==='Approved'?'#2e7d32':st==='Rejected'?'#c62828':st==='Dropped'?'#6a1b9a':'#b07000';
            const desc=r.partDesc||r.partDetails||'—';
            return `<tr>
              <td style="font-weight:700;font-size:.8rem;color:var(--g7)">${r.reqNo}</td>
              <td style="font-size:.78rem">${r.requestedBy||'—'}</td>
              <td style="font-size:.78rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${desc}">${desc}</td>
              <td style="font-size:.74rem">${r.type?`<span style="background:#e3f2fd;color:#1565c0;padding:.1rem .38rem;border-radius:4px">${r.type}</span>`:'—'}</td>
              <td><span style="background:${stBg};color:${stCl};padding:.15rem .45rem;border-radius:12px;font-size:.71rem;font-weight:700">${st}</span></td>
              <td style="font-size:.77rem;color:var(--txt3)">${r.approver||'—'}</td>
              <td style="font-size:.77rem;color:var(--txt3)">${r.ts?fmtDate(r.ts):'—'}</td>
            </tr>`;}).join('')}
          </tbody>
        </table>`}
      </div>
    </div>`;
    makeTableSortable(el.querySelector('.emp-table')); wrapTableScroll(el.querySelector('.emp-table'));
  }

  function smRenderPO(el) {
    const rows = (_smOpsData.po||[]).sort((a,b)=>b.amount-a.amount);
    const totalAmt = rows.reduce((s,r)=>s+r.amount,0);
    const pending  = rows.filter(r=>r.status.toUpperCase()!=='REJECTED'&&r.lock==='Released for Approval').length;
    const approved = rows.filter(r=>r.status.toUpperCase().includes('APPROVED')).length;

    el.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:1rem">
      ${smMiniKpi('📦',rows.length,'Total POs','')}
      ${smMiniKpi('⏳',pending,'Pending','#fff8e1','#b07000')}
      ${smMiniKpi('✅',approved,'Approved','#e8f5e9','#2e7d32')}
      ${smMiniKpi('💰',fmtAmt(totalAmt),'Total Value','#e3f2fd','#1565c0')}
    </div>
    <div class="card">
      <div class="card-head"><h3>📦 POs for ${siteName}</h3><span class="hr-stat-pill">${rows.length} POs</span></div>
      <div class="card-body" style="padding:0;overflow-x:auto">
        ${rows.length===0 ? '<div style="padding:2rem;text-align:center;color:var(--txt3)">No POs found for this site.</div>' :
        `<table class="emp-table">
          <thead><tr><th>PO No</th><th>Date</th><th>Vendor</th><th>Amount</th><th>Status</th><th>Approver</th></tr></thead>
          <tbody>${rows.map(r=>{
            const st=r.status||'Pending';
            const isPend=r.lock==='Released for Approval'&&st.toUpperCase()!=='REJECTED';
            const stBg=st.toUpperCase().includes('APPROVED')?'#e8f5e9':st.toUpperCase().includes('REJECT')?'#ffebee':isPend?'#fff8e1':'#f0f4f1';
            const stCl=st.toUpperCase().includes('APPROVED')?'#2e7d32':st.toUpperCase().includes('REJECT')?'#c62828':isPend?'#b07000':'var(--txt2)';
            const appLink=`${APPSHEET_SCM_URL}?tblName=PO&rowKey=${encodeURIComponent(r.uuid)}`;
            return `<tr>
              <td><a href="${appLink}" target="_blank" style="font-weight:700;font-size:.8rem;color:var(--g7);text-decoration:none">${r.poNo}</a></td>
              <td style="font-size:.78rem;color:var(--txt3)">${fmtDate(r.poDate)}</td>
              <td style="font-size:.78rem">${r.vendor}</td>
              <td style="font-weight:700;font-size:.82rem">${fmtAmtFull(r.amount)}</td>
              <td><span style="background:${stBg};color:${stCl};padding:.15rem .45rem;border-radius:12px;font-size:.71rem;font-weight:700">${st||'Pending'}</span></td>
              <td style="font-size:.77rem;color:var(--txt3)">${r.approver||'—'}</td>
            </tr>`;}).join('')}
          </tbody>
        </table>`}
      </div>
    </div>`;
    makeTableSortable(el.querySelector('.emp-table')); wrapTableScroll(el.querySelector('.emp-table'));
  }

  function smRenderStock(el) {
    const data = _smOpsData.stock || {stockIn:[],levels:[]};
    const levels = data.levels || [];
    const totalQty = levels.reduce((s,r)=>s+parseFloat(r['Site Stock']||0),0);

    el.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:1rem">
      ${smMiniKpi('📊',levels.length,'Item Lines','')}
      ${smMiniKpi('📦',Math.round(totalQty),'Total Stock Qty','#e8f5e9','#2e7d32')}
      ${smMiniKpi('⬇',data.stockIn.length,'Stock IN Entries','')}
      ${smMiniKpi('0️⃣',levels.filter(r=>parseFloat(r['Site Stock']||0)<=0).length,'Zero Stock','#ffebee','#c62828')}
    </div>
    <div class="card">
      <div class="card-head"><h3>📊 Stock Levels — ${siteName}</h3><span class="hr-stat-pill">${levels.length} items</span></div>
      <div class="card-body" style="padding:0;overflow-x:auto">
        ${levels.length===0 ? '<div style="padding:2rem;text-align:center;color:var(--txt3)">No stock level data for this site.</div>' :
        `<table class="emp-table">
          <thead><tr><th>#</th><th>Part Details</th><th style="text-align:right">Stock IN</th><th style="text-align:right">Transfer</th><th style="text-align:right">Stock Out</th><th style="text-align:right">Site Stock</th></tr></thead>
          <tbody>${levels.map((r,i)=>{
            const qty=parseFloat(r['Site Stock']||0);
            const qc=qty<=0?'#c62828':qty<=2?'#b07000':'#2e7d32';
            return `<tr>
              <td style="font-size:.74rem;color:var(--txt3)">${r['SNo']||i+1}</td>
              <td style="font-size:.8rem">${r['Part Details']||r['Site & Code']||'—'}</td>
              <td style="text-align:right;font-size:.8rem">${r['StockIN']||'0'}</td>
              <td style="text-align:right;font-size:.8rem">${r['Stock Transfer (To)']||'0'}</td>
              <td style="text-align:right;font-size:.8rem">${r['Stock Out']||'0'}</td>
              <td style="text-align:right;font-weight:700;color:${qc}">${qty}</td>
            </tr>`;}).join('')}
          </tbody>
        </table>`}
      </div>
    </div>`;
    makeTableSortable(el.querySelector('.emp-table')); wrapTableScroll(el.querySelector('.emp-table'));
  }

  function smRenderGRN(el) {
    const data = _smOpsData.stock || {stockIn:[]};
    const rows = (data.stockIn||[]).sort((a,b)=>new Date(b._receivedOn||0)-new Date(a._receivedOn||0));

    el.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:1rem">
      ${smMiniKpi('📥',rows.length,'Stock IN Lines','')}
      ${smMiniKpi('📦',new Set(rows.map(r=>r._grnNo).filter(Boolean)).size,'GRN Nos','#e8f5e9','#2e7d32')}
      ${smMiniKpi('⏳',rows.filter(r=>!r._grnNo).length,'Pending GRN','#fff8e1','#b07000')}
    </div>
    <div class="card">
      <div class="card-head"><h3>📥 GRN / Stock IN — ${siteName}</h3><span class="hr-stat-pill">${rows.length} entries</span></div>
      <div class="card-body" style="padding:0;overflow-x:auto">
        ${rows.length===0 ? '<div style="padding:2rem;text-align:center;color:var(--txt3)">No Stock IN records for this site.</div>' :
        `<table class="emp-table">
          <thead><tr><th>GRN No</th><th>SI ID</th><th>PO No</th><th>Vendor</th><th>Invoice/ST No</th><th>Part Description</th><th style="text-align:right">GRN Qty</th><th>Received On</th></tr></thead>
          <tbody>${rows.slice(0,100).map(r=>`<tr>
            <td style="font-weight:700;font-size:.78rem;color:var(--g7)">${r._grnNo||'<span style="color:var(--txt3);font-style:italic">Pending</span>'}</td>
            <td style="font-size:.73rem;color:var(--txt3)">${r['SI ID']||'—'}</td>
            <td style="font-size:.74rem;color:#1565c0">${r['PO No']||r['F']||'—'}</td>
            <td style="font-size:.76rem">${r['Vendor Name']||r['G']||'—'}</td>
            <td style="font-size:.74rem">${r['Invoice No / ST No']||r['H']||'—'}</td>
            <td style="font-size:.78rem;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r['Part Description']||r['N']||'—'}</td>
            <td style="text-align:right;font-weight:700;color:#2e7d32">${r['GRN Qty']||r['Q']||'—'}</td>
            <td style="font-size:.77rem;color:var(--txt3)">${(r._receivedOn||'').split(' ')[0]||'—'}</td>
          </tr>`).join('')}
          </tbody>
        </table>`}
      </div>
    </div>`;
    makeTableSortable(el.querySelector('.emp-table')); wrapTableScroll(el.querySelector('.emp-table'));
  }

  function smMiniKpi(icon, val, label, bg, color) {
    return `<div class="kpi-card" ${bg?`style="background:${bg}"`:''}><div class="kpi-top"><div class="kpi-icon">${icon}</div></div><div class="kpi-val" style="font-size:1.4rem;font-weight:700;${color?`color:${color}`:''}">${val}</div><div class="kpi-label">${label}</div></div>`;
  }

  // Auto-load first tab
  setTimeout(()=>smRenderOpsContent(), 0);
}

function renderSMEmpTable(emps) {
  if (!emps.length) return `<div style="padding:1.5rem;text-align:center;color:var(--txt3)">No employees found.</div>`;
  return `<table class="emp-table">
    <thead><tr><th>Name</th><th>Code</th><th>Designation</th><th>Department</th><th>Type</th></tr></thead>
    <tbody>${emps.slice(0,60).map(u => `<tr>
      <td style="font-weight:600;font-size:.82rem">${u.name}</td>
      <td style="font-size:.78rem;color:var(--txt3)">${u.empCode||'—'}</td>
      <td style="font-size:.79rem">${u.desig||'—'}</td>
      <td style="font-size:.79rem">${u.dept||'—'}</td>
      <td style="font-size:.75rem"><span style="padding:.2rem .5rem;background:#e8f5e9;color:#2e7d32;border-radius:10px">${u.empType||'—'}</span></td>
    </tr>`).join('')}</tbody>
    ${emps.length>60?`<tfoot><tr><td colspan="5" style="text-align:center;padding:.75rem;font-size:.78rem;color:var(--txt3)">Showing 60 of ${emps.length} employees</td></tr></tfoot>`:''}
  </table>`;
}

function renderSMEquipTable(assets) {
  if (!assets.length) return `<div style="padding:1.5rem;text-align:center;color:var(--txt3)">No equipment deployed at this site.</div>`;
  return `<table class="emp-table">
    <thead><tr><th>Asset Name</th><th>Code</th><th>Category</th><th>Own/Hire</th><th>Status</th></tr></thead>
    <tbody>${assets.slice(0,60).map(a => {
      const stBg = (a.status||'').toUpperCase()==='ACTIVE' ? '#e8f5e9' : '#fff3e0';
      const stCl = (a.status||'').toUpperCase()==='ACTIVE' ? '#2e7d32' : '#e65100';
      return `<tr>
        <td style="font-weight:600;font-size:.82rem">${a.name||'—'}</td>
        <td style="font-size:.78rem;color:var(--txt3)">${a.code||'—'}</td>
        <td style="font-size:.79rem">${a.category||'—'}</td>
        <td style="font-size:.78rem"><span style="padding:.2rem .5rem;background:${(a.ownHire||'').toLowerCase()==='own'?'#e3f2fd':'#f3e5f5'};color:${(a.ownHire||'').toLowerCase()==='own'?'#1565c0':'#6a1b9a'};border-radius:10px">${a.ownHire||'—'}</span></td>
        <td style="font-size:.78rem"><span style="padding:.2rem .5rem;background:${stBg};color:${stCl};border-radius:10px">${a.status||'—'}</span></td>
      </tr>`;
    }).join('')}</tbody>
    ${assets.length>60?`<tfoot><tr><td colspan="5" style="text-align:center;padding:.75rem;font-size:.78rem;color:var(--txt3)">Showing 60 of ${assets.length} units</td></tr></tfoot>`:''}
  </table>`;
}

// ══════════════════════════════════════════════════════════
//  PHASE 3 — SAFETY MODULE
// ══════════════════════════════════════════════════════════
const SAFETY_CHECKS = [
  { id:'ppe',       label:'PPE compliance — helmets, vests, boots',   cat:'PPE' },
  { id:'scaffold',  label:'Scaffolding inspected & tagged',            cat:'Working at Height' },
  { id:'electrical',label:'Electrical panels locked & labelled',       cat:'Electrical' },
  { id:'fire_ext',  label:'Fire extinguishers serviceable & accessible', cat:'Fire Safety' },
  { id:'first_aid', label:'First aid kit stocked & accessible',        cat:'Medical' },
  { id:'signage',   label:'Safety signage visible at entry & hazard zones', cat:'Signage' },
  { id:'toolbox',   label:'Toolbox talk conducted today',              cat:'Training' },
  { id:'permits',   label:'Work permits issued for hot/confined work', cat:'Permits' },
  { id:'housekeep', label:'Housekeeping — walkways clear of debris',   cat:'Housekeeping' },
  { id:'machinery', label:'Machinery guards in place & functioning',   cat:'Machinery' },
];

// ══════════════════════════════════════════════════════════
//  SAFETY MODULE — Sheet-backed: Incidents + DailyChecks
// ══════════════════════════════════════════════════════════
const SAFETY_SHEET_ID = '1B8P0PawV43ksazbzhKsil1X6-INOfxx9PFvGycNOvDY';

// ── Write helpers via Apps Script ──────────────────────
// Incidents columns: A=Timestamp B=UUID C=Site D=Type E=Severity F=Description G=ReportedBy H=EmployeeName I=Status J=Date
// DailyChecks columns: A=Timestamp B=Site C=Date D=SubmittedBy E=Score F=TotalChecks G..P=check items
async function safetyWriteToSheet(tab, rowData) {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'appendRow', sheetId: SAFETY_SHEET_ID, tab, row: rowData }),
    });
    const json = await res.json();
    return json.success !== false;
  } catch(e) {
    console.warn('Safety sheet write failed (offline?):', e.message);
    return false;
  }
}

// ── Read helpers ────────────────────────────────────────
async function safetyLoadIncidents() {
  try {
    const rows = await fetchSheet('Incidents', null, SAFETY_SHEET_ID);
    // Map sheet rows to same shape as sessionStorage incidents
    return rows.filter(r => r['UUID'] || r['B']).map(r => ({
      id:   r['UUID']          || r['B'] || String(Date.now()),
      site: r['Site']          || r['C'] || '',
      type: r['Type']          || r['D'] || '',
      sev:  r['Severity']      || r['E'] || '',
      desc: r['Description']   || r['F'] || '',
      by:   r['Reported By']   || r['G'] || '',
      emp:  r['Employee Name'] || r['H'] || '',
      status: r['Status']      || r['I'] || 'Open',
      date: r['Date']          || r['J'] || '',
    }));
  } catch(e) { return []; }
}

async function safetyLoadDailyChecks() {
  try {
    return await fetchSheet('DailyChecks', null, SAFETY_SHEET_ID);
  } catch(e) { return []; }
}

// ── Session fallback (offline) ──────────────────────────
function getSafetyIncidentsLocal() { try { return JSON.parse(sessionStorage.getItem('safety_incidents')||'[]'); } catch(e){return[];} }
function saveSafetyIncidentsLocal(arr) { sessionStorage.setItem('safety_incidents', JSON.stringify(arr)); }

// ── Render ──────────────────────────────────────────────
function renderSafetyModule() {
  const el    = document.getElementById('mainContent');
  const sites = (STATE.masters.sites||[]).filter(s => s.status==='ACTIVE');
  const selSite = _smSelectedSite || sites[0]?.name || '';

  function getSafetyChecks(site) { try { return JSON.parse(sessionStorage.getItem('sfchk_'+site)||'{}'); } catch(e){return{};} }
  function setSafetyCheck(site,id,val) {
    const c = getSafetyChecks(site); c[id]=val;
    sessionStorage.setItem('sfchk_'+site, JSON.stringify(c));
  }

  const checks   = getSafetyChecks(selSite);
  const done     = SAFETY_CHECKS.filter(c => checks[c.id]).length;
  const score    = SAFETY_CHECKS.length ? Math.round(done/SAFETY_CHECKS.length*100) : 0;
  const scoreCol = score===100 ? '#2e7d32' : score>=60 ? '#e65100' : '#c62828';
  const localInc = getSafetyIncidentsLocal();
  const openInc  = localInc.filter(i => i.status==='Open');
  const siteInc  = localInc.filter(i => i.site===selSite);
  const siteOpts = sites.map(s=>`<option value="${s.name}"${s.name===selSite?' selected':''}>${s.name}</option>`).join('');

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem;flex-wrap:wrap">
      <div>
        <h1 style="font-size:1.3rem;font-weight:700;color:var(--g9);margin:0">&#129510; Safety Module</h1>
        <p style="font-size:.8rem;color:var(--txt3);margin:0">Daily checklist &middot; Incident log &middot; Site safety score</p>
      </div>
      <select id="sf-site-sel" onchange="window.sfSelectSite(this.value)"
        style="margin-left:auto;padding:.45rem .8rem;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:.85rem;background:#fff;cursor:pointer;max-width:260px">
        ${siteOpts}
      </select>
    </div>

    <!-- KPIs -->
    <div class="kpi-grid" style="margin-bottom:1.2rem">
      <div class="kpi-card ${score===100?'':'warn'}">
        <div class="kpi-top"><div class="kpi-icon ${score===100?'green':'orange'}">&#128737;</div></div>
        <div class="kpi-value" style="color:${scoreCol}">${score}%</div>
        <div class="kpi-label">Safety Score — Today</div>
        <div class="kpi-sub">${done}/${SAFETY_CHECKS.length} checks done</div>
      </div>
      <div class="kpi-card ${openInc.length>0?'warn':''}">
        <div class="kpi-top"><div class="kpi-icon ${openInc.length>0?'orange':'green'}">&#9888;</div></div>
        <div class="kpi-value" id="sfOpenIncCt">${openInc.length}</div>
        <div class="kpi-label">Open Incidents</div>
        <div class="kpi-sub">Across all sites</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><div class="kpi-icon green">&#128203;</div></div>
        <div class="kpi-value" id="sfTotalIncCt">${localInc.length}</div>
        <div class="kpi-label">Total Incidents</div>
        <div class="kpi-sub" id="sfIncSrc">Local session</div>
      </div>
      <div class="kpi-card info">
        <div class="kpi-top"><div class="kpi-icon blue">&#127959;</div></div>
        <div class="kpi-value">${siteInc.length}</div>
        <div class="kpi-label">Incidents at Site</div>
        <div class="kpi-sub">${selSite||'Selected site'}</div>
      </div>
    </div>

    <div class="dash-grid" style="margin-bottom:1.2rem">
      <!-- Daily Safety Checklist -->
      <div class="card">
        <div class="card-head">
          <h3>&#10003; Daily Safety Checklist &mdash; ${selSite||'Site'}</h3>
          <span style="font-size:.75rem;font-weight:700;padding:.2rem .6rem;border-radius:10px;background:${scoreCol}20;color:${scoreCol}">${score}% complete</span>
        </div>
        <div class="card-body" style="padding:.5rem 1rem">
          <div style="background:var(--surface2);border-radius:20px;height:8px;overflow:hidden;margin-bottom:1rem">
            <div style="width:${score}%;height:100%;background:${scoreCol};border-radius:20px;transition:width .4s"></div>
          </div>
          ${SAFETY_CHECKS.map(c => {
            const checked = !!checks[c.id];
            return `<label style="display:flex;align-items:center;gap:.75rem;padding:.55rem 0;border-bottom:1px solid var(--surface2);cursor:pointer">
              <input type="checkbox" ${checked?'checked':''} onchange="window.sfToggle('${selSite}','${c.id}',this.checked)"
                style="width:16px;height:16px;cursor:pointer;accent-color:var(--g7)">
              <span style="flex:1;font-size:.83rem;font-weight:${checked?'400':'500'};color:${checked?'var(--txt3)':'var(--txt)'};text-decoration:${checked?'line-through':'none'}">${c.label}</span>
              <span style="font-size:.65rem;padding:.15rem .45rem;border-radius:8px;background:#e8f5e9;color:#2e7d32;white-space:nowrap">${c.cat}</span>
            </label>`;
          }).join('')}
          <div style="margin-top:.75rem;display:flex;gap:.6rem">
            <button onclick="window.sfMarkAll('${selSite}')"
              style="flex:1;padding:.5rem;background:var(--g7);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:.8rem;font-weight:600">
              &#10003; Mark All Safe
            </button>
            <button onclick="window.sfClearAll('${selSite}')"
              style="padding:.5rem .9rem;background:#fff;color:var(--txt2);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:inherit;font-size:.8rem">
              Reset
            </button>
          </div>
          <div id="sf-checklist-status" style="margin-top:.5rem;font-size:.75rem;color:var(--txt3);text-align:center"></div>
        </div>
      </div>

      <!-- Report Incident -->
      <div class="card">
        <div class="card-head"><h3>&#128680; Report Incident</h3></div>
        <div class="card-body">
          <div style="display:grid;gap:.7rem">
            <div>
              <label style="font-size:.75rem;font-weight:600;color:var(--txt2);display:block;margin-bottom:.3rem">Type</label>
              <select id="inc-type" style="width:100%;padding:.45rem .7rem;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:.82rem">
                <option>Near Miss</option><option>First Aid</option><option>Property Damage</option>
                <option>Lost Time Injury</option><option>Fire/Explosion</option><option>Environmental</option>
              </select>
            </div>
            <div>
              <label style="font-size:.75rem;font-weight:600;color:var(--txt2);display:block;margin-bottom:.3rem">Severity</label>
              <select id="inc-sev" style="width:100%;padding:.45rem .7rem;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:.82rem">
                <option>Low</option><option>Medium</option><option>High</option><option>Critical</option>
              </select>
            </div>
            <div>
              <label style="font-size:.75rem;font-weight:600;color:var(--txt2);display:block;margin-bottom:.3rem">Description *</label>
              <textarea id="inc-desc" rows="3" placeholder="Describe what happened..."
                style="width:100%;padding:.45rem .7rem;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:.82rem;resize:vertical;box-sizing:border-box"></textarea>
            </div>
            <div>
              <label style="font-size:.75rem;font-weight:600;color:var(--txt2);display:block;margin-bottom:.3rem">Employee Name <span style="font-weight:400;color:var(--txt3)">(optional)</span></label>
              <input id="inc-emp" type="text" placeholder="Name of employee involved" list="incEmpList"
                style="width:100%;padding:.45rem .7rem;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:.82rem;box-sizing:border-box">
              <datalist id="incEmpList"></datalist>
            </div>
            <div>
              <label style="font-size:.75rem;font-weight:600;color:var(--txt2);display:block;margin-bottom:.3rem">Reported By</label>
              <input id="inc-by" type="text" value="${STATE.user?.name||''}" placeholder="Your name"
                style="width:100%;padding:.45rem .7rem;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:.82rem;box-sizing:border-box">
            </div>
            <div id="inc-submit-msg" style="display:none;font-size:.78rem;padding:.4rem .7rem;border-radius:6px"></div>
            <button onclick="window.sfSubmitIncident('${selSite}')"
              id="inc-submit-btn"
              style="padding:.55rem;background:#c62828;color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:700;font-size:.85rem">
              &#128680; Submit Incident Report
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Incident Log -->
    <div class="card">
      <div class="card-head">
        <h3>&#128203; Incident Log &mdash; All Sites</h3>
        <div style="display:flex;gap:.5rem;align-items:center">
          <span class="hr-stat-pill" id="sfIncLogCount">${localInc.length} local</span>
          <button class="btn btn-secondary btn-sm" onclick="window.sfReloadFromSheet()">&#8635; Load from Sheet</button>
        </div>
      </div>
      <div class="card-body" style="padding:0" id="sf-incident-log">
        ${renderIncidentLog(localInc)}
      </div>
    </div>
  `;

  // Populate employee datalist
  const dl = document.getElementById('incEmpList');
  if (dl) {
    (STATE.masters.users||[]).filter(u=>u.status==='ACTIVE').forEach(u=>{
      const o = document.createElement('option'); o.value = u.name; dl.appendChild(o);
    });
  }

  // ── Helpers ──────────────────────────────────────────
  window.sfSelectSite  = (name) => { _smSelectedSite = name; renderSafetyModule(); };
  window.sfToggle      = (site,id,val) => { setSafetyCheck(site,id,val); renderSafetyModule(); };

  window.sfMarkAll = async (site) => {
    const obj={}; SAFETY_CHECKS.forEach(c=>obj[c.id]=true);
    sessionStorage.setItem('sfchk_'+site, JSON.stringify(obj));
    renderSafetyModule();
    // Write to DailyChecks sheet
    const statusEl = document.getElementById('sf-checklist-status');
    if (statusEl) statusEl.textContent = 'Saving to sheet...';
    const ts  = new Date().toISOString();
    const dt  = new Date().toLocaleDateString('en-IN');
    const row = [ts, site, dt, STATE.user?.name||'', '100', String(SAFETY_CHECKS.length),
      ...SAFETY_CHECKS.map(c => 'Yes')];
    const ok = await safetyWriteToSheet('DailyChecks', row);
    if (statusEl) {
      statusEl.textContent = ok ? '✅ Saved to DailyChecks sheet' : '⚠️ Saved locally only (sheet write failed)';
      statusEl.style.color = ok ? '#2e7d32' : '#e65100';
    }
  };

  window.sfClearAll = (site) => { sessionStorage.removeItem('sfchk_'+site); renderSafetyModule(); };

  window.sfSubmitIncident = async (site) => {
    const type  = document.getElementById('inc-type')?.value||'';
    const sev   = document.getElementById('inc-sev')?.value||'';
    const desc  = (document.getElementById('inc-desc')?.value||'').trim();
    const emp   = (document.getElementById('inc-emp')?.value||'').trim();
    const by    = (document.getElementById('inc-by')?.value||'').trim();
    const msgEl = document.getElementById('inc-submit-msg');
    const btnEl = document.getElementById('inc-submit-btn');
    const showMsg = (txt,ok) => {
      if (!msgEl) return;
      msgEl.style.display='block'; msgEl.textContent=txt;
      msgEl.style.background = ok ? '#f0fdf4' : '#fef2f2';
      msgEl.style.color      = ok ? '#16a34a' : '#dc2626';
    };
    if (!desc) { showMsg('Please describe the incident.', false); return; }
    if (btnEl) { btnEl.textContent='Submitting...'; btnEl.disabled=true; }

    const uuid = 'INC-' + Date.now();
    const dt   = new Date().toLocaleDateString('en-IN');
    const ts   = new Date().toISOString();

    // Save locally first
    const arr = getSafetyIncidentsLocal();
    arr.unshift({ id:uuid, site, type, sev, desc, by, emp, date:dt, status:'Open' });
    saveSafetyIncidentsLocal(arr);

    // Write to Incidents sheet: A=Timestamp B=UUID C=Site D=Type E=Severity F=Description G=ReportedBy H=EmployeeName I=Status J=Date
    const row = [ts, uuid, site, type, sev, desc, by, emp, 'Open', dt];
    const ok  = await safetyWriteToSheet('Incidents', row);

    if (btnEl) { btnEl.textContent='&#128680; Submit Incident Report'; btnEl.disabled=false; }
    showMsg(ok ? '✅ Incident saved to sheet' : '⚠️ Saved locally. Sheet write failed — check Apps Script.', ok);
    setTimeout(() => renderSafetyModule(), 1500);
  };

  window.sfCloseInc = async (id) => {
    // Optimistic UI update first
    const arr = getSafetyIncidentsLocal().map(i => i.id===id ? {...i, status:'Closed'} : i);
    saveSafetyIncidentsLocal(arr);
    const log = document.getElementById('sf-incident-log');
    if (log) log.innerHTML = renderIncidentLog(arr);
    const cntEl = document.getElementById('sfOpenIncCt');
    if (cntEl) cntEl.textContent = arr.filter(i=>i.status==='Open').length;

    // Write-back to Safety Sheet via Apps Script — update Status column (Col I)
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action:   'updateCell',
          sheetId:  SAFETY_SHEET_ID,
          tab:      'Incidents',
          matchCol: 'B',        // UUID column
          matchVal: id,
          updateCol:'I',        // Status column
          updateVal: 'Closed',
        })
      });
      const json = await res.json();
      if (!json.success) console.warn('Safety close write-back failed:', json.message);
    } catch(e) {
      console.warn('Safety close write-back error:', e.message);
      // UI already updated — silent fail is acceptable
    }
  };

  window.sfReloadFromSheet = async () => {
    const logEl = document.getElementById('sf-incident-log');
    const cntEl = document.getElementById('sfIncLogCount');
    if (logEl) logEl.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--txt3)">&#8987; Loading from sheet...</div>';
    const rows = await safetyLoadIncidents();
    if (rows.length) {
      saveSafetyIncidentsLocal(rows);
      if (logEl) logEl.innerHTML = renderIncidentLog(rows);
      if (cntEl) cntEl.textContent = rows.length + ' from sheet';
      document.getElementById('sfTotalIncCt').textContent = rows.length;
      document.getElementById('sfOpenIncCt').textContent  = rows.filter(r=>r.status==='Open').length;
      document.getElementById('sfIncSrc').textContent     = 'From sheet';
    } else {
      if (logEl) logEl.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--txt3)">No incidents in sheet yet, or sheet not shared.</div>';
    }
  };
}

function renderIncidentLog(incidents) {
  if (!incidents.length) return `<div style="padding:1.5rem;text-align:center;color:var(--txt3)">No incidents logged yet. Use the form to report one.</div>`;
  const sevCol = { Low:'#2e7d32', Medium:'#e65100', High:'#c62828', Critical:'#6a1b9a' };
  const rows = incidents.slice(0,30).map(i => {
    const sc = sevCol[i.sev]||'#555';
    return `<tr>
      <td style="font-size:.78rem;white-space:nowrap">${i.date||''}</td>
      <td style="font-size:.79rem">${i.site||''}</td>
      <td style="font-size:.79rem">${i.type||''}</td>
      <td><span style="font-size:.7rem;font-weight:700;padding:.2rem .5rem;border-radius:10px;background:${sc}20;color:${sc}">${i.sev||''}</span></td>
      <td style="font-size:.79rem;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i.desc||''}</td>
      <td style="font-size:.78rem">${i.by||'—'}</td>
      <td style="font-size:.78rem;color:var(--txt3)">${i.emp||'—'}</td>
      <td style="text-align:center">
        ${i.status==='Open'
          ? `<button onclick="window.sfCloseInc('${i.id}')"
              style="padding:.2rem .55rem;background:#e8f5e9;color:#2e7d32;border:1px solid #c8e6c9;border-radius:6px;cursor:pointer;font-size:.7rem;font-weight:600">
              Close &#10003;</button>`
          : `<span style="font-size:.7rem;color:#2e7d32;font-weight:700">&#10003; Closed</span>`}
      </td>
    </tr>`;
  }).join('');
  return `<div style="overflow-x:auto"><table class="emp-table">
    <thead><tr><th>Date</th><th>Site</th><th>Type</th><th>Severity</th><th>Description</th><th>Reported By</th><th>Employee</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}



// ══════════════════════════════════════════════════════════
//  PHASE 3 — EQUIPMENT & MACHINERY
// ══════════════════════════════════════════════════════════
let _eqFilter   = { site:'', cat:'', own:'' };
let _eqSort     = { col:'name', dir:1 };

function renderEquipmentModule() {
  const el     = document.getElementById('mainContent');
  const assets  = STATE.masters.assets || [];
  const active  = assets.filter(a => a.status === 'ACTIVE');
  const inactive= assets.filter(a => a.status !== 'ACTIVE');

  // Unique values for filters
  const allSites = [...new Set(assets.map(a=>a.site).filter(Boolean))].sort();
  const allCats  = [...new Set(assets.map(a=>a.category).filter(Boolean))].sort();
  const ownCount = active.filter(a => (a.ownHire||'').toUpperCase()==='OWN').length;
  const hireCount= active.filter(a => (a.ownHire||'').toUpperCase()==='HIRE').length;

  // Site-wise breakdown
  const siteMap = {};
  active.forEach(a => { const s=a.site||'Unassigned'; siteMap[s]=(siteMap[s]||0)+1; });
  const topSites = Object.entries(siteMap).sort((a,b)=>b[1]-a[1]).slice(0,8);

  // Category breakdown
  const catMap = {};
  active.forEach(a => { const c=a.category||'Uncategorised'; catMap[c]=(catMap[c]||0)+1; });
  const topCats = Object.entries(catMap).sort((a,b)=>b[1]-a[1]).slice(0,6);

  el.innerHTML = `
    <div style="margin-bottom:1rem">
      <h1 style="font-size:1.3rem;font-weight:700;color:var(--g9);margin:0">🚜 Equipment & Machinery</h1>
      <p style="font-size:.8rem;color:var(--txt3);margin:0">Live from AssetMaster · ${assets.length} total units</p>
    </div>

    <!-- KPI Cards -->
    <div class="kpi-grid" style="margin-bottom:1.2rem">
      <div class="kpi-card">
        <div class="kpi-top"><div class="kpi-icon green">🚜</div></div>
        <div class="kpi-value">${active.length}</div>
        <div class="kpi-label">Active Units</div>
      </div>
      <div class="kpi-card warn">
        <div class="kpi-top"><div class="kpi-icon orange">🔧</div></div>
        <div class="kpi-value">${inactive.length}</div>
        <div class="kpi-label">Inactive / Off-hire</div>
      </div>
      <div class="kpi-card info">
        <div class="kpi-top"><div class="kpi-icon blue">🏢</div></div>
        <div class="kpi-value">${ownCount}</div>
        <div class="kpi-label">Own Assets</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><div class="kpi-icon green">📋</div></div>
        <div class="kpi-value">${hireCount}</div>
        <div class="kpi-label">Hired / Leased</div>
      </div>
    </div>

    <div class="dash-grid" style="margin-bottom:1.2rem">
      <!-- Category breakdown -->
      <div class="card">
        <div class="card-head"><h3>📦 By Category (Active)</h3></div>
        <div class="card-body">
          ${topCats.map(([c,n]) => {
            const pct = active.length ? Math.round(n/active.length*100):0;
            return `<div style="margin-bottom:.65rem">
              <div style="display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:.25rem">
                <span style="font-weight:600;color:var(--g9)">${c}</span>
                <span style="color:var(--txt3)">${n} (${pct}%)</span>
              </div>
              <div style="background:var(--surface2);border-radius:20px;height:7px;overflow:hidden">
                <div style="width:${pct}%;height:100%;background:var(--g6);border-radius:20px"></div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <!-- Site deployment -->
      <div class="card">
        <div class="card-head"><h3>🏗️ Site Deployment</h3></div>
        <div class="card-body" style="padding:0;overflow-x:auto">
          <table class="emp-table">
            <thead><tr><th>Site</th><th style="text-align:center">Units</th><th>Bar</th></tr></thead>
            <tbody>
              ${topSites.map(([s,n]) => {
                const pct = active.length ? Math.round(n/active.length*100):0;
                return `<tr>
                  <td style="font-size:.81rem;font-weight:600">${s}</td>
                  <td style="text-align:center;font-weight:700">${n}</td>
                  <td style="min-width:100px">
                    <div style="background:var(--surface2);border-radius:20px;height:7px;overflow:hidden">
                      <div style="width:${pct}%;height:100%;background:var(--g5);border-radius:20px"></div>
                    </div>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Filter bar -->
    <div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-bottom:.8rem">
      <select id="eq-f-site" onchange="window.eqApplyFilter()"
        style="padding:.4rem .7rem;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:.8rem;background:#fff">
        <option value="">All Sites</option>
        ${allSites.map(s=>`<option value="${s}">${s}</option>`).join('')}
      </select>
      <select id="eq-f-cat" onchange="window.eqApplyFilter()"
        style="padding:.4rem .7rem;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:.8rem;background:#fff">
        <option value="">All Categories</option>
        ${allCats.map(c=>`<option value="${c}">${c}</option>`).join('')}
      </select>
      <select id="eq-f-own" onchange="window.eqApplyFilter()"
        style="padding:.4rem .7rem;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:.8rem;background:#fff">
        <option value="">Own & Hire</option>
        <option value="OWN">Own Only</option>
        <option value="HIRE">Hire Only</option>
      </select>
      <input id="eq-search" type="text" placeholder="Search asset…" oninput="window.eqApplyFilter()"
        style="padding:.4rem .7rem;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:.8rem;flex:1;min-width:150px;max-width:220px">
      <span class="hr-stat-pill" id="eq-count-badge">${assets.length} assets</span>
    </div>

    <!-- Asset Table -->
    <div class="card">
      <div class="card-body" style="padding:0;overflow-x:auto" id="eq-table">
        ${renderEQTable(assets)}
      </div>
    </div>
  `;

  window.eqApplyFilter = function() {
    const site  = document.getElementById('eq-f-site')?.value||'';
    const cat   = document.getElementById('eq-f-cat')?.value||'';
    const own   = document.getElementById('eq-f-own')?.value||'';
    const q     = (document.getElementById('eq-search')?.value||'').toLowerCase();
    let rows = assets.filter(a =>
      (!site || a.site===site) &&
      (!cat  || a.category===cat) &&
      (!own  || (a.ownHire||'').toUpperCase()===own) &&
      (!q    || (a.name+a.code+a.category).toLowerCase().includes(q))
    );
    const badge = document.getElementById('eq-count-badge');
    if (badge) badge.innerHTML = `<strong>${rows.length}</strong> assets`;
    const t = document.getElementById('eq-table');
    if (t) t.innerHTML = renderEQTable(rows);
  };
}

function renderEQTable(rows) {
  if (!rows.length) return `<div style="padding:1.5rem;text-align:center;color:var(--txt3)">No assets match the filter.</div>`;
  const show = rows.slice(0,100);
  return `<table class="emp-table" style="min-width:560px">
    <thead><tr><th>Asset Name</th><th>Code</th><th>Category</th><th>Site</th><th style="text-align:center">Own/Hire</th><th style="text-align:center">Status</th></tr></thead>
    <tbody>${show.map(a => {
      const stCol = a.status==='ACTIVE' ? '#2e7d32':'#c62828';
      const stBg  = a.status==='ACTIVE' ? '#e8f5e9':'#fdecea';
      const ohCol = (a.ownHire||'').toUpperCase()==='OWN' ? '#1565c0':'#e65100';
      const ohBg  = (a.ownHire||'').toUpperCase()==='OWN' ? '#e3f2fd':'#fff3e0';
      return `<tr>
        <td style="font-weight:600;font-size:.82rem">${a.name}</td>
        <td style="font-size:.78rem;color:var(--txt3)">${a.code||'—'}</td>
        <td style="font-size:.79rem">${a.category||'—'}</td>
        <td style="font-size:.79rem">${a.site||'—'}</td>
        <td style="text-align:center">
          <span style="font-size:.7rem;font-weight:700;padding:.2rem .5rem;border-radius:10px;background:${ohBg};color:${ohCol}">${a.ownHire||'—'}</span>
        </td>
        <td style="text-align:center">
          <span style="font-size:.7rem;font-weight:700;padding:.2rem .5rem;border-radius:10px;background:${stBg};color:${stCol}">${a.status}</span>
        </td>
      </tr>`;
    }).join('')}</tbody>
    ${rows.length>100?`<tfoot><tr><td colspan="6" style="text-align:center;padding:.75rem;font-size:.78rem;color:var(--txt3)">Showing 100 of ${rows.length} assets</td></tr></tfoot>`:''}
  </table>`;
}

// ══════════════════════════════════════════════════════════
//  PHASE 3 — SITE STORE  (MRS-based)
// ══════════════════════════════════════════════════════════
let _storeAllRows = [];
let _storeSort    = { col:'count', dir:-1 };
let _storeFilter  = '';

function renderStoreModule() {
  const el = document.getElementById('mainContent');
  // Default to currently selected site (from Site Manager) if role is site
  const defaultSite = (STATE.role === 'site' && _smSelectedSite) ? _smSelectedSite : '';
  const siteOptions = `<option value="">All Sites</option>` +
    (STATE.masters.sites||[]).filter(s=>s.status==='ACTIVE')
      .map(s=>`<option value="${s.name}" ${s.name===defaultSite?'selected':''}>${s.name}</option>`).join('');

  el.innerHTML = `
    <div style="margin-bottom:1rem">
      <h1 style="font-size:1.3rem;font-weight:700;color:var(--g9);margin:0">🏪 Site Store</h1>
      <p style="font-size:.8rem;color:var(--txt3);margin:0">Material Requests (MRS) · site-wise inventory · live from v2_Purchase</p>
    </div>

    <!-- KPIs -->
    <div class="kpi-grid" style="margin-bottom:1.2rem">
      <div class="kpi-card" style="cursor:pointer" onclick="window.stJumpTo('all')"><div class="kpi-top"><div class="kpi-icon green">📦</div><div class="kpi-trend flat" style="font-size:.65rem">view all ↓</div></div>
        <div class="kpi-value" id="st-kpi-total">—</div><div class="kpi-label">Total MRS</div>
        <div style="margin-top:.35rem"><button class="as-btn" onclick="event.stopPropagation();window.open(AS.newMR(),'_blank')">🚀 New Material Request</button></div></div>
      <div class="kpi-card warn" style="cursor:pointer" onclick="window.stJumpTo('Pending')"><div class="kpi-top"><div class="kpi-icon orange">⏳</div><div class="kpi-trend flat" style="font-size:.65rem">view list ↓</div></div>
        <div class="kpi-value" id="st-kpi-pending">—</div><div class="kpi-label">Pending</div>
        <div style="margin-top:.35rem"><button class="as-btn" onclick="event.stopPropagation();window.open(AS.pendingMR(),'_blank')">🚀 Pending MR Approval</button></div></div>
      <div class="kpi-card info" style="cursor:pointer" onclick="window.stJumpTo('Approved')"><div class="kpi-top"><div class="kpi-icon blue">✅</div><div class="kpi-trend flat" style="font-size:.65rem">view list ↓</div></div>
        <div class="kpi-value" id="st-kpi-approved">—</div><div class="kpi-label">Approved</div>
        <div style="margin-top:.35rem"><button class="as-btn" onclick="event.stopPropagation();window.open(AS.mrsMaster(),'_blank')">🚀 MRS Master View</button></div></div>
      <div class="kpi-card" style="cursor:pointer" onclick="window.stJumpTo('sites')"><div class="kpi-top"><div class="kpi-icon green">🏗️</div><div class="kpi-trend flat" style="font-size:.65rem">view sites ↓</div></div>
        <div class="kpi-value" id="st-kpi-sites">—</div><div class="kpi-label">Sites with MRS</div></div>
    </div>

    <div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-bottom:.8rem">
      <select id="st-site-f" onchange="window.stApplyFilter()"
        style="padding:.4rem .7rem;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:.8rem;background:#fff;font-weight:600">
        ${siteOptions}
      </select>
      <select id="st-status-f" onchange="window.stApplyFilter()"
        style="padding:.4rem .7rem;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:.8rem;background:#fff">
        <option value="">All Statuses</option>
        <option value="Pending">Pending</option>
        <option value="Approved">Approved</option>
        <option value="Rejected">Rejected</option>
      </select>
      <input id="st-search" type="text" placeholder="Search…" oninput="window.stApplyFilter()"
        style="padding:.4rem .7rem;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:.8rem;flex:1;min-width:140px;max-width:220px">
      <span class="hr-stat-pill" id="st-count-badge">Loading…</span>
      <button onclick="window.stDownloadCSV()" class="csv-btn">⬇ CSV</button>
    </div>

    <div id="st-table" style="max-height:320px;overflow-y:auto;overflow-x:auto">
      <div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:3rem;color:var(--txt3)">
        <div style="width:22px;height:22px;border:2px solid var(--border);border-top-color:var(--g5);border-radius:50%;animation:spin 1s linear infinite"></div>
        Loading MRS data from v2_Purchase…
      </div>
    </div>

    <!-- Item-level search -->
    <div class="card" style="margin-top:1rem">
      <div class="card-head"><h3>🔍 Search Material Requests</h3></div>
      <div class="card-body">
        <div style="display:flex;gap:.6rem;margin-bottom:.8rem;flex-wrap:wrap">
          <input id="mrs-item-search" type="text" placeholder="Search by part description or request no…"
            style="padding:.4rem .7rem;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:.8rem;flex:1;min-width:220px">
          <button onclick="window.mrsSiteSearch()"
            style="padding:.4rem 1rem;background:var(--g7);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:.8rem;font-weight:600">
            Search
          </button>
        </div>
        <div id="mrs-item-results" style="font-size:.82rem;color:var(--txt3)">Enter a search term above to find specific material requests.</div>
      </div>
    </div>
  `;

  // Fetch MRS data — columns: D=Request No, F=Site, N=MR Approval Status, P=MR Approval Date, Y=Timestamp
  fetchSheet('MRS', 'SELECT D,F,G,N,Y', PO_SHEET_ID).then(rawRows => {
    // Deduplicate by Request No, filter out dummy
    const seen = new Set();
    _storeAllRows = rawRows.filter(r => {
      const rn = (r['Request No']||'').trim();
      if (!rn || rn.toLowerCase()==='dummy') return false;
      if (seen.has(rn)) return false;
      seen.add(rn); return true;
    }).map(r => ({
      reqNo:  r['Request No'] || '—',
      site:   r['Requested For (site)'] || r['F'] || '—',
      part:   r['Part Details'] || r['G'] || '',
      status: (r['MR Approval Status'] || '').trim() || 'Pending',
      ts:     r['Timestamp'] || r['Y'] || '',
    }));

    // Site aggregation
    const siteMap = {};
    _storeAllRows.forEach(r => {
      const s = r.site;
      if (!siteMap[s]) siteMap[s] = { site:s, count:0, pending:0, approved:0, rejected:0, dropped:0 };
      siteMap[s].count++;
      const st = r.status.toUpperCase();
      if (st==='APPROVED') siteMap[s].approved++;
      else if (st==='REJECTED') siteMap[s].rejected++;
      else if (st==='DROPPED') siteMap[s].dropped++;
      else siteMap[s].pending++;
    });

    const total    = _storeAllRows.length;
    const pending  = _storeAllRows.filter(r => !r.status || r.status.toUpperCase()==='PENDING' || r.status==='').length;
    const approved = _storeAllRows.filter(r => r.status.toUpperCase()==='APPROVED').length;
    const siteCnt  = Object.keys(siteMap).length;

    const kT = document.getElementById('st-kpi-total');    if(kT) kT.textContent = total;
    const kP = document.getElementById('st-kpi-pending');  if(kP) kP.textContent = pending;
    const kA = document.getElementById('st-kpi-approved'); if(kA) kA.textContent = approved;
    const kS = document.getElementById('st-kpi-sites');    if(kS) kS.textContent = siteCnt;

    const badge = document.getElementById('st-count-badge');
    if (badge) badge.innerHTML = `<strong>${siteCnt}</strong> sites`;

    // Store for filter
    window._storeSiteMap = siteMap;
    renderStoreSiteTable(Object.values(siteMap));
  }).catch(() => {
    const t = document.getElementById('st-table');
    if (t) t.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;padding:2rem;color:#c62828">
      ⚠️ Could not load MRS data. Ensure v2_Purchase is shared as "Anyone on the internet".</div></div>`;
  });

  window.stSort = function(col) {
    if (_storeSort.col===col) _storeSort.dir*=-1; else { _storeSort.col=col; _storeSort.dir=-1; }
    renderStoreSiteTable(Object.values(window._storeSiteMap||{}));
  };
  window.stApplyFilter = function() {
    const sitef = (document.getElementById('st-site-f')?.value||'');
    const q     = (document.getElementById('st-search')?.value||'').toLowerCase();
    const sf    = (document.getElementById('st-status-f')?.value||'').toLowerCase();
    let rows = Object.values(window._storeSiteMap||{});
    if (sitef) rows = rows.filter(r => r.site === sitef);
    if (q)     rows = rows.filter(r => r.site.toLowerCase().includes(q));
    renderStoreSiteTable(rows, sf);
  };
  window.mrsSiteSearch = function() {
    const q = (document.getElementById('mrs-item-search')?.value||'').trim().toLowerCase();
    const res = document.getElementById('mrs-item-results');
    if (!q || !res) return;
    const hits = _storeAllRows.filter(r =>
      (r.reqNo+r.part+r.site).toLowerCase().includes(q)).slice(0,20);
    if (!hits.length) { res.innerHTML = `<span style="color:var(--txt3)">No results for "${q}".</span>`; return; }
    const stC = { APPROVED:'#2e7d32', REJECTED:'#c62828', DROPPED:'#777' };
    res.innerHTML = `<table class="emp-table"><thead><tr><th>Request No</th><th>Site</th><th>Part</th><th>Status</th></tr></thead>
      <tbody>${hits.map(r => {
        const c = stC[r.status.toUpperCase()]||'#e65100';
        return `<tr>
          <td style="font-weight:700;font-size:.8rem">${r.reqNo}</td>
          <td style="font-size:.79rem">${r.site}</td>
          <td style="font-size:.79rem;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.part||'—'}</td>
          <td><span style="font-size:.7rem;font-weight:700;padding:.2rem .5rem;border-radius:10px;background:${c}20;color:${c}">${r.status}</span></td>
        </tr>`;
      }).join('')}</tbody></table>`;
  };
}

// ── STORE DEEP LINK ───────────────────────────────────────
window.stDownloadCSV = function() {
  const sf = (document.getElementById('st-status-f')?.value || '').toLowerCase();
  const q  = (document.getElementById('st-search')?.value || '').toLowerCase();
  let rows = _storeAllRows;
  if (sf) rows = rows.filter(r => r.status.toLowerCase() === sf);
  if (q)  rows = rows.filter(r => (r.site||'').toLowerCase().includes(q) || (r.reqNo||'').toLowerCase().includes(q));
  const csv = rows.map(r => ({ 'Request No': r.reqNo, 'Site': r.site, 'Part Details': r.part, 'Status': r.status, 'Timestamp': r.ts }));
  downloadCSV(csv, `SiteStore_${sf||'all'}_${new Date().toISOString().slice(0,10)}.csv`);
};
window.stJumpTo = function(filter) {
  const sf = document.getElementById('st-status-f');
  const tbl = document.getElementById('st-table');
  if (sf && filter !== 'sites' && filter !== 'all') {
    sf.value = filter;   // e.g. "Pending" / "Approved"
  } else if (sf && filter === 'all') {
    sf.value = '';
  }
  window.stApplyFilter();
  // scroll to appropriate section
  const target = filter === 'sites' ? tbl : tbl;
  if (target) target.scrollIntoView({ behavior:'smooth', block:'start' });
};

function renderStoreSiteTable(rows, statusFilter) {
  const el = document.getElementById('st-table');
  if (!el) return;
  const col = _storeSort.col, dir = _storeSort.dir;
  let sorted = [...rows].sort((a,b) => {
    if (typeof a[col]==='number') return (a[col]-b[col])*dir;
    return String(a[col]||'').localeCompare(String(b[col]||''))*dir;
  });

  function sth(label, col) {
    const arrow = _storeSort.col===col ? (_storeSort.dir===1?' ▲':' ▼'):' ↕';
    return `<th style="cursor:pointer;user-select:none" onclick="window.stSort('${col}')">${label}<span style="opacity:.45;font-size:.68rem">${arrow}</span></th>`;
  }
  const maxC = Math.max(...sorted.map(r=>r.count),1);
  const trs = sorted.map(r => `<tr>
    <td style="font-weight:700;font-size:.82rem;color:var(--g8)">${r.site}</td>
    <td style="text-align:center;font-weight:700">${r.count}</td>
    <td style="text-align:center;color:#e65100;font-weight:600">${r.pending}</td>
    <td style="text-align:center;color:#2e7d32;font-weight:600">${r.approved}</td>
    <td style="text-align:center;color:#c62828;font-weight:600">${r.rejected}</td>
    <td style="min-width:80px">
      <div style="background:var(--surface2);border-radius:20px;height:7px;overflow:hidden">
        <div style="width:${Math.round(r.count/maxC*100)}%;height:100%;background:var(--g5);border-radius:20px"></div>
      </div>
    </td>
  </tr>`).join('');

  el.innerHTML = `<div class="card"><div class="card-body" style="padding:0;overflow-x:auto">
    <table class="emp-table" style="min-width:480px">
      <thead><tr>
        ${sth('Site','site')}
        ${sth('Total MRS','count')}
        ${sth('⏳ Pending','pending')}
        ${sth('✅ Approved','approved')}
        ${sth('❌ Rejected','rejected')}
        <th>Volume</th>
      </tr></thead>
      <tbody>${trs}</tbody>
      <tfoot><tr style="background:var(--surface2);font-weight:700">
        <td style="font-size:.81rem;color:var(--g8)">TOTAL (${sorted.length} sites)</td>
        <td style="text-align:center">${sorted.reduce((s,r)=>s+r.count,0)}</td>
        <td style="text-align:center;color:#e65100">${sorted.reduce((s,r)=>s+r.pending,0)}</td>
        <td style="text-align:center;color:#2e7d32">${sorted.reduce((s,r)=>s+r.approved,0)}</td>
        <td style="text-align:center;color:#c62828">${sorted.reduce((s,r)=>s+r.rejected,0)}</td>
        <td></td>
      </tr></tfoot>
    </table>
  </div></div>`;

  // Apply sort + pagination
  const _t_storeSiteTable = el?.querySelector?.(".emp-table, .vpi-tbl") || el?.closest?.(".card")?.querySelector?.(".emp-table, .vpi-tbl");
  if (_t_storeSiteTable) { makeTableSortable(_t_storeSiteTable); wrapTableScroll(_t_storeSiteTable); }
}

// ══════════════════════════════════════════════════════════
//  REPORTS MODULE
// ══════════════════════════════════════════════════════════
const REPORT_CATALOGUE = [
  {
    id: 'mrs_summary',
    name: '📋 MRS Summary',
    desc: 'Material Request Slips by site, status and date range',
    filters: ['site','status_mrs','fy'],
    source: 'mrs',
    roles: ['md','purchase','accounts','hr','site','employee'],
  },
  {
    id: 'po_tracker',
    name: '📦 PO Tracker',
    desc: 'Purchase Orders with vendor, site, status and spend',
    filters: ['site','vendor','status_po','fy'],
    source: 'po',
    roles: ['md','purchase','accounts'],
  },
  {
    id: 'vendor_spend',
    name: '💰 Vendor Spend Summary',
    desc: 'Total spend, PO count and pending amounts per vendor',
    filters: ['site','fy'],
    source: 'po',
    roles: ['md','purchase','accounts'],
  },
  {
    id: 'stock_levels',
    name: '📊 Stock Levels by Site',
    desc: 'Current stock quantities per item per site',
    filters: ['site'],
    source: 'stock_levels',
    roles: ['md','purchase','site'],
  },
  {
    id: 'grn_register',
    name: '📥 GRN Register',
    desc: 'Goods Received Notes with vendor, PO and quantities',
    filters: ['site','vendor'],
    source: 'stockin',
    roles: ['md','purchase','site'],
  },
  {
    id: 'emp_headcount',
    name: '👷 Employee Headcount',
    desc: 'Active employees by site and department',
    filters: ['site','dept'],
    source: 'employees',
    roles: ['md','hr'],
  },
  {
    id: 'equipment_deployment',
    name: '🚜 Equipment Deployment',
    desc: 'Equipment units by site, category and own/hire status',
    filters: ['site','category','ownhire'],
    source: 'assets',
    roles: ['md','purchase','site'],
  },
  {
    id: 'onboarding_status',
    name: '👶 Onboarding Status',
    desc: 'New joiners in the last 90/180 days with onboarding progress',
    filters: ['site','period'],
    source: 'employees',
    roles: ['md','hr','employee','site'],
  },
  {
    id: 'vendor_invoice',
    name: '🧾 Vendor Invoice Status',
    desc: 'Invoice payment status per vendor',
    filters: ['vendor','status_inv'],
    source: 'invoice',
    roles: ['md','purchase','accounts'],
  },
];

let _rptSelectedId  = null;
let _rptRawData     = {};   // cache by source key
let _rptResultRows  = [];
let _rptLoading     = false;

function renderReportsModule() {
  // All internal users can access Reports — vendor/SC blocked via navigate() guard
  // Filter catalogue to only show reports relevant to this user's role
  const role = STATE.role;
  const visibleReports = REPORT_CATALOGUE.filter(r => r.roles.includes(role));

  const el = document.getElementById('mainContent');
  el.innerHTML = `
  <div class="page-header">
    <div>
      <div class="page-title">📊 Reports</div>
      <div class="page-sub">Select a report · apply filters · download CSV</div>
    </div>
  </div>

  <!-- REPORT SELECTOR CARDS -->
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.75rem;margin-bottom:1.4rem" id="rpt-catalogue">
    ${visibleReports.length === 0
      ? `<div style="padding:2rem;color:var(--txt3);grid-column:1/-1;text-align:center">No reports available for your role.</div>`
      : visibleReports.map(r => `
    <div class="rpt-card" id="rpt-card-${r.id}" onclick="window.rptSelect('${r.id}')"
      style="background:#fff;border:2px solid #e0ece4;border-radius:12px;padding:1rem;cursor:pointer;transition:all .2s">
      <div style="font-size:1.1rem;margin-bottom:.35rem">${r.name}</div>
      <div style="font-size:.74rem;color:var(--txt3);line-height:1.4">${r.desc}</div>
    </div>`).join('')}
  </div>

  ${(role === 'md' || role === 'admin') ? `
  <!-- SCHEDULE DIAGNOSTICS — admin/MD only -->
  <div class="card" id="rpt-sched-diag" style="margin-bottom:1.4rem;border:1.5px solid #f0a50033;background:linear-gradient(180deg,#fffaf0,#fff)">
    <div class="card-head" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.6rem">
      <div>
        <h3 style="display:flex;align-items:center;gap:.5rem;margin:0">
          <span style="font-size:1rem">🛠️</span> Schedule Diagnostics
        </h3>
        <div style="font-size:.7rem;color:var(--txt3);margin-top:.15rem">
          Verify scheduled reports without waiting for the trigger
        </div>
      </div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        <button onclick="rptSchedRunNow()" id="rptSchedRunBtn" class="btn btn-secondary btn-sm"
          style="background:#f0a500;color:#0d3320;border:none;font-weight:700">
          🔄 Run Schedules Now
        </button>
        <button onclick="rptSchedViewLog()" id="rptSchedLogBtn" class="btn btn-secondary btn-sm">
          📋 View Schedule Log
        </button>
        <button onclick="rptSchedRefreshSummary()" class="btn btn-secondary btn-sm" title="Refresh active count">
          ⟳
        </button>
      </div>
    </div>
    <div class="card-body" style="padding-top:0">
      <div id="rpt-sched-diag-summary" style="font-size:.78rem;color:var(--txt2);padding:.4rem 0">
        <span style="color:var(--txt3)">Loading active schedules…</span>
      </div>
      <div id="rpt-sched-diag-output"></div>
    </div>
  </div>
  ` : ''}

  <!-- FILTER + RUN PANEL -->
  <div id="rpt-filter-panel" style="display:none">
    <div class="card" style="margin-bottom:1.1rem">
      <div class="card-head">
        <h3 id="rpt-panel-title">Filters</h3>
        <div style="display:flex;gap:.5rem;align-items:center">
          <span class="hr-stat-pill" id="rpt-result-badge" style="display:none">—</span>
          <button onclick="window.rptRun()" id="rpt-run-btn"
            style="padding:.42rem 1.1rem;background:var(--g7);color:#fff;border:none;border-radius:8px;font-family:inherit;font-size:.82rem;font-weight:700;cursor:pointer">
            ▶ Run Report
          </button>
          <button onclick="window.rptDownload()" id="rpt-dl-btn" class="csv-btn" style="display:none">
            ⬇ CSV
          </button>
        </div>
      </div>
      <div class="card-body">
        <div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:flex-end" id="rpt-filters"></div>
      </div>
    </div>

    <!-- RESULTS TABLE -->
    <div id="rpt-results"></div>

    <!-- SCHEDULE REPORT BAR -->
    <div style="margin-top:1rem;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:.75rem 1rem;display:flex;align-items:center;gap:.8rem;flex-wrap:wrap">
      <span style="font-size:1rem">📅</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:.82rem;font-weight:600;color:var(--txt2)" id="rpt-sched-status">Not scheduled</div>
        <div style="font-size:.7rem;color:var(--txt3)" id="rpt-sched-sub">Configure a schedule to auto-email this report</div>
      </div>
      <button onclick="rptOpenSchedule()" class="btn btn-secondary btn-sm" style="white-space:nowrap">
        &#128197; Schedule Report
      </button>
    </div>
  </div>`;

  // Inject report card CSS
  if (!document.getElementById('rpt-styles')) {
    const s = document.createElement('style'); s.id = 'rpt-styles';
    s.textContent = `
      .rpt-card:hover{border-color:var(--g6)!important;box-shadow:0 4px 14px rgba(26,96,56,.12);transform:translateY(-2px)}
      .rpt-card.selected{border-color:var(--g6)!important;background:#e8f5e9!important;box-shadow:0 0 0 3px rgba(26,96,56,.12)}
      .rpt-filter-select{padding:.4rem .7rem;border:1.5px solid #cce3d4;border-radius:8px;font-family:inherit;font-size:.82rem;background:#fff;outline:none;cursor:pointer}
      .rpt-filter-label{font-size:.72rem;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.2rem}
    `;
    document.head.appendChild(s);
  }

  // Populate Schedule Diagnostics summary if the panel is visible (admin/MD only)
  setTimeout(() => { if (document.getElementById('rpt-sched-diag-summary')) rptSchedRefreshSummary(); }, 60);
}

window.rptSelect = function(id) {
  _rptSelectedId  = id;
  _rptResultRows  = [];
  // Highlight selected card
  document.querySelectorAll('.rpt-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('rpt-card-' + id)?.classList.add('selected');
  // Show filter panel
  const panel = document.getElementById('rpt-filter-panel');
  if (panel) panel.style.display = 'block';
  const report = REPORT_CATALOGUE.find(r => r.id === id);
  if (!report) return;
  document.getElementById('rpt-panel-title').textContent = report.name + ' — Filters';
  document.getElementById('rpt-result-badge').style.display = 'none';
  document.getElementById('rpt-dl-btn').style.display = 'none';
  document.getElementById('rpt-results').innerHTML = '';
  // Build filters
  rptBuildFilters(report);
  // Refresh schedule status bar
  setTimeout(rptRefreshScheduleBar, 50);
  // Scroll into view
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function rptBuildFilters(report) {
  const el = document.getElementById('rpt-filters');
  const sites   = (STATE.masters.sites||[]).filter(s=>s.status==='ACTIVE').map(s=>s.name);
  const vendors = (STATE.masters.vendors||[]).map(v=>v.name||v.id||'').filter(Boolean);
  const depts   = [...new Set((STATE.masters.users||[]).map(u=>u.dept).filter(Boolean))].sort();
  const cats    = [...new Set((STATE.masters.assets||[]).map(a=>a.category).filter(Boolean))].sort();
  const fySet   = getFYSet();

  const makeFilter = (id, label, options, allLabel='All') => `
    <div style="display:flex;flex-direction:column">
      <div class="rpt-filter-label">${label}</div>
      <select id="rpt-f-${id}" class="rpt-filter-select">
        <option value="">${allLabel}</option>
        ${options.map(o => `<option value="${o}">${o}</option>`).join('')}
      </select>
    </div>`;

  let html = '';
  if (report.filters.includes('site'))       html += makeFilter('site', 'Site', sites);
  if (report.filters.includes('vendor'))     html += makeFilter('vendor', 'Vendor', vendors.slice(0,100));
  if (report.filters.includes('status_mrs')) html += makeFilter('status_mrs', 'Status', ['Pending','Approved','Rejected','Dropped']);
  if (report.filters.includes('status_po'))  html += makeFilter('status_po', 'Status', ['Pending Approval','Approved','Rejected']);
  if (report.filters.includes('status_inv')) html += makeFilter('status_inv', 'Status', ['Pending','Paid']);
  if (report.filters.includes('fy'))         html += makeFilter('fy', 'Financial Year', fySet, 'All FY');
  if (report.filters.includes('dept'))       html += makeFilter('dept', 'Department', depts);
  if (report.filters.includes('category'))   html += makeFilter('category', 'Category', cats);
  if (report.filters.includes('ownhire'))    html += makeFilter('ownhire', 'Own / Hire', ['Own','Hire']);
  if (report.filters.includes('period'))     html += makeFilter('period', 'Period', ['Last 30 days','Last 60 days','Last 90 days','Last 180 days'], 'Last 90 days');

  el.innerHTML = html || '<span style="font-size:.82rem;color:var(--txt3)">No filters for this report — click Run to load all data.</span>';
}

window.rptRun = async function() {
  const id = _rptSelectedId;
  if (!id) return;
  const report = REPORT_CATALOGUE.find(r => r.id === id);
  if (!report) return;

  const results = document.getElementById('rpt-results');
  results.innerHTML = `<div style="text-align:center;padding:2.5rem;color:var(--txt3)"><div style="font-size:1.8rem;margin-bottom:.5rem">⏳</div>Loading report…</div>`;
  document.getElementById('rpt-dl-btn').style.display = 'none';

  // Read active filters
  const fv = (fid) => document.getElementById('rpt-f-' + fid)?.value || '';
  const site     = fv('site');
  const vendor   = fv('vendor');
  const stMRS    = fv('status_mrs');
  const stPO     = fv('status_po');
  const stINV    = fv('status_inv');
  const fy       = fv('fy');
  const dept     = fv('dept');
  const category = fv('category');
  const ownHire  = fv('ownhire');
  const period   = fv('period') || 'Last 90 days';

  let rows = [];
  try {
    // ── MRS SUMMARY ────────────────────────────────────────
    if (id === 'mrs_summary') {
      if (!_rptRawData.mrs) {
        const raw = await fetchSheet('MRS','SELECT D,E,F,G,I,J,K,L,N,O,P,U,Y',PO_SHEET_ID);
        const seen = new Set();
        _rptRawData.mrs = raw.filter(r=>{const n=(r['Request No']||'').trim();if(!n||n.toLowerCase()==='dummy'||seen.has(n))return false;seen.add(n);return true;})
          .map(r=>({reqNo:r['Request No']||'',site:r['Requested For']||r['F']||'',requestedBy:r['Requested By']||r['E']||'',partDesc:r['Part Description']||r['I']||'',type:r['Type']||r['J']||'',status:r['MR Approval Status']||r['N']||'Pending',approver:r['Approver Name']||r['O']||'',ts:r['Timestamp']||r['Y']||'',approveD:r['MR Approval Date']||r['P']||'',fyKey:getFYKey(parsePODate(r['Timestamp']||r['Y']||''))}));
      }
      rows = _rptRawData.mrs;
      if (site)  rows = rows.filter(r=>r.site===site);
      if (stMRS) rows = rows.filter(r=>(r.status||'Pending')===stMRS);
      if (fy)    rows = rows.filter(r=>r.fyKey===fy);
      _rptResultRows = rows.map(r=>({'Request No':r.reqNo,'Site':r.site,'Requested By':r.requestedBy,'Part Description':r.partDesc,'Type':r.type,'Status':r.status||'Pending','Approver':r.approver,'Raised On':r.ts?fmtDate(r.ts):'','Approval Date':r.approveD?fmtDate(r.approveD):''}));
      rptRenderTable(['Request No','Site','Requested By','Part Description','Type','Status','Approver','Raised On','Approval Date']);
    }

    // ── PO TRACKER ─────────────────────────────────────────
    else if (id === 'po_tracker') {
      if (!_rptRawData.po) {
        const raw = await fetchSheet(PO_TAB,'SELECT A,E,F,G,R,S,AF,AG,AP,AQ',PO_SHEET_ID);
        _rptRawData.po = raw.filter(r=>{const p=(r['PO No']||r['E']||'').trim();return p&&p.toLowerCase()!=='dummy';})
          .map(r=>({uuid:r['UUID']||r['A']||'',poNo:r['PO No']||r['E']||'',poDate:r['PO Date']||r['F']||'',prepBy:r['Prepared By']||r['G']||'',vendor:r['Vendor Name']||r['R']||'',site:r['Site Name']||r['S']||'',approver:r['Approver Name']||r['AF']||'',status:r['PO Approval Status']||r['AG']||'',amount:parseFloat((r['Net Amount']||r['AP']||'0').toString().replace(/,/g,''))||0,lock:r['Lock']||r['AQ']||'',fyKey:getFYKey(parsePODate(r['PO Date']||r['F']||''))}));
      }
      rows = _rptRawData.po;
      if (site)   rows = rows.filter(r=>r.site===site);
      if (vendor) rows = rows.filter(r=>r.vendor.toLowerCase().includes(vendor.toLowerCase()));
      if (fy)     rows = rows.filter(r=>r.fyKey===fy);
      if (stPO) {
        if (stPO==='Pending Approval') rows=rows.filter(r=>r.status.toUpperCase()!=='REJECTED'&&r.lock==='Released for Approval');
        else if (stPO==='Approved')    rows=rows.filter(r=>r.status.toUpperCase().includes('APPROVED'));
        else if (stPO==='Rejected')    rows=rows.filter(r=>r.status.toUpperCase().includes('REJECT'));
      }
      _rptResultRows = rows.map(r=>({'PO No':r.poNo,'PO Date':r.poDate?fmtDate(r.poDate):'','Vendor':r.vendor,'Site':r.site,'Amount':r.amount,'Status':r.status||'Pending','Approver':r.approver,'Prepared By':r.prepBy}));
      rptRenderTable(['PO No','PO Date','Vendor','Site','Amount','Status','Approver','Prepared By']);
    }

    // ── VENDOR SPEND ───────────────────────────────────────
    else if (id === 'vendor_spend') {
      if (!_rptRawData.po) {
        const raw = await fetchSheet(PO_TAB,'SELECT A,E,F,G,R,S,AF,AG,AP,AQ',PO_SHEET_ID);
        _rptRawData.po = raw.filter(r=>{const p=(r['PO No']||r['E']||'').trim();return p&&p.toLowerCase()!=='dummy';})
          .map(r=>({poNo:r['PO No']||r['E']||'',vendor:r['Vendor Name']||r['R']||'',site:r['Site Name']||r['S']||'',status:r['PO Approval Status']||r['AG']||'',amount:parseFloat((r['Net Amount']||r['AP']||'0').toString().replace(/,/g,''))||0,fyKey:getFYKey(parsePODate(r['PO Date']||r['F']||''))}));
      }
      rows = _rptRawData.po;
      if (site) rows = rows.filter(r=>r.site===site);
      if (fy)   rows = rows.filter(r=>r.fyKey===fy);
      // Group by vendor
      const byV = {};
      rows.forEach(r=>{
        if(!byV[r.vendor]) byV[r.vendor]={Vendor:r.vendor,'PO Count':0,'Total Amount':0,'Approved Amount':0,'Pending Amount':0};
        byV[r.vendor]['PO Count']++;
        byV[r.vendor]['Total Amount']+=r.amount;
        if(r.status.toUpperCase().includes('APPROVED')) byV[r.vendor]['Approved Amount']+=r.amount;
        if(r.status.toUpperCase()!=='REJECTED'&&r.status.toUpperCase()!=='APPROVED') byV[r.vendor]['Pending Amount']+=r.amount;
      });
      _rptResultRows = Object.values(byV).sort((a,b)=>b['Total Amount']-a['Total Amount']);
      rptRenderTable(['Vendor','PO Count','Total Amount','Approved Amount','Pending Amount']);
    }

    // ── STOCK LEVELS ───────────────────────────────────────
    else if (id === 'stock_levels') {
      if (!_rptRawData.stock_levels) {
        _rptRawData.stock_levels = await fetchSheet('v3StockLevels','SELECT A,B,C,D,E,F,G,H',STORES_SHEET_ID);
      }
      rows = _rptRawData.stock_levels.filter(r=>(r['SNo']||r['Site & Code']||'').trim()!=='');
      if (site) rows = rows.filter(r=>(r['Site Name']||'').trim()===site);
      _rptResultRows = rows.map(r=>({'SNo':r['SNo']||'','Site':r['Site Name']||'','Part Details':r['Part Details']||r['Site & Code']||'','Stock IN':r['StockIN']||'0','Stock Transfer':r['Stock Transfer (To)']||'0','Stock Out':r['Stock Out']||'0','Site Stock':r['Site Stock']||'0'}));
      rptRenderTable(['SNo','Site','Part Details','Stock IN','Stock Transfer','Stock Out','Site Stock']);
    }

    // ── GRN REGISTER ───────────────────────────────────────
    else if (id === 'grn_register') {
      if (!_rptRawData.stockin) {
        const [si,grn] = await Promise.all([
          fetchSheet('StockIN','SELECT A,B,C,D,F,G,H,N,O,P,Q,U',STORES_SHEET_ID),
          fetchSheet('GRN_No','SELECT A,B,C,F,G,H',STORES_SHEET_ID),
        ]);
        const gMap={};
        grn.forEach(r=>{const u=(r['UUID']||'').trim();if(u)gMap[u]={grnNo:r['GRN No (Goods Receipt)']||'',receivedOn:r['Received On (At)']||''};});
        _rptRawData.stockin = si.map(r=>{const cs=(r['CheckSum']||r['UUID']||'').trim();const g=gMap[cs]||{};return{siId:r['SI ID']||'',siteName:r['Site Name']||r['D']||'',poNo:r['PO No']||r['F']||'',vendor:r['Vendor Name']||r['G']||'',invNo:r['Invoice No / ST No']||r['H']||'',partDesc:r['Part Description']||r['N']||'',mrQty:r['MR Qty']||r['O']||'',invQty:r['Invoice Qty']||r['P']||'',grnQty:r['GRN Qty']||r['Q']||'',grnNo:g.grnNo||'',receivedOn:g.receivedOn||r['Received On (At)']||''};});
      }
      rows = _rptRawData.stockin;
      if (site)   rows = rows.filter(r=>r.siteName===site);
      if (vendor) rows = rows.filter(r=>r.vendor.toLowerCase().includes(vendor.toLowerCase()));
      _rptResultRows = rows.map(r=>({'GRN No':r.grnNo||'Pending','SI ID':r.siId,'Site':r.siteName,'PO No':r.poNo,'Vendor':r.vendor,'Invoice/ST No':r.invNo,'Part Description':r.partDesc,'MR Qty':r.mrQty,'Invoice Qty':r.invQty,'GRN Qty':r.grnQty,'Received On':r.receivedOn?fmtDate(r.receivedOn):''}));
      rptRenderTable(['GRN No','SI ID','Site','PO No','Vendor','Invoice/ST No','Part Description','MR Qty','Invoice Qty','GRN Qty','Received On']);
    }

    // ── EMPLOYEE HEADCOUNT ─────────────────────────────────
    else if (id === 'emp_headcount') {
      rows = (STATE.masters.users||[]).filter(u=>u.status==='ACTIVE');
      if (site) rows = rows.filter(u=>u.site===site);
      if (dept) rows = rows.filter(u=>u.dept===dept);
      _rptResultRows = rows.map(u=>({'Emp Code':u.empCode||'','Name':u.name||'','Designation':u.desig||'','Department':u.dept||'','Site':u.site||'','Type':u.empType||'','Grade':u.grade||'','DOJ':u.doj?fmtDate(u.doj):''}));
      rptRenderTable(['Emp Code','Name','Designation','Department','Site','Type','Grade','DOJ']);
    }

    // ── EQUIPMENT DEPLOYMENT ───────────────────────────────
    else if (id === 'equipment_deployment') {
      rows = STATE.masters.assets||[];
      if (site)     rows = rows.filter(a=>a.site===site);
      if (category) rows = rows.filter(a=>a.category===category);
      if (ownHire)  rows = rows.filter(a=>(a.ownHire||'').toLowerCase()===ownHire.toLowerCase());
      _rptResultRows = rows.map(a=>({'Asset Name':a.name||'','Asset Code':a.code||'','Category':a.category||'','Site':a.site||'','Own/Hire':a.ownHire||'','Status':a.status||''}));
      rptRenderTable(['Asset Name','Asset Code','Category','Site','Own/Hire','Status']);
    }

    // ── ONBOARDING STATUS ──────────────────────────────────
    else if (id === 'onboarding_status') {
      const days = parseInt((period||'90').match(/\d+/)?.[0]||'90');
      const today = new Date(); today.setHours(0,0,0,0);
      rows = (STATE.masters.users||[]).filter(u=>{
        if(u.status!=='ACTIVE') return false;
        const doj=parsePODate(u.doj||'');
        return doj && (today-doj)<=days*86400000;
      });
      if (site) rows = rows.filter(u=>u.site===site);
      _rptResultRows = rows.map(u=>{
        const doj=parsePODate(u.doj||'');
        const daysIn=doj?Math.floor((today-doj)/86400000):null;
        const checks=JSON.parse(sessionStorage.getItem('ob_'+(u.id||u.empId||u.name))||'{}');
        const done=Object.keys(checks).filter(k=>checks[k]).length;
        return {'Emp Code':u.empCode||'','Name':u.name||'','Site':u.site||'','Dept':u.dept||'','DOJ':u.doj?fmtDate(u.doj):'','Days Since Joining':daysIn??'','Onboarding Steps Done':done+'/12','Status':done>=12?'Complete':'In Progress'};
      });
      rptRenderTable(['Emp Code','Name','Site','Dept','DOJ','Days Since Joining','Onboarding Steps Done','Status']);
    }

    // ── VENDOR INVOICE STATUS ──────────────────────────────
    else if (id === 'vendor_invoice') {
      if (!_rptRawData.invoice) {
        _rptRawData.invoice = await fetchSheet('Invoice','SELECT A,B,C,D,G,H,I',PO_SHEET_ID);
      }
      rows = _rptRawData.invoice.filter(r=>(r['Invoice No']||r['B']||'').trim()!=='');
      if (vendor) rows = rows.filter(r=>(r['Vendor Name']||r['G']||'').toLowerCase().includes(vendor.toLowerCase()));
      if (stINV)  rows = rows.filter(r=>(r['Payment Status']||r['I']||'').toLowerCase()===stINV.toLowerCase());
      _rptResultRows = rows.map(r=>({'Invoice No':r['Invoice No']||r['B']||'','Invoice Date':r['Invoice Date']||r['C']||'','PO No':r['PO No']||r['D']||'','Vendor':r['Vendor Name']||r['G']||'','Invoice Amount':r['Invoice Amount']||r['H']||'','Payment Status':r['Payment Status']||r['I']||''}));
      rptRenderTable(['Invoice No','Invoice Date','PO No','Vendor','Invoice Amount','Payment Status']);
    }

  } catch(err) {
    results.innerHTML = `<div style="padding:1.5rem;background:#fff3cd;border-radius:10px;color:#856404">⚠️ Error loading report: ${err.message}</div>`;
    console.error('Report error:', err);
  }
};

function rptRenderTable(cols) {
  const results = document.getElementById('rpt-results');
  const badge   = document.getElementById('rpt-result-badge');
  const dlBtn   = document.getElementById('rpt-dl-btn');
  const n = _rptResultRows.length;

  if (badge) { badge.innerHTML = `<strong>${n}</strong> record${n!==1?'s':''}`;  badge.style.display = ''; }
  if (dlBtn) dlBtn.style.display = '';

  if (!n) {
    results.innerHTML = `<div style="text-align:center;padding:2.5rem;background:#f0f4f1;border-radius:12px;color:var(--txt3)">
      <div style="font-size:2rem;margin-bottom:.5rem">🔍</div>
      <div style="font-weight:600">No records found</div>
      <div style="font-size:.82rem;margin-top:.3rem">Try adjusting your filters</div>
    </div>`;
    return;
  }

  // Format numbers nicely in the table
  const fmtCell = (col, val) => {
    if (col === 'Amount' || col.includes('Amount') || col === 'Total Amount' || col === 'Approved Amount' || col === 'Pending Amount') {
      const n = parseFloat(val);
      return isNaN(n) ? val : fmtAmt(n);
    }
    return val ?? '—';
  };

  results.innerHTML = `
  <div class="card">
    <div class="card-body" style="padding:0;overflow-x:auto">
      <table class="emp-table" id="rpt-table">
        <thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead>
        <tbody>
          ${_rptResultRows.map(row=>`<tr>${cols.map(c=>`<td style="font-size:.8rem;white-space:nowrap">${fmtCell(c, row[c]??'—')}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;

  makeTableSortable(document.getElementById('rpt-table')); wrapTableScroll(document.getElementById('rpt-table'));
}

window.rptDownload = function() {
  if (!_rptResultRows.length) return;
  const report = REPORT_CATALOGUE.find(r=>r.id===_rptSelectedId);
  downloadCSV(_rptResultRows, `${report?.id||'report'}_${new Date().toISOString().slice(0,10)}.csv`);
};

// ══════════════════════════════════════════════════════════
//  PHASE 4 — PROCUREMENT STORES (StockIN + GRN + Stock Levels)
// ══════════════════════════════════════════════════════════
let _pstStockIN    = [];   // all StockIN rows
let _pstGRNMap     = {};   // UUID → { grnNo, site, poNo, ... }
let _pstLevels     = [];   // v3StockLevels rows
let _pstLoaded     = false;
let _pstActiveTab  = 'stockin';
let _pstSiteFilter = '';

function renderProcurementStores() {
  const el = document.getElementById('mainContent');
  // Procurement Stores always shows the complete cross-site list — reset any filter
  _pstSiteFilter = '';
  el.innerHTML = `
  <div class="page-header">
    <div>
      <div class="page-title">🏪 Stores</div>
      <div class="page-sub">Stock IN · GRN Register · Site Stock Levels</div>
    </div>
    <button class="btn btn-primary btn-sm" onclick="pstRefresh()" id="pst-refresh-btn" style="height:36px">🔄 Refresh</button>
  </div>

  <div id="pst-sheet-warn" style="display:none;background:#fff8e1;border:1px solid #f0a500;border-radius:10px;padding:.85rem 1.1rem;margin-bottom:1.1rem;font-size:.82rem;color:#7a5000">
    ⚠️ <b>v2_Stores sheet is org-restricted.</b> Ask your admin to set <i>v2_Stores</i> to "Anyone with the link → Viewer" for data to load.
  </div>

  <!-- KPI ROW -->
  <div id="pst-kpi-row" class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:.85rem;margin-bottom:1.1rem"></div>

  <!-- SITE FILTER + TABS -->
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.6rem;margin-bottom:.75rem">
    <div style="display:flex;gap:.4rem;border-bottom:2px solid #e0ece4;flex:1">
      <button class="vpi-tab-btn active" id="pst-tab-stockin"  onclick="pstSwitchTab('stockin')">📥 Stock IN</button>
      <button class="vpi-tab-btn"        id="pst-tab-grn"      onclick="pstSwitchTab('grn')">📦 GRN Register</button>
      <button class="vpi-tab-btn"        id="pst-tab-levels"   onclick="pstSwitchTab('levels')">📊 Stock Levels</button>
    </div>
    <div style="display:flex;gap:.5rem;align-items:center">
      <select id="pst-site-select" onchange="pstSetSite(this.value)"
        style="padding:.38rem .65rem;border:1.5px solid #cce3d4;border-radius:8px;font-size:.82rem;font-family:inherit;outline:none;background:#fff">
        <option value="">All Sites</option>
      </select>
      <input type="text" id="pst-search" placeholder="Search…"
        style="padding:.38rem .65rem;border:1.5px solid #cce3d4;border-radius:8px;font-size:.82rem;font-family:inherit;outline:none;width:160px"
        oninput="pstSearch(this.value)" />
    </div>
  </div>

  <div id="pst-loading" style="text-align:center;padding:3rem;color:var(--txt3)">
    <div style="font-size:2rem;margin-bottom:.5rem">⏳</div><div>Loading stores data…</div>
  </div>
  <div id="pst-tab-content" style="display:none"></div>`;

  if (!document.getElementById('vpi-styles')) {
    const s = document.createElement('style');
    s.id = 'vpi-styles';
    s.textContent = `
      .vpi-tab-btn { padding:.48rem 1rem;border:none;background:none;font-family:inherit;font-size:.82rem;font-weight:600;color:var(--txt3);cursor:pointer;border-bottom:2.5px solid transparent;margin-bottom:-2px;transition:color .2s }
      .vpi-tab-btn.active { color:var(--green);border-bottom-color:var(--green) }
      .vpi-tab-btn:hover { color:var(--green) }
      /* vpi-tbl styles unified in global CSS */
      .vpi-status-pill { display:inline-block;padding:.18rem .55rem;border-radius:20px;font-size:.72rem;font-weight:700 }
    `;
    document.head.appendChild(s);
  }

  pstLoad();
}

async function pstLoad() {
  document.getElementById('pst-loading').style.display = 'block';
  document.getElementById('pst-tab-content').style.display = 'none';

  const [stockRows, grnRows, levelRows] = await Promise.all([
    fetchSheet('StockIN', 'SELECT A,B,C,D,E,F,G,H,K,L,M,N,O,P,Q,U,V,W', STORES_SHEET_ID),
    fetchSheet('GRN_No',  'SELECT A,B,C,D,E,F,G,H,I,J,K,L,M', STORES_SHEET_ID),
    fetchSheet('v3StockLevels', 'SELECT A,B,C,D,E,F,G,H', STORES_SHEET_ID),
  ]);

  if (!stockRows.length && !levelRows.length) {
    // Only warn if GRN_No also returned nothing — genuine access error
    // If sheets are shared correctly, at least GRN_No should have rows
    const grnAlsoEmpty = grnRows.length === 0;
    if (grnAlsoEmpty) {
      document.getElementById('pst-sheet-warn').style.display = 'block';
    }
  }

  _pstStockIN = stockRows.filter(r => (r['UUID'] || r['SI ID'] || '').trim() !== '');
  _pstLevels  = levelRows.filter(r => (r['SNo'] || r['Site & Code'] || '').trim() !== '');

  // Build GRN lookup map (UUID → GRN details)
  _pstGRNMap = {};
  grnRows.forEach(r => {
    const uuid = (r['UUID'] || '').trim();
    if (uuid) _pstGRNMap[uuid] = {
      grnNo:      r['GRN No (Goods Receipt)'] || r['GRN No'] || '',
      site:       r['Site Name'] || '',
      type:       r['Invoice / Stock Trans'] || '',
      poKey:      r['PO No (Key)'] || '',
      poNo:       r['PO No'] || '',
      vendorId:   r['Vendor Name (ID)'] || '',
      vendorDet:  r['Vendor Details'] || '',
      stNo:       r['ST No'] || '',
      invNo:      r['Invoice No / ST'] || '',
      invDate:    r['Invoice / DC Copy'] || '',
      receivedOn: r['Received On (At)'] || '',
    };
  });

  _pstLoaded = true;

  // Populate site filter dropdown
  const sites = [...new Set(_pstStockIN.map(r => r['Site Name']).filter(Boolean))].sort();
  const sel = document.getElementById('pst-site-select');
  if (sel) {
    sel.innerHTML = '<option value="">All Sites</option>' +
      sites.map(s => `<option value="${s}">${s}</option>`).join('');
    if (_pstSiteFilter) sel.value = _pstSiteFilter;
  }

  pstUpdateKPIs();
  document.getElementById('pst-loading').style.display = 'none';
  document.getElementById('pst-tab-content').style.display = 'block';
  pstRenderTab();
}

function pstRefresh() {
  _pstLoaded = false;
  pstLoad();
}

window.pstDownloadCSV = function(tab) {
  const site = _pstSiteFilter;
  const q    = (document.getElementById('pst-search')?.value || '').toLowerCase();
  if (tab === 'stockin') {
    const rows = pstFilteredStockIN(q);
    downloadCSV(rows.map(r => ({
      'GRN No': r._grnNo || '', 'SI ID': r['SI ID'] || '', 'Site': r['Site Name'] || '',
      'Type': r['Invoice / Stock Transfer'] || '', 'PO No': r['PO No'] || '',
      'Vendor': r['Vendor Name'] || '', 'Invoice/ST No': r['Invoice No / ST No'] || '',
      'Part Description': r['Part Description'] || r['Part Details'] || '',
      'MR No': r['MR No'] || '', 'MR Qty': r['MR Qty'] || '',
      'Invoice Qty': r['Invoice Qty'] || '', 'GRN Qty': r['GRN Qty'] || '',
      'Received On': (r._grnReceivedOn || '').split(' ')[0],
    })), `StockIN_${site||'all'}_${new Date().toISOString().slice(0,10)}.csv`);
  } else if (tab === 'grn') {
    const base = site ? _pstStockIN.filter(r => r['Site Name'] === site) : _pstStockIN;
    const byGRN = {};
    base.forEach(r => {
      const cs = (r['CheckSum'] || r['UUID'] || '').trim();
      const g  = _pstGRNMap[cs] || {};
      const key = g.grnNo || '(Pending GRN)';
      if (!byGRN[key]) byGRN[key] = { 'GRN No': key, 'Site': g.site || r['Site Name'] || '', 'PO No': g.poNo || '', 'Vendor': g.vendorDet || r['Vendor Name'] || '', 'Invoice/ST No': g.invNo || '', 'Line Items': 0, 'Total GRN Qty': 0, 'Received On': (g.receivedOn || '').split(' ')[0] };
      byGRN[key]['Line Items']++;
      byGRN[key]['Total GRN Qty'] += parseFloat(r['GRN Qty'] || 0);
    });
    downloadCSV(Object.values(byGRN), `GRNRegister_${site||'all'}_${new Date().toISOString().slice(0,10)}.csv`);
  } else if (tab === 'levels') {
    const rows = (site ? _pstLevels.filter(r => r['Site Name'] === site) : _pstLevels)
      .filter(r => !q || (r['Part Details'] || r['Site & Code'] || '').toLowerCase().includes(q) || (r['Site Name'] || '').toLowerCase().includes(q));
    downloadCSV(rows.map(r => ({
      'SNo': r['SNo'] || '', 'Site': r['Site Name'] || '', 'Part Details': r['Part Details'] || r['Site & Code'] || '',
      'Stock IN': r['StockIN'] || '0', 'Stock Transfer': r['Stock Transfer (To)'] || '0',
      'Stock Out': r['Stock Out'] || '0', 'Site Stock': r['Site Stock'] || '0',
    })), `StockLevels_${site||'all'}_${new Date().toISOString().slice(0,10)}.csv`);
  }
};

function pstSetSite(v) {
  _pstSiteFilter = v;
  const si = document.getElementById('pst-search');
  if (si) si.value = '';
  pstUpdateKPIs();
  pstRenderTab();
}

function pstSearch(q) {
  pstRenderTab(q);
}

function pstSwitchTab(t) {
  _pstActiveTab = t;
  ['stockin','grn','levels'].forEach(x =>
    document.getElementById('pst-tab-' + x)?.classList.toggle('active', x === t));
  const si = document.getElementById('pst-search');
  if (si) si.value = '';
  pstRenderTab();
}

function pstFilteredStockIN(q) {
  let rows = _pstSiteFilter
    ? _pstStockIN.filter(r => r['Site Name'] === _pstSiteFilter)
    : _pstStockIN;
  if (q) {
    const lq = q.toLowerCase();
    rows = rows.filter(r =>
      (r['Part Description'] || r['Part Details'] || '').toLowerCase().includes(lq) ||
      (r['Vendor Name'] || '').toLowerCase().includes(lq) ||
      (r['PO No'] || '').toLowerCase().includes(lq) ||
      (r['Invoice No / ST No'] || '').toLowerCase().includes(lq) ||
      (r['MR No'] || '').toLowerCase().includes(lq) ||
      (r['SI ID'] || '').toLowerCase().includes(lq)
    );
  }
  // Enrich with GRN
  return rows.map(r => {
    const cs = (r['CheckSum'] || r['UUID'] || '').trim();
    const g  = _pstGRNMap[cs] || {};
    return { ...r, _grnNo: g.grnNo || '', _grnReceivedOn: g.receivedOn || r['Received On (At)'] || '' };
  }).sort((a, b) => new Date(b._grnReceivedOn||0) - new Date(a._grnReceivedOn||0));
}

function pstUpdateKPIs() {
  const rows = _pstSiteFilter ? _pstStockIN.filter(r => r['Site Name'] === _pstSiteFilter) : _pstStockIN;
  const enriched = rows.map(r => {
    const cs = (r['CheckSum'] || r['UUID'] || '').trim();
    return { ...r, _grnNo: (_pstGRNMap[cs] || {}).grnNo || '' };
  });
  const totalSI    = rows.length;
  const totalGRNs  = new Set(enriched.map(r => r._grnNo).filter(Boolean)).size;
  const pendingGRN = enriched.filter(r => !r._grnNo).length;
  const sites      = new Set(rows.map(r => r['Site Name']).filter(Boolean)).size;
  const lvlRows    = _pstSiteFilter ? _pstLevels.filter(r => r['Site Name'] === _pstSiteFilter) : _pstLevels;
  const totalStock = lvlRows.reduce((s, r) => s + parseFloat(r['Site Stock'] || r['StockIN'] || 0), 0);

  document.getElementById('pst-kpi-row').innerHTML = `
    ${pstKpi('📥','Stock IN Lines', totalSI, '', 'stockin', AS.stockInOut(),'Stock IN / Stock Out')}
    ${pstKpi('📦','GRN Nos', totalGRNs, 'green', 'grn', AS.goodsReceived(),'Goods Received')}
    ${pstKpi('⏳','Pending GRN', pendingGRN, pendingGRN > 0 ? 'gold' : '', 'stockin', AS.pendingStockIn(),'Pending Stock IN')}
    ${pstKpi('🏗️','Sites', _pstSiteFilter ? 1 : sites, '', '', '','') }
    ${pstKpi('📊','Stock Qty', Math.round(totalStock).toLocaleString('en-IN'), '', 'levels', AS.stockLevels(),'Stock Levels')}
  `;
}

function pstKpi(icon, label, val, accent, tab, asUrl, asLabel) {
  const color = accent === 'green' ? '#2e7d32' : accent === 'gold' ? '#b07000' : 'var(--txt1)';
  const clickHandler = tab ? `onclick="pstSwitchTab('${tab}');document.getElementById('pst-tab-content')?.scrollIntoView({behavior:'smooth',block:'start'})"` : '';
  const asLink = asUrl ? `<div style="margin-top:.3rem"><a onclick="event.stopPropagation()" href="javascript:window.open('${asUrl}','_blank')" style="font-size:.65rem;color:#1565c0;text-decoration:none">🚀 ${asLabel}</a></div>` : '';
  return `<div class="kpi-card" style="${tab?'cursor:pointer':''}" ${clickHandler}>
    <div class="kpi-top"><div class="kpi-icon">${icon}</div>${tab?'<div class="kpi-trend flat" style="font-size:.62rem">view ↓</div>':''}</div>
    <div class="kpi-val" style="color:${color}">${val}</div>
    <div class="kpi-label">${label}</div>${asLink}
  </div>`;
}

function pstRenderTab(q) {
  const c = document.getElementById('pst-tab-content');
  if (!c) return;
  if (_pstActiveTab === 'stockin') pstRenderStockIN(c, q || '');
  else if (_pstActiveTab === 'grn')  pstRenderGRNRegister(c, q || '');
  else if (_pstActiveTab === 'levels') pstRenderLevels(c, q || '');
}

/* ── STOCK IN TAB ─────────────────────────────────── */
function pstRenderStockIN(c, q) {
  const rows = pstFilteredStockIN(q);
  if (!rows.length) {
    c.innerHTML = `<div style="text-align:center;padding:2.5rem;color:var(--txt3)">No Stock IN records found${q ? ' for "'+q+'"' : ''}.</div>`;
    return;
  }
  c.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.6rem;gap:.5rem;flex-wrap:wrap">
    <span style="font-size:.8rem;color:var(--txt3)">${rows.length} record${rows.length !== 1 ? 's' : ''}</span>
    <button onclick="window.pstDownloadCSV('stockin')" class="csv-btn">⬇ CSV</button>
  </div>
  <div style="overflow-x:auto;border-radius:10px;border:1px solid #e0ece4">
  <table class="vpi-tbl">
    <thead><tr>
      <th>GRN No</th><th>SI ID</th><th>Site</th><th>Type</th>
      <th>PO No</th><th>Vendor</th><th>Invoice / ST No</th>
      <th>Part Description</th><th>MR No</th>
      <th style="text-align:right">MR Qty</th><th style="text-align:right">Inv Qty</th>
      <th style="text-align:right">GRN Qty</th><th>Received On</th><th>Received By</th>
    </tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td style="font-weight:700;color:var(--green);font-size:.78rem;white-space:nowrap">
        ${r._grnNo || '<span style="color:var(--txt3);font-style:italic;font-size:.73rem">Pending</span>'}
      </td>
      <td style="font-size:.72rem;color:var(--txt3)">${r['SI ID'] || '—'}</td>
      <td style="font-size:.78rem">${r['Site Name'] || '—'}</td>
      <td style="font-size:.74rem"><span style="background:${r['Invoice / Stock Transfer'] === 'Stock Transfer' ? '#e3f2fd' : '#f3e5f5'};color:${r['Invoice / Stock Transfer'] === 'Stock Transfer' ? '#1565c0' : '#6a1b9a'};padding:.12rem .4rem;border-radius:4px">${r['Invoice / Stock Transfer'] || 'Invoice'}</span></td>
      <td style="font-size:.73rem;color:#1565c0">${r['PO No'] || '—'}</td>
      <td style="font-size:.76rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r['Vendor Name'] || '—'}</td>
      <td style="font-size:.73rem">${r['Invoice No / ST No'] || '—'}</td>
      <td style="font-size:.8rem;max-width:160px;white-space:normal">${r['Part Description'] || r['Part Details'] || '—'}</td>
      <td style="font-size:.73rem;color:var(--txt3)">${r['MR No'] || '—'}</td>
      <td style="text-align:right">${r['MR Qty'] || '—'}</td>
      <td style="text-align:right">${r['Invoice Qty'] || '—'}</td>
      <td style="text-align:right;font-weight:700;color:#2e7d32">${r['GRN Qty'] || '—'}</td>
      <td style="white-space:nowrap;font-size:.77rem">${(r._grnReceivedOn || '').split(' ')[0] || '—'}</td>
      <td style="font-size:.76rem;color:var(--txt3)">${r['Received By (At)'] || '—'}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;

  const _t_pstStockIN = (typeof c !== "undefined" ? c : el)?.querySelector(".emp-table, .vpi-tbl");
  if (_t_pstStockIN) { makeTableSortable(_t_pstStockIN); wrapTableScroll(_t_pstStockIN); }
}

/* ── GRN REGISTER TAB ─────────────────────────────── */
function pstRenderGRNRegister(c, q) {
  const base = _pstSiteFilter ? _pstStockIN.filter(r => r['Site Name'] === _pstSiteFilter) : _pstStockIN;

  // Group StockIN by GRN No
  const byGRN = {};
  base.forEach(r => {
    const cs  = (r['CheckSum'] || r['UUID'] || '').trim();
    const g   = _pstGRNMap[cs] || {};
    const key = g.grnNo || '(Pending GRN)';
    if (!byGRN[key]) byGRN[key] = {
      grnNo: key, site: g.site || r['Site Name'] || '', poNo: g.poNo || r['PO No'] || '',
      vendorDet: g.vendorDet || r['Vendor Name'] || '', type: g.type || r['Invoice / Stock Transfer'] || '',
      invNo: g.invNo || r['Invoice No / ST No'] || '', receivedOn: g.receivedOn || r['Received On (At)'] || '',
      lines: 0, totalGRN: 0
    };
    byGRN[key].lines++;
    byGRN[key].totalGRN += parseFloat(r['GRN Qty'] || 0);
  });

  let grnList = Object.values(byGRN).sort((a, b) => new Date(b.receivedOn||0) - new Date(a.receivedOn||0));

  if (q) {
    const lq = q.toLowerCase();
    grnList = grnList.filter(g =>
      g.grnNo.toLowerCase().includes(lq) || g.site.toLowerCase().includes(lq) ||
      g.poNo.toLowerCase().includes(lq)  || g.vendorDet.toLowerCase().includes(lq) ||
      g.invNo.toLowerCase().includes(lq)
    );
  }

  if (!grnList.length) {
    c.innerHTML = `<div style="text-align:center;padding:2.5rem;color:var(--txt3)">No GRN records found${q ? ' for "'+q+'"' : ''}.</div>`;
    return;
  }

  c.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.6rem;gap:.5rem;flex-wrap:wrap">
    <span style="font-size:.8rem;color:var(--txt3)">${grnList.length} GRN${grnList.length !== 1 ? 's' : ''}</span>
    <button onclick="window.pstDownloadCSV('grn')" class="csv-btn">⬇ CSV</button>
  </div>
  <div style="overflow-x:auto;border-radius:10px;border:1px solid #e0ece4">
  <table class="vpi-tbl">
    <thead><tr>
      <th>GRN No</th><th>Type</th><th>Site</th><th>PO No</th>
      <th>Vendor / Supplier</th><th>Invoice / ST No</th>
      <th style="text-align:center">Lines</th><th style="text-align:right">Total GRN Qty</th>
      <th>Received On</th>
    </tr></thead>
    <tbody>${grnList.map(g => `<tr>
      <td style="font-weight:700;color:var(--green);font-size:.82rem;white-space:nowrap">
        ${g.grnNo !== '(Pending GRN)' ? g.grnNo : '<span style="color:var(--txt3);font-style:italic;font-size:.76rem">Pending GRN</span>'}
      </td>
      <td><span style="background:${g.type === 'Stock Transfer' ? '#e3f2fd' : '#f3e5f5'};color:${g.type === 'Stock Transfer' ? '#1565c0' : '#6a1b9a'};padding:.12rem .4rem;border-radius:4px;font-size:.73rem">${g.type || 'Invoice'}</span></td>
      <td style="font-size:.78rem">${g.site || '—'}</td>
      <td style="font-size:.74rem;color:#1565c0">${g.poNo || '—'}</td>
      <td style="font-size:.77rem;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${g.vendorDet || '—'}</td>
      <td style="font-size:.74rem">${g.invNo || '—'}</td>
      <td style="text-align:center;font-weight:600">${g.lines}</td>
      <td style="text-align:right;font-weight:700;color:#2e7d32;font-size:.88rem">${g.totalGRN}</td>
      <td style="white-space:nowrap;font-size:.78rem">${(g.receivedOn || '').split(' ')[0] || '—'}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;

  const _t_pstGRN = (typeof c !== "undefined" ? c : el)?.querySelector(".emp-table, .vpi-tbl");
  if (_t_pstGRN) { makeTableSortable(_t_pstGRN); wrapTableScroll(_t_pstGRN); }
}

/* ── STOCK LEVELS TAB ─────────────────────────────── */
function pstRenderLevels(c, q) {
  let rows = _pstSiteFilter
    ? _pstLevels.filter(r => r['Site Name'] === _pstSiteFilter)
    : _pstLevels;

  if (q) {
    const lq = q.toLowerCase();
    rows = rows.filter(r =>
      (r['Part Details'] || r['Site & Code'] || '').toLowerCase().includes(lq) ||
      (r['Site Name'] || '').toLowerCase().includes(lq)
    );
  }

  if (!rows.length) {
    c.innerHTML = `<div style="text-align:center;padding:2.5rem;color:var(--txt3)">No stock level records found${q ? ' for "'+q+'"' : ''}.</div>`;
    return;
  }

  // Site summary for summary bar
  const bySite = {};
  rows.forEach(r => {
    const site = r['Site Name'] || 'Unknown';
    if (!bySite[site]) bySite[site] = { site, items: 0, totalStock: 0 };
    bySite[site].items++;
    bySite[site].totalStock += parseFloat(r['Site Stock'] || r['StockIN'] || 0);
  });
  const siteList = Object.values(bySite).sort((a, b) => b.totalStock - a.totalStock).slice(0, 5);

  c.innerHTML = `
  ${!_pstSiteFilter ? `
  <div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:1rem">
    ${siteList.map(s => `<div style="background:#f0f4f1;border-radius:8px;padding:.45rem .85rem;font-size:.79rem">
      <span style="font-weight:600">${s.site}</span>
      <span style="color:var(--txt3);margin-left:.4rem">${s.items} items · </span>
      <span style="font-weight:700;color:#2e7d32">${Math.round(s.totalStock).toLocaleString('en-IN')} units</span>
    </div>`).join('')}
    ${Object.keys(bySite).length > 5 ? `<div style="background:#f0f4f1;border-radius:8px;padding:.45rem .85rem;font-size:.79rem;color:var(--txt3)">+${Object.keys(bySite).length - 5} more sites</div>` : ''}
  </div>` : ''}

  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.6rem;gap:.5rem;flex-wrap:wrap">
    <span style="font-size:.8rem;color:var(--txt3)">${rows.length} item${rows.length !== 1 ? 's' : ''}</span>
    <button onclick="window.pstDownloadCSV('levels')" class="csv-btn">⬇ CSV</button>
  </div>
  <div style="overflow-x:auto;border-radius:10px;border:1px solid #e0ece4">
  <table class="vpi-tbl">
    <thead><tr>
      <th>#</th><th>Site</th><th>Part Details</th>
      <th style="text-align:right">Stock IN</th>
      <th style="text-align:right">Stock Transfer</th>
      <th style="text-align:right">Stock Out</th>
      <th style="text-align:right;background:#e8f5e9;color:#2e7d32">Site Stock</th>
    </tr></thead>
    <tbody>${rows.map((r, i) => {
      const stock = parseFloat(r['Site Stock'] || r['StockIN'] || 0);
      const stockColor = stock <= 0 ? '#c62828' : stock <= 2 ? '#b07000' : '#2e7d32';
      return `<tr>
        <td style="color:var(--txt3);font-size:.74rem">${r['SNo'] || i + 1}</td>
        <td style="font-size:.78rem">${r['Site Name'] || '—'}</td>
        <td style="font-size:.8rem;max-width:200px;white-space:normal">${r['Part Details'] || r['Site & Code'] || '—'}</td>
        <td style="text-align:right">${r['StockIN'] || '0'}</td>
        <td style="text-align:right">${r['Stock Transfer (To)'] || '0'}</td>
        <td style="text-align:right">${r['Stock Out'] || '0'}</td>
        <td style="text-align:right;font-weight:700;color:${stockColor};background:#f9fef9">${stock}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;

  const _t_pstLevels = (typeof c !== "undefined" ? c : el)?.querySelector(".emp-table, .vpi-tbl");
  if (_t_pstLevels) { makeTableSortable(_t_pstLevels); wrapTableScroll(_t_pstLevels); }
}

// ══════════════════════════════════════════════════════════
//  PHASE 4 — INTERNAL VENDOR PORTAL
// ══════════════════════════════════════════════════════════
let _vpiVendors = [];       // from VendorMaster
let _vpiSelected = null;    // { name, code, id }
let _vpiPayments = [];      // from PaymentRequest
let _vpiStockIN  = [];      // from StockIN
let _vpiGRNMap   = {};      // CheckSum → { grnNo, site, poNo, invNo, receivedOn }
let _vpiActiveTab = 'ledger';

function renderVendorPortalInternal() {
  const el = document.getElementById('mainContent');
  el.innerHTML = `
  <div class="page-header">
    <div>
      <div class="page-title">🏢 Vendor Portal <span style="font-size:.75rem;color:var(--txt3);font-family:'DM Sans',sans-serif;font-weight:400">(Internal)</span></div>
      <div class="page-sub">Ledger · Payments · GRN — for Procurement & Accounts team</div>
    </div>
  </div>

  <!-- SHEET ACCESS WARNING -->
  <div id="vpi-sheet-warn" style="display:none;background:#fff8e1;border:1px solid #f0a500;border-radius:10px;padding:.85rem 1.1rem;margin-bottom:1.1rem;font-size:.82rem;color:#7a5000;display:flex;align-items:center;gap:.6rem">
    ⚠️ <span>One or more data sheets may be restricted. Ask your admin to set <b>Account View</b> and <b>v2_Stores</b> sheets to <i>"Anyone with the link can view"</i> for data to load.</span>
  </div>

  <!-- VENDOR SELECTOR PANEL -->
  <div id="vpi-selector-panel" class="card" style="padding:1.2rem 1.4rem;margin-bottom:1.2rem">
    <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
      <div style="flex:1;min-width:220px">
        <div style="font-size:.78rem;color:var(--txt3);margin-bottom:.35rem;font-weight:600">SELECT VENDOR</div>
        <div style="display:flex;gap:.5rem">
          <input id="vpi-search" type="text" placeholder="Search by name or code…"
            style="flex:1;padding:.52rem .75rem;border:1.5px solid #cce3d4;border-radius:8px;font-size:.85rem;font-family:inherit;outline:none"
            oninput="vpiFilterVendors(this.value)" />
          <button class="btn btn-primary btn-sm" onclick="vpiLoadData()" style="white-space:nowrap">▶ Load</button>
        </div>
        <div id="vpi-suggest" style="position:absolute;z-index:99;background:#fff;border:1px solid #dde8e2;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.1);max-height:220px;overflow-y:auto;min-width:280px;display:none"></div>
      </div>
      <div id="vpi-selected-badge" style="display:none;background:#e8f5e9;border:1.5px solid #66bb6a;border-radius:10px;padding:.5rem .9rem;font-size:.84rem;font-weight:600;color:#1a6038"></div>
    </div>
  </div>

  <!-- KPI ROW -->
  <div id="vpi-kpi-row" style="display:none;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:.85rem;margin-bottom:1.1rem;display:none" class="kpi-grid"></div>

  <!-- TABS -->
  <div id="vpi-tabs" style="display:none">
    <div style="display:flex;gap:.4rem;border-bottom:2px solid #e0ece4;margin-bottom:1rem">
      <button class="vpi-tab-btn active" id="vpi-tab-ledger" onclick="vpiSwitchTab('ledger')">💳 Payment Ledger</button>
      <button class="vpi-tab-btn" id="vpi-tab-grn" onclick="vpiSwitchTab('grn')">📦 GRN / Stock IN</button>
      <button class="vpi-tab-btn" id="vpi-tab-invoices" onclick="vpiSwitchTab('invoices')">🧾 Invoices</button>
    </div>
    <div id="vpi-tab-content"></div>
  </div>

  <!-- LOADING -->
  <div id="vpi-loading" style="display:none;text-align:center;padding:3rem;color:var(--txt3)">
    <div style="font-size:2rem;margin-bottom:.5rem">⏳</div>
    <div>Loading vendor data…</div>
  </div>

  <!-- EMPTY STATE -->
  <div id="vpi-empty" style="display:none;text-align:center;padding:3rem;color:var(--txt3)">
    <div style="font-size:2.5rem;margin-bottom:.5rem">🔍</div>
    <div>Search and load a vendor to view their ledger</div>
  </div>`;

  // Tab styles
  if (!document.getElementById('vpi-styles')) {
    const s = document.createElement('style');
    s.id = 'vpi-styles';
    s.textContent = `
      .vpi-tab-btn { padding:.48rem 1rem;border:none;background:none;font-family:inherit;font-size:.82rem;font-weight:600;color:var(--txt3);cursor:pointer;border-bottom:2.5px solid transparent;margin-bottom:-2px;transition:color .2s }
      .vpi-tab-btn.active { color:var(--green);border-bottom-color:var(--green) }
      .vpi-tab-btn:hover { color:var(--green) }
      /* vpi-tbl styles unified in global CSS */
      .vpi-status-pill { display:inline-block;padding:.18rem .55rem;border-radius:20px;font-size:.72rem;font-weight:700 }
    `;
    document.head.appendChild(s);
  }

  document.getElementById('vpi-empty').style.display = 'block';

  // Load vendor list
  fetchSheet('7-VendorMaster', 'SELECT A,B,C,D,E', SHEET_ID).then(rows => {
    _vpiVendors = rows.filter(r => r['Vendor Name'] || r['Vendor ID']).map(r => ({
      id:    r['Vendor ID'] || r[Object.keys(r)[0]] || '',
      name:  r['Vendor Name'] || r[Object.keys(r)[1]] || '',
      code:  r['Vendor Code'] || r['Vendor ID'] || '',
      type:  r['Vendor Type'] || '',
      city:  r['City'] || '',
    }));
  });
}

function vpiFilterVendors(q) {
  const suggest = document.getElementById('vpi-suggest');
  if (!q || q.length < 2) { suggest.style.display = 'none'; return; }
  const lower = q.toLowerCase();
  const matches = _vpiVendors.filter(v =>
    v.name.toLowerCase().includes(lower) || v.id.toLowerCase().includes(lower) || v.code.toLowerCase().includes(lower)
  ).slice(0, 10);

  if (!matches.length) { suggest.style.display = 'none'; return; }
  suggest.innerHTML = matches.map(v => `
    <div onclick="vpiSelectVendor('${v.id.replace(/'/g,"\\'")}','${v.name.replace(/'/g,"\\'")}')"
      style="padding:.55rem .9rem;cursor:pointer;border-bottom:1px solid #f0f4f1;display:flex;flex-direction:column"
      onmouseover="this.style.background='#f0f4f1'" onmouseout="this.style.background=''">
      <span style="font-weight:600;font-size:.84rem">${v.name}</span>
      <span style="font-size:.74rem;color:var(--txt3)">${v.id}${v.city ? ' · ' + v.city : ''}</span>
    </div>`).join('');
  suggest.style.display = 'block';
}

function vpiSelectVendor(id, name) {
  _vpiSelected = { id, name };
  document.getElementById('vpi-search').value = name;
  document.getElementById('vpi-suggest').style.display = 'none';
  const badge = document.getElementById('vpi-selected-badge');
  badge.innerHTML = `🏢 <span>${name}</span> <span style="font-size:.75rem;color:var(--txt3);font-weight:400">${id}</span>`;
  badge.style.display = 'flex';
  badge.style.gap = '.5rem';
  badge.style.alignItems = 'center';
}

async function vpiLoadData() {
  if (!_vpiSelected) {
    const q = document.getElementById('vpi-search').value.trim();
    if (!q) { alert('Please search and select a vendor first'); return; }
    // Try exact name match
    const match = _vpiVendors.find(v => v.name.toLowerCase() === q.toLowerCase() || v.id.toLowerCase() === q.toLowerCase());
    if (match) vpiSelectVendor(match.id, match.name);
    else { _vpiSelected = { id: q, name: q }; }
  }

  const vName = _vpiSelected.name;
  const vId   = _vpiSelected.id;

  // Show loading
  document.getElementById('vpi-empty').style.display = 'none';
  document.getElementById('vpi-kpi-row').style.display = 'none';
  document.getElementById('vpi-tabs').style.display = 'none';
  document.getElementById('vpi-loading').style.display = 'block';

  // Fetch PaymentRequest (columns: F=Date, G=Initiator, H=PaymentTo, K=VendorCode, L=Site, N=OrderNo, O=BillNo, Q=POValue, R=InvoiceValue, S=PaidValue, T=PendingValue, W=Amount, AC=AccountsStatus, AD=AccountsDate, AE=UTR, AG=Status)
  const [payments, stockRows, grnRows] = await Promise.all([
    fetchSheet('PaymentRequest',
      'SELECT A,F,G,H,K,L,N,O,Q,R,S,T,W,X,AC,AD,AE,AG WHERE H IS NOT NULL',
      PAYMENT_SHEET_ID
    ),
    fetchSheet('StockIN',
      'SELECT A,C,D,F,G,H,K,L,M,N,O,P,Q,U,V,W',
      STORES_SHEET_ID
    ),
    fetchSheet('GRN_No',
      'SELECT A,B,C,F,G,J,M',
      STORES_SHEET_ID
    )
  ]);

  // Filter to this vendor
  const nameLower = vName.toLowerCase();
  const idLower   = vId.toLowerCase();

  _vpiPayments = payments.filter(r => {
    const pt = (r['Payment To'] || '').toLowerCase();
    const kc = (r['Paid To'] || r['paidTo'] || '').toLowerCase();
    return pt.includes(nameLower) || pt.includes(idLower) || kc.includes(idLower) || kc === idLower;
  }).filter(r => (r['Order No'] || '').trim() !== ''); // only vendor payments (have order no)

  _vpiStockIN = stockRows.filter(r => {
    const vn = (r['Vendor Name'] || '').toLowerCase();
    return vn.includes(nameLower) || vn.includes(idLower);
  });

  // Build GRN lookup: CheckSum in StockIN → UUID in GRN_No
  // GRN_No cols: A=UUID, B=GRN No, C=Site, F=PO No, G=Vendor (ID), J=Invoice No/ST, M=Received On
  _vpiGRNMap = {};
  grnRows.forEach(r => {
    const uuid  = (r['UUID'] || '').trim();
    const vn    = (r['Vendor Name (ID)'] || r['Vendor Name'] || '').toLowerCase();
    if (!uuid) return;
    // Include all GRN rows — we'll join to StockIN via CheckSum=UUID
    _vpiGRNMap[uuid] = {
      grnNo:      r['GRN No (Goods Receipt)'] || r['GRN No'] || '',
      site:       r['Site Name'] || '',
      poNo:       r['PO No'] || '',
      invNo:      r['Invoice No / ST'] || r['Invoice No/ST'] || '',
      receivedOn: r['Received On (At)'] || '',
    };
  });

  document.getElementById('vpi-loading').style.display = 'none';

  if (!_vpiPayments.length && !_vpiStockIN.length && !grnRows.length) {
    document.getElementById('vpi-sheet-warn').style.display = 'flex';
  } else {
    document.getElementById('vpi-sheet-warn').style.display = 'none';
  }

  // KPIs
  const totalPO  = _vpiPayments.reduce((s, r) => s + parseFloat(r['PO Value'] || r['Amount'] || 0), 0);
  const totalInv = _vpiPayments.reduce((s, r) => s + parseFloat(r['Invoice Value'] || 0), 0);
  const totalPaid= _vpiPayments.reduce((s, r) => s + parseFloat(r['Paid Value'] || 0), 0);
  const totalPend= _vpiPayments.reduce((s, r) => s + parseFloat(r['Pending Value'] || 0), 0);
  const totalGRN = new Set(_vpiStockIN.map(r => {
    const grn = _vpiGRNMap[(r['CheckSum'] || r['UUID'] || '').trim()];
    return grn ? grn.grnNo : null;
  }).filter(Boolean)).size || _vpiStockIN.length;

  const kpiRow = document.getElementById('vpi-kpi-row');
  kpiRow.innerHTML = `
    ${vpiKpi('💰', 'PO Value', fmtAmt(totalPO), '', 'ledger', AS.purchase(), 'Purchase View')}
    ${vpiKpi('🧾', 'Invoiced', fmtAmt(totalInv), '', 'invoices', AS.invoiceTransport(), 'Invoice & Transport')}
    ${vpiKpi('✅', 'Paid', fmtAmt(totalPaid), 'green', 'ledger', AS.poAccounts(), 'POs → Accounts')}
    ${vpiKpi('⏳', 'Pending', fmtAmt(totalPend), totalPend > 0 ? 'gold' : '', 'ledger', AS.poApproval(), 'PO Approval')}
    ${vpiKpi('📦', 'GRN Entries', totalGRN, '', 'grn', AS.goodsReceived(), 'Goods Received')}
  `;
  kpiRow.style.display = 'grid';

  document.getElementById('vpi-tabs').style.display = 'block';
  _vpiActiveTab = 'ledger';
  vpiUpdateTabUI();
  vpiRenderTabContent();
}

function vpiKpi(icon, label, val, accent, tab, asUrl, asLabel) {
  const color = accent === 'green' ? '#2e7d32' : accent === 'gold' ? '#b07000' : 'var(--txt1)';
  const clickHandler = tab ? `onclick="vpiSwitchTab('${tab}')"` : '';
  const asLink = asUrl ? `<div style="margin-top:.3rem"><a onclick="event.stopPropagation()" href="javascript:window.open('${asUrl}','_blank')" style="font-size:.65rem;color:#1565c0;text-decoration:none">🚀 ${asLabel}</a></div>` : '';
  return `<div class="kpi-card" style="${tab?'cursor:pointer':''}" ${clickHandler}>
    <div class="kpi-top"><div class="kpi-icon">${icon}</div>${tab?'<div class="kpi-trend flat" style="font-size:.62rem">view ↓</div>':''}</div>
    <div class="kpi-val" style="color:${color}">${val}</div>
    <div class="kpi-label">${label}</div>${asLink}
  </div>`;
}

window.vpiDownloadCSV = function(tab) {
  if (tab === 'ledger') {
    const q = (document.getElementById('vpi-ledger-filter')?.value || '').toLowerCase();
    const rows = q ? _vpiPayments.filter(r =>
      (r['Order No']||'').toLowerCase().includes(q) || (r['Bill No']||'').toLowerCase().includes(q) ||
      (r['Request ID']||'').toLowerCase().includes(q) || (r['Site Name']||'').toLowerCase().includes(q)
    ) : _vpiPayments;
    downloadCSV(rows.map(r => ({
      'Request ID': r['Request ID'] || '', 'Date': (r['Date Of Request']||'').split(' ')[0],
      'Order No': r['Order No']||'', 'Bill No': r['Bill No']||'', 'Site': r['Site Name']||'',
      'PO Value': r['PO Value']||'', 'Invoice Value': r['Invoice Value']||'',
      'Paid Value': r['Paid Value']||'', 'Pending Value': r['Pending Value']||'',
      'UTR': r['UTR Details']||'', 'Status': r['Status']||r['Accounts Status']||'',
    })), `VendorLedger_${new Date().toISOString().slice(0,10)}.csv`);
  } else if (tab === 'grn') {
    downloadCSV(_vpiStockIN.map(r => {
      const cs = (r['CheckSum']||r['UUID']||'').trim();
      const g  = _vpiGRNMap[cs] || {};
      return { 'GRN No': g.grnNo||'', 'SI ID': r['SI ID']||'', 'Site': r['Site Name']||'',
        'PO No': r['PO No']||'', 'Invoice/ST No': r['Invoice No / ST No']||'',
        'Part Description': r['Part Description']||r['Part Details']||'',
        'MR No': r['MR No']||'', 'MR Qty': r['MR Qty']||'',
        'Invoice Qty': r['Invoice Qty']||'', 'GRN Qty': r['GRN Qty']||'',
        'Received On': (g.receivedOn||r['Received On (At)']||'').split(' ')[0],
      };
    }), `VendorGRN_${new Date().toISOString().slice(0,10)}.csv`);
  } else if (tab === 'invoices') {
    const invRows = _vpiStockIN.filter(r => (r['Invoice No / ST No']||'').trim());
    const byInv = {};
    invRows.forEach(r => {
      const k = (r['Invoice No / ST No']||'').trim();
      if (!byInv[k]) byInv[k] = { 'Invoice/ST No': k, 'PO No': r['PO No']||'', 'Site': r['Site Name']||'', 'Line Items': 0, 'Total GRN Qty': 0, 'Received On': (r['Received On (At)']||'').split(' ')[0] };
      byInv[k]['Line Items']++; byInv[k]['Total GRN Qty'] += parseFloat(r['GRN Qty']||0);
    });
    downloadCSV(Object.values(byInv), `VendorInvoices_${new Date().toISOString().slice(0,10)}.csv`);
  }
};

function vpiSwitchTab(tab) {
  _vpiActiveTab = tab;
  vpiUpdateTabUI();
  vpiRenderTabContent();
}

function vpiUpdateTabUI() {
  ['ledger','grn','invoices'].forEach(t => {
    document.getElementById('vpi-tab-' + t)?.classList.toggle('active', t === _vpiActiveTab);
  });
}

function vpiRenderTabContent() {
  const c = document.getElementById('vpi-tab-content');
  if (_vpiActiveTab === 'ledger') vpiRenderLedger(c);
  else if (_vpiActiveTab === 'grn') vpiRenderGRN(c);
  else if (_vpiActiveTab === 'invoices') vpiRenderInvoices(c);
}

function vpiStatusPill(status) {
  const s = (status || '').toLowerCase();
  let bg = '#f0f4f1', color = '#555';
  if (s.includes('paid') || s.includes('completed')) { bg = '#e8f5e9'; color = '#2e7d32'; }
  else if (s.includes('approved') || s.includes('verified')) { bg = '#e3f2fd'; color = '#1565c0'; }
  else if (s.includes('pending') || s.includes('initiated')) { bg = '#fff8e1'; color = '#b07000'; }
  else if (s.includes('reject') || s.includes('hold')) { bg = '#ffebee'; color = '#c62828'; }
  return `<span class="vpi-status-pill" style="background:${bg};color:${color}">${status || '—'}</span>`;
}

function vpiRenderLedger(c) {
  if (!_vpiPayments.length) {
    c.innerHTML = `<div style="text-align:center;padding:2.5rem;color:var(--txt3)">No payment records found for this vendor.</div>`;
    return;
  }

  // Sort by date desc
  const rows = [..._vpiPayments].sort((a, b) => {
    const da = new Date(a['Date Of Request'] || 0), db = new Date(b['Date Of Request'] || 0);
    return db - da;
  });

  c.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem;flex-wrap:wrap;gap:.5rem">
    <div style="font-size:.82rem;color:var(--txt3)">${rows.length} payment request${rows.length !== 1 ? 's' : ''} found</div>
    <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
      <input type="text" placeholder="Filter by order no / bill no…" id="vpi-ledger-filter"
        style="padding:.38rem .65rem;border:1.5px solid #cce3d4;border-radius:8px;font-size:.8rem;font-family:inherit;outline:none;width:200px"
        oninput="vpiFilterLedgerRows(this.value)" />
      <button onclick="window.vpiDownloadCSV('ledger')" class="csv-btn">⬇ CSV</button>
    </div>
  </div>
  <div style="overflow-x:auto;border-radius:10px;border:1px solid #e0ece4">
  <table class="vpi-tbl" id="vpi-ledger-tbl">
    <thead><tr>
      <th>Request ID</th><th>Date</th><th>Order No (PO/WO)</th><th>Bill No</th>
      <th>Site</th><th>PO Value</th><th>Invoice Value</th><th>Paid</th><th>Pending</th>
      <th>UTR</th><th>Status</th>
    </tr></thead>
    <tbody id="vpi-ledger-body">${rows.map(r => vpiLedgerRow(r)).join('')}</tbody>
  </table></div>`;
}

function vpiLedgerRow(r) {
  const amt     = v => { const n = parseFloat(v || 0); return n ? fmtAmt(n) : '—'; };
  const dateStr = (r['Date Of Request'] || '').split(' ')[0];
  const reqId   = r['Request ID'] || r['UUID'] || '—';
  const orderNo = r['Order No'] || '—';
  const billNo  = r['Bill No'] || '—';
  const utr     = r['UTR Details'] || '—';
  const status  = r['Status'] || r['Accounts Status'] || '';
  return `<tr>
    <td style="font-weight:600;color:var(--green);font-size:.78rem">${reqId}</td>
    <td style="white-space:nowrap">${dateStr}</td>
    <td style="font-size:.78rem;color:#1565c0">${orderNo}</td>
    <td style="font-size:.78rem">${billNo}</td>
    <td style="font-size:.78rem">${r['Site Name'] || '—'}</td>
    <td style="text-align:right">${amt(r['PO Value'] || r['Amount'])}</td>
    <td style="text-align:right">${amt(r['Invoice Value'])}</td>
    <td style="text-align:right;color:#2e7d32;font-weight:600">${amt(r['Paid Value'])}</td>
    <td style="text-align:right;color:#b07000;font-weight:600">${amt(r['Pending Value'])}</td>
    <td style="font-size:.76rem;color:var(--txt3)">${utr !== '—' ? `<span style="color:#1565c0;font-weight:600">${utr}</span>` : '—'}</td>
    <td>${vpiStatusPill(status)}</td>
  </tr>`;
}

function vpiFilterLedgerRows(q) {
  const lower = q.toLowerCase();
  const tbody = document.getElementById('vpi-ledger-body');
  if (!tbody) return;
  const rows = [..._vpiPayments].sort((a, b) => new Date(b['Date Of Request']||0) - new Date(a['Date Of Request']||0));
  const filtered = q ? rows.filter(r =>
    (r['Order No'] || '').toLowerCase().includes(lower) ||
    (r['Bill No'] || '').toLowerCase().includes(lower) ||
    (r['Request ID'] || '').toLowerCase().includes(lower) ||
    (r['Site Name'] || '').toLowerCase().includes(lower)
  ) : rows;
  tbody.innerHTML = filtered.map(r => vpiLedgerRow(r)).join('');
}

function vpiRenderGRN(c) {
  if (!_vpiStockIN.length) {
    c.innerHTML = `<div style="text-align:center;padding:2.5rem;color:var(--txt3)">No GRN / Stock IN records found for this vendor.</div>`;
    return;
  }

  // Enrich each StockIN row with its GRN No via CheckSum → UUID lookup
  const rows = [..._vpiStockIN]
    .map(r => {
      const cs  = (r['CheckSum'] || r['UUID'] || '').trim();
      const grn = _vpiGRNMap[cs] || {};
      return { ...r, _grnNo: grn.grnNo || '', _grnReceivedOn: grn.receivedOn || r['Received On (At)'] || '' };
    })
    .sort((a, b) => new Date(b._grnReceivedOn || 0) - new Date(a._grnReceivedOn || 0));

  // ── GRN SUMMARY grouped by GRN No ───────────────────────
  const grnGroups = {};
  rows.forEach(r => {
    const key = r._grnNo || '(No GRN)';
    if (!grnGroups[key]) grnGroups[key] = {
      grnNo: key, site: r['Site Name'] || '', poNo: r['PO No'] || '',
      invNo: r['Invoice No / ST No'] || '', receivedOn: r._grnReceivedOn, lines: 0, totalGRN: 0
    };
    grnGroups[key].lines++;
    grnGroups[key].totalGRN += parseFloat(r['GRN Qty'] || 0);
    if (!grnGroups[key].receivedOn && r._grnReceivedOn) grnGroups[key].receivedOn = r._grnReceivedOn;
  });
  const grnList = Object.values(grnGroups).sort((a, b) => new Date(b.receivedOn||0) - new Date(a.receivedOn||0));

  c.innerHTML = `
  <!-- GRN SUMMARY CARDS -->
  <div style="font-weight:700;font-size:.82rem;color:var(--txt2);margin-bottom:.6rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.4rem">
    <span>📦 GRN Summary <span style="font-weight:400;color:var(--txt3);font-size:.77rem">(${grnList.length} GRN${grnList.length !== 1 ? 's' : ''})</span></span>
    <div style="display:flex;gap:.4rem;align-items:center">
      <span style="font-size:.76rem;color:var(--txt3)">${rows.length} total line items</span>
      <button onclick="window.vpiDownloadCSV('grn')" class="csv-btn">⬇ CSV</button>
    </div>
  </div>

  <div style="overflow-x:auto;border-radius:10px;border:1px solid #e0ece4;margin-bottom:1.4rem">
  <table class="vpi-tbl">
    <thead><tr>
      <th>GRN No</th><th>Site</th><th>PO No</th><th>Invoice / ST No</th>
      <th style="text-align:center">Line Items</th><th style="text-align:right">Total GRN Qty</th>
      <th>Received On</th>
    </tr></thead>
    <tbody>${grnList.map(g => `<tr style="cursor:pointer" onclick="vpiScrollToGRN('${g.grnNo.replace(/'/g,"\\'")}')" title="Click to jump to line items">
      <td>
        <span style="font-weight:700;color:var(--green);font-size:.82rem">${g.grnNo !== '(No GRN)' ? g.grnNo : '<span style="color:var(--txt3);font-style:italic">Pending GRN</span>'}</span>
      </td>
      <td style="font-size:.78rem">${g.site||'—'}</td>
      <td style="font-size:.76rem;color:#1565c0">${g.poNo||'—'}</td>
      <td style="font-size:.76rem">${g.invNo||'—'}</td>
      <td style="text-align:center;font-weight:600">${g.lines}</td>
      <td style="text-align:right;font-weight:700;color:#2e7d32;font-size:.88rem">${g.totalGRN}</td>
      <td style="white-space:nowrap;font-size:.78rem">${(g.receivedOn||'').split(' ')[0]||'—'}</td>
    </tr>`).join('')}</tbody>
  </table></div>

  <!-- DIVIDER -->
  <div style="font-weight:700;font-size:.82rem;color:var(--txt2);margin-bottom:.6rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem">
    <span>🗒️ Stock IN Line Items</span>
    <input type="text" id="vpi-grn-filter" placeholder="Filter by GRN No / Part / PO…"
      style="padding:.38rem .65rem;border:1.5px solid #cce3d4;border-radius:8px;font-size:.8rem;font-family:inherit;outline:none;width:220px"
      oninput="vpiFilterGRNRows(this.value)" />
  </div>
  <div style="overflow-x:auto;border-radius:10px;border:1px solid #e0ece4" id="vpi-grn-table-wrap">
  <table class="vpi-tbl" id="vpi-grn-tbl">
    <thead><tr>
      <th>GRN No</th><th>SI ID</th><th>Site</th><th>PO No</th>
      <th>Invoice / ST No</th><th>Part Description</th><th>MR No</th>
      <th style="text-align:right">MR Qty</th><th style="text-align:right">Inv Qty</th>
      <th style="text-align:right">GRN Qty</th><th>Received On</th><th>Received By</th>
    </tr></thead>
    <tbody id="vpi-grn-body">${rows.map(r => vpiGRNRow(r)).join('')}</tbody>
  </table></div>`;
}

function vpiGRNRow(r) {
  const grnNo = r._grnNo;
  const grnBadge = grnNo
    ? `<span style="font-weight:700;color:var(--green);font-size:.78rem" data-grn="${grnNo}">${grnNo}</span>`
    : `<span style="color:var(--txt3);font-style:italic;font-size:.76rem">Pending</span>`;
  return `<tr>
    <td>${grnBadge}</td>
    <td style="font-size:.73rem;color:var(--txt3)">${r['SI ID'] || r['UUID'] || '—'}</td>
    <td style="font-size:.78rem">${r['Site Name'] || '—'}</td>
    <td style="font-size:.73rem;color:#1565c0">${r['PO No'] || '—'}</td>
    <td style="font-size:.73rem">${r['Invoice No / ST No'] || '—'}</td>
    <td style="font-size:.8rem;max-width:180px;white-space:normal">${r['Part Description'] || r['Part Details'] || '—'}</td>
    <td style="font-size:.73rem;color:var(--txt3)">${r['MR No'] || '—'}</td>
    <td style="text-align:right">${r['MR Qty'] || '—'}</td>
    <td style="text-align:right">${r['Invoice Qty'] || '—'}</td>
    <td style="text-align:right;font-weight:700;color:#2e7d32">${r['GRN Qty'] || '—'}</td>
    <td style="white-space:nowrap;font-size:.78rem">${(r._grnReceivedOn || '').split(' ')[0] || '—'}</td>
    <td style="font-size:.76rem;color:var(--txt3)">${r['Received By (At)'] || '—'}</td>
  </tr>`;
}

function vpiFilterGRNRows(q) {
  const lower = q.toLowerCase();
  const rows = [..._vpiStockIN].map(r => {
    const cs  = (r['CheckSum'] || r['UUID'] || '').trim();
    const grn = _vpiGRNMap[cs] || {};
    return { ...r, _grnNo: grn.grnNo || '', _grnReceivedOn: grn.receivedOn || r['Received On (At)'] || '' };
  }).sort((a, b) => new Date(b._grnReceivedOn||0) - new Date(a._grnReceivedOn||0));

  const filtered = q ? rows.filter(r =>
    (r._grnNo || '').toLowerCase().includes(lower) ||
    (r['Part Description'] || r['Part Details'] || '').toLowerCase().includes(lower) ||
    (r['PO No'] || '').toLowerCase().includes(lower) ||
    (r['Invoice No / ST No'] || '').toLowerCase().includes(lower) ||
    (r['MR No'] || '').toLowerCase().includes(lower) ||
    (r['Site Name'] || '').toLowerCase().includes(lower)
  ) : rows;

  const tbody = document.getElementById('vpi-grn-body');
  if (tbody) tbody.innerHTML = filtered.map(r => vpiGRNRow(r)).join('');
}

function vpiScrollToGRN(grnNo) {
  // Populate filter and scroll to line items
  const fi = document.getElementById('vpi-grn-filter');
  if (fi) { fi.value = grnNo; vpiFilterGRNRows(grnNo); }
  const wrap = document.getElementById('vpi-grn-table-wrap');
  if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function vpiRenderInvoices(c) {
  // Invoice view: StockIN rows that have an Invoice No / ST No
  const invRows = _vpiStockIN.filter(r => (r['Invoice No / ST No'] || '').trim() !== '');
  // Group by Invoice No
  const byInv = {};
  invRows.forEach(r => {
    const key = (r['Invoice No / ST No'] || '').trim();
    if (!byInv[key]) byInv[key] = { inv: key, poNo: r['PO No'] || '', site: r['Site Name'] || '', receivedOn: r['Received On (At)'] || '', items: 0, totalGRN: 0 };
    byInv[key].items++;
    byInv[key].totalGRN += parseFloat(r['GRN Qty'] || 0);
  });

  const grouped = Object.values(byInv).sort((a, b) => new Date(b.receivedOn||0) - new Date(a.receivedOn||0));

  if (!grouped.length) {
    c.innerHTML = `<div style="text-align:center;padding:2.5rem;color:var(--txt3)">No invoice records found for this vendor.</div>`;
    return;
  }

  // Also try to match against PO invoices in payment register
  const payInvs = _vpiPayments.filter(r => (r['Bill No'] || '').trim() !== '');

  c.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem;flex-wrap:wrap;gap:.4rem">
    <span style="font-size:.82rem;color:var(--txt3)">${grouped.length} invoice(s) from GRN records${payInvs.length ? ` · ${payInvs.length} from payment register` : ''}</span>
    <button onclick="window.vpiDownloadCSV('invoices')" class="csv-btn">⬇ CSV</button>
  </div>

  ${payInvs.length ? `
  <div style="font-weight:700;font-size:.82rem;color:var(--txt2);margin-bottom:.5rem;margin-top:.25rem">📋 Payment Register Bills</div>
  <div style="overflow-x:auto;border-radius:10px;border:1px solid #e0ece4;margin-bottom:1.2rem">
  <table class="vpi-tbl">
    <thead><tr><th>Request ID</th><th>Bill No</th><th>Order No</th><th>Site</th><th>Invoice Value</th><th>Paid Value</th><th>Status</th></tr></thead>
    <tbody>${payInvs.map(r => `<tr>
      <td style="font-size:.76rem;font-weight:600;color:var(--green)">${r['Request ID']||'—'}</td>
      <td style="font-size:.78rem;font-weight:600">${r['Bill No']||'—'}</td>
      <td style="font-size:.76rem;color:#1565c0">${r['Order No']||'—'}</td>
      <td style="font-size:.78rem">${r['Site Name']||'—'}</td>
      <td style="text-align:right">${fmtAmt(parseFloat(r['Invoice Value']||0))}</td>
      <td style="text-align:right;color:#2e7d32;font-weight:600">${fmtAmt(parseFloat(r['Paid Value']||0))}</td>
      <td>${vpiStatusPill(r['Status']||r['Accounts Status']||'')}</td>
    </tr>`).join('')}</tbody>
  </table></div>` : ''}

  <div style="font-weight:700;font-size:.82rem;color:var(--txt2);margin-bottom:.5rem">📦 GRN Invoices (Stock IN)</div>
  <div style="overflow-x:auto;border-radius:10px;border:1px solid #e0ece4">
  <table class="vpi-tbl">
    <thead><tr><th>Invoice / ST No</th><th>PO No</th><th>Site</th><th>Line Items</th><th>Total GRN Qty</th><th>Received On</th></tr></thead>
    <tbody>${grouped.map(r => `<tr>
      <td style="font-weight:600;font-size:.78rem">${r.inv}</td>
      <td style="font-size:.76rem;color:#1565c0">${r.poNo||'—'}</td>
      <td style="font-size:.78rem">${r.site||'—'}</td>
      <td style="text-align:center">${r.items}</td>
      <td style="text-align:right;font-weight:600;color:#2e7d32">${r.totalGRN}</td>
      <td style="white-space:nowrap;font-size:.78rem">${r.receivedOn.split(' ')[0]||'—'}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

// ══════════════════════════════════════════════════════════
//  PHASE 2 — ONBOARDING PORTAL
// ══════════════════════════════════════════════════════════
function renderOnboardingPortal() {
  const el = document.getElementById('mainContent');

  // Pull recently joined employees from master (joined in last 90 days)
  const users = STATE.masters.users || [];
  const today = new Date(); today.setHours(0,0,0,0);
  const newJoiners = users.filter(u => {
    if (u.status !== 'ACTIVE') return false;
    const doj = parsePODate(u.doj || u['Date of Joining'] || '');
    return doj && (today - doj) <= 90 * 86400000;
  }).sort((a,b) => {
    const da = parsePODate(a.doj||''), db = parsePODate(b.doj||'');
    return (db||0)-(da||0);
  });

  // Onboarding checklist steps (track in sessionStorage per employee)
  const STEPS = [
    { id:'offer',      icon:'📄', label:'Offer Letter Issued',       dept:'HR' },
    { id:'id_card',    icon:'🪪', label:'Employee ID Card Created',   dept:'HR' },
    { id:'email',      icon:'📧', label:'Work Email Setup',           dept:'IT' },
    { id:'bank',       icon:'🏦', label:'Bank Details Collected',     dept:'Accounts' },
    { id:'pf',         icon:'📑', label:'PF / ESI Enrollment',        dept:'HR' },
    { id:'medical',    icon:'🏥', label:'Medical Insurance Added',    dept:'HR' },
    { id:'induction',  icon:'🎓', label:'Induction Completed',        dept:'HR' },
    { id:'site_brief', icon:'🏗️', label:'Site Briefing Done',         dept:'Site Manager' },
    { id:'ppe',        icon:'🦺', label:'PPE Kit Issued',             dept:'Safety' },
    { id:'access',     icon:'🔑', label:'System / Portal Access',     dept:'IT' },
    { id:'document',   icon:'📂', label:'Documents Collected (ID/PAN/Aadhar)', dept:'HR' },
    { id:'exit',       icon:'✅', label:'Onboarding Complete',        dept:'HR' },
  ];

  // Load state from sessionStorage
  function getChecks(empId) {
    try { return JSON.parse(sessionStorage.getItem('ob_'+empId)||'{}'); } catch(e) { return {}; }
  }
  function setCheck(empId, stepId, val) {
    const checks = getChecks(empId);
    checks[stepId] = val;
    sessionStorage.setItem('ob_'+empId, JSON.stringify(checks));
  }

  const totalNew  = newJoiners.length;
  const allActive = users.filter(u => u.status === 'ACTIVE').length;

  // department colour map
  const deptColour = { HR:'#1a6038', IT:'#1565c0', Accounts:'#6a1b9a', 'Site Manager':'#e65100', Safety:'#c62828' };

  // Build new joiner cards
  const joinCards = newJoiners.slice(0,20).map(u => {
    const doj     = parsePODate(u.doj || '');
    const daysAgo = doj ? Math.floor((today-doj)/86400000) : null;
    const checks  = getChecks(u.id || u.empId || u.name);
    const done    = STEPS.filter(s => checks[s.id]).length;
    const pct     = Math.round((done/STEPS.length)*100);
    const eid     = u.id || u.empId || u.name || 'u'+Math.random();
    const colour  = pct === 100 ? '#2e7d32' : pct >= 50 ? '#1565c0' : '#e65100';
    return `
      <div class="card" style="cursor:pointer;transition:box-shadow .2s" onclick="window.openOnboarding('${eid}','${(u.name||'').replace(/'/g,"\\'")}')">
        <div class="card-body" style="padding:1rem">
          <div style="display:flex;align-items:center;gap:.8rem;margin-bottom:.7rem">
            <div style="width:42px;height:42px;border-radius:50%;background:var(--g8);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1rem;flex-shrink:0">
              ${(u.name||'?').charAt(0).toUpperCase()}
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:.88rem;color:var(--g9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.name||'—'}</div>
              <div style="font-size:.72rem;color:var(--txt3)">${u.designation||u.dept||'—'} &middot; ${u.site||'—'}</div>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
            <span style="font-size:.7rem;color:var(--txt3)">Joined ${daysAgo !== null ? daysAgo+'d ago' : '—'}</span>
            <span data-ob-lbl="${eid}" style="font-size:.72rem;font-weight:700;color:${colour}">${done}/${STEPS.length} steps</span>
          </div>
          <div style="background:var(--surface2);border-radius:20px;height:6px;overflow:hidden">
            <div data-ob-bar="${eid}" style="width:${pct}%;height:100%;background:${colour};border-radius:20px;transition:width .4s"></div>
          </div>
          ${pct===100 ? '<div style="font-size:.68rem;color:#2e7d32;font-weight:700;margin-top:.4rem">✅ Onboarding Complete</div>' : ''}
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="page-header" style="margin-bottom:1rem">
      <div>
        <h1>👶 Onboarding Portal</h1>
        <p>Track new joiner onboarding progress · Last 90 days</p>
      </div>
      <button onclick="window.open('https://neurolooom-eng.github.io/onboarding/','_blank')"
        style="padding:.55rem 1.2rem;background:var(--g7);color:#fff;border:none;border-radius:9px;font-family:inherit;font-size:.85rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:.5rem;white-space:nowrap">
        🚀 Open Onboarding Form
      </button>
    </div>

    <!-- KPIs -->
    <div class="kpi-grid" style="margin-bottom:1.2rem">
      <div class="kpi-card">
        <div class="kpi-top"><div class="kpi-icon green">👥</div></div>
        <div class="kpi-value">${totalNew}</div>
        <div class="kpi-label">New Joiners (90 days)</div>
      </div>
      <div class="kpi-card info">
        <div class="kpi-top"><div class="kpi-icon blue">✅</div></div>
        <div class="kpi-value" id="ob-complete-count">—</div>
        <div class="kpi-label">Onboarding Complete</div>
      </div>
      <div class="kpi-card warn">
        <div class="kpi-top"><div class="kpi-icon orange">⏳</div></div>
        <div class="kpi-value" id="ob-pending-count">—</div>
        <div class="kpi-label">In Progress</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><div class="kpi-icon green">📊</div></div>
        <div class="kpi-value">${allActive}</div>
        <div class="kpi-label">Total Active Employees</div>
      </div>
    </div>

    ${totalNew === 0 ? `
      <div style="background:#e8f5e9;border-radius:10px;padding:2.5rem;text-align:center;color:#2e7d32">
        <div style="font-size:2.5rem;margin-bottom:.5rem">🎉</div>
        <strong>No new joiners in the last 90 days</strong><br>
        <span style="font-size:.82rem;color:var(--txt3)">New employees joining will appear here for onboarding tracking.</span>
      </div>
    ` : `
      <!-- New Joiner Cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;margin-bottom:1.2rem">
        ${joinCards}
      </div>
    `}

    <!-- Onboarding Checklist Modal -->
    <div id="ob-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;align-items:center;justify-content:center;padding:1rem">
      <div style="background:#fff;border-radius:16px;width:100%;max-width:560px;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="background:linear-gradient(135deg,var(--g9),var(--g7));padding:1.2rem 1.5rem;color:#fff;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:.72rem;opacity:.7;text-transform:uppercase;letter-spacing:.08em">Onboarding Checklist</div>
            <div id="ob-modal-name" style="font-size:1.1rem;font-weight:700"></div>
          </div>
          <button onclick="window.closeOBModal()" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:1.1rem;display:flex;align-items:center;justify-content:center">✕</button>
        </div>
        <div style="padding:1rem 1.5rem;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem">
            <span style="font-size:.8rem;color:var(--txt2)" id="ob-prog-label">0 of ${STEPS.length} steps complete</span>
            <span style="font-size:.8rem;font-weight:700;color:var(--g7)" id="ob-prog-pct">0%</span>
          </div>
          <div style="background:var(--surface2);border-radius:20px;height:8px;overflow:hidden">
            <div id="ob-prog-bar" style="height:100%;background:var(--g6);border-radius:20px;transition:width .4s;width:0%"></div>
          </div>
        </div>
        <div id="ob-steps-list" style="overflow-y:auto;flex:1;padding:.5rem 1rem"></div>
        <div style="padding:1rem 1.5rem;border-top:1px solid var(--border);display:flex;gap:.6rem;justify-content:flex-end">
          <button onclick="window.closeOBModal()" style="padding:.5rem 1.2rem;border:1px solid var(--border);border-radius:8px;background:#fff;cursor:pointer;font-family:inherit">Close</button>
          <button onclick="window.markAllOB()" style="padding:.5rem 1.2rem;border:none;border-radius:8px;background:var(--g7);color:#fff;cursor:pointer;font-family:inherit;font-weight:600">Mark All Complete ✅</button>
        </div>
      </div>
    </div>
  `;

  // Compute complete/in-progress counts
  let cmplt = 0, inprog = 0;
  newJoiners.forEach(u => {
    const eid = u.id || u.empId || u.name;
    const done = STEPS.filter(s => getChecks(eid)[s.id]).length;
    if (done === STEPS.length) cmplt++; else inprog++;
  });
  const cc = document.getElementById('ob-complete-count');
  const pc = document.getElementById('ob-pending-count');
  if (cc) cc.textContent = cmplt;
  if (pc) pc.textContent = inprog;

  // Modal logic
  let _obEmpId = null;
  window.openOnboarding = function(eid, name) {
    _obEmpId = eid;
    const modal = document.getElementById('ob-modal');
    modal.style.display = 'flex';
    document.getElementById('ob-modal-name').textContent = name;
    renderOBSteps(eid);
  };
  window.closeOBModal = function() {
    const modal = document.getElementById('ob-modal');
    if (modal) modal.style.display = 'none';
    _obEmpId = null;
    // Refresh just the progress bars on the cards without full re-render
    newJoiners.slice(0, 20).forEach(u => {
      const eid = u.id || u.empId || u.name;
      const checks = getChecks(eid);
      const done = STEPS.filter(s => checks[s.id]).length;
      const pct  = Math.round((done / STEPS.length) * 100);
      const colour = pct === 100 ? '#2e7d32' : pct >= 50 ? '#1565c0' : '#e65100';
      // update progress bar inside the card — locate by data attribute
      const bar = document.querySelector(`[data-ob-bar="${eid}"]`);
      const lbl = document.querySelector(`[data-ob-lbl="${eid}"]`);
      if (bar) { bar.style.width = pct + '%'; bar.style.background = colour; }
      if (lbl) lbl.textContent = done + '/' + STEPS.length + ' steps';
    });
    // update complete/in-progress KPIs
    let cmplt2 = 0, inprog2 = 0;
    newJoiners.forEach(u => {
      const eid = u.id || u.empId || u.name;
      const done = STEPS.filter(s => getChecks(eid)[s.id]).length;
      if (done === STEPS.length) cmplt2++; else inprog2++;
    });
    const cc2 = document.getElementById('ob-complete-count');
    const pc2 = document.getElementById('ob-pending-count');
    if (cc2) cc2.textContent = cmplt2;
    if (pc2) pc2.textContent = inprog2;
  };
  window.markAllOB = function() {
    if (!_obEmpId) return;
    const checks = {};
    STEPS.forEach(s => checks[s.id] = true);
    sessionStorage.setItem('ob_'+_obEmpId, JSON.stringify(checks));
    renderOBSteps(_obEmpId);
  };
  window.toggleOBStep = function(eid, stepId, checked) {
    setCheck(eid, stepId, checked);
    renderOBSteps(eid);
    // Write-back to Apps Script → Onboarding sheet
    const emp = (STATE.masters.users || []).find(u =>
      (u.id || u.empId || u.name) === eid || u.empCode === eid || u.name === eid
    );
    const row = [
      new Date().toLocaleString('en-IN', {timeZone:'Asia/Kolkata'}), // Timestamp
      eid,                                                             // Employee ID / empCode
      emp?.name  || eid,                                              // Employee Name
      emp?.site  || '',                                               // Site
      emp?.dept  || '',                                               // Department
      stepId,                                                          // Step ID
      STEPS.find(s => s.id === stepId)?.label || stepId,             // Step Label
      checked ? 'Completed' : 'Pending',                              // Status
      STATE.user?.name  || 'HR',                                      // Marked By
      STATE.user?.email || '',                                         // Marked By Email
    ];
    fetch(APPS_SCRIPT_URL, {
      method: 'POST', headers: {'Content-Type': 'text/plain'},
      body: JSON.stringify({ action: 'appendRow', sheetId: EMP_SHEET_ID, tab: 'OnboardingChecklist', row })
    }).catch(() => {}); // silent fail — sessionStorage is source of truth for now
  };
  function renderOBSteps(eid) {
    const checks = getChecks(eid);
    const done   = STEPS.filter(s => checks[s.id]).length;
    const pct    = Math.round((done/STEPS.length)*100);
    const pl     = document.getElementById('ob-prog-label');
    const pb     = document.getElementById('ob-prog-bar');
    const ppct   = document.getElementById('ob-prog-pct');
    if (pl) pl.textContent = `${done} of ${STEPS.length} steps complete`;
    if (pb) pb.style.width = pct+'%';
    if (ppct) ppct.textContent = pct+'%';
    const list = document.getElementById('ob-steps-list');
    if (!list) return;
    list.innerHTML = STEPS.map(s => {
      const checked = !!checks[s.id];
      const dc = deptColour[s.dept] || '#555';
      return `<label style="display:flex;align-items:center;gap:.8rem;padding:.7rem .5rem;border-bottom:1px solid var(--surface2);cursor:pointer;${checked?'opacity:.6':''}">
        <input type="checkbox" ${checked?'checked':''} onchange="window.toggleOBStep('${eid}','${s.id}',this.checked)"
          style="width:18px;height:18px;cursor:pointer;accent-color:var(--g7)">
        <span style="font-size:1.1rem">${s.icon}</span>
        <span style="flex:1;font-size:.85rem;font-weight:${checked?'400':'600'};color:${checked?'var(--txt3)':'var(--txt)'};text-decoration:${checked?'line-through':'none'}">${s.label}</span>
        <span style="font-size:.65rem;font-weight:700;padding:.2rem .5rem;border-radius:10px;background:${dc}20;color:${dc};white-space:nowrap">${s.dept}</span>
      </label>`;
    }).join('');
  }
}

// ══════════════════════════════════════════════════════════
//  PHASE 2 — VENDOR PO TRACKER  (my-orders)
// ══════════════════════════════════════════════════════════
let _vpoAllRows = [];
let _vpoSort    = { col: 'date', dir: -1 };
let _vpoFilter  = 'all';

function renderVendorPOTracker() {
  const el  = document.getElementById('mainContent');
  const rec = STATE.vendorRecord || {};
  const vendorName = (rec.name || '').trim();
  const isSC = STATE.role === 'sc';
  const typeLabel = isSC ? 'Work Orders' : 'Purchase Orders';
  const typeIcon  = isSC ? '🤝' : '📋';

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:.8rem;margin-bottom:1rem;flex-wrap:wrap">
      <div>
        <h1 style="font-size:1.3rem;font-weight:700;color:var(--g9);margin:0">${typeIcon} My ${typeLabel}</h1>
        <p style="font-size:.8rem;color:var(--txt3);margin:0">${vendorName || 'Your company'} · All POs from Evergreen Enterprises</p>
      </div>
      <button onclick="navigate('my-portal')" style="margin-left:auto;padding:.4rem .9rem;border:1px solid var(--border);border-radius:8px;background:#fff;cursor:pointer;font-family:inherit;font-size:.8rem">← Back</button>
    </div>

    <!-- KPI Cards -->
    <div class="kpi-grid" style="margin-bottom:1.2rem">
      <div class="kpi-card" style="cursor:pointer" onclick="window.vpoSetFilter('all');document.getElementById('vpo-table')?.scrollIntoView({behavior:'smooth',block:'start'})">
        <div class="kpi-top"><div class="kpi-icon green">${typeIcon}</div><div class="kpi-trend flat" style="font-size:.65rem">view all ↓</div></div>
        <div class="kpi-value" id="vpo-kpi-total">—</div>
        <div class="kpi-label">Total POs</div>
        <div style="margin-top:.35rem"><button class="as-btn" onclick="event.stopPropagation();window.open(AS.purchase(),'_blank')">🚀 Purchase View</button></div>
      </div>
      <div class="kpi-card warn" style="cursor:pointer" onclick="window.vpoSetFilter('pending');document.getElementById('vpo-table')?.scrollIntoView({behavior:'smooth',block:'start'})">
        <div class="kpi-top"><div class="kpi-icon orange">⏳</div><div class="kpi-trend flat" style="font-size:.65rem">view list ↓</div></div>
        <div class="kpi-value" id="vpo-kpi-pending">—</div>
        <div class="kpi-label">Pending Approval</div>
        <div style="margin-top:.35rem"><button class="as-btn" onclick="event.stopPropagation();window.open(AS.poApproval(),'_blank')">🚀 PO Approval</button></div>
      </div>
      <div class="kpi-card info" style="cursor:pointer" onclick="window.vpoSetFilter('approved');document.getElementById('vpo-table')?.scrollIntoView({behavior:'smooth',block:'start'})">
        <div class="kpi-top"><div class="kpi-icon blue">✅</div><div class="kpi-trend flat" style="font-size:.65rem">view list ↓</div></div>
        <div class="kpi-value" id="vpo-kpi-approved">—</div>
        <div class="kpi-label">Approved</div>
        <div style="margin-top:.35rem"><button class="as-btn" onclick="event.stopPropagation();window.open(AS.purchase(),'_blank')">🚀 Purchase View</button></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><div class="kpi-icon green">₹</div></div>
        <div class="kpi-value" id="vpo-kpi-value">—</div>
        <div class="kpi-label">Total PO Value</div>
      </div>
    </div>

    <!-- Filter + Search bar -->
    <div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-bottom:1rem">
      <input id="vpo-search" type="text" placeholder="Search PO No or Site…"
        oninput="window.vpoApplyFilters()"
        style="padding:.5rem .8rem;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:.82rem;flex:1;min-width:180px;max-width:260px">
      <div style="display:flex;gap:.4rem;flex-wrap:wrap" id="vpo-status-filters">
        ${['all','pending','approved','rejected'].map(s =>
          `<button onclick="window.vpoSetFilter('${s}')" id="vpo-f-${s}"
            style="padding:.35rem .8rem;border:1px solid var(--border);border-radius:20px;font-family:inherit;font-size:.76rem;cursor:pointer;font-weight:600;
            background:${s==='all'?'var(--g7)':'#fff'};color:${s==='all'?'#fff':'var(--txt2)'}">${s.charAt(0).toUpperCase()+s.slice(1)}</button>`).join('')}
      </div>
      <div style="display:flex;gap:.5rem;align-items:center">
        <span class="hr-stat-pill" id="vpo-count-badge">Loading…</span>
        <button onclick="window.vpoDownloadCSV()" class="csv-btn">⬇ CSV</button>
      </div>
    </div>

    <!-- PO Table -->
    <div class="card">
      <div class="card-body" style="padding:0;overflow-x:auto;max-height:320px;overflow-y:auto">
        <div id="vpo-table">
          <div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:3rem;color:var(--txt3)">
            <div style="width:22px;height:22px;border:2px solid var(--border);border-top-color:var(--g5);border-radius:50%;animation:spin 1s linear infinite"></div>
            ${vendorName ? `Loading POs for <strong>${vendorName}</strong>…` : 'Loading…'}
          </div>
        </div>
      </div>
    </div>
  `;

  // Load data
  if (!vendorName) {
    document.getElementById('vpo-table').innerHTML =
      `<div style="padding:2rem;text-align:center;color:#c62828">⚠️ No vendor session found. Please log in as a Vendor.</div>`;
    return;
  }

  fetchSheet(PO_TAB, 'SELECT A,E,F,R,S,AF,AG,AP,AQ', PO_SHEET_ID).then(rawRows => {
    const today = new Date(); today.setHours(0,0,0,0);
    _vpoAllRows = rawRows
      .filter(r => {
        const vn = (r['Vendor Name'] || '').trim().toLowerCase();
        const pn = (r['PO No'] || '').trim().toLowerCase();
        return vn === vendorName.toLowerCase() && pn && pn !== 'dummy';
      })
      .map(r => {
        const dt  = parsePODate(r['PO Date'] || '');
        const age = dt ? Math.floor((today - dt) / 86400000) : null;
        return {
          uuid:    r['UUID'] || '',
          poNo:    r['PO No'] || '—',
          date:    r['PO Date'] || '—',
          dt,
          vendor:  r['Vendor Name'] || '—',
          site:    r['Site Name']   || '—',
          approver:r['Approver Name'] || '—',
          status:  (r['PO Approval Status'] || '').trim(),
          amount:  parseFloat(r['Net Amount'] || '0') || 0,
          lock:    r['Lock'] || '',
          age,
        };
      });

    // KPIs
    const total    = _vpoAllRows.length;
    const pending  = _vpoAllRows.filter(r => r.status.toUpperCase() !== 'REJECTED' && r.lock === 'Released for Approval').length;
    const approved = _vpoAllRows.filter(r => r.status.toUpperCase() === 'APPROVED').length;
    const totalVal = _vpoAllRows.reduce((s,r) => s+r.amount, 0);

    const kT = document.getElementById('vpo-kpi-total');
    const kP = document.getElementById('vpo-kpi-pending');
    const kA = document.getElementById('vpo-kpi-approved');
    const kV = document.getElementById('vpo-kpi-value');
    if (kT) kT.textContent = total;
    if (kP) kP.textContent = pending;
    if (kA) kA.textContent = approved;
    if (kV) kV.textContent = fmtAmt(totalVal);

    // Update portal KPIs on my-portal page too
    if (STATE.vendorRecord) STATE.vendorRecord._poCount = total;

    renderVPOTable();
  }).catch(() => {
    document.getElementById('vpo-table').innerHTML =
      `<div style="padding:2rem;text-align:center;color:#c62828">⚠️ Could not load PO data. Ensure v2_Purchase is shared publicly.</div>`;
  });
}

// VPO filter / sort helpers
// ── CSV DOWNLOAD FUNCTIONS ────────────────────────────────
window.mrsSiteDownloadCSV = function() {
  const rows = (_mrsSiteData || []).map(r => ({
    'Site': r.site, 'Total MRS': r.count, 'Pending': r.pending,
    'Approved': r.approved, 'Rejected': r.rejected || 0, 'Dropped': r.dropped || 0,
  }));
  downloadCSV(rows, `MRS_by_site_${new Date().toISOString().slice(0,10)}.csv`);
};

window.scmPendingDownloadCSV = function() {
  const rows = (_scmPendingPOs || []).map(r => ({
    'PO No': r.poNo, 'PO Date': fmtDate(r.poDate), 'Vendor': r.vendor,
    'Site': r.site, 'Amount': r.amount, 'Approver': r.approver,
    'Age (Days)': r.ageDays ?? '', 'Status': r.status || 'Pending',
  }));
  downloadCSV(rows, `SCM_pending_${new Date().toISOString().slice(0,10)}.csv`);
};

window.vpoDownloadCSV = function() {
  const search = (document.getElementById('vpo-search')?.value || '').toLowerCase();
  let rows = _vpoAllRows.filter(r => {
    const st = r.status.toUpperCase();
    if (_vpoFilter === 'pending'  && !(st !== 'REJECTED' && r.lock === 'Released for Approval')) return false;
    if (_vpoFilter === 'approved' && st !== 'APPROVED') return false;
    if (_vpoFilter === 'rejected' && st !== 'REJECTED') return false;
    if (search) return (r.poNo + r.site).toLowerCase().includes(search);
    return true;
  });
  downloadCSV(rows.map(r => ({
    'PO No': r.poNo, 'PO Date': fmtDate(r.date), 'Vendor': r.vendor,
    'Site': r.site, 'Amount': r.amount, 'Status': r.status || 'Pending',
    'Approver': r.approver, 'Age (Days)': r.age ?? '',
  })), `My_POs_${_vpoFilter}_${new Date().toISOString().slice(0,10)}.csv`);
};

window.vinvDownloadCSV = function() {
  downloadCSV(_vinvAllRows.map(r => ({
    'Invoice No': r.invNo, 'Invoice Date': fmtDate(r.date),
    'PO No': r.poNo, 'Vendor': r.vendor,
    'Amount': r.amount, 'Payment Status': r.payStatus || 'Pending',
  })), `My_Invoices_${new Date().toISOString().slice(0,10)}.csv`);
};

window.vpoSetFilter = function(f) {
  _vpoFilter = f;
  ['all','pending','approved','rejected'].forEach(s => {
    const btn = document.getElementById('vpo-f-'+s);
    if (btn) { btn.style.background = s===f ? 'var(--g7)':'#fff'; btn.style.color = s===f ? '#fff':'var(--txt2)'; }
  });
  renderVPOTable();
};
window.vpoApplyFilters = renderVPOTable;
window.vpoSort = function(col) {
  if (_vpoSort.col===col) _vpoSort.dir*=-1; else { _vpoSort.col=col; _vpoSort.dir=1; }
  renderVPOTable();
};

function renderVPOTable() {
  const el    = document.getElementById('vpo-table');
  const badge = document.getElementById('vpo-count-badge');
  if (!el) return;

  const search = (document.getElementById('vpo-search')?.value || '').toLowerCase();
  let rows = _vpoAllRows.filter(r => {
    const st = r.status.toUpperCase();
    if (_vpoFilter === 'pending'  && !(st !== 'REJECTED' && r.lock === 'Released for Approval')) return false;
    if (_vpoFilter === 'approved' && st !== 'APPROVED') return false;
    if (_vpoFilter === 'rejected' && st !== 'REJECTED') return false;
    if (search) return (r.poNo+r.site).toLowerCase().includes(search);
    return true;
  });

  rows.sort((a,b) => {
    const col = _vpoSort.col;
    if (col === 'date') return ((a.dt||0)-(b.dt||0)) * _vpoSort.dir;
    if (col === 'amount') return (a.amount-b.amount) * _vpoSort.dir;
    return String(a[col]||'').localeCompare(String(b[col]||'')) * _vpoSort.dir;
  });

  if (badge) badge.innerHTML = `<strong>${rows.length}</strong> POs`;

  if (rows.length === 0) {
    el.innerHTML = `<div style="padding:2.5rem;text-align:center;color:var(--txt3)">No POs found${_vpoFilter!=='all'?' for this filter':''}.</div>`;
    return;
  }

  function vth(label, col) {
    const s = _vpoSort;
    const arrow = s.col===col ? (s.dir===1?' ▲':' ▼'):' ↕';
    return `<th style="cursor:pointer;user-select:none;white-space:nowrap" onclick="window.vpoSort('${col}')">${label}<span style="opacity:.45;font-size:.68rem">${arrow}</span></th>`;
  }

  const trs = rows.map(r => {
    const st    = r.status.toUpperCase();
    const isPend = st !== 'REJECTED' && r.lock === 'Released for Approval';
    const stCol  = st === 'APPROVED' ? '#2e7d32' : st === 'REJECTED' ? '#c62828' : isPend ? '#e65100' : '#777';
    const stBg   = st === 'APPROVED' ? '#e8f5e9' : st === 'REJECTED' ? '#fdecea' : isPend ? '#fff3e0' : '#f5f5f5';
    const stLbl  = st === 'APPROVED' ? '✅ Approved' : st === 'REJECTED' ? '❌ Rejected' : isPend ? '⏳ Pending' : r.status || '—';
    const ageLbl = r.age !== null
      ? (r.age > 14 ? `<span style="color:#c62828;font-weight:700">🔴 ${r.age}d</span>`
       : r.age > 7  ? `<span style="color:#e65100;font-weight:700">🟠 ${r.age}d</span>`
                    : `<span style="color:#2e7d32;font-weight:700">🟢 ${r.age}d</span>`)
      : '—';
    const openBtn = r.uuid
      ? `<a href="${APPSHEET_SCM_URL}?tblName=PO&rowKey=${encodeURIComponent(r.uuid)}" target="_blank"
          style="padding:.25rem .6rem;background:var(--g7);color:#fff;border-radius:6px;font-size:.7rem;font-weight:600;text-decoration:none;white-space:nowrap">Open ↗</a>`
      : '';
    return `<tr>
      <td style="font-weight:700;font-size:.8rem;color:var(--g8);white-space:nowrap">${r.poNo}</td>
      <td style="font-size:.79rem;white-space:nowrap">${r.date}</td>
      <td style="font-size:.79rem">${r.site}</td>
      <td style="text-align:right;font-weight:700;font-size:.82rem">${fmtAmt(r.amount)}</td>
      <td style="text-align:center">${ageLbl}</td>
      <td style="text-align:center">
        <span style="font-size:.7rem;font-weight:700;padding:.2rem .55rem;border-radius:12px;background:${stBg};color:${stCol};white-space:nowrap">${stLbl}</span>
      </td>
      <td style="text-align:center">${openBtn}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <table class="emp-table" style="min-width:620px">
      <thead><tr>
        ${vth('PO No','poNo')}
        ${vth('Date','date')}
        ${vth('Site','site')}
        ${vth('Value','amount')}
        <th>Age</th>
        <th style="text-align:center">Status</th>
        <th style="text-align:center">Action</th>
      </tr></thead>
      <tbody>${trs}</tbody>
      <tfoot><tr style="background:var(--surface2);font-weight:700">
        <td colspan="3" style="font-size:.81rem;color:var(--g8)">TOTAL (${rows.length} POs)</td>
        <td style="text-align:right;font-size:.82rem">${fmtAmt(rows.reduce((s,r)=>s+r.amount,0))}</td>
        <td colspan="3"></td>
      </tr></tfoot>
    </table>`;

  const _t_vpoTable = (typeof c !== "undefined" ? c : el)?.querySelector(".emp-table, .vpi-tbl");
  if (_t_vpoTable) { makeTableSortable(_t_vpoTable); wrapTableScroll(_t_vpoTable); }
}

// ══════════════════════════════════════════════════════════
//  PHASE 2 — VENDOR INVOICES  (my-invoices)
// ══════════════════════════════════════════════════════════
let _vinvAllRows = [];
let _vinvSort    = { col: 'date', dir: -1 };

function renderVendorInvoices() {
  const el  = document.getElementById('mainContent');
  const rec = STATE.vendorRecord || {};
  const vendorName = (rec.name || '').trim();

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:.8rem;margin-bottom:1rem;flex-wrap:wrap">
      <div>
        <h1 style="font-size:1.3rem;font-weight:700;color:var(--g9);margin:0">💰 Invoices & Payments</h1>
        <p style="font-size:.8rem;color:var(--txt3);margin:0">${vendorName || 'Your company'} · Invoice & payment status</p>
      </div>
      <button onclick="navigate('my-portal')" style="margin-left:auto;padding:.4rem .9rem;border:1px solid var(--border);border-radius:8px;background:#fff;cursor:pointer;font-family:inherit;font-size:.8rem">← Back</button>
    </div>

    <!-- KPI Cards -->
    <div class="kpi-grid" style="margin-bottom:1.2rem">
      <div class="kpi-card" style="cursor:pointer" onclick="document.getElementById('vinv-table')?.scrollIntoView({behavior:'smooth',block:'start'})">
        <div class="kpi-top"><div class="kpi-icon green">🧾</div><div class="kpi-trend flat" style="font-size:.65rem">view all ↓</div></div>
        <div class="kpi-value" id="vinv-kpi-total">—</div>
        <div class="kpi-label">Total Invoices</div>
        <div style="margin-top:.35rem"><button class="as-btn" onclick="event.stopPropagation();window.open(AS.invoiceTransport(),'_blank')">🚀 Invoice & Transport</button></div>
      </div>
      <div class="kpi-card warn" style="cursor:pointer" onclick="document.getElementById('vinv-table')?.scrollIntoView({behavior:'smooth',block:'start'})">
        <div class="kpi-top"><div class="kpi-icon orange">⏳</div><div class="kpi-trend flat" style="font-size:.65rem">view list ↓</div></div>
        <div class="kpi-value" id="vinv-kpi-pending">—</div>
        <div class="kpi-label">Awaiting Payment</div>
        <div style="margin-top:.35rem"><button class="as-btn" onclick="event.stopPropagation();window.open(AS.invoiceTransport(),'_blank')">🚀 Invoice & Transport</button></div>
      </div>
      <div class="kpi-card info" style="cursor:pointer" onclick="document.getElementById('vinv-table')?.scrollIntoView({behavior:'smooth',block:'start'})">
        <div class="kpi-top"><div class="kpi-icon blue">✅</div><div class="kpi-trend flat" style="font-size:.65rem">view list ↓</div></div>
        <div class="kpi-value" id="vinv-kpi-paid">—</div>
        <div class="kpi-label">Paid</div>
        <div style="margin-top:.35rem"><button class="as-btn" onclick="event.stopPropagation();window.open(AS.poAccounts(),'_blank')">🚀 POs → Accounts</button></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><div class="kpi-icon green">₹</div></div>
        <div class="kpi-value" id="vinv-kpi-value">—</div>
        <div class="kpi-label">Total Invoice Value</div>
      </div>
    </div>

    <div style="display:flex;justify-content:flex-end;margin-bottom:.6rem">
      <button onclick="window.vinvDownloadCSV()" class="csv-btn">⬇ CSV</button>
    </div>
    <div id="vinv-table" style="max-height:320px;overflow-y:auto;overflow-x:auto">
      <div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:3rem;color:var(--txt3)">
        <div style="width:22px;height:22px;border:2px solid var(--border);border-top-color:var(--g5);border-radius:50%;animation:spin 1s linear infinite"></div>
        Loading invoices…
      </div>
    </div>
  `;

  if (!vendorName) {
    document.getElementById('vinv-table').innerHTML =
      `<div style="padding:2rem;text-align:center;color:#c62828">⚠️ No vendor session. Please log in as a Vendor.</div>`;
    return;
  }

  // Fetch from Invoice tab — columns: A=UUID, B=Invoice No, C=Invoice Date, D=PO No, G=Vendor Name, H=Invoice Amount, I=Payment Status
  fetchSheet('Invoice', 'SELECT A,B,C,D,G,H,I', PO_SHEET_ID).then(rawRows => {
    const today = new Date(); today.setHours(0,0,0,0);

    // Column names vary — try both possible label formats
    _vinvAllRows = rawRows.filter(r => {
      const vn = (r['Vendor Name'] || r['G'] || '').trim().toLowerCase();
      const inv = (r['Invoice No'] || r['B'] || '').trim();
      return vn === vendorName.toLowerCase() && inv && inv !== 'dummy';
    }).map(r => {
      const dt  = parsePODate(r['Invoice Date'] || r['C'] || '');
      return {
        uuid:    r['UUID'] || r['A'] || '',
        invNo:   r['Invoice No'] || r['B'] || '—',
        date:    r['Invoice Date'] || r['C'] || '—',
        dt,
        poNo:    r['PO No'] || r['D'] || '—',
        vendor:  r['Vendor Name'] || r['G'] || '—',
        amount:  parseFloat(r['Invoice Amount'] || r['H'] || '0') || 0,
        payStatus: (r['Payment Status'] || r['I'] || '').trim(),
      };
    });

    const total   = _vinvAllRows.length;
    const pending = _vinvAllRows.filter(r => !r.payStatus || r.payStatus.toUpperCase() !== 'PAID').length;
    const paid    = _vinvAllRows.filter(r => r.payStatus?.toUpperCase() === 'PAID').length;
    const totalV  = _vinvAllRows.reduce((s,r) => s+r.amount, 0);

    const kT = document.getElementById('vinv-kpi-total');
    const kP = document.getElementById('vinv-kpi-pending');
    const kA = document.getElementById('vinv-kpi-paid');
    const kV = document.getElementById('vinv-kpi-value');
    if (kT) kT.textContent = total;
    if (kP) kP.textContent = pending;
    if (kA) kA.textContent = paid;
    if (kV) kV.textContent = fmtAmt(totalV);

    renderVINVTable();
  }).catch(() => {
    // Invoice tab may not be accessible — show friendly state
    document.getElementById('vinv-table').innerHTML = `
      <div class="card">
        <div class="card-body" style="text-align:center;padding:3rem;color:var(--txt3)">
          <div style="font-size:2.5rem;margin-bottom:.75rem">📊</div>
          <strong style="color:var(--txt2)">Invoice data not yet available</strong><br>
          <span style="font-size:.82rem">Invoice tracking will appear here once the Invoice sheet is shared publicly.</span><br>
          <a href="mailto:procurement@evgcpl.com" style="display:inline-block;margin-top:1rem;padding:.5rem 1.2rem;background:var(--g7);color:#fff;border-radius:8px;text-decoration:none;font-size:.82rem">📧 Contact Procurement</a>
        </div>
      </div>`;
    const kT = document.getElementById('vinv-kpi-total'); if (kT) kT.textContent = '—';
    const kP = document.getElementById('vinv-kpi-pending'); if (kP) kP.textContent = '—';
    const kA = document.getElementById('vinv-kpi-paid'); if (kA) kA.textContent = '—';
    const kV = document.getElementById('vinv-kpi-value'); if (kV) kV.textContent = '—';
  });
}

window.vinvSort = function(col) {
  if (_vinvSort.col===col) _vinvSort.dir*=-1; else { _vinvSort.col=col; _vinvSort.dir=1; }
  renderVINVTable();
};

function renderVINVTable() {
  const el = document.getElementById('vinv-table');
  if (!el) return;

  const rows = [..._vinvAllRows].sort((a,b) => {
    const col = _vinvSort.col;
    if (col === 'date')   return ((a.dt||0)-(b.dt||0)) * _vinvSort.dir;
    if (col === 'amount') return (a.amount-b.amount) * _vinvSort.dir;
    return String(a[col]||'').localeCompare(String(b[col]||'')) * _vinvSort.dir;
  });

  if (rows.length === 0) {
    el.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;padding:2.5rem;color:var(--txt3)">No invoices found for your account.</div></div>`;
    return;
  }

  function ivth(label, col) {
    const s = _vinvSort;
    const arrow = s.col===col ? (s.dir===1?' ▲':' ▼'):' ↕';
    return `<th style="cursor:pointer;user-select:none;white-space:nowrap" onclick="window.vinvSort('${col}')">${label}<span style="opacity:.45;font-size:.68rem">${arrow}</span></th>`;
  }

  const trs = rows.map(r => {
    const ps   = (r.payStatus||'').toUpperCase();
    const pCol = ps === 'PAID' ? '#2e7d32' : '#e65100';
    const pBg  = ps === 'PAID' ? '#e8f5e9' : '#fff3e0';
    const pLbl = ps === 'PAID' ? '✅ Paid' : r.payStatus || '⏳ Awaiting';
    return `<tr>
      <td style="font-weight:700;font-size:.8rem;color:var(--g8);white-space:nowrap">${r.invNo}</td>
      <td style="font-size:.79rem;white-space:nowrap">${r.date}</td>
      <td style="font-size:.79rem">${r.poNo}</td>
      <td style="text-align:right;font-weight:700;font-size:.82rem">${fmtAmt(r.amount)}</td>
      <td style="text-align:center">
        <span style="font-size:.7rem;font-weight:700;padding:.2rem .55rem;border-radius:12px;background:${pBg};color:${pCol};white-space:nowrap">${pLbl}</span>
      </td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="card">
      <div class="card-body" style="padding:0;overflow-x:auto">
        <table class="emp-table" style="min-width:520px">
          <thead><tr>
            ${ivth('Invoice No','invNo')}
            ${ivth('Date','date')}
            ${ivth('PO No','poNo')}
            ${ivth('Amount','amount')}
            <th style="text-align:center">Payment Status</th>
          </tr></thead>
          <tbody>${trs}</tbody>
          <tfoot><tr style="background:var(--surface2);font-weight:700">
            <td colspan="3" style="font-size:.81rem;color:var(--g8)">TOTAL (${rows.length})</td>
            <td style="text-align:right;font-size:.82rem">${fmtAmt(rows.reduce((s,r)=>s+r.amount,0))}</td>
            <td></td>
          </tr></tfoot>
        </table>
      </div>
    </div>`;

  const _t_vinvTable = (typeof c !== "undefined" ? c : el)?.querySelector(".emp-table, .vpi-tbl");
  if (_t_vinvTable) { makeTableSortable(_t_vinvTable); wrapTableScroll(_t_vinvTable); }
}

function renderExternalPortal() {
  const el = document.getElementById('mainContent');
  const isVendor = STATE.role === 'vendor';
  const typeLabel = isVendor ? 'Vendor' : 'Sub-Contractor';
  const typeIcon  = isVendor ? '🏢' : '🤝';

  const r = STATE.vendorRecord || {};
  const name  = r.name || 'Your Company';
  const id    = r.id   || '—';
  const type  = r.type2 || r.type || '—';
  const city  = r.city  || '—';
  const state = r.state || '—';
  const gst   = r.gst   || '—';

  el.innerHTML = `
    <!-- Vendor Hero Banner -->
    <div style="background:linear-gradient(135deg,var(--g9) 0%,var(--g7) 100%);border-radius:var(--rad-lg);padding:1.8rem 2rem;color:#fff;margin-bottom:1.4rem;display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap">
      <div style="width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:1.8rem;flex-shrink:0">${typeIcon}</div>
      <div style="flex:1">
        <div style="font-size:.72rem;opacity:.7;text-transform:uppercase;letter-spacing:.1em;margin-bottom:.2rem">${typeLabel} Portal</div>
        <div style="font-size:1.3rem;font-weight:700;margin-bottom:.2rem">${name}</div>
        <div style="font-size:.82rem;opacity:.75">${id} &nbsp;·&nbsp; ${city}${state ? ', '+state : ''}</div>
      </div>
      <div style="text-align:right;opacity:.75;font-size:.8rem">
        <div>Logged in as</div>
        <div style="font-weight:600">${r.loginEmail || STATE.user?.email || '—'}</div>
      </div>
    </div>

    <!-- Status KPIs -->
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi-card" style="cursor:pointer" onclick="navigate('my-orders')">
        <div class="kpi-top"><div class="kpi-icon green">📋</div><div class="kpi-trend flat">→ View POs</div></div>
        <div class="kpi-value" id="ext-kpi-po">—</div>
        <div class="kpi-label">Total POs</div>
        <div class="kpi-sub">Purchase orders from Evergreen</div>
      </div>
      <div class="kpi-card warn" style="cursor:pointer" onclick="navigate('my-invoices')">
        <div class="kpi-top"><div class="kpi-icon orange">💰</div><div class="kpi-trend flat">→ View Invoices</div></div>
        <div class="kpi-value">₹ —</div>
        <div class="kpi-label">Pending Payments</div>
        <div class="kpi-sub">Invoices awaiting clearance</div>
      </div>
      <div class="kpi-card info" style="cursor:pointer" onclick="navigate('my-documents')">
        <div class="kpi-top"><div class="kpi-icon blue">📂</div><div class="kpi-trend flat">→ View Docs</div></div>
        <div class="kpi-value">—</div>
        <div class="kpi-label">Documents</div>
        <div class="kpi-sub">Compliance & certificates</div>
      </div>
    </div>

    <!-- Company Details -->
    <div class="card" style="margin-bottom:1.4rem">
      <div class="card-head"><h3>${typeIcon} ${typeLabel} Details</h3><span class="hr-stat-pill">⬤ From Master Register</span></div>
      <div class="card-body">
        <div class="info-grid-3">
          <div class="info-card"><div class="ic-label">${typeLabel} ID</div><div class="ic-value">${id}</div></div>
          <div class="info-card"><div class="ic-label">Company Name</div><div class="ic-value">${name}</div></div>
          <div class="info-card"><div class="ic-label">Type</div><div class="ic-value">${type}</div></div>
          <div class="info-card"><div class="ic-label">City</div><div class="ic-value">${city}</div></div>
          <div class="info-card"><div class="ic-label">State</div><div class="ic-value">${state}</div></div>
          <div class="info-card"><div class="ic-label">GST / Reg No.</div><div class="ic-value">${gst}</div></div>
        </div>
      </div>
    </div>

    <!-- Quick Links -->
    <div class="dash-grid">
      <div class="card" style="cursor:pointer" onclick="navigate('my-orders')">
        <div class="card-head"><h3>📋 Purchase Orders</h3><span class="hr-stat-pill">Live ⬤</span></div>
        <div class="card-body" style="text-align:center;padding:1.5rem;color:var(--txt3)">
          <div style="font-size:2.5rem;margin-bottom:.75rem">📋</div>
          <div style="font-weight:600;margin-bottom:.4rem;color:var(--txt)">View all POs raised for your company</div>
          <div style="font-size:.82rem">Track approval status, amounts & site-wise breakdown.</div>
          <button onclick="navigate('my-orders')" class="btn btn-secondary btn-sm" style="margin-top:1rem">View POs →</button>
        </div>
      </div>
      <div class="card" style="cursor:pointer" onclick="navigate('my-invoices')">
        <div class="card-head"><h3>💰 Invoices & Payments</h3><span class="hr-stat-pill">Live ⬤</span></div>
        <div class="card-body" style="text-align:center;padding:1.5rem;color:var(--txt3)">
          <div style="font-size:2.5rem;margin-bottom:.75rem">💰</div>
          <div style="font-weight:600;margin-bottom:.4rem;color:var(--txt)">Track invoice & payment history</div>
          <div style="font-size:.82rem">Submit invoices against POs and track payment status.</div>
          <button onclick="navigate('my-invoices')" class="btn btn-secondary btn-sm" style="margin-top:1rem">View Invoices →</button>
        </div>
      </div>
    </div>

    <div style="margin-top:1rem;padding:1rem 1.2rem;background:#fff3e0;border:1px solid #ffe0b2;border-radius:var(--rad);font-size:.8rem;color:#e65100">
      <strong>🔒 Portal Access:</strong> You can only see information relevant to your account. 
      For any queries, contact <strong>procurement@evgcpl.com</strong>
    </div>
  `;
}

function renderExtPlaceholder(icon, title, desc) {
  const el = document.getElementById('mainContent');
  el.innerHTML = `
    <div class="page-header"><h1>${icon} ${title}</h1><p>${desc}</p></div>
    <div class="module-placeholder">
      <div class="mp-icon">${icon}</div>
      <h2>${title}</h2>
      <p>${desc}</p>
      <div class="mp-badge">🔨 Coming Soon</div>
      <button onclick="navigate('my-portal')" style="margin-top:1rem;padding:8px 18px;background:var(--g7);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit">← Back to My Dashboard</button>
    </div>
  `;
}

// ══════════════════════════════════════════════════
//  MASTERS — ALL SHEETS CONFIG
// ══════════════════════════════════════════════════
const SHEET_ID           = '1B2wb38KhNwlLoZnsAGWQkO0FdEGFFfsh3ycRRurigq4'; // Master spreadsheet
const BUDGET_SHEET_ID    = ''; // IC Budget -- paste Drive sheet ID here after upload
const V2_MASTER_SHEET_ID = '1fhSO4WBYp0LNXPxe9I9zr5qsIPs9CIDFpUixBogPnsM'; // v2_Master
const EMP_SHEET_ID = '1HWKZPhKRhcuvxBgyyN8zRt8p-SzYmKjJWiOdCgykBHs'; // Employee Register
const DPR_SHEET_ID = '139deMPqCXVZLSw5gFdzhN1heV-hynkYqIjsVpO1oXSc'; // Daily Progress Report sheet
const DPR_TAB      = 'DPR'; // Tab inside the DPR sheet

// PCC (Project Cost Control) backing sheet — hosts setup, BOQ, WBS, workplan, etc.
// All Activity / Nature-of-Work / Type-of-Work masters live in this sheet.
const PCC_SHEET_ID = '1dQow9nD4e0qVOSfpwEWQmPTuhF3FW_8r1oK5dMjJlRE'; // ProjectSetup_v1
const PCC_TABS = {
  projectSetup: 'Project_Master',     // Per-project setup rows
  boq:          'M_PL_2_BOQ',         // Bill of Quantities
  wbs:          'M_PL_3_WBS',         // Work Breakdown Structure (Nature of Work level)
  activities:   'M_PL_1_Activities',  // ACTIVITY MASTER — Nature of Work + Type of Work
  workplan:     'M_PL_4_Workplan',    // Monthly workplan rows
  workplanDtl:  'M_PL_4_WorkplanDtl', // Workplan month-by-month qty/value (long-form)
};
// Backwards-compat alias for older code that referenced WORKPLAN_SHEET_ID directly
const WORKPLAN_SHEET_ID = PCC_SHEET_ID;
const ACTIVITY_MASTER_TAB = PCC_TABS.activities;

const SHEET_GID    = '944085465'; // Site Master GID (kept for direct URL fallback)

const MASTER_SHEETS = {
  sites:          { sheet: '5-SiteMaster'          },
  users:          { sheet: '2-UserMaster'           },
  assets:         { sheet: '6-AssetMaster'          },
  vendors:        { sheet: '7-VendorMaster'         },
  subcontractors: { sheet: '10-SubContractorMaster' },
  // 4-GRNMaster, 3-HeadMaster: skipped for now — Phase 3+
};

// Col indices for Site Master (0-based)
const COL = {
  UUID:0, CREATED_BY:1, CREATED_ON:2,
  SITE_ID:3, SITE_NAME:4,
  PAN:5, TAN:6, GST:7,
  ADDR1:8, ADDR2:9, ADDR3:10, ADDRESS:11,
  CITY:12, STATE:13, PIN:14,
  EMAIL:15, CONTACT1:16, CONTACT2:17, CONTACT3:18,
  WEBSITE:19, LOCATION:20,
  DEL_ADDR:21, DEL_CONTACT:22,
  COMPANY:23, BILLING:24,
  SITE_INCHARGE:25, REPORTING_MGR:26,
  PLANNING_IC:27, MESS_IC:28, ACCOUNTS_IC:29,
  ATTENDANCE_IC:30, SC_ATTEND:31,
  OPTION:32, STATUS:33
};

// Master state
STATE.masters = {
  sites: [], users: [], mess: [], messUnique: [], assets: [], vendors: [], subcontractors: []
};
STATE.mastersLoaded = false;

// ── gviz JSONP: intercept google.visualization.Query.setResponse ──
// Each request gets a unique reqId; the global handler routes the response back.
window.google = window.google || {};
window.google.visualization = window.google.visualization || {};
window.google.visualization.Query = window.google.visualization.Query || {};
const _gvizHandlers = {};
window.google.visualization.Query.setResponse = function(json) {
  const id = String(json.reqId || '0');
  if (_gvizHandlers[id]) { _gvizHandlers[id](json); delete _gvizHandlers[id]; }
};

let _gvizReqId = 0;

function fetchSheet(sheetName, tq, spreadsheetId) {
  return new Promise((resolve) => {
    const reqId = String(++_gvizReqId);
    const sid = spreadsheetId || SHEET_ID;
    let url = `https://docs.google.com/spreadsheets/d/${sid}/gviz/tq`
            + `?tqx=out:json;reqId:${reqId}`
            + `&sheet=${encodeURIComponent(sheetName)}`;
    if (tq) url += `&tq=${encodeURIComponent(tq)}`;

    const timer = setTimeout(() => {
      delete _gvizHandlers[reqId];
      if (script.parentNode) script.parentNode.removeChild(script);
      console.warn(`Sheet "${sheetName}" timed out — skipped`);
      resolve([]);
    }, 20000);

    _gvizHandlers[reqId] = (json) => {
      clearTimeout(timer);
      if (script.parentNode) script.parentNode.removeChild(script);
      try {
        const cols = json.table.cols.map(c => c.label);
        resolve(json.table.rows.map(row => {
          const obj = {};
          row.c.forEach((cell, i) => {
            obj[cols[i]] = (cell && cell.v != null) ? String(cell.v).trim() : '';
          });
          return obj;
        }));
      } catch(e) {
        console.warn(`Sheet "${sheetName}" parse error:`, e.message);
        resolve([]);
      }
    };

    const script = document.createElement('script');
    script.onerror = () => {
      clearTimeout(timer);
      delete _gvizHandlers[reqId];
      console.warn(`Sheet "${sheetName}" script error`);
      resolve([]);
    };
    script.src = url;
    document.head.appendChild(script);
  });
}

// ── Status helper: treat anything that is ACTIVE in the sheet as active ──
function isActive(row, key = 'Active/Inactive?') {
  return (row[key] || '').toUpperCase() === 'ACTIVE';
}

// ── Parse gviz Date string e.g. "Date(2025,9,2,19,58,6)" → JS Date ──
function parseGvizDate(val) {
  const m = String(val || '').match(/Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)/);
  if (!m) return new Date(0);
  return new Date(+m[1], +m[2], +m[3], +(m[4]||0), +(m[5]||0), +(m[6]||0));
}

// ── Deduplicate array by a key field — keeps the entry with the LATEST timestamp ──
function deduplicateLatest(rows, keyField, tsField) {
  const map = new Map();
  for (const r of rows) {
    const key = r[keyField];
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, r);
    } else {
      if (parseGvizDate(r[tsField]) > parseGvizDate(map.get(key)[tsField])) {
        map.set(key, r);
      }
    }
  }
  return Array.from(map.values());
}

// ── Tally an array by a field, sorted by count desc ──
function tallyBy(rows, field) {
  const m = {};
  rows.forEach(r => { const k = r[field] || '—'; m[k] = (m[k]||0) + 1; });
  return Object.entries(m).sort((a,b) => b[1]-a[1]);
}

async function loadAllMasters() {
  if (STATE.mastersLoaded) return;

  // ── Fetch each independently — one failure NEVER kills the rest ──
  // NOTE: 4-GRNMaster and 3-HeadMaster skipped for now — Phase 3+
  // VendorMaster: SELECT only 7 cols (of 39) — cuts payload ~80%
  // Employees: separate spreadsheet — 0_EmployeeRegister_Live + 07_Mess_Accomodation
  const [sitesRows, empRows, messRows, assetsRows, vendorsRows, scRows] = await Promise.all([
    fetchSheet('5-SiteMaster',           null, SHEET_ID),
    fetchSheet('0_EmployeeRegister_Live',null, EMP_SHEET_ID),
    fetchSheet('07_Mess_Accomodation',   null, EMP_SHEET_ID),
    fetchSheet('6-AssetMaster',          null, SHEET_ID),
    fetchSheet('7-VendorMaster',        'SELECT C,J,K,L,Q,R,AK', SHEET_ID),
    fetchSheet('10-SubContractorMaster', null, SHEET_ID),
  ]);

  // ── Sites: every row where Active/Inactive? = ACTIVE counts as live ──
  STATE.masters.sites = sitesRows
    .filter(r => r['Site ID'])
    .map(r => ({
      siteId:   r['Site ID'],
      name:     r['Site Name'] || '',
      city:     r['City'] || '',
      state:    r['State'] || '',
      email:    r['Email ID'] || '',
      contact:  r['Contact 1'] || '',
      incharge: (r['Site In Charge Name'] || '').replace(/EG\w+\|/g, ''),
      manager:  (r['Reporting Manager Name'] || '').replace(/EG\w+\|/g, ''),
      status:   (r['Active/Inactive?'] || '').toUpperCase().trim(),
      gstin:    r['GST'] || '',
      address:  r['Address'] || '',
      company:  r['Company'] || '',
    }));

  // ── Employees — from 0_EmployeeRegister_Live (Employee Register spreadsheet) ──
  STATE.masters.users = empRows
    .filter(r => r['EMP CODE'] || r['Employee Name'])
    .map(r => ({
      empCode:    r['EMP CODE'] || r['New Employee Code'] || r['Emp Code'] || r['EmpCode'] || r['Employee Code'] || '',
      employeeRef:r['Employee_Ref'] || r['Employee Ref'] || r['EmployeeRef'] || '',
      name:       r['Employee Name'] || r['Name'] || r['EMPLOYEE NAME'] || '',
      email:      r['Mail ID'] || r['Email'] || r['Email ID'] || '',
      dept:       r['Department'] || r['DEPARTMENT'] || r['Dept'] || '',
      desig:      r['DESIGNATION'] || r['Designation'] || '',
      grade:      r['Grade'] || r['GRADE'] || '',
      empType:    r['Employee Type'] || '',
      site:       r['Site Name'] || '',
      payroll:    r['PayRoll'] || '',
      doj:        r['DOJ MM/DD/YYYY'] || '',
      doe:        r['DOE MM/DD/YYYY'] || '',
      expTotal:   r['TOTAL YEAR EXPERIENCE'] || '',
      expEG:      r['Year of Experience in Evergreen till current date'] || '',
      photo:      r['Photo'] || '',
      plEligible: r['PL Eligible?'] || '',
      plBalance:  r['PL Avalable as of Today'] || '',
      role:       r['Role (User Type)'] || '',
      empStatus:  r['Employee Status'] || '',
      siteIC:     (r['Site In-Charge Name'] || '').replace(/^EG\w+\|/i, '').trim(),
      siteICCode: (r['Site In-Charge Name'] || '').match(/^(EG\w+)\|/i)?.[1]?.toUpperCase() || '',
      manager:     (r['Reporting Manager'] || '').replace(/^EG\w+\|/i, '').trim(),
      managerCode: (r['Reporting Manager'] || '').match(/^(EG\w+)\|/i)?.[1]?.toUpperCase() || (r['Reporting Manager'] || '').trim().toUpperCase(),
      timestamp:  r['Timestamp'] || '',
      // Status: ONLY "CURRENT" = active. LEFT THE COMPANY / NOT JOINED / blank = inactive.
      status: (r['Employee Status'] || '').trim().toUpperCase() === 'CURRENT' ? 'ACTIVE' : 'INACTIVE',
    }));
  // Deduplicate by EMP CODE — keep only the latest entry per employee
  STATE.masters.users = deduplicateLatest(STATE.masters.users, 'empCode', 'timestamp');

  // ── Employee Personal Details — UUID lookup (for HR Docs) ──
  // Col A = UUID, Col F = Mail ID — fetch lazily when needed
  STATE.masters.personalDetailsLoaded = false;
  STATE.masters.personalDetails = []; // { uuid, email } pairs


  // Deduplicate by EMP CODE — sort by Timestamp desc, take unique per employee
  const rawMess = messRows
    .filter(r => r['EMP CODE'] || r['Employee Name'])
    .map(r => ({
      empCode:       r['EMP CODE'] || '',
      name:          r['Employee Name'] || '',
      site:          r['Site Name'] || '',
      accommodation: r['ACCOMMODATION'] || '',
      messDetails:   r['MESS DETAILS'] || '',
      monthlyFood:   r['Monthly Food Allowance (30Days)'] || '',
      perDayFood:    r['Per Day Food Allowance'] || '',
      specialAllow:  r['Special Site Allowance'] || '',
      fromDate:      r['From ( Date )'] || '',
      timestamp:     r['Timestamp'] || '',
    }));
  STATE.masters.mess = rawMess; // keep all
  STATE.masters.messUnique = deduplicateLatest(rawMess, 'empCode', 'timestamp');

  // ── Assets ──
  STATE.masters.assets = assetsRows
    .filter(r => r['Asset Name'])
    .map(r => ({
      name:     r['Asset Name'] || '',
      code:     r['Asset Code'] || '',
      category: r['Category'] || '',
      site:     r['Site'] || '',
      ownHire:  r['OWN / HIRE'] || '',
      status:   (r['Active/Inactive?'] || '').toUpperCase().trim(),
    }));

  // ── Vendors (SELECT C,J,K,L,Q,R,AK → Type,VendorID,LegalName,VendorName,City,State,Status) ──
  STATE.masters.vendors = vendorsRows
    .filter(r => r['Vendor Name'] || r['Legal Name'])
    .map(r => ({
      id:     r['Vendor ID']   || '',
      name:   r['Vendor Name'] || r['Legal Name'] || '',
      type:   r['Vendor Type'] || '',
      city:   r['City']        || '',
      state:  r['State']       || '',
      status: (r['Active/Inactive?'] || '').toUpperCase().trim(),
    }));

  // ── Sub-Contractors ──
  STATE.masters.subcontractors = scRows
    .filter(r => r['Sub Contractor Name'])
    .map(r => ({
      id:     r['SC ID'] || '',
      name:   r['Sub Contractor Name'] || '',
      gst:    r['GST'] || '',
      status: (r['Active/Inactive?'] || '').toUpperCase().trim(),
    }));

  STATE.mastersLoaded = true;
  console.log(`✅ Masters loaded — Sites:${STATE.masters.sites.length} Employees:${STATE.masters.users.length} Mess:${STATE.masters.mess.length} Assets:${STATE.masters.assets.length} Vendors:${STATE.masters.vendors.length} SCs:${STATE.masters.subcontractors.length}`);
}

// Legacy aliases
const loadSiteMaster = loadAllMasters;
const fetchMasterSheet = fetchSheet;

// ── Filtered helpers: ACTIVE in sheet = ACTIVE in portal, no exceptions ──
function getActiveSites()    { return STATE.masters.sites.filter(s => s.status === 'ACTIVE'); }
function getInactiveSites()  { return STATE.masters.sites.filter(s => s.status === 'INACTIVE'); }
function getActiveUsers()    { return STATE.masters.users.filter(u => u.status === 'ACTIVE'); }
function getActiveAssets()   { return STATE.masters.assets.filter(a => a.status === 'ACTIVE'); }
function getActiveVendors()  { return STATE.masters.vendors.filter(v => v.status === 'ACTIVE'); }
function getActiveSCs()      { return STATE.masters.subcontractors.filter(s => s.status === 'ACTIVE'); }

// ── RENDERED HELPERS ──

function sitesData() {
  const active = getActiveSites().slice(0, 8);
  if (!active.length) return '<tr><td colspan="4" style="padding:1.5rem;text-align:center;color:var(--txt3)">⏳ Loading site data…</td></tr>';
  return active.map(s => `
    <tr>
      <td>
        <span class="site-name">${s.name}</span>
        <div style="font-size:.7rem;color:var(--txt3);margin-top:2px">${s.siteId} · ${s.city}, ${s.state}</div>
      </td>
      <td>
        <div style="font-size:.75rem;color:var(--txt2)">${s.incharge || '—'}</div>
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="status-dot green"></span>
          <span style="font-size:.75rem;color:var(--ok);font-weight:600">ACTIVE</span>
        </div>
      </td>
    </tr>
  `).join('');
}

function allSitesCards() {
  const active = getActiveSites();
  if (!active.length) return '<div style="padding:2rem;text-align:center;color:var(--txt3)">⏳ Loading…</div>';
  return active.map(s => `
    <div class="md-site-card" onclick="navigate('site-manager')">
      <div style="width:36px;height:36px;border-radius:9px;background:var(--g8);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0">🏗️</div>
      <div class="md-site-info">
        <div class="md-site-name">${s.name}</div>
        <div class="md-site-loc">📍 ${s.city}, ${s.state}</div>
        <div style="font-size:.68rem;color:var(--txt4);margin-top:2px">In-Charge: ${s.incharge || '—'}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:.7rem;font-weight:700;color:var(--g7)">${s.siteId}</div>
        <span class="status-dot green" style="display:block;margin:4px auto 0"></span>
      </div>
    </div>
  `).join('');
}

function mastersWidget() {
  const activeSites   = getActiveSites();
  const activeUsers   = getActiveUsers();
  const activeAssets  = getActiveAssets();
  const activeVendors = getActiveVendors();
  const activeSCs     = getActiveSCs();

  // State-wise site breakdown
  const stateMap = {};
  activeSites.forEach(s => { stateMap[s.state] = (stateMap[s.state]||0)+1; });
  const topStates = Object.entries(stateMap).sort((a,b)=>b[1]-a[1]).slice(0,5);

  // Asset categories
  const catMap = {};
  activeAssets.forEach(a => { catMap[a.category] = (catMap[a.category]||0)+1; });
  const topCats = Object.entries(catMap).sort((a,b)=>b[1]-a[1]).slice(0,5);

  return `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.8rem">
      <!-- Sites by State -->
      <div>
        <div style="font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--txt3);margin-bottom:.7rem">🏗️ Sites by State</div>
        ${topStates.map(([state,count]) => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:.5rem">
            <div style="font-size:.78rem;color:var(--txt2);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${state}</div>
            <div style="font-size:.72rem;font-weight:700;color:var(--g7);white-space:nowrap">${count} sites</div>
          </div>
          <div style="height:4px;background:var(--border);border-radius:2px;margin-bottom:.5rem">
            <div style="height:100%;background:var(--g5);border-radius:2px;width:${Math.round(count/activeSites.length*100)}%"></div>
          </div>
        `).join('')}
        <div style="font-size:.7rem;color:var(--txt4);margin-top:.5rem">${activeSites.length} active in ${topStates.length} states + more</div>
      </div>

      <!-- Equipment by Category -->
      <div>
        <div style="font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--txt3);margin-bottom:.7rem">🚜 Equipment by Type</div>
        ${topCats.map(([cat,count]) => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:.5rem">
            <div style="font-size:.78rem;color:var(--txt2);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cat||'Other'}</div>
            <div style="font-size:.72rem;font-weight:700;color:var(--info);white-space:nowrap">${count}</div>
          </div>
          <div style="height:4px;background:var(--border);border-radius:2px;margin-bottom:.5rem">
            <div style="height:100%;background:var(--info);border-radius:2px;width:${Math.round(count/activeAssets.length*100)}%"></div>
          </div>
        `).join('')}
        <div style="font-size:.7rem;color:var(--txt4);margin-top:.5rem">${activeAssets.length} active across all sites</div>
      </div>

      <!-- Master Counts Summary -->
      <div>
        <div style="font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--txt3);margin-bottom:.7rem">📊 Master Records</div>
        ${[
          ['🏗️','Sites',       activeSites.length,  STATE.masters.sites.length],
          ['👷','Employees',   activeUsers.length,  STATE.masters.users.length],
          ['🚜','Equipment',   activeAssets.length, STATE.masters.assets.length],
          ['🏢','Vendors',     activeVendors.length,STATE.masters.vendors.length],
          ['🤝','Sub-Contractors',activeSCs.length, STATE.masters.subcontractors.length],
        ].map(([icon,label,active,total]) => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:.35rem 0;border-bottom:1px solid var(--border)">
            <span style="font-size:.78rem;color:var(--txt2)">${icon} ${label}</span>
            <span style="font-size:.75rem">
              <span style="font-weight:700;color:var(--g7)">${active.toLocaleString('en-IN')}</span>
              <span style="color:var(--txt4)"> / ${total.toLocaleString('en-IN')}</span>
            </span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function approvalItem(icon, id, desc, amount, time) {
  return `
    <div class="approval-item">
      <div class="appr-icon" style="background:var(--surface2)">${icon}</div>
      <div class="appr-info">
        <div class="appr-title">${id} — ${desc}</div>
        <div class="appr-meta">${time}</div>
        <div class="appr-actions">
          <button class="btn-approve">✓ Approve</button>
          <button class="btn-reject">✕ Reject</button>
        </div>
      </div>
      <div class="appr-amount">${amount}</div>
    </div>
  `;
}

function quickAction(icon, label, page) {
  return `
    <button onclick="navigate('${page}')" style="padding:.8rem;border-radius:var(--rad);background:var(--surface2);border:1px solid var(--border);display:flex;flex-direction:column;align-items:center;gap:5px;cursor:pointer;transition:all var(--transition);font-size:.75rem;font-weight:600;color:var(--txt2)" onmouseover="this.style.background='#edf7f1';this.style.borderColor='var(--border2)'" onmouseout="this.style.background='var(--surface2)';this.style.borderColor='var(--border)'">
      <span style="font-size:1.3rem">${icon}</span>
      ${label}
    </button>
  `;
}

function moduleCard(icon, label, page, bg, color) {
  return `
    <div onclick="navigate('${page}')" style="padding:1rem;border-radius:var(--rad);background:${bg};cursor:pointer;text-align:center;transition:all .2s;border:1px solid transparent" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='var(--shadow-md)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
      <div style="font-size:1.5rem;margin-bottom:5px">${icon}</div>
      <div style="font-size:.78rem;font-weight:700;color:${color}">${label}</div>
    </div>
  `;
}

function finRow(label, value, type) {
  return `
    <div class="fin-row">
      <span class="fin-label">${label}</span>
      <span class="fin-value ${type}">${value}</span>
    </div>
  `;
}

// ══════════════════════════════════════════════════
//  UI CONTROLS
// ══════════════════════════════════════════════════
function toggleSidebar() {
  STATE.sidebarOpen = !STATE.sidebarOpen;
  document.getElementById('sidebar').classList.toggle('mobile-open', STATE.sidebarOpen);
  document.getElementById('hamburger').classList.toggle('open', STATE.sidebarOpen);
}
function closeSidebar() {
  STATE.sidebarOpen = false;
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('hamburger').classList.remove('open');
}
function toggleNotifPanel() {
  // Close AI chat if open
  if (AI_CHAT?.open) { AI_CHAT.open = false; document.getElementById('aiChatPanel')?.classList.remove('open'); }
  STATE.notifOpen = !STATE.notifOpen;
  document.getElementById('notifPanel').classList.toggle('open', STATE.notifOpen);
}
function toggleUserMenu() {
  // Role is auto-detected from Employee Register
  const _em = STATE.user?.email || '';
  const _rl = (ROLES[STATE.role] || ROLES.employee).label;
  const _t = document.createElement('div');
  _t.textContent = _em + '  ·  ' + _rl;
  _t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(13,51,32,.95);color:#fff;padding:9px 20px;border-radius:8px;font-size:.82rem;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.3);pointer-events:none;';
  document.body.appendChild(_t);
  setTimeout(() => _t.remove(), 2500);
}

// ══════════════════════════════════════════════════
//  LIVE CLOCK

// ── TOP NAV: click-to-toggle dropdown + close on outside click ──
function initTopNavClicks() {
  const topNav = document.getElementById('topNav');
  if (!topNav) return;

  // Click on a non-solo tnav-btn toggles its group open/close
  topNav.querySelectorAll('.tnav-btn:not(.solo)').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const group = btn.closest('.tnav-group');
      const isOpen = group.classList.contains('open');
      // Close all others
      topNav.querySelectorAll('.tnav-group.open').forEach(g => g.classList.remove('open'));
      // Toggle this one
      if (!isOpen) group.classList.add('open');
    });
  });

  // Click outside closes all
  document.addEventListener('click', function() {
    topNav.querySelectorAll('.tnav-group.open').forEach(g => g.classList.remove('open'));
  });

  // Esc key closes all
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      topNav.querySelectorAll('.tnav-group.open').forEach(g => g.classList.remove('open'));
    }
  });
}

// ════════════════════════════════════════════════════════════════
//  MULTI-TIMEZONE CLOCK ENGINE
// ════════════════════════════════════════════════════════════════
const TZ_STORAGE_KEY = 'evgcpl_user_timezones';

// All available timezone presets
const TZ_PRESETS = [
  // Africa
  { id:'Africa/Dar_es_Salaam', label:'Tanzania', city:'Dar es Salaam / Gueyo', flag:'🇹🇿', abbr:'EAT' },
  { id:'Africa/Nairobi',       label:'Kenya',    city:'Nairobi',               flag:'🇰🇪', abbr:'EAT' },
  { id:'Africa/Lagos',         label:'Nigeria',  city:'Lagos / Abuja',         flag:'🇳🇬', abbr:'WAT' },
  { id:'Africa/Cairo',         label:'Egypt',    city:'Cairo',                 flag:'🇪🇬', abbr:'EET' },
  { id:'Africa/Johannesburg',  label:'South Africa', city:'Johannesburg',      flag:'🇿🇦', abbr:'SAST' },
  { id:'Africa/Accra',         label:'Ghana',    city:'Accra',                 flag:'🇬🇭', abbr:'GMT' },
  // Asia
  { id:'Asia/Kolkata',         label:'India',    city:'Namakkal / All India',  flag:'🇮🇳', abbr:'IST' },
  { id:'Asia/Dubai',           label:'UAE',      city:'Dubai / Abu Dhabi',     flag:'🇦🇪', abbr:'GST' },
  { id:'Asia/Singapore',       label:'Singapore',city:'Singapore',             flag:'🇸🇬', abbr:'SGT' },
  { id:'Asia/Tokyo',           label:'Japan',    city:'Tokyo',                 flag:'🇯🇵', abbr:'JST' },
  { id:'Asia/Shanghai',        label:'China',    city:'Shanghai / Beijing',    flag:'🇨🇳', abbr:'CST' },
  { id:'Asia/Riyadh',          label:'Saudi Arabia', city:'Riyadh',           flag:'🇸🇦', abbr:'AST' },
  { id:'Asia/Colombo',         label:'Sri Lanka',city:'Colombo',               flag:'🇱🇰', abbr:'SLST' },
  { id:'Asia/Dhaka',           label:'Bangladesh',city:'Dhaka',               flag:'🇧🇩', abbr:'BST' },
  { id:'Asia/Kathmandu',       label:'Nepal',    city:'Kathmandu',             flag:'🇳🇵', abbr:'NPT' },
  { id:'Asia/Muscat',          label:'Oman',     city:'Muscat',                flag:'🇴🇲', abbr:'GST' },
  { id:'Asia/Kuwait',          label:'Kuwait',   city:'Kuwait City',           flag:'🇰🇼', abbr:'AST' },
  { id:'Asia/Karachi',         label:'Pakistan', city:'Karachi / Islamabad',   flag:'🇵🇰', abbr:'PKT' },
  { id:'Asia/Dhaka',           label:'Bangladesh',city:'Dhaka',               flag:'🇧🇩', abbr:'BST' },
  // Europe
  { id:'Europe/London',        label:'UK',       city:'London',                flag:'🇬🇧', abbr:'GMT/BST' },
  { id:'Europe/Paris',         label:'France',   city:'Paris',                 flag:'🇫🇷', abbr:'CET' },
  { id:'Europe/Berlin',        label:'Germany',  city:'Berlin',                flag:'🇩🇪', abbr:'CET' },
  // Americas
  { id:'America/New_York',     label:'USA East', city:'New York',              flag:'🇺🇸', abbr:'ET' },
  { id:'America/Los_Angeles',  label:'USA West', city:'Los Angeles',           flag:'🇺🇸', abbr:'PT' },
  { id:'America/Chicago',      label:'USA Central', city:'Chicago',            flag:'🇺🇸', abbr:'CT' },
  // Australia
  { id:'Australia/Sydney',     label:'Australia',city:'Sydney',                flag:'🇦🇺', abbr:'AEST' },
];

// Default clocks: IST (primary, always shown) + Tanzania
const TZ_DEFAULTS = ['Asia/Kolkata', 'Africa/Dar_es_Salaam'];

function tzGetSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(TZ_STORAGE_KEY));
    if (Array.isArray(saved) && saved.length) return saved;
  } catch(e) {}
  return [...TZ_DEFAULTS];
}

function tzSave(zones) {
  localStorage.setItem(TZ_STORAGE_KEY, JSON.stringify(zones));
}

function tzGetPreset(id) {
  return TZ_PRESETS.find(t => t.id === id) || { id, label: id, city: id, flag: '🌍', abbr: '' };
}

function tzFormatTime(tz) {
  try {
    return new Date().toLocaleTimeString('en-IN', {
      hour:'2-digit', minute:'2-digit', second:'2-digit', timeZone: tz, hour12: true
    });
  } catch(e) { return '--:--'; }
}

function tzRenderClocks() {
  const row = document.getElementById('tzClocksRow');
  if (!row) return;
  const zones = tzGetSaved();

  row.innerHTML = zones.map((tz, i) => {
    const p = tzGetPreset(tz);
    const isPrimary = tz === 'Asia/Kolkata';
    const time = tzFormatTime(tz);
    const removable = !isPrimary;
    return `<div class="tz-clock-pill${isPrimary ? ' primary' : ''}" id="tz-pill-${i}">
      <div class="tz-pill-time" id="tz-time-${i}">${time}</div>
      <div class="tz-pill-label">
        ${p.flag} ${p.abbr || p.label}${removable ? `<span class="tz-remove" onclick="tzRemove('${tz}')" title="Remove">✕</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

function tzTick() {
  const zones = tzGetSaved();
  zones.forEach((tz, i) => {
    const el = document.getElementById(`tz-time-${i}`);
    if (el) el.textContent = tzFormatTime(tz);
  });
}

// Open timezone picker modal
window.tzOpenPicker = function() {
  const modal = document.getElementById('tzPickerModal');
  if (!modal) { tzInjectPickerModal(); }
  document.getElementById('tzPickerModal').classList.add('open');
  tzRenderPickerList('');
  document.getElementById('tzPickerSearch').focus();
};

function tzInjectPickerModal() {
  const div = document.createElement('div');
  div.id = 'tzPickerModal';
  div.innerHTML = `
    <div class="tz-picker-box">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.9rem">
        <h3 style="font-size:.95rem;font-weight:700;color:var(--g9)">🌍 Add Timezone</h3>
        <button onclick="document.getElementById('tzPickerModal').classList.remove('open')"
          style="background:none;border:none;font-size:1.1rem;cursor:pointer;color:var(--txt3)">✕</button>
      </div>
      <input id="tzPickerSearch" class="tz-picker-search" placeholder="Search country, city, timezone…"
        oninput="tzRenderPickerList(this.value)">
      <div class="tz-picker-list" id="tzPickerList"></div>
    </div>`;
  document.body.appendChild(div);
  div.addEventListener('click', e => { if (e.target === div) div.classList.remove('open'); });
}

window.tzRenderPickerList = function(q) {
  const list = document.getElementById('tzPickerList');
  if (!list) return;
  const saved = tzGetSaved();
  const qLow  = q.toLowerCase();
  const items = TZ_PRESETS.filter(t =>
    !saved.includes(t.id) && (
      !q || t.label.toLowerCase().includes(qLow) ||
      t.city.toLowerCase().includes(qLow) ||
      t.abbr.toLowerCase().includes(qLow) ||
      t.id.toLowerCase().includes(qLow)
    )
  );
  // Remove duplicates by id
  const seen = new Set();
  const unique = items.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });

  if (!unique.length) {
    list.innerHTML = '<div style="text-align:center;color:var(--txt3);padding:1.5rem;font-size:.84rem">No timezones found</div>';
    return;
  }
  list.innerHTML = unique.map(t => `
    <div class="tz-picker-item" onclick="tzAdd('${t.id}')">
      <div>
        <div class="tz-pi-name">${t.flag} ${t.label}</div>
        <div class="tz-pi-city">${t.city}</div>
      </div>
      <div class="tz-pi-time">${tzFormatTime(t.id)}</div>
    </div>`).join('');
};

window.tzAdd = function(id) {
  const zones = tzGetSaved();
  if (!zones.includes(id)) {
    zones.push(id);
    tzSave(zones);
    tzRenderClocks();
  }
  document.getElementById('tzPickerModal')?.classList.remove('open');
};

window.tzRemove = function(id) {
  const zones = tzGetSaved().filter(z => z !== id);
  tzSave(zones);
  tzRenderClocks();
};

let clockInterval = null;
function startClock() {
  if (clockInterval) clearInterval(clockInterval);
  // Initial render
  tzRenderClocks();
  tzInjectPickerModal();
  clockInterval = setInterval(() => {
    const row = document.getElementById('tzClocksRow');
    if (row) { tzTick(); }
    else { clearInterval(clockInterval); }
  }, 1000);
}

// ══════════════════════════════════════════════════
//  CLOSE SIDEBAR ON OUTSIDE CLICK
// ══════════════════════════════════════════════════
document.addEventListener('click', (e) => {
  if (STATE.sidebarOpen &&
    !document.getElementById('sidebar').contains(e.target) &&
    !document.getElementById('hamburger').contains(e.target)) {
    closeSidebar();
  }
  if (STATE.notifOpen &&
    !document.getElementById('notifPanel').contains(e.target) &&
    !e.target.closest('.h-icon-btn')) {
    STATE.notifOpen = false;
    document.getElementById('notifPanel').classList.remove('open');
  }
});


// ════════════════════════════════════════════════════════════════
//  APPS HUB — All external app & tool links in one place
// ════════════════════════════════════════════════════════════════
// ── App link card renderer (shared) ──────────────────────────────
function _renderAppLinkCard(app) {
  return `
  <a href="${app.url}" target="_blank" rel="noopener noreferrer"
    style="display:flex;align-items:flex-start;gap:1rem;padding:1rem 1.2rem;text-decoration:none;color:inherit;border-bottom:1px solid var(--border);border-right:1px solid var(--border);transition:background .15s"
    onmouseover="this.style.background='var(--surface2)'"
    onmouseout="this.style.background=''">
    <div style="width:40px;height:40px;border-radius:10px;background:${app.color}18;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:.1rem">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${app.color}" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
    </div>
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.2rem">
        <span style="font-size:.9rem;font-weight:600;color:var(--txt)">${app.name}</span>
        <span style="background:${app.color}18;color:${app.color};font-size:.62rem;font-weight:700;padding:1px 7px;border-radius:8px;flex-shrink:0">${app.tag}</span>
      </div>
      <div style="font-size:.78rem;color:var(--txt3);line-height:1.4">${app.desc}</div>
    </div>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--txt4)" stroke-width="2" style="flex-shrink:0;margin-top:.3rem"><polyline points="9 18 15 12 9 6"/></svg>
  </a>`;
}

function _renderAppGroup(group, role) {
  const visible = group.apps.filter(a => !a.roles || a.roles.includes(role));
  if (!visible.length) return '';
  return `
  <div class="card">
    <div class="card-head">
      <h3>${group.icon} ${group.group}</h3>
      <span class="hr-stat-pill">${visible.length} item${visible.length !== 1 ? 's' : ''}</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:0;border-top:1px solid var(--border)">
      ${visible.map(_renderAppLinkCard).join('')}
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════════════════
//  APPS HUB — AppSheet apps + Portal link (all roles)
// ════════════════════════════════════════════════════════════════
function renderAppsHub() {
  const el   = document.getElementById('mainContent');
  const role = STATE.role;

  const APPS = [
    {
      group: 'AppSheet Apps', icon: '📱',
      apps: [
        { name: 'HR App',      desc: 'Employee register, attendance, leave, onboarding',
          url: 'https://www.appsheet.com/start/9fcf3039-c992-4498-9647-2bcccca13ece',
          tag: 'HR', color: '#7c3aed', roles: ['md','hr','employee','dept_head'] },
        { name: 'Accounts App',desc: 'Payment requests, approvals, accounts management',
          url: 'https://www.appsheet.com/start/fcdba849-9f9d-435f-8e8a-ea0c975dbd21',
          tag: 'Finance', color: '#0ea5e9', roles: ['md','accounts','purchase','dept_head'] },
        { name: 'SCM App',     desc: 'Purchase orders, MRS, stores, vendor rate list',
          url: 'https://www.appsheet.com/start/06fd0117-1dd8-445b-aaee-e2ff6e68e36f',
          tag: 'SCM', color: '#16a34a', roles: ['md','purchase','site','dept_head'] },
      ]
    },
    {
      group: 'Portal', icon: '🌿',
      apps: [
        { name: 'EVGCPL Portal', desc: 'This intranet portal — share this link with team members',
          url: 'https://evgcpladmin.github.io/evgcpl-portal/',
          tag: 'Portal', color: '#16a34a' },
        { name: 'PIN Set / Reset', desc: 'Set or reset your portal login PIN',
          url: 'https://evgcpladmin.github.io/password/',
          tag: 'Auth', color: '#6b7280' },
        { name: 'Onboarding Form', desc: 'New employee onboarding form',
          url: 'https://neurolooom-eng.github.io/onboarding/',
          tag: 'HR', color: '#7c3aed', roles: ['md','hr'] },
      ]
    },
  ];

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1>📱 Apps</h1>
          <p>AppSheet apps and portal links for your team</p>
        </div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:1.4rem">
      ${APPS.map(g => _renderAppGroup(g, role)).join('')}
      <div class="card card-pad" style="background:var(--surface2)">
        <div style="display:flex;align-items:center;gap:.8rem;flex-wrap:wrap">
          <span style="font-size:.82rem;font-weight:600;color:var(--txt2)">📋 Share Portal Link:</span>
          <code style="font-size:.78rem;background:var(--surface1,#fff);border:1px solid var(--border);padding:4px 10px;border-radius:6px;color:var(--g7)">https://evgcpladmin.github.io/evgcpl-portal/</code>
          <button onclick="navigator.clipboard.writeText('https://evgcpladmin.github.io/evgcpl-portal/');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000)" class="btn btn-secondary btn-sm">Copy</button>
        </div>
      </div>
    </div>
  `;
}

// ════════════════════════════════════════════════════════════════
//  SHEETS HUB — Google Sheet links (MD / Admin only)
// ════════════════════════════════════════════════════════════════
function renderSheetsHub() {
  const el   = document.getElementById('mainContent');
  const role = STATE.role;

  // Guard — md only
  if (role !== 'md') {
    el.innerHTML = `<div class="module-placeholder"><div style="font-size:2rem;margin-bottom:.6rem">🔒</div><p>This page is restricted to Administrators only.</p></div>`;
    return;
  }

  const SHEETS = [
    {
      group: 'Master Data', icon: '🗄️',
      apps: [
        { name: 'Master Sheet',       desc: 'Sites, assets, vendors, subcontractors — master data',
          url: 'https://docs.google.com/spreadsheets/d/1B2wb38KhNwlLoZnsAGWQkO0FdEGFFfsh3ycRRurigq4',
          tag: 'Master', color: '#16a34a' },
        { name: 'Employee Register',  desc: 'Full employee register — current & past employees',
          url: 'https://docs.google.com/spreadsheets/d/1HWKZPhKRhcuvxBgyyN8zRt8p-SzYmKjJWiOdCgykBHs',
          tag: 'HR', color: '#7c3aed' },
        { name: 'v2 Master',          desc: 'Purchase orders, MRS, payment requests',
          url: 'https://docs.google.com/spreadsheets/d/1fhSO4WBYp0LNXPxe9I9zr5qsIPs9CIDFpUixBogPnsM',
          tag: 'SCM', color: '#16a34a' },
        { name: 'Rewards & Wall',     desc: 'Posts, Reactions, Comments, Nominations',
          url: 'https://docs.google.com/spreadsheets/d/1vz8HLopjlSF8TF7rzYuVu5JjqukT929I7aSx7kdehlI',
          tag: 'HR', color: '#f59e0b' },
        { name: 'UserSecrets (PIN)',   desc: 'PIN authentication — employee login credentials',
          url: 'https://docs.google.com/spreadsheets/d/1hN4VEDNpVLD3lKuBPYCTOaViv7UpveRfud2d2gy15D0',
          tag: 'Auth', color: '#6b7280' },
      ]
    },
    {
      group: 'Finance & Procurement', icon: '💰',
      apps: [
        { name: 'Purchase Orders',    desc: 'All POs — v2_Purchase sheet',
          url: 'https://docs.google.com/spreadsheets/d/1zcqF2tjjBETPuW25c9MBMo0zakBIBD6tksg5OstFA7c',
          tag: 'PO', color: '#f59e0b' },
        { name: 'Payments Sheet',     desc: 'All payment requests — PaymentRequest tab',
          url: 'https://docs.google.com/spreadsheets/d/1mLddxLRf719EaXE9XSET9gT8l0a8Cxns362yIbHo63g',
          tag: 'Finance', color: '#0ea5e9' },
        { name: 'Stores Sheet',       desc: 'Stock IN/OUT, GRN — v2 Stores register',
          url: 'https://docs.google.com/spreadsheets/d/1iMQxgqGilUh2_3NCZl5D-EMt-NC8FwugX83q2fWb8fE',
          tag: 'Stores', color: '#ea580c' },
        { name: 'Safety Sheet',       desc: 'Safety incidents and daily check records',
          url: 'https://docs.google.com/spreadsheets/d/1B8P0PawV43ksazbzhKsil1X6-INOfxx9PFvGycNOvDY',
          tag: 'Safety', color: '#dc2626' },
      ]
    },
    {
      group: 'Developer & Admin', icon: '🔧',
      apps: [
        { name: 'Apps Script API',    desc: 'Backend proxy — AI, file uploads, PIN, appendRow',
          url: getExec('main'),
          tag: 'Dev', color: '#6b7280' },
        { name: 'Groq Console',       desc: 'AI API key management — free 14,400 req/day',
          url: 'https://console.groq.com',
          tag: 'AI', color: '#7c3aed' },
        { name: 'Google AI Studio',   desc: 'Gemini API — alternative AI provider',
          url: 'https://aistudio.google.com',
          tag: 'AI', color: '#0ea5e9' },
        { name: 'GitHub Repository',  desc: 'Portal source code — evgcpladmin/evgcpl-portal',
          url: 'https://github.com/evgcpladmin/evgcpl-portal',
          tag: 'Dev', color: '#24292e' },
      ]
    },
  ];

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1>📊 Sheets</h1>
          <p>Google Sheets — source of truth for all portal data &nbsp;·&nbsp; Admin only</p>
        </div>
        <span style="background:#fef2f2;color:#dc2626;border:1px solid #fca5a5;padding:4px 12px;border-radius:20px;font-size:.75rem;font-weight:700">🔒 Admin Only</span>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:1.4rem">
      ${SHEETS.map(g => _renderAppGroup(g, role)).join('')}
    </div>
  `;
}

function renderAppsHub_REPLACED() { // placeholder — keep old name in route map pointing to new fn

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1>🔗 Apps &amp; Links</h1>
          <p>All connected apps, sheets, and tools in one place</p>
        </div>
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:1.4rem">
      ${APP_LIST.map(group => {
        const visibleApps = group.apps.filter(a => a.roles.includes(role));
        if (!visibleApps.length) return '';
        return `
        <div class="card">
          <div class="card-head">
            <h3>${group.icon} ${group.group}</h3>
            <span class="hr-stat-pill">${visibleApps.length} app${visibleApps.length !== 1 ? 's' : ''}</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:0;border-top:1px solid var(--border)">
            ${visibleApps.map(app => `
            <a href="${app.url}" target="_blank" rel="noopener noreferrer"
              style="display:flex;align-items:flex-start;gap:1rem;padding:1rem 1.2rem;text-decoration:none;color:inherit;border-bottom:1px solid var(--border);border-right:1px solid var(--border);transition:background .15s"
              onmouseover="this.style.background='var(--surface2)'"
              onmouseout="this.style.background=''">
              <div style="width:40px;height:40px;border-radius:10px;background:${app.color}18;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:.1rem">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${app.color}" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.2rem">
                  <span style="font-size:.9rem;font-weight:600;color:var(--txt)">${app.name}</span>
                  <span style="background:${app.color}18;color:${app.color};font-size:.62rem;font-weight:700;padding:1px 7px;border-radius:8px;flex-shrink:0">${app.tag}</span>
                </div>
                <div style="font-size:.78rem;color:var(--txt3);line-height:1.4">${app.desc}</div>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--txt4)" stroke-width="2" style="flex-shrink:0;margin-top:.3rem"><polyline points="9 18 15 12 9 6"/></svg>
            </a>`).join('')}
          </div>
        </div>`;
      }).join('')}

      <!-- Quick copy links for sharing -->
      <div class="card card-pad" style="background:var(--surface2)">
        <div style="display:flex;align-items:center;gap:.8rem;flex-wrap:wrap">
          <span style="font-size:.82rem;font-weight:600;color:var(--txt2)">📋 Share Portal Link:</span>
          <code style="font-size:.78rem;background:var(--surface1,#fff);border:1px solid var(--border);padding:4px 10px;border-radius:6px;color:var(--g7)">https://evgcpladmin.github.io/evgcpl-portal/</code>
          <button onclick="navigator.clipboard.writeText('https://evgcpladmin.github.io/evgcpl-portal/');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000)" class="btn btn-secondary btn-sm">Copy</button>
        </div>
      </div>
    </div>
  `;
}



// ════════════════════════════════════════════════════════════════
//  WALL — Company Blog / Social Feed
//  Posts, reactions (👍❤️🎉), comments — all stored in Google Sheet
//  Sheet: REWARDS_SHEET_ID → tabs: Posts, Reactions, Comments
//
//  Posts tab cols:  A=PostID  B=Timestamp  C=AuthorName  D=AuthorEmail
//                   E=Dept    F=Body       G=ImageURL    H=Tags
//  Reactions tab:   A=PostID  B=UserEmail  C=Emoji  D=Timestamp
//  Comments tab:    A=CommentID  B=PostID  C=Timestamp  D=AuthorName
//                   E=AuthorEmail  F=Body
// ════════════════════════════════════════════════════════════════

const WALL_EMOJIS = ['👍','❤️','🎉','🙌','🔥'];

let _wallPosts     = [];
let _wallReactions = {}; // postId → [{email,emoji}]
let _wallComments  = {}; // postId → [{id,name,body,ts}]
let _wallLoaded    = false;
let _wallShowComments = {}; // postId → bool

function renderWallPage() {
  const el = document.getElementById('mainContent');
  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1>📣 Company Wall</h1>
          <p>Share updates, celebrate wins &middot; React &middot; Comment</p>
        </div>
        <button class="btn btn-gold btn-sm" onclick="wallScrollToCompose()">✏️ New Post</button>
      </div>
    </div>

    <!-- Compose -->
    <div class="blog-compose-card" id="wallCompose">
      <div style="display:flex;gap:.75rem;align-items:flex-start;margin-bottom:.7rem">
        <div class="blog-avatar" id="wallMyAvatar">${(STATE.user?.name||'?').charAt(0)}</div>
        <div style="flex:1">
          <textarea class="blog-compose-area" id="wallPostBody"
            placeholder="Share an update, celebrate a win, or post an announcement…"></textarea>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">
        <input id="wallPostImage" type="url" placeholder="Image URL (optional)"
          style="flex:1;min-width:200px;border:1px solid var(--border);border-radius:8px;padding:.4rem .8rem;font-size:.82rem;background:var(--surface2);outline:none">
        <input id="wallPostTags" type="text" placeholder="#tags (optional)"
          style="width:160px;border:1px solid var(--border);border-radius:8px;padding:.4rem .8rem;font-size:.82rem;background:var(--surface2);outline:none">
        <button class="btn btn-gold btn-sm" onclick="wallSubmitPost()" id="wallPostBtn" style="flex-shrink:0">Post</button>
      </div>
      <div id="wallPostMsg" style="display:none;margin-top:.5rem;font-size:.8rem;padding:.4rem .8rem;border-radius:6px"></div>
    </div>

    <!-- Feed -->
    <div id="wallFeed">
      <div style="text-align:center;padding:3rem;color:var(--txt3)">⏳ Loading posts…</div>
    </div>
  `;

  wallLoadPosts();
}

window.wallScrollToCompose = function() {
  document.getElementById('wallCompose')?.scrollIntoView({ behavior:'smooth' });
  document.getElementById('wallPostBody')?.focus();
};

// ── Load posts + reactions + comments ────────────────────────────
async function wallLoadPosts() {
  const feed = document.getElementById('wallFeed');

  // If no sheet connected, just show empty state — no error
  if (!REWARDS_SHEET_ID) {
    _wallPosts = []; _wallReactions = {}; _wallComments = {};
    _wallLoaded = true;
    wallRenderFeed();
    return;
  }

  try {
    // Each tab fetch gets its own .catch so missing tabs return [] not throw
    const safeTab = (tab, query) =>
      fetchSheet(tab, query, REWARDS_SHEET_ID)
        .catch(() => []); // tab doesn't exist yet → empty array

    const [postRows, reactRows, commentRows] = await Promise.all([
      safeTab('Posts',     'SELECT A,B,C,D,E,F,G,H'),
      safeTab('Reactions', 'SELECT A,B,C,D'),
      safeTab('Comments',  'SELECT A,B,C,D,E,F'),
    ]);

    // Use letter columns (A,B,C…) — reliable regardless of whether row 1 is a header.
    // Named columns only work if the sheet has a header row, which these tabs may not have
    // if they were auto-created by Apps Script without headers.
    // Posts tab: A=PostID B=Timestamp C=AuthorName D=AuthorEmail E=Dept F=Body G=ImageURL H=Tags
    _wallPosts = postRows.map(r => ({
      id:     r['A'] || '',
      ts:     r['B'] || '',
      author: r['C'] || 'Anonymous',
      email:  r['D'] || '',
      dept:   r['E'] || '',
      body:   r['F'] || '',
      image:  r['G'] || '',
      tags:   r['H'] || '',
    })).filter(p => {
      // Skip header rows (first row may be "PostID","Timestamp"... if headers exist)
      return p.id && p.body && !p.id.toLowerCase().includes('postid') && p.id !== 'A';
    }).reverse(); // newest first

    // Reactions tab: A=PostID B=UserEmail C=Emoji D=Timestamp
    _wallReactions = {};
    reactRows.forEach(r => {
      const pid = r['A'] || '';
      if (!pid || pid.toLowerCase() === 'postid') return; // skip header row
      if (!_wallReactions[pid]) _wallReactions[pid] = [];
      _wallReactions[pid].push({ email: r['B']||'', emoji: r['C']||'👍' });
    });

    // Comments tab: A=CommentID B=PostID C=Timestamp D=AuthorName E=AuthorEmail F=Body
    _wallComments = {};
    commentRows.forEach(r => {
      const pid = r['B'] || '';
      if (!pid || pid.toLowerCase() === 'postid') return; // skip header row
      if (!_wallComments[pid]) _wallComments[pid] = [];
      _wallComments[pid].push({
        id:   r['A'] || '',
        ts:   r['C'] || '',
        name: r['D'] || 'Anonymous',
        body: r['F'] || '',
      });
    });

    _wallLoaded = true;
    wallRenderFeed();
  } catch(err) {
    // On any error just show empty feed — the tab probably doesn't exist yet
    _wallPosts = []; _wallReactions = {}; _wallComments = {};
    _wallLoaded = true;
    wallRenderFeed();
  }
}

// ── Render feed ───────────────────────────────────────────────────
function wallRenderFeed() {
  const feed = document.getElementById('wallFeed');
  if (!feed) return;
  const myEmail = STATE.user?.email || '';

  if (!_wallPosts.length) {
    feed.innerHTML = `
      <div style="text-align:center;padding:4rem 2rem;color:var(--txt3)">
        <div style="font-size:2.5rem;margin-bottom:.75rem">📣</div>
        <div style="font-weight:700;font-size:1rem;color:var(--txt2)">No posts yet</div>
        <div style="font-size:.84rem;margin-top:.4rem">Be the first to share something!</div>
      </div>`;
    return;
  }

  feed.innerHTML = _wallPosts.map(post => wallRenderPost(post, myEmail)).join('');
}

// Parse Indian locale timestamps like "27/3/2026, 11:05:38 pm"
// Also handles ISO strings, gviz Date strings, and plain locale strings
function wallParseTs(ts) {
  if (!ts) return null;
  // Indian locale: "27/3/2026, 11:05:38 pm" or "27/3/2026, 23:05:38"
  const m = String(ts).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (m) {
    let [, d, mo, y, h, min, sec, ampm] = m;
    h = parseInt(h, 10);
    if (ampm) {
      if (ampm.toLowerCase() === 'pm' && h !== 12) h += 12;
      if (ampm.toLowerCase() === 'am' && h === 12) h = 0;
    }
    return new Date(+y, +mo - 1, +d, h, +min, +(sec||0));
  }
  // Fallback: ISO / any other format
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

function wallFmtTs(ts) {
  const d = wallParseTs(ts);
  if (!d) return '';
  return d.toLocaleString('en-IN', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'});
}

function wallFmtMonth(ts) {
  const d = wallParseTs(ts);
  if (!d) return '';
  return d.toLocaleDateString('en-IN', {month:'long', year:'numeric'});
}

function wallRenderPost(post, myEmail) {
  const reactions  = _wallReactions[post.id] || [];
  const comments   = _wallComments[post.id]  || [];
  const showCmt    = _wallShowComments[post.id] || false;
  const initials   = (post.author||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const tsDisplay  = wallFmtTs(post.ts);

  // Emoji reaction counts + user's current reaction
  const emojiCounts = {};
  let myReaction = '';
  reactions.forEach(r => {
    emojiCounts[r.emoji] = (emojiCounts[r.emoji]||0) + 1;
    if (r.email === myEmail) myReaction = r.emoji;
  });
  const totalReactions = reactions.length;

  const reactionBtns = WALL_EMOJIS.map(e => {
    const count = emojiCounts[e] || 0;
    const active = myReaction === e;
    return `<button class="blog-reaction-btn${active?' liked':''}"
      onclick="wallToggleReaction('${post.id}','${e}')"
      title="${e}">
      ${e}${count ? ` <span style="font-size:.75rem">${count}</span>` : ''}
    </button>`;
  }).join('');

  const tagsHtml = post.tags ? post.tags.split(/[,\s#]+/).filter(Boolean).map(t =>
    `<span style="background:var(--g5)18;color:var(--g7);font-size:.68rem;padding:2px 8px;border-radius:10px;font-weight:600">#${t}</span>`
  ).join(' ') : '';

  const commentsHtml = showCmt ? `
    <div class="blog-comment-section" id="cmt-${post.id}">
      ${comments.length ? comments.map(c => `
        <div class="blog-comment">
          <div class="blog-comment-avatar">${(c.name||'?').charAt(0)}</div>
          <div class="blog-comment-bubble">
            <div class="blog-comment-name">${c.name} <span style="font-weight:400;color:var(--txt3);font-size:.68rem">· ${wallFmtTs(c.ts)}</span></div>
            <div class="blog-comment-text">${wallEscape(c.body)}</div>
          </div>
        </div>`).join('') : '<div style="color:var(--txt3);font-size:.8rem;margin-bottom:.5rem">No comments yet.</div>'}
      <div class="blog-comment-input-row">
        <div class="blog-comment-avatar">${(STATE.user?.name||'?').charAt(0)}</div>
        <input class="blog-comment-input" id="cmtInput-${post.id}"
          placeholder="Write a comment…"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();wallSubmitComment('${post.id}')}">
        <button class="blog-reaction-btn" onclick="wallSubmitComment('${post.id}')" style="border-radius:20px;padding:.35rem .8rem">Send</button>
      </div>
    </div>` : '';

  return `
    <div class="blog-post-card" id="post-${post.id}">
      <div class="blog-post-header">
        <div class="blog-avatar">${initials}</div>
        <div class="blog-post-meta">
          <div class="blog-post-author">${wallEscape(post.author)} ${post.dept?`<span style="font-weight:400;color:var(--txt3);font-size:.78rem">· ${post.dept}</span>`:''}</div>
          <div class="blog-post-ts">${tsDisplay}</div>
        </div>
        ${tagsHtml ? `<div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-left:auto">${tagsHtml}</div>` : ''}
      </div>
      ${post.image ? `<img class="blog-post-image" src="${post.image}" alt="" onerror="this.style.display='none'">` : ''}
      <div class="blog-post-body">${wallEscape(post.body).replace(/\n/g,'<br>')}</div>
      <div class="blog-post-footer">
        ${reactionBtns}
        <button class="blog-reaction-btn" onclick="wallToggleComments('${post.id}')" style="margin-left:auto">
          💬 ${comments.length ? comments.length : ''} Comment${comments.length!==1?'s':''}
        </button>
      </div>
      ${commentsHtml}
    </div>`;
}

// ── Helper: escape HTML ───────────────────────────────────────────
function wallEscape(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Toggle comment section ────────────────────────────────────────
window.wallToggleComments = function(postId) {
  _wallShowComments[postId] = !_wallShowComments[postId];
  wallRenderFeed();
  if (_wallShowComments[postId]) {
    setTimeout(() => {
      document.getElementById(`cmtInput-${postId}`)?.focus();
    }, 50);
  }
};

// ── Toggle reaction ───────────────────────────────────────────────
window.wallToggleReaction = function(postId, emoji) {
  const myEmail = STATE.user?.email || '';
  if (!myEmail) return;

  const reactions = _wallReactions[postId] || [];
  const existing  = reactions.find(r => r.email === myEmail);

  if (existing && existing.emoji === emoji) {
    // Remove reaction — can't delete from sheet easily, just update locally
    _wallReactions[postId] = reactions.filter(r => r.email !== myEmail);
  } else {
    // Replace or add
    _wallReactions[postId] = reactions.filter(r => r.email !== myEmail);
    _wallReactions[postId].push({ email: myEmail, emoji });

    // Persist to sheet
    const row = [
      postId,
      myEmail,
      emoji,
      new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}),
    ];
    fetch(APPS_SCRIPT_URL, {
      method:'POST', headers:{'Content-Type':'text/plain'},
      body: JSON.stringify({ action:'appendRow', sheetId:REWARDS_SHEET_ID, tab:'Reactions', row }),
    }).catch(()=>{});
  }

  // Re-render just this post
  const postEl = document.getElementById(`post-${postId}`);
  const post   = _wallPosts.find(p => p.id === postId);
  if (postEl && post) {
    postEl.outerHTML = wallRenderPost(post, myEmail);
  }
};

// ── Submit comment ────────────────────────────────────────────────
window.wallSubmitComment = function(postId) {
  const input = document.getElementById(`cmtInput-${postId}`);
  const body  = (input?.value || '').trim();
  if (!body) return;

  const myName  = STATE.user?.name  || 'Anonymous';
  const myEmail = STATE.user?.email || '';
  const ts      = new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'});
  const cmtId   = 'cmt-' + Date.now();

  // Update locally
  if (!_wallComments[postId]) _wallComments[postId] = [];
  _wallComments[postId].push({ id: cmtId, ts, name: myName, body });
  if (input) input.value = '';

  // Re-render post
  const postEl = document.getElementById(`post-${postId}`);
  const post   = _wallPosts.find(p => p.id === postId);
  if (postEl && post) postEl.outerHTML = wallRenderPost(post, myEmail);
  _wallShowComments[postId] = true;

  // Persist to sheet
  const row = [cmtId, postId, ts, myName, myEmail, body];
  fetch(APPS_SCRIPT_URL, {
    method:'POST', headers:{'Content-Type':'text/plain'},
    body: JSON.stringify({ action:'appendRow', sheetId:REWARDS_SHEET_ID, tab:'Comments', row }),
  }).catch(()=>{});

  // Re-focus comment input
  setTimeout(() => document.getElementById(`cmtInput-${postId}`)?.focus(), 50);
};

// ── Submit new post ───────────────────────────────────────────────
window.wallSubmitPost = function() {
  const body     = (document.getElementById('wallPostBody')?.value   || '').trim();
  const imageUrl = (document.getElementById('wallPostImage')?.value  || '').trim();
  const tags     = (document.getElementById('wallPostTags')?.value   || '').trim();
  const msgEl    = document.getElementById('wallPostMsg');
  const btn      = document.getElementById('wallPostBtn');

  const showMsg = (txt, ok) => {
    if (!msgEl) return;
    msgEl.style.display = 'block';
    msgEl.style.background = ok ? '#f0fdf4' : '#fef2f2';
    msgEl.style.color      = ok ? '#16a34a' : '#dc2626';
    msgEl.textContent = txt;
  };

  if (!body) return showMsg('Please write something before posting.', false);

  const myName  = STATE.user?.name  || 'Anonymous';
  const myEmail = STATE.user?.email || '';
  const emp     = (STATE.masters.users||[]).find(u => u.email?.toLowerCase() === myEmail.toLowerCase());
  const ts      = new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'});
  const postId  = 'post-' + Date.now();

  if (btn) { btn.disabled = true; btn.textContent = 'Posting…'; }

  const row = [postId, ts, myName, myEmail, emp?.dept || '', body, imageUrl, tags];

  fetch(APPS_SCRIPT_URL, {
    method:'POST', headers:{'Content-Type':'text/plain'},
    body: JSON.stringify({ action:'appendRow', sheetId:REWARDS_SHEET_ID, tab:'Posts', row }),
  })
  .then(r => r.json())
  .then(res => {
    if (!res.success) throw new Error(res.message || 'Failed');
    // Add to local state and re-render
    _wallPosts.unshift({ id:postId, ts, author:myName, email:myEmail, dept:emp?.dept||'', body, image:imageUrl, tags });
    document.getElementById('wallPostBody').value  = '';
    document.getElementById('wallPostImage').value = '';
    document.getElementById('wallPostTags').value  = '';
    if (msgEl) msgEl.style.display = 'none';
    wallRenderFeed();
    showMsg('✓ Posted!', true);
    setTimeout(() => { if (msgEl) msgEl.style.display='none'; }, 2000);
  })
  .catch(err => showMsg('Error: ' + err.message, false))
  .finally(() => { if (btn) { btn.disabled=false; btn.textContent='Post'; } });
};


// ════════════════════════════════════════════════════════════════
//  PROJECTS — Planning & Budget (Overview + Project Setup sub-pages)
// ════════════════════════════════════════════════════════════════
function renderProjectsPage(subPage) {
  const el = document.getElementById('mainContent');
  const current = subPage || 'overview';

  const subNav = (id, label, icon) => `
    <button onclick="renderProjectsPage('${id}')"
      style="display:flex;align-items:center;gap:.5rem;padding:.55rem 1.1rem;border:none;background:none;
      font-family:inherit;font-size:.84rem;font-weight:600;cursor:pointer;border-bottom:2px solid ${current===id?'var(--g7)':'transparent'};
      margin-bottom:-2px;color:${current===id?'var(--g7)':'var(--txt3)'};transition:all .15s">
      ${icon} ${label}
    </button>`;

  el.innerHTML = `
    <div class="page-header" style="margin-bottom:1rem">
      <div class="page-header-row">
        <div>
          <h1>📐 Planning &amp; Budget</h1>
          <p>Project overview · Setup · Budget control · Measurement book</p>
        </div>
        <div style="display:flex;gap:.6rem">
          <button class="btn btn-secondary btn-sm" onclick="renderProjectsPage('${current}')">↻ Refresh</button>
        </div>
      </div>
      <div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-top:.6rem">
        ${subNav('overview',      'Overview',       '📊')}
        ${subNav('project-setup', 'Project Setup',  '⚙️')}
      </div>
    </div>`;

  if (current === 'overview') {
    // Overview: KPIs + link into full planning module
    const users   = STATE.masters.users || [];
    const sites   = STATE.masters.sites || [];
    const assets  = STATE.masters.assets || [];
    const active  = users.filter(u => u.status === 'ACTIVE').length;
    el.innerHTML += `
      <div class="kpi-grid" style="margin-bottom:1.4rem">
        <div class="kpi-card gold">
          <div class="kpi-top"><div class="kpi-icon gold">🏗️</div><div class="kpi-trend flat">Active</div></div>
          <div class="kpi-value">${sites.filter(s=>(s.status||'').toUpperCase()==='ACTIVE').length}</div>
          <div class="kpi-label">Active Sites</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-top"><div class="kpi-icon green">👷</div><div class="kpi-trend flat">Current</div></div>
          <div class="kpi-value">${active}</div>
          <div class="kpi-label">Deployed Staff</div>
        </div>
        <div class="kpi-card info">
          <div class="kpi-top"><div class="kpi-icon blue">🚜</div><div class="kpi-trend flat">Fleet</div></div>
          <div class="kpi-value">${assets.length}</div>
          <div class="kpi-label">Equipment Units</div>
        </div>
        <div class="kpi-card" style="border-left:4px solid var(--gold)">
          <div class="kpi-top"><div class="kpi-icon gold">📋</div><div class="kpi-trend flat">Modules</div></div>
          <div class="kpi-value">2</div>
          <div class="kpi-label">Planning Tools</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.2rem">
        <div class="card card-pad" style="cursor:pointer;border-left:4px solid var(--g7)"
          onclick="navigate('planning')" onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,.08)'" onmouseout="this.style.boxShadow=''">
          <div style="display:flex;align-items:center;gap:.8rem;margin-bottom:.6rem">
            <div style="font-size:1.6rem">📏</div>
            <div>
              <div style="font-weight:700;color:var(--g9)">Measurement Book</div>
              <div style="font-size:.78rem;color:var(--txt3)">BOQ planning &amp; execution entries</div>
            </div>
          </div>
          <div style="font-size:.82rem;color:var(--txt2);line-height:1.5">
            Track BOQ items, log measurements, compute cumulative quantities, resource-wise cost breakup.
          </div>
          <div style="margin-top:.8rem">
            <span style="font-size:.72rem;background:var(--g7)18;color:var(--g7);padding:2px 10px;border-radius:10px;font-weight:700">Open →</span>
          </div>
        </div>

        <div class="card card-pad" style="cursor:pointer;border-left:4px solid var(--gold)"
          onclick="renderProjectsPage('project-setup')" onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,.08)'" onmouseout="this.style.boxShadow=''">
          <div style="display:flex;align-items:center;gap:.8rem;margin-bottom:.6rem">
            <div style="font-size:1.6rem">⚙️</div>
            <div>
              <div style="font-weight:700;color:var(--g9)">Project Setup</div>
              <div style="font-size:.78rem;color:var(--txt3)">Configure rates, categories &amp; personnel</div>
            </div>
          </div>
          <div style="font-size:.82rem;color:var(--txt2);line-height:1.5">
            Set up project master: labour rates, material norms, equipment rates, overhead categories.
          </div>
          <div style="margin-top:.8rem">
            <span style="font-size:.72rem;background:#f0a50018;color:var(--gold);padding:2px 10px;border-radius:10px;font-weight:700">Configure →</span>
          </div>
        </div>

        <div class="card card-pad" style="cursor:pointer;border-left:4px solid #0ea5e9"
          onclick="navigate('execution')" onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,.08)'" onmouseout="this.style.boxShadow=''">
          <div style="display:flex;align-items:center;gap:.8rem;margin-bottom:.6rem">
            <div style="font-size:1.6rem">📝</div>
            <div>
              <div style="font-weight:700;color:var(--g9)">DPR / Execution</div>
              <div style="font-size:.78rem;color:var(--txt3)">Daily progress reports &amp; site entries</div>
            </div>
          </div>
          <div style="font-size:.82rem;color:var(--txt2);line-height:1.5">
            Log daily progress, submit DPRs, track work done vs planned.
          </div>
          <div style="margin-top:.8rem">
            <span style="font-size:.72rem;background:#0ea5e918;color:#0ea5e9;padding:2px 10px;border-radius:10px;font-weight:700">Open →</span>
          </div>
        </div>
      </div>`;
  } else {
    // Project Setup — delegate to existing renderPlanningModule setup tab
    renderPlanningModule();
  }
}

// ════════════════════════════════════════════════════════════════
//  EXECUTION — DPR Entries sub-page
// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
//  BUDGETING — embeds the Project Cost Control (PCC) multipage app
// ════════════════════════════════════════════════════════════════
function renderBudgetingPage() {
  const el = document.getElementById('mainContent');
  // PCC lives at /<base>/pcc/. Resolve relative to current page.
  const pccBase = window.location.pathname.replace(/\/[^/]*$/, '/') + 'pcc/';

  el.innerHTML = `
    <div class="page-header" style="margin-bottom:.8rem">
      <div class="breadcrumb">
        <span>Home</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        <span>Planning</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        <span>Budgeting</span>
      </div>
      <div class="page-header-row">
        <div>
          <h1>💰 Budgeting</h1>
          <p>Project Cost Control &middot; setup, BOQ, WBS, workplan, resources &middot; variations</p>
        </div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <a href="${pccBase}index.html" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">↗ Open in new tab</a>
          <button class="btn btn-secondary btn-sm" onclick="document.getElementById('pccFrame').src=document.getElementById('pccFrame').src">↻ Refresh</button>
        </div>
      </div>
    </div>

    <div class="card" style="overflow:hidden;border-radius:12px">
      <iframe id="pccFrame" name="pccFrame" src="${pccBase}index.html"
        style="width:100%;height:calc(100vh - 220px);min-height:560px;border:0;display:block;background:#f4f6f4"
        title="Project Cost Control"></iframe>
    </div>

    <div style="margin-top:1rem;display:flex;gap:.4rem;flex-wrap:wrap">
      <a href="${pccBase}setup.html"      target="pccFrame" class="btn btn-secondary btn-sm">1. Setup</a>
      <a href="${pccBase}boq.html"        target="pccFrame" class="btn btn-secondary btn-sm">2. BOQ</a>
      <a href="${pccBase}wbs.html"        target="pccFrame" class="btn btn-secondary btn-sm">3. WBS</a>
      <a href="${pccBase}workplan.html"   target="pccFrame" class="btn btn-secondary btn-sm">4. Workplan</a>
      <a href="${pccBase}manpower.html"   target="pccFrame" class="btn btn-secondary btn-sm">5A. Manpower</a>
      <a href="${pccBase}machinery.html"  target="pccFrame" class="btn btn-secondary btn-sm">5B. Machinery</a>
      <a href="${pccBase}materials.html"  target="pccFrame" class="btn btn-secondary btn-sm">5C. Materials</a>
      <a href="${pccBase}overheads.html"  target="pccFrame" class="btn btn-secondary btn-sm">Overheads</a>
      <a href="${pccBase}summary.html"    target="pccFrame" class="btn btn-secondary btn-sm">6+7. Summary</a>
      <a href="${pccBase}variations.html" target="pccFrame" class="btn btn-secondary btn-sm">8. Variations</a>
    </div>
  `;
}

// ════════════════════════════════════════════════════════════════
//  ACTIVITY MASTER — Nature of Work + Type of Work (cascading)
//  Source: PCC sheet → M_PL_1_Activities tab
//  Used by: WBS (Nature of Work), Workplan (Activity), DPR forms
// ════════════════════════════════════════════════════════════════
//
//  Expected columns in M_PL_1_Activities (case + spacing tolerant):
//    - Nature of Work     (parent / cost package)
//    - Type of Work       (child / activity / cost center)
//    - UOM                (unit of measure)             [optional]
//    - Depends On         (predecessor activity)        [optional]
//    - Measurement Basis  (formula / how qty is derived)[optional]
//    - Active             (TRUE/FALSE — filter)         [optional]
//
//  Cached on STATE.activitiesCache to avoid repeated fetches.
//  Call invalidateActivityMaster() to force a refresh.
async function loadActivityMaster(force) {
  if (!force && STATE.activitiesCache && STATE.activitiesCache.rows && (Date.now() - STATE.activitiesCache.loadedAt) < 5*60*1000) {
    return STATE.activitiesCache.rows;
  }
  const url = `https://docs.google.com/spreadsheets/d/${PCC_SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(ACTIVITY_MASTER_TAB)}`;
  try {
    const res = await fetch(url);
    const txt = await res.text();
    const m = txt.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/);
    if (!m) throw new Error('Bad gviz response');
    const data = JSON.parse(m[1]);
    if (!data.table || !data.table.cols) throw new Error('No table');

    const cols = data.table.cols.map(c => (c.label || c.id || '').toString().trim());
    const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g,'');
    const idxOf = (...names) => {
      for (const n of names) {
        const i = cols.findIndex(c => norm(c) === norm(n));
        if (i >= 0) return i;
      }
      return -1;
    };
    const iNature  = idxOf('Nature of Work','NatureOfWork','Cost Package','Package');
    const iType    = idxOf('Type of Work','TypeOfWork','Activity','Cost Center','CostCenter');
    const iUOM     = idxOf('UOM','Unit','Unit of Measure');
    const iDeps    = idxOf('Depends On','DependsOn','Predecessor','Dependency');
    const iBasis   = idxOf('Measurement Basis','Formula','Basis');
    const iActive  = idxOf('Active','Status','Enabled');

    const get = (cells, i) => i < 0 ? '' : (cells[i]?.f ?? cells[i]?.v ?? '').toString().trim();

    const rows = (data.table.rows || []).map(r => {
      const c = r.c || [];
      const active = iActive >= 0 ? get(c, iActive) : '';
      const isActive = !active || /^(true|yes|y|1|active|on)$/i.test(active);
      return {
        natureOfWork:     get(c, iNature),
        typeOfWork:       get(c, iType),
        uom:              get(c, iUOM),
        dependsOn:        get(c, iDeps),
        measurementBasis: get(c, iBasis),
        active:           isActive,
      };
    }).filter(x => x.natureOfWork && x.typeOfWork && x.active);

    STATE.activitiesCache = { rows, loadedAt: Date.now() };
    return rows;
  } catch (err) {
    console.warn('[ActivityMaster] load failed:', err.message);
    STATE.activitiesCache = { rows: [], loadedAt: Date.now(), error: err.message };
    return [];
  }
}

function invalidateActivityMaster() { STATE.activitiesCache = null; }

// Get unique list of Nature of Work values (for WBS dropdown / filter)
function getNaturesOfWork() {
  const rows = (STATE.activitiesCache?.rows) || [];
  return [...new Set(rows.map(r => r.natureOfWork))].sort();
}

// Get Types of Work for a given Nature of Work (for cascading Activity dropdown)
function getTypesOfWork(natureOfWork) {
  if (!natureOfWork) return [];
  const rows = (STATE.activitiesCache?.rows) || [];
  return rows
    .filter(r => r.natureOfWork.toLowerCase() === natureOfWork.toLowerCase())
    .map(r => ({ typeOfWork: r.typeOfWork, uom: r.uom, dependsOn: r.dependsOn, basis: r.measurementBasis }))
    .sort((a, b) => a.typeOfWork.localeCompare(b.typeOfWork));
}

// Wire a pair of <select> elements as cascading Nature → Type dropdowns.
// Usage: bindActivityCascade(natureSelectId, typeSelectId, { onChange })
async function bindActivityCascade(natureId, typeId, opts) {
  opts = opts || {};
  await loadActivityMaster();
  const natureSel = document.getElementById(natureId);
  const typeSel   = document.getElementById(typeId);
  if (!natureSel || !typeSel) return;

  const natures = getNaturesOfWork();
  natureSel.innerHTML = `<option value="">— Nature of Work —</option>` +
    natures.map(n => `<option value="${n.replace(/"/g,'&quot;')}">${n}</option>`).join('');

  const populateTypes = (n) => {
    const types = getTypesOfWork(n);
    typeSel.innerHTML = `<option value="">— Type of Work —</option>` +
      types.map(t => {
        const label = t.uom ? `${t.typeOfWork} (${t.uom})` : t.typeOfWork;
        return `<option value="${t.typeOfWork.replace(/"/g,'&quot;')}" data-uom="${t.uom||''}" data-deps="${t.dependsOn||''}">${label}</option>`;
      }).join('');
    typeSel.disabled = types.length === 0;
  };
  populateTypes(natureSel.value);

  natureSel.addEventListener('change', () => {
    populateTypes(natureSel.value);
    if (opts.onChange) opts.onChange({ nature: natureSel.value, type: '' });
  });
  typeSel.addEventListener('change', () => {
    if (opts.onChange) opts.onChange({ nature: natureSel.value, type: typeSel.value });
  });
}

// Expose globally (PCC iframe pages and inline DPR forms both call these)
window.loadActivityMaster      = loadActivityMaster;
window.invalidateActivityMaster = invalidateActivityMaster;
window.getNaturesOfWork        = getNaturesOfWork;
window.getTypesOfWork          = getTypesOfWork;
window.bindActivityCascade     = bindActivityCascade;

// ════════════════════════════════════════════════════════════════
//  EXECUTION — DPR Entries + KPI strip + site dashboards
// ════════════════════════════════════════════════════════════════
async function loadDPRsFromSheet() {
  const url = `https://docs.google.com/spreadsheets/d/${DPR_SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(DPR_TAB)}`;
  try {
    const res = await fetch(url);
    const txt = await res.text();
    const m = txt.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/);
    if (!m) throw new Error('Bad gviz response');
    const data = JSON.parse(m[1]);
    if (!data.table || !data.table.cols) throw new Error('No table');

    const cols = data.table.cols.map(c => (c.label || c.id || '').toString().trim());
    const idxOf = (...names) => {
      for (const n of names) {
        const i = cols.findIndex(c => c.toLowerCase().replace(/[^a-z0-9]/g,'') === n.toLowerCase().replace(/[^a-z0-9]/g,''));
        if (i >= 0) return i;
      }
      return -1;
    };
    const iDate     = idxOf('Date','DPR Date','Report Date','Timestamp','Start Date');
    const iSite     = idxOf('Site','Site Name','Project','Project Code');
    const iActivity = idxOf('Activity','Work Done','Description','Type of Work','Scope');
    const iManpower = idxOf('Manpower','Workers','Men','Labour','Headcount');
    const iEqHrs    = idxOf('Equipment Hrs','Eq Hrs','Machine Hours','Machinery','Equipment Hours');
    const iRemarks  = idxOf('Remarks','Issues','Notes','Final Status');

    const normalizeDate = (cell) => {
      if (!cell) return '';
      if (cell.f) return cell.f;
      const v = (cell.v || '').toString();
      const m2 = v.match(/^Date\((\d+),(\d+),(\d+)/);
      if (m2) {
        const d = new Date(+m2[1], +m2[2], +m2[3]);
        return d.toISOString().slice(0,10);
      }
      return v;
    };

    const rows = (data.table.rows || []).map(r => {
      const cells = r.c || [];
      const get = (i) => i < 0 ? '' : (cells[i]?.f ?? cells[i]?.v ?? '').toString();
      return {
        date:      iDate >= 0 ? normalizeDate(cells[iDate]) : '',
        site:      get(iSite),
        activity:  get(iActivity),
        manpower:  parseFloat(get(iManpower)) || 0,
        equipHrs:  parseFloat(get(iEqHrs)) || 0,
        remarks:   get(iRemarks),
      };
    }).filter(e => e.date || e.site);

    STATE.dprCache = { entries: rows, loadedAt: Date.now() };
    return rows;
  } catch (err) {
    console.warn('[DPR] sheet load failed:', err.message);
    STATE.dprCache = { entries: [], loadedAt: Date.now(), error: err.message };
    return [];
  }
}

function hydrateExecKPIs() {
  const entries = (STATE.dprCache?.entries) || [];
  const today = new Date().toISOString().slice(0,10);
  const weekAgo = new Date(Date.now() - 7*24*3600*1000).toISOString().slice(0,10);
  const thisMonth = today.slice(0,7);

  const todays    = entries.filter(e => (e.date||'').slice(0,10) === today);
  const thisWeek  = entries.filter(e => (e.date||'').slice(0,10) >= weekAgo);
  const issueRe   = /(delay|issue|stop|hold|block|problem|defect|fail)/i;
  const openIssues = thisWeek.filter(e => issueRe.test(e.remarks || '')).length;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const activeSites = (STATE.masters?.sites || []).filter(s => (s.status||'').toUpperCase()==='ACTIVE').length;
  set('exKpi-sites',    activeSites);
  set('exKpi-dprToday', todays.length);
  set('exKpi-mp',       todays.reduce((a,e)=>a+(e.manpower||0),0).toLocaleString());
  set('exKpi-eq',       todays.reduce((a,e)=>a+(e.equipHrs||0),0).toLocaleString());
  set('exKpi-issues',   openIssues);
  set('exKpi-week',     thisWeek.length);

  // Productivity by Site (this month)
  const bySite = {};
  entries.filter(e => (e.date||'').slice(0,7) === thisMonth).forEach(e => {
    const s = (e.site || '—').slice(0, 30);
    bySite[s] = bySite[s] || { mp:0, eq:0, n:0 };
    bySite[s].mp += e.manpower || 0;
    bySite[s].eq += e.equipHrs || 0;
    bySite[s].n  += 1;
  });
  const prodEl = document.getElementById('execProductivity');
  if (prodEl) {
    const list = Object.entries(bySite).sort((a,b)=>b[1].n-a[1].n).slice(0,8);
    prodEl.innerHTML = list.length === 0
      ? `<div style="text-align:center;color:var(--txt3);padding:1.5rem;font-size:.85rem">No DPRs this month yet.</div>`
      : `<table style="width:100%;font-size:.82rem;border-collapse:collapse">
          <thead><tr style="border-bottom:1px solid var(--border)">
            <th style="text-align:left;padding:.4rem .5rem;color:var(--txt3);font-weight:600">Site</th>
            <th style="text-align:right;padding:.4rem .5rem;color:var(--txt3);font-weight:600">DPRs</th>
            <th style="text-align:right;padding:.4rem .5rem;color:var(--txt3);font-weight:600">Manpower</th>
            <th style="text-align:right;padding:.4rem .5rem;color:var(--txt3);font-weight:600">Eq Hrs</th>
          </tr></thead>
          <tbody>${list.map(([site, d]) => `
            <tr style="border-bottom:1px solid var(--border)">
              <td style="padding:.4rem .5rem">${site}</td>
              <td style="padding:.4rem .5rem;text-align:right;font-variant-numeric:tabular-nums">${d.n}</td>
              <td style="padding:.4rem .5rem;text-align:right;font-variant-numeric:tabular-nums">${d.mp.toLocaleString()}</td>
              <td style="padding:.4rem .5rem;text-align:right;font-variant-numeric:tabular-nums">${d.eq.toLocaleString()}</td>
            </tr>`).join('')}</tbody>
        </table>`;
  }

  // Site activity last 7d
  const actEl = document.getElementById('execActivity7d');
  if (actEl) {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i*24*3600*1000).toISOString().slice(0,10);
      days.push({ d, n: entries.filter(e => (e.date||'').slice(0,10) === d).length });
    }
    const max = Math.max(1, ...days.map(x => x.n));
    actEl.innerHTML = `
      <div style="display:flex;align-items:flex-end;gap:.4rem;height:100px;padding:.5rem 0">
        ${days.map(x => `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:.3rem">
            <div style="font-size:.7rem;color:var(--txt3);font-weight:600">${x.n}</div>
            <div style="width:100%;height:${(x.n/max)*70+5}px;background:linear-gradient(180deg,var(--g7),var(--g9));border-radius:4px 4px 0 0"></div>
            <div style="font-size:.65rem;color:var(--txt3)">${x.d.slice(5)}</div>
          </div>`).join('')}
      </div>`;
  }
}

function populateDPRRecentList() {
  const list = document.getElementById('dprRecentList');
  if (!list) return;
  const entries = (STATE.dprCache?.entries) || [];
  const err = STATE.dprCache?.error;

  if (err) {
    list.innerHTML = `<div style="text-align:center;padding:1.5rem;color:#dc2626;font-size:.82rem">
      <div style="font-size:1.6rem;margin-bottom:.4rem">⚠️</div>
      Could not load DPR sheet: ${err}<br>
      <span style="font-size:.74rem;color:var(--txt3)">Make sure the DPR sheet is shared "Anyone with the link"</span>
    </div>`;
    return;
  }
  if (!entries.length) {
    list.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--txt3)">
      <div style="font-size:1.8rem;margin-bottom:.5rem">📋</div>
      <div>No DPR entries yet.</div>
      <div style="font-size:.74rem;margin-top:.3rem;color:var(--txt4)">Submit one using the form on the left.</div>
    </div>`;
    return;
  }
  const recent = entries.slice().reverse().slice(0, 25);
  const issueRe = /(delay|issue|stop|hold|block|problem|defect|fail)/i;
  list.innerHTML = recent.map(e => {
    const isIssue = issueRe.test(e.remarks || '');
    return `<div style="padding:.55rem .7rem;border-bottom:1px solid var(--border);display:grid;grid-template-columns:80px 1fr auto;gap:.6rem;align-items:start;font-size:.78rem">
      <div style="color:var(--txt3);font-variant-numeric:tabular-nums">${(e.date||'').slice(0,10)}</div>
      <div>
        <div style="font-weight:600;color:var(--g9)">${e.site || '—'}</div>
        <div style="color:var(--txt2);margin-top:.15rem;line-height:1.3">${(e.activity||'').slice(0,120)}${(e.activity||'').length>120?'…':''}</div>
        ${e.remarks ? `<div style="color:${isIssue?'#dc2626':'var(--txt3)'};margin-top:.2rem;font-size:.74rem">${isIssue?'⚠️ ':''}${e.remarks.slice(0,80)}</div>` : ''}
      </div>
      <div style="text-align:right;color:var(--txt3);font-size:.72rem;line-height:1.3">
        ${e.manpower ? `<div>${e.manpower} mp</div>` : ''}
        ${e.equipHrs ? `<div>${e.equipHrs} hrs</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function renderExecutionPage(subPage) {
  const el = document.getElementById('mainContent');
  const current = subPage || 'dpr';

  const subNav = (id, label, icon) => `
    <button onclick="renderExecutionPage('${id}')"
      style="display:flex;align-items:center;gap:.5rem;padding:.55rem 1.1rem;border:none;background:none;
      font-family:inherit;font-size:.84rem;font-weight:600;cursor:pointer;border-bottom:2px solid ${current===id?'var(--g7)':'transparent'};
      margin-bottom:-2px;color:${current===id?'var(--g7)':'var(--txt3)'};transition:all .15s">
      ${icon} ${label}
    </button>`;

  el.innerHTML = `
    <div class="page-header" style="margin-bottom:1rem">
      <div class="breadcrumb">
        <span>Home</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        <span>Planning</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        <span>Execution</span>
      </div>
      <div class="page-header-row">
        <div>
          <h1>📝 Execution</h1>
          <p>Daily Progress Reports &middot; Site activity logging &middot; live from DPR sheet</p>
        </div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" onclick="loadDPRsFromSheet().then(()=>{hydrateExecKPIs();populateDPRRecentList();})">↻ Refresh</button>
        </div>
      </div>
    </div>

    <!-- KPI strip -->
    <div class="kpi-grid" style="margin-bottom:1.2rem">
      <div class="kpi-card"><div class="kpi-icon" style="background:#e6f7eb">🏗️</div><div class="kpi-body"><div class="kpi-label">Active Sites</div><div class="kpi-value" id="exKpi-sites">—</div></div></div>
      <div class="kpi-card"><div class="kpi-icon" style="background:#fef9c3">📋</div><div class="kpi-body"><div class="kpi-label">DPRs Today</div><div class="kpi-value" id="exKpi-dprToday">—</div></div></div>
      <div class="kpi-card"><div class="kpi-icon" style="background:#dbeafe">👷</div><div class="kpi-body"><div class="kpi-label">Manpower Today</div><div class="kpi-value" id="exKpi-mp">—</div></div></div>
      <div class="kpi-card"><div class="kpi-icon" style="background:#fce7f3">🚜</div><div class="kpi-body"><div class="kpi-label">Equipment Hrs Today</div><div class="kpi-value" id="exKpi-eq">—</div></div></div>
      <div class="kpi-card"><div class="kpi-icon" style="background:#fee2e2">⚠️</div><div class="kpi-body"><div class="kpi-label">Open Issues (7d)</div><div class="kpi-value" id="exKpi-issues">—</div></div></div>
      <div class="kpi-card"><div class="kpi-icon" style="background:#e0e7ff">📅</div><div class="kpi-body"><div class="kpi-label">DPRs This Week</div><div class="kpi-value" id="exKpi-week">—</div></div></div>
    </div>

    <!-- Sub-nav -->
    <div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:1rem">
      ${subNav('dpr', 'DPR Entries', '📋')}
    </div>

    <!-- Dashboards row -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.2rem">
      <div class="card card-pad">
        <h3 style="font-size:.86rem;font-weight:700;margin-bottom:.4rem;color:var(--g9)">📊 Site Activity (Last 7 days)</h3>
        <div id="execActivity7d"><div style="text-align:center;color:var(--txt3);padding:1.5rem;font-size:.85rem">Loading…</div></div>
      </div>
      <div class="card card-pad">
        <h3 style="font-size:.86rem;font-weight:700;margin-bottom:.4rem;color:var(--g9)">🏆 Productivity by Site (This Month)</h3>
        <div id="execProductivity"><div style="text-align:center;color:var(--txt3);padding:1.5rem;font-size:.85rem">Loading…</div></div>
      </div>
    </div>

    <!-- DPR entry + recent -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.2rem">
      <div class="card card-pad">
        <h3 style="font-size:.9rem;font-weight:700;margin-bottom:1rem;color:var(--g9)">📋 New DPR Entry</h3>
        <div style="display:flex;flex-direction:column;gap:.75rem">
          <div>
            <label style="font-size:.75rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Site *</label>
            <select id="dprSite" style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit;background:#fff">
              <option value="">Select site…</option>
              ${(STATE.masters.sites||[]).filter(s=>(s.status||'').toUpperCase()==='ACTIVE').map(s=>`<option>${s.name||s.site||''}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:.75rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Date *</label>
            <input type="date" id="dprDate" value="${new Date().toISOString().slice(0,10)}"
              style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit">
          </div>
          <div>
            <label style="font-size:.75rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Activity / Work Done *</label>
            <textarea id="dprActivity" rows="3" placeholder="Describe work completed today…"
              style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit;resize:vertical"></textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">
            <div>
              <label style="font-size:.75rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Manpower (nos)</label>
              <input type="number" id="dprManpower" placeholder="0" min="0"
                style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit">
            </div>
            <div>
              <label style="font-size:.75rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Equipment Hours</label>
              <input type="number" id="dprEquipHrs" placeholder="0" min="0"
                style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit">
            </div>
          </div>
          <div>
            <label style="font-size:.75rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Remarks / Issues</label>
            <textarea id="dprRemarks" rows="2" placeholder="Any delays, issues, or notable observations…"
              style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit;resize:vertical"></textarea>
          </div>
          <div id="dprMsg" style="display:none;font-size:.82rem;padding:.45rem .8rem;border-radius:8px"></div>
          <button onclick="dprSubmit()" class="btn btn-gold">📤 Submit DPR</button>
        </div>
      </div>
      <div class="card card-pad" style="display:flex;flex-direction:column">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.6rem">
          <h3 style="font-size:.9rem;font-weight:700;color:var(--g9)">📂 Recent DPR Entries</h3>
          <span style="font-size:.72rem;color:var(--txt3)" id="dprCount"></span>
        </div>
        <div id="dprRecentList" style="font-size:.82rem;color:var(--txt3);max-height:520px;overflow-y:auto;border:1px solid var(--border);border-radius:8px">
          <div style="text-align:center;padding:2rem;color:var(--txt3)">
            <div style="font-size:1.8rem;margin-bottom:.5rem">⏳</div>
            <div>Loading DPRs from sheet…</div>
          </div>
        </div>
      </div>
    </div>`;

  // Load DPRs and populate KPIs + list
  loadDPRsFromSheet().then(() => {
    hydrateExecKPIs();
    populateDPRRecentList();
    const cnt = document.getElementById('dprCount');
    if (cnt) cnt.textContent = `${(STATE.dprCache?.entries||[]).length} total`;
  });

  window.dprSubmit = function() {
    const site     = document.getElementById('dprSite')?.value?.trim();
    const date     = document.getElementById('dprDate')?.value;
    const activity = document.getElementById('dprActivity')?.value?.trim();
    const manpower = document.getElementById('dprManpower')?.value || '0';
    const equipHrs = document.getElementById('dprEquipHrs')?.value || '0';
    const remarks  = document.getElementById('dprRemarks')?.value?.trim() || '';
    const msgEl    = document.getElementById('dprMsg');
    const showMsg  = (txt, ok) => { if (!msgEl) return; msgEl.style.display='block'; msgEl.style.background=ok?'#f0fdf4':'#fef2f2'; msgEl.style.color=ok?'#16a34a':'#dc2626'; msgEl.textContent=txt; };

    if (!site)     return showMsg('Please select a site.', false);
    if (!date)     return showMsg('Please select a date.', false);
    if (!activity) return showMsg('Please describe the work done.', false);

    const ts  = new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'});
    const row = [ts, date, site, STATE.user?.name||'Anonymous', STATE.user?.email||'', activity, manpower, equipHrs, remarks];
    showMsg('Submitting…', true);

    fetch(APPS_SCRIPT_URL, {
      method:'POST', headers:{'Content-Type':'text/plain'},
      body: JSON.stringify({ action:'appendRow', sheetId: DPR_SHEET_ID, tab: DPR_TAB, row })
    })
    .then(r => r.json())
    .then(res => {
      if (!res.success) throw new Error(res.message||'Failed');
      showMsg('✓ DPR submitted successfully!', true);
      ['dprActivity','dprRemarks'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
      const mp=document.getElementById('dprManpower'); if (mp) mp.value='';
      const eq=document.getElementById('dprEquipHrs'); if (eq) eq.value='';
      // Push the new entry locally and re-render
      const cache = STATE.dprCache || { entries: [] };
      cache.entries.push({ date, site, activity, manpower:+manpower||0, equipHrs:+equipHrs||0, remarks });
      STATE.dprCache = cache;
      hydrateExecKPIs();
      populateDPRRecentList();
    })
    .catch(err => showMsg('Error: '+err.message, false));
  };
}

// ════════════════════════════════════════════════════════════════
//  PLANT & MACHINERY — Log Entry / Asset Verification / Maintenance
// ════════════════════════════════════════════════════════════════
function renderPlantMachineryPage(subPage) {
  const el = document.getElementById('mainContent');
  const current = subPage || 'log-entry';

  const subNav = (id, label, icon) => `
    <button onclick="renderPlantMachineryPage('${id}')"
      style="display:flex;align-items:center;gap:.5rem;padding:.55rem 1.1rem;border:none;background:none;
      font-family:inherit;font-size:.84rem;font-weight:600;cursor:pointer;border-bottom:2px solid ${current===id?'var(--g7)':'transparent'};
      margin-bottom:-2px;color:${current===id?'var(--g7)':'var(--txt3)'};transition:all .15s">
      ${icon} ${label}
    </button>`;

  const assets = STATE.masters.assets || [];

  el.innerHTML = `
    <div class="page-header" style="margin-bottom:1rem">
      <div class="page-header-row">
        <div>
          <h1>🚜 Plant &amp; Machinery</h1>
          <p>Fleet of ${assets.length} units &middot; Log Entry &middot; Asset Verification &middot; Maintenance</p>
        </div>
      </div>
      <div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-top:.6rem">
        ${subNav('log-entry',    'Log Entry',           '📋')}
        ${subNav('verification', 'Asset Verification',  '✅')}
        ${subNav('maintenance',  'Asset Maintenance',   '🔧')}
      </div>
    </div>`;

  if (current === 'log-entry') {
    el.innerHTML += `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.2rem">
        <div class="card card-pad">
          <h3 style="font-size:.9rem;font-weight:700;margin-bottom:1rem;color:var(--g9)">📋 Daily Equipment Log</h3>
          <div style="display:flex;flex-direction:column;gap:.75rem">
            <div>
              <label style="font-size:.75rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Asset / Equipment *</label>
              <select id="plantAsset" style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit;background:#fff">
                <option value="">Select equipment…</option>
                ${assets.map(a=>`<option value="${a.code||''}">${a.name||a.description||a.code||''} ${a.site?'('+a.site+')':''}</option>`).join('')}
              </select>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">
              <div>
                <label style="font-size:.75rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Date *</label>
                <input type="date" id="plantDate" value="${new Date().toISOString().slice(0,10)}"
                  style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit">
              </div>
              <div>
                <label style="font-size:.75rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Hours Worked</label>
                <input type="number" id="plantHours" placeholder="0.0" min="0" step="0.5"
                  style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit">
              </div>
            </div>
            <div>
              <label style="font-size:.75rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Operator Name</label>
              <input type="text" id="plantOperator" placeholder="Operator / Driver name"
                style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit">
            </div>
            <div>
              <label style="font-size:.75rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Work Description</label>
              <textarea id="plantWork" rows="2" placeholder="What was the equipment used for?"
                style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit;resize:vertical"></textarea>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">
              <div>
                <label style="font-size:.75rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Fuel (litres)</label>
                <input type="number" id="plantFuel" placeholder="0" min="0"
                  style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit">
              </div>
              <div>
                <label style="font-size:.75rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Status</label>
                <select id="plantStatus" style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit;background:#fff">
                  <option>Working</option>
                  <option>Idle</option>
                  <option>Under Repair</option>
                  <option>Breakdown</option>
                </select>
              </div>
            </div>
            <div id="plantLogMsg" style="display:none;font-size:.82rem;padding:.45rem .8rem;border-radius:8px"></div>
            <button onclick="plantLogSubmit()" class="btn btn-gold">📤 Submit Log</button>
          </div>
        </div>

        <!-- Asset summary cards -->
        <div class="card card-pad">
          <h3 style="font-size:.9rem;font-weight:700;margin-bottom:.8rem;color:var(--g9)">🚜 Fleet Overview</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-bottom:.8rem">
            ${[['Total Units',assets.length,'#16a34a'],
               ['Active',assets.filter(a=>(a.status||'').toUpperCase()==='ACTIVE').length,'#2563eb'],
               ['Sites Covered',[...new Set(assets.map(a=>a.site).filter(Boolean))].length,'#7c3aed'],
               ['Categories',[...new Set(assets.map(a=>a.category||a.type).filter(Boolean))].length,'#f59e0b']
              ].map(([lbl,val,col])=>`
              <div style="background:${col}0d;border:1px solid ${col}30;border-radius:8px;padding:.65rem .8rem">
                <div style="font-size:1.2rem;font-weight:700;color:${col}">${val}</div>
                <div style="font-size:.7rem;color:var(--txt3)">${lbl}</div>
              </div>`).join('')}
          </div>
          <div style="max-height:320px;overflow-y:auto">
            ${assets.slice(0,15).map(a=>`
              <div style="display:flex;align-items:center;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid var(--border)">
                <div>
                  <div style="font-size:.82rem;font-weight:600;color:var(--g9)">${a.name||a.description||a.code||'—'}</div>
                  <div style="font-size:.7rem;color:var(--txt3)">${a.category||a.type||''} · ${a.site||'—'}</div>
                </div>
                <span style="font-size:.68rem;padding:2px 8px;border-radius:10px;font-weight:700;background:${(a.status||'').toUpperCase()==='ACTIVE'?'#f0fdf4':'#fef2f2'};color:${(a.status||'').toUpperCase()==='ACTIVE'?'#16a34a':'#dc2626'}">${a.status||'—'}</span>
              </div>`).join('')}
            ${assets.length > 15 ? `<div style="text-align:center;color:var(--txt3);font-size:.74rem;padding:.6rem">+${assets.length-15} more units</div>` : ''}
          </div>
        </div>
      </div>`;

    window.plantLogSubmit = function() {
      const asset  = document.getElementById('plantAsset')?.value?.trim();
      const date   = document.getElementById('plantDate')?.value;
      const hours  = document.getElementById('plantHours')?.value||'0';
      const op     = document.getElementById('plantOperator')?.value?.trim()||'';
      const work   = document.getElementById('plantWork')?.value?.trim();
      const fuel   = document.getElementById('plantFuel')?.value||'0';
      const status = document.getElementById('plantStatus')?.value||'Working';
      const msgEl  = document.getElementById('plantLogMsg');
      const showMsg= (t,ok)=>{if(!msgEl)return;msgEl.style.display='block';msgEl.style.background=ok?'#f0fdf4':'#fef2f2';msgEl.style.color=ok?'#16a34a':'#dc2626';msgEl.textContent=t;};
      if (!asset) return showMsg('Please select equipment.', false);
      if (!date)  return showMsg('Please select a date.', false);
      const ts  = new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'});
      const row = [ts, date, asset, op, work||'—', hours, fuel, status, STATE.user?.name||'', STATE.user?.email||''];
      showMsg('Submitting…', true);
      fetch(APPS_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'text/plain'},
        body:JSON.stringify({action:'appendRow',sheetId:SHEET_ID,tab:'PlantLog',row})})
      .then(r=>r.json()).then(res=>{
        if(!res.success) throw new Error(res.message||'Failed');
        showMsg('✓ Log entry submitted!', true);
        document.getElementById('plantWork').value='';
        document.getElementById('plantHours').value='';
        document.getElementById('plantFuel').value='';
      }).catch(err=>showMsg('Error: '+err.message, false));
    };

  } else if (current === 'verification') {
    el.innerHTML += `
      <div class="card card-pad">
        <h3 style="font-size:.9rem;font-weight:700;margin-bottom:1rem;color:var(--g9)">✅ Asset Verification</h3>
        <div style="margin-bottom:.8rem;display:flex;gap:.6rem;flex-wrap:wrap">
          <input id="assetVerifSearch" oninput="assetVerifFilter()" placeholder="Search asset or site…"
            style="flex:1;min-width:200px;padding:.5rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;outline:none">
          <button onclick="assetVerifAll(true)"  class="btn btn-secondary btn-sm">✓ Verify All Visible</button>
          <button onclick="assetVerifSubmit()" class="btn btn-gold btn-sm">📤 Submit Verification</button>
        </div>
        <div id="assetVerifTable" style="max-height:520px;overflow-y:auto">
          <table style="width:100%;border-collapse:collapse;font-size:.82rem">
            <thead><tr style="background:var(--g9);color:#fff">
              <th style="padding:.5rem;text-align:left">Asset</th>
              <th style="padding:.5rem;text-align:left">Category</th>
              <th style="padding:.5rem;text-align:left">Site</th>
              <th style="padding:.5rem;text-align:center">Verified</th>
              <th style="padding:.5rem;text-align:left">Condition</th>
              <th style="padding:.5rem;text-align:left">Remarks</th>
            </tr></thead>
            <tbody id="assetVerifBody">
              ${assets.map((a,i)=>`
              <tr style="border-bottom:1px solid var(--border)" data-search="${((a.name||a.description||a.code||'')+' '+(a.site||'')).toLowerCase()}">
                <td style="padding:.45rem .5rem;font-weight:600;color:var(--g9)">${a.name||a.description||a.code||'—'}</td>
                <td style="padding:.45rem .5rem;color:var(--txt3)">${a.category||a.type||'—'}</td>
                <td style="padding:.45rem .5rem">${a.site||'—'}</td>
                <td style="padding:.45rem .5rem;text-align:center">
                  <input type="checkbox" id="av-${i}" style="width:16px;height:16px;cursor:pointer">
                </td>
                <td style="padding:.45rem .5rem">
                  <select id="avc-${i}" style="font-size:.78rem;border:1px solid var(--border);border-radius:5px;padding:2px 6px;background:#fff">
                    <option>Good</option><option>Fair</option><option>Poor</option><option>Under Repair</option>
                  </select>
                </td>
                <td style="padding:.45rem .5rem">
                  <input type="text" id="avr-${i}" placeholder="Optional remark" style="font-size:.78rem;border:1px solid var(--border);border-radius:5px;padding:3px 7px;width:120px">
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div id="assetVerifMsg" style="display:none;margin-top:.6rem;font-size:.82rem;padding:.45rem .8rem;border-radius:8px"></div>
      </div>`;

    window.assetVerifFilter = function() {
      const q = (document.getElementById('assetVerifSearch')?.value||'').toLowerCase();
      document.querySelectorAll('#assetVerifBody tr').forEach(row => {
        row.style.display = !q || (row.dataset.search||'').includes(q) ? '' : 'none';
      });
    };
    window.assetVerifAll = function(checked) {
      assets.forEach((_,i) => {
        const cb = document.getElementById(`av-${i}`);
        const row = cb?.closest('tr');
        if (cb && row && row.style.display !== 'none') cb.checked = checked;
      });
    };
    window.assetVerifSubmit = function() {
      const ts   = new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'});
      const rows = assets.map((a,i) => {
        const cb  = document.getElementById(`av-${i}`);
        if (!cb?.checked) return null;
        const cond = document.getElementById(`avc-${i}`)?.value||'Good';
        const rmk  = document.getElementById(`avr-${i}`)?.value||'';
        return [ts, a.name||a.code||'', a.site||'', cond, rmk, STATE.user?.name||''];
      }).filter(Boolean);
      const msgEl = document.getElementById('assetVerifMsg');
      const showMsg= (t,ok)=>{if(!msgEl)return;msgEl.style.display='block';msgEl.style.background=ok?'#f0fdf4':'#fef2f2';msgEl.style.color=ok?'#16a34a':'#dc2626';msgEl.textContent=t;};
      if (!rows.length) return showMsg('Please verify at least one asset.', false);
      showMsg(`Submitting ${rows.length} verifications…`, true);
      // Submit all rows sequentially
      Promise.all(rows.map(row => fetch(APPS_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'text/plain'},
        body:JSON.stringify({action:'appendRow',sheetId:SHEET_ID,tab:'AssetVerification',row})}).then(r=>r.json())))
      .then(() => showMsg(`✓ ${rows.length} asset${rows.length!==1?'s':''} verified and submitted!`, true))
      .catch(err => showMsg('Error: '+err.message, false));
    };

  } else if (current === 'maintenance') {
    el.innerHTML += `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.2rem">
        <div class="card card-pad">
          <h3 style="font-size:.9rem;font-weight:700;margin-bottom:1rem;color:var(--g9)">🔧 Log Maintenance</h3>
          <div style="display:flex;flex-direction:column;gap:.75rem">
            <div>
              <label style="font-size:.75rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Asset *</label>
              <select id="maintAsset" style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit;background:#fff">
                <option value="">Select equipment…</option>
                ${assets.map(a=>`<option>${a.name||a.description||a.code||''}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:.75rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Maintenance Type *</label>
              <select id="maintType" style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit;background:#fff">
                <option>Preventive Maintenance</option>
                <option>Corrective Maintenance</option>
                <option>Breakdown Repair</option>
                <option>Oil &amp; Lubricant Change</option>
                <option>Tyre Change / Repair</option>
                <option>Battery Replacement</option>
                <option>Annual Service</option>
                <option>Other</option>
              </select>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">
              <div>
                <label style="font-size:.75rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Date *</label>
                <input type="date" id="maintDate" value="${new Date().toISOString().slice(0,10)}"
                  style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit">
              </div>
              <div>
                <label style="font-size:.75rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Cost (₹)</label>
                <input type="number" id="maintCost" placeholder="0" min="0"
                  style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit">
              </div>
            </div>
            <div>
              <label style="font-size:.75rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Work Description *</label>
              <textarea id="maintWork" rows="3" placeholder="Describe the maintenance work done…"
                style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit;resize:vertical"></textarea>
            </div>
            <div>
              <label style="font-size:.75rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Next Due Date</label>
              <input type="date" id="maintNextDue"
                style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit">
            </div>
            <div>
              <label style="font-size:.75rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Vendor / Mechanic</label>
              <input type="text" id="maintVendor" placeholder="Who performed the work?"
                style="width:100%;padding:.55rem .8rem;border:1.5px solid var(--border);border-radius:8px;font-size:.86rem;font-family:inherit">
            </div>
            <div id="maintMsg" style="display:none;font-size:.82rem;padding:.45rem .8rem;border-radius:8px"></div>
            <button onclick="maintSubmit()" class="btn btn-gold">📤 Submit Maintenance Log</button>
          </div>
        </div>

        <div class="card card-pad">
          <h3 style="font-size:.9rem;font-weight:700;margin-bottom:.8rem;color:var(--g9)">📅 Maintenance Schedule</h3>
          <div style="text-align:center;padding:2rem;color:var(--txt3)">
            <div style="font-size:1.8rem;margin-bottom:.5rem">🔧</div>
            <div style="font-weight:600;color:var(--txt2)">No maintenance records yet</div>
            <div style="font-size:.78rem;margin-top:.3rem">Submitted logs will appear here. Connect a Maintenance Google Sheet for persistence.</div>
          </div>
        </div>
      </div>`;

    window.maintSubmit = function() {
      const asset   = document.getElementById('maintAsset')?.value?.trim();
      const type    = document.getElementById('maintType')?.value;
      const date    = document.getElementById('maintDate')?.value;
      const cost    = document.getElementById('maintCost')?.value||'0';
      const work    = document.getElementById('maintWork')?.value?.trim();
      const nextDue = document.getElementById('maintNextDue')?.value||'';
      const vendor  = document.getElementById('maintVendor')?.value?.trim()||'';
      const msgEl   = document.getElementById('maintMsg');
      const showMsg = (t,ok)=>{if(!msgEl)return;msgEl.style.display='block';msgEl.style.background=ok?'#f0fdf4':'#fef2f2';msgEl.style.color=ok?'#16a34a':'#dc2626';msgEl.textContent=t;};
      if (!asset) return showMsg('Please select an asset.', false);
      if (!work)  return showMsg('Please describe the work done.', false);
      const ts  = new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'});
      const row = [ts, date, asset, type, work, cost, vendor, nextDue, STATE.user?.name||'', STATE.user?.email||''];
      showMsg('Submitting…', true);
      fetch(APPS_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'text/plain'},
        body:JSON.stringify({action:'appendRow',sheetId:SHEET_ID,tab:'AssetMaintenance',row})})
      .then(r=>r.json()).then(res=>{
        if(!res.success) throw new Error(res.message||'Failed');
        showMsg('✓ Maintenance log submitted!', true);
        ['maintWork','maintVendor'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
        document.getElementById('maintCost').value='';
        document.getElementById('maintNextDue').value='';
      }).catch(err=>showMsg('Error: '+err.message, false));
    };
  }
}


// ════════════════════════════════════════════════════════════════
//  PROJECTS — Planning & Budget + Execution
//  Sub-pages rendered via renderProjectsPage(subPage)
// ════════════════════════════════════════════════════════════════

const PROJ_SUBPAGES = {
  overview:  { label:'Overview',        icon:'📊', route:'planning-overview' },
  setup:     { label:'Project Setup',   icon:'⚙️',  route:'planning-setup' },
  execution: { label:'DPR Entries',     icon:'📋', route:'execution' },
};

function renderProjectsPage(subPage) {
  subPage = subPage || 'overview';
  const el = document.getElementById('mainContent');

  const sectionLabel = subPage === 'execution' ? 'Execution' : 'Planning & Budget';
  const subItems = subPage === 'execution'
    ? [{ key:'execution', label:'DPR Entries', icon:'📋' }]
    : [
        { key:'overview', label:'Overview',      icon:'📊' },
        { key:'setup',    label:'Project Setup', icon:'⚙️' },
      ];

  el.innerHTML = `
    <div class="page-header" style="margin-bottom:1rem">
      <div class="page-header-row">
        <div>
          <h1>${subPage === 'execution' ? '📋 Execution' : '📐 Planning &amp; Budget'}</h1>
          <p>Projects &middot; ${sectionLabel}</p>
        </div>
      </div>

      <!-- Sub-page nav pills -->
      <div style="display:flex;gap:.4rem;margin-top:.8rem;flex-wrap:wrap">
        ${subItems.map(s => `
          <button onclick="navigate('${s.key}')"
            style="padding:.4rem 1rem;border-radius:20px;border:1.5px solid ${s.key===subPage?'var(--g7)':'var(--border)'};
            background:${s.key===subPage?'var(--g7)':'transparent'};
            color:${s.key===subPage?'#fff':'var(--txt2)'};
            font-family:inherit;font-size:.82rem;font-weight:600;cursor:pointer;transition:all .15s">
            ${s.icon} ${s.label}
          </button>`).join('')}
      </div>
    </div>

    <div id="projSubContent">
      <div style="text-align:center;padding:3rem;color:var(--txt3)">⏳ Loading…</div>
    </div>
  `;

  // Render the correct sub-page content
  if (subPage === 'overview')  _renderProjOverview();
  if (subPage === 'setup')     _renderProjSetup();
  if (subPage === 'execution') _renderProjExecution();
}

function _renderProjOverview() {
  const c = document.getElementById('projSubContent');
  if (!c) return;
  const users   = STATE.masters.users  || [];
  const sites   = STATE.masters.sites  || [];
  const active  = sites.filter(s => s.status === 'ACTIVE');

  c.innerHTML = `
    <!-- KPI row -->
    <div class="kpi-grid" style="margin-bottom:1.4rem">
      <div class="kpi-card">
        <div class="kpi-top"><div class="kpi-icon green">🏗️</div><div class="kpi-trend flat">Active</div></div>
        <div class="kpi-value">${active.length}</div>
        <div class="kpi-label">Active Sites</div>
      </div>
      <div class="kpi-card gold">
        <div class="kpi-top"><div class="kpi-icon gold">👷</div><div class="kpi-trend flat">On-site</div></div>
        <div class="kpi-value">${users.filter(u=>u.status==='ACTIVE'&&u.site).length}</div>
        <div class="kpi-label">Deployed Staff</div>
      </div>
      <div class="kpi-card info">
        <div class="kpi-top"><div class="kpi-icon blue">📦</div><div class="kpi-trend flat">Budget</div></div>
        <div class="kpi-value">${BUDGET_SHEET_ID ? '↗' : '—'}</div>
        <div class="kpi-label">IC Budget</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-top"><div class="kpi-icon green">📋</div><div class="kpi-trend flat">Docs</div></div>
        <div class="kpi-value">—</div>
        <div class="kpi-label">BOQ Items</div>
      </div>
    </div>

    <div class="dash-grid thirds">
      <!-- Active Sites table -->
      <div class="card" style="grid-column:span 2">
        <div class="card-head"><h3>🏗️ Active Projects</h3></div>
        <div class="card-body" style="padding:0;max-height:420px;overflow-y:auto">
          <table class="data-table">
            <thead><tr><th>Site Name</th><th>State</th><th>Staff</th><th>Status</th></tr></thead>
            <tbody>
              ${active.slice(0,20).map(s => {
                const staffCount = users.filter(u=>u.status==='ACTIVE'&&u.site===s.name).length;
                return `<tr>
                  <td style="font-weight:600">${s.name||'—'}</td>
                  <td>${s.state||'—'}</td>
                  <td><span style="font-weight:700;color:var(--g7)">${staffCount}</span></td>
                  <td><span style="background:#e8f5ee;color:#1a6038;padding:2px 8px;border-radius:10px;font-size:.7rem;font-weight:700">Active</span></td>
                </tr>`;
              }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--txt3);padding:2rem">No sites loaded</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Quick actions -->
      <div class="card card-pad">
        <h3 style="font-size:.9rem;font-weight:700;margin-bottom:.8rem">⚡ Quick Actions</h3>
        <div style="display:flex;flex-direction:column;gap:.5rem">
          <button class="btn btn-secondary" onclick="navigate('planning-setup')" style="text-align:left;justify-content:flex-start">
            ⚙️ &nbsp;Project Setup
          </button>
          <button class="btn btn-secondary" onclick="navigate('execution')" style="text-align:left;justify-content:flex-start">
            📋 &nbsp;DPR Entry
          </button>
          <button class="btn btn-secondary" onclick="navigate('planning')" style="text-align:left;justify-content:flex-start">
            📐 &nbsp;Measurement Book
          </button>
          ${!BUDGET_SHEET_ID ? '<div style="background:#fff8e1;color:#92400e;font-size:.76rem;padding:.6rem .8rem;border-radius:8px;margin-top:.3rem">⚠️ IC Budget sheet not connected. Upload template to activate live data.</div>' : ''}
        </div>
      </div>
    </div>
  `;
}

function _renderProjSetup() {
  const c = document.getElementById('projSubContent');
  if (!c) return;
  // Reuse existing renderPlanningModule's Project Setup tab content
  // For now show a card that links to Measurement Book
  c.innerHTML = `
    <div class="dash-grid" style="grid-template-columns:1fr 1fr;gap:1.2rem">
      <div class="card card-pad">
        <h3 style="font-size:1rem;font-weight:700;margin-bottom:.4rem;color:var(--g9)">⚙️ Project Setup</h3>
        <p style="font-size:.84rem;color:var(--txt2);margin-bottom:1rem;line-height:1.6">Configure site rates, cost categories, personnel details, and alert thresholds for the IC Budget system.</p>
        <button class="btn btn-gold" onclick="navigate('planning')" style="width:100%">Open Project Setup →</button>
      </div>
      <div class="card card-pad">
        <h3 style="font-size:1rem;font-weight:700;margin-bottom:.4rem;color:var(--g9)">📐 Measurement Book</h3>
        <p style="font-size:.84rem;color:var(--txt2);margin-bottom:1rem;line-height:1.6">BOQ-wise measurement entries, formula-based quantity calculation, cumulative tracking with B/F carryforward.</p>
        <button class="btn btn-secondary" onclick="navigate('planning')" style="width:100%">Open Measurement Book →</button>
      </div>
      <div class="card card-pad" style="grid-column:span 2">
        <h3 style="font-size:.9rem;font-weight:700;margin-bottom:.8rem;color:var(--g9)">📋 Setup Checklist</h3>
        ${[
          ['Upload IC Budget Excel template to Google Drive','BUDGET_SHEET_ID connection'],
          ['Share the sheet (Anyone with link → Viewer)','gviz API access'],
          ['Paste BUDGET_SHEET_ID in index.html constants','Live data activation'],
          ['Configure Project_Master tab — rates, categories, thresholds','Cost control setup'],
          ['Add BOQ items in Measurement Book','Quantity tracking'],
        ].map(([item, note], i) => `
          <div style="display:flex;align-items:center;gap:.75rem;padding:.5rem 0;border-bottom:1px solid var(--border)">
            <div style="width:24px;height:24px;border-radius:50%;background:${BUDGET_SHEET_ID && i<3?'var(--g7)':'var(--border)'};color:#fff;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;flex-shrink:0">${i+1}</div>
            <div>
              <div style="font-size:.84rem;font-weight:600;color:var(--g9)">${item}</div>
              <div style="font-size:.72rem;color:var(--txt3)">${note}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>
  `;
}

function _renderProjExecution() {
  const c = document.getElementById('projSubContent');
  if (!c) return;
  const sites = (STATE.masters.sites || []).filter(s=>s.status==='ACTIVE').map(s=>s.name).sort();

  c.innerHTML = `
    <div class="dash-grid" style="grid-template-columns:1fr 1fr;gap:1.2rem">
      <!-- DPR Entry Form -->
      <div class="card card-pad" style="grid-column:span 2">
        <h3 style="font-size:.95rem;font-weight:700;margin-bottom:1rem">📋 Daily Progress Report (DPR) Entry</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.8rem;margin-bottom:.8rem">
          <div>
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Date *</label>
            <input type="date" id="dprDate" value="${new Date().toISOString().slice(0,10)}"
              style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;outline:none">
          </div>
          <div>
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Site *</label>
            <select id="dprSite" style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;background:#fff;outline:none">
              <option value="">Select site…</option>
              ${sites.map(s=>`<option>${s}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">BOQ / Work Item *</label>
            <input type="text" id="dprWork" placeholder="e.g. Earth Work — Cutting"
              style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;outline:none">
          </div>
          <div>
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Qty Today</label>
            <input type="number" id="dprQty" placeholder="0.00" min="0" step="0.01"
              style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;outline:none">
          </div>
          <div>
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Unit</label>
            <select id="dprUnit" style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;background:#fff;outline:none">
              <option>cum</option><option>Sqm</option><option>RM</option><option>MT</option>
              <option>Kg</option><option>Nos</option><option>LS</option>
            </select>
          </div>
          <div>
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Manpower</label>
            <input type="number" id="dprManpower" placeholder="0" min="0"
              style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;outline:none">
          </div>
          <div style="grid-column:span 2">
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Remarks / Notes</label>
            <textarea id="dprRemarks" rows="2" placeholder="Weather, delays, incidents, notes…"
              style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;resize:none;outline:none"></textarea>
          </div>
          <div style="display:flex;align-items:flex-end">
            <button onclick="dprSubmit()" class="btn btn-gold" style="width:100%;padding:.65rem">✓ Save DPR Entry</button>
          </div>
        </div>
        <div id="dprMsg" style="display:none;font-size:.8rem;padding:.45rem .8rem;border-radius:8px;margin-top:.3rem"></div>
      </div>

      <!-- Recent DPR log -->
      <div class="card" style="grid-column:span 2">
        <div class="card-head">
          <h3>📜 Recent DPR Log</h3>
          <span id="dprCount" style="font-size:.76rem;color:var(--txt3)">Saved locally this session</span>
        </div>
        <div class="card-body" style="padding:0;max-height:320px;overflow-y:auto" id="dprLog">
          <div style="text-align:center;padding:2rem;color:var(--txt3);font-size:.84rem">No entries yet. Submit a DPR above.</div>
        </div>
      </div>
    </div>
  `;

  window.dprSubmit = function() {
    const date     = document.getElementById('dprDate')?.value || '';
    const site     = document.getElementById('dprSite')?.value || '';
    const work     = document.getElementById('dprWork')?.value?.trim() || '';
    const qty      = document.getElementById('dprQty')?.value || '0';
    const unit     = document.getElementById('dprUnit')?.value || '';
    const manpower = document.getElementById('dprManpower')?.value || '0';
    const remarks  = document.getElementById('dprRemarks')?.value?.trim() || '';
    const msgEl    = document.getElementById('dprMsg');

    const showMsg = (t, ok) => {
      if (!msgEl) return;
      msgEl.style.display = 'block';
      msgEl.style.background = ok ? '#f0fdf4' : '#fef2f2';
      msgEl.style.color      = ok ? '#16a34a' : '#dc2626';
      msgEl.textContent = t;
    };

    if (!date || !site || !work) return showMsg('Date, Site and Work Item are required.', false);

    const row = [
      new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}),
      date, site, work, qty, unit, manpower,
      STATE.user?.name || 'Unknown', remarks,
    ];

    // Save to DPR sheet via Apps Script
    fetch(APPS_SCRIPT_URL, {
      method:'POST', headers:{'Content-Type':'text/plain'},
      body: JSON.stringify({ action:'appendRow', sheetId: DPR_SHEET_ID, tab: DPR_TAB, row }),
    }).catch(()=>{});

    // Local log
    const log = document.getElementById('dprLog');
    if (log) {
      const existingEmpty = log.querySelector('[style*="No entries"]');
      if (existingEmpty) log.innerHTML = '';
      log.insertAdjacentHTML('afterbegin', `
        <div style="display:grid;grid-template-columns:90px 1fr 70px 60px auto;align-items:center;gap:.5rem;padding:.6rem 1rem;border-bottom:1px solid var(--border);font-size:.8rem">
          <span style="color:var(--txt3)">${date}</span>
          <div><div style="font-weight:600;color:var(--g9)">${work}</div><div style="font-size:.72rem;color:var(--txt3)">${site}</div></div>
          <span style="font-weight:700;color:var(--g7)">${qty} ${unit}</span>
          <span style="color:var(--txt2)">${manpower} pax</span>
          <span style="background:#e8f5ee;color:#1a6038;padding:2px 8px;border-radius:10px;font-size:.68rem;font-weight:700">Saved</span>
        </div>`);
      document.getElementById('dprCount').textContent = `${log.querySelectorAll('[style*="border-bottom"]').length} entries this session`;
    }

    showMsg('✓ DPR entry saved!', true);
    ['dprWork','dprQty','dprManpower','dprRemarks'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    setTimeout(() => { if (msgEl) msgEl.style.display = 'none'; }, 2500);
  };
}


// ════════════════════════════════════════════════════════════════
//  PLANT & MACHINERY — Sub-pages: Log, Verify, Maintenance
// ════════════════════════════════════════════════════════════════

function renderPlantPage(subPage) {
  subPage = subPage || 'log';
  const el = document.getElementById('mainContent');

  const subs = [
    { key:'log',         label:'Log Entry',         icon:'📝' },
    { key:'verify',      label:'Asset Verification', icon:'✅' },
    { key:'maintenance', label:'Maintenance',         icon:'🔧' },
  ];

  el.innerHTML = `
    <div class="page-header" style="margin-bottom:1rem">
      <div class="page-header-row">
        <div>
          <h1>⚙️ Plant &amp; Machinery</h1>
          <p>Equipment log, asset verification &amp; maintenance tracking</p>
        </div>
      </div>
      <!-- Sub-page pills -->
      <div style="display:flex;gap:.4rem;margin-top:.8rem;flex-wrap:wrap">
        ${subs.map(s => `
          <button onclick="navigate('plant-${s.key}')"
            style="padding:.4rem 1rem;border-radius:20px;border:1.5px solid ${s.key===subPage?'var(--g7)':'var(--border)'};
            background:${s.key===subPage?'var(--g7)':'transparent'};
            color:${s.key===subPage?'#fff':'var(--txt2)'};
            font-family:inherit;font-size:.82rem;font-weight:600;cursor:pointer;transition:all .15s">
            ${s.icon} ${s.label}
          </button>`).join('')}
      </div>
    </div>

    <div id="plantSubContent">
      <div style="text-align:center;padding:3rem;color:var(--txt3)">⏳ Loading…</div>
    </div>
  `;

  if (subPage === 'log')         _renderPlantLog();
  if (subPage === 'verify')      _renderPlantVerify();
  if (subPage === 'maintenance') _renderPlantMaintenance();
}

// Add sub-routes to route map
// (plant-log, plant-verify, plant-maintenance already in route map above)

function _renderPlantLog() {
  const c = document.getElementById('plantSubContent');
  if (!c) return;
  const assets = STATE.masters.assets || [];
  const active = assets.filter(a => a.status === 'ACTIVE');
  const sites  = (STATE.masters.sites  || []).filter(s=>s.status==='ACTIVE').map(s=>s.name).sort();

  c.innerHTML = `
    <div class="dash-grid" style="grid-template-columns:1fr 1fr;gap:1.2rem">
      <!-- Log entry form -->
      <div class="card card-pad" style="grid-column:span 2">
        <h3 style="font-size:.95rem;font-weight:700;margin-bottom:1rem">📝 Equipment Log Entry</h3>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.8rem;margin-bottom:.8rem">
          <div>
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Date *</label>
            <input type="date" id="plantLogDate" value="${new Date().toISOString().slice(0,10)}"
              style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;outline:none">
          </div>
          <div>
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Site *</label>
            <select id="plantLogSite" style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;background:#fff;outline:none">
              <option value="">Select site…</option>
              ${sites.map(s=>`<option>${s}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Equipment / Asset *</label>
            <input type="text" id="plantLogAsset" list="plantAssetList" placeholder="Asset name or ID"
              style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;outline:none">
            <datalist id="plantAssetList">${active.map(a=>`<option value="${a.name||a.assetId||''}">`).join('')}</datalist>
          </div>
          <div>
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Working Hours</label>
            <input type="number" id="plantLogHours" placeholder="0" min="0" max="24" step="0.5"
              style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;outline:none">
          </div>
          <div>
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Idle Hours</label>
            <input type="number" id="plantLogIdle" placeholder="0" min="0" max="24" step="0.5"
              style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;outline:none">
          </div>
          <div>
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Fuel (Litres)</label>
            <input type="number" id="plantLogFuel" placeholder="0" min="0" step="0.1"
              style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;outline:none">
          </div>
          <div style="grid-column:span 2">
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Operator Name</label>
            <input type="text" id="plantLogOp" placeholder="Operator / Driver name"
              style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;outline:none">
          </div>
          <div>
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Remarks</label>
            <input type="text" id="plantLogRemarks" placeholder="Notes / breakdown / etc."
              style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;outline:none">
          </div>
          <div style="grid-column:span 3">
            <button onclick="plantLogSubmit()" class="btn btn-gold" style="width:100%;padding:.65rem">📝 Save Log Entry</button>
          </div>
        </div>
        <div id="plantLogMsg" style="display:none;font-size:.8rem;padding:.45rem .8rem;border-radius:8px"></div>
      </div>

      <!-- Asset utilisation summary -->
      <div class="card" style="grid-column:span 2">
        <div class="card-head"><h3>⚙️ Asset Summary</h3></div>
        <div class="card-body" style="padding:0;max-height:300px;overflow-y:auto">
          <table class="data-table">
            <thead><tr><th>Asset</th><th>Category</th><th>Site</th><th>Own/Hire</th><th>Status</th></tr></thead>
            <tbody>
              ${active.slice(0,20).map(a=>`<tr>
                <td style="font-weight:600">${a.name||a.assetId||'—'}</td>
                <td>${a.category||'—'}</td>
                <td style="font-size:.78rem">${a.site||'—'}</td>
                <td><span style="font-size:.72rem;padding:2px 7px;border-radius:8px;background:${(a.ownHire||'').toLowerCase()==='own'?'#e8f5ee':'#fff3e0'};color:${(a.ownHire||'').toLowerCase()==='own'?'#1a6038':'#e65100'};font-weight:700">${a.ownHire||'—'}</span></td>
                <td><span style="background:#e8f5ee;color:#1a6038;padding:2px 8px;border-radius:8px;font-size:.7rem;font-weight:700">Active</span></td>
              </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--txt3)">No asset data loaded</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  window.plantLogSubmit = function() {
    const date    = document.getElementById('plantLogDate')?.value || '';
    const site    = document.getElementById('plantLogSite')?.value || '';
    const asset   = document.getElementById('plantLogAsset')?.value?.trim() || '';
    const hours   = document.getElementById('plantLogHours')?.value || '0';
    const idle    = document.getElementById('plantLogIdle')?.value || '0';
    const fuel    = document.getElementById('plantLogFuel')?.value || '0';
    const op      = document.getElementById('plantLogOp')?.value?.trim() || '';
    const remarks = document.getElementById('plantLogRemarks')?.value?.trim() || '';
    const msgEl   = document.getElementById('plantLogMsg');

    const showMsg = (t, ok) => {
      if (!msgEl) return;
      msgEl.style.display = 'block';
      msgEl.style.background = ok ? '#f0fdf4' : '#fef2f2';
      msgEl.style.color      = ok ? '#16a34a' : '#dc2626';
      msgEl.textContent = t;
    };

    if (!date || !site || !asset) return showMsg('Date, Site and Asset are required.', false);

    const row = [
      new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}),
      date, site, asset, hours, idle, fuel, op,
      STATE.user?.name || 'Unknown', remarks,
    ];

    fetch(APPS_SCRIPT_URL, {
      method:'POST', headers:{'Content-Type':'text/plain'},
      body: JSON.stringify({ action:'appendRow', sheetId: SHEET_ID, tab:'PlantLog', row }),
    }).catch(()=>{});

    showMsg('✓ Log entry saved!', true);
    ['plantLogHours','plantLogIdle','plantLogFuel','plantLogOp','plantLogRemarks'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    setTimeout(() => { if (msgEl) msgEl.style.display='none'; }, 2500);
  };
}

function _renderPlantVerify() {
  const c = document.getElementById('plantSubContent');
  if (!c) return;
  const assets = STATE.masters.assets || [];
  const active = assets.filter(a => a.status === 'ACTIVE');
  const sites  = (STATE.masters.sites || []).filter(s=>s.status==='ACTIVE').map(s=>s.name).sort();

  c.innerHTML = `
    <div class="card card-pad" style="margin-bottom:1.2rem">
      <h3 style="font-size:.95rem;font-weight:700;margin-bottom:1rem">✅ Asset Verification</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.8rem">
        <div>
          <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Verification Date *</label>
          <input type="date" id="verDate" value="${new Date().toISOString().slice(0,10)}"
            style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;outline:none">
        </div>
        <div>
          <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Site *</label>
          <select id="verSite" style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;background:#fff;outline:none">
            <option value="">Select site…</option>
            ${sites.map(s=>`<option>${s}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Verified By</label>
          <input type="text" id="verBy" value="${STATE.user?.name||''}" readonly
            style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;background:#f9f9f9;font-family:inherit;outline:none">
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3>Asset Checklist</h3>
        <span style="font-size:.76rem;color:var(--txt3)" id="verProgress">0 / ${active.length} verified</span>
      </div>
      <div class="card-body" style="padding:0;max-height:450px;overflow-y:auto">
        <table class="data-table">
          <thead><tr><th>Asset</th><th>Category</th><th>Site</th><th>Own/Hire</th><th>Condition</th><th>Present?</th></tr></thead>
          <tbody id="verTbody">
            ${active.map((a,i) => `<tr id="verRow${i}">
              <td style="font-weight:600">${a.name||a.assetId||'—'}</td>
              <td>${a.category||'—'}</td>
              <td style="font-size:.78rem">${a.site||'—'}</td>
              <td><span style="font-size:.72rem;padding:2px 7px;border-radius:8px;background:${(a.ownHire||'').toLowerCase()==='own'?'#e8f5ee':'#fff3e0'};color:${(a.ownHire||'').toLowerCase()==='own'?'#1a6038':'#e65100'};font-weight:700">${a.ownHire||'—'}</span></td>
              <td>
                <select id="verCond${i}" style="font-size:.76rem;border:1px solid var(--border);border-radius:6px;padding:2px 6px;background:#fff">
                  <option value="">—</option>
                  <option>Good</option><option>Fair</option><option>Poor</option><option>Under Repair</option>
                </select>
              </td>
              <td style="text-align:center">
                <input type="checkbox" id="verChk${i}" onchange="verUpdateCount()"
                  style="width:18px;height:18px;cursor:pointer;accent-color:var(--g7)">
              </td>
            </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--txt3)">No asset data</td></tr>'}
          </tbody>
        </table>
      </div>
      <div style="padding:.8rem 1rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end">
        <button onclick="verSubmit(${active.length})" class="btn btn-gold">✅ Submit Verification</button>
      </div>
    </div>
  `;

  window.verUpdateCount = function() {
    const checked = document.querySelectorAll('[id^="verChk"]:checked').length;
    const prog = document.getElementById('verProgress');
    if (prog) prog.textContent = `${checked} / ${active.length} verified`;
  };

  window.verSubmit = function(count) {
    const date = document.getElementById('verDate')?.value || '';
    const site = document.getElementById('verSite')?.value || '';
    if (!date || !site) { alert('Please select Date and Site.'); return; }

    const rows = [];
    for (let i=0; i<count; i++) {
      const chk  = document.getElementById(`verChk${i}`)?.checked;
      const cond = document.getElementById(`verCond${i}`)?.value || '';
      const a    = active[i];
      rows.push([date, site, a?.name||'', chk?'Present':'Absent', cond, STATE.user?.name||'', new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})]);
    }
    rows.forEach(row => {
      fetch(APPS_SCRIPT_URL, {
        method:'POST', headers:{'Content-Type':'text/plain'},
        body: JSON.stringify({ action:'appendRow', sheetId: SHEET_ID, tab:'AssetVerification', row }),
      }).catch(()=>{});
    });
    alert(`✓ Verification submitted for ${rows.length} assets.`);
  };
}

function _renderPlantMaintenance() {
  const c = document.getElementById('plantSubContent');
  if (!c) return;
  const assets = STATE.masters.assets || [];
  const active = assets.filter(a => a.status === 'ACTIVE');
  const sites  = (STATE.masters.sites || []).filter(s=>s.status==='ACTIVE').map(s=>s.name).sort();

  c.innerHTML = `
    <div class="dash-grid" style="grid-template-columns:1fr 1fr;gap:1.2rem">
      <div class="card card-pad" style="grid-column:span 2">
        <h3 style="font-size:.95rem;font-weight:700;margin-bottom:1rem">🔧 Maintenance Entry</h3>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.8rem">
          <div>
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Date *</label>
            <input type="date" id="mntDate" value="${new Date().toISOString().slice(0,10)}"
              style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;outline:none">
          </div>
          <div>
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Asset *</label>
            <input type="text" id="mntAsset" list="mntAssetList" placeholder="Asset name or ID"
              style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;outline:none">
            <datalist id="mntAssetList">${active.map(a=>`<option value="${a.name||a.assetId||''}">`).join('')}</datalist>
          </div>
          <div>
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Maintenance Type *</label>
            <select id="mntType" style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;background:#fff;outline:none">
              <option value="">Select…</option>
              <option>Preventive</option><option>Corrective</option><option>Breakdown</option>
              <option>Periodic Service</option><option>Annual</option>
            </select>
          </div>
          <div>
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Site</label>
            <select id="mntSite" style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;background:#fff;outline:none">
              <option value="">Select…</option>
              ${sites.map(s=>`<option>${s}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Cost (₹)</label>
            <input type="number" id="mntCost" placeholder="0" min="0" step="100"
              style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;outline:none">
          </div>
          <div>
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Next Service Due</label>
            <input type="date" id="mntNext"
              style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;outline:none">
          </div>
          <div style="grid-column:span 2">
            <label style="font-size:.76rem;font-weight:600;color:var(--g8);display:block;margin-bottom:.25rem">Work Done / Description *</label>
            <textarea id="mntDesc" rows="2" placeholder="Describe maintenance performed…"
              style="width:100%;padding:.55rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.84rem;font-family:inherit;resize:none;outline:none"></textarea>
          </div>
          <div style="display:flex;align-items:flex-end">
            <button onclick="mntSubmit()" class="btn btn-gold" style="width:100%;padding:.65rem">🔧 Save Maintenance</button>
          </div>
        </div>
        <div id="mntMsg" style="display:none;font-size:.8rem;padding:.45rem .8rem;border-radius:8px;margin-top:.5rem"></div>
      </div>

      <!-- Maintenance summary from masters -->
      <div class="card" style="grid-column:span 2">
        <div class="card-head"><h3>📊 Fleet Overview</h3></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:.8rem;padding:1rem">
          ${[...new Set(active.map(a=>a.category).filter(Boolean))].sort().map(cat => {
            const count = active.filter(a=>a.category===cat).length;
            return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:.8rem;text-align:center">
              <div style="font-size:1.4rem;font-weight:700;color:var(--g7)">${count}</div>
              <div style="font-size:.76rem;color:var(--txt2);margin-top:.2rem">${cat}</div>
            </div>`;
          }).join('') || '<div style="color:var(--txt3);font-size:.84rem;padding:1rem">No asset data loaded</div>'}
        </div>
      </div>
    </div>
  `;

  window.mntSubmit = function() {
    const date  = document.getElementById('mntDate')?.value || '';
    const asset = document.getElementById('mntAsset')?.value?.trim() || '';
    const type  = document.getElementById('mntType')?.value || '';
    const site  = document.getElementById('mntSite')?.value || '';
    const cost  = document.getElementById('mntCost')?.value || '0';
    const next  = document.getElementById('mntNext')?.value || '';
    const desc  = document.getElementById('mntDesc')?.value?.trim() || '';
    const msgEl = document.getElementById('mntMsg');

    const showMsg = (t, ok) => {
      if (!msgEl) return;
      msgEl.style.display = 'block';
      msgEl.style.background = ok ? '#f0fdf4' : '#fef2f2';
      msgEl.style.color      = ok ? '#16a34a' : '#dc2626';
      msgEl.textContent = t;
    };

    if (!date || !asset || !type || !desc) return showMsg('Date, Asset, Type and Description are required.', false);

    const row = [
      new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}),
      date, asset, type, site, desc, cost, next,
      STATE.user?.name || 'Unknown',
    ];

    fetch(APPS_SCRIPT_URL, {
      method:'POST', headers:{'Content-Type':'text/plain'},
      body: JSON.stringify({ action:'appendRow', sheetId: SHEET_ID, tab:'AssetMaintenance', row }),
    }).catch(()=>{});

    showMsg('✓ Maintenance record saved!', true);
    ['mntAsset','mntType','mntSite','mntCost','mntNext','mntDesc'].forEach(id=>{
      const el = document.getElementById(id); if(el) el.value='';
    });
    setTimeout(() => { if(msgEl) msgEl.style.display='none'; }, 2500);
  };
}

// ════════════════════════════════════════════════════════════════
//  EG AI ASSISTANT — Powered by Claude
//  Accesses live portal state: sites, employees, vendors, accounts
//  safety incidents, assets, purchase orders
// ════════════════════════════════════════════════════════════════

const AI_CHAT = {
  open: false,
  history: [],   // [{role:'user'|'assistant', content:''}]
  busy: false,
};

// ── Toggle panel ─────────────────────────────────────────────────
window.toggleAIChat = function() {
  AI_CHAT.open = !AI_CHAT.open;
  document.getElementById('aiChatPanel').classList.toggle('open', AI_CHAT.open);
  // Close notif panel if open
  if (AI_CHAT.open) {
    STATE.notifOpen = false;
    document.getElementById('notifPanel').classList.remove('open');
    // Show welcome if first open
    if (AI_CHAT.history.length === 0) aiWelcome();
    aiUpdateContext();
    setTimeout(() => document.getElementById('aiChatInput')?.focus(), 300);
  }
};

// ── Welcome message ───────────────────────────────────────────────
function aiWelcome() {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = STATE.user?.name?.split(' ')[0] || (STATE.role === 'md' ? 'Sir' : 'there');
  aiAppendBot(`${greet}, **${name}**! I'm your EG Assistant — I have live access to your portal data including sites, employees, vendors, accounts, safety records, and more.

Ask me anything about EVGCPL operations, or tap a suggestion below to get started. 🏗️`);
}

// ── Context bar update ────────────────────────────────────────────
function aiUpdateContext() {
  const el = document.getElementById('aiCtxText');
  if (!el) return;
  if (!STATE.mastersLoaded) {
    el.textContent = 'Loading portal data…';
    return;
  }
  const sites = (STATE.masters.sites||[]).filter(s=>s.status==='ACTIVE').length;
  const emps  = (STATE.masters.users||[]).filter(u=>u.status==='ACTIVE').length;
  const vend  = (STATE.masters.vendors||[]).length;
  el.textContent = `${sites} active sites · ${emps} employees · ${vend} vendors loaded`;
}

// ── Build system prompt with live portal data ─────────────────────
function aiSystemPrompt() {
  const now = new Date().toLocaleDateString('en-IN', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
  const m = STATE.masters || {};

  // Sites
  const activeSites   = (m.sites||[]).filter(s=>s.status==='ACTIVE');
  const inactiveSites = (m.sites||[]).filter(s=>s.status!=='ACTIVE');
  const siteSummary   = activeSites.slice(0,20).map(s=>`  • ${s.siteId}: ${s.name} (${s.city||'?'}, ${s.state||'?'}) — IC: ${s.incharge||'N/A'}`).join('\n');

  // Employees
  const activeEmps  = (m.users||[]).filter(u=>u.status==='ACTIVE');
  const depts       = {};
  activeEmps.forEach(e=>{ depts[e.dept||'Unknown']=(depts[e.dept||'Unknown']||0)+1; });
  const deptSummary = Object.entries(depts).sort((a,b)=>b[1]-a[1]).slice(0,10)
    .map(([d,c])=>`  • ${d}: ${c}`).join('\n');

  // Vendors
  const vendors = (m.vendors||[]).slice(0,15).map(v=>`  • ${v.id||v.name}: ${v.type||''}`.trim()).join('\n');

  // Assets
  const assets = m.assets||[];
  const assetCats = {};
  assets.forEach(a=>{ assetCats[a.category||'Other']=(assetCats[a.category||'Other']||0)+1; });
  const assetSummary = Object.entries(assetCats).sort((a,b)=>b[1]-a[1])
    .map(([c,n])=>`  • ${c}: ${n}`).join('\n');

  // Subcontractors
  const scs = (m.subcontractors||[]).length;

  // Accounts (if loaded)
  const accRows = window._accAllRows || [];
  let accSummary = '';
  if (accRows.length) {
    const pending   = accRows.filter(r=>r.status.cat==='pending').length;
    const completed = accRows.filter(r=>r.status.cat==='completed').length;
    const progress  = accRows.filter(r=>r.status.cat==='progress').length;
    const totalAmt  = accRows.filter(r=>r.status.cat==='completed').reduce((s,r)=>s+r.amount,0);
    accSummary = `
## Accounts & Payments
- Total payment requests: ${accRows.length}
- Pending: ${pending} | In Progress: ${progress} | Completed: ${completed}
- Total paid amount: ₹${Math.round(totalAmt).toLocaleString('en-IN')}`;
  }

  // Safety incidents (from sessionStorage)
  let safetyInfo = '';
  try {
    const incs = JSON.parse(sessionStorage.getItem('evgcpl_safety_incidents')||'[]');
    const open = incs.filter(i=>i.status==='Open').length;
    if (incs.length) safetyInfo = `\n## Safety\n- Total incidents logged: ${incs.length}\n- Open: ${open} | Closed: ${incs.length-open}`;
  } catch(e) {}

  // Current user
  const userInfo = STATE.user
    ? `Name: ${STATE.user.name||'Unknown'}, Email: ${STATE.user.email||''}, Role: ${STATE.role}`
    : `Role: ${STATE.role}`;

  return `You are EG Assistant, the AI-powered assistant for EVGCPL (Evergreen Enterprises) Intranet Portal. You have real-time access to the company's operational data loaded in this session.

## Company
Evergreen Enterprises (EVGCPL) is a multi-site civil and infrastructure contractor headquartered in Namakkal, Tamil Nadu, India.

## Current User
${userInfo}

## Today's Date
${now}

## Live Portal Data

### Sites
- Active sites: ${activeSites.length}
- Inactive/closed sites: ${inactiveSites.length}
- Total: ${(m.sites||[]).length}
Top active sites:
${siteSummary||'  (loading…)'}

### Workforce
- Active employees: ${activeEmps.length}
- Total in register: ${(m.users||[]).length}
Department breakdown:
${deptSummary||'  (loading…)'}

### Procurement & Supply Chain
- Vendors registered: ${(m.vendors||[]).length}
- Sub-contractors: ${scs}
Top vendors:
${vendors||'  (loading…)'}

### Equipment & Assets
- Total assets: ${assets.length}
Asset categories:
${assetSummary||'  (loading…)'}
${accSummary}${safetyInfo}

## Instructions
- Answer questions about EVGCPL operations using the data above
- Be concise but thorough; use bullet points and numbers where helpful
- If asked about specific employees, vendors, or sites not in the summary, note data may be partial
- Format numbers in Indian system (lakhs, crores) when appropriate
- You can help with analysis, calculations, and recommendations based on the data
- For sensitive HR/financial queries, remind that detailed records are in the respective modules
- Always respond in the same language the user writes in
- Keep responses focused and practical for a busy construction company manager`;
}

// ── Send message ──────────────────────────────────────────────────
window.aiSend = async function() {
  if (AI_CHAT.busy) return;
  const input = document.getElementById('aiChatInput');
  const msg   = (input?.value||'').trim();
  if (!msg) return;
  input.value = '';
  input.style.height = 'auto';

  aiAppendUser(msg);
  AI_CHAT.history.push({ role:'user', content: msg });
  document.getElementById('aiSuggestions').style.display = 'none';
  aiSetBusy(true);

  // Show typing indicator
  const typingId = 'ai-typing-' + Date.now();
  aiAppendTyping(typingId);

  try {
    // Route through Apps Script proxy — uses free Gemini API (GEMINI_API_KEY in Script Properties)
    const res = await fetch(APPS_SCRIPT_URL, {
      method:'POST',
      headers:{ 'Content-Type':'text/plain' },
      body: JSON.stringify({
        action: 'aiProxy',
        system: aiSystemPrompt(),
        messages: AI_CHAT.history.map(h => ({ role: h.role, content: h.content }))
      })
    });

    const data = await res.json();
    document.getElementById(typingId)?.remove();

    if (!data.success) throw new Error(data.message || data.error?.message || 'Proxy error');

    const reply = data.reply || 'Sorry, I could not get a response.';
    AI_CHAT.history.push({ role:'assistant', content: reply });
    aiAppendBot(reply);

    // Show new contextual suggestions based on reply
    aiRefreshSuggestions(msg, reply);

  } catch(err) {
    document.getElementById(typingId)?.remove();
    console.error('AI Chat error:', err);
    aiAppendBot('⚠️ Something went wrong: ' + err.message + '\n\nPlease check your connection and try again.');
  }

  aiSetBusy(false);
};

window.aiSendSuggestion = function(btn) {
  const input = document.getElementById('aiChatInput');
  if (input) { input.value = btn.textContent; }
  aiSend();
};

// ── DOM helpers ───────────────────────────────────────────────────
function aiAppendUser(text) {
  const msgs = document.getElementById('aiChatMsgs');
  if (!msgs) return;
  const time = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
  const div = document.createElement('div');
  div.className = 'ai-msg user';
  div.innerHTML = `<div class="ai-bubble">${escHtml(text)}</div><div class="ai-bubble-time">${time}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function aiAppendBot(md) {
  const msgs = document.getElementById('aiChatMsgs');
  if (!msgs) return;
  const time = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
  const div = document.createElement('div');
  div.className = 'ai-msg bot';
  div.innerHTML = `<div class="ai-bubble">${aiFormatMd(md)}</div><div class="ai-bubble-time">EG Assistant · ${time}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function aiAppendTyping(id) {
  const msgs = document.getElementById('aiChatMsgs');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = 'ai-msg bot';
  div.id = id;
  div.innerHTML = `<div class="ai-typing"><span></span><span></span><span></span></div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function aiSetBusy(busy) {
  AI_CHAT.busy = busy;
  const btn = document.getElementById('aiSendBtn');
  if (btn) btn.disabled = busy;
  const inp = document.getElementById('aiChatInput');
  if (inp) inp.disabled = busy;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

// Minimal markdown: **bold**, *italic*, `code`, bullet lists, numbered lists
function aiFormatMd(md) {
  let html = escHtml(md);
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic  
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bullet lists (lines starting with • or - or *)
  html = html.replace(/^[•\-] (.+)$/gm, '<div style="margin:.15rem 0;padding-left:.8rem;position:relative"><span style="position:absolute;left:0;color:var(--g5)">•</span>$1</div>');
  // Numbered lists
  html = html.replace(/^(\d+)\. (.+)$/gm, '<div style="margin:.15rem 0;padding-left:1.2rem;position:relative"><span style="position:absolute;left:0;color:var(--g5);font-weight:600">$1.</span>$2</div>');
  // Headers
  html = html.replace(/^## (.+)$/gm, '<div style="font-weight:700;color:var(--g8);margin:.6rem 0 .2rem;font-size:.85rem">$1</div>');
  html = html.replace(/^# (.+)$/gm,  '<div style="font-weight:700;color:var(--g9);margin:.7rem 0 .25rem;font-size:.9rem">$1</div>');
  return html;
}

// ── Contextual suggestion refresh ─────────────────────────────────
function aiRefreshSuggestions(question, answer) {
  const q = question.toLowerCase();
  const el = document.getElementById('aiSuggestions');
  if (!el) return;

  let suggestions = [];
  if (q.includes('site')) {
    suggestions = ['Site-wise employee count','Which sites have safety incidents?','Top performing sites','Sites in Tamil Nadu'];
  } else if (q.includes('employee') || q.includes('staff')) {
    suggestions = ['Department headcount','New joiners this quarter','Site-wise employees','HR contacts'];
  } else if (q.includes('vendor') || q.includes('payment') || q.includes('account')) {
    suggestions = ['Top vendors by spend','Pending payment summary','Payment trend analysis','Overdue approvals'];
  } else if (q.includes('safety') || q.includes('incident')) {
    suggestions = ['Open incidents by site','Safety check compliance','Recent near-misses','Safety statistics'];
  } else if (q.includes('equipment') || q.includes('asset')) {
    suggestions = ['Equipment by category','Idle equipment','Asset utilization','Maintenance schedule'];
  } else {
    suggestions = ['Summary dashboard','Budget status','Safety overview','Vendor analysis'];
  }

  el.style.display = 'flex';
  el.innerHTML = suggestions.map(s =>
    `<button class="ai-sugg" onclick="aiSendSuggestion(this)">${s}</button>`
  ).join('');
}

// ── Close on outside click ─────────────────────────────────────────
document.addEventListener('click', function(e) {
  const panel = document.getElementById('aiChatPanel');
  const btn   = document.getElementById('aiChatBtn');
  if (!panel || !btn) return;
  if (AI_CHAT.open && !panel.contains(e.target) && !btn.contains(e.target)) {
    AI_CHAT.open = false;
    panel.classList.remove('open');
  }
});


// ════════════════════════════════════════════════════════════════
//  RECRUITMENT MODULE  (v1.0  ·  Sessions 4 + 5)
//  Route:  'recruitment'  hosted on hr.html
//  Roles:  md · hr · dept_head · site (MRF raise only for site)
// ════════════════════════════════════════════════════════════════

// RECRUITMENT_SHEET_ID declared at top of portal-bundle.js (line ~2843)

// ── Status config ──────────────────────────────────────────────
const RC_STATUS = {
  'Pending HR Review':   { color:'#d97706', bg:'#fffbeb', dot:'🟡' },
  'Pending MD Approval': { color:'#2563eb', bg:'#eff6ff', dot:'🔵' },
  'Open':                { color:'#16a34a', bg:'#f0fdf4', dot:'🟢' },
  'Returned':            { color:'#dc2626', bg:'#fef2f2', dot:'🔴' },
  'Rejected':            { color:'#dc2626', bg:'#fef2f2', dot:'🔴' },
  'Closed – Filled':     { color:'#6b7280', bg:'#f9fafb', dot:'⚫' },
  'Closed – Cancelled':  { color:'#9ca3af', bg:'#f9fafb', dot:'⚫' },
};

// ── Session state ──────────────────────────────────────────────
let _rcTab   = 'requisitions';  // active tab key
let _rcMRFs  = null;            // null = not loaded yet
let _rcLoading = false;

// ══════════════════════════════════════════════════════════════
//  ENTRY POINT
// ══════════════════════════════════════════════════════════════
function renderRecruitmentModule() {
  const el   = document.getElementById('mainContent');
  const role = STATE.role;

  if (!STATE.mastersLoaded) {
    el.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--txt3)">⏳ Loading master data…</div>`;
    loadAllMasters().then(() => renderRecruitmentModule());
    return;
  }

  const tabs = [
    { key:'overview',      label:'Overview',      icon:'📊', roles:['md','hr'] },
    { key:'requisitions',  label:'Requisitions',  icon:'📋', roles:['md','hr','dept_head','site'] },
    { key:'offer-letters', label:'Offer Letters', icon:'📄', roles:['md','hr'] },
    { key:'pre-joining',   label:'Pre-Joining',   icon:'☑️', roles:['md','hr'] },
    { key:'joining',       label:'Joining',       icon:'🎯', roles:['md','hr'] },
  ].filter(t => t.roles.includes(role));

  if (!tabs.find(t => t.key === _rcTab)) _rcTab = tabs[0]?.key || 'requisitions';

  const canRaise = ['md','hr','dept_head','site'].includes(role);

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <h1>👥 Recruitment</h1>
          <p>Manpower requisitions · Offer letters · Pre-joining · Joining</p>
        </div>
        ${canRaise ? `<button class="btn btn-primary btn-sm" onclick="_rcOpenMRFForm()">+ New MRF</button>` : ''}
      </div>
    </div>

    <div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:1.4rem;overflow-x:auto">
      ${tabs.map(t => `
        <button id="rc-tab-${t.key}" onclick="_rcSwitchTab('${t.key}')"
          style="padding:.55rem 1.1rem;background:none;border:none;cursor:pointer;font-size:.82rem;font-weight:${_rcTab===t.key?'600':'400'};
                 color:${_rcTab===t.key?'var(--g7)':'var(--txt3)'};white-space:nowrap;
                 border-bottom:${_rcTab===t.key?'2px solid var(--g7)':'2px solid transparent'};
                 margin-bottom:-2px;transition:all .15s">
          ${t.icon}&nbsp;${t.label}
        </button>`).join('')}
    </div>

    <div id="rc-panel"></div>

    <!-- MRF Modal -->
    <div id="rc-modal" onclick="_rcModalBg(event)"
      style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;overflow-y:auto;padding:2rem 1rem">
      <div onclick="event.stopPropagation()"
        style="background:var(--surface1,#fff);border-radius:16px;max-width:700px;margin:0 auto;
               box-shadow:0 20px 60px rgba(0,0,0,.25)">
        <div style="padding:1.1rem 1.4rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:.95rem;font-weight:600;color:var(--g7)" id="rc-modal-title">📋 Manpower Requisition Form</div>
            <div style="font-size:.74rem;color:var(--txt3);margin-top:2px">All fields marked * are required</div>
          </div>
          <button onclick="_rcCloseModal()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--txt3)">✕</button>
        </div>
        <div id="rc-modal-body" style="padding:1.4rem 1.5rem 1.8rem"></div>
      </div>
    </div>
  `;

  _rcRenderPanel();
}

// ══════════════════════════════════════════════════════════════
//  TAB SWITCHER
// ══════════════════════════════════════════════════════════════
function _rcSwitchTab(key) {
  _rcTab = key;
  document.querySelectorAll('[id^="rc-tab-"]').forEach(b => {
    const active = b.id === 'rc-tab-' + key;
    b.style.fontWeight   = active ? '600' : '400';
    b.style.color        = active ? 'var(--g7)' : 'var(--txt3)';
    b.style.borderBottom = active ? '2px solid var(--g7)' : '2px solid transparent';
  });
  _rcRenderPanel();
}

function _rcRenderPanel() {
  const fns = {
    overview:       _rcRenderOverview,
    requisitions:   _rcRenderRequisitions,
    'offer-letters': _rcRenderOfferLetters,
    'pre-joining':  _rcRenderPreJoining,
    joining:        _rcRenderJoining,
  };
  (fns[_rcTab] || _rcRenderRequisitions)();
}

// ══════════════════════════════════════════════════════════════
//  OVERVIEW TAB  — KPI cards
// ══════════════════════════════════════════════════════════════
function _rcRenderOverview() {
  const panel = document.getElementById('rc-panel');
  panel.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--txt3)">⏳ Loading overview…</div>`;

  Promise.all([
    _rcLoadMRFs(),
    _rcLoadOffers(),
    _rcLoadJoiningData(),
  ]).then(() => {
    const mrfs      = _rcMRFs        || [];
    const offers    = _rcOffers      || [];
    const joiners   = _rcJoiningData || [];

    const open      = mrfs.filter(m => m.status === 'Open').length;
    const pending   = mrfs.filter(m => ['Pending HR Review','Pending MD Approval'].includes(m.status)).length;
    const offerPend = offers.filter(o => o.status === 'Sent').length;

    const thisMonth = new Date().toISOString().slice(0,7);
    const joined    = joiners.filter(j => {
      const jc = (j['Joining Code'] || j['joiningCode'] || '');
      const st = (j['Status'] || j['status'] || '');
      const dt = (j['Actual DOJ'] || j['actualDOJ'] || j['Created At'] || '');
      return st === 'Joined' && dt.startsWith(thisMonth);
    }).length;

    const filled = mrfs.filter(m => m.status === 'Closed – Filled' && m.createdAt && m.closedAt);
    const avgDays = filled.length
      ? Math.round(filled.reduce((s,m) => s + (new Date(m.closedAt)-new Date(m.createdAt))/86400000, 0)/filled.length)
      : '—';

    const card = (icon, value, label, sub, color) => `
      <div class="card card-pad" style="flex:1;min-width:140px;cursor:default">
        <div style="font-size:1.5rem;margin-bottom:.35rem">${icon}</div>
        <div style="font-size:1.9rem;font-weight:700;color:${color||'var(--g7)'};line-height:1">${value}</div>
        <div style="font-size:.78rem;font-weight:600;color:var(--txt1);margin-top:.3rem">${label}</div>
        <div style="font-size:.71rem;color:var(--txt3);margin-top:.1rem">${sub}</div>
      </div>`;

    panel.innerHTML = `
      <div style="display:flex;gap:.9rem;flex-wrap:wrap;margin-bottom:1.2rem">
        ${card('📂', open,      'Open positions',       'Approved MRFs awaiting candidates', '#16a34a')}
        ${card('⏳', pending,   'Pending approval',     'Awaiting HR or MD action',           '#d97706')}
        ${card('📄', offerPend, 'Offers pending',       'Sent — awaiting candidate response', '#2563eb')}
        ${card('🎯', joined,    'Joined this month',    new Date().toLocaleString('en-IN',{month:'long',year:'numeric'}), '#7c3aed')}
        ${card('⏱️', avgDays,   'Avg days to hire',     'MRF open → offer accepted',          '#0891b2')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">

        <div class="card card-pad">
          <div style="font-weight:600;margin-bottom:.8rem;color:var(--txt1);font-size:.85rem">MRF pipeline</div>
          ${mrfs.length === 0
            ? `<p style="color:var(--txt3);font-size:.82rem">No MRFs yet.</p>`
            : _rcStatusBreakdownHtml(mrfs)}
        </div>

        <div class="card card-pad">
          <div style="font-weight:600;margin-bottom:.8rem;color:var(--txt1);font-size:.85rem">Recent activity</div>
          ${_rcRecentActivityHtml(mrfs, offers)}
        </div>

      </div>

      ${pending > 0 && ['md','hr'].includes(STATE.role) ? `
      <div style="margin-top:1rem">
        <div class="card card-pad" style="border-left:3px solid #d97706">
          <div style="font-weight:600;margin-bottom:.6rem;color:#d97706;font-size:.83rem">⏳ Pending your action (${pending})</div>
          ${_rcPendingListHtml(mrfs)}
        </div>
      </div>` : ''}
    `;
  });
}

function _rcStatusBreakdownHtml(mrfs) {
  const counts = {};
  mrfs.forEach(m => { counts[m.status] = (counts[m.status]||0) + 1; });
  return Object.entries(counts).map(([s, c]) => {
    const cfg = RC_STATUS[s] || { color:'#6b7280', bg:'#f9fafb' };
    const pct = Math.round(c/mrfs.length*100);
    return `
      <div style="display:flex;align-items:center;gap:.8rem;margin-bottom:.5rem">
        <span style="font-size:.75rem;color:${cfg.color};background:${cfg.bg};padding:2px 8px;border-radius:20px;white-space:nowrap;min-width:160px">${s}</span>
        <div style="flex:1;height:6px;background:var(--border);border-radius:3px">
          <div style="width:${pct}%;height:6px;background:${cfg.color};border-radius:3px"></div>
        </div>
        <span style="font-size:.78rem;font-weight:600;color:var(--txt2);min-width:20px">${c}</span>
      </div>`;
  }).join('');
}

function _rcPendingListHtml(mrfs) {
  const role = STATE.role;
  const pending = mrfs.filter(m =>
    (role === 'md' && m.status === 'Pending MD Approval') ||
    (role === 'hr' && m.status === 'Pending HR Review')
  );
  if (!pending.length) return `<p style="color:var(--txt3);font-size:.82rem">Nothing pending your action.</p>`;
  return pending.slice(0,5).map(m => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid var(--border)">
      <div>
        <span style="font-weight:600;font-size:.83rem;color:var(--txt1)">${m.position}</span>
        <span style="font-size:.75rem;color:var(--txt3);margin-left:.5rem">${m.site||'—'} · ${m.dept||'—'}</span>
      </div>
      <button class="btn btn-sm btn-secondary" onclick="_rcSwitchTab('requisitions');_rcHighlightMRF('${m.id}')">Review →</button>
    </div>`).join('');
}

function _rcRecentActivityHtml(mrfs, offers) {
  const events = [];
  mrfs.forEach(m => {
    if (m.updatedAt) events.push({ ts: m.updatedAt, icon: '📋', text: `MRF ${m.id} — ${m.status}`, sub: m.position });
  });
  (offers||[]).forEach(o => {
    if (o.sentDate) events.push({ ts: o.sentDate, icon: '📄', text: `Offer sent — ${o.candidateName}`, sub: o.position });
    if (o.acceptanceDate && o.status === 'Accepted') events.push({ ts: o.acceptanceDate, icon: '✅', text: `Offer accepted — ${o.candidateName}`, sub: o.position });
  });
  events.sort((a,b) => b.ts.localeCompare(a.ts));
  if (!events.length) return `<p style="color:var(--txt3);font-size:.82rem">No recent activity.</p>`;
  return events.slice(0,6).map(e => `
    <div style="display:flex;gap:.6rem;padding:.35rem 0;border-bottom:1px solid var(--border)">
      <span style="flex-shrink:0;font-size:.9rem">${e.icon}</span>
      <div>
        <div style="font-size:.78rem;color:var(--txt1)">${e.text}</div>
        <div style="font-size:.72rem;color:var(--txt3)">${e.sub} · ${e.ts.split(',')[0]||e.ts.slice(0,10)}</div>
      </div>
    </div>`).join('');
}

// ══════════════════════════════════════════════════════════════
//  REQUISITIONS TAB  — MRF table + filters
// ══════════════════════════════════════════════════════════════
function _rcRenderRequisitions() {
  const panel = document.getElementById('rc-panel');
  panel.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--txt3)">⏳ Loading requisitions…</div>`;
  _rcLoadMRFs().then(() => _rcDrawRequisitionsTable());
}

// ── Additional state ───────────────────────────────────────────
let _rcOffers      = null;
let _rcJoiningData = null;
let _rcOLDraft     = {};      // offer letter draft in progress

// ── HTML template loader (offer / appointment letters) ──────────
const _tplCache = {};
async function _loadHtmlTemplate(name){
  if (_tplCache[name]) return _tplCache[name];
  const ver = (typeof PORTAL_BUILD !== 'undefined') ? PORTAL_BUILD : 'dev';
  const txt = await (await fetch(`assets/templates/${name}.html?v=${ver}`)).text();
  return (_tplCache[name] = txt);
}
function _fillTemplate(tpl, map){
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in map ? map[k] : ''));
}
let _rcOLTpl = '';

// ── Letter-template fill helpers: a clean value, or a gray-italic .ph placeholder ──
function _rcF(v, ph){ return (v != null && String(v).trim()) ? escapeHtml_(String(v).trim()) : `<span class="ph">${ph || '—'}</span>`; }
function _rcMoney(v){ return (v && Number(v)) ? '₹' + Math.round(Number(v)).toLocaleString('en-IN') : `<span class="ph">—</span>`; }
function _rcFmtDMY(v, ph){
  if (!v) return `<span class="ph">${ph || '—'}</span>`;
  const dt = new Date(v);
  if (isNaN(dt)) return escapeHtml_(String(v));
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getMonth()];
  return `${String(dt.getDate()).padStart(2,'0')}-${mon}-${dt.getFullYear()}`;
}

async function _rcLoadMRFs(force=false) {
  if (_rcMRFs !== null && !force) return;
  _rcLoading = true;
  try {
    const rows = await fetchSheet('MRF_Register', null, RECRUITMENT_SHEET_ID);
    // fetchSheet returns [] on error — fall back to localStorage if empty
    if (rows.length > 0) {
      _rcMRFs = rows.map(r => ({
        id:           r['MRF ID']       || r['id']        || '',
        position:     r['Position']                        || '',
        dept:         r['Department']   || r['Dept']       || '',
        site:         r['Site']                            || '',
        vacancies:    r['Vacancies']    || r['No of Vacancies'] || 1,
        type:         r['Type']                            || 'New Position',
        replacing:    r['Replacing']                       || '',
        requiredBy:   r['Required By']                     || '',
        reportingTo:  r['Reporting To']                    || '',
        skills:       r['Skills']                          || '',
        reason:       r['Reason']                          || '',
        budget:       r['Budget']                          || '',
        status:       r['Status']                          || 'Pending HR Review',
        raisedBy:     r['Raised By']                       || '',
        raisedByEmail:r['Raised By Email']                 || '',
        hrRemarks:    r['HR Remarks']                      || '',
        mdRemarks:    r['MD Remarks']                      || '',
        createdAt:    r['Created At']                      || '',
        updatedAt:    r['Updated At']                      || '',
        closedAt:     r['Closed At']                       || '',
      }));
      _rcPersist();
    } else {
      const stored = localStorage.getItem('evgcpl_mrf_v1');
      _rcMRFs = stored ? JSON.parse(stored) : [];
    }
  } catch(e) {
    const stored = localStorage.getItem('evgcpl_mrf_v1');
    _rcMRFs = stored ? JSON.parse(stored) : [];
  }
  _rcLoading = false;
}

async function _rcLoadOffers(force=false) {
  if (_rcOffers !== null && !force) return;
  try {
    const rows = await fetchSheet('Offer_Tracker', null, RECRUITMENT_SHEET_ID);
    _rcOffers = rows.map(r => ({
      olId:          r['OL ID']          || '',
      refNo:         r['Ref No']         || '',
      mrfId:         r['MRF ID']         || '',
      candidateName: r['Candidate Name'] || '',
      position:      r['Position']       || '',
      site:          r['Site']           || '',
      ctcAnnual:     r['CTC (Annual)']   || '',
      joiningDate:   r['Joining Date']   || '',
      candidateEmail:r['Candidate Email']|| '',
      dispatchMethod:r['Dispatch Method']|| '',
      status:        r['Status']         || 'Sent',
      sentDate:      r['Sent Date']      || '',
      acceptanceDate:r['Acceptance Date']|| '',
      remarks:       r['Remarks']        || '',
      createdAt:     r['Created At']     || '',
      offerDate:     r['Offer Date']     || '',
      grade:         r['Grade']          || '',
      department:    r['Department']     || '',
      address:       r['Address']        || '',
      company:       r['Company']        || '',
      empType:       r['Employee Type']  || '',
      contractPeriod:r['Contractual Period'] || '',
      addr1:         r['Address Line 1'] || '',
      addr2:         r['Address Line 2'] || '',
      addr3:         r['Address Line 3'] || '',
      addr4:         r['Address Line 4'] || '',
      startTime:     r['Start Time']     || '',
      endTime:       r['End Time']       || '',
      noticePeriod:  r['Notice Period']  || '',
      probation:     r['Probation Period']|| '',
      reportingManager: r['Reporting Manager'] || '',
      basic:         r['Basic']          || '',
      da:            r['DA']             || '',
      hra:           r['HRA']            || '',
      specialallow:  r['Special Allowance'] || '',
      conveyance:    r['Conveyance']     || '',
      education:     r['Education Allowance'] || '',
      uniform:       r['Uniform Allowance']  || '',
      lta:           r['LTA']            || '',
      siteallow:     r['Site Allowance'] || '',
      medical:       r['Medical']        || '',
      pfEmployer:    r['PF Employer']    || '',
      gross:         r['Gross']          || '',
      net:           r['Net']            || '',
      ctcMonthly:    r['CTC (Monthly)']  || '',
      agreedSalary:    r['Agreed Salary']     || '',
      calculatedSalary:r['Calculated Salary'] || '',
      basicTotal:      r['Basic Total']       || '',
      hraTotal:        r['HRA Total']         || '',
      otherTotal:      r['Other Total']       || '',
      submittedAt:     r['Submitted For Approval At'] || '',
      submittedBy:     r['Submitted By']      || '',
      approvedBy:      r['Approved By']       || '',
      approvedAt:      r['Approved At']       || '',
      acceptBy:        r['Accept By']         || '',
      acceptedAt:      r['Accepted At']       || '',
      declineReason:   r['Decline Reason']    || '',
      salRows:         (()=>{ try { return JSON.parse(r['Salary JSON']||'[]'); } catch(e){ return []; } })(),
    }));
  } catch(e) { _rcOffers = []; }
}

async function _rcLoadJoiningData(force=false) {
  if (_rcJoiningData !== null && !force) return;
  try {
    const rows = await fetchSheet('v1_JoiningList', null, RECRUITMENT_SHEET_ID);
    _rcJoiningData = rows;
  } catch(e) { _rcJoiningData = []; }
}

function _rcPersist() {
  localStorage.setItem('evgcpl_mrf_v1', JSON.stringify(_rcMRFs));
}

function _rcDrawRequisitionsTable() {
  const panel = document.getElementById('rc-panel');
  const role  = STATE.role;
  const mrfs  = _rcMRFs || [];

  // Filter controls
  const statuses = ['All', ...Object.keys(RC_STATUS)];
  const sites    = ['All', ...(STATE.masters.sites||[]).filter(s=>s.status==='ACTIVE').map(s=>s.name).sort()];

  panel.innerHTML = `
    <!-- Filters -->
    <div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:1rem;align-items:center">
      <select id="rc-filt-status" onchange="_rcDrawRequisitionsTable()"
        style="font-size:.78rem;padding:.35rem .6rem;border:1px solid var(--border);border-radius:8px;background:var(--surface1);color:var(--txt1)">
        ${statuses.map(s=>`<option>${s}</option>`).join('')}
      </select>
      <select id="rc-filt-site" onchange="_rcDrawRequisitionsTable()"
        style="font-size:.78rem;padding:.35rem .6rem;border:1px solid var(--border);border-radius:8px;background:var(--surface1);color:var(--txt1)">
        ${sites.map(s=>`<option>${s}</option>`).join('')}
      </select>
      <input id="rc-filt-q" oninput="_rcDrawRequisitionsTable()" placeholder="Search position, dept…"
        style="font-size:.78rem;padding:.35rem .7rem;border:1px solid var(--border);border-radius:8px;background:var(--surface1);color:var(--txt1);min-width:180px">
      <span style="font-size:.74rem;color:var(--txt3);margin-left:auto" id="rc-count"></span>
    </div>

    <!-- Table -->
    <div style="overflow-x:auto;border-radius:10px;border:1px solid var(--border)">
      <table class="emp-table" style="min-width:820px">
        <thead>
          <tr>
            <th>MRF ID</th>
            <th>Position</th>
            <th>Dept</th>
            <th>Site</th>
            <th style="text-align:center">Vac.</th>
            <th>Type</th>
            <th>Required By</th>
            <th>Raised By</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="rc-mrf-tbody"></tbody>
      </table>
    </div>

    ${mrfs.length === 0 ? `
      <div style="text-align:center;padding:3rem;color:var(--txt3)">
        <div style="font-size:2rem;margin-bottom:.5rem">📋</div>
        <p style="font-weight:600;color:var(--txt2)">No MRFs yet</p>
        <p style="font-size:.8rem;margin-top:.3rem">Click "+ New MRF" to raise the first manpower request.</p>
      </div>` : ''}
  `;

  _rcApplyFiltersAndDraw();
  setTimeout(() => {
    const t = document.querySelector('#rc-panel .emp-table');
    if (t) { makeTableSortable(t); wrapTableScroll(t); }
  }, 80);
}

function _rcApplyFiltersAndDraw() {
  const q       = (document.getElementById('rc-filt-q')?.value||'').toLowerCase();
  const status  = document.getElementById('rc-filt-status')?.value || 'All';
  const site    = document.getElementById('rc-filt-site')?.value   || 'All';
  const role    = STATE.role;

  let rows = (_rcMRFs || []);

  // Site role sees only their site's MRFs
  if (role === 'site') {
    const mySite = (STATE.user?.site||'').toLowerCase();
    rows = rows.filter(m => (m.site||'').toLowerCase() === mySite || m.raisedByEmail === STATE.user?.email);
  }
  // Dept head sees only their dept
  if (role === 'dept_head') {
    const myDept = (STATE.deptHeadDept||'').toLowerCase();
    rows = rows.filter(m => (m.dept||'').toLowerCase().includes(myDept) || m.raisedByEmail === STATE.user?.email);
  }

  if (status !== 'All') rows = rows.filter(m => m.status === status);
  if (site   !== 'All') rows = rows.filter(m => m.site   === site);
  if (q) rows = rows.filter(m =>
    (m.position||'').toLowerCase().includes(q) ||
    (m.dept||'').toLowerCase().includes(q) ||
    (m.id||'').toLowerCase().includes(q)
  );

  const tbody = document.getElementById('rc-mrf-tbody');
  const cntEl = document.getElementById('rc-count');
  if (cntEl) cntEl.textContent = `${rows.length} MRF${rows.length===1?'':'s'}`;

  if (!tbody) return;

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:2rem;color:var(--txt3)">No MRFs match current filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(m => {
    const cfg = RC_STATUS[m.status] || { color:'#6b7280', bg:'#f9fafb' };
    const actions = _rcMRFActions(m, role);
    return `
      <tr id="rc-mrf-row-${m.id}" style="transition:background .3s">
        <td style="font-size:.74rem;font-family:monospace;color:var(--g7)">${m.id||'—'}</td>
        <td style="font-weight:500">${m.position||'—'}</td>
        <td style="font-size:.78rem">${m.dept||'—'}</td>
        <td style="font-size:.78rem">${m.site||'—'}</td>
        <td style="text-align:center;font-weight:600">${m.vacancies||1}</td>
        <td style="font-size:.76rem">${m.type||'—'}</td>
        <td style="font-size:.76rem">${m.requiredBy||'—'}</td>
        <td style="font-size:.75rem;color:var(--txt3)">${m.raisedBy||'—'}</td>
        <td>
          <span style="font-size:.72rem;padding:2px 8px;border-radius:20px;background:${cfg.bg};color:${cfg.color};white-space:nowrap">${m.status||'—'}</span>
        </td>
        <td style="white-space:nowrap">${actions}</td>
      </tr>`;
  }).join('');
}

function _rcMRFActions(m, role) {
  const btns = [];

  // View always
  btns.push(`<button class="btn btn-sm btn-secondary" onclick="_rcViewMRF('${m.id}')" style="font-size:.72rem;padding:3px 9px">View</button>`);

  // Edit — only if pending and raised by current user OR HR/MD
  if (['Pending HR Review'].includes(m.status) && ['md','hr'].includes(role)) {
    btns.push(`<button class="btn btn-sm btn-secondary" onclick="_rcEditMRFForm('${m.id}')" style="font-size:.72rem;padding:3px 9px">Edit</button>`);
  }

  // HR actions
  if (role === 'hr' && m.status === 'Pending HR Review') {
    btns.push(`<button class="btn btn-sm" onclick="_rcHRApprove('${m.id}')" style="font-size:.72rem;padding:3px 9px;background:#16a34a;color:#fff;border:none;border-radius:6px;cursor:pointer">Forward →</button>`);
    btns.push(`<button class="btn btn-sm" onclick="_rcReturn('${m.id}')" style="font-size:.72rem;padding:3px 9px;background:#dc2626;color:#fff;border:none;border-radius:6px;cursor:pointer">Return</button>`);
  }

  // MD actions
  if (role === 'md' && m.status === 'Pending MD Approval') {
    btns.push(`<button class="btn btn-sm" onclick="_rcMDApprove('${m.id}')" style="font-size:.72rem;padding:3px 9px;background:#16a34a;color:#fff;border:none;border-radius:6px;cursor:pointer">Approve ✓</button>`);
    btns.push(`<button class="btn btn-sm" onclick="_rcReject('${m.id}')" style="font-size:.72rem;padding:3px 9px;background:#dc2626;color:#fff;border:none;border-radius:6px;cursor:pointer">Reject</button>`);
  }

  return `<div style="display:flex;gap:4px;flex-wrap:wrap">${btns.join('')}</div>`;
}

// ══════════════════════════════════════════════════════════════
//  MRF FORM  (New + Edit)
// ══════════════════════════════════════════════════════════════
function _rcOpenMRFForm(editId) {
  const modal = document.getElementById('rc-modal');
  const body  = document.getElementById('rc-modal-body');
  const title = document.getElementById('rc-modal-title');
  if (!modal || !body) return;

  const mrf   = editId ? (_rcMRFs||[]).find(m => m.id === editId) : null;
  const isEdit = !!mrf;
  if (title) title.textContent = isEdit ? '✏️ Edit MRF — ' + mrf.id : '📋 Manpower Requisition Form';

  const users = (STATE.masters.users||[]).filter(u => u.empCode && u.name && (!u.empStatus || /^active$/i.test(String(u.empStatus).trim()))).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const sites = (STATE.masters.sites||[]).filter(s=>s.status==='ACTIVE').map(s=>s.name).sort();
  const depts = [...new Set((STATE.masters.users||[]).map(u=>u.dept).filter(Boolean))].sort();

  const v = (f, def='') => mrf ? (mrf[f]||def) : def;

  body.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.9rem">

      <div style="grid-column:1/-1">
        <label class="form-label" style="font-size:.78rem;font-weight:600;color:var(--txt2)">Position Title *</label>
        <input id="rc-f-position" value="${v('position')}" placeholder="e.g. Site Engineer"
          style="width:100%;padding:.45rem .7rem;border:1px solid var(--border);border-radius:8px;font-size:.83rem;background:var(--surface1);color:var(--txt1);margin-top:.25rem">
      </div>

      <div>
        <label style="font-size:.78rem;font-weight:600;color:var(--txt2)">Department *</label>
        <select id="rc-f-dept" style="width:100%;padding:.45rem .7rem;border:1px solid var(--border);border-radius:8px;font-size:.83rem;background:var(--surface1);color:var(--txt1);margin-top:.25rem">
          <option value="">— Select dept —</option>
          ${depts.map(d=>`<option${v('dept')===d?' selected':''}>${d}</option>`).join('')}
        </select>
      </div>

      <div>
        <label style="font-size:.78rem;font-weight:600;color:var(--txt2)">Site *</label>
        <select id="rc-f-site" style="width:100%;padding:.45rem .7rem;border:1px solid var(--border);border-radius:8px;font-size:.83rem;background:var(--surface1);color:var(--txt1);margin-top:.25rem">
          <option value="">— Select site —</option>
          ${sites.map(s=>`<option${v('site')===s?' selected':''}>${s}</option>`).join('')}
        </select>
      </div>

      <div>
        <label style="font-size:.78rem;font-weight:600;color:var(--txt2)">No. of Vacancies *</label>
        <input id="rc-f-vac" type="number" min="1" value="${v('vacancies','1')}"
          style="width:100%;padding:.45rem .7rem;border:1px solid var(--border);border-radius:8px;font-size:.83rem;background:var(--surface1);color:var(--txt1);margin-top:.25rem">
      </div>

      <div>
        <label style="font-size:.78rem;font-weight:600;color:var(--txt2)">Type *</label>
        <div style="display:flex;gap:1rem;margin-top:.5rem">
          <label style="display:flex;align-items:center;gap:.4rem;font-size:.82rem;cursor:pointer">
            <input type="radio" name="rc-f-type" value="New Position" ${v('type','New Position')==='New Position'?'checked':''}>
            New Position
          </label>
          <label style="display:flex;align-items:center;gap:.4rem;font-size:.82rem;cursor:pointer">
            <input type="radio" name="rc-f-type" value="Replacement" ${v('type')==='Replacement'?'checked':''}>
            Replacement
          </label>
        </div>
      </div>

      <div id="rc-f-replace-wrap" style="display:${v('type')==='Replacement'?'block':'none'}">
        <label style="font-size:.78rem;font-weight:600;color:var(--txt2)">Replacing (employee name)</label>
        <input id="rc-f-replace" value="${v('replacing')}" placeholder="Name of departing employee"
          style="width:100%;padding:.45rem .7rem;border:1px solid var(--border);border-radius:8px;font-size:.83rem;background:var(--surface1);color:var(--txt1);margin-top:.25rem">
      </div>

      <div>
        <label style="font-size:.78rem;font-weight:600;color:var(--txt2)">Required By Date *</label>
        <input id="rc-f-reqby" type="date" value="${v('requiredBy')}"
          style="width:100%;padding:.45rem .7rem;border:1px solid var(--border);border-radius:8px;font-size:.83rem;background:var(--surface1);color:var(--txt1);margin-top:.25rem">
      </div>

      <div>
        <label style="font-size:.78rem;font-weight:600;color:var(--txt2)">Reporting To</label>
        <select id="rc-f-reportto" style="width:100%;padding:.45rem .7rem;border:1px solid var(--border);border-radius:8px;font-size:.83rem;background:var(--surface1);color:var(--txt1);margin-top:.25rem">
          <option value="">— Select manager —</option>
          ${users.map(u=>`<option value="${u.empCode||u.name}" ${v('reportingTo')===(u.empCode||u.name)?' selected':''}>${u.name}${u.empCode?' ('+u.empCode+')':''}</option>`).join('')}
        </select>
      </div>

      <div style="grid-column:1/-1">
        <label style="font-size:.78rem;font-weight:600;color:var(--txt2)">Skills Required</label>
        <textarea id="rc-f-skills" rows="2" placeholder="Key skills, qualifications, experience required…"
          style="width:100%;padding:.45rem .7rem;border:1px solid var(--border);border-radius:8px;font-size:.83rem;background:var(--surface1);color:var(--txt1);resize:vertical;margin-top:.25rem">${v('skills')}</textarea>
      </div>

      <div style="grid-column:1/-1">
        <label style="font-size:.78rem;font-weight:600;color:var(--txt2)">Reason / Justification *</label>
        <textarea id="rc-f-reason" rows="2" placeholder="Why is this position needed?"
          style="width:100%;padding:.45rem .7rem;border:1px solid var(--border);border-radius:8px;font-size:.83rem;background:var(--surface1);color:var(--txt1);resize:vertical;margin-top:.25rem">${v('reason')}</textarea>
      </div>

      <div>
        <label style="font-size:.78rem;font-weight:600;color:var(--txt2)">Annual Salary Budget (₹)</label>
        <input id="rc-f-budget" type="number" value="${v('budget')}" placeholder="Optional — CTC in rupees"
          style="width:100%;padding:.45rem .7rem;border:1px solid var(--border);border-radius:8px;font-size:.83rem;background:var(--surface1);color:var(--txt1);margin-top:.25rem">
      </div>

    </div>

    <!-- Radio toggle for replacement field -->
    <div style="margin-top:1.2rem;padding-top:1rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:.7rem">
      <button onclick="_rcCloseModal()" class="btn btn-secondary btn-sm">Cancel</button>
      <button onclick="_rcSubmitMRF('${isEdit?mrf.id:''}')" class="btn btn-primary btn-sm" id="rc-submit-btn">
        ${isEdit ? 'Save Changes' : 'Submit MRF'}
      </button>
    </div>
  `;

  // Radio change → show/hide replacing field
  document.querySelectorAll('input[name="rc-f-type"]').forEach(r => {
    r.addEventListener('change', () => {
      const wrap = document.getElementById('rc-f-replace-wrap');
      if (wrap) wrap.style.display = r.value === 'Replacement' ? 'block' : 'none';
    });
  });

  modal.style.display = 'block';
  document.body.style.overflow = 'hidden';
}

function _rcEditMRFForm(id) { _rcOpenMRFForm(id); }

function _rcCloseModal() {
  const modal = document.getElementById('rc-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

function _rcModalBg(e) {
  if (e.target.id === 'rc-modal') _rcCloseModal();
}

// ── Form submission ────────────────────────────────────────────
async function _rcSubmitMRF(editId) {
  const get = id => (document.getElementById(id)?.value||'').trim();
  const position  = get('rc-f-position');
  const dept      = get('rc-f-dept');
  const site      = get('rc-f-site');
  const vacancies = parseInt(get('rc-f-vac')||'1');
  const type      = document.querySelector('input[name="rc-f-type"]:checked')?.value || 'New Position';
  const reqBy     = get('rc-f-reqby');
  const reason    = get('rc-f-reason');

  // Validate required fields
  if (!position || !dept || !site || !reqBy || !reason) {
    const missing = [!position&&'Position',!dept&&'Department',!site&&'Site',!reqBy&&'Required By Date',!reason&&'Reason'].filter(Boolean);
    alert('Please fill in: ' + missing.join(', '));
    return;
  }

  const btn = document.getElementById('rc-submit-btn');
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

  const now   = new Date().toLocaleString('en-IN', { timeZone:'Asia/Kolkata' });
  const email = STATE.user?.email || '';
  const name  = STATE.user?.name  || email;

  if (editId) {
    // Edit existing
    const idx = (_rcMRFs||[]).findIndex(m => m.id === editId);
    if (idx >= 0) {
      Object.assign(_rcMRFs[idx], {
        position, dept, site, vacancies, type,
        replacing: get('rc-f-replace'),
        requiredBy: reqBy,
        reportingTo: get('rc-f-reportto'),
        skills: get('rc-f-skills'),
        reason, budget: get('rc-f-budget'),
        updatedAt: now, updatedBy: name,
      });
    }
  } else {
    // New MRF
    const newMRF = {
      id:         _rcGenMRFId(),
      position, dept, site, vacancies, type,
      replacing:  get('rc-f-replace'),
      requiredBy: reqBy,
      reportingTo: get('rc-f-reportto'),
      skills:     get('rc-f-skills'),
      reason,
      budget:     get('rc-f-budget'),
      status:     'Pending HR Review',
      raisedBy:   name,
      raisedByEmail: email,
      createdAt:  now,
    };
    _rcMRFs = [newMRF, ...(_rcMRFs||[])];
  }

  // Persist locally
  _rcPersist();

  // POST to Apps Script (non-blocking — fails gracefully if sheet not set up yet)
  _rcPostAction({ action: editId ? 'updateMRF' : 'saveMRF', mrf: editId ? _rcMRFs.find(m=>m.id===editId) : _rcMRFs[0] });

  _rcCloseModal();
  _rcTab = 'requisitions';
  _rcDrawRequisitionsTable();

  // Toast
  _showRcToast(editId ? '✏️ MRF updated' : '✅ MRF submitted — Pending HR Review');
}

function _rcGenMRFId() {
  const yr  = new Date().getFullYear();
  const existing = (_rcMRFs||[]).filter(m => m.id && m.id.startsWith('MRF-'+yr+'-'));
  const next = existing.length + 1;
  return `MRF-${yr}-${String(next).padStart(3,'0')}`;
}

// ── View MRF detail ────────────────────────────────────────────
function _rcViewMRF(id) {
  const mrf = (_rcMRFs||[]).find(m => m.id === id);
  if (!mrf) return;
  const modal = document.getElementById('rc-modal');
  const body  = document.getElementById('rc-modal-body');
  const title = document.getElementById('rc-modal-title');
  if (!modal || !body) return;

  if (title) title.textContent = '📋 MRF Details — ' + mrf.id;
  const cfg = RC_STATUS[mrf.status] || { color:'#6b7280', bg:'#f9fafb' };

  const row = (label, value) => value
    ? `<div style="display:flex;gap:.5rem;padding:.4rem 0;border-bottom:1px solid var(--border)">
         <span style="font-size:.76rem;color:var(--txt3);min-width:140px;flex-shrink:0">${label}</span>
         <span style="font-size:.8rem;color:var(--txt1)">${value}</span>
       </div>` : '';

  body.innerHTML = `
    <div style="margin-bottom:1rem">
      <span style="font-size:.78rem;padding:3px 12px;border-radius:20px;background:${cfg.bg};color:${cfg.color};font-weight:600">${mrf.status}</span>
    </div>
    ${row('MRF ID', mrf.id)}
    ${row('Position', mrf.position)}
    ${row('Department', mrf.dept)}
    ${row('Site', mrf.site)}
    ${row('Vacancies', mrf.vacancies)}
    ${row('Type', mrf.type + (mrf.replacing ? ' — replacing ' + mrf.replacing : ''))}
    ${row('Required By', mrf.requiredBy)}
    ${row('Reporting To', mrf.reportingTo)}
    ${row('Skills Required', mrf.skills)}
    ${row('Reason / Justification', mrf.reason)}
    ${row('Salary Budget', mrf.budget ? '₹' + Number(mrf.budget).toLocaleString('en-IN') + ' p.a.' : '')}
    ${row('Raised By', mrf.raisedBy)}
    ${row('Created', mrf.createdAt)}
    ${row('Updated', mrf.updatedAt)}
    ${mrf.hrRemarks ? row('HR Remarks', mrf.hrRemarks) : ''}
    ${mrf.mdRemarks ? row('MD Remarks', mrf.mdRemarks) : ''}

    <div style="margin-top:1.2rem;padding-top:.8rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end">
      <button onclick="_rcCloseModal()" class="btn btn-secondary btn-sm">Close</button>
    </div>
  `;
  modal.style.display = 'block';
  document.body.style.overflow = 'hidden';
}

// ── Highlight row after tab switch ─────────────────────────────
function _rcHighlightMRF(id) {
  setTimeout(() => {
    const row = document.getElementById('rc-mrf-row-' + id);
    if (row) {
      row.style.background = '#fffbeb';
      row.scrollIntoView({ behavior:'smooth', block:'center' });
      setTimeout(() => row.style.background = '', 2000);
    }
  }, 300);
}

// ══════════════════════════════════════════════════════════════
//  STATUS TRANSITIONS
// ══════════════════════════════════════════════════════════════
function _rcUpdateStatus(id, newStatus, remarks) {
  const mrf = (_rcMRFs||[]).find(m => m.id === id);
  if (!mrf) return;
  const now   = new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'});
  const actor = STATE.user?.name || STATE.user?.email || '';
  mrf.status    = newStatus;
  mrf.updatedAt = now;
  mrf.updatedBy = actor;
  if (remarks) {
    if (STATE.role === 'hr') mrf.hrRemarks = remarks;
    if (STATE.role === 'md') mrf.mdRemarks = remarks;
  }
  if (['Closed – Filled','Closed – Cancelled'].includes(newStatus)) mrf.closedAt = now;

  _rcPersist();
  _rcPostAction({ action:'updateMRFStatus', id, status:newStatus, remarks, actor, role:STATE.role, updatedAt:now });
}

function _rcHRApprove(id) {
  const mrf = (_rcMRFs||[]).find(m => m.id === id);
  if (!mrf) return;
  const remarks = prompt('Forward to MD — any notes to add? (optional)');
  if (remarks === null) return; // cancelled
  _rcUpdateStatus(id, 'Pending MD Approval', remarks);
  _rcDrawRequisitionsTable();
  _showRcToast('🔵 MRF forwarded to MD for approval');
}

function _rcMDApprove(id) {
  if (!confirm('Approve this MRF and open the position?')) return;
  _rcUpdateStatus(id, 'Open');
  _rcDrawRequisitionsTable();
  _showRcToast('✅ MRF approved — position is now Open');
}

function _rcReturn(id) {
  const remarks = prompt('Reason for returning this MRF:');
  if (!remarks || !remarks.trim()) return;
  _rcUpdateStatus(id, 'Returned', remarks.trim());
  _rcDrawRequisitionsTable();
  _showRcToast('↩️ MRF returned with remarks');
}

function _rcReject(id) {
  const remarks = prompt('Reason for rejection:');
  if (!remarks || !remarks.trim()) return;
  _rcUpdateStatus(id, 'Rejected', remarks.trim());
  _rcDrawRequisitionsTable();
  _showRcToast('❌ MRF rejected');
}

// ══════════════════════════════════════════════════════════════
//  PLACEHOLDER TABS  (built in later sessions)
// ══════════════════════════════════════════════════════════════
// STUBS_REPLACED_BELOW

// ══════════════════════════════════════════════════════════════
//  APPS SCRIPT BRIDGE
// ══════════════════════════════════════════════════════════════
function _rcPostAction(payload) {
  fetch(APPS_SCRIPT_URL, {
    method:'POST',
    headers:{'Content-Type':'text/plain'},
    body: JSON.stringify({ ...payload, sheetId: RECRUITMENT_SHEET_ID })
  }).catch(() => {});
}

// ══════════════════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════════════════
function _showRcToast(msg) {
  let t = document.getElementById('rc-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'rc-toast';
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--g7);color:#fff;padding:10px 20px;border-radius:10px;font-size:.83rem;font-weight:500;z-index:2000;box-shadow:0 6px 20px rgba(0,0,0,.25);opacity:0;transition:opacity .2s';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.style.opacity = '0', 3000);
}

// ══════════════════════════════════════════════════════════════
//  OFFER LETTERS TAB  (Sessions 6 & 7)
// ══════════════════════════════════════════════════════════════
function _rcRenderOfferLetters() {
  const panel = document.getElementById('rc-panel');
  panel.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--txt3)">⏳ Loading…</div>`;
  Promise.all([_rcLoadMRFs(), _rcLoadOffers()]).then(() => _rcDrawOfferLettersTab());
}

function _rcDrawOfferLettersTab() {
  const panel  = document.getElementById('rc-panel');
  const offers = _rcOffers || [];
  panel.innerHTML = `
    <div style="display:flex;gap:0;margin-bottom:1.2rem;border-bottom:1px solid var(--border)">
      <button id="rc-ol-tab-new" onclick="_rcOLSubTab('new')"
        style="padding:.45rem .9rem;background:none;border:none;border-bottom:2px solid var(--g7);font-size:.81rem;font-weight:600;color:var(--g7);cursor:pointer">
        + New Offer Letter
      </button>
      <button id="rc-ol-tab-tracker" onclick="_rcOLSubTab('tracker')"
        style="padding:.45rem .9rem;background:none;border:none;border-bottom:2px solid transparent;font-size:.81rem;color:var(--txt3);cursor:pointer">
        Offer Tracker (${offers.length})
      </button>
    </div>
    <div id="rc-ol-sub"></div>`;
  _rcOLSubTab('new');
}

function _rcOLSubTab(tab) {
  ['new','tracker'].forEach(t => {
    const b = document.getElementById('rc-ol-tab-'+t);
    if (!b) return;
    b.style.borderBottom = t===tab ? '2px solid var(--g7)' : '2px solid transparent';
    b.style.fontWeight   = t===tab ? '600' : '400';
    b.style.color        = t===tab ? 'var(--g7)' : 'var(--txt3)';
  });
  const sub = document.getElementById('rc-ol-sub');
  if (!sub) return;
  if (tab === 'new') _rcDrawOLForm(sub);
  else _rcDrawOLTracker(sub);
}

// ── Designation Master state ──────────────────────────────────
let _rcDesigMaster = null; // [{desig, grade, dept}]

async function _rcLoadDesigMaster() {
  if (_rcDesigMaster !== null) return;
  try {
    // Try Designation Master tab in Employee Register (tolerate name variants)
    let rows = [];
    for (const tab of ['Designation Master','Designation_Master','DesignationMaster','Designations','Designation']) {
      try { rows = await fetchSheet(tab, null, EMP_SHEET_ID); if (rows.length) break; } catch(e) {}
    }
    if (rows.length > 0) {
      _rcDesigMaster = rows
        .filter(r => r['Designation'] || r['DESIGNATION'] || r['designation'])
        .map(r => ({
          desig: r['Designation'] || r['DESIGNATION'] || r['designation'] || '',
          grade: r['Grade'] || r['GRADE'] || r['grade'] || '',
          dept:  r['Department'] || r['DEPARTMENT'] || r['dept'] || '',
        }))
        .filter(r => r.desig);
    }
  } catch(e) {}

  // Fallback: derive unique designations from loaded employee masters
  if (!_rcDesigMaster || !_rcDesigMaster.length) {
    const seen = {};
    (STATE.masters.users || []).forEach(u => {
      if (u.desig && !seen[u.desig]) {
        seen[u.desig] = { desig: u.desig, grade: u.grade || '', dept: u.dept || '' };
      }
    });
    _rcDesigMaster = Object.values(seen).sort((a,b) => a.desig.localeCompare(b.desig));
  }
}

// Billing master (1-BillingMaster on the main MASTER sheet) — for the offer "Company" dropdown.
let _rcBillingMaster = null;
async function _rcLoadBillingMaster() {
  if (_rcBillingMaster !== null) return;
  try {
    const rows = await fetchSheet('1-BillingMaster', null, SHEET_ID);
    const seen = new Set();
    _rcBillingMaster = rows
      .map(r => ({
        name: r['Billing Name'] || r['Name'] || r['Company'] || r['Company Name'] || '',
        gst:  r['GST'] || r['GSTIN'] || '',
      }))
      .filter(r => {
        if (!r.name) return false;
        const k = r.name.trim().toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a,b) => a.name.localeCompare(b.name));
  } catch(e) { _rcBillingMaster = []; }
}

function _rcDrawOLForm(container) {
  // Ensure masters + letter template are loaded, then render
  Promise.all([
    _rcLoadDesigMaster(),
    _rcLoadBillingMaster(),
    _loadHtmlTemplate('offer-letter').then(t => _rcOLTpl = t),
  ]).then(() => _rcDrawOLFormInner(container));
}

function _rcDrawOLFormInner(container) {
  const mrfs  = (_rcMRFs || []).filter(m => m.status === 'Open');
  const d     = _rcOLDraft;
  const desigs = _rcDesigMaster || [];
  // Permissive filter: any record with an identifier (Employee_Ref / EmpCode / name).
  // empStatus filter: include blank (treated as active) or any "Active" variant.
  const users  = (STATE.masters.users || [])
    .filter(u => (u.employeeRef || u.empCode || u.name) && (!u.empStatus || /^active$/i.test(String(u.empStatus).trim())))
    .sort((a,b) => String(a.employeeRef||a.name||'').localeCompare(String(b.employeeRef||b.name||'')));

  if (!d.refNo) {
    const seq = String((_rcOffers||[]).length + 1).padStart(3,'0');
    d.refNo = `EG/M-1/HO-${seq}/TAN-INDIA`;
  }
  _rcOLSeedSalRows();
  // Back-compat: if loaded from a legacy offer with addr1-4, join into a single paragraph
  if (!d.address && (d.addr1||d.addr2||d.addr3||d.addr4)) {
    d.address = [d.addr1,d.addr2,d.addr3,d.addr4].filter(Boolean).join('\n');
  }
  // Offer Valid Until default → Offer Date + 7 days
  const od = d.offerDate || new Date().toISOString().slice(0,10);
  if (!d.validUntil && od) {
    const dt = new Date(od); dt.setDate(dt.getDate()+7);
    if (!isNaN(dt)) d.validUntil = dt.toISOString().slice(0,10);
  }
  // Pre-compute dependent grade list for the initial render
  const desigGrades = [...new Set((desigs||[]).filter(ds=>!d.position||ds.desig===d.position).map(ds=>ds.grade).filter(Boolean))].sort();
  const allDepts    = [...new Set([...desigs.map(ds=>ds.dept).filter(Boolean), ...(STATE.masters.users||[]).map(u=>u.dept).filter(Boolean)])].sort();
  const siteOpts    = (STATE.masters.sites||[]).filter(s=>s.status==='ACTIVE').map(s=>s.name).filter(Boolean).sort();
  // Reports To dropdown uses Employee_Ref (column E) as the display; falls back to name (empCode) when missing.
  const userSelOpts = users.map(u => {
    const ref = u.employeeRef || `${u.name||''}${u.empCode?' ('+u.empCode+')':''}`.trim();
    const val = u.employeeRef || u.empCode || u.name || '';
    return `<option value="${escapeHtml_(val)}" ${d.reportingToCode===val?'selected':''}>${escapeHtml_(ref)}</option>`;
  }).join('');
  const billOpts    = (_rcBillingMaster||[]).map(b => `<option value="${escapeHtml_(b.name)}" ${d.company===b.name?'selected':''}>${escapeHtml_(b.name)}</option>`).join('');

  const desigOpts = desigs.map(ds =>
    `<option value="${ds.desig}" data-grade="${ds.grade}" ${d.position===ds.desig?'selected':''}>${ds.desig}</option>`
  ).join('');

  const userOpts = users.map(u =>
    `<option value="${u.empCode}" data-name="${u.name}" ${d.reportingToCode===u.empCode?'selected':''}>${u.name} — ${u.empCode}${u.desig?' ('+u.desig+')':''}</option>`
  ).join('');

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.2rem;align-items:start">

      <!-- ═══ LEFT: FORM ═══ -->
      <div class="card card-pad" style="max-height:82vh;overflow-y:auto">
        <div style="font-weight:600;font-size:.85rem;color:var(--g7);padding-bottom:.5rem;margin-bottom:.9rem;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--surface1,#fff);z-index:2">
          Appointment Letter Details
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">

          <!-- Linked MRF -->
          <div style="grid-column:1/-1">
            <label class="rc-lbl">Linked MRF</label>
            <select id="ol-mrf" onchange="_rcOLMRFChange()"  class="rc-inp">
              <option value="">— Select MRF or fill manually —</option>
              ${mrfs.map(m=>`<option value="${m.id}" ${d.mrfId===m.id?'selected':''}>${m.id} · ${m.position} · ${m.site}</option>`).join('')}
            </select>
          </div>

          <!-- Ref No (auto-generated, read-only) -->
          <div>
            <label class="rc-lbl">Ref No. <span style="font-size:.68rem;color:var(--txt3)">(auto)</span></label>
            <input id="ol-refno" value="${d.refNo||''}" readonly title="Auto-generated by the system" class="rc-inp" style="background:var(--surface2);color:var(--txt2);cursor:not-allowed">
          </div>

          <!-- Offer Date -->
          <div>
            <label class="rc-lbl">Offer / Letter Date *</label>
            <input id="ol-offerdate" type="date" value="${d.offerDate||new Date().toISOString().slice(0,10)}" oninput="_rcOLOfferDateChange(this.value)" class="rc-inp">
          </div>

          <!-- Name -->
          <div style="grid-column:1/-1">
            <label class="rc-lbl">Candidate Name *</label>
            <input id="ol-name" value="${d.candidateName||''}" oninput="_rcOLField('candidateName',this.value);_rcOLLiveSync('candidateName',this.value)" placeholder="Full name" class="rc-inp">
          </div>

          <!-- Address — single paragraph -->
          <div style="grid-column:1/-1">
            <label class="rc-lbl">Address</label>
            <textarea id="ol-address" oninput="_rcOLField('address',this.value)" rows="3" placeholder="Full address — street, area, city, state, PIN code" class="rc-inp" style="resize:vertical;line-height:1.5;min-height:64px">${escapeHtml_(d.address||'')}</textarea>
          </div>

          <!-- Company — Billing Master -->
          <div>
            <label class="rc-lbl">Company * <span style="font-size:.68rem;color:var(--txt3)">(Billing Master)</span></label>
            <select id="ol-company" onchange="_rcOLField('company',this.value)" class="rc-inp">
              <option value="">— Select —</option>
              ${billOpts}
            </select>
          </div>

          <!-- Employee Type -->
          <div>
            <label class="rc-lbl">Employee Type *</label>
            <select id="ol-emptype" onchange="_rcOLField('empType',this.value)" class="rc-inp">
              <option value="">— Select —</option>
              ${['On Role','Contractual','Head Office'].map(t=>`<option value="${t}" ${d.empType===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>

          <!-- ── DESIGNATION from Designation Master ── -->
          <div>
            <label class="rc-lbl">Designation * <span style="font-size:.68rem;color:var(--txt3)">(Designation Master)</span></label>
            <select id="ol-desig" onchange="_rcOLDesigChange()" class="rc-inp">
              <option value="">— Select —</option>
              ${desigOpts}
            </select>
          </div>

          <!-- GRADE — dependent dropdown filtered by Designation -->
          <div>
            <label class="rc-lbl">Grade * <span style="font-size:.68rem;color:var(--txt3)">(by Designation)</span></label>
            <select id="ol-grade" onchange="_rcOLField('grade',this.value)" class="rc-inp">
              <option value="">— Select —</option>
              ${desigGrades.map(g => `<option value="${g}" ${d.grade===g?'selected':''}>${g}</option>`).join('')}
            </select>
          </div>

          <!-- Department — dropdown -->
          <div>
            <label class="rc-lbl">Department</label>
            <select id="ol-dept" onchange="_rcOLField('dept',this.value)" class="rc-inp">
              <option value="">— Select —</option>
              ${allDepts.map(dp => `<option value="${escapeHtml_(dp)}" ${d.dept===dp?'selected':''}>${escapeHtml_(dp)}</option>`).join('')}
            </select>
          </div>

          <!-- Site — Site Master -->
          <div>
            <label class="rc-lbl">Site / Location <span style="font-size:.68rem;color:var(--txt3)">(Site Master)</span></label>
            <select id="ol-site" onchange="_rcOLField('site',this.value)" class="rc-inp">
              <option value="">— Select —</option>
              ${siteOpts.map(s => `<option value="${escapeHtml_(s)}" ${d.site===s?'selected':''}>${escapeHtml_(s)}</option>`).join('')}
            </select>
          </div>

          <!-- Reports To — dropdown from Employee Register -->
          <div style="grid-column:1/-1">
            <label class="rc-lbl">Reports To * <span style="font-size:.68rem;color:var(--txt3)">(Employee Register)</span></label>
            <select id="ol-rpt" onchange="_rcOLSelectRptDD(this.value)" class="rc-inp">
              <option value="">— Select reporting manager —</option>
              ${userSelOpts}
            </select>
            <input type="hidden" id="ol-rpt-code" value="${d.reportingToCode||''}">
          </div>

          <!-- Working Hours -->
          <div>
            <label class="rc-lbl">Start Time (AM)</label>
            <input id="ol-starttime" value="${d.startTime||'9:30'}" oninput="_rcOLField('startTime',this.value)" class="rc-inp" placeholder="9:30">
          </div>
          <div>
            <label class="rc-lbl">End Time (PM)</label>
            <input id="ol-endtime" value="${d.endTime||'6:30'}" oninput="_rcOLField('endTime',this.value)" class="rc-inp" placeholder="6:30">
          </div>

          <!-- Date of Appointment -->
          <div>
            <label class="rc-lbl">Date of Appointment *</label>
            <input id="ol-doj" type="date" value="${d.joiningDate||''}" oninput="_rcOLField('joiningDate',this.value)" class="rc-inp">
          </div>

          <!-- Notice Period -->
          <div>
            <label class="rc-lbl">Notice Period (days)</label>
            <input id="ol-notice" type="number" value="${d.noticePeriod||'30'}" oninput="_rcOLField('noticePeriod',this.value)" class="rc-inp">
          </div>

          <!-- Probation Period -->
          <div>
            <label class="rc-lbl">Probation (months)</label>
            <input id="ol-probation" type="number" value="${d.probation||'6'}" oninput="_rcOLLiveSync('probation',this.value)" class="rc-inp">
          </div>

          <!-- Contractual Period (only meaningful when Employee Type = Contractual) -->
          <div>
            <label class="rc-lbl">Contractual Period (months) <span style="font-size:.68rem;color:var(--txt3)">(if Contractual)</span></label>
            <input id="ol-contractperiod" type="number" value="${d.contractPeriod||''}" oninput="_rcOLField('contractPeriod',this.value)" class="rc-inp">
          </div>

          <!-- Offer Valid Until — defaults to Offer Date + 7 -->
          <div>
            <label class="rc-lbl">Offer Valid Until <span style="font-size:.68rem;color:var(--txt3)">(default: Offer Date + 7)</span></label>
            <input id="ol-valid" type="date" value="${d.validUntil||''}" oninput="_rcOLField('validUntil',this.value)" class="rc-inp">
          </div>

        </div>

        <!-- ═══ AGREED SALARY + DYNAMIC COMPONENTS ═══ -->
        <div style="margin-top:.9rem">
          <label class="rc-lbl">Agreed Monthly Salary (₹) *</label>
          <input id="ol-agreed" type="number" value="${d.agreedSalary||''}" oninput="_rcOLAgreedChange(this.value)" placeholder="e.g. 25000" class="rc-inp" style="font-weight:600">
        </div>

        <div style="margin-top:.7rem;border:1px solid var(--border);border-radius:8px;overflow:hidden">
          <div style="background:var(--g7,#1A6038);color:#fff;padding:7px 12px;font-size:.76rem;font-weight:600;display:flex;justify-content:space-between;align-items:center">
            <span>Salary Components</span>
            <button type="button" onclick="_rcOLSalAdd()" style="background:rgba(255,255,255,.18);color:#fff;border:1px solid rgba(255,255,255,.35);border-radius:6px;font-size:.7rem;padding:2px 8px;cursor:pointer">➕ Add Element</button>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:.76rem">
            <thead><tr style="background:var(--surface2)">
              <th style="padding:4px 8px;text-align:left;font-size:.7rem;color:var(--txt2);border-bottom:1px solid var(--border)">Component</th>
              <th style="padding:4px 6px;text-align:left;font-size:.7rem;color:var(--txt2);border-bottom:1px solid var(--border)">Group</th>
              <th style="padding:4px 6px;text-align:left;font-size:.7rem;color:var(--txt2);border-bottom:1px solid var(--border)">Basis</th>
              <th style="padding:4px 6px;text-align:right;font-size:.7rem;color:var(--txt2);border-bottom:1px solid var(--border)">Value</th>
              <th style="padding:4px 8px;text-align:right;font-size:.7rem;color:var(--txt2);border-bottom:1px solid var(--border)">Amount</th>
              <th style="border-bottom:1px solid var(--border)"></th>
            </tr></thead>
            <tbody id="ol-sal-tbody"></tbody>
            <tfoot>
              <tr style="background:var(--surface2);font-weight:600"><td colspan="4" style="padding:5px 8px">Calculated Salary</td><td id="ol-calc-disp" style="padding:5px 8px;text-align:right">—</td><td></td></tr>
              <tr><td colspan="4" style="padding:3px 8px;color:var(--txt3);font-size:.72rem">↳ Basic</td><td id="ol-basic-disp" style="padding:3px 8px;text-align:right;font-size:.72rem">—</td><td></td></tr>
              <tr><td colspan="4" style="padding:3px 8px;color:var(--txt3);font-size:.72rem">↳ HRA</td><td id="ol-hra-disp" style="padding:3px 8px;text-align:right;font-size:.72rem">—</td><td></td></tr>
              <tr><td colspan="4" style="padding:3px 8px;color:var(--txt3);font-size:.72rem">↳ Other Allowance</td><td id="ol-other-disp" style="padding:3px 8px;text-align:right;font-size:.72rem">—</td><td></td></tr>
            </tfoot>
          </table>
        </div>

        <!-- Medical + PF (CTC inputs) -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-top:.7rem">
          <div><label class="rc-lbl">Medical Insurance (₹/mo)</label><input id="ol-medical" type="number" value="${d.medical||''}" oninput="_rcOLField('medical',this.value);_rcOLRecalc()" class="rc-inp"></div>
          <div><label class="rc-lbl">Employer PF (₹/mo)</label><input id="ol-pfemployer" type="number" value="${d.pfEmployer||''}" oninput="_rcOLField('pfEmployer',this.value);_rcOLRecalc()" class="rc-inp"></div>
        </div>
        <div style="margin-top:.6rem;background:#f0f7f2;border:1px solid var(--g5,#cde7d6);border-radius:8px;padding:8px 12px;display:flex;justify-content:space-between;font-weight:700;color:#1A6038">
          <span>Cost to Company (CTC) / month</span><span id="ol-ctc-disp2">—</span>
        </div>

        <!-- Candidate Email -->
        <div style="margin-top:.7rem">
          <label class="rc-lbl">Candidate Email</label>
          <input id="ol-email" type="email" value="${d.candidateEmail||''}" oninput="_rcOLField('candidateEmail',this.value)" class="rc-inp">
        </div>

        <!-- Action Buttons -->
        <div style="display:flex;gap:.6rem;margin-top:1rem;flex-wrap:wrap;position:sticky;bottom:0;background:var(--surface1,#fff);padding-top:.6rem;border-top:1px solid var(--border)">
          <button onclick="_rcOLUpdatePreview()" class="btn btn-secondary btn-sm">↻ Refresh Preview</button>
          <button onclick="_rcOLGeneratePDF()" class="btn btn-primary btn-sm">🖨 Print / Save PDF</button>
          <button onclick="_rcOLSaveOffer()" style="padding:.35rem .9rem;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:.79rem;font-weight:600;cursor:pointer">💾 Save as Draft</button>
          <button onclick="_rcOLSendForApproval()" style="padding:.35rem .9rem;background:#1A6038;color:#fff;border:none;border-radius:8px;font-size:.79rem;font-weight:600;cursor:pointer">📤 Send for MD Approval</button>
        </div>
      </div>

      <!-- ═══ RIGHT: LIVE PREVIEW ═══ -->
      <div style="position:sticky;top:0">
        <div style="font-size:.72rem;font-weight:600;color:var(--txt3);margin-bottom:.4rem;text-transform:uppercase;letter-spacing:.05em">Live Preview — matches print output</div>
        <div id="ol-preview-frame" style="border:1px solid var(--border);border-radius:10px;overflow:hidden;background:#fff;height:82vh">
          <iframe id="ol-preview-iframe" title="Offer letter preview" sandbox="allow-same-origin" style="width:100%;height:100%;border:0;background:#fff"></iframe>
        </div>
      </div>

    </div>

    <style>
      .rc-lbl { display:block;font-size:.74rem;font-weight:600;color:var(--txt2);margin-bottom:.2rem }
      .rc-inp { width:100%;padding:.38rem .6rem;border:1px solid var(--border);border-radius:7px;font-size:.81rem;background:var(--surface1);color:var(--txt1);box-sizing:border-box }
      .rc-inp:focus { outline:none;border-color:var(--g7) }
    </style>
  `;

  // Close rpt dropdown on outside click
  document.addEventListener('click', function _rptClose(e) {
    if (!e.target.closest('#ol-rpt-search') && !e.target.closest('#ol-rpt-dropdown')) {
      const dd = document.getElementById('ol-rpt-dropdown');
      if (dd) dd.style.display = 'none';
      document.removeEventListener('click', _rptClose);
    }
  });

  // Populate the preview iframe once the form is in the DOM
  _rcOLRenderSalTable();
  _rcOLUpdatePreview();
}

// ── Designation change → repopulate Grade options (dependent) + Dept ──────────
function _rcOLDesigChange() {
  const sel   = document.getElementById('ol-desig');
  const desig = sel?.value || '';
  const desigs = _rcDesigMaster || [];
  _rcOLDraft.position = desig;
  // Filter grades for this designation
  const grades  = [...new Set(desigs.filter(ds => !desig || ds.desig===desig).map(ds=>ds.grade).filter(Boolean))].sort();
  const defaultGrade = desigs.find(ds => ds.desig === desig)?.grade || '';
  _rcOLDraft.grade = defaultGrade;
  const gradeEl = document.getElementById('ol-grade');
  if (gradeEl) {
    gradeEl.innerHTML = '<option value="">— Select —</option>' +
      grades.map(g => `<option value="${g}" ${g===defaultGrade?'selected':''}>${g}</option>`).join('');
  }
  // Auto-fill dept from designation master
  const master = desigs.find(ds=>ds.desig===desig);
  if (master?.dept) {
    _rcOLDraft.dept = master.dept;
    const dEl = document.getElementById('ol-dept');
    if (dEl) dEl.value = master.dept;
  }
  _rcOLUpdatePreview();
}

// Offer Date change → also auto-set Offer Valid Until = Offer Date + 7
function _rcOLOfferDateChange(v) {
  _rcOLDraft.offerDate = v;
  if (v) {
    const dt = new Date(v); dt.setDate(dt.getDate()+7);
    if (!isNaN(dt)) {
      const iso = dt.toISOString().slice(0,10);
      _rcOLDraft.validUntil = iso;
      const el = document.getElementById('ol-valid'); if (el) el.value = iso;
    }
  }
  _rcOLPreviewSoon();
}

// Reports To dropdown — `val` is the Employee_Ref string (or empCode/name fallback).
// We persist it directly to reportingTo so the letter prints exactly what HR picked.
function _rcOLSelectRptDD(val) {
  const u = (STATE.masters.users||[]).find(x => (x.employeeRef||x.empCode||x.name) === val);
  _rcOLDraft.reportingToCode = val || '';
  _rcOLDraft.reportingTo     = val || '';
  const hid = document.getElementById('ol-rpt-code'); if (hid) hid.value = val || '';
  _rcOLPreviewSoon();
}

// ── Reports To search/filter ───────────────────────────────────
function _rcOLFilterRpt(q) {
  const dd = document.getElementById('ol-rpt-dropdown');
  if (!dd) return;
  const users = (STATE.masters.users||[]).filter(u => u.empCode && u.name && (!u.empStatus || /^active$/i.test(String(u.empStatus).trim())));
  const filtered = q.length < 1 ? users.slice(0,8) :
    users.filter(u =>
      u.name.toLowerCase().includes(q.toLowerCase()) ||
      u.empCode.toLowerCase().includes(q.toLowerCase())
    ).slice(0,10);
  if (!filtered.length) { dd.style.display='none'; return; }
  dd.innerHTML = filtered.map(u=>`
    <div onclick="_rcOLSelectRpt('${u.empCode}','${u.name.replace(/'/g,"\\'")}','${(u.desig||'').replace(/'/g,"\\'")}')"
      style="padding:8px 12px;cursor:pointer;font-size:.79rem;border-bottom:1px solid var(--border)"
      onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
      <strong>${u.name}</strong>
      <span style="color:var(--txt3);font-size:.71rem;margin-left:.4rem">${u.empCode}${u.desig?' · '+u.desig:''}</span>
    </div>`).join('');
  dd.style.display = 'block';
}

function _rcOLSelectRpt(empCode, name, desig) {
  _rcOLDraft.reportingToCode = empCode;
  _rcOLDraft.reportingTo     = name;
  const inp = document.getElementById('ol-rpt-search');
  const hid = document.getElementById('ol-rpt-code');
  if (inp) inp.value = `${name} (${empCode})`;
  if (hid) hid.value = empCode;
  const dd = document.getElementById('ol-rpt-dropdown');
  if (dd) dd.style.display = 'none';
  _rcOLUpdatePreview();
}

let _rcOLPrevTimer = null;
function _rcOLPreviewSoon(){ clearTimeout(_rcOLPrevTimer); _rcOLPrevTimer = setTimeout(_rcOLUpdatePreview, 250); }

// Tracker + joining-tab filter state (used by status chips / onboarding filter)
let _rcOLStatusFilter = '';   // '' = uninit; first draw sets default for the user's role
let _rcJLOnbFilter    = false;
function _rcOLSetStatusFilter(s){ _rcOLStatusFilter = s; _rcDrawOLTracker(document.getElementById('rc-ol-sub')); }
function _rcJLToggleOnbFilter(){ _rcJLOnbFilter = !_rcJLOnbFilter; _rcDrawJoiningTab(); }
function _rcOLField(key, val) { _rcOLDraft[key] = val; _rcOLPreviewSoon(); }

function _rcOLLiveSync(key, val) {
  _rcOLDraft[key] = val;
  _rcOLUpdatePreview();
}

function _rcOLMRFChange() {
  const id  = document.getElementById('ol-mrf')?.value;
  const mrf = (_rcMRFs||[]).find(m => m.id === id);
  if (!mrf) return;
  Object.assign(_rcOLDraft, { mrfId:id, position:mrf.position||'', site:mrf.site||'', reportingTo:mrf.reportingTo||'' });
  const selDesig = document.getElementById('ol-desig');
  if (selDesig && mrf.position) selDesig.value = mrf.position;
  const siteEl = document.getElementById('ol-site');
  if (siteEl) siteEl.value = mrf.site||'';
  _rcOLUpdatePreview();
}

// Fixed "designed" components (% of Agreed Salary). Editable per offer; recruiter
// adds flat extras (Other Allowance only). Three groups: Basic / HRA / Other Allowance.
const _RC_SAL_COMPONENTS = [
  { name:'Basic',                       group:'Basic', pct:50 },
  { name:'HRA',                         group:'HRA',   pct:10 },
  { name:'Dearness Allowance',          group:'Other', pct:15 },
  { name:'Special Allowance',           group:'Other', pct:15 },
  { name:'Conveyance Allowance',        group:'Other', pct:4  },
  { name:'Education Allowance',         group:'Other', pct:1  },
  { name:'Uniform / Washing Allowance', group:'Other', pct:1  },
  { name:'LTA',                         group:'Other', pct:2  },
  { name:'Site Allowance',              group:'Other', pct:2  },
];

function _rcOLSeedSalRows() {
  if (!_rcOLDraft.salRows || !_rcOLDraft.salRows.length) {
    _rcOLDraft.salRows = _RC_SAL_COMPONENTS.map(c => ({ name:c.name, group:c.group, basis:'pct', value:c.pct }));
  }
}

// Recompute amounts + rollups from Agreed Salary. Does NOT trigger the preview.
function _rcOLRecalc() {
  const d = _rcOLDraft;
  const agreed = parseFloat(d.agreedSalary||0)||0;
  let calc=0, basic=0, hra=0, other=0;
  (d.salRows||[]).forEach(r => {
    const v = parseFloat(r.value||0)||0;
    r.amount = (r.basis==='flat') ? Math.round(v) : Math.round(agreed*v/100);
    calc += r.amount;
    if      (r.group==='Basic') basic += r.amount;
    else if (r.group==='HRA')   hra   += r.amount;
    else                        other += r.amount;
  });
  const medical = parseFloat(d.medical||0)||0;
  const pfEmp   = parseFloat(d.pfEmployer||0)||0;
  d.calculatedSalary = calc;
  d.basicTotal = basic;
  d.hraTotal   = hra;
  d.otherTotal = other;
  d.gross      = calc;                                  // back-compat
  d.ctcMonthly = calc + medical + pfEmp;
  d.ctcAnnual  = d.ctcMonthly * 12;
  d.net        = calc - Math.round(basic * 0.12);       // employee PF 12% of basic
  _rcOLUpdateSalDisplays();
}

function _rcOLUpdateSalDisplays() {
  const d = _rcOLDraft;
  const f = v => v ? '₹'+Math.round(v).toLocaleString('en-IN') : '—';
  const set = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=f(v); };
  set('ol-calc-disp',  d.calculatedSalary);
  set('ol-basic-disp', d.basicTotal);
  set('ol-hra-disp',   d.hraTotal);
  set('ol-other-disp', d.otherTotal);
  set('ol-ctc-disp2',  d.ctcMonthly);
  (d.salRows||[]).forEach((r,i)=>{ const e=document.getElementById('sal-amt-'+i); if(e) e.textContent=f(r.amount); });
}

function _rcOLRenderSalTable() {
  const tb = document.getElementById('ol-sal-tbody'); if (!tb) return;
  const rows = _rcOLDraft.salRows || [];
  const nDesigned = _RC_SAL_COMPONENTS.length;
  tb.innerHTML = rows.map((r,i) => {
    const designed = i < nDesigned;
    const amt = Math.round(r.amount||0);
    const inp = 'padding:2px 5px;border:1px solid var(--border);border-radius:5px;font-size:.74rem;background:var(--surface1);color:var(--txt1)';
    const sel = 'font-size:.72rem;padding:1px 3px;border:1px solid var(--border);border-radius:5px;background:var(--surface1);color:var(--txt1)';
    const nameCell = designed
      ? `<td style="padding:3px 8px">${escapeHtml_(r.name||'')}</td>`
      : `<td style="padding:2px 8px"><input value="${escapeHtml_(r.name||'')}" oninput="_rcOLSalName(${i},this.value)" placeholder="Element name" style="width:100%;${inp}"></td>`;
    const grpCell = `<td style="padding:2px 6px"><select onchange="_rcOLSalGroup(${i},this.value)" ${designed?'':'disabled'} style="${sel}"><option value="Basic" ${r.group==='Basic'?'selected':''}>Basic</option><option value="HRA" ${r.group==='HRA'?'selected':''}>HRA</option><option value="Other" ${(r.group!=='Basic'&&r.group!=='HRA')?'selected':''}>Other Allowance</option></select></td>`;
    const basisCell = `<td style="padding:2px 6px"><select onchange="_rcOLSalBasis(${i},this.value)" style="${sel}"><option value="pct" ${r.basis==='pct'?'selected':''}>%</option><option value="flat" ${r.basis==='flat'?'selected':''}>Flat ₹</option></select></td>`;
    const valCell = `<td style="padding:2px 6px;text-align:right"><input type="number" value="${r.value!=null?r.value:''}" oninput="_rcOLSalVal(${i},this.value)" style="width:70px;text-align:right;${inp}">${r.basis==='pct'?' %':''}</td>`;
    const amtCell = `<td id="sal-amt-${i}" style="padding:3px 8px;text-align:right">${amt?'₹'+amt.toLocaleString('en-IN'):'—'}</td>`;
    const delCell = `<td style="padding:2px 6px;text-align:center">${designed?'':`<button type="button" onclick="_rcOLSalDel(${i})" title="Remove" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:.85rem">✕</button>`}</td>`;
    return `<tr style="border-bottom:1px solid var(--border)">${nameCell}${grpCell}${basisCell}${valCell}${amtCell}${delCell}</tr>`;
  }).join('');
  _rcOLUpdateSalDisplays();
}

function _rcOLAgreedChange(v){ _rcOLDraft.agreedSalary = v; _rcOLRecalc(); _rcOLPreviewSoon(); }
function _rcOLSalVal(i,v){ if(_rcOLDraft.salRows[i]) _rcOLDraft.salRows[i].value = v; _rcOLRecalc(); _rcOLPreviewSoon(); }
function _rcOLSalName(i,v){ if(_rcOLDraft.salRows[i]) _rcOLDraft.salRows[i].name = v; _rcOLPreviewSoon(); }
function _rcOLSalGroup(i,v){ if(_rcOLDraft.salRows[i]) _rcOLDraft.salRows[i].group = (v==='Basic'?'Basic':(v==='HRA'?'HRA':'Other')); _rcOLRecalc(); _rcOLRenderSalTable(); _rcOLPreviewSoon(); }
function _rcOLSalBasis(i,v){ if(_rcOLDraft.salRows[i]) _rcOLDraft.salRows[i].basis = (v==='flat'?'flat':'pct'); _rcOLRecalc(); _rcOLRenderSalTable(); _rcOLPreviewSoon(); }
function _rcOLSalAdd(){ (_rcOLDraft.salRows = _rcOLDraft.salRows||[]).push({ name:'', group:'Other', basis:'flat', value:'' }); _rcOLRenderSalTable(); _rcOLRecalc(); }
function _rcOLSalDel(i){ if(i >= _RC_SAL_COMPONENTS.length && _rcOLDraft.salRows[i]) { _rcOLDraft.salRows.splice(i,1); _rcOLRenderSalTable(); _rcOLRecalc(); _rcOLPreviewSoon(); } }

function _rcOLUpdatePreview() {
  const map = {
    'ol-refno':'refNo','ol-offerdate':'offerDate','ol-name':'candidateName',
    'ol-address':'address',
    'ol-desig':'position','ol-grade':'grade','ol-dept':'dept','ol-site':'site',
    'ol-company':'company','ol-emptype':'empType','ol-contractperiod':'contractPeriod',
    'ol-starttime':'startTime','ol-endtime':'endTime',
    'ol-doj':'joiningDate','ol-notice':'noticePeriod','ol-valid':'validUntil',
    'ol-probation':'probation','ol-agreed':'agreedSalary','ol-email':'candidateEmail',
    'ol-medical':'medical','ol-pfemployer':'pfEmployer',
  };
  Object.entries(map).forEach(([id,key])=>{ const el=document.getElementById(id); if(el) _rcOLDraft[key]=el.value; });
  // Sync Reports To from hidden field
  const code=document.getElementById('ol-rpt-code'); if(code) _rcOLDraft.reportingToCode=code.value;
  const srch=document.getElementById('ol-rpt-search'); if(srch) _rcOLDraft.reportingTo=srch.value.split(' (')[0].trim();
  _rcOLRecalc();
  const iframe=document.getElementById('ol-preview-iframe');
  if(iframe) iframe.srcdoc=_rcOLPreviewHTML();
}

// Build the offer-letter token map from any offer-like object (live draft or a saved offer)
function _rcOfferTokenMap(d) {
  const agreed = parseFloat(d.agreedSalary||0)||0;
  const rows = (d.salRows||[]);
  const amtOf = r => (r.amount != null) ? Math.round(r.amount)
    : (r.basis==='flat' ? Math.round(parseFloat(r.value)||0) : Math.round(agreed*(parseFloat(r.value)||0)/100));
  const salaryRows = rows.length
    ? rows.map(r => {
        const grp = r.group==='Basic' ? 'Basic' : (r.group==='HRA' ? 'HRA' : 'Other Allowance');
        const a = amtOf(r);
        return `<tr><td>${escapeHtml_(r.name||'')}</td><td style="color:#6a6a70">${grp}</td><td style="text-align:right">${a?'₹'+a.toLocaleString('en-IN'):'—'}</td></tr>`;
      }).join('')
    : `<tr><td colspan="3" style="text-align:center;color:#999">No components</td></tr>`;
  return {
    refNo:       _rcF(d.refNo, '<<Ref No>>'),
    offerDate:   _rcFmtDMY(d.offerDate || new Date().toISOString().slice(0,10)),
    candidateName: _rcF(d.candidateName, 'Name'),
    address: (d.address && String(d.address).trim())
      ? escapeHtml_(String(d.address).trim()).replace(/\n/g,'<br>')
      : (([d.addr1,d.addr2,d.addr3,d.addr4].filter(Boolean).join('\n').trim())
          ? escapeHtml_([d.addr1,d.addr2,d.addr3,d.addr4].filter(Boolean).join('\n')).replace(/\n/g,'<br>')
          : `<span class="ph">Address</span>`),
    position: _rcF(d.position, 'Designation'),
    grade:    _rcF(d.grade, 'Grade'),
    company:  _rcF(d.company || 'Evergreen Enterprises', 'Company'),
    appointmentDate: _rcFmtDMY(d.joiningDate, 'Appointment Date'),
    probation: _rcF(d.probation || '6'),
    agreedSalary: _rcMoney(d.agreedSalary),
    salaryRows,
    basicTotal: _rcMoney(d.basicTotal),
    hraTotal:   _rcMoney(d.hraTotal),
    otherTotal: _rcMoney(d.otherTotal),
    calculatedSalary: _rcMoney(d.calculatedSalary),
    medical: _rcMoney(d.medical), pfEmployer: _rcMoney(d.pfEmployer),
    ctc: _rcMoney(d.ctcMonthly),
  };
}

function _rcOLPreviewHTML() {
  if (!_rcOLTpl) return '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:24px;color:#888">Loading letter template…</body></html>';
  return _fillTemplate(_rcOLTpl, _rcOfferTokenMap(_rcOLDraft));
}

// Re-render and open a previously saved offer letter (read from _rcOffers)
async function _rcOLViewSaved(olId) {
  const o = (_rcOffers||[]).find(x => x.olId === olId);
  if (!o) { alert('Offer not found — try Refresh from Sheet.'); return; }
  let tpl; try { tpl = await _loadHtmlTemplate('offer-letter'); } catch(e){ alert('Could not load the offer letter template.'); return; }
  _rcPrintDoc(_fillTemplate(tpl, _rcOfferTokenMap(o)), `OfferLetter_${(o.candidateName||'Candidate').replace(/\s+/g,'_')}_${o.olId}.pdf`, false);
}


function _rcPrintDoc(html, filename, autoPrint=true){
  const printScript = autoPrint ? '<script>window.onload=function(){window.print()}<\/script>' : '';
  const isFullDoc = /^\s*<(!doctype|html)/i.test(html);
  const doc = isFullDoc
    ? (/<\/body>/i.test(html) ? html.replace(/<\/body>/i, printScript + '</body>') : html + printScript)
    : `<!DOCTYPE html><html><head><title>${filename}</title>
    <style>@media print{body{margin:0}}body{margin:0;font-family:Arial,sans-serif}</style>
    </head><body>${html}${printScript}</body></html>`;
  const w = window.open('','_blank','width=860,height=700');
  w.document.write(doc);
  w.document.close();
}

function _rcOLGeneratePDF() {
  _rcOLUpdatePreview();
  const d = _rcOLDraft;
  if (!d.candidateName) { alert('Fill candidate details first.'); return; }
  _rcPrintDoc(_rcOLPreviewHTML(), `OfferLetter_${(d.candidateName||'Candidate').replace(/\s+/g,'_')}_${d.mrfId||'EVGCPL'}.pdf`);
}

async function _rcALGeneratePDF(jc){
  const row = (_rcJoiningData||[]).find(r => (r['Joining Code']||r['joiningCode']||r['JC'])===jc) || {};
  const offer = (_rcOffers||[]).find(o => o.olId && (o.olId===row['OL ID'] || o.candidateName===(row['Candidate Name']||row['Employee Name']))) || {};
  let tpl; try { tpl = await _loadHtmlTemplate('appointment-letter'); } catch(e){ alert('Could not load the appointment letter template.'); return; }
  const nm = row['Candidate Name']||row['Employee Name']||row['Name']||offer.candidateName||'';
  const map = {
    refNo:     _rcF(row['Appointment Letter Ref'], '<<Ref No>>'),
    offerDate: _rcFmtDMY(row['Appointment Letter Date'] || offer.offerDate || new Date().toISOString().slice(0,10)),
    candidateName: _rcF(nm, 'Name'),
    addr1: _rcF(offer.addr1, 'Address Line 1'),
    addr2: _rcF(offer.addr2, 'Address Line 2'),
    addr3: _rcF(offer.addr3, 'Address Line 3'),
    addr4: _rcF(offer.addr4, 'Address Line 4'),
    position: _rcF(row['Position']||offer.position, 'Designation'),
    grade:    _rcF(offer.grade, 'Grade'),
    company:  'Evergreen Enterprises',
    startTime: _rcF(offer.startTime, 'Start Time'),
    endTime:   _rcF(offer.endTime, 'End Time'),
    appointmentDate: _rcFmtDMY(row['Actual DOJ']||row['Expected DOJ']||offer.joiningDate, 'Appointment Date'),
    probation: _rcF(offer.probation || '6'),
    noticePeriod: _rcF(offer.noticePeriod, 'Notice Period'),
  };
  _rcPrintDoc(_fillTemplate(tpl, map), `AppointmentLetter_${(nm||'Employee').replace(/\s+/g,'_')}_${jc}.pdf`);
}

// Build the offer object from the current draft (no side effects).
function _rcOLBuildOfferRecord(dispatchMethod) {
  const d = _rcOLDraft;
  const year=new Date().getFullYear();
  const seq=String((_rcOffers||[]).filter(o=>o.olId&&o.olId.startsWith('OL-'+year)).length+1).padStart(3,'0');
  const olId=`OL-${year}-${seq}`;
  const now=new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'});
  return {olId,refNo:d.refNo||'',mrfId:d.mrfId||'',candidateName:d.candidateName,position:d.position,site:d.site,ctcAnnual:d.ctcAnnual||((d.gross||0)*12),joiningDate:d.joiningDate,candidateEmail:d.candidateEmail,dispatchMethod,status:'Draft',sentDate:now,basic:d.basic,hra:d.hra,allowances:d.allowances,pf:d.pf,gross:d.gross,net:d.net,probation:d.probation||'6',validUntil:d.validUntil,createdBy:STATE.user?.email||'',createdAt:now,
    offerDate:d.offerDate||'',grade:d.grade||'',department:d.dept||'',address:d.address||'',addr1:d.addr1||'',addr2:d.addr2||'',addr3:d.addr3||'',addr4:d.addr4||'',company:d.company||'',empType:d.empType||'',contractPeriod:d.contractPeriod||'',startTime:d.startTime||'',endTime:d.endTime||'',noticePeriod:d.noticePeriod||'',reportingManager:d.reportingTo||'',da:d.da||'',specialallow:d.specialallow||'',conveyance:d.conveyance||'',education:d.education||'',uniform:d.uniform||'',lta:d.lta||'',siteallow:d.siteallow||'',medical:d.medical||'',pfEmployer:d.pfEmployer||'',ctcMonthly:d.ctcMonthly||'',
    agreedSalary:d.agreedSalary||'',calculatedSalary:d.calculatedSalary||'',basicTotal:d.basicTotal||'',hraTotal:d.hraTotal||'',otherTotal:d.otherTotal||'',salJSON:JSON.stringify(d.salRows||[])};
}

// Apply a saved offer to local state (optimistic) + link the MRF.
function _rcOLApplyLocal(offer) {
  if (!_rcOffers) _rcOffers=[];
  _rcOffers.unshift(offer);
  if (offer.mrfId) { const mrf=(_rcMRFs||[]).find(m=>m.id===offer.mrfId); if(mrf){mrf.offerSent=offer.olId; _rcPersist();} }
}

// POST that AWAITS and returns the backend's parsed JSON {success, ...}.
async function _rcPostActionAwait(payload) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method:'POST', headers:{'Content-Type':'text/plain'},
    body: JSON.stringify({ ...payload, sheetId: RECRUITMENT_SHEET_ID })
  });
  try { return await res.json(); }
  catch(e) { return { success:false, message:`Backend returned a non-JSON response (HTTP ${res.status}). Check the Apps Script deployment.` }; }
}

async function _rcOLSaveOffer() {
  _rcOLUpdatePreview();
  const d = _rcOLDraft;
  if (!d.candidateName||!d.position) { alert('Candidate name and designation are required.'); return; }
  const offer = _rcOLBuildOfferRecord('Saved');
  _showRcToast('💾 Saving offer…');
  let resp;
  try { resp = await _rcPostActionAwait({action:'saveOffer', offer}); }
  catch(e) { alert('Save failed — could not reach the backend:\n'+e.message); return; }
  if (!resp || resp.success === false) {
    alert('Save failed — backend did not accept it:\n'+((resp&&resp.message)||'unknown error')+'\n\n(Check that the main Apps Script /exec is deployed with the recruitment routes.)');
    return;
  }
  if (resp.olId) offer.olId = resp.olId;
  _rcOLApplyLocal(offer);
  _rcOLDraft={};
  _rcOLSubTab('tracker');
  _showRcToast(`✅ Offer saved to sheet — ${offer.olId}`);
  _rcResyncOffers(offer);
}

// Re-fetch offers from the sheet after a write so the portal mirrors the backend.
// Keeps the just-saved offer visible if the GET races the append.
function _rcResyncOffers(keepOffer) {
  setTimeout(() => {
    _rcLoadOffers(true).then(() => {
      if (keepOffer && !(_rcOffers||[]).some(o => o.olId === keepOffer.olId)) {
        (_rcOffers = _rcOffers || []).unshift(keepOffer);
      }
      const sub = document.getElementById('rc-ol-sub');
      if (sub) _rcDrawOLTracker(sub);
    }).catch(()=>{});
  }, 2000);
}

// ═══ Phase 2 — approval / lifecycle handlers ═══════════════════════
function _rcNow(){ return new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}); }
function _rcMe(){ return STATE.user?.email || ''; }

// From the form: save current draft, then mark Pending Approval in one go.
async function _rcOLSendForApproval() {
  _rcOLUpdatePreview();
  const d = _rcOLDraft;
  if (!d.candidateName||!d.position) { alert('Candidate name and designation are required.'); return; }
  const offer = _rcOLBuildOfferRecord('Saved');
  _showRcToast('📤 Submitting for MD approval…');
  let resp;
  try { resp = await _rcPostActionAwait({action:'saveOffer', offer}); }
  catch(e){ alert('Could not reach the backend:\n'+e.message); return; }
  if (!resp || resp.success === false) { alert('Save failed: '+((resp&&resp.message)||'unknown error')); return; }
  if (resp.olId) offer.olId = resp.olId;
  const now = _rcNow(), me = _rcMe();
  const up = await _rcPostActionAwait({ action:'updateOfferStatus', olId:offer.olId, status:'Pending Approval', fields:{'Submitted For Approval At':now,'Submitted By':me} });
  if (!up || up.success===false) { alert('Saved but could not flag for approval:\n'+((up&&up.message)||'unknown error')); return; }
  offer.status='Pending Approval'; offer.submittedAt=now; offer.submittedBy=me;
  _rcOLApplyLocal(offer);
  _rcOLDraft={};
  _rcOLSubTab('tracker');
  _showRcToast(`📤 Sent to MD for approval — ${offer.olId}`);
  _rcResyncOffers(offer);
}

// Tracker action — submit an existing Draft offer for approval (no form involved).
async function _rcOLSendForApprovalById(olId) {
  const offer = (_rcOffers||[]).find(o=>o.olId===olId); if (!offer) return;
  const now = _rcNow(), me = _rcMe();
  const resp = await _rcPostActionAwait({ action:'updateOfferStatus', olId, status:'Pending Approval', fields:{'Submitted For Approval At':now,'Submitted By':me} });
  if (!resp || resp.success===false) { alert('Send for Approval failed: '+((resp&&resp.message)||'')); return; }
  offer.status='Pending Approval'; offer.submittedAt=now; offer.submittedBy=me;
  _rcDrawOLTracker(document.getElementById('rc-ol-sub'));
  _showRcToast(`📤 Sent to MD for approval — ${olId}`);
}

async function _rcOLApprove(olId) {
  if (STATE.role !== 'md') { alert('Only the MD can approve offers.'); return; }
  const offer = (_rcOffers||[]).find(o=>o.olId===olId); if (!offer) return;
  const now = _rcNow(), me = _rcMe();
  const acceptBy = offer.validUntil || '';
  const resp = await _rcPostActionAwait({ action:'updateOfferStatus', olId, status:'Released', fields:{'Approved By':me,'Approved At':now,'Accept By':acceptBy} });
  if (!resp || resp.success===false) { alert('Approve failed: '+((resp&&resp.message)||'')); return; }
  offer.status='Released'; offer.approvedBy=me; offer.approvedAt=now; offer.acceptBy=acceptBy;
  _rcDrawOLTracker(document.getElementById('rc-ol-sub'));
  _showRcToast(`✅ Approved & released — ${olId}`);
}

async function _rcOLReject(olId) {
  if (STATE.role !== 'md') { alert('Only the MD can reject offers.'); return; }
  const reason = prompt('Reason for rejection (optional):',''); if (reason === null) return;
  const resp = await _rcPostActionAwait({ action:'updateOfferStatus', olId, status:'Declined', fields:{'Decline Reason':reason||'Rejected by MD'} });
  if (!resp || resp.success===false) { alert('Reject failed: '+((resp&&resp.message)||'')); return; }
  const o = (_rcOffers||[]).find(x=>x.olId===olId); if (o){ o.status='Declined'; o.declineReason=reason; }
  _rcDrawOLTracker(document.getElementById('rc-ol-sub'));
  _showRcToast(`❌ Rejected — ${olId}`);
}

async function _rcOLMarkAccepted(olId) {
  const offer = (_rcOffers||[]).find(o=>o.olId===olId); if (!offer) return;
  const now = _rcNow();
  const resp = await _rcPostActionAwait({ action:'updateOfferStatus', olId, status:'Accepted', fields:{'Accepted At':now} });
  if (!resp || resp.success===false) { alert('Mark Accepted failed: '+((resp&&resp.message)||'')); return; }
  offer.status='Accepted'; offer.acceptedAt=now;
  if (offer.mrfId) { const mrf=(_rcMRFs||[]).find(m=>m.id===offer.mrfId); if(mrf) _rcUpdateStatus(offer.mrfId,'Closed – Filled'); }
  _rcDrawOLTracker(document.getElementById('rc-ol-sub'));
  _showRcToast(`✅ Offer accepted — ${olId}`);
}

async function _rcOLMarkDeclined(olId) {
  const reason = prompt('Reason for decline (optional):',''); if (reason === null) return;
  const resp = await _rcPostActionAwait({ action:'updateOfferStatus', olId, status:'Declined', fields:{'Decline Reason':reason||'Declined by candidate'} });
  if (!resp || resp.success===false) { alert('Mark Declined failed: '+((resp&&resp.message)||'')); return; }
  const o = (_rcOffers||[]).find(x=>x.olId===olId); if (o){ o.status='Declined'; o.declineReason=reason; }
  _rcDrawOLTracker(document.getElementById('rc-ol-sub'));
  _showRcToast(`❌ Declined — ${olId}`);
}

// Email the offer letter to the candidate from the tracker (Released offers only).
async function _rcOLEmailFromTracker(olId) {
  const o = (_rcOffers||[]).find(x=>x.olId===olId); if (!o) { alert('Offer not found.'); return; }
  if (!(o.status==='Released' || o.status==='Accepted')) { alert('Email is available only after MD approval (Released).'); return; }
  const email = (o.candidateEmail||'').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { alert('Saved offer is missing a valid Candidate Email.'); return; }
  let tpl; try { tpl = await _loadHtmlTemplate('offer-letter'); } catch(e){ alert('Could not load the offer letter template.'); return; }
  const html = _fillTemplate(tpl, _rcOfferTokenMap(o));
  _rcPostAction({ action:'sendOfferEmail', to:email, candidateName:o.candidateName, position:o.position, olId:o.olId, html });
  _showRcToast(`📧 Emailing offer to ${email}`);
}

async function _rcOLEmailOffer() {
  _rcOLUpdatePreview();
  const d = _rcOLDraft;
  if (!d.candidateName||!d.position) { alert('Candidate name and designation are required.'); return; }
  const email = (d.candidateEmail||'').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { alert('Enter a valid Candidate Email before emailing the offer.'); return; }
  const html = _rcOLPreviewHTML();
  const offer = _rcOLBuildOfferRecord('Email');
  _showRcToast('📧 Saving & emailing…');
  let resp;
  try { resp = await _rcPostActionAwait({action:'saveOffer', offer}); }
  catch(e){ alert('Could not reach the backend:\n'+e.message); return; }
  if (!resp || resp.success === false) { alert('Save failed — backend did not accept it:\n'+((resp&&resp.message)||'unknown error')); return; }
  if (resp.olId) offer.olId = resp.olId;
  _rcPostAction({ action:'sendOfferEmail', to:email, candidateName:d.candidateName, position:d.position, olId:offer.olId, html });
  _rcOLApplyLocal(offer);
  _rcOLDraft={};
  _rcOLSubTab('tracker');
  _showRcToast(`📧 Offer saved & emailed to ${email} — ${offer.olId}`);
  _rcResyncOffers(offer);
}

function _rcDrawOLTracker(container) {
  const offers = _rcOffers||[];
  const isMD = STATE.role === 'md';
  const today = new Date().toISOString().slice(0,10);
  const displayStatus = o => {
    if ((o.status==='Released' || o.status==='Sent') && o.acceptBy && o.acceptBy < today) return 'Expired';
    return o.status || 'Draft';
  };
  // Default filter: MD lands on Pending Approval, everyone else on All
  if (!_rcOLStatusFilter) _rcOLStatusFilter = isMD ? 'Pending Approval' : 'All';
  const fStatus = _rcOLStatusFilter;
  const countBy = s => offers.filter(o => displayStatus(o)===s).length;
  const visible = (fStatus==='All') ? offers : offers.filter(o => displayStatus(o)===fStatus);
  const sc = {
    'Draft':            ['#6b7280','#f3f4f6'],
    'Pending Approval': ['#d97706','#fffbeb'],
    'Released':         ['#2563eb','#eff6ff'],
    'Sent':             ['#2563eb','#eff6ff'],  // legacy
    'Saved':            ['#2563eb','#eff6ff'],  // legacy
    'Accepted':         ['#16a34a','#f0fdf4'],
    'Declined':         ['#dc2626','#fef2f2'],
    'Expired':          ['#6b7280','#f9fafb'],
  };
  const chips = ['All','Draft','Pending Approval','Released','Accepted','Declined','Expired'];
  const chipRow = chips.map(s => {
    const active = s===fStatus;
    const n = s==='All' ? offers.length : countBy(s);
    return `<button onclick="_rcOLSetStatusFilter('${s}')" style="font-size:.72rem;padding:3px 11px;border-radius:20px;border:1px solid ${active?'#1A6038':'var(--border)'};background:${active?'#1A6038':'var(--surface1)'};color:${active?'#fff':'var(--txt2)'};cursor:pointer;font-weight:${active?'600':'400'}">${s}${n?' ('+n+')':''}</button>`;
  }).join('');
  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;gap:.5rem;flex-wrap:wrap">
      <div style="font-size:.75rem;color:var(--txt3)">${isMD?'<strong style="color:#d97706">MD view</strong> · approve or reject pending offers':'<strong>Recruiter view</strong> · Draft → Send for Approval → MD approves → Released'}</div>
      <button class="btn btn-sm btn-secondary" onclick="_rcLoadOffers(true).then(()=>_rcDrawOLTracker(document.getElementById('rc-ol-sub')))">↻ Refresh from Sheet</button>
    </div>
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.7rem">${chipRow}</div>
    <div style="overflow-x:auto;border-radius:10px;border:1px solid var(--border)">
    <table class="emp-table" style="min-width:920px">
      <thead><tr><th>OL ID</th><th>MRF</th><th>Candidate</th><th>Position</th><th>Site</th><th>CTC</th><th>Joining</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${visible.length===0?`<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--txt3)">${fStatus==='All'?'No offers yet.':'No offers in '+fStatus+'.'}</td></tr>`:
      visible.map(o=>{
        const st = displayStatus(o);
        const [c,bg] = sc[st] || ['#6b7280','#f9fafb'];
        const btn = (fn,label,color) => `<button class="btn btn-sm btn-secondary" onclick="${fn}('${o.olId}')" style="font-size:.7rem;padding:2px 7px${color?';color:'+color:''}">${label}</button>`;
        const actions = [btn('_rcOLViewSaved','📄 View')];
        if (st === 'Draft')                            actions.push(btn('_rcOLSendForApprovalById','📤 Send for Approval'));
        if (st === 'Pending Approval' && isMD)        { actions.push(btn('_rcOLApprove','✓ Approve','#16a34a')); actions.push(btn('_rcOLReject','✗ Reject','#dc2626')); }
        if (st === 'Released' || st === 'Sent' || st === 'Saved') {
          actions.push(btn('_rcOLEmailFromTracker','📧 Email'));
          actions.push(btn('_rcOLMarkAccepted','✓ Accepted','#16a34a'));
          actions.push(btn('_rcOLMarkDeclined','✗ Declined','#dc2626'));
        }
        return `<tr>
          <td style="font-family:monospace;font-size:.73rem;color:var(--g7)">${o.olId}</td>
          <td style="font-size:.74rem">${o.mrfId||'—'}</td>
          <td style="font-weight:500">${o.candidateName}</td>
          <td style="font-size:.77rem">${o.position}</td>
          <td style="font-size:.77rem">${o.site||'—'}</td>
          <td style="font-size:.77rem">₹${Number(o.ctcAnnual||0).toLocaleString('en-IN')}</td>
          <td style="font-size:.75rem">${o.joiningDate||'—'}</td>
          <td><span style="font-size:.71rem;padding:2px 8px;border-radius:20px;background:${bg};color:${c}">${st}</span></td>
          <td style="white-space:nowrap"><div style="display:flex;gap:4px;flex-wrap:wrap">${actions.join('')}</div></td>
        </tr>`;
      }).join('')}
      </tbody>
    </table></div>`;
  setTimeout(()=>{const t=container.querySelector('.emp-table');if(t){makeTableSortable(t);wrapTableScroll(t);}},80);
}

function _rcOLUpdateStatus(olId,status) {
  const offer=(_rcOffers||[]).find(o=>o.olId===olId);
  if(!offer) return;
  offer.status=status;
  offer.acceptanceDate=new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'});
  _rcPostAction({action:'updateOfferStatus',olId,status});
  if(status==='Accepted'&&offer.mrfId){const mrf=(_rcMRFs||[]).find(m=>m.id===offer.mrfId);if(mrf)_rcUpdateStatus(offer.mrfId,'Closed – Filled');}
  _rcDrawOLTracker(document.getElementById('rc-ol-sub'));
  _showRcToast(status==='Accepted'?'✅ Accepted — move to Pre-Joining tab':'❌ Offer declined');
}

// ══════════════════════════════════════════════════════════════
//  PRE-JOINING CHECKLIST TAB  (Session 9)
// ══════════════════════════════════════════════════════════════
const RC_PJ_ITEMS=[
  {id:'pj1',label:'Education certificates collected',owner:'HR'},
  {id:'pj2',label:'Previous employment proof collected',owner:'HR'},
  {id:'pj3',label:'ID proof (Aadhaar, PAN) collected',owner:'HR'},
  {id:'pj4',label:'Bank account details received',owner:'HR'},
  {id:'pj5',label:'Background verification initiated',owner:'HR'},
  {id:'pj6',label:'Signed offer letter copy received',owner:'HR'},
  {id:'pj7',label:'Site / accommodation arranged',owner:'Site / RM'},
  {id:'pj8',label:'Reporting manager informed',owner:'HR'},
  {id:'pj9',label:'EmpCode allocated',owner:'HR'},
  {id:'pj10',label:'Work email / portal login created',owner:'IT / HR'},
];
let _rcPJState={};

function _rcRenderPreJoining() {
  const panel=document.getElementById('rc-panel');
  panel.innerHTML=`<div style="text-align:center;padding:2rem;color:var(--txt3)">⏳ Loading…</div>`;
  _rcLoadOffers().then(()=>_rcDrawPreJoiningTab());
}

function _rcDrawPreJoiningTab() {
  const panel=document.getElementById('rc-panel');
  const accepted=(_rcOffers||[]).filter(o=>o.status==='Accepted');
  if(!accepted.length){
    panel.innerHTML=`<div class="card card-pad" style="text-align:center;padding:3rem">
      <div style="font-size:2rem;margin-bottom:.6rem">☑️</div>
      <h3 style="color:var(--g7);margin-bottom:.4rem">No accepted offers yet</h3>
      <p style="color:var(--txt3);font-size:.82rem">Candidates appear here once their offer is accepted.</p>
      <button class="btn btn-secondary btn-sm" onclick="_rcSwitchTab('offer-letters')" style="margin-top:1rem">← Offer Letters</button>
    </div>`;
    return;
  }
  panel.innerHTML=`<p style="font-size:.79rem;color:var(--txt3);margin-bottom:1rem">Complete all 10 items before creating a joining entry.</p><div id="rc-pj-list"></div>`;
  const list=document.getElementById('rc-pj-list');
  accepted.forEach(offer=>{
    if(!_rcPJState[offer.olId]) _rcPJState[offer.olId]={};
    const state=_rcPJState[offer.olId];
    const checked=RC_PJ_ITEMS.filter(i=>state[i.id]?.checked).length;
    const allDone=checked===RC_PJ_ITEMS.length;
    const card=document.createElement('div');
    card.className='card card-pad';
    card.style.marginBottom='1rem';
    card.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.8rem;flex-wrap:wrap;gap:.5rem">
        <div>
          <span style="font-weight:700;font-size:.9rem;color:var(--txt1)">${offer.candidateName}</span>
          <span style="font-size:.75rem;color:var(--txt3);margin-left:.5rem">${offer.position} · ${offer.site||'—'} · ${offer.olId}</span>
        </div>
        <div style="display:flex;align-items:center;gap:.7rem">
          <span style="font-size:.78rem;color:${allDone?'#16a34a':'#d97706'};font-weight:600">${checked}/10</span>
          <button onclick="_rcPJCreateJoining('${offer.olId}','${offer.candidateName}','${offer.mrfId||''}','${offer.position||''}','${offer.site||''}')"
            ${allDone?'':'disabled'}
            style="padding:.35rem .9rem;background:${allDone?'#16a34a':'#ccc'};color:#fff;border:none;border-radius:8px;font-size:.78rem;font-weight:600;cursor:${allDone?'pointer':'not-allowed'}">
            ${allDone?'🎯 Create Joining Entry':'⏳ '+(10-checked)+' left'}
          </button>
        </div>
      </div>
      <div style="height:5px;background:var(--border);border-radius:3px;margin-bottom:.8rem">
        <div style="width:${checked*10}%;height:5px;background:#16a34a;border-radius:3px;transition:width .3s"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.3rem .8rem">
        ${RC_PJ_ITEMS.map(item=>{
          const st=state[item.id]||{};
          return`<label style="display:flex;align-items:flex-start;gap:.5rem;padding:.3rem 0;cursor:pointer;border-bottom:1px solid var(--border)">
            <input type="checkbox" ${st.checked?'checked':''} onchange="_rcPJToggle('${offer.olId}','${item.id}',this.checked,'${offer.candidateName}')"
              style="margin-top:2px;flex-shrink:0;accent-color:#1A6038">
            <div>
              <div style="font-size:.79rem;color:${st.checked?'var(--txt3)':'var(--txt1)'};${st.checked?'text-decoration:line-through':''}">${item.label}</div>
              <div style="font-size:.69rem;color:var(--txt3)">${item.owner}${st.date?' · '+st.date.split(',')[0]:''}</div>
            </div>
          </label>`;
        }).join('')}
      </div>`;
    list.appendChild(card);
  });
}

function _rcPJToggle(olId,itemId,checked,candidateName) {
  if(!_rcPJState[olId]) _rcPJState[olId]={};
  _rcPJState[olId][itemId]={checked,date:checked?new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):''};
  _rcPostAction({action:'savePreJoining',joiningCode:olId,itemId,checked,checkedBy:STATE.user?.name||STATE.user?.email||'',candidateName});
  _rcDrawPreJoiningTab();
}

async function _rcPJCreateJoining(olId,candidateName,mrfId,position,site) {
  const doj=prompt(`Actual joining date for ${candidateName} (YYYY-MM-DD):`,new Date().toISOString().slice(0,10));
  if(!doj) return;
  await _rcLoadJoiningData(true);
  const existing=_rcJoiningData||[];
  const maxNJC=existing.reduce((mx,row)=>{
    const jc=row['Joining Code']||'';
    const num=parseInt((jc.match(/NJC-(\d+)/i)||[])[1]||'0');
    return Math.max(mx,num);
  },0);
  const joiningCode=`NJC-${maxNJC+1}`;
  _rcPostAction({action:'createJoiningEntry',joiner:{joiningCode,path:'A',mrfId:mrfId||'',olId,name:candidateName,position:position||'',site:site||'',expectedDOJ:doj,createdBy:STATE.user?.email||''}});
  if(!_rcJoiningData) _rcJoiningData=[];
  _rcJoiningData.unshift({'Joining Code':joiningCode,'Type':'Formal Recruitment','Status':'Pending','Employee Name':candidateName,'Position':position,'Site':site,'Expected DOJ':doj});
  _showRcToast(`🎯 Joining entry created — ${joiningCode}`);
  _rcSwitchTab('joining');
}

// ══════════════════════════════════════════════════════════════
//  JOINING TAB  (Session 10)
// ══════════════════════════════════════════════════════════════
function _rcRenderJoining() {
  const panel=document.getElementById('rc-panel');
  panel.innerHTML=`<div style="text-align:center;padding:2rem;color:var(--txt3)">⏳ Loading joining list…</div>`;
  _rcLoadJoiningData(true).then(()=>_rcDrawJoiningTab());
}

function _rcDrawJoiningTab() {
  const panel=document.getElementById('rc-panel');
  const joiners=_rcJoiningData||[];
  const sc={'Pending':['#d97706','#fffbeb'],'Pre-Joining':['#2563eb','#eff6ff'],'Joined Directly':['#6b7280','#f9fafb'],'Joined':['#16a34a','#f0fdf4'],'Active':['#059669','#ecfdf5'],'Formal Recruitment':['#7c3aed','#f5f3ff']};
  const counts={};
  joiners.forEach(j=>{const s=j['Type']||j['Status']||'—'; counts[s]=(counts[s]||0)+1;});
  const fStatus=document.getElementById('rc-jl-fs')?.value||'All';
  const fQ=(document.getElementById('rc-jl-fq')?.value||'').toLowerCase();
  const allS=['All',...Object.keys(counts)];
  let filtered=joiners;
  if(fStatus!=='All') filtered=filtered.filter(j=>(j['Type']||j['Status']||'')===fStatus);
  if(fQ) filtered=filtered.filter(j=>Object.values(j).some(v=>String(v||'').toLowerCase().includes(fQ)));
  const onbCount=joiners.filter(j=>j['Onboarding Status']==='Pending HR').length;
  if(_rcJLOnbFilter) filtered=filtered.filter(j=>j['Onboarding Status']==='Pending HR');
  const s0=joiners[0]||{};
  const nameCol=['Employee Name','Candidate Name','Name'].find(k=>k in s0)||'Employee Name';
  const jcCol=['Joining Code','joiningCode','JC'].find(k=>k in s0)||'Joining Code';
  const typeCol=['Type','Path','type'].find(k=>k in s0)||'Type';
  const siteCol=['Site','site','Site Name'].find(k=>k in s0)||'Site';
  const dojCol=['Actual DOJ','Expected DOJ','DOJ','Date of Joining'].find(k=>k in s0)||'Expected DOJ';
  const ecCol=['EmpCode','Employee Code','Emp Code'].find(k=>k in s0)||'EmpCode';
  const statCol=['Status','status'].find(k=>k in s0)||'Status';
  panel.innerHTML=`
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem">
      ${Object.entries(counts).map(([s,c])=>{const[col,bg]=sc[s]||['#6b7280','#f9fafb'];return`<span style="font-size:.73rem;padding:2px 10px;border-radius:20px;background:${bg};color:${col};font-weight:600">${s}: ${c}</span>`;}).join('')}
    </div>
    <div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:.9rem;align-items:center">
      <select id="rc-jl-fs" onchange="_rcDrawJoiningTab()" style="font-size:.78rem;padding:.35rem .6rem;border:1px solid var(--border);border-radius:8px;background:var(--surface1);color:var(--txt1)">
        ${allS.map(s=>`<option${fStatus===s?' selected':''}>${s}</option>`).join('')}
      </select>
      <input id="rc-jl-fq" value="${fQ}" oninput="_rcDrawJoiningTab()" placeholder="Search name, code, site…"
        style="font-size:.78rem;padding:.35rem .7rem;border:1px solid var(--border);border-radius:8px;background:var(--surface1);color:var(--txt1);min-width:200px">
      <button onclick="_rcJLToggleOnbFilter()" style="font-size:.73rem;padding:3px 11px;border-radius:20px;border:1px solid ${_rcJLOnbFilter?'#c2410c':'var(--border)'};background:${_rcJLOnbFilter?'#fff7ed':'var(--surface1)'};color:${_rcJLOnbFilter?'#c2410c':'var(--txt2)'};cursor:pointer;font-weight:${_rcJLOnbFilter?'600':'400'}">🤝 Pending HR Onboarding${onbCount?' ('+onbCount+')':''}</button>
      <button class="btn btn-sm btn-secondary" onclick="_rcLoadJoiningData(true).then(()=>_rcDrawJoiningTab())">↻ Refresh</button>
      <span style="font-size:.73rem;color:var(--txt3);margin-left:auto">${filtered.length} of ${joiners.length}</span>
    </div>
    <div style="overflow-x:auto;border-radius:10px;border:1px solid var(--border)">
      <table class="emp-table" style="min-width:880px">
        <thead><tr><th>Joining Code</th><th>Name</th><th>Type</th><th>Site</th><th>DOJ</th><th>EmpCode</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${filtered.length===0?`<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--txt3)">No records.</td></tr>`:
          filtered.map(j=>{
            const type=j[typeCol]||'—';
            const status=j[statCol]||type;
            const [c,bg]=sc[status]||sc[type]||['#6b7280','#f9fafb'];
            const jc=j[jcCol]||'—';
            const ec=j[ecCol]||'—';
            const isPathA=(type||'').toLowerCase().includes('formal')||(type||'').toLowerCase().includes('recruit');
            const canMark=['Pending','Pre-Joining'].includes(status)&&isPathA;
            const canAssign=status==='Joined'&&(!ec||ec==='—');
            return`<tr>
              <td style="font-family:monospace;font-size:.73rem;color:var(--g7)">${jc}</td>
              <td style="font-weight:500">${j[nameCol]||'—'}</td>
              <td style="font-size:.74rem">${type}</td>
              <td style="font-size:.77rem">${j[siteCol]||'—'}</td>
              <td style="font-size:.75rem">${j[dojCol]||'—'}</td>
              <td style="font-family:monospace;font-size:.74rem;color:var(--g7)">${ec}</td>
              <td><span style="font-size:.71rem;padding:2px 8px;border-radius:20px;background:${bg};color:${c};white-space:nowrap">${status}</span>${j['Onboarding Status']==='Pending HR'?'<span title="HR onboarding triggered" style="display:inline-block;margin-left:4px;font-size:.65rem;padding:1px 6px;border-radius:20px;background:#fff7ed;color:#c2410c;font-weight:600;white-space:nowrap">🤝 HR</span>':''}</td>
              <td style="white-space:nowrap;display:flex;gap:4px;flex-wrap:wrap">
                ${canMark?`<button onclick="_rcJLMarkJoined('${jc}','${j[nameCol]||''}')" style="padding:2px 7px;background:#16a34a;color:#fff;border:none;border-radius:6px;font-size:.71rem;cursor:pointer">🎯 Mark Joined</button>`:''}
                ${canAssign?`<button onclick="_rcJLAssignEC('${jc}','${j[nameCol]||''}')" class="btn btn-sm btn-secondary" style="font-size:.71rem;padding:2px 7px">Assign EmpCode</button>`:''}
                ${['Joined','Active'].includes(status)?`<button onclick="_rcJLApptLetter('${jc}','${j[nameCol]||''}')" class="btn btn-sm btn-secondary" style="font-size:.71rem;padding:2px 7px">📋 Appt Letter</button>`:''}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div id="rc-jl-appt-panel"></div>`;
  setTimeout(()=>{const t=panel.querySelector('.emp-table');if(t){makeTableSortable(t);wrapTableScroll(t);}},80);
}

function _rcJLMarkJoined(jc,name) {
  const doj=prompt(`Confirm actual joining date for ${name}:`,new Date().toISOString().slice(0,10));
  if(!doj) return;
  _rcPostAction({action:'markAsJoined',joiningCode:jc,actualDOJ:doj});
  _showRcToast(`✅ ${name} marked as Joined`);
  _rcLoadJoiningData(true).then(()=>_rcDrawJoiningTab());
}

function _rcJLAssignEC(jc,name) {
  const code=prompt(`Enter EmpCode for ${name}:`);
  if(!code||!code.trim()) return;
  _rcPostAction({action:'assignEmpCode',joiningCode:jc,empCode:code.trim()});
  _showRcToast(`🪪 EmpCode ${code.trim()} assigned`);
  _rcLoadJoiningData(true).then(()=>_rcDrawJoiningTab());
}

function _rcJLApptLetter(jc,name) {
  const p=document.getElementById('rc-jl-appt-panel');
  if(!p) return;
  p.innerHTML=`<div class="card card-pad" style="margin-top:1rem;border-left:3px solid var(--g7)">
    <div style="font-weight:600;margin-bottom:.8rem;color:var(--g7)">📋 Appointment Letter — ${name} (${jc})</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.7rem">
      <div><label style="font-size:.74rem;font-weight:600;color:var(--txt2)">Letter Ref No.</label>
        <input id="al-ref" placeholder="e.g. EVGCPL/HR/2026/001" style="width:100%;margin-top:.2rem;padding:.4rem .6rem;border:1px solid var(--border);border-radius:8px;font-size:.8rem;background:var(--surface1);color:var(--txt1)"></div>
      <div><label style="font-size:.74rem;font-weight:600;color:var(--txt2)">Date Issued</label>
        <input id="al-date" type="date" value="${new Date().toISOString().slice(0,10)}" style="width:100%;margin-top:.2rem;padding:.4rem .6rem;border:1px solid var(--border);border-radius:8px;font-size:.8rem;background:var(--surface1);color:var(--txt1)"></div>
      <div><label style="font-size:.74rem;font-weight:600;color:var(--txt2)">Signed Copy Received</label>
        <select id="al-signed" style="width:100%;margin-top:.2rem;padding:.4rem .6rem;border:1px solid var(--border);border-radius:8px;font-size:.8rem;background:var(--surface1);color:var(--txt1)"><option>No</option><option>Yes</option></select></div>
    </div>
    <div style="margin-top:.8rem;display:flex;gap:.6rem;flex-wrap:wrap">
      <button onclick="_rcJLSaveAL('${jc}','${name}')" class="btn btn-primary btn-sm">Save Record</button>
      <button onclick="_rcALGeneratePDF('${jc}')" class="btn btn-secondary btn-sm">🖨 Generate Letter</button>
      <button onclick="_rcJLTriggerOnboarding('${jc}','${name}')" style="padding:.35rem .9rem;background:#1A6038;color:#fff;border:none;border-radius:8px;font-size:.79rem;font-weight:600;cursor:pointer">🤝 Issue Letter &amp; Trigger HR Onboarding</button>
      <button onclick="document.getElementById('rc-jl-appt-panel').innerHTML=''" class="btn btn-secondary btn-sm">Cancel</button>
    </div>
  </div>`;
  p.scrollIntoView({behavior:'smooth'});
}

function _rcJLSaveAL(jc,name) {
  const ref=document.getElementById('al-ref')?.value||'';
  const date=document.getElementById('al-date')?.value||'';
  const signed=document.getElementById('al-signed')?.value||'No';
  _rcPostAction({action:'updateApptLetter',joiningCode:jc,ref,date,signed,updatedBy:STATE.user?.email||''});
  _showRcToast(`📋 Appointment Letter record saved for ${name}`);
  document.getElementById('rc-jl-appt-panel').innerHTML='';
}

// Phase 3 — saves the appointment letter ref/date and flags the joining row
// "Pending HR" so HR picks it up for onboarding (EmpCode, masters, accommodation/site/mess).
async function _rcJLTriggerOnboarding(jc, name) {
  const ref    = document.getElementById('al-ref')?.value || '';
  const date   = document.getElementById('al-date')?.value || '';
  const signed = document.getElementById('al-signed')?.value || 'No';
  _showRcToast('🤝 Triggering HR onboarding…');
  let resp;
  try {
    resp = await _rcPostActionAwait({
      action:'updateApptLetter',
      joiningCode: jc, ref, date, signed,
      updatedBy: STATE.user?.email || '',
      triggerOnboarding: true,
    });
  } catch(e) { alert('Could not reach the backend:\n'+e.message); return; }
  if (!resp || resp.success === false) { alert('Trigger failed: '+((resp&&resp.message)||'unknown error')); return; }
  // Update local row optimistically
  const row = (_rcJoiningData||[]).find(r => (r['Joining Code']||r['joiningCode'])===jc);
  if (row) {
    row['Onboarding Triggered At'] = new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'});
    row['Onboarding Triggered By'] = STATE.user?.email || '';
    row['Onboarding Status']       = 'Pending HR';
    if (ref)    row['Appointment Letter Ref']  = ref;
    if (date)   row['Appointment Letter Date'] = date;
    if (signed) row['Signed Copy Received']    = signed;
  }
  document.getElementById('rc-jl-appt-panel').innerHTML='';
  _rcDrawJoiningTab();
  _showRcToast(`✅ ${name}: appointment letter issued & HR onboarding triggered`);
}
