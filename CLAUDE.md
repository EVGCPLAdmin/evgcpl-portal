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

**Correct sequence for every change:**
1. Make the code change in `portal-bundle.js` (and run `node --check` to verify).
2. `git fetch origin main && git merge origin/main --no-edit` to get the latest
   `version.json` **before** building.
3. Run `node build-portal.js --patch` **as the final step** so the build number
   increments from main's current value (strictly sequential, always higher).
4. Commit, push, open the PR.

### Resolving a version.json / HTML `?v=` merge conflict

These conflicts are expected after a squash merge. Resolve them like this — do
**not** hand-merge the numbers:

1. Keep your code: `git checkout --ours <code files>` (e.g. `portal-bundle.js`).
2. Take **main's** `version.json`: `git checkout --theirs version.json`
   (main has the highest released build number; never keep the branch's older one).
3. `git add -A && git commit --no-edit`
4. Re-run `node build-portal.js --patch` so the version bumps **from main's
   number** (guarantees the new build > main's build), then commit that.
5. Push and merge.

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
- **Top navigation is hand-coded static HTML duplicated across every page file**
  (`accounts.html`, `dashboard.html`, `scm.html`, `site-ops.html`, etc.) — it is
  **not** generated from `MODULE_REGISTRY`. `MODULE_REGISTRY` (`section:` field)
  drives role/permission visibility and the Dev-Mode module list only. To change
  what the menu actually shows, edit the `.tnav-group` / `.tnav-item` blocks in
  **all** the page HTML files (keep them in sync), then `node build-portal.js`.
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
