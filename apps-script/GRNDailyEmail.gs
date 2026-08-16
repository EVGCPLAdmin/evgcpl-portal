/**
 * GRNDailyEmail.gs — daily CSV email of YESTERDAY's GRN receipts.
 *
 * Reads the StockIN tab of the v2_Stores workbook, keeps the rows whose
 * GRN Timestamp fell yesterday, builds a CSV, and emails it as an attachment
 * at ~08:00 (the Apps Script project's timezone — set it to Asia/Kolkata under
 * Project Settings if it isn't already).
 *
 * ── One-time setup (in the Apps Script editor) ──────────────────────────
 *   1. Paste this file into the project that can read the v2_Stores sheet.
 *   2. Run  installGRNDailyTrigger()  once  → authorises + creates the 08:00
 *      daily trigger. (Run  grnDailyTestNow()  first to send an immediate test.)
 *
 * ── Recipients (test → all) ─────────────────────────────────────────────
 *   Starts in TEST mode: emails ONLY admin@evgcpl.com.
 *   When you're happy ("SendAllApproved"), run  grnDailyEnableAll()  once — it
 *   flips a stored flag so every future run emails the full list. Revert any
 *   time with  grnDailyDisableAll().  (No code edit needed; the flag lives in
 *   Script Properties.)
 */

// Full distribution list — used only once ALL mode is enabled.
var GRN_DAILY_RECIPIENTS_ALL  = 'shanthini2007@gmail.com,ars@evgcpl.com,stores@evgcpl.com,purchase@evgcpl.com,accounts@evgcpl.com,admin@evgcpl.com';
// Test recipient(s) — the only ones emailed until ALL mode is enabled.
var GRN_DAILY_RECIPIENTS_TEST = 'admin@evgcpl.com';

var GRN_DAILY_SHEET_ID = '1iMQxgqGilUh2_3NCZl5D-EMt-NC8FwugX83q2fWb8fE'; // v2_Stores
var GRN_DAILY_TAB      = 'StockIN';
var GRN_DAILY_SEND_WHEN_EMPTY = true;  // email a "no receipts" note even on empty days (confirms the job ran)

// ── Recipient / mode helpers (flag stored in Script Properties) ──────────
function _grnDailySendAll() {
  return PropertiesService.getScriptProperties().getProperty('GRN_DAILY_SEND_ALL') === 'true';
}
function grnDailyEnableAll()  { PropertiesService.getScriptProperties().setProperty('GRN_DAILY_SEND_ALL', 'true'); return 'GRN daily email → ALL recipients: ' + GRN_DAILY_RECIPIENTS_ALL; }
function grnDailyDisableAll() { PropertiesService.getScriptProperties().deleteProperty('GRN_DAILY_SEND_ALL'); return 'GRN daily email → TEST mode: ' + GRN_DAILY_RECIPIENTS_TEST; }
function _grnDailyRecipients() { return _grnDailySendAll() ? GRN_DAILY_RECIPIENTS_ALL : GRN_DAILY_RECIPIENTS_TEST; }

// ── Trigger install / remove ────────────────────────────────────────────
function installGRNDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'emailDailyGRN') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('emailDailyGRN').timeBased().atHour(8).nearMinute(0).everyDays(1).create();
  return 'Installed: emailDailyGRN runs daily ~08:00 (' + (Session.getScriptTimeZone() || '?') + ')';
}
function uninstallGRNDailyTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'emailDailyGRN') { ScriptApp.deleteTrigger(t); n++; }
  });
  return 'Removed ' + n + ' GRN email trigger(s)';
}

// Run once from the editor to send an immediate test for yesterday's receipts.
function grnDailyTestNow() { return emailDailyGRN(); }

// ── Main: build + send yesterday's CSV ──────────────────────────────────
function emailDailyGRN() {
  var tz = Session.getScriptTimeZone() || 'Asia/Kolkata';
  var now = new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); // yesterday 00:00
  var end   = new Date(now.getFullYear(), now.getMonth(), now.getDate());     // today 00:00
  var dateStr = Utilities.formatDate(start, tz, 'dd-MMM-yyyy');

  var data = _grnDailyRows(start.getTime(), end.getTime());
  var recipients = _grnDailyRecipients();
  var mode = _grnDailySendAll() ? 'ALL' : 'TEST (admin only)';
  var count = data.rows.length;

  if (!count && !GRN_DAILY_SEND_WHEN_EMPTY) {
    return { success: true, rows: 0, sent: false, mode: mode, note: 'no rows; empty-send disabled' };
  }

  var subject = 'GRN receipts — ' + dateStr + ' (' + count + ')' + (mode === 'ALL' ? '' : ' [TEST]');
  var body = [
    'GRN receipts booked on ' + dateStr + ' (filtered by GRN Timestamp).',
    'Rows: ' + count,
    'Distribution: ' + mode,
    '',
    count ? 'CSV attached.' : 'No GRN receipts were booked yesterday.',
    '',
    '— EVGCPL Portal (automated daily GRN report)',
  ].join('\n');

  var opts = { name: 'EVGCPL Portal' };
  if (count) {
    var csv = _grnDailyCsv(data);
    var fname = 'GRN_receipts_' + Utilities.formatDate(start, tz, 'yyyy-MM-dd') + '.csv';
    opts.attachments = [Utilities.newBlob('﻿' + csv, 'text/csv', fname)]; // BOM for Excel
  }

  MailApp.sendEmail(recipients, subject, body, opts);
  return { success: true, rows: count, sent: true, mode: mode, recipients: recipients, date: dateStr };
}

// ── Read + filter StockIN rows for the [start,end) window ────────────────
function _grnDailyRows(startMs, endMs) {
  var ss = SpreadsheetApp.openById(GRN_DAILY_SHEET_ID);
  var sh = ss.getSheetByName(GRN_DAILY_TAB);
  if (!sh) throw new Error('Tab "' + GRN_DAILY_TAB + '" not found in ' + GRN_DAILY_SHEET_ID);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { headers: [], idx: {}, rows: [] };

  var headers = values[0];
  var norm = function (s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase(); };
  var idx = {};
  for (var c = 0; c < headers.length; c++) idx[norm(headers[c])] = c;
  var col = function (names) { for (var i = 0; i < names.length; i++) { var p = idx[norm(names[i])]; if (p !== undefined) return p; } return -1; };

  var cTs = col(['Timestamp', 'Time Stamp', 'Created On', 'Entry Timestamp', 'Created Timestamp', 'Created']);
  var cols = {
    grn:  col(['GRN No (Goods Receipt)', 'GRN No', 'GRN Number', 'GRN No.', 'GRN']),
    recv: col(['Received On (At Site)', 'Received On (At)', 'Received On', 'GRN Received On', 'Received Date']),
    po:   col(['PO No', 'PO No (Key)']),
    vend: col(['Vendor Name', 'Vendor']),
    site: col(['Site Name', 'Site']),
    inv:  col(['Invoice No / ST No', 'Invoice No', 'Invoice']),
    part: col(['Part Details', 'Part Description', 'Part']),
    qty:  col(['GRN Qty', 'GRN Quantity', 'Received Qty']),
    siid: col(['SI ID', 'SIID', 'SI Id']),
    ts:   cTs,
  };

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var t = cTs >= 0 ? _grnDailyParseTs(values[r][cTs]) : 0;
    if (!t) continue;
    if (t >= startMs && t < endMs) out.push(values[r]);
  }
  return { headers: headers, idx: idx, cols: cols, rows: out };
}

// ── CSV of the curated receipt columns ──────────────────────────────────
function _grnDailyCsv(data) {
  var tz = Session.getScriptTimeZone() || 'Asia/Kolkata';
  var cols = data.cols;
  var esc = function (v) { v = (v == null ? '' : String(v)); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var get = function (row, c) { return c >= 0 ? row[c] : ''; };
  var dOnly = function (v) { var t = _grnDailyParseTs(v); return t ? Utilities.formatDate(new Date(t), tz, 'dd-MMM-yyyy') : (v == null ? '' : String(v)); };
  var dTime = function (v) { var t = _grnDailyParseTs(v); return t ? Utilities.formatDate(new Date(t), tz, 'dd-MMM-yyyy HH:mm:ss') : (v == null ? '' : String(v)); };

  var head = ['GRN No', 'GRN Date', 'GRN Timestamp', 'PO No', 'Vendor', 'Site', 'Invoice No', 'Part', 'GRN Qty', 'SI ID'];
  var lines = [head.join(',')];
  data.rows.forEach(function (row) {
    lines.push([
      get(row, cols.grn), dOnly(get(row, cols.recv)), dTime(get(row, cols.ts)),
      get(row, cols.po), get(row, cols.vend), get(row, cols.site), get(row, cols.inv),
      get(row, cols.part), get(row, cols.qty), get(row, cols.siid),
    ].map(esc).join(','));
  });
  return lines.join('\r\n');
}

// Parse a Timestamp cell to millis. Sheet date cells arrive as Date objects;
// text timestamps may be "DD/MM/YYYY[ HH:MM[:SS]]" (which Date.parse misreads),
// so handle that explicitly before falling back to Date.parse.
function _grnDailyParseTs(v) {
  if (v instanceof Date) return v.getTime();
  var s = String(v == null ? '' : v).trim();
  if (!s) return 0;
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  var t = Date.parse(s);
  return isNaN(t) ? 0 : t;
}
