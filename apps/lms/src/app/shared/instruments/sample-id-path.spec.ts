import { describe, expect, it } from 'vitest';
import { buildParser, emptyInstrumentForm, formFromInstrument } from './instrument-config';
import type { InstrumentDto } from './instrument.models';
import { extractSampleId, formatFor, pathLabel, pickModel, rangePath, textValue } from './sample-id-path';

// Same fixtures as electron/instruments/test/sample-id-path.test.js (the connector side).
const MEDONIC = ['MSH|^~\\&|Medonic|Lab|||20261024182301||ORU^R01|1|P|2.3.1', 'PID|1||||^261000013', 'PV1|1||W2^B7||||||||||||||||V77',
  'OBR|1||26703|01001^Automated Count^99MRC||20261024182150|20261024182150',
  'OBX|1|NM|6690-2^WBC^LN||8.26|10*3/uL|||||F'].join('\r');
const ERBA = ['H|\\^&|||Erba^EM200^SN42|||||||P|1|20261024', 'P|1||PAT77||DOE^JANE^^^MR',
  'O|1|S1001|RACK5|^^^GLU|R||20261024101500', 'R|1|^^^GLU|98|mg/dL||N||F', 'L|1|N'].join('\r');
const HBPRO = 'S04----19MS TEST PATNT  29 F032904121502610241230441018253351760.0012';
const SINO = JSON.stringify({ sinocare: 1, type: 1, resource: 'Observation',
  body: { fhir: { code: { text: 'HbA1c' }, valueQuantity: { value: '6.1', unit: '%' }, extension: { position: '3' }, sampleNo: 'OBS9' } },
  context: { patient: null, patients: { 3: { medicalRecordNo: ' 0777 ', name: 'Ravi', extension: { position: '3' } } }, device: { serialNumber: 'SN42' } } });

describe('sample-id-path (TS mirror of the connector)', () => {
  it('extracts like the connector: HL7, ASTM, HBPro, text, Sinocare', () => {
    expect(extractSampleId(MEDONIC, 'hl7', 'PID.5.2')).toBe('261000013');
    expect(extractSampleId(MEDONIC, 'hl7', 'OBR.3')).toBe('26703');
    expect(extractSampleId(MEDONIC, 'hl7', 'PV1.19')).toBe('V77');
    expect(extractSampleId(MEDONIC, 'hl7', 'MSH.3')).toBe('Medonic');
    expect(extractSampleId(MEDONIC, 'hl7', 'PID.5.3')).toBe('');
    expect(extractSampleId(ERBA, 'astm', 'O.3')).toBe('S1001');
    expect(extractSampleId(ERBA, 'astm', 'P.6.2')).toBe('JANE');
    expect(extractSampleId(HBPRO, 'hbpro', '7-9')).toBe('19');
    expect(extractSampleId(HBPRO, 'hbpro', '^S04-+(\\d+)')).toBe('19');
    expect(textValue('LAB\r\nRack 4 Tube 0012 Seq 99\r\n', '2:12-16')).toBe('0012');
    expect(extractSampleId(SINO, 'sinocare', 'Patient.medicalRecordNo')).toBe('0777');
    expect(extractSampleId(SINO, 'sinocare', 'Observation.sampleNo')).toBe('OBS9');
    expect(extractSampleId(SINO, 'sinocare', 'Device.serialNumber')).toBe('SN42');
  });

  it('HL7 picker: segment rows with numbered fields/components; tapping the cell gives PID.5.2', () => {
    const m = pickModel(MEDONIC, 'hl7');
    const pid = m.rows.find((r) => r.name === 'PID')!;
    expect(pid.cells.map((c) => [c.path, c.value])).toEqual([['PID.1', '1'], ['PID.5.2', '261000013']]);
    const msh = m.rows.find((r) => r.name === 'MSH')!;
    expect(msh.cells[0]).toEqual({ path: 'MSH.3', value: 'Medonic', label: '3' });
    expect(m.rows.find((r) => r.name === 'PV1')!.cells.map((c) => c.path)).toContain('PV1.3.2');
    // every offered cell reads back to its own value
    for (const r of m.rows) for (const c of r.cells) expect(extractSampleId(MEDONIC, 'hl7', c.path)).toBe(c.value);
  });

  it('HL7 picker: a repeated OBX gets [n]; subcomponents keep their component; long blobs are not offered', () => {
    const t = ['MSH|^~\\&|X|||||20261024||ORU^R01|1|P|2.5', 'PID|1||A1&B2^^^MR', 'OBR|1||S1', 'OBX|1|ST|SID||111', 'OBX|2|ED|IMG||^Image^BMP^Base64^' + 'Q'.repeat(200)].join('\r');
    const m = pickModel(t, 'hl7');
    expect(m.rows.find((r) => r.name === 'PID')!.cells.map((c) => c.path)).toEqual(['PID.1', 'PID.3.1.1', 'PID.3.1.2', 'PID.3.4']);
    const obx2 = m.rows.find((r) => r.name === 'OBX 2')!;
    expect(obx2.cells.every((c) => c.path.startsWith('OBX[2].'))).toBe(true);
    expect(obx2.cells.some((c) => c.value.length > 64)).toBe(false);
    for (const r of m.rows) for (const c of r.cells) expect(extractSampleId(t, 'hl7', c.path)).toBe(c.value);
  });

  it('ASTM picker: record rows, Erba O.3', () => {
    const m = pickModel(ERBA, 'astm');
    const o = m.rows.find((r) => r.name === 'O')!;
    expect(o.cells[1]).toEqual({ path: 'O.3', value: 'S1001', label: '3' });
    expect(m.rows.find((r) => r.name === 'H')!.cells.some((c) => c.path === 'H.2')).toBe(false);
    for (const r of m.rows) for (const c of r.cells) expect(extractSampleId(ERBA, 'astm', c.path)).toBe(c.value);
  });

  it('text / HBPro: two taps → range path; Sinocare leaves', () => {
    expect(rangePath('hbpro', 1, 8, 7)).toBe('7-9');
    expect(rangePath('text', 2, 12, 15)).toBe('2:12-16');
    expect(pickModel(HBPRO, 'hbpro').lines[0].text).toBe(HBPRO);
    const leaves = pickModel(SINO, 'sinocare').leaves;
    expect(leaves.find((l) => l.path === 'Patient.medicalRecordNo')?.value).toBe('0777');
    expect(leaves.find((l) => l.path === 'Observation.extension.position')?.value).toBe('3');
  });

  it('labels in plain words; auto protocol sniffs the message', () => {
    expect(pathLabel('hl7', 'PID.5.2')).toBe('PID-5.2');
    expect(pathLabel('hl7', 'OBX[2].5')).toBe('OBX[2]-5');
    expect(pathLabel('astm', 'O.3.1')).toBe('O record, field 3.1');
    expect(pathLabel('hbpro', '7-9')).toBe('characters 7–8');
    expect(pathLabel('text', '2:12-16')).toBe('line 2, characters 12–15');
    expect(formatFor('auto', MEDONIC)).toBe('hl7');
    expect(formatFor('auto', ERBA)).toBe('astm');
    expect(formatFor('auto', 'GLU 98')).toBe('text');
    expect(formatFor('lifedx-hbpro', '')).toBe('hbpro');
  });
});

describe('sampleIdPath in the saved config', () => {
  it('unset → parser blocks byte-identical to before', () => {
    const f = emptyInstrumentForm();
    f.protocol = 'hl7';
    const before = JSON.stringify(buildParser(f));
    f.sampleIdPath = null;
    expect(JSON.stringify(buildParser(f))).toBe(before);
    f.sampleIdPath = { format: 'hl7', path: '  ' };
    expect(JSON.stringify(buildParser(f))).toBe(before);
    expect(before).not.toContain('sampleIdPath');
  });

  it('set → only its own block carries it; round-trips through the saved config', () => {
    const f = emptyInstrumentForm();
    f.protocol = 'hl7';
    f.sampleIdPath = { format: 'hl7', path: 'PID.5.2' };
    const p = buildParser(f);
    expect(p.hl7).toEqual({ sampleIdField: 'OBR-3', sampleIdPath: 'PID.5.2' });
    expect(p.astm).toEqual({ sampleIdField: 3, sampleIdComponent: 1 });
    expect(p.text?.sampleIdPath).toBeUndefined();
    const back = formFromInstrument({ name: 'M', make: '', model: '', serialNumber: '', isActive: true, transport: 'tcp-server',
      config: { transport: { type: 'tcp-server', port: 5001 }, link: { type: 'mllp' }, parser: p } } as unknown as InstrumentDto);
    expect(back.sampleIdPath).toEqual({ format: 'hl7', path: 'PID.5.2' });
  });

  it('a path for another protocol is dropped (protocol changed); presets keep it in their own block', () => {
    const f = emptyInstrumentForm();
    f.protocol = 'astm';
    f.sampleIdPath = { format: 'hl7', path: 'PID.5.2' };
    expect(JSON.stringify(buildParser(f))).not.toContain('sampleIdPath');
    f.protocol = 'lifedx-hbpro';
    f.sampleIdPath = { format: 'hbpro', path: '7-9' };
    expect(buildParser(f).hbpro).toEqual({ fields: [], sampleIdPath: '7-9' });
    f.protocol = 'sinocare-fhir';
    f.sampleIdPath = { format: 'sinocare', path: 'Patient.name' };
    expect(buildParser(f).sinocare).toEqual({ sampleIdField: 'medicalRecordNo', sampleIdPath: 'Patient.name' });
  });
});
