/**
 * ════════════════════════════════════════════════════════════════
 *  EVGCPL Portal — Apps Script Router  (canonical doPost/doGet)
 *  ────────────────────────────────────────────────────────────────
 *  This is the ONLY doPost/doGet that should exist in an Apps Script
 *  project. If you have another Code.gs with doPost, DELETE its
 *  doPost function before deploying this.
 *
 *  ── ONE FILE, MANY PROJECTS ────────────────────────────────────
 *  The portal talks to SIX separate Apps Script projects (portalConfig,
 *  main, pcc, accounts, safety, pinReset — see EXEC_REGISTRY_DEFAULTS in
 *  portal-bundle.js). This same Router.gs is pasted into each of them, but
 *  each project holds only SOME of the handler files: the Accounts project
 *  has AccountsHandlers.gs and TallyVendorReconcile.gs and has never had
 *  PCCHandlers.gs or RecruitmentHandlers.gs.
 *
 *  So most actions listed below are, in any given project, names of
 *  functions that do not exist there. That is expected and fine — but the
 *  old router called them directly, so asking a project for an action it
 *  does not own produced a raw "saveBOQ is not defined" ReferenceError,
 *  which reads like a bug in the handler rather than "you called the wrong
 *  deployment". Dispatch now goes through ACTION_OWNER: an action whose
 *  handler is absent is reported as NOT SERVED BY THIS DEPLOYMENT, naming
 *  the file that provides it.
 *
 *  Nothing needs to be deleted per project. Paste this file everywhere as
 *  it is; each deployment answers for what it actually has.
 *
 *  ── Diagnosing "wrong deployment" ──────────────────────────────
 *  POST {"action":"__whoami__"} to any /exec URL. It replies with the
 *  actions that deployment can actually serve and the backend versions it
 *  reports — which is how you tell two deployments of the same project
 *  apart without guessing from a URL.
 *
 *  Add a new action:
 *    1. Add the handler function in a .gs file in the RIGHT project
 *    2. Register it in ACTION_OWNER below (name → the file providing it)
 *    3. Wire it into the dispatch block in doPost
 *    4. Deploy → Manage deployments → ✏️ → New version
 *       (NOT "New deployment" — that mints a new /exec URL and leaves every
 *        portal still holding the old one silently on the old code)
 * ═══════════════════════════════════════════════════════════════ */

// Action → the .gs file that provides its handler. Used only to explain a
// missing handler; it never affects dispatch. Keeping it beside the dispatch
// block is deliberate: a name added to one and not the other is obvious.
var ACTION_OWNER = {
  appendRow: 'CoreWrites.gs',  appendRowMapped: 'CoreWrites.gs',
  updateCell: 'CoreWrites.gs', batchUpdate: 'CoreWrites.gs',
  closeSafetyIncident: 'SafetyHandlers.gs',

  saveScheduledReport: 'ScheduledReports.gs', deleteScheduledReport: 'ScheduledReports.gs',
  runReportNow: 'ScheduledReports.gs', runSchedulesNow: 'ScheduledReports.gs',
  getScheduleLog: 'ScheduledReports.gs',

  tvrSaveBatch: 'TallyVendorReconcile.gs', tvrGetStatus: 'TallyVendorReconcile.gs',
  tvrGetBatch: 'TallyVendorReconcile.gs',  tvrSaveRules: 'TallyVendorReconcile.gs',
  tvrRunNow: 'TallyVendorReconcile.gs',    tvrSetSign: 'TallyVendorReconcile.gs',

  aiChat: 'AIChat.gs', aiProxy: 'AiProxy.gs',
  diagnoseSheet: 'SheetDiagnostic.gs', listShares: 'SheetDiagnostic.gs',

  saveProjectSetup: 'PCCHandlers.gs', saveBOQ: 'PCCHandlers.gs',
  saveWBS: 'PCCHandlers.gs', deleteWBSRow: 'PCCHandlers.gs',
  deleteActivity: 'PCCHandlers.gs', saveWorkplan: 'PCCHandlers.gs',
  saveManpower: 'PCCHandlers.gs', saveMachinery: 'PCCHandlers.gs',
  saveMaterials: 'PCCHandlers.gs', saveOverheads: 'PCCHandlers.gs',
  saveVariations: 'PCCHandlers.gs', submitBudgetApproval: 'PCCHandlers.gs',

  getSheetHeaders: 'SheetDiagnostic.gs', readSheet: 'SheetRead.gs',
  savePortalConfig: 'PortalConfigBackend.gs', getPortalConfig: 'PortalConfigBackend.gs',
  verifyPin: 'PIN.gs', resetPin: 'PIN.gs',

  saveMRF: 'RecruitmentHandlers.gs', updateMRF: 'RecruitmentHandlers.gs',
  updateMRFStatus: 'RecruitmentHandlers.gs', getMRFs: 'RecruitmentHandlers.gs',
  saveOffer: 'RecruitmentHandlers.gs', updateOfferStatus: 'RecruitmentHandlers.gs',
  createJoiningEntry: 'RecruitmentHandlers.gs', getJoiningList: 'RecruitmentHandlers.gs',
  getJoiningListSchema: 'RecruitmentHandlers.gs', savePreJoining: 'RecruitmentHandlers.gs',
  markAsJoined: 'RecruitmentHandlers.gs', assignEmpCode: 'RecruitmentHandlers.gs',
  sendOfferEmail: 'RecruitmentHandlers.gs', updateApptLetter: 'RecruitmentHandlers.gs',

  saveNewPaymentRequest: 'AccountsHandlers.gs', saveAccountsUpdate: 'AccountsHandlers.gs',
  saveVendorOpeningBalance: 'AccountsHandlers.gs', saveGRNReview: 'AccountsHandlers.gs',
  createPRFolder: 'AccountsHandlers.gs', uploadPRAttachment: 'AccountsHandlers.gs',
  listPRAttachments: 'AccountsHandlers.gs'
};

// Is a handler actually present in THIS project? Top-level function
// declarations land on the global object under the V8 runtime; the try/catch
// and the `this` fallback keep this from throwing under the legacy runtime,
// where a missing name would otherwise be a ReferenceError of its own.
function _has(name) {
  try {
    var g = (typeof globalThis !== 'undefined') ? globalThis : this;
    return !!g && typeof g[name] === 'function';
  } catch (err) {
    return false;
  }
}

// Every action this deployment can actually serve.
function _served() {
  var out = [];
  Object.keys(ACTION_OWNER).forEach(function (a) { if (_has(a)) out.push(a); });
  return out.sort();
}

// The "you called the wrong deployment" answer. Says what is missing, which
// file provides it, and what this deployment DOES serve — enough to identify
// the right /exec URL without opening the editor.
function _notServed(action) {
  var owner = ACTION_OWNER[action] || 'an unknown file';
  return _err('Action "' + action + '" is NOT SERVED BY THIS DEPLOYMENT. Its handler lives in ' +
    owner + ', which is not in this Apps Script project. Either you are calling the wrong /exec ' +
    'URL, or ' + owner + ' needs to be added here and redeployed. This deployment serves: ' +
    _served().join(', '));
}

// ════════════════════════════════════════════════════════════════
// doPost — main entry point for portal writes
// ════════════════════════════════════════════════════════════════
function doPost(e) {
  // Parse the request body. Frontend sends Content-Type: text/plain with
  // a JSON body so the browser doesn't issue a CORS preflight.
  var body;
  try {
    var raw = (e && e.postData && e.postData.contents) || '{}';
    body = JSON.parse(raw);
  } catch (err) {
    return _err('Invalid JSON body: ' + err.message);
  }
  if (!body || typeof body !== 'object') body = {};

  var action = String(body.action || '').trim();
  if (!action) return _err('Missing action');

  try {
    // ── Diagnostics ─────────────────────────────────────────────
    if (action === '__ping__')                 return _ok({ message: 'pong', at: new Date().toISOString() });
    if (action === '__whoami__')               return _ok(_whoami());

    // A registered action whose handler is absent belongs to another project.
    // Answering that plainly here keeps it from surfacing as a ReferenceError
    // from inside a handler that was never actually reached.
    if (ACTION_OWNER[action] && !_has(action)) return _notServed(action);

    // ── Generic writes (CoreWrites.gs) ─────────────────────────
    if (action === 'appendRow')                return appendRow(body);
    if (action === 'appendRowMapped')          return appendRowMapped(body);
    if (action === 'updateCell')               return updateCell(body);
    if (action === 'batchUpdate')              return batchUpdate(body);
    if (action === 'closeSafetyIncident')      return closeSafetyIncident(body);

    // ── Scheduled reports (ScheduledReports.gs) ────────────────
    if (action === 'saveScheduledReport')      return saveScheduledReport(body);
    if (action === 'deleteScheduledReport')    return deleteScheduledReport(body);
    if (action === 'runReportNow')             return runReportNow(body);
    // Schedule Diagnostics panel
    if (action === 'runSchedulesNow')          return _ok(forceRunSchedules());
    if (action === 'getScheduleLog')           return _ok(getScheduleLog_(body.limit || 30));

    // ── Tally vs vendor ledger reconciliation (TallyVendorReconcile.gs) ──
    if (action === 'tvrSaveBatch')             return _wrap(tvrSaveBatch(body));
    if (action === 'tvrGetStatus')             return _wrap(tvrGetStatus(body));
    if (action === 'tvrGetBatch')              return _wrap(tvrGetBatch(body));
    if (action === 'tvrSaveRules')             return _wrap(tvrSaveRules(body));
    if (action === 'tvrRunNow')                return _wrap(tvrRunNow(body));
    if (action === 'tvrSetSign')               return _wrap(tvrSetSign(body));

    // ── AI (AIChat.gs / AiProxy.gs) ────────────────────────────
    if (action === 'aiChat')                   return aiChat(body);
    if (action === 'aiProxy')                  return aiProxy(body);

    // ── Sheet diagnostic (SheetDiagnostic.gs) ──────────────────
    if (action === 'diagnoseSheet')            return diagnoseSheet(body);

    // ── PCC handlers (PCCHandlers.gs) ──────────────────────────
    // Pass the full body. The handlers normalize with _norm() so they
    // tolerate undefined, top-level fields, OR a legacy { payload: {...} } wrapper.
    if (action === 'saveProjectSetup')         return _wrap(saveProjectSetup(body));
    if (action === 'saveBOQ')                  return _wrap(saveBOQ(body));
    if (action === 'saveWBS')                  return saveWBS(body);   // returns its own response
    if (action === 'deleteWBSRow')             return deleteWBSRow(body);
    if (action === 'deleteActivity')           return deleteActivity(body);
    if (action === 'saveWorkplan')             return saveWorkplan(body);
    if (action === 'saveManpower')             return _wrap(saveManpower(body));
    if (action === 'saveMachinery')            return _wrap(saveMachinery(body));
    if (action === 'saveMaterials')            return _wrap(saveMaterials(body));
    if (action === 'saveOverheads')            return _wrap(saveOverheads(body));
    if (action === 'saveVariations')           return _wrap(saveVariations(body));
    if (action === 'submitBudgetApproval')     return _wrap(submitBudgetApproval(body));

    // ── Diagnostics / schema inspection ────────────────────────
    if (action === 'getSheetHeaders')          return getSheetHeaders(body);

    // ── Filter-immune full-tab read (SheetRead.gs) ─────────────
    // Reads via getValues() so an active BASIC FILTER on the sheet no longer
    // hides rows from the app (gviz honours the filter; this does not).
    if (action === 'readSheet')                return readSheet(body);

    // ── Portal config (PortalConfig tab in Master sheet) ───────
    if (action === 'savePortalConfig')         return savePortalConfig(body);
    if (action === 'getPortalConfig')          return getPortalConfig(body);

    // ── PIN ops (separate PIN.gs if present) ───────────────────
    if (action === 'verifyPin')                return verifyPin(body);
    if (action === 'resetPin')                 return resetPin(body);

    // ── Recruitment (RecruitmentHandlers.gs) ───────────────────
    if (action === 'saveMRF')                  return _wrap(saveMRF(body));
    if (action === 'updateMRF')                return _wrap(updateMRF(body));
    if (action === 'updateMRFStatus')          return _wrap(updateMRFStatus(body));
    if (action === 'getMRFs')                  return _wrap(getMRFs(body));
    if (action === 'saveOffer')                return _wrap(saveOffer(body));
    if (action === 'updateOfferStatus')        return _wrap(updateOfferStatus(body));
    if (action === 'createJoiningEntry')       return _wrap(createJoiningEntry(body));
    if (action === 'getJoiningList')           return _wrap(getJoiningList(body));
    if (action === 'getJoiningListSchema')     return _wrap(getJoiningListSchema());
    if (action === 'savePreJoining')           return _wrap(savePreJoining(body));
    if (action === 'markAsJoined')             return _wrap(markAsJoined(body));
    if (action === 'assignEmpCode')            return _wrap(assignEmpCode(body));
    if (action === 'sendOfferEmail')           return _wrap(sendOfferEmail(body));
    if (action === 'updateApptLetter')         return _wrap(updateApptLetter(body));

    // ── Accounts (AccountsHandlers.gs) ─────────────────────────
    if (action === 'saveNewPaymentRequest')    return _wrap(saveNewPaymentRequest(body));
    if (action === 'saveAccountsUpdate')       return _wrap(saveAccountsUpdate(body));
    if (action === 'saveVendorOpeningBalance') return _wrap(saveVendorOpeningBalance(body));
    if (action === 'saveGRNReview')            return _wrap(saveGRNReview(body));
    if (action === 'createPRFolder')           return _wrap(createPRFolder(body));
    if (action === 'uploadPRAttachment')       return _wrap(uploadPRAttachment(body));
    if (action === 'listPRAttachments')        return _wrap(listPRAttachments(body));

    return _err('Unknown POST action: ' + action + '. This deployment serves: ' + _served().join(', '));

  } catch (err) {
    Logger.log('[doPost] action=' + action + ' error: ' + err);
    return _err('Server error in ' + action + ': ' + err.message);
  }
}

// What this deployment is and what it can do. The one call that settles
// "which deployment am I actually talking to" — a question a URL alone
// cannot answer once several deployments of the same project exist.
function _whoami() {
  var out = {
    at: new Date().toISOString(),
    served: _served(),
    registered: Object.keys(ACTION_OWNER).sort()
  };
  // Backend contract versions, when the file that owns one is present here.
  try { if (typeof TVR_BACKEND_VERSION !== 'undefined') out.tvrBackendVersion = TVR_BACKEND_VERSION; }
  catch (err) { /* not in this project */ }
  try { out.timeZone = Session.getScriptTimeZone(); } catch (err) { /* no auth */ }
  // Which of the known handler files this project appears to hold, inferred
  // from which of their actions resolved.
  var files = {};
  Object.keys(ACTION_OWNER).forEach(function (a) { if (_has(a)) files[ACTION_OWNER[a]] = true; });
  out.files = Object.keys(files).sort();
  return out;
}

// ════════════════════════════════════════════════════════════════
// doGet — read-only entry point
// ════════════════════════════════════════════════════════════════
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  if (!action || action === '__ping__') {
    return _ok({ message: 'EVGCPL Portal API alive', at: new Date().toISOString() });
  }
  // Reachable from a browser address bar, which is the fastest way to identify
  // a deployment when several URLs are in play.
  if (action === '__whoami__')                 return _ok(_whoami());
  if (ACTION_OWNER[action] && !_has(action))   return _notServed(action);
  if (action === 'diagnoseSheet')              return diagnoseSheet(e.parameter);
  if (action === 'listShares')                 return listShares(e.parameter);
  if (action === 'getScheduleLog')             return _ok(getScheduleLog_(e.parameter.limit || 30));
  return _err('Unknown GET action: ' + action);
}

// ════════════════════════════════════════════════════════════════
// Response helpers
// ════════════════════════════════════════════════════════════════

// Build a {success:true, ...payload} JSON response
function _ok(payload) {
  var out = { success: true };
  if (payload) Object.keys(payload).forEach(function(k) { out[k] = payload[k]; });
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

// Build a {success:false, message} JSON response
function _err(message) {
  return ContentService.createTextOutput(JSON.stringify({
    success: false, message: String(message || 'error')
  })).setMimeType(ContentService.MimeType.JSON);
}

// Wrap handlers that return a raw value (count, object, or already-built ContentService response)
function _wrap(result) {
  // Already a ContentService response → pass through
  if (result && typeof result.getContent === 'function') return result;
  // Number → "Saved N rows"
  if (typeof result === 'number') return _ok({ message: 'Saved ' + result + ' rows', count: result });
  // Object → if has success field, return as-is; else wrap as ok
  if (result && typeof result === 'object') {
    if (result.success !== undefined) return _ok(result);
    return _ok(result);
  }
  // Anything else (undefined, null, string) → generic OK
  return _ok({ message: 'OK' });
}
