# Project Cost Control · Multi-page Architecture

A unified multi-page web app covering all 8 steps of the Project Budget Preparation Flow, backed by a single Google Sheet (`1dQow9nD4e0qVOSfpwEWQmPTuhF3FW_8r1oK5dMjJlRE`).

This is the **merge** of the original `project_setup_v1.html` (Steps 1–3) with the Steps 4–8 budget app, restructured as discrete pages so each step can be linked, deep-linked, and reasoned about independently.

---

## Sub-pages (Steps 1–7) — the "1 to 7" structure

| Step | File | Module | Description |
|---|---|---|---|
| **1** | `setup.html` | Project Setup | Project Identity, Multi-GST Billing IDs, Site & Client, Team |
| **2** | `boq.html` | Bill of Quantities | Inline-editable table, AI assistant, CSV import/export |
| **3** | `wbs.html` | Work Breakdown Structure | Tree + Activities + Cost Codes |
| **4** | `workplan.html` | Workplan | Monthly quantity grid per activity |
| **5A** | `manpower.html` | Manpower | Workers · rate · days · indirect · buffer |
| **5B** | `machinery.html` | Machinery | Owned/Rental · hours · diesel · mob/demob |
| **5C** | `materials.html` | Materials | BOQ qty · wastage · unit rate · procurement |

## Step 8 group — Budget rollup, Approval, Variations

| Page | File | Description |
|---|---|---|
| Overheads | `overheads.html` | Direct (site) + Indirect (HO 5%, insurance, taxes) |
| Cost Summary (6 + 7) | `summary.html` | Activity cost + overheads + buffer = Total Budget · Submit for Approval |
| Variations | `variations.html` | Step 8 — scope/design/quantity changes workflow |

---

## File layout

```
multipage/
├── index.html                   ← dashboard: switcher, KPIs, module grid
├── setup.html                   ← Step 1
├── boq.html                     ← Step 2
├── wbs.html                     ← Step 3
├── workplan.html                ← Step 4
├── manpower.html                ← Step 5A
├── machinery.html               ← Step 5B
├── materials.html               ← Step 5C
├── overheads.html
├── summary.html                 ← Steps 6 + 7
├── variations.html              ← Step 8
├── AppsScript_Handlers.gs       ← backend handlers — paste into bound Apps Script
├── README.md                    ← (this file)
└── assets/
    ├── img/EG.jpg               ← logo (saved from /mnt/project/EG.jpg)
    ├── css/app.css              ← shared light theme (Syne · DM Sans · DM Mono)
    └── js/
        ├── config.js            ← Sheet ID, Apps Script URL, tab names, page metadata
        ├── state.js             ← localStorage persistence (active project, months)
        ├── api.js               ← gviz reads + Apps Script POST writes
        ├── utils.js             ← fmt, esc, toast, uuid, genMonths, debounce
        ├── shell.js             ← header / nav / footer / project switcher
        └── pages/
            ├── setup.js
            ├── boq.js
            ├── wbs.js
            ├── workplan.js
            ├── manpower.js
            ├── machinery.js
            ├── materials.js
            ├── overheads.js
            ├── summary.js
            └── variations.js
```

---

## How a page wires up

Every page loads scripts in the same order:

```html
<script src="assets/js/config.js"></script>
<script src="assets/js/state.js"></script>
<script src="assets/js/api.js"></script>
<script src="assets/js/utils.js"></script>
<script src="assets/js/shell.js"></script>
<script src="assets/js/pages/<page>.js"></script>
<script>
(async function() {
  await Shell.init({ pageId: '<page>' });
  await PAGE.load();
})();
</script>
```

`Shell.init()` injects the header, nav, footer, and project-switcher modal, then loads the project list via `API.gviz('Project')`. The active project is restored from `localStorage` (key `EVGCPL_PCC_STATE_V1`) so the header pill stays consistent across navigation.

Each `pages/<name>.js` exports a `window.PAGE` object with at least:
- `load()` — fetch sheet data, render the page
- `save()` — POST changes to Apps Script
- `onProjectChange()` — re-load when the user switches project from the header

---

## Backend — Apps Script

`AppsScript_Handlers.gs` contains 10 actions that need to live in your existing Apps Script project (the one bound to the backing sheet, deployed as Web App at `https://script.google.com/macros/s/AKfycbxajusc.../exec`).

Add these case branches inside the existing `doPost` switch:

```javascript
function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var action = data.action;
  switch (action) {
    // Steps 1–3 (foundation)
    case 'saveProjectSetup':     return saveProjectSetup(data.payload);
    case 'saveBOQ':              return saveBOQ(data.payload);
    case 'saveWBS':              return saveWBS(data.payload);
    // Steps 4–5 (workplan + resources)
    case 'saveWorkplan':         return saveWorkplan(data.payload);
    case 'saveManpower':         return saveManpower(data.payload);
    case 'saveMachinery':        return saveMachinery(data.payload);
    case 'saveMaterials':        return saveMaterials(data.payload);
    // Step 6–8 (estimation, budget, variations)
    case 'saveOverheads':        return saveOverheads(data.payload);
    case 'saveVariations':       return saveVariations(data.payload);
    case 'submitBudgetApproval': return submitBudgetApproval(data.payload);
  }
}
```

All write actions follow the **per-project replace** pattern: clear all rows where col A = `projectCode`, then append fresh rows. Tabs auto-create with a frozen dark-green header on first save. The CORS-safe POST pattern is `Content-Type: text/plain` with a JSON body — that avoids preflight issues and `e.postData = undefined`.

`saveProjectSetup` is the exception: it's a single-row upsert that auto-generates `EG{YY}{G/P}{NNNN}` codes when the project is new (e.g. `EG25G0001`), then inserts or updates the matching row in the `Project` tab.

---

## Design tokens

The light theme matches `project_setup_v1.html` and the EVGCPL brand:

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#f4f6f4` | Page background |
| `--surface` | `#ffffff` | Cards, panels |
| `--surface2` | `#f0f4f0` | Subtle fills, tab strips |
| `--green` | `#1e8035` | Primary brand · buttons |
| `--green-d` | `#155927` | Button hover · top stripe |
| `--green-dim` | `#d4eeda` | Pills, KPI accent |
| `--gold` | `#a06c10` | BOQ totals, gold accents |
| `--text` | `#1a2e1a` | Body text |
| `--text-faint` | `#7a9a7a` | Captions, table headers |

Fonts:
- **Syne** — headings, KPI values, brand
- **DM Sans** — body
- **DM Mono** — codes, numbers, monospaced data

---

## EVGCPL Portal integration

This sub-app is intended to be linked from the main EVGCPL portal (`https://evgcpladmin.github.io/evgcpl-portal/`) as the **"Project Cost Control"** sub-section under Finance/Budget & Planning. The dashboard `index.html` includes a "Back to EVGCPL Portal" link so users can roundtrip cleanly.

To deploy: drop the entire `multipage/` folder into the portal repo at `pcc/` (or whatever path you choose), and link to it from the portal's IC Budget / Budget & Planning tile.

---

## Sheet contract

The Project Setup form maps to existing columns in the `Project` tab:

| Field | Sheet Column |
|---|---|
| Project Code | `Project Code` (auto-generated) |
| Project Name | `Project Name` |
| Type | `Private / Govt` |
| Domestic / Inte | `Domestic / Inte` |
| Awarded Date | `Awarded Date` |
| Contract Amount | `Contract Amount` |
| Site Code | `Series` |
| Site Name | `Site Name` |
| Site Address Line 1/2 | `Site Address Line 1`, `Site Address Line 2` |
| City / State / PIN | `City`, `State`, `Pin Code` |
| Email / Contact 1 / Contact 2 | `Email ID`, `Contact 1`, `Contact 2` |
| Client Name / WO No / WO Date / Client GST | `Client Name`, `Work Order Number`, `WO Date`, `Client GST` |
| Site In-Charge / Reporting Manager | `Site In Charge Name`, `Reporting Manager Name` |
| Planning / Accounts In-Charge | `Planning In-Charge`, `Accounts In-Charge` |
| Active flag | `Active/Inactive` |
| Multi-GST | `GST` (pipe-separated `GSTN1|GSTN2|...`) |

Companies are loaded from the **Master** sheet (`1B2wb38KhNwlLoZnsAGWQkO0FdEGFFfsh3ycRRurigq4`, tab `Company`), employees from the **Employee Register** (`1HWKZPhKRhcuvxBgyyN8zRt8p-SzYmKjJWiOdCgykBHs`, tab `Employee`).

---

## Local dev

It's pure static HTML/CSS/JS — no build step. Open `index.html` in a browser. For full functionality (gviz reads, Apps Script writes), serve from a real origin (any static host) or run:

```bash
cd multipage && python3 -m http.server 8080
# then open http://localhost:8080
```

---

## Migration notes — from `project_setup_v1.html`

The original single-file `project_setup_v1.html` was a 3-tab app (Project Setup, BOQ, Team & In-Charges). In this multipage merge:

- **Project Setup** tab → `setup.html` + `assets/js/pages/setup.js`. The old "Team & In-Charges" content has been folded into the same form as a "Team" card, since they share the same `Project` row.
- **BOQ** tab → `boq.html` + `assets/js/pages/boq.js`. The AI assistant panel is preserved with the same Anthropic API call pattern, just relocated to a sticky-right column.
- **WBS** is new — added between BOQ and Workplan to capture the Step 3 hierarchy that the original v1 file didn't have.

If you have additional fields in the original v1 form that aren't in the new `FIELD_MAP` (`assets/js/pages/setup.js`), add them by:

1. Add an `<input id="f_xxx">` to `setup.html` inside an appropriate `<div class="card">`.
2. Add a `'Sheet Column Name': 'f_xxx'` line to `FIELD_MAP` at the top of `setup.js`.

That's it — `populateForm`, `collectForm`, and `save` all read off `FIELD_MAP` so no further wiring is needed.
