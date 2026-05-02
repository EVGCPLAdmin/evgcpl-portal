/* ════════════════════════════════════════════════════════════════
   CONFIG · Sheet IDs, Apps Script URL, Tab names
═══════════════════════════════════════════════════════════════ */

window.CONFIG = {
  // Project Cost Control backing sheet
  SHEET_ID:   '1dQow9nD4e0qVOSfpwEWQmPTuhF3FW_8r1oK5dMjJlRE',
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxajuscM46AlJe2iMtDg0nJjfuzidEZwnOy_o2TZXQIbh_e2hGu79CNxAzvUu11tPJP/exec',

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
  },

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

  DEMO_MODE: false,
};
