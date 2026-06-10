---
name: portal-release
description: Build, version, and release the EVGCPL portal correctly. Use whenever you bump the version, cut a release, run build-portal.js, resolve a version.json / HTML "?v=" merge conflict, or open+squash-merge a portal PR. Covers the commit-before-merge guard that prevents silently losing work, and choosing --minor vs --patch.
---

# Portal release & versioning

The portal is a static site. `assets/js/portal-bundle.js` is the source of truth;
`version.json` holds `{major,minor,patch,build,semver,builtAt}`. The build is
**deterministic from `version.json`** — only the starting `version.json` matters.

Bump ONLY via the build script (never hand-edit version constants or `version.json`):

```bash
node build-portal.js --minor   # new feature / feature batch  → 3.19.x → 3.20.0
node build-portal.js --patch   # fix / small tweak            → 3.20.0 → 3.20.1
node build-portal.js --major   # breaking change / redesign   → 3.x   → 4.0.0
```

The command bumps the chosen level **and always increments `build`**, stamps
`PORTAL_VERSION/BUILD/BUILD_AT` into `portal-bundle.js` and `pcc/.../config.js`,
cache-busts `?v=<build>` on every `*.html` asset ref, runs `node --check`, syncs
the top nav from `partials/topnav.html` into every page, then writes `version.json`.

## The one rule that prevents lost work

**Commit your code BEFORE any `git merge`, `git checkout --ours/--theirs`, or build.**

`git checkout --ours/--theirs <file>` resolves to the **committed** side — any
uncommitted working-tree edits are discarded silently. This once wiped an entire
feature; the follow-up commit captured only the version stamp, so the PR merged an
empty diff. If markers for your change are missing after a build, suspect this.

## Correct release sequence

1. Edit `portal-bundle.js` (and `partials/topnav.html` for nav). `node --check`.
2. **`git add -A && git commit`** the code now — before touching main or building.
3. `git fetch origin main && git merge origin/main --no-edit` (get latest `version.json`).
4. Build LAST: `node build-portal.js --minor` (or `--patch`). Build # increments
   from main's value → strictly sequential, always higher than main.
5. `git add -A && git commit` the build → push → open PR → squash-merge.

## version.json / `?v=` conflict after a squash merge (expected)

Code already committed (step 2), so only the version artifacts conflict:
1. `git checkout --theirs version.json` (main has the highest build; never keep the
   branch's older number). Leave your committed code untouched.
2. `git add -A && git commit --no-edit`
3. Re-run `node build-portal.js --minor|--patch` (bumps from main's number), commit.
4. Push and merge.

## Sanity checks before pushing
- `version.json` `build` is **strictly greater** than `origin/main`'s build.
- `grep -c "<a unique marker from your change>" assets/js/portal-bundle.js` > 0
  (confirms the build didn't ship an empty diff).
- `node --check assets/js/portal-bundle.js` passes (the build does this too).

## Notes
- PRs are squash-merged, so the branch diverges after every merge — re-sync main
  before the next build (step 3).
- The build sandbox has **no network egress to Google** (`Host not in allowlist`).
- Top nav is single-sourced in `partials/topnav.html` and injected by the build;
  edit the partial, not the per-page copies.
