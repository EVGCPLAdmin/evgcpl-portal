/* ═══════════════════════════════════════════════════════════════════
   EVGCPL Portal — Data Bindings Registry
   /assets/js/data-bindings.js

   This is the SINGLE SOURCE OF TRUTH for which sheet+tab each module
   reads. Every fetch in the portal goes through API.fetchByBinding().

   The admin Config page can override:
     - Sheet IDs (per logical key: MASTER, PURCHASE, etc.)
     - Tab names (per binding: dashboard.sites, scm.po, etc.)
     - Disable a binding entirely (skip the call)

   Overrides persist in localStorage under EVGCPL_DATA_OVERRIDES_V1
   and take effect on the next fetch — no restart needed.
   ═══════════════════════════════════════════════════════════════════ */

window.DATA_BINDINGS = {
  // ── DASHBOARD ─────────────────────────────────────────────────
  'dashboard.sites':         { sheetKey:'MASTER',   tab:'5-SiteMaster',   tq:'SELECT A,B,F,G,H,K' },
  'dashboard.employees':     { sheetKey:'EMPLOYEE', tab:'0_EmployeeRegister_Live', tq:'SELECT A,C,M,N,P,X,Y' },
  'dashboard.vendors':       { sheetKey:'MASTER',   tab:'7-VendorMaster', tq:'SELECT A,B,F' },
  'dashboard.subcontractors':{ sheetKey:'MASTER',   tab:'10-SubContractorMaster', tq:'SELECT A,B,F' },
  'dashboard.assets':        { sheetKey:'MASTER',   tab:'6-AssetMaster',  tq:'SELECT A,B,F' },

  // ── SCM ───────────────────────────────────────────────────────
  'scm.po':                  { sheetKey:'PURCHASE', tab:'PO',             tq:'SELECT A,E,F,G,J,R,S,AF,AG,AP,AQ' },
  'scm.mrs':                 { sheetKey:'PURCHASE', tab:'MRS',            tq:'SELECT D,F,G,N,Y' },
  'scm.vendor':              { sheetKey:'MASTER',   tab:'Vendor',         tq:'SELECT *' },
  'scm.sc':                  { sheetKey:'MASTER',   tab:'SC',             tq:'SELECT *' },

  // ── SITE OPS ──────────────────────────────────────────────────
  'siteops.assets':          { sheetKey:'MASTER',   tab:'6-AssetMaster',  tq:'SELECT *' },
  'siteops.sites':           { sheetKey:'MASTER',   tab:'5-SiteMaster',   tq:'SELECT *' },
  'siteops.mrs':             { sheetKey:'PURCHASE', tab:'MRS',            tq:'SELECT D,F,G,N,Y' },
  'siteops.grn':             { sheetKey:'STORES',   tab:'GRN',            tq:'SELECT *' },

  // ── HR ────────────────────────────────────────────────────────
  'auth.userSecrets':        { sheetKey:'USER_SECRETS', tab:'UserSecrets', tq:'SELECT *' },
  'hr.employees':            { sheetKey:'EMPLOYEE', tab:'0_EmployeeRegister_Live', tq:'SELECT *' },
  'hr.attendance':           { sheetKey:'EMPLOYEE', tab:'Attendance',     tq:'SELECT *' },
  'hr.payslips':             { sheetKey:'EMPLOYEE', tab:'Payslips',       tq:'SELECT *' },
  'hr.leave':                { sheetKey:'EMPLOYEE', tab:'Leave',          tq:'SELECT *' },
  'hr.onboardingChecklist':  { sheetKey:'EMPLOYEE', tab:'OnboardingChecklist', tq:'SELECT A,B,C,D,E,F,G,H,I,J' },
  'hr.personalDetails':      { sheetKey:'EMPLOYEE', tab:'0A_EmployeePersonalDetails', tq:'SELECT A,F' },
  'hr.mess':                 { sheetKey:'EMPLOYEE', tab:'07_Mess_Accomodation',       tq:'SELECT *' },

  // ── ACCOUNTS / FINANCE ────────────────────────────────────────
  // 42-column PaymentRequest schema; we pull a curated subset:
  // A=UUID C=Manual/Auto D=Installment E=RequestID F=Date G=Initiator
  // H=NatureOfExpenses J=PaymentTo K=CostCode L=Department M=Process
  // N=PaidTo O=SiteName P=Company Q=OrderNo R=BillNo T=POValue U=InvoiceValue
  // V=PaidValue W=PendingValue Z=Currency AA=Amount AB=Narrative
  // AG=AccountsStatus AH=AccountsDate AI=UTR AJ=Remarks AK=Status
  'accounts.payments':       { sheetKey:'PAYMENT',  tab:'PaymentRequest',
                                 tq:'SELECT A,C,D,E,F,G,H,J,K,L,M,N,O,P,Q,R,T,U,V,W,Z,AA,AB,AG,AH,AI,AJ,AK' },

  // ── SAFETY ────────────────────────────────────────────────────
  'safety.incidents':        { sheetKey:'SAFETY',   tab:'Incidents',      tq:'SELECT *' },
  'safety.dailyChecks':      { sheetKey:'SAFETY',   tab:'DailyChecks',    tq:'SELECT *' },
  'safety.observations':     { sheetKey:'SAFETY',   tab:'Observation',    tq:'SELECT *' },

  // ── REPORTS (cross-cutting reads not already covered above) ───
  'reports.stockLevels':     { sheetKey:'STORES',   tab:'v3StockLevels',  tq:'SELECT A,B,C,D,E,F,G,H' },
  'reports.stockIn':         { sheetKey:'STORES',   tab:'StockIN',        tq:'SELECT A,B,C,D,F,G,H,N,O,P,Q,U' },
  'reports.grnNo':           { sheetKey:'STORES',   tab:'GRN_No',         tq:'SELECT A,B,C,F,G,H' },
  'reports.invoice':         { sheetKey:'PURCHASE', tab:'Invoice',        tq:'SELECT A,B,C,D,G,H,I' },

  // ── REWARDS ───────────────────────────────────────────────────
  'rewards.master':          { sheetKey:'REWARDS',  tab:'Master',         tq:'SELECT *' },
};


/* ═══════════════════════════════════════════════════════════════════
   Friendly metadata — used by the admin Config page to render a
   human-readable table. Each binding belongs to a module group.
   ═══════════════════════════════════════════════════════════════════ */
window.DATA_BINDING_META = {
  'dashboard.sites':         { module:'Dashboard',   label:'Active sites list' },
  'dashboard.employees':     { module:'Dashboard',   label:'Employee count' },
  'dashboard.vendors':       { module:'Dashboard',   label:'Vendor count' },
  'dashboard.subcontractors':{ module:'Dashboard',   label:'Subcontractor count' },
  'dashboard.assets':        { module:'Dashboard',   label:'Asset count' },
  'scm.po':                  { module:'SCM',         label:'Purchase Orders' },
  'scm.mrs':                 { module:'SCM',         label:'Material Requests' },
  'scm.vendor':              { module:'SCM',         label:'Vendor master' },
  'scm.sc':                  { module:'SCM',         label:'Sub-Contractor master' },
  'siteops.assets':          { module:'Site Ops',    label:'Equipment & Assets' },
  'siteops.sites':           { module:'Site Ops',    label:'Site master' },
  'siteops.mrs':             { module:'Site Ops',    label:'Site MRS' },
  'siteops.grn':             { module:'Site Ops',    label:'Goods Received Notes' },
  'auth.userSecrets':        { module:'Auth',        label:'PIN store (login validation)' },
  'hr.employees':            { module:'HR',          label:'Employee master' },
  'hr.attendance':           { module:'HR',          label:'Attendance' },
  'hr.payslips':             { module:'HR',          label:'Payslips' },
  'hr.leave':                { module:'HR',          label:'Leave records' },
  'hr.onboardingChecklist':  { module:'HR',          label:'Onboarding checklist log' },
  'hr.personalDetails':      { module:'HR',          label:'Personal details (UUID lookup)' },
  'hr.mess':                 { module:'HR',          label:'Mess & accommodation' },
  'accounts.payments':       { module:'Accounts',    label:'Payment requests' },
  'safety.incidents':        { module:'Safety',      label:'Incidents log' },
  'safety.dailyChecks':      { module:'Safety',      label:'Daily safety checks' },
  'safety.observations':     { module:'Safety',      label:'Observations' },
  'reports.stockLevels':     { module:'Reports',     label:'v3StockLevels (per-site stock)' },
  'reports.stockIn':         { module:'Reports',     label:'StockIN (goods received raw)' },
  'reports.grnNo':           { module:'Reports',     label:'GRN_No (goods receipt notes)' },
  'reports.invoice':         { module:'Reports',     label:'Invoice register' },
  'rewards.master':          { module:'Rewards',     label:'Rewards master' },
};
