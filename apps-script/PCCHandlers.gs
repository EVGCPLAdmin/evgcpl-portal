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

  // ── Read EXISTING headers — NEVER overwrite ──────────────────
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var existingHeaders = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var colIndex = {};
  existingHeaders.forEach(function(h, i) {
    if (h && String(h).trim()) colIndex[String(h).trim()] = i;
  });

  // ── Detect ARRAYFORMULA-protected columns ─────────────────────
  // Row 2 (first data row) — any cell with a formula is ARRAYFORMULA-protected.
  // We MUST NOT write to these columns; the sheet formula owns them.
  var formulaProtected = {};  // 0-based col index → true
  if (sh.getLastRow() >= 2) {
    try {
      var row2Formulas = sh.getRange(2, 1, 1, lastCol).getFormulas()[0];
      row2Formulas.forEach(function(f, i) {
        if (f && String(f).trim().charAt(0) === '=') {
          formulaProtected[i] = true;
          Logger.log('[_replaceProjectRows] Formula-protected col [' + i + ']: ' + existingHeaders[i]);
        }
      });
    } catch (e) {
      Logger.log('[_replaceProjectRows] Could not read formulas: ' + e);
    }
  }

  // ── Clear rows for this project (match on CheckSum or Project Code col) ──
  // Try CheckSum column first (AppSheet Ref key), fall back to Project Code
  var matchColIdx = colIndex['CheckSum'] !== undefined ? colIndex['CheckSum']
                  : colIndex['Project Code'] !== undefined ? colIndex['Project Code']
                  : 0;  // default to col A

  var lastRow = sh.getLastRow();
  if (lastRow > 1) {
    var matchVals = sh.getRange(2, matchColIdx + 1, lastRow - 1, 1).getValues();
    var toDelete = [];
    for (var i = 0; i < matchVals.length; i++) {
      var cellVal = String(matchVals[i][0] || '').trim();
      if (cellVal === String(projectCode).trim()) toDelete.push(i + 2);
    }
    toDelete.reverse().forEach(function(r) { sh.deleteRow(r); });
  }

  // ── Append fresh rows (ARRAYFORMULA-safe block writes) ────────
  // For each new row:
  //   1. Find all contiguous blocks of writable (non-formula) columns
  //   2. Write each block as a single setValues call
  //   3. Formula columns are never touched — ARRAYFORMULA fills them
  if (rows.length > 0) {
    rows.forEach(function(rowObj) {
      // Map field values to column positions
      var cellValues = new Array(lastCol).fill('');
      Object.keys(rowObj).forEach(function(field) {
        var idx = colIndex[field];
        if (idx !== undefined && !formulaProtected[idx]) {
          var v = rowObj[field];
          cellValues[idx] = (v === null || v === undefined) ? '' : v;
        }
      });

      var newRowNum = sh.getLastRow() + 1;

      // Build contiguous writable blocks (skip formula-protected columns)
      var blocks = [];
      var blockStart = -1;
      var blockVals  = [];

      for (var ci = 0; ci < lastCol; ci++) {
        if (formulaProtected[ci]) {
          // Flush any pending block
          if (blockStart >= 0) {
            blocks.push({ col: blockStart + 1, vals: blockVals.slice() });
            blockStart = -1; blockVals = [];
          }
        } else {
          if (blockStart < 0) blockStart = ci;
          blockVals.push(cellValues[ci]);
        }
      }
      if (blockStart >= 0) blocks.push({ col: blockStart + 1, vals: blockVals });

      // Write each block (one setValues call per contiguous block)
      blocks.forEach(function(block) {
        if (block.vals.length > 0) {
          sh.getRange(newRowNum, block.col, 1, block.vals.length).setValues([block.vals]);
        }
      });
    });
  }

  return rows.length;
}


// ─── 1. WORKPLAN ───
// Schema: one row per activity in the BOQ → WBS → Activity hierarchy.
// 12 monthly columns (Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec, Jan, Feb, Mar).
// Total Qty is carried from BOQ. Planned Total = sum of monthly columns.
function saveWorkplan(p) {
  p = _norm(p);
  var projectCode = String(p.projectCode || '').trim();
  var fy          = String(p.fy || '').trim();  // e.g. "2026-27"

  var mths = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'];

  var rows = (p.rows || []).map(function(r) {
    var row = {
      'Project Code':    projectCode,
      'FY':              fy,
      'BOQ Item #':      r['BOQ Item #']      || r.boqItemNum || '',
      'BOQ UUID':        r['BOQ UUID']        || r.boqUuid    || '',
      'BOQ Description': r['BOQ Description'] || r.boqDesc    || '',
      'WBS Code':        r['WBS Code']        || r.wbsCode    || '',
      'WBS Name':        r['WBS Name']        || r.wbsName    || '',
      'WBS UUID':        r['WBS UUID']        || r.wbsUuid    || '',
      'Activity':        r['Activity']        || r.activity   || '',
      'Nature of Work':  r['Nature of Work']  || r.nature     || '',
      'Type of Work':    r['Type of Work']    || r.type       || '',
      'UoM':             r['UoM']             || r.unit       || '',
      'Total Qty':       Number(r['Total Qty']  || r.totalQty  || 0),
      'Planned Total':   Number(r['Planned Total']|| r.planTot  || 0),
      '% Weight':        Number(r['% Weight']   || r.weight    || 0),
      'Updated At':      _fmtTimestamp(new Date()),
    };
    // 12 monthly columns
    mths.forEach(function(m) {
      row[m] = Number(r[m] || 0);
    });
    return row;
  });

  var defaultHeaders = [
    'Project Code', 'FY',
    'BOQ Item #', 'BOQ UUID', 'BOQ Description',
    'WBS Code', 'WBS Name', 'WBS UUID',
    'Activity', 'Nature of Work', 'Type of Work', 'UoM',
    'Total Qty', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
    'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar',
    'Planned Total', '% Weight', 'Updated At',
  ];

  _replaceProjectRows('Workplan', defaultHeaders, projectCode, rows);

  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    message: 'Saved ' + rows.length + ' workplan rows for FY ' + fy,
    count:   rows.length,
  })).setMimeType(ContentService.MimeType.JSON);
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
// Schema matches AppSheet PL11_BOQ.
// NEVER WRITE (formula columns — ARRAYFORMULA owns them):
//   BOQ ID · BOQ ID (Description) · Project Code · Project Name
//   Site Name · UserEmail · SystemEmail · Timestamp
// Auto-calculated by backend:
//   UUID (PL-BOQ-{random}), BOQ Item # (sequential per project)
// PCC computes and sends static value for:
//   Amount = Qty × Rate
function saveBOQ(p) {
  p = _norm(p);
  var projectCode = String(p.projectCode || '').trim();
  var projectUuid = String(p.projectUuid || '').trim();
  var projectName = String(p.projectName || '').trim();
  var siteName    = String(p.siteName    || '').trim();
  var userEmail   = String(p.userEmail   || '').trim();
  var systemEmail = String(p.systemEmail || userEmail || '').trim();

  if (!projectCode) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false, message: 'Missing projectCode'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // Timestamp format: "08-Apr-2026 17:17:19"
  var _mths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var _now  = new Date();
  var ts = ('0' + _now.getDate()).slice(-2) + '-' +
           _mths[_now.getMonth()] + '-' + _now.getFullYear() + ' ' +
           ('0' + _now.getHours()).slice(-2)   + ':' +
           ('0' + _now.getMinutes()).slice(-2)  + ':' +
           ('0' + _now.getSeconds()).slice(-2);

  var assignedRows = [];

  // Build row objects with full schema
  var rows = (p.rows || []).map(function(r, idx) {
    var existingUuid = String(r['UUID'] || r.uuid || '').trim();
    // Generate UUID in AppSheet-compatible format: PL-BOQ-{random}
    var uuid = existingUuid || ('PL-BOQ-' + Utilities.getUuid());

    var checkSum = String(r['CheckSum'] || r.checkSum || '').trim() || projectUuid;

    // BOQ Item # — sequential within project (1-based, from the submitted index)
    // Frontend sends them in order; backend reassigns 1, 2, 3... for the project
    var boqItemNum = idx + 1;

    assignedRows.push({
      index:      idx,
      uuid:       uuid,
      checkSum:   checkSum,
      boqItemNum: boqItemNum,
    });

    return {
      // ── Writable data columns ──────────────────────────────────
      'CheckSum':        checkSum,          // = Project UUID (AppSheet Ref key)
      'UUID':            uuid,              // PL-BOQ-{random}
      'BOQ Item #':      boqItemNum,        // Sequential 1,2,3... per project

      // Mapped from CheckSum / active project (PCC writes; AppSheet formula also writes via [CheckSum].[X])
      'Project Code':    p.projectCode      || '',
      'Project Name':    p.projectName      || '',
      'Site Name':       p.siteName         || '',

      // Item fields
      'Description':     String(r['Description']     || r.desc || ''),
      'Unit':            String(r['Unit']             || r.unit || ''),

      // Quantities
      'Qty':             Number(r['Qty']              || r.qty           || 0),
      'Tender Qty':      Number(r['Tender Qty']       || r.tenderQty     || 0),
      'Actual Qty':      Number(r['Actual Qty']       || r.actualQty     || 0),

      // Rates
      'Rate':            Number(r['Rate']             || r.rate           || 0),
      'Contractor Rate': Number(r['Contractor Rate']  || r.contractorRate || 0),
      'Client Rate':     Number(r['Client Rate']      || r.clientRate     || 0),

      // PCC computes and sends as static value
      'Amount':          Number(r['Amount']           || r.amt            || 0),

      // User + system fields (PCC writes since AppSheet formula won't run for PCC-created rows)
      'UserEmail':       p.userEmail   || Session.getActiveUser().getEmail() || '',
      'SystemEmail':     p.systemEmail || Session.getActiveUser().getEmail() || '',
      'Timestamp':       ts,           // Format: "08-Apr-2026 17:17:19"

      // NEVER included (ARRAYFORMULA columns — sheet owns them):
      // 'BOQ ID'              → ARRAYFORMULA: UUID&"-"&BOQItem#
      // 'BOQ ID (Description)'→ ARRAYFORMULA: UUID&"-"&BOQItem#&" : "&Desc
    };
  });

  // Default headers for new sheet creation — matches exact user-confirmed schema
  // Column order: CheckSum → UUID → BOQ Item # → Project Code → Project Name → Site Name
  //               → Description → Unit → Qty → Tender Qty → Actual Qty
  //               → Rate → Contractor Rate → Client Rate → Amount
  //               → UserEmail → SystemEmail → Timestamp
  // NEVER WRITTEN (ARRAYFORMULA — sheet owns these):
  //   'BOQ ID'                → =ARRAYFORMULA(UUID&"-"&BOQItem#)
  //   'BOQ ID (Description)'  → =ARRAYFORMULA(UUID&"-"&BOQItem#&" : "&Desc)
  var defaultHeaders = [
    'CheckSum',
    'BOQ ID',                // ARRAYFORMULA — never written by PCC
    'BOQ ID (Description)',  // ARRAYFORMULA — never written by PCC
    'UUID',
    'Project Code',
    'BOQ Item #',
    'Project Name',
    'Site Name',
    'Description',
    'Unit',
    'Qty',
    'Tender Qty',
    'Actual Qty',
    'Rate',
    'Contractor Rate',
    'Client Rate',
    'Amount',
    'UserEmail',
    'SystemEmail',
    'Timestamp',
  ];

  // Match rows by CheckSum (= Project UUID, the AppSheet Ref key)
  var matchKey = projectUuid || projectCode;
  _replaceProjectRows('BOQ', defaultHeaders, matchKey, rows);

  return ContentService.createTextOutput(JSON.stringify({
    success:      true,
    message:      'Saved ' + rows.length + ' BOQ items',
    assignedRows: assignedRows,
  })).setMimeType(ContentService.MimeType.JSON);
}

// ─── 3. WBS ─── (PL12_WBS schema — CheckSum = BOQ.UUID)
// Schema: one row per WBS work package, child of a specific BOQ item.
// NEVER WRITE: WBS Code · Related PL13_Activities
// UUID format:  PCC-WBS-{random}
// Activity #:   sequential per BOQ (per CheckSum)
function saveWBS(p) {
  p = _norm(p);
  var projectCode = String(p.projectCode || '').trim();
  var projectName = String(p.projectName || '').trim();
  var siteName    = String(p.siteName    || '').trim();
  var userEmail   = String(p.userEmail   || '').trim();
  if (!userEmail) {
    try { userEmail = Session.getActiveUser().getEmail() || ''; } catch(e) {}
  }
  var ts = _fmtTimestamp(new Date());

  if (!projectCode) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false, message: 'Missing projectCode'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // Track sequential Activity # per BOQ (per CheckSum / BOQ UUID)
  var actNumByBoq = {};   // boqUuid → current counter
  var assignedNodes = [];
  var refMap = {};        // tempId/oldUuid → finalUuid (for Activities resolution)

  var wbsRows = (p.nodes || []).map(function(n, idx) {
    var oldUuid  = String(n.uuid || '').trim();
    // UUID: preserve existing; generate new for new rows with PCC-WBS- prefix
    var finalUuid = oldUuid || ('PCC-WBS-' + Utilities.getUuid());
    var boqUuid   = String(n.checkSum || n.boqUuid || '').trim();

    // Sequential Activity # per BOQ
    if (!actNumByBoq[boqUuid]) actNumByBoq[boqUuid] = 0;
    actNumByBoq[boqUuid]++;
    var actNum = actNumByBoq[boqUuid];

    // Build ref map for Activities resolution
    if (n.tempId) refMap[String(n.tempId).trim()]  = finalUuid;
    if (oldUuid)  refMap[oldUuid]                   = finalUuid;

    assignedNodes.push({
      tempId:  n.tempId  || '',
      oldUuid: oldUuid,
      uuid:    finalUuid,
      actNum:  actNum,
    });

    return {
      // ── PL12_WBS schema (NEVER WRITE: WBS Code, Related PL13_Activities) ──
      'CheckSum':             boqUuid,          // FK → PL11_BOQ.UUID
      'UUID':                 finalUuid,        // PCC-WBS-{uuid}
      'Project Code':         projectCode,      // mapped via BOQ
      'BOQ ID':               String(n.boqId       || '').trim(),
      'BOQ ID (Description)': String(n.boqIdDesc   || '').trim(),
      'Activity #':           actNum,           // sequential per BOQ
      'Description':          String(n.description || n.wbsName || '').trim(),
      'Unit':                 String(n.unit        || '').trim(),
      'Qty':                  Number(n.qty)         || 0,
      'Project Name':         projectName,      // mapped via BOQ
      'Site Name':            siteName,         // mapped via BOQ
      'UserEmail':            userEmail,
      'SystemEmail':          userEmail,
      'Timestamp':            ts,
      // WBS Code — NEVER WRITE (protected column)
    };
  });

  var defaultHeaders = [
    'CheckSum',
    'UUID',
    'Project Code',
    'BOQ ID',
    'BOQ ID (Description)',
    'Activity #',
    'Description',
    'Unit',
    'Qty',
    'Project Name',
    'Site Name',
    'UserEmail',
    'SystemEmail',
    'Timestamp',
  ];

  _replaceProjectRows('WBS', defaultHeaders, projectCode, wbsRows);

  // ── Activities (PL13_Activities) — keep backward-compat if caller sends them ──
  if (p.activities && p.activities.length > 0) {
    var actHeaders = [
      'Project Code', 'Activity', 'WBS UUID', 'CheckSum',
      'Nature of Work', 'Type of Work', 'Unit', 'Cost Code',
      'BOQ Qty', 'Master UUID', 'Task Code', 'Updated At',
    ];
    var actRows = p.activities.map(function(a) {
      var parentRef    = String(a.parentRef || '').trim();
      var resolvedUuid = refMap[parentRef] || parentRef;
      return {
        'Project Code':   projectCode,
        'Activity':       a.name         || '',
        'WBS UUID':       resolvedUuid,
        'CheckSum':       resolvedUuid,   // Activity.CheckSum = WBS.UUID
        'Nature of Work': a.natureOfWork || '',
        'Type of Work':   a.typeOfWork   || '',
        'Unit':           a.unit         || '',
        'Cost Code':      a.costCode     || '',
        'BOQ Qty':        Number(a.boqQty) || 0,
        'Master UUID':    a.masterUuid   || '',
        'Task Code':      a.taskCode     || '',
        'Updated At':     ts,
      };
    });
    _replaceProjectRows('Activities', actHeaders, projectCode, actRows);
  }

  return ContentService.createTextOutput(JSON.stringify({
    success:       true,
    message:       'Saved ' + wbsRows.length + ' WBS rows',
    assignedNodes: assignedNodes,
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

// ─── Portal Config ─── (PortalConfig tab in Master sheet)
// Stores exec URLs + other config persistently, shared across all users.
// Read via gviz (public). Write via this handler (Apps Script).

var MASTER_SHEET_ID_PC = '1B2wb38KhNwlLoZnsAGWQkO0FdEGFFfsh3ycRRurigq4';

function _getOrCreatePortalConfigSheet() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID_PC);
  var sh = ss.getSheetByName('PortalConfig');
  if (!sh) {
    sh = ss.insertSheet('PortalConfig');
    var hdrs = ['Key', 'Value', 'Description', 'Updated By', 'Updated At'];
    sh.getRange(1, 1, 1, hdrs.length)
      .setValues([hdrs])
      .setBackground('#1a6038')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 140);
    sh.setColumnWidth(2, 480);
    sh.setColumnWidth(3, 220);
    sh.setColumnWidth(4, 160);
    sh.setColumnWidth(5, 160);
    // Pre-populate with exec key stubs
    var stubs = [
      ['exec_main',       '', 'Main backend — most portal POSTs'],
      ['exec_pcc',        '', 'PCC handlers — saveProjectSetup, saveBOQ, saveWBS…'],
      ['exec_pinReset',   '', 'PIN reset — bound to UserSecrets sheet'],
      ['exec_aiProxy',    '', 'AI proxy — Groq via Apps Script'],
      ['exec_diagnostic', '', 'Sheet diagnostic — server-side sharing checks'],
    ];
    sh.getRange(2, 1, stubs.length, 3).setValues(stubs);
    Logger.log('[PortalConfig] Created PortalConfig tab with ' + stubs.length + ' stubs');
  }
  return sh;
}

function savePortalConfig(p) {
  p = _norm(p);
  var key       = String(p.key       || '').trim();
  var value     = String(p.value     || '').trim();
  var updatedBy = String(p.updatedBy || '').trim();

  if (!key) return ContentService.createTextOutput(JSON.stringify({
    success: false, message: 'Missing key'
  })).setMimeType(ContentService.MimeType.JSON);

  // Validate exec URLs
  if (value && key.indexOf('exec_') === 0 && !/^https:\/\/script\.google\.com\/macros\//.test(value)) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false, message: 'exec_* keys must be https://script.google.com/macros/... URLs'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var sh = _getOrCreatePortalConfigSheet();
  var data = sh.getDataRange().getValues();
  var headers  = data[0].map(function(h) { return String(h).trim(); });
  var keyIdx   = headers.indexOf('Key');
  var valIdx   = headers.indexOf('Value');
  var byIdx    = headers.indexOf('Updated By');
  var atIdx    = headers.indexOf('Updated At');

  // Format timestamp
  var now   = new Date();
  var mths  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var ts    = ('0' + now.getDate()).slice(-2) + '-' + mths[now.getMonth()] + '-' + now.getFullYear() +
              ' ' + ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);

  // Find or append row
  var found = false;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][keyIdx] || '').trim() === key) {
      if (valIdx >= 0) sh.getRange(i + 1, valIdx + 1).setValue(value);
      if (byIdx  >= 0) sh.getRange(i + 1, byIdx  + 1).setValue(updatedBy);
      if (atIdx  >= 0) sh.getRange(i + 1, atIdx  + 1).setValue(ts);
      found = true;
      break;
    }
  }
  if (!found) {
    var row = new Array(headers.length).fill('');
    if (keyIdx >= 0) row[keyIdx] = key;
    if (valIdx >= 0) row[valIdx] = value;
    if (byIdx  >= 0) row[byIdx]  = updatedBy;
    if (atIdx  >= 0) row[atIdx]  = ts;
    sh.appendRow(row);
  }

  return ContentService.createTextOutput(JSON.stringify({
    success:   true,
    message:   (found ? 'Updated' : 'Created') + ': ' + key,
    key:       key,
    value:     value,
    updatedAt: ts,
  })).setMimeType(ContentService.MimeType.JSON);
}

function getPortalConfig(p) {
  var sh = _getOrCreatePortalConfigSheet();
  var data    = sh.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var keyIdx  = headers.indexOf('Key');
  var valIdx  = headers.indexOf('Value');
  var byIdx   = headers.indexOf('Updated By');
  var atIdx   = headers.indexOf('Updated At');

  var config = {}, meta = {};
  for (var i = 1; i < data.length; i++) {
    var k = String(data[i][keyIdx] || '').trim();
    var v = String(data[i][valIdx] || '').trim();
    if (k) {
      config[k] = v;
      meta[k]   = {
        updatedBy: byIdx >= 0 ? String(data[i][byIdx] || '') : '',
        updatedAt: atIdx >= 0 ? String(data[i][atIdx] || '') : '',
      };
    }
  }
  return ContentService.createTextOutput(JSON.stringify({
    success: true, config: config, meta: meta
  })).setMimeType(ContentService.MimeType.JSON);
}
