'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detect } = require('../core/detect');
const { encodeFrames } = require('../core/link/astm-e1381');
const { frame: mllp } = require('../core/link/mllp');
const { applyMaps, convertValue, roundAway } = require('../core/mapper');
const { DiskQueue } = require('../core/queue');
const { RawLog } = require('../core/rawlog');
const { MllpReceiver } = require('../core/link/mllp');
const { RawReceiver } = require('../core/link/raw');
const { createLink } = require('../core/link');
const { C } = require('../core/bytes');
const { astmMessage, hl7Message, textMessage } = require('../sim/dialects');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pf-inst-'));

// ── auto-detect ─────────────────────────────────────────────────────────
test('detect: ASTM E1381 capture → astm + proposal with O.3', () => {
  const { text } = astmMessage({ sampleId: '260100061' });
  const raw = Buffer.concat([Buffer.from([C.ENQ]), ...encodeFrames(text), Buffer.from([C.EOT])]);
  const d = detect(raw);
  assert.equal(d.protocol, 'astm');
  assert.equal(d.link, 'astm-e1381');
  assert.ok(d.confidence >= 0.9, `confidence ${d.confidence}`);
  assert.deepEqual(d.proposed.parser.astm, { sampleIdField: 3, sampleIdComponent: 1 });
  assert.equal(d.messages[0].sampleId, '260100061');
});

test('detect: MLLP HL7 capture → hl7 with OBR-3', () => {
  const { text } = hl7Message({ sampleId: '260100062' });
  const d = detect(mllp(text));
  assert.equal(d.protocol, 'hl7');
  assert.equal(d.link, 'mllp');
  assert.equal(d.proposed.parser.hl7.sampleIdField, 'OBR-3');
  assert.equal(d.messages[0].results.length, 20);
});

test('detect: plain printed ticket → text template', () => {
  const d = detect(textMessage({ sampleId: '260100063' }).text);
  assert.equal(d.protocol, 'text');
  assert.equal(d.link, 'raw');
  assert.ok(d.proposed.parser.text.linePattern);
  assert.equal(d.messages[0].sampleId, '260100063');
});

test('detect: ASTM records without framing (e.g. a file export) and O.4 barcodes', () => {
  const d = detect('H|\\^&\rP|1\rO|1||260100064|^^^CBC\rR|1|^^^WBC|6.1|10^3/uL\rL|1\r');
  assert.equal(d.protocol, 'astm');
  assert.equal(d.link, 'raw');
  assert.equal(d.proposed.parser.astm.sampleIdField, 4);
});

test('detect: garbage → unknown with confidence 0', () => {
  const d = detect(Buffer.from([0x81, 0x92, 0x33, 0x44]));
  assert.equal(d.protocol, 'unknown');
  assert.equal(d.confidence, 0);
});

// ── mapper ──────────────────────────────────────────────────────────────
const MAPS = [
  { analyzerCode: 'WBC', testCatalogKey: 'HEM019', factor: 1000, decimals: 0, unit: 'cells/µL' },
  { analyzerCode: 'HGB', testCatalogKey: 'HEM011', decimals: 1 },
  { analyzerCode: 'neut#', testCatalogKey: 'HEM025', factor: 1, decimals: 2, unit: '×10⁹/L' },
  { analyzerCode: 'TEMP', testCatalogKey: 'X1', factor: 1.8, offset: 32, decimals: 1 },
];

test('mapper: factor, offset, decimals, units, flags; unmapped codes listed', () => {
  const msg = { results: [
    { code: 'WBC', value: '7.8', unit: '10^3/uL', flags: ['H'] },
    { code: 'HGB', value: '10.25', unit: 'g/dL', flags: [] },
    { code: 'NEUT#', value: '4.5', unit: '10^3/uL', flags: [] },
    { code: 'TEMP', value: '37', unit: 'C', flags: [] },
    { code: 'P-LCR', value: '30', unit: '%', flags: [] },
  ] };
  const { mapped, unmapped } = applyMaps(msg, MAPS);
  assert.deepEqual(mapped.map((m) => [m.catalogKey, m.value, m.unit, m.rawValue, m.rawUnit]), [
    ['HEM019', '7800', 'cells/µL', '7.8', '10^3/uL'],
    ['HEM011', '10.3', 'g/dL', '10.25', 'g/dL'],       // half away from zero
    ['HEM025', '4.50', '×10⁹/L', '4.5', '10^3/uL'],
    ['X1', '98.6', null, '37', 'C'],
  ].map(([k, v, u, rv, ru]) => [k, v, u ?? 'C', rv, ru]));
  assert.deepEqual(mapped[0].flags, ['H']);
  assert.deepEqual(unmapped, ['P-LCR']);
});

test('mapper: non-numeric values pass through; rounding is half away from zero', () => {
  assert.equal(convertValue('Positive', { factor: 1000 }), 'Positive');
  assert.equal(convertValue('>1000', { factor: 2 }), '>1000');
  assert.equal(convertValue('1.005', { decimals: 2 }), '1.01');
  assert.equal(convertValue('-2.5', { decimals: 0 }), '-3');
  assert.equal(convertValue('0.1', { factor: 3 }), '0.3');
  assert.equal(roundAway(2.345, 2), 2.35);
});

// ── queue ───────────────────────────────────────────────────────────────
test('queue: survives restart, de-duplicates keys, backoff then done', () => {
  const dir = tmp();
  let now = 1000;
  const q = new DiskQueue({ dir, now: () => now, random: () => 0.5, baseDelayMs: 100 }).load();
  assert.equal(q.add({ key: 'k1', payload: { a: 1 } }).added, true);
  assert.equal(q.add({ key: 'k1', payload: { a: 1 } }).added, false);    // idempotent
  assert.equal(q.add({ key: 'k2', payload: { a: 2 } }).added, true);
  const [first] = q.due();
  q.retry(first.id, 'network');
  assert.equal(q.due().length, 1);                                          // k1 backing off
  now += 100;
  assert.equal(q.due().length, 2);

  // "Crash" and reload from disk.
  const q2 = new DiskQueue({ dir, now: () => now }).load();
  assert.equal(q2.length, 2);
  const k1 = [...q2.items.values()].find((i) => i.key === 'k1');
  assert.equal(k1.attempts, 1);
  q2.done(k1.id);
  assert.equal(q2.add({ key: 'k1', payload: {} }).added, false);           // done keys remembered
  const q3 = new DiskQueue({ dir }).load();
  assert.equal(q3.length, 1);
  assert.equal(q3.hasKey('k1'), true);
  q3.compact();
  const q4 = new DiskQueue({ dir }).load();
  assert.equal(q4.length, 1);
  assert.equal(q4.hasKey('k1'), true);
});

test('queue: a torn last line (crash mid-write) is ignored', () => {
  const dir = tmp();
  const q = new DiskQueue({ dir }).load();
  q.add({ key: 'a', payload: 1 });
  fs.appendFileSync(path.join(dir, 'queue.jsonl'), '{"op":"add","id":"x","ke');
  assert.equal(new DiskQueue({ dir }).load().length, 1);
});

test('queue: dead letters are copied out and removed', () => {
  const dir = tmp();
  const q = new DiskQueue({ dir }).load();
  const { id } = q.add({ key: 'bad', payload: { x: 1 } });
  q.dead(id, 'HTTP 400');
  assert.equal(q.length, 0);
  assert.match(fs.readFileSync(path.join(dir, 'queue.dead.jsonl'), 'utf8'), /HTTP 400/);
});

// ── links / raw log ─────────────────────────────────────────────────────
test('MLLP receiver: split packets, multiple blocks, ACK reply framed', () => {
  const written = [];
  const got = [];
  const rx = new MllpReceiver({ write: (b) => written.push(b), reply: (t) => `ACK:${t.length}` });
  rx.on('message', (m) => got.push(m));
  const a = mllp('MSH|a'); const b = mllp('MSH|bb');
  const all = Buffer.concat([a, b]);
  rx.feed(all.subarray(0, 4)); rx.feed(all.subarray(4, 9)); rx.feed(all.subarray(9));
  assert.deepEqual(got, ['MSH|a', 'MSH|bb']);
  assert.equal(written.length, 2);
  assert.equal(written[0][0], C.VT);
  assert.equal(written[0].toString('latin1', 1, written[0].length - 2), 'ACK:5');
});

test('raw receiver: terminator and idle timeout', async () => {
  const got = [];
  const rx = new RawReceiver({ terminator: '\f', idleMs: 40 });
  rx.on('message', (m) => got.push(m));
  rx.feed('A 1\r\nB 2\fC');
  assert.deepEqual(got, ['A 1\r\nB 2']);
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(got, ['A 1\r\nB 2', 'C']);
});

test('auto link picks ASTM on ENQ, MLLP on VT, raw otherwise', () => {
  const pick = (first) => { const l = createLink({ type: 'auto', idleMs: 0 }, { write: () => {} }); let t = null; l.on('link', (x) => { t = x; }); l.feed(first); l.close(); return t; };
  assert.equal(pick(Buffer.from([C.ENQ])), 'astm-e1381');
  assert.equal(pick(Buffer.from([C.VT, 0x4d])), 'mllp');
  assert.equal(pick('SAMPLE 1'), 'raw');
});

test('raw log: visible control chars, ring buffer and rotation', () => {
  const dir = tmp();
  const log = new RawLog({ dir, maxBytes: 200, keep: 2, ring: 3 });
  for (let i = 0; i < 10; i++) log.write('in', Buffer.from([C.STX, 0x41 + i, C.ETX, C.CR, C.LF]));
  const recent = log.recent();
  assert.equal(recent.length, 3);
  assert.match(recent[0].text, /^<STX>[A-Z]<ETX><CR><LF>/);
  assert.ok(fs.existsSync(path.join(dir, 'raw.log.1')));
  assert.ok(!fs.existsSync(path.join(dir, 'raw.log.3')));
});
