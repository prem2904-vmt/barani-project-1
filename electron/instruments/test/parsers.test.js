'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseAstm } = require('../core/parsers/astm');
const { parseHl7, buildAck, redactEdImages } = require('../core/parsers/hl7');
const { parseText } = require('../core/parsers/text');
const { parseMessage, redactForUpload } = require('../core/parsers');
const { astmMessage, hl7Message, textMessage } = require('../sim/dialects');

const M51_FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures/m51-synthetic.hl7'), 'latin1');

test('ASTM E1394: H/P/O/R/C/L → one message per O record', () => {
  const text = [
    'H|\\^&|||ANALYZER^2.1^SN-77|||||||P|LIS2-A2|20260930104200',
    'P|1',
    'O|1|260100023||^^^CBC|R|20260930104000|||||N',
    'R|1|^^^WBC|7.8|10^3/uL|4.0-10.0|H||F||||20260930104200',
    'C|1|I|smear reviewed|G',
    'R|2|^^^HGB|10.2|g/dL|13-17|L||F',
    'R|3|^^^PLT|250|10^3/uL||N||F',
    'O|2|260100024||^^^CBC|R',
    'R|1|^^^WBC|5.1|10^3/uL||N||F',
    'L|1|N',
  ].join('\r') + '\r';
  const msgs = parseAstm(text);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].sampleId, '260100023');
  assert.equal(msgs[0].instrumentSerial, 'SN-77');
  assert.equal(msgs[0].qc, false);
  assert.deepEqual(msgs[0].results.map((r) => [r.code, r.value, r.unit, r.flags]), [
    ['WBC', '7.8', '10^3/uL', ['H']], ['HGB', '10.2', 'g/dL', ['L']], ['PLT', '250', '10^3/uL', []],
  ]);
  assert.match(msgs[0].results[0].rawRecord, /C\|1\|I\|smear reviewed/);
  assert.ok(msgs[0].runAt);
  assert.equal(msgs[1].sampleId, '260100024');
  assert.equal(msgs[1].results.length, 1);
});

test('ASTM: custom delimiters from the H record + escape sequences', () => {
  // field '!', repeat '@', component '~', escape '%'
  const text = [
    'H!@~%!!!SIM~1~X9',
    'O!1!S-55!!~~~CBC',
    'R!1!~~~NEUT%F%!61.0!%E%!!H@A!!F',
    'L!1',
  ].join('\r');
  const [m] = parseAstm(text);
  assert.equal(m.sampleId, 'S-55');
  assert.equal(m.results[0].code, 'NEUT!');      // %F% → field delimiter
  assert.equal(m.results[0].value, '61.0');
  assert.equal(m.results[0].unit, '%');          // %E% → escape char itself
  assert.deepEqual(m.results[0].flags, ['H', 'A']);
});

test('ASTM: configurable sample-ID field/component and O.4 fallback; QC via H.12 / O.12', () => {
  const t1 = 'H|\\^&\rO|1|RACK1^260100030||^^^CBC\rR|1|^^^WBC|6|x\r';
  assert.equal(parseAstm(t1, { sampleIdField: 3, sampleIdComponent: 2 })[0].sampleId, '260100030');
  const t2 = 'H|\\^&\rO|1||260100031|^^^CBC\rR|1|^^^WBC|6|x\r';
  assert.equal(parseAstm(t2)[0].sampleId, '260100031');
  const qc1 = 'H|\\^&|||S|||||||Q\rO|1|QC1\rR|1|^^^WBC|6|x\r';
  assert.equal(parseAstm(qc1)[0].qc, true);
  const qc2 = 'H|\\^&\rO|1|QC2||^^^CBC|R||||||Q\rR|1|^^^WBC|6|x\r';
  assert.equal(parseAstm(qc2)[0].qc, true);
});

test('ASTM: sim dialect round-trips (frame-number prefixed records are tolerated)', () => {
  const { text, results } = astmMessage({ sampleId: '260100040' });
  const [m] = parseAstm(text);
  assert.equal(m.sampleId, '260100040');
  assert.equal(m.results.length, results.length);
  const prefixed = text.split('\r').filter(Boolean).map((r, i) => `${(i + 1) % 8}${r}`).join('\r');
  assert.equal(parseAstm(prefixed)[0].results.length, results.length);
});

test('HL7 ORU^R01: OBR-3 sample ID, OBX code/value/unit/flags, SPM QC role', () => {
  const text = [
    'MSH|^~\\&|HAEM|LAB1|LIS|PF|20260930104200||ORU^R01|CTL123|P|2.3.1',
    'PID|1||MRN1',
    'OBR|1|PL-9|260100023|CBC^Complete blood count|||20260930104000',
    'OBX|1|NM|WBC^White cells^L||12.1|10\\S\\3/uL|4-10|H~A|||F',
    'OBX|2|NM|^Haemoglobin||9.8|g/dL|13-17|L|||F',
    'OBX|3|ST|NOTE^Comment||Smear\\T\\review|',
  ].join('\r');
  const [m] = parseHl7(text);
  assert.equal(m.sampleId, '260100023');
  assert.equal(m.instrumentSerial, 'HAEM@LAB1');
  assert.deepEqual(m.results.map((r) => [r.code, r.value, r.unit, r.flags]), [
    ['WBC', '12.1', '10^3/uL', ['H', 'A']],
    ['Haemoglobin', '9.8', 'g/dL', ['L']],
    ['NOTE', 'Smear&review', null, []],
  ]);
  assert.equal(parseHl7(text, { sampleIdField: 'OBR-2' })[0].sampleId, 'PL-9');
  assert.equal(parseHl7(text, { sampleIdField: 'PID-3' })[0].sampleId, 'MRN1');
  const qc = hl7Message({ sampleId: 'QC-L1-1', qc: true });
  assert.equal(parseHl7(qc.text)[0].qc, true);
  const spm = parseHl7(`${text}\rSPM|1|SPM-77^F1||BLD`, { sampleIdField: 'SPM-2' });
  assert.equal(spm[0].sampleId, 'SPM-77');
});

test('HL7 OBX type classification: IS is never a result/image, ED becomes an image not a result', () => {
  const text = [
    'MSH|^~\\&|M51|LAB|LIS|PF|20260930104200||ORU^R01|CTL1|P|2.3.1',
    'PID|1||||^TEST',
    'OBR|1||10614|01001^Automated Count^99MRC',
    'OBX|1|IS|02001^Take Mode^99MRC||O||||||F',
    'OBX|2|IS|09001^Remark^99MRC||||||||F',
    'OBX|3|NM|6690-2^WBC^LN||13.29|10*3/uL|4.00-10.50|H~A|||F',
    'OBX|4|ED|12003^WBC Histogram. BMP^99MRC||^Image^BMP^Base64^QkFTRTY0REFUQQ==|||||||F',
    'OBX|5|ED|12153^WBC DIFF Scattergram. HS-MS BMP^99MRC||^Image^BMP^Base64^QkFTRTY0VFdP|||||||F',
  ].join('\r');
  const [m] = parseHl7(text, { sampleIdField: 'OBR-3' });
  assert.equal(m.sampleId, '10614');
  // IS segments never become a result or an image.
  assert.equal(m.results.length, 1);
  assert.deepEqual(m.results.map((r) => r.code), ['6690-2']);
  assert.ok(!m.results.some((r) => ['02001', '09001'].includes(r.code)));
  assert.ok(!m.images.some((im) => ['02001', '09001'].includes(im.code)));
  // ED segments become images, never results.
  assert.equal(m.images.length, 2);
  assert.deepEqual(m.images[0], { code: '12003', label: 'WBC Histogram', format: 'bmp', base64: 'QkFTRTY0REFUQQ==' });
  assert.deepEqual(m.images[1], { code: '12153', label: 'WBC DIFF Scattergram', format: 'bmp', base64: 'QkFTRTY0VFdP' });
});

test('redactEdImages: strips ED base64 to a placeholder, keeps everything else (segments, NM results) byte-identical', () => {
  const text = [
    'MSH|^~\\&|M51|LAB|LIS|PF|20260930104200||ORU^R01|CTL1|P|2.3.1',
    'OBR|1||10614|01001^Automated Count^99MRC',
    'OBX|1|NM|6690-2^WBC^LN||13.29|10*3/uL|4.00-10.50|H~A|||F',
    'OBX|2|ED|12003^WBC Histogram. BMP^99MRC||^Image^BMP^Base64^QkFTRTY0REFUQQ==|||||||F',
  ].join('\r');
  const redacted = redactEdImages(text);
  assert.ok(!redacted.includes('QkFTRTY0REFUQQ=='), 'base64 payload removed');
  assert.ok(redacted.includes('[image 12003 stored: see images[]]'));
  assert.ok(redacted.includes('OBX|1|NM|6690-2^WBC^LN||13.29|10*3/uL|4.00-10.50|H~A|||F'), 'NM segment untouched');
  assert.ok(redacted.includes('OBX|2|ED|12003^WBC Histogram. BMP^99MRC||^Image^BMP^Base64^[image 12003 stored: see images[]]|||||||F'));
  // Non-HL7 / no-MSH text and protocols without ED are a no-op.
  assert.equal(redactEdImages('not hl7 at all'), 'not hl7 at all');
  assert.equal(redactForUpload(text, 'hl7'), redacted);
  assert.equal(redactForUpload('R|1|^^^WBC|7.8|x\r', 'astm'), 'R|1|^^^WBC|7.8|x\r');
});

test('M51 synthetic fixture: 34 NM results (incl. the 2 unmapped histogram-line pairs and Age), 0 from IS, exactly 4 images, sample 10614', () => {
  const [m] = parseHl7(M51_FIXTURE, { sampleIdField: 'OBR-3' });
  assert.equal(m.sampleId, '10614');
  assert.equal(m.results.length, 34, 'all 34 NM segments, none excluded — matches current (no special-case) Age handling');
  assert.equal(m.images.length, 4);
  assert.deepEqual(m.images.map((im) => im.code), ['12003', '12053', '12103', '12153']);
  assert.deepEqual(m.images.map((im) => im.label), ['WBC Histogram', 'RBC Histogram', 'PLT Histogram', 'WBC DIFF Scattergram']);
  assert.ok(m.images.every((im) => im.format === 'bmp' && im.base64.length > 0));
  // IS segments (Take Mode, Blood Mode, Test Mode, Remark, Ref Group) contribute nothing.
  assert.ok(!m.results.some((r) => ['02001', '02002', '02003', '09001', '03001'].includes(r.code)));
  // The histogram-line NM pairs are legitimate unmapped results (unchanged from before).
  for (const c of ['12051', '12052', '12101', '12102']) assert.ok(m.results.some((r) => r.code === c));
  // Age is a plain NM result today (no special-casing exists in the parser) — preserved, not regressed.
  assert.ok(m.results.some((r) => r.code === '30525-0' && r.value === '19'));
});

test('M51 synthetic fixture via redactForUpload: raw stays small regardless of the 4 embedded images', () => {
  const redacted = redactForUpload(M51_FIXTURE, 'hl7');
  assert.ok(!/[A-Za-z0-9+/]{40,}/.test(redacted.replace(/stored: see images\[\]/g, '')), 'no long base64-looking run survives');
  assert.ok(redacted.length < 3000, `redacted raw should be well under the original ${M51_FIXTURE.length} bytes`);
  assert.ok(redacted.length < M51_FIXTURE.length, 'strictly smaller than the original');
});

test('HL7 ACK echoes the control id in MSA-2 and swaps sender/receiver', () => {
  const ack = buildAck('MSH|^~\\&|HAEM|LAB1|LIS|PF|20260930||ORU^R01|CTL123|P|2.3.1\rOBR|1', { now: new Date('2026-09-30T05:00:00Z') });
  const [msh, msa] = ack.split('\r');
  const f = msh.split('|');
  assert.equal(f[2], 'LIS');
  assert.equal(f[4], 'HAEM');
  assert.equal(f[8], 'ACK^R01');
  assert.equal(msa, 'MSA|AA|CTL123');
  assert.equal(buildAck('not hl7'), null);
});

test('Text template: default pattern, sample-ID line, flags, QC and multi-ticket blobs', () => {
  const t = textMessage({ sampleId: '260100050' }).text;
  const [m] = parseText(t);
  assert.equal(m.sampleId, '260100050');
  assert.ok(m.results.length >= 13);
  const wbc = m.results.find((r) => r.code === 'WBC');
  assert.equal(wbc.unit, '10^3/uL');
  const blob = 'SAMPLE ID: A1\nWBC 12.5 10^3/uL H\nHGB 9.1 g/dL L\nSAMPLE ID: A2\nWBC 6.0 10^3/uL\n';
  const two = parseText(blob);
  assert.deepEqual(two.map((x) => x.sampleId), ['A1', 'A2']);
  assert.deepEqual(two[0].results.map((r) => r.flags), [['H'], ['L']]);
  const qc = parseText('QC LEVEL 2\nSAMPLE ID: QC-9\nWBC 7.0 10^3/uL\n');
  assert.equal(qc[0].qc, true);
});

test('Text template: admin regex with named groups and fixed columns', () => {
  const cfg = { linePattern: '^(?<code>\\w+)=(?<value>[\\d.]+)(?:\\[(?<unit>[^\\]]+)\\])?(?<flag>[HL]?)$', sampleIdPattern: '^#(?<id>\\d+)$' };
  const [m] = parseText('#777\nWBC=8.1[10^3/uL]H\nPLT=320[10^3/uL]\n', cfg);
  assert.equal(m.sampleId, '777');
  assert.deepEqual(m.results.map((r) => [r.code, r.value, r.unit, r.flags]), [['WBC', '8.1', '10^3/uL', ['H']], ['PLT', '320', '10^3/uL', []]]);
  const fixed = parseText('ID 900\nWBC       8.10  10^3/uL H\n', {
    sampleIdPattern: '^ID (?<id>\\d+)',
    fixedColumns: [{ name: 'code', start: 0, end: 10 }, { name: 'value', start: 10, end: 14 }, { name: 'unit', start: 16, end: 23 }, { name: 'flag', start: 24, end: 25 }],
  });
  assert.equal(fixed[0].sampleId, '900');
  assert.deepEqual(fixed[0].results[0].flags, ['H']);
  assert.equal(fixed[0].results[0].value, '8.10');
});

test('parseMessage auto: link hint wins, else content sniffing', () => {
  const astm = astmMessage({ sampleId: 'X1' }).text;
  const hl7 = hl7Message({ sampleId: 'X2' }).text;
  const txt = textMessage({ sampleId: 'X3' }).text;
  assert.equal(parseMessage(astm, { type: 'auto' })[0].protocol, 'astm');
  assert.equal(parseMessage(hl7, { type: 'auto' })[0].protocol, 'hl7');
  assert.equal(parseMessage(txt, { type: 'auto' })[0].protocol, 'text');
  assert.equal(parseMessage(hl7, { type: 'auto' }, { link: 'mllp' })[0].sampleId, 'X2');
});
