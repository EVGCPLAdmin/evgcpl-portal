---
name: party-ledger
description: Build or extend a "ledger" view in the EVGCPL portal — a per-party statement of payment transactions with a running balance and Paid/Pending totals. A party is a Vendor, Sub Contractor, Employee, or "Others", identified uniquely by Name + A/C number. Use when asked to add a ledger, a vendor/sub-contractor/employee statement, an account statement, a running balance, or to reuse the Party Ledger anywhere in assets/js/portal-bundle.js.
---

# Party Ledger

A reusable pattern for rendering a party's payment history as a ledger: a
chronological table with a running balance plus Total Billed / Paid / Pending
KPIs. First shipped on the MD Payments dashboard (`md-payments` route); the
core renderer is context-free so it can be embedded on any page.

## Data model

- **Source:** the `PaymentRequest` tab of `PAYMENT_SHEET_ID` (the "Account View"
  sheet). Read it **by header name**, never by column letter — the sheet's
  column order changes:
  ```js
  const rows = await fetchSheet('PaymentRequest', null, PAYMENT_SHEET_ID);
  ```
- **Party identity = `Payment To` (type) + `Paid To` (name) + `A/C NUMBER`.**
  Same name on a different account is a different party. Types live in
  `PARTY_TYPES = ['Vendor', 'Sub Contractor', 'Employee', 'Others']`.
- The per-type payee column is `Paid To (Vendor|SC|Employee|Others)`, but the
  computed `Paid To` column already holds the resolved name, so group on that.

## Reusable building blocks (all in `assets/js/portal-bundle.js`)

| Function | Role |
|---|---|
| `_mdpParseRow(r)` | Normalise one `PaymentRequest` row → `{ uuid, requestId, date, installment, payTo, paidTo, vendor, company, orderNo, billNo, amount, paidVal, pendingVal, currency, acNumber, utr, status, ... }`. `status` is the `getPayStatus()` object. |
| `_mdpLoad(force)` / `_mdpRows` | Fetch + cache the parsed rows. Call `_mdpLoad(true)` to refresh after a write. |
| `_plPartyKey(r)` | The unique key `"type|name|acc"`. |
| `_plParties(type, companyFilter)` | Distinct parties of a type → `[{ key, name, acc, count, total }]`. |
| `partyLedgerRender(txRows, opts)` | **Context-free.** Renders KPIs + running-balance table from any parsed rows. `opts.onRowClick` = name of a global fn called with the row `uuid` (e.g. `'_accOpenPRDetail'`). |
| Helpers | `_mdpAmt(v, currency)`, `_mdpDateVal(d)` (tolerant date sort, handles `10June2026` / `1 November 2025` / `DD/MM/YYYY`), `_mdpEsc(s)`, `getPayStatus(raw)`. |

## Recipe: add a ledger somewhere new

1. Make sure you have parsed rows. Reuse the cache: `await _mdpLoad();` then
   read `_mdpRows`. (Or map your own rows through `_mdpParseRow`.)
2. Filter to the scope you want — a single party (`_plPartyKey(r) === key`), a
   project, a company (`r.company === company`), a date range, etc.
3. Render:
   ```js
   container.innerHTML = partyLedgerRender(txRows, { onRowClick: '_accOpenPRDetail' });
   ```
4. For a picker, drive it with `_plParties(type, companyFilter)` and a type
   switch over `PARTY_TYPES` (see `_mdpLedgerHtml`).

## Conventions (do not break)

- **Header-name reads only** — never hardcode gviz column letters for
  PaymentRequest; the schema shifts.
- **Status** always via `getPayStatus()`; never invent status strings. Paid vs
  Pending in the ledger is derived from `status.cat === 'completed'`. If a
  context needs PO-level figures instead, use `r.paidVal` / `r.pendingVal`.
- **Amounts** via `_mdpAmt`; **escape** all sheet text via `_mdpEsc` /
  `escapeHtml_`; **sort dates** with `_mdpDateVal`.
- **Reuse `partyLedgerRender`** — don't fork the table markup per party type.

## Extending to a new party type

Add the label to `PARTY_TYPES` and make sure `Payment To` carries that value
and a matching `Paid To (...)` column exists. No renderer changes needed —
`_plParties` and `partyLedgerRender` are type-agnostic.

## Ship checklist

- `node --check assets/js/portal-bundle.js`
- `node build-portal.js --patch` (bumps build + validates JS)
- One PR per change, squash-merge to `main`.
- No emojis and no "Claude"/"AI"/"agent" in commits, code, or comments.
