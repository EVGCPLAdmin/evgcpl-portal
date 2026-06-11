/* ════════════════════════════════════════════════════════════════════
   EVGCPL Portal — Multi-page bootstrap layer

   This file is the ONLY new code introduced for the multi-page split.
   It runs after the main v88 bundle (assets/js/portal-bundle.js) and:

     1. Maps every route name → the HTML page that owns it
     2. Overrides navigate() so cross-page routes redirect via location.href
     3. On DOMContentLoaded, calls renderPage() with the route declared by
        body.dataset.page so the page renders its content
     4. Wires the new admin pages (Sheets directory, App Links registry,
        Apps launcher) into the same registry

   The legacy navigate() function is kept intact and called for same-page
   routes (e.g. switching from Equipment → Site Store within site-ops.html).
   ════════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  // ── Detect which page we're on ───────────────────────────────────
  const PAGE = (document.body.dataset.page || '').toLowerCase();
  const IS_LOGIN = (PAGE === 'index' || PAGE === '');

  // ── On the LOGIN page: override launchApp() to skip main-app DOM
  //    ops (which would crash since header/sidebar don't exist here)
  //    and instead persist STATE then redirect to the destination page.
  // ─────────────────────────────────────────────────────────────────
  if (IS_LOGIN) {
    // Patch must apply BEFORE any login-button handler fires. Since the
    // bundle defines launchApp at parse time, we wait for it to exist
    // then immediately replace it.
    const tryPatch = () => {
      if (typeof window.launchApp !== 'function') return setTimeout(tryPatch, 30);
      window.launchApp = function() {
        try {
          // Persist STATE so the destination page can read it
          if (typeof persistState === 'function') persistState();
        } catch (_) { /* fallback: localStorage write */ }
        try {
          localStorage.setItem('STATE', JSON.stringify({
            role:         STATE.role,
            selectedRole: STATE.selectedRole,
            user:         STATE.user,
            deptHeadDept: STATE.deptHeadDept || null,
          }));
        } catch (_) {}
        // Redirect to the right starting page for this role
        const isExternal = STATE.role === 'vendor' || STATE.role === 'sc';
        const dest = isExternal ? 'external.html' : 'dashboard.html';
        location.href = dest;
      };
    };
    tryPatch();
    return; // Login page does NOT need the rest of the bootstrap
  }

  // ──────────────────────────────────────────────────────────────────
  // From here on: we're on a MAIN-APP page (dashboard.html, hr.html, ...)
  // ──────────────────────────────────────────────────────────────────

  // ── Restore STATE from localStorage as soon as bundle has parsed ──
  // The bundle defines STATE as a plain global object with default
  // values. We overwrite it with whatever was persisted on the login
  // page redirect, before any function tries to use STATE.
  function restoreState() {
    if (typeof STATE === 'undefined') return setTimeout(restoreState, 20);
    try {
      const saved = JSON.parse(localStorage.getItem('STATE') || 'null');
      if (saved && saved.user && saved.user.email) {
        // Only overwrite the keys we know about — leave the bundle's own
        // defaults (mastersLoaded, currentPage, etc.) intact.
        STATE.role         = saved.role || 'employee';
        STATE.selectedRole = saved.selectedRole || saved.role || 'employee';
        STATE.user         = saved.user;
        STATE.deptHeadDept = saved.deptHeadDept || null;
      } else {
        // No login state — bounce to login
        location.href = 'index.html';
      }
    } catch (_) {
      location.href = 'index.html';
    }
  }
  restoreState();

  // ── Run the UI-population parts of launchApp without the redirect.
  //    On a main-app page, all the DOM elements (header, sidebar) DO exist, so we can safely run those bits. We skip the
  //    fade-out / setTimeout / navigate(default) path because we're
  //    already on the right page and the bootstrap below will call
  //    renderPage() with the route from data-page or hash.
  function runLaunchAppUI() {
    if (typeof STATE === 'undefined' || !STATE.user) return setTimeout(runLaunchAppUI, 30);
    if (typeof ROLES === 'undefined' || typeof applyRoleNavRestrictions !== 'function') {
      return setTimeout(runLaunchAppUI, 30);
    }
    try {
      const r = ROLES[STATE.role] || ROLES.employee;
      const _roleLabel = STATE.role === 'dept_head' && STATE.deptHeadDept
        ? 'Dept Head – ' + STATE.deptHeadDept : r.label;
      const setText = (id, txt) => {
        const el = document.getElementById(id);
        if (el) el.textContent = txt;
      };
      setText('roleBadge',     r.badge);
      setText('userName',      STATE.user.name || 'User');
      setText('userRoleLabel', _roleLabel);
      setText('userAvatar',    r.avatar);


      if (typeof applyPortalConfig === 'function') applyPortalConfig();
      if (typeof applyRoleNavRestrictions === 'function') applyRoleNavRestrictions(STATE.role);
      if (typeof applyDevModeUI === 'function') applyDevModeUI();

      // Show the app shell
      const appEl = document.getElementById('app');
      if (appEl) appEl.classList.add('show');
      const login = document.getElementById('loginScreen');
      if (login) login.style.display = 'none';
    } catch (e) {
      console.warn('runLaunchAppUI partial failure:', e);
    }

    // Kick off background data load
    if (typeof loadAllMasters === 'function') {
      loadAllMasters().then(() => {
        if (typeof updateAllMasterUI === 'function') updateAllMasterUI();
      }).catch(() => { /* tolerate */ });
    }
    if (typeof initNotifications === 'function') {
      try { initNotifications(); } catch (_) {}
    }
  }
  // Wait for DOM ready before populating header
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(runLaunchAppUI, 0);
  } else {
    document.addEventListener('DOMContentLoaded', runLaunchAppUI);
  }

  // ── Route → Page map ─────────────────────────────────────────────
  // Routes not listed default to dashboard.html so unknown routes fall
  // back gracefully. Each page hosts ONE primary route plus any
  // sub-routes that share its data fetches.
  const ROUTE_TO_PAGE = {
    // Dashboard
    'dashboard':         'dashboard.html',
    'md-command':        'dashboard.html',
    'dev-mode':          'dashboard.html',
    'settings':          'dashboard.html',

    // HR group
    'hr-dashboard':      'hr.html',
    'my-profile':        'hr.html',
    'onboarding':        'hr.html',
    'rewards':           'hr.html',
    'wall':              'hr.html',
    'policies':          'hr.html',

    // SCM group
    'scm':               'scm.html',
    'mrs':               'scm.html',
    'purchase':          'scm.html',
    'stores':            'scm.html',
    'stores-stockin':    'scm.html',
    'stores-siraw':      'scm.html',
    'stores-grn':        'scm.html',
    'stores-openpo':     'scm.html',
    'stores-levels':     'scm.html',
    'vendor':            'scm.html',
    'subcontractor':     'scm.html',

    // Site Ops
    'site-manager':      'site-ops.html',
    'safety':            'site-ops.html',
    'equipment':         'site-ops.html',
    'store':             'site-ops.html',

    // Accounts
    'accounts':          'accounts.html',

    // Reports
    'reports':           'reports.html',

    // Tendering / Planning
    'tendering':         'planning.html',
    'planning':          'planning.html',
    'planning-overview': 'planning.html',
    'planning-setup':    'planning.html',
    'execution':         'planning.html',
    'budget':            'planning.html',
    'project-setup':     'planning.html',
    'boq-planning':      'planning.html',

    // Plant & Machinery
    'plant':             'plant.html',
    'plant-log':         'plant.html',
    'plant-verify':      'plant.html',
    'plant-maintenance': 'plant.html',
    'log-entry':         'plant.html',
    'asset-verification':'plant.html',
    'asset-maintenance': 'plant.html',

    // Apps & Sheets hubs (legacy + new admin pages)
    'apps':              'apps.html',
    'sheets':            'sheets-directory.html',

    // External / vendor / sc
    'my-portal':         'external.html',
    'my-orders':         'external.html',
    'my-invoices':       'external.html',
    'my-documents':      'external.html',
  };

  // ── New admin pages (added on top of v87/v88 baseline) ───────────
  const ADMIN_ROUTE_TO_PAGE = {
    'config':            'config.html',
    'cfg-sheets':        'config.html',
    'cfg-sheets-dir':    'config.html',
    'cfg-bindings':      'config.html',
    'cfg-app-links':     'config.html',
    'cfg-status':        'config.html',
    'sharing-doctor':    'sharing-doctor.html',
    'sheets-dir':        'sheets-directory.html',
    'app-links':         'app-links.html',
  };

  Object.assign(ROUTE_TO_PAGE, ADMIN_ROUTE_TO_PAGE);

  // ── Override navigate() for cross-page redirects ─────────────────
  // The original navigate() lives in the v88 bundle; we wrap it so
  // routes belonging to a different HTML page redirect via location.href
  // (preserving the chosen route as a hash for the destination page to
  // pick up). Same-page routes flow through the original navigate() to
  // get full sub-route handling.
  const _legacyNavigate = window.navigate;
  if (typeof _legacyNavigate !== 'function') {
    console.warn('Multi-page bootstrap: legacy navigate() not found. Fallback: full reload on any nav.');
  }

  window.navigate = function(page) {
    const here = (document.body.dataset.page || '').toLowerCase();
    const target = ROUTE_TO_PAGE[page];

    // Unknown route → behave like legacy (it'll fall back to dashboard internally)
    if (!target) {
      if (_legacyNavigate) return _legacyNavigate(page);
      location.href = 'dashboard.html#' + page;
      return;
    }

    const targetFile = target.toLowerCase().replace(/\.html$/, '');
    if (here === targetFile) {
      // Same page — defer to legacy
      if (_legacyNavigate) return _legacyNavigate(page);
    }
    // Different page — redirect, carrying the route as hash
    location.href = target + '#' + page;
  };

  // ── On DOMContentLoaded: render the page's primary route ─────────
  function bootstrapPage() {
    const dataPage = (document.body.dataset.page || '').toLowerCase();
    if (!dataPage) return;

    // Use hash route if it belongs to this page; otherwise default to
    // the first route mapped to this page (or the page name itself).
    let route = (location.hash || '').replace(/^#/, '');
    if (!route || ROUTE_TO_PAGE[route] !== dataPage + '.html') {
      route = Object.keys(ROUTE_TO_PAGE).find(r =>
        ROUTE_TO_PAGE[r] === dataPage + '.html'
      ) || dataPage;
    }

    // Wait for both renderPage AND a logged-in STATE before rendering
    function tryRender(tries = 0) {
      if (typeof renderPage !== 'function' || typeof STATE === 'undefined' || !STATE.user) {
        if (tries > 50) return; // give up after ~5s
        return setTimeout(() => tryRender(tries + 1), 100);
      }
      // Record the route we're actually on. The bundle defaults
      // STATE.currentPage to 'dashboard'; leaving it stale made the bundle's
      // post-load re-validation call navigate('dashboard') from every other
      // page — a hard redirect back to dashboard.html ~1s after load.
      try { STATE.currentPage = route; } catch (_) {}
      try { renderPage(route); }
      catch (e) { console.error('renderPage failed for route:', route, e); }
    }
    tryRender();

    // Render the version footer once the app shell is up
    setTimeout(injectPortalFooter, 200);
  }

  // ── Portal footer with version info — appears on every page ──────
  function injectPortalFooter() {
    if (document.getElementById('portalVersionFooter')) return; // already injected
    const ver   = (typeof PORTAL_VERSION  !== 'undefined') ? PORTAL_VERSION  : '?.?.?';
    const build = (typeof PORTAL_BUILD    !== 'undefined') ? PORTAL_BUILD    : '—';
    const at    = (typeof PORTAL_BUILD_AT !== 'undefined') ? PORTAL_BUILD_AT : '';

    // Format build date (YYYY-MM-DD)
    let dateLabel = '';
    if (at) {
      try {
        const d = new Date(at);
        if (!isNaN(d.getTime())) {
          dateLabel = d.toISOString().slice(0, 10);
        }
      } catch (_) {}
    }

    const footer = document.createElement('footer');
    footer.id = 'portalVersionFooter';
    footer.setAttribute('aria-label', 'Portal version');
    footer.innerHTML = `
      <div class="pvf-inner">
        <span class="pvf-brand">EVGCPL Portal</span>
        <span class="pvf-sep">·</span>
        <span class="pvf-ver" title="Semantic version">v${ver}</span>
        <span class="pvf-sep">·</span>
        <span class="pvf-build" title="Build number — auto-incremented every package">build ${build}</span>
        ${dateLabel ? `<span class="pvf-sep">·</span><span class="pvf-date" title="Build date (UTC)">${dateLabel}</span>` : ''}
        <span class="pvf-fill"></span>
        <span class="pvf-tail">© ${new Date().getFullYear()} Evergreen Enterprises</span>
      </div>`;
    document.body.appendChild(footer);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(bootstrapPage, 0);
  } else {
    document.addEventListener('DOMContentLoaded', bootstrapPage);
  }

  // ── Hash-change handling (for in-page sub-route changes) ─────────
  window.addEventListener('hashchange', () => {
    const route = (location.hash || '').replace(/^#/, '');
    if (route && typeof renderPage === 'function') {
      const dataPage = (document.body.dataset.page || '').toLowerCase();
      const target = ROUTE_TO_PAGE[route];
      if (!target || target.toLowerCase() === dataPage + '.html') {
        try { if (typeof STATE !== 'undefined') STATE.currentPage = route; } catch (_) {}
        try { renderPage(route); } catch (e) { console.error(e); }
      }
    }
  });

  // ──────────────────────────────────────────────────────────────────
  //  AI ASSISTANT — Domain-aware data injection
  //
  //  The v88 bundle's aiSend() sends only summary statistics. We extend
  //  it so users can pick a domain (Accounts / Purchase / Stores / Site /
  //  HR / Safety / All), and the matching CSV rows get attached to the
  //  prompt as context. The Apps Script aiProxy passes this through to
  //  Groq (or Gemini) and returns the answer.
  // ──────────────────────────────────────────────────────────────────
  window.AI_DOMAIN = 'all';

  window.aiSetDomain = function(btnEl, domain) {
    AI_DOMAIN = domain;
    document.querySelectorAll('.ai-domain-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    const ctx = document.getElementById('aiCtxText');
    if (ctx) ctx.textContent = domain === 'all'
      ? 'Connected to portal data'
      : 'Scoped to: ' + domain.charAt(0).toUpperCase() + domain.slice(1);
  };

  // ── Domain → sheet bindings ──────────────────────────────────────
  // Each domain knows which sheet+tab to fetch and which columns matter.
  // Caps row count per domain so prompts stay under Groq's token limit.
  const DOMAIN_SOURCES = {
    accounts: {
      label: 'Accounts & Payments',
      sheetIdConst: 'PAYMENT_SHEET_ID',
      tab: 'PaymentRequest',
      maxRows: 300,
      hint: 'Each row = one payment request. Status column tells you pending/in-progress/paid. Use Vendor + PO# + Amount + Status to answer queries.',
    },
    purchase: {
      label: 'Purchase / SCM',
      sheetIdConst: 'PO_SHEET_ID',
      tab: 'PO',
      maxRows: 300,
      hint: 'Each row = one purchase order. Use PO# + Vendor + Status + Amount + Date to answer.',
    },
    stores: {
      label: 'Stores / Inventory',
      sheetIdConst: 'STORES_SHEET_ID',
      tab: 'StockIN',
      maxRows: 300,
      hint: 'Each row = one stock-in entry. GRN# + Material + Qty + Site.',
    },
    site: {
      label: 'Site Operations / DPR',
      sheetIdConst: 'V2_MASTER_SHEET_ID',
      tab: 'DPR',
      maxRows: 300,
      hint: 'Daily Progress Report rows. Site + Date + Activity + Quantity + Manpower.',
    },
    hr: {
      label: 'HR / Employees',
      sheetIdConst: 'EMP_SHEET_ID',
      tab: '0_EmployeeRegister_Live',
      maxRows: 400,
      hint: 'Each row = one employee. Name + EmpCode + Designation + Department + Site + Mail ID.',
    },
    safety: {
      label: 'Safety Incidents',
      sheetIdConst: 'SAFETY_SHEET_ID',
      tab: 'Incidents',
      maxRows: 200,
      hint: 'Each row = one incident. Date + Site + Type + Severity + Status + Description.',
    },
  };

  // Resolve a sheet ID const name to its current value (honoring overrides)
  function resolveSheetId(constName) {
    if (typeof window[constName] !== 'undefined' && window[constName]) return window[constName];
    // fallback: pull from Settings overrides
    try {
      const ov = JSON.parse(localStorage.getItem('evgcpl_settings_overrides') || '{}');
      const map = { PAYMENT_SHEET_ID:'PAYMENT', PO_SHEET_ID:'PO', STORES_SHEET_ID:'STORES',
                    V2_MASTER_SHEET_ID:'V2', EMP_SHEET_ID:'EMP', SAFETY_SHEET_ID:'SAFETY' };
      if (ov.sheets && map[constName] && ov.sheets[map[constName]]) return ov.sheets[map[constName]];
    } catch(_) {}
    return null;
  }

  // Fetch domain-specific rows as a CSV string for the AI prompt
  async function fetchDomainData(domain) {
    if (domain === 'all' || !DOMAIN_SOURCES[domain]) return '';
    const src = DOMAIN_SOURCES[domain];
    const sid = resolveSheetId(src.sheetIdConst);
    if (!sid) return '\n[' + src.label + ' — sheet ID not set]\n';
    try {
      const rows = await fetchSheet(src.tab, null, sid);
      if (!rows || !rows.length) return '\n[' + src.label + ' — no rows]\n';
      const trimmed = rows.slice(0, src.maxRows);
      // Build a compact CSV: take headers from first row's keys
      const cols = Object.keys(trimmed[0]);
      const head = cols.join(',');
      const body = trimmed.map(r => cols.map(c => {
        const v = (r[c] ?? '').toString().replace(/"/g, '""').replace(/\n/g, ' ');
        return v.includes(',') || v.includes('"') ? '"' + v + '"' : v;
      }).join(',')).join('\n');
      return `\n## ${src.label} (${trimmed.length} of ${rows.length} rows shown)\n${src.hint}\n\n\`\`\`csv\n${head}\n${body}\n\`\`\`\n`;
    } catch (err) {
      return '\n[' + src.label + ' — fetch failed: ' + err.message + ']\n';
    }
  }

  // ── Override aiSend() to attach domain data ──────────────────────
  // Wait until the bundle has defined aiSend, then wrap it.
  function patchAiSend() {
    if (typeof window.aiSend !== 'function' || typeof window.aiSystemPrompt !== 'function') {
      return setTimeout(patchAiSend, 50);
    }
    if (window._aiSendPatched) return;
    window._aiSendPatched = true;

    // We replace aiSystemPrompt by wrapping it: original output + domain CSV
    const origSystemPrompt = window.aiSystemPrompt;
    window._aiDomainContext = '';
    window.aiSystemPrompt = function() {
      const base = origSystemPrompt();
      const extra = window._aiDomainContext || '';
      return base + (extra ? '\n\n# DOMAIN DATA\n' + extra : '') +
        '\n\nIMPORTANT: When the user asks for status of a specific PO/MRS/payment/employee, scan the rows above and quote the matching record exactly. If no match is found, say so explicitly — do not invent data.';
    };

    // Also wrap aiSend to fetch domain data first
    const origAiSend = window.aiSend;
    window.aiSend = async function() {
      const domain = window.AI_DOMAIN || 'all';
      if (domain !== 'all') {
        try {
          window._aiDomainContext = await fetchDomainData(domain);
        } catch(e) {
          window._aiDomainContext = '\n[Domain fetch error: ' + e.message + ']\n';
        }
      } else {
        window._aiDomainContext = '';
      }
      return origAiSend();
    };
  }
  patchAiSend();

})();
