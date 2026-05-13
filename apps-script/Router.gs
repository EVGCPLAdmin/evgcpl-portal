/**
 * ════════════════════════════════════════════════════════════════
 *  EVGCPL Portal — Apps Script Router  (canonical doPost/doGet)
 *  ────────────────────────────────────────────────────────────────
 *  This is the ONLY doPost/doGet that should exist in the bound
 *  Apps Script project. If you have another Code.gs with doPost,
 *  DELETE its doPost function before deploying this.
 *
 *  Add a new action:
 *    1. Add the handler function in any .gs file in this project
 *    2. Register it below in the action map
 *    3. Deploy → New version (exec URL stays the same)
 * ═══════════════════════════════════════════════════════════════ */

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

    // ── Generic writes (SafetyHandlers.gs) ─────────────────────
    if (action === 'appendRow')                return appendRow(body);
    if (action === 'updateCell')               return updateCell(body);
    if (action === 'batchUpdate')              return batchUpdate(body);
    if (action === 'closeSafetyIncident')      return closeSafetyIncident(body);

    // ── Scheduled reports (ScheduledReports.gs) ────────────────
    if (action === 'saveScheduledReport')      return saveScheduledReport(body);
    if (action === 'deleteScheduledReport')    return deleteScheduledReport(body);
    if (action === 'runReportNow')             return runReportNow(body);

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

    // ── Portal config (PortalConfig tab in Master sheet) ───────
    if (action === 'savePortalConfig')         return savePortalConfig(body);
    if (action === 'getPortalConfig')          return getPortalConfig(body);

    // ── PIN ops (separate PIN.gs if present) ───────────────────
    if (action === 'verifyPin')                return verifyPin(body);
    if (action === 'resetPin')                 return resetPin(body);

    return _err('Unknown POST action: ' + action);

  } catch (err) {
    Logger.log('[doPost] action=' + action + ' error: ' + err);
    return _err('Server error in ' + action + ': ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════
// doGet — read-only entry point
// ════════════════════════════════════════════════════════════════
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  if (!action || action === '__ping__') {
    return _ok({ message: 'EVGCPL Portal API alive', at: new Date().toISOString() });
  }
  if (action === 'diagnoseSheet')              return diagnoseSheet(e.parameter);
  if (action === 'listShares')                 return listShares(e.parameter);
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
