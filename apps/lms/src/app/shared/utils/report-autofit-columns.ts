/**
 * Column auto-fit for the results table — pure.
 *
 * Each column has a content range: `min` (its longest unbreakable word, plus
 * padding — narrower than this and a word would be cut) and `max` (its
 * longest line unwrapped). Given the table's usable width:
 *
 *  - Σmax fits → every column gets its max; the slack is shared out in
 *    proportion to the lab's configured widths (`pref`), so a table with
 *    short content keeps the proportions the lab chose.
 *  - Otherwise → every column gets its min, and the remainder is shared in
 *    proportion to (max − min): the column with the most to gain from room
 *    (a long parameter name) gets the most of it.
 *  - Σmin does not fit at all → the mins are scaled down evenly (the caller
 *    keeps wrapping; nothing is cut).
 *
 * The result column is the caller's to protect: it passes `min = max` for a
 * column whose values must never wrap (capped so one column cannot starve
 * the rest).
 *
 * Credit: the min/max content-width scheme follows the table `autofit_widths`
 * idea in storytold's wordcraft layout crate (MIT OR Apache-2.0).
 * Re-implemented here from the idea; no code copied.
 */

export interface ColumnSpec {
  /** The lab's configured share of the table (any positive weight). */
  pref: number;
  min: number;
  max: number;
}

export function autofitColumns(cols: ReadonlyArray<ColumnSpec>, total: number): number[] {
  const n = cols.length;
  if (n === 0) return [];
  const spec = cols.map(c => {
    const min = Math.max(0, c.min);
    return { pref: c.pref > 0 ? c.pref : 1, min, max: Math.max(min, c.max) };
  });
  const sumMax = spec.reduce((s, c) => s + c.max, 0);
  const sumMin = spec.reduce((s, c) => s + c.min, 0);
  const sumPref = spec.reduce((s, c) => s + c.pref, 0);
  if (sumMax <= total) {
    const slack = total - sumMax;
    return spec.map(c => c.max + (slack * c.pref) / sumPref);
  }
  if (sumMin >= total) {
    return spec.map(c => (c.min / (sumMin || 1)) * total);
  }
  const room = total - sumMin;
  const gain = spec.reduce((s, c) => s + (c.max - c.min), 0);
  return spec.map(c => c.min + (gain > 0 ? (room * (c.max - c.min)) / gain : room / n));
}
