/* ═══════════════════════════════════════════════════════════════════
   EVGCPL Portal — Navigation Config
   /assets/js/nav-config.js
   Declarative structure — each section becomes a top-nav group.
   `route` maps to a page file, e.g. 'dashboard' → 'dashboard.html'.
   `roles` hides items from users who don't have access.
   ═══════════════════════════════════════════════════════════════════ */

window.NAV_CONFIG = [
  {
    label:  'Dashboard',
    icon:   'grid',
    route:  'dashboard',
    page:   'dashboard.html',
    roles:  ['md','admin','hr','site','purchase','accounts','employee','dept_head'],
  },
  {
    label:  'HR & People',
    icon:   'users',
    rolesHide: ['site','vendor','sc'],
    items: [
      { label:'HR Dashboard',      route:'hr-dashboard', page:'hr.html#hr-dashboard', status:'live' },
      { label:'My Profile',         route:'my-profile',   page:'hr.html#my-profile',   status:'live' },
      { label:'My Team',            route:'my-team',      page:'hr.html#my-team',      status:'live' },
      { label:'Onboarding',         route:'onboarding',   page:'hr.html#onboarding',   status:'live' },
      { label:'Policies Hub',       route:'policies',     page:'hr.html#policies',     status:'live' },
    ],
  },
  {
    label:  'Site Ops',
    icon:   'building',
    items: [
      { label:'Site Manager',       route:'site-manager', page:'site-ops.html#sites',     status:'live' },
      { label:'Safety Module',      route:'safety',       page:'safety.html',             status:'live' },
      { label:'Equipment',          route:'equipment',    page:'site-ops.html#equipment', status:'live' },
      { label:'Site Store',         route:'store',        page:'site-ops.html#store',     status:'live' },
      { label:'Plant & Machinery',  route:'plant',        page:'site-ops.html#plant',     status:'live' },
    ],
  },
  {
    label:  'Procurement',
    icon:   'cart',
    rolesHide: ['site'],
    items: [
      { label:'SCM Dashboard',      route:'scm',          page:'scm.html',                status:'live' },
      { label:'Vendors',            route:'vendor',       page:'scm.html#vendors',        status:'live' },
      { label:'Subcontractors',     route:'subcontractor',page:'scm.html#subcontractors', status:'live' },
    ],
  },
  {
    label:  'Finance',
    icon:   'rupee',
    rolesHide: ['site','employee'],
    items: [
      { label:'Accounts',           route:'accounts',     page:'accounts.html',           status:'live' },
      { label:'Payments',           route:'payments',     page:'accounts.html#payments',  status:'live' },
      { label:'IC Budget',          route:'budget',       page:'ic-budget.html',          status:'dev'  },
    ],
  },
  {
    label:  'Reports',
    icon:   'chart',
    route:  'reports',
    page:   'reports.html',
    roles:  ['md','admin','hr','site','purchase','accounts','dept_head'],
  },
  {
    label:  'Apps',
    icon:   'apps',
    route:  'apps',
    page:   'apps.html',
    roles:  ['md','admin','hr','site','purchase','accounts','employee','dept_head'],
  },
  {
    label:  'Config',
    icon:   'apps',
    roles:  ['md','admin'],
    items: [
      { label:'Sharing Doctor',     route:'sharing-doctor',     page:'sharing-doctor.html',           status:'live' },
      { label:'Sheet IDs',          route:'cfg-sheets',         page:'config.html#sheets',            status:'live' },
      { label:'Sheets directory',   route:'cfg-sheets-dir',     page:'config.html#sheets-dir',        status:'live' },
      { label:'Tab & Query bindings', route:'cfg-bindings',     page:'config.html#bindings',          status:'live' },
      { label:'App Links',          route:'cfg-app-links',      page:'config.html#app-links',         status:'live' },
      { label:'Diagnostics',        route:'cfg-status',         page:'config.html#status',            status:'live' },
    ],
  },
];


/* ──────────────────────────────────────────────────────────────
   Flat search index — populated for the ⌘K palette
   ────────────────────────────────────────────────────────────── */
window.NAV_INDEX = (function() {
  const flat = [];
  window.NAV_CONFIG.forEach(group => {
    if (group.route) {
      flat.push({
        title: group.label,
        section: 'Navigation',
        page: group.page,
        external: false,
        keywords: group.label.toLowerCase(),
      });
    }
    if (group.items) {
      group.items.forEach(item => {
        flat.push({
          title: item.label,
          section: group.label,
          page: item.page || item.url,
          external: !!item.external,
          keywords: (group.label + ' ' + item.label).toLowerCase(),
        });
      });
    }
  });
  return flat;
})();
