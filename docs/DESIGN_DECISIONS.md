# EVGCPL Portal — Design Decisions Log

> A running log of the **architectural and design decisions** behind the portal,
> written as self-contained records (ADR style). Each entry is meant to be
> **liftable** — you can copy a decision, modify the "Decision" line, and reuse
> it as the basis for a future change or a new project.
>
> Format per record: **Context** (the forces/problem) · **Decision** (what we
> chose) · **Rationale** (why) · **Consequences** (trade-offs + what it costs) ·
> **Alternatives** (what we rejected) · **Status**.
>
> Baseline: **v4.11.0**. Add new records at the end; never renumber.

---

## DD-001 — Google Sheets as the system of record (no application database)
- **Context:** Operational data already lives in Google Sheets, maintained by ops/finance staff who need to keep editing it directly. A conventional DB would duplicate it and require sync.
- **Decision:** Sheets are the system of record. The portal **reads** live via the gviz JSON endpoint and **writes** via Google Apps Script web-app actions. No server, no DB.
- **Rationale:** Zero infra to run; non-developers keep ownership of data; instant reflection of manual edits; cheap.
- **Consequences:** Read latency + per-sheet quotas; no transactions/joins (done client-side); column-name discipline matters; data correctness depends on sheet hygiene. Heavy reporting is awkward.
- **Alternatives rejected:** Dedicated backend + Postgres (too much infra/ownership change); Sheets-as-cache-into-DB (sync complexity).
- **Status:** Adopted, foundational.

## DD-002 — Single vanilla-JS bundle, no framework
- **Context:** Small team, long-lived internal tool, must be trivially hostable and debuggable without a build toolchain.
- **Decision:** One hand-written bundle `assets/js/portal-bundle.js` (~24k lines), plain DOM + template strings. No React/Vue/build step for app code.
- **Rationale:** No framework churn; everything greppable in one file; deploys as static assets; any contributor can read it.
- **Consequences:** Large file; discipline needed to avoid duplication; manual DOM/state management. Refactors are textual.
- **Alternatives rejected:** SPA framework (build complexity, overkill); micro-frontends.
- **Status:** Adopted.

## DD-003 — Static multi-page shells + shared bundle
- **Context:** A pure SPA would reload the whole app for deep links and complicate GitHub Pages hosting.
- **Decision:** One HTML "shell" per nav section (`dashboard.html`, `hr.html`, `accounts.html`, …), all loading the same bundle. `multi-page-bootstrap.js` maps each route to its owning shell (`ROUTE_TO_PAGE`); `navigate()` renders in place for same-shell routes and redirects across shells.
- **Rationale:** Clean deep-linkable URLs; smaller initial DOM per section; static-host friendly.
- **Consequences:** Cross-section navigation is a full page load; **two navs to maintain** (see DD-009); every route must be mapped in `ROUTE_TO_PAGE`.
- **Status:** Adopted.

## DD-004 — `MODULE_REGISTRY` as the single route/access contract
- **Context:** Routes, nav visibility, and role access kept drifting out of sync, hiding working pages.
- **Decision:** `MODULE_REGISTRY` (`{route,label,section,defStatus,defRoles}`) is the spine. `applyPortalConfig()` rebuilds `ROLE_ROUTES` entirely from it each load; an unregistered navigable route is stripped and its nav hidden.
- **Rationale:** One authoritative source for "what exists and who sees it"; admin can override status/roles via PortalConfig.
- **Consequences:** **Every new top-level route must be registered** (registry + `pages` map + `ROUTE_TO_PAGE` + both navs) — the #1 footgun. A `_routeRegistryAudit()` warns; `window._RENDER_ROUTES` is a backstop.
- **Status:** Adopted; enforced by convention + audit.

## DD-005 — EVG design system + universal table engine
- **Context:** Each module re-styled its own tables/cards/forms, producing inconsistency and copy-paste.
- **Decision:** `window.EVG` holds one base definition per component (`table`, `card`, `form`, `dashboard`). `applyTableFeatures()` stamps the table engine (wrap, resize, column manager, density, search, sticky header, CSV) onto **every** rendered data table; `evgKpiCard()` / `.evg-form` / `.evg-dash-grid` standardise the rest.
- **Rationale:** Change a default once → every instance updates; new code consumes shared components instead of re-styling.
- **Consequences:** Global blast radius (a change touches all tables); needs an opt-out (`data-evg-defaults="off"`) for views that manage their own scroll/toolbar.
- **Status:** Adopted.

## DD-006 — Role-based access + Access Groups + configurable Super Admins
- **Context:** Different roles need different surfaces; the org also needs finer, configurable grants without code changes.
- **Decision:** Base roles drive default routes; **Access Groups** grant route+action sets configured in the "Access & Pages" tab; **Super Admins** are a permanent bootstrap list plus an org-configurable list. `access_config` is sheet-authoritative; `?access=off` is a lockout escape hatch.
- **Rationale:** Code stays generic; admins self-serve; owner can never be locked out.
- **Consequences:** Access resolves on every load; two layers (role + group) to reason about.
- **Status:** Adopted.

## DD-007 — Deterministic versioning, build-last, commit-first discipline
- **Context:** Squash-merges make `main` diverge after each PR; hand-merging version stamps caused build numbers to stagnate/go backwards, and an uncommitted feature was once silently destroyed by a merge/`checkout --ours`.
- **Decision:** `version.json` is authoritative; the **only** way to bump is `node build-portal.js --patch|--minor|--major` (stamps version, cache-busts HTML `?v=`, syncs top nav, `node --check`). Rule: **commit code first → merge latest `main` → build last**; on a `version.json` conflict take main's then rebuild.
- **Rationale:** Build number strictly increases; no lost work; reproducible.
- **Consequences:** A fixed release ritual every PR (see CLAUDE.md).
- **Status:** Adopted; load-bearing.

## DD-008 — Read sheets by header name; force `headers=1` for all-text tabs
- **Context:** Column order shifts as staff edit sheets; and gviz fails to auto-detect the header row when a tab has no numeric columns (amounts stored as text), returning letter-labelled columns and empty header-keyed access.
- **Decision:** Always read by header name. `fetchSheet` accepts `opts.headers`; pass `headers:1` for tabs whose numbers are text (e.g. the Expenses sheet) so row 1 is treated as the header.
- **Rationale:** Resilient to column moves; fixes the "rows load but every field is blank" failure.
- **Consequences:** Must know which tabs need `headers:1`; duplicate header names collide (last wins).
- **Status:** Adopted.

## DD-009 — Two hand-coded navs; level-3 sub-pages via `NAV_SUBMENUS`
- **Context:** Desktop top nav and mobile sidebar are separate, hand-coded structures. Some modules have many sub-views.
- **Decision:** The build syncs the **top nav** from `partials/topnav.html`; the **mobile sidebar** is per-file. Level-3 sub-pages are declared as `NAV_SUBMENUS` children of a parent route; `getRouteSet(role)` auto-grants a role access to all children of any parent it can see, so children need **no** registry/role-set entry.
- **Rationale:** Sub-pages render in both navs from one declaration; access "comes along" with the parent — minimal churn. Used for Stores, SCM, Ledgers, and Recruitment.
- **Consequences:** New top-level items still need both navs updated; submenu children aren't independently role-filtered (graceful fallback handles it).
- **Status:** Adopted.

## DD-010 — Consolidate Accounts into one Workspace; retire classic + KPI as redirects
- **Context:** Three overlapping Accounts UIs (classic list, v2 Workspace, standalone KPI) over one data layer — duplicated code and confusing nav.
- **Decision:** The v2 **Workspace** (Dashboard + Worklist tabs) is the single Accounts UI. Old routes (`accounts`, `accounts-kpi`, …) **redirect** to it so deep-links/role configs keep working; ~560 lines of dead classic/KPI render code removed.
- **Rationale:** One UI to maintain; no broken links; less code.
- **Consequences:** `accounts` route stays "live" as an alias (still backs the `#accounts` deep-link + dashboard buttons), so it's not fully deletable.
- **Status:** Adopted.

## DD-011 — Table scroll fits the viewport (single scrollbar)
- **Context:** A fixed 12-row scroll cap meant table + page chrome exceeded the viewport, so the page scrolled *too* — a second scrollbar nested around every table.
- **Decision:** Default `EVG.table.rows = 0` (fit mode); `_tblFitHeights()` measures each wrap's top and sets `max-height` to the viewport bottom (re-run on the table MutationObserver pass + debounced resize). A user-chosen rows-before-scroll keeps its fixed cap.
- **Rationale:** One scrollbar everywhere; the table is the scroller, the page isn't.
- **Consequences:** Pages with content *below* a table can still page-scroll (inherent, rare).
- **Status:** Adopted.

## DD-012 — Worklist: progressive rendering, not fixed-window virtualization
- **Context:** The Accounts Worklist can render ~2,900 variable-height, grouped/collapsible rows — painting them all blocked the main thread; typing in search rebuilt everything per keystroke.
- **Decision:** Opt the worklist out of the EVG engine (it owns its scroller/toolbar), **debounce** search, and **progressively render** — paint a first window, stream more (`requestAnimationFrame` top-up) as the user scrolls.
- **Rationale:** Variable row heights + grouping make classic constant-DOM windowing fragile to ship without a browser to verify; append-on-scroll is robust and removes the lag, and every row is reachable.
- **Consequences:** DOM grows as you scroll deep (rare), never in one blocking paint. Not constant-DOM virtualization (a possible future change if needed).
- **Status:** Adopted.

## DD-013 — Reusable Party Ledger engine
- **Context:** Vendor/Sub-Contractor/Employee statements all need the same running-balance presentation.
- **Decision:** One context-free engine (`partyLedgerRender(txRows, opts)`) fed from `PaymentRequest`, with a party keyed by Name + A/C. Reused across MD Payments, the Ledgers page, My Profile → Statement, Subcontractor/Vendor portals. The **Vendor Ledger (PO)** is a deliberately distinct model (Dr = received material, Cr = paid).
- **Rationale:** One implementation, consistent statements; `opts.onRowClick` lets each surface deep-link to its detail.
- **Status:** Adopted.

## DD-014 — Expense Ledger drill-down keyed by `CheckSum = CashExpenseMonth.UUID`
- **Context:** Cash expenses span four tabs (monthly ledger, requests, approvals, bills). The bills don't carry a clean request id; joining on `Request ID` linked nothing.
- **Decision:** The monthly ledger row's **UUID** (the `MCE-site|Cash For|period` composite) is the join key — the bills (`Ledger`) and cash requests (`Cash Expenses`) both carry it as their **CheckSum**. The tree: `CashExpenseMonth` (top) → its payment requests + bills, joined by CheckSum=UUID. Other/Mess split lives on the `Cash For` column.
- **Rationale:** It's the only key that actually links the tabs; it also carries the running balance and the Other/Mess split.
- **Consequences:** Bills attribute to the *month*, not an individual cash request (they share the monthly composite).
- **Status:** Adopted.

## DD-015 — Discover sheet schemas via the Drive/Sheets integration; wire real data, not placeholders
- **Context:** The build sandbox has no Google egress, so data-backed pages couldn't be designed against real columns; guessing layouts produced broken pages (see DD-008).
- **Decision:** Read the actual sheet via the Drive integration to discover tabs/columns/sample values, then wire the page to real data. Avoid shipping empty placeholder pages for data we can't see — request the sheet first.
- **Rationale:** Correct mappings the first time; honest scope (don't fake "done").
- **Consequences:** New data modules are gated on getting the sheet; an explicit placeholder (e.g. My Tasks) is used only when intentionally deferred.
- **Status:** Adopted.

## DD-016 — Optimistic writes with parked-transaction reconciliation
- **Context:** Apps Script POSTs have latency; users expect immediate feedback (e.g. advancing a payment stage).
- **Decision:** Reflect the change in the UI immediately (`_txnPark*`), then POST in the background and reconcile (drop the parked row on failure, with a toast).
- **Rationale:** Snappy UX over a slow write path.
- **Consequences:** Brief divergence between UI and sheet; must handle the failure/rollback path.
- **Status:** Adopted.

## DD-017 — Hard Refresh to defeat stale CDN-cached HTML
- **Context:** GitHub Pages / CDN can keep serving an old HTML shell pointing at an old bundle even after a deploy.
- **Decision:** A runtime-injected **Hard Refresh** button purges cache storage / service workers and re-requests the document with a one-shot cache-busting param. The bootstrap also self-heals by comparing the running build to a fresh `version.json`.
- **Rationale:** Users can always force themselves onto the latest build.
- **Status:** Adopted.

---

## How to reuse a decision
1. Copy the record.
2. Keep **Context** if the forces still apply; otherwise rewrite it for the new situation.
3. Change the **Decision** line to the new choice and update **Consequences**/**Alternatives**.
4. Give it a new `DD-NNN` and set **Status** (Proposed → Adopted/Superseded). If it replaces an old one, mark the old record `Superseded by DD-NNN`.
