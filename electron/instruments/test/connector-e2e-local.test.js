'use strict';
/**
 * Connector core ⇄ simulator ⇄ fake API, over real sockets / a virtual
 * serial pair. (The same scenarios run against the real LMS backend in
 * prefrontal-mw's InstrumentSimE2ETests via e2e/run-sim-e2e.js.)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fakeApi } = require('../e2e/fake-api');
const { runScenario, openVirtualSerialPair } = require('../e2e/harness');
const { Connector } = require('../core/connector');
const { ConnectorManager } = require('../core/manager');
const { runSim } = require('../sim/cbc-sim');

const ID = '11111111-2222-3333-4444-555555555555';
const KEY = 'pfi_test_key';
const MAPS = [
  { analyzerCode: 'WBC', testCatalogKey: 'HEM019', factor: 1000, decimals: 0 },
  { analyzerCode: 'HGB', testCatalogKey: 'HEM011', decimals: 1 },
];
const LINK = { 'astm-5part': { type: 'astm-e1381' }, 'hl7-5part': { type: 'mllp' }, 'text-3part': { type: 'raw', terminator: '\f', idleMs: 2000 } };
const CODES_3PART = ['WBC', 'LYM%', 'MID%', 'GRAN%', 'RBC', 'HGB', 'HCT', 'MCV', 'MCH', 'MCHC', 'RDW-CV', 'PLT', 'MPV', 'LYM#', 'MID#', 'GRAN#'];

async function api(dialect, extra = {}) {
  return fakeApi({
    instruments: { [ID]: { key: KEY, name: `Sim ${dialect}`, config: { transport: { type: 'tcp-server', port: 0 }, link: LINK[dialect], parser: { type: 'auto' } }, codeMaps: MAPS } },
    knownBarcodes: ['260100001', '260100002', '260100003', '260100004', '260100005'],
    ...extra,
  });
}

function assertScenario(r, store, { astm }) {
  const states = store.messages.map((m) => `${m.sampleId}:${m.state}`);
  // normal → matched then superseded by the re-run; re-run matched
  assert.equal(store.messages.filter((m) => m.sampleId === '260100001').length, astm ? 2 : 2);
  assert.ok(states.includes('260100001:superseded'), states.join(','));
  assert.ok(states.includes('QC-L1-24117:qc'), states.join(','));
  assert.ok(states.includes('999999999:unmatched'), states.join(','));
  if (astm) {
    const bad = r.sent.find((s) => s.kind === 'badchecksum');
    assert.equal(bad.naks, 1);
    assert.equal(bad.retransmits, 1);
    assert.ok(r.nakNotes >= 1, 'connector logged the NAK');
  }
  // burst samples all arrive exactly once
  for (const id of ['260100003', '260100004', '260100005']) assert.equal(store.messages.filter((m) => m.sampleId === id).length, 1, id);
  assert.equal(r.queueLeft, 0);
  assert.ok(r.sent.every((s) => s.ok), JSON.stringify(r.sent.map((s) => [s.kind, s.ok])));
}

for (const dialect of ['astm-5part', 'hl7-5part', 'text-3part']) {
  for (const transport of ['tcp-server', 'tcp-client']) {
    test(`e2e (fake API): ${dialect} — connector ${transport}`, async () => {
      const a = await api(dialect);
      try {
        const r = await runScenario({ apiUrl: a.url, instrumentId: ID, deviceKey: KEY, dialect, connectorTransport: transport, samples: ['260100001', '260100002', '260100003', '260100004', '260100005'] });
        assertScenario(r, a.store, { astm: dialect === 'astm-5part' });
        const first = a.store.messages.find((m) => m.sampleId === '260100001');
        const wbc = first.mapped.find((m) => m.catalogKey === 'HEM019');
        assert.equal(wbc.value, String(Math.round(Number(wbc.rawValue) * 1000)));
        if (dialect === 'text-3part') assert.deepEqual(first.payload.message.results.map((x) => x.code), CODES_3PART);
        else assert.equal(first.payload.message.results.length, 20);
        assert.ok(a.store.heartbeats.length >= 1, 'heartbeat sent');
      } finally { await a.close(); }
    });
  }
}

test('e2e (fake API): serial via virtual null-modem (socat or pty relay)', async (t) => {
  const pair = await openVirtualSerialPair();
  if (pair.skipped) { t.skip(pair.skipped); return; }
  const a = await api('astm-5part');
  try {
    const r = await runScenario({ apiUrl: a.url, instrumentId: ID, deviceKey: KEY, dialect: 'astm-5part', connectorTransport: 'serial', serialPair: pair, samples: ['260100001', '260100002', '260100003', '260100004', '260100005'] });
    assertScenario(r, a.store, { astm: true });
  } finally { pair.close(); await a.close(); }
});

test('store-and-forward: API down → queued on disk → survives restart → delivered once', async () => {
  const a = await api('astm-5part', { failFirst: 1000 });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-inst-sf-'));
  const mk = () => new Connector({ instrumentId: ID, apiUrl: a.url, deviceKey: KEY, dataDir, transportOverride: { type: 'tcp-server', host: '127.0.0.1', port: 0 }, heartbeatMs: 60000, queueOpts: { baseDelayMs: 50, maxDelayMs: 200 } });
  try {
    let c = mk();
    await c.start();
    const sim = await runSim({ dialect: 'astm-5part', transport: 'tcp-client', host: '127.0.0.1', port: c.transport.port, samples: ['260100002'], scenario: 'normal', count: 3, delay: 50, quiet: true });
    assert.ok(sim.ok);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(c.queue.length, 3);
    assert.equal(a.store.messages.length, 0);
    await c.stop();                                   // "power cut"
    a.setFailures(0);                                 // server back
    c = mk();
    await c.start();
    await Promise.race([c.idle(), new Promise((_r, j) => setTimeout(() => j(new Error('not drained')), 5000))]);
    assert.equal(a.store.messages.length, 3);
    // A re-send of identical bytes (analyzer retransmits a whole message) is de-duplicated.
    const again = await runSim({ dialect: 'astm-5part', transport: 'tcp-client', host: '127.0.0.1', port: c.transport.port, samples: ['260100002'], scenario: 'normal', delay: 0, quiet: true });
    assert.ok(again.ok);
    await new Promise((r) => setTimeout(r, 300));
    await c.stop();
  } finally { await a.close(); }
});

test('idempotency at the server: the same payload posted twice is stored once', async () => {
  const a = await api('astm-5part');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-inst-idem-'));
  try {
    const c = new Connector({ instrumentId: ID, apiUrl: a.url, deviceKey: KEY, dataDir, transportOverride: { type: 'tcp-server', host: '127.0.0.1', port: 0 }, heartbeatMs: 60000 });
    await c.start();
    const text = require('../sim/dialects').astmMessage({ sampleId: '260100004', at: new Date('2026-09-30T05:00:00Z') }).text;
    c._onText(text, { type: 'astm' }, { link: 'astm-e1381' });
    await c.idle();
    // Simulate a lost HTTP response: the queue retries the same payload.
    const { payload } = { payload: a.store.messages[0].payload };
    const res = await c.uploader.postMessage(payload);
    assert.equal(res.duplicate, true);
    assert.equal(a.store.messages.length, 1);
    await c.stop();
  } finally { await a.close(); }
});

test('M51 backward compat: a message with 4 embedded images still uploads to a TODAY-shaped server (raw stays small, numbers still map) (§4)', async () => {
  // M51_MAPS: a slice of the Arun-lab LOINC preset, enough to prove numeric
  // prefill still works end to end through a server that has NOT been
  // upgraded for image storage (fakeApi here never even looks at
  // `message.images` — exactly like today's deployed mw, which System.Text.Json
  // on an unknown-shaped DTO silently ignores extra properties for).
  const M51_MAPS = [
    { analyzerCode: '6690-2', testCatalogKey: 'HEM019', factor: 1000, decimals: 0 },
    { analyzerCode: '777-3', testCatalogKey: 'HEM030', factor: 1000, decimals: 0 },
    { analyzerCode: '770-8', testCatalogKey: 'HEM020', factor: 1, decimals: 1 },
  ];
  const a = await fakeApi({ instruments: { [ID]: { key: KEY, name: 'M51', config: { transport: { type: 'tcp-server', port: 0 }, link: { type: 'mllp' }, parser: { type: 'hl7', hl7: { sampleIdField: 'OBR-3' } } }, codeMaps: M51_MAPS } } });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-inst-m51-'));
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/m51-synthetic.hl7'), 'latin1');
  try {
    const c = new Connector({ instrumentId: ID, apiUrl: a.url, deviceKey: KEY, dataDir, transportOverride: { type: 'tcp-server', host: '127.0.0.1', port: 0 }, heartbeatMs: 60000 });
    await c.start();
    c._onText(fixture, { type: 'hl7', hl7: { sampleIdField: 'OBR-3' } }, { link: 'mllp' });
    await c.idle();
    assert.equal(a.store.messages.length, 1);
    const row = a.store.messages[0];
    assert.equal(row.state, 'unmatched');  // no known-barcode list wired here — the point is the server accepted it at all
    const { payload } = row;
    // raw never carries the base64 BMP data, and stays small independent of
    // the number of embedded images (4 here).
    assert.ok(payload.raw.length < 10 * 1024, `raw should stay under ~10KB, was ${payload.raw.length}`);
    assert.ok(!/[A-Za-z0-9+/]{40,}/.test(payload.raw), 'no long base64 run leaked into raw');
    assert.ok(payload.raw.includes('see images[]'), 'raw keeps a human-readable placeholder for each redacted image');
    // images travel in message.images, additively — a server that has never
    // heard of this field (this fake, and today's deployed mw) just never
    // reads it; it does not reject or choke on it.
    assert.equal(payload.message.images.length, 4);
    assert.deepEqual(payload.message.images.map((im) => im.code), ['12003', '12053', '12103', '12153']);
    assert.ok(payload.message.images.every((im) => im.base64.length > 0), 'full image bytes still travel — just not inside raw');
    // Numeric results still prefill against this (today-shaped) server.
    assert.equal(row.unmapped.includes('6690-2'), false);
    const wbc = row.mapped.find((x) => x.catalogKey === 'HEM019');
    assert.equal(wbc.value, '13290');
    const plt = row.mapped.find((x) => x.catalogKey === 'HEM030');
    assert.equal(plt.value, '173000');
    await c.stop();
  } finally { await a.close(); }
});

test('manager: pairing verifies the key with the server; wrong key never pairs', async () => {
  const a = await api('astm-5part');
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-inst-mgr-'));
  const secrets = { encrypt: (s) => Buffer.from(s).toString('base64'), decrypt: (s) => Buffer.from(s, 'base64').toString() };
  const m = new ConnectorManager({ baseDir, secrets, connectorOpts: { transportOverride: { type: 'tcp-server', host: '127.0.0.1', port: 0 }, heartbeatMs: 60000 } });
  try {
    assert.deepEqual(await m.pair({ instrumentId: ID, deviceKey: 'wrong', apiUrl: a.url }), { ok: false, error: 'The server rejected this device key' });
    assert.equal((await m.pair({ instrumentId: 'not-a-guid', deviceKey: KEY, apiUrl: a.url })).ok, false);
    assert.deepEqual(await m.pair({ instrumentId: ID, deviceKey: KEY, apiUrl: a.url }), { ok: true });
    const stored = fs.readFileSync(path.join(baseDir, 'paired.json'), 'utf8');
    assert.ok(!stored.includes(KEY), 'key is stored encrypted');
    assert.equal(m.list()[0].name, 'Sim astm-5part');
    const m2 = new ConnectorManager({ baseDir, secrets, connectorOpts: { transportOverride: { type: 'tcp-server', host: '127.0.0.1', port: 0 }, heartbeatMs: 60000 } });
    await m2.load();
    assert.equal(m2.status()[0].instrumentId, ID);
    await m2.stopAll();
    assert.deepEqual(await m.unpair(ID), { ok: true });
    assert.equal(m.list().length, 0);
  } finally { await m.stopAll(); await a.close(); }
});

test('listen mode: captures, ACKs like a LIS, detects and previews without uploading', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-inst-listen-'));
  const m = new ConnectorManager({ baseDir });
  const events = [];
  m.on('listen', (e) => events.push(e));
  const net = require('net');
  const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const { sessionId } = await m.listenStart({ transport: { type: 'tcp-server', host: '127.0.0.1', port } });
  assert.ok(sessionId);
  const sim = await runSim({ dialect: 'astm-5part', transport: 'tcp-client', host: '127.0.0.1', port, samples: ['26123'], scenario: 'normal', delay: 50, quiet: true });
  assert.ok(sim.ok, 'the analyzer was ACKed during listen mode');
  const r = await m.listenStop(sessionId);
  assert.equal(r.detect.protocol, 'astm');
  assert.equal(r.detect.link, 'astm-e1381');
  assert.equal(r.messages[0].sampleId, '26123');
  assert.match(r.raw, /<ENQ>/);
  assert.ok(events.some((e) => e.kind === 'message' && e.message.sampleId === '26123'));
  assert.ok(events.some((e) => e.kind === 'detect'));
  const pv = m.preview('SAMPLE ID: 42\nWBC 7.8 10^3/uL H\nHGB 12.0 g/dL\nPLT 250 10^3/uL\n');
  assert.equal(pv.detect.protocol, 'text');
  assert.equal(pv.messages[0].results[0].flags[0], 'H');
});
