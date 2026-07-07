/**
 * EVGCPL Portal — generic sheet-write actions dispatched by Router.gs.
 *
 * Router.gs maps these actions to bare function names (no leading underscore):
 *     appendRow    → appendRow(body)
 *     updateCell   → updateCell(body)
 *     batchUpdate  → batchUpdate(body)
 *
 * They MUST exist under those exact names, or the router's catch block throws
 *     "Server error in <action>: <name> is not defined"
 * which is exactly what broke Stock Reconciliation saves (updateCell +
 * appendRow) and Purchase-View MD/SCM approvals (updateCell). SafetyHandlers.gs
 * historically defined the same logic under _appendRow/_updateCell, so the
 * router's un-prefixed calls resolved to nothing on the current deployment.
 *
 * Responses go through Router.gs's _ok / _err helpers, so the portal frontend
 * sees { success:true, ... } on success and { success:false, message } on
 * failure — the shape _srkPost / _pvWriteCell already read.
 *
 * NOTE: the account running this web app must have EDIT access to every
 * spreadsheet these write to (e.g. the v2_Stores sheet for Stock
 * Reconciliation). Read-only (gviz) access is not enough for writes.
 */

// appendRow — append one positional row to a tab.
// body: { sheetId, tab, row: [v1, v2, ...] }
function appendRow(body) {
  var sheetId = body.sheetId, tab = body.tab, row = body.row;
  if (!sheetId) return _err('appendRow: missing sheetId');
  if (!tab)     return _err('appendRow: missing tab');
  if (!Array.isArray(row)) return _err('appendRow: row must be an array');
  var sh = SpreadsheetApp.openById(sheetId).getSheetByName(tab);
  if (!sh) return _err('appendRow: tab "' + tab + '" not found');
  sh.appendRow(row);
  return _ok({ rowsAfter: sh.getLastRow() });
}

// updateCell — set one cell, located by matching a value in another column.
// body: { sheetId, tab, matchCol:'A', matchVal, updateCol:'AG', updateVal }
// matchCol / updateCol are A1 column LETTERS.
function updateCell(body) {
  var sheetId = body.sheetId, tab = body.tab;
  if (!sheetId) return _err('updateCell: missing sheetId');
  if (!tab)     return _err('updateCell: missing tab');
  var sh = SpreadsheetApp.openById(sheetId).getSheetByName(tab);
  if (!sh) return _err('updateCell: tab "' + tab + '" not found');
  var matchIdx  = _a1ColToIdx(body.matchCol);
  var updateIdx = _a1ColToIdx(body.updateCol);
  if (!matchIdx)  return _err('updateCell: bad matchCol "' + body.matchCol + '"');
  if (!updateIdx) return _err('updateCell: bad updateCol "' + body.updateCol + '"');
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return _err('updateCell: sheet "' + tab + '" has no data rows');
  var col = sh.getRange(2, matchIdx, lastRow - 1, 1).getValues();
  var target = String(body.matchVal);
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0]) === target) {
      var rowIdx = i + 2;
      sh.getRange(rowIdx, updateIdx).setValue(body.updateVal);
      return _ok({ rowUpdated: rowIdx, updated: 1 });
    }
  }
  return _err('updateCell: no row where column ' + body.matchCol + ' = "' + target + '"');
}

// batchUpdate — apply several updateCell operations in one call. Each entry may
// carry its own sheetId/tab, else it inherits the top-level sheetId/tab.
// body: { sheetId, tab, updates: [ { matchCol, matchVal, updateCol, updateVal }, ... ] }
function batchUpdate(body) {
  var updates = body.updates || [];
  if (!Array.isArray(updates) || !updates.length) return _err('batchUpdate: no updates');
  var done = 0, failed = [];
  for (var i = 0; i < updates.length; i++) {
    var u = updates[i] || {};
    var one = {
      sheetId:   u.sheetId   !== undefined ? u.sheetId   : body.sheetId,
      tab:       u.tab       !== undefined ? u.tab       : body.tab,
      matchCol:  u.matchCol,  matchVal:  u.matchVal,
      updateCol: u.updateCol, updateVal: u.updateVal
    };
    var res = updateCell(one);
    try { if (JSON.parse(res.getContent()).success) done++; else failed.push(i); }
    catch (e) { failed.push(i); }
  }
  return _ok({ updated: done, failed: failed });
}

// A1 column letters ("A", "AG") → 1-based column index. Distinct name from
// SafetyHandlers.gs's _colToIdx so both files can coexist in the project.
function _a1ColToIdx(letters) {
  if (!letters) return 0;
  var s = String(letters).toUpperCase(), n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i) - 64;
    if (c < 1 || c > 26) return 0;
    n = n * 26 + c;
  }
  return n;
}
