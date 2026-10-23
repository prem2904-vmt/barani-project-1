import { buildReportPdf, familyChildRows, isBlankReportValue } from './report-pdf';
import { familyReportLines } from './option-family';
import type { ResolvedReportLayout } from '../models/report-layout.model';

/**
 * Family values on the report (owner 2026-10-23): the parameter's row prints
 * the ROOT answer, then one row per picked item with its amount, the name
 * indented; deeper levels indent further; "Absent" prints just the one row.
 * Renders the REAL pipeline and reads the PDF content stream back (same
 * harness as report-pdf.blank-values.spec.ts).
 */
const PRESENT = { family: 'FAM-CASTS', v: 'PRS', label: 'Present', items: [
  { v: 'HYA', label: 'Hyaline', qty: '2-3', unit: '/LPF' },
  { v: 'GRA', label: 'Granular', qty: 'Few', items: [{ v: 'FIN', label: 'Fine texture' }] },
] };
const ABSENT = { family: 'FAM-CASTS', v: 'ABS', label: 'Absent' };

type Run = { x: number; y: number; text: string };
function render(values: Record<string, unknown>, layout?: Partial<ResolvedReportLayout>): Run[] {
  const snap = {
    patient: { displayName: 'Test Patient', age: 40, sex: 'M' },
    order: { id: 'o1', orderNumber: 'LAB-2610-000009', createdAt: '2026-10-03T00:00:00Z' },
    type: 'final',
    tests: [{ testId: 'um', name: 'Urine Microscopy', department: 'Clinical Pathology', sampleType: 'Urine', result: { values } }],
  };
  const layouts: Record<string, ResolvedReportLayout> = {
    um: { testId: 'um', testName: 'Urine Microscopy', departmentName: 'Clinical Pathology', columns: [],
      configured: true, sections: [], ...(layout ?? {}) } as unknown as ResolvedReportLayout,
  };
  const doc = buildReportPdf({ report: { id: 'r1', createdAt: '2026-10-03T00:00:00Z', data: JSON.stringify(snap) },
    resolvedLayouts: layouts, template: null } as never);
  const pdf = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  return [...pdf.matchAll(/([\d.]+) ([\d.]+) Td\s*\(((?:[^()\\]|\\.)*)\)\s*Tj/g)]
    .map(m => ({ x: Number(m[1]), y: Number(m[2]), text: m[3] }));
}
const find = (runs: Run[], text: string) => runs.find(r => r.text.includes(text));

describe('report PDF — family values print one line per item', () => {
  it('legacy values table: parent row = root answer, items indented below with their amounts', () => {
    const runs = render({ Casts: { value: PRESENT, flag: 'A' } });
    const parent = find(runs, 'Casts')!, root = find(runs, 'Present')!;
    const hya = find(runs, 'Hyaline')!, gra = find(runs, 'Granular')!, fine = find(runs, 'Fine texture')!;
    for (const r of [parent, root, hya, gra, fine]) expect(r).toBeTruthy();
    expect(find(runs, '2-3 /LPF')).toBeTruthy();
    expect(find(runs, 'Few')).toBeTruthy();
    // Children are indented under the parameter name; deeper indents further.
    expect(hya.x).toBeGreaterThan(parent.x);
    expect(fine.x).toBeGreaterThan(hya.x);
    // …and print in order, below the parent (PDF y grows upwards).
    expect(parent.y).toBeGreaterThan(hya.y);
    expect(hya.y).toBeGreaterThan(gra.y);
    // Never the one-line summary nor a raw object.
    expect(runs.some(r => r.text.includes('[object Object]') || r.text.includes('"family"'))).toBe(false);
  });

  it('a raw (unwrapped) stored value prints the same way', () => {
    const runs = render({ Casts: PRESENT });
    expect(find(runs, 'Present')).toBeTruthy();
    expect(find(runs, 'Hyaline')).toBeTruthy();
  });

  it('Absent prints just the one row', () => {
    const runs = render({ Casts: { value: ABSENT }, 'Urine pH': { value: '6.0' } });
    expect(find(runs, 'Absent')).toBeTruthy();
    expect(find(runs, 'Hyaline')).toBeFalsy();
  });

  it('a resolved results grid expands the family from the snapshot, whatever the cell holds', () => {
    const cols = [
      { id: 'n', name: 'name', label: 'Investigation', order: 0, width: 40, type: 'name', locked: false },
      { id: 'r', name: 'result', label: 'Result', order: 1, width: 30, type: 'result', locked: false },
      { id: 'u', name: 'unit', label: 'Unit', order: 2, width: 15, type: 'unit', locked: false },
      { id: 'g', name: 'range', label: 'Reference', order: 3, width: 15, type: 'range', locked: false },
    ];
    for (const cell of ['Present', JSON.stringify(PRESENT), JSON.stringify({ value: PRESENT, flag: 'A' })]) {
      const runs = render({ Casts: { value: PRESENT, flag: 'A' } }, {
        columns: cols as never,
        sections: [{ id: 's', type: 'grid', isVisible: true, rows: [
          { id: 'r1', parameterName: 'Casts', title: 'Casts', cells: { result: cell }, isMerged: false, isBold: false },
        ] }] as never,
      });
      const parent = find(runs, 'Casts')!, hya = find(runs, 'Hyaline')!;
      expect(find(runs, 'Present')).toBeTruthy();
      expect(hya.x).toBeGreaterThan(parent.x);
      expect(find(runs, 'Fine texture')).toBeTruthy();
      expect(runs.some(r => r.text.includes('{'))).toBe(false);
    }
  });

  it('isBlankReportValue: a family is blank only without a root answer', () => {
    expect(isBlankReportValue({ family: 'F', v: '', label: '' })).toBe(true);
    expect(isBlankReportValue(ABSENT)).toBe(false);
  });

  it('familyChildRows: one plain row per item, depth = indent', () => {
    const rows = familyChildRows(familyReportLines(PRESENT), 'Casts');
    expect(rows.map(r => [r.name, r.result, r.indent, r.rowKey])).toEqual([
      ['Hyaline', '2-3 /LPF', 1, 'Casts'], ['Granular', 'Few', 1, 'Casts'], ['Fine texture', '', 2, 'Casts'],
    ]);
    expect(rows.every(r => r.flag === '' && r.abnormal === false && r.range === '')).toBe(true);
  });
});
