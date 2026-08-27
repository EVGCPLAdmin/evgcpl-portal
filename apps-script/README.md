# EVGCPL Portal — Apps Script Backend

This folder contains all the server-side Google Apps Script code that the
portal calls. These files do **not** run from GitHub — they must be pasted
into a Google Apps Script project that's bound to the master spreadsheet,
and deployed as a Web App at:

```
https://script.google.com/macros/s/AKfycb…/exec
```

The `exec` URL is what the portal hits. It's stored in the runtime registry
and can be overridden per-environment from **Config → 🔗 Apps Script Endpoints**.

---

## Files in this folder

| File | Purpose | Notes |
|---|---|---|
| `Router.gs` | `doPost` / `doGet` entry points and the action → handler dispatch table | **Required.** Every other file's functions are routed from here. |
| `SafetyHandlers.gs` | `appendRow`, `updateCell`, `batchUpdate`, plus Safety incident close | Generic write API used by DPR, Reports, Onboarding, Safety |
| `AccountsHandlers.gs` | `saveNewPaymentRequest`, `saveAccountsUpdate`, `saveVendorOpeningBalance`, `createPRFolder`, `uploadPRAttachment`, `listPRAttachments` | Header-mapped appends to the Payment / Vendor Master sheets + PR attachment Drive ops |
| `RecruitmentHandlers.gs` | MRF / Offer / Joining recruitment actions | Backed by the Recruitment sheet |
| `PortalConfigBackend.gs` | `savePortalConfig`, `getPortalConfig` | PortalConfig tab read/write |
| `EmployeeProfileHandlers.gs` | Employee profile writes | HR profile module |
| `ScheduledReports.gs` | Time-driven email triggers; `saveScheduledReport`, `runReportNow` | Owns the daily/weekly/monthly trigger runner |
| `AIChat.gs` | `aiChat` action — Groq chat with system prompt assembly | Reads `GROQ_API_KEY` from Script Properties |
| `AiProxy.gs` | `aiProxy` — generic LLM proxy with Gemini fallback | Reads `GROQ_API_KEY` then `GEMINI_API_KEY` |
| `SheetDiagnostic.gs` | `diagnoseSheet`, `listShares` — server-side sharing checks | Powers the Sharing-Doctor page |
| `PCCHandlers.gs` | The 10 Project Cost Control actions: `saveProjectSetup`, `saveBOQ`, `saveWBS`, `saveWorkplan`, `saveManpower`, `saveMachinery`, `saveMaterials`, `saveOverheads`, `saveVariations`, `submitBudgetApproval` | Backed by sheet `1dQow9nD…` |
| `WorkplanHandlers.gs` | Optional helper file for workplan-specific logic if you want to split it out | Not currently routed; merged into PCCHandlers |
| `TallyVendorReconcile.gs` | Tally-vs-portal vendor reconciliation: `tvrSaveBatch`, `tvrGetStatus`, `tvrGetBatch`, `tvrSaveRules`, `tvrRunNow`, `tvrSetSign`, plus the daily 08:30 trigger `runDailyVendorReconcile` | Deployed in the **Accounts** project (with its own `Router.gs`), not `main`. Creates its four tabs on first use. |
| `WORKPLAN_SCHEMA.md` | Reference for the per-activity Workplan schema (15 columns) | Documentation only |

---

> **These files are NOT all in one project.** The portal's endpoint registry
> (`EXEC_REGISTRY_DEFAULTS` in `portal-bundle.js`) lists several deployments, and
> **each is a separate Apps Script project needing its own copy of `Router.gs`** —
> so "Router.gs" does not identify a deployment. Adding a server action means
> pasting the handler file into the right project *and* adding the route to **that
> project's** `Router.gs`. Each registry entry shows its `.gs` file list in
> **Config → 🔗 Apps Script Endpoints**.

## First-time install (per Apps Script project)

1. Open the master spreadsheet (the one tied to the `APPS_SCRIPT_URL` you're using).
2. **Extensions → Apps Script** opens the bound project.
3. For each `.gs` file in this folder:
   - In the Apps Script editor, click **+ → Script** and name it the same as the file (e.g. `Router`)
   - Open the file from this folder, copy ALL contents, paste into the new Apps Script file
   - Save (Ctrl+S)
4. **Project Settings → Script Properties** — add:
   - `GROQ_API_KEY` — your Groq API key (`gsk_…`) — get one free at console.groq.com
   - Optional: `GEMINI_API_KEY` — fallback if Groq is unavailable
5. **Deploy → New deployment**
   - Type: **Web app**
   - Description: `EVGCPL Portal v3.4.x`
   - Execute as: **Me** (your account)
   - Who has access: **Anyone** (so the portal can call without auth)
   - Click **Deploy**, copy the `/exec` URL
6. Update the portal: open the portal → Config → 🔗 Apps Script Endpoints → paste the URL into the `main` row → ✓ Save endpoints.

---

## Updating after code changes

After editing any `.gs` file:

1. Save in Apps Script editor.
2. **Deploy → Manage deployments → ✏️ on active deployment → Version: New version → Deploy.**
3. The exec URL stays the same. The new code is live within a few seconds.

> **Common gotcha:** Apps Script Web Apps cache the deployed snapshot. Editing a `.gs` file is **not enough** — you have to redeploy a new version for the change to be visible at the exec URL.

> **Do NOT use `Deploy → New deployment` to ship a code change.** That creates a
> *second* deployment with a **different** `/exec` URL, and the original keeps
> serving the OLD code instead of failing. Nothing errors — every portal still
> holding the old URL just silently runs against a stale backend until the value
> in `EXEC_REGISTRY_DEFAULTS` (and any saved override) is updated everywhere. Use
> `Manage deployments → ✏️ → Version: New version` instead: same URL, forever.
>
> If you already have a new URL and need the portal on it now, you do not need a
> code release — paste it into **Config → 🔗 Apps Script Endpoints** and use
> **⬇ Force update Sheets & T1** to push it org-wide via the PortalConfig sheet.

---

## Testing a deployment

From the portal:

1. **Config → 🔗 Apps Script Endpoints → ▶︎ Test all** — should show green pills for all five logical endpoints.

Or from the browser console on any portal page:

```javascript
fetch(getExec('main'), {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body: JSON.stringify({ action: '__ping__' })
}).then(r => r.json()).then(console.log);
```

Expected response:
```json
{ "success": true, "message": "pong", "deploymentTime": "2026-…" }
```

---

## Action map summary

These are the actions the Router knows about, by category. If the portal posts an action not in this list, you'll see `Unknown POST action: <name>` in the response.

| Category | Actions |
|---|---|
| Diagnostics | `__ping__` |
| Writes | `appendRow`, `updateCell`, `batchUpdate` |
| Safety | `closeSafetyIncident` |
| Reports | `saveScheduledReport`, `deleteScheduledReport`, `runReportNow` |
| AI | `aiChat`, `aiProxy` |
| Sheet | `diagnoseSheet`, `listShares` |
| PCC | `saveProjectSetup`, `saveBOQ`, `saveWBS`, `saveWorkplan`, `saveManpower`, `saveMachinery`, `saveMaterials`, `saveOverheads`, `saveVariations`, `submitBudgetApproval` |
| Accounts | `saveNewPaymentRequest`, `saveAccountsUpdate`, `saveVendorOpeningBalance`, `createPRFolder`, `uploadPRAttachment`, `listPRAttachments` |
| Reconciliation | `tvrSaveBatch`, `tvrGetStatus`, `tvrGetBatch`, `tvrSaveRules`, `tvrRunNow`, `tvrSetSign` |
| Portal config | `savePortalConfig`, `getPortalConfig` |
| PIN | `verifyPin`, `resetPin` |

Adding a new action:
1. Add the function in the appropriate `.gs` file (or a new one)
2. Add a route in `Router.gs → doPost` (and update this README)
3. Redeploy
