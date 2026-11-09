import { describe, expect, it } from 'vitest';
import {
  tubeInLab,
  nothingToSubmitMessage,
  TabSnapshot,
  invalidNumbers,
  isFilled,
  missingEntries,
  missingLine,
  overlayDraft,
  prefillFromTests,
  tabMark,
  tabPayload,
  blankTests,
  boldFromTests,
} from './submit-all';

const PARAMS = JSON.stringify({
  parameters: [
    { name: 'target', title: 'Target Detection', type: 'select', options: ['Detected', 'Not detected'] },
    { name: 'adequacy', title: 'Sample Adequacy', type: 'select', options: ['Adequate', 'Inadequate'] },
    { name: 'qc', title: 'Molecular QC', type: 'select', options: ['Pass', 'Fail'] },
  ],
});

function test(id: string, name: string, extra: Record<string, unknown> = {}): any {
  return { id, subOrderId: 's', testId: id, name, status: 'in_progress', test: { id, name, parameters: PARAMS }, ...extra };
}
function tab(sampleId: string, barcode: string, tests: any[], values: Record<string, Record<string, unknown>> = {}): TabSnapshot {
  return { sampleId, barcode, tests, values };
}

describe('Submit all — the empty-field rule', () => {
  it('every field of every writable test filled → nothing missing', () => {
    const tabs = [
      tab('a', '26123', [test('t1', 'Bacterial PCR Detection')], { t1: { target: 'Detected', adequacy: 'Adequate', qc: 'Pass' } }),
      tab('b', '26124', [test('t2', 'Bacterial Identification')], { t2: { target: 'Not detected', adequacy: 'Adequate', qc: 'Pass' } }),
    ];
    expect(missingEntries(tabs)).toEqual([]);
  });

  it('empty fields are listed per tab and test, in tab order — a test with NO value included', () => {
    const tabs = [
      tab('a', '26123', [test('t1', 'Bacterial PCR Detection')], { t1: { target: 'Detected', adequacy: '', qc: 'Pass' } }),
      tab('b', '26124', [test('t2', 'Bacterial Identification')]),
    ];
    const m = missingEntries(tabs);
    expect(m.map(missingLine)).toEqual([
      '26123 · Bacterial PCR Detection — Sample Adequacy',
      '26124 · Bacterial Identification — Target Detection, Sample Adequacy, Molecular QC',
    ]);
    expect(m[0]).toMatchObject({ sampleId: 'a', testId: 't1', fields: [{ name: 'adequacy', title: 'Sample Adequacy' }] });
  });

  it('submitted / validated / rejected tests and cultures never count', () => {
    const culture = test('t9', 'Urine C/S');
    culture.test.parameters = JSON.stringify({ microFormat: 'culture_sensitivity', parameters: [] });
    const tabs = [tab('a', '26123', [
      test('t1', 'A', { status: 'entered' }), test('t2', 'B', { status: 'validated' }),
      test('t3', 'C', { status: 'rejected' }), culture,
    ])];
    expect(missingEntries(tabs)).toEqual([]);
    expect(tabMark(tabs[0])).toBeNull();
    expect(tabPayload(tabs[0]).results).toEqual([]);
  });

  it('a schema-less test has one "Result" field and is named alone', () => {
    const bare = { ...test('t1', 'ESR'), test: { id: 't1', name: 'ESR', parameters: null } };
    expect(missingEntries([tab('a', '26123', [bare])]).map(missingLine)).toEqual(['26123 · ESR']);
  });

  it('a checkbox is never "empty" (unticked is an answer); blank text is', () => {
    const t = test('t1', 'Flags');
    t.test.parameters = JSON.stringify({ parameters: [
      { name: 'hemolysed', title: 'Hemolysed', type: 'checkbox' },
      { name: 'note', title: 'Note', type: 'text' },
    ] });
    const m = missingEntries([tab('a', '26123', [t], { t1: { note: '   ' } })]);
    expect(m[0].fields.map((f) => f.name)).toEqual(['note']);
    expect(isFilled(false)).toBe(false);
    expect(isFilled(true)).toBe(true);
    expect(isFilled(0)).toBe(true);
  });

  it('tab marks: dot when some value is there, check when every field is filled', () => {
    const t = [test('t1', 'PCR')];
    expect(tabMark(tab('a', '1', t))).toBeNull();
    expect(tabMark(tab('a', '1', t, { t1: { target: 'Detected' } }))).toBe('draft');
    expect(tabMark(tab('a', '1', t, { t1: { target: 'Detected', adequacy: 'Adequate', qc: 'Pass' } }))).toBe('complete');
  });

  it('the payload carries the writable tests WITH a value; a blank one is closed as not reported instead (owner 2026-10-03)', () => {
    const snap = tab('a', '1', [test('t1', 'A'), test('t2', 'B'), test('t3', 'C', { status: 'entered' })], { t1: { target: 'Detected' } });
    expect(tabPayload(snap).results).toEqual([
      { orderTestId: 't1', values: { target: 'Detected' }, note: undefined },
    ]);
    expect(blankTests(snap).map((t) => t.id)).toEqual(['t2']);
  });

  it('a number field holding text is reported (the per-tab submit check)', () => {
    const t = test('t1', 'Hb');
    t.test.parameters = JSON.stringify({ parameters: [{ name: 'hb', title: 'Haemoglobin', type: 'number' }] });
    expect(invalidNumbers(tab('a', '1', [t], { t1: { hb: '12..' } }))).toEqual(['Haemoglobin']);
    expect(invalidNumbers(tab('a', '1', [t], { t1: { hb: '12.5' } }))).toEqual([]);
  });

  it('drafts count: the server prefill, overlaid by the local unsaved copy', () => {
    const tests = [test('t1', 'A', { currentResult: JSON.stringify({ values: { target: 'Detected', qc: 'Pass' } }) })];
    const v = overlayDraft(prefillFromTests(tests), { t1: { qc: 'Fail', adequacy: 'Adequate' } });
    expect(v).toEqual({ t1: { target: 'Detected', qc: 'Fail', adequacy: 'Adequate' } });
  });
});

describe('Submit all — "print in bold" rides the per-tab payload', () => {
  it('a known bold map goes with every submitted test ([] when none); an unknown one is omitted', () => {
    const snap = tab('a', '1', [test('t1', 'A'), test('t2', 'B')], { t1: { target: 'Detected' }, t2: { target: 'Detected' } });
    expect(tabPayload({ ...snap, bold: { t1: ['target'] } }).results).toEqual([
      { orderTestId: 't1', values: { target: 'Detected' }, note: undefined, bold: ['target'] },
      { orderTestId: 't2', values: { target: 'Detected' }, note: undefined, bold: [] },
    ]);
    // No map (not known) → the server keeps each saved list.
    expect(tabPayload(snap).results.every(r => !('bold' in r))).toBe(true);
  });

  it('the saved picks come back from each result snapshot', () => {
    const t1 = test('t1', 'A', { currentResult: JSON.stringify({ values: {}, bold: ['target', 7, ''] }) });
    const t2 = test('t2', 'B', { currentResult: JSON.stringify({ values: {} }) });
    const t3 = test('t3', 'C', { currentResult: 'oops' });
    expect(boldFromTests([t1, t2, t3])).toEqual({ t1: ['target'] });
  });
});

describe('OPS-120: tubes not in the lab', () => {
  const t = (id: string, status = 'pending'): any => ({ id, status, name: id, test: { name: id, parameters: JSON.stringify({ parameters: [{ id: 'v', name: 'v', title: 'V', type: 'number' }] }) } });
  it('tubeInLab is false only for pending / rejected', () => {
    expect(tubeInLab({ status: 'pending' })).toBe(false);
    expect(tubeInLab({ status: 'rejected' })).toBe(false);
    expect(tubeInLab({ status: 'received' })).toBe(true);
    expect(tubeInLab({})).toBe(true);
  });
  it('names the skipped tube and says already-submitted values are not missing', () => {
    const tabs: any[] = [
      { sampleId: 'a', barcode: '26379', status: 'received', tests: [t('1', 'entered')], values: {} },
      { sampleId: 'b', barcode: '26378', status: 'pending', tests: [t('2')], values: {} },
    ];
    const m = nothingToSubmitMessage(tabs);
    expect(m).toContain('already submitted');
    expect(m).toContain('26378 is not collected');
  });
  it('plain message when nothing was typed', () => {
    const tabs: any[] = [{ sampleId: 'a', barcode: '1', status: 'received', tests: [t('1')], values: {} }];
    expect(nothingToSubmitMessage(tabs)).toMatch(/^Enter at least one value/);
  });
});
