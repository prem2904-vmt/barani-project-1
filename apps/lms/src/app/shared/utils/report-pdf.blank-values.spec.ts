import { buildReportPdf, dropValuelessGroups, isBlankReportValue } from './report-pdf';
import type { ResolvedReportLayout } from '../models/report-layout.model';

/**
 * Owner 2026-10-03: "if no value, don't show it in the report". A value-less
 * parameter row is omitted; a test whose values are ALL empty prints nothing
 * (no band); a department left with nothing disappears. Renders the REAL
 * pipeline and reads the content stream back (same harness as the ≥/≤ spec).
 */
type V = { value: unknown; flag?: string };
function render(tests: Array<{ testId: string; name: string; department: string; values: Record<string, V> }>): string[] {
  const snap = {
    patient: { displayName: 'Test Patient', age: 40, sex: 'M' },
    order: { id: 'o1', orderNumber: 'LAB-2610-000009', createdAt: '2026-10-03T00:00:00Z' },
    type: 'final',
    tests: tests.map(t => ({ testId: t.testId, name: t.name, department: t.department, sampleType: 'Urine',
      result: { values: t.values } })),
  };
  const layouts: Record<string, ResolvedReportLayout> = {};
  for (const t of tests)
    layouts[t.testId] = { testId: t.testId, testName: t.name, departmentName: t.department, columns: [],
      configured: true, sections: [] } as unknown as ResolvedReportLayout;
  const doc = buildReportPdf({ report: { id: 'r1', createdAt: '2026-10-03T00:00:00Z', data: JSON.stringify(snap) },
    resolvedLayouts: layouts, template: null } as never);
  const pdf = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  return [...pdf.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)].map(m => m[1]);
}
const has = (runs: string[], text: string) => runs.some(r => r.toLowerCase().includes(text.toLowerCase()));

describe('report PDF — no value, no row', () => {
  it('an empty parameter of a submitted multi-value test is omitted; filled ones print', () => {
    const runs = render([{ testId: 'ur', name: 'Urine Routine', department: 'Clinical Pathology', values: {
      'Urine Colour': { value: 'Pale yellow' }, 'Urine Odour': { value: '' }, 'Urine pH': { value: '6.0' },
    } }]);
    expect(has(runs, 'Pale yellow')).toBe(true);
    expect(has(runs, '6.0')).toBe(true);
    expect(has(runs, 'Urine Odour')).toBe(false);
  });

  it('a test with every value empty prints no band, and its department disappears', () => {
    const runs = render([
      { testId: 'glu', name: 'Glucose Fasting', department: 'Biochemistry', values: { 'Glucose Fasting': { value: '92' } } },
      { testId: 'bil', name: 'Urine Bilirubin', department: 'Clinical Pathology', values: { 'Urine Bilirubin': { value: '' } } },
    ]);
    expect(has(runs, '92')).toBe(true);
    expect(has(runs, 'Urine Bilirubin')).toBe(false);
    expect(has(runs, 'Clinical Pathology')).toBe(false);
  });

  it('isBlankReportValue: blank, dash, empty pick list', () => {
    for (const v of [undefined, null, '', '   ', '—', '-', [], ['', ' ']]) expect(isBlankReportValue(v)).toBe(true);
    for (const v of ['0', 0, 'Negative', ['Few']]) expect(isBlankReportValue(v)).toBe(false);
  });

  it('dropValuelessGroups keeps preview blocks and blocks with any value', () => {
    const groups = [
      { fromResults: true, rows: [{ kind: 'note' }] },          // values all empty → dropped
      { fromResults: true, rows: [{ kind: 'param' }] },         // kept
      { fromResults: false, rows: [] as { kind?: string }[] },  // editor preview → kept
    ];
    expect(dropValuelessGroups(groups).length).toBe(2);
  });
});
