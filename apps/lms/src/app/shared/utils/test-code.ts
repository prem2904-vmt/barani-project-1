/**
 * Test codes — the 9-series (owner FINAL, 2026-09-24).
 *
 * Nobody types or edits a test code: not a lab, not the Admin Test Master.
 * The server assigns the department's next number when a test or profile is
 * created (packages have no code) and the code never changes afterwards —
 * a change is refused with `code_readonly`, a code sent on create is ignored.
 *
 * Shape: the department's 3-letter prefix + number, no separator
 * (`BIO019`, `HEM1000`). Admin Test Master: 001–899, then 1000–8999.
 * A lab's own tests: 900–999, then 9000–9999.
 *
 * Pure helpers, no Angular: the admin console keeps a byte-identical copy.
 */

/** Shown in the read-only code field before the first save. */
export const CODE_AUTO_TEXT = 'Assigned automatically';

/** Helper line under the read-only code field. */
export const CODE_READONLY_HINT =
  'Assigned from the department when the test is created. Codes never change.';

/** The server's refusal of a code change. */
export const CODE_READONLY_ERROR = 'code_readonly';

/** The server's refusal of a coded create without a department. */
export const DEPARTMENT_REQUIRED_ERROR = 'department_required';

/** The department has used every number of its range. */
export const CODE_RANGE_EXHAUSTED_ERROR = 'code_range_exhausted';

/** What the code field shows: the code, or the "assigned automatically"
 *  text for a test that has not been saved yet. */
export function codeDisplay(code: string | null | undefined, saved: boolean): string {
  const c = (code ?? '').trim();
  if (c) return c;
  return saved ? '—' : CODE_AUTO_TEXT;
}

/** (prefix, number) of a 3-letters + digits code; null otherwise. */
export function parseTestCode(code: string | null | undefined): { prefix: string; n: number } | null {
  const m = /^([A-Z]{3})([0-9]{3,6})$/.exec((code ?? '').trim().toUpperCase());
  return m ? { prefix: m[1], n: Number(m[2]) } : null;
}

/** Natural order: prefix, then number (BIO002 < BIO010 < BIO901 < BIO1000);
 *  codes of any other shape after, alphabetically; blanks last. */
export function compareTestCodes(a: string | null | undefined, b: string | null | undefined): number {
  const pa = parseTestCode(a);
  const pb = parseTestCode(b);
  if (pa && pb) return pa.prefix === pb.prefix ? pa.n - pb.n : (pa.prefix < pb.prefix ? -1 : 1);
  if (pa || pb) return pa ? -1 : 1;
  const sa = (a ?? '').trim().toLowerCase();
  const sb = (b ?? '').trim().toLowerCase();
  if (!sa || !sb) return sa ? -1 : sb ? 1 : 0;
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}
