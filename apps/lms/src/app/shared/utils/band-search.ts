/**
 * Band pill search — the one matcher every admin page's pill search uses.
 * Case-insensitive; every whitespace-separated word of the query must appear
 * somewhere in the joined haystack fields, so "hosp chennai" finds a hospital
 * named "City Hospital" in "Chennai". An empty query matches everything.
 */
export function bandMatch(query: string | null | undefined, ...fields: unknown[]): boolean {
  const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fields
    .filter((f) => f !== null && f !== undefined && f !== '')
    .map((f) => String(f).toLowerCase())
    .join(' ');
  return words.every((w) => hay.includes(w));
}

/** Filter a list with {@link bandMatch}; `fields` picks what a row is searched on. */
export function bandFilter<T>(rows: readonly T[], query: string | null | undefined, fields: (row: T) => unknown[]): T[] {
  if (!(query ?? '').trim()) return rows.slice();
  return rows.filter((r) => bandMatch(query, ...fields(r)));
}
