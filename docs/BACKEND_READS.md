# Filter-proof reads (`readSheet` backend action)

## Why

The portal reads sheets through Google's **gviz** endpoint (`/gviz/tq`,
`fetchSheet()` in `portal-bundle.js`). gviz reflects a sheet's active **basic
filter** — if someone filters the backend sheet, those rows disappear from the
web app too.

Reading a tab through Apps Script (`getDataRange().getValues()`) **ignores
filters and hidden rows**, so the app always sees the full data.

## How it works in the app

`fetchSheetSafe(tab, sheetId, opts)` is used by the high-traffic loaders
(StockIN, PO_Actual, PO_Items, GRN master, GRN_No, PaymentRequest, StockTransfer,
ST_StockIN). It:

1. Probes the **main** backend once per browser for a `readSheet` action
   (cached 24h in `localStorage` under `evg_bkread_cap_v1`).
2. If present → reads the tab through the backend (filter-proof).
3. On **any** miss/error → falls back to gviz.

So **nothing changes until you deploy the action below.** After deploying, the
app picks it up automatically (or run `_evgRefreshBackendRead()` in the browser
console to re-probe immediately).

Only full-tab reads route to the backend; reads that pass a `SELECT …` query stay
on gviz (a query is itself a deliberate filter).

## What to deploy

Add this `readSheet` case to the **main** Apps Script web app's `doPost`
router (the one `getExec('main')` points at), then **redeploy** the web app.

```js
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) {}

  if (body.action === 'readSheet') {
    return _readSheet(body);
  }

  // … your existing actions …
}

function _jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _readSheet(body) {
  // Capability ping — lets the portal detect this action is deployed.
  if (body.ping) return _jsonOut({ ok: true, readSheet: true });

  try {
    var ss  = SpreadsheetApp.openById(body.sheetId);
    var sh  = ss.getSheetByName(body.tab);
    if (!sh) return _jsonOut({ ok: false, error: 'tab not found: ' + body.tab });

    var values = sh.getDataRange().getValues();      // ignores filters / hidden rows
    var headerRows = body.headerRows == null ? 1 : Number(body.headerRows) || 1;
    if (values.length < headerRows) return _jsonOut({ ok: true, rows: [] });

    var headers = values[headerRows - 1].map(function (h) {
      return String(h == null ? '' : h).trim();
    });

    var rows = [];
    for (var r = headerRows; r < values.length; r++) {
      var obj = {}, blank = true;
      for (var c = 0; c < headers.length; c++) {
        var key = headers[c];
        if (!key) continue;
        var v = values[r][c];
        v = (v == null) ? '' : String(v).trim();      // match gviz string output
        if (v !== '') blank = false;
        obj[key] = v;
      }
      if (!blank) rows.push(obj);
    }
    return _jsonOut({ ok: true, rows: rows });
  } catch (err) {
    return _jsonOut({ ok: false, error: String(err) });
  }
}
```

### Notes

- The web app must be deployed as **Execute as: Me**, **Who has access: Anyone**
  (the same setting your existing POST actions use), so the browser can read it
  cross-origin.
- The account that owns the script must have at least view access to every
  spreadsheet id the portal reads (Master, PO, Stores, Payment).
- Output keys = the header row labels, values trimmed to strings — identical to
  what `fetchSheet` returns from gviz, so the rest of the app is unchanged.
- `headerRows` defaults to 1; pass it through if a tab's header isn't row 1.

### Verify

1. Redeploy the web app (new version).
2. In the portal, open the browser console and run `_evgRefreshBackendRead()`,
   then reload.
3. Apply a basic filter on a backend tab (e.g. StockIN) — the web app should now
   still show **all** rows.
