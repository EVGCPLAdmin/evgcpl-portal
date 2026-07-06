# Stock AuditTrail tab (v2_Stores)

The **Stock Reconciliation** page (`stock-recon`, under Procurement → Stores) lets
authorised users edit the received **GRN Qty** on a StockIN receipt. Every change:

1. writes the new value back into the **StockIN** tab, and
2. appends an audit row to the **AuditTrail** tab.

The AuditTrail schema is generic so **Stock Out** and **Stock Transfer** can reuse
the same tab later — only the `Module` / `Action` / `Field` values differ.

## AuditTrail tab — column order (row 1 headers)

Rows are appended **positionally** in this exact order, so keep the header row
in this order:

| # | Header | Example (StockIN edit) |
|---|--------|------------------------|
| A | Timestamp   | `2026-07-06T10:22:01.000Z` (ISO, UTC) |
| B | User Email  | `md@evgcpl.com` |
| C | User Name   | `Neuroloom` |
| D | Module      | `StockIN` (later: `StockOut`, `StockTransfer`) |
| E | Action      | `Edit GRN Qty` |
| F | Ref No      | GRN No, e.g. `GRN/1413/25-26` |
| G | CheckSum    | the StockIN CheckSum of the edited row |
| H | Field       | `GRN Qty` |
| I | Old Value   | value before the edit |
| J | New Value   | value after the edit |
| K | Remarks     | optional reason the user typed |

You named the tab **`AuditTrail`** in the **v2_Stores** sheet — that exact name
and sheet are what the app writes to.

## How the StockIN write stays safe

The column letters for the StockIN **GRN Qty** and **CheckSum** are resolved at
runtime from the sheet's own header row (via gviz column metadata), not hard-coded.
So reordering StockIN columns won't send a write to the wrong column — and if
those headers can't be found, editing is disabled with a warning instead of
guessing.

## Backend

Uses the existing main Apps Script actions — no new backend code needed:
- `updateCell` — sets the StockIN GRN Qty cell (match by CheckSum column).
- `appendRow` — appends the audit row to `AuditTrail`.

The script account must have **edit** access to the v2_Stores spreadsheet.

## Access

Gated by the `stock-recon` module actions:
- `view` — see the reconciliation list + Audit Trail tab.
- `edit` — change GRN Qty (the ✎ Edit button only shows with this grant).

Grant these under **Access & Pages → Stock Reconciliation**.
