# EVGCPL Recruitment Module — Project Handoff

**Branch:** `claude/access-check-2mIk5` (merged to `main` continuously)
**Latest build:** v3.18.18 / build 391
**Scope:** End-to-end recruiter → MD → candidate → HR pipeline inside the EVGCPL portal, mirroring the parallel AppSheet "child" setup.

---

## 1. Workflow at a glance

```
┌──────────────┐     ┌─────────────────┐     ┌─────────────┐     ┌──────────────┐
│  Recruiter   │ →   │  MD approval    │ →   │  Candidate  │ →   │  HR onboard  │
│  drafts      │     │  Approve/Reject │     │  Accept     │     │  EmpCode etc │
└──────────────┘     └─────────────────┘     └─────────────┘     └──────────────┘
   Draft               Pending Approval         Released                Joined
   → Send                                       → Email                 → Trigger
   for Approval                                 → Mark Accepted         HR Onboarding
```

1. **Recruiter (hr role)** drafts an offer (new dynamic salary model).
2. **Send for MD Approval** → status `Pending Approval`.
3. **MD (md role)** opens Recruitment → tracker auto-filters to Pending Approval → **Approve** (or Reject) → status `Released`, `Accept By` set from Offer Valid Until.
4. Recruiter **emails** the offer letter from the tracker (PDF rendered server-side from the template).
5. Candidate accepts → recruiter **marks Accepted** → status `Accepted`, linked MRF auto-closes.
6. A joining entry is created (existing `createJoiningEntry`). On the day of joining, recruiter opens the row's Appt Letter panel and clicks **🤝 Issue Letter & Trigger HR Onboarding** → joining row gets `Onboarding Status = Pending HR`.
7. **HR** runs the **Pre-Joining checklist** (accommodation/site/mess), **assigns EmpCode**, then **Marks Joined** → record enters the main employee system.

---

## 2. Salary model (offer letter)

- **Agreed Monthly Salary** — headline figure the recruiter enters.
- **9 designed components**, each defined as a **% of Agreed Salary**, summing to 100%:

  | Category | Component | Default % |
  |---|---|---|
  | Basic | Basic | 50 |
  | HRA | HRA | 10 |
  | Other Allowance | Dearness Allowance | 15 |
  | Other Allowance | Special Allowance | 15 |
  | Other Allowance | Conveyance Allowance | 4 |
  | Other Allowance | Education Allowance | 1 |
  | Other Allowance | Uniform / Washing | 1 |
  | Other Allowance | LTA | 2 |
  | Other Allowance | Site Allowance | 2 |

- **➕ Add Element** — recruiter adds **flat-amount** rows with a free-text name; locked to **Other Allowance**.
- Per-row dropdowns: **Basis** (`% / Flat ₹`) and **Group** (`Basic / HRA / Other Allowance`).
- Live recalc → **Calculated Salary**, **Basic / HRA / Other** totals, **+ Medical + Employer PF = CTC**.
- Components are persisted as a **Salary JSON** blob + the rollups; saved offers re-render exactly via `_rcOfferTokenMap`.

---

## 3. Status lifecycles

**Offer:** `Draft → Pending Approval → Released → Accepted | Declined | Expired`
- `Expired` is **derived** in the UI when status is Released and `Accept By` is past.
- Email is enabled only for Released (and Accepted) offers.

**Joining row** (existing): `Pending → Pre-Joining → Joined → Active`
- Parallel **Onboarding Status**: empty → `Pending HR` (set by the Phase 3 trigger).

---

## 4. Role gating

- **md** — tracker defaults to **Pending Approval** queue; gets ✓ Approve / ✗ Reject buttons.
- **hr** — drafts, saves, sends for approval, emails (post-approval), marks accepted/declined, triggers HR onboarding.
- **dept_head (HR dept)** — gets recruitment via `DEPT_HEAD_ROUTES`.
- **site** — gets recruitment for raising MRFs.

UI lives in `ROLE_ROUTES` / `DEPT_HEAD_ROUTES` (portal-bundle.js ~1385) and `MODULE_REGISTRY` (~4748). A one-time config self-heal forces Recruitment to its registry default for these roles even if a stale local Portal Config was hiding it.

---

## 5. Where the code lives

- **Frontend (bundle):** `assets/js/portal-bundle.js`
  - Offer form: `_rcDrawOLFormInner`
  - Salary master: `_RC_SAL_COMPONENTS`
  - Recalc engine: `_rcOLRecalc`, `_rcOLRenderSalTable`, `_rcOLAgreedChange`, `_rcOLSalVal/Group/Basis/Add/Del/Name`
  - Letter rendering: `_rcOfferTokenMap`, `_rcOLPreviewHTML`, `_rcALGeneratePDF`, `_rcPrintDoc`
  - Persistence: `_rcOLBuildOfferRecord`, `_rcOLApplyLocal`, `_rcLoadOffers`, `_rcResyncOffers`
  - Awaited POST: `_rcPostActionAwait` (returns real backend `{success, message}`)
  - Lifecycle: `_rcOLSaveOffer`, `_rcOLSendForApproval[ById]`, `_rcOLApprove`, `_rcOLReject`, `_rcOLMarkAccepted/Declined`, `_rcOLEmailFromTracker`
  - Tracker: `_rcDrawOLTracker` (chip-row filter, role-gated actions)
  - Joining: `_rcDrawJoiningTab`, `_rcJLApptLetter`, `_rcJLTriggerOnboarding`, `_rcJLToggleOnbFilter`
- **Letter templates:** `assets/templates/offer-letter.html`, `assets/templates/appointment-letter.html`
  Full HTML documents (EB Garamond/Montserrat, embedded base64 logo, A4 print CSS, fixed footer) with `{{token}}` placeholders. Empty values fall back to a `.ph` styled span (gray italic, dotted underline).
- **Backend (Apps Script):** `apps-script/RecruitmentHandlers.gs`
  - Schemas: `RC_OFFER_HEADERS`, `RC_JOINING_HEADERS`
  - Header-aware `saveOffer` (auto-creates new columns)
  - `updateOfferStatus(payload)` — accepts `fields: {colName:value}` map; writes any column by header
  - `updateApptLetter(payload)` — accepts `triggerOnboarding:true`; writes onboarding columns
  - Plus: `createJoiningEntry`, `assignEmpCode`, `markAsJoined`, `sendOfferEmail` (server-side HTML→PDF), `getMRFs`, `getJoiningList`, `getJoiningListSchema`, etc.
- **Router:** `apps-script/Router.gs` — every action routed to a handler.

---

## 6. Backend schema

**`Offer_Tracker` columns** (header-aware `saveOffer` auto-creates anything new):
- Core: OL ID, MRF ID, Candidate Name, Position, Site, CTC (Annual), Joining Date, Probation Period, Offer Valid Until, Candidate Email, Dispatch Method, Status, Sent Date, Acceptance Date, Remarks, Created By, Created At.
- Letter fields: Ref No, Offer Date, Grade, Department, Address Line 1-4, Start Time, End Time, Notice Period, Reporting Manager, Basic, HRA, DA, Special Allowance, Conveyance, Education Allowance, Uniform Allowance, LTA, Site Allowance, Medical, PF Employer, CTC (Monthly).
- Salary model: **Agreed Salary, Calculated Salary, Basic Total, HRA Total, Other Total, Salary JSON**.
- Lifecycle: **Submitted For Approval At, Submitted By, Approved By, Approved At, Accept By, Accepted At, Decline Reason**.

**`v1_JoiningList` columns:**
- Core: Joining Code, Path, MRF ID, OL ID, Candidate Name, Position, Department, Site, Reporting Manager, Expected DOJ, Actual DOJ, Status, EmpCode, Appointment Letter Ref, Appointment Letter Date, Signed Copy Received, Remarks, Created By, Created At, Updated At.
- Onboarding: **Onboarding Triggered At, Onboarding Triggered By, Onboarding Status**.

---

## 7. Apps Script deployment (the one operational requirement)

The portal posts all recruitment writes to `getExec('main')`:
`https://script.google.com/macros/s/AKfycbxajuscM46AlJe2iMtDg0nJjfuzidEZwnOy_o2TZXQIbh_e2hGu79CNxAzvUu11tPJP/exec`

For any of the new actions to land in the sheet, the Apps Script project containing `Router.gs` + `RecruitmentHandlers.gs` **must be deployed as the latest version at that URL**.

Diagnostics if a save isn't working:
- Save/Email now `await` the backend response; the popup shows the real error (`unknown action`, server exception, etc.). Silent failures are gone.
- Sheet IDs must match (frontend `RECRUITMENT_SHEET_ID` ≡ backend `RECRUITMENT_SHEET_ID` — both `1Dw48OEDmIAAu9Va1-a9z7PZT7wKS_mWU7cwpK6osRNI`).
- Header-aware writes auto-add any missing columns to row 1 of `Offer_Tracker` and `v1_JoiningList` — no manual sheet edits required.

---

## 8. Build history (this session)

| # | Title | Notes |
|---|---|---|
| 380 | Remove Demo Mode + externalize letter PDF templates | + iframe preview + appointment-letter generator |
| 381 | Offer email dispatch (server-side HTML→PDF) | `sendOfferEmail` accepts `html` |
| 382 | Recruitment visible in nav by default + Live badge | One-time portal-config self-heal |
| 383 | PCC Apps Script exec URL updated |  |
| 384 | Letter templates swapped to new A4 designs | Full HTML docs; expanded saved offer fields |
| 385 | Offer module live preview, Save + view sent letters, sheet sync | Iframe preview; tracker View action |
| 386 | Surface real offer-save result (diagnose silent failures) | `_rcPostActionAwait` |
| 387 | **Phase 1** — dynamic salary model | Basic / Other (initial) + flat extras |
| 388 | Salary master locked: **Basic 50 / HRA 10 / Other 40** | 3 categories, 9 components |
| 389 | **Phase 2** — lifecycle: Draft → Pending → Released → Accepted/Declined | Role-gated tracker actions |
| 390 | **Phase 3** — HR onboarding handoff | "Issue Letter & Trigger HR Onboarding" |
| 391 | Filters + onboarding badges | MD chip row; joining 🤝 HR badge |

---

## 9. Known limitations / future enhancements

- **Apps Script redeploy** is the only blocker on the operational side; everything else is on `main`.
- Google Fonts `@import` may not load during Apps Script's HTML→PDF; emailed PDF falls back to serif. Preview + browser-Print are pixel-accurate.
- Component master is a code constant — adding a new component requires a rebuild. Future: move to a master sheet.
- No public candidate-accept link; HR/recruiter currently marks acceptance.
- Onboarding status is a single flag. Future: extend to a sub-state machine (Pending HR → In Progress → Complete) tied to checklist completion.

---

## 10. Verification checklist (post-redeploy)

1. New Offer → fill Agreed Salary + designation + address → preview fills live; Ref No auto-set.
2. **Save as Draft** → success toast, appears in tracker as Draft.
3. **Send for MD Approval** → status `Pending Approval`.
4. MD user → tracker auto-filters to Pending Approval → **Approve** → status `Released`, `Accept By` populated.
5. Tracker → **📧 Email** → PDF arrives in candidate inbox.
6. **✓ Accepted** → status `Accepted`; linked MRF auto-closes.
7. Joining tab → row exists → **Appt Letter** → **🖨 Generate Letter** → **🤝 Issue Letter & Trigger HR Onboarding** → row shows 🤝 HR badge; joining sheet captures Onboarding Triggered At/By/Status.
8. Pre-Joining checklist → tick items → **Assign EmpCode** → **Mark Joined**.

---

## 11. Continuity notes

- Every change since build 380 sits on `claude/access-check-2mIk5` and has been merged to `main` via a PR per build.
- For the **header-aware backend pattern** to keep working: new fields/columns should be **appended** to `RC_OFFER_HEADERS` / `RC_JOINING_HEADERS` and never reordered. `saveOffer` / `updateOfferStatus` / `updateApptLetter` will auto-extend the live sheet's header row.
- For schema changes to the offer object, update three places in lockstep:
  1. `_rcOLBuildOfferRecord` (write side)
  2. `_rcLoadOffers` (read side)
  3. `RC_OFFER_HEADERS` + the relevant handler's value map (backend persist)

---

## Backlog

### Migrate Recruitment off Google Sheets → Supabase Postgres (~4 weeks)

**Status:** Parked. Plan finalized 2026-06-08, awaiting kick-off.

**Why:** Performance, real reporting/scale, RBAC + audit, clean API for future mobile work. Recruitment is the best first target — most self-contained module, dedicated sheet (`1Dw48OEDmI...`), 14 well-scoped Apps Script actions, workflow freshly built.

**Decisions baked in:**
- Target: **Supabase** (managed Postgres + REST + Edge Functions + Storage + Auth).
- Cutover: **hard cutover + 1-week parallel-read safety net**.
- Email + PDF: **Resend** (transactional email) + **Supabase Edge Function with puppeteer** (PDF). Fully off Apps Script.
- Sequencing: Recruitment first → Accounts (~2 wks, infra reused) → re-evaluate the rest (HR, PCC, Safety, Stores, Reports).

**Architecture (Recruitment only — everything else stays on Sheets):**
```
Frontend ──► assets/js/recruitmentDb.js ──► Supabase REST + Edge Functions
                                              │
                                              ▼
                                       Postgres + Storage
                                       (mrf · offer · joining · pre_joining
                                        + 4 read-only master mirrors)

Master mirrors fed by sync/mirror.js cron (15-min) reading
designation, site, billing, employee from Sheets via gviz.

Email out via Resend; PDFs via Edge Function w/ puppeteer.
```

**Phase 1 stages:**
- **A — Foundation (~3 d):** Supabase project (Mumbai region), Google OAuth, Resend domain verification, GitHub secrets, auth bridge in `multi-page-bootstrap.js`.
- **B — Schema (~2 d):** Tables for `mrf`, `offer`, `joining`, `pre_joining_checklist` (mirror current `RC_OFFER_HEADERS` / `RC_JOINING_HEADERS`). RLS policies derived from `ROLE_ROUTES` (portal-bundle.js:1386). Read-only master mirror tables.
- **C — Backend (1 wk):** PostgREST auto-covers 12 of the 14 actions. Two Edge Functions:
  - `sendOfferEmail` — Deno port of `_fillTemplate`, calls `generatePDF`, posts to Resend.
  - `generatePDF` — puppeteer-core + chromium-aws-lambda; used by email + Download PDF.
  - `sync/mirror.js` + `sync/schema.json` + `.github/workflows/mirror.yml` cron job for master tables.
- **D — Data migration (~2 d):** `migrate/recruitment-oneshot.js` copies all rows from MRF_Register / Offer_Tracker / PreJoining_Checklist / v1_JoiningList into Postgres. Drop Sheet's editor share → archive.
- **E — Frontend swap (~1 wk):** `assets/js/recruitmentDb.js` mirrors `_rc*` signatures. Behind `localStorage.evg_use_db_recruitment === '1'`. Roll out: you (day 1) → second recruiter (day 2–3) → all (day 4+). Parallel-read week: drift logged to `sync_drift`.
- **F — Decommission (~3 d):** After 7 clean days, delete the 14 Recruitment routes from `Router.gs`. Archive `RecruitmentHandlers.gs` (don't delete file). Drop the feature flag.

**Phase 2 — Accounts (~2 wks):** same recipe, skips Stage A. Tables for `payment_request`, oneshot from Payment sheet (`1mLddxLRf...`), `assets/js/accountsDb.js` behind `USE_DB_ACCOUNTS`.

**Phase 3+:** deferred. Decide based on real numbers from Phase 1+2.

**New files (Phase 1):**
- `supabase/migrations/0001_recruitment_schema.sql`
- `supabase/migrations/0002_master_mirrors.sql`
- `supabase/migrations/0003_rls_recruitment.sql`
- `supabase/functions/sendOfferEmail/index.ts`
- `supabase/functions/generatePDF/index.ts`
- `sync/mirror.js`, `sync/schema.json`, `sync/lib/gviz.js`
- `.github/workflows/mirror.yml`
- `migrate/recruitment-oneshot.js`
- `assets/js/recruitmentDb.js`

**Modify (Phase 1):**
- `assets/js/multi-page-bootstrap.js` — Supabase auth bridge on boot.
- `assets/js/portal-bundle.js` — route the 16 `_rc*` functions through `recruitmentDb.js` when flag is on.
- `apps-script/Router.gs` (Stage F) — delete the 14 Recruitment action routes.
- `apps-script/RecruitmentHandlers.gs` (Stage F) — archive, don't delete.

**Reuse:**
- `parseGvizDate` (portal-bundle.js:11713) → `sync/lib/gviz.js`.
- HTML templates `assets/templates/offer-letter.html`, `appointment-letter.html` — unchanged; Edge Function consumes them.
- `_fillTemplate` (portal-bundle.js:~15098) → Deno port in the Edge Function.
- `ROLE_ROUTES` (portal-bundle.js:1386) → translated to RLS policies.

**Cost:** $0–25/mo through Phase 1+2 (Supabase free tier covers 500MB DB / 1GB Storage / 50K MAU; Resend free is 3K mails/mo; GitHub Actions free).

**Risk + rollback:**
- Week 3 issues → flip `USE_DB_RECRUITMENT` off, instantly back on Apps Script + Sheets.
- Post Stage F rollback = git revert + redeploy (~30 min).
- Lock-in: low — Supabase is Postgres + PostgREST; schema is portable to any Postgres host.

**Open decisions before kick-off:**
- Region: Mumbai (ap-south-1) vs Singapore (ap-southeast-1).
- Resend sender domain: `noreply@evgcpl.com`? Needs DNS access for DKIM/SPF.
- Canary user for Day 2 of Stage E.

**Verification checklist:** see full plan at `/root/.claude/plans/root-claude-uploads-2be5b1f0-e0f4-4848-sunny-crane.md` (this session's plan file).
