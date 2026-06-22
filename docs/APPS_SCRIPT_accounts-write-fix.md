# Apps Script fix — idempotent, timeout-proof Accounts approval writes

> **Where this lives:** the **Google Apps Script project** behind the `accounts` `/exec`
> endpoint (`getExec('accounts')` in the portal) — **not this repo**. The portal (static
> site) only POSTs to it. The build sandbox has no Google egress, so this is authored and
> tested inside the Apps Script editor.
>
> **Problem it fixes:** MD approvals intermittently fail with *"Service Spreadsheets timed
> out while accessing document …"* because the large `PaymentRequest`/`AccountsUpdate`
> workbook is slow and contended under concurrent writes, so the synchronous append can't
> finish in time and the portal bounces the approval back to the queue.
>
> **Strategy (the council's recommendation):** make the user-facing write **idempotent +
> atomic** and land it in a **small append-only inbox sheet**; a **time-driven trigger**
> merges the inbox into the big `AccountsUpdate` tab off the user's critical path. No new
> backend infrastructure — all on Apps Script + Sheets.

The portal already pairs with this (shipped): every approval write now carries a stable
**`DedupeKey`** (and builds the row once, so retries re-post the same key), and the UI says
"submitted — confirming on Sheets…" until the sheet's derived status confirms it.

---

## Contract the portal sends

`POST` (content-type `text/plain`) a JSON body:

```json
{
  "action": "saveAccountsUpdate",
  "sheetId": "<PAYMENT_SHEET_ID>",
  "tab": "AccountsUpdate",
  "row": {
    "UUID": "ACC-AU-xxxxxxxx",
    "DedupeKey": "<requestUuid>|<status>",   // ← stable idempotency key
    "UserEmail": "...", "Updated By": "...",
    "Request ID": "<requestUuid>",
    "Details of Request": "...",
    "Status": "Process Payment, Move to Accounts",
    "Pending Reason": "", "Date": "16/06/2026",
    "UTR Details": "", "Comments (If Any)": "",
    "Timestamp": "16/06/2026 21:19:28"
  }
}
```

Expected response: `{"success": true, "dedupeKey": "...", "duplicate": false}` (or
`duplicate:true` when the key was already recorded). The portal treats any `success !==
false` as posted; it then confirms via the derived status (see "Why this preserves
behavior").

---

## Implementation

### 1. New tab: `AccountsApprovals_Inbox`
A small, dedicated sheet (own workbook or the Accounts workbook — keep it tiny). Header row:

```
DedupeKey | RowJSON | Status | RequestID | Timestamp | ReceivedAt | FlushedAt
```

`RowJSON` is the full `row` object stringified (so the flusher can write it verbatim).
Keeping the inbox tiny is what makes the append near-instant and contention-free.

### 2. `saveAccountsUpdate` handler — idempotent + atomic append to the inbox

```javascript
function saveAccountsUpdate_(payload) {
  const row = payload.row || {};
  const key = String(row.DedupeKey || row.UUID || '').trim();
  if (!key) return { success: false, message: 'missing DedupeKey' };

  // (a) Fast idempotency pre-check via CacheService (covers lost-ACK retries within ~25 min)
  const cache = CacheService.getScriptCache();
  if (cache.get('acc_dk_' + key)) return { success: true, dedupeKey: key, duplicate: true };

  const lock = LockService.getScriptLock();
  // Short wait; if we can't get the lock fast, tell the client to retry (it will, same key)
  if (!lock.tryLock(8000)) return { success: false, message: 'Service busy, try again (lock)' };
  try {
    const sh = SpreadsheetApp.openById(INBOX_SHEET_ID).getSheetByName('AccountsApprovals_Inbox');

    // (b) Durable idempotency: skip if this key is already in the inbox
    const keys = sh.getRange(2, 1, Math.max(0, sh.getLastRow() - 1), 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === key) {
        cache.put('acc_dk_' + key, '1', 1500);
        return { success: true, dedupeKey: key, duplicate: true };
      }
    }

    // (c) Atomic single-row append — no slow reads happen under the lock after this point
    sh.appendRow([
      key, JSON.stringify(row), row.Status || '', row['Request ID'] || '',
      row.Timestamp || '', new Date(), ''   // FlushedAt blank → picked up by the flusher
    ]);
    cache.put('acc_dk_' + key, '1', 1500);
    return { success: true, dedupeKey: key, duplicate: false };
  } catch (e) {
    return { success: false, message: 'inbox append failed: ' + e.message };
  } finally {
    lock.releaseLock();   // release immediately — lock never spans the slow workbook
  }
}
```

Key points:
- The user-facing call only ever touches the **tiny inbox** → no more multi-second waits
  on the big workbook → the timeout goes away.
- The lock scope is **only the inbox append**, grabbed late, released in `finally`.
- Dedupe is checked twice: CacheService (fast, transient) + the inbox column (durable). A
  retried or double-submitted `DedupeKey` never produces a second row.

### 3. Time-driven flusher → merge inbox into `AccountsUpdate`

Install a trigger: **Edit → Triggers → `flushAccountsInbox` → Time-driven → every minute.**

```javascript
function flushAccountsInbox() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return;          // another flush is running; skip this tick
  try {
    const inbox = SpreadsheetApp.openById(INBOX_SHEET_ID).getSheetByName('AccountsApprovals_Inbox');
    const last = inbox.getLastRow();
    if (last < 2) return;
    const data = inbox.getRange(2, 1, last - 1, 7).getValues();   // …FlushedAt = col 7

    const dest = SpreadsheetApp.openById(PAYMENT_SHEET_ID).getSheetByName('AccountsUpdate');
    const header = dest.getRange(1, 1, 1, dest.getLastColumn()).getValues()[0];

    const toAppend = [], flushedRowNums = [];
    for (let i = 0; i < data.length; i++) {
      if (data[i][6]) continue;             // already flushed
      const row = JSON.parse(data[i][1] || '{}');
      toAppend.push(header.map(h => (h in row ? row[h] : '')));  // map by header name
      flushedRowNums.push(i + 2);
    }
    if (toAppend.length) {
      dest.getRange(dest.getLastRow() + 1, 1, toAppend.length, header.length).setValues(toAppend);
      const now = new Date();
      flushedRowNums.forEach(rn => inbox.getRange(rn, 7).setValue(now));  // stamp FlushedAt
    }
  } finally {
    lock.releaseLock();
  }
}
```

- Batched `setValues` (one write for many rows) is far cheaper than per-row `appendRow`,
  and it runs **server-side on a schedule**, not on the user's click.
- Maps by **header name** (matches the portal's read-by-header convention) so column order
  in `AccountsUpdate` doesn't matter.
- Idempotent: `FlushedAt` guards against re-flushing; the inbox's `DedupeKey` already
  guarantees one row per logical approval.
- Optional housekeeping: a daily trigger that deletes inbox rows whose `FlushedAt` is older
  than a few days, to keep the inbox tiny.

### 4. Constants
Add `INBOX_SHEET_ID` (the inbox workbook) and reuse `PAYMENT_SHEET_ID` for the destination.
Keep the old direct-append code path available behind a flag during rollout if you want a
fallback.

---

## Why this preserves current behavior
The portal derives each request's status from the **latest `AccountsUpdate` row** for that
request. The flusher writes exactly that row (verbatim, header-mapped), so once a tick lands
(≤ ~60s), the derived status updates and the portal's existing reconcile poll
(`_txnReconcile`) clears the "In Transaction — syncing" shelf — same UX, now reliable.

## Rollout & test (in the Apps Script project)
1. Create `AccountsApprovals_Inbox` with the header above; add `saveAccountsUpdate_`,
   `flushAccountsInbox`, and the minute trigger.
2. **Idempotency:** call `saveAccountsUpdate` twice with the same `DedupeKey` → exactly one
   inbox row; the second returns `duplicate:true`.
3. **No timeout under load:** fire several concurrent `saveAccountsUpdate` calls → all
   return fast (they only touch the inbox); none time out.
4. **Flush:** wait for the trigger (or run `flushAccountsInbox` manually) → rows land in
   `AccountsUpdate`, `FlushedAt` stamped, and the portal shows the request approved.
5. **Lost-ACK:** simulate a client retry of the same key after a success → no duplicate row.

## Migration trigger (when to revisit a real backend — deferred)
Only revisit moving the Accounts core off Sheets when a **second** module hits the same
concurrency wall, **or** finance needs a first-class immutable ledger / bank-UPI
integration / real-time cash position. The inbox + dedupe pattern above is also the natural
seam to swap in a real datastore later without touching the portal's write contract.

---

# Additional handler — `saveVendorOpeningBalance` (Vendor Ledger opening balances)

> **Added this session.** The Vendor Ledger (PO) now has a side-pull **Opening Balance**
> form that records a vendor's carried-forward Dr/Cr balance. The portal already builds and
> POSTs the row; the `accounts` Apps Script project needs **one small additive handler** to
> append it. This is a plain append (not money-movement, low contention) — it does **not**
> need the inbox/dedupe machinery above; a direct append is fine.

## Where it writes
A **separate spreadsheet** — the Vendor Master workbook
`1WhjqAGb5XNSQ-q-tPA7tGPQa-aPpgX2LHzzOy2HwTkA`, tab **`OpeningBalance`**. The portal sends
the sheet ID + tab in the payload, so the handler does not hard-code them.

> ⚠️ **Access requirement:** the `accounts` Apps Script must be able to **write** to that
> Vendor Master workbook (the account running the web app needs edit access, or share the
> sheet with it). If it can't open the file, `SpreadsheetApp.openById` throws.

## Contract the portal sends
`POST` (content-type `text/plain`):

```json
{
  "action": "saveVendorOpeningBalance",
  "sheetId": "1WhjqAGb5XNSQ-q-tPA7tGPQa-aPpgX2LHzzOy2HwTkA",
  "tab": "OpeningBalance",
  "row": {
    "UUID": "VOB-xxxxxxxx",
    "SystemEmail": "...", "UserEmail": "...",
    "Timestamp": "22/06/2026 21:19:28",
    "Updated By": "...",
    "VendorKey(UUID)": "<vendor-master UUID>",
    "Vendor ID": "MV300",
    "Vendor Name": "USHA MARTIN",
    "Vendor Detail": "MV300|USHA MARTIN",
    "Opening Balance": 125000,          // SIGNED: + = Cr (payable b/f), − = Dr (advance)
    "As On (Date)": "31/03/2026",
    "Remarks (If Any)": "Balance carried forward from FY 2025-26"
  }
}
```

Expected response: `{"success": true, "uuid": "VOB-xxxxxxxx"}`. The portal treats any
`success !== false` as saved, closes the drawer, and re-reads the tab so the opening balance
appears as the ledger's first entry.

**Note on the signed amount:** the `OpeningBalance` tab has **no Dr/Cr column**, so the side
is encoded in the sign of `Opening Balance` (+ credit / − debit). If you'd rather store the
side explicitly, add a `Dr/Cr` column to the tab and tell the frontend — it can send it as a
separate field.

## Implementation — generic header-mapped append

```javascript
function saveVendorOpeningBalance_(payload) {
  var row = payload.row || {};
  var sheetId = payload.sheetId;
  var tab     = payload.tab || 'OpeningBalance';
  if (!sheetId) return { success: false, message: 'missing sheetId' };
  if (!row['Vendor ID'] && !row['VendorKey(UUID)']) {
    return { success: false, message: 'missing Vendor ID / Vendor Key' };
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return { success: false, message: 'busy, try again' };
  try {
    var sh = SpreadsheetApp.openById(sheetId).getSheetByName(tab);
    if (!sh) return { success: false, message: 'tab not found: ' + tab };
    appendRowByHeader_(sh, row);                 // maps by header name (see helper)
    return { success: true, uuid: row.UUID || '' };
  } catch (e) {
    return { success: false, message: 'append failed: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

// Reusable: append an object to a sheet, aligning each value to the column whose
// header (row 1) matches the object key. Unknown keys are ignored; missing
// columns are left blank. Header order in the sheet can change freely.
function appendRowByHeader_(sh, obj) {
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var line = header.map(function (h) { return (h in obj) ? obj[h] : ''; });
  sh.appendRow(line);
}
```

## Wire it into the router
In the project's `doPost`, add the case alongside the existing actions:

```javascript
case 'saveVendorOpeningBalance':
  return _json(saveVendorOpeningBalance_(payload));
```

(`_json` = your existing `ContentService.createTextOutput(JSON.stringify(x))
.setMimeType(ContentService.MimeType.JSON)` wrapper — reuse whatever
`saveNewPaymentRequest` / `saveAccountsUpdate` already use.)

## Test
1. From the portal: Vendor Ledger (PO) → **⊕ Opening Balance** → pick a vendor, enter an
   amount + Dr/Cr + as-on date → **Save**. One new row should land in `OpeningBalance` with
   the headers populated and a signed `Opening Balance`.
2. Re-open that vendor's ledger → the opening balance shows as the **first entry** (an
   "Opening" chip) and seeds the running balance.
3. Save a second amount for the same vendor → the ledger **sums** both (useful for
   adjustments). If you instead want a re-entry to *replace* the old one, add a `Status`/
   `Active` column and filter in the handler — tell the frontend and it will honour it.

---

# Summary of changes this session (what touches Apps Script vs frontend-only)

| Change | Apps Script work needed? |
|---|---|
| **Vendor Ledger Opening Balance** — side-pull entry form + fold-in to the ledger | **Yes** — add the `saveVendorOpeningBalance` handler above (+ grant the web app write access to the Vendor Master workbook). |
| **Vendor Master → `7-VendorMaster_Actual`** on its own sheet, canonical everywhere (ledger bridge, new-PR vendor list + bank auto-fill, vendor portal search, masters loader, Data Hub, Sheet-Linking) | **No** — these are gviz **reads** (by header), no backend change. Only ensure the new Vendor Master sheet is shared **Anyone with link → Viewer** for reads. |
| Vendor Ledger **GRN "+N" → wrap** (Particulars column) | **No** — display-only. |

Everything else from the MD-approval write-fix above still stands and is unaffected by these
additions.
