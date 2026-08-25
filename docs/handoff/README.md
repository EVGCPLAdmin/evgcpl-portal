# EVGCPL Portal → StrategicERP — Handoff

This folder is the migration handoff package for moving off the EVGCPL Portal to **StrategicERP**.

## Contents

| File / location | What it is |
|-----------------|------------|
| [`URD-StrategicERP.md`](URD-StrategicERP.md) | **User Requirements Document** — per-module functional requirements + testable acceptance criteria, non-functional requirements, source→target data-migration map, cutover checklist, and appendices (role×module matrix, route action catalogue, payment-voucher fields). The UAT sign-off basis. |
| In-app **Knowledge Base → Handoff** | The same handoff content surfaced inside the portal: *StrategicERP Handoff — Overview* and *— Module Requirements (URD)*. |
| In-app **Knowledge Base** (16 process guides) | Living description of how each current process works (user + technical layers) — reference for the implementation team. |
| **Module Atlas** (artifact) | Visual map of modules and how data flows between them. |
| **Backends Reference** | Every Spreadsheet ID, tab, Drive folder and Apps Script exec URL. **Held separately — sensitive** (contains live deployment URLs). Note: these IDs are already compiled into `assets/js/portal-bundle.js`. |

## How to use it

1. **Vendor / implementation team** — start with `URD-StrategicERP.md` (what the ERP must do) and the in-app Knowledge Base (how it works today).
2. **Data-migration team** — Part C of the URD (migration map + cutover) plus the Backends Reference for source locations.
3. **Process owners (Accounts, HR, Purchase…)** — validate your module's acceptance criteria before they go to the vendor; the ACs were derived from system behaviour, not signed off by the business.

## Status

Baseline v1.0. The URD describes capability StrategicERP must **meet or exceed**. Acceptance criteria are written as independently testable Given/When/Then conditions for UAT.
