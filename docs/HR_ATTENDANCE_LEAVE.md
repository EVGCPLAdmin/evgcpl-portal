# HR — Attendance & Leave (TimeOff)

Portal-native rebuild of the AppSheet HR **Attendance** and **Leave** modules.
All code lives in `assets/js/portal-bundle.js` (search `HR — ATTENDANCE & LEAVE`).
Source spec: the AppSheet extraction pack (`00_BUILD_SPEC.md`, `40_UX_and_Behavior.md`,
raw table schemas `10`–`31`).

## Routes (hosted on `hr.html`)

| Route | Tab | Render |
|-------|-----|--------|
| `attendance` | Mark Attendance (landing) | `renderAttendance` / `_attOpenTab('mark')` |
| `att-register` | Register (consolidated, read-only) | `_attOpenTab('register')` |
| `att-calendar` | Calendar (month grid) | `_attOpenTab('calendar')` |
| `leave` | My Requests (landing) | `renderLeave` / `_leaveOpenTab('mine')` |
| `leave-apply` | Apply for Leave | `_leaveOpenTab('apply')` |
| `leave-approvals` | Approval queue (L1/L2) | `_leaveOpenTab('approvals')` |
| `leave-types` | Leave Type master (admin) | `_leaveOpenTab('types')` |

Registered per `docs/ADDING_A_PAGE.md`: `MODULE_REGISTRY`, `NAV_SUBMENUS`
(`attendance` + `leave` parents), the `renderPage()` `pages` map, `ROUTE_TO_PAGE`
in `multi-page-bootstrap.js`, and both nav partials (`partials/topnav.html`,
`partials/sidebar.html`).

## Data sources (configure before use)

Workbook IDs are **runtime-configurable** — set them in **Settings → Sheet IDs**
(no rebuild needed; resolved via `getSheetId()`):

| Settings key | Workbook | Tabs | Mode |
|--------------|----------|------|------|
| `ATTLEAVE` | Attendance & Leave | `Attendance-EG`, `Leave Request Form`, `Leave Approval` | read + append |
| `ATTREG`   | Attendance Register | `AttendanceRegister`, `LeaveRegister`, `02_Leave_New` | read-only |
| `MASTERHR` | Master-HR | `M_LeaveTypes` | read + append |

Until a key is set, its page shows a "configure this sheet" notice instead of erroring.
Employee identity / reporting manager / PL eligibility+balance come from the existing
`loadAllMasters()` → `STATE.masters.users` (the Employee Register), **not** a second fetch.
Tab names live in `HR_TABS` in the bundle.

## Leave workflow (two-stage, append-only)

Approvals never edit the request row — each decision **appends** a row to `Leave Approval`
(audit log), exactly like Accounts (`PaymentRequest` + `AccountsUpdate`). A request's
effective status is **derived** from its approval rows by `_leaveEffectiveStatus()`:

```
submit            → Status "Pending"            (awaiting L1 · RM)
RM approves       → "L2 Approval Pending"       (awaiting L2 · HR/Admin)
HR/Admin approves → "Approved"
any "Rejected"    → "Rejected"
```

- Join key: a request's `UUID` is also written as its `Request ID`; each approval row
  carries `CheckSum` and `Request ID` = the request `UUID`.
- Who can act (`_leaveCanApprove`): **L1** = the request's Reporting Manager (matched by
  `RM Mail ID` / name / emp-code) *or* an admin; **L2** = admin only.
  `_hrIsAdmin()` = portal role `md`/`hr`, or an employee `Role` of Admin / Process Owner / HR.
- **Attendance → Leave bridge**: marking a day as `Half-a-Day` auto-creates a `0.5`-day
  `PL` request (`Purpose = "Auto Apply Based on Attendance"`) via the shared
  `_leaveCreateRequest()`.

## Writes — `appendRowMapped`

All writes are header-mapped appends through `_hrAppend(sheetId, tab, {Header: value})`,
which POSTs `action:'appendRowMapped'` to the main Apps Script `/exec`. The handler
(`apps-script/SafetyHandlers.gs` → `appendRowMapped`, wired in `apps-script/Router.gs`)
reads the tab's row-1 headers and places each value under its matching header, so we never
depend on column order. **The deployed `/exec` must be re-deployed with this action** for
writes to work; reads work regardless. Column names written match the AppSheet schema
headers (see the spec pack).

## Status colours (per AppSheet format rules)

`_hrBadge(text, kind)` with: green = Present/Approved, red = Absent/LOP/Rejected,
amber = Half-a-Day/OD/Pending, blue = in-flight stage, grey = neutral/inactive.

## Out of scope (per the spec selection)

Subcontractor attendance (`G2_2`, `HT_AttendanceRegister`), `AttendanceUpload`,
Attendance Report exports, and the OD/TA modules.
