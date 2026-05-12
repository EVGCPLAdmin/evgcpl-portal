/**
 * ════════════════════════════════════════════════════════════════
 *  Project Cost Control — Multi-page Backend Handlers
 *  Add these 7 actions into the EXISTING doPost switch in your
 *  Apps Script project (the one bound to sheet
 *  1dQow9nD4e0qVOSfpwEWQmPTuhF3FW_8r1oK5dMjJlRE).
 *
 *  Existing doPost pattern (DON'T duplicate):
 *    function doPost(e) {
 *      var data = JSON.parse(e.postData.contents);
 *      var action = data.action;
 *      switch(action) {
 *        case 'saveProjectSetup': ...
 *        case 'saveBOQ':          ...
 *        case 'saveWBS':          ...
 *        case 'saveActivities':   ...
 *
 *        // ──── ADD THESE 7 BELOW ────
 *        case 'saveWorkplan':         return saveWorkplan(data.payload);
 *        case 'saveManpower':         return saveManpower(data.payload);
 *        case 'saveMachinery':        return saveMachinery(data.payload);
 *        case 'saveMaterials':        return saveMaterials(data.payload);
 *        case 'saveOverheads':        return saveOverheads(data.payload);
 *        case 'saveVariations':       return saveVariations(data.payload);
 *        case 'submitBudgetApproval': return submitBudgetApproval(data.payload);
 *      }
 *    }
 * ═══════════════════════════════════════════════════════════════ */

var PCC_SHEET_ID = '1dQow9nD4e0qVOSfpwEWQmPTuhF3FW_8r1oK5dMjJlRE';

/**
 * Generic per-project replace pattern.
 * Clears all rows where col A = projectCode, then appends new rows.
 * Auto-creates tab with header row on first save.
 */
function _replaceProjectRows(tabName, headers, projectCode, rows) {
  var ss = SpreadsheetApp.openById(PCC_SHEET_ID);
  var sh = ss.getSheetByName(tabName);
  if (!sh) {
    sh = ss.insertSheet(tabName);
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setBackground('#1e8035').setFontColor('#ffffff').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  // Ensure headers match (in case sheet existed but with old headers)
  var existingHeaders = sh.getRange(1, 1, 1, Math.max(headers.length, sh.getLastColumn() || 1)).getValues()[0];
  var headersDiffer = headers.some(function(h, i) { return existingHeaders[i] !== h; });
  if (headersDiffer) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  // Clear rows for this project (col A)
  var lastRow = sh.getLastRow();
  if (lastRow > 1) {
    var codes = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    var rowsToDelete = [];
    for (var i = 0; i < codes.length; i++) {
      if (String(codes[i][0]) === String(projectCode)) rowsToDelete.push(i + 2);
    }
    rowsToDelete.reverse().forEach(function(r) { sh.deleteRow(r); });
  }

  // Append fresh rows
  if (rows && rows.length) {
    var data = rows.map(function(r) {
      return headers.map(function(h) { return r[h] != null ? r[h] : ''; });
    });
    sh.getRange(sh.getLastRow() + 1, 1, data.length, headers.length).setValues(data);
  }
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    message: 'Saved ' + (rows ? rows.length : 0) + ' rows to ' + tabName,
    rowCount: rows ? rows.length : 0,
  })).setMimeType(ContentService.MimeType.JSON);
}

// ─── 1. WORKPLAN ───
function saveWorkplan(p) {
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
  return _replaceProjectRows('Manpower_Plan', [
    'Project Code', 'Activity Code', 'Type',
    'Workers', 'Days', 'Daily Rate', 'Productivity',
    'Buffer %', 'Indirect %',
  ], p.projectCode, p.rows);
}

// ─── 3. MACHINERY ───
function saveMachinery(p) {
  return _replaceProjectRows('Machinery_Plan', [
    'Project Code', 'Activity Code', 'Equipment', 'Mode',
    'Hrs/Day', 'Days', 'Rate', 'Diesel Cost', 'Mob Demob', 'Idle %',
  ], p.projectCode, p.rows);
}

// ─── 4. MATERIALS ───
function saveMaterials(p) {
  return _replaceProjectRows('Material_Plan', [
    'Project Code', 'Activity Code', 'Material', 'Unit',
    'BOQ Qty', 'Wastage %', 'Unit Rate', 'Procurement %',
  ], p.projectCode, p.rows);
}

// ─── 5. OVERHEADS ───
function saveOverheads(p) {
  return _replaceProjectRows('Overheads', [
    'Project Code', 'Type', 'Category', 'Description',
    'Monthly Cost', 'Months',
  ], p.projectCode, p.rows);
}

// ─── 6. VARIATIONS ───
function saveVariations(p) {
  // Variations tab uses V-ID as primary key; project-scoped replace works.
  return _replaceProjectRows('Variations', [
    'Project Code', 'V-ID', 'Date', 'Description', 'Type',
    'Status', 'Internal', 'Client',
    'Cost Impact', 'Time Impact',
  ], p.projectCode, p.rows);
}

// ─── 7. BUDGET APPROVAL ───
function submitBudgetApproval(p) {
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
// Single-row upsert. Generates Project Code if missing using formula
// EG{YY}{G/P}{NNNN} where G=Gov, P=Pvt. Series increments based on existing rows.
function saveProjectSetup(p) {
  var ss = SpreadsheetApp.openById(PCC_SHEET_ID);
  var sh = ss.getSheetByName('Project');
  if (!sh) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false, message: 'Project tab not found',
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var col = function(name) { return headers.indexOf(name) + 1; }; // 1-indexed; 0 if absent

  // Generate Project Code if blank (NEW project)
  var projectCode = (p['Project Code'] || '').trim();
  if (!projectCode) {
    var yy = String((p['Awarded Date'] ? new Date(p['Awarded Date']).getFullYear() : new Date().getFullYear())).slice(-2);
    var typeChar = (p['Private / Govt'] || '').toUpperCase().charAt(0) || 'P';
    var existing = sh.getLastRow() > 1 ? sh.getRange(2, col('Project Code'), sh.getLastRow() - 1, 1).getValues() : [];
    var prefix = 'EG' + yy + typeChar;
    var maxNum = 0;
    existing.forEach(function(r) {
      var v = String(r[0] || '');
      if (v.indexOf(prefix) === 0) {
        var n = parseInt(v.slice(prefix.length), 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
    });
    projectCode = prefix + ('0000' + (maxNum + 1)).slice(-4);
    p['Project Code'] = projectCode;
  }

  // Find existing row for this code
  var pcCol = col('Project Code');
  var lastRow = sh.getLastRow();
  var existingRow = 0;
  if (lastRow > 1 && pcCol > 0) {
    var codes = sh.getRange(2, pcCol, lastRow - 1, 1).getValues();
    for (var i = 0; i < codes.length; i++) {
      if (String(codes[i][0]) === projectCode) { existingRow = i + 2; break; }
    }
  }

  // Build the row in order of existing headers
  var row = headers.map(function(h) { return p[h] != null ? p[h] : ''; });

  if (existingRow) {
    sh.getRange(existingRow, 1, 1, headers.length).setValues([row]);
  } else {
    sh.appendRow(row);
  }

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    projectCode: projectCode,
    message: existingRow ? 'Project updated' : 'Project created',
  })).setMimeType(ContentService.MimeType.JSON);
}

// ─── 2. BOQ ───
function saveBOQ(p) {
  return _replaceProjectRows('BOQ', [
    'Project Code', 'S No', 'Description', 'Unit', 'Qty', 'Rate', 'Amount',
  ], p.projectCode, (p.rows || []).map(function(r) {
    return {
      'Project Code': p.projectCode,
      'S No':         r.sno,
      'Description':  r.desc,
      'Unit':         r.unit,
      'Qty':          r.qty,
      'Rate':         r.rate,
      'Amount':       r.amt,
    };
  }));
}

// ─── 3. WBS ─── (replaces both WBS nodes & Activities for the project)
function saveWBS(p) {
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
    'Project Code', 'UUID', 'WBS Code', 'WBS Name', 'Updated At'
  ];

  var wbsRows = (p.nodes || []).map(function(n) {
    var finalUuid = (n.uuid && String(n.uuid).trim()) || Utilities.getUuid();
    var finalCode = (n.wbsCode && String(n.wbsCode).trim()) ||
                    _formatWbsCode(projectCode, nextCodeNum++);
    // Register both tempId and uuid → finalUuid in the refMap so activities can resolve either
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
