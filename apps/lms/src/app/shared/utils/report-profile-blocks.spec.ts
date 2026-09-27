import { buildReportPdf } from './report-pdf';
import type { ResolvedReportLayout } from '../models/report-layout.model';

/**
 * A PROFILE's own printed blocks on the REAL report (owner bug 2026-09-27,
 * Diabetes Profile): the print-order Sentence and the members' Description
 * cells must reach the PDF — the same buildReportPdf the live preview uses.
 * Renders real PDFs and reads the text back (Standard-14 fonts write literal
 * text into the content stream).
 */
const col = (name: string, label: string, type: string, order: number) =>
  ({ id: 'c-' + name, name, label, order, width: 25, type, locked: false });
const WITH_DESC = [col('result', 'Result', 'result', 2), col('unit', 'Unit', 'unit', 3),
  col('range', 'Reference range', 'range', 4), col('description', 'Description', 'text', 5)];
const NO_DESC = [col('result', 'Result', 'result', 2), col('unit', 'Unit', 'unit', 3),
  col('range', 'Reference range', 'range', 4), col('methodology', 'Methodology', 'method', 5)];

const member = (id: string, name: string, cols: unknown[], desc: string): ResolvedReportLayout => ({
  testId: id, testName: name, departmentName: 'Biochemistry', columns: cols,
  sections: [{ id: 'g', type: 'grid', order: 1, isVisible: true, rows: [
    { id: 'r', parameterName: id, title: name, isMerged: false,
      cells: { result: '132', unit: 'mg/dL', range: '70-110', description: desc } },
  ] }],
} as unknown as ResolvedReportLayout);

const SENTENCE = 'Kindly correlate the glucose values with HbA1c and the clinical history';

function render(cols: unknown[], profileSections: unknown[]): string {
  const layouts: Record<string, ResolvedReportLayout> = {
    fbs: member('fbs', 'Fasting Blood Sugar', cols, 'Raised in diabetes'),
    ppbs: member('ppbs', 'Postprandial Blood Sugar', cols, ''),
    dia: { testId: 'dia', testName: 'Diabetes Profile', departmentName: 'Biochemistry', columns: cols,
      sections: profileSections } as unknown as ResolvedReportLayout,
  };
  const snap = {
    patient: { displayName: 'Test Patient', age: 45, sex: 'Female' },
    order: { id: 'o1', orderNumber: 'LAB-2609-000001', createdAt: '2026-09-27T00:00:00Z' },
    type: 'final',
    tests: ['fbs', 'ppbs'].map(id => ({
      testId: id, name: layouts[id].testName, department: 'Biochemistry',
      packageTestId: 'dia', profileTestId: 'dia', packageType: 'profile',
      packageName: 'Diabetes Profile', profileName: 'Diabetes Profile',
      result: { values: { [id]: { value: '132', unit: 'mg/dL', range: '70-110' } } },
    })),
  };
  const doc = buildReportPdf({
    report: { id: 'r1', createdAt: '2026-09-27T00:00:00Z', data: JSON.stringify(snap) },
    resolvedLayouts: layouts,
    template: null,
  } as never);
  return Buffer.from(doc.output('arraybuffer')).toString('latin1');
}

const sentence = { id: 'p', type: 'paragraph', order: 2, isVisible: true, content: SENTENCE };

describe("a profile's printed blocks on the real report", () => {
  it("prints the profile's Sentence after its members' results", () => {
    const text = render(WITH_DESC, [sentence]);
    expect(text).toContain('Kindly correlate');
    expect(text).toContain('Fasting Blood Sugar');
  });

  it('a blank Sentence prints nothing (no lone profile heading)', () => {
    const count = (t: string) => t.split('DIABETES PROFILE').length;
    const blank = render(WITH_DESC, [{ ...sentence, content: '   ' }]);
    expect(blank).not.toContain('Kindly correlate');
    // The Sentence's block adds one profile heading; a blank one adds none.
    expect(count(blank)).toBe(count(render(WITH_DESC, [sentence])) - 1);
  });

  it("prints a member's description in the Description column of the profile block", () => {
    const text = render(WITH_DESC, [sentence]);
    expect(text).toContain('Description');
    expect(text).toContain('Raised in diabetes');
  });

  it('no Description column in the table → the description cannot print (the editor warns)', () => {
    const text = render(NO_DESC, [sentence]);
    expect(text).not.toContain('Raised in diabetes');
  });
});
