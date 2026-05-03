/**
 * EVGCPL Portal — Apps Script handlers used by the Safety module.
 *
 * Per user memory: these are already deployed to the live Apps Script.
 * This file documents the contract so Apps Script and portal stay in sync.
 *
 * Deploy URL contract (must match assets/js/api.js APPS_SCRIPT_URL):
 *   https://script.google.com/macros/s/<deploymentId>/exec
 *
 * CORS note: client must POST with Content-Type: text/plain and a JSON
 * body. Anything else makes e.postData undefined.
 */

function doPost(e) {
  let payload = {};
  try { payload = JSON.parse(e.postData.contents); }
  catch (err) { return _json({ success:false, message:'Bad JSON: ' + err.message }); }

  const action = payload.action || '';
  try {
    switch (action) {
      case 'appendRow': return _appendRow(payload);
      case 'updateCell': return _updateCell(payload);
      // ... existing actions retained ...
      default: return _json({ success:false, message:'Unknown action: ' + action });
    }
  } catch (err) {
    return _json({ success:false, message:err.message, action });
  }
}

/**
 * Append a row to a sheet tab.
 * payload: { action:'appendRow', sheetId, tab, row: [v1, v2, ...] }
 */
function _appendRow({ sheetId, tab, row }) {
  const ss = SpreadsheetApp.openById(sheetId);
  const sh = ss.getSheetByName(tab);
  if (!sh) return _json({ success:false, message:`Tab "${tab}" not found` });
  sh.appendRow(row);
  return _json({ success:true, rowsAfter: sh.getLastRow() });
}

/**
 * Update a single cell, found by matching a value in another column.
 * payload: { action:'updateCell', sheetId, tab, matchCol:'B', matchVal:'INC-...', updateCol:'I', updateVal:'Closed' }
 */
function _updateCell({ sheetId, tab, matchCol, matchVal, updateCol, updateVal }) {
  const ss = SpreadsheetApp.openById(sheetId);
  const sh = ss.getSheetByName(tab);
  if (!sh) return _json({ success:false, message:`Tab "${tab}" not found` });

  const matchIdx  = _colToIdx(matchCol);
  const updateIdx = _colToIdx(updateCol);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return _json({ success:false, message:'Sheet empty' });

  const matches = sh.getRange(2, matchIdx, lastRow - 1, 1).getValues();
  for (let i = 0; i < matches.length; i++) {
    if (String(matches[i][0]) === String(matchVal)) {
      const rowIdx = i + 2;
      sh.getRange(rowIdx, updateIdx).setValue(updateVal);
      return _json({ success:true, rowUpdated: rowIdx });
    }
  }
  return _json({ success:false, message:`No row matched ${matchCol}=${matchVal}` });
}

function _colToIdx(letters) {
  let n = 0;
  letters.toUpperCase().split('').forEach(ch => {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  });
  return n;
}
function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ───────────────────────────────────────────────────────────────────
   doGet — read-only handlers (called by My Profile docs grid).

   Used by My Profile to enumerate per-employee documents on Drive.
   Files are organised on Drive as:
     <HR_DOCS_FOLDER_ID>/<subFolder>/<UUID>_<original-name>

   GET params:
     action     = 'listHRDocs'
     folderId   = root HR docs folder ID
     subFolder  = 'Photo' | 'OfferLetter' | 'Aadhar' | …
     prefix     = the employee's UUID (filenames must start with this)
   Returns: { files: [{ name, url, mimeType, sizeBytes }] }
   ─────────────────────────────────────────────────────────────────── */
function doGet(e) {
  const action = (e.parameter || {}).action || '';
  try {
    if (action === 'listHRDocs') {
      const root = DriveApp.getFolderById(e.parameter.folderId);
      const sub  = root.getFoldersByName(e.parameter.subFolder);
      if (!sub.hasNext()) return _json({ files: [] });
      const folder = sub.next();
      const prefix = (e.parameter.prefix || '').toString();
      const out = [];
      const it  = folder.getFiles();
      while (it.hasNext()) {
        const f = it.next();
        if (!prefix || f.getName().indexOf(prefix) === 0) {
          out.push({
            name:      f.getName(),
            url:       f.getUrl(),
            mimeType:  f.getMimeType(),
            sizeBytes: f.getSize(),
          });
        }
      }
      return _json({ files: out });
    }

    /* listPolicyFiles — flat list of all files in the policy folder.
       Used by the Policy Hub (HR sub-route).
       GET params: action=listPolicyFiles, folderId=<policy folder ID> */
    if (action === 'listPolicyFiles') {
      const folder = DriveApp.getFolderById(e.parameter.folderId);
      const out = [];
      const it  = folder.getFiles();
      while (it.hasNext()) {
        const f = it.next();
        out.push({
          name:      f.getName(),
          url:       f.getUrl(),
          mimeType:  f.getMimeType(),
          sizeBytes: f.getSize(),
          createdAt: f.getDateCreated().toISOString(),
        });
      }
      return _json({ files: out });
    }

    return _json({ success:false, message:'Unknown GET action: ' + action });
  } catch (err) {
    return _json({ success:false, message:err.message, action });
  }
}

/* ───────────────────────────────────────────────────────────────────
   Additional doPost actions (extend the switch in doPost above):

   uploadPolicyFile — base64 upload to Policy Hub folder.
     payload: { action:'uploadPolicyFile', folderId, fileName,
                mimeType, category, base64Data }

   sendReportTest — fire a test email for a Reports schedule.
     payload: { action:'sendReportTest', reportId, recipients, filters, subject }
   ─────────────────────────────────────────────────────────────────── */
function _uploadPolicyFile({ folderId, fileName, mimeType, category, base64Data }) {
  const folder = DriveApp.getFolderById(folderId);
  const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType || 'application/octet-stream', fileName);
  const file = folder.createFile(blob);
  if (category) file.setDescription('Category: ' + category);
  return _json({ success:true, fileId:file.getId(), url:file.getUrl() });
}

function _sendReportTest({ reportId, recipients, filters, subject }) {
  if (!Array.isArray(recipients) || !recipients.length) {
    return _json({ success:false, message:'No recipients' });
  }
  const body = [
    'This is a test email from the EVGCPL Reports module.',
    '',
    'Report: ' + reportId,
    'Filters: ' + JSON.stringify(filters || {}, null, 2),
    '',
    'When activated via a time-driven trigger, the live report data will be',
    'attached as CSV. This test only confirms the email channel works.',
  ].join('\n');
  recipients.forEach(to => {
    MailApp.sendEmail({
      to,
      subject: subject || ('[Test] ' + reportId),
      body,
      name: 'EVGCPL Portal',
    });
  });
  return _json({ success:true, sentTo:recipients.length });
}
