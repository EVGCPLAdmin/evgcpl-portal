/**
 * EVGCPL Portal — Scheduled Report Email Trigger
 *
 * This file documents the Apps Script handlers and time-driven trigger
 * that activate the per-report schedules saved in the portal Reports
 * module.
 *
 * Architecture:
 *   1. The portal saves a schedule to localStorage (instant UI feedback)
 *      AND posts it to Apps Script via `saveReportSchedule` (server mirror).
 *   2. Apps Script writes each schedule to a `ReportSchedules` tab in the
 *      EMPLOYEE sheet — one row per (reportId, savedBy) — so it survives
 *      browser refreshes, machine swaps, etc.
 *   3. A time-driven trigger fires `runScheduledReports` every hour. It
 *      scans `ReportSchedules` and for any whose (frequency, time) match
 *      the current hour-in-IST, it generates the report CSV and emails
 *      the recipients.
 *
 * One-time setup (do this once after deploying):
 *   1. Paste this file's contents alongside `SafetyHandlers.gs` in the
 *      Apps Script project (script.google.com → your project).
 *   2. Run `_initReportSchedulesTab()` once manually from the Apps
 *      Script editor — this creates the tab with headers if missing.
 *   3. Run `installReportTrigger()` once manually to install the
 *      hourly trigger. Verify in the Triggers panel.
 *   4. (Optional) Run `_dryRunNow()` to test a single send-now without
 *      waiting for the trigger to fire.
 *
 * Schedule shape (matches portal localStorage):
 *   {
 *     active:     'on' | 'off',
 *     freq:       'daily' | '0' | '1' | '2' | '3' | '4' | '5' | '6',
 *                 // 'daily' = Mon–Fri; '0' = Sun … '6' = Sat
 *     time:       'HH:MM',         // 24h, IST
 *     recipients: ['email1', …],
 *     filters:    { … }            // arbitrary filter object
 *   }
 */

// ── Configuration — wire these once ──────────────────────────────
// IMPORTANT: paste the same EMPLOYEE sheet ID used elsewhere in the portal.
const REPORT_SCHED_SHEET_ID = '1HWKZPhKRhcuvxBgyyN8zRt8p-SzYmKjJWiOdCgykBHs';
const REPORT_SCHED_TAB      = 'ReportSchedules';

// Optional: master sheet ID, purchase sheet ID, etc. — only needed by
// _generateReportCSV below if you want server-side report generation.
// For v1, we send a "data link" pointing back to the portal instead.
const PORTAL_BASE_URL = 'https://evgcpladmin.github.io/evgcpl-portal/';


/* ════════════════════════════════════════════════════════════════════
   doPost actions to add to your existing doPost switch:

     case 'saveReportSchedule':   return _saveReportSchedule(payload);
     case 'deleteReportSchedule': return _deleteReportSchedule(payload);
     case 'sendReportTest':       return _sendReportTest(payload);
   ════════════════════════════════════════════════════════════════════ */

function _saveReportSchedule({ reportId, config, savedBy }) {
  if (!reportId || !config) return _json({ success:false, message:'Missing reportId or config' });
  const sh = _getReportSchedulesSheet();
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol    = headers.indexOf('reportId');
  const userCol  = headers.indexOf('savedBy');

  // Find existing row for this (reportId, savedBy) — owner-scoped
  let rowIdx = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === reportId && String(data[i][userCol]) === (savedBy || '')) {
      rowIdx = i; break;
    }
  }

  const row = [
    new Date().toISOString(),
    reportId,
    savedBy || '',
    config.active || 'on',
    config.freq,
    config.time || '08:00',
    (config.recipients || []).join(','),
    JSON.stringify(config.filters || {}),
  ];

  if (rowIdx === -1) sh.appendRow(row);
  else sh.getRange(rowIdx + 1, 1, 1, row.length).setValues([row]);

  return _json({ success:true, action:'saved', reportId });
}

function _deleteReportSchedule({ reportId, savedBy }) {
  const sh = _getReportSchedulesSheet();
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol    = headers.indexOf('reportId');
  const userCol  = headers.indexOf('savedBy');

  // Walk bottom-up so deletes don't shift the loop index
  for (let i = data.length - 1; i > 0; i--) {
    if (String(data[i][idCol]) === reportId && String(data[i][userCol]) === (savedBy || '')) {
      sh.deleteRow(i + 1);
    }
  }
  return _json({ success:true, action:'deleted', reportId });
}

function _sendReportTest({ reportId, recipients, filters, subject }) {
  if (!Array.isArray(recipients) || !recipients.length) {
    return _json({ success:false, message:'No recipients' });
  }
  recipients.forEach(to => {
    MailApp.sendEmail({
      to,
      subject: subject || ('[Test] ' + reportId),
      body: _buildEmailBody(reportId, filters, true),
      name: 'EVGCPL Portal',
    });
  });
  return _json({ success:true, sentTo:recipients.length });
}


/* ════════════════════════════════════════════════════════════════════
   Time-driven trigger entry point.

   Install once with `installReportTrigger()`. After that, this function
   runs every hour. It checks every saved schedule and fires any whose
   (frequency, hour-in-IST) match the current moment.
   ════════════════════════════════════════════════════════════════════ */

function runScheduledReports() {
  const sh = _getReportSchedulesSheet();
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return;

  const headers = data[0];
  const COL = {};
  headers.forEach((h, i) => { COL[h] = i; });

  // Current IST time
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone:'Asia/Kolkata' }));
  const istHour = ist.getHours();
  const istMin  = ist.getMinutes();
  const istDay  = ist.getDay();         // 0=Sun … 6=Sat
  const isWeekday = istDay >= 1 && istDay <= 5;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const active = row[COL.active];
    if (active !== 'on') continue;

    const freq = String(row[COL.freq]);
    const timeStr = String(row[COL.time] || '08:00');
    const [schedHour, schedMin] = timeStr.split(':').map(Number);

    // Match by hour only (we run hourly). Tolerate ±15 minutes.
    if (schedHour !== istHour) continue;
    if (Math.abs(schedMin - istMin) > 15) continue;

    // Match frequency
    if (freq === 'daily' && !isWeekday) continue;
    if (freq !== 'daily' && parseInt(freq) !== istDay) continue;

    // Fire
    const reportId   = row[COL.reportId];
    const recipients = String(row[COL.recipients] || '').split(',').map(s => s.trim()).filter(Boolean);
    let filters = {};
    try { filters = JSON.parse(row[COL.filters] || '{}'); } catch (_) { /* ignore */ }

    if (!recipients.length) continue;

    try {
      recipients.forEach(to => {
        MailApp.sendEmail({
          to,
          subject: `[EVGCPL] ${_reportTitle(reportId)} · ${ist.toLocaleDateString('en-IN')}`,
          body:    _buildEmailBody(reportId, filters, false),
          name:   'EVGCPL Portal',
        });
      });
      Logger.log('Sent ' + reportId + ' to ' + recipients.length + ' recipient(s)');
    } catch (err) {
      Logger.log('Failed to send ' + reportId + ': ' + err.message);
    }
  }
}


/* ════════════════════════════════════════════════════════════════════
   Helpers
   ════════════════════════════════════════════════════════════════════ */

function _getReportSchedulesSheet() {
  const ss = SpreadsheetApp.openById(REPORT_SCHED_SHEET_ID);
  let sh = ss.getSheetByName(REPORT_SCHED_TAB);
  if (!sh) {
    sh = ss.insertSheet(REPORT_SCHED_TAB);
    sh.appendRow(['updatedAt', 'reportId', 'savedBy', 'active', 'freq', 'time', 'recipients', 'filters']);
    sh.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#e8f5e9');
  }
  return sh;
}

// Run once manually after deploying — also covered by _getReportSchedulesSheet
function _initReportSchedulesTab() {
  _getReportSchedulesSheet();
  Logger.log('ReportSchedules tab initialised.');
}

function _reportTitle(reportId) {
  // Mirror the catalogue labels in modules/reports.js so the email subject
  // line is human-readable. If the reportId isn't recognised, fall back
  // to the raw id.
  return ({
    mrs_summary:           'MRS Summary',
    po_tracker:            'PO Tracker',
    vendor_spend:          'Vendor Spend Summary',
    stock_levels:          'Stock Levels by Site',
    grn_register:          'GRN Register',
    emp_headcount:         'Employee Headcount',
    equipment_deployment:  'Equipment Deployment',
    onboarding_status:     'Onboarding Status',
    vendor_invoice:        'Vendor Invoice Status',
  })[reportId] || reportId;
}

// Plain-text email body. The portal generates the actual data, so for v1
// we link recipients back into the portal with the saved filters applied.
// If you later want server-side CSV generation, replace this function with
// one that fetches the data from the relevant sheets and attaches a CSV.
function _buildEmailBody(reportId, filters, isTest) {
  const filterLines = Object.keys(filters || {}).length
    ? Object.entries(filters).map(([k, v]) => '  ' + k + ': ' + v).join('\n')
    : '  (no filters)';

  const url = PORTAL_BASE_URL + 'reports.html#' + reportId;

  return [
    isTest ? 'TEST MESSAGE — verifying schedule delivery.' : 'Scheduled report from the EVGCPL Portal.',
    '',
    'Report:  ' + _reportTitle(reportId),
    'When:    ' + new Date().toLocaleString('en-IN', { timeZone:'Asia/Kolkata' }) + ' IST',
    '',
    'Filters applied:',
    filterLines,
    '',
    'Open the live report:',
    '  ' + url,
    '',
    '— EVGCPL Portal',
  ].join('\n');
}

/* ════════════════════════════════════════════════════════════════════
   One-time setup — run from Apps Script editor manually.
   ════════════════════════════════════════════════════════════════════ */

function installReportTrigger() {
  // Drop any existing instance of this trigger to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'runScheduledReports') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runScheduledReports')
    .timeBased()
    .everyHours(1)
    .create();
  Logger.log('Hourly trigger installed.');
}

function uninstallReportTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'runScheduledReports') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Trigger removed.');
}

function _dryRunNow() {
  // Useful for testing — bypasses the time-window check and sends every
  // active schedule once. ONLY use this from the Apps Script editor.
  const sh = _getReportSchedulesSheet();
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const COL = {};
  headers.forEach((h, i) => { COL[h] = i; });

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[COL.active] !== 'on') continue;
    const reportId   = row[COL.reportId];
    const recipients = String(row[COL.recipients] || '').split(',').map(s => s.trim()).filter(Boolean);
    let filters = {};
    try { filters = JSON.parse(row[COL.filters] || '{}'); } catch (_) {}
    if (!recipients.length) continue;
    recipients.forEach(to => {
      MailApp.sendEmail({
        to,
        subject: `[DRY RUN] ${_reportTitle(reportId)}`,
        body:    _buildEmailBody(reportId, filters, true),
        name:   'EVGCPL Portal',
      });
    });
    Logger.log('Dry-run sent ' + reportId + ' to ' + recipients.length);
  }
}
