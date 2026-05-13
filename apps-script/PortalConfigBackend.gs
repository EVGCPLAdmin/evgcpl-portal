/**
 * ════════════════════════════════════════════════════════════════
 *   EVGCPL Portal Config Backend  (standalone)
 *   ────────────────────────────────────────────────────────────
 *   Purpose: Read/write the PortalConfig tab in the Master sheet.
 *            Completely independent of PCCHandlers.gs / Router.gs /
 *            any other portal Apps Script. Deploy once, never touch.
 *
 *   This Apps Script project should contain ONLY this single file.
 *
 *   Endpoints (POST with JSON body, Content-Type: text/plain):
 *      { action: 'savePortalConfig', key: 'exec_main', value: 'https://...', updatedBy: 'admin@...' }
 *      { action: 'getPortalConfig' }
 *      { action: '__ping__' }
 *
 *   Sheet: Master spreadsheet, tab "PortalConfig"
 *   Schema: Key | Value | Description | Updated By | Updated At
 * ═══════════════════════════════════════════════════════════ */

var MASTER_SHEET_ID = '1B2wb38KhNwlLoZnsAGWQkO0FdEGFFfsh3ycRRurigq4';
var SHEET_TAB_NAME  = 'PortalConfig';

// ═══ Entry points ════════════════════════════════════════════════
function doPost(e) {
  try {
    var body   = {};
    var raw    = (e && e.postData && e.postData.contents) ? e.postData.contents : '';
    if (raw) {
      try { body = JSON.parse(raw); } catch (pe) {}
    }
    var action = body.action || '';

    switch (action) {
      case 'savePortalConfig': return savePortalConfig(body);
      case 'getPortalConfig':  return getPortalConfig(body);
      case '__ping__':         return _json({ success: true, message: 'pong', service: 'PortalConfig' });
      default:                 return _json({ success: false, message: 'Unknown action: ' + action });
    }
  } catch (err) {
    return _json({ success: false, message: 'Error: ' + err.message });
  }
}

function doGet(e) {
  // Browser/diagnostic ping — returns service info
  return _json({
    success: true,
    service: 'EVGCPL Portal Config Backend',
    sheet:   MASTER_SHEET_ID,
    tab:     SHEET_TAB_NAME,
    actions: ['savePortalConfig', 'getPortalConfig', '__ping__'],
  });
}

// ═══ Core handlers ═══════════════════════════════════════════════

function savePortalConfig(p) {
  var key       = String((p && p.key)       || '').trim();
  var value     = String((p && p.value)     || '').trim();
  var updatedBy = String((p && p.updatedBy) || '').trim();

  if (!key) return _json({ success: false, message: 'Missing key' });

  // Validate exec_* keys must be Apps Script exec URLs
  if (value && key.indexOf('exec_') === 0 && !/^https:\/\/script\.google\.com\/macros\//.test(value)) {
    return _json({
      success: false,
      message: 'exec_* keys must be valid https://script.google.com/macros/... URLs'
    });
  }

  var sh      = _getOrCreatePortalConfigSheet();
  var data    = sh.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var keyIdx  = headers.indexOf('Key');
  var valIdx  = headers.indexOf('Value');
  var byIdx   = headers.indexOf('Updated By');
  var atIdx   = headers.indexOf('Updated At');

  if (keyIdx < 0 || valIdx < 0) {
    return _json({ success: false, message: 'PortalConfig tab missing Key or Value columns' });
  }

  var ts = _formatTimestamp(new Date());

  // Update existing row, or append
  var found = false;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][keyIdx] || '').trim() === key) {
      sh.getRange(i + 1, valIdx + 1).setValue(value);
      if (byIdx >= 0) sh.getRange(i + 1, byIdx + 1).setValue(updatedBy);
      if (atIdx >= 0) sh.getRange(i + 1, atIdx + 1).setValue(ts);
      found = true;
      break;
    }
  }
  if (!found) {
    var row = new Array(headers.length).fill('');
    row[keyIdx] = key;
    row[valIdx] = value;
    if (byIdx >= 0) row[byIdx] = updatedBy;
    if (atIdx >= 0) row[atIdx] = ts;
    sh.appendRow(row);
  }

  return _json({
    success:   true,
    message:   (found ? 'Updated' : 'Created') + ': ' + key,
    key:       key,
    value:     value,
    updatedBy: updatedBy,
    updatedAt: ts,
  });
}

function getPortalConfig(p) {
  var sh      = _getOrCreatePortalConfigSheet();
  var data    = sh.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var keyIdx  = headers.indexOf('Key');
  var valIdx  = headers.indexOf('Value');
  var byIdx   = headers.indexOf('Updated By');
  var atIdx   = headers.indexOf('Updated At');

  var config = {}, meta = {};
  for (var i = 1; i < data.length; i++) {
    var k = String(data[i][keyIdx] || '').trim();
    if (!k) continue;
    config[k] = String(data[i][valIdx] || '').trim();
    meta[k] = {
      updatedBy: byIdx >= 0 ? String(data[i][byIdx] || '') : '',
      updatedAt: atIdx >= 0 ? String(data[i][atIdx] || '') : '',
    };
  }
  return _json({ success: true, config: config, meta: meta });
}

// ═══ Helpers ═════════════════════════════════════════════════════

function _getOrCreatePortalConfigSheet() {
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sh = ss.getSheetByName(SHEET_TAB_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_TAB_NAME);
    var hdrs = ['Key', 'Value', 'Description', 'Updated By', 'Updated At'];
    sh.getRange(1, 1, 1, hdrs.length)
      .setValues([hdrs])
      .setBackground('#1a6038')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 140);
    sh.setColumnWidth(2, 480);
    sh.setColumnWidth(3, 240);
    sh.setColumnWidth(4, 180);
    sh.setColumnWidth(5, 160);

    var stubs = [
      ['exec_main',         '', 'Main backend — DPR, Safety, HR, Reports, Onboarding'],
      ['exec_pcc',          '', 'PCC handlers — saveProjectSetup, saveBOQ, saveWBS, saveWorkplan'],
      ['exec_pinReset',     '', 'PIN reset — bound to UserSecrets sheet'],
      ['exec_aiProxy',      '', 'AI proxy — Groq llama-3.3-70b via Apps Script'],
      ['exec_diagnostic',   '', 'Sheet sharing-doctor — server-side sharing checks'],
      ['exec_portalConfig', '', 'This service — savePortalConfig / getPortalConfig'],
    ];
    sh.getRange(2, 1, stubs.length, 3).setValues(stubs);
  }
  return sh;
}

function _formatTimestamp(d) {
  // Format: "08-Apr-2026 17:17:19"
  var mths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return ('0' + d.getDate()).slice(-2) + '-' +
         mths[d.getMonth()] + '-' + d.getFullYear() + ' ' +
         ('0' + d.getHours()).slice(-2) + ':' +
         ('0' + d.getMinutes()).slice(-2) + ':' +
         ('0' + d.getSeconds()).slice(-2);
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══ Manual test (run from Apps Script editor) ═══════════════════
function _testPing() {
  Logger.log(doGet({}).getContent());
}
function _testSave() {
  Logger.log(savePortalConfig({
    key: 'test_key',
    value: 'test_value',
    updatedBy: 'manual_test'
  }).getContent());
}
function _testGet() {
  Logger.log(getPortalConfig({}).getContent());
}
