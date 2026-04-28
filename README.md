# EVGCPL Intranet Portal — Multi-page (v2.0)

This build is a **multi-page split** of the canonical `index__88_.html`
(byte-identical to v87). The UI/UX is **preserved exactly** — same CSS,
same render functions, same layout, same vector graphics. Only the
**routing layer** is changed: instead of one giant single-page file,
the bundle is loaded by 11 page templates that each request the right
route at boot.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Each *.html page                                            │
│     <link href="assets/css/portal.css">     ← v88 CSS verbatim│
│     <body data-page="dashboard">                             │
│       <!-- v88 main-app shell: topnav + sidebar + main -->   │
│     <script src="assets/js/portal-bundle.js">  ← v88 JS       │
│     <script src="assets/js/multi-page-bootstrap.js">          │
│                                                              │
│  Bootstrap reads body.dataset.page and calls renderPage(...)  │
└──────────────────────────────────────────────────────────────┘
```

- **`assets/css/portal.css`** — 1,003 lines, lifted verbatim from
  v88's `<style>` block. Zero modifications.
- **`assets/js/portal-bundle.js`** — 13,371 lines, lifted verbatim
  from v88's main `<script>` block. All 218 render functions, all
  Apps Script calls, all sheet IDs preserved.
- **`assets/js/multi-page-bootstrap.js`** — 188 lines, the ONLY new
  code. It maps every route to its owning HTML page, intercepts
  `navigate()` for cross-page redirects, and hands off to
  `renderPage()` on each page load.

## Pages

| File | data-page | Owns routes |
|---|---|---|
| `index.html` | `index` | Login + role selector + vendor modal |
| `dashboard.html` | `dashboard` | `dashboard`, `md-command`, `dev-mode` |
| `hr.html` | `hr` | `hr-dashboard`, `my-profile`, `personal`, `onboarding`, `rewards`, `wall`, `policies` |
| `scm.html` | `scm` | `scm`, `mrs`, `purchase`, `stores`, `vendor`, `subcontractor` |
| `site-ops.html` | `site-ops` | `site-manager`, `safety`, `equipment`, `store` |
| `accounts.html` | `accounts` | `accounts` |
| `reports.html` | `reports` | `reports` |
| `planning.html` | `planning` | `planning`, `tendering`, `budget`, `project-setup`, `boq-planning`, `execution`, `planning-overview`, `planning-setup` |
| `plant.html` | `plant` | `plant`, `plant-log`, `plant-verify`, `plant-maintenance`, `log-entry`, `asset-verification`, `asset-maintenance` |
| `apps.html` | `apps` | `apps` (v88 Apps hub) |
| `external.html` | `external` | `my-portal`, `my-orders`, `my-invoices`, `my-documents` (vendor/SC) |

## Admin Config Pages (NEW — added on top of v87/v88)

These are not in the v87/v88 baseline. They were built earlier to give
admins UI-level control over portal data sources:

| File | Purpose |
|---|---|
| `config.html` | 5 tabs: Sheet IDs · Sheets directory · Tab & Query bindings · App Links · Diagnostics |
| `sharing-doctor.html` | Server-side reachability check for every binding |
| `apps-script/SheetDiagnostic.gs` | Sharing Doctor backend |
| `apps-script/SafetyHandlers.gs` | `appendRow`, `updateCell`, `listHRDocs`, `listPolicyFiles`, `uploadPolicyFile`, `sendReportTest` reference |
| `apps-script/ScheduledReports.gs` | Time-driven trigger + setup helpers (run once after deploying) |

## What did NOT change

- The login screen 2-column layout with embedded base64 logo
- The animated floating green-glow circles
- The dark green `var(--g7)/var(--g8)/var(--g9)` palette
- The DM Serif Display + DM Sans typography
- The sidebar with all role-gated nav items
- The top nav with all dropdowns
- The header with user avatar and avatar menu
- The `#mainContent` rendering and all 218 `render*` functions
- Apps Script URL (already deployed and working)
- Google OAuth client ID
- All sheet IDs and tab names

## Deployment

```bash
cd ~/path/to/evgcpl-portal
find . -maxdepth 1 ! -name '.git' ! -name '.' -exec rm -rf {} +
unzip ~/Downloads/EVGCPL_Portal_v2.0.zip -d .
git add -A
git commit -m "Deploy EVGCPL Portal v2.0 — multi-page split of v88 baseline"
git push origin main
```

## Verification after deployment

1. Visit `index.html` — confirm the v88 login layout is intact
2. Sign in with Google or PIN — should redirect to `dashboard.html`
3. Click any sidebar item — URL should change to that page's HTML file
4. Within a section (e.g. site-ops.html), sidebar items in the same
   section change route via hash — no full page reload
5. Cross-section clicks trigger a full-page navigation
6. Visit `config.html` — admin Sheet IDs / bindings / app-links UI

If any page shows a blank `#mainContent`, it means the bootstrap couldn't
resolve the default route. Check browser console — should say what failed.
