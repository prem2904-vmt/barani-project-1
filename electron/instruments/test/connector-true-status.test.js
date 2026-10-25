'use strict';
/**
 * True analyzer status (next-phase §4, Arun Lab 24 Oct): "Online" only when
 * the analyzer is really connected.
 *   • deriveLink table (connected / waiting / not_connected / error);
 *   • a TCP server: waiting → a peer connects (remote, local, since) →
 *     connected; any byte (a lone keep-alive too) stamps lastRxAt; the peer
 *     leaves → waiting again; the heartbeat carries link / sessions /
 *     lastRxAt / listenPort / errorDetail;
 *   • a port another program holds: plain words naming it (host lookup),
 *     the heartbeat still goes out (link error + errorDetail), and the
 *     heartbeat retries until the port is free;
 *   • a protocol change applies to an ALREADY-OPEN session (the HBPro bug);
 *   • a cosmetic key-order change never restarts the transport;
 *   • a TCP client that is refused says so in plain words.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { Connector, deriveLink, stableJson } = require('../core/connector');
const { friendlyTransportError } = require('../core/errors');

const ID = '11111111-2222-3333-4444-555555555555';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pf-inst-true-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await wait(20); }
  return false;
}
function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
}
const STX = 0x02; const ETX = 0x03; const ACK = 0x06;

/** An uploader double: serves `cfg()` and records every heartbeat body. */
function stubUploader(cfg) {
  const beats = [];
  return {
    beats,
    getConfig: async () => ({ id: ID, name: 'True status', config: cfg(), codeMaps: [], heartbeatSeconds: 30 }),
    heartbeat: async (body) => { beats.push(body); return { ok: true }; },
    postMessage: async () => ({ state: 'matched' }),
  };
}

function analyzer(port) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host: '127.0.0.1', port }, () => resolve(s));
    s.once('error', reject);
  });
}

test('deriveLink: connected only with a real session (or recent serial bytes); listening alone is waiting', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  assert.equal(deriveLink({ state: 'listening', kind: 'tcp-server', sessions: 0 }), 'waiting');
  assert.equal(deriveLink({ state: 'connected', kind: 'tcp-server', sessions: 1 }), 'connected');
  assert.equal(deriveLink({ state: 'disconnected', kind: 'tcp-client', sessions: 0 }), 'not_connected');
  assert.equal(deriveLink({ state: 'connected', kind: 'tcp-client', sessions: 1 }), 'connected');
  assert.equal(deriveLink({ state: 'error', kind: 'tcp-server', sessions: 0 }), 'error');
  assert.equal(deriveLink({ state: 'stopped', kind: null }), 'not_connected');
  // Serial: an open port is a "session" but says nothing about the analyzer.
  assert.equal(deriveLink({ state: 'connected', kind: 'serial', sessions: 1, lastRxAt: null, now }), 'waiting');
  assert.equal(deriveLink({ state: 'connected', kind: 'serial', sessions: 1, lastRxAt: '2026-10-24T11:58:00Z', now }), 'connected');
  assert.equal(deriveLink({ state: 'connected', kind: 'serial', sessions: 1, lastRxAt: '2026-10-24T11:50:00Z', now }), 'waiting');
  assert.equal(deriveLink({ state: 'listening', kind: 'folder' }), 'connected');
});

test('friendly errors: port busy (named owner / our own / unknown), access denied, refused, serial busy', () => {
  const e = (code, message = code) => Object.assign(new Error(message), { code });
  const srv = { type: 'tcp-server', port: 5600 };
  assert.equal(friendlyTransportError(e('EADDRINUSE'), srv, { pid: 7412, name: 'CBCLisM51' }),
    'Port 5600 is used by CBCLisM51 (PID 7412). Close that program, or pick another port for this analyzer.');
  assert.match(friendlyTransportError(e('EADDRINUSE'), srv, { pid: 9020, name: 'Prefrontal', ours: true }), /another analyzer in Prefrontal/);
  assert.match(friendlyTransportError(e('EADDRINUSE'), srv, null), /^Port 5600 is already used by another program/);
  assert.match(friendlyTransportError(e('EACCES'), srv), /^Port 5600 can't be used on this PC \(access denied/);
  assert.match(friendlyTransportError(e('ECONNREFUSED'), { type: 'tcp-client', host: '192.168.1.30', port: 5100 }), /192\.168\.1\.30:5100 refused the connection/);
  assert.match(friendlyTransportError(e('ETIMEDOUT'), { type: 'tcp-client', host: '192.168.1.30', port: 5100 }), /Can't reach the analyzer/);
  assert.match(friendlyTransportError(new Error('Opening COM3: Access denied'), { type: 'serial', path: 'COM3' }), /COM3 is open in another program/);
  assert.equal(friendlyTransportError(new Error('weird'), srv), 'weird');
});

test('TCP server: waiting → connected from <peer> → lastRxAt on a lone keep-alive → waiting; heartbeat carries it all', async () => {
  const port = await freePort();
  const up = stubUploader(() => ({ transport: { type: 'tcp-server', host: '127.0.0.1', port }, link: { type: 'auto' }, parser: { type: 'auto' } }));
  const c = new Connector({ instrumentId: ID, dataDir: tmp(), uploader: up, heartbeatMs: 40 });
  try {
    await c.start();
    assert.ok(await until(() => c.status().link === 'waiting'));
    assert.equal(c.status().listenPort, port);
    assert.deepEqual(c.status().sessions, []);
    assert.ok(await until(() => up.beats.some((b) => b.link === 'waiting' && b.listenPort === port)), 'heartbeat says waiting');

    const s = await analyzer(port);
    assert.ok(await until(() => c.status().link === 'connected'));
    const st = c.status();
    assert.equal(st.sessions.length, 1);
    assert.match(st.sessions[0].remote, /^127\.0\.0\.1:\d+$/);
    assert.equal(st.sessions[0].local, `127.0.0.1:${port}`);
    assert.ok(!Number.isNaN(Date.parse(st.sessions[0].since)));
    assert.equal(st.lastRxAt, null, 'nothing heard yet');

    s.write(Buffer.from([STX]));     // Mindray-style idle ping
    assert.ok(await until(() => c.status().lastRxAt !== null), 'a keep-alive byte counts as "heard"');
    assert.ok(await until(() => up.beats.some((b) => b.link === 'connected' && b.sessions.length === 1 && b.lastRxAt)));
    const hb = up.beats.find((b) => b.link === 'connected');
    assert.deepEqual(Object.keys(hb.sessions[0]).sort(), ['remote', 'since'], 'heartbeat sessions = contract shape');
    assert.equal(hb.errorDetail, null);

    s.destroy();
    assert.ok(await until(() => c.status().link === 'waiting' && c.status().sessions.length === 0), 'peer gone → waiting');
  } finally { await c.stop(); }
});

test('port held by another program: named in plain words, still heartbeats (error), retried until free', async () => {
  const port = await freePort();
  const squatter = net.createServer();
  await new Promise((r) => squatter.listen(port, '127.0.0.1', r));
  const up = stubUploader(() => ({ transport: { type: 'tcp-server', host: '127.0.0.1', port }, link: { type: 'auto' }, parser: { type: 'auto' } }));
  const asked = [];
  const c = new Connector({
    instrumentId: ID, dataDir: tmp(), uploader: up, heartbeatMs: 60,
    portOwner: async (p) => { asked.push(p); return { pid: 7412, name: 'CBCLisM51' }; },
  });
  try {
    await c.start();   // must NOT reject — the lab still needs the heartbeat
    assert.equal(c.status().state, 'error');
    assert.equal(c.status().link, 'error');
    assert.equal(c.status().errorDetail, `Port ${port} is used by CBCLisM51 (PID 7412). Close that program, or pick another port for this analyzer.`);
    assert.deepEqual(asked.slice(0, 1), [port]);
    assert.ok(await until(() => up.beats.some((b) => b.link === 'error' && /CBCLisM51/.test(b.errorDetail || ''))), 'heartbeat carries the reason');

    await new Promise((r) => squatter.close(r));
    assert.ok(await until(() => c.status().link === 'waiting', 4000), 'heartbeat retried and the port opened');
    assert.equal(c.status().errorDetail, null);
    assert.ok(await until(() => up.beats.at(-1).link === 'waiting'));
  } finally { await c.stop(); if (squatter.listening) squatter.close(); }
});

test('a protocol change is applied to the ALREADY-OPEN session (no reconnect needed)', async () => {
  const port = await freePort();
  let cfg = { transport: { type: 'tcp-server', host: '127.0.0.1', port }, link: { type: 'auto' }, parser: { type: 'auto' } };
  const up = stubUploader(() => cfg);
  const c = new Connector({ instrumentId: ID, dataDir: tmp(), uploader: up, heartbeatMs: 60000 });
  try {
    await c.start();
    const s = await analyzer(port);
    const got = [];
    s.on('data', (b) => got.push(...b));
    assert.ok(await until(() => c.status().link === 'connected'));
    s.write('some plain text before the change\r\n');
    await wait(50);

    // Owner switches the protocol to LifeDx HBPro (STX/ETX + ACK) while the analyzer stays connected.
    cfg = { ...cfg, link: { type: 'stx-etx' }, parser: { type: 'lifedx-hbpro' } };
    const r = await c.reload();
    assert.deepEqual(r, { changed: true, restarted: false }, 'transport kept — the analyzer is not dropped');
    assert.equal(c.links.size, 1, 'the open session already has a new link');
    assert.equal(c.links.values().next().value.configured, 'stx-etx');

    s.write(Buffer.concat([Buffer.from([STX]), Buffer.from('S04----19MS TEST PATNT  29 F0329', 'latin1'), Buffer.from([ETX])]));
    assert.ok(await until(() => got.includes(ACK)), 'the SAME socket got the HBPro ACK');
    assert.ok(c.rawlog.recent(50).some((e) => /protocol settings applied to the open connection/.test(e.text || '')));
    s.destroy();
  } finally { await c.stop(); }
});

test('a transport saved back with its keys in another order is the same transport — never restarted', async () => {
  assert.equal(stableJson({ type: 'tcp-server', port: 5600, host: '0.0.0.0' }), stableJson({ host: '0.0.0.0', port: 5600, type: 'tcp-server' }));
  const port = await freePort();
  let cfg = { transport: { type: 'tcp-server', host: '127.0.0.1', port }, link: { type: 'auto' }, parser: { type: 'auto' } };
  const c = new Connector({ instrumentId: ID, dataDir: tmp(), uploader: stubUploader(() => cfg), heartbeatMs: 60000 });
  try {
    await c.start();
    const s = await analyzer(port);
    assert.ok(await until(() => c.status().link === 'connected'));
    cfg = { ...cfg, transport: { port, host: '127.0.0.1', type: 'tcp-server' } };
    assert.deepEqual(await c.reload(), { changed: false, restarted: false });
    assert.equal(c.status().link, 'connected', 'the analyzer stayed connected');
    s.destroy();
  } finally { await c.stop(); }
});

test('an editor save that writes out the default host (0.0.0.0) does not restart a TCP server', async () => {
  const port = await freePort();
  let cfg = { transport: { type: 'tcp-server', port }, link: { type: 'auto' }, parser: { type: 'auto' } };
  const c = new Connector({ instrumentId: ID, dataDir: tmp(), uploader: stubUploader(() => cfg), heartbeatMs: 60000 });
  try {
    await c.start();
    const s = await analyzer(port);
    assert.ok(await until(() => c.status().link === 'connected'));
    cfg = { ...cfg, transport: { type: 'tcp-server', port, host: '0.0.0.0' }, parser: { type: 'hl7' } };
    assert.deepEqual(await c.reload(), { changed: true, restarted: false });
    assert.equal(c.status().link, 'connected');
    s.destroy();
  } finally { await c.stop(); }
});

test('TCP client refused: not connected, with a plain-words reason in status + heartbeat', async () => {
  const port = await freePort();   // nothing listens here
  const up = stubUploader(() => ({ transport: { type: 'tcp-client', host: '127.0.0.1', port, reconnectMs: 50 }, link: { type: 'auto' }, parser: { type: 'auto' } }));
  const c = new Connector({ instrumentId: ID, dataDir: tmp(), uploader: up, heartbeatMs: 60 });
  try {
    await c.start();
    assert.ok(await until(() => /refused the connection/.test(c.status().errorDetail || '')));
    assert.equal(c.status().link, 'not_connected');
    assert.ok(await until(() => up.beats.some((b) => b.link === 'not_connected' && /refused/.test(b.errorDetail || ''))));
  } finally { await c.stop(); }
});
