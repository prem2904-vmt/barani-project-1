import { buildReportPdf } from './report-pdf';
import type { ReportColumn, ResolvedReportLayout } from '../models/report-layout.model';

/**
 * Per-test / per-profile COLUMN overrides — the render cascade.
 *
 * Rules under test (owner decisions):
 *  - No override anywhere → the department flatten renders exactly as before
 *    (single table, standard headers).
 *  - A test's own override applies when it is ordered STANDALONE — its group
 *    gets its own table run while neighbours keep the department columns.
 *  - A PROFILE's override wins for its whole block.
 *  - A member's override never leaks into a profile block — the block falls
 *    back to the member's department columns, and the member's values for
 *    columns its override dropped still print (engine cell union +
 *    departmentColumns fallback).
 *
 * These render real PDFs and grep the latin1 text, same as
 * report-notes-rule.spec.ts, so they cover the actual autoTable output.
 */

const col = (name: string, label: string, type: string, order: number, width = 25): ReportColumn =>
  ({ id: `c-${name}-${order}`, name, label, order, width, type, locked: false } as ReportColumn);

/** The department set: Result · Unit · Reference range. */
const DEPT: ReportColumn[] = [
  col('result', 'Result', 'result', 1, 40),
  col('unit', 'Unit', 'unit', 2, 20),
  col('range', 'Reference range', 'range', 3, 40),
];

interface Param { name: string; value: string; range?: string; unit?: string }

const gridLayout = (
  testId: string,
  testName: string,
  params: Param[],
  opts?: { columns?: ReportColumn[]; hasColumnOverride?: boolean; departmentColumns?: ReportColumn[] | null },
): ResolvedReportLayout => ({
  testId,
  testName,
  departmentName: 'Biochemistry',
  columns: opts?.columns ?? DEPT,
  hasColumnOverride: opts?.hasColumnOverride,
  departmentColumns: opts?.departmentColumns ?? null,
  sections: [{
    id: 'g1', type: 'grid', order: 1, isVisible: true,
    rows: params.map(p => ({
      parameterName: p.name,
      isMerged: false,
      unit: p.unit ?? '',
      cells: { result: p.value, range: p.range ?? '', unit: p.unit ?? '' },
    })),
  }],
} as unknown as ResolvedReportLayout);

interface SnapTest {
  testId: string;
  name: string;
  packageTestId?: string | null;
  packageType?: string | null;
  profileName?: string | null;
  values: Record<string, { value: string; range?: string; unit?: string }>;
}

function renderText(tests: SnapTest[], layouts: Record<string, ResolvedReportLayout>): string {
  const snap = {
    patient: { displayName: 'Test Patient', age: 30, sex: 'M' },
    order: { id: 'o1', orderNumber: 'LAB-2608-000002', createdAt: '2026-08-16T00:00:00Z' },
    type: 'final',
    tests: tests.map(t => ({
      testId: t.testId,
      name: t.name,
      packageTestId: t.packageTestId ?? null,
      packageType: t.packageType ?? null,
      profileName: t.profileName ?? null,
      department: 'Biochemistry',
      sampleType: 'Serum',
      result: { values: t.values },
    })),
  };
  const doc = buildReportPdf({
    report: { id: 'r1', createdAt: '2026-08-16T00:00:00Z', data: JSON.stringify(snap) },
    resolvedLayouts: layouts,
    template: null,
  } as never);
  return Buffer.from(doc.output('arraybuffer')).toString('latin1');
}

describe('report column overrides', () => {
  const glucoseParams: Param[] = [{ name: 'Glucose', value: '92', range: '70-99', unit: 'mg/dL' }];
  const ureaParams: Param[] = [{ name: 'Urea', value: '28', range: '17-43', unit: 'mg/dL' }];

  it('no override: department flatten renders with standard headers, no sentinel', () => {
    const text = renderText(
      [
        { testId: 't1', name: 'Glucose', values: { Glucose: { value: '92', range: '70-99', unit: 'mg/dL' } } },
        { testId: 't2', name: 'Urea', values: { Urea: { value: '28', range: '17-43', unit: 'mg/dL' } } },
      ],
      {
        t1: gridLayout('t1', 'Glucose', glucoseParams),
        t2: gridLayout('t2', 'Urea', ureaParams),
      },
    );
    expect(text).toContain('Reference range');
    expect(text).not.toContain('OUTCOME');
  });

  it('standalone override: renamed header renders in its own run, sibling keeps dept columns', () => {
    const override = [col('result', 'OUTCOME', 'result', 1, 60), col('unit', 'Unit', 'unit', 2, 40)];
    const text = renderText(
      [
        { testId: 't1', name: 'Glucose', values: { Glucose: { value: '92', range: '70-99', unit: 'mg/dL' } } },
        { testId: 't2', name: 'Urea', values: { Urea: { value: '28', range: '17-43', unit: 'mg/dL' } } },
      ],
      {
        t1: gridLayout('t1', 'Glucose', glucoseParams,
          { columns: override, hasColumnOverride: true, departmentColumns: DEPT }),
        t2: gridLayout('t2', 'Urea', ureaParams),
      },
    );
    expect(text).toContain('OUTCOME');            // t1's run uses its own columns
    expect(text).toContain('Reference range');    // t2's run keeps the dept set
  });

  it("profile override wins for the whole block", () => {
    const profCols = [col('result', 'PROFILECOL', 'result', 1, 60), col('range', 'Reference range', 'range', 2, 40)];
    const text = renderText(
      [{
        testId: 'm1', name: 'Total Cholesterol',
        packageTestId: 'prof1', packageType: 'profile', profileName: 'Lipid Profile',
        values: { 'Total Cholesterol': { value: '210', range: '<200', unit: 'mg/dL' } },
      }],
      {
        m1: gridLayout('m1', 'Total Cholesterol',
          [{ name: 'Total Cholesterol', value: '210', range: '<200', unit: 'mg/dL' }]),
        prof1: gridLayout('prof1', 'Lipid Profile', [],
          { columns: profCols, hasColumnOverride: true, departmentColumns: DEPT }),
      },
    );
    expect(text).toContain('PROFILECOL');
  });

  it("member override never leaks into a profile block; its dropped-column values still print", () => {
    // Member's own override renames result AND drops the range column; the
    // profile has no override, so the block renders with the member's
    // DEPARTMENT columns — and the range value must still be there.
    const memberCols = [col('result', 'MEMBERCOL', 'result', 1, 100)];
    const text = renderText(
      [{
        testId: 'm1', name: 'Total Cholesterol',
        packageTestId: 'prof1', packageType: 'profile', profileName: 'Lipid Profile',
        values: { 'Total Cholesterol': { value: '210', range: 'RANGEVAL99', unit: 'mg/dL' } },
      }],
      {
        m1: gridLayout('m1', 'Total Cholesterol',
          [{ name: 'Total Cholesterol', value: '210', range: 'RANGEVAL99', unit: 'mg/dL' }],
          { columns: memberCols, hasColumnOverride: true, departmentColumns: DEPT }),
      },
    );
    expect(text).not.toContain('MEMBERCOL');
    expect(text).toContain('RANGEVAL99');
  });

  it('override run keeps a just-added column even when it has no data yet', () => {
    // The whole point of adding a 5th column on ONE test: it must print in
    // that test's own run. Before, the empty-column economy silently dropped
    // it and the override looked like a no-op.
    const override = [
      ...DEPT.map(c => ({ ...c, width: 20 })),
      col('description', 'DESCCOL', 'text', 4, 40),
    ];
    const text = renderText(
      [
        { testId: 't1', name: 'Glucose', values: { Glucose: { value: '92', range: '70-99', unit: 'mg/dL' } } },
        { testId: 't2', name: 'Urea', values: { Urea: { value: '28', range: '17-43', unit: 'mg/dL' } } },
      ],
      {
        t1: gridLayout('t1', 'Glucose', glucoseParams,
          { columns: override, hasColumnOverride: true, departmentColumns: DEPT }),
        t2: gridLayout('t2', 'Urea', ureaParams),
      },
    );
    expect(text).toContain('DESCCOL'); // empty column survives in the override run
  });

  it('a single-analyte test with an override stays compact — no heading band', () => {
    // Owner 2026-09-19: the override run's own column-header strip IS the
    // block's heading; a band would repeat the name the Investigation cell
    // already prints ("INSULIN" band + "Insulin" row).
    const override = [col('result', 'Result', 'result', 1, 60), col('unit', 'Unit', 'unit', 2, 40)];
    const text = renderText(
      [{ testId: 't1', name: 'Special Assay', values: { 'Special Assay': { value: '5', unit: 'U/L' } } }],
      {
        t1: gridLayout('t1', 'Special Assay',
          [{ name: 'Special Assay', value: '5', unit: 'U/L' }],
          { columns: override, hasColumnOverride: true, departmentColumns: DEPT }),
      },
    );
    expect(text).toContain('Special Assay');     // once, in the Investigation cell
    expect(text).not.toContain('SPECIAL ASSAY'); // no uppercase band above it
  });
});
