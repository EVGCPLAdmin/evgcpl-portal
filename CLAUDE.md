# EVGCPL Portal — working notes for Claude

## Build & versioning (do this correctly — it has bitten us)

The portal is a static site. `assets/js/portal-bundle.js` is the source of truth;
`version.json` holds `{major,minor,patch,build,semver,builtAt}`.

**Never hand-edit version constants or `version.json`.** The only way to bump a
version is:

```bash
node build-portal.js --patch     # or --minor / --major
```

That single command:
- bumps `patch` (or minor/major) **and always increments `build`**,
- stamps `PORTAL_VERSION/BUILD/BUILD_AT` into `portal-bundle.js` and `pcc/.../config.js`,
- cache-busts `?v=<build>` on every `*.html` asset reference,
- runs `node --check`, then writes `version.json`.

So the build is **deterministic from `version.json`** — only the starting
`version.json` matters.

### The golden rule: build LAST, from main's latest version.json

PRs are **squash-merged**, so after every merge `main` gets a new single commit
and this branch diverges. If you bump the version off a stale base, the next PR
conflicts on `version.json` (and the HTML `?v=` stamps), and resolving with
`--ours` can keep an **older** build number → the version stagnates or goes
backwards. That is the bug to avoid.

### ⚠️ COMMIT YOUR CODE FIRST — before any merge or build

This bit us hard: an uncommitted feature was **silently destroyed** by a
`git checkout --ours assets/js/portal-bundle.js` run during the merge/build dance.
`git checkout --ours/--theirs <file>` resolves to the **committed** side — any
uncommitted working-tree edits are discarded with no warning, and the commit that
follows captures only the version stamp (the feature "ships" as an empty diff).

**Rule: never run `git merge`, `git checkout --ours/--theirs`, or `build-portal.js`
with uncommitted code edits in the tree. Commit first.**

**Correct sequence for every change:**
1. Make the code change in `portal-bundle.js`; run `node --check` to verify.
2. **`git add -A && git commit`** the code change NOW (so it can't be lost).
3. `git fetch origin main && git merge origin/main --no-edit` to get the latest
   `version.json` before building.
4. Run the build **as the final step** — `--minor` for a feature/feature-batch
   release, `--patch` for fixes, `--major` for breaking changes. The build number
   always increments from main's current value (strictly sequential, always higher).
5. `git add -A && git commit` the build, push, open the PR.

### Release level: minor vs patch
- `--patch` — bug fixes / small tweaks within a feature already shipped.
- `--minor` — a new feature or a batch of features (the usual choice when wrapping
  up a chunk of work). Resets `patch` to 0, e.g. `3.19.x → 3.20.0`.
- `--major` — breaking changes / a redesign.
Don't let a feature go out as a long string of `--patch` bumps; cut a `--minor`.

### Resolving a version.json / HTML `?v=` merge conflict

Expected after a squash merge. With your **code already committed** (see above),
resolve like this — do **not** hand-merge the numbers:

1. Take **main's** `version.json`: `git checkout --theirs version.json`
   (main has the highest released build number; never keep the branch's older one).
   Your committed code files are safe — only touch `version.json` here.
2. `git add -A && git commit --no-edit`
3. Re-run `node build-portal.js --minor|--patch` so the version bumps **from main's
   number** (guarantees the new build > main's build), then commit that.
4. Push and merge.

The HTML `?v=<build>` stamp conflicts don't need manual care — the rebuild in
step 4 overwrites them all consistently.

### Sanity check before pushing
- `version.json` `build` is **strictly greater** than `origin/main`'s build.
- `node --check assets/js/portal-bundle.js` passes (the build does this too).

## Git / PR workflow
- Develop on the assigned feature branch; never push to `main` directly.
- Push with `git push -u origin <branch>`; retry on network errors.
- Only create a PR when asked; squash-merge.
- End commit messages / PR bodies with the session URL footer.

## Architecture gotchas
- **⚠️ EVERY new page/route MUST be registered in `MODULE_REGISTRY`.**
  `applyPortalConfig()` rebuilds `ROLE_ROUTES` *entirely* from `MODULE_REGISTRY`
  on every load, so any navigable route that is **not** in the registry is
  silently stripped from the route set and `applyRoleNavRestrictions()` then
  **hides its nav button** (this is the bug that kept Data Hub invisible for
  builds). When you add a page you must, together:
  1. add a `{ route, label, section, defStatus, defRoles }` entry to
     `MODULE_REGISTRY`,
  2. add the route → render fn to the `pages` map in `renderPage()`,
  3. add the route → page file to `ROUTE_TO_PAGE` in `multi-page-bootstrap.js`,
  4. add the nav entry (top nav **and** mobile `#sidebar` — they're separate).
  A load-time `_routeRegistryAudit()` console-warns for any nav route missing
  from the registry, and `applyPortalConfig()` unions `window._RENDER_ROUTES`
  into md's set as a backstop — but registering the module is the real fix.
  Level-3 sub-pages (`NAV_SUBMENUS` children) render inside their parent page
  and are intentionally NOT registered.
- **Both navs are hand-coded and duplicated per page file** — the desktop top
  nav (`.tnav-group`/`.tnav-item` in `<nav id="topNav">`) AND the mobile
  `<nav class="sidebar">` (`.sidebar-section`/`.nav-item`). The build only syncs
  the top nav from `partials/topnav.html`; the sidebar is per-file. New menu
  items added at runtime go through `_navEnsureInjected()` (which injects into
  **both**). `MODULE_REGISTRY` does not generate either nav.
- **Access control = one tab.** "Access & Pages" (`_cfgRenderAccess`) holds both
  the per-page Live/Dev/Off status (`uaSetModuleStatus`) and the Access-Groups
  route/action grants. The old "Modules & Roles" tab (`_cfgRenderModules`) was
  retired as a duplicate — don't reintroduce a separate role matrix.
- Accounts data: `_accReloadRows()` → `window._accAllRows` via `_accMapRow`.
  Stage model: `ACC_VIEWS`, `_accStageOf`, `_accViewById`, `_accCanAdvance`,
  `_accAdvance`. Voucher: `_accOpenPRDetail`. Reuse these rather than re-fetching.
- Per-user arrangement config (table columns / voucher fields / voucher blocks)
  resolves: **personal localStorage → system default (PortalConfig sheet) →
  compiled default**. System defaults are written via the `savePortalConfig`
  backend under keys `acc_default_columns`, `acc_default_order_fields`,
  `acc_default_voucher_blocks`.
- The build sandbox has **no network egress to Google** (`Host not in allowlist`),
  so live Sheets can't be inspected from here — the runtime browser still can.
