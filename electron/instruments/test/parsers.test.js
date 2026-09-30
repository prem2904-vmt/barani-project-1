'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAstm } = require('../core/parsers/astm');
const { parseHl7, buildAck } = require('../core/parsers/hl7');
const { parseText } = require('../core/parsers/text');
const { parseMessage } = require('../core/parsers');
const { astmMessage, hl7Message, textMessage } = require('../sim/dialects');

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
