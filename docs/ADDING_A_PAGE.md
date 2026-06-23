# Adding a New Page

Every navigable route in the portal requires four registration steps. Missing any one of them will silently hide the page from navigation.

## 1. Register in `MODULE_REGISTRY` (`portal-bundle.js`)

Find `const MODULE_REGISTRY = [` and add:

```js
{ route:'your-route', label:'Page Label', section:'SectionName', defStatus:'live', defRoles:['md','acc'] },
```

- `route` — must be a unique lowercase slug with no slashes.
- `section` — groups the page in the Access & Pages admin panel.
- `defStatus` — `'live'` | `'dev'` | `'off'`.
- `defRoles` — array of role keys that get access by default.

## 2. Add to the pages dispatch map in `renderPage()` (`portal-bundle.js`)

Find the `pages` object inside `renderPage()` and add:

```js
'your-route': renderYourPage,
```

## 3. Register in `ROUTE_TO_PAGE` (`multi-page-bootstrap.js`)

Find `const ROUTE_TO_PAGE = {` and add:

```js
'your-route': 'dashboard.html',
```

Use `'dashboard.html'` for standard authenticated pages. External/login-only pages get their own file.

## 4. Add to both navs

### Desktop top nav (`partials/topnav.html`)

Add inside the appropriate `<div class="tnav-group">`:

```html
<button class="tnav-item" data-route="your-route" onclick="navigate('your-route')">
  Label
</button>
```

### Mobile sidebar (`partials/sidebar.html`)

Add inside the matching `<div class="sidebar-section">`:

```html
<button class="nav-item" data-route="your-route" onclick="navigate('your-route')">
  <span class="nav-icon">📄</span>
  <span class="nav-label">Label</span>
</button>
```

After editing either partial, run the build to sync all page files:

```bash
node build-portal.js --patch
```

## 5. Write the render function

```js
function renderYourPage() {
  const el = document.getElementById('mainContent');
  el.innerHTML = `<div class="page-header">...</div>...`;
}
```

## Build and ship

```bash
# 1. Commit code
git add -A && git commit -m "feat: add YourPage"

# 2. Merge latest version.json
git fetch origin main && git merge origin/main --no-edit

# 3. Build (--minor for a new feature)
node build-portal.js --minor

# 4. Commit build + push
git add -A && git commit -m "build: v$(node -e 'const v=require(\"./version.json\");console.log(v.semver)')"
git push -u origin <branch>
```
