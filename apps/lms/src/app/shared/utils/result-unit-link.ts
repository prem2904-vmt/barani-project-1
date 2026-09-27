import type { ReportColumn } from '../models/report-layout.model';

/**
 * The ONE Result→Unit default-merge rule, shared by the report PDF renderer
 * (department tables, per-test overrides, grid sections) and the columns
 * editor (Admin → Reports and the test editor's "Change the columns").
 *
 * A column config that predates the merge feature carries no `linkedNext`
 * at all — for those, an adjacent Result→Unit is merged by default so the
 * unit prints beside the value ("11.4 g/dL").
 *
 * An admin who UNPINS Result from Unit saves `linkedNext: false` on the
 * Result column. That is an explicit choice and must be kept: Result and
 * Unit print as two separate columns. (Owner bug 2026-09-27: unpinning
 * saved correctly but both the editor reload and the PDF re-merged the pair,
 * because "no link anywhere" was read as "never configured".)
 *
 * Once any link exists, the admin's merges are respected exactly.
 */
export function applyDefaultResultUnitLink<T extends ReportColumn>(cols: T[]): T[] {
  if (cols.some(c => c.linkedNext)) return cols;
  const ri = cols.findIndex(c => c.type === 'result');
  if (ri < 0 || cols[ri + 1]?.type !== 'unit') return cols;
  if (resultUnitExplicitlyUnlinked(cols, ri)) return cols;
  return cols.map((c, i) => (i === ri ? { ...c, linkedNext: true } : c));
}

/** True when the admin explicitly unpinned Result from Unit. A payload where
 *  EVERY column carries `linkedNext: false` is not a choice — it is an older
 *  server that coerced the missing flag to false on every column — and keeps
 *  the default merge. */
function resultUnitExplicitlyUnlinked(cols: ReportColumn[], ri: number): boolean {
  if (cols[ri].linkedNext !== false) return false;
  return !cols.every(c => c.linkedNext === false);
}
