/**
 * ════════════════════════════════════════════════════════════════
 *  EVGCPL Portal — Apps Script Router (doPost / doGet)
 *  Build target: v3.4.1+
 * ────────────────────────────────────────────────────────────────
 *  This file goes into the bound Apps Script project at:
 *    https://script.google.com/macros/s/AKfycb…/exec
 *
 *  Every POST from the portal arrives here. The router parses the
 *  JSON body, reads `action`, and calls the matching handler defined
 *  in the sibling .gs files in this folder.
 *
 *  IMPORTANT — when you add a new handler:
 *    1. Add the function in its appropriate file (or a new .gs file)
 *    2. Add the route below in the if-chain
 *    3. Deploy → Manage Deployments → ✏️ → New Version → Deploy
 *       (the exec URL doesn't change; only redeploy makes new code live)
 * ════════════════════════════════════════════════════════════════
 */

// ════════════════════════════════════════════════════════════════
// doPost — main entry point for portal writes
// ════════════════════════════════════════════════════════════════
function doPost(e) {
  // CORS-safe parsing: portal sends Content-Type: text/plain with a JSON body
  let body;
  try {
    body = JSON.parse(e.postData && e.postData.contents || '{}');
  } catch (parseErr) {
    return _jsonErr('Invalid JSON body: ' + parseErr.message);
  }

  const action = String(body.action || '').trim();
  if (!action) return _jsonErr('Missing action');

  try {
    // ── Diagnostics / health check ─────────────────────────────
    if (action === '__ping__') {
      return _jsonOk({ message: 'pong', deploymentTime: new Date().toISOString() });
    }

    // ── Generic write helpers (in SafetyHandlers.gs) ───────────
    if (action === 'appendRow')           return appendRow(body);
    if (action === 'updateCell')          return updateCell(body);
    if (action === 'batchUpdate')         return batchUpdate(body);

    // ── Safety module (in SafetyHandlers.gs) ───────────────────
    if (action === 'closeSafetyIncident') return closeSafetyIncident(body);

    // ── Scheduled email reports (in ScheduledReports.gs) ───────
    if (action === 'saveScheduledReport') return saveScheduledReport(body);
    if (action === 'deleteScheduledReport') return deleteScheduledReport(body);
    if (action === 'runReportNow')        return runReportNow(body);

    // ── AI proxy (in AIChat.gs / AiProxy.gs) ───────────────────
    if (action === 'aiChat')              return aiChat(body);
    if (action === 'aiProxy')             return aiProxy(body);

    // ── Sheet sharing diagnostic (in SheetDiagnostic.gs) ───────
    if (action === 'diagnoseSheet')       return diagnoseSheet(body);

    // ── PCC — Project Cost Control (in PCCHandlers.gs) ─────────
    if (action === 'saveProjectSetup')     return _wrap(saveProjectSetup(body));
    if (action === 'saveBOQ')              return _wrap(saveBOQ(body));
    if (action === 'saveWBS')              return saveWBS(body);  // returns ContentService directly
    if (action === 'saveWorkplan')         return _wrap(saveWorkplan(body));
    if (action === 'saveManpower')         return _wrap(saveManpower(body));
    if (action === 'saveMachinery')        return _wrap(saveMachinery(body));
    if (action === 'saveMaterials')        return _wrap(saveMaterials(body));
    if (action === 'saveOverheads')        return _wrap(saveOverheads(body));
    if (action === 'saveVariations')       return _wrap(saveVariations(body));
    if (action === 'submitBudgetApproval') return _wrap(submitBudgetApproval(body));

    // ── PIN reset (lives in this file or a separate PIN.gs) ────
    if (action === 'verifyPin')           return verifyPin(body);
    if (action === 'resetPin')            return resetPin(body);

    return _jsonErr('Unknown POST action: ' + action);

  } catch (err) {
    Logger.log('doPost error in action=' + action + ': ' + err);
    return _jsonErr('Server error in ' + action + ': ' + err.message);
  }
}

// ════════════════════════════════════════════════════════════════
// doGet — read-only entry point
// ════════════════════════════════════════════════════════════════
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || '';

  if (action === '__ping__' || !action) {
    return _jsonOk({ message: 'EVGCPL Portal Apps Script · alive', deploymentTime: new Date().toISOString() });
  }

  // ── Diagnostic GETs (in SheetDiagnostic.gs) ──────────────────
  if (action === 'diagnoseSheet')       return diagnoseSheet(e.parameter);
  if (action === 'listShares')          return listShares(e.parameter);

  return _jsonErr('Unknown GET action: ' + action);
}

// ════════════════════════════════════════════════════════════════
//  Response helpers
// ════════════════════════════════════════════════════════════════

// Build a {success:true, …} JSON ContentService response
function _jsonOk(payload) {
  return ContentService.createTextOutput(
    JSON.stringify(Object.assign({ success: true }, payload || {}))
  ).setMimeType(ContentService.MimeType.JSON);
}

// Build a {success:false, message:…} JSON ContentService response
function _jsonErr(message, extra) {
  return ContentService.createTextOutput(
    JSON.stringify(Object.assign({ success: false, message: String(message || 'error') }, extra || {}))
  ).setMimeType(ContentService.MimeType.JSON);
}

// Wrap a count-returning handler in the standard {success, message} response.
// Used for handlers that return a number (count of rows written) rather than
// constructing their own ContentService response.
function _wrap(result) {
  if (typeof result === 'number') {
    return _jsonOk({ message: 'Saved ' + result + ' rows', count: result });
  }
  // If the handler already returned a ContentService response, pass it through
  if (result && typeof result.getContent === 'function') return result;
  // If it returned a plain object, normalize
  if (result && typeof result === 'object') {
    if (result.success !== undefined) return _jsonOk(result);
    return _jsonOk(result);
  }
  return _jsonOk({ message: 'OK' });
}
