/**
 * A table in a narrative response (API docs "Tables in responses"): a grid's answers already in words — `-` for an
 * empty cell, merged headings, merged row labels (`label: null` = under the label above), merged cells.
 * `sections[].tables` sit under their section's words; the top-level `tables` (a section that wrote no words) carry
 * the `order` of the section they belong to (null = at the end).
 */
export interface NarrativeTableCell {
  text: string;
  colSpan: number;
}
export interface NarrativeTableRow {
  label: string | null;
  labelSpan: number;
  cells: NarrativeTableCell[];
}
export interface NarrativeTable {
  fieldKey: string;
  label: string;
  order: number | null;
  rowHeader: string;
  headerGroups: { label: string; span: number }[] | null;
  columns: string[];
  rows: NarrativeTableRow[];
}

const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const a = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const n = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Read the API's tables defensively (a missing or odd field never breaks the narrative). */
export function toNarrativeTables(v: unknown): NarrativeTable[] {
  return a(v).map((raw) => {
    const t = o(raw);
    const groups = a(t['headerGroups']).map((g) => ({ label: s(o(g)['label']), span: Math.max(1, n(o(g)['span'], 1)) }));
    return {
      fieldKey: s(t['fieldKey']),
      label: s(t['label']),
      order: typeof t['order'] === 'number' ? (t['order'] as number) : null,
      rowHeader: s(t['rowHeader']),
      headerGroups: groups.length ? groups : null,
      columns: a(t['columns']).map(s),
      rows: a(t['rows']).map((r) => {
        const row = o(r);
        return {
          label: typeof row['label'] === 'string' ? (row['label'] as string) : null,
          labelSpan: Math.max(1, n(row['labelSpan'], 1)),
          cells: a(row['cells']).map((c) => ({ text: s(o(c)['text']) || '-', colSpan: Math.max(1, n(o(c)['colSpan'], 1)) })),
        };
      }),
    };
  });
}

/** One entry of a narrative in reading order: a section, or a table whose section wrote no words. */
export type NarrativeEntry<S> = { kind: 'section'; section: S; order: number } | { kind: 'table'; table: NarrativeTable; order: number };

/**
 * Sections and the top-level tables in reading order: a table goes where its section would be (after the sections
 * of the same order), a table with no order at the end.
 */
export function narrativeEntries<S extends { order: number }>(sections: S[], tables: NarrativeTable[]): NarrativeEntry<S>[] {
  const out: NarrativeEntry<S>[] = sections.map((section) => ({ kind: 'section' as const, section, order: section.order }));
  for (const t of tables) out.push({ kind: 'table', table: t, order: t.order ?? Number.MAX_SAFE_INTEGER });
  return out
    .map((e, i) => ({ e, i }))
    .sort((x, y) => x.e.order - y.e.order || (x.e.kind === y.e.kind ? x.i - y.i : x.e.kind === 'section' ? -1 : 1))
    .map(({ e }) => e);
}
