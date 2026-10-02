import type { ReportPdfInput } from './report-pdf';
import type { ResolvedReportLayout } from '../models/report-layout.model';
import { applyLivePageLayout, plausibleValue, sampleAnalyzerImages, sampleValuesFor } from './report-sample-preview';
import { readPageLayout } from './report-profile-layout';

describe('report-sample-preview — the ONE sample report (designer + Live preview)', () => {
  it('a plausible value is the midpoint of the range that fits the sample patient (adult female)', () => {
    const v = plausibleValue({ name: 'TLC', referenceRanges: [
      { min: 9, max: 30, minAge: 0, maxAge: 0.08 },
      { min: 4.2, max: 9.8, sex: 'M', minAge: 18 },
      { min: 4.0, max: 10.4, sex: 'F', minAge: 18 },
    ] });
    expect(v).toBe('7.20');
  });
  it('no range → "1.0" (the row still prints with its unit and name)', () => {
    expect(plausibleValue({ name: 'X' })).toBe('1.0');
  });
  it('sampleValuesFor reads the wrapper or bare-array Parameters JSON', () => {
    expect(sampleValuesFor(JSON.stringify({ parameters: [{ name: 'Hb', referenceRanges: [{ min: 12, max: 16 }] }] }))).toEqual({ Hb: '14.0' });
    expect(sampleValuesFor(JSON.stringify([{ name: 'PLT', referenceRanges: [{ min: 150, max: 410 }] }]))).toEqual({ PLT: '280' });
    expect(sampleValuesFor(null, ['A'])).toEqual({ A: '1.0' });
  });
  it('sample analyzer graphs resolve to absolute asset URLs, only for analyzer boxes', () => {
    const imgs = sampleAnalyzerImages([
      { id: 't', kind: 'table', x: 0, y: 0, w: 10, h: 10 },
      { id: 'a', kind: 'analyzer', ref: '12053', x: 0, y: 0, w: 10, h: 10 },
    ], 'http://lab.test/app/');
    expect(imgs).toEqual({ '12053': 'http://lab.test/app/assets/analyzer-samples/m51-12053.png' });
  });
  it('applyLivePageLayout patches the target profile\'s page layout (adds one if absent) and attaches sample graphs to its first member', () => {
    const input = {
      report: { id: 'r', type: 'final', data: JSON.stringify({ tests: [
        { testId: 'm1', profileTestId: 'pkg' }, { testId: 'm2', profileTestId: 'pkg' },
      ] }) },
      resolvedLayouts: { pkg: { testId: 'pkg', testName: 'CBC', departmentName: 'H', columns: [], sections: [] } as unknown as ResolvedReportLayout },
      template: null,
    } as unknown as ReportPdfInput;
    const out = applyLivePageLayout(input, 'pkg', { enabled: true, boxes: [{ id: 'a', kind: 'analyzer', ref: '12003', x: 0, y: 0, w: 30, h: 30 }] }, 'http://x/');
    const pl = readPageLayout(out.resolvedLayouts!['pkg'].sections);
    expect(pl?.enabled).toBe(true);
    expect(pl?.boxes[0].ref).toBe('12003');
    const tests = JSON.parse(out.report.data!).tests;
    expect(tests[0].analyzerImages).toEqual({ '12003': 'http://x/assets/analyzer-samples/m51-12003.png' });
    expect(tests[1].analyzerImages).toBeNull();
    // The input itself is untouched (the designer re-applies on every drag).
    expect(readPageLayout(input.resolvedLayouts!['pkg'].sections)).toBeNull();
  });
});
