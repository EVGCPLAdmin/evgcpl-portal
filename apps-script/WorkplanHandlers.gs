/* ═══════════════════════════════════════════════════════════════════
   EVGCPL — Workplan & Activity Master Handlers
   ───────────────────────────────────────────────────────────────────
   Add this to the existing Apps Script project (`EVGCPL_Portal_API`).

   Routes registered:
     action: 'workplan.save'        → upsert a workplan row
     action: 'workplan.list'        → list workplan rows for a project
     action: 'workplan.delete'      → soft-delete (Status='DELETED')
     action: 'activities.list'      → fetch the activity master (cached)
     action: 'activities.upsert'    → admin: add/edit a master row

   All routes accept JSON body with Content-Type: text/plain
   (matches the existing CORS-safe pattern used by Safety/DPR handlers).
   ═══════════════════════════════════════════════════════════════════ */

// ── Sheet config ──────────────────────────────────────────────────
var PCC_SHEET_ID    = '1dQow9nD4e0qVOSfpwEWQmPTuhF3FW_8r1oK5dMjJlRE';
var TAB_ACTIVITIES  = 'M_PL_1_Activities';
var TAB_BOQ         = 'M_PL_2_BOQ';
var TAB_WBS         = 'M_PL_3_WBS';
var TAB_WORKPLAN    = 'M_PL_4_Workplan';
var TAB_WORKPLANDTL = 'M_PL_4_WorkplanDtl';

// ── Workplan column order (header row 1) ──────────────────────────
//   The handler is order-agnostic — it reads the header row and maps
//   field names. So you can rearrange columns in the sheet freely.
var WORKPLAN_FIELDS = [
  'WorkplanID',         // auto: WP-{ProjectCode}-{seq}
  'ProjectCode',        // FK → Project_Master
  'SiteName',
  'WBSCode',            // FK → M_PL_3_WBS
  'NatureOfWork',       // FK → M_PL_1_Activities (parent)
  'TypeOfWork',         // FK → M_PL_1_Activities (child)
  'BOQItemCode',        // FK → M_PL_2_BOQ (optional)
  'UOM',
  'PlannedQty',
  'PlannedRate',
  'PlannedValue',       // = PlannedQty * PlannedRate
  'StartDate',
  'EndDate',
  'DurationDays',
  'AssignedTo',         // employee code
  'Subcontractor',      // SC code (optional)
  'Status',             // PLANNED / IN_PROGRESS / COMPLETED / DELETED
  'Notes',
  'CreatedBy',
  'CreatedAt',
  'ModifiedBy',
  'ModifiedAt'
];

// Detail / month-by-month qty rows — used when a workplan spans months
var WORKPLANDTL_FIELDS = [
  'DetailID',
  'WorkplanID',         // FK
  'PeriodMonth',        // YYYY-MM
  'PlannedQty',
  'PlannedValue',
  'ActualQty',          // populated from DPR rollups
  'ActualValue',
  'Variance',
  'Notes'
];

// ════════════════════════════════════════════════════════════════
// PUBLIC ENTRY POINT — wire into your existing doPost router
// ════════════════════════════════════════════════════════════════
function handleWorkplan(action, payload) {
  switch (action) {
    case 'workplan.save':     return wp_save(payload);
    case 'workplan.list':     return wp_list(payload);
    case 'workplan.delete':   return wp_delete(payload);
    case 'activities.list':   return act_list(payload);
    case 'activities.upsert': return act_upsert(payload);
  }
  return null; // not our action
}

// ════════════════════════════════════════════════════════════════
// WORKPLAN — Upsert / List / Delete
// ════════════════════════════════════════════════════════════════
function wp_save(p) {
  var ss   = SpreadsheetApp.openById(PCC_SHEET_ID);
  var sh   = _ensureSheet(ss, TAB_WORKPLAN, WORKPLAN_FIELDS);
  var hdr  = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var idCol = hdr.indexOf('WorkplanID') + 1;
  var now  = new Date();
  var user = (p.user && p.user.email) || 'system';
  var data = sh.getDataRange().getValues();

  // Generate ID if new
  if (!p.row.WorkplanID) {
    var pc  = (p.row.ProjectCode || 'P').toString().toUpperCase();
    var seq = data.filter(function(r){
      return (r[idCol-1] || '').toString().indexOf('WP-'+pc+'-') === 0;
    }).length + 1;
    p.row.WorkplanID = 'WP-' + pc + '-' + ('000' + seq).slice(-4);
    p.row.CreatedBy  = user;
    p.row.CreatedAt  = now;
  }
  p.row.ModifiedBy = user;
  p.row.ModifiedAt = now;
  if (p.row.PlannedQty != null && p.row.PlannedRate != null) {
    p.row.PlannedValue = (parseFloat(p.row.PlannedQty) || 0) * (parseFloat(p.row.PlannedRate) || 0);
  }
  if (!p.row.Status) p.row.Status = 'PLANNED';

  // Find existing row by WorkplanID, else append
  var existingRowIdx = -1;
  for (var i = 1; i < data.length; i++) {
    if (data[i][idCol-1] === p.row.WorkplanID) { existingRowIdx = i + 1; break; }
  }
  var rowValues = hdr.map(function(h){ return p.row[h] != null ? p.row[h] : ''; });
  if (existingRowIdx > 0) {
    sh.getRange(existingRowIdx, 1, 1, hdr.length).setValues([rowValues]);
  } else {
    sh.appendRow(rowValues);
  }

  // Persist month-by-month detail rows if provided
  if (p.detail && p.detail.length) {
    var sd = _ensureSheet(ss, TAB_WORKPLANDTL, WORKPLANDTL_FIELDS);
    var sdHdr = sd.getRange(1, 1, 1, sd.getLastColumn()).getValues()[0];
    p.detail.forEach(function(d){
      d.WorkplanID = p.row.WorkplanID;
      if (!d.DetailID) d.DetailID = p.row.WorkplanID + '-' + d.PeriodMonth;
      var dr = sdHdr.map(function(h){ return d[h] != null ? d[h] : ''; });
      sd.appendRow(dr);
    });
  }

  return { success: true, workplanID: p.row.WorkplanID };
}

function wp_list(p) {
  var ss = SpreadsheetApp.openById(PCC_SHEET_ID);
  var sh = ss.getSheetByName(TAB_WORKPLAN);
  if (!sh) return { success: true, rows: [] };
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return { success: true, rows: [] };
  var hdr = data[0];
  var rows = data.slice(1).map(function(r){
    var o = {};
    hdr.forEach(function(h, i){ o[h] = r[i]; });
    return o;
  })
  .filter(function(r){ return r.Status !== 'DELETED'; })
  .filter(function(r){ return !p.projectCode || r.ProjectCode === p.projectCode; })
  .filter(function(r){ return !p.siteName    || r.SiteName    === p.siteName; });
  return { success: true, rows: rows };
}

function wp_delete(p) {
  if (!p.workplanID) return { success: false, message: 'workplanID required' };
  var ss   = SpreadsheetApp.openById(PCC_SHEET_ID);
  var sh   = ss.getSheetByName(TAB_WORKPLAN);
  if (!sh) return { success: false, message: 'sheet not found' };
  var data = sh.getDataRange().getValues();
  var hdr  = data[0];
  var idCol = hdr.indexOf('WorkplanID');
  var stCol = hdr.indexOf('Status');
  for (var i = 1; i < data.length; i++) {
    if (data[i][idCol] === p.workplanID) {
      sh.getRange(i+1, stCol+1).setValue('DELETED');
      return { success: true };
    }
  }
  return { success: false, message: 'not found' };
}

// ════════════════════════════════════════════════════════════════
// ACTIVITY MASTER — list / upsert
// ════════════════════════════════════════════════════════════════
function act_list(p) {
  var ss = SpreadsheetApp.openById(PCC_SHEET_ID);
  var sh = ss.getSheetByName(TAB_ACTIVITIES);
  if (!sh) return { success: false, message: TAB_ACTIVITIES + ' not found' };
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return { success: true, rows: [] };
  var hdr = data[0];
  var rows = data.slice(1).map(function(r){
    var o = {};
    hdr.forEach(function(h, i){ o[h] = r[i]; });
    return o;
  });
  return { success: true, rows: rows, count: rows.length };
}

function act_upsert(p) {
  // Only MD/admin should call this
  var ss   = SpreadsheetApp.openById(PCC_SHEET_ID);
  var sh   = ss.getSheetByName(TAB_ACTIVITIES);
  if (!sh) return { success: false, message: TAB_ACTIVITIES + ' not found' };
  var data = sh.getDataRange().getValues();
  var hdr  = data[0];
  // Use Nature+Type as composite natural key
  var nCol = hdr.indexOf('Nature of Work');
  var tCol = hdr.indexOf('Type of Work');
  if (nCol < 0 || tCol < 0) return { success: false, message: 'Required columns missing' };
  for (var i = 1; i < data.length; i++) {
    if (data[i][nCol] === p.row['Nature of Work'] && data[i][tCol] === p.row['Type of Work']) {
      var rowValues = hdr.map(function(h){ return p.row[h] != null ? p.row[h] : data[i][hdr.indexOf(h)]; });
      sh.getRange(i+1, 1, 1, hdr.length).setValues([rowValues]);
      return { success: true, mode: 'updated' };
    }
  }
  // New row
  var newRow = hdr.map(function(h){ return p.row[h] != null ? p.row[h] : ''; });
  sh.appendRow(newRow);
  return { success: true, mode: 'inserted' };
}

// ════════════════════════════════════════════════════════════════
// Helper — ensure tab exists with given header row
// ════════════════════════════════════════════════════════════════
function _ensureSheet(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return sh;
  }
  // Add any missing header columns at the end
  var existing = sh.getRange(1, 1, 1, sh.getLastColumn() || 1).getValues()[0];
  headers.forEach(function(h){
    if (existing.indexOf(h) < 0) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue(h).setFontWeight('bold');
    }
  });
  return sh;
}
