/** "Insert results": the one place that builds the results-workbook request and words its notices. */
export interface ResultsRange { testIds: string[]; from: string; to: string; branchId?: string | null }

export const TRUNCATED_NOTICE = 'Only the first 5,000 rows were included. Narrow the dates to get the rest.';
export const BROKEN_RESULTS_MESSAGE = "The results file we got back isn't a spreadsheet, so nothing was opened. Try again, and tell us if it keeps happening.";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Why the form can't be sent yet (plain words), or null when it can. */
export function resultsProblem(r: ResultsRange): string | null {
  if (!r.testIds.length) return 'Pick at least one test.';
  if (!ISO.test(r.from) || !ISO.test(r.to)) return 'Pick the first and last date.';
  if (r.from > r.to) return 'The first date is after the last date.';
  return null;
}

/** `/api/office/results-workbook?testIds=a,b&from=…&to=…[&branchId=…]` (ids sorted + de-duplicated, so the same pick is the same URL). */
export function resultsWorkbookPath(r: ResultsRange): string {
  const ids = [...new Set(r.testIds.map(i => i.trim()).filter(Boolean))].sort();
  const q = [`testIds=${ids.map(encodeURIComponent).join(',')}`, `from=${r.from}`, `to=${r.to}`];
  if (r.branchId) q.push(`branchId=${encodeURIComponent(r.branchId)}`);
  return `/api/office/results-workbook?${q.join('&')}`;
}

/** A name for the new sheet: the server's filename, else "Results <from> to <to>.xlsx". */
export function resultsFileName(headerName: string | null, r: Pick<ResultsRange, 'from' | 'to'>): string {
  const fromHeader = (headerName ?? '').trim();
  if (fromHeader) return /\.xlsx$/i.test(fromHeader) ? fromHeader : `${fromHeader}.xlsx`;
  return `Results ${r.from} to ${r.to}.xlsx`;
}

/** `Content-Disposition: attachment; filename="x.xlsx"; filename*=UTF-8''x.xlsx` → "x.xlsx" (or null). */
export function fileNameFromDisposition(h: string | null | undefined): string | null {
  if (!h) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(h);
  if (star) { try { return decodeURIComponent(star[1].trim()); } catch { /* fall through */ } }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(h);
  return plain ? plain[1].trim() : null;
}
