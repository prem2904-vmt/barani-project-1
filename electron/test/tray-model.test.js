// node --test electron/test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../tray-model');

const NOW = new Date(2026, 9, 2, 20, 4, 0).getTime(); // local 8:04 PM

const inst = (over = {}) => ({
  instrumentId: 'i1', name: 'Sysmex XN', state: 'connected',
  lastMessageAt: null, queueLength: 0, messagesToday: 0, unmatchedToday: 0,
  serverOnline: null, serverOfflineSince: null,
  ...over,
});

function actions(template) {
  return template.filter((i) => i.action).map((i) => i.action);
}
function labels(template) {
  return template.map((i) => i.label);
}

test('no instruments configured: a single disabled line says so, no instrument-only items', () => {
  const t = model.buildMenuModel({ now: NOW, instruments: [], version: '1.2.3' });
  const noneLine = t.find((i) => i.label === 'No instruments connected');
  assert.ok(noneLine && noneLine.enabled === false);
  assert.ok(!labels(t).some((l) => l && l.startsWith('Results received today')));
  assert.ok(!actions(t).includes('openUnmatched'));
  // Always-present scaffold.
  assert.deepEqual(actions(t), ['open', 'openInstruments', 'checkUpdates', 'toggleLogin', 'copyDiagnostics', 'quit']);
});

test('one connected instrument: a line with the dot + status, "results today" shown even at 0', () => {
  const t = model.buildMenuModel({ now: NOW, instruments: [inst({ messagesToday: 5 })] });
  const line = t.find((i) => i.label && i.label.includes('Sysmex XN'));
  assert.equal(line.label, '● Sysmex XN — Connected');
  assert.equal(line.enabled, false);
  assert.ok(labels(t).includes('Results received today: 5'));
});

test('instrument states map to the right dot + word: connected/listening = ●, else = ○', () => {
  assert.equal(model.dotFor('connected'), '●');
  assert.equal(model.dotFor('listening'), '●');
  assert.equal(model.dotFor('starting'), '○');
  assert.equal(model.dotFor('disconnected'), '○');
  assert.equal(model.dotFor('error'), '○');
  assert.equal(model.statusWord('connected'), 'Connected');
  assert.equal(model.statusWord('listening'), 'Connected');
  assert.equal(model.statusWord('starting'), 'Waiting');
  assert.equal(model.statusWord('error'), 'Disconnected');
  assert.equal(model.statusWord('disconnected'), 'Disconnected');
});

test('last-result time appends only when known, in coarse relative units', () => {
  assert.equal(model.relativeTime(null, NOW), null);
  assert.equal(model.relativeTime(new Date(NOW - 10_000).toISOString(), NOW), 'just now');
  assert.equal(model.relativeTime(new Date(NOW - 5 * 60_000).toISOString(), NOW), '5m ago');
  assert.equal(model.relativeTime(new Date(NOW - 3 * 3600_000).toISOString(), NOW), '3h ago');
  assert.equal(model.relativeTime(new Date(NOW - 2 * 86400_000).toISOString(), NOW), '2d ago');
  const line = model.instrumentLine(inst({ lastMessageAt: new Date(NOW - 5 * 60_000).toISOString() }), NOW);
  assert.equal(line, '● Sysmex XN — Connected · last result 5m ago');
});

test('results waiting to send: shown only when something is actually queued', () => {
  const none = model.buildMenuModel({ now: NOW, instruments: [inst({ queueLength: 0 })] });
  assert.ok(!labels(none).some((l) => l && l.includes('waiting to send')));
  const some = model.buildMenuModel({ now: NOW, instruments: [inst({ queueLength: 3 }), inst({ instrumentId: 'i2', queueLength: 2 })] });
  assert.ok(labels(some).includes('Results waiting to send: 5 — will send when back online'));
});

test('unmatched results: a clickable line, shown only when > 0, summed across instruments', () => {
  const none = model.buildMenuModel({ now: NOW, instruments: [inst({ unmatchedToday: 0 })] });
  assert.ok(!actions(none).includes('openUnmatched'));
  const some = model.buildMenuModel({ now: NOW, instruments: [inst({ unmatchedToday: 2 }), inst({ instrumentId: 'i2', unmatchedToday: 1 })] });
  const row = some.find((i) => i.action === 'openUnmatched');
  assert.equal(row.label, 'Unmatched results today: 3');
});

test('server status line: hidden until any instrument has heartbeated, then online/offline with a clock time', () => {
  const unknown = model.buildMenuModel({ now: NOW, instruments: [inst({ serverOnline: null })] });
  assert.ok(!labels(unknown).includes('Connected to Prefrontal'));
  const online = model.buildMenuModel({ now: NOW, instruments: [inst({ serverOnline: true })] });
  assert.ok(labels(online).includes('Connected to Prefrontal'));
  const offlineSince = new Date(2026, 9, 2, 20, 4, 0).toISOString();
  const offline = model.buildMenuModel({ now: NOW, instruments: [inst({ serverOnline: false, serverOfflineSince: offlineSince })] });
  assert.ok(labels(offline).includes('Offline since 8:04 PM'));
  // One instrument online, one offline → the line still says offline (the earliest offline-since).
  const mixed = model.buildMenuModel({
    now: NOW,
    instruments: [inst({ serverOnline: true }), inst({ instrumentId: 'i2', serverOnline: false, serverOfflineSince: offlineSince })],
  });
  assert.ok(labels(mixed).includes('Offline since 8:04 PM'));
});

test('formatClock: 12-hour wall clock, noon/midnight edge cases', () => {
  assert.equal(model.formatClock(new Date(2026, 0, 1, 0, 4)), '12:04 AM');
  assert.equal(model.formatClock(new Date(2026, 0, 1, 12, 0)), '12:00 PM');
  assert.equal(model.formatClock(new Date(2026, 0, 1, 23, 59)), '11:59 PM');
  assert.equal(model.formatClock(new Date(2026, 0, 1, 8, 4)), '8:04 AM');
});

test('tooltip: counts only connected/listening instruments, singular/plural', () => {
  assert.equal(model.tooltip([]), 'Prefrontal — 0 instruments connected');
  assert.equal(model.tooltip([inst()]), 'Prefrontal — 1 instrument connected');
  assert.equal(model.tooltip([inst(), inst({ instrumentId: 'i2', state: 'disconnected' })]), 'Prefrontal — 1 instrument connected');
  assert.equal(model.tooltip([inst(), inst({ instrumentId: 'i2', state: 'listening' })]), 'Prefrontal — 2 instruments connected');
});

test('hasAttention: any disconnected/error, queued, unmatched, or server-offline instrument', () => {
  assert.equal(model.hasAttention([inst()]), false);
  assert.equal(model.hasAttention([inst({ state: 'disconnected' })]), true);
  assert.equal(model.hasAttention([inst({ state: 'error' })]), true);
  assert.equal(model.hasAttention([inst({ queueLength: 1 })]), true);
  assert.equal(model.hasAttention([inst({ unmatchedToday: 1 })]), true);
  assert.equal(model.hasAttention([inst({ serverOnline: false })]), true);
  assert.equal(model.hasAttention([]), false);
});

test('updater label reflects phase; defaults to "Check for updates"', () => {
  assert.equal(model.updaterLabel(null), 'Check for updates');
  assert.equal(model.updaterLabel({ phase: 'idle' }), 'Check for updates');
  assert.equal(model.updaterLabel({ phase: 'checking' }), 'Checking for updates…');
  assert.equal(model.updaterLabel({ phase: 'downloading', progress: 42 }), 'Downloading update… 42%');
  assert.equal(model.updaterLabel({ phase: 'ready', version: '1.3.0' }), 'Restart to install v1.3.0');
  assert.equal(model.updaterLabel({ phase: 'deferred' }), 'Update ready — waiting for instruments to finish');
});

test('start-at-login checkbox reflects state + support; version line is always present', () => {
  const t = model.buildMenuModel({ now: NOW, instruments: [], version: '2.0.0', startAtLogin: true, loginSupported: true });
  const login = t.find((i) => i.action === 'toggleLogin');
  assert.equal(login.type, 'checkbox');
  assert.equal(login.checked, true);
  assert.equal(login.enabled, true);
  assert.ok(labels(t).includes('Version 2.0.0'));

  const unsupported = model.buildMenuModel({ now: NOW, instruments: [], loginSupported: false });
  assert.equal(unsupported.find((i) => i.action === 'toggleLogin').enabled, false);
});

test('quit is always the last item; open is always first', () => {
  const t = model.buildMenuModel({ now: NOW, instruments: [inst()] });
  assert.equal(t[0].action, 'open');
  assert.equal(t[t.length - 1].action, 'quit');
});

test('buildMenuModel never throws on empty/garbage input', () => {
  assert.doesNotThrow(() => model.buildMenuModel());
  assert.doesNotThrow(() => model.buildMenuModel({ instruments: null }));
  assert.doesNotThrow(() => model.buildMenuModel({ instruments: [{}] }));
});
