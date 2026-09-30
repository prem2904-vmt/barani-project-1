'use strict';
/**
 * Live reload: a saved instrument config reaches a RUNNING connector without
 * a re-pair or an app restart —
 *   • core: heartbeat poll pulls a changed parser and applies it;
 *   • core: a heartbeat config version gates the pull (no change → no GET);
 *   • host: manager.reload() (what the Electron IPC calls after a save)
 *     restarts the transport when the port changed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { fakeApi } = require('../e2e/fake-api');
const { Connector } = require('../core/connector');
const { ConnectorManager } = require('../core/manager');
const { textMessage } = require('../sim/dialects');
const { TEXT_DEFAULTS } = require('../core/parsers/text');

const ID = '11111111-2222-3333-4444-555555555555';
const KEY = 'pfi_reload_key';
const OLD_UI_SAMPLE_ID = '^(?:SAMPLE|ID)\\s*[:#]?\\s*(?<id>\\S+)';   // the drifted wizard default
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pf-inst-reload-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await wait(25); }
  return false;
}
function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
}
function sendTo(port, text) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host: '127.0.0.1', port }, () => { s.write(Buffer.from(text, 'latin1')); setTimeout(() => { s.end(); resolve(); }, 100); });
    s.once('error', reject);
  });
}
const canConnect = (port) => new Promise((resolve) => {
  const s = net.createConnection({ host: '127.0.0.1', port }, () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
});
const ticket = (id) => textMessage({ sampleId: id, run: 1 }).text;

test('core: heartbeat poll applies a changed parser to the running connector (no re-pair)', async () => {
  const port = await freePort();
  const inst = { key: KEY, name: 'Reload', codeMaps: [],
    config: { transport: { type: 'tcp-server', host: '127.0.0.1', port }, link: { type: 'raw', terminator: '\f' },
      parser: { type: 'text', text: { sampleIdPattern: OLD_UI_SAMPLE_ID } } } };
  const a = await fakeApi({ instruments: { [ID]: inst }, knownBarcodes: ['2609-00013', '2609-00014'] });
  const c = new Connector({ instrumentId: ID, apiUrl: a.url, deviceKey: KEY, dataDir: tmp(), heartbeatMs: 100 });
  try {
    await c.start();
    await sendTo(port, ticket('2609-00013'));
    assert.ok(await until(() => a.store.messages.length === 1));
    assert.equal(a.store.messages[0].sampleId, 'ID:', 'old pattern misreads the ticket (the bug being fixed)');

    // "Save" in the UI: the server config changes; the connector is NOT re-paired.
    inst.config = { ...inst.config, parser: { type: 'text', text: { sampleIdPattern: TEXT_DEFAULTS.sampleIdPattern } } };
    assert.ok(await until(() => JSON.stringify(c.active.parser) === JSON.stringify(inst.config.parser)), 'poll pulled the new parser');
    await sendTo(port, ticket('2609-00014'));
    assert.ok(await until(() => a.store.messages.length === 2));
    assert.equal(a.store.messages[1].sampleId, '2609-00014');
    assert.equal(a.store.messages[1].state, 'matched');
  } finally { await c.stop(); await a.close(); }
});

test('core: a heartbeat config version gates the pull — unchanged version, no config GET', async () => {
  let version = 'v1';
  let gets = 0;
  const cfg = { transport: { type: 'tcp-server', host: '127.0.0.1', port: 0 }, link: { type: 'auto' }, parser: { type: 'auto' } };
  const uploader = {
    getConfig: async () => { gets++; return { id: ID, name: 'V', config: cfg, codeMaps: [], heartbeatSeconds: 30 }; },
    heartbeat: async () => ({ ok: true, configVersion: version }),
    postMessage: async () => ({}),
  };
  const c = new Connector({ instrumentId: ID, dataDir: tmp(), uploader, heartbeatMs: 40 });
  try {
    await c.start();                                  // GET #1
    assert.ok(await until(() => gets === 2));         // first beat: unknown version → GET #2
    await wait(250);                                  // several beats, same version
    assert.equal(gets, 2);
    version = 'v2';
    assert.ok(await until(() => gets === 3));         // new version → exactly one more GET
    await wait(200);
    assert.equal(gets, 3);
  } finally { await c.stop(); }
});

test('host: manager.reload (the IPC a save calls) restarts the transport on a new port', async () => {
  const [p1, p2] = [await freePort(), await freePort()];
  const inst = { key: KEY, name: 'Host reload', codeMaps: [],
    config: { transport: { type: 'tcp-server', host: '127.0.0.1', port: p1 }, link: { type: 'raw', terminator: '\f' }, parser: { type: 'text' } } };
  const a = await fakeApi({ instruments: { [ID]: inst }, knownBarcodes: ['2609-00015'] });
  const m = new ConnectorManager({ baseDir: tmp(), connectorOpts: { heartbeatMs: 60000 } });
  try {
    assert.deepEqual(await m.pair({ instrumentId: ID, deviceKey: KEY, apiUrl: a.url }), { ok: true });
    assert.ok(await canConnect(p1));
    // Let the start-up heartbeat (fires at 0 ms, then polls the config) settle,
    // so the reloads below are the only ones in flight.
    const c = m.connectors.get(ID);
    assert.ok(await until(async () => { await wait(50); return !c.reloading; }));
    assert.deepEqual(await m.reload(ID), { ok: true, changed: false, restarted: false }, 'nothing changed → no restart');

    inst.config = { ...inst.config, transport: { type: 'tcp-server', host: '127.0.0.1', port: p2 } };
    assert.deepEqual(await m.reload(ID), { ok: true, changed: true, restarted: true });
    assert.equal(await canConnect(p1), false, 'old port closed');
    await sendTo(p2, ticket('2609-00015'));
    assert.ok(await until(() => a.store.messages.length === 1));
    assert.equal(a.store.messages[0].sampleId, '2609-00015');
    assert.equal((await m.reload('22222222-2222-2222-2222-222222222222')).ok, false, 'not paired here');
  } finally {
    for (const p of m.list()) await m.unpair(p.instrumentId);
    await a.close();
  }
});
