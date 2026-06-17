# EVGCPL Portal — Backlog

Tracked follow-ups that are scaffolded but not yet fully built.

## My Tasks (per-user approval inbox) — route `my-tasks`
**Status:** placeholder page shipped (`renderMyTasks` in `assets/js/portal-bundle.js`), nav + route registered. Needs detailing/wiring.

**Intent:** one consolidated, per-user worklist that lists **every pending item across the portal where the current user is the named approver / next actioner** — a single inbox instead of hunting through each module.

**To detail later:**
- Sources to aggregate (each contributes its "pending where I'm the approver" rows):
  - Payment Requests (Accounts) — stage/approver model (`ACC_VIEWS`, `_accStageOf`, `_accCanAdvance`).
  - Cash / Mess expense approvals — `Cash Expenses` / `Cash Expenses - Approval`, `Individual Food Expenses Approval` (EXPENSE_SHEET_ID).
  - HR: Leave / OD / Attendance Review (once those are wired).
  - Any other module with an approver + pending status.
- "Approver = me" matching rule (by email / employee-ref / role) per source.
- Row model: source, item id, requester, amount/summary, age, deep-link to the item, action buttons.
- Grouping (by source / by age) + a pending count surfaced in the nav badge.

## HR restructure (Recruitment / Day-to-Day / Other Operations)
Pending inputs from product owner: Recruitment sub-page list; sheet IDs/tabs/columns for Attendance, Leave, OD, Attendance Review, Advance & Loans. Expense + Individual-Mess data already provided (EXPENSE_SHEET_ID).
