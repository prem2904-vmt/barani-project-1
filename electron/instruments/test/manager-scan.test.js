'use strict';
/**
 * "Connect an analyzer" — the manager side:
 *   • listenStart refuses a port a paired analyzer on this PC already uses
 *     (it used to open a second server / fail with a bare EADDRINUSE);
 *   • a multi-port "find the analyzer" scan: who connected, on which port,
 *     what it looks like (HL7 MSH-3 → Medonic M51), ports in use skipped
 *     with a reason, nothing uploaded;
 *   • AnalyzerGuess mirror (mw Services/Bridges/AnalyzerGuess.cs).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { ConnectorManager } = require('../core/manager');
const { Connector } = require('../core/connector');
const { guess, headerOf, normalizeMac } = require('../core/analyzer-guess');

const ID = '11111111-2222-3333-4444-555555555555';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pf-inst-scan-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await wait(20); }
  return false;
}
function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
}
const VT = '\x0b'; const FS = '\x1c'; const CR = '\r';
const M51_HL7 = `${VT}MSH|^~\\&|M51|Boule Medical|LIS||20261024103100||ORU^R01|1|P|2.3.1${CR}PID|1||||^TEST PATIENT${CR}OBR|1||2610-00021${CR}OBX|1|NM|WBC||7.8|10^3/uL|||||F${CR}${FS}${CR}`;

/** A manager with one fake "paired" connector on `port` (no server needed). */
async function managerWithPaired(port) {
  const m = new ConnectorManager({ baseDir: tmp() });
  const cfg = { transport: { type: 'tcp-server', host: '127.0.0.1', port }, link: { type: 'auto' }, parser: { type: 'auto' } };
  const c = new Connector({
    instrumentId: ID, name: 'Medonic M51', dataDir: tmp(), heartbeatMs: 60000,
    uploader: { getConfig: async () => ({ name: 'Medonic M51', config: cfg, codeMaps: [] }), heartbeat: async () => ({}), postMessage: async () => ({}) },
  });
  await c.start();
  m.connectors.set(ID, c);
  return { m, c };
}

test('listenStart refuses a port a paired analyzer on this PC uses — plain words, no second server', async () => {
  const port = await freePort();
  const { m } = await managerWithPaired(port);
  try {
    const r = await m.listenStart({ transport: { type: 'tcp-server', port } });
    assert.equal(r.code, 'port_in_use');
    assert.equal(r.error, `Port ${port} is used by the analyzer "Medonic M51" on this PC. Pick another port, or open that analyzer instead.`);
    assert.equal(m.listens.size, 0);
    assert.deepEqual(m.usedEndpoints().map((u) => u.port), [port]);
  } finally { await m.stopAll(); }
});

test('listenStart on a port another program holds names it (host portOwner lookup)', async () => {
  const port = await freePort();
  const squatter = net.createServer();
  await new Promise((r) => squatter.listen(port, '0.0.0.0', r));
  const m = new ConnectorManager({ baseDir: tmp(), connectorOpts: { portOwner: async () => ({ pid: 7412, name: 'CBCLisM51' }) } });
  try {
    const r = await m.listenStart({ transport: { type: 'tcp-server', port } });
    assert.equal(r.error, `Port ${port} is used by CBCLisM51 (PID 7412). Close that program, or pick another port for this analyzer.`);
  } finally { squatter.close(); await m.stopAll(); }
});

test('scan: several ports at once — the analyzer connects to one, is recognised from its header, nothing uploaded', async () => {
  const [p1, p2, busy] = [await freePort(), await freePort(), await freePort()];
  const { m } = await managerWithPaired(busy);
  const events = [];
  m.on('diag', (e) => events.push(e));
  try {
    const r = await m.scanStart({ ports: [p1, p2, busy, 0, 70000, 'x'] });
    assert.ok(r.scanId);
    assert.deepEqual(r.ports.map((p) => [p.port, p.ok]), [[p1, true], [p2, true], [busy, false]], 'invalid ports dropped, busy one skipped');
    assert.match(r.ports[2].error, /used by the analyzer "Medonic M51"/);
    assert.equal(m.activeCaptures(), 1, 'the updater guard sees the capture');

    const s = await new Promise((res) => { const x = net.createConnection({ host: '127.0.0.1', port: p2 }, () => res(x)); });
    const got = [];
    s.on('data', (b) => got.push(b.toString('latin1')));
    assert.ok(await until(() => events.some((e) => e.kind === 'connected' && e.port === p2)));
    const conn = events.find((e) => e.kind === 'connected');
    assert.match(conn.remote, /^127\.0\.0\.1:\d+$/);
    assert.equal(conn.local, `127.0.0.1:${p2}`, 'which address of this PC it reached');

    s.write(M51_HL7);
    assert.ok(await until(() => events.some((e) => e.kind === 'detect' && e.port === p2)));
    const det = events.filter((e) => e.kind === 'detect').at(-1);
    assert.equal(det.detect.protocol, 'hl7');
    assert.equal(det.detect.link, 'mllp');
    assert.deepEqual({ make: det.guess.make, model: det.guess.model, label: det.guess.label }, { make: 'Medonic', model: 'M51', label: 'Medonic M51' });
    assert.ok(await until(() => got.join('').includes('MSA|AA')), 'answered like a real LIS (HL7 ACK) so the analyzer keeps talking');

    const stop = await m.scanStop(r.scanId);
    assert.equal(m.activeCaptures(), 0);
    const hit = stop.ports.find((p) => p.port === p2);
    assert.equal(hit.messages, 1);
    assert.equal(hit.guess.label, 'Medonic M51');
    assert.equal(stop.ports.find((p) => p.port === p1).remote, null, 'nobody on the other port');
    assert.equal(await new Promise((res) => { const x = net.createConnection({ host: '127.0.0.1', port: p1 }); x.once('connect', () => { x.destroy(); res(true); }); x.once('error', () => res(false)); }), false, 'ports closed after stop');
    s.destroy();
  } finally { await m.stopAll(); }
});

test('scan with no usable port says so; scanStop of an unknown id is harmless', async () => {
  const m = new ConnectorManager({ baseDir: tmp() });
  assert.deepEqual(await m.scanStart({ ports: [] }), { error: 'ports required' });
  assert.deepEqual(await m.scanStop('nope'), { ports: [] });
});

test('AnalyzerGuess mirror: HL7 MSH-3/4, ASTM H-5/H-13, MAC OUI, opt-in protocols, no match', () => {
  assert.equal(guess(headerOf('MSH|^~\\&|XN-550^00-11|SYSMEX|||20261024||ORU^R01|1|P|2.3.1')).label, 'Sysmex XN-550');
  assert.equal(guess(headerOf('MSH|^~\\&||Boule M51 Lab|||x')).profileKey, 'medonic-m51-cbc', 'MSH-4 when MSH-3 is empty');
  assert.equal(guess(headerOf('1H|\\^&|||XN-350^00-22^11001^^^^12345678||||||||E1394-97')).model, 'XN-350', 'ASTM H-5 (frame number stripped)');
  assert.equal(guess(headerOf('H|\\^&|||Host||||||||BS-240 v1.0')).label, 'Mindray BS-240', 'ASTM H-13');
  assert.equal(guess({ peerMac: '00-1b-2c-44-55-66' }).label, 'Sysmex analyzer');
  assert.equal(guess({ protocol: 'lifedx-hbpro' }).label, 'LifeDx HBPro (HbA1c)');
  assert.equal(guess({ protocol: 'sinocare-fhir' }).make, 'Sinocare');
  assert.deepEqual(guess(headerOf('MSH|^~\\&|UNKNOWNBOX|LAB|||x')), { make: null, model: null, profileKey: null, label: null });
  assert.equal(normalizeMac('0:50:c2:a:b:c'), null, 'short octets are not guessed');
  assert.equal(normalizeMac('00-50-C2-0A-0B-0C'), '00:50:C2:0A:0B:0C');
});

// ── fixed analyzer port: the wizard's "Change" ──────────────────────────────
const portListening = (port) => new Promise((res) => { const x = net.createConnection({ host: '127.0.0.1', port }); x.once('connect', () => { x.destroy(); res(true); }); x.once('error', () => res(false)); });

test('scanSetPort: new port opens FIRST, only then the suggested one closes; the usual ports stay', async () => {
  const [sugg, fixed] = [await freePort(), await freePort()];
  const m = new ConnectorManager({ baseDir: tmp() });
  const events = [];
  m.on('diag', (e) => events.push(e));
  try {
    const r = await m.scanStart({ ports: [sugg] });
    assert.equal(await portListening(sugg), true);
    const c = await m.scanSetPort({ scanId: r.scanId, port: fixed, previous: sugg });
    assert.deepEqual({ ok: c.ok, port: c.port, ports: c.ports }, { ok: true, port: fixed, ports: [fixed] });
    assert.equal(await portListening(fixed), true);
    assert.equal(await portListening(sugg), false, 'the old suggestion no longer listens');
    assert.ok(events.some((e) => e.kind === 'listening' && e.port === fixed), 'live events continue on the new port');
    // the analyzer connects on the chosen port → same live events as before
    const s = await new Promise((res) => { const x = net.createConnection({ host: '127.0.0.1', port: fixed }, () => res(x)); });
    s.write(M51_HL7);
    assert.ok(await until(() => events.some((e) => e.kind === 'detect' && e.port === fixed)));
    assert.equal(events.filter((e) => e.kind === 'detect').at(-1).guess.label, 'Medonic M51');
    s.destroy();
    // a "usual" previous port is kept open
    const keep = await m.scanSetPort({ scanId: r.scanId, port: sugg, previous: fixed, keep: [fixed] });
    assert.deepEqual(keep.ports.sort(), [sugg, fixed].sort());
    // same port again is a no-op success
    assert.equal((await m.scanSetPort({ scanId: r.scanId, port: sugg })).ok, true);
    const stop = await m.scanStop(r.scanId);
    assert.equal(stop.ports.length, 2);
  } finally { await m.stopAll(); }
});

test('scanSetPort refusals leave the previous port listening: invalid, paired-by-another-analyzer, held by a program (named)', async () => {
  const [sugg, pairedPort, held] = [await freePort(), await freePort(), await freePort()];
  const { m } = await managerWithPaired(pairedPort);
  m.connectorOpts = { portOwner: async (p) => (p === held ? { pid: 7412, name: 'CBCLisM51' } : null) };
  const squatter = net.createServer();
  await new Promise((r) => squatter.listen(held, '0.0.0.0', r));
  try {
    const { scanId } = await m.scanStart({ ports: [sugg] });
    for (const bad of [0, 70000, 80.5, NaN, '5603', null]) {
      const r = await m.scanSetPort({ scanId, port: bad, previous: sugg });
      assert.equal(r.ok, false); assert.equal(r.code, 'invalid_port'); assert.match(r.error, /1 to 65535/);
    }
    const a = await m.scanSetPort({ scanId, port: pairedPort, previous: sugg });
    assert.equal(a.code, 'port_in_use');
    assert.match(a.error, /used by the analyzer "Medonic M51" on this PC/);
    const b = await m.scanSetPort({ scanId, port: held, previous: sugg });
    assert.equal(b.code, 'port_in_use');
    assert.equal(b.error, `Port ${held} is used by CBCLisM51 (PID 7412). Close that program, or pick another port for this analyzer.`);
    assert.equal(await portListening(sugg), true, 'previous port still listening after every refusal');
    assert.equal((await m.scanSetPort({ scanId: 'gone', port: sugg })).code, 'no_scan');
    // a port below 1024 is allowed but warned
    const low = await m.scanSetPort({ scanId, port: 1, previous: sugg });
    if (low.ok) assert.match(low.warning, /administrator/); else assert.ok(low.error);
    assert.equal(await portListening(sugg), low.ok ? false : true);
  } finally { squatter.close(); await m.stopAll(); }
});

test('listen vs paired is refused both ways: a paired analyzer\'s port can\'t be listened on, and pair() refuses a second analyzer on the same port', async () => {
  const port = await freePort();
  const { m } = await managerWithPaired(port);
  try {
    assert.match(m.conflictFor({ type: 'tcp-server', port }), /used by the analyzer "Medonic M51"/);
    assert.equal(m.conflictFor({ type: 'tcp-server', port }, { exceptInstrumentId: ID }), null, 're-pairing the same analyzer is fine');
    assert.equal(m.conflictFor({ type: 'tcp-client', port }), null, 'a client dial uses no listen port');
    const OTHER = '99999999-2222-3333-4444-555555555555';
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { name: 'Other', config: { transport: { type: 'tcp-server', port } }, codeMaps: [] } }), text: async () => '{}' });
    const m2 = Object.assign(m, { fetchImpl });
    const r = await m2.pair({ instrumentId: OTHER, deviceKey: 'k', apiUrl: 'http://localhost:1' });
    assert.equal(r.ok, false);
    assert.match(r.error, /^Port \d+ is used by the analyzer "Medonic M51" on this PC/);
    assert.equal(m.paired.some((p) => p.instrumentId === OTHER), false, 'nothing stored');
  } finally { await m.stopAll(); }
});
