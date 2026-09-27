/**
 * ONE test layout, TWO editors on the same screen.
 *
 * The test editor's "Printed report" tab edits a single stored `sections`
 * array from two places:
 *   · the print order (`pf-report-structure`) owns the SECTION LIST — which
 *     blocks exist, their order, Prints/Hidden, labels, a Sentence's text and
 *     its plain-words if/else;
 *   · the Description column (`pf-test-notes-editor`, slim) owns the GRID
 *     ROWS — one override row per value, carrying its description.
 *
 * Each used to POST its OWN full copy, loaded once when the tab opened. So a
 * Description save wrote back the Sentence as it was at load time (blank), and
 * a print-order autosave wrote back the grid rows as they were at load time —
 * whichever saved last silently erased the other's work, and the live preview
 * (which reads the stored layout) showed the erased version.
 *
 * Now each editor saves ON TOP OF THE LATEST STORED COPY and replaces only
 * what it owns. Pure functions, no Angular — trivially testable.
 */

/** A stored layout section, loosely typed: fields an editor doesn't know about
 *  (conditions, templates, chart config…) must survive a merge untouched. */
export type LooseSection = Record<string, unknown> & { id?: string; type?: string; rows?: unknown };
type LooseRow = Record<string, unknown> & { parameter_name?: string; row_merge?: boolean };

const isGrid = (s: LooseSection | undefined): boolean => s?.type === 'grid';
const rowsOf = (s: LooseSection | undefined): LooseRow[] =>
  Array.isArray(s?.rows) ? (s!.rows as LooseRow[]) : [];

/**
 * Print-order save: the structure's section list wins; every grid keeps the
 * rows STORED right now (the Description column may have written them since
 * the structure loaded). A grid the structure doesn't know about (created by
 * the Description column after the structure loaded) is kept, leading the
 * report — the results table comes first.
 */
export function mergeStructureOntoLatest(latest: readonly LooseSection[], structure: readonly LooseSection[]): LooseSection[] {
  const latestGrids = latest.filter(isGrid);
  const used = new Set<LooseSection>();
  const out = structure.map(s => {
    if (!isGrid(s)) return s;
    const match = latestGrids.find(g => !used.has(g) && g.id != null && g.id === s.id)
      ?? latestGrids.find(g => !used.has(g));
    if (!match) return s;
    used.add(match);
    return { ...s, rows: rowsOf(match) };
  });
  const orphans = latestGrids.filter(g => !used.has(g));
  return orphans.length ? [...orphans, ...out] : out;
}

/**
 * Description-column save: start from the stored layout and replace ONLY the
 * rows of the values this editor touched (by parameter name) in the first
 * grid. A touched value with no local row is removed from the stored grid.
 * No grid stored yet → one is created at the top (results table first).
 */
export function mergeDescriptionsOntoLatest(
  latest: readonly LooseSection[],
  local: readonly LooseSection[],
  touched: Iterable<string>,
): LooseSection[] {
  const names = [...touched];
  const next = latest.map(s => ({ ...s }));
  if (names.length === 0) return next;
  const localRows = rowsOf(local.find(isGrid));
  const byName = (rows: LooseRow[], n: string) =>
    rows.findIndex(r => !r.row_merge && (r.parameter_name ?? '') === n);

  let gi = next.findIndex(isGrid);
  if (gi < 0) {
    const localGrid = local.find(isGrid);
    next.unshift({ ...(localGrid ?? {}), id: localGrid?.id ?? 'sec-desc', type: 'grid', rows: [] });
    gi = 0;
  }
  const rows = [...rowsOf(next[gi])];
  for (const n of names) {
    const li = byName(localRows, n);
    const si = byName(rows, n);
    if (li >= 0) {
      if (si >= 0) rows[si] = localRows[li];
      else rows.push(localRows[li]);
    } else if (si >= 0) {
      rows.splice(si, 1);
    }
  }
  next[gi] = { ...next[gi], rows };
  return next;
}
