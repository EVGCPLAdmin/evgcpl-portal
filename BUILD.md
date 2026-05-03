# EVGCPL Portal — Build Process

## Versioning scheme

`v{MAJOR}.{MINOR}.{PATCH}`  +  monotonic `build` integer

- **MAJOR** — bumped on architectural rewrites (e.g. v2 → v3 multipage migration)
- **MINOR** — bumped when new modules / sections ship (e.g. PCC integration, AI Agent)
- **PATCH** — bumped on bug fixes and small enhancements
- **build** — auto-incremented every time the build script runs (always increases)

## Build & ship a new version

```bash
cd <repo>
node build-portal.js              # patch-level bump (just build++)
node build-portal.js --patch      # bumps PATCH + build
node build-portal.js --minor      # bumps MINOR (resets PATCH=0) + build
node build-portal.js --major      # bumps MAJOR (resets MINOR=0,PATCH=0) + build
node build-portal.js --version=4.0.0   # explicit semver + build++
```

The script will:
1. Read `version.json` (canonical version state)
2. Apply the bump
3. Patch `PORTAL_VERSION`, `PORTAL_BUILD`, `PORTAL_BUILD_AT` constants in `assets/js/portal-bundle.js`
4. Run `node --check` on the bundle
5. Save the new `version.json`
6. Create a versioned zip: `EVGCPL_Portal_v{semver}_build{n}_{YYYYMMDD}.zip`

## Footer display

The version + build + date appear at the bottom of every page in the portal,
injected by `multi-page-bootstrap.js → injectPortalFooter()`.

Format: `EVGCPL Portal · v3.1.0 · build 313 · 2026-05-03`
