/**
 * TallyVendorReconcile.gs — daily Tally-vs-portal vendor ledger reconciliation.
 *
 * Compares two flat, point-in-time tables of per-vendor closing balances:
 *
 *   A. TallyLedgerImport    ← uploaded from the portal (Tally vendor ledger
 *                             export, CSV). One batch per upload.
 *   B. VendorLedgerSnapshot ← captured from the portal's Vendor Ledger (PO)
 *                             Flat List. One batch per snapshot.
 *
 * …flags every vendor whose closing balance differs beyond TVR_TOLERANCE, plus
 * vendors present in one source and missing from the other, writes them to the
 * Mismatches tab, and emails each mismatch to the recipients its amount tier in
 * MismatchRules routes to.
 *
 * ── Why the snapshot is uploaded, not computed here ────────────────────
 * The portal's vendor balance is NOT a simple sum. It is produced by
 * _vplpCompute() in assets/js/portal-bundle.js (~700 lines: PO rate tiers laid
 * end-to-end against received qty, per-GRN accounts reviews that override the
 * PO rate, Tax(a)/Tax(b)/additional-charge apportionment, opening balances that
 * close out everything before their own date, and a vendor-master bridge from
 * payment name/account → Vendor ID). Re-implementing that here would duplicate
 * the hardest logic in the codebase and silently drift the moment either copy
 * changed — the reconciliation would then report mismatches caused by its own
 * arithmetic rather than by Tally. So the browser, which already computes those
 * numbers to render the Flat List, posts them here verbatim. This file does no
 * valuation at all: it diffs two flat tables and emails the differences.
 *
 * The consequence to know about: the snapshot is only as fresh as the last time
 * someone opened the Vendor Ledger page (the portal auto-snapshots once a day
 * on load). Every mismatch email states the snapshot's age, and a snapshot
 * older than TVR_STALE_HOURS is called out at the top of the mail.
 *
 * ── One-time setup (in the Apps Script editor) ─────────────────────────
 *   1. Paste this file into the portal's Apps Script project (the one with
 *      Router.gs).
 *   2. Add these cases to the doPost action map in Router.gs:
 *
 *        if (action === 'tvrSaveBatch')  return tvrSaveBatch(body);
 *        if (action === 'tvrGetStatus')  return tvrGetStatus(body);
 *        if (action === 'tvrGetBatch')   return tvrGetBatch(body);
 *        if (action === 'tvrSaveRules')  return tvrSaveRules(body);
 *        if (action === 'tvrRunNow')     return tvrRunNow(body);
 *        if (action === 'tvrSetSign')    return tvrSetSign(body);
 *
 *   3. Run  installVendorReconcileTrigger()  once → authorises the script and
 *      creates the daily 08:30 trigger. The four tabs are created automatically
 *      on first use, so there is nothing to hand-build.
 *   4. Run  tvrTestNow()  to reconcile + email immediately without waiting.
 *
 * ── Linking a vendor (this is what makes the match work) ───────────────
 *   The join is Tally's $GUID against a TallyUID column in the Vendor Master
 *   tab (7-VendorMaster_Actual). The Tally export is the WHOLE chart of
 *   accounts — in the sample, 1,169 ledgers of which only 587 were Sundry
 *   Creditors — so a ledger is only reconciled once its GUID is recorded
 *   against a vendor. TallyUID is the ONLY matcher — there is deliberately no
 *   name or A/C fallback, because once a definitive key exists a fuzzy fallback
 *   can only pair the wrong two ledgers, and it would do so silently.
 *
 *   So an unlinked vendor is never guessed at; it is reported, on whichever
 *   side it is missing:
 *     • Tally ledger with no Vendor Master TallyUID  → "unlinked" list
 *     • Portal vendor with a balance and no TallyUID → its own list, NOT
 *       "missing from Tally" (nothing is known about Tally's view of it)
 *     • Portal vendor WITH a TallyUID that Tally never mentioned → a real
 *       mismatch
 *   The portal shows a coverage figure (linked / total vendors) beside the
 *   mismatch count, because an empty mismatch list means nothing if only a
 *   fraction of the vendor book is linked.
 *
 * ── Sign convention ───────────────────────────────────────────────────
 *   Tally's $_ClosingBalance sign is not self-evident and was NOT assumed:
 *   in the sample, Sundry Creditors carried both signs. Figures are stored
 *   exactly as exported and converted at compare time via TVR_SIGN_FLIP.
 *   The portal's Overview shows the matched pairs side by side with the
 *   total difference each way, so the correct setting is obvious on the
 *   first upload; one button (tvrSetSign) switches it, and because the flip
 *   happens at compare time nothing needs re-uploading.
 *
 * ── Recipients (test → all) ────────────────────────────────────────────
 *   Starts in TEST mode: every mail goes ONLY to TVR_TEST_RECIPIENT, whatever
 *   the rules say, and subjects are tagged [TEST]. When the routing looks
 *   right, run  tvrEnableAll()  once to start mailing the real recipients.
 *   Revert any time with  tvrDisableAll(). The flag lives in Script Properties,
 *   so no code edit is needed. (Same pattern as GRNDailyEmail.gs.)
 */

// Vendor-finance workbook — already holds OpeningBalance and 7-VendorMaster_Actual.
var TVR_SHEET_ID = '1WhjqAGb5XNSQ-q-tPA7tGPQa-aPpgX2LHzzOy2HwTkA';

var TVR_TAB_TALLY    = 'TallyLedgerImport';
var TVR_TAB_SNAPSHOT = 'VendorLedgerSnapshot';
var TVR_TAB_RULES    = 'MismatchRules';
var TVR_TAB_MISMATCH = 'Mismatches';

// Balances within this many rupees of each other are treated as equal — Tally
// and the portal round differently, so an exact compare would flag everything.
var TVR_TOLERANCE = 1;
// Rows rendered inline in the mail. Beyond this the full list goes as a CSV
// attachment instead: Apps Script caps the message BODY well below the overall
// message size, and a first run with hundreds of mismatches blew that limit
// ("Limit Exceeded: Email Body Size"), which previously failed the whole run.
var TVR_EMAIL_MAX_ROWS = 60;
// A snapshot older than this is flagged as stale in the email.
var TVR_STALE_HOURS = 30;

var TVR_TEST_RECIPIENT = 'admin@evgcpl.com';

// Bumped whenever this file gains an action or changes a stored shape. The
// portal compares it against the build it expects and says plainly when the
// deployed script is older — otherwise a stale deployment surfaces only as a
// cryptic "Unknown POST action: <name>" at the moment someone clicks the
// feature that needs it. Editing a .gs file is not enough: Apps Script serves
// the last DEPLOYED snapshot, so a redeploy is always required.
//   1 = initial   2 = +tvrGetBatch/history   3 = +tvrSetSign, GUID matching
//   4 = TallyUID is the ONLY matcher; portal-side unlinked + coverage reported
//   5 = existing tabs get their header row migrated (new columns were being
//       written but never read back, so GUID matching silently found nothing)
var TVR_BACKEND_VERSION = 5;

// Tally's $_ClosingBalance sign convention is NOT self-evident from the export:
// in the sample, Sundry Creditors carried both signs (197 positive, 180
// negative), so "creditors are negative" does not hold. The portal's own
// convention is fixed and documented (_vplpBalStatus: a POSITIVE balance means
// we owe the vendor). Rather than guess — a wrong guess inverts every
// comparison and reports a false mismatch of roughly double the balance for
// every vendor — Tally figures are stored EXACTLY as exported and the flip is
// applied at compare time from this flag, so changing it re-reconciles without
// re-uploading anything. Set it from the portal once the first upload's
// side-by-side makes the convention obvious.
function _tvrSignFlip() {
  return PropertiesService.getScriptProperties().getProperty('TVR_SIGN_FLIP') === 'true';
}
function tvrSetSign(body) {
  body = body || {};
  var flip = !!body.flip;
  if (flip) PropertiesService.getScriptProperties().setProperty('TVR_SIGN_FLIP', 'true');
  else PropertiesService.getScriptProperties().deleteProperty('TVR_SIGN_FLIP');
  return { success: true, signFlip: flip,
           message: flip ? 'Tally balances will be negated before comparing.'
                         : 'Tally balances will be compared as exported.' };
}
// One place that turns a stored Tally figure into the portal's convention.
function _tvrTallyBal(v) { var n = _tvrNum(v); return _tvrSignFlip() ? -n : n; }

var TVR_HEADERS = {};
// GUID (Tally's $GUID) and TallyUID (the Vendor Master column) are the real
// join between the two systems; name and A/C stay as fallbacks for ledgers that
// haven't been linked yet. Parent is Tally's ledger group ("Sundry Creditors",
// "Employee Creditors", …) — kept so an unlinked ledger can be identified
// without going back to Tally.
TVR_HEADERS[TVR_TAB_TALLY]    = ['UploadedAt', 'UploadedBy', 'BatchId', 'Vendor Name', 'A/C Number', 'Closing Balance', 'GUID', 'Parent'];
TVR_HEADERS[TVR_TAB_SNAPSHOT] = ['UploadedAt', 'UploadedBy', 'BatchId', 'Vendor Name', 'A/C Number', 'Closing Balance', 'TallyUID'];
TVR_HEADERS[TVR_TAB_RULES]    = ['RuleID', 'MinAmount', 'MaxAmount', 'Recipients', 'Label', 'Active'];
TVR_HEADERS[TVR_TAB_MISMATCH] = ['Date', 'RunId', 'Vendor Name', 'A/C Number', 'TallyBalance', 'PortalBalance', 'Diff', 'Type', 'NotifiedTo', 'RuleLabel', 'GUID', 'MatchedBy', 'Vendor ID', 'TallyUID'];

// Seeded on first use so the rules table is never empty (an empty table would
// silently route nothing). Edit from the portal's Rules tab, not here.
var TVR_DEFAULT_RULES = [
  ['R1', 0,    5000, 'accounts@evgcpl.com',                    'Minor — Accounts',    'Yes'],
  ['R2', 5000, '',   'accounts@evgcpl.com,admin@evgcpl.com',   'Major — Accounts + MD', 'Yes']
];

/* ════════════════════════════════════════════════════════════════════
   Recipient mode
   ════════════════════════════════════════════════════════════════════ */

function _tvrSendAll() {
  return PropertiesService.getScriptProperties().getProperty('TVR_SEND_ALL') === 'true';
}
function tvrEnableAll() {
  PropertiesService.getScriptProperties().setProperty('TVR_SEND_ALL', 'true');
  return 'Vendor reconcile emails → ALL (recipients come from the MismatchRules tab)';
}
function tvrDisableAll() {
  PropertiesService.getScriptProperties().deleteProperty('TVR_SEND_ALL');
  return 'Vendor reconcile emails → TEST mode: ' + TVR_TEST_RECIPIENT + ' only';
}

/* ════════════════════════════════════════════════════════════════════
   Trigger install / remove
   ════════════════════════════════════════════════════════════════════ */

function installVendorReconcileTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runDailyVendorReconcile') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runDailyVendorReconcile').timeBased().atHour(8).nearMinute(30).everyDays(1).create();
  return 'Installed: runDailyVendorReconcile runs daily ~08:30 (' + (Session.getScriptTimeZone() || '?') + ')';
}

function uninstallVendorReconcileTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runDailyVendorReconcile') { ScriptApp.deleteTrigger(t); n++; }
  });
  return 'Removed ' + n + ' vendor-reconcile trigger(s)';
}

// Run once from the editor to reconcile + email immediately.
function tvrTestNow() { return runDailyVendorReconcile(); }

/* ════════════════════════════════════════════════════════════════════
   Sheet helpers
   ════════════════════════════════════════════════════════════════════ */

// Get a tab, creating it with its header row if missing.
function _tvrSheet(tab) {
  var ss = SpreadsheetApp.openById(TVR_SHEET_ID);
  var sh = ss.getSheetByName(tab);
  var want = TVR_HEADERS[tab] || [];
  if (!sh) {
    sh = ss.insertSheet(tab);
    if (want.length) {
      sh.getRange(1, 1, 1, want.length).setValues([want]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    if (tab === TVR_TAB_RULES) {
      sh.getRange(2, 1, TVR_DEFAULT_RULES.length, TVR_DEFAULT_RULES[0].length).setValues(TVR_DEFAULT_RULES);
    }
    return sh;
  }
  _tvrMigrateHeaders(sh, want);
  return sh;
}

// Bring an EXISTING tab's header row up to date.
//
// Headers used to be written only when a tab was first created, so a sheet
// built by an earlier version kept its original columns forever. Later versions
// then wrote wider rows — GUID/Parent on the Tally tab, TallyUID on the
// snapshot, Vendor ID/TallyUID on Mismatches — and the values landed in the
// sheet but the header row never named them. Since _tvrRows() is header-keyed
// and skips unnamed columns, those values were written and then silently
// dropped on read: matching by GUID would have failed on every row while
// looking, from the outside, like nothing was linked.
//
// Every header change so far has been an APPEND, so filling in blanks at the
// end is safe. A cell that already holds a DIFFERENT name is left untouched —
// renaming someone's column, or shifting data under a relabelled header, would
// be far worse than reporting the mismatch.
function _tvrMigrateHeaders(sh, want) {
  if (!want.length) return;
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var have = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var norm = function (v) { return String(v == null ? '' : v).trim(); };
  var writes = [], conflicts = [];
  for (var i = 0; i < want.length; i++) {
    var cur = norm(have[i]);
    if (cur === norm(want[i])) continue;
    if (cur === '') { writes.push(i); continue; }
    conflicts.push('col ' + (i + 1) + ': sheet has "' + cur + '", expected "' + want[i] + '"');
  }
  if (conflicts.length) {
    Logger.log('[TVR] "' + sh.getName() + '" header differs from the expected layout, left as-is: ' + conflicts.join('; '));
    return;   // don't touch a sheet whose columns were rearranged by hand
  }
  if (!writes.length) return;
  // One write covering the whole expected width keeps the row consistent.
  sh.getRange(1, 1, 1, want.length).setValues([want]).setFontWeight('bold');
  if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
  Logger.log('[TVR] "' + sh.getName() + '" header extended with: ' +
             writes.map(function (i) { return want[i]; }).join(', '));
}

// All data rows of a tab as header-keyed objects.
function _tvrRows(tab) {
  var sh = _tvrSheet(tab);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var head = values[0].map(function (h) { return String(h == null ? '' : h).trim(); });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var o = {}, blank = true;
    for (var c = 0; c < head.length; c++) {
      if (!head[c]) continue;
      o[head[c]] = values[r][c];
      if (String(values[r][c] == null ? '' : values[r][c]).trim() !== '') blank = false;
    }
    if (!blank) out.push(o);
  }
  return out;
}

function _tvrNum(v) {
  if (typeof v === 'number') return v;
  var s = String(v == null ? '' : v).trim();
  if (!s) return 0;
  // Strip currency symbols, thousands separators and a trailing Dr/Cr marker.
  var cr = /cr\s*$/i.test(s), dr = /dr\s*$/i.test(s);
  s = s.replace(/[₹,\s]/g, '').replace(/(dr|cr)$/i, '');
  var neg = /^\(.*\)$/.test(s);              // (1,234) = negative, as Tally exports it
  if (neg) s = s.slice(1, -1);
  var n = parseFloat(s);
  if (isNaN(n)) return 0;
  if (neg) n = -n;
  // A Dr-marked balance is the opposite sign of a Cr-marked one. The portal's
  // convention (see _vplpBalStatus) is Cr-positive = payable to the vendor.
  if (dr && n > 0) n = -n;
  if (cr && n < 0) n = -n;
  return n;
}

function _tvrNorm(s) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
}

function _tvrTz() { return Session.getScriptTimeZone() || 'Asia/Kolkata'; }

function _tvrFmt(d) { return Utilities.formatDate(d, _tvrTz(), 'dd-MMM-yyyy HH:mm'); }

function _tvrInr(n) {
  var neg = n < 0, v = Math.round(Math.abs(n));
  // Indian grouping: last 3 digits, then pairs.
  var s = String(v), out;
  if (s.length <= 3) out = s;
  else {
    var last3 = s.slice(-3), rest = s.slice(0, -3);
    out = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }
  return (neg ? '-' : '') + '₹' + out;
}

/* ════════════════════════════════════════════════════════════════════
   ACTION: tvrSaveBatch — store one uploaded/captured batch
   body: { kind:'tally'|'snapshot', uploadedBy, rows:[{name, acc, balance}] }

   Every call writes a NEW batch (its own BatchId). Older batches are kept, so
   the tab's own history is the upload log — who uploaded what, and when.
   ════════════════════════════════════════════════════════════════════ */
function tvrSaveBatch(body) {
  body = body || {};
  var kind = String(body.kind || '').trim();
  var tab = kind === 'tally' ? TVR_TAB_TALLY : kind === 'snapshot' ? TVR_TAB_SNAPSHOT : '';
  if (!tab) return { success: false, message: 'tvrSaveBatch: kind must be "tally" or "snapshot"' };

  var rows = body.rows || [];
  if (!Array.isArray(rows) || !rows.length) return { success: false, message: 'tvrSaveBatch: no rows' };

  var now = new Date();
  var at = _tvrFmt(now);
  var by = String(body.uploadedBy || '').trim() || 'unknown';
  var batchId = kind.toUpperCase().slice(0, 4) + '-' + Utilities.formatDate(now, _tvrTz(), 'yyyyMMdd-HHmmss');

  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    var name = String(r.name == null ? '' : r.name).trim();
    if (!name) continue;                       // a nameless row can never be matched
    var base = [at, by, batchId, name, String(r.acc == null ? '' : r.acc).trim(), _tvrNum(r.balance)];
    // Tally rows carry the ledger GUID + group; snapshot rows carry the Vendor
    // Master TallyUID. Stored raw — the sign flip happens at compare time.
    if (kind === 'tally') base.push(String(r.guid == null ? '' : r.guid).trim(), String(r.parent == null ? '' : r.parent).trim());
    else base.push(String(r.tallyUid == null ? '' : r.tallyUid).trim());
    out.push(base);
  }
  if (!out.length) return { success: false, message: 'tvrSaveBatch: every row was missing a vendor name' };

  var sh = _tvrSheet(tab);
  sh.getRange(sh.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);
  return { success: true, batchId: batchId, uploadedAt: at, uploadedBy: by, count: out.length };
}

// One batch's rows. batchId '' (or omitted) selects the newest — BatchIds embed
// yyyyMMdd-HHmmss so they sort chronologically as plain strings.
function _tvrBatch(tab, batchId) {
  var rows = _tvrRows(tab);
  if (!rows.length) return { batchId: '', at: '', by: '', rows: [] };
  var want = String(batchId || '');
  if (!want) {
    rows.forEach(function (r) {
      var b = String(r['BatchId'] || '');
      if (b > want) want = b;
    });
  }
  var mine = rows.filter(function (r) { return String(r['BatchId'] || '') === want; });
  return {
    batchId: mine.length ? want : '',
    at: mine.length ? String(mine[0]['UploadedAt'] || '') : '',
    by: mine.length ? String(mine[0]['UploadedBy'] || '') : '',
    rows: mine
  };
}

function _tvrLatestBatch(tab) { return _tvrBatch(tab, ''); }

// 'TALL-20260825-081500' → '2026-08-25'. The id is generated by tvrSaveBatch, so
// this is more reliable than re-parsing the human-formatted UploadedAt string.
function _tvrBatchDate(batchId) {
  var m = String(batchId || '').match(/(\d{4})(\d{2})(\d{2})-\d{6}$/);
  return m ? (m[1] + '-' + m[2] + '-' + m[3]) : '';
}

// Days in the window that have a Tally upload but NO portal snapshot. Those days
// can never be reconciled later: the Tally file is stored, but a past portal
// balance cannot be reconstructed once the underlying POs/GRNs/payments move on.
function _tvrSnapshotGaps(days) {
  var span = days || 30;
  var snapDates = {};
  _tvrBatchLog(TVR_TAB_SNAPSHOT, 9999).forEach(function (b) {
    var d = _tvrBatchDate(b.batchId); if (d) snapDates[d] = true;
  });
  var cutoff = Date.now() - span * 864e5;
  var seen = {}, gaps = [];
  _tvrBatchLog(TVR_TAB_TALLY, 9999).forEach(function (b) {
    var d = _tvrBatchDate(b.batchId);
    if (!d || seen[d] || snapDates[d]) return;
    var t = Date.parse(d + 'T00:00:00Z');
    if (isNaN(t) || t < cutoff) return;
    seen[d] = true;
    gaps.push(d);
  });
  return gaps.sort().reverse();
}

// Past reconciliation runs, newest first — the history index the Overview picker
// reads. Built from the Mismatches tab, so it replays what was ACTUALLY reported
// on the day rather than recomputing it from data that has since moved.
function _tvrRunIndex(limit) {
  var byRun = {};
  _tvrRows(TVR_TAB_MISMATCH).forEach(function (r) {
    var id = String(r['RunId'] || ''); if (!id) return;
    if (!byRun[id]) byRun[id] = { runId: id, date: String(r['Date'] || ''), count: 0, totalValue: 0 };
    byRun[id].count++;
    byRun[id].totalValue += Math.abs(_tvrNum(r['Diff']));
  });
  var list = Object.keys(byRun).map(function (k) { return byRun[k]; });
  list.sort(function (a, b) { return a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0; });
  return list.slice(0, limit || 60);
}

// Batch history, newest first — the freshness log the portal renders.
function _tvrBatchLog(tab, limit) {
  var rows = _tvrRows(tab);
  var by = {};
  rows.forEach(function (r) {
    var b = String(r['BatchId'] || ''); if (!b) return;
    if (!by[b]) by[b] = { batchId: b, at: String(r['UploadedAt'] || ''), by: String(r['UploadedBy'] || ''), count: 0 };
    by[b].count++;
  });
  var list = Object.keys(by).map(function (k) { return by[k]; });
  list.sort(function (a, b) { return a.batchId < b.batchId ? 1 : a.batchId > b.batchId ? -1 : 0; });
  return list.slice(0, limit || 15);
}

/* ════════════════════════════════════════════════════════════════════
   The diff
   ════════════════════════════════════════════════════════════════════ */

// Match Tally rows to snapshot rows. A/C number is the reliable key, but Tally
// ledger exports often carry only the ledger name — so match on A/C first and
// fall back to the normalised name for whatever is left over. Anything still
// unmatched on either side is itself a reported mismatch.
// Match Tally ledgers to portal vendors and classify every row.
//
// Join order, strongest first:
//   1. GUID  — Tally's $GUID against the TallyUID column in Vendor Master. This
//              is the only identifier both systems agree on by construction.
//   2. A/C   — the portal's Vendor ID, when the Tally export happens to carry it.
//   3. Name  — normalised, for ledgers not yet linked.
//
// The export is the WHOLE chart of accounts (in the sample, 1,169 ledgers of
// which only 587 were Sundry Creditors — the rest bank, GST, salary, asset and
// employee ledgers). Reporting every unmatched ledger as a mismatch would bury
// the real ones under ~1,000 rows of noise, so anything that never matches is
// returned separately as `unlinked` — non-zero ones only, since a zero-balance
// ledger nobody linked is not worth anyone's attention.
//
// Returns { mismatches, unlinked, matched } where `matched` backs the
// sign-convention check in the portal.
// Their Tally ledgers embed the portal Vendor ID as a name suffix —
// "Srons Engineers Private Limited-MV10" against Vendor ID MV10. In the sample
// export 248 of 1,169 ledgers used it and 245 of those were Sundry Creditors,
// so this one rule links most vendors before a single TallyUID is filled in.
// Kept strict (a trailing -LETTERS+DIGITS token only) and only accepted when it
// equals a real Vendor ID, so it can't invent a match.
function _tvrVidInName(n) {
  var m = /-\s*([A-Za-z]{1,6}\d{1,6})\s*$/.exec(String(n || ''));
  return m ? m[1] : '';
}

function _tvrDiff(tallyRows, snapRows) {
  var T = tallyRows.map(function (r) {
    return {
      name: String(r['Vendor Name'] || '').trim(),
      acc: String(r['A/C Number'] || '').trim(),
      guid: String(r['GUID'] || '').trim(),
      parent: String(r['Parent'] || '').trim(),
      raw: _tvrNum(r['Closing Balance']),        // exactly as Tally exported it
      bal: _tvrTallyBal(r['Closing Balance']),   // in the portal's convention
      vidInName: _tvrVidInName(r['Vendor Name']),
      used: false
    };
  }).filter(function (r) { return r.name; });

  var S = snapRows.map(function (r) {
    return {
      name: String(r['Vendor Name'] || '').trim(),
      acc: String(r['A/C Number'] || '').trim(),
      uid: String(r['TallyUID'] || '').trim(),
      bal: _tvrNum(r['Closing Balance']),
      used: false
    };
  }).filter(function (r) { return r.name; });

  var byUid = {}, byAcc = {}, byName = {};
  S.forEach(function (s) {
    if (s.uid) { var u = _tvrNorm(s.uid); if (!byUid[u]) byUid[u] = s; }
    if (s.acc) { var a = _tvrNorm(s.acc); if (!byAcc[a]) byAcc[a] = s; }
    var n = _tvrNorm(s.name); if (!byName[n]) byName[n] = s;
  });
  var pick = function (map, key) {
    if (!key) return null;
    var m = map[_tvrNorm(key)];
    return (m && !m.used) ? m : null;
  };

  var mismatches = [], unlinked = [], matched = [];
  T.forEach(function (t) {
    // TallyUID in Vendor Master is an exact copy of Tally's $GUID, so it is the
    // ONLY matcher. Name and Vendor-ID-code fallbacks were removed deliberately:
    // once a definitive key exists, a fuzzy fallback can only ever pair the
    // wrong two ledgers — and it would do so silently, producing a confident
    // balance comparison between unrelated accounts. A vendor with no TallyUID
    // is reported as unlinked (on whichever side it is missing), never guessed.
    var m = pick(byUid, t.guid), how = 'guid';
    if (!m) {
      // No Vendor Master row carries this GUID. Only worth surfacing if it holds
      // money. vidInName is carried purely as a SUGGESTION for whoever fills in
      // TallyUID — it never takes part in matching.
      if (Math.abs(t.bal) > TVR_TOLERANCE) {
        unlinked.push({ name: t.name, acc: t.acc, guid: t.guid, parent: t.parent,
                        tally: t.bal, raw: t.raw, vidInName: t.vidInName });
      }
      return;
    }
    m.used = true; t.used = true;
    // The displayed name is always the portal's (Vendor Master) spelling; Tally's
    // is kept alongside so a naming difference is visible rather than confusing.
    matched.push({ name: m.name || t.name, tallyName: t.name, guid: t.guid, vid: m.acc,
                   tallyUid: m.uid, matchedBy: how, tallyRaw: t.raw, tally: t.bal, portal: m.bal });
    var diff = t.bal - m.bal;
    if (Math.abs(diff) > TVR_TOLERANCE) {
      mismatches.push({ name: m.name || t.name, tallyName: t.name, acc: t.acc || m.acc,
                        guid: t.guid, vid: m.acc, tallyUid: m.uid, matchedBy: how,
                        tally: t.bal, portal: m.bal, diff: diff, type: 'balance-diff' });
    }
  });

  // Portal vendors left over. Two very different situations, kept apart:
  //   • no TallyUID       → not linked yet. Nothing is known about Tally's view
  //                         of this vendor, so calling it "missing from Tally"
  //                         would be an assertion the data does not support.
  //   • has a TallyUID    → genuinely absent from the export. A real finding.
  var unlinkedPortal = [];
  S.forEach(function (s) {
    if (s.used) return;
    if (Math.abs(s.bal) <= TVR_TOLERANCE) return;
    if (!s.uid) {
      unlinkedPortal.push({ name: s.name, vid: s.acc, portal: s.bal });
      return;
    }
    mismatches.push({ name: s.name, tallyName: '', acc: s.acc, guid: '', vid: s.acc,
                      tallyUid: s.uid, matchedBy: '',
                      tally: '', portal: s.bal, diff: -s.bal, type: 'missing-in-tally' });
  });

  mismatches.sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff); });
  unlinked.sort(function (a, b) { return Math.abs(b.tally) - Math.abs(a.tally); });
  unlinkedPortal.sort(function (a, b) { return Math.abs(b.portal) - Math.abs(a.portal); });
  // linkedPortal / totalPortal give the coverage figure: how much of the vendor
  // book is actually being reconciled, which strict matching makes essential to
  // show — an empty mismatch list means nothing if only a handful are linked.
  var linkedPortal = 0;
  S.forEach(function (s) { if (s.uid) linkedPortal++; });
  return { mismatches: mismatches, unlinked: unlinked, matched: matched,
           unlinkedPortal: unlinkedPortal, linkedPortal: linkedPortal, totalPortal: S.length };
}

/* ════════════════════════════════════════════════════════════════════
   Rule routing
   ════════════════════════════════════════════════════════════════════ */

function _tvrRules() {
  return _tvrRows(TVR_TAB_RULES)
    .filter(function (r) { return String(r['Active'] || 'Yes').trim().toLowerCase() !== 'no'; })
    .map(function (r) {
      var min = _tvrNum(r['MinAmount']);
      var maxRaw = String(r['MaxAmount'] == null ? '' : r['MaxAmount']).trim();
      return {
        id: String(r['RuleID'] || ''),
        min: min,
        max: maxRaw === '' ? Infinity : _tvrNum(maxRaw),   // blank MaxAmount = no upper bound
        recipients: String(r['Recipients'] || '').split(/[,;]/).map(function (s) { return s.trim(); }).filter(Boolean),
        label: String(r['Label'] || r['RuleID'] || '')
      };
    });
}

// First rule whose [min, max) band contains the mismatch amount.
function _tvrMatchRule(rules, amount) {
  var a = Math.abs(amount);
  for (var i = 0; i < rules.length; i++) {
    if (a >= rules[i].min && a < rules[i].max) return rules[i];
  }
  return null;
}

/* ════════════════════════════════════════════════════════════════════
   Main: reconcile → log → email
   ════════════════════════════════════════════════════════════════════ */

// opts: { tallyBatchId, snapshotBatchId, skipEmail }
// With no batch ids this is the daily job: latest Tally vs latest snapshot.
// Naming either one reconciles a specific past pair instead — used by the
// "Reconcile a past date" control. A historical re-run APPENDS a new RunId; it
// never rewrites the original run, so the record of what was reported on the day
// survives. It also defaults to skipEmail, because re-checking an old day should
// not re-notify anyone who already dealt with it.
function runDailyVendorReconcile(opts) {
  opts = opts || {};
  var historical = !!(opts.tallyBatchId || opts.snapshotBatchId);
  if (historical && opts.skipEmail === undefined) opts.skipEmail = true;

  var tally = _tvrBatch(TVR_TAB_TALLY, opts.tallyBatchId);
  var snap  = _tvrBatch(TVR_TAB_SNAPSHOT, opts.snapshotBatchId);

  if (opts.tallyBatchId && !tally.rows.length) return { success: false, message: 'Tally batch not found: ' + opts.tallyBatchId };
  if (opts.snapshotBatchId && !snap.rows.length) return { success: false, message: 'Snapshot batch not found: ' + opts.snapshotBatchId };
  if (!tally.rows.length) return { success: false, message: 'No Tally export has been uploaded yet.' };
  if (!snap.rows.length)  return { success: false, message: 'No vendor ledger snapshot has been captured yet.' };

  var diff = _tvrDiff(tally.rows, snap.rows);
  var mismatches = diff.mismatches;
  var rules = _tvrRules();
  var now = new Date();
  var runId = 'RUN-' + Utilities.formatDate(now, _tvrTz(), 'yyyyMMdd-HHmmss');
  var dateStr = Utilities.formatDate(now, _tvrTz(), 'dd-MMM-yyyy');

  // Group by recipient set so each person gets one mail listing everything
  // routed to them, rather than one mail per mismatch.
  var buckets = {};
  mismatches.forEach(function (m) {
    var rule = _tvrMatchRule(rules, m.diff);
    m.rule = rule;
    m.notifiedTo = rule ? rule.recipients.join(',') : '';
    if (!rule || !rule.recipients.length) return;
    var key = rule.recipients.slice().sort().join(',');
    if (!buckets[key]) buckets[key] = { recipients: rule.recipients, items: [] };
    buckets[key].items.push(m);
  });

  // Log every mismatch, routed or not — an unrouted one still needs a record.
  if (mismatches.length) {
    var sh = _tvrSheet(TVR_TAB_MISMATCH);
    var rows = mismatches.map(function (m) {
      return [dateStr, runId, m.name, m.acc, m.tally, m.portal, m.diff, m.type,
              m.notifiedTo, m.rule ? m.rule.label : 'UNROUTED', m.guid || '', m.matchedBy || '',
              m.vid || '', m.tallyUid || ''];
    });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }

  var staleHrs = _tvrAgeHours(snap.at);
  var sent = [];
  var emailErrors = [];
  if (!opts.skipEmail) {
    Object.keys(buckets).forEach(function (k) {
      var b = buckets[k];
      var to = _tvrSendAll() ? b.recipients.join(',') : TVR_TEST_RECIPIENT;
      // The reconciliation itself has already been written to the sheet by this
      // point. A mail that can't be delivered must not throw that away, so each
      // send is isolated and its failure reported rather than raised.
      try {
        var opt = { name: 'EVGCPL Portal', htmlBody: _tvrHtml(b.items, dateStr, tally, snap, staleHrs) };
        if (b.items.length > TVR_EMAIL_MAX_ROWS) {
          opt.attachments = [Utilities.newBlob('\ufeff' + _tvrCsv(b.items), 'text/csv',
                             'mismatches_' + runId + '.csv')];   // BOM so Excel opens it as UTF-8
        }
        MailApp.sendEmail(to, _tvrSubject(b.items, dateStr),
                          _tvrBody(b.items, dateStr, tally, snap, staleHrs), opt);
        sent.push({ to: to, count: b.items.length });
      } catch (err) {
        emailErrors.push({ to: to, count: b.items.length, error: String(err && err.message || err) });
      }
    });
  }

  return {
    success: true, runId: runId, mismatches: mismatches.length,
    // vendorsCompared is the MATCHED count, not the export's row count — the
    // export is the whole chart of accounts, so "1,169 compared" would be a lie.
    vendorsCompared: diff.matched.length,
    tallyLedgers: tally.rows.length, unlinked: diff.unlinked.length,
    emails: sent, mode: _tvrSendAll() ? 'ALL' : 'TEST', snapshotAgeHours: staleHrs,
    tallyBatch: tally.batchId, snapshotBatch: snap.batchId,
    historical: historical, emailed: !opts.skipEmail, signFlip: _tvrSignFlip(),
    emailErrors: emailErrors
  };
}

// Hours since a "dd-MMM-yyyy HH:mm" stamp; -1 when unparseable.
function _tvrAgeHours(at) {
  var t = Date.parse(String(at || '').replace(/-/g, ' '));
  if (isNaN(t)) return -1;
  return Math.round((Date.now() - t) / 36e5);
}

// Full mismatch list for the attachment — every row, no cap.
function _tvrCsv(items) {
  var esc = function (v) {
    v = (v == null ? '' : String(v));
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  var lines = [['Vendor (Vendor Master)', 'Vendor ID', 'Tally UID', 'Tally Name',
                'Tally Balance', 'Portal Balance', 'Difference', 'Type', 'Matched By'].join(',')];
  items.forEach(function (m) {
    lines.push([m.name, m.vid || '', m.tallyUid || '', m.tallyName || '',
                m.tally === '' ? '' : m.tally, m.portal === '' ? '' : m.portal,
                m.diff, _tvrTypeLabel(m.type), m.matchedBy || ''].map(esc).join(','));
  });
  return lines.join('\r\n');
}

function _tvrSubject(items, dateStr) {
  var total = items.reduce(function (s, m) { return s + Math.abs(m.diff); }, 0);
  return (_tvrSendAll() ? '' : '[TEST] ') +
    'Tally vs Portal — ' + items.length + ' vendor mismatch' + (items.length === 1 ? '' : 'es') +
    ' (' + _tvrInr(total) + ') — ' + dateStr;
}

function _tvrTypeLabel(t) {
  return t === 'balance-diff' ? 'Balance differs'
       : t === 'missing-in-portal' ? 'In Tally, not in portal'
       : 'In portal, not in Tally';
}

function _tvrBody(items, dateStr, tally, snap, staleHrs) {
  var lines = [];
  if (staleHrs > TVR_STALE_HOURS) {
    lines.push('⚠ The portal snapshot is ' + staleHrs + ' hours old (captured ' + snap.at + ').');
    lines.push('  Open the Vendor Ledger page in the portal to refresh it, then re-run.');
    lines.push('');
  }
  lines.push('Tally vendor ledger vs the portal Vendor Ledger (PO) Flat List — ' + dateStr + '.');
  lines.push('Tally export uploaded ' + tally.at + ' by ' + tally.by + ' (' + tally.rows.length + ' vendors).');
  lines.push('Portal snapshot captured ' + snap.at + ' by ' + snap.by + ' (' + snap.rows.length + ' vendors).');
  lines.push('');
  var shown = items.slice(0, TVR_EMAIL_MAX_ROWS);
  if (items.length > shown.length) {
    lines.push('Showing the largest ' + shown.length + ' of ' + items.length +
               ' — the full list is attached as CSV.');
    lines.push('');
  }
  shown.forEach(function (m) {
    lines.push('• ' + m.name + (m.acc ? ' [' + m.acc + ']' : ''));
    lines.push('    Tally: ' + (m.tally === '' ? '—' : _tvrInr(m.tally)) +
               '   Portal: ' + (m.portal === '' ? '—' : _tvrInr(m.portal)) +
               '   Diff: ' + _tvrInr(m.diff) + '   (' + _tvrTypeLabel(m.type) + ')');
  });
  lines.push('');
  lines.push('— EVGCPL Portal (automated daily vendor reconciliation)');
  return lines.join('\n');
}

function _tvrHtml(items, dateStr, tally, snap, staleHrs) {
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  var warn = staleHrs > TVR_STALE_HOURS
    ? '<p style="background:#fef3c7;border-left:4px solid #f59e0b;padding:10px 12px;margin:0 0 14px;font-size:13px">' +
      '<b>Snapshot is ' + staleHrs + ' hours old</b> (captured ' + esc(snap.at) + '). Open the Vendor Ledger page in the portal to refresh it, then re-run.</p>'
    : '';
  var shown = items.slice(0, TVR_EMAIL_MAX_ROWS);
  var moreNote = items.length > shown.length
    ? '<p style="font-size:12px;color:#6b7280;margin:0 0 10px">Showing the largest <b>' + shown.length +
      '</b> of <b>' + items.length + '</b>. The full list is attached as a CSV.</p>'
    : '';
  var rows = shown.map(function (m) {
    var col = m.diff >= 0 ? '#b45309' : '#1d4ed8';
    return '<tr>' +
      '<td style="padding:6px 9px;border-bottom:1px solid #e5e7eb">' + esc(m.name) +
        (m.acc ? ' <span style="color:#6b7280;font-size:11px">[' + esc(m.acc) + ']</span>' : '') + '</td>' +
      '<td style="padding:6px 9px;border-bottom:1px solid #e5e7eb;text-align:right">' + (m.tally === '' ? '—' : _tvrInr(m.tally)) + '</td>' +
      '<td style="padding:6px 9px;border-bottom:1px solid #e5e7eb;text-align:right">' + (m.portal === '' ? '—' : _tvrInr(m.portal)) + '</td>' +
      '<td style="padding:6px 9px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:' + col + '">' + _tvrInr(m.diff) + '</td>' +
      '<td style="padding:6px 9px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280">' + _tvrTypeLabel(m.type) + '</td>' +
      '</tr>';
  }).join('');
  return '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111827">' +
    '<h2 style="font-size:17px;margin:0 0 4px">Tally vs Portal — vendor mismatches</h2>' +
    '<p style="color:#6b7280;font-size:13px;margin:0 0 14px">' + esc(dateStr) + '</p>' + warn +
    '<p style="font-size:12px;color:#6b7280;margin:0 0 12px">' +
      'Tally export uploaded ' + esc(tally.at) + ' by ' + esc(tally.by) + ' (' + tally.rows.length + ' vendors)<br>' +
      'Portal snapshot captured ' + esc(snap.at) + ' by ' + esc(snap.by) + ' (' + snap.rows.length + ' vendors)</p>' +
    moreNote +
    '<table style="border-collapse:collapse;font-size:13px;width:100%">' +
    '<thead><tr style="background:#1f2937;color:#fff;text-align:left">' +
      '<th style="padding:8px 9px">Vendor</th><th style="padding:8px 9px;text-align:right">Tally</th>' +
      '<th style="padding:8px 9px;text-align:right">Portal</th><th style="padding:8px 9px;text-align:right">Diff</th>' +
      '<th style="padding:8px 9px">Type</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<p style="color:#9ca3af;font-size:11px;margin-top:16px">— EVGCPL Portal (automated daily vendor reconciliation)</p></div>';
}

/* ════════════════════════════════════════════════════════════════════
   ACTION: tvrRunNow — reconcile on demand from the portal
   body: { skipEmail?:true }
   ════════════════════════════════════════════════════════════════════ */
function tvrRunNow(body) {
  body = body || {};
  var opts = { tallyBatchId: body.tallyBatchId || '', snapshotBatchId: body.snapshotBatchId || '' };
  // Only force a value when the caller actually asked; otherwise let
  // runDailyVendorReconcile apply its historical-run default.
  if (body.skipEmail !== undefined) opts.skipEmail = !!body.skipEmail;
  return runDailyVendorReconcile(opts);
}

/* ════════════════════════════════════════════════════════════════════
   ACTION: tvrGetBatch — the stored rows of one batch
   body: { kind:'tally'|'snapshot', batchId }
   Backs the clickable Upload Log: shows exactly what was uploaded or
   captured that day, straight from the sheet.
   ════════════════════════════════════════════════════════════════════ */
function tvrGetBatch(body) {
  body = body || {};
  var kind = String(body.kind || '').trim();
  var tab = kind === 'tally' ? TVR_TAB_TALLY : kind === 'snapshot' ? TVR_TAB_SNAPSHOT : '';
  if (!tab) return { success: false, message: 'tvrGetBatch: kind must be "tally" or "snapshot"' };
  var b = _tvrBatch(tab, body.batchId || '');
  if (!b.rows.length) return { success: false, message: 'Batch not found: ' + (body.batchId || '(latest)') };
  return {
    success: true, kind: kind, batchId: b.batchId, at: b.at, by: b.by,
    rows: b.rows.map(function (r) {
      return { name: String(r['Vendor Name'] || ''), acc: String(r['A/C Number'] || ''), balance: _tvrNum(r['Closing Balance']) };
    })
  };
}

/* ════════════════════════════════════════════════════════════════════
   ACTION: tvrGetStatus — everything the portal page renders, in one call
   ════════════════════════════════════════════════════════════════════ */
// body: { runId?, logLimit? }
// runId selects a past run to replay; omitted means the newest.
function tvrGetStatus(body) {
  body = body || {};
  var tally = _tvrLatestBatch(TVR_TAB_TALLY);
  var snap  = _tvrLatestBatch(TVR_TAB_SNAPSHOT);

  var all = _tvrRows(TVR_TAB_MISMATCH);
  var newestRun = '';
  all.forEach(function (r) { var id = String(r['RunId'] || ''); if (id > newestRun) newestRun = id; });
  // Which run to return: the one asked for, else the newest.
  var wantRun = String(body.runId || '') || newestRun;
  var current = all.filter(function (r) { return String(r['RunId'] || '') === wantRun; });

  // Recompute the current pairing so the portal can show what is linked, what
  // isn't, and whether the sign convention looks right — all from stored data,
  // no re-upload. Cheap: two flat tables.
  var live = (tally.rows.length && snap.rows.length) ? _tvrDiff(tally.rows, snap.rows)
                                                     : { mismatches: [], unlinked: [], matched: [] };

  return {
    success: true,
    backendVersion: TVR_BACKEND_VERSION,
    signFlip: _tvrSignFlip(),
    unlinked: live.unlinked.slice(0, 200),
    unlinkedTotal: live.unlinked.length,
    unlinkedPortal: (live.unlinkedPortal || []).slice(0, 200),
    unlinkedPortalTotal: (live.unlinkedPortal || []).length,
    linkedPortal: live.linkedPortal || 0,
    totalPortal: live.totalPortal || 0,
    matchedCount: live.matched.length,
    // A few matched pairs, biggest first — enough to eyeball the sign convention.
    signCheck: live.matched.slice().sort(function (a, b) {
      return Math.abs(b.portal) - Math.abs(a.portal);
    }).slice(0, 6),
    tally:    { batchId: tally.batchId, at: tally.at, by: tally.by, count: tally.rows.length },
    snapshot: { batchId: snap.batchId,  at: snap.at,  by: snap.by,  count: snap.rows.length },
    uploadLog: _tvrBatchLog(TVR_TAB_TALLY, body.logLimit || 15),
    snapshotLog: _tvrBatchLog(TVR_TAB_SNAPSHOT, body.logLimit || 15),
    runId: wantRun,
    latestRunId: newestRun,
    isLatestRun: wantRun === newestRun,
    runs: _tvrRunIndex(60),
    snapshotGaps: _tvrSnapshotGaps(30),
    mismatches: current.map(function (r) {
      return {
        name: String(r['Vendor Name'] || ''), acc: String(r['A/C Number'] || ''),
        tally: r['TallyBalance'], portal: r['PortalBalance'], diff: _tvrNum(r['Diff']),
        type: String(r['Type'] || ''), notifiedTo: String(r['NotifiedTo'] || ''),
        ruleLabel: String(r['RuleLabel'] || ''), guid: String(r['GUID'] || ''),
        matchedBy: String(r['MatchedBy'] || ''), vid: String(r['Vendor ID'] || ''),
        tallyUid: String(r['TallyUID'] || '')
      };
    }),
    rules: _tvrRows(TVR_TAB_RULES).map(function (r) {
      return {
        id: String(r['RuleID'] || ''), min: _tvrNum(r['MinAmount']),
        max: String(r['MaxAmount'] == null ? '' : r['MaxAmount']).trim(),
        recipients: String(r['Recipients'] || ''), label: String(r['Label'] || ''),
        active: String(r['Active'] || 'Yes')
      };
    }),
    mode: _tvrSendAll() ? 'ALL' : 'TEST'
  };
}

/* ════════════════════════════════════════════════════════════════════
   ACTION: tvrSaveRules — replace the whole rules table
   body: { rules: [{ id, min, max, recipients, label, active }] }
   ════════════════════════════════════════════════════════════════════ */
function tvrSaveRules(body) {
  body = body || {};
  var rules = body.rules || [];
  if (!Array.isArray(rules)) return { success: false, message: 'tvrSaveRules: rules must be an array' };

  var sh = _tvrSheet(TVR_TAB_RULES);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, TVR_HEADERS[TVR_TAB_RULES].length).clearContent();
  if (!rules.length) return { success: true, count: 0, message: 'All rules cleared — nothing will be emailed.' };

  var out = rules.map(function (r, i) {
    return [
      String(r.id || ('R' + (i + 1))),
      _tvrNum(r.min),
      String(r.max == null ? '' : r.max).trim() === '' ? '' : _tvrNum(r.max),
      String(r.recipients || ''),
      String(r.label || ''),
      String(r.active || 'Yes')
    ];
  });
  sh.getRange(2, 1, out.length, out[0].length).setValues(out);
  return { success: true, count: out.length };
}
