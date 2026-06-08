# ACCOUNTS MODULE — Payment Request Form Build · Handoff for Claude Chat

> **Read this top-to-bottom; do not assume prior context.** This document gets you (a fresh Claude in Claude Chat) up to speed cold so you can plan and design the build with the user. Code changes happen back in Claude Code on the repo — your job in Claude Chat is **spec'ing the form** alongside the user.

---

## What's being built

**Convert the existing AppSheet for Accounts → a fully functional Payment Request module inside the EVGCPL Portal**, starting with the **New Payment Request form**.

The AppSheet today: <https://www.appsheet.com/start/fcdba849-9f9d-435f-8e8a-ea0c975dbd21>

Goal: portal-native form (matching AppSheet UX), writes to the same `PaymentRequest` sheet via Apps Script. Once the form works, the rest of the AppSheet workflow (approvals, Mark Paid, UTR entry) follows in the same sprint.

---

## Decisions already made (don't relitigate)

| Decision | Choice |
|---|---|
| Scope of first sprint | Full conversion (New PR + Approval screen + Accounts processing/UTR + status changes) — ship together |
| Approval workflow | **Match the AppSheet exactly** — user is providing screenshots + field spec |
| Attachments | **Multi-attachment folder per PR** (one Drive folder per Request ID; initiator uploads invoice, supporting docs, etc.) |
| Backend | **Stay on Apps Script + Google Sheets** for now. Postgres migration is parked (see `RECRUITMENT_HANDOFF.md` § Backlog). |
| Cutover style | Hard cutover after parallel test, no dual-write |
| First deliverable | **Payment Request form only** — then approval screen, then Accounts/UTR entry |

---

## Stack & repo

- **Frontend**: GitHub Pages static site. Multi-page (one HTML per major area). Shared bundle: `assets/js/portal-bundle.js` (~16K lines). Shared CSS: `assets/css/portal.css`.
- **Backend**: Google Apps Script (`/exec` URL) with handler files in `apps-script/`. Router at `apps-script/Router.gs` dispatches to `*Handlers.gs` files via a `case 'action':` switch.
- **Data**: Google Sheets. PaymentRequest tab lives in sheet ID `1mLddxLRf719EaXE9XSET9gT8l0a8Cxns362yIbHo63g`.
- **Build**: `node build-portal.js --patch` bumps version + build number; commit; merge PR to `main`; GitHub Pages auto-deploys.
- **Branch convention**: development on `claude/access-check-2mIk5`, merge PR to `main` after every build. Apps Script must be **manually redeployed** by the user — that's not automatable.
- **Current build at handoff time**: v3.18.28 build 401.

---

## What already exists (don't rebuild)

### Accounts page (read side)
- **Page**: `accounts.html` (shell only)
- **Route**: `'accounts': renderAccountsModule` in `portal-bundle.js:1578`
- **Renderer**: `renderAccountsModule()` at `portal-bundle.js:4253–4724` — already fetches the live `PaymentRequest` tab, displays a filterable table, exports CSV. This **stays**; the New PR form gets added to it.
- **Read query** (line 4434–4435):
  ```
  fetchSheet('PaymentRequest',
    'SELECT A,C,D,E,F,G,H,J,K,L,M,N,O,P,Q,R,T,U,V,W,Z,AA,AB,AG,AH,AI,AJ,AK,AL,AM',
    PAYMENT_SHEET_ID)
  ```
- **Status mapping** lives in `getPayStatus()` near line 4448.

### Role gating for Accounts route
Already configured in `portal-bundle.js:1391–1410` (ROLE_ROUTES):
- `md`, `accounts`, `dept_head`, `finance`, `scm/procurement/purchase` roles → `accounts` route allowed.
- `site`, `employee`, `vendor`, `sc` → blocked.
- Use `STATE.role` to gate UI controls (only `accounts` + `md` should see "Mark Paid"; `dept_head` + `md` should see "Approve").

### Master-data sources already mirrored on the frontend
The form likely needs these — they're already cached in `STATE.masters`:

| Master | STATE key | Source | Notes |
|---|---|---|---|
| Sites | `STATE.masters.sites` | `5-SiteMaster` in Master sheet | `name`, `status` |
| Billing companies | `STATE.masters.billing` | `1-BillingMaster` in Master sheet | `name` (deduplicate for dropdown) |
| Employee register | `STATE.masters.users` | `0_EmployeeRegister_Live` in Employee sheet | `name`, `empCode`, `email`, `dept`, `desig` |
| Cost codes | already in PCC config | `CostCode` tab | per-project |
| Vendors | (in PO sheet) | `PO_Actual` | vendor names live as PO column |

The recruitment module recently added dedicated loaders for some of these — see `_rcLoadDesigMaster`, `_rcLoadBillingMaster`, `_rcLoadEmpRefMaster` in `portal-bundle.js` (search for them). Same pattern applies for the Accounts form's dropdowns.

### Apps Script primitives already wired
- `appendRow` — generic write to any sheet/tab. Header-aware. Used everywhere. **First-choice path for `saveNewPaymentRequest` is just `appendRow` with the right column map.**
- `updateCell`, `batchUpdate` — for status updates and approval actions.
- File upload pattern from Recruitment: `RecruitmentHandlers.gs:sendOfferEmail` shows the HTML→PDF via `Utilities.newBlob()` route. For multi-attachment, look at how `uploadProfilePhoto` (portal-bundle.js:7863) handles base64 → Apps Script `savePhoto` → Drive.

### Drive folder pattern
- Photos: `evg_photo_${empCode}` localStorage + `savePhoto` Apps Script → Drive.
- For PR attachments, we'll need a new Apps Script action `createPRFolder(requestId)` + `uploadPRAttachment(requestId, base64, filename, mime)`.

---

## Data model — PaymentRequest sheet

**Sheet ID**: `1mLddxLRf719EaXE9XSET9gT8l0a8Cxns362yIbHo63g`
**Tab**: `PaymentRequest`

| Col | Header | Frontend field | Type | Notes |
|---|---|---|---|---|
| A | UUID | `uuid` | text | System-generated on submit |
| C | Manual/Auto | `manualAuto` | dropdown | Likely `Manual` / `Auto` — confirm with user |
| D | Installment | `installment` | text/number | |
| E | Request ID | `requestId` | text | System-generated, format TBD with user (e.g., `PR-YYMM-####`) |
| F | Date Of Request | `date` | date | Default = today |
| G | Name of Initiator | `initiator` | text | Default = `STATE.user.name` |
| H | Nature of Expenses | `nature` | dropdown | Source TBD with user |
| I | Account Code Descriptions | `accCode` | dropdown | Source TBD with user |
| J | Payment To | `payTo` | dropdown | Vendor / Employee / Other — confirm |
| K | CostCode | `costCode` | dropdown | From PCC CostCode tab |
| L | Department | `dept` | dropdown | From Employee Register |
| M | From Which Process | `process` | dropdown | Source TBD |
| N | Paid To | `paidTo` | text | Specific person/vendor name |
| O | Site Name | `site` | dropdown | From Site Master |
| P | Company | `company` | dropdown | From Billing Master (dedup) |
| Q | Order No | `orderNo` | text/dropdown | If PO-based, ref to PO sheet |
| R | Bill No | `billNo` | text | |
| T | PO Value | `poValue` | currency | |
| U | Invoice Value | `invoiceVal` | currency | |
| V | Paid Value | `paidVal` | currency | Updated by Accounts |
| W | Pending Value | `pendingVal` | currency | Computed: invoiceVal − paidVal |
| Z | Currency | `currency` | dropdown | INR / USD / EUR / etc. |
| AA | Amount | `amount` | currency | This-installment amount |
| AB | Narrative/Comments | `narrative` | textarea | |
| AC | A/C Holder Name | `acHolder` | text | |
| AD | A/C Number | `acNumber` | text | |
| AE | IFSC Code | `ifsc` | text | Regex: `^[A-Z]{4}0[A-Z0-9]{6}$` |
| AF | Bank Name | `bank` | text | |
| AG | Accounts Status | `accStatus` | dropdown | System — set by Accounts |
| AH | Accounts Date | `accDate` | date | Set on Mark Paid |
| AI | UTR Details | `utr` | text | Set on Mark Paid |
| AJ | Remarks | `remarks` | textarea | |
| AN | Month-Year | `monthYear` | computed | From `date` |
| AK | Status | `rawStatus` | dropdown | Workflow state |

**~30 columns** — most map 1:1 to form fields. The user said they'll provide **Valid If rules, dropdowns, and defaults for every field**.

---

## What you (Claude Chat) should do next

1. **Acknowledge this handoff** and ask the user to share:
   - The AppSheet YAML / app-definition export (small, structured) **OR** screenshots of:
     - New PR form (field order, sections, labels)
     - Each dropdown's source list
     - Any Valid If / Show If rules visible in the column editor
     - The Detail view (so you know which fields are computed/read-only)
   - The bot/automation list (if any)

2. **Build the form spec** with the user — fill in this table for every field:

   ```
   | # | Label | Sheet Column | Type | Required (Valid If) | Default | Dropdown Source | Show If | Read-only | Section |
   ```

   Type vocabulary: `text` · `number` · `currency` · `date` · `dropdown` · `dependent-dropdown` · `ref-to-sheet` · `textarea` · `attachment`.

3. **Group fields into sections** for the form's panels — typical structure for a payment request:
   - **Initiator** (auto-filled from `STATE.user`)
   - **Vendor / Paid To** (Paid To, Bank details, IFSC)
   - **Bill & PO Reference** (Order No, Bill No, PO Value, Invoice Value, Pending Value)
   - **Payment** (Amount, Currency, Installment, Account Code, CostCode, Nature, Process)
   - **Site & Company** (Site, Company, Department)
   - **Narrative & Attachments** (Narrative, Remarks, file upload)

4. **Confirm 4 system-controlled values** with the user so the build doesn't ask them again:
   - **Request ID format** — `PR-{YYMM}-{####}` auto-increment? Or AppSheet-style `PR-{UUID-short}`?
   - **UUID** — generated client-side (e.g., `crypto.randomUUID()`) or by Apps Script on save?
   - **After submit** — back to PR list, or open the new PR's detail view?
   - **Attachments folder ID** — does the user have a Drive folder ID already, or should Apps Script create a "PaymentRequests" parent folder and bucket per-PR subfolders inside it?

5. **Output for Claude Code** — once the spec is complete, write a single Markdown handoff that has:
   - The full field table
   - Section grouping
   - Request ID format + UUID source
   - Drive parent folder ID
   - "After submit" navigation
   - Any non-obvious validation rules (regex, cross-field, threshold-based)

   Paste that back in Claude Code, and the build can happen in one focused pass.

---

## Pre-existing patterns to mirror (not to reinvent)

When the user starts the actual build in Claude Code, the cleanest templates to copy from already exist in this codebase:

| Pattern | Reference |
|---|---|
| Form with sections, live preview, save handler | Recruitment offer form: `_rcDrawOLFormInner`, `_rcOLPreviewSoon`, `_rcOLSaveOffer` in `portal-bundle.js` |
| Dropdown loader from a master sheet | `_rcLoadEmpRefMaster` (search for it) |
| Dependent dropdown (designation → grade) | `_rcLoadDesigMaster` + the form binding code right below it |
| Awaited POST with backend error surfacing | `_rcPostActionAwait` |
| Header-aware sheet write | `saveOffer` in `apps-script/RecruitmentHandlers.gs` (auto-extends columns) |
| Status lifecycle with role-gated actions | `_rcOLSendForApproval`, `_rcOLApprove`, `_rcOLReject`, `_rcOLMarkAccepted` |
| File upload to Drive | `uploadProfilePhoto` (`portal-bundle.js:7863`) + `savePhoto` action |
| Form draft persistence | The Recruitment offer draft pattern (look for `_rcOLDraft` mutations) |

The Payment Request form should reuse `class="rc-inp"` styling for input fields and the existing form-section CSS so it visually matches Recruitment.

---

## Build / deploy rules (so Claude Code knows the rhythm)

1. After every code change: `node --check assets/js/portal-bundle.js` → `node build-portal.js --patch`.
2. Commit message style: imperative subject, brief body, no "AI" / "agent" / "session" mentions in the commit text.
3. Open a PR from `claude/access-check-2mIk5` → `main`. Squash-merge.
4. Tell the user when **Apps Script needs to be redeployed** (any change in `apps-script/*.gs`). The user does this manually in the Apps Script editor (Deploy → Manage deployments → New version).
5. Never delete an Apps Script handler in the same PR as the new one going live — keep the old one until the parallel-read week proves out.

---

## What's intentionally out of scope here

- Approval screen, Mark Paid screen, UTR entry — they come **after** the form lands. Same sprint but separate builds.
- Migrating PaymentRequest off Sheets → Postgres. Parked. See `RECRUITMENT_HANDOFF.md` § Backlog.
- Touching HR_v0, PCC, SCM, Stores, Safety AppSheets. Separate decisions.
- Vendor master cleanup. The current vendor list is embedded in the PO sheet. We'll work with what's there.

---

## Files Claude Chat should reference if asked

- `assets/js/portal-bundle.js:4253` — current `renderAccountsModule`
- `assets/js/portal-bundle.js:1578` — accounts route
- `assets/js/portal-bundle.js:2692` — APPSHEET_APPS.accounts (AppSheet launcher URL)
- `apps-script/Router.gs` — central doPost/doGet switch
- `apps-script/RecruitmentHandlers.gs` — closest existing analog to what we'll build for Accounts
- `RECRUITMENT_HANDOFF.md` — sibling handoff doc (same shape), useful as a worked example

---

**End of handoff.** Paste this whole doc into the start of your Claude Chat session, then share the AppSheet spec / screenshots, and walk the field table with the user.
