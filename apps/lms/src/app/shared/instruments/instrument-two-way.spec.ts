import { describe, expect, it } from 'vitest';
import type { Test } from '../models/test.model';
import type { InstrumentDto } from './instrument.models';
import { buildInstrumentConfig, buildUpsert, emptyInstrumentForm, formFromInstrument, validateInstrumentForm } from './instrument-config';
import {
  DeviceOrdersDto, TWO_WAY_MODES, buildBidirectional, emptyTwoWayForm, hasQuery, hasWorklist, isDefaultTwoWay, modeLabel,
  orderCodeProblem, orderCodeTestOptions, ordersPreviewUrl, previewErrorText, previewView, showsHl7Options, twoWayFromConfig,
  validateTwoWay, withOrderCodeRowsFor,
} from './instrument-two-way';

const OLD_CONFIG = {
  transport: { type: 'tcp-server', port: 5001, host: '0.0.0.0' },
  link: { type: 'mllp', ackTimeoutMs: 15000, frameTimeoutMs: 30000, idleMs: 1500 },
  parser: { type: 'hl7', astm: { sampleIdField: 3, sampleIdComponent: 1 }, hl7: { sampleIdField: 'OBR-3' }, text: { linePattern: 'x', sampleIdPattern: 'y', qcPattern: 'z', fixedColumns: null } },
};
const dto = (config: Record<string, unknown>): InstrumentDto => ({
  id: 'i1', name: 'BS-240', transport: 'tcp-server', config: config as never, isActive: true, status: 'online', hasDeviceKey: true,
});

describe('two-way — defaults + loading the ConfigJson block', () => {
  it('a fresh form is Off, patient details off, HL7 auto / ORM^O01, 24 h window, 60 s check, no codes', () => {
    expect(emptyTwoWayForm()).toEqual({
      mode: 'off', sendPatient: false, hl7Query: 'auto', hl7Order: 'orm_o01', worklistWindowHours: 24, worklistPollSeconds: 60, orderCodes: [],
    });
    expect(emptyInstrumentForm().twoWay.mode).toBe('off');
  });

  it('an instrument with no block (every instrument before this change) loads as Off', () => {
    expect(twoWayFromConfig(undefined)).toEqual(emptyTwoWayForm());
    expect(twoWayFromConfig(null)).toEqual(emptyTwoWayForm());
    expect(twoWayFromConfig('query')).toEqual(emptyTwoWayForm());
    expect(formFromInstrument(dto(OLD_CONFIG)).twoWay).toEqual(emptyTwoWayForm());
  });

  it('reads every field; an unknown mode / dialect falls back to the safe default', () => {
    const f = twoWayFromConfig({
      mode: 'both', sendPatient: true, hl7Query: 'qbp_q11', hl7Order: 'oml_o21', worklistWindowHours: 48, worklistPollSeconds: 120,
      orderCodes: { HEM001: 'CBC', BIO010: 'GLU', bad: 5 },
    });
    expect(f).toEqual({
      mode: 'both', sendPatient: true, hl7Query: 'qbp_q11', hl7Order: 'oml_o21', worklistWindowHours: 48, worklistPollSeconds: 120,
      orderCodes: [{ testCatalogKey: 'HEM001', code: 'CBC' }, { testCatalogKey: 'BIO010', code: 'GLU' }],
    });
    const odd = twoWayFromConfig({ mode: 'remote-start', hl7Query: 'x', hl7Order: 'y', sendPatient: 'yes' });
    expect(odd.mode).toBe('off');
    expect(odd.hl7Query).toBe('auto');
    expect(odd.hl7Order).toBe('orm_o01');
    expect(odd.sendPatient).toBe(false);
  });
});

describe('two-way — what shows when', () => {
  it('query / worklist parts follow the mode', () => {
    expect([hasQuery('off'), hasQuery('query'), hasQuery('worklist'), hasQuery('both')]).toEqual([false, true, false, true]);
    expect([hasWorklist('off'), hasWorklist('query'), hasWorklist('worklist'), hasWorklist('both')]).toEqual([false, false, true, true]);
  });
  it('HL7 options only for HL7 or auto-detect', () => {
    expect(showsHl7Options('hl7')).toBe(true);
    expect(showsHl7Options('auto')).toBe(true);
    expect(showsHl7Options('astm')).toBe(false);
    expect(showsHl7Options('text')).toBe(false);
  });
  it('four modes, each with a plain sentence; the labels have no protocol jargon', () => {
    expect(TWO_WAY_MODES.map((m) => m.value)).toEqual(['off', 'query', 'worklist', 'both']);
    for (const m of TWO_WAY_MODES) {
      expect(m.desc.length).toBeGreaterThan(30);
      expect(m.label).not.toMatch(/HL7|ASTM|QRY|ORM|LIS/);
    }
    expect(modeLabel('query')).toBe('Analyzer asks by barcode');
  });
});

describe('two-way — validation (contract ranges + order-code rules)', () => {
  it('nothing is checked while Off', () => {
    expect(validateTwoWay({ ...emptyTwoWayForm(), worklistWindowHours: 999, orderCodes: [{ testCatalogKey: '', code: 'A|B' }] })).toEqual([]);
  });
  it('worklist window 1..168 h and check-every 15..3600 s, whole numbers only — worklist modes only', () => {
    const base = { ...emptyTwoWayForm(), mode: 'worklist' as const };
    expect(validateTwoWay(base)).toEqual([]);
    for (const h of [0, 169, 1.5, null]) expect(validateTwoWay({ ...base, worklistWindowHours: h }).map((i) => i.field)).toEqual(['window']);
    for (const s of [14, 3601, null]) expect(validateTwoWay({ ...base, worklistPollSeconds: s }).map((i) => i.field)).toEqual(['poll']);
    expect(validateTwoWay({ ...base, worklistWindowHours: 1, worklistPollSeconds: 3600 })).toEqual([]);
    expect(validateTwoWay({ ...base, worklistWindowHours: 168, worklistPollSeconds: 15 })).toEqual([]);
    // Query-only: the worklist numbers are hidden and not checked.
    expect(validateTwoWay({ ...base, mode: 'query', worklistWindowHours: 0 })).toEqual([]);
  });
  it('order code: required, ≤ 32 characters, none of | ^ ~ \\ &', () => {
    expect(orderCodeProblem('CBC')).toBeNull();
    expect(orderCodeProblem('x'.repeat(32))).toBeNull();
    expect(orderCodeProblem('x'.repeat(33))).toMatch(/32/);
    expect(orderCodeProblem('  ')).toMatch(/Type the code/);
    for (const c of ['A|B', 'A^B', 'A~B', 'A\\B', 'A&B', 'A\nB']) expect(orderCodeProblem(c)).not.toBeNull();
  });
  it('order-code rows: blank rows ignored, a test is needed, one code per test', () => {
    const f = {
      ...emptyTwoWayForm(), mode: 'query' as const,
      orderCodes: [
        { testCatalogKey: '', code: '' },
        { testCatalogKey: 'HEM001', code: 'CBC' },
        { testCatalogKey: '', code: 'GLU' },
        { testCatalogKey: 'HEM001', code: 'CBC2' },
        { testCatalogKey: 'BIO010', code: 'G^1' },
        { testCatalogKey: 'BIO011', code: '' },
      ],
    };
    expect(validateTwoWay(f).map((i) => [i.index, i.message])).toEqual([
      [2, 'Pick the test this code is for'],
      [3, 'This test already has an order code'],
      [4, 'A code can’t contain | ^ ~ \\ or &'],
      [5, 'Type the code the analyzer expects'],
    ]);
  });
  it('issues land on the editor’s Two-way step and block Save', () => {
    const form = emptyInstrumentForm();
    form.name = 'X'; form.serial.path = 'COM1';
    form.twoWay = { ...form.twoWay, mode: 'worklist', worklistPollSeconds: 5 };
    expect(validateInstrumentForm(form)).toEqual([{ step: 'twoway', field: 'twoWay.poll', message: 'Seconds must be a whole number from 15 to 3600' }]);
  });
});

describe('two-way — serialisation round-trip', () => {
  it('an OLD instrument saved without touching the section: config unchanged — NO bidirectional key', () => {
    const f = formFromInstrument(dto(OLD_CONFIG));
    const cfg = buildInstrumentConfig(f, OLD_CONFIG as never);
    expect('bidirectional' in cfg).toBe(false);
    expect(JSON.stringify(buildUpsert(f, OLD_CONFIG as never).config)).toBe(JSON.stringify(buildInstrumentConfig(f, OLD_CONFIG as never)));
    expect(buildBidirectional(emptyTwoWayForm(), undefined)).toBeUndefined();
  });

  it('turned on then back off on an old instrument: still no block', () => {
    const f = formFromInstrument(dto(OLD_CONFIG));
    f.twoWay = { ...f.twoWay, mode: 'query' };
    f.twoWay = { ...f.twoWay, mode: 'off' };
    expect('bidirectional' in buildInstrumentConfig(f, OLD_CONFIG as never)).toBe(false);
  });

  it('a new choice writes the full contract block', () => {
    const f = emptyInstrumentForm();
    f.twoWay = {
      ...f.twoWay, mode: 'both', sendPatient: true, hl7Query: 'qry_q02',
      orderCodes: [{ testCatalogKey: ' HEM001 ', code: ' CBC ' }, { testCatalogKey: '', code: '' }],
    };
    expect(buildInstrumentConfig(f)['bidirectional']).toEqual({
      mode: 'both', sendPatient: true, hl7Query: 'qry_q02', hl7Order: 'orm_o01', worklistWindowHours: 24, worklistPollSeconds: 60,
      orderCodes: { HEM001: 'CBC' },
    });
  });

  it('config → form → config is stable, and keys this screen doesn’t know survive', () => {
    const block = {
      mode: 'worklist', sendPatient: false, hl7Query: 'auto', hl7Order: 'oml_o21', worklistWindowHours: 12, worklistPollSeconds: 30,
      orderCodes: { HEM001: 'CBC' }, futureFlag: 7,
    };
    const saved = { ...OLD_CONFIG, bidirectional: block };
    const f = formFromInstrument(dto(saved));
    const again = buildInstrumentConfig(f, saved as never);
    expect(again['bidirectional']).toEqual(block);
    const f2 = formFromInstrument(dto(again as never));
    expect(f2.twoWay).toEqual(f.twoWay);
  });

  it('an existing block switched to Off keeps the block with mode "off" (connector sees it)', () => {
    const saved = { ...OLD_CONFIG, bidirectional: { mode: 'query', sendPatient: true } };
    const f = formFromInstrument(dto(saved));
    f.twoWay = { ...f.twoWay, mode: 'off' };
    expect(buildInstrumentConfig(f, saved as never)['bidirectional']).toMatchObject({ mode: 'off', sendPatient: true });
  });

  it('isDefaultTwoWay ignores blank order-code rows', () => {
    expect(isDefaultTwoWay({ ...emptyTwoWayForm(), orderCodes: [{ testCatalogKey: '', code: '' }] })).toBe(true);
    expect(isDefaultTwoWay({ ...emptyTwoWayForm(), sendPatient: true })).toBe(false);
  });
});

describe('two-way — order-code test picker', () => {
  const tests = [
    { name: 'Complete Blood Count', catalogKey: 'HEM001', type: 'profile', testCode: 'CBC' },
    { name: 'Glucose, fasting', catalogKey: 'BIO010', type: 'individual', code: 'GLU' },
    { name: 'Glucose, fasting (copy)', catalogKey: 'BIO010', type: 'individual' },
    { name: 'No key', catalogKey: null, type: 'individual' },
  ] as unknown as Test[];
  it('every test with a catalogue key (profiles too), once, by name; a stale saved key keeps a label', () => {
    const opts = orderCodeTestOptions(tests, [{ testCatalogKey: 'GONE01', code: 'X' }]);
    expect(opts.map((o) => [o.value, o.label, o.hint])).toEqual([
      ['HEM001', 'Complete Blood Count', 'CBC · Profile'],
      ['BIO010', 'Glucose, fasting', 'GLU'],
      ['GONE01', 'GONE01', 'Not in the test list'],
    ]);
  });
  it('preview "add order codes" adds a blank row per new key only', () => {
    const rows = withOrderCodeRowsFor([{ testCatalogKey: 'HEM001', code: 'CBC' }], ['HEM001', 'BIO010', 'BIO010']);
    expect(rows).toEqual([{ testCatalogKey: 'HEM001', code: 'CBC' }, { testCatalogKey: 'BIO010', code: '' }]);
  });
});

describe('two-way — "Test a barcode" preview', () => {
  const found: DeviceOrdersDto = {
    sampleId: '26329', found: true, priority: 'urgent', collectedAt: '2026-10-14T05:10:00Z', specimen: 'Whole blood',
    patient: { id: 'AA0007', name: 'Paravai Munusamy', sex: 'F', dob: '1982-01-31', ageYears: 44 },
    tests: [{ code: 'CBC', testCatalogKey: 'HEM001', name: 'Complete Blood Count' }],
    unmapped: [{ testCatalogKey: 'HEM050', name: 'ESR' }],
  };
  it('url encodes id + barcode', () => {
    expect(ordersPreviewUrl('a b', ' 26/329 ')).toBe('/api/instruments/a%20b/orders-preview?sampleId=26%2F329');
  });
  it('found: meta from the data, tests + unmapped, patient line only when patient details are on', () => {
    const v = previewView(found, true, () => '14 Oct, 10:40 am');
    expect(v).toEqual({
      found: true, sampleId: '26329', meta: 'Urgent · Whole blood · Collected 14 Oct, 10:40 am',
      tests: found.tests, unmapped: found.unmapped, patientLine: 'Paravai Munusamy · Female · 44 y · ID AA0007',
    });
    expect(previewView(found, false).patientLine).toBeNull();
    expect(previewView({ ...found, patient: null }, true).patientLine).toBeNull();
    expect(previewView({ ...found, priority: 'normal', specimen: null, collectedAt: null }, false).meta).toBe('Normal');
  });
  it('not found: no tests, no patient, no meta', () => {
    const v = previewView({ sampleId: '999', found: false, tests: [], unmapped: [], patient: found.patient }, true);
    expect(v).toEqual({ found: false, sampleId: '999', meta: '', tests: [], unmapped: [], patientLine: null });
  });
  it('errors read in plain words', () => {
    expect(previewErrorText('bidirectional_off')).toMatch(/Two-way is off/);
    expect(previewErrorText(undefined, 'Forbidden')).toBe('Forbidden');
    expect(previewErrorText(undefined, '')).toMatch(/Couldn’t check/);
  });
});
