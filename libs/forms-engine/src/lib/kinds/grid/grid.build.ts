import { ANSWERED_OPS, KindBuild } from '../../build/contract';
import { FieldDef } from '../../core/types';
import { gridConfig, gridLayout } from './grid-model';
import { GridPanelComponent } from './grid.studio';

/** Studio descriptor for `grid` (API "Grid and the hard cases"): rows, columns, merged headings, Quick fill and words are set in its panel. */
export const GRID_BUILD: KindBuild = {
  kind: 'grid',
  name: 'Table',
  hint: 'Rows and columns of small answers: a dental chart, an eye examination, a power table. Quick fill chips such as All normal.',
  icon: 'k-grid',
  group: 'Table',
  starterConfig: {
    display: 'table',
    rowHeader: '',
    columns: [
      { key: 'finding', label: 'Finding', type: 'text' },
      { key: 'note', label: 'Note', type: 'text' },
    ],
    rows: [
      { key: 'row1', label: 'Row 1' },
      { key: 'row2', label: 'Row 2' },
    ],
  },
  sentence: () => '',
  ifNone: null,
  conditionValue: 'none',
  conditionOps: ANSWERED_OPS,
  config: [
    {
      name: 'display',
      label: 'In the case sheet',
      choices: { table: 'A table', sentences: 'Sentences', both: 'A table and sentences' },
    },
    { name: 'includeSwitch', label: 'Doctor can leave it out', hint: 'An “Include in narrative” switch above the table.' },
  ],
  sample: (f: FieldDef) => gridSample(f),
  panel: GridPanelComponent,
};

/** A typical answer (the API's SampleAnswer): the first three rows, up to four cells each. */
export function gridSample(f: FieldDef): unknown {
  const l = gridLayout(gridConfig(f));
  const cells: Record<string, Record<string, unknown>> = {};
  for (const row of l.rows.slice(0, 3)) {
    const values: Record<string, unknown> = {};
    for (const s of row.cells.flatMap((c) => c.slots).slice(0, 4)) {
      const t = s.field.type ?? 'text';
      const v = t === 'number' ? 1 : t === 'yesno' ? true : t === 'choice' ? s.field.options?.[0]?.key : 'Normal';
      if (v !== undefined) values[s.slot] = v;
    }
    if (Object.keys(values).length) cells[row.def.key] = values;
  }
  return Object.keys(cells).length ? { print: true, cells } : undefined;
}
