import { buildReportPdf, departmentSampleIds } from './report-pdf';

/**
 * QA 2026-09-24: a profile whose members need different tubes (EDTA +
 * fluoride + serum → three sample IDs) printed only its FIRST member's sample
 * ID on the department band — the compiled profile block copied one member's
 * sampleId. The band must list every tube behind the section, and the
 * profile's members must print in the order the snapshot lists them (the
 * server emits them in the profile's authored order).
 */
type Over = Record<string, unknown>;
const T = (name: string, over: Over) => ({
  testId: name, name, department: 'Biochemistry', sampleType: 'Serum',
  result: { values: { [name]: { value: '1', unit: 'u', range: '0-2' } } },
  ...over,
});
const member = (name: string, sampleId: string) => T(name, {
  sampleId, packageTestId: 'p1', packageName: 'ZPROFILE', packageType: 'profile',
  profileTestId: 'p1', profileName: 'ZPROFILE',
});

function renderText(tests: unknown[]): string {
  const snap = {
    patient: { displayName: 'P', age: 30, sex: 'M' },
    order: { id: 'o', orderNumber: 'LAB-9', createdAt: '2026-09-24T00:00:00Z' },
    type: 'final', tests,
  };
  const doc = buildReportPdf({
    report: { id: 'r', createdAt: '2026-09-24T00:00:00Z', data: JSON.stringify(snap) },
    resolvedLayouts: {}, template: null,
  } as never);
  return Buffer.from(doc.output('arraybuffer')).toString('latin1').toUpperCase();
}

describe('report department band — every sample ID of a multi-tube profile', () => {
  it('prints all three tubes of one profile on its department band', () => {
    const s = renderText([
      member('ZALPHA', 'S123'),
      member('ZBETA', 'S124'),
      member('ZGAMMA', 'S125'),
      // A second department so the band (and its Sample ID line) renders.
      T('ZHB', { department: 'Haematology', sampleId: 'S200' }),
    ]);
    expect(s).toContain('SAMPLE ID: S123, S124, S125');
    expect(s).toContain('SAMPLE ID: S200');
  });

  it('lists the members in the snapshot (profile) order', () => {
    const s = renderText([
      member('ZGAMMA', 'S125'),
      member('ZALPHA', 'S123'),
      member('ZBETA', 'S124'),
      T('ZHB', { department: 'Haematology', sampleId: 'S200' }),
    ]);
    const at = (n: string) => s.indexOf(n);
    expect(at('ZGAMMA')).toBeGreaterThan(-1);
    expect(at('ZGAMMA')).toBeLessThan(at('ZALPHA'));
    expect(at('ZALPHA')).toBeLessThan(at('ZBETA'));
    expect(s).toContain('SAMPLE ID: S125, S123, S124');
  });
});

describe('departmentSampleIds', () => {
  it('merges a profile block’s tubes with standalone groups, distinct, first-seen order', () => {
    expect(departmentSampleIds([
      { sampleId: 'S1', sampleIds: ['S1', 'S2'] },
      { sampleId: 'S2' },
      { sampleId: 'S3' },
      {},
    ])).toEqual(['S1', 'S2', 'S3']);
  });

  it('falls back to the single sampleId when a group carries no list', () => {
    expect(departmentSampleIds([{ sampleId: ' S9 ' }, { sampleIds: [] }])).toEqual(['S9']);
  });
});
