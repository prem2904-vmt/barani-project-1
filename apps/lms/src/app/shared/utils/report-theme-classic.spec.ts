import { buildReportPdf } from './report-pdf';
import { hash, silenceJsdomCanvas } from './report-header-legacy.spec-helpers';
import { classicBodyMatrix, richInput, stripVolatile } from './report-theme.spec-helpers';
import { CLASSIC_BODY_GOLDEN } from './report-theme-classic.golden';

/**
 * THE CLASSIC THEME PRINTS EXACTLY AS BEFORE (report themes, 2026-09-30).
 *
 * Every text draw in report-pdf.ts now reads its font / size / weight from the
 * report-theme token table. A template that never picked a theme (or picked
 * Classic) must produce a byte-identical PDF. The golden hashes were captured
 * from the renderer BEFORE the token table existed, over a rich multi-
 * department body (profile + abnormal, compact tests, CBC with a bold
 * override, multi-band ranges, description + Sentence rows, culture + AST,
 * narrative test, abnormal summary, department signatories, disclaimer /
 * footer) × every patient-block layout × flag styles × font families/scales
 * × header presets. The header matrix lives in report-header-legacy.spec.ts.
 *
 * Regenerate ONLY for an intentional Classic change: PF_PRINT_GOLDEN=1.
 */
describe('report theme — Classic body prints exactly as before', () => {
  silenceJsdomCanvas();
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T05:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  const MATRIX = classicBodyMatrix();

  it('the matrix and the golden list the same renders', () => {
    expect(MATRIX.map(([n]) => n).sort()).toEqual(Object.keys(CLASSIC_BODY_GOLDEN).sort());
  });

  it.each(MATRIX.map(([n]) => n))('%s matches its golden hash', name => {
    const patch = MATRIX.find(([n]) => n === name)![1];
    const pdf = stripVolatile(Buffer.from(buildReportPdf(richInput(patch)).output('arraybuffer')).toString('latin1'));
    const got = hash(pdf);
    if ((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.['PF_PRINT_GOLDEN']) {
      console.log(`CLASSIC_BODY_GOLDEN ${JSON.stringify(name)}: ${JSON.stringify(got)},`);
    }
    expect(got).toBe(CLASSIC_BODY_GOLDEN[name]);
  });
});
