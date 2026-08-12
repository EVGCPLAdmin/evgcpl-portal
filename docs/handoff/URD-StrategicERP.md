# EVGCPL Portal → StrategicERP

## Handoff & User Requirements Document (URD) with Acceptance Criteria

**Version:** 1.0 · **Date:** 2026-08-12 · **Prepared for:** StrategicERP migration
**Source system:** EVGCPL Portal (static web app + Google Sheets + Google Apps Script)
**Status:** Handoff baseline — requirements describe capability the new ERP must meet or exceed.

---

## How to read this document

- **Part A — Handoff Overview**: what the current system is, how it's built, where the data and integrations live, and migration considerations. For the ERP implementation team and data-migration team.
- **Part B — User Requirements, per module**: for each functional module — purpose, roles, **Functional Requirements (FR)** and testable **Acceptance Criteria (AC)**. This is the contractual "what StrategicERP must do."
- **Part C — Non-functional requirements & data migration**: security, audit, performance, and the sheet-by-sheet migration map.

**Requirement keywords:** *shall* = mandatory; *should* = recommended; *may* = optional.
**AC format:** each acceptance criterion is independently testable — **Given** a precondition, **When** an action, **Then** an observable result.

---

# PART A — HANDOFF OVERVIEW

## A1. Current system at a glance

The EVGCPL Portal is an operations portal for a construction / infrastructure contractor operating across multiple project sites (India, Tanzania, Ivory Coast). It is delivered as a **static single-page web application** hosted on GitHub Pages, reading and writing **Google Sheets** as its database via **Google Apps Script** web-app endpoints. There is no traditional application server or relational database.

| Aspect | Current implementation | Migration implication |
|--------|------------------------|-----------------------|
| Front end | Static HTML + one JS bundle (`portal-bundle.js`) | Re-implemented as ERP UI |
| Data store | ~16 Google Spreadsheets, ~60+ tabs | Migrate to ERP relational schema |
| Backend | 5 Apps Script deployments (`main`, `portalConfig`, `accounts`, `pcc`, `safety`) | Replace with ERP business logic / APIs |
| Auth | PIN-based login (Google login disabled) | Replace with ERP identity/SSO |
| Access control | Access Groups (route + action grants), org-wide config | Map to ERP roles & permissions |
| Config | `PortalConfig` sheet key/value | Map to ERP configuration |
| Files | Google Drive folders (HR docs, policies, payment attachments) | Migrate to ERP document store |

## A2. Functional footprint (11 sections, ~62 routes)

Main · HR & People · Site Ops · Procurement · Accounts · Planning · Plant & Machinery · Reports & Data Hub · Quick Access · Personal · Admin/Configuration.
Plus externally: **Attendance / Leave / On-Duty** run today in a separate **AppSheet** app keyed on the same Employee Master — these must be consolidated into StrategicERP.

## A3. Data inventory (source spreadsheets)

> Full IDs are held in the separate **Backends Reference** file. Tabs listed are the primary ones.

| # | Spreadsheet | Primary tabs | Feeds |
|---|-------------|--------------|-------|
| 1 | Master | 26 master tabs (Site, Vendor, Asset, UOM, HeadMaster, CostCenter, PaymentTerms, Currency…) | Every module's reference data |
| 2 | Vendor Master | `7-VendorMaster_Actual`, Opening Balance | PO, Vendor Portal, Vendor Ledger |
| 3 | Purchase / SCM | `MRS`, `PO_Actual`, `SiteMaster`, PO Items, Invoice | Procurement, Accounts voucher |
| 4 | Account View / Payments | `PaymentRequest`, `AccountsUpdate`, Payment Master | Accounts, MD approvals, ledgers |
| 5 | v2_Stores | `StockIN`, `GRN_No`, `StockLevels` | Stores, GRN, Item Rate |
| 6 | Expenses | `CashExpenseMonth`, `Cash Expenses`, `Ledger`, Individual Food | Expense Ledger |
| 7 | Employee Register | `0_EmployeeRegister_Live`, Personal Details, Mess/Accommodation | HR, Access, Ledgers, Payroll |
| 8 | v2_Master | `DPR`, `LogSheet`, `Maintenance`, `Verification` | Execution, Plant |
| 9 | DPR | `DPR` | Daily progress |
| 10 | PCC / ProjectSetup | BOQ, WBS, Workplan, Resources | Budgeting / cost control |
| 11 | Safety | `Incidents`, `DailyChecks` / `Checklist` | Safety |
| 12 | Rewards | `Nomination`, `Posts`, `Reactions`, `Comments` | Rewards & Recognition |
| 13 | Recruitment | `MRF_Register`, `Offer_Tracker`, `v1_JoiningList` | Recruitment |
| 14 | UserSecrets / PIN | `UserSecrets`, `ReportConfig`, `ReportSchedules` | Login, scheduled reports |
| 15 | Rental (Onboarding wkbk) | `Rental Agreement`, `RP Booking`, Transfer Initiation | Rentals, transfers |

## A4. Integration inventory (Apps Script backends)

| Deployment | Responsibility | Key actions |
|------------|----------------|-------------|
| `main` | Generic writes | `appendRow`, `updateCell`, HR/Policy Drive listing, report send, `aiProxy`, `diagnoseSheet` |
| `portalConfig` | Config key/value | `savePortalConfig`, `getPortalConfig` |
| `accounts` | Finance writes | `saveNewPaymentRequest`, `saveAccountsUpdate`, `saveVendorOpeningBalance`, `saveGRNReview`, PR folder/attachments |
| `pcc` | Cost control writes | `saveProjectSetup`, `saveBOQ`, `saveWBS`, `saveWorkplan` |
| `safety` | Safety writes | Incident / daily-check append |

## A5. Access & roles model

Roles today: **MD/Admin, HR, Site Manager, Purchase, Accounts, Employee, Dept-Head**, plus external **Vendor** and **Sub-Contractor**. Access is enforced by **Access Groups** granting *routes* (pages) and *actions* (view/create/verify/approve/…). A master **enforce** switch and **super-admin** override exist. Employees are auto-assigned to **Users** (status Current) or **Deactivated** (otherwise) on a 24-hour cycle. StrategicERP must reproduce this route+action granularity, not just coarse role tiers.

## A6. Migration considerations & risks

1. **Append-only audit model.** Status changes (esp. Accounts) are *new rows*, never edits — the live value is the latest row. The ERP must preserve this history on migration, not just the current state.
2. **Composite keys.** Records link by business keys — `MR No → PO No → GRN No`, party = `Name + A/C No`, expense month = `MCE-site|CashFor|period`. These must map to ERP foreign keys.
3. **Cell-size limit.** Google Sheets' 50k-char/cell limit shaped some designs (e.g. compact `emp_group_sync` map). Not a constraint in the ERP, but explains current structures.
4. **Multi-currency.** Sites carry Country/Currency/Status (INR/TZS/XOF). ERP must be multi-currency, multi-country from day one.
5. **External AppSheet apps** (Attendance/Leave/On-Duty) must be folded in.
6. **Documents in Drive** (HR docs, policies, payment attachments) must migrate to the ERP document store with their record links intact.
7. **No referential integrity today** — the ERP will *add* it; expect to cleanse orphaned/duplicate rows during migration.

---

# PART B — USER REQUIREMENTS (PER MODULE)

---

## Module 1 — Authentication & Access Control

**Purpose:** Authenticate users and govern which pages and actions each may access.
**Roles:** All users; administered by MD/Admin & super-admins.

### Functional Requirements
- **FR-1.1** The system *shall* authenticate each user before granting access (current: PIN; target: ERP identity/SSO).
- **FR-1.2** The system *shall* support named roles and **access groups** that grant specific pages (routes) and specific actions per page.
- **FR-1.3** A user's effective access *shall* be the union of all groups they belong to.
- **FR-1.4** The system *shall* provide a super-admin that bypasses group restrictions, and an org-wide enforcement toggle.
- **FR-1.5** The system *shall* auto-assign active employees to a baseline access profile and revoke it when employment status is not "Current," on a recurring schedule (≤24h).
- **FR-1.6** Administration of access *shall* be restricted so a scoped admin cannot escalate their own privileges.
- **FR-1.7** External parties (Vendor, Sub-Contractor) *shall* see only their own portal (orders, invoices, documents).

### Acceptance Criteria
- **AC-1.1** Given valid credentials, When a user logs in, Then only the pages their groups grant are visible and navigable.
- **AC-1.2** Given a user lacks the "approve" action on Payments, When they open a payment request, Then the Approve control is absent/disabled.
- **AC-1.3** Given enforcement is ON and a user belongs to no group granting route X, When they navigate to X, Then access is denied and the nav entry is hidden.
- **AC-1.4** Given an employee's status changes from Current to any other value, When the sync runs, Then their baseline access is removed within one cycle.
- **AC-1.5** Given a super-admin account, When enforcement is ON, Then the super-admin can still reach every page and action.
- **AC-1.6** Given a vendor logs in, When they browse, Then they can see only their own orders/invoices/documents and no internal pages.

---

## Module 2 — Dashboard & My Tasks

**Purpose:** Role-aware landing page with KPIs and a personal task/action queue.
**Roles:** All.

### Functional Requirements
- **FR-2.1** The system *shall* present a role-specific dashboard of KPIs and shortcuts on login.
- **FR-2.2** The system *shall* present each user a consolidated **My Tasks** list of items awaiting their action across modules (approvals, verifications, pending entries).
- **FR-2.3** Dashboard figures *shall* reflect live data and be drill-through to the source module.

### Acceptance Criteria
- **AC-2.1** Given a user with the Accounts role, When they open the dashboard, Then finance KPIs (pending/completed payments, amounts) are shown; an Employee sees personal KPIs.
- **AC-2.2** Given a request awaits the user's approval, When they open My Tasks, Then that item appears with a direct link to act on it.
- **AC-2.3** Given a KPI tile, When clicked, Then the user is taken to the filtered underlying list.

---

## Module 3 — HR & People

**Purpose:** Manage the employee lifecycle — recruitment, onboarding, records, profiles, policies, mess/accommodation, transfers.
**Roles:** MD, HR, Dept-Head, Site, Employee (self-service).

### Functional Requirements
- **FR-3.1** The system *shall* run recruitment as a pipeline: **Manpower Requisition (MRF) → Offer Letter → Pre-Joining → Joining → Onboarding**, with status tracking at each stage.
- **FR-3.2** Authorised roles (MD/HR/Dept-Head/Site) *shall* raise an MRF; HR *shall* progress it through offer and joining.
- **FR-3.3** Onboarding *shall* run a completion checklist that creates the authoritative Employee record.
- **FR-3.4** The system *shall* maintain an Employee Register with status (Current/…), designation, grade, site, payroll company, and personal details.
- **FR-3.5** Employees *shall* have self-service **My Profile** (view details, documents).
- **FR-3.6** The system *shall* provide a **Policies Hub** (published documents, indexed and viewable).
- **FR-3.7** The system *shall* support **inter-site employee transfers** (from-site, to-site, reporting date, reporting manager) with an auditable request.
- **FR-3.8** The system *shall* track **individual mess/accommodation** expenses per employee.

### Acceptance Criteria
- **AC-3.1** Given a Dept-Head, When they submit an MRF, Then it appears in the Requisitions list for HR with status "raised."
- **AC-3.2** Given an MRF, When HR issues an offer and marks joining complete, Then the pipeline reflects each stage and the joining feeds onboarding.
- **AC-3.3** Given onboarding completes for a candidate, When saved, Then an Employee Register record exists and (per Module 1) baseline access is granted on the next sync.
- **AC-3.4** Given an employee, When they open My Profile, Then their own details and documents are shown and no one else's.
- **AC-3.5** Given a transfer is initiated, When saved, Then it records from-site, to-site, reporting date and manager, and is visible to HR as an auditable entry.
- **AC-3.6** Given a published policy, When a permitted user opens the Policies Hub, Then the document is listed and viewable.

---

## Module 4 — Site Operations

**Purpose:** Day-to-day site management — site manager workspace, safety, equipment, site store, plant overview.
**Roles:** MD, Site, Dept-Head, HR (safety), Purchase (store).

### Functional Requirements
- **FR-4.1** The system *shall* provide a Site Manager workspace scoped to the user's site(s).
- **FR-4.2** **Safety** *shall* provide a daily HSE checklist (min. the 10 standard checks: PPE, scaffolding, electrical, fire, first-aid, signage, toolbox talk, permits, housekeeping, machinery guards) and compute a completeness **safety score** per site per day.
- **FR-4.3** **Safety** *shall* allow **incident reporting** with details, stored as a dated record.
- **FR-4.4** The system *shall* track **equipment & machinery** and a **site store** (materials held at site).
- **FR-4.5** All safety and site records *shall* be dated and immutable as history.

### Acceptance Criteria
- **AC-4.1** Given a site user completes the daily checklist, When submitted, Then a dated DailyChecks record is stored and the site's safety score reflects the checks completed.
- **AC-4.2** Given an incident occurs, When reported, Then a dated incident record is stored and retrievable in the incident register.
- **AC-4.3** Given a site manager, When they open their workspace, Then data is scoped to their assigned site(s) only.
- **AC-4.4** Given a prior day's checklist, When viewed later, Then it is read-only history and cannot be silently overwritten.

---

## Module 5 — Procurement & Stores

**Purpose:** Material request → purchase order → goods receipt → stock, plus vendor/sub-contractor management and purchase analytics.
**Roles:** MD, Purchase, Site, Dept-Head; external Vendor & Sub-Contractor.

### Functional Requirements
- **FR-5.1** The system *shall* let sites raise a **Material Request (MRS)** for required items.
- **FR-5.2** Purchase *shall* convert approved MRS lines into a **Purchase Order (PO)** to a vendor.
- **FR-5.3** The store *shall* record **Goods Receipt (GRN)** against a PO (quantity, invoice, part), updating stock.
- **FR-5.4** The system *shall* maintain **stock levels**, **stock transfers**, **stock-out**, and **stock reconciliation** (book vs physical).
- **FR-5.5** Records *shall* carry linking keys end-to-end: **MR No → PO No → GRN No**.
- **FR-5.6** The system *shall* provide an **Open PO report** (ordered − received) and an **Item Rate Master** (rates reconstructed from GRN + PO).
- **FR-5.7** The system *shall* provide **Vendor** and **Sub-Contractor** portals for external parties to see their orders, invoices and documents.
- **FR-5.8** PO approval *shall* be gateable (pending-approval state) before issue.

### Acceptance Criteria
- **AC-5.1** Given an approved MRS line, When a PO is created from it, Then the PO carries the originating MR No.
- **AC-5.2** Given a PO, When goods are received, Then a GRN records quantity/invoice/part, carries the PO No, and increments the relevant stock level.
- **AC-5.3** Given POs and GRNs exist, When the Open PO report is run, Then each line shows ordered minus received quantity/amount.
- **AC-5.4** Given a stock reconciliation, When book and physical differ, Then the variance is shown and recordable.
- **AC-5.5** Given a vendor, When they log into their portal, Then only their own POs/invoices are visible.
- **AC-5.6** Given a PO pending approval, When an unauthorised user attempts to issue it, Then the action is blocked.

---

## Module 6 — Accounts & Finance

**Purpose:** Payment requests and their approval pipeline, vendor/party ledgers, GRN valuation, cash/mess expenses, and payroll.
**Roles:** MD, Accounts, Dept-Head (finance).

### Functional Requirements
- **FR-6.1** The system *shall* let authorised users raise a **payment request** (payee type Employee/Vendor/Sub-Contractor/Others, site/company, bill & PO reference, financials with currency/GST/TDS, bank details, narrative, attachments).
- **FR-6.2** Each request *shall* move through an **approval pipeline**: To be Verified → MD Queue → To Initiate Payment → Paid → Update UTR → Completed, with parking states for Hold/Sent-back/Query/Rejected.
- **FR-6.3** Every status change *shall* be recorded as **append-only history** (full audit of who/what/when); the live status is the latest entry.
- **FR-6.4** The system *shall* enforce, per status transition, **who may perform it** (Status Access), and provide an MD approval queue with single & bulk approve/reject (reason required to reject).
- **FR-6.5** On submission the system *shall* validate (amount > 0, payee present, amount ≤ pending value) and run a **duplicate-payment guard**.
- **FR-6.6** The system *shall* maintain a **Vendor Ledger** netting goods received (Cr) against payments (Dr), with opening balances and closing status (Payable/Advance/Settled).
- **FR-6.7** The system *shall* value received goods via **GRN Review** (per-GRN rule, PO/tiered fallback, rate-by-quantity, invoice-confirmed tax), gated by Status Access.
- **FR-6.8** The system *shall* maintain **party ledgers** (Vendor/Sub-Contractor/Employee, keyed by Name + A/C) with running balance and Paid/Pending totals.
- **FR-6.9** The system *shall* manage **cash & mess expenses** per site-month (opening → requests → bills → close), with Open/Closed state.
- **FR-6.10** The system *shall* support **salary/payroll** processing.
- **FR-6.11** Payment attachments *shall* be stored against the request and retrievable.

### Acceptance Criteria
- **AC-6.1** Given a valid new request, When submitted, Then it is created in "To be Verified" and appears on the Accounts worklist.
- **AC-6.2** Given a request in MD Queue, When the MD approves, Then it advances to "To Initiate Payment"; When rejected without a reason, Then rejection is refused.
- **AC-6.3** Given any status change, When it occurs, Then a new history entry (user, timestamp, from/to) exists and prior entries are unchanged.
- **AC-6.4** Given a user without rights to a transition, When they attempt it, Then it is blocked per Status Access.
- **AC-6.5** Given a duplicate amount for the same Order No/payee, When submitting, Then the system warns before allowing continuation.
- **AC-6.6** Given goods received and payments made for a vendor, When the Vendor Ledger is opened, Then Cr, Dr, and a Payable/Advance/Settled closing balance are shown.
- **AC-6.7** Given a GRN, When reviewed, Then the invoice-confirmed value (with tax) is what posts to the ledger, overriding the PO estimate.
- **AC-6.8** Given a party (Name+A/C), When their statement is opened, Then every transaction, a running balance, and Paid/Pending totals are shown and exportable.
- **AC-6.9** Given a site-month, When all bills are booked and it is closed, Then Ledger Status reads Closed and Opening/Initiated/Paid/Closing reconcile.
- **AC-6.10** Given a completed payment, When UTR is recorded, Then the request closes and the UTR is stored against it.

---

## Module 7 — Planning (Budget & Execution)

**Purpose:** Project cost control (budget) and daily progress reporting (execution), tracked against each other.
**Roles:** MD, Site, Accounts, Purchase, HR, Dept-Head.

### Functional Requirements
- **FR-7.1** The system *shall* provide **project cost control / budgeting** — BOQ, WBS, work plan, resources, project dashboard.
- **FR-7.2** The system *shall* capture a **Daily Progress Report (DPR)** of site actuals.
- **FR-7.3** The system *shall* report **plan vs actual** (budget/schedule vs DPR).

### Acceptance Criteria
- **AC-7.1** Given a project setup, When BOQ/WBS/workplan are entered, Then they persist and populate the project dashboard.
- **AC-7.2** Given a site day, When the DPR is submitted, Then a dated progress record is stored.
- **AC-7.3** Given budget and DPR data, When a project is viewed, Then planned vs actual progress is comparable.

---

## Module 8 — Plant & Machinery

**Purpose:** Track equipment usage, verification and maintenance.
**Roles:** MD, Site, Dept-Head.

### Functional Requirements
- **FR-8.1** The system *shall* record a **daily plant log** (usage/hours per machine).
- **FR-8.2** The system *shall* record **asset verification** (asset present & working) on inspection.
- **FR-8.3** The system *shall* record **maintenance/servicing** per asset.
- **FR-8.4** Each asset *shall* have a retrievable history across log, verification and maintenance.

### Acceptance Criteria
- **AC-8.1** Given a machine, When a daily log is entered, Then a dated usage record is stored against that asset.
- **AC-8.2** Given an inspection, When an asset is verified, Then a dated verification record exists.
- **AC-8.3** Given an asset, When its history is opened, Then log, verification and maintenance records are shown together.

---

## Module 9 — Reports & Data Hub

**Purpose:** Read-only access to source data, master-data export, and scheduled report distribution.
**Roles:** MD, HR, Purchase, Accounts, Dept-Head.

### Functional Requirements
- **FR-9.1** The system *shall* provide a **Data Hub** to browse source datasets read-only.
- **FR-9.2** The system *shall* expose **Master data** (all master tables) with per-view column selection and **CSV export** (single and bulk).
- **FR-9.3** The system *shall* let users define **reports** and **schedule** them for automated email distribution on a cadence.
- **FR-9.4** Reporting *shall not* mutate source data.

### Acceptance Criteria
- **AC-9.1** Given a source dataset, When opened in Data Hub, Then it is viewable read-only with no edit controls.
- **AC-9.2** Given a master table, When the user hides/shows columns and exports, Then the CSV reflects the chosen columns.
- **AC-9.3** Given a scheduled report, When its cadence is due, Then the report is emailed to recipients automatically.

---

## Module 10 — Configuration & Administration

**Purpose:** Administer the system without code — module status, data-source binding, per-site attributes, status permissions, data schemas, and integration endpoints.
**Roles:** MD/Admin, super-admins.

### Functional Requirements
- **FR-10.1** The system *shall* let admins set each module's status (Live/Dev/Off) and org-wide defaults.
- **FR-10.2** The system *shall* let admins **re-point any data source** so every dependent view follows (current: Sheet Linking).
- **FR-10.3** The system *shall* maintain a **Site Config** — per-site Country, Currency, Status — usable as a lookup across modules, and *shall* stamp these onto dependent records (e.g. rental agreements/bookings) with a **preview-before-write** safeguard.
- **FR-10.4** The system *shall* let admins restrict each **status transition** to named people/roles (Status Access).
- **FR-10.5** The system *shall* provide a **Schema Manager** defining table columns and form fields (type, label, validation) that the UI renders from.
- **FR-10.6** The system *shall* centralise **integration endpoints/credentials** and allow re-pointing without code changes.
- **FR-10.7** Administrative changes *shall* be restricted to admins and *shall not* allow privilege escalation by scoped admins.

### Acceptance Criteria
- **AC-10.1** Given an admin sets a module to Off, When any user loads the app, Then that module is unavailable.
- **AC-10.2** Given an admin re-points a data source, When a dependent view is opened, Then it reads from the new source.
- **AC-10.3** Given Site Config holds a site's currency, When a dependent record for that site is created/updated, Then the currency/country/status is applied; and When a bulk write is requested, Then a preview of changes is shown before any write.
- **AC-10.4** Given a status transition is restricted to role R, When a non-R user attempts it, Then it is blocked.
- **AC-10.5** Given a field's type/validation is changed in Schema Manager, When any form/table using it renders, Then the new definition applies everywhere.

---

## Module 11 — Employee Engagement (Rewards & Recognition)

**Purpose:** Peer recognition and a shared recognition wall.
**Roles:** All.

### Functional Requirements
- **FR-11.1** The system *shall* let any user submit a **nomination** recognising a colleague.
- **FR-11.2** Nominations *shall* surface on a **recognition wall** the team can **react to** and **comment on**.

### Acceptance Criteria
- **AC-11.1** Given a user submits a nomination, When saved, Then it appears on the recognition feed.
- **AC-11.2** Given a wall post, When a user reacts or comments, Then the reaction/comment is recorded and visible to others.

---

## Module 12 — Time & Attendance *(currently external — AppSheet)*

**Purpose:** Attendance, leave and on-duty — today in a separate AppSheet app keyed on the Employee Master; **to be consolidated into StrategicERP**.

### Functional Requirements
- **FR-12.1** The system *shall* record daily **attendance** per employee.
- **FR-12.2** The system *shall* manage **leave** requests and **on-duty (OD)** requests with an approval workflow (Dept-Head/HR).
- **FR-12.3** Approved attendance/leave/OD *shall* feed **payroll** and DPR headcount.

### Acceptance Criteria
- **AC-12.1** Given an employee, When attendance is marked, Then a dated record exists keyed to their Employee ID.
- **AC-12.2** Given a leave/OD request, When the approver acts, Then the request reflects approved/rejected and the balance updates.
- **AC-12.3** Given approved time data for a period, When payroll runs, Then it consumes days/hours from this module.

---

# PART C — NON-FUNCTIONAL REQUIREMENTS & DATA MIGRATION

## C1. Non-functional requirements

| Ref | Requirement | Acceptance |
|-----|-------------|------------|
| NFR-1 **Audit** | All financial and status changes retained as immutable history (who/what/when). | Any record's full change history is retrievable; prior entries never mutate. |
| NFR-2 **Security** | Authenticated access; route + action authorisation; no privilege escalation by scoped admins; external parties isolated to own data. | Pen-test / role-matrix test passes; vendor cannot read internal data. |
| NFR-3 **Multi-currency / multi-country** | Sites in INR/TZS/XOF; amounts carry currency. | A TZS site's transactions display and total in TZS; conversion rates applied where configured. |
| NFR-4 **Roles** | Reproduce MD, HR, Site, Purchase, Accounts, Employee, Dept-Head + Vendor/Sub-Contractor, at route+action granularity. | Role-permission matrix matches or exceeds current grants. |
| NFR-5 **Availability / performance** | Large tables (thousands of rows) remain responsive; list/search usable on site connections. | Key lists render < 3s on a standard connection. |
| NFR-6 **Documents** | HR docs, policies, payment attachments retained and linked to records. | Each migrated document opens from its parent record. |
| NFR-7 **Data integrity** | ERP enforces referential integrity absent today. | Orphan/duplicate report is zero post-migration cleanse. |
| NFR-8 **Localisation** | Indian number formatting (lakh/crore), en-IN dates. | Amounts and dates display in the expected local formats. |

## C2. Data migration map (source → target)

| Source data | Business key(s) | Target ERP object | Notes |
|-------------|-----------------|-------------------|-------|
| Employee Register | Employee ID (EG####) | Employee master | Status drives access; personal + mess/accommodation sub-objects |
| Site master + Site Config | Site Name | Site/Project master | Carry Country/Currency/Status |
| Vendor Master (+ opening bal) | Vendor ID | Vendor master + opening balance | |
| Sub-Contractor master | SC ID | Subcontractor master | |
| MRS / PO / GRN | MR No → PO No → GRN No | Requisition → PO → GRN | Preserve the chain as FKs |
| PaymentRequest + AccountsUpdate | Request UUID | Payment request + status history | **Append-only history must migrate**, not just latest status |
| Vendor Ledger / GRN Review | Vendor ID, SI ID | AP ledger + goods valuation | |
| Party ledgers | Name + A/C No | Party statement | |
| Cash/Mess expenses | MCE-site\|CashFor\|period | Petty-cash / mess ledger by site-month | |
| DPR / PCC (BOQ/WBS/Workplan) | Project + date / WBS code | Project cost & progress | |
| Plant log/verify/maintenance | Asset ID | Asset register + events | |
| Safety incidents / daily checks | Site + date | HSE records | |
| Recruitment (MRF/Offer/Joining) | MRF No / candidate | Recruitment pipeline | |
| Rental Agreement / RP Booking | Row key | Rental/asset-hire records | Currency/status from Site Config |
| Attendance/Leave/OD (AppSheet) | Employee ID + date | Time & attendance | Consolidate external app |
| PortalConfig | key | ERP configuration | Access groups, defaults, status access |
| Drive folders | folder/record link | Document store | HR, policy, payment attachments |

## C3. Cutover checklist (handoff)

1. Freeze source-sheet writes at an agreed cutoff; take a full export snapshot of every spreadsheet/tab.
2. Migrate master data first (Employee, Site, Vendor, SC, UOM, Heads, Cost Centre, Payment Terms, Currency).
3. Migrate transactional data with keys and **status history**; validate the MR→PO→GRN and payment chains reconcile.
4. Migrate documents; verify record links.
5. Rebuild the access/permission matrix from `access_config` + Status Access.
6. Parallel-run finance (ledgers/approvals) for one cycle; reconcile balances against the source Vendor/Party ledgers.
7. Consolidate Attendance/Leave/OD from AppSheet.
8. Decommission Apps Script endpoints and revoke sheet sharing after sign-off.

## C4. Handoff artefacts (companion files)

- **Backends Reference** — every Spreadsheet ID, tab list, Drive folder, and Apps Script exec URL (held separately; contains sensitive IDs).
- **In-portal Knowledge Base** — 16 process guides (how each process works, both user & technical layers) — a living description of current behaviour for the implementation team.
- **Module Atlas** — visual map of modules and how data flows between them.

---

---

# APPENDICES

## Appendix A — Role × Module access (default grants)

Seven internal roles: **MD/Admin, HR, Site, Purchase, Accounts, Employee, Dept-Head** (plus external **Vendor**, **Sub-Contractor**). MD/Admin has access to everything. Defaults below are the compiled starting grants; live grants are governed by Access Groups (Part B, Module 1). ● = default access.

| Module / area | MD | HR | Site | Purch | Accts | Emp | Dept-Head |
|---------------|:--:|:--:|:----:|:-----:|:-----:|:---:|:---------:|
| Dashboard · My Tasks | ● | ● | ● | ● | ● | ● | ● |
| HR Dashboard | ● | ● | | | | | ● |
| My Profile · Policies | ● | ● | ● | ● | ● | ● | ● |
| Onboarding | ● | ● | | | | | |
| Recruitment | ● | ● | ● | | | | ● |
| Individual Mess Expenses | ● | ● | | | ● | | ● |
| Site Manager · Plant Overview | ● | | ● | | | | ● |
| Safety | ● | ● | ● | | | | ● |
| Equipment · Site Store | ● | | ● | ● | | | ● |
| Purchase (PO) · MRS · Stores | ● | | ● | ● | | | ● |
| Vendor Portal | ● | | | ● | ● | | ● |
| Subcontractor Portal | ● | | | ● | ● | | |
| Payments & Approvals (MD) | ● | | | | | | |
| Accounts (all workspaces) | ● | | | | ● | | ● |
| Expense Ledger | ● | ● | | | ● | | ● |
| Ledgers (party) | ● | | | | ● | | |
| Budgeting · Execution (DPR) | ● | ● | ● | ● | ● | ●* | ● |
| Plant & Machinery (log/verify/maint) | ● | | ● | | | | ● |
| Reports · Data Hub · Masters | ● | ● | | ● | ● | | ● |
| Rewards & Wall · Apps | ● | ● | ● | ● | ● | ● | ● |
| My Documents | ● | ● | ● | ● | ● | ● | ● |
| Configuration · Access · Settings · Schema | ● | | | | | | |

\* Employee has Budgeting (view) but not Execution by default.
**Requirement:** StrategicERP *shall* reproduce this at route granularity, adjustable per access group — not fixed to role tiers.

## Appendix B — Route action catalogue (per-page permissions)

The current system grants **actions** per page, not just view. StrategicERP *shall* support at least this action granularity. Pages not listed default to **view** only.

| Route / page | Grantable actions |
|--------------|-------------------|
| Accounts · Accounts Workspace (`accounts`, `accounts-v2`) | view, create, verify, advance, update, setDefault, export |
| Accounts Worklist | view, advance, update, export |
| Accounts Dashboard | view, export |
| Payments & Approvals (MD) | view, **approve**, **reject** |
| Ledgers · Vendor Ledger (PO) | view, export |
| PO Register · StockIN Register | view, export |
| Safety | view, create, **close** |
| Reports | view, export, **schedule** |
| Material Request (MRS) | view, create, edit |
| MRS List · SCM · Item Rate Master · Stores registers | view, export |
| Stock Reconciliation | view, edit |
| Purchase View | view, **approve-md**, **approve-scm**, **reject-md**, **reject-scm** |

**Action vocabulary to reproduce:** view, create, edit, verify, advance, update (status), approve, reject, close, export, schedule, setDefault — plus the dual MD/SCM approve/reject on Purchase View.

## Appendix C — Accounts payment request (voucher) field catalogue

The payment request is the most field-rich form; StrategicERP's AP entry *shall* cover these. Grouped by voucher section; validation noted.

| # · Section | Fields | Notes / validation |
|-------------|--------|--------------------|
| 1 · Initiator | Date; Requested by; Department; Process; Manual/Auto | |
| 2 · Payment To | Payee type (Employee / Vendor / Sub-Contractor / Others); Payee | "Others" = free text; else picked from master |
| 3 · Site & Company | Site; Company | Company auto-fills from Site |
| 4 · Bill & PO Reference | Order No; Bill No; Payment Terms; PO Value; Invoice Value; Paid Value; Pending Value | PO/values for Purchase dept |
| 5 · Financial | Currency; **Amount**; Nature of Expenses; Account Code; GST; TDS | Amount > 0; Amount ≤ Pending Value |
| 6 · Bank Details | A/C holder; A/C number; IFSC; Bank | Auto-filled for known Vendor / Sub-Contractor |
| 7 · Narrative & Attachments | Narrative (**required**); Invoice / supporting files | Files stored per-request (Drive today) |

**Submit-time rules the ERP must reproduce:** amount > 0; payee present; amount not over pending value; **duplicate-payment guard** (warn if the same amount is already requested for the same Order No / payee).

**Voucher personalisation:** voucher *blocks* (request details, amount, bank, PO items, previous payments, documents, status timeline) and the Bill & PO Reference fields are drag-reorderable / show-hideable per user, with an admin org-wide default. The ERP *should* offer comparable per-user layout with an admin default.

**Status lifecycle** (see Module 6): To be Verified → MD Queue → To Initiate Payment → Paid → Update UTR → Completed, with Hold / Sent-back / Query / Rejected parking states — each transition append-only and permission-gated.

---

*End of document. This URD describes the capability StrategicERP must deliver to replace the EVGCPL Portal. Acceptance criteria are the basis for UAT sign-off per module.*
