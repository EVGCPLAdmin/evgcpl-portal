/**
 * EVGCPL Portal — Accounts module backend handlers.
 *
 * Header-aware writes to the Payment spreadsheet. The portal sends a row
 * object keyed by the exact header names; we place each value into the
 * column whose header matches (case/space-insensitive), leaving every
 * other column blank so the sheet's own formulas populate it. We never
 * write by column letter and never invent new columns on these
 * formula-driven sheets.
 *
 * Dispatched from Router.gs:
 *   saveNewPaymentRequest, saveAccountsUpdate, createPRFolder, uploadPRAttachment
 *
 * IMPORTANT: after editing this file the Apps Script /exec MUST be
 * redeployed (Deploy -> Manage deployments -> New version) before the
 * portal can save payment requests.
 */

// ─────────────────────────────────────────────────────────────
//  ACTION: saveNewPaymentRequest
//  body: { sheetId, tab:'PaymentRequest', row:{ <header>:<value>, ... } }
// ─────────────────────────────────────────────────────────────
function saveNewPaymentRequest(body) {
  try {
    var res = _accAppendByHeader(body.sheetId, body.tab || 'PaymentRequest', body.row || {});
    if (!res.success) return res;
    return { success: true, uuid: (body.row && body.row['UUID']) || '', rowsAfter: res.rowsAfter, unmatched: res.unmatched };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
//  ACTION: saveAccountsUpdate
//  body: { sheetId, tab:'AccountsUpdate', row:{ <header>:<value>, ... } }
//  Every status change is a NEW row — never an update of an existing row.
// ─────────────────────────────────────────────────────────────
function saveAccountsUpdate(body) {
  try {
    var res = _accAppendByHeader(body.sheetId, body.tab || 'AccountsUpdate', body.row || {});
    if (!res.success) return res;
    return { success: true, uuid: (body.row && body.row['UUID']) || '', rowsAfter: res.rowsAfter, unmatched: res.unmatched };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
//  Append a row, mapping object keys to the live header row by name.
//  Unknown keys are reported back in `unmatched` (not written).
// ─────────────────────────────────────────────────────────────
function _accAppendByHeader(sheetId, tab, row) {
  if (!sheetId) return { success: false, message: 'Missing sheetId' };
  var ss = SpreadsheetApp.openById(sheetId);
  var sh = ss.getSheetByName(tab);
  if (!sh) return { success: false, message: 'Tab "' + tab + '" not found' };

  var lastCol = sh.getLastColumn();
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var norm = function (s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase(); };

  var idx = {};
  for (var c = 0; c < headers.length; c++) idx[norm(headers[c])] = c;

  var out = [];
  for (var i = 0; i < lastCol; i++) out.push('');

  var unmatched = [];
  Object.keys(row).forEach(function (k) {
    var pos = idx[norm(k)];
    if (pos === undefined) { unmatched.push(k); return; }
    out[pos] = row[k];
  });

  sh.appendRow(out);
  return { success: true, rowsAfter: sh.getLastRow(), unmatched: unmatched };
}

// ─────────────────────────────────────────────────────────────
//  ACTION: createPRFolder
//  body: { requestId, uuid }
//  Gets/creates a 'PaymentRequests' parent folder and a per-PR subfolder.
// ─────────────────────────────────────────────────────────────
function createPRFolder(body) {
  try {
    var parentName = 'PaymentRequests';
    var it = DriveApp.getFoldersByName(parentName);
    var parent = it.hasNext() ? it.next() : DriveApp.createFolder(parentName);
    var sub = (body.requestId || body.uuid || 'PR') + '_' + (body.uuid || '');
    var folder = parent.createFolder(sub);
    return { success: true, folderId: folder.getId(), folderUrl: folder.getUrl() };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
//  ACTION: uploadPRAttachment
//  body: { folderId, filename, mimeType, base64 }
// ─────────────────────────────────────────────────────────────
function uploadPRAttachment(body) {
  try {
    var folder = DriveApp.getFolderById(body.folderId);
    var bytes  = Utilities.base64Decode(body.base64 || '');
    var blob   = Utilities.newBlob(bytes, body.mimeType || 'application/octet-stream', body.filename || 'attachment');
    var file   = folder.createFile(blob);
    return { success: true, fileId: file.getId(), fileUrl: file.getUrl() };
  } catch (e) {
    return { success: false, message: e.message };
  }
}
