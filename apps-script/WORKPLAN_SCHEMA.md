# PCC — Workplan Backend & Activity Master Schema

**Sheet:** `ProjectSetup_v1`
**Sheet ID:** `1dQow9nD4e0qVOSfpwEWQmPTuhF3FW_8r1oK5dMjJlRE`
**Constant:** `PCC_SHEET_ID` in `portal-bundle.js`

This is the single backing sheet for all PCC (Project Cost Control) data.
Five tabs, with `M_PL_1_Activities` serving as the master for cascading
**Nature of Work → Type of Work** dropdowns used by both **WBS** and
**Workplan** (and reusable by DPR forms).

---

## Tab 1 — `M_PL_1_Activities` (the master)

The single source of truth for what work types exist on the project.
Drives every dropdown across WBS, Workplan, BOQ, and DPR.

| Column              | Type    | Required | Notes                                                              |
| ------------------- | ------- | -------- | ------------------------------------------------------------------ |
| Nature of Work      | TEXT    | ✓        | Cost package — e.g. SDA, TAM Grouting, Micropile, Shotcrete        |
| Type of Work        | TEXT    | ✓        | Activity within the package — Drilling, Grouting, WPT, Concreting  |
| UOM                 | TEXT    | ✓        | Unit of measure — RM, KG, MT, Sq.m, Cu.m, Nos                      |
| Depends On          | TEXT    |          | Predecessor "Type of Work" on same hole/location                   |
| Measurement Basis   | TEXT    |          | Volume (L×B×H) / Area (L×B) / Length (L) / Numbers / Stages        |
| Active              | BOOLEAN |          | Default TRUE; set FALSE to hide without deleting                   |
| Project             | TEXT    |          | Optional — leave blank for global; populate for project-specific   |
| Notes               | TEXT    |          | Free text                                                          |

### Recommended seed rows (from prior catalogue)

| Nature of Work          | Type of Work        | UOM         | Depends On       | Measurement Basis |
| ----------------------- | ------------------- | ----------- | ---------------- | ----------------- |
| SDA                     | Drilling            | RM          |                  | Length (depth)    |
| SDA                     | Grouting            | KG          | Drilling         | Numbers (cement)  |
| Consolidation Grouting  | Drilling            | RM          |                  | Length            |
| Consolidation Grouting  | WPT                 | Stages      | Drilling         | Stages            |
| Consolidation Grouting  | Grouting            | KG          | WPT              | Numbers           |
| TAM Grouting            | Drilling            | RM          |                  | Length            |
| TAM Grouting            | Sheath Grouting     | KG          | Drilling         | Numbers           |
| TAM Grouting            | TAM Grouting        | KG          | Sheath Grouting  | Numbers           |
| Micropile               | Drilling            | RM          |                  | Length            |
| Micropile               | Cage Lowering       | Nos         | Drilling         | Numbers           |
| Micropile               | Concreting          | Cu.m        | Cage Lowering    | Volume (L×B×H)    |
| Shotcrete               | Spraying            | Sq.m / Cu.m |                  | Area (L×H)        |
| Gabion Box              | Installation        | Cu.m        |                  | Volume × Nos      |
| Mesh Laying (DT Mesh)   | Laying              | Sq.m        |                  | Area × Nos        |
| Loose Scalling / CTA    | Scalling            | Sq.m        |                  | Area (L×H)        |

---

## Tab 2 — `M_PL_2_BOQ`

| Column           | Type   | Notes                                            |
| ---------------- | ------ | ------------------------------------------------ |
| BOQItemCode      | TEXT   | PK — from contract                               |
| ProjectCode      | TEXT   | FK → Project_Master                              |
| Description      | TEXT   |                                                  |
| Schedule         | TEXT   | Schedule A / B / C                               |
| Chapter          | TEXT   |                                                  |
| UOM              | TEXT   |                                                  |
| ContractQty      | NUMBER |                                                  |
| ContractRate     | NUMBER |                                                  |
| ContractValue    | NUMBER | Auto = Qty × Rate                                |
| NatureOfWork     | TEXT   | FK → M_PL_1_Activities (parent only)             |
| TypeOfWork       | TEXT   | FK → M_PL_1_Activities (child, cascades)         |
| Status           | TEXT   | ACTIVE / SUSPENDED / VARIATION                   |

---

## Tab 3 — `M_PL_3_WBS` (Work Breakdown Structure)

WBS is **organized by Nature of Work** — each Nature of Work becomes a
WBS node, with Types of Work as its leaves.

| Column         | Type | Notes                                                    |
| -------------- | ---- | -------------------------------------------------------- |
| WBSCode        | TEXT | PK — e.g. `WBS-SDA-01`                                   |
| ProjectCode    | TEXT | FK → Project_Master                                      |
| WBSLevel       | INT  | 1 = Project, 2 = Nature of Work, 3 = Type of Work        |
| ParentWBSCode  | TEXT | Self-referencing FK                                      |
| NatureOfWork   | TEXT | **dropdown sourced from M_PL_1_Activities**              |
| TypeOfWork     | TEXT | **cascading dropdown — filtered by NatureOfWork**        |
| Description    | TEXT |                                                          |
| BudgetValue    | NUMBER |                                                        |
| StartDate      | DATE |                                                          |
| EndDate        | DATE |                                                          |
| Status         | TEXT | NOT_STARTED / IN_PROGRESS / COMPLETED                    |

### Cascade behavior

- **WBS Level 2** rows = unique Natures of Work — populate by selecting from
  the deduplicated `Nature of Work` column of `M_PL_1_Activities`.
- **WBS Level 3** rows = Types of Work under their parent Nature of Work —
  the Type of Work dropdown is **filtered** by the parent's Nature of Work.

---

## Tab 4 — `M_PL_4_Workplan`

The actual time-phased plan rows. `WorkplanHandlers.gs` writes to this tab.

| Column          | Type   | Notes                                                         |
| --------------- | ------ | ------------------------------------------------------------- |
| WorkplanID      | TEXT   | PK — auto: `WP-{ProjectCode}-{seq}` e.g. `WP-P5453-0001`      |
| ProjectCode     | TEXT   | FK → Project_Master                                           |
| SiteName        | TEXT   | FK → 5-SiteMaster (in Master sheet)                           |
| WBSCode         | TEXT   | FK → M_PL_3_WBS                                               |
| **NatureOfWork**| TEXT   | **FK → M_PL_1_Activities** (parent dropdown)                  |
| **TypeOfWork**  | TEXT   | **FK → M_PL_1_Activities** (cascading dropdown)               |
| BOQItemCode     | TEXT   | FK → M_PL_2_BOQ (optional)                                    |
| UOM             | TEXT   | Auto-filled from the selected Type of Work                    |
| PlannedQty      | NUMBER |                                                               |
| PlannedRate     | NUMBER |                                                               |
| PlannedValue    | NUMBER | Auto = Qty × Rate (computed by handler)                       |
| StartDate       | DATE   |                                                               |
| EndDate         | DATE   |                                                               |
| DurationDays    | INT    |                                                               |
| AssignedTo      | TEXT   | Employee code                                                 |
| Subcontractor   | TEXT   | SC code (optional)                                            |
| Status          | TEXT   | PLANNED / IN_PROGRESS / COMPLETED / DELETED                   |
| Notes           | TEXT   |                                                               |
| CreatedBy       | TEXT   |                                                               |
| CreatedAt       | DATETIME |                                                             |
| ModifiedBy      | TEXT   |                                                               |
| ModifiedAt      | DATETIME |                                                             |

### Auto-fields

- `WorkplanID` — generated by handler if blank
- `PlannedValue` — recomputed on every save
- `Status` defaults to `PLANNED`
- `CreatedBy/At` only set on insert; `ModifiedBy/At` set on every save

---

## Tab 5 — `M_PL_4_WorkplanDtl` (month-by-month detail)

Optional long-form table for workplans that span multiple months.
`Total of detail rows == header PlannedQty` is enforced UI-side, not by
the sheet.

| Column        | Type   | Notes                                              |
| ------------- | ------ | -------------------------------------------------- |
| DetailID      | TEXT   | PK — auto: `{WorkplanID}-{YYYY-MM}`                |
| WorkplanID    | TEXT   | FK → M_PL_4_Workplan                               |
| PeriodMonth   | TEXT   | YYYY-MM                                            |
| PlannedQty    | NUMBER |                                                    |
| PlannedValue  | NUMBER |                                                    |
| ActualQty     | NUMBER | Populated from DPR rollups (read-only here)        |
| ActualValue   | NUMBER | Populated from DPR rollups                         |
| Variance      | NUMBER | = (Actual − Planned)                               |
| Notes         | TEXT   |                                                    |

---

## Cascading dropdown — implementation flow

```
                            M_PL_1_Activities
                                   │
                                   │  loadActivityMaster() — gviz fetch, cached 5 min
                                   ▼
                         STATE.activitiesCache
                                   │
                                   │
              ┌────────────────────┼─────────────────────┐
              │                    │                     │
              ▼                    ▼                     ▼
       getNaturesOfWork()   getTypesOfWork(N)    bindActivityCascade(natId, typeId)
              │                    │                     │
        unique sorted        filtered & sorted    wires both <select>s
        list of Nature       by Nature of Work    + change events
              │                    │                     │
              ▼                    ▼                     ▼
        WBS dropdown         Activity dropdown    Workplan / DPR forms
        (parent)             (child / cascading)
```

### Usage from any HTML page

```html
<select id="natureSel"></select>
<select id="typeSel" disabled></select>
<input id="uomField" readonly>

<script>
  // Auto-fill UOM when Type of Work changes
  bindActivityCascade('natureSel', 'typeSel', {
    onChange: ({ nature, type }) => {
      const opt = document.querySelector(`#typeSel option[value="${type}"]`);
      document.getElementById('uomField').value = opt?.dataset.uom || '';
    }
  });
</script>
```

This works inside the `/pcc/` iframe pages (workplan.html, wbs.html, boq.html)
AND inside the portal's inline DPR form, because all three globals
(`loadActivityMaster`, `getNaturesOfWork`, `getTypesOfWork`,
`bindActivityCascade`) are exposed on `window` from `portal-bundle.js`.

---

## Apps Script wiring

Add this single line to your existing `doPost(e)` router in the main
Apps Script project, just after the existing action dispatcher:

```js
function doPost(e) {
  const body   = JSON.parse(e.postData.contents);
  const action = body.action;

  // ... existing actions (appendRow, updateCell, aiProxy, ...)

  // Workplan + Activity Master routes
  const wpResult = handleWorkplan(action, body);
  if (wpResult) return ContentService.createTextOutput(JSON.stringify(wpResult))
                   .setMimeType(ContentService.MimeType.JSON);

  // ... fallthrough / unknown action handler
}
```

The `handleWorkplan(action, payload)` function returns `null` if the
action isn't one of its routes, so the existing dispatcher continues
to work for everything else.

---

## Sharing requirement

The PCC sheet must be shared **"Anyone with the link → Viewer"** for
gviz reads to work. Writes go through Apps Script which uses the
project owner's credentials, so write permissions are independent.

---

## Build log entry

Added in v3.2.0 build 315: Activity Master cascade + Workplan handlers.
