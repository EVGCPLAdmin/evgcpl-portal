/* ═══════════════════════════════════════════════════════════════════
   EVGCPL Portal — API Module
   /assets/js/api.js
   - fetchSheet (gviz JSONP, fallback to fetch+CSV)
   - apps script POST helper
   - sheet sharing diagnostic (real HTTP status detection)
   ═══════════════════════════════════════════════════════════════════ */

window.API = (function() {
  'use strict';

  // ── Constants (override per environment if needed) ────────────
  const APPS_SCRIPT_URL =
    'https://script.google.com/macros/s/AKfycbxajuscM46AlJe2iMtDg0nJjfuzidEZwnOy_o2TZXQIbh_e2hGu79CNxAzvUu11tPJP/exec';

  // Default sheet IDs — these are the FALLBACK values. The admin can
  // override any of them through the Config page; overrides persist
  // in localStorage and take effect on the next fetch.
  const SHEETS_DEFAULT = {
    MASTER:   '1B2wb38KhNwlLoZnsAGWQkO0FdEGFFfsh3ycRRurigq4',
    EMPLOYEE: '1HWKZPhKRhcuvxBgyyN8zRt8p-SzYmKjJWiOdCgykBHs',
    PURCHASE: '1zcqF2tjjBETPuW25c9MBMo0zakBIBD6tksg5OstFA7c',
    PAYMENT:  '1mLddxLRf719EaXE9XSET9gT8l0a8Cxns362yIbHo63g',
    STORES:   '1iMQxgqGilUh2_3NCZl5D-EMt-NC8FwugX83x2fWb8fE',
    V2_MASTER:'1fhSO4WBYp0LNXPxe9I9zr5qsIPs9CIDFpUixBogPnsM',
    SAFETY:   '1B8P0PawV43ksazbzhKsil1X6-INOfxx9PFvGycNOvDY',
    REWARDS:  '1vz8HLopjlSF8TF7rzYuVu5JjqukT929I7aSx7kdehlI',
    USER_SECRETS: '1hN4VEDNpVLD3lKuBPYCTOaViv7UpveRfud2d2gy15D0',
    BUDGET:   '', // Pending — paste once Excel is uploaded to Drive
  };

  const OVERRIDE_KEY = 'EVGCPL_DATA_OVERRIDES_V1';

  // ── Override store ────────────────────────────────────────────
  // Shape:
  //   {
  //     sheets:   { MASTER: '<custom id>', ... },     // overrides SHEETS_DEFAULT
  //     bindings: { 'scm.po': { tab: 'PO_v2', tq: '...', disabled: false }, ... }
  //   }
  function loadOverrides() {
    try {
      const raw = localStorage.getItem(OVERRIDE_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return {
        sheets:   obj.sheets   || {},
        bindings: obj.bindings || {},
      };
    } catch (_) {
      return { sheets:{}, bindings:{} };
    }
  }
  function saveOverrides(state) {
    try {
      localStorage.setItem(OVERRIDE_KEY, JSON.stringify(state));
      return true;
    } catch (_) { return false; }
  }
  function getSheetId(key) {
    const ov = loadOverrides();
    return (ov.sheets && ov.sheets[key]) || SHEETS_DEFAULT[key] || '';
  }
  function setSheetId(key, value) {
    const ov = loadOverrides();
    if (value && value !== SHEETS_DEFAULT[key]) {
      ov.sheets[key] = value;
    } else {
      delete ov.sheets[key]; // revert to default
    }
    return saveOverrides(ov);
  }
  function getBinding(name) {
    const base = (window.DATA_BINDINGS || {})[name];
    if (!base) return null;
    const ov = loadOverrides();
    const o  = ov.bindings[name] || {};
    return {
      sheetKey: o.sheetKey || base.sheetKey,
      tab:      o.tab      != null ? o.tab : base.tab,
      tq:       o.tq       != null ? o.tq  : base.tq,
      disabled: !!o.disabled,
    };
  }
  function setBinding(name, partial) {
    const base = (window.DATA_BINDINGS || {})[name];
    if (!base) return false;
    const ov = loadOverrides();
    const merged = { ...(ov.bindings[name] || {}), ...partial };
    // Strip keys that match the default — keeps storage minimal
    if (merged.sheetKey === base.sheetKey) delete merged.sheetKey;
    if (merged.tab      === base.tab)      delete merged.tab;
    if (merged.tq       === base.tq)       delete merged.tq;
    if (!merged.disabled) delete merged.disabled;
    if (Object.keys(merged).length === 0) {
      delete ov.bindings[name];
    } else {
      ov.bindings[name] = merged;
    }
    return saveOverrides(ov);
  }
  function resetBinding(name) {
    const ov = loadOverrides();
    delete ov.bindings[name];
    return saveOverrides(ov);
  }
  function resetAll() {
    return saveOverrides({ sheets:{}, bindings:{} });
  }

  // SHEETS object — proxied so that legacy code reading API.SHEETS.MASTER
  // still picks up the user's override transparently.
  const SHEETS = new Proxy(SHEETS_DEFAULT, {
    get(target, prop) { return getSheetId(prop) || target[prop]; },
  });

  // Maps the logical sheet KEY (not the ID) to a human label.
  // We use this for error messages and the Sharing Doctor table.
  const SHEET_LABELS = {
    MASTER:       'Master',
    EMPLOYEE:     'Employee Register',
    PURCHASE:     'v2_Purchase',
    PAYMENT:      'Payment',
    STORES:       'Stores',
    V2_MASTER:    'v2_Master',
    SAFETY:       'Safety',
    REWARDS:      'Rewards',
    USER_SECRETS: 'UserSecrets',
    BUDGET:       'Budget',
  };

  // Optional descriptive metadata per sheet, surfaced in the Sheets
  // directory page on Config. Editable through the same override store
  // (key: 'sheets-meta' inside the overrides JSON), so admins can rename
  // a sheet without losing the underlying ID.
  const SHEET_META_DEFAULT = {
    MASTER:       { description:'Sites, vendors, subcontractors, assets, mix-design lookups',
                    primaryTabs:'5-SiteMaster · 6-AssetMaster · 7-VendorMaster · 10-SubContractorMaster · 10_Mix_Design_Lookup' },
    EMPLOYEE:     { description:'HR data — register, attendance, payslips, leave, onboarding, mess',
                    primaryTabs:'0_EmployeeRegister_Live · OnboardingChecklist · 0A_EmployeePersonalDetails · 07_Mess_Accomodation · ReportSchedules' },
    PURCHASE:     { description:'Procurement — POs, MRS, invoices, stock movements',
                    primaryTabs:'PO · MRS · Invoice · StockIN · GRN_No' },
    PAYMENT:      { description:'42-column PaymentRequest schema for Accounts',
                    primaryTabs:'PaymentRequest' },
    STORES:       { description:'Site-level stock levels and inward register',
                    primaryTabs:'v3StockLevels · StockIN · GRN_No' },
    V2_MASTER:    { description:'Successor to Master — used while structural columns are being migrated',
                    primaryTabs:'(structure under review)' },
    SAFETY:       { description:'Safety incidents, daily checklist responses, observations',
                    primaryTabs:'Incidents · DailyChecks · Observation' },
    REWARDS:      { description:'Rewards & recognition — nominations, points, redemptions',
                    primaryTabs:'Master' },
    USER_SECRETS: { description:'PIN authentication store (read-only via Apps Script)',
                    primaryTabs:'Pins' },
    BUDGET:       { description:'IC Budget — 18-sheet financial planning workbook (pending upload)',
                    primaryTabs:'Project_Master · 10_Mix_Design_Lookup · v2_Master' },
  };

  function getSheetMeta(key) {
    const ov = loadOverrides();
    const o  = (ov.sheetsMeta || {})[key] || {};
    const d  = SHEET_META_DEFAULT[key] || {};
    return {
      label:       o.label       != null ? o.label       : (SHEET_LABELS[key] || key),
      description: o.description != null ? o.description : (d.description || ''),
      primaryTabs: o.primaryTabs != null ? o.primaryTabs : (d.primaryTabs || ''),
    };
  }
  function setSheetMeta(key, partial) {
    const ov = loadOverrides();
    ov.sheetsMeta = ov.sheetsMeta || {};
    const merged = { ...(ov.sheetsMeta[key] || {}), ...partial };
    // Strip keys that match the default so storage stays minimal
    if (merged.label       === (SHEET_LABELS[key] || key))                       delete merged.label;
    if (merged.description === (SHEET_META_DEFAULT[key]?.description || ''))     delete merged.description;
    if (merged.primaryTabs === (SHEET_META_DEFAULT[key]?.primaryTabs || ''))     delete merged.primaryTabs;
    if (Object.keys(merged).length === 0) delete ov.sheetsMeta[key];
    else ov.sheetsMeta[key] = merged;
    return saveOverrides(ov);
  }
  function sheetUrl(key) {
    const id = getSheetId(key);
    return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : '';
  }
  // Reverse lookup: ID → label, computed dynamically so that overrides work.
  function labelForId(id) {
    for (const k of Object.keys(SHEETS_DEFAULT)) {
      if (getSheetId(k) === id) return getSheetMeta(k).label || k;
    }
    for (const k of Object.keys(SHEETS_DEFAULT)) {
      if (SHEETS_DEFAULT[k] === id) return getSheetMeta(k).label || k;
    }
    return id ? id.slice(0, 12) + '…' : '?';
  }
  // Old SHEET_NAMES API kept for any code that does SHEET_NAMES[someId].
  const SHEET_NAMES = new Proxy({}, {
    get(_, prop) { return labelForId(prop); },
  });


  /* ═══════════════════════════════════════════════════════════════
     APP LINKS REGISTRY
     ═══════════════════════════════════════════════════════════════
     A directory of external apps the portal links to (AppSheet apps,
     Looker dashboards, internal tools, etc). Default registry below;
     admins can add/edit/remove entries via Config → App Links. The
     registry is persisted in the same overrides JSON under 'appLinks'
     so a single localStorage object holds all admin customisation. */

  const APP_LINKS_DEFAULT = [
    { id:'scm-appsheet',      name:'SCM AppSheet',           category:'AppSheet',
      url:'https://www.appsheet.com/start/06fd0117-1dd8-445b-aaee-e2ff6e68e36f',
      description:'Procurement workflow — PR/PO/MRS/GRN/Stock entry & approvals',
      icon:'📦' },
    { id:'hr-appsheet',       name:'HR AppSheet',            category:'AppSheet',
      url:'https://www.appsheet.com/start/9fcf3039',
      description:'HR module — employees, attendance, leave, onboarding',
      icon:'👥' },
    { id:'accounts-appsheet', name:'Accounts AppSheet',      category:'AppSheet',
      url:'https://www.appsheet.com/start/fcdba849-9f9d-435f-8e8a-ea0c975dbd21',
      description:'Payment requests, MD approvals, UTR confirmation',
      icon:'💰' },
    { id:'master-sheet',      name:'Master Sheet',           category:'Google Sheet',
      url:'https://docs.google.com/spreadsheets/d/1B2wb38KhNwlLoZnsAGWQkO0FdEGFFfsh3ycRRurigq4/edit',
      description:'Master data — sites, vendors, subcontractors, assets',
      icon:'📊' },
    { id:'employee-sheet',    name:'Employee Register',      category:'Google Sheet',
      url:'https://docs.google.com/spreadsheets/d/1HWKZPhKRhcuvxBgyyN8zRt8p-SzYmKjJWiOdCgykBHs/edit',
      description:'Live employee register with all HR data',
      icon:'📋' },
    { id:'apps-script',       name:'Apps Script',            category:'Backend',
      url:'https://script.google.com',
      description:'Backend handlers — appendRow, updateCell, listHRDocs, scheduled emails',
      icon:'⚙' },
    { id:'github-repo',       name:'GitHub Repository',      category:'Source',
      url:'https://github.com/evgcpladmin/evgcpl-portal',
      description:'Portal source code',
      icon:'🐙' },
    { id:'looker',            name:'Looker Studio dashboards', category:'Reporting',
      url:'https://lookerstudio.google.com',
      description:'IC Budget dashboards (pending data wire-up)',
      icon:'📈' },
  ];

  function loadAppLinks() {
    const ov = loadOverrides();
    if (Array.isArray(ov.appLinks)) return ov.appLinks;
    return APP_LINKS_DEFAULT.map(l => ({ ...l }));
  }
  function saveAppLinks(arr) {
    const ov = loadOverrides();
    ov.appLinks = arr;
    return saveOverrides(ov);
  }
  function resetAppLinks() {
    const ov = loadOverrides();
    delete ov.appLinks;
    return saveOverrides(ov);
  }

  // gviz JSONP plumbing
  let _reqId = 0;
  const _handlers = {};
  window.google = window.google || {};
  window.google.visualization = window.google.visualization || {};
  window.google.visualization.Query = window.google.visualization.Query || {};
  window.google.visualization.Query.setResponse = function(json) {
    const id = json.reqId;
    if (_handlers[id]) { _handlers[id](json); delete _handlers[id]; }
  };


  /* ───────────────────────────────────────────────────────────
     fetchSheet — JSONP with proper failure diagnostics
     Returns array of objects keyed by column header.
     ─────────────────────────────────────────────────────────── */
  function fetchSheet(tabName, tq, sheetId) {
    return new Promise((resolve, reject) => {
      const id   = String(++_reqId);
      const sid  = sheetId || SHEETS.MASTER;
      let url    = `https://docs.google.com/spreadsheets/d/${sid}/gviz/tq?tqx=out:json;reqId:${id}`;
      if (tabName) url += `&sheet=${encodeURIComponent(tabName)}`;
      if (tq)      url += `&tq=${encodeURIComponent(tq)}`;

      const timeout = setTimeout(() => {
        delete _handlers[id];
        if (script.parentNode) script.parentNode.removeChild(script);
        const err = new SheetError('TIMEOUT', sid, tabName,
          `Request timed out (20 s). The sheet may be huge or the network is slow.`);
        reject(err);
      }, 20000);

      _handlers[id] = (json) => {
        clearTimeout(timeout);
        if (script.parentNode) script.parentNode.removeChild(script);
        try {
          if (!json || !json.table) throw new Error('No table in response');
          const cols = json.table.cols.map(c => c.label);
          const rows = json.table.rows.map(row => {
            const obj = {};
            row.c.forEach((cell, i) => {
              obj[cols[i]] = (cell && cell.v != null) ? String(cell.v).trim() : '';
            });
            return obj;
          });
          resolve(rows);
        } catch (e) {
          reject(new SheetError('PARSE', sid, tabName,
            'Sheet returned data but it could not be parsed: ' + e.message));
        }
      };

      const script = document.createElement('script');
      script.onerror = async () => {
        clearTimeout(timeout);
        delete _handlers[id];
        if (script.parentNode) script.parentNode.removeChild(script);
        // Script errored — run a real diagnostic to figure out why
        const diag = await diagnoseSheet(sid, tabName);
        reject(new SheetError(diag.code, sid, tabName, diag.message, diag));
      };
      script.src = url;
      document.head.appendChild(script);
    });
  }


  /* ───────────────────────────────────────────────────────────
     fetchByBinding — preferred entry point for module pages.
     Resolves the binding through the override layer and calls
     fetchSheet with the effective sheet/tab/query.
     ─────────────────────────────────────────────────────────── */
  function fetchByBinding(name) {
    const b = getBinding(name);
    if (!b) {
      return Promise.reject(new SheetError(
        'BINDING_NOT_FOUND', '', '',
        `Unknown data binding "${name}". Add it to /assets/js/data-bindings.js or check the name.`,
      ));
    }
    if (b.disabled) {
      return Promise.reject(new SheetError(
        'BINDING_DISABLED', '', b.tab,
        `Binding "${name}" is disabled in Config. Re-enable it on the Config page to load data.`,
      ));
    }
    const sid = getSheetId(b.sheetKey);
    if (!sid) {
      return Promise.reject(new SheetError(
        'NO_SHEET_ID', '', b.tab,
        `No Sheet ID set for "${b.sheetKey}". Open Config → Sheets and paste the ID.`,
      ));
    }
    return fetchSheet(b.tab, b.tq, sid);
  }


  /* ───────────────────────────────────────────────────────────
     diagnoseSheet — Apps Script first (authoritative server-side
     check), with browser-side fallback if Apps Script unreachable.
     ─────────────────────────────────────────────────────────── */
  async function diagnoseSheet(sheetId, tabName) {
    const friendly = SHEET_NAMES[sheetId] || sheetId.slice(0, 12) + '…';
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;

    // ── Path A: Apps Script proxy (real HTTP status, no CORS). ──
    // The Apps Script runs UrlFetchApp server-side, so it can read
    // the response code, content-type, redirect target, and body.
    try {
      const ctrl = new AbortController();
      const tmo  = setTimeout(() => ctrl.abort(), 12000);
      const resp = await fetch(
        APPS_SCRIPT_URL + '?action=diagnoseSheet' +
          '&sheetId=' + encodeURIComponent(sheetId) +
          '&tab=' + encodeURIComponent(tabName || ''),
        { signal: ctrl.signal }
      );
      clearTimeout(tmo);
      if (resp.ok) {
        const data = await resp.json();
        return {
          code:     mapVerdictToCode(data.verdict),
          message:  buildMessageFromDiag(friendly, tabName, data),
          sheetUrl: sheetUrl,
          action:   verdictToAction(data.verdict),
          raw:      data,
          source:   'apps-script',
        };
      }
    } catch (_) {
      // Apps Script unreachable — fall through to browser-side probe
    }

    // ── Path B: Browser-side fallback. CORS hides response details,
    //    but we can still probe reachability via image-tag and look
    //    for redirect-to-signin markers if the body happens to leak.
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv` +
                   (tabName ? `&sheet=${encodeURIComponent(tabName)}` : '');
    let text = '';
    try {
      const r = await fetch(csvUrl, { method:'GET', redirect:'manual', credentials:'omit' });
      try { text = await r.text(); } catch (_) {}
    } catch (_) {}

    if (text && /accounts\.google\.com|ServiceLogin|signin/i.test(text)) {
      return {
        code: 'NOT_PUBLIC',
        message: `${friendly} redirects to a Google sign-in page when accessed anonymously. The sheet is not actually public, even if the Share dialog says "Anyone with the link" — most likely your Workspace org policy is silently overriding it.`,
        sheetUrl, action: 'sharing-or-policy', source: 'browser',
      };
    }

    const reachable = await new Promise((res) => {
      const img = new Image();
      img.onload  = () => res(true);
      img.onerror = () => res(false);
      img.src = csvUrl + '&_probe=' + Date.now();
      setTimeout(() => res(null), 4000);
    });

    if (reachable === false) {
      return {
        code: 'NOT_PUBLIC',
        message: `${friendly} could not be loaded anonymously. Most likely cause: the sheet is not publicly shared, OR your Google Workspace admin has a policy that silently blocks "Anyone with the link" sharing for files in your domain.`,
        sheetUrl, action: 'sharing-or-policy', source: 'browser',
      };
    }

    return {
      code: 'UNKNOWN',
      message: `${friendly} failed to load and the browser-side check was inconclusive. Open the sheet URL in an Incognito window — if you see a sign-in page, sharing is the problem.`,
      sheetUrl, action: 'manual-check', source: 'browser',
    };
  }

  // Map Apps Script verdict → portal error code
  function mapVerdictToCode(v) {
    switch (v) {
      case 'PUBLIC_OK':                     return 'OK';
      case 'NOT_PUBLIC_REDIRECTS_TO_LOGIN':
      case 'WORKSPACE_POLICY_BLOCKED':      return 'NOT_PUBLIC';
      case 'TAB_NOT_FOUND':                 return 'TAB_NOT_FOUND';
      case 'SHEET_NOT_FOUND':               return 'SHEET_NOT_FOUND';
      case 'TIMEOUT':                       return 'TIMEOUT';
      default:                              return 'UNKNOWN';
    }
  }
  function verdictToAction(v) {
    if (v === 'NOT_PUBLIC_REDIRECTS_TO_LOGIN') return 'sharing-or-policy';
    if (v === 'WORKSPACE_POLICY_BLOCKED')      return 'workspace-policy';
    if (v === 'TAB_NOT_FOUND')                 return 'tab-name';
    if (v === 'SHEET_NOT_FOUND')               return 'wrong-id';
    return 'manual-check';
  }
  function buildMessageFromDiag(friendly, tabName, d) {
    const status = d.status != null ? d.status : '?';
    const ct     = d.contentType ? ` · ${d.contentType}` : '';
    const where  = d.redirectTo ? ` → ${d.redirectTo}` : '';
    const summary = `HTTP ${status}${ct}${where}`;
    return `${friendly} — ${summary}\n\n${d.fixHint || 'No fix hint provided.'}`;
  }


  /* ───────────────────────────────────────────────────────────
     SheetError — typed error with friendly message + remediation
     ─────────────────────────────────────────────────────────── */
  function SheetError(code, sheetId, tabName, message, diag) {
    this.name      = 'SheetError';
    this.code      = code;
    this.sheetId   = sheetId;
    this.tabName   = tabName;
    this.message   = message;
    this.diag      = diag || null;
    this.sheetUrl  = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
  }
  SheetError.prototype = Object.create(Error.prototype);


  /* ───────────────────────────────────────────────────────────
     renderSheetError — compact UI for an error, with action paths
     based on the actual diagnostic verdict.
     ─────────────────────────────────────────────────────────── */
  function renderSheetError(err, target) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return;

    // Binding-layer errors (no sheetId) — render a simpler message.
    if (err.code === 'BINDING_NOT_FOUND' || err.code === 'BINDING_DISABLED' || err.code === 'NO_SHEET_ID') {
      el.innerHTML = `
        <div class="alert warn" style="margin-bottom:1rem">
          <span class="alert-icon">⚠</span>
          <div class="alert-body">
            <b>${err.code === 'NO_SHEET_ID' ? 'No sheet ID configured.' :
                err.code === 'BINDING_DISABLED' ? 'This data source is disabled.' :
                'Data binding not found.'}</b>
            <div style="margin-top:.3rem;font-size:.84rem">${escapeHtml(err.message || '')}</div>
            <div style="margin-top:.6rem"><a class="btn btn-primary btn-sm" href="config.html">Open Config →</a></div>
          </div>
        </div>`;
      return;
    }

    const friendly = (err.sheetId && SHEET_NAMES[err.sheetId]) || (err.sheetId ? err.sheetId.slice(0, 12) + '…' : 'sheet');
    const action   = err.diag?.action || (err.code === 'TAB_NOT_FOUND' ? 'tab-name' : 'sharing-or-policy');
    const raw      = err.diag?.raw;

    // ── Build action block based on verdict ─────────────────────
    let actionHtml = '';

    if (action === 'sharing-or-policy' || action === 'workspace-policy') {
      actionHtml = `
        <div class="diag-block">
          <div class="diag-headline">Most likely cause</div>
          <p>The sheet looks public in your Share dialog, but anonymous requests get redirected to a Google sign-in page. There are two common reasons:</p>
          <ol class="diag-list">
            <li><b>Google Workspace org policy</b> is silently overriding "Anyone with the link" sharing for files in your domain. The owner sees it as public, but external users can't actually access it.</li>
            <li>Sharing is set on a different account than the one that owns the sheet.</li>
          </ol>
          <div class="diag-headline">How to verify in 10 seconds</div>
          <p>Open <a href="${err.sheetUrl}" target="_blank" rel="noopener">the sheet</a> in an <b>Incognito browser window</b> (not signed in to any Google account). If you see a sign-in page, the sheet is not actually public.</p>
          <div class="diag-headline">Fix paths</div>
          <ul class="diag-list">
            <li><b>If you control the Workspace:</b> ask your admin to allowlist this file, or change the org-wide sharing policy at admin.google.com → Apps → Google Workspace → Drive → Sharing settings → set "Sharing outside of [domain]" to ON.</li>
            <li><b>If admin won't change policy:</b> move the sheet to a personal (non-Workspace) Google account; sharing then works normally.</li>
            <li><b>If the data is sensitive anyway:</b> route reads through the portal's Apps Script (server-side, authenticated) instead of public gviz.</li>
          </ul>
        </div>`;
    } else if (action === 'tab-name') {
      actionHtml = `
        <div class="diag-block">
          <div class="diag-headline">Fix</div>
          <p>The sheet is publicly accessible, but a tab named exactly <code>${escapeHtml(err.tabName || '')}</code> was not found. Open <a href="${err.sheetUrl}" target="_blank" rel="noopener">the sheet</a> and confirm the tab name (case-sensitive, no extra spaces).</p>
        </div>`;
    } else if (action === 'wrong-id') {
      actionHtml = `
        <div class="diag-block">
          <div class="diag-headline">Fix</div>
          <p>No sheet exists with this ID. Either the sheet was deleted, or the ID in <code>/assets/js/api.js</code> → <code>SHEETS</code> is wrong.</p>
        </div>`;
    } else if (action === 'manual-check') {
      actionHtml = `
        <div class="diag-block">
          <div class="diag-headline">Manual check</div>
          <p>Open <a href="${err.sheetUrl}" target="_blank" rel="noopener">the sheet</a> in an Incognito window. If it loads, the data side is fine; if it shows a sign-in page, sharing or Workspace policy is blocking access.</p>
        </div>`;
    }

    // ── Optional raw HTTP details (collapsed) ───────────────────
    let rawHtml = '';
    if (raw) {
      rawHtml = `
        <details class="diag-raw">
          <summary>Raw response details</summary>
          <div class="diag-raw-grid">
            <div><b>HTTP status:</b> ${raw.status}</div>
            <div><b>Content-Type:</b> ${escapeHtml(raw.contentType || '—')}</div>
            <div><b>Bytes returned:</b> ${raw.bodyBytes}</div>
            <div><b>Redirected:</b> ${raw.redirected ? 'yes' : 'no'}</div>
            ${raw.redirectTo ? `<div style="grid-column:1/-1"><b>Redirect target:</b> <code>${escapeHtml(raw.redirectTo)}</code></div>` : ''}
            ${raw.bodySniff ? `<div style="grid-column:1/-1"><b>Body preview:</b> <code>${escapeHtml(raw.bodySniff)}</code></div>` : ''}
            <div style="grid-column:1/-1"><b>Source:</b> ${err.diag?.source === 'apps-script' ? 'Apps Script (server-side, authoritative)' : 'browser probe (CORS-limited)'}</div>
          </div>
        </details>`;
    }

    el.innerHTML = `
      <div class="alert danger" role="alert" style="align-items:flex-start">
        <div class="alert-icon">⚠</div>
        <div class="alert-body">
          <div style="font-weight:600">Could not load <code>${escapeHtml(err.tabName || '')}</code> from <b>${escapeHtml(friendly)}</b>.</div>
          <div style="font-size:.78rem;margin-top:.2rem;color:var(--txt3);white-space:pre-wrap">${escapeHtml(err.message || '')}</div>
          ${actionHtml}
          ${rawHtml}
          <div class="alert-actions" style="margin-top:.7rem">
            <button class="btn btn-secondary btn-sm" onclick="API.runSharingDiagnostic('${err.sheetId}','${escapeHtml(err.tabName||'')}',this)">Re-run diagnostic</button>
            <a class="btn btn-secondary btn-sm" href="${err.sheetUrl}" target="_blank" rel="noopener">Open sheet ↗</a>
            <a class="btn btn-secondary btn-sm" href="sharing-doctor.html">Sharing Doctor →</a>
          </div>
        </div>
      </div>
    `;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }


  /* ───────────────────────────────────────────────────────────
     runSharingDiagnostic — exposed for re-run buttons
     ─────────────────────────────────────────────────────────── */
  async function runSharingDiagnostic(sheetId, tabName, btn) {
    if (btn) { btn.textContent = 'Diagnosing…'; btn.disabled = true; }
    const diag = await diagnoseSheet(sheetId, tabName);
    if (btn) { btn.textContent = 'Re-run diagnostic'; btn.disabled = false; }
    alert(
      'Diagnostic result\n' +
      '─────────────────\n' +
      'Sheet:  ' + (SHEET_NAMES[sheetId] || sheetId) + '\n' +
      'Tab:    ' + (tabName || '(default)') + '\n' +
      'Status: ' + diag.code + '\n\n' +
      diag.message
    );
  }


  /* ───────────────────────────────────────────────────────────
     postScript — Apps Script POST helper (CORS-safe)
     ─────────────────────────────────────────────────────────── */
  function postScript(payload) {
    return fetch(APPS_SCRIPT_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify(payload),
    }).then(r => r.json());
  }

  function getScript(action, params) {
    let url = APPS_SCRIPT_URL + '?action=' + encodeURIComponent(action);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        url += '&' + k + '=' + encodeURIComponent(v);
      });
    }
    return fetch(url).then(r => r.json());
  }


  /* ───────────────────────────────────────────────────────────
     diagnoseAllSheets — bulk check, used by Sharing Doctor page
     Calls Apps Script with a JSON list; falls back to per-sheet
     individual calls if the bulk endpoint is missing.
     ─────────────────────────────────────────────────────────── */
  async function diagnoseAllSheets(list) {
    // list = [{ id, tab, label }, ...]
    try {
      const url = APPS_SCRIPT_URL + '?action=diagnoseAllSheets&sheets=' +
                  encodeURIComponent(JSON.stringify(list));
      const r = await fetch(url);
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data.results)) return data.results;
      }
    } catch (_) {}
    // Fallback — per-sheet sequential calls
    const out = [];
    for (const s of list) {
      const d = await diagnoseSheet(s.id, s.tab || '');
      out.push({ ...d.raw, label: s.label || s.id, _portalCode: d.code, _portalMessage: d.message });
    }
    return out;
  }


  /* ───────────────────────────────────────────────────────────
     Public API
     ─────────────────────────────────────────────────────────── */
  return {
    SHEETS,
    SHEETS_DEFAULT,
    SHEET_NAMES,
    SHEET_LABELS,
    APPS_SCRIPT_URL,
    fetchSheet,
    fetchByBinding,
    diagnoseSheet,
    diagnoseAllSheets,
    renderSheetError,
    runSharingDiagnostic,
    postScript,
    getScript,
    SheetError,
    // Config layer
    getSheetId,
    setSheetId,
    getBinding,
    setBinding,
    resetBinding,
    resetAll,
    loadOverrides,
    labelForId,
    // Sheet metadata + URL helpers
    getSheetMeta, setSheetMeta, sheetUrl,
    SHEET_META_DEFAULT,
    // App links registry
    loadAppLinks, saveAppLinks, resetAppLinks,
    APP_LINKS_DEFAULT,
  };
})();
