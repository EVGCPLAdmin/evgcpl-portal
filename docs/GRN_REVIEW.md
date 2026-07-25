# GRN Accounts Review — StockIN → Vendor Ledger

Every GRN StockIN done at site is reviewed by the **Accounts team** against the
received **invoice + PO** before its value settles in the **Vendor Ledger (PO)**.
During review Accounts can set the **Final Rate / Final Tax / Final Additional
Charges / Final Value** for each received line.

## How a GRN is valued (per-GRN rule — no On/Off switch)

There is **no global Ledger Link On/Off gate**. Each received line is valued on
its own, by whether a review entry exists for its `SI ID`:

| GRN state | Valuation | In the balance? |
|---|---|---|
| **Approved** review | the entry's own **Final Rate / Tax / Value** (authoritative) | ✅ counted |
| **Rejected** review | — | ❌ **excluded** (shown as a red *Rejected* row) |
| **No** review yet | **PO rate / tiered** valuation (the old "Off" logic) | ✅ counted |

So reviews take effect **automatically** — approve a line and its Final values
drive the ledger; reject it and it drops out; leave it un-reviewed and it still
counts at the PO rate. The GRN Review header shows an *"ⓘ Reviews applied
automatically"* note instead of a toggle.

If `GRN_REVIEW_SHEET_ID` is blank there is simply no review data to read, so
every received line is valued at the PO rate (identical to a fully un-reviewed
ledger).

> **Tab visibility only.** PortalConfig `grn_review_mode` = `hidden` still hides
> the GRN Review tab for non-admins (`_grnTabHidden()`); admins always see it.
> `on`/`off` no longer affect valuation — the per-GRN rule above always applies.

## How un-reviewed lines are valued (the PO/tiered logic)

For a line with no review entry:

- **Material (a)** = `received Qty × Rate` (from `PO_Items_Actual`).
- **Tax (a)** = `received material × Tax%` — read from the PO line's **`Tax (%)`**
  column (same row as Rate/Qty). Tax% is normalised: a value **≥ 1** is a whole
  percent (`18` → 0.18), a value **< 1** is already a fraction (`0.18` stays
  0.18). If a line has no `Tax %`, it falls back to the stored **Tax Amount**
  apportioned by received qty.
- **Tax (b) / Additional (b)** = the PO header's `Tax (b)` / `Sub Total (b)`,
  apportioned across the un-reviewed receipts by material share.

### Rates mapped to received QUANTITY across tiers

When the **same item** appears on a PO at **multiple rates** (e.g. 800 @ ₹100
then 400 @ ₹120), received quantity is valued against the PO's rate tiers **in
PO-line order** — first line's qty at its rate, next line's qty at its rate, etc.
— **regardless of which line each GRN was booked against**. A GRN that straddles
a tier boundary is **blended within its own row** (e.g. 300 @ ₹100 + 100 @ ₹120).
Receipts fill tiers chronologically; anything received beyond all tiers uses the
last tier's rate. Different items on a PO are independent; single-rate items are
unchanged.

## The review entry (Final fields)

Accounts enter, per line, in the **GRN Review** queue:

- **Final Rate** (`Reviewed Rate`) — overrides the PO rate for this line.
- **Final Tax** (`Reviewed Tax`).
- **Final Additional Charges** (`Additional Charges`).
- **Final Value** (`Reviewed Value`) — **what credits the ledger**. Auto-computes
  as `Qty × Rate + Tax + Addl` but can be **overridden** directly.

For an **approved** line the Final Value is the credit and PO-apportioned
Tax(b)/Additional(b) are **not** re-applied (the review is authoritative). The
queue also shows read-only **PO Tax %** and **PO Tax Value** (`PO Rate × Qty ×
Tax%`) as a reference while reviewing. `PO Rate` is display-only.

## 1. Create the review tab

A dedicated tab (own workbook, or the Vendor Master / Stores workbook). Default
name **`GRN_Review`** (`GRN_REVIEW_TAB`). Header row (order doesn't matter — the
backend maps by header name, and the read matches header names
**case/whitespace-insensitively**, so `SI ID`, `SI Id`, or a stray-space variant
all resolve):

```
UUID | SystemEmail | UserEmail | Timestamp | Reviewed By | SI ID | GRN No |
PO No | Vendor ID | Part | Invoice No | GRN Qty | PO Rate | PO Tax % |
PO Tax Value | Reviewed Rate | Reviewed Tax | Additional Charges |
Reviewed Value | Review Status | Comments
```

`PO Tax %` and `PO Tax Value` (= `PO Rate × Qty × Tax%`) are written for reference
alongside `PO Rate`. Add these two columns to the tab to capture them; without
them the values are simply skipped (reported back in the write's `unmatched`).

- **`SI ID`** is the join key — the StockIN line's own ID (read from the StockIN
  `SI ID` column). One review per SI ID: the backend **upserts** — a re-review
  **updates the same row** (`saveGRNReview` → `_accUpsertByHeader`, keyed on
  `SI ID`). If duplicate rows ever exist, the backend updates the **latest by
  Timestamp** and the portal read also takes the **latest** row per SI ID.
- **`Review Status`** = `Approved` / `Rejected` / `Pending`. Approved counts at
  the Final values; Rejected is excluded from the balance; **Pending** (or no
  entry) reverts the line to the PO-rate valuation and still counts — the queue's
  **↩ Move to Pending** action writes this to undo a prior Approve/Reject. Only an
  **Approved** entry drives the Final values (`_grnIsApproved`).
- **`Reviewed Value`** is the credit for an approved line.

Share it **Anyone with link → Viewer** (for the read) and give the **accounts
Apps Script web app EDIT access** (for the write).

## 2. Wire the constants

In `assets/js/portal-bundle.js`:

```js
const GRN_REVIEW_SHEET_ID = '<the GRN Review sheet ID>';   // enables review data
const GRN_REVIEW_TAB      = 'GRN_Review';
```

(The sheet ID also runs through the Sheet-Linking override on write via
`_resolveSheetId`, so it can be re-pointed at runtime if you register it there.)

## 3. Deploy the backend action

`apps-script/AccountsHandlers.gs` has **`saveGRNReview`** (header-mapped
**upsert** keyed on `SI ID`, via `_accUpsertByHeader`) and `Router.gs` routes it.
**Redeploy a new version** of the `accounts` Apps Script web app after pasting the
updated files — the upsert behaviour only takes effect once the new backend is
deployed.

Contract:
```json
{ "action": "saveGRNReview", "sheetId": "<GRN_REVIEW_SHEET_ID>", "tab": "GRN_Review",
  "row": { "UUID": "GRV-…", "SI ID": "…", "Review Status": "Approved",
           "Reviewed Rate": 123.45, "Additional Charges": 0, "Reviewed Value": 2430, … } }
```

The written row also carries alias keys (`Final Rate`, `Final Tax`,
`Final Additional Charges`, `Final Value`, `Status`) so the write sticks
regardless of the tab's exact header spelling.

## 4. Who can review

Anyone with the **accounts** role by default. To lock it to specific people, use
**Configuration → Status Access → "GRN Review — Approve / Edit"** and list the
allowed emails/names (same mechanism as the payment-status restrictions).

## Where it lives in the portal

- **Vendor Ledger (PO) → GRN Review** view: the queue of received StockIN lines
  (Pending / Approved / Rejected / All), each with editable **Final Rate / Tax /
  Add'l / Value** and **✓ / ✗** actions. Shows ~10 rows then scrolls (sticky
  header); a search box + 150-row cap keep it responsive. A one-line read
  diagnostic (`reviews on file · keyed by SI ID · matched to lines`) surfaces
  join problems.
- **Per-vendor ledger:** approved receipts credit the ledger at their Final
  values; un-reviewed receipts credit at the PO/tiered rate; **rejected**
  receipts show a *Rejected* row (₹ amount shown, **not** in the balance). Each
  goods-received row (and the Totals) shows the received **Qty in brackets** next
  to the Credit, and **Tax (a)/(b)** show their effective **%** in-cell.

## Code touch-points

- `_vplpEnsure` loads `GRN_REVIEW_TAB` (forced `headers:1`, plus a session-local
  buffer of just-saved reviews so approvals don't bounce back while gviz lags).
- `_grnReviewBySiId()` = latest review per SI ID (`_grnRVal` matches columns by
  normalised header name).
- `_vplpCompute` values each receipt per the per-GRN rule; tiers are laid out by
  quantity per PO item. Per-PO tallies: `poRevCr/poRevMat/poRevTaxA/poRevAddl`
  (reviewed-approved) vs `poUnMat/poUnTaxA` (un-reviewed); `poPending` = rejected.
- `_vplpPOTotals(d, k)` = the single per-PO credit/breakdown helper shared by the
  per-vendor ledger and the Flat List (keeps balances identical).
- `_vplpGRNReviewView()` / `_vplpGRNSubmit()` — the review UI + write.
