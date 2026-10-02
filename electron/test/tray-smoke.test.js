// node --test electron/test/*.test.js — spawns the Electron binary on the
// tray smoke script (skips when the binary is missing, e.g. a node-only CI
// box — same convention as main-smoke.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

let electronBin = null;
try { electronBin = require('electron'); } catch { electronBin = null; }

test('tray: menu-bar/system-tray icon, menu and actions (real Electron)', { skip: !electronBin }, () => {
  const r = spawnSync(electronBin, [path.join(__dirname, 'tray-smoke.electron.js')], {
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '' },
    encoding: 'utf8',
    timeout: 60000,
  });
  const line = `${r.stdout}\n${r.stderr}`.split('\n').find((l) => l.startsWith('PF_TRAY_SMOKE '));
  assert.ok(line, `no smoke output (status ${r.status}): ${r.stderr.slice(-1200)}`);
  const out = JSON.parse(line.slice('PF_TRAY_SMOKE '.length));
  assert.deepEqual(out.errors, []);
  assert.equal(out.trayCreated, true);
  assert.equal(out.contextMenuSet, true);
  assert.equal(out.iconSet, true);
  assert.equal(out.tooltipMentionsInstruments, true);
  assert.equal(out.unreadBadgeUpdatesTooltip, true);
  assert.equal(out.openActionShowsWindow, true);
  assert.equal(out.openInstrumentsNavigates, true);
  assert.equal(out.diagnosticsOnClipboard, true);
  assert.equal(out.quitActionMarksQuitting, true);
  assert.equal(out.quitActionCallsAppQuit, true);
  assert.equal(out.nativeNotificationsNeverTriggeredBySmoke, true);
});
