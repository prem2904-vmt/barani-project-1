/**
 * `GET /api/tests` for a catalogue LIST screen (DB optimisation phase 2):
 * always the SUMMARY view — every field a list / picker / grid reads, without
 * the heavy JSON (description, conditions, calculation, the full parameter
 * blob). Its `parameters` is trimmed to what list screens parse: bundle
 * `items`, the `askSpecimen` / `microFormat` flags and the first value's
 * unit / referenceRanges / normalValue.
 *
 * Opening one test still reads the full row via `GET /api/tests/{id}`. Screens
 * that need every member's FULL parameter blob or calculation (test editor
 * member pickers, option-groups mapper) keep the plain full list.
 */
export interface TestListQuery {
  /** Ordering pickers: operationally visible tests only. */
  activeOnly?: boolean;
  /** Test Master switch filter (server default `all`). */
  status?: 'all' | 'active' | 'inactive';
  /** Price view (pricing screen); omitted = the acting branch. */
  branchId?: string | null;
}

export const TEST_LIST_SUMMARY_VIEW = 'summary';

export function testListUrl(q: TestListQuery = {}): string {
  const p = new URLSearchParams();
  if (q.activeOnly) p.set('activeOnly', 'true');
  if (q.status) p.set('status', q.status);
  if (q.branchId) p.set('branchId', q.branchId);
  p.set('view', TEST_LIST_SUMMARY_VIEW);
  return `/api/tests/?${p.toString()}`;
}
