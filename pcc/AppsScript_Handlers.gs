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
  return _replaceProjectRows('Workplan', [
    'Project Code', 'Activity Code', 'Description', 'Unit',
    'BOQ Qty', 'Month', 'Planned Qty',
  ], p.projectCode, p.rows);
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
  // Save WBS nodes
  var nodesResp = _replaceProjectRows('WBS', [
    'Project Code', 'WBS Code', 'WBS Name',
  ], p.projectCode, (p.nodes || []).map(function(n) {
    return {
      'Project Code': p.projectCode,
      'WBS Code':     n.wbsCode,
      'WBS Name':     n.wbsName,
    };
  }));

  // Save Activities
  _replaceProjectRows('Activities', [
    'Project Code', 'Activity', 'WBS Code', 'Cost Code', 'Unit', 'BOQ Qty',
  ], p.projectCode, (p.activities || []).map(function(a) {
    return {
      'Project Code': p.projectCode,
      'Activity':     a.name,
      'WBS Code':     a.wbsCode,
      'Cost Code':    a.costCode,
      'Unit':         a.unit,
      'BOQ Qty':      a.boqQty,
    };
  }));

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    message: 'Saved ' + (p.nodes || []).length + ' WBS nodes and ' + (p.activities || []).length + ' activities',
  })).setMimeType(ContentService.MimeType.JSON);
}
