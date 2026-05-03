/**
 * EVGCPL Portal — Sheet Sharing Diagnostic
 * --------------------------------------------------------------------
 * Add this file to your existing Apps Script project (alongside the
 * other doGet/doPost handlers). Then in your main router, add:
 *
 *   if (action === 'diagnoseSheet') return diagnoseSheet_(e);
 *
 * The portal calls this from /assets/js/api.js when a normal gviz
 * fetch fails. Apps Script runs server-side, so it can read HTTP
 * status, content-type, redirect target, and body sniff — none of
 * which are visible to a browser fetch (blocked by CORS).
 *
 * Returned JSON shape:
 *   {
 *     ok: false,
 *     status: 200 | 401 | 403 | 404 | 'TIMEOUT',
 *     contentType: 'text/csv' | 'text/html' | ...,
 *     redirected: true | false,
 *     redirectTo: '<final URL>' | null,
 *     bodySniff: '<first 200 chars>',
 *     bodyBytes: <number>,
 *     verdict:
 *       'PUBLIC_OK'                | // CSV came back, sheet is public
 *       'NOT_PUBLIC_REDIRECTS_TO_LOGIN' | // bounced to ServiceLogin
 *       'WORKSPACE_POLICY_BLOCKED' | // redirected, but to a Workspace policy page
 *       'TAB_NOT_FOUND'            | // sheet public, requested tab missing
 *       'SHEET_NOT_FOUND'          | // 404 — bad sheet ID
 *       'INVALID_RESPONSE'         | // got something we don't recognise
 *       'TIMEOUT',
 *     fixHint: '<one-line plain-English remediation>',
 *   }
 * --------------------------------------------------------------------
 */
function diagnoseSheet_(e) {
  var sheetId = (e.parameter.sheetId || '').trim();
  var tabName = (e.parameter.tab || e.parameter.tabName || '').trim();
  var out = { ok: false, sheetId: sheetId, tab: tabName };

  if (!sheetId) {
    out.verdict = 'INVALID_RESPONSE';
    out.fixHint = 'Missing sheetId parameter.';
    return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
  }

  // Build the same CSV URL the portal would hit
  var url = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?tqx=out:csv';
  if (tabName) url += '&sheet=' + encodeURIComponent(tabName);

  var resp;
  try {
    resp = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: false,    // we want to SEE redirects, not follow them
      validateHttpsCertificates: true,
      // No Authorization header — we want to test ANONYMOUS access,
      // exactly as the user's browser would experience it.
    });
  } catch (err) {
    out.status = 'TIMEOUT';
    out.verdict = 'TIMEOUT';
    out.fixHint = 'Network error reaching docs.google.com: ' + err.message;
    return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
  }

  var status   = resp.getResponseCode();
  var headers  = resp.getAllHeaders ? resp.getAllHeaders() : resp.getHeaders();
  var ctype    = (headers['Content-Type'] || headers['content-type'] || '') + '';
  var location = (headers['Location'] || headers['location'] || '') + '';
  var body     = '';
  try { body = resp.getContentText(); } catch (_) { body = ''; }
  var sniff    = body.replace(/\s+/g, ' ').slice(0, 200);

  out.status        = status;
  out.contentType   = ctype;
  out.bodyBytes     = body.length;
  out.bodySniff     = sniff;
  out.redirected    = (status >= 300 && status < 400);
  out.redirectTo    = out.redirected ? location : null;

  // ── Verdict logic ─────────────────────────────────────────────
  if (status === 200 && /text\/(csv|plain)/i.test(ctype)) {
    out.ok = true;
    out.verdict = 'PUBLIC_OK';
    out.fixHint = 'Sheet is publicly accessible. If the portal still fails, check the tab name.';

  } else if (out.redirected && /accounts\.google\.com|ServiceLogin|signin/i.test(location)) {
    out.verdict = 'NOT_PUBLIC_REDIRECTS_TO_LOGIN';
    out.fixHint = 'The sheet is NOT publicly shared. Either sharing is set to "Restricted" in the Share dialog, OR your Google Workspace admin has a domain policy that silently blocks "Anyone with the link" sharing. Open the sheet URL in an Incognito browser window — if you see a sign-in page, that confirms it.';

  } else if (out.redirected) {
    out.verdict = 'WORKSPACE_POLICY_BLOCKED';
    out.fixHint = 'The sheet redirects to: ' + location + '. This is usually a Google Workspace org policy that overrides "Anyone with the link" sharing. Ask your Workspace admin to allowlist the file, or move the sheet to a personal (non-Workspace) Google account.';

  } else if (status === 200 && /text\/html/i.test(ctype) && /Sign in|ServiceLogin/i.test(body)) {
    out.verdict = 'NOT_PUBLIC_REDIRECTS_TO_LOGIN';
    out.fixHint = 'The sheet returned an HTML sign-in page instead of CSV. It is not publicly shared. Open it in an Incognito browser to confirm.';

  } else if (status === 200 && /text\/html/i.test(ctype)) {
    out.verdict = 'INVALID_RESPONSE';
    out.fixHint = 'The sheet returned HTML instead of CSV. Possible causes: the sheet is owned by a Workspace account with strict policy, or there is a "Trash" / archive notice on the sheet itself.';

  } else if (status === 400 && /Invalid query|invalid sheet|cannot find/i.test(body)) {
    out.verdict = 'TAB_NOT_FOUND';
    out.fixHint = 'The sheet is public, but no tab named "' + tabName + '" exists. Check the exact spelling and capitalization on the sheet.';

  } else if (status === 404) {
    out.verdict = 'SHEET_NOT_FOUND';
    out.fixHint = 'No sheet exists with ID ' + sheetId + '. The ID in the portal config is wrong or the sheet was deleted.';

  } else if (status === 401 || status === 403) {
    out.verdict = 'NOT_PUBLIC_REDIRECTS_TO_LOGIN';
    out.fixHint = 'Server returned ' + status + ' (forbidden). The sheet is private. Set sharing to "Anyone with the link" → Viewer.';

  } else if (status >= 500) {
    out.verdict = 'TIMEOUT';
    out.fixHint = 'Google Sheets returned a ' + status + '. Transient — retry in a moment.';

  } else {
    out.verdict = 'INVALID_RESPONSE';
    out.fixHint = 'Unknown response (status ' + status + ', content-type ' + ctype + '). Sniff: ' + sniff;
  }

  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * Optional — bulk diagnostic for all known portal sheets at once.
 * Called by the Sharing Doctor page in the portal.
 *
 * Add to router:
 *   if (action === 'diagnoseAllSheets') return diagnoseAllSheets_(e);
 *
 * Expects e.parameter.sheets = JSON array of { id, tab, label } objects.
 */
function diagnoseAllSheets_(e) {
  var raw = e.parameter.sheets || '[]';
  var list = [];
  try { list = JSON.parse(raw); } catch (_) { list = []; }

  var results = list.map(function(s) {
    var fakeE = { parameter: { sheetId: s.id, tab: s.tab || '' } };
    var resp  = diagnoseSheet_(fakeE);
    var data  = JSON.parse(resp.getContent());
    data.label = s.label || s.id;
    return data;
  });

  return ContentService
    .createTextOutput(JSON.stringify({ results: results, count: results.length }))
    .setMimeType(ContentService.MimeType.JSON);
}
