# Defaults & Configuration Priority

## Resolution order (highest → lowest)

For any configurable value, the portal reads in this order and stops at the first hit:

1. **Personal localStorage** — user-specific override saved by the browser
2. **PortalConfig sheet** — org-wide default set by an admin; cached in `window._SHEET_CONFIG`
3. **Compiled default** — value hardcoded in `portal-bundle.js`

## PortalConfig keys

| Key | Type | Set by | Used by |
|-----|------|--------|---------|
| `tbl_cols` | JSON | Access & Pages admin | EVG column manager |
| `evg_tbl_widths` | JSON | Access & Pages admin | EVG column resize |
| `acc_default_columns` | JSON | Accounts settings | Accounts list view |
| `acc_default_order_fields` | JSON | Accounts settings | Voucher field order |
| `acc_default_voucher_blocks` | JSON | Accounts settings | Voucher block layout |
| `field_schema_<KEY>_<TAB>` | JSON | Schema Manager page | Forms, exports |
| `exec_<key>` | string | Endpoints card (Config page) | `getExec(key)` |
| `modules.<route>.status` | string | Access & Pages tab | `applyPortalConfig()` |
| `modules.<route>.roles` | string[] | Access & Pages tab | `applyPortalConfig()` |

## EVG design system defaults

Global component defaults live in `window.EVG` in `portal-bundle.js`:

```js
EVG.table     = { wrap, resize, columnManager, gutter, scrollbar }
EVG.card      = { /* KPI card */ }
EVG.form      = { labelPosition, density, validationMode }
EVG.dashboard = { /* layout */ }
```

Changing these affects every instance. Opt out per-element with `data-evg-defaults="off"`.

## Sheet ID overrides

Default spreadsheet IDs are in `SHEETS_DIRECTORY` (8 sheets). Users can override them per-session in **Settings → Sheet IDs**; admins can push org-wide IDs via the **Sheet Linking** card in the Configuration page.

Resolution inside `getSheetId(key)`:
1. `loadSettingsOverrides().sheets[key]` (personal localStorage)
2. `SHEETS_DIRECTORY.find(s => s.key === key).defaultId` (compiled)

## Exec endpoint overrides

Apps Script URLs are in `EXEC_REGISTRY_DEFAULTS`. Override per-endpoint in **Configuration → Endpoints**. Stored under `exec_<key>` in PortalConfig.

Resolution inside `getExec(key)`:
1. `getExecOverrides()[key]` (cached from PortalConfig / localStorage)
2. `EXEC_REGISTRY_DEFAULTS[key].defaultUrl` (compiled)

## Dev Mode

Toggled via Admin dropdown → Dev Mode (or sidebar Admin section). Persists in `localStorage` under key `devMode`. Activating shows extra debug panels and disables some read-only guards. All sessions for the same browser share the same flag.

## Build version

`version.json` is the canonical source. Never hand-edit it — use `node build-portal.js --patch|--minor|--major`. The build stamps the version into `portal-bundle.js` and all HTML files.
