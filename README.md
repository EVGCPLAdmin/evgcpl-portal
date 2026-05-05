# EVGCPL Portal — Complete Package

**Build:** v3.4.1 · build 321 · 2026-05-05

This is the complete deliverable: portal frontend, Apps Script backend, and project documentation in one zip. Everything you need to deploy or audit the portal.

## What's in this package

```
.
├── README.md                              ← you are here
├── BUILD.md                               ← build script reference
├── version.json                           ← canonical version state
├── build-portal.js                        ← run to make a new build
├── EVGCPL_Portal_ProjectDocument_v6.docx  ← project doc (Word format)
├── EVGCPL_Portal_ProjectDocument_v6.pdf   ← project doc (PDF format)
│
├── Frontend (HTML pages)
│   ├── index.html (login)
│   ├── dashboard.html
│   ├── hr.html · scm.html · site-ops.html · planning.html
│   ├── accounts.html · reports.html · apps.html · plant.html
│   ├── config.html · external.html · sharing-doctor.html
│   └── assets/
│       ├── js/portal-bundle.js          ← main shared bundle (821KB)
│       ├── js/multi-page-bootstrap.js
│       ├── css/portal.css
│       └── img/EG.jpg
│
├── pcc/                                   ← Project Cost Control subapp
│   ├── 11 HTML pages (Setup, BOQ, WBS, Workplan, Manpower, etc.)
│   ├── assets/                            ← own JS + CSS
│   ├── AppsScript_Handlers.gs             ← copy in apps-script/PCCHandlers.gs
│   └── README.md
│
└── apps-script/                           ← server-side .gs files
    ├── Router.gs                          ← doPost/doGet entry + dispatch
    ├── SafetyHandlers.gs                  ← appendRow, updateCell, batchUpdate
    ├── ScheduledReports.gs                ← time-driven email triggers
    ├── AIChat.gs                          ← Groq chat proxy
    ├── AiProxy.gs                         ← generic LLM proxy w/ Gemini fallback
    ├── SheetDiagnostic.gs                 ← sharing diagnostics
    ├── PCCHandlers.gs                     ← 10 PCC actions
    ├── WorkplanHandlers.gs                ← optional workplan-specific helpers
    ├── WORKPLAN_SCHEMA.md                 ← schema reference
    └── README.md                          ← install + deploy instructions
```

## Quick deploy (3 steps)

### 1. Push the frontend to GitHub Pages

```powershell
cd C:\Users\1234\Downloads\Portal2\EVGCPL_Deploy
git pull origin main

# Extract this zip's CONTENTS (no portal_v3 wrapper)
Expand-Archive -Path "$env:USERPROFILE\Downloads\EVGCPL_Portal_v3.4.1_build321_20260505.zip" -DestinationPath "$env:TEMP\evgcpl_v341" -Force
Copy-Item -Path "$env:TEMP\evgcpl_v341\*" -Destination . -Recurse -Force

git add -A
git commit -m "v3.4.1 build 321: Endpoint Registry + PO_Actual + comprehensive package"
git push origin main
```

GitHub Pages picks it up in ~60 seconds.

### 2. Deploy the Apps Script backend

Open the Google Apps Script project bound to your master spreadsheet:
1. **Extensions → Apps Script** from the master sheet
2. For each `.gs` file in `apps-script/`, click **+ → Script** in the editor and paste in the contents (name files the same as their source filenames)
3. **Deploy → Manage deployments → ✏️ → New version → Deploy**
4. Copy the `/exec` URL

See `apps-script/README.md` for full deploy details.

### 3. Verify

1. Open the portal, hard-refresh
2. Go to **Config → 🔗 Apps Script Endpoints**
3. Click **▶︎ Test all** — all 5 endpoints should turn green
4. Open **Planning → Budgeting** and try saving a project — should succeed

## Documentation

- **EVGCPL_Portal_ProjectDocument_v6.docx** — full project document (11 sections)
- **apps-script/README.md** — server-side install/deploy guide
- **BUILD.md** — how to bump versions and produce new builds
- **pcc/README.md** — Project Cost Control specifics

## Versioning

Run from this folder:

```bash
node build-portal.js              # auto-bump build only
node build-portal.js --patch      # 3.4.1 → 3.4.2, build++
node build-portal.js --minor      # 3.4.1 → 3.5.0, build++
node build-portal.js --major      # 3.4.1 → 4.0.0, build++
```

Each build:
- Increments `PORTAL_BUILD` (monotonic integer)
- Updates `PORTAL_BUILD_AT` timestamp
- Patches `portal-bundle.js` constants
- Validates JS syntax
- Creates a versioned zip: `EVGCPL_Portal_v{semver}_build{n}_{YYYYMMDD}.zip`

The version stamps appear in the footer of every page in the portal.
