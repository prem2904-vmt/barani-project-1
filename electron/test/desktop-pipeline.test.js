// Desktop release pipeline guards (no Electron, no network, nothing published).
// Run: npm run test:electron
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const semver = require('semver'); // the same lib electron-updater compares with

test('dev builds "<base>-dev.<run>" update build-to-build and never downgrade to/from stable', () => {
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
