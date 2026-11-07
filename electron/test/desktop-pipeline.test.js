// Desktop release pipeline guards (no Electron, no network, nothing published).
// Run: npm run test:electron
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.join(__dirname, '..', '..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release-desktop.yml'), 'utf8');
const BUILD = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).build;

// semver / minimatch are transitive deps (electron-updater / electron-builder): resolve them the way
// those libs do, and skip (not fail) in a checkout without node_modules — that was the "baseline
// failure" (MODULE_NOT_FOUND 'semver') that killed every test in this file.
function optionalDep(name, via) {
  try { return require(require.resolve(name, { paths: [path.dirname(require.resolve(`${via}/package.json`))] })); } catch { return null; }
}
const semver = optionalDep('semver', 'electron-updater'); // the same lib electron-updater compares with
const minimatchMod = optionalDep('minimatch', 'app-builder-lib'); // the same lib electron-builder matches `files` with

test('dev builds "<base>-dev.<run>" update build-to-build and never downgrade to/from stable', { skip: !semver && 'npm ci first (semver)' }, () => {
  // generic provider: electron-updater only needs semver.gt(latest, current)
  // (allowPrerelease is a GitHub-provider-only switch, so no updater change is needed).
  assert.ok(semver.gt('1.2.0-dev.11', '1.2.0-dev.9'), 'numeric prerelease ids compare as numbers');
  assert.ok(semver.gt('1.2.0-dev.1', '1.1.9'));
  assert.ok(semver.gt('1.2.0', '1.2.0-dev.99'), 'a stable release outranks its own dev builds');
});

test('--finish-pending skips stale/failed/finished submissions and exits 0 on an empty state dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-state-'));
  const script = path.join(__dirname, '..', '..', 'tools', 'desktop-release.mjs');
  const run = () => spawnSync(process.execPath, [script, '--finish-pending'], {
    encoding: 'utf8', env: { ...process.env, PF_RELEASE_STATE_DIR: dir },
  });
  assert.equal(run().status, 0);
  const old = new Date(Date.now() - 8 * 86400e3).toISOString();
  fs.writeFileSync(path.join(dir, 'dev-mac-1.0.0-dev.1.json'), JSON.stringify({ submissionId: 'x', submittedAt: old, published: true, publishedUnstapled: true }));
  fs.writeFileSync(path.join(dir, 'dev-mac-1.0.0-dev.2.json'), JSON.stringify({ submissionId: 'x', failed: 'Invalid', submittedAt: new Date().toISOString() }));
  fs.writeFileSync(path.join(dir, 'dev-mac-1.0.0-dev.3.json'), JSON.stringify({ submissionId: 'x', finishedAt: old, submittedAt: old }));
  const r = run();
  assert.equal(r.status, 0);
  assert.match(r.stdout, /pending > 7 days/);
  assert.doesNotMatch(r.stdout, /finishing pending/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--finish scans the app it just stapled for leaked credentials, and never needs dist/electron', () => {
  // The scheduled finisher runs in a fresh checkout with no build output; it used to
  // crash in the leak guard (readdir of the missing dist/electron) after stapling.
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'desktop-release.mjs'), 'utf8');
  assert.match(src, /function findAsar\(osName\) \{\s*if \(!fs\.existsSync\(OUT_DIR\)\) return null;/);
  assert.match(src, /assertNoLeakedSecrets\('mac', creds, path\.join\(appPath, 'Contents', 'Resources', 'app\.asar'\)\)/);
  const finish = src.slice(src.indexOf('async function actionFinish'), src.indexOf('function actionFinishPending'));
  assert.ok(finish.indexOf('assertNoLeakedSecrets') < finish.indexOf('cleanup()'), 'scan before the stapled app is deleted');
});

// ── Windows on the dev PC ──────────────────────────────────────────────────
function job(name) {
  const m = new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n|$)`).exec(WORKFLOW);
  assert.ok(m, `job ${name} exists`);
  return m[1];
}

test('workflow: windows job is routed by PF_WIN_RUNNER with the Mac as fallback; mac jobs stay on the Mac', () => {
  const win = job('windows');
  assert.match(win, /runs-on: \$\{\{ fromJSON\(vars\.PF_WIN_RUNNER \|\| '\["self-hosted","macOS","ARM64","pf-mac"\]'\) \}\}/);
  assert.match(win, /needs: plan\n/, 'windows only waits for plan, so it runs in parallel with mac');
  assert.match(win, /--win\b/);
  assert.doesNotMatch(win, /--mac\b/);
  for (const j of ['plan', 'mac', 'mac-finish']) assert.match(job(j), /runs-on: \[self-hosted, macOS, ARM64, pf-mac\]/, `${j} needs the Mac keychain`);
  // the documented variable value must be valid JSON naming the PC's labels
  const m = /PF_WIN_RUNNER = (\[[^\]]+\])/.exec(WORKFLOW);
  assert.ok(m, 'header documents the PF_WIN_RUNNER value');
  assert.deepEqual(JSON.parse(m[1]), ['self-hosted', 'Linux', 'X64', 'pf-win-build']);
});

test('workflow: a Linux windows runner checks wine + release creds before building', () => {
  const win = job('windows');
  const pre = win.indexOf("if: runner.os == 'Linux'");
  assert.ok(pre > 0 && pre < win.indexOf('npm ci'), 'preflight runs before npm ci');
  assert.match(win, /command -v wine/);
  assert.match(win, /release-spaces\.env/);
});

test('release script: --win on Linux needs wine and fails before the Angular build', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'desktop-release.mjs'), 'utf8');
  assert.match(src, /function assertWinBuildHost\(\) \{\s*if \(process\.platform !== 'linux'\) return;/);
  const rel = src.slice(src.indexOf('async function actionRelease'), src.indexOf('async function actionFinish'));
  assert.ok(rel.indexOf('assertWinBuildHost()') > 0 && rel.indexOf('assertWinBuildHost()') < rel.indexOf('nxBuild('));
  // never compile native modules for a foreign platform; always both real Windows arches
  assert.match(src, /args\.push\('-c\.npmRebuild=false'\)/);
  assert.match(src, /args\.push\('--x64', '--ia32'\)/);
});

// ── packaging rules (what ships, what gets codesigned) ─────────────────────
// electron-builder semantics: production node_modules are copied by default, app files only when a
// positive pattern matches; patterns apply in order, the last matching one wins, `!` excludes.
function shipped(rel) {
  const mm = minimatchMod.minimatch || minimatchMod;
  let inc = rel.startsWith('node_modules/');
  for (const p of BUILD.files) {
    const neg = p.startsWith('!');
    if (mm(rel, neg ? p.slice(1) : p, { dot: true })) inc = !neg;
  }
  return inc;
}

test('packaging: runtime files of the native modules ship, their sources/tests/fuzz corpus do not', { skip: !minimatchMod && 'npm ci first (minimatch)' }, () => {
  for (const keep of [
    'electron/main.js',
    'electron/instruments/core/transports/serial.js',
    'dist/apps/lms/browser/index.html',
    'node_modules/usb/package.json',
    'node_modules/usb/dist/usb/bindings.js',
    'node_modules/usb/prebuilds/darwin-x64+arm64/node.napi.node',
    'node_modules/usb/prebuilds/win32-x64/node.napi.node',
    'node_modules/usb/prebuilds/win32-ia32/node.napi.node',
    'node_modules/@serialport/bindings-cpp/dist/serialport-bindings.js',
    'node_modules/@serialport/bindings-cpp/prebuilds/win32-ia32/@serialport+bindings-cpp.node',
    'node_modules/@serialport/bindings-cpp/prebuilds/darwin-x64+arm64/@serialport+bindings-cpp.node',
    'node_modules/serialport/dist/index.js',
    'node_modules/node-gyp-build/index.js',
    'node_modules/electron-updater/out/main.js',
    'node_modules/multicast-dns/index.js',
  ]) assert.ok(shipped(keep), `must ship: ${keep}`);
  for (const drop of [
    'electron/test/desktop-pipeline.test.js',
    'node_modules/usb/libusb/tests/fuzz/corpus/bos/min.bos',
    'node_modules/usb/libusb/libusb/core.c',
    'node_modules/usb/src/device.cc',
    'node_modules/usb/test/usb.coffee',
    'node_modules/usb/node_modules/node-addon-api/napi.h',
    'node_modules/@serialport/bindings-cpp/src/serialport.cpp',
    'node_modules/usb/prebuilds/android-arm64/node.napi.armv8.node',
    'node_modules/date-fns/docs/i18n.md',
    'node_modules/lightningcss-darwin-arm64/lightningcss.darwin-arm64.node',
    'node_modules/@tailwindcss/oxide-darwin-arm64/tailwindcss-oxide.darwin-arm64.node',
    'node_modules/@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node',
  ]) assert.ok(!shipped(drop), `must NOT ship: ${drop}`);
});

test('packaging: only native prebuilds are unpacked, and macOS only codesigns real Mach-O code', () => {
  assert.deepEqual(BUILD.asarUnpack, ['**/node_modules/{usb,@serialport/bindings-cpp}/prebuilds/**']);
  assert.equal(BUILD.win.files, undefined, 'a platform "files" list replaces the top-level one in the main matcher (ships the whole repo) — keep rules top-level');
  assert.equal(BUILD.mac.files, undefined);
  const ignore = BUILD.mac.signIgnore.map((r) => new RegExp(r));
  const skipped = (p) => ignore.some((r) => r.test(p));
  const app = '/x/dist/electron/mac-arm64/Prefrontal Dev.app/Contents';
  const un = `${app}/Resources/app.asar.unpacked/node_modules`;
  for (const p of [
    `${app}/Frameworks/Electron Framework.framework/Versions/A/Resources/de.lproj/locale.pak`,
    `${app}/Frameworks/Electron Framework.framework/Versions/A/Resources/en.lproj/locale.pak`,
    `${un}/usb/prebuilds/win32-x64/node.napi.node`,
    `${un}/usb/prebuilds/linux-x64/node.napi.glibc.node`,
    `${un}/@serialport/bindings-cpp/prebuilds/win32-ia32/@serialport+bindings-cpp.node`,
  ]) assert.ok(skipped(p), `resource/foreign binary need not be signed: ${p}`);
  for (const p of [
    `${app}/MacOS/Prefrontal Dev`,
    `${app}/Frameworks/Electron Framework.framework/Versions/A/Electron Framework`,
    `${app}/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib`,
    `${app}/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler`,
    `${app}/Frameworks/Prefrontal Dev Helper (Renderer).app/Contents/MacOS/Prefrontal Dev Helper (Renderer)`,
    `${app}/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt`,
    `${app}/Resources/app.asar`,
    `${un}/usb/prebuilds/darwin-x64+arm64/node.napi.node`,
    `${un}/@serialport/bindings-cpp/prebuilds/darwin-x64+arm64/@serialport+bindings-cpp.node`,
  ]) assert.ok(!skipped(p), `Mach-O must stay signed (notarization): ${p}`);
});
