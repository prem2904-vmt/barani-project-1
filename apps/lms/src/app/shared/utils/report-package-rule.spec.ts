import { buildReportPdf } from './report-pdf';

/**
 * A package's name NEVER appears on a report.
 *
 * A package is billing vocabulary — the frontdesk sells it, the invoice
 * itemises it. The report speaks in what was actually tested: a package's
 * direct members print as individual tests, and members that came through a
 * profile compile under the PROFILE's name. Profiles ordered directly are
 * untouched, and legacy snapshots (written before packageType existed) keep
 * the old group-by-bundle behaviour rather than degrading.
 *
 * Renders real PDFs and reads the text back (uppercased — panel headers are
 * drawn in caps), covering all four snapshot shapes at once.
 */
type Over = Record<string, unknown>;
const T = (name: string, over: Over) => ({
  testId: 'x', name, department: 'Biochemistry', sampleType: 'Serum',
  result: { values: { [name]: { value: '1', unit: 'u', range: '0-2' } } },
  ...over,
});

function renderText(tests: unknown[]): string {
  const snap = {
    patient: { displayName: 'P', age: 30, sex: 'M' },
    order: { id: 'o', orderNumber: 'LAB-9', createdAt: '2026-08-09T00:00:00Z' },
    type: 'final', tests,
  };
  const doc = buildReportPdf({
    report: { id: 'r', createdAt: '2026-08-09T00:00:00Z', data: JSON.stringify(snap) },
    resolvedLayouts: {}, template: null,
  } as never);
  return Buffer.from(doc.output('arraybuffer')).toString('latin1').toUpperCase();
}

describe('report never shows a package name', () => {
  it("lists a typed package's direct members as individual tests", () => {
    const s = renderText([
      T('Bilirubin total', { testId: 'a', packageTestId: 'sp1', packageName: 'ZPKG', packageType: 'package' }),
      T('Albumin', { testId: 'b', packageTestId: 'sp1', packageName: 'ZPKG', packageType: 'package' }),
    ]);
    expect(s).not.toContain('ZPKG');
    expect(s).toContain('BILIRUBIN TOTAL');
    expect(s).toContain('ALBUMIN');
  });

  it("compiles a package's profile members under the PROFILE's name", () => {
    const s = renderText([
      T('ALT', { testId: 'a', packageTestId: 'sp1', packageName: 'ZPKG', packageType: 'package', profileTestId: 'lft', profileName: 'Liver Function Test' }),
      T('AST', { testId: 'b', packageTestId: 'sp1', packageName: 'ZPKG', packageType: 'package', profileTestId: 'lft', profileName: 'Liver Function Test' }),
    ]);
    expect(s).toContain('LIVER FUNCTION TEST');
    expect(s).not.toContain('ZPKG');
  });

  it('leaves directly-ordered profiles exactly as before', () => {
    const s = renderText([
      T('Hb', { testId: 'a', packageTestId: 'cbc', packageName: 'Complete Blood Count', packageType: 'profile', profileTestId: 'cbc', profileName: 'Complete Blood Count' }),
      T('RBC', { testId: 'b', packageTestId: 'cbc', packageName: 'Complete Blood Count', packageType: 'profile', profileTestId: 'cbc', profileName: 'Complete Blood Count' }),
    ]);
    expect(s).toContain('COMPLETE BLOOD COUNT');
  });

  it('keeps legacy snapshots (no packageType) on the old grouping', () => {
    // Old snapshots cannot distinguish profile from package; degrading them to
    // ungrouped rows would rewrite existing reports' appearance.
    const s = renderText([
      T('Hb', { testId: 'a', packageTestId: 'cbc', packageName: 'Complete Blood Count' }),
      T('RBC', { testId: 'b', packageTestId: 'cbc', packageName: 'Complete Blood Count' }),
    ]);
    expect(s).toContain('COMPLETE BLOOD COUNT');
  });
});
