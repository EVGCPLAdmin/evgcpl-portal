/**
 * ════════════════════════════════════════════════════════════════
 *  Project Cost Control — Multi-page Backend Handlers
 *  ────────────────────────────────────────────────────────────────
 *  Deploy alongside Router.gs. Router.gs receives the POST, parses
 *  the JSON body, and dispatches to one of these handlers with the
 *  full body object as `p`.
 *
 *  Frontend POST body shape (sent by API.scriptCall in /pcc/api.js):
 *    {
 *      action: 'saveProjectSetup',
 *      'Project Code': '...',           ← fields spread at top level
 *      'Project Name': '...',
 *      ...
 *    }
 *
 *  In Router.gs:
 *    case 'saveProjectSetup':   return saveProjectSetup(body);
 *    case 'saveBOQ':            return saveBOQ(body);
 *    case 'saveWBS':            return saveWBS(body);
 *    ...
 *
 *  These handlers are defensive:
 *    • p = p || {}  → never crashes on undefined
 *    • Auto-unwraps legacy { payload: {...} } shape if someone's
 *      old doPost still calls saveXxx(data.payload)
 * ═══════════════════════════════════════════════════════════════ */

var PCC_SHEET_ID = '1dQow9nD4e0qVOSfpwEWQmPTuhF3FW_8r1oK5dMjJlRE';

// Normalizer used at the top of every handler:
//   • Returns {} if p is null/undefined (no crash)
//   • Auto-unwraps p.payload if a legacy doPost wrapped the call
function _norm(p) {
  if (!p) return {};
  if (p.payload && typeof p.payload === 'object' && !Array.isArray(p.payload)) {
    // Merge top-level + payload, with payload winning. Preserves action/projectCode at top.
    var merged = {};
    Object.keys(p).forEach(function(k) { if (k !== 'payload') merged[k] = p[k]; });
    Object.keys(p.payload).forEach(function(k) { merged[k] = p.payload[k]; });
    return merged;
  }
  return p;
}

/**
 * Generic per-project replace pattern.
 * ────────────────────────────────────────────────────────────────
 * RULES:
 *   1. NEVER overwrite row 1 (headers). Headers are owned by the sheet.
 *   2. If the sheet doesn't exist yet → create it with the supplied headers.
 *   3. If the sheet exists → read its actual headers and map data by column name.
 *      Any column in the sheet that we don't have a value for → left blank.
 *      Any field we have that the sheet doesn't have a column for → silently skipped.
 *   4. Clears only rows where col A = projectCode (never touches other projects).
 */
function _replaceProjectRows(tabName, defaultHeaders, projectCode, rows) {
  rows = rows || [];
  var ss = SpreadsheetApp.openById(PCC_SHEET_ID);
  var sh = ss.getSheetByName(tabName);

  // ── Create tab if it doesn't exist ──────────────────────────
  if (!sh) {
    sh = ss.insertSheet(tabName);
    sh.getRange(1, 1, 1, defaultHeaders.length)
      .setValues([defaultHeaders])
      .setBackground('#1e8035')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    sh.setFrozenRows(1);
    Logger.log('[_replaceProjectRows] Created new tab: ' + tabName);
  }

  // ── Read EXISTING headers — never overwrite them ─────────────
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var existingHeaders = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  // Build column-name → 0-based-index map from whatever is in row 1
  var colIndex = {};
  existingHeaders.forEach(function(h, i) {
    if (h && String(h).trim()) colIndex[String(h).trim()] = i;
  });

  // ── Clear rows for this project (col A = projectCode) ────────
  var lastRow = sh.getLastRow();
  if (lastRow > 1) {
    var codes = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    var toDelete = [];
    for (var i = 0; i < codes.length; i++) {
      if (String(codes[i][0]).trim() === String(projectCode).trim()) {
        toDelete.push(i + 2);
      }
    }
    // Delete from bottom up so row numbers stay valid
    toDelete.reverse().forEach(function(r) { sh.deleteRow(r); });
  }

  // ── Append fresh rows, mapped to existing column positions ───
  if (rows.length > 0) {
    var numCols = existingHeaders.length;
    var data = rows.map(function(rowObj) {
      var out = new Array(numCols).fill('');
      Object.keys(rowObj).forEach(function(field) {
        var idx = colIndex[field];
        if (idx !== undefined) {
          var v = rowObj[field];
          out[idx] = (v === null || v === undefined) ? '' : v;
        }
        // Fields not in the sheet are silently skipped — never adds a column
      });
      return out;
    });
    sh.getRange(sh.getLastRow() + 1, 1, data.length, numCols).setValues(data);
  }

  return rows.length;  // caller wraps in _wrap() for the response
}

// ─── 1. WORKPLAN ───
function saveWorkplan(p) {
  p = _norm(p);  // Defensive + auto-unwrap legacy { payload: {...} }
  // Schema: one row per activity (NOT per month).
  // WBS Code · Nature of Work · Activity · UoM · Qty · Start · End · Duration · % Weight · Responsibility
  // Plus provenance fields linking back to M_PL_1_Activities (Master UUID, Task Code, CheckSum)
  // and a server-stamped Updated At.
  var nowIso = new Date().toISOString();
  var rows = (p.rows || []).map(function(r) {
    return {
      'Project Code':   p.projectCode,
      'WBS Code':       r.wbsCode || '',
      'Nature of Work': r.natureOfWork || '',
      'Activity':       r.activity || '',
      'UoM':            r.unit || '',
      'Qty':            r.qty != null ? Number(r.qty) || 0 : 0,
      'Start':          r.start || '',
      'End':            r.end || '',
      'Duration':       r.duration != null ? Number(r.duration) || 0 : 0,
      '% Weight':       r.weight   != null ? Number(r.weight)   || 0 : 0,
      'Responsibility': r.responsibility || '',
      'Master UUID':    r.masterUuid || '',
      'Task Code':      r.taskCode   || '',
      'CheckSum':       r.checkSum   || '',
      'Updated At':     nowIso,
    };
  });
  return _replaceProjectRows('Workplan', [
    'Project Code', 'WBS Code', 'Nature of Work', 'Activity',
    'UoM', 'Qty', 'Start', 'End', 'Duration', '% Weight', 'Responsibility',
    'Master UUID', 'Task Code', 'CheckSum', 'Updated At',
  ], p.projectCode, rows);
}

// ─── 2. MANPOWER ───
function saveManpower(p) {
  p = _norm(p);  // Defensive + auto-unwrap legacy { payload: {...} }
  return _replaceProjectRows('Manpower_Plan', [
    'Project Code', 'Activity Code', 'Type',
    'Workers', 'Days', 'Daily Rate', 'Productivity',
    'Buffer %', 'Indirect %',
  ], p.projectCode, p.rows);
}

// ─── 3. MACHINERY ───
function saveMachinery(p) {
  p = _norm(p);  // Defensive + auto-unwrap legacy { payload: {...} }
  return _replaceProjectRows('Machinery_Plan', [
    'Project Code', 'Activity Code', 'Equipment', 'Mode',
    'Hrs/Day', 'Days', 'Rate', 'Diesel Cost', 'Mob Demob', 'Idle %',
  ], p.projectCode, p.rows);
}

// ─── 4. MATERIALS ───
function saveMaterials(p) {
  p = _norm(p);  // Defensive + auto-unwrap legacy { payload: {...} }
  return _replaceProjectRows('Material_Plan', [
    'Project Code', 'Activity Code', 'Material', 'Unit',
    'BOQ Qty', 'Wastage %', 'Unit Rate', 'Procurement %',
  ], p.projectCode, p.rows);
}

// ─── 5. OVERHEADS ───
function saveOverheads(p) {
  p = _norm(p);  // Defensive + auto-unwrap legacy { payload: {...} }
  return _replaceProjectRows('Overheads', [
    'Project Code', 'Type', 'Category', 'Description',
    'Monthly Cost', 'Months',
  ], p.projectCode, p.rows);
}

// ─── 6. VARIATIONS ───
function saveVariations(p) {
  p = _norm(p);  // Defensive + auto-unwrap legacy { payload: {...} }
  // Variations tab uses V-ID as primary key; project-scoped replace works.
  return _replaceProjectRows('Variations', [
    'Project Code', 'V-ID', 'Date', 'Description', 'Type',
    'Status', 'Internal', 'Client',
    'Cost Impact', 'Time Impact',
  ], p.projectCode, p.rows);
}

// ─── 7. BUDGET APPROVAL ───
function submitBudgetApproval(p) {
  p = _norm(p);  // Defensive + auto-unwrap legacy { payload: {...} }
  var ss = SpreadsheetApp.openById(PCC_SHEET_ID);
  var sh = ss.getSheetByName('BudgetApprovals');
  if (!sh) {
    sh = ss.insertSheet('BudgetApprovals');
    sh.getRange(1, 1, 1, 5).setValues([[
      'Project Code', 'Submitted At', 'Submitted By', 'Total Budget', 'Status',
    ]]).setBackground('#1e8035').setFontColor('#ffffff').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  sh.appendRow([
    p.projectCode,
    p.submittedAt || new Date().toISOString(),
    p.submittedBy || 'Portal User',
    p.total || '',
    'Pending Approval',
  ]);
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    message: 'Budget submitted for approval',
  })).setMimeType(ContentService.MimeType.JSON);
}

/* ════════════════════════════════════════════════════════════════
 *  STEPS 1–3 HANDLERS (added in the multipage merge)
 *  Add to the same doPost switch:
 *    case 'saveProjectSetup': return saveProjectSetup(data.payload);
 *    case 'saveBOQ':          return saveBOQ(data.payload);
 *    case 'saveWBS':          return saveWBS(data.payload);
 * ════════════════════════════════════════════════════════════════ */

// ─── 1. PROJECT SETUP ───
// Single-row upsert. Auto-generates UUID, Series (max+1), Project Code (EG+YY+P/G+Series).
// Normalises Active/Inactive? to ACTIVE/INACTIVE. Stamps Timestamp. Never overwrites headers.
function saveProjectSetup(p) {
  p = _norm(p);
  var ss = SpreadsheetApp.openById(PCC_SHEET_ID);
  var sh = ss.getSheetByName('Project');
  if (!sh) return ContentService.createTextOutput(JSON.stringify({
    success: false, message: 'Project tab not found'
  })).setMimeType(ContentService.MimeType.JSON);

  // ── Read existing headers – NEVER overwrite ──
  var lastCol  = Math.max(sh.getLastColumn(), 1);
  var headers  = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var colIndex = {};
  headers.forEach(function(h, i) { var k = String(h || '').trim(); if (k) colIndex[k] = i; });

  // ── Series: max + 1 for new projects ──
  var projectCode = String(p['Project Code'] || '').trim();
  var isNew = !projectCode;
  if (isNew) {
    var seriesFromP = parseInt(String(p['Series'] || '0'), 10) || 0;
    if (!seriesFromP) {
      var seriesMax = 0;
      var lastR = sh.getLastRow();
      if (lastR > 1 && colIndex['Series'] !== undefined) {
        sh.getRange(2, colIndex['Series'] + 1, lastR - 1, 1).getValues().forEach(function(r) {
          var n = parseInt(String(r[0] || '0'), 10);
          if (!isNaN(n) && n > seriesMax) seriesMax = n;
        });
      }
      seriesFromP = seriesMax + 1;
    }
    p['Series'] = seriesFromP;
    // Project Code = EG + YY + P/G + Series (4-digit)
    var yy       = String(p['Awarded Date'] ? new Date(p['Awarded Date']).getFullYear() : new Date().getFullYear()).slice(-2);
    var typeChar = String(p['Private / Govt'] || '').toUpperCase().charAt(0) || 'P';
    projectCode  = 'EG' + yy + typeChar + ('0000' + seriesFromP).slice(-4);
    p['Project Code'] = projectCode;
  }

  // ── UUID: generate if missing ──
  var uuid = String(p['UUID'] || '').trim();
  if (!uuid) {
    var lastR2 = sh.getLastRow();
    if (lastR2 > 1 && colIndex['Project Code'] !== undefined && colIndex['UUID'] !== undefined) {
      var pcVals   = sh.getRange(2, colIndex['Project Code'] + 1, lastR2 - 1, 1).getValues();
      var uuidVals = sh.getRange(2, colIndex['UUID'] + 1,         lastR2 - 1, 1).getValues();
      for (var i = 0; i < pcVals.length; i++) {
        if (String(pcVals[i][0]).trim() === projectCode && String(uuidVals[i][0]).trim()) {
          uuid = String(uuidVals[i][0]).trim(); break;
        }
      }
    }
    if (!uuid) uuid = Utilities.getUuid();
  }
  p['UUID'] = uuid;

  // ── ACTIVE / INACTIVE normalise ──
  var activeVal = String(p['Active/Inactive?'] || p['Active/Inactive'] || 'ACTIVE').trim().toUpperCase();
  if (activeVal !== 'INACTIVE') activeVal = 'ACTIVE';
  p['Active/Inactive?'] = activeVal;
  p['Active/Inactive']  = activeVal;

  // ── Timestamp: "12 May 2026 14:28" ──
  var now = new Date();
  var mths = ['January','February','March','April','May','June',
              'July','August','September','October','November','December'];
  var ts = now.getDate() + ' ' + mths[now.getMonth()] + ' ' + now.getFullYear() + ' ' +
           ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
  p['Timestamp'] = ts;

  // ── UserEmail / SystemEmail: ensure both set ──
  if (!p['UserEmail']   && p['SystemEmail']) p['UserEmail']   = p['SystemEmail'];
  if (!p['SystemEmail'] && p['UserEmail'])   p['SystemEmail'] = p['UserEmail'];

  // ── Find existing row ──
  var existingRow = 0;
  var lastR3 = sh.getLastRow();
  if (lastR3 > 1 && colIndex['Project Code'] !== undefined) {
    var pcV = sh.getRange(2, colIndex['Project Code'] + 1, lastR3 - 1, 1).getValues();
    for (var j = 0; j < pcV.length; j++) {
      if (String(pcV[j][0]).trim() === projectCode) { existingRow = j + 2; break; }
    }
  }

  // ── Fields that formula columns — NEVER write to these from code ──
  // These are computed by the sheet itself (formulas). Writing a value
  // would replace the formula with a static string.
  var NEVER_WRITE = ['Project Code'];

  // ── Fields protected after first write — skip on updates ─────
  // Written once at row creation; never overwritten on subsequent saves.
  var WRITE_ONCE = ['UUID', 'Series', 'UserEmail', 'SystemEmail'];

  if (existingRow) {
    // ── UPDATE: cell-by-cell — only changed, non-protected cells ──
    // This leaves formula cells and protected cells completely untouched.
    headers.forEach(function(h, i) {
      var k = String(h || '').trim();
      if (!k) return;

      // Formula columns: never write
      if (NEVER_WRITE.indexOf(k) >= 0) return;

      // Write-once columns: skip on updates
      if (WRITE_ONCE.indexOf(k) >= 0) return;

      // Active/Inactive: normalise
      if (k === 'Active/Inactive?' || k === 'Active/Inactive') {
        sh.getRange(existingRow, i + 1).setValue(activeVal);
        return;
      }

      // Timestamp: always server-stamp on every save
      if (k === 'Timestamp') {
        sh.getRange(existingRow, i + 1).setValue(ts);
        return;
      }

      // All other fields: only write if non-empty — never erase existing data
      var submitted = p[k];
      var submittedStr = (submitted !== null && submitted !== undefined)
                          ? String(submitted).trim() : '';
      if (submittedStr !== '') {
        sh.getRange(existingRow, i + 1).setValue(submitted);
      }
      // If blank: leave the cell alone entirely
    });

  } else {
    // ── CREATE: append a full row ─────────────────────────────────
    // NEVER_WRITE columns get an empty string — the sheet formula will compute them.
    // WRITE_ONCE columns get their generated values (UUID, Series).
    var newRow = headers.map(function(h) {
      var k = String(h || '').trim();
      if (!k) return '';
      if (NEVER_WRITE.indexOf(k) >= 0) return '';    // let sheet formula handle
      if (k === 'UUID')        return uuid;
      if (k === 'Series')      return p['Series'];
      if (k === 'Timestamp')   return ts;
      if (k === 'UserEmail')   return p['UserEmail']   || '';
      if (k === 'SystemEmail') return p['SystemEmail'] || '';
      if (k === 'Active/Inactive?' || k === 'Active/Inactive') return activeVal;
      var v = p[k];
      return (v !== null && v !== undefined) ? v : '';
    });
    sh.appendRow(newRow);
  }

  return ContentService.createTextOutput(JSON.stringify({
    success: true, projectCode: projectCode, uuid: uuid,
    series: p['Series'], timestamp: ts,
    message: existingRow ? 'Project updated' : 'Project created',
  })).setMimeType(ContentService.MimeType.JSON);
}

// ─── 2. BOQ ───
function saveBOQ(p) {
  p = _norm(p);  // Defensive + auto-unwrap legacy { payload: {...} }
  var projectCode = String(p.projectCode || '').trim();
  var projectUuid = String(p.projectUuid || '').trim(); // for CheckSum = Project.UUID
  var nowIso = new Date().toISOString();
  var assignedRows = [];

  var rows = (p.rows || []).map(function(r, idx) {
    // Preserve existing UUID; generate one for new rows
    var uuid = String(r.uuid || '').trim() || Utilities.getUuid();
    // CheckSum links this BOQ row to the Project (Project.UUID)
    var checkSum = String(r.checkSum || '').trim() || projectUuid;
    assignedRows.push({ index: idx, uuid: uuid, checkSum: checkSum });
    return {
      'Project Code': projectCode,
      'UUID':         uuid,
      'CheckSum':     checkSum,     // = Project.UUID
      'S No':         r.sno,
      'Description':  r.desc,
      'Unit':         r.unit,
      'Qty':          r.qty,
      'Rate':         r.rate,
      'Amount':       r.amt,
      'Updated At':   nowIso,
    };
  });

  var count = _replaceProjectRows('BOQ', [
    'Project Code', 'UUID', 'CheckSum', 'S No', 'Description', 'Unit', 'Qty', 'Rate', 'Amount', 'Updated At',
  ], projectCode, rows);

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    message: 'Saved ' + rows.length + ' BOQ items',
    assignedRows: assignedRows,  // frontend updates local UUIDs
  })).setMimeType(ContentService.MimeType.JSON);
}

// ─── 3. WBS ─── (replaces both WBS nodes & Activities for the project)
function saveWBS(p) {
  p = _norm(p);  // Defensive + auto-unwrap legacy { payload: {...} }
  // ════════════════════════════════════════════════════════════
  // WBS save with auto-generated UUIDs + WBS Codes + tempId resolution
  // ────────────────────────────────────────────────────────────
  // Frontend sends:
  //   nodes:      [{ uuid?, tempId?, wbsCode?, wbsName }]
  //   activities: [{ parentRef, name, natureOfWork, typeOfWork,
  //                  unit, costCode, boqQty, masterUuid, taskCode }]
  //
  // This handler:
  //   1. For each node without UUID → generates a new UUID + WBS Code
  //   2. Builds a tempId/oldUUID → finalUUID map
  //   3. Writes WBS rows with full schema
  //   4. Replaces activity.parentRef → final UUID → writes as CheckSum
  //   5. Returns assignedNodes[] so frontend can update its local state
  // ════════════════════════════════════════════════════════════

  var projectCode = String(p.projectCode || '').trim();
  if (!projectCode) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false, message: 'Missing projectCode'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var nowIso = new Date().toISOString();
  var nextCodeNum = _getNextWbsCodeNum(projectCode);

  // Build refMap: tempId → finalUUID, AND existingUUID → existingUUID (passthrough)
  var refMap = {};
  var assignedNodes = [];

  var wbsHeaders = [
    'Project Code', 'UUID', 'WBS Code', 'WBS Name', 'CheckSum', 'Updated At'
  ];

  var wbsRows = (p.nodes || []).map(function(n) {
    var finalUuid = (n.uuid && String(n.uuid).trim()) || Utilities.getUuid();
    var finalCode = (n.wbsCode && String(n.wbsCode).trim()) ||
                    _formatWbsCode(projectCode, nextCodeNum++);
    var boqRef    = String(n.boqRef || '').trim(); // = parent BOQ.UUID → WBS.CheckSum
    if (n.tempId) refMap[String(n.tempId).trim()] = finalUuid;
    if (n.uuid)   refMap[String(n.uuid).trim()]   = finalUuid;
    assignedNodes.push({
      tempId:  n.tempId || '',
      uuid:    finalUuid,
      wbsCode: finalCode,
      wbsName: n.wbsName || '',
    });
    return {
      'Project Code': projectCode,
      'UUID':         finalUuid,
      'WBS Code':     finalCode,
      'WBS Name':     n.wbsName || '',
      'CheckSum':     boqRef,        // ← WBS links to BOQ via this
      'Updated At':   nowIso,
    };
  });

  _replaceProjectRows('WBS', wbsHeaders, projectCode, wbsRows);

  // Now Activities — resolve parentRef → real UUID via refMap
  var actHeaders = [
    'Project Code', 'Activity', 'WBS Code', 'CheckSum',
    'Nature of Work', 'Type of Work', 'Unit', 'Cost Code',
    'BOQ Qty', 'Master UUID', 'Task Code', 'Updated At'
  ];

  var actRows = (p.activities || []).map(function(a) {
    var parentRef = String(a.parentRef || '').trim();
    var resolvedUuid = refMap[parentRef] || parentRef; // fall back to raw if not in map
    // Find the WBS Code for this resolved UUID (from the rows we just built)
    var parent = wbsRows.filter(function(r) { return r['UUID'] === resolvedUuid; })[0];
    var wbsCode = parent ? parent['WBS Code'] : '';
    return {
      'Project Code':   projectCode,
      'Activity':       a.name || '',
      'WBS Code':       wbsCode,
      'CheckSum':       resolvedUuid,      // = parent WBS.UUID
      'Nature of Work': a.natureOfWork || '',
      'Type of Work':   a.typeOfWork   || '',
      'Unit':           a.unit         || '',
      'Cost Code':      a.costCode     || '',
      'BOQ Qty':        Number(a.boqQty) || 0,
      'Master UUID':    a.masterUuid   || '',
      'Task Code':      a.taskCode     || '',
      'Updated At':     nowIso,
    };
  });

  _replaceProjectRows('Activities', actHeaders, projectCode, actRows);

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    message: 'Saved ' + wbsRows.length + ' WBS rows and ' + actRows.length + ' activities',
    assignedNodes: assignedNodes,   // [{ tempId, uuid, wbsCode, wbsName }] — frontend uses to update local state
  })).setMimeType(ContentService.MimeType.JSON);
}

// ── Helpers for saveWBS ─────────────────────────────────────────

// Find the next available WBS Code number for a project.
// Scans existing rows on the WBS tab and picks max+1.
function _getNextWbsCodeNum(projectCode) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('WBS');
    if (!sheet || sheet.getLastRow() < 2) return 1;
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var pcIdx   = headers.indexOf('Project Code');
    var codeIdx = headers.indexOf('WBS Code');
    if (pcIdx < 0 || codeIdx < 0) return 1;
    var max = 0;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][pcIdx]) === projectCode) {
        var code = String(data[i][codeIdx] || '');
        var m = code.match(/(\d+)/);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
    }
    return max + 1;
  } catch (e) {
    return 1;
  }
}

// Format a WBS Code: e.g. "WBS-001", "WBS-002"
// Project Code prefix is omitted — codes are scoped per-project via the Project Code column.
function _formatWbsCode(projectCode, num) {
  var n = String(num);
  while (n.length < 3) n = '0' + n;
  return 'WBS-' + n;
}

// ─── DIAGNOSTIC: Read sheet headers ────────────────────────────
// Call with action: 'getSheetHeaders' to see exactly what columns
// exist on each tab — used to map saveWBS / Activities correctly.
// Returns: { WBS: [...headers], Activities: [...headers], ... }
function getSheetHeaders(p) {
  p = _norm(p);
  var ss = SpreadsheetApp.openById(PCC_SHEET_ID);
  var tabs = (p.tabs && p.tabs.length) ? p.tabs
    : ['Project', 'BOQ', 'WBS', 'Activities', 'Workplan',
       'Manpower_Plan', 'Machinery_Plan', 'Material_Plan',
       'Overheads', 'Variations', 'CostCode', 'M_PL_1_Activities'];
  var result = {};
  tabs.forEach(function(tabName) {
    var sh = ss.getSheetByName(tabName);
    if (!sh) { result[tabName] = null; return; }
    var lastCol = sh.getLastColumn();
    if (lastCol < 1) { result[tabName] = []; return; }
    result[tabName] = sh.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function(h) { return String(h || '').trim(); })
      .filter(function(h, i, arr) {
        // include all up to last non-empty
        return arr.slice(i).some(function(x) { return x !== ''; });
      });
  });
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    headers: result,
    sheetId: PCC_SHEET_ID,
  })).setMimeType(ContentService.MimeType.JSON);
}
