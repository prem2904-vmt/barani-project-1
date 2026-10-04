'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AstmReceiver, AstmSender, checksum, encodeFrames, decodeFrame } = require('../core/link/astm-e1381');
const { C } = require('../core/bytes');

/** Wire a sender and a receiver together in memory. */
function pair({ corrupt, receiverOpts = {} } = {}) {
  const log = { toReceiver: [], toSender: [] };
  let rx;
  const tx = new AstmSender({ write: (b) => { log.toReceiver.push(Buffer.from(b)); setImmediate(() => rx.feed(b)); }, ackTimeoutMs: 500, busyRetryMs: 20, corrupt });
  rx = new AstmReceiver({ write: (b) => { log.toSender.push(Buffer.from(b)); setImmediate(() => tx.feed(b)); }, ...receiverOpts });
  return { tx, rx, log };
}

test('checksum is the mod-256 sum of FN…ETX as 2 upper-case hex chars', () => {
  // "1H|\^&\r<ETX>": known-good value computed by hand.
  const body = `1H|\\^&\r${String.fromCharCode(C.ETX)}`;
  let s = 0; for (const ch of Buffer.from(body, 'latin1')) s = (s + ch) % 256;
  assert.equal(checksum(body), s.toString(16).toUpperCase().padStart(2, '0'));
  assert.match(checksum(body), /^[0-9A-F]{2}$/);
});

test('encodeFrames splits records > 240 chars into ETB + ETX frames with rolling FN', () => {
  const long = 'C|1|I|' + 'x'.repeat(500) + '|G';
  const frames = encodeFrames(`H|\\^&\r${long}\rL|1|N\r`);
  // H (1 frame) + long record (3 frames: 240+240+rest) + L (1 frame) = 5
  assert.equal(frames.length, 5);
  const decoded = frames.map(decodeFrame);
  assert.deepEqual(decoded.map((d) => d.fn), [1, 2, 3, 4, 5]);
  assert.deepEqual(decoded.map((d) => d.final), [true, false, false, true, true]);
  assert.ok(decoded.every((d) => d.ok));
  assert.equal(decoded.slice(1, 4).map((d) => d.text).join(''), long + '\r');
});

test('frame numbers wrap 7 → 0', () => {
  const recs = Array.from({ length: 10 }, (_x, i) => `R|${i + 1}|^^^X|1`).join('\r') + '\r';
  const fns = encodeFrames(recs).map((f) => decodeFrame(f).fn);
  assert.deepEqual(fns, [1, 2, 3, 4, 5, 6, 7, 0, 1, 2]);
});

test('sender → receiver delivers the reassembled message (incl. ETB multi-frame)', async () => {
  const { tx, rx } = pair();
  const msg = `H|\\^&|||SIM\rO|1|260100001\rR|1|^^^WBC|7.8|10^3/uL||H\rC|1|I|${'y'.repeat(600)}|G\rL|1|N\r`;
  const got = new Promise((r) => rx.once('message', r));
  const st = await tx.send(msg);
  assert.equal(await got, msg);
  assert.equal(st.naks, 0);
});

test('bad checksum is NAKed and the retransmitted frame is accepted', async () => {
  const { tx, rx, log } = pair({ corrupt: (i, attempt) => i === 1 && attempt === 1 });
  const frames = [];
  rx.on('frame', (f) => frames.push(f));
  const msg = 'H|\\^&\rO|1|S1\rR|1|^^^HGB|10.2|g/dL||L\rL|1|N\r';
  const got = new Promise((r) => rx.once('message', r));
  const st = await tx.send(msg);
  assert.equal(await got, msg);
  assert.equal(st.naks, 1);
  assert.equal(st.retransmits, 1);
  assert.ok(frames.some((f) => !f.ok && /checksum/.test(f.reason)));
  assert.ok(log.toSender.some((b) => b[0] === C.NAK));
});

test('a repeated frame (lost ACK) is ACKed but not appended twice', () => {
  const out = [];
  const rx = new AstmReceiver({ write: (b) => out.push(b[0]) });
  let msg = null;
  rx.on('message', (m) => { msg = m; });
  const frames = encodeFrames('H|\\^&\rL|1|N\r');
  rx.feed(Buffer.from([C.ENQ]));
  rx.feed(frames[0]);
  rx.feed(frames[0]); // duplicate
  rx.feed(frames[1]);
  rx.feed(Buffer.from([C.EOT]));
  assert.deepEqual(out, [C.ACK, C.ACK, C.ACK, C.ACK]);
  assert.equal(msg, 'H|\\^&\rL|1|N\r');
  rx.close();
});

test('out-of-sequence frame number is NAKed', () => {
  const out = [];
  const rx = new AstmReceiver({ write: (b) => out.push(b[0]) });
  const frames = encodeFrames('H|\\^&\rP|1\rL|1|N\r');
  rx.feed(Buffer.from([C.ENQ]));
  rx.feed(frames[1]); // FN 2 when 1 expected
  assert.deepEqual(out, [C.ACK, C.NAK]);
  rx.close();
});

test('receiver answers ENQ with NAK while busy (contention)', () => {
  const out = [];
  const rx = new AstmReceiver({ write: (b) => out.push(b[0]), busy: () => true });
  rx.feed(Buffer.from([C.ENQ]));
  assert.deepEqual(out, [C.NAK]);
  assert.equal(rx.state, 'idle');
});

test('frame timeout discards a partial message and returns to idle', async () => {
  const rx = new AstmReceiver({ write: () => {}, frameTimeoutMs: 30 });
  let timedOut = false;
  let delivered = false;
  rx.on('timeout', () => { timedOut = true; });
  rx.on('message', () => { delivered = true; });
  rx.feed(Buffer.from([C.ENQ]));
  rx.feed(encodeFrames('H|\\^&\r')[0]);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(timedOut, true);
  assert.equal(rx.state, 'idle');
  rx.feed(Buffer.from([C.EOT]));
  assert.equal(delivered, false);
});

test('sender gives up after maxRetries NAKs and sends EOT', async () => {
  const written = [];
  let tx;
  // A receiver that ACKs ENQ but NAKs every frame.
  tx = new AstmSender({
    write: (b) => { written.push(b[0]); setImmediate(() => tx.feed(Buffer.from([b[0] === C.ENQ ? C.ACK : C.NAK]))); },
    ackTimeoutMs: 200, maxRetries: 2,
  });
  await assert.rejects(tx.send('H|\\^&\r'), /rejected/);
  assert.equal(written[written.length - 1], C.EOT);
});
