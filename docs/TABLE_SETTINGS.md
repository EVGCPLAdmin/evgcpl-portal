# Table Settings

All tables in the portal are rendered through the EVG design system. The base config lives in `window.EVG.table` and is applied via `applyTableFeatures()`.

## EVG.table defaults (`portal-bundle.js`)

```js
EVG.table = {
  wrap:          true,   // horizontal scroll wrapper
  resize:        true,   // drag column-width handles
  columnManager: true,   // ⚙ Columns button (reorder / show-hide)
  gutter:        true,   // left gutter column
  scrollbar:     'thin', // 'thin' | 'none'
};
```

To override globally, edit the `EVG.table` object. To opt a single table out, add `data-evg-defaults="off"` on the table or an ancestor element.

## Column Manager (per-user and org-wide)

The ⚙ Columns button lets users:
- Drag to reorder columns
- Toggle show/hide per column
- ★ Set as default (saves to `localStorage` under key `evg_tbl_cols`)

Admins can push an org-wide default via **PortalConfig** under keys:
- `tbl_cols`      — column order/visibility
- `evg_tbl_widths` — column widths

Only simple 1-column-per-field list tables are eligible. The Open PO table has its own chooser and is excluded.

## Per-instance overrides

Pass an overrides object as the second argument to `applyTableFeatures()`:

```js
applyTableFeatures(tableEl, { resize: false, gutter: false });
```

## Field types (Schema Manager)

The **Schema / Field-Type Manager** page (`navigate('schema')`) lets admins define per-column types that forms and exports can consume:

| Type | Behaviour |
|------|-----------|
| Text | Default — raw string |
| Number | Numeric, right-aligned |
| Date | Formatted as DD-MMM-YYYY |
| Currency | ₹ formatted, right-aligned |
| Email | Rendered as mailto link |
| Phone | tel: link |
| Boolean | ✓ / ✗ chip |
| Select | Dropdown in edit mode |

Saved to PortalConfig under `field_schema_<SHEET_KEY>_<TAB>`.

## Rendering a table

```js
const tableEl = document.createElement('table');
tableEl.className = 'data-table';
tableEl.innerHTML = `<thead>...</thead><tbody>...</tbody>`;
container.appendChild(tableEl);
applyTableFeatures(tableEl);
```
