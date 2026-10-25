'use strict';
/**
 * Opt-in analyzers (2026-10-24, on site):
 *   - LifeDx HBPro: link 'stx-etx' (<STX> record <ETX> → <ACK>, retransmit
 *     dedupe) + parser 'lifedx-hbpro' (fixed-width record, positions configurable)
 *   - Sinocare iCARE-2100: link 'sinocare-sn' ("SN" + len + type + JSON + CRC16/MODBUS,
 *     replyMode none|echo) + parser 'sinocare-fhir'
 * Fixtures are the captured bytes with patient names replaced by fake ones.
 * The classic ASTM / MLLP / raw behaviour is pinned at the bottom.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { C } = require('../core/bytes');
const { createLink } = require('../core/link');
const { StxEtxReceiver } = require('../core/link/stx-etx');
const { SinocareReceiver, crc16modbus, encodeSnFrame, decodeSnFrame, DEFAULT_ACK_JSON } = require('../core/link/sinocare-sn');
const { parseMessage } = require('../core/parsers');
const { parseHbpro, parseFieldLines } = require('../core/parsers/lifedx-hbpro');
const { detect } = require('../core/detect');
const { preview } = require('../core/listen');
const { Connector } = require('../core/connector');

const HBPRO = fs.readFileSync(path.join(__dirname, 'fixtures/lifedx-hbpro-record.txt'), 'latin1');
const hbFrame = (rec = HBPRO) => Buffer.concat([Buffer.from([C.STX]), Buffer.from(rec, 'latin1'), Buffer.from([C.ETX])]);

// ── Sinocare captured payloads (no patient data in these two) ──────────────
const DEVICE_JSON = '{"fhir":{"AdVersion":"V01.02.00.00 ","ICCID":"","IMEI":"","McuVersion":"V01.00.05.03 ","SysVersion":"V01.04.00.00","lotNumber":"3VQ3JR","manufactureDate":"2026-03-19","manufacturer":"","model":"iCARE-2100","owner":{"name":""},"serialNumber":"3VQ3JR00011","status":"1","type":"","version":"01.09.00.00"},"url":"https://example.com/path/Device"}';
const ID_JSON = '{"id":""}';
const patientJson = (mrn, pos, name = 'Test Patient') => JSON.stringify({ fhir: { UserId: '', age: '40', ageMonth: '0', department: '', extension: { position: pos }, gender: 2, medicalRecordNo: mrn, name }, url: 'https://example.com/path/Patient' });
const obsJson = (extra = {}) => JSON.stringify({ fhir: { resourceType: 'Observation', code: { coding: [{ code: 'HbA1c' }] }, valueQuantity: { value: 6.4, unit: '%' }, ...extra }, url: 'https://example.com/path/Observation' });
const typeBuf = (t) => { const b = Buffer.alloc(2); b.writeUInt16BE(t, 0); return b; };

// ── CRC / framing ──────────────────────────────────────────────────────────
test('CRC-16/MODBUS known answers from the iCARE capture', () => {
  assert.equal(crc16modbus(Buffer.from('123456789')), 0x4b37, 'standard MODBUS check value');
  assert.equal(crc16modbus(Buffer.concat([typeBuf(1), Buffer.from(DEVICE_JSON)])), 0x0aed, 'Device frame (log: …Device"}<LF>í)');
  assert.equal(crc16modbus(Buffer.concat([typeBuf(8), Buffer.from(ID_JSON)])), 0x4b6f, '{"id":""} frame (log: …}Ko)');
  // Byte-for-byte the captured id frame: SN 000d 0008 {"id":""} 4b6f
  assert.equal(encodeSnFrame(8, ID_JSON).toString('hex'), '534e000d0008' + Buffer.from(ID_JSON).toString('hex') + '4b6f');
  const dev = encodeSnFrame(1, DEVICE_JSON);
  assert.equal(dev.readUInt16BE(2), 0x015b, 'length 347 as captured (SN<SOH>[)');
  const d = decodeSnFrame(dev);
  assert.equal(d.ok, true); assert.equal(d.type, 1); assert.equal(d.size, dev.length);
});

test('SinocareReceiver: byte-at-a-time, garbage prefix, bad CRC ignored and resynced', () => {
  const frames = []; const msgs = [];
  const rx = new SinocareReceiver({});
  rx.on('frame', (f) => frames.push(f)); rx.on('message', (m) => msgs.push(JSON.parse(m)));
  const bad = encodeSnFrame(1, patientJson('001', '1')); bad[bad.length - 1] ^= 0xff;
  const wire = Buffer.concat([Buffer.from('\r\nxx'), encodeSnFrame(1, DEVICE_JSON), bad, encodeSnFrame(8, ID_JSON)]);
  for (const b of wire) rx.feed(Buffer.from([b]));
  assert.deepEqual(frames.map((f) => f.ok), [true, false, true]);
  assert.match(frames[1].reason, /bad CRC/);
  assert.deepEqual(msgs.map((m) => [m.type, m.resource]), [[1, 'Device'], [8, null]]);
  assert.equal(msgs[1].context.device.serialNumber, '3VQ3JR00011');
});

test('replyMode none sends nothing; echo answers each frame with the same type + ack JSON (valid length/CRC, id filled)', () => {
  const none = []; const rx0 = new SinocareReceiver({ write: (b) => none.push(b) });
  rx0.feed(encodeSnFrame(1, DEVICE_JSON));
  assert.equal(none.length, 0);

  const out = []; const rx = new SinocareReceiver({ write: (b) => out.push(b), replyMode: 'echo' });
  rx.feed(encodeSnFrame(8, '{"id":"ab\\"c"}'));
  rx.feed(encodeSnFrame(1, DEVICE_JSON));
  assert.equal(out.length, 2);
  const r1 = decodeSnFrame(out[0]);
  assert.equal(r1.ok, true); assert.equal(r1.type, 8);
  assert.deepEqual(JSON.parse(r1.payload.toString('utf8')), { code: 0, msg: 'success', id: 'ab"c' });
  const r2 = decodeSnFrame(out[1]);
  assert.equal(r2.type, 1);
  assert.deepEqual(JSON.parse(r2.payload.toString('utf8')), JSON.parse(DEFAULT_ACK_JSON.replace('{{id}}', '')));

  const custom = []; const rx2 = new SinocareReceiver({ write: (b) => custom.push(b), replyMode: 'echo', ackJson: '{"result":"OK"}' });
  rx2.feed(encodeSnFrame(1, DEVICE_JSON));
  assert.equal(decodeSnFrame(custom[0]).payload.toString(), '{"result":"OK"}');
});

test('Patient then Observation → one message with results; context survives a reconnect (same config)', () => {
  const linkCfg = { type: 'sinocare-sn' };
  const parser = { type: 'sinocare-fhir' };
  const got = [];
  const a = createLink(linkCfg, { write: () => {} });
  a.on('message', (t, meta) => got.push(...parseMessage(t, parser, meta)));
  a.feed(encodeSnFrame(1, DEVICE_JSON));
  a.feed(encodeSnFrame(1, patientJson('006', '55')));
  assert.equal(got.length, 0, 'Device / Patient alone produce no message');
  a.close();
  const b = createLink(linkCfg, { write: () => {} });       // the iCARE opens a new connection
  b.on('message', (t, meta) => got.push(...parseMessage(t, parser, meta)));
  b.feed(encodeSnFrame(1, obsJson()));
  assert.equal(got.length, 1);
  assert.equal(got[0].sampleId, '006');
  assert.equal(got[0].instrumentSerial, '3VQ3JR00011');
  assert.deepEqual(got[0].results.map((r) => [r.code, r.value, r.unit]), [['HbA1c', '6.4', '%']]);
  assert.equal(got[0].protocol, 'text');
  // position mode
  const [p] = parseMessage(JSON.stringify({ ...JSON.parse(got[0].raw) }), { type: 'sinocare-fhir', sinocare: { sampleIdField: 'position' } });
  assert.equal(p.sampleId, '55');
});

test('sinocare-fhir is tolerant: components, Bundle entries, valueString, own position', () => {
  const env = (body, patients = {}) => JSON.stringify({ sinocare: 1, type: 1, resource: 'Observation', body, context: { patient: null, patients, device: null } });
  const [c] = parseMessage(env({ fhir: { component: [{ code: { text: 'CRP' }, valueQuantity: { value: '12.5', unit: 'mg/L' } }, { itemName: 'PCT', result: '<0.1', unit: 'ng/mL' }], medicalRecordNo: '9' } }), { type: 'sinocare-fhir' });
  assert.equal(c.sampleId, '9');
  assert.deepEqual(c.results.map((r) => [r.code, r.value, r.unit]), [['CRP', '12.5', 'mg/L'], ['PCT', '<0.1', 'ng/mL']]);
  const [b] = parseMessage(env({ fhir: { resourceType: 'Bundle', entry: [{ resource: { code: 'TSH', valueString: '2.1' } }], extension: { position: '3' } } }, { 3: { medicalRecordNo: '077', extension: { position: '3' } } }), { type: 'sinocare-fhir' });
  assert.equal(b.sampleId, '077');
  assert.deepEqual(b.results.map((r) => [r.code, r.value]), [['TSH', '2.1']]);
  assert.deepEqual(parseMessage(env({ id: '' }), { type: 'sinocare-fhir' }), []);
  assert.deepEqual(parseMessage('not json', { type: 'sinocare-fhir' }), []);
});

// ── STX/ETX + HBPro ────────────────────────────────────────────────────────
test('stx-etx: ACK after every frame, identical retransmits read once per window, split chunks', () => {
  let now = 1000;
  const out = []; const msgs = []; const frames = [];
  const rx = new StxEtxReceiver({ write: (b) => out.push(b), dedupeMs: 60000, now: () => now });
  rx.on('message', (m) => msgs.push(m)); rx.on('frame', (f) => frames.push(f));
  const f = hbFrame();
  rx.feed(f.subarray(0, 100)); rx.feed(f.subarray(100));     // split across TCP chunks
  now += 3000; rx.feed(f);                                    // retransmit 3 s later
  now += 4000; rx.feed(f);
  assert.equal(out.length, 3, 'every frame is ACKed');
  assert.ok(out.every((b) => b.length === 1 && b[0] === C.ACK));
  assert.equal(msgs.length, 1, 'retransmits are not re-read');
  assert.deepEqual(frames.map((x) => x.duplicate), [false, true, true]);
  assert.equal(msgs[0], HBPRO);
  now += 61000; rx.feed(f);
  assert.equal(msgs.length, 2, 'after the window it is read again (connector idempotency still dedupes)');
  // a stray STX restarts the frame; text outside STX..ETX is ignored
  rx.feed(Buffer.from('junk\x02half\x02S04-----7REC\x03', 'latin1'));
  assert.equal(msgs[2], 'S04-----7REC');
});

test('lifedx-hbpro: record type, sample id, patient bits; layout none → no results; own positions win', () => {
  const [m] = parseHbpro(HBPRO, { layout: 'none' });
  assert.equal(m.recordType, 'S04');
  assert.equal(m.sampleId, '19');
  assert.deepEqual(m.patient, { name: 'MS TEST PATNT', age: 29, sex: 'F' });
  assert.deepEqual(m.results, []);
  assert.equal(m.raw, HBPRO, 'the full record is kept as raw');

  const fields = parseFieldLines('# code start end unit\nA 60 66 %\nB 66 72\nbad line\nC 9 10');
  assert.deepEqual(fields.map((f) => [f.code, f.start, f.end, f.unit]), [['A', 60, 66, '%'], ['B', 66, 72, null], ['C', 9, 10, null]]);
  const [r] = parseMessage(HBPRO, { type: 'lifedx-hbpro', hbpro: { fields: [{ code: 'A', start: 63, end: 69, unit: '%' }, { code: 'NAME', start: 9, end: 13 }] } });
  assert.deepEqual(r.results.map((x) => [x.code, x.value, x.unit]), [['A', '0.0012', '%']], 'non-numeric slices are skipped');
  const [s] = parseMessage(HBPRO, { type: 'lifedx-hbpro', hbpro: { fields: 'A 63 69 %' } });
  assert.equal(s.results[0].value, '0.0012');
});

test('connector: stx-etx/hbpro ACKs, uploads nothing with layout none, queues once with positions despite retransmits', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-optin-'));
  const c = new Connector({ instrumentId: '11111111-2222-3333-4444-555555555555', dataDir: dir, uploader: { getConfig: async () => null, heartbeat: async () => ({}), postMessage: async () => ({ state: 'matched' }) } });
  const sent = [];
  c.transport = { write: (b) => sent.push(Buffer.from(b)), describe: () => 'test' };
  const l0 = c._makeLink({ type: 'stx-etx' }, { type: 'lifedx-hbpro', hbpro: { layout: 'none' } }, 's1');
  l0.feed(hbFrame()); l0.feed(hbFrame());
  assert.equal(sent.length, 2);
  assert.equal(c.queue.length, 0, 'no result positions → nothing queued');
  assert.ok(c.rawlog.recent(50).some((e) => /no results to send/.test(e.text || e.line || JSON.stringify(e))));

  const l = c._makeLink({ type: 'stx-etx' }, { type: 'lifedx-hbpro', hbpro: { fields: 'HBA1C 63 69 %' } }, 's2');
  l.feed(hbFrame()); l.feed(hbFrame()); l.feed(hbFrame());
  assert.equal(c.queue.length, 1);
  const p = c.queue.due()[0].payload;
  { assert.equal(p.message.sampleId, '19'); assert.equal(p.protocol, 'text'); assert.equal(p.message.patient, undefined, 'patient name is never uploaded as a field'); }
});

// ── Detect: suggest only ───────────────────────────────────────────────────
test('detect suggests stx-etx/lifedx-hbpro and sinocare-sn/sinocare-fhir; preview re-reads frames', () => {
  const d = detect(Buffer.concat([hbFrame(), hbFrame()]));
  assert.equal(d.link, 'stx-etx'); assert.equal(d.protocol, 'lifedx-hbpro');
  assert.equal(d.proposed.parser.type, 'lifedx-hbpro');
  assert.match(d.reasons[0], /retransmit/);
  assert.equal(d.messages[0].sampleId, '19');

  const cap = Buffer.concat([encodeSnFrame(1, DEVICE_JSON), encodeSnFrame(8, ID_JSON), encodeSnFrame(1, patientJson('008', '51')), encodeSnFrame(1, obsJson())]);
  const s = detect(cap);
  assert.equal(s.link, 'sinocare-sn'); assert.equal(s.protocol, 'sinocare-fhir');
  assert.equal(s.proposed.link.replyMode, 'none');
  assert.equal(s.messages.length, 1); assert.equal(s.messages[0].sampleId, '008');
  const pv = preview(cap.toString('latin1'), { parser: { type: 'sinocare-fhir', sinocare: { sampleIdField: 'position' } } });
  assert.equal(pv.messages[0].sampleId, '51');
});

test('classic detection is untouched: ASTM, MLLP, text, lone STX keep-alive, and a non-HBPro STX/ETX body', () => {
  const { encodeFrames } = require('../core/link/astm-e1381');
  const astm = Buffer.concat([Buffer.from([C.ENQ]), ...encodeFrames('H|\\^&\rO|1|S1||^^^WBC\rR|1|^^^WBC|7.8|10^3/uL\rL|1|N\r'), Buffer.from([C.EOT])]);
  assert.equal(detect(astm).link, 'astm-e1381');
  const mllp = Buffer.from('\x0bMSH|^~\\&|A|B|C|D|20261024||ORU^R01|1|P|2.3.1\rOBR|1||S1\rOBX|1|NM|WBC||7.8\x1c\r', 'latin1');
  assert.equal(detect(mllp).link, 'mllp');
  const text = 'SAMPLE ID: 2609-00013\r\nWBC 7.8 10^3/uL H\r\nHGB 14.2 g/dL\r\nPLT 250 10^3/uL\r\n';
  const t = detect(Buffer.concat([Buffer.from([C.STX]), Buffer.from(text)]));
  assert.equal(t.link, 'raw'); assert.equal(t.protocol, 'text');
  const odd = detect(Buffer.from('\x02hello world, nothing here\x03', 'latin1'));
  assert.equal(odd.link, 'raw'); assert.equal(odd.protocol, 'unknown');
});

test('auto link never picks the opt-in links (HBPro bytes still land in raw, SN bytes in raw)', () => {
  const a = createLink({ type: 'auto' }, { write: () => {} });
  a.feed(hbFrame());
  assert.equal(a.type, 'raw');
  const b = createLink({ type: 'auto' }, { write: () => {} });
  b.feed(encodeSnFrame(1, DEVICE_JSON));
  assert.equal(b.type, 'raw');
});

test('the editor default reply JSON equals the connector default (one source)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../../apps/lms/src/app/shared/instruments/instrument-config.ts'), 'utf8');
  const m = /export const DEFAULT_SINOCARE_ACK_JSON = '([^']*)';/.exec(src);
  assert.ok(m, 'DEFAULT_SINOCARE_ACK_JSON not found');
  assert.equal(m[1], DEFAULT_ACK_JSON);
});
