'use strict';
/**
 * Regression coverage for the orphaned-client-socket bug (Mindray BC-5130,
 * 2026-10-10): a config-changed reconfigure (tcp-server → tcp-client) raced
 * against the connector's own startup, which left TWO client sockets
 * connected to an analyzer that only accepts ONE — the tracked transport
 * lost the race, the OTHER (untracked, orphaned) socket held the analyzer's
 * one connection slot forever, and every later reconnect attempt was
 * accepted-then-closed in under a second.
 *
 *   • connector.js: start()/stop()/reload() are now strictly sequential
 *     (_enqueue) and _startTransport() carries a generation token so a
 *     superseded transport's own late events/callbacks are no-ops.
 *   • transports/tcp.js: TcpClientTransport.stop() awaits the actual socket
 *     close, every socket event handler checks socket identity, and a
 *     repeated "peer accepted then closed us right away" backs off
 *     (1×/2×/6×/12× reconnectMs, capped) with a one-time hint.
 *   • link/index.js: the auto-sniffer skips a lone non-ENQ/VT control byte
 *     (a keep-alive, e.g. a lone <STX>) instead of locking the session into
 *     'raw' and breaking the real message that follows.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { Connector, isLoneKeepAliveByte } = require('../core/connector');
const { TcpClientTransport } = require('../core/transports/tcp');
const { Link, isAutoNoiseByte } = require('../core/link/index');
const { C } = require('../core/bytes');

const ID = '11111111-2222-3333-4444-555555555555';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pf-inst-race-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await wait(20); }
  return false;
}
function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
}

test('race: start() and an almost-simultaneous reload() to the same analyzer never open two client sockets', async () => {
  // Fake analyzer: tracks every socket that is simultaneously live so the
  // test can assert the orphan never happens, and records incoming bytes so
  // it can assert data really reaches the connector through the surviving
  // (tracked) socket, not a dead one.
  const live = new Set();
  let maxConcurrent = 0;
  const analyzer = net.createServer((sock) => {
    live.add(sock);
    maxConcurrent = Math.max(maxConcurrent, live.size);
    sock.on('close', () => live.delete(sock));
  });
  await new Promise((resolve) => analyzer.listen(0, '127.0.0.1', resolve));
  const port = analyzer.address().port;

  const cfg = { transport: { type: 'tcp-client', host: '127.0.0.1', port }, link: { type: 'raw', idleMs: 200 }, parser: { type: 'text' } };
  let getConfigCalls = 0;
  const uploader = {
    getConfig: async () => {
      getConfigCalls++;
      // The FIRST pull (connector startup) is slow — as it realistically is
      // over a real network — so the host's "instrument saved" reload lands
      // squarely in the middle of it.
      if (getConfigCalls === 1) await wait(80);
      return { id: ID, name: 'Race', config: cfg, codeMaps: [], heartbeatSeconds: 3600 };
    },
    heartbeat: async () => ({ ok: true }),
    postMessage: async () => ({}),
  };
  const c = new Connector({ instrumentId: ID, dataDir: tmp(), uploader, heartbeatMs: 3600_000 });
  try {
    const startP = c.start();
    await wait(15); // start() is still awaiting its slow first getConfig()
    const reloadP = c.reload(); // "instrument saved" — the host's IPC calls this on a running connector
    await Promise.all([startP, reloadP]);
    await wait(250); // let anything that WOULD race (pre-fix) finish connecting too

    assert.equal(maxConcurrent, 1, `expected at most one live client socket to the analyzer at any instant, saw ${maxConcurrent}`);
    assert.equal(live.size, 1, 'exactly one socket alive after the race settles — no orphan left behind');
    assert.equal(c.transport.describe(), `TCP client → 127.0.0.1:${port}`, 'the connector is tracking the live socket, not a stale one');

    const sock = [...live][0];
    sock.write('SAMPLE ID: 2609-00013\r\nWBC 7.8 10^9/L\r\n');
    assert.ok(await until(() => c.lastMessageAt != null), 'data the analyzer sends reaches the connector through its tracked, non-orphan transport');
  } finally {
    await c.stop();
    analyzer.close();
  }
});

test('tcp-client: a peer that accepts-then-closes repeatedly backs off 1x/2x/6x reconnectMs (capped) and hints once', async () => {
  const attempts = [];
  const srv = net.createServer((sock) => { attempts.push(Date.now()); sock.destroy(); }); // "accepts ONE client" that immediately rejects
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const port = srv.address().port;

  const t = new TcpClientTransport({ host: '127.0.0.1', port, reconnectMs: 40, maxReconnectMs: 400 });
  const errors = [];
  t.on('error', (e) => errors.push(e.message));
  try {
    await t.start();
    // base(40) + 2x(80) + 6x(240) + a margin to observe a 4th attempt too.
    assert.ok(await until(() => attempts.length >= 4, 1200), `expected several escalating reconnect attempts, got ${attempts.length}`);
    const gaps = attempts.slice(1).map((at, i) => at - attempts[i]);
    assert.ok(gaps[0] >= 30 && gaps[0] < 70, `first backoff ~1x reconnectMs, got ${gaps.join(',')}`);
    assert.ok(gaps[1] >= gaps[0] * 1.5, `second backoff should escalate past the first: ${gaps.join(',')}`);
    assert.ok(gaps[2] >= gaps[1] * 1.5, `third backoff should escalate further: ${gaps.join(',')}`);
    const hints = errors.filter((m) => /only allow one LIS connection/.test(m));
    assert.equal(hints.length, 1, `the "accepted and closed" hint logs exactly once per problem episode, got ${hints.length}`);
  } finally {
    await t.stop();
    srv.close();
  }
});

test('tcp-client: stop() awaits the real socket close — never more than one live socket across a stop+start', async () => {
  const live = new Set();
  let maxConcurrent = 0;
  const srv = net.createServer((sock) => { live.add(sock); maxConcurrent = Math.max(maxConcurrent, live.size); sock.on('close', () => live.delete(sock)); });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const port = srv.address().port;

  const a = new TcpClientTransport({ host: '127.0.0.1', port, reconnectMs: 10_000 });
  try {
    await a.start();
    assert.ok(await until(() => live.size === 1));
    await a.stop(); // must resolve only once the socket is actually gone
    assert.equal(live.size, 0, 'stop() resolved only after the socket fully closed');

    const b = new TcpClientTransport({ host: '127.0.0.1', port, reconnectMs: 10_000 });
    await b.start();
    assert.ok(await until(() => live.size === 1));
    assert.equal(maxConcurrent, 1, 'the old and new transport were never both connected at once');
    await b.stop();
  } finally { srv.close(); }
});

test('keep-alive: a lone non-ENQ/VT control byte (e.g. <STX>) is noise for the auto-sniffer, never the start of a protocol', () => {
  assert.equal(isAutoNoiseByte(C.STX), true);
  assert.equal(isAutoNoiseByte(C.ACK), true);
  assert.equal(isAutoNoiseByte(C.EOT), true);
  assert.equal(isAutoNoiseByte(C.ENQ), false, 'ENQ starts a real ASTM session');
  assert.equal(isAutoNoiseByte(C.VT), false, 'VT starts a real MLLP block');
});

test('keep-alive: isLoneKeepAliveByte flags a standalone control byte, never ENQ/VT or multi-byte data', () => {
  assert.equal(isLoneKeepAliveByte(Buffer.from([C.STX])), true);
  assert.equal(isLoneKeepAliveByte(Buffer.from([C.ENQ])), false);
  assert.equal(isLoneKeepAliveByte(Buffer.from([C.VT])), false);
  assert.equal(isLoneKeepAliveByte(Buffer.from([C.STX, C.STX])), false, 'only a lone byte counts — real content is never suppressed');
  assert.equal(isLoneKeepAliveByte(Buffer.from('X')), false);
});

test('keep-alive: a lone <STX> ping does not lock the auto-link into raw, and the real MLLP message after it still parses', () => {
  const writes = [];
  const link = new Link({ type: 'auto' }, { write: (b) => writes.push(b), reply: () => null });
  const messages = [];
  link.on('message', (text, meta) => messages.push({ text, meta }));

  // Three keep-alive pings, each its own data event (as the analyzer sends them).
  link.feed(Buffer.from([C.STX]));
  link.feed(Buffer.from([C.STX]));
  link.feed(Buffer.from([C.STX]));
  assert.equal(messages.length, 0, 'keep-alive pings never produce a message');
  assert.equal(link.type, null, 'no protocol has been locked in by the pings alone');

  // The real HL7 MLLP message now arrives.
  const hl7 = 'MSH|^~\\&|BC5130|LAB|||20261010120000||ORU^R01|1|P|2.3.1\rOBX|1|NM|WBC||7.8|10*3/uL|4.0-10.0|N|||F\r';
  link.feed(Buffer.concat([Buffer.from([C.VT]), Buffer.from(hl7, 'latin1'), Buffer.from([C.FS, C.CR])]));
  assert.equal(messages.length, 1, 'the real message parses correctly after the keep-alive noise');
  assert.equal(messages[0].meta.link, 'mllp');
  assert.ok(messages[0].text.includes('WBC'));
});

test('keep-alive: connector throttles raw.log for a repeating lone control byte (logs first + periodic count, not every one)', async () => {
  const uploader = {
    getConfig: async () => ({ id: ID, name: 'KA', config: { transport: { type: 'tcp-server', host: '127.0.0.1', port: 0 }, link: { type: 'auto' }, parser: { type: 'auto' } }, codeMaps: [], heartbeatSeconds: 3600 }),
    heartbeat: async () => ({ ok: true }),
    postMessage: async () => ({}),
  };
  const c = new Connector({ instrumentId: ID, dataDir: tmp(), uploader, heartbeatMs: 3600_000 });
  try {
    await c.start();
    const before = c.rawlog.recent(1000).length;
    for (let i = 0; i < 20; i++) c._logIncoming(Buffer.from([C.STX]));
    const notes = c.rawlog.recent(1000).slice(before);
    const stxLines = notes.filter((n) => /keep-alive/.test(n.text));
    assert.equal(stxLines.length, 1, `20 repeats of the same keep-alive byte should log only the first (within the minute window), got ${stxLines.length}`);

    // A real byte right after still logs normally and resets the throttle state.
    c._logIncoming(Buffer.from('X'));
    const after = c.rawlog.recent(1000).slice(before);
    assert.ok(after.some((n) => n.dir === 'in' && n.text === 'X'), 'ordinary content is still logged in full');
  } finally { await c.stop(); }
});
