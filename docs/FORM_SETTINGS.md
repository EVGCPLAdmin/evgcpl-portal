# Form Settings

Forms are governed by `window.EVG.form` and the `.evg-form` CSS class.

## EVG.form defaults (`portal-bundle.js`)

```js
EVG.form = {
  labelPosition: 'top',   // 'top' | 'left'
  density:       'normal', // 'normal' | 'compact'
  validationMode:'submit', // 'submit' | 'blur' | 'live'
};
```

## Standard form markup

```html
<form class="evg-form" onsubmit="handleSubmit(event)">
  <div class="form-group">
    <label>Field Label</label>
    <input type="text" name="fieldName" required>
    <span class="form-error"></span>
  </div>
  <button type="submit">Save</button>
</form>
```

## Field types from Schema Manager

When a field schema is saved for a sheet/tab, forms reading that schema should render the appropriate input:

| Schema Type | Input to render |
|-------------|----------------|
| Text | `<input type="text">` |
| Number | `<input type="number">` |
| Date | `<input type="date">` |
| Currency | `<input type="number" step="0.01">` with ₹ prefix |
| Email | `<input type="email">` |
| Phone | `<input type="tel">` |
| Boolean | `<input type="checkbox">` |
| Select | `<select>` with values from schema `options` array |

Load the schema for a sheet/tab:

```js
const schema = pcReadJSON('field_schema_STORES_StockIN', {});
// schema[colName] = { type, label, required }
```

## Per-user arrangement

Column/field order resolves:
1. Personal `localStorage` (key: `acc_default_order_fields` etc.)
2. System default from PortalConfig (`acc_default_order_fields`)
3. Compiled default in `portal-bundle.js`

Admins push system defaults via the save buttons on the Accounts Voucher / Column settings panels — they post to `savePortalConfig`.

## Validation

Required fields defined in the schema (`required: true`) should be validated before submission. Pattern:

```js
function validateForm(schema, data) {
  const errors = {};
  Object.entries(schema).forEach(([col, def]) => {
    if (def.required && !data[col]) errors[col] = `${def.label || col} is required`;
  });
  return errors;
}
```
