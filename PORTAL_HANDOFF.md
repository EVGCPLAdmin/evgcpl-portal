# EVGCPL PORTAL — Complete Project Handoff

> **Start here.** This is the master document — everything a fresh Claude needs to pick up the project cold. Sibling docs are scoped to specific tasks: `RECRUITMENT_HANDOFF.md` for the recruitment module operations + Postgres-migration backlog, `ACCOUNTS_HANDOFF.md` for the in-flight Accounts AppSheet-to-webapp conversion.

**Current state at handoff** · build **401** (v3.18.28) · branch `claude/access-check-2mIk5` · merged to `main` via PR #24 · last build: Schedule Diagnostics wiring.

---

## Table of contents
1. [Project identity](#1-project-identity)
2. [Stack & infrastructure](#2-stack--infrastructure)
3. [Repo layout](#3-repo-layout)
4. [Build & deploy rhythm](#4-build--deploy-rhythm)
5. [Standing rules / user preferences](#5-standing-rules--user-preferences)
6. [Role & RBAC system](#6-role--rbac-system)
7. [All modules in the portal](#7-all-modules-in-the-portal)
8. [Apps Script architecture](#8-apps-script-architecture)
9. [Data sources (all Google Sheets)](#9-data-sources-all-google-sheets)
10. [Critical patterns (with file references)](#10-critical-patterns)
11. [Recent build history](#11-recent-build-history)
12. [In flight: Accounts conversion](#12-in-flight-accounts-conversion)
13. [Backlog / parked items](#13-backlog--parked-items)
14. [Where to look for what](#14-where-to-look-for-what)

---

## 1. Project identity

**EVGCPL Portal** — internal multi-module web portal for Evergreen Enterprises (EVGCPL). Construction / project-management company. The portal centralizes operations: HR, Recruitment, Accounts, SCM / Purchase, Stores, Plant & Equipment, Site Operations, Safety, Reports, Project Cost Control (PCC), MD Command Centre. Users range from the MD (sees everything) to site-level staff (sees only their site's data) to external vendors (sees only their own POs/invoices).

**Primary user / decision-maker**: the MD ("NEUROLOOOM" — email `neurolooom@gmail.com`). Most directives in this codebase come from them. They make UI/UX calls, approve flow changes, and own the cutover decisions for every migration.

**Why the portal exists**: replacing a sprawl of AppSheet apps with a single integrated portal that has consistent design, single sign-in, role-based access, and a real upgrade path (Postgres migration planned). Some AppSheets have already been converted (Recruitment, HR Dashboard, Safety, Reports); others still live as embedded "Launch app" buttons (SCM, Accounts at the time of this doc — Accounts is being converted now).

---

## 2. Stack & infrastructure

| Layer | Technology |
|---|---|
| Frontend hosting | **GitHub Pages** (static) — `https://evgcpladmin.github.io/evgcpl-portal/` |
| Frontend code | Vanilla HTML / CSS / JS. **No build framework, no React.** Shared bundle pattern. |
| Backend | **Google Apps Script** deployed at a `/exec` URL. Frontend POSTs JSON to it. |
| Database | **Google Sheets** (10 distinct sheets — see § 9). Read via gviz JSON, write via Apps Script. |
| Auth | Google sign-in. User's Google profile (`name`, `email`) lives in `STATE.user`. Role derived from Employee Register row by email. |
| Storage | **Google Drive** (employee photos, recruitment PDFs, future PR attachments). |
| Email | **Apps Script `MailApp.sendEmail`** (offer letters, scheduled reports, safety alerts). |
| PDF generation | **`Utilities.newBlob(html, 'text/html').getAs('application/pdf')`** in Apps Script. |
| AI proxy | Apps Script `aiProxy` action → Groq / Gemini behind the scenes. |
| Sub-app | **PCC** (Project Cost Control) — separate page-set under `/pcc/` with its own backing sheet and Apps Script URL registry. |

**Crucial: there is no backend server, no Docker, no CI build of the frontend.** The portal is a `git push` away from production. The only thing that needs a "deploy" step is Apps Script — the user does that manually after backend `.gs` changes.

---

## 3. Repo layout

```
/
├── *.html                     ← one page per module (multi-page architecture)
│   ├── index.html             ← login page
│   ├── dashboard.html
│   ├── hr.html                ← HR + Recruitment + My Profile + Onboarding + Wall + Policies + Rewards
│   ├── accounts.html
│   ├── scm.html
│   ├── site-ops.html
│   ├── plant.html
│   ├── planning.html
│   ├── reports.html
│   ├── apps.html
│   ├── external.html
│   └── evg-ledger.html        ← (new, partial)
│
├── assets/
│   ├── js/
│   │   ├── portal-bundle.js   ← ~17K lines, ALL renderers live here
│   │   └── multi-page-bootstrap.js  ← per-page boot, route → page mapping, navigate() override
│   ├── css/
│   │   └── portal.css
│   └── templates/
│       ├── offer-letter.html       ← A4 token-fill HTML, used by Recruitment
│       └── appointment-letter.html
│
├── apps-script/               ← 11 .gs files (canonical backend)
│   ├── Router.gs              ← canonical doPost/doGet — switch on action
│   ├── RecruitmentHandlers.gs
│   ├── PCCHandlers.gs
│   ├── SafetyHandlers.gs
│   ├── ScheduledReports.gs
│   ├── AIChat.gs
│   ├── AiProxy.gs
│   ├── PortalConfigBackend.gs
│   ├── EmployeeProfileHandlers.gs
│   ├── SheetDiagnostic.gs
│   └── WorkplanHandlers.gs
│
├── pcc/                       ← Project Cost Control sub-app
│   ├── *.html                 ← 13 PCC pages (setup, boq, wbs, workplan, etc.)
│   ├── assets/js/
│   │   ├── config.js          ← PCC version + Apps Script URL resolver
│   │   ├── api.js             ← gviz wrapper + POST helper
│   │   └── ...
│   └── apps-script/
│       ├── AppsScript_Handlers.gs
│       └── PCC_AppScript_additions.gs
│
├── portal_v3/                 ← LEGACY MIRROR — being phased out, do not extend
│
├── build-portal.js            ← bumps version + build #, validates JS, bundles a release zip
├── BUILD.md                   ← build-script reference
├── README.md
├── RECRUITMENT_HANDOFF.md     ← recruitment module operations + Postgres migration backlog
├── ACCOUNTS_HANDOFF.md        ← in-flight Accounts AppSheet conversion brief
└── PORTAL_HANDOFF.md          ← this file
```

**Read this first**: `portal-bundle.js` is one giant file with section-comment banners (`// ══ HEADER ══`). Use grep to navigate. Don't try to read top-to-bottom.

---

## 4. Build & deploy rhythm

### Standard build cycle (every change)
1. Edit code.
2. `node --check assets/js/portal-bundle.js` — fail fast on syntax errors.
3. `node build-portal.js --patch` — bumps PCC_VERSION + PCC_BUILD + writes `version.json`, validates JS, produces `EVGCPL_Portal_v{ver}_build{n}_{date}.zip` (the zip is for archive only; GitHub Pages serves from `main`).
4. Commit. Push to the dev branch.
5. Open PR → **squash-merge to `main`**. GitHub Pages auto-deploys main within ~30 s.
6. If `apps-script/*.gs` changed: **tell the user to redeploy Apps Script** — they do it manually (Deploy → Manage deployments → New version, same exec URL). You cannot automate this.

### Branch convention
- Dev branch: **`claude/access-check-2mIk5`** (long-lived for this session series; was created early on).
- Every build merges back to `main` via PR.
- If a PR conflicts after squash-merge of the previous one: `git fetch origin main && git rebase origin/main && git push --force-with-lease`. This is normal and harmless (the conflicts are because squash created a different SHA for the same content).

### Build numbers
- `pcc/assets/js/config.js` holds `PCC_VERSION` (semver) and `PCC_BUILD` (monotonic integer). Both are patched by `build-portal.js`.
- `version.json` is the public source of truth — readable from the live site.
- The `?v=BUILD` cache-buster appended to bundle URLs in `*.html` is auto-rewritten by the build script. **Do not hand-edit those `?v=` strings.**

### Apps Script URL registry
- The frontend reads its Apps Script URL via `_resolvePccScriptUrl()` (pcc/config.js:16) — checks `localStorage.evgcpl_exec_registry_v1` first, then a `_SHEET_CONFIG` global, then a compiled-in default.
- The current default in `pcc/assets/js/config.js:15` is `https://script.google.com/macros/s/AKfycby...Gy2dchiLe3M/exec`. **Update when the user gives a new one.**
- The main portal has a similar `APPS_SCRIPT_URL` constant in `portal-bundle.js` — search for it.

---

## 5. Standing rules / user preferences

These are durable instructions from the MD. **Do not relitigate them.**

1. **Merge after every build.** Open a PR to `main` and squash-merge it. Don't leave builds languishing on the dev branch.
2. **No emojis in commit messages.** (Emojis in user-facing UI strings are fine and frequently requested.)
3. **No "Claude" / "AI" / "agent" / model-identifier references in commits, PR titles/bodies, code comments, or any committed artifact.** Keep that to chat replies only.
4. **No model name / version in code or commits.** The current model identifier is `claude-opus-4-7[1m]`; never write it anywhere committed.
5. **Manual Apps Script redeploy is the user's job** — flag it clearly when needed; don't try to automate or pretend it's done.
6. **Don't preemptively delete `portal_v3/`** — it's a legacy mirror that's being phased out. Edits to main pages should be mirrored there only if explicitly asked.
7. **Don't add demo modes, fake data, or sample-mode flags.** The MD removed all of those earlier and considers them noise.
8. **When in doubt, ask** via `AskUserQuestion`. The MD prefers a 30-second clarification to a wrong rebuild.
9. **Cleanup-as-you-go**: when removing a feature, also remove orphan CSS, dead JS references, and stale mentions in HTML. The codebase has had multiple feature removals (Demo Mode, Personal Dashboard, mobile bottom nav) where this discipline kept the bundle clean.
10. **Backward-compatibility shims are not wanted** — if a route or a column is being removed, remove every reference in the same PR.

---

## 6. Role & RBAC system

### Roles
Defined in `portal-bundle.js` (search for `const ROLES =`). Top-level portal roles:

| Role | Who | What they see |
|---|---|---|
| `md` | MD / Director / Admin / Process Owner | Everything |
| `hr` | HR staff, recruiters | HR Dashboard, Recruitment, Profile, Policies, Reports |
| `dept_head` | Department Head (with `deptHeadDept` storing which dept) | Their dept's data + reports |
| `site` | Site-In-Charge, RM | Their assigned site only |
| `purchase` | Purchase / Procurement / SCM | SCM, MRS, Stores, Vendor |
| `accounts` | Accounts / Finance | Accounts, Reports |
| `employee` | Regular staff | My Profile, My Documents, Policies, Apps |
| `vendor` | External vendor | Their POs, invoices, payments |
| `sc` | Sub-contractor | Their assigned work |

### Role detection
- Source of truth: **Employee Register** sheet's `Role (User Type)` column.
- Resolver: `resolveRoleFromEmployee(emp)` at `portal-bundle.js:1315`. Handles multi-role entries (comma/pipe/semicolon-separated), picks the highest-rank match via `ROLE_HIERARCHY` at `portal-bundle.js:1301`.
- For dept heads: extracts the department from `"Department Head - SCM"`-style tokens into `STATE.deptHeadDept`.

### Route gating
- `ROLE_ROUTES` (portal-bundle.js:1386) — per-role `Set` of allowed route IDs.
- `DEPT_HEAD_ROUTES` (~line 1399) — per-department-name `Set` for dept heads.
- `applyRoleNavRestrictions(role)` walks the sidebar and hides items the role can't access.
- **When adding a new route**: also add it to the right `ROLE_ROUTES` sets, or it'll work for the MD only.

### Sidebar visibility flags (HTML)
- `data-role-hide="site"` — hidden for site role.
- `data-status="live"` — shows a green "Live" badge.
- `data-status="dev"` — shows only when Dev Mode is on (MD-only toggle).

---

## 7. All modules in the portal

Each module = one route registered in `_routeRenderers` (portal-bundle.js:~1555) + one renderer function.

### Built and live

| Module | Route | Renderer | Page | Notes |
|---|---|---|---|---|
| Dashboard | `dashboard` | `renderDashboard` | dashboard.html | KPI tiles + sparklines |
| MD Command Centre | `md-command` | `renderMDCommand` | dashboard.html | MD-only; cross-module alerts + Pending Approvals |
| HR Dashboard | `hr-dashboard` | `renderHRDashboard` | hr.html | Headcount, accommodation/mess breakup, dept tally. Has 🚀 HR App button to the AppSheet (HR_v0). |
| My Profile | `my-profile` | `renderMyProfile` | hr.html | Workday-style: hero + left rail + 6-tab strip (Summary, Job, Compensation, Time Off, Documents, Team). Docs + Team lazy-load. |
| My Documents | `my-documents` | `renderMyDocuments` | hr.html | UUID-keyed Drive doc folder per employee. |
| Onboarding | `onboarding` | `renderOnboarding` | hr.html | HR view of recently joined → EmpCode + master entry. |
| Recruitment | `recruitment` | `renderRecruitmentModule` | hr.html | Full lifecycle. See § 12 / RECRUITMENT_HANDOFF.md. |
| Policies | `policies` | `renderPolicies` | hr.html | Static policy hub. |
| Rewards | `rewards` | `renderRewards` | hr.html | Nominations + wall posts to Rewards sheet. |
| Wall | `wall` | `renderWall` | hr.html | Internal social wall: posts + reactions + comments. |
| Site Manager | `site-manager` | `renderSiteManager` | site-ops.html | Per-site headcount, asset deployment. |
| Safety | `safety` | `renderSafety` | site-ops.html | Incidents tab with closing workflow + email alerts. |
| Equipment / Plant | `equipment`, `plant`, `plant-log`, `plant-verify`, `plant-maintenance` | various | plant.html, site-ops.html | Asset register + verification + maintenance. |
| Store | `store`, `stores` | `renderStores` | site-ops.html, scm.html | Stock + GRN tracking. |
| SCM | `scm`, `mrs`, `purchase`, `vendor`, `subcontractor` | various | scm.html | Purchase order lifecycle + MRS. |
| Accounts | `accounts` | `renderAccountsModule` | accounts.html | **Read-only today; New PR form being built — see § 12.** |
| Planning / PCC | `planning`, `planning-overview`, `planning-setup`, `execution`, `budget`, `project-setup`, `boq-planning`, `measurement-book`, `budgeting` | various | planning.html + the `pcc/` sub-app | Project Cost Control flow. |
| Reports | `reports` | `renderReports` | reports.html | Report catalogue + Schedule Diagnostics + Save Schedule + per-report views. |
| Settings / Dev Mode | `settings`, `dev-mode` | various | dashboard.html | MD-only |
| Apps | `apps` | `renderApps` | apps.html | Quick-launch grid for AppSheet apps still standalone. |
| External (vendor portal) | `vendor`, `my-portal`, `my-orders`, `my-invoices`, `my-documents` (vendor) | `renderVendorPortalInternal` | external.html | Vendor-facing PO + invoice view. |
| AI Chat | (sliding panel, not a route) | `toggleAIChat` | global | AI assistant — bell icon next to user pill. |
| Notifications | (sliding panel) | `toggleNotifPanel` | global | Right-side notification drawer. |
| Workday-style user menu | (popover) | `toggleUserMenu` → `_renderUserMenuContent` | global | Click user pill → avatar + View Profile + quick links + Sign Out. |

### Recently removed (don't re-add)
- **Personal Dashboard** (route `personal`) — was a single-button launcher for HR_v0 AppSheet. Removed in build 400. The 🚀 HR App button now lives in HR Dashboard header + My Profile hero.
- **Mobile bottom nav** (Home / Safety / Alerts / Menu bar) — removed in build 399. Was non-functional; the top header's bell + hamburger already cover Alerts + Menu.
- **Demo Mode** — removed across main + PCC + portal_v3 earlier.

---

## 8. Apps Script architecture

### Router
`apps-script/Router.gs` is the **only** `doPost` / `doGet` in the deployed project. Every other `.gs` file just exports handler functions. The router:
- Parses JSON body (Content-Type: text/plain to avoid CORS preflight).
- Switches on `action` field.
- Returns `_ok({...})` or `_err('message')` — both produce `application/json` with a `success` boolean.
- `_wrap(result)` normalizes handler return values.

### Handler files (`apps-script/`)
| File | Owns |
|---|---|
| `Router.gs` | Canonical doPost/doGet + response helpers (`_ok`, `_err`, `_wrap`). |
| `SafetyHandlers.gs` | Generic writes: `appendRow`, `updateCell`, `batchUpdate` (used across many modules), plus `closeSafetyIncident`. |
| `RecruitmentHandlers.gs` | 14 actions: `saveMRF`, `updateMRF`, `updateMRFStatus`, `getMRFs`, `saveOffer`, `updateOfferStatus`, `createJoiningEntry`, `getJoiningList`, `getJoiningListSchema`, `savePreJoining`, `markAsJoined`, `assignEmpCode`, `sendOfferEmail`, `updateApptLetter`. Header-aware `saveOffer` auto-extends columns. |
| `PCCHandlers.gs` | Project Cost Control writes: 12 actions (`saveProjectSetup`, `saveBOQ`, `saveWBS`, `saveWorkplan`, `saveManpower`, `saveMachinery`, `saveMaterials`, `saveOverheads`, `saveVariations`, `submitBudgetApproval`, `deleteWBSRow`, `deleteActivity`). |
| `WorkplanHandlers.gs` | Workplan-specific operations. |
| `ScheduledReports.gs` | `runScheduledReports` (hourly trigger) + `forceRunSchedules` + `getScheduleLog_` + auto-creates `ScheduleLog` tab. Wired in build 401. |
| `EmployeeProfileHandlers.gs` | `getEmployeeList`. |
| `PortalConfigBackend.gs` | `savePortalConfig`, `getPortalConfig` (PortalConfig tab in Master sheet). |
| `SheetDiagnostic.gs` | `diagnoseSheet` (public-share + permission inspection). |
| `AIChat.gs` | `aiChat` — domain-aware Q&A. |
| `AiProxy.gs` | `aiProxy` — Groq / Gemini passthrough. |

### Total: **47 distinct POST actions** wired in Router.gs.

### When adding a new action
1. Write the handler function in the appropriate `.gs` file (or create a new one).
2. Register in `Router.gs` doPost — typically `if (action === 'foo') return _ok(foo(body));` or `_wrap(foo(body))`.
3. Tell the user to redeploy. Until they do, the frontend will see `Unknown POST action: foo`.

---

## 9. Data sources (all Google Sheets)

| Sheet ID | Name | Tabs frontend reads | Used by |
|---|---|---|---|
| `1B2wb38KhNwlLoZnsAGWQkO0FdEGFFfsh3ycRRurigq4` | **Master** | `5-SiteMaster`, `1-BillingMaster`, `7-VendorMaster`, `10-SubContractorMaster`, `PortalConfig`, `DesignationMaster` | Almost every module — site / billing / vendor dropdowns |
| `1HWKZPhKRhcuvxBgyyN8zRt8p-SzYmKjJWiOdCgykBHs` | **Employee Register** | `0_EmployeeRegister_Live`, `0A_EmployeePersonalDetails`, `ReportSchedules`, `ScheduleLog` | HR, Profile, Recruitment "Reports To", Onboarding, RBAC role detection |
| `1Dw48OEDmIAAu9Va1-a9z7PZT7wKS_mWU7cwpK6osRNI` | **Recruitment** | `MRF_Register`, `Offer_Tracker`, `PreJoining_Checklist`, `v1_JoiningList` | Recruitment module only |
| `1mLddxLRf719EaXE9XSET9gT8l0a8Cxns362yIbHo63g` | **Payment / Accounts** | `PaymentRequest` (~30 cols) | Accounts module |
| `1zcqF2tjjBETPuW25c9MBMo0zakBIBD6tksg5OstFA7c` | **PO / Purchase** | `PO_Actual`, `MRS`, `Invoice`, vendor lookup columns | SCM, Vendor Portal, Accounts (for PO refs) |
| `1iMQxgqGilUh2_3NCZl5D-EMt-NC8FwugX83q2fWb8fE` | **Stores** | `StockIN`, `GRN_No`, `v3StockLevels` | Stores, Accounts (GRN reconciliation) |
| `1dQow9nD4e0qVOSfpwEWQmPTuhF3FW_8r1oK5dMjJlRE` | **PCC** | `Project`, `BOQ`, `WBS`, `Activities`, `CostCode`, `Workplan`, `Manpower_Plan`, `Machinery_Plan`, `Material_Plan`, `Overheads`, `Variations`, `BudgetApprovals` | PCC sub-app |
| `1fhSO4WBYp0LNXPxe9I9zr5qsIPs9CIDFpUixBogPnsM` | **Z12 / v2_Master** | `M12_Nature of Work`, `M_PL_1_Activities` | PCC activity master, DPR data |
| `1B8P0PawV...ycNOvDY` | **Safety** | `Incidents` | Safety module |
| `1vz8HLopj...dehlI` | **Rewards** | `Nomination`, `Posts`, `Reactions`, `Comments` | Rewards + Wall |
| `139deMPqCXVZL...hynkYqIjsVp` | **DPR** | DPR tab | Daily Progress Reports |
| `1hN4VEDNpVLD...gy15D0` | **UserSecrets** | `PIN`, `ReportConfig` | PIN reset, legacy report configs |

**Reads**: every sheet must be **"Anyone with link → Viewer"** for the gviz endpoint to work. The frontend calls `fetchSheet(tabName, tqQuery, sheetId)` (portal-bundle.js:~11661) which hits `gviz/tq?tqx=out:json` and parses the JSONP response.

**Writes**: every sheet must be **shared with the Apps Script's deployed account as Editor**.

---

## 10. Critical patterns

### `fetchSheet(tabName, tqQuery, sheetId)` — gviz read
- Source: `portal-bundle.js:~11661`.
- Returns array of row objects keyed by column header. Pass `null` as the query to get all columns (`*`).
- gviz Date format is non-standard: `Date(YYYY,MM,DD[,HH,mm,ss])`. **Use `parseGvizDate(val)`** (portal-bundle.js:~11713) to parse.

### Header-aware Apps Script writes
- Example: `saveOffer` in `RecruitmentHandlers.gs`. Before writing, it reads the live sheet's header row and **appends any new columns** declared in `RC_OFFER_HEADERS` that the sheet doesn't yet have. Then writes the data row in header order. **Use this pattern** when adding new fields — the live sheet self-extends, no manual header edit needed.

### Awaited POST with backend-error surfacing
- `_rcPostActionAwait({action, ...payload})` (search in portal-bundle.js) — wraps `fetch` so non-2xx responses or `success:false` bodies are surfaced to the user instead of swallowed. Use this for any user-initiated write.

### iframe `srcdoc` for full-document preview
- Used by Recruitment's offer-letter preview to isolate the template's `@page`, `@import` and global styles from the portal's CSS.
- Set via JS: `iframe.srcdoc = filledHtml;` — not inline `srcdoc=""` attribute (escape hell).

### Token-fill template (`_fillTemplate(html, map)`)
- Source: `portal-bundle.js:~15098`. Regex-replaces `{{token}}` (`\w+` only) — safe inside `<style>` blocks and base64 data URIs.
- Templates live in `assets/templates/`. Loaded via `_loadHtmlTemplate(name)` with build-version cache-bust.

### Debounced preview re-render
- `_rcOLPreviewSoon()` schedules a 250 ms-debounced preview refresh. **Don't trigger preview recalc from inside a recalc** — leads to infinite loops. Field handlers call `_rcOLPreviewSoon()`; the recalc function only writes to draft + DOM.

### Lazy-loaded panes
- `_mpShowTab(id)` (My Profile) sets a `data-pane` `.active` class and lazy-loads Documents + Team panes on first open.

### Role-gated UI controls
- Don't rely on hidden buttons for security — RBAC must be enforced server-side too. Today server-side gates are weak (Apps Script just trusts the role string the frontend sends). When Postgres migration happens, RLS replaces this.
- Frontend pattern: `${['md','hr'].includes(STATE.role) ? '<button…>' : ''}`.

### `STATE` object
- Lives in `portal-bundle.js` as a plain global. Mirrored to `localStorage.STATE` by `multi-page-bootstrap.js` so each page reload picks up the same role/user. Key paths:
  - `STATE.user.email`, `STATE.user.name`
  - `STATE.role`, `STATE.selectedRole`, `STATE.deptHeadDept`
  - `STATE.masters.users`, `STATE.masters.sites`, `STATE.masters.billing`, `STATE.masters.messUnique` etc.
  - `STATE.mastersLoaded` — set true after `loadAllMasters()` finishes.

### "Wait for masters" guard
- If a renderer needs `STATE.masters.*`, **check `STATE.mastersLoaded` and retry** if not ready (cross-page redirects can race the masters loader). Example pattern shipped in build 398:
  ```js
  if (!STATE.mastersLoaded || !STATE.masters?.users?.length) {
    el.innerHTML = `<spinner/>`;
    setTimeout(renderMyProfile, 300);
    return;
  }
  ```

### Photo / asset storage
- Employee photos: localStorage `evg_photo_${empCode}` + Drive backup via `savePhoto` action.
- PR attachments (in flight for Accounts): per-PR Drive folder, new Apps Script action `uploadPRAttachment`.

---

## 11. Recent build history

| Build | Change |
|---|---|
| **401** (current) | Wire `runSchedulesNow` + `getScheduleLog` actions; auto-create `ScheduleLog` tab. Fixed "Unknown POST action" in Schedule Diagnostics. |
| 400 | Drop Personal Dashboard page; add 🚀 HR App launcher to HR Dashboard header + My Profile hero. |
| 399 | Remove non-functional mobile bottom nav (Home / Safety / Alerts / Menu) from 10 main + 10 portal_v3 pages. |
| 398 | Guard My Profile against pre-masters render (spinner + retry). Fixes empty View Profile from dashboard popover. |
| 397 | Workday-style user menu + Worker Profile shell. Click user pill → popover with View Profile + quick links + Sign Out. Profile reskinned to left-rail + 6-tab strip. |
| 396 | Reports To dropdown fetches `Employee_Ref` directly from EMP_SHEET_ID, bypassing the masters cache. |
| 395 | Reports To uses `Employee_Ref`; broaden user loader fallbacks; dedupe Billing dropdown. |
| 394 | Update PCC Apps Script exec URL. |
| 393 | Fix empty Reports-To dropdown (filter on `empStatus`, not the missing `u.status`). |
| 392 | Offer form: master-backed dropdowns (Designation, Site, Billing, Reports To, Department, Company); new fields (Employee Type, Contractual Period, Address paragraph). |
| 391 | Tracker + Joining filters: MD Pending Approvals badge, HR Pending Onboarding filter, status badges. |
| 390 | HR onboarding handoff (Phase 3) — appointment-on-joining triggers Pending HR onboarding. |
| 389 | Offer lifecycle (Phase 2) — Draft → Pending Approval → Released → Accepted/Declined/Expired. Role-gated tracker actions. |
| 388 | 9-component salary model (Basic 50 / HRA 10 / DA 15 / Special 15 / Conveyance 4 / Education 1 / Uniform 1 / LTA 2 / Site 2) + recruiter-added flat extras → Calculated Salary → CTC. |
| 387 | New A4 offer + appointment letter designs (EB Garamond / Montserrat, embedded base64 logo). |
| 386 | Externalize PDF letter templates to `assets/templates/*.html`. |

The Recruitment module's full operations doc is in `RECRUITMENT_HANDOFF.md` (read it after this one).

---

## 12. In flight: Accounts conversion

**Goal**: replace the Accounts AppSheet (`https://www.appsheet.com/start/fcdba849-9f9d-435f-8e8a-ea0c975dbd21`) with a portal-native module. The read-only view already exists (`renderAccountsModule` at `portal-bundle.js:4253`). The writes (New PR, approval, Mark Paid, UTR entry) still live in the AppSheet.

**Decisions locked** (do not relitigate):
- Full conversion in one sprint (New PR + Approval + Accounts processing + status changes).
- Match the AppSheet workflow exactly — user will provide field spec + screenshots.
- **Multi-attachment folder per PR** — each PR gets its own Drive folder; initiator uploads invoice + supporting docs.
- Stay on Apps Script + Sheets backend (Postgres migration parked — see § 13).

**First deliverable**: Payment Request form. Field spec is being drafted by the user in Claude Chat using `ACCOUNTS_HANDOFF.md` as the brief. When that spec lands here, we build:
1. "+ New Payment Request" button on the existing Accounts page
2. Form shell with sections (Initiator / Vendor / Bill & PO / Payment / Site & Company / Attachments)
3. Dropdown loaders for Site, Billing, Department, CostCode, Employee, Vendor
4. Apps Script action `saveNewPaymentRequest` (header-aware, mirroring Recruitment's `saveOffer`)
5. Drive folder creator `createPRFolder(requestId)` + uploader `uploadPRAttachment`
6. Request ID generator (format TBD with user — probably `PR-YYMM-####`)
7. UUID via `crypto.randomUUID()` client-side

**After the form lands**: approval screen → Accounts processing (Mark Paid + UTR) → archive the AppSheet launcher card.

**Full inventory of the current Accounts read side**: see `ACCOUNTS_HANDOFF.md`.

---

## 13. Backlog / parked items

### Migrate Recruitment + Accounts off Sheets → Supabase Postgres
- **Parked.** Full plan in `RECRUITMENT_HANDOFF.md` § Backlog.
- Phase 1 = Recruitment (~4 wks). Phase 2 = Accounts (~2 wks). Phase 3+ deferred.
- Decisions baked in: hard cutover + 1-week parallel read, Resend + Supabase Edge Function (puppeteer) for email/PDF, Supabase as the target.
- Resume condition: after the Accounts AppSheet conversion lands and proves stable.

### Other AppSheet conversions (not started)
- **HR_v0** (`9fcf3039-c992-4498-9647-2bcccca13ece`) — leave / attendance / payslip flows. Most-used AppSheet; obvious next target after Accounts.
- **SCM** (`06fd0117-1dd8-445b-aaee-e2ff6e68e36f`).
- **Salary Breakup template** — was deferred during Recruitment phase 1.

### Minor known issues
- Approval / Reports CRUD via Apps Script — actions `saveScheduledReport`, `deleteScheduledReport`, `runReportNow` are registered in `Router.gs` but call functions that don't exist. They'd ReferenceError if invoked. Frontend doesn't hit them (uses `appendRow` directly). Fix when Reports rework happens.
- `portal_v3/` mirror is stale relative to `main` for several recent builds. Not pruned because the MD hasn't asked for cleanup yet.

---

## 14. Where to look for what

| Looking for | Path |
|---|---|
| Main bundle (every renderer) | `assets/js/portal-bundle.js` |
| Per-page boot, route → page map, `navigate()` | `assets/js/multi-page-bootstrap.js` |
| Apps Script router | `apps-script/Router.gs` |
| Recruitment lifecycle | `apps-script/RecruitmentHandlers.gs` + RECRUITMENT_HANDOFF.md |
| Recruitment frontend | `_rc*` functions in portal-bundle.js + `assets/templates/offer-letter.html`, `appointment-letter.html` |
| Workday user menu | `toggleUserMenu` / `_renderUserMenuContent` / `signOut` in portal-bundle.js |
| My Profile shell | `renderMyProfile` (portal-bundle.js:~7500) + `_mpShowTab` |
| HR Dashboard | `renderHRDashboard` (portal-bundle.js:7289) |
| Accounts | `renderAccountsModule` (portal-bundle.js:4253) + ACCOUNTS_HANDOFF.md |
| Schedule Diagnostics | `rptSched*` functions in portal-bundle.js + `ScheduledReports.gs` |
| Role resolver | `resolveRoleFromEmployee` (portal-bundle.js:1315) + `ROLE_HIERARCHY` (~1301) |
| Route gating | `ROLE_ROUTES` (portal-bundle.js:1386), `DEPT_HEAD_ROUTES` (~1399) |
| Route registration | `_routeRenderers` (portal-bundle.js:~1555) |
| gviz reader | `fetchSheet` (portal-bundle.js:~11661), `parseGvizDate` (~11713) |
| Template fill | `_fillTemplate` (~15098), `_loadHtmlTemplate` |
| Build script | `build-portal.js` + BUILD.md |
| Version / build # | `pcc/assets/js/config.js`, `version.json` |
| AppSheet launcher URLs | `APPSHEET_APPS` (portal-bundle.js:~2688) |

---

**End of master handoff.** When picking up the project: read this top-to-bottom, then `RECRUITMENT_HANDOFF.md` (for module depth + Postgres backlog), then `ACCOUNTS_HANDOFF.md` (for the active task).
