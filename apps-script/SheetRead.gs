/**
 * SheetRead.gs — the `readSheet` action.
 *
 * WHY: the portal normally reads tabs client-side via gviz (/gviz/tq). gviz
 * reflects a sheet's active BASIC FILTER, so if someone leaves a filter applied
 * on a source tab, the filtered-out rows silently vanish from the app (e.g. the
 * Vendor Ledger loses receipts/payments). Reading through Apps Script with
 * getDataRange().getValues() IGNORES filters and hidden rows.
 *
 * The client (fetchSheetSafe in portal-bundle.js) probes once per browser with
 *   { action:'readSheet', ping:1 }   → expects { ok:true, readSheet:true }
 * and, when present, routes full-tab reads (no gviz `tq` query) here:
 *   { action:'readSheet', sheetId, tab, headerRows } → { ok:true, rows:[…] }
 * On ANY miss/error it falls back to gviz, so the app works whether or not this
 * action is deployed — deploying it just makes reads filter-immune.
 *
 * Rows are returned in the SAME shape gviz yields: header-keyed objects, every
 * value a trimmed string, and Date cells formatted as "Date(y,m,d,h,mi,s)"
 * (month 0-indexed) so the portal's existing date parsers agree.
 *
 * Register in Router.gs:  if (action === 'readSheet') return readSheet(body);
 * Deploy a NEW VERSION of the MAIN web app after adding this (getExec('main')).
 */
function readSheet(body) {
  try {
    if (body && body.ping) return _rsOut({ ok: true, readSheet: true });

    var sheetId = body && body.sheetId;
    var tab = body && body.tab;
    if (!sheetId || !tab) return _rsOut({ ok: false, error: 'Missing sheetId/tab' });

    var headerRows = (body.headerRows != null) ? Number(body.headerRows) : 1;
    if (!(headerRows >= 1)) headerRows = 1;

    var sh = SpreadsheetApp.openById(sheetId).getSheetByName(tab);
    if (!sh) return _rsOut({ ok: false, error: 'tab not found: ' + tab });

    var values = sh.getDataRange().getValues();   // ignores filters / hidden rows
    if (values.length < headerRows) return _rsOut({ ok: true, rows: [] });

    var headers = values[headerRows - 1].map(function (h) { return String(h == null ? '' : h).trim(); });

    var out = [];
    for (var r = headerRows; r < values.length; r++) {
      var row = values[r], obj = {}, blank = true;
      for (var c = 0; c < headers.length; c++) {
        var key = headers[c];
        if (!key) continue;                      // skip unlabeled columns
        var v = _rsCell(row[c]);
        if (v !== '') blank = false;
        obj[key] = v;
      }
      if (!blank) out.push(obj);                  // skip fully-empty rows (gviz omits them too)
    }
    return _rsOut({ ok: true, rows: out });
  } catch (e) {
    return _rsOut({ ok: false, error: String((e && e.message) || e) });
  }
}

// Match gviz cell formatting: trimmed strings; Date → "Date(y,m,d,h,mi,s)".
function _rsCell(v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return 'Date(' + v.getFullYear() + ',' + v.getMonth() + ',' + v.getDate() +
           ',' + v.getHours() + ',' + v.getMinutes() + ',' + v.getSeconds() + ')';
  }
  return String(v).trim();
}

// readSheet responds with { ok: … } (NOT the router's { success: … }), because
// the client checks `j.ok` / `j.readSheet` / `j.rows`.
function _rsOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
