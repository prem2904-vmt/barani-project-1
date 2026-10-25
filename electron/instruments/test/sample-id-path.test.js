'use strict';
/**
 * Custom sample-number location (parser.<block>.sampleIdPath): picked from a
 * real message in the editor; overrides the standard field, falls back to it
 * when the path reads nothing, and changes NOTHING when unset.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseMessage } = require('../core/parsers');
const { parseHl7Path, parseAstmPath, textValue } = require('../core/parsers/sample-id-path');

const HBPRO = fs.readFileSync(path.join(__dirname, 'fixtures/lifedx-hbpro-record.txt'), 'latin1');
const M51 = fs.readFileSync(path.join(__dirname, 'fixtures/m51-synthetic.hl7'), 'latin1');

const medonic = (pid) => ['MSH|^~\\&|Medonic|Lab|||20261024182301||ORU^R01|1|P|2.3.1', pid, 'PV1|1||W2^B7||||||||||||||||V77',
  'OBR|1||26703|01001^Automated Count^99MRC||20261024182150|20261024182150',
  'OBX|1|NM|6690-2^WBC^LN||8.26|10*3/uL|||||F'].join('\r');

const erba = (o3, o4 = '') => ['H|\\^&|||Erba^EM200^SN42|||||||P|1|20261024',
  'P|1||PAT77||DOE^JANE^^^MR',
  `O|1|${o3}|${o4}|^^^GLU|R||20261024101500`,
  'R|1|^^^GLU|98|mg/dL||N||F',
  'L|1|N'].join('\r');

test('path grammar: HL7 SEG[n].field.comp.sub, ASTM Type[n].field.comp, bad paths → null', () => {
  assert.deepEqual(parseHl7Path('PID.5.2'), { seg: 'PID', occ: null, field: 5, comp: 2, sub: null });
  assert.deepEqual(parseHl7Path('obx[2].5'), { seg: 'OBX', occ: 2, field: 5, comp: null, sub: null });
  assert.deepEqual(parseHl7Path('PID.3.4.1'), { seg: 'PID', occ: null, field: 3, comp: 4, sub: 1 });
  assert.equal(parseHl7Path('PID-5'), null);
  assert.equal(parseHl7Path('PID.0'), null);
  assert.deepEqual(parseAstmPath('O.3.1'), { type: 'O', occ: null, field: 3, comp: 1 });
  assert.deepEqual(parseAstmPath('P[2].6'), { type: 'P', occ: 2, field: 6, comp: null });
  assert.equal(parseAstmPath('OBR.3'), null);
});

test('HL7: Medonic PID|1||||^261000013 → PID.5.2 overrides the standard field', () => {
  const [m] = parseMessage(medonic('PID|1||||^261000013'), { type: 'hl7', hl7: { sampleIdField: 'OBR-3', sampleIdPath: 'PID.5.2' } });
  assert.equal(m.sampleId, '261000013');
  assert.equal(m.results.length, 1);
});

test('HL7: OBR.3, PV1.19, MSH.3 (separator quirk), OBX[1].5, trims', () => {
  const t = medonic('PID|1||||^ 261000013 ');
  const id = (p) => parseMessage(t, { type: 'hl7', hl7: { sampleIdField: 'PID-3', sampleIdPath: p } })[0].sampleId;
  assert.equal(id('OBR.3'), '26703');
  assert.equal(id('PV1.19'), 'V77');
  assert.equal(id('MSH.3'), 'Medonic');
  assert.equal(id('OBX[1].5'), '8.26');
  assert.equal(id('PID.5.2'), '261000013');
  assert.equal(id('PV1.3.2'), 'B7');
});

test('HL7: path that reads nothing falls back to the standard field', () => {
  const t = medonic('PID|1||||^261000013');
  const id = (p, f = 'OBR-3') => parseMessage(t, { type: 'hl7', hl7: { sampleIdField: f, sampleIdPath: p } })[0].sampleId;
  assert.equal(id('PID.5.3'), '26703');          // empty component
  assert.equal(id('ZZZ.1'), '26703');            // no such segment
  assert.equal(id('garbage'), '26703');          // unparseable path
  assert.equal(id('PID.5.3', 'PID-5'), '261000013');
});

test('HL7: per order — OBR path uses each OBR; PID uses the patient before it', () => {
  const t = ['MSH|^~\\&|X|||||20261024||ORU^R01|1|P|2.3.1',
    'PID|1||A1||^111', 'OBR|1||S1', 'OBX|1|NM|GLU||5',
    'PID|2||A2||^222', 'OBR|2||S2', 'OBX|1|NM|GLU||6'].join('\r');
  const ids = (p) => parseMessage(t, { type: 'hl7', hl7: { sampleIdPath: p } }).map((m) => m.sampleId);
  assert.deepEqual(ids('OBR.3'), ['S1', 'S2']);
  assert.deepEqual(ids('PID.5.2'), ['111', '222']);
  assert.deepEqual(ids('PID[2].5.2'), ['222', '222']);
});

test('HL7: custom path wins over SPM-2, QC pattern judged on the custom value', () => {
  const t = ['MSH|^~\\&|X|||||20261024||ORU^R01|1|P|2.5', 'PID|1||||^QC77', 'OBR|1||S1', 'SPM|1|SPM9', 'OBX|1|NM|GLU||5'].join('\r');
  const [m] = parseMessage(t, { type: 'hl7', qcPattern: '^QC', hl7: { sampleIdField: 'SPM-2', sampleIdPath: 'PID.5.2' } });
  assert.equal(m.sampleId, 'QC77');
  assert.equal(m.qc, true);
});

test('ASTM: Erba O.3 / O.3.1 / P.6.2 / P.4, fallback to O.3↔O.4 standard', () => {
  const id = (t, p, cfg = {}) => parseMessage(t, { type: 'astm', astm: { sampleIdField: 4, sampleIdComponent: 1, ...cfg, sampleIdPath: p } })[0].sampleId;
  assert.equal(id(erba('S1001', 'RACK5'), 'O.3'), 'S1001');      // standard would say RACK5 (O.4)
  assert.equal(id(erba('S1001^2^3'), 'O.3.1'), 'S1001');
  assert.equal(id(erba('S1001'), 'P.6.2'), 'JANE');
  assert.equal(id(erba('S1001'), 'P.4'), 'PAT77');
  assert.equal(id(erba('S1001'), 'P.3'), 'S1001');                // P.3 empty → standard (O.4 empty → O.3)
  assert.equal(id(erba('', 'RACK5'), 'O.3'), 'RACK5');           // empty → standard
  assert.equal(id(erba('S1001', 'RACK5'), 'Q.3'), 'RACK5');      // no such record → standard
});

test('HBPro: character range and regex; empty range → standard', () => {
  const id = (p) => parseMessage(HBPRO, { type: 'lifedx-hbpro', hbpro: { sampleIdPath: p } })[0].sampleId;
  assert.equal(id('7-9'), '19');
  assert.equal(id('3-9'), '----19');               // trim only — what you pick is what you get
  assert.equal(id('^S04-+(\\d+)'), '19');
  assert.equal(id('9-11'), 'MS');
  assert.equal(id('5000-5005'), '19');             // past the end → standard (3–8, padding stripped)
});

test('text: line:start-end on a one-ticket message; several tickets keep the standard pattern', () => {
  const one = 'LAB PRINTOUT\r\nRack 4 Tube 0012 Seq 99\r\nGLU 98 mg/dL\r\n';
  const id = (t, p) => parseMessage(t, { type: 'text', text: { sampleIdPath: p } }).map((m) => m.sampleId);
  assert.deepEqual(id(one, '2:12-16'), ['0012']);
  assert.deepEqual(id(one, 'Tube\\s+(\\d+)'), ['0012']);
  assert.equal(textValue(one, '2:12-16'), '0012');
  const two = 'SAMPLE: A1\nGLU 98 mg/dL\nSAMPLE: A2\nGLU 99 mg/dL\n';
  assert.deepEqual(id(two, '1:8-10'), ['A1', 'A2']);
});

test('Sinocare: Patient.medicalRecordNo / Patient.extension.position / Observation.* / Device.*', () => {
  const env = JSON.stringify({ sinocare: 1, type: 1, resource: 'Observation',
    body: { fhir: { code: { text: 'HbA1c' }, valueQuantity: { value: '6.1', unit: '%' }, extension: { position: '3' }, sampleNo: 'OBS9' } },
    context: { patient: null, patients: { 3: { medicalRecordNo: ' 0777 ', name: 'Ravi', extension: { position: '3' } } }, device: { serialNumber: 'SN42' } } });
  const id = (p) => parseMessage(env, { type: 'sinocare-fhir', sinocare: { sampleIdField: 'medicalRecordNo', sampleIdPath: p } })[0].sampleId;
  assert.equal(id('Patient.medicalRecordNo'), '0777');
  assert.equal(id('Patient.extension.position'), '3');
  assert.equal(id('Patient.name'), 'Ravi');
  assert.equal(id('Observation.sampleNo'), 'OBS9');
  assert.equal(id('Device.serialNumber'), 'SN42');
  assert.equal(id('Patient.nothing'), 'OBS9');     // standard: the Observation's own id first
});

test('unset / empty sampleIdPath is byte-identical to the standard parse', () => {
  const cases = [
    [medonic('PID|1||||^261000013'), { type: 'hl7', hl7: { sampleIdField: 'PID-5' } }, 'hl7'],
    [M51, { type: 'hl7', hl7: { sampleIdField: 'OBR-3' } }, 'hl7'],
    [erba('S1001', 'RACK5'), { type: 'astm', astm: { sampleIdField: 3, sampleIdComponent: 1 } }, 'astm'],
    [HBPRO, { type: 'lifedx-hbpro', hbpro: { fields: 'A 63 69 %' } }, 'hbpro'],
    ['SAMPLE: A1\nGLU 98 mg/dL\n', { type: 'text', text: {} }, 'text'],
  ];
  for (const [t, cfg, block] of cases) {
    const base = JSON.stringify(parseMessage(t, cfg));
    const k = block === 'hbpro' ? 'hbpro' : block;
    assert.equal(JSON.stringify(parseMessage(t, { ...cfg, [k]: { ...(cfg[k] || {}), sampleIdPath: '' } })), base, `${block} empty path`);
    assert.equal(JSON.stringify(parseMessage(t, { ...cfg, [k]: { ...(cfg[k] || {}), sampleIdPath: undefined } })), base, `${block} undefined path`);
  }
});
