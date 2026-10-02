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
const { parseHl7 } = require('../core/parsers/hl7');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pf-inst-'));
const M51_FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures/m51-synthetic.hl7'), 'latin1');

// The "Arun lab" M51/HL7-LOINC default-map preset (mirrors the LOINC-keyed
// rows added to apps/lms/.../instrument-config.ts CBC_DEFAULT_MAPS — kept as
// a literal table here so this test doesn't depend on compiling TS).
const M51_LOINC_MAPS = [
  { analyzerCode: '6690-2', testCatalogKey: 'HEM019', factor: 1000, decimals: 0 },
  { analyzerCode: '789-8', testCatalogKey: 'HEM012', factor: 1, decimals: 2 },
  { analyzerCode: '718-7', testCatalogKey: 'HEM011', factor: 1, decimals: 1 },
  { analyzerCode: '4544-3', testCatalogKey: 'HEM013', factor: 1, decimals: 1 },
  { analyzerCode: '787-2', testCatalogKey: 'HEM014', factor: 1, decimals: 1 },
  { analyzerCode: '785-6', testCatalogKey: 'HEM015', factor: 1, decimals: 1 },
  { analyzerCode: '786-4', testCatalogKey: 'HEM016', factor: 1, decimals: 1 },
  { analyzerCode: '788-0', testCatalogKey: 'HEM017', factor: 1, decimals: 1 },
  { analyzerCode: '777-3', testCatalogKey: 'HEM030', factor: 1000, decimals: 0 },
  { analyzerCode: '32623-1', testCatalogKey: 'HEM031', factor: 1, decimals: 1 },
  { analyzerCode: '32207-3', testCatalogKey: 'HEM032', factor: 1, decimals: 1 },
  { analyzerCode: '11003', testCatalogKey: 'HEM033', factor: 1, decimals: 3 },
  { analyzerCode: '770-8', testCatalogKey: 'HEM020', factor: 1, decimals: 1 },
  { analyzerCode: '736-9', testCatalogKey: 'HEM021', factor: 1, decimals: 1 },
  { analyzerCode: '5905-5', testCatalogKey: 'HEM022', factor: 1, decimals: 1 },
  { analyzerCode: '713-8', testCatalogKey: 'HEM023', factor: 1, decimals: 1 },
  { analyzerCode: '706-2', testCatalogKey: 'HEM024', factor: 1, decimals: 1 },
  { analyzerCode: '751-8', testCatalogKey: 'HEM025', factor: 1, decimals: 2 },
  { analyzerCode: '731-0', testCatalogKey: 'HEM026', factor: 1, decimals: 2 },
  { analyzerCode: '742-7', testCatalogKey: 'HEM027', factor: 1, decimals: 2 },
  { analyzerCode: '711-2', testCatalogKey: 'HEM028', factor: 1, decimals: 2 },
  { analyzerCode: '704-7', testCatalogKey: 'HEM029', factor: 1, decimals: 2 },
];

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
  assert.equal(convertValue(' 7.80 ', {}), '7.80');                 // identity → as sent
  assert.equal(convertValue('7.80', { factor: 1000 }), '7800');
  assert.equal(convertValue('1e3', { factor: 2 }), '2000');
});

test('mapper + M51 preset: all 22 LOINC-coded analytes hit with the correct factor; 7 stay deliberately unmapped', () => {
  const [m] = parseHl7(M51_FIXTURE, { sampleIdField: 'OBR-3' });
  const { mapped, unmapped } = applyMaps(m, M51_LOINC_MAPS);
  assert.equal(mapped.length, 22, 'exactly the 22 analytes in the Arun-lab table');
  const by = (code) => mapped.find((x) => x.analyzerCode === code);
  // ×1000 counts round to an exact integer.
  assert.equal(by('6690-2').value, '13290');       // WBC 13.29 → 13290 cells/µL
  assert.equal(by('6690-2').catalogKey, 'HEM019');
  assert.equal(by('777-3').value, '173000');        // PLT 173 → 173000 cells/µL
  assert.equal(by('777-3').catalogKey, 'HEM030');
  // Spot-check factor-1 analytes stay exact (identity / same-precision round-trip).
  assert.equal(by('770-8').value, '67.5');          // NEU%
  assert.equal(by('789-8').value, '4.92');          // RBC
  assert.equal(by('718-7').value, '13.6');          // HGB
  assert.equal(by('11003').value, '0.165');         // PCT — decimals:3 keeps plateletcrit precision
  // The 7 analytes with no catalogue test are deliberately absent from the
  // preset and so land in `unmapped`, never invented a mapping for.
  for (const code of ['21000-5', '48386-7', '34167-7', '11032', '11033', '11090', '11091']) {
    assert.ok(unmapped.includes(code), `${code} should be unmapped`);
  }
  // IS-derived codes and ED/image codes never even reach the mapper (they
  // never entered message.results in the first place, so they can't show up
  // as mapped OR unmapped).
  assert.ok(!unmapped.includes('02001') && !unmapped.includes('09001'), 'IS codes never reach the mapper');
  assert.ok(!unmapped.includes('12003') && !unmapped.includes('12153'), 'ED/image codes never reach the mapper');
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

// ── folder transport ────────────────────────────────────────────────────
test('folder transport: waits for a stable size, emits the file once, moves it', () => {
  const { FolderTransport } = require('../core/transports/folder');
  const dir = tmp();
  const done = path.join(dir, 'done');
  const t = new FolderTransport({ path: dir, pattern: '*.txt', moveTo: done });
  fs.mkdirSync(done);
  const got = [];
  t.on('file', (text, name) => got.push([name, text]));
  fs.writeFileSync(path.join(dir, 'run1.txt'), 'SAMPLE ID: 5\nWBC 7 10^3/uL\n');
  fs.writeFileSync(path.join(dir, 'ignore.csv'), 'x');
  t.poll();                      // first sighting: size recorded, not read yet
  assert.equal(got.length, 0);
  t.poll();                      // stable → read + moved
  assert.deepEqual(got.map((g) => g[0]), ['run1.txt']);
  assert.ok(fs.existsSync(path.join(done, 'run1.txt')));
  assert.ok(fs.existsSync(path.join(dir, 'ignore.csv')));
  t.poll();
  assert.equal(got.length, 1);
});
