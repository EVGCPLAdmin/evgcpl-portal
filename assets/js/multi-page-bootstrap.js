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

  // ── Route → Page map ─────────────────────────────────────────────
  // Routes not listed default to dashboard.html so unknown routes fall
  // back gracefully. Each page hosts ONE primary route plus any
  // sub-routes that share its data fetches.
  const ROUTE_TO_PAGE = {
    // Dashboard
    'dashboard':         'dashboard.html',
    'md-command':        'dashboard.html',
    'dev-mode':          'dashboard.html',

    // HR group
    'hr-dashboard':      'hr.html',
    'my-profile':        'hr.html',
    'personal':          'hr.html',
    'onboarding':        'hr.html',
    'rewards':           'hr.html',
    'wall':              'hr.html',
    'policies':          'hr.html',

    // SCM group
    'scm':               'scm.html',
    'mrs':               'scm.html',
    'purchase':          'scm.html',
    'stores':            'scm.html',
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
    if (!dataPage) return; // login page or admin page handles itself

    // If a hash is present (e.g. site-ops.html#equipment), use that route;
    // otherwise pick the first route that maps to this page.
    let route = (location.hash || '').replace(/^#/, '');
    if (!route || ROUTE_TO_PAGE[route] !== dataPage + '.html') {
      // Resolve default route for this page
      route = Object.keys(ROUTE_TO_PAGE).find(r =>
        ROUTE_TO_PAGE[r] === dataPage + '.html'
      ) || dataPage;
    }

    // Auth gate — if not logged in (and this is not the login page itself),
    // bounce to index.html. STATE is set up by the legacy bundle.
    if (typeof STATE !== 'undefined' && !STATE.user && dataPage !== 'index') {
      // Allow the legacy bundle's own auth flow to run first; if it
      // doesn't show the login overlay, redirect.
      setTimeout(() => {
        if (typeof STATE !== 'undefined' && !STATE.user) {
          location.href = 'index.html';
        }
      }, 500);
    }

    // Hand off to the legacy renderer
    if (typeof renderPage === 'function') {
      try { renderPage(route); }
      catch (e) { console.error('renderPage failed for route:', route, e); }
    } else {
      console.warn('Multi-page bootstrap: renderPage not found.');
    }
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
        try { renderPage(route); } catch (e) { console.error(e); }
      }
    }
  });
})();
