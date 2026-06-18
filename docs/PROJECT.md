# EVGCPL Portal — Project Document

> Internal operations portal for **Evergreen Enterprises (EVGCPL)** — a
> construction / infrastructure contractor. Single-page modules served as a
> static multi-page site, backed entirely by Google Sheets and Google Apps
> Script. This document is the canonical reference for how the portal is built,
> deployed, and structured.

**Current release:** v4.11.0 · build 584 · 2026-06-18
_(authoritative source: [`version.json`](../version.json))_

---

## 1. What this is

The EVGCPL Portal is a role-based intranet that surfaces the company's
operational data — HR, site operations, procurement, stores/inventory,
accounts/payments, planning & cost control — to staff, management, vendors and
sub-contractors. There is **no application database**: every screen reads from
Google Sheets (live, via the gviz endpoint) and writes through Google Apps
Script web apps. The portal itself is a static bundle of HTML + one large JS
file, hosted on GitHub Pages.

**Design philosophy**
- The spreadsheet is the system of record; the portal is a presentation +
  light-write layer over it.
- One source-of-truth JS bundle, deterministically versioned and cache-busted.
- A shared design system (EVG) and a universal table engine so every module
  looks and behaves consistently.
- Role + per-page access control resolved on every load.

---

## 2. Tech stack & hosting

| Concern | Choice |
|---|---|
| Front end | Vanilla JS (no framework), hand-written HTML, CSS-in-JS generated from the EVG design system |
| App logic | `assets/js/portal-bundle.js` — the single source-of-truth bundle (~1.3 MB) |
| Multi-page glue | `assets/js/multi-page-bootstrap.js` — route→page map, state restore, self-heal |
| Data reads | Google Sheets **gviz** (`fetchSheet(tab, tq, sheetId)`), read **by header name** |
| Data writes | Google Apps Script web apps (`EXEC_REGISTRY`) via POST |
| Auth | Google Sign-In (GIS) + PIN (UserSecrets sheet) |
| Hosting | GitHub Pages (static), repo `evgcpladmin/evgcpl-portal` |
| AI | Groq `llama-3.3-70b-versatile` proxied through Apps Script (`aiProxy`) |

---

## 3. Repository layout

```
/                         repo root (static site root)
├── *.html                one file per page-group (see §5)
├── version.json          {major,minor,patch,build,semver,builtAt} — DO NOT hand-edit
├── build-portal.js       the ONLY way to bump version / stamp / cache-bust
├── CLAUDE.md             working notes & golden rules for contributors
├── partials/
│   └── topnav.html       desktop top-nav master (synced into every page by the build)
├── assets/
│   ├── js/
│   │   ├── portal-bundle.js          ← the app (source of truth)
│   │   └── multi-page-bootstrap.js   ← routing / bootstrap layer
│   └── css/ …
├── pcc/                  Project Cost Control sub-app (own config.js, version-stamped)
└── docs/
    └── PROJECT.md        this document
```

### HTML page-groups
Each HTML file is a "page group" that loads the same bundle and renders one of
several routes via `body.dataset.page`:

`index.html` (login) · `dashboard.html` · `hr.html` · `site-ops.html` ·
`scm.html` · `accounts.html` · `planning.html` · `plant.html` · `reports.html` ·
`apps.html` · `config.html` · `external.html` (vendor/SC) · `evg-ledger.html` ·
`sharing-doctor.html`

---

## 4. Architecture

### 4.1 Routing & the multi-page split
`multi-page-bootstrap.js` runs after the bundle and:
1. Maps every route → owning HTML page (`ROUTE_TO_PAGE`).
2. Overrides `navigate()` so cross-page routes redirect via `location.href`,
   while same-page routes render in place through `renderPage()`.
3. Restores `STATE` (role, user) from `localStorage` on each page (set at login).
4. **Self-heals stale cache** — compares the running `PORTAL_BUILD` against a
   fresh `version.json`; if a newer build is deployed it reloads once with a
   cache-busting query (prevents the "old HTML/bundle still served" problem).

### 4.2 Module registry — the route contract
`MODULE_REGISTRY` is the spine of navigation & access. `applyPortalConfig()`
rebuilds `ROLE_ROUTES` **entirely** from it on every load. **Any navigable route
not registered there is silently stripped and its nav button hidden.**

> ⚠️ **Every new page/route MUST be registered in four places, together:**
> 1. a `{ route, label, section, defStatus, defRoles }` entry in `MODULE_REGISTRY`
> 2. route → render fn in the `pages` map inside `renderPage()`
> 3. route → owning page file in `ROUTE_TO_PAGE` (`multi-page-bootstrap.js`)
> 4. the nav entry — **top nav** (`partials/topnav.html`) **and** the mobile
>    `#sidebar` (they are separate, hand-coded per page).
>
> A load-time `_routeRegistryAudit()` warns about nav routes missing from the
> registry; `applyPortalConfig()` unions `window._RENDER_ROUTES` in as a
> backstop — but registering the module is the real fix.
>
> Level-3 sub-pages (children of `NAV_SUBMENUS`) render inside their parent and
> are intentionally **not** registered.

### 4.3 Navigation
Two hand-coded, duplicated navs:
- **Desktop top nav** — `.tnav-group`/`.tnav-item` in `<nav id="topNav">`. The
  build syncs this from `partials/topnav.html` into all pages.
- **Mobile sidebar** — `.sidebar-section`/`.nav-item`, a progressive
  drill-down (L1 → L2 → L3), per-file.

New runtime menu items go through `_navEnsureInjected()` (injects into both).

### 4.4 EVG design system & universal table engine
`window.EVG` holds one base definition per component type — `EVG.table`,
`EVG.card` (KPI), `EVG.form`, `EVG.dashboard`. Change a default there and every
instance updates. Component classes: `.evg-kpi`, `.evg-kpi-grid`,
`.evg-dash-grid`, `.evg-form` (CSS generated in `_tblEngineEnsureStyles`).

The **universal table engine** stamps features onto every rendered data table:
- wrap · drag-resize columns · per-table quick search · **density** toggle
  (comfortable/compact) · per-column `data-nowrap`.
- **Viewport-fit scroll** — `_tblFitHeights()` sizes each table's scroll region
  to end at the viewport bottom (default `EVG.table.rows = 0`), so the page
  itself doesn't also scroll — **one scrollbar, no nesting**. A user-set
  rows-before-scroll keeps its fixed cap.
- **⚙ Columns** manager — drag-reorder + show/hide + ★ set-as-default
  (personal `localStorage evg_tbl_cols`; admin org-wide via PortalConfig
  `tbl_cols`); widths persist in `evg_tbl_widths`.
- **🎨 Style** per-table override — zebra / borders / wrap / width / rows
  (`localStorage evg_tbl_style`, by table signature; overrides beat the system
  default *and* inline cell styles via `!important`).
- **⬇ CSV** export — honours the column manager's visible columns & order.

Opt a single instance out entirely with `data-evg-defaults="off"` (used where a
view manages its own scroll/toolbar, e.g. the Accounts Worklist, which also
streams rows progressively on scroll for large datasets).

### 4.5 Access control & roles
Roles (`ROLES`): `md`, `hr`, `site`, `employee`, `purchase`, `accounts`,
`vendor`, `sc`, `dept_head`.

Access is configured in one tab — **"Access & Pages"** (`_cfgRenderAccess`),
which holds both per-page Live/Dev/Off status (`uaSetModuleStatus`) and the
Access-Group route/action grants. `access_config` is sheet-authoritative on
load; `?access=off` is an escape hatch so an admin can't be locked out.
External roles (`vendor`, `sc`) land on `external.html`, not the staff shell.

---

## 5. Data sources

### 5.1 Google Sheets (read by header name via gviz)
| Constant | Purpose |
|---|---|
| `SHEET_ID` | Master spreadsheet (cost centres, vendor/SC masters) |
| `V2_MASTER_SHEET_ID` | v2_Master |
| `EMP_SHEET_ID` | Employee Register (+ UUID tab `0A_EmployeePersonalDetails`) |
| `PAYMENT_SHEET_ID` | "Account View" — `PaymentRequest` tab (payments/approvals/ledgers) |
| `PO_SHEET_ID` | v2_Purchase — `PO_Actual` (header) + `PO_Items_Actual` (lines) |
| `STORES_SHEET_ID` | v2_Stores — `StockIN` / GRN tabs |
| `EXPENSE_SHEET_ID` | "Expenses" — `CashExpenseMonth` (monthly ledger), `Cash Expenses` (requests), `Cash Expenses - Approval`, `Ledger` (bills), `Individual Food Expenses` (+ Approval). Numeric columns are text → fetch with `headers:1`. |
| `RECRUITMENT_SHEET_ID` | Recruitment |
| `SAFETY_SHEET_ID` | Safety module |
| `REWARDS_SHEET_ID` | Rewards & Recognition + Blog/Wall |
| `DPR_SHEET_ID` | Daily Progress Report (Execution) |
| `PCC_SHEET_ID` | ProjectSetup_v1 (Project Cost Control) |
| `PIN_SHEET_ID` | UserSecrets (PIN auth) |
| `HR_DOCS_FOLDER_ID` / `POLICY_FOLDER_ID` | Drive folders (HR documents, policies) |

> **Convention:** always read sheets **by header name**, never by column letter
> — column order shifts. Sheets must be shared **Anyone with link → Viewer**.
> Sheet links can be overridden at runtime via the Sheet-Linking config
> (`getLink('KEY')` → `{id, tab}`).

### 5.2 Apps Script backends (`EXEC_REGISTRY`)
Configurable per-environment; defaults baked in, overridable via PortalConfig
`exec_*` rows.

| Key | Role |
|---|---|
| `main` | Default for most POSTs (DPR, Safety, PCC, Onboarding, Reports) |
| `portalConfig` | Standalone PortalConfig backend (get/save portal config) |
| `accounts` | Accounts module (payment requests, PR folders/attachments) |
| `pcc` | Project Cost Control handlers |
| `pinReset` | PIN reset (UserSecrets) |
| `aiProxy` | Groq AI proxy |
| `diagnostic` | Sharing-Doctor sheet checks |

---

## 6. Modules (by nav section)

Source of truth: `MODULE_REGISTRY`. Status `live` unless noted.

| Section | Route | Label | Roles |
|---|---|---|---|
| Main | `dashboard` | Dashboard | all staff |
| | `my-tasks` | **My Tasks** — per-user pending-approvals inbox _(placeholder; see BACKLOG.md)_ | all staff |
| | `md-command` | MD Command Centre | md |
| HR & People | `hr-dashboard` | HR Dashboard | md, hr, dept_head |
| | `my-profile` | My Profile (Summary/Job/Comp/Time Off/Documents/Team/**Statement**) | all staff |
| | `onboarding` | Onboarding | md, hr |
| | `recruitment` (+ sub-pages `rec-requisitions` / `rec-offers` / `rec-prejoining` / `rec-joining`) | Recruitment — Overview, Requisitions, Offer Letters, Pre-Joining, Joining (each tab is a nav sub-page) | md, hr, dept_head, site |
| | `mess-individual` | **Individual Mess Expenses** — per-employee monthly mess allowance (`Individual Food Expenses`) | md, hr, accounts, dept_head |
| | `policies` | Policies Hub | md, hr, site, employee, dept_head |
| Site Ops | `site-manager` | Site Manager | md, site, dept_head |
| | `safety` | Safety Module | md, site, hr, dept_head |
| | `equipment` | Equipment & Machinery | md, site, dept_head |
| | `store` | Site Store | md, site, purchase, dept_head |
| | `plant` | Plant Overview | md, site, dept_head |
| Procurement | `scm` (+ `scm-pending/register/site/vendor`) | Purchase Dashboard & views | md, purchase, site, dept_head |
| | `mrs` | MRS | md, purchase, site, dept_head |
| | `stores` (+ `stockin/siraw/grn/openpo/levels`) | Stores & sub-pages | md, purchase, site, dept_head |
| | `vendor` | Vendor Portal (internal; own ledger tab) | md, purchase, accounts, dept_head |
| | `subcontractor` | Subcontractor Portal (SC ledger) | md, purchase, accounts |
| | `tendering` | Tendering | md, purchase _(dev)_ |
| Accounts | `md-payments` | Payments & Approvals | md |
| | `ledgers` (+ `ledger-sc`, `vendor-ledger-po`) | **Ledgers** (Employee / Sub-Contractor / Vendor PO) | md, accounts |
| | `expense-ledger` | **Expense Ledger** — cash-expense drill-down tree (month → requests → bills) from `EXPENSE_SHEET_ID`; Other Expenses / Site Mess split; pending highlighted | md, accounts, hr, dept_head |
| | `accounts` / `-dashboard` / `-worklist` (legacy aliases `-v2` / `-kpi`) | Accounts Workspace & KPIs (classic + KPI pages retired to redirects) | md, accounts, dept_head |
| Planning | `budgeting`, `execution` (DPR), planning/PCC routes | Budgeting / Execution / Cost Control | varies |
| Plant & Machinery | `plant-log`, `plant-verify`, `plant-maintenance` | Log / Verify / Maintenance | md, site, dept_head |
| Reports | `reports`, `data-hub` | Reports / Universal Data Hub | md, hr, purchase, accounts, dept_head |
| Quick Access | `rewards`, `apps`, `sheets` | Rewards & Wall / Apps / Sheets dir | varies |
| Personal | `my-documents` | My Documents | all staff |
| Admin | `dev-mode` (Configuration), `settings` | Admin | md |

---

## 7. Ledgers subsystem

A **party ledger** is a per-party statement of transactions with a running
balance. A *party* is a Vendor, Sub-Contractor, Employee or "Others", identified
uniquely by **Name + A/C number**.

### 7.1 Core engine (reusable)
All in `portal-bundle.js`, fed from the `PaymentRequest` tab:
- `_mdpParseRow(r)` → normalised row `{ uuid, date, payTo, paidTo, orderNo,
  amount, acNumber, status, … }`.
- `_mdpLoad(force)` / `_mdpRows` — fetch + cache.
- `_plPartyKey(r)` (`type|name|acc`), `_plParties(type, companyFilter)`.
- `partyLedgerRender(txRows, opts)` — **context-free** KPIs + running-balance
  table; `opts.onRowClick` = global fn name (e.g. `_accOpenPRDetail`).
- Status always via `getPayStatus()`; amounts via `_mdpAmt`; dates sorted with
  `_mdpDateVal` (tolerant of `10June2026`, `1 November 2025`, `DD/MM/YYYY`).

### 7.2 Where ledgers appear
| Surface | Route / location | Notes |
|---|---|---|
| MD Payments → Party Ledger | `md-payments` tab | original home |
| **Dedicated Ledgers page** | `ledgers` | Employee / Vendor / Sub-Contractor tabs + party picker |
| My Profile → **Statement** tab | `my-profile` | the logged-in employee's own ledger |
| **Subcontractor Portal** | `subcontractor` | SC party ledger |
| Vendor Portal | `vendor` | its own vendor-scoped ledger (`vpiRenderLedger`) |
| **Vendor Ledger (PO Payments)** | `vendor-ledger-po` | see below |

### 7.3 Vendor Ledger (PO Payments) — distinct model
A vendor account statement scoped to PO purchases (not the billed-amount model):
- **Vendor list** = only vendors with PO payments (`PaymentRequest` rows where
  `Payment To = Vendor` and `Order No` non-empty).
- **Credit (Material)** = received material cost = StockIN received qty × PO
  rate, per PO (reuses the Open PO `StockIN ↔ PO_Items_Actual` CheckSum‖Part
  join).
- **Total Tax** = `Tax (a)` (`Tax Amt` on `PO_Items_Actual`) + `Tax (b)`
  (`PO_Actual`).
- **Additional Charges** = `Sub Total (b)` (`PO_Actual`).
- **Debit (Paid)** = the vendor's paid PO payments.
- **Running Balance** = Σ(Credit − Debit) = outstanding payable. (Tax &
  Additional Charges are shown as columns and are *not* currently folded into
  the balance.)

---

## 8. Build & release process

The portal is **deterministic from `version.json`**. Never hand-edit version
constants or `version.json`. The only way to bump is:

```bash
node build-portal.js --patch    # or --minor / --major
```

That single command bumps the version **and always increments `build`**, stamps
`PORTAL_VERSION/BUILD/BUILD_AT` into the bundle and `pcc/.../config.js`,
cache-busts `?v=<build>` on every HTML asset ref, syncs the top nav from
`partials/topnav.html`, runs `node --check`, then writes `version.json`.

### The golden rules
1. **Commit your code FIRST**, before any merge or build. `git checkout
   --ours/--theirs <file>` and `build-portal.js` operate on the **committed**
   tree — uncommitted edits can be silently destroyed.
2. **Build LAST, from main's latest `version.json`.** PRs are squash-merged, so
   `main` diverges after every merge. Sequence:
   1. edit `portal-bundle.js`; `node --check`.
   2. `git add -A && git commit` the code.
   3. `git fetch origin main && git merge origin/main --no-edit`.
   4. resolve any `version.json` conflict by taking **main's** (`git checkout
      --theirs version.json`), commit.
   5. run `build-portal.js` (`--patch` fix / `--minor` feature / `--major`
      breaking) so the build increments **from main's** number.
   6. commit the build, push, open PR, squash-merge.
3. **Sanity check before push:** `version.json` `build` strictly greater than
   `origin/main`'s; `node --check` passes.

### Release level
- `--patch` — bug fixes / small tweaks.
- `--minor` — a new feature or batch of features (resets patch).
- `--major` — breaking changes / redesign.

### Git / PR workflow
- Develop on the assigned feature branch; never push to `main` directly.
- Push `git push -u origin <branch>`; retry on network errors.
- One PR per change; squash-merge. End commit messages / PR bodies with the
  session URL footer.

---

## 9. Conventions & gotchas

- **Read sheets by header name**, never column letter.
- **Register every route** (§4.2) — the #1 cause of "the page exists but the nav
  button is missing".
- **Both navs are separate** — update top nav (`partials/topnav.html`) *and* the
  mobile sidebar.
- **Reuse the EVG components & `partyLedgerRender`** — don't re-style or fork.
- **No emojis and no "Claude"/"AI"/"agent"** in commits, code, or comments.
- The **build sandbox has no network egress to Google** (`Host not in
  allowlist`) — live Sheets can't be inspected from CI; only the runtime browser
  can. Validate data-dependent features against the live site.
- Per-user arrangement config resolves **personal localStorage → system default
  (PortalConfig) → compiled default**.

---

## 10. Backlog / roadmap

| Item | Status | Notes |
|---|---|---|
| **My Tasks** (per-user approval inbox) | placeholder shipped | Consolidate every pending item where the user is the approver/next actioner. Spec in `BACKLOG.md`. |
| **HR restructure** — Day-to-Day (Employee Register, Attendance, Leave, OD, Attendance Review) & Other Operations (Site Mess, Individual Mess, Advance & Loans) classifications + roll-up overviews | partial | Individual Mess + Site Mess (Expense Ledger) done; Employee Register data exists. **Needs sheets** for Attendance / Leave / OD / Attendance Review / Advance & Loans, and the Recruitment page list (now done). |
| **Expense Ledger** — per-bill drill detail; remove the temporary load-diagnostic counter once verified | open | Loader already pulls the `Ledger` line items. |
| Salary / **Pay Slip** | ⏸️ parked | Monthly Pay Slip from a **separate salary sheet** — needs sheet ID + column headers. |
| Vendor Ledger — include Tax/Additional in Outstanding; match POs by vendor name | open | small changes if desired |
| Tendering module | dev | "Coming" |

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **gviz** | Google Visualization API query endpoint used to read sheets as JSON |
| **EVG** | The portal's design system (`window.EVG`) |
| **MODULE_REGISTRY** | The master list of routes that drives nav + access |
| **Party** | A Vendor / Sub-Contractor / Employee / Others, keyed by Name + A/C |
| **PR** | Payment Request (a row in the `PaymentRequest` tab) |
| **GRN / StockIN** | Goods Received Note — received-material records |
| **PCC** | Project Cost Control sub-app |
| **DPR** | Daily Progress Report (Execution module) |
| **UUID** | Per-employee key in `0A_EmployeePersonalDetails`, used for HR docs |

---

_Maintained alongside the code. When you add a module, ship a feature, or change
the build process, update this document in the same PR._
