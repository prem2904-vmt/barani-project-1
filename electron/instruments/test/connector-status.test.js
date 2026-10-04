'use strict';
/**
 * connector.js status() additions for the desktop tray (electron/tray.js):
 *   - unmatchedToday: tallies 'unmatched' upload responses, resets with the
 *     IST-day rollover (same boundary as messagesToday).
 *   - serverOnline / serverOfflineSince: derived from the existing periodic
 *     heartbeat (never a second ping).
 *   - recentErrors: a bounded ring of the connector's own short error
 *     strings (status() exposes the last 10).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Connector } = require('../core/connector');

const ID = '11111111-2222-3333-4444-555555555555';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pf-inst-status-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await wait(20); }
  return false;
}

function baseUploader(overrides = {}) {
  return {
    getConfig: async () => ({ id: ID, name: 'Status', config: { transport: { type: 'tcp-server', host: '127.0.0.1', port: 0 }, link: { type: 'auto' }, parser: { type: 'auto' } }, codeMaps: [], heartbeatSeconds: 30 }),
    heartbeat: async () => ({ ok: true }),
    postMessage: async () => ({ state: 'matched' }),
    ...overrides,
  };
}

test('unmatchedToday counts "unmatched" upload responses only, not matched/superseded', async () => {
  const states = ['unmatched', 'matched', 'unmatched', 'superseded'];
  let i = 0;
  const uploader = baseUploader({ postMessage: async () => ({ state: states[i++] }) });
  const c = new Connector({ instrumentId: ID, dataDir: tmp(), uploader, heartbeatMs: 10_000 });
  try {
    for (let n = 0; n < states.length; n++) c.queue.add({ key: `k${n}`, payload: { message: { sampleId: `s${n}` } } });
    await c.start(); // _drain() is a no-op while stopped; start() kicks the queue
    assert.ok(await until(() => c.queue.length === 0), 'queue drained');
    assert.equal(c.status().unmatchedToday, 2);
    assert.equal(c.status().messagesToday, 0, 'unmatchedToday is tallied at upload time, independent of messagesToday (tallied on receipt)');
  } finally { await c.stop(); }
});

test('serverOnline: unknown until the first heartbeat, then tracks success/failure with a timestamp', async () => {
  let fail = false;
  const uploader = baseUploader({ heartbeat: async () => { if (fail) throw new Error('network: timeout'); return { ok: true }; } });
  const c = new Connector({ instrumentId: ID, dataDir: tmp(), uploader, heartbeatMs: 30 });
  try {
    assert.equal(c.status().serverOnline, null);
    await c.start();
    assert.ok(await until(() => c.status().serverOnline === true));
    assert.equal(c.status().serverOfflineSince, null);

    fail = true;
    assert.ok(await until(() => c.status().serverOnline === false));
    const since = c.status().serverOfflineSince;
    assert.ok(since && !Number.isNaN(new Date(since).getTime()));

    fail = false;
    assert.ok(await until(() => c.status().serverOnline === true));
    assert.equal(c.status().serverOfflineSince, null, 'back online clears the offline-since timestamp');
  } finally { await c.stop(); }
});

test('recentErrors: a failing heartbeat is recorded with a short, non-empty message; status() exposes at most the last 10', async () => {
  const uploader = baseUploader({ heartbeat: async () => { throw new Error('network: timeout'); } });
  const c = new Connector({ instrumentId: ID, dataDir: tmp(), uploader, heartbeatMs: 15 });
  try {
    await c.start();
    assert.ok(await until(() => c.status().recentErrors.length > 0));
    const first = c.status().recentErrors[0];
    assert.ok(first.at && !Number.isNaN(new Date(first.at).getTime()));
    assert.match(first.message, /^heartbeat: network: timeout$/);

    // Flood the ring well past its internal cap; status() never exceeds 10.
    for (let i = 0; i < 25; i++) c._recordError(`synthetic ${i}`);
    const errs = c.status().recentErrors;
    assert.equal(errs.length, 10);
    assert.equal(errs[errs.length - 1].message, 'synthetic 24');
  } finally { await c.stop(); }
});

test('status() never throws for a brand-new, unstarted connector (tray can poll it at any time)', () => {
  const c = new Connector({ instrumentId: ID, dataDir: tmp(), uploader: baseUploader() });
  const s = c.status();
  assert.equal(s.unmatchedToday, 0);
  assert.equal(s.serverOnline, null);
  assert.deepEqual(s.recentErrors, []);
});
