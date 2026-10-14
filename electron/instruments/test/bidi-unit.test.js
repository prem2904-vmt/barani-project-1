'use strict';
/** Two-way interfacing: message builders/parsers, escaping, stores, uploader timeout (no sockets). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { astmEscape, hl7Escape } = require('../core/bidi/escape');
const A = require('../core/bidi/astm');
const H = require('../core/bidi/hl7');
const { SentJournal, OrderCache, testSetHash } = require('../core/bidi/store');
const { normalizeBidi } = require('../core/bidi');
const { parseAstm } = require('../core/parsers/astm');
const { AstmSender } = require('../core/link/astm-e1381');
const { Uploader, QUERY_TIMEOUT_MS } = require('../core/uploader');
const { C } = require('../core/bytes');
const { parseAstmOrders, parseHl7Orders, parseDsr } = require('../sim/query-sim');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pf-bidi-'));
const DTO = (over = {}) => ({
  sampleId: '260100001', found: true, priority: 'normal', collectedAt: '2026-10-14T05:10:00Z', specimen: 'Serum', patient: null,
  tests: [{ code: 'GLU', testCatalogKey: 'BIO001', name: 'Glucose' }, { code: 'UREA', testCatalogKey: 'BIO002', name: 'Urea' }], unmapped: [], ...over,
});
const NASTY = 'Ann Q|Rs^t&u\\v~w';

test('escape: ASTM delimiters and control characters', () => {
  assert.equal(astmEscape('a|b^c\\d&e'), 'a&F&b&S&c&R&d&E&e');
  assert.equal(astmEscape('x\r\ny'), 'x  y');
  assert.equal(astmEscape('a#b', { field: '#', repeat: '\\', component: '^', escape: '&' }), 'a&F&b');
  assert.equal(astmEscape(null), '');
});

test('escape: HL7 delimiters, line breaks', () => {
  assert.equal(hl7Escape('a|b^c&d~e\\f'), 'a\\F\\b\\S\\c\\T\\d\\R\\e\\E\\f');
  assert.equal(hl7Escape('l1\nl2'), 'l1\\.br\\l2');
});

test('ASTM Q: single, specimen component, instrument-specimen component, patient component', () => {
  const t = (q, cfg) => A.parseAstmQueries(`H|\\^&|||X\rQ|1|${q}||^^^ALL||||||||O\rL|1\r`, cfg).queries[0];
  assert.deepEqual(t('^123').ids, ['123']);
  assert.deepEqual(t('^^456').ids, ['456']);
  assert.deepEqual(t('789').ids, ['789']);
  assert.deepEqual(t('P1^S2^I3', { queryComponent: 1 }).ids, ['P1']);
  assert.deepEqual(t('P1^S2^I3', { queryComponent: 3 }).ids, ['I3']);
  assert.equal(t('^123').tests, null);
});

test('ASTM Q: range expansion is capped, repeat list, ALL, specific tests', () => {
  const r = A.parseAstmQueries('H|\\^&\rQ|1|^000100|^000103|^^^GLU\\^^^UREA\rL|1\r').queries[0];
  assert.deepEqual(r.ids, ['000100', '000101', '000102', '000103']);
  assert.deepEqual(r.tests, ['GLU', 'UREA']);
  const big = A.parseAstmQueries('H|\\^&\rQ|1|^0001|^0500\rL|1\r').queries[0];
  assert.equal(big.ids.length, 20);
  assert.equal(big.truncated, true);
  assert.equal(A.parseAstmQueries('H|\\^&\rQ|1|^ALL\rL|1\r').queries[0].all, true);
  assert.deepEqual(A.parseAstmQueries('H|\\^&\rQ|1|^A1\\^B2\rL|1\r').queries[0].ids, ['A1', 'B2']);
  const many = 'H|\\^&\r' + Array.from({ length: 15 }, (_x, i) => `Q|${i + 1}|^S${i}`).join('\r') + '\rL|1\r';
  assert.equal(A.parseAstmQueries(many).queries.length, 10);
});

test('ASTM Q: non-default delimiters and escaped values in the analyzer H record', () => {
  const q = A.parseAstmQueries('H#!@~#\rQ#1#!A@S#\rL#1\r'.replace(/!/g, '^').replace(/@/g, '^')).queries;
  assert.equal(q.length, 1);
  const q2 = A.parseAstmQueries('H|\\^&\rQ|1|^A&F&B\rL|1\r').queries[0];
  assert.deepEqual(q2.ids, ['A|B']);
});

test('ASTM answer: H P O L, repeat list, report type O, action code, escaping round-trips through the real parser', () => {
  const msg = A.buildAstmOrders([DTO({ priority: 'urgent', patient: { id: 'P-1', name: NASTY, sex: 'F', dob: '1980-01-31', ageYears: 45 } })], A.DEFAULT_DELIMS, { sendPatient: true, now: new Date(2026, 9, 14, 10, 0, 0) });
  const recs = msg.split('\r').filter(Boolean);
  assert.deepEqual(recs.map((r) => r[0]), ['H', 'P', 'O', 'L']);
  assert.equal(recs[3], 'L|1|N');
  const o = recs[2].split('|');
  assert.equal(o[2], '260100001');
  assert.equal(o[4], '^^^GLU\\^^^UREA');
  assert.equal(o[5], 'S');
  assert.equal(o[11], 'A');
  assert.equal(o[25], 'O');
  assert.equal(o.length, 26);
  assert.ok(!/Q\|Rs/.test(recs[1]), 'raw field delimiter never leaks into the P record');
  const orders = parseAstmOrders(msg);
  assert.equal(orders[0].patient.name, `Q|Rs^t&u\\v~w Ann`);
  assert.deepEqual(orders[0].tests, ['GLU', 'UREA']);
  // The connector's own results parser also reads the answer back (sample id field/component)
  assert.equal(parseAstm(msg)[0].sampleId, '260100001');
});

test('ASTM answer: sample ID in O.4 / component 2 when the analyzer config says so; no patient unless asked', () => {
  const msg = A.buildAstmOrders([DTO({ patient: { id: 'P', name: 'X Y' } })], A.DEFAULT_DELIMS, { sendPatient: false, sampleIdField: 4, sampleIdComponent: 2 });
  const o = msg.split('\r').find((r) => r[0] === 'O').split('|');
  assert.equal(o[2], '');
  assert.equal(o[3], '^260100001');
  assert.equal(msg.split('\r').find((r) => r[0] === 'P'), 'P|1');
  assert.equal(parseAstm(msg, { sampleIdField: 4, sampleIdComponent: 2 })[0].sampleId, '260100001');
});

test('ASTM answer: honours the analyzer delimiters; test filter', () => {
  const d = { field: '#', repeat: '*', component: '$', escape: '@' };
  const msg = A.buildAstmOrders([DTO()], d, { filterTests: ['UREA'] });
  assert.match(msg, /^H#\*\$@#/);
  assert.match(msg, /O#1#260100001##\$\$\$UREA#/);
});

test('ASTM no information (LIS2-A2): H, Q echo with status X, L|1|I — never an empty order', () => {
  const q = A.parseAstmQueries('H|\\^&\rQ|1|^999||^^^ALL||||||||O\rL|1\r').queries[0];
  const msg = A.buildAstmNoInfo(q, A.DEFAULT_DELIMS, {});
  const recs = msg.split('\r').filter(Boolean);
  assert.deepEqual(recs.map((r) => r[0]), ['H', 'Q', 'L']);
  assert.equal(recs[1].split('|')[12], 'X');
  assert.equal(recs[1].split('|')[2], '^999');
  assert.equal(recs[2], 'L|1|I');
  assert.ok(!recs.some((r) => r[0] === 'O'));
});

const QRY = (id) => `MSH|^~\\&|BS-240|LAB|LIS|HOST|20261014100000||QRY^Q02|77|P|2.3.1\rQRD|20261014100000|R|D|9|||1^RD|${id}|OTH|||T\rQRF|BS-240\r`;
const QBP = (id) => `MSH|^~\\&|AU|LAB|LIS|HOST|20261014100000||QBP^Q11^QBP_Q11|88|P|2.5.1\rQPD|WOS^Work Order Step^IHE_LABTF|TAG7|${id}\rRCP|I||R\r`;

test('HL7 classify: QRY^Q02, QBP^Q11, ACK, ordinary ORU is none', () => {
  assert.equal(H.classifyHl7(QRY('S1')).sampleId, 'S1');
  assert.equal(H.classifyHl7(QRY('S1')).kind, 'qry_q02');
  assert.equal(H.classifyHl7(QBP('S2')).sampleId, 'S2');
  assert.equal(H.classifyHl7(QBP('S2')).queryId, 'TAG7');
  const ack = H.classifyHl7('MSH|^~\\&|A|B|C|D|2026||ACK^O01|1|P|2.3.1\rMSA|AE|PFX1\r');
  assert.equal(ack.kind, 'ack'); assert.equal(ack.code, 'AE'); assert.equal(ack.ref, 'PFX1');
  assert.equal(H.classifyHl7('MSH|^~\\&|A|B|C|D|2026||ORU^R01|1|P|2.3.1\rOBR|1||X\r'), null);
  assert.equal(H.classifyHl7(QRY('S9'), { qrdSampleField: 9 }).sampleId, 'OTH');
});

test('HL7 QCK/DSR: QCK OK+NF, DSR rows per dialect (mindray-bs), sample id and tests round-trip, escaping', () => {
  const q = H.classifyHl7(QRY('260100001'));
  const qck = H.buildQck(q, true);
  assert.match(qck, /\|QCK\^Q02\|/); assert.match(qck, /\rMSA\|AA\|77\r/); assert.match(qck, /QAK\|SR\|OK/);
  assert.match(H.buildQck(q, false), /QAK\|SR\|NF/);
  const dsr = H.buildDsr(q, DTO({ patient: { id: 'P-1', name: NASTY, sex: 'M', dob: '1980-01-31' } }), { sendPatient: true });
  assert.match(dsr, /\|DSR\^Q03\|/);
  const p = parseDsr(dsr);
  assert.equal(p.sampleId, '260100001'); assert.deepEqual(p.tests, ['GLU', 'UREA']); assert.equal(p.name, NASTY);
  assert.match(dsr, /DSP\|26\|\|GLU\^\^\^\|\|\|\r/);
  assert.ok(!/DSP\|4\|/.test(H.buildDsr(q, DTO({ patient: { id: 'P', name: 'N' } }), { sendPatient: false })), 'no patient rows unless sendPatient');
  assert.match(dsr, /^MSH\|\^~\\&\|LIS\|HOST\|BS-240\|LAB\|/);        // sender/receiver swapped
  const gen = H.buildDsr(q, DTO(), { dialect: 'generic' });
  assert.match(gen, /DSP\|6\|\|GLU\|/);
});

test('HL7 RSP^K11: ORC/OBR per test, OK and NF, echoes tag and QPD', () => {
  const q = H.classifyHl7(QBP('260100001'));
  const rsp = H.buildRsp(q, DTO());
  assert.match(rsp, /\|RSP\^K11\^RSP_K11\|/); assert.match(rsp, /MSA\|AA\|88/); assert.match(rsp, /QAK\|TAG7\|OK\|WOS/);
  assert.match(rsp, /\rQPD\|WOS/); assert.equal((rsp.match(/\rORC\|NW\|/g) || []).length, 2); assert.equal((rsp.match(/\rOBR\|/g) || []).length, 2);
  assert.ok(!/\rPID\|/.test(rsp));
  assert.match(H.buildRsp(q, DTO({ patient: { id: 'P', name: NASTY } }), { sendPatient: true }), /\rPID\|/);
  const nf = H.buildRsp(q, null);
  assert.match(nf, /QAK\|TAG7\|NF/); assert.ok(!/OBR/.test(nf));
  const o = parseHl7Orders(rsp);
  assert.deepEqual(o[0].tests, ['GLU', 'UREA']); assert.equal(o[0].sampleId, '260100001');
});

test('HL7 worklist: ORM^O01 and OML^O21, PID only with a patient, one ORC/OBR per test, escaping', () => {
  const orm = H.buildWorklistMessage(DTO(), { type: 'orm_o01' });
  assert.match(orm.text, /\|ORM\^O01\|PF/); assert.ok(!/\rPID\|/.test(orm.text)); assert.equal((orm.text.match(/\rOBR\|/g) || []).length, 2);
  const oml = H.buildWorklistMessage(DTO({ patient: { id: 'P-1', name: NASTY, sex: 'F', dob: '1980-01-31' } }), { type: 'oml_o21', sendPatient: true });
  assert.match(oml.text, /\|OML\^O21\^OML_O21\|/); assert.match(oml.text, /\rSPM\|1\|260100001/);
  assert.equal(parseHl7Orders(oml.text)[0].patient.name, 'Ann Q|Rs^t&u\\v~w');
  assert.ok(!/Q\|Rs/.test(oml.text.split('\r').find((s) => s.startsWith('PID'))));
  const noPt = H.buildWorklistMessage(DTO({ patient: { id: 'P', name: 'N' } }), { type: 'orm_o01', sendPatient: false });
  assert.ok(!/\rPID\|/.test(noPt.text));
});

test('store: sent journal is crash-safe (torn line) and send-once/resend-on-change', () => {
  const dir = tmp();
  let j = new SentJournal({ dir });
  const d = DTO();
  assert.equal(j.isSent(d), false);
  j.mark(d);
  fs.appendFileSync(path.join(dir, 'bidi-sent.jsonl'), '{"id":"torn","ha');
  j = new SentJournal({ dir });
  assert.equal(j.isSent(d), true);
  assert.equal(j.isSent(DTO({ tests: [...d.tests, { code: 'CREA', name: 'x' }] })), false);
  assert.equal(testSetHash(d), testSetHash(DTO({ tests: [...d.tests].reverse() })), 'order of tests does not matter');
});

test('store: order cache serves fresh entries only, never negatives', () => {
  const dir = tmp();
  let t = 1000;
  const c = new OrderCache({ dir, now: () => t, ttlMs: 500 });
  c.put(DTO()); c.put(DTO({ sampleId: 'NF', found: false, tests: [] })); c.save();
  assert.ok(new OrderCache({ dir, now: () => t, ttlMs: 500 }).get('260100001'));
  assert.equal(c.get('NF'), null);
  t += 501;
  assert.equal(c.get('260100001'), null);
});

test('config: absent / unknown mode = off; values clamped', () => {
  assert.equal(normalizeBidi(undefined).mode, 'off');
  assert.equal(normalizeBidi({ mode: 'bogus' }).mode, 'off');
  const n = normalizeBidi({ mode: 'both', worklistPollSeconds: 1, worklistWindowHours: 9999, hl7Order: 'x' });
  assert.deepEqual([n.mode, n.worklistPollSeconds, n.worklistWindowHours, n.hl7Order, n.sendPatient], ['both', 15, 168, 'orm_o01', false]);
});

test('uploader: queries have a hard 4 s ceiling even when fetch ignores the abort signal', async () => {
  assert.equal(QUERY_TIMEOUT_MS, 4000);
  const hang = () => new Promise(() => {});
  const u = new Uploader({ apiUrl: 'http://x', instrumentId: 'i', deviceKey: 'k', fetchImpl: hang });
  const t0 = Date.now();
  await assert.rejects(() => u.getOrders('S1', { timeoutMs: 150 }), /timeout/);
  assert.ok(Date.now() - t0 < 1500);
  let seen;
  const ok = async (url, init) => { seen = { url, key: init.headers['X-Instrument-Key'] }; return { status: 200, json: async () => ({ success: true, data: { found: false } }) }; };
  const u2 = new Uploader({ apiUrl: 'http://x/', instrumentId: 'i d', deviceKey: 'KEY', fetchImpl: ok });
  await u2.getOrders('A B&c');
  assert.equal(seen.url, 'http://x/api/instruments/i%20d/orders?sampleId=A%20B%26c'); assert.equal(seen.key, 'KEY');
  await u2.getWorklist({ since: '2026-10-14T00:00:00Z' });
  assert.match(seen.url, /\/worklist\?since=2026-10-14T00%3A00%3A00Z$/);
});

test('E1381 contention: crossed ENQ — the sender waits (beforeEnq gate) and bids again after the peer', async () => {
  const written = [];
  const gate = [];
  const s = new AstmSender({ write: (b) => written.push(Buffer.from(b)), ackTimeoutMs: 300, busyRetryMs: 20, beforeEnq: async (n) => { gate.push(n); } });
  const p = s.send('H|\\^&\rL|1|N\r');
  await new Promise((r) => setTimeout(r, 10));
  s.feed(Buffer.from([C.ENQ]));                          // analyzer bids at the same moment
  await new Promise((r) => setTimeout(r, 60));
  s.feed(Buffer.from([C.ACK]));                          // second bid accepted
  for (let i = 0; i < 2; i++) { await new Promise((r) => setTimeout(r, 10)); s.feed(Buffer.from([C.ACK])); }
  await p;
  assert.deepEqual(gate, [0, 1]);
  assert.equal(written.filter((b) => b.length === 1 && b[0] === C.ENQ).length, 2);
  assert.equal(written[written.length - 1][0], C.EOT);
});
