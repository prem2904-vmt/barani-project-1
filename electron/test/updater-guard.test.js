// electron/updater-guard.js — pure "don't restart during an analyzer
// session" guard over connector.status() snapshots. No Electron needed.
// Run: npm run test:electron
const test = require('node:test');
const assert = require('node:assert/strict');
const { canRestartNow, isConnectorBusy, ACTIVE_WINDOW_MS } = require('../updater-guard');

const NOW = 1_700_000_000_000;
const idle = (over = {}) => ({
  instrumentId: 'i1', name: 'Sysmex XN', state: 'connected',
  lastMessageAt: null, queueLength: 0, ...over,
});

test('no connectors paired → safe to restart', () => {
  assert.deepEqual(canRestartNow([], NOW), { safe: true, reasons: [] });
  assert.deepEqual(canRestartNow(null, NOW), { safe: true, reasons: [] });
  assert.deepEqual(canRestartNow(undefined, NOW), { safe: true, reasons: [] });
});

test('a connector just sitting "connected" with an empty queue is NOT busy (the common idle case)', () => {
  const statuses = [idle()];
  assert.equal(isConnectorBusy(statuses[0], NOW), false);
  assert.deepEqual(canRestartNow(statuses, NOW), { safe: true, reasons: [] });
});

test('listen mode (capturing an unknown analyzer) is busy', () => {
  const statuses = [idle({ state: 'listening' })];
  assert.equal(canRestartNow(statuses, NOW).safe, false);
  assert.deepEqual(canRestartNow(statuses, NOW).reasons, ['Sysmex XN']);
});

test('a non-empty upload queue (a result hasn\'t reached the server yet) is busy', () => {
  const statuses = [idle({ queueLength: 1 })];
  assert.equal(canRestartNow(statuses, NOW).safe, false);
});

test('a message within the active window is busy, even though state never left "connected"', () => {
  const justNow = idle({ lastMessageAt: new Date(NOW - 5_000).toISOString() });
  assert.equal(isConnectorBusy(justNow, NOW), true);
  assert.equal(canRestartNow([justNow], NOW).safe, false);
});

test('a message well outside the active window is NOT busy', () => {
  const longAgo = idle({ lastMessageAt: new Date(NOW - ACTIVE_WINDOW_MS - 1_000).toISOString() });
  assert.equal(isConnectorBusy(longAgo, NOW), false);
  assert.equal(canRestartNow([longAgo], NOW).safe, true);
});

test('right at the window boundary is still busy (strict <, not <=, so exactly-equal is the safe side)', () => {
  const atBoundary = idle({ lastMessageAt: new Date(NOW - ACTIVE_WINDOW_MS).toISOString() });
  assert.equal(isConnectorBusy(atBoundary, NOW), false);
  const justInside = idle({ lastMessageAt: new Date(NOW - ACTIVE_WINDOW_MS + 1).toISOString() });
  assert.equal(isConnectorBusy(justInside, NOW), true);
});

test('one busy connector among several idle ones blocks the whole restart and names only itself', () => {
  const statuses = [
    idle({ instrumentId: 'a', name: 'Idle One' }),
    idle({ instrumentId: 'b', name: 'Busy Two', queueLength: 3 }),
    idle({ instrumentId: 'c', name: 'Idle Three' }),
  ];
  const r = canRestartNow(statuses, NOW);
  assert.equal(r.safe, false);
  assert.deepEqual(r.reasons, ['Busy Two']);
});

test('a malformed / null status entry never throws and is never busy', () => {
  assert.equal(isConnectorBusy(null, NOW), false);
  assert.equal(isConnectorBusy(undefined, NOW), false);
  assert.equal(isConnectorBusy({}, NOW), false);
  assert.doesNotThrow(() => canRestartNow([null, undefined, {}], NOW));
});

test('an error-state connector (disconnected) is not treated as busy on its own', () => {
  const statuses = [idle({ state: 'error' })];
  assert.equal(canRestartNow(statuses, NOW).safe, true);
});


test('a paired TCP-server connector WAITING for its analyzer (state listening + link) is idle, not busy', () => {
  const waiting = idle({ state: 'listening', link: 'waiting' });
  assert.equal(isConnectorBusy(waiting, NOW), false);
  assert.deepEqual(canRestartNow([waiting], NOW), { safe: true, reasons: [] });
  // …while a capture pseudo entry (host guardSnapshot: no link) still holds the restart.
  assert.equal(canRestartNow([waiting, { name: 'Analyzer capture', state: 'listening' }], NOW).safe, false);
});

test('keep-alive bytes (lastRxAt) alone never make a connector busy — only real messages do', () => {
  const pinging = idle({ state: 'connected', link: 'connected', lastRxAt: new Date(NOW - 1000).toISOString() });
  assert.equal(isConnectorBusy(pinging, NOW), false);
});
