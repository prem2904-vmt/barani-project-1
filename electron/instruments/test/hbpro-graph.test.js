'use strict';
/**
 * LifeDx HBPro chromatogram → PNG on message.images (code 'HbA1c-graph'),
 * the same path the Medonic M51 histograms take. Fixtures are real records
 * with the patient name replaced. Ground truth (analyzer screen, record A):
 * A1a 15.3, A1b 17.8, F 25.2, LA1c+ 32.8, A1c 51.0, A0 76.3 s.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { C } = require('../core/bytes');
const { parseMessage } = require('../core/parsers');
const { parseHbpro, blockStart } = require('../core/parsers/lifedx-hbpro');
const { extractCurve, findPeaks, renderChromatogram, runStamp, IMAGE_CODE } = require('../core/parsers/hbpro-graph');
const { Canvas, encodePng, crc32 } = require('../core/raster');
const { Connector } = require('../core/connector');

const fx = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'latin1');
const A = fx('lifedx-hbpro-curve-a.txt');
const B = fx('lifedx-hbpro-curve-b.txt');
const OLD = fx('lifedx-hbpro-record.txt');

/** Minimal PNG reader: signature, chunk CRCs, IHDR size, inflated length. */
function readPng(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let o = 8; const chunks = []; const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o); const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    assert.equal(buf.readUInt32BE(o + 8 + len), crc32(buf.subarray(o + 4, o + 8 + len)), `${type} CRC`);
    chunks.push(type); if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const ihdr = buf.subarray(16, 29);
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  return { chunks, w, h, depth: ihdr[8], colour: ihdr[9], raw };
}

const SCREEN = { A1a: 15.3, A1b: 17.8, F: 25.2, 'LA1c+': 32.8, A1c: 51.0, A0: 76.3 };

test('curve: 200 fixed-width points after the results, both fixtures and the older record', () => {
  for (const rec of [A, B, OLD]) {
    const pts = extractCurve(rec, blockStart(rec, 9));
    assert.equal(pts.length, 200);
    assert.ok(pts.every((v) => v >= 0 && v < 10));
  }
  const pts = extractCurve(A, blockStart(A, 9));
  assert.equal(pts[0], 0); assert.equal(Math.max(...pts), 0.2377);
});

test('curve: peaks sit at the analyzer screen retention times (record A, ±1.2 s)', () => {
  const peaks = findPeaks(extractCurve(A, blockStart(A, 9)));
  assert.deepEqual(peaks.map((p) => p.name), Object.keys(SCREEN));
  for (const p of peaks) assert.ok(Math.abs(p.time - SCREEN[p.name]) <= 1.2, `${p.name} ${p.time} vs ${SCREEN[p.name]}`);
  const a0 = peaks.find((p) => p.name === 'A0'); const a1c = peaks.find((p) => p.name === 'A1c');
  assert.ok(a0.od > 20 * a1c.od, 'A0 dwarfs A1c — the chart clips it');
});

test('curve: record B (A1c 5.4 %) — A1c and A0 found at the same retention times', () => {
  const peaks = Object.fromEntries(findPeaks(extractCurve(B, blockStart(B, 9))).map((p) => [p.name, p.time]));
  assert.ok(Math.abs(peaks.A1c - 51.0) <= 1.2, `A1c ${peaks.A1c}`);
  assert.ok(Math.abs(peaks.A0 - 76.3) <= 1.2, `A0 ${peaks.A0}`);
  assert.ok(Math.abs(peaks['LA1c+'] - 32.8) <= 1.2);
});

test('curve: malformed / truncated tails give no curve (never a wrong graph)', () => {
  const b = blockStart(A, 9);
  assert.equal(extractCurve(A.slice(0, b + 600), b), null, 'truncated');
  assert.equal(extractCurve(A.slice(0, b + 145) + 'xyz' + A.slice(b + 148), b), null, 'count not digits');
  assert.equal(extractCurve(A.replace(/0\.0013(?=0\.0013)/, '0,0013'), b), null, 'bad value');
  assert.equal(extractCurve(A, -1), null);
  assert.equal(runStamp(A, b), '2026-10-23 11:40');
});

test('png encoder: valid signature, CRCs, IHDR size, scanlines', () => {
  const cv = new Canvas(10, 4, 2); cv.rect(0, 0, 5, 4, [255, 0, 0]);
  const p = readPng(cv.toPng());
  assert.deepEqual(p.chunks, ['IHDR', 'IDAT', 'IEND']);
  assert.equal(p.w, 10); assert.equal(p.h, 4); assert.equal(p.depth, 8); assert.equal(p.colour, 2);
  assert.equal(p.raw.length, (10 * 3 + 1) * 4);
  assert.deepEqual([...p.raw.subarray(1, 4)], [255, 0, 0]);
  assert.deepEqual([...p.raw.subarray(1 + 9 * 3, 1 + 10 * 3)], [255, 255, 255]);
  assert.equal(encodePng(1, 1, Buffer.from([1, 2, 3])).length > 40, true);
});

test('chart: 720×360 PNG, white background, violet curve pixels, well under mw\'s 2 MB image cap', () => {
  const png = renderChromatogram(extractCurve(A, blockStart(A, 9)), { sampleId: '14', when: '2026-10-23 11:40' });
  const p = readPng(png);
  assert.equal(p.w, 720); assert.equal(p.h, 360);
  assert.ok(png.length < 100 * 1024, `${png.length} bytes`);
  assert.deepEqual([...p.raw.subarray(1, 4)], [255, 255, 255], 'top-left is white');
  let violet = 0;
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const i = y * (p.w * 3 + 1) + 1 + x * 3;
    if (p.raw[i] === 74 && p.raw[i + 1] === 30 && p.raw[i + 2] === 140) violet++;
  }
  assert.ok(violet > 500, `curve drawn (${violet} px)`);
});

test('parser: the HbA1c-graph image rides on the parsed message (results unchanged)', () => {
  const [m] = parseMessage(A, { type: 'lifedx-hbpro' });
  assert.equal(m.results.find((r) => r.code === 'HbA1c').value, '11.0');
  assert.equal(m.images.length, 1);
  const im = m.images[0];
  assert.equal(im.code, IMAGE_CODE); assert.equal(im.code, 'HbA1c-graph');
  assert.equal(im.label, 'HbA1c chromatogram'); assert.equal(im.format, 'png');
  assert.equal(readPng(Buffer.from(im.base64, 'base64')).w, 720);
  assert.ok(!m.raw.includes(im.base64.slice(0, 40)), 'raw stays the record text');
});

test('parser: graph:false, layout none (no results) or no curve → no image', () => {
  assert.equal(parseHbpro(A, { graph: false })[0].images.length, 0);
  assert.equal(parseHbpro(A, { layout: 'none' })[0].images.length, 0);
  const b = blockStart(A, 9);
  const [m] = parseHbpro(A.slice(0, b + 150));
  assert.equal(m.images.length, 0); assert.equal(m.results.find((r) => r.code === 'HbA1c').value, '11.0');
});

test('connector: the queued upload carries message.images with the PNG; raw stays small', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-hbgraph-'));
  const c = new Connector({ instrumentId: '11111111-2222-3333-4444-555555555555', dataDir: dir, uploader: { getConfig: async () => null, heartbeat: async () => ({}), postMessage: async () => ({ state: 'matched' }) } });
  c.transport = { write: () => {}, describe: () => 'test' };
  const l = c._makeLink({ type: 'stx-etx' }, { type: 'lifedx-hbpro' }, 's1');
  l.feed(Buffer.concat([Buffer.from([C.STX]), Buffer.from(A, 'latin1'), Buffer.from([C.ETX])]));
  assert.equal(c.queue.length, 1);
  const p = c.queue.due()[0].payload;
  assert.equal(p.message.images.length, 1);
  assert.equal(p.message.images[0].code, 'HbA1c-graph');
  assert.equal(p.message.images[0].format, 'png');
  assert.ok(p.raw.length < 2000);
});
