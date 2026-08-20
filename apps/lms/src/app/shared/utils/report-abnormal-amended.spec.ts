import { buildReportPdf } from './report-pdf';
import type { ResolvedReportLayout } from '../models/report-layout.model';

/**
 * Invariant #1 (report PDF), render-real-PDF-and-grep:
 *  - the reference column prints EVERY authored tier (one grep token each);
 *  - qualitative and numeric result VALUES print;
 *  - NO amended-report banner is ever drawn on the page — the owner's call
 *    (report-pdf.ts:564, 2026-08-16): the amendment trail lives in the data,
 *    never on the patient-facing document. So even an amended report with
 *    amendment metadata must not contain the word "AMENDED".
 *
 * These render the REAL pipeline (buildReportPdf) and read the content-stream
 * text back — Standard-14 fonts write literal latin1 text, same technique as
 * report-notes-rule.spec.ts / report-column-override.spec.ts.
 */

const layout = (testId: string, testName: string, dept: string): ResolvedReportLayout => ({
  testId, testName, departmentName: dept, columns: [], configured: true, sections: [],
} as unknown as ResolvedReportLayout);

const LAYOUTS: Record<string, ResolvedReportLayout> = {
  hiv: layout('hiv', 'HIV I & II', 'Serology'),
  chol: layout('chol', 'Total Cholesterol', 'Biochemistry'),
  tsh: layout('tsh', 'TSH', 'Biochemistry'),
};

function renderText(opts: { amended?: boolean } = {}): string {
  const snap: Record<string, unknown> = {
    patient: { displayName: 'Test Patient', age: 30, sex: 'M' },
    order: { id: 'o1', orderNumber: 'LAB-2608-000001', createdAt: '2026-08-08T00:00:00Z' },
    type: opts.amended ? 'amended' : 'final',
    tests: [
      {
        testId: 'hiv', name: 'HIV I & II', department: 'Serology', sampleType: 'Serum',
        result: { values: { 'HIV I & II': { value: 'ZREACTIVE', flag: 'A', range: 'ZNONREACTIVE' } } },
      },
      {
        testId: 'chol', name: 'Total Cholesterol', department: 'Biochemistry', sampleType: 'Serum',
        result: { values: { 'Total Cholesterol': { value: '250', flag: 'H', unit: 'mg/dL', range: 'ZDESIR <200; ZBORDER 200-239; ZHIGH >=240' } } },
      },
      {
        testId: 'tsh', name: 'TSH', department: 'Biochemistry', sampleType: 'Serum',
        result: { values: { 'TSH': { value: 'ZNORMALVAL', flag: 'N', unit: 'uIU/mL', range: '0.4-4.0' } } },
      },
    ],
  };
  if (opts.amended) {
    snap['amendment'] = { by: 'Dr X', reason: 'Reprocessed sample', at: '2026-08-09T00:00:00Z' };
  }
  const report: Record<string, unknown> = { id: 'r1', createdAt: '2026-08-08T00:00:00Z', data: JSON.stringify(snap) };
  if (opts.amended) {
    report['amendedBy'] = 'Dr X';
    report['amendmentReason'] = 'Reprocessed sample';
    report['amendedAt'] = '2026-08-09T00:00:00Z';
  }
  const doc = buildReportPdf({ report, resolvedLayouts: LAYOUTS, template: null } as never);
  return Buffer.from(doc.output('arraybuffer')).toString('latin1');
}

describe('report invariant #1 — tiers, values, no AMENDED banner', () => {
  it('never prints an AMENDED banner, even for an amended report (owner decision, report-pdf.ts:564)', () => {
    expect(renderText({ amended: true })).not.toContain('AMENDED');
  });

  it('the plain final report likewise carries no AMENDED banner', () => {
    expect(renderText()).not.toContain('AMENDED');
  });

  it('prints the reference column with every authored tier', () => {
    const txt = renderText();
    expect(txt).toContain('ZDESIR');
    expect(txt).toContain('ZBORDER');
    expect(txt).toContain('ZHIGH');
  });

  it('prints qualitative and numeric result values', () => {
    const txt = renderText();
    expect(txt).toContain('ZREACTIVE');   // qualitative abnormal ('A')
    expect(txt).toContain('250');          // numeric high ('H')
    expect(txt).toContain('ZNORMALVAL');   // normal ('N')
  });
});
