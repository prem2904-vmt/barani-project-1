import { buildReportPdf } from './report-pdf';

/**
 * OPS-56 — the overall OBSERVATION a technician writes at result entry
 * (an "observation" comment, ParameterName null) must appear ON the report.
 * The mw snapshot now emits it as `tests[].observations`; the PDF renderer
 * prints each as an italic "Note:" line under the test's rows.
 *
 * These render real PDFs and read the text back, covering both the standalone
 * path and the profile-member path (member observations surface under the
 * profile block, not dropped like the member's own narrative notes).
 */
function renderText(snap: unknown): string {
  const doc = buildReportPdf({
    report: { id: 'r1', createdAt: '2026-08-08T00:00:00Z', data: JSON.stringify(snap) },
    resolvedLayouts: {},
    template: null,
  } as never);
  return Buffer.from(doc.output('arraybuffer')).toString('latin1');
}

const base = {
  patient: { displayName: 'Test Patient', age: 30, sex: 'M' },
  order: { id: 'o1', orderNumber: 'LAB-2608-000001', createdAt: '2026-08-08T00:00:00Z' },
  type: 'final',
};

describe('report renders tech observations (OPS-56)', () => {
  it('prints a standalone test observation as a Note line', () => {
    const text = renderText({
      ...base,
      tests: [{
        testId: 'm1', name: 'Haemoglobin', department: 'Haematology',
        result: { values: { Haemoglobin: { value: '11.4', unit: 'g/dL', range: '13-17' } } },
        observations: ['OBSERVEDSAMPLEHAEMOLYSED'],
      }],
    });
    expect(text).toContain('OBSERVEDSAMPLEHAEMOLYSED');
    expect(text).toContain('Note:');
  });

  it('surfaces a profile member observation under the profile block', () => {
    const text = renderText({
      ...base,
      tests: [{
        testId: 'chol', packageTestId: 'lipid', packageType: 'profile',
        packageName: 'Lipid Profile', profileTestId: 'lipid', profileName: 'Lipid Profile',
        name: 'Total Cholesterol', department: 'Biochemistry',
        result: { values: { 'Total Cholesterol': { value: '210', unit: 'mg/dL', range: '<200' } } },
        observations: ['PROFILEMEMBEROBSERVATION'],
      }],
    });
    expect(text).toContain('PROFILEMEMBEROBSERVATION');
  });

  it('prints no Note line when a test has no observations', () => {
    const text = renderText({
      ...base,
      tests: [{
        testId: 'm1', name: 'Haemoglobin', department: 'Haematology',
        result: { values: { Haemoglobin: { value: '11.4', unit: 'g/dL', range: '13-17' } } },
      }],
    });
    expect(text).not.toContain('Note:');
  });
});
