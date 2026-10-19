import { buildReportPdf } from './report-pdf';
import { ResolvedReportLayout } from '../models/report-layout.model';

/**
 * Department-specific patient strip (owner's model, 2026-09-19): a
 * department may carry its own patient-block arrangement on its resolved
 * layout (mw: department_report_columns.PatientJson → engine PatientStrip).
 * The renderer applies it ONLY when every test on the report resolves to
 * that single department — the strip prints once for the whole document,
 * so mixed-department reports keep the tenant default.
 */

function layoutFor(testId: string, dept: string,
                   patientStrip?: { layout?: string; columns?: string[][] } | null): ResolvedReportLayout {
  return { testId, testName: 'T ' + testId, departmentName: dept,
           columns: [], sections: [], ...(patientStrip !== undefined ? { patientStrip } : {}) } as ResolvedReportLayout;
}

function render(tests: Array<{ testId: string }>,
                resolvedLayouts: Record<string, ResolvedReportLayout>): string {
  const snap = {
    patient: { displayName: 'Anitha PATIENTNAME', age: 34, sex: 'F' },
    order: { id: 'o1', orderNumber: 'LAB-2609-000002', createdAt: '2026-09-19T00:00:00Z' },
    type: 'final',
    tests: tests.map(t => ({
      testId: t.testId, name: 'Test ' + t.testId, packageTestId: null, packageType: null,
      department: resolvedLayouts[t.testId]?.departmentName ?? 'Unknown',
      sampleType: 'Serum',
      result: { values: {} },
    })),
  };
  const doc = buildReportPdf({
    report: { id: 'r1', createdAt: '2026-09-19T00:00:00Z', data: JSON.stringify(snap) },
    resolvedLayouts,
    template: null,
  } as never);
  return Buffer.from(doc.output('arraybuffer')).toString('latin1');
}

const MICRO_STRIP = { layout: 'three-col', columns: [['name', 'sex'], [], []] }; // no age

describe('department-specific patient strip', () => {
  it('single-department report prints that department\'s arrangement', () => {
    const text = render([{ testId: 't1' }], { t1: layoutFor('t1', 'Microbiology', MICRO_STRIP) });
    expect(text).toContain('Sex :');
    expect(text).not.toContain('Age :');       // dept strip dropped the age row
  });

  it('mixed-department report keeps the tenant default strip', () => {
    const text = render([{ testId: 't1' }, { testId: 't2' }], {
      t1: layoutFor('t1', 'Microbiology', MICRO_STRIP),
      t2: layoutFor('t2', 'Biochemistry'),
    });
    expect(text).toContain('Age :');           // default three-col path
  });

  it('a test with no resolved layout blocks the override (unknown department)', () => {
    const text = render([{ testId: 't1' }, { testId: 't2' }], {
      t1: layoutFor('t1', 'Microbiology', MICRO_STRIP),
    });
    expect(text).toContain('Age :');
  });

  it('same department without a strip keeps the default', () => {
    const text = render([{ testId: 't1' }], { t1: layoutFor('t1', 'Microbiology') });
    expect(text).toContain('Age :');
  });

  it('an all-empty strip arrangement is ignored', () => {
    const text = render([{ testId: 't1' }],
      { t1: layoutFor('t1', 'Microbiology', { layout: 'three-col', columns: [[], []] }) });
    expect(text).toContain('Age :');
  });
});
