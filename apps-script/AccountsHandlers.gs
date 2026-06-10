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
    var folder = _getOrCreatePRFolder(body.requestId, body.uuid);
    if (!folder) return { success: false, message: 'Could not resolve PaymentRequests folder' };
    return { success: true, folderId: folder.getId(), folderUrl: folder.getUrl() };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// Find (or create) the per-PR subfolder inside the 'PaymentRequests' parent.
// Folder name convention: "<requestId>_<uuid>". We reuse an existing folder
// that matches the uuid (most reliable) or the requestId so re-uploads and
// later look-ups land in the same place instead of spawning duplicates.
function _getOrCreatePRFolder(requestId, uuid, createIfMissing) {
  if (createIfMissing === undefined) createIfMissing = true;
  var parentIt = DriveApp.getFoldersByName('PaymentRequests');
  var parent = parentIt.hasNext() ? parentIt.next()
             : (createIfMissing ? DriveApp.createFolder('PaymentRequests') : null);
  if (!parent) return null;
  requestId = String(requestId || '');
  uuid      = String(uuid || '');
  var folders = parent.getFolders();
  while (folders.hasNext()) {
    var f = folders.next();
    var name = f.getName();
    if ((uuid && name.indexOf(uuid) !== -1) ||
        (requestId && (name === requestId || name.indexOf(requestId + '_') === 0))) {
      return f;
    }
  }
  if (!createIfMissing) return null;
  var sub = (requestId || uuid || 'PR') + '_' + uuid;
  return parent.createFolder(sub);
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
    // Make the attachment openable by any portal user who has the link.
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (se) {}
    return { success: true, fileId: file.getId(), fileUrl: file.getUrl() };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
//  ACTION: listPRAttachments
//  body: { link, orderNo, billNo }   (requestId/uuid accepted as fallback)
//  Attachments live in a Shared Drive, scattered across subfolders, and are
//  NAMED by the request's Link code (e.g. "SCMv1-69d8e715.Quote(Attachment).
//  112314.pdf"). We therefore search the whole Shared Drive recursively for
//  files whose NAME contains the Link / Bill No / Order No and return openable
//  links. Search is precise because the Link code is unique per request.
// ─────────────────────────────────────────────────────────────
// Shared Drive that holds all payment-request attachments (root folder
// "00_AppsheetClone" and its PONOGen quote/image subfolders live here).
var PR_ATTACH_DRIVE_ID = '0AAy1Om6TVuApUk9PVA';

function listPRAttachments(body) {
  try {
    var keys = [];
    [body.link, body.orderNo, body.billNo].forEach(function (k) {
      k = (k == null ? '' : String(k)).trim();
      // Skip blanks and too-short/generic keys that would over-match.
      if (k && k.length >= 4 && keys.indexOf(k) === -1) keys.push(k);
    });
    if (!keys.length) return { success: true, files: [] };

    var token = ScriptApp.getOAuthToken();
    var seen = {}, out = [];
    for (var i = 0; i < keys.length; i++) {
      var esc = keys[i].replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      var q = "trashed = false and mimeType != 'application/vnd.google-apps.folder' and name contains '" + esc + "'";
      var pageToken = '';
      do {
        var url = 'https://www.googleapis.com/drive/v3/files'
          + '?q=' + encodeURIComponent(q)
          + '&fields=' + encodeURIComponent('nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)')
          + '&pageSize=100'
          + '&corpora=drive&driveId=' + PR_ATTACH_DRIVE_ID
          + '&includeItemsFromAllDrives=true&supportsAllDrives=true'
          + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
        var resp = UrlFetchApp.fetch(url, {
          method: 'get',
          headers: { Authorization: 'Bearer ' + token },
          muteHttpExceptions: true
        });
        if (resp.getResponseCode() !== 200) {
          return { success: false, message: 'Drive search HTTP ' + resp.getResponseCode() + ': ' + String(resp.getContentText()).slice(0, 300) };
        }
        var data = JSON.parse(resp.getContentText());
        (data.files || []).forEach(function (f) {
          if (seen[f.id]) return;
          seen[f.id] = true;
          out.push({
            id:       f.id,
            name:     f.name,
            mimeType: f.mimeType,
            url:      f.webViewLink || ('https://drive.google.com/file/d/' + f.id + '/view'),
            size:     f.size || 0,
            updated:  f.modifiedTime || '',
            matchedOn: keys[i]
          });
        });
        pageToken = data.nextPageToken || '';
      } while (pageToken);
    }
    out.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    return { success: true, files: out, keys: keys };
  } catch (e) {
    return { success: false, message: e.message };
  }
}
