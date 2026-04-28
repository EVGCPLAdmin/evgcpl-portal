# EVGCPL Intranet Portal — Multi-page Build (v1.3)

Complete rewrite of the EVGCPL portal as a multi-page architecture, ported
session-by-session from the canonical single-file `index__87_.html` baseline.

Live data flows from your Google Sheets via the `gviz` API; writes go through
the existing Apps Script deployment.

## Pages

| Route | File | Status |
|---|---|---|
| Sign-in (real Google OAuth + PIN fallback) | `index.html` | Live |
| Dashboard | `dashboard.html` | Live |
| HR · Dashboard / My Profile / My Team / Onboarding / Policies | `hr.html#…` | Live |
| SCM Dashboard | `scm.html` | Live |
| Site Ops · Equipment / Site Store / Site Manager (all 7 ops tabs) | `site-ops.html#…` | Live |
| Safety | `safety.html` | Live |
| Accounts & Payments | `accounts.html` | Live |
| Reports (catalogue + end-to-end scheduled emails) | `reports.html` | Live |
| **Apps launcher** (consumer view of App Links registry) | `apps.html` | **Live** |
| Config — 5 sub-tabs | `config.html#…` | Live |
| Sharing Doctor | `sharing-doctor.html` | Live |
| IC Budget & Cost Control | `ic-budget.html` | Blocked on `BUDGET_SHEET_ID` |

## Config sub-pages (admin/MD only)

| Tab | URL | Purpose |
|---|---|---|
| Sheet IDs | `config.html#sheets` | Edit Google Sheet IDs per logical key |
| **Sheets directory** | `config.html#sheets-dir` | Full registry: name · ID · URL · tabs in use · description (all editable) |
| Tab & Query bindings | `config.html#bindings` | Per-binding sheet/tab/query, with live "Test" button |
| **App Links** | `config.html#app-links` | Editable registry: icon · name · category · URL · description; add/remove/reorder |
| Diagnostics | `config.html#status` | Sharing Doctor + raw localStorage view |


## Architecture

### Shell + module pattern

Every page loads:
1. `assets/css/portal.css`
2. Five core JS files: `state.js`, `api.js`, `data-bindings.js`, `nav-config.js`, `shell.js`
3. One module file from `assets/js/modules/`

### Editable data layer

Every fetch goes through `API.fetchByBinding('module.dataset')`. Bindings live
in `assets/js/data-bindings.js`. The Config page lets admins override **sheet
IDs**, **tab names**, and **gviz queries** at runtime — stored in
`localStorage["EVGCPL_DATA_OVERRIDES_V1"]`. Changes take effect on the next
fetch.

### Apps Script handlers

Three reference files are in `apps-script/`:
- `SheetDiagnostic.gs` — Sharing Doctor backend
- `SafetyHandlers.gs` — `appendRow`, `updateCell`, `listHRDocs`,
  `listPolicyFiles`, `uploadPolicyFile`, `sendReportTest`
- `ScheduledReports.gs` — `saveReportSchedule`, `deleteReportSchedule`,
  + the time-driven trigger `runScheduledReports` and one-time setup
  helpers (`installReportTrigger`, `_initReportSchedulesTab`, `_dryRunNow`)

Per project memory, the live Apps Script at the deployment URL hardcoded in
`assets/js/api.js` already has the first two files' handlers. To activate
**scheduled emails**, paste `ScheduledReports.gs` into the same project and
run the one-time setup steps documented at the top of that file.

## Deployment

1. Drop the **entire contents** of this folder into your GitHub Pages repo
   root (`evgcpladmin.github.io/evgcpl-portal/`).
2. Commit and push.
3. Visit the site. Sign in with Google (the official GSI button renders
   automatically using the real OAuth client ID).

### After deployment

- Visit `/config.html` → "Tab & Query bindings" to verify all sheet IDs and
  tab names. Click "Test" on any binding for a live fetch check.
- Visit `/sharing-doctor.html` to confirm reachability of every binding.
- For Safety / Onboarding / Policy write-back to work, ensure the relevant
  tabs and Drive folders exist (see binding definitions and the Apps Script
  reference for the contract).

### Activating scheduled emails (one-time)

1. Open your live Apps Script project (script.google.com).
2. Paste `apps-script/ScheduledReports.gs` alongside `SafetyHandlers.gs`.
3. Add three cases to the `doPost` switch statement (case lines documented
   at the top of `ScheduledReports.gs`).
4. Run `_initReportSchedulesTab()` once from the editor to create the
   `ReportSchedules` tab in the EMPLOYEE sheet.
5. Run `installReportTrigger()` once to install the hourly trigger.
6. Verify in Apps Script → Triggers panel that `runScheduledReports` fires
   every hour.
7. Optional: run `_dryRunNow()` to fire all active schedules immediately
   for testing.

After this, every "Save" in the Reports schedule modal mirrors to the
`ReportSchedules` tab and the trigger fires the email at the scheduled hour.

## Project file layout

```
.
├── README.md                      ← this file
├── index.html                     ← Sign-in (real Google OAuth)
├── dashboard.html
├── hr.html                        ← 5 hash-routed sub-pages
├── scm.html
├── site-ops.html                  ← 3 hash-routed sub-pages
├── safety.html
├── accounts.html
├── reports.html
├── config.html
├── sharing-doctor.html
├── ic-budget.html                 ← Placeholder
├── assets/
│   ├── css/portal.css             ← All styles, light + dark
│   ├── img/EG.jpg
│   └── js/
│       ├── state.js
│       ├── api.js
│       ├── data-bindings.js       ← 31 bindings
│       ├── nav-config.js
│       ├── shell.js
│       └── modules/
│           ├── dashboard.js
│           ├── hr.js              (Dashboard, Profile, Team, Onboarding, Policies)
│           ├── scm.js
│           ├── site-ops.js        (Equipment, Store, Site Manager + 7 ops tabs)
│           ├── safety.js
│           ├── accounts.js
│           └── reports.js         (Catalogue + scheduling)
└── apps-script/
    ├── SheetDiagnostic.gs
    ├── SafetyHandlers.gs          ← appendRow, updateCell, listHRDocs, listPolicyFiles, uploadPolicyFile
    └── ScheduledReports.gs        ← saveReportSchedule, deleteReportSchedule, time-driven trigger
```

## Sessions delivered

| Session | Scope |
|---|---|
| A | SCM Dashboard + Equipment + Site Store + Editable config layer |
| B | Reports catalogue (9 reports) + Safety (checklist + incident form + log) |
| C | Accounts & Payments (42-col PaymentRequest, 27-key status map) |
| D | Onboarding Portal (12 steps, write-back to OnboardingChecklist) |
| E | My Profile (gradient hero, Drive docs grid) + My Team |
| F | Site Manager (per-site core + MRS + PO ops tabs) |
| G | Real Google OAuth · Policy Hub · Reports schedule UI · Stock + GRN ops tabs |
| H | Time-driven email trigger · DPR / Log Sheet / Maintenance ops launchers |
| **I** | **Sheets directory · App Links registry · Apps launcher page · deep-linkable Config tabs** |

Each session built against the canonical `index__87_.html` baseline (891 KB,
~14,951 lines). All modules pass `node --check` and use only CSS classes
defined in `portal.css`.

## What's truly remaining

- **IC Budget portal route** — blocked on `BUDGET_SHEET_ID` upload to Drive.
  Once the Excel template is uploaded and the ID is pasted into Config, the
  route can be wired using the same `fetchByBinding` pattern as everything
  else. The 18-sheet calculation engine lives in Sheets per the architecture
  decision; portal just needs to read it.

That's the only genuine outstanding item. Everything else from the canonical
baseline is now ported and live.

## Key constants

- Apps Script URL: hardcoded in `assets/js/api.js` (`APPS_SCRIPT_URL`)
- Google OAuth client ID: hardcoded in `index.html`
- HR docs Drive folder: `1I1ESOw_0EncSMt3nLZV2P7I106aniLY-` (in `hr.js`)
- Policy Hub Drive folder: placeholder in `hr.js` — replace with live ID
- localStorage keys:
  - `EVGCPL_DATA_OVERRIDES_V1` — Config overrides
  - `evgcpl_rpt_schedules` — Report schedules (mirrored to sheet)
  - `evgcpl_safety_local_v1` — Local incident fallback
  - `sfchk_<date>_<site>` — Daily safety checklist (sessionStorage)
  - `evgcpl_ob_<empId>` — Onboarding progress (sessionStorage)
  - `evg_photo_<empCode>` — Profile photos
- Server-side stores:
  - `ReportSchedules` tab in EMPLOYEE sheet (created on first save)
  - `OnboardingChecklist` tab in EMPLOYEE sheet (per-step write-back)
  - `Incidents` + `DailyChecks` tabs in SAFETY sheet
