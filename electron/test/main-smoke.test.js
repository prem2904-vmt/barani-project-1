// node --test electron/test/*.test.js — spawns the Electron binary on the
// smoke script (skips when the binary is missing, e.g. a node-only CI box).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

let electronBin = null;
try { electronBin = require('electron'); } catch { electronBin = null; }

function run(packaged) {
  const r = spawnSync(electronBin, [path.join(__dirname, 'main-smoke.electron.js')], {
    env: { ...process.env, PF_SMOKE_PACKAGED: packaged ? '1' : '0', ELECTRON_ENABLE_LOGGING: '' },
    encoding: 'utf8',
    timeout: 60000,
  });
  const line = `${r.stdout}\n${r.stderr}`.split('\n').find(l => l.startsWith('PF_SMOKE '));
  assert.ok(line, `no smoke output (status ${r.status}): ${r.stderr.slice(-800)}`);
  return JSON.parse(line.slice('PF_SMOKE '.length));
}

test('main process: notification wiring (unpackaged run)', { skip: !electronBin }, () => {
  const out = run(false);
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.loginCalls, []);   // `electron .` never registers a login item
});

test('main process: installed app turns launch-at-login on by default (first run)', { skip: !electronBin }, () => {
  const out = run(true);
  assert.deepEqual(out.errors, []);
  assert.equal(out.loginCalls.length, 1);
  assert.equal(out.loginCalls[0].openAtLogin, true);
});
