# GRN Accounts Review — StockIN → Vendor Ledger gate

Every GRN StockIN done at site is reviewed by the **Accounts team** against the
received **invoice + PO** before its value hits the **Vendor Ledger (PO)**.
During review Accounts can **edit the rate** and add **per-line additional
charges**. Only **Approved** lines are counted in the ledger; un-reviewed lines
show as **"Pending review"** and are excluded from the running balance.

## Ledger Link (runtime On / Off / Off + Hide)
Once `GRN_REVIEW_SHEET_ID` is set, admins control the gate at runtime from the
**GRN Review** header or **Configuration → Status Access** (stored org-wide in
PortalConfig `grn_review_mode`):
- **On** — only Accounts-**approved** GRN lines credit the ledger (gate active).
- **Off** — every received line counts (as before); the GRN Review tab stays visible.
- **Off + Hide tab** — gate off **and** the GRN Review tab is hidden.

Default is **Off** (setting the sheet ID does not silently change balances — an
admin flips it On). Reviews can still be recorded while Off; they only drive the
ledger when On.

If `GRN_REVIEW_SHEET_ID` is blank the gate can't be On (no review data to read),
and the ledger behaves exactly as before.

## 1. Create the review tab
A dedicated tab (own workbook, or the Vendor Master workbook). Default name
**`GRN_Review`** (`GRN_REVIEW_TAB`). Header row (order doesn't matter — the
backend appends by header name):

```
UUID | SystemEmail | UserEmail | Timestamp | Reviewed By | SI ID | GRN No |
PO No | Vendor ID | Part | Invoice No | GRN Qty | PO Rate | Reviewed Rate |
Additional Charges | Reviewed Value | Review Status | Comments
```

- **`Reviewed Value`** — the **only** field Accounts edit in the queue: the final
  amount for that item (what credits the ledger). It defaults to the PO amount
  (`GRN Qty × PO Rate`), shown read-only alongside. `Reviewed Rate` /
  `Additional Charges` are no longer entered via the UI (kept in the schema for
  older records); PO Rate + PO Amount are display-only reference.

- **`SI ID`** is the join key — the StockIN line's own ID (the portal reads it
  from the StockIN `SI ID` column). One review per SI ID; the **latest** row per
  SI ID wins (append-only, so a re-review just adds a newer row).
- **`Review Status`** = `Approved` / `Rejected` / `Pending`.
- **`Reviewed Rate`** overrides the PO rate for valuing the received goods;
  **`Additional Charges`** is a per-line add-on. Ledger credit for a line =
  `GRN Qty × (Reviewed Rate || PO Rate) + Additional Charges`.

Share it **Anyone with link → Viewer** (for the read) and give the **accounts
Apps Script web app EDIT access** (for the write).

## 2. Wire the constants
In `assets/js/portal-bundle.js`:

```js
const GRN_REVIEW_SHEET_ID = '<the GRN Review sheet ID>';   // activates the gate
const GRN_REVIEW_TAB      = 'GRN_Review';
```

(The sheet ID also runs through the Sheet-Linking override on write via
`_resolveSheetId`, so it can be re-pointed at runtime if you register it there.)

## 3. Deploy the backend action
`apps-script/AccountsHandlers.gs` gains **`saveGRNReview`** (header-mapped append,
reuses `_accAppendByHeader`) and `Router.gs` routes it. **Redeploy a new version**
of the `accounts` Apps Script web app after pasting the updated files.

Contract:
```json
{ "action": "saveGRNReview", "sheetId": "<GRN_REVIEW_SHEET_ID>", "tab": "GRN_Review",
  "row": { "UUID": "GRV-…", "SI ID": "…", "Review Status": "Approved",
           "Reviewed Rate": 123.45, "Additional Charges": 0, … } }
```

## 4. Who can review
Anyone with the **accounts** role by default. To lock it to specific people, use
**Configuration → Status Access → "GRN Review — Approve / Edit"** and list the
allowed emails/names (same mechanism as the payment-status restrictions).

## Where it lives in the portal
- **Vendor Ledger (PO) → GRN Review** view: the queue of received StockIN lines
  (Pending / Approved / Rejected / All), each with editable **Reviewed Rate** +
  **Additional Charges** and **✓ / ✗** actions.
- **Per-vendor ledger:** approved receipts credit the ledger using the reviewed
  rate + charges; un-reviewed receipts appear as a **"Pending review"** row
  (₹ amount shown, **not** counted in the balance).

## Code touch-points
- `_vplpEnsure` loads `GRN_REVIEW_TAB`; `_grnReviewBySiId()` = latest review per SI ID.
- `_vplpCompute` splits received value into counted (`poRecv`) vs `poPending`
  per PO, honouring the reviewed rate/charges; `grnLines` feeds the queue.
- `_vplpGRNReviewView()` / `_vplpGRNSubmit()` — the review UI + write.
- Gate is active only when `_grnGateOn()` (i.e. `GRN_REVIEW_SHEET_ID` set).
