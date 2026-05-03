#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════
   EVGCPL Portal — Build Script
   ────────────────────────────────────────────────────────────────────
   Run this every time a new portal package is produced.

   What it does:
     1. Reads version.json  (next to this script)
     2. Increments PORTAL_BUILD by 1
     3. Updates PORTAL_BUILD_AT to current ISO timestamp
     4. Patches the three constants inside portal-bundle.js
     5. Validates JS syntax with `node --check`
     6. Copies the build into /mnt/user-data/outputs/portal_v3/
     7. Creates a versioned zip:
          EVGCPL_Portal_v{semver}_build{n}_{YYYYMMDD}.zip

   Usage:
     node build-portal.js              # increments build by 1
     node build-portal.js --major      # bumps major (resets minor=0,patch=0)
     node build-portal.js --minor      # bumps minor (resets patch=0)
     node build-portal.js --patch      # bumps patch
     node build-portal.js --version=4.0.0   # explicit semver
   ════════════════════════════════════════════════════════════════════ */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Paths (resolved relative to this script) ──
// When run from inside the portal repo, ROOT = the repo dir.
// When run from /home/claude (dev mode), ROOT = /home/claude/portal_v3.
const SCRIPT_DIR = __dirname;
const ROOT = fs.existsSync(path.join(SCRIPT_DIR, 'assets/js/portal-bundle.js'))
  ? SCRIPT_DIR
  : path.join(SCRIPT_DIR, 'portal_v3');

const BUNDLE     = path.join(ROOT, 'assets/js/portal-bundle.js');
const VERSION_FILE = path.join(ROOT, 'version.json');
const OUTPUT_DIR = process.env.OUTPUT_DIR || (fs.existsSync('/mnt/user-data/outputs') ? '/mnt/user-data/outputs' : SCRIPT_DIR);

// ── Parse args ──
const args = process.argv.slice(2);
const flags = {
  major: args.includes('--major'),
  minor: args.includes('--minor'),
  patch: args.includes('--patch'),
};
const explicitVer = (args.find(a => a.startsWith('--version=')) || '').split('=')[1];

// ── Read or initialize version ──
let v;
try {
  v = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
} catch (_) {
  v = { major: 3, minor: 1, patch: 0, build: 312 };
}

// ── Apply version bump ──
if (explicitVer) {
  const m = explicitVer.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) { console.error('Invalid --version. Use X.Y.Z'); process.exit(1); }
  v.major = +m[1]; v.minor = +m[2]; v.patch = +m[3];
} else if (flags.major) {
  v.major += 1; v.minor = 0; v.patch = 0;
} else if (flags.minor) {
  v.minor += 1; v.patch = 0;
} else if (flags.patch) {
  v.patch += 1;
}
// Always bump build
v.build += 1;
const now = new Date();
v.builtAt = now.toISOString().replace(/\.\d+Z$/, 'Z'); // strip ms
v.semver  = `${v.major}.${v.minor}.${v.patch}`;

// ── Patch portal-bundle.js ──
let src = fs.readFileSync(BUNDLE, 'utf8');
const before = src.length;

src = src.replace(/const\s+PORTAL_VERSION\s*=\s*'[^']*'\s*;/, `const PORTAL_VERSION  = '${v.semver}';`);
src = src.replace(/const\s+PORTAL_BUILD\s*=\s*\d+\s*;/,        `const PORTAL_BUILD    = ${v.build};`);
src = src.replace(/const\s+PORTAL_BUILD_AT\s*=\s*'[^']*'\s*;/, `const PORTAL_BUILD_AT = '${v.builtAt}';`);

// Confirm all three constants got patched
const checks = [
  [`PORTAL_VERSION  = '${v.semver}'`,  'version'],
  [`PORTAL_BUILD    = ${v.build}`,     'build'],
  [`PORTAL_BUILD_AT = '${v.builtAt}'`, 'timestamp'],
];
let ok = true;
checks.forEach(([needle, label]) => {
  if (!src.includes(needle)) {
    console.error(`✗ Failed to patch ${label} in bundle`);
    ok = false;
  }
});
if (!ok) process.exit(1);

fs.writeFileSync(BUNDLE, src);
console.log(`✓ Patched portal-bundle.js (${before} → ${src.length} bytes)`);

// ── Validate JS ──
try {
  execSync(`node --check "${BUNDLE}"`, { stdio: 'pipe' });
  console.log('✓ JS syntax valid');
} catch (e) {
  console.error('✗ JS syntax check FAILED:');
  console.error(e.stderr.toString());
  process.exit(1);
}

// ── Save version.json ──
fs.writeFileSync(VERSION_FILE, JSON.stringify(v, null, 2));
console.log(`✓ version.json updated → v${v.semver} build ${v.build}`);

// ── Create versioned zip ──
const dateStamp = v.builtAt.slice(0, 10).replace(/-/g, '');
const zipName   = `EVGCPL_Portal_v${v.semver}_build${v.build}_${dateStamp}.zip`;
const zipPath   = path.join(OUTPUT_DIR, zipName);

// Clean previous version zips so the output dir doesn't fill up
try {
  execSync(`find "${OUTPUT_DIR}" -maxdepth 1 -name 'EVGCPL_Portal_v*.zip' -delete 2>/dev/null || true`);
} catch (_) {}

const stagingMode = (ROOT !== SCRIPT_DIR); // dev mode (sandbox) — copy then zip
if (stagingMode) {
  const stagingDir = path.join(OUTPUT_DIR, 'portal_v3');
  try { execSync(`rm -rf "${stagingDir}"`); } catch (_) {}
  execSync(`cp -r "${ROOT}" "${stagingDir}"`);
  execSync(`cd "${OUTPUT_DIR}" && zip -qr "${zipName}" portal_v3/`);
} else {
  // Local mode — zip the repo contents (excluding .git, node_modules, *.zip)
  // Works on Windows PowerShell via Compress-Archive fallback if zip not present.
  try {
    execSync(`cd "${ROOT}" && zip -qr "${zipPath}" . -x ".git/*" "node_modules/*" "*.zip"`);
  } catch (_) {
    // Fallback for Windows without zip — use PowerShell Compress-Archive
    const psCmd = `Compress-Archive -Path '${ROOT}\\*' -DestinationPath '${zipPath}' -Force`;
    execSync(`powershell -Command "${psCmd.replace(/"/g, '\\"')}"`, { shell: true });
  }
}

const stat = fs.statSync(zipPath);
console.log(`✓ Bundled: ${zipName} (${(stat.size / 1024).toFixed(1)} KB)`);
console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Portal v${v.semver}  ·  build ${v.build}  ·  ${v.builtAt.slice(0,10)}`);
console.log('═══════════════════════════════════════════════════════════');
