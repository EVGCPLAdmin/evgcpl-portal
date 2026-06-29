/* ════════════════════════════════════════════════════════════════
   CONFIG · Sheet IDs, Apps Script URL, Tab names
═══════════════════════════════════════════════════════════════ */

// ── Build constants — patched by build-portal.js at build time ──
const PCC_VERSION  = '4.27.0';
const PCC_BUILD    = 643;
const PCC_BUILD_AT = '2026-06-29T17:52:42Z';

// ── Apps Script URL: read parent portal's endpoint registry ──
// The PCC subapp loads in an iframe on the same origin. Its parent stores
// per-endpoint URL overrides in localStorage under 'evgcpl_exec_registry_v1'.
// We read that map and prefer overrides[pcc] (or overrides[main] as fallback).
// Hardcoded URL is the last-resort default.
const _PCC_DEFAULT_URL = 'https://script.google.com/macros/s/AKfycbyYs2Uot1gGEsmSk1LLeer9T1I2Sy01aRgffRFVNMGDGEScVVf2cXF1Gy2dchiLe3M/exec';
function _resolvePccScriptUrl() {
  try {
    const raw = localStorage.getItem('evgcpl_exec_registry_v1');
    if (raw) {
      const overrides = JSON.parse(raw);
      const ok = u => typeof u === 'string' && /^https:\/\/script\.google\.com\/macros\//.test(u);
      // T1: localStorage override
      if (ok(overrides.pcc))  return overrides.pcc;
      if (ok(overrides.main)) return overrides.main;
    }
  } catch (e) { /* localStorage parse failed */ }
  // T2: Sheet config (loaded by parent portal into window._SHEET_CONFIG,
  //     or via same-origin parent frame access)
  try {
    const sc = (window._SHEET_CONFIG || (window.parent && window.parent._SHEET_CONFIG) || {});
    const ok = u => typeof u === 'string' && /^https:\/\/script\.google\.com\/macros\//.test(u);
    if (ok(sc['exec_pcc']))  return sc['exec_pcc'];
    if (ok(sc['exec_main'])) return sc['exec_main'];
  } catch (e) { /* cross-origin */ }
  // T3: Compiled default
  return _PCC_DEFAULT_URL;
}

window.CONFIG = {
  // Project Cost Control backing sheet
  SHEET_ID:   '1dQow9nD4e0qVOSfpwEWQmPTuhF3FW_8r1oK5dMjJlRE',
  SCRIPT_URL: _resolvePccScriptUrl(),

  // Master sheet (sites, vendors, billing companies, sub-contractors)
  // Tabs of interest: 5-SiteMaster, 1-BillingMaster, 7-VendorMaster, 10-SubContractorMaster
  MASTER_SHEET_ID: '1B2wb38KhNwlLoZnsAGWQkO0FdEGFFfsh3ycRRurigq4',

  // Employee register (separate sheet)
  // Tab: 0_EmployeeRegister_Live
  EMPLOYEE_SHEET_ID: '1HWKZPhKRhcuvxBgyyN8zRt8p-SzYmKjJWiOdCgykBHs',

  // Tab names — keep in sync with the backing Sheet
  TABS: {
    PROJECT:    'Project',
    BOQ:        'BOQ',
    WBS:        'WBS',
    ACTIVITIES: 'Activities',
    COSTCODE:   'CostCode',

    // Steps 4–8 (auto-create on first save)
    WORKPLAN:   'Workplan',
    MANPOWER:   'Manpower_Plan',
    MACHINERY:  'Machinery_Plan',
    MATERIALS:  'Material_Plan',
    OVERHEADS:  'Overheads',
    VARIATIONS: 'Variations',
    APPROVALS:  'BudgetApprovals',

    // Master / lookup tabs (cached at load, used to build dropdowns)
    // Master / lookup tabs (cached at load, used to build dropdowns)
    M_ACTIVITIES: 'M_PL_1_Activities',  // Activity catalog (cross-project)
    Z12_NATURE:   'M12_Nature of Work', // Nature/Type/UOM master tab (on V2_MASTER sheet)
  },

  // The Z12 master sheet is V2_MASTER, not the PCC sheet.
  // Tab name is M12_Nature of Work (mapped from AppSheet table Z12.Nature of Work).
  Z12_SHEET_ID: '1fhSO4WBYp0LNXPxe9I9zr5qsIPs9CIDFpUixBogPnsM',
  Z12_TAB:      'M12_Nature of Work',

  // Workplan schema — one row per activity (per-project, per-WBS-row).
  // Kept in sync with saveWorkplan in AppsScript_Handlers.gs.
  WORKPLAN_HEADERS: [
    'Project Code',
    'WBS Code',
    'Nature of Work',
    'Activity',
    'UoM',
    'Qty',
    'Start',          // YYYY-MM-DD
    'End',            // YYYY-MM-DD
    'Duration',       // days, auto-computed from Start..End
    '% Weight',       // 0-100, should sum to 100 across project
    'Responsibility', // employee name (or free text)
    'Master UUID',    // FK to M_PL_1_Activities.UUID
    'Task Code',      // human-readable copy
    'CheckSum',       // FK to M_PL_1_Activities.CheckSum (links to parent WBS UUID)
    'Updated At',     // server-stamped ISO timestamp
  ],

  // Master tabs
  MASTER_TABS: {
    SITE:           '5-SiteMaster',
    BILLING:        '1-BillingMaster',
    VENDOR:         '7-VendorMaster',
    SUBCONTRACTOR:  '10-SubContractorMaster',
  },
  EMPLOYEE_TAB: '0_EmployeeRegister_Live',

  // Page metadata — drives the nav and dashboard
  PAGES: [
    { id: 'project-dashboard', file: 'project-dashboard.html', step: '·', title: 'Dashboard',    icon: '📊', desc: 'Timeline & Cost progress · S-curve · Trend · Deviations', status: 'live' },
    { id: 'project-tree',      file: 'project-tree.html',      step: '·', title: 'Project Tree',  icon: '🌲', desc: 'Full project hierarchy: BOQ → WBS → Activities',          status: 'live' },
    { id: 'home',       file: 'index.html',       step: '·', title: 'Home',          icon: '🏠', desc: 'Project switcher and module dashboard',                  status: 'live'    },
    { id: 'setup',      file: 'setup.html',       step: 1,  title: 'Project Setup',  icon: '🏗️', desc: 'Project identity · client · site · billing · team',     status: 'live'    },
    { id: 'boq',        file: 'boq.html',         step: 2,  title: 'BOQ',            icon: '📋', desc: 'Bill of quantities · AI assistant · CSV import',         status: 'live'    },
    { id: 'wbs',        file: 'wbs.html',         step: 3,  title: 'WBS',            icon: '🌳', desc: 'Work breakdown structure · activities · cost codes',     status: 'live'    },
    { id: 'workplan',   file: 'workplan.html',    step: 4,  title: 'Workplan',       icon: '📅', desc: 'Monthly quantity grid per activity',                     status: 'live'    },
    { id: 'manpower',   file: 'manpower.html',    step: '5A', title: 'Manpower',     icon: '👥', desc: 'Workers · rate · days · indirect · buffer',              status: 'live'    },
    { id: 'machinery',  file: 'machinery.html',   step: '5B', title: 'Machinery',    icon: '🚜', desc: 'Owned/Rental · hours · diesel · mob/demob',              status: 'live'    },
    { id: 'materials',  file: 'materials.html',   step: '5C', title: 'Materials',    icon: '🧱', desc: 'BOQ qty · wastage · unit rate · procurement',            status: 'live'    },
    { id: 'overheads',  file: 'overheads.html',   step: '·',  title: 'Overheads',    icon: '🏢', desc: 'Direct (site) + Indirect (HO 5% · insurance · taxes)',  status: 'live'    },
    { id: 'summary',    file: 'summary.html',     step: '6+7',title: 'Cost Summary', icon: '💰', desc: 'Activity cost + overheads + buffer = Total Budget',     status: 'live'    },
    { id: 'variations', file: 'variations.html',  step: 8,  title: 'Variations',     icon: '🔄', desc: 'Scope/Design/Quantity changes · workflow tracking',      status: 'live'    },
  ],

};
