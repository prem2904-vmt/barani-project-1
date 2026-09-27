import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The closing line of the patient report (owner, 2026-09-28): only the
 * "****End of Report****" marker prints — no "Thanks for Reference" text.
 */
const src = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/shared/utils/report-pdf.ts'), 'utf8');
const endOfReport = src.slice(src.indexOf('function drawEndOfReport'), src.indexOf('return y;', src.indexOf('function drawEndOfReport')));

describe('report PDF — end-of-report line', () => {
  it('never prints "Thanks for Reference"', () => {
    expect(src).not.toMatch(/doc\.text\(\s*['"`]Thanks for Reference/);
  });

  it('still prints the end-of-report marker (preliminary wording kept)', () => {
    expect(endOfReport).toContain('theme.endOfReportText');
    expect(endOfReport).toContain('End of Preliminary Report');
    expect(endOfReport).toMatch(/doc\.text\(marker/);
  });
});
