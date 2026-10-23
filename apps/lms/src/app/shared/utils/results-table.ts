import type { ResolvedReportLayout, ResolvedRow, ResolvedSection } from '../models/report-layout.model';
import { isFamilyFilled, isFamilyValue } from './option-family';

/**
 * The results table can never silently leave a report (patient-safety RCA,
 * 2026-09-27): adding a Sentence to a test with no saved layout stored ONLY the
 * Sentence (the server stripped the empty results-table section), the engine
 * resolved a grid-less layout, and the RESULT vanished from the patient report
 * — "Glucose Fasting 110 mg/dL" gone, only "Fasting of 8–10 hours is required"
 * printed.
 *
 * The same rule as mw `ReportResultsTable` (save + engine), in two places here:
 *   · the print-order editor (`pf-report-structure`) always keeps the results
 *     table in what it saves for a test with values — it can be moved, never
 *     deleted (`sectionsNeedResultsTable` / `withResultsTableFirst`);
 *   · the shared render path (`resolveReportLayouts` + `buildReportPdf`) — a
 *     standalone test with values whose resolved layout has no table gets the
 *     default one first (`withResultsTable`), so preview == PDF even against a
 *     server that predates the fix.
 *
 * NOT value-bearing (no table added): profiles/packages (members print their
 * own values), culture reports, and narrative-only layouts whose Sentences
 * write out every printing value (`{{Gross}}`) — the engine marks those
 * `valuesInNarrative`.
 */

/** A stored (raw) section, loosely typed. */
export type RawLayoutSection = Record<string, unknown> & {
  id?: string; type?: string; order?: number; hidden?: boolean; template?: string; parameter?: string;
};

export const RESULTS_TABLE_ID = 'results-table';

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** Values the layout's own non-grid blocks already print: a Sentence's
 *  `{{name}}` (not `_unit` / `_range`, which print metadata) or a chart. */
function valuesPrintedByBlocks(sections: readonly RawLayoutSection[]): Set<string> {
  const set = new Set<string>();
  for (const s of sections) {
    if (s.hidden === true) continue;
    if (s.type === 'chart' && typeof s.parameter === 'string' && s.parameter.trim()) set.add(s.parameter.trim().toLowerCase());
    if (s.type !== 'paragraph') continue;
    for (const m of String(s.template ?? '').matchAll(PLACEHOLDER)) {
      const key = m[1];
      if (/_(unit|range)$/i.test(key)) continue;
      set.add(key.toLowerCase());
    }
  }
  return set;
}

/** Does this stored print order lack the results table a test with printing
 *  values needs? False for an empty list (the engine synthesises the table),
 *  any grid, culture blocks, no printing values, or a narrative that writes
 *  out every value itself. */
export function sectionsNeedResultsTable(sections: readonly RawLayoutSection[], printingValues: readonly string[]): boolean {
  if (sections.length === 0 || printingValues.length === 0) return false;
  if (sections.some(s => s.type === 'grid' || String(s.type ?? '').startsWith('culture_'))) return false;
  const inBlocks = valuesPrintedByBlocks(sections);
  return printingValues.some(n => !inBlocks.has(n.trim().toLowerCase()));
}

/** The sections with an empty default results table FIRST. Empty rows are the
 *  stored shape — the test's parameters[] are the report rows. */
export function withResultsTableFirst<T extends RawLayoutSection>(sections: readonly T[], id = RESULTS_TABLE_ID): T[] {
  const grid = { id, type: 'grid', order: 0, conditions: [], rows: [] } as unknown as T;
  return [grid, ...sections];
}

/** The snapshot test fields the render net reads. */
export interface ResultsTableTest {
  packageTestId?: string | null;
  profileTestId?: string | null;
  result?: { values?: Record<string, unknown> | null; microFormat?: string | null } | null;
}

type Wrapped = { value?: unknown; unit?: unknown; range?: unknown; flag?: unknown; description?: unknown };
// A family value travels as its JSON so the renderer can expand it (one row
// per picked item); everything else is plain text.
const str = (v: unknown): string => (v === null || v === undefined ? '' : isFamilyValue(v) ? JSON.stringify(v) : String(v));

/**
 * Render safety net: a STANDALONE test with entered values whose resolved
 * layout has no results table gets the default one first, built from the
 * snapshot's values against the layout's own columns. Returns the layout
 * unchanged (same object) whenever the table is not needed:
 *   · no layout / no sections array, or the layout already has a grid;
 *   · no visible Sentence/chart block — the renderer keeps such a test in
 *     the results table and prints its values from the snapshot already;
 *   · the engine marked the layout narrative-only (`valuesInNarrative`);
 *   · a profile/package member — its values print in the profile block
 *     through the plain values table exactly as before;
 *   · a culture report (the culture renderer draws the result);
 *   · no entered values.
 */
export function withResultsTable<L>(layout: L, test: ResultsTableTest | null | undefined): L {
  const l = layout as unknown as ResolvedReportLayout | null | undefined;
  if (!l || !Array.isArray(l.sections) || !test) return layout;
  if (l.valuesInNarrative) return layout;
  if (test.packageTestId || test.profileTestId) return layout;
  if (test.result?.microFormat === 'culture_sensitivity') return layout;
  if (l.sections.some(s => s.type === 'grid' || String(s.type ?? '').startsWith('culture_'))) return layout;
  // Only a layout that pulls the test out of the results table (a visible
  // Sentence / chart — images never do) loses the values. With no such block
  // the renderer already prints the plain values table: leave it exactly so.
  if (!l.sections.some(s => s.isVisible && s.type !== 'image')) return layout;

  const entries = Object.entries(test.result?.values ?? {}).filter(([, v]) => {
    const scalar = v !== null && typeof v === 'object' && 'value' in (v as object) ? (v as Wrapped).value : v;
    if (isFamilyValue(scalar)) return isFamilyFilled(scalar);
    return scalar !== null && scalar !== undefined && String(scalar).trim() !== '';
  });
  if (entries.length === 0) return layout;

  const cols = Array.isArray(l.columns) ? l.columns : [];
  const rows: ResolvedRow[] = entries.map(([name, v]) => {
    const w: Wrapped = v !== null && typeof v === 'object' && 'value' in (v as object) ? (v as Wrapped) : { value: v };
    const cells: Record<string, string> = {};
    for (const c of cols) {
      cells[c.name] = c.type === 'result' ? str(w.value)
        : c.type === 'unit' ? str(w.unit)
        : c.type === 'range' ? str(w.range)
        : c.name === 'description' ? str(w.description) : '';
    }
    return {
      id: `auto-${name}`, parameterName: name, cells,
      unit: str(w.unit) || undefined, isMerged: false, isBold: false,
      flag: typeof w.flag === 'string' ? w.flag : null,
    };
  });
  const table: ResolvedSection = { id: RESULTS_TABLE_ID, type: 'grid', isVisible: true, rows };
  return { ...l, sections: [table, ...l.sections] } as unknown as L;
}

/** Apply the render net to every standalone test of a snapshot (idempotent). */
export function withResultsTables<L>(
  layouts: Record<string, L>,
  tests: ReadonlyArray<ResultsTableTest & { testId?: string | null }>,
): Record<string, L> {
  let out = layouts;
  for (const t of tests) {
    if (!t.testId || !(t.testId in layouts)) continue;
    const next = withResultsTable(out[t.testId], t);
    if (next !== out[t.testId]) {
      if (out === layouts) out = { ...layouts };
      out[t.testId] = next;
    }
  }
  return out;
}
