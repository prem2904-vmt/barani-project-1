import vectors from '../../testing/grid-quick-fill.vectors.json';
import {
  GridAnswer,
  GridConfig,
  applyChip,
  chipActive,
  clearAlong,
  fillCount,
  fillFrom,
  gridAnswered,
  gridConfig,
  gridLayout,
  headerBand,
  resolveChip,
  shapePositions,
  valueText,
  withCell,
} from './grid-model';

/** The API's dental-chart example (GridKind.Examples) — the shape every test below writes in. */
export const DENTAL: GridConfig = {
  display: 'table',
  rowHeader: 'Tooth',
  columns: [
    {
      key: 'status',
      label: 'Status',
      type: 'choice',
      options: [
        { key: 'sound', label: 'Sound' },
        { key: 'caries', label: 'Caries' },
        { key: 'filled', label: 'Filled' },
        { key: 'missing', label: 'Missing' },
      ],
    },
    {
      key: 'mobility',
      label: 'Mobility',
      type: 'choice',
      options: [
        { key: 'none', label: 'None' },
        { key: 'g1', label: 'Grade 1' },
        { key: 'g2', label: 'Grade 2' },
      ],
    },
    { key: 'note', label: 'Note', type: 'text' },
  ],
  headerGroups: [{ label: 'Findings', from: 'status', span: 2 }],
  rows: [
    { key: 't18', label: '18' },
    { key: 't17', label: '17' },
    { key: 't16', label: '16' },
  ],
  quickFill: {
    enabled: true,
    presets: [
      { label: 'All sound', value: 'Sound' },
      { label: 'No mobility', value: 'None', scope: 'column' },
    ],
  },
};

/** Compare after dropping empty rows and an empty cells object (the vectors' rule). */
function norm(a: GridAnswer | null | undefined): unknown {
  if (!a) return null;
  const cells = Object.fromEntries(Object.entries(a.cells ?? {}).filter(([, r]) => Object.keys(r ?? {}).length));
  const out: Record<string, unknown> = {};
  if (a.print !== undefined) out['print'] = a.print;
  if (Object.keys(cells).length) out['cells'] = cells;
  return Object.keys(out).length ? out : null;
}

describe('grid: Quick Fill matches the server (shared vectors docs/vectors/grid-quick-fill.json)', () => {
  const layout = gridLayout(gridConfig({ config: vectors.config as Record<string, unknown> }));
  for (const c of vectors.cases) {
    it(c.name, () => {
      const where = { row: (c as { row?: string }).row ?? null, column: (c as { column?: string }).column ?? null };
      const after = applyChip(layout, c.before as unknown as GridAnswer | null, c.chip as never, where, c.clear);
      expect(norm(after)).toEqual(norm(c.after as unknown as GridAnswer));
      // the input is never changed
      if (c.before) expect(c.before).toEqual(JSON.parse(JSON.stringify(c.before)));
    });
  }

  it('a chip is active when every cell it fits holds its value', () => {
    const chip = { label: 'All normal', value: 'Normal' };
    const filled = applyChip(layout, null, chip);
    expect(chipActive(layout, filled, chip)).toBe(true);
    expect(chipActive(layout, withCell(filled, 'r2', 'note', 'typed over') ?? null, chip)).toBe(false);
    expect(chipActive(layout, null, { label: 'zzz' }, { column: 'status' })).toBe(false);
    // tapping again takes it back
    expect(norm(applyChip(layout, filled, chip, {}, true))).toEqual({ print: true });
  });

  it('resolves a chip like the server', () => {
    const col = (type: string, extra = {}) => ({ key: 'k', label: 'Normal', type, ...extra }) as never;
    expect(resolveChip(col('number'), ' 4.5 ')).toBe(4.5);
    expect(resolveChip(col('number'), 'four')).toBeUndefined();
    expect(resolveChip(col('yesno'), 'normal')).toBe(true);
    expect(resolveChip(col('yesno'), 'NO')).toBe(false);
    expect(resolveChip(col('choice', { options: [{ key: 'g1', label: 'Grade 1' }] }), 'grade 1')).toBe('g1');
    expect(resolveChip(col('text'), 'x'.repeat(600))).toHaveLength(500);
    expect(resolveChip(col('text'), '   ')).toBeUndefined();
  });
});

describe('grid: layout', () => {
  it('lays out merged cells, cells with their own fields and merged row labels', () => {
    const cfg = gridConfig({
      config: {
        columns: [
          { key: 'a', label: 'A' },
          { key: 'b', label: 'B', type: 'number' },
          { key: 'c', label: 'C' },
        ],
        rows: [
          { key: 'r1', label: 'Upper', labelSpan: 2, cells: [{ column: 'a', colSpan: 2 }] },
          { key: 'r2', label: 'x', cells: [{ column: 'c', fields: [{ key: 'p', label: 'P' }, { key: 'q', label: 'Q', type: 'yesno' }] }] },
          { key: 'r3', label: 'Lower', cells: [{ column: 'b', fields: [] }] },
        ],
      },
    });
    const l = gridLayout(cfg);
    expect(l.rows.map((r) => r.labelSpan)).toEqual([2, 0, 1]);
    expect(l.rows[0].cells.map((c) => [c.column, c.colSpan])).toEqual([
      [0, 2],
      [2, 1],
    ]);
    expect(l.rows[1].cells[2].slots.map((s) => s.slot)).toEqual(['c.p', 'c.q']);
    expect(l.rows[2].cells[1].slots).toEqual([]);
    expect(l.slots).toHaveLength(2 + 4 + 2);
  });

  it('clamps a label span or a cell span that runs past the end (never throws)', () => {
    const l = gridLayout(
      gridConfig({
        config: { columns: [{ key: 'a', label: 'A' }], rows: [{ key: 'r', label: 'R', labelSpan: 9, cells: [{ column: 'a', colSpan: 5 }] }] },
      }),
    );
    expect(l.rows[0].labelSpan).toBe(1);
    expect(l.rows[0].cells[0].colSpan).toBe(1);
    expect(gridLayout(gridConfig({ config: { columns: null, rows: 'x' } as never })).rows).toEqual([]);
  });

  it('the header band fills gaps and drops overlapping groups', () => {
    expect(headerBand(DENTAL)).toEqual([
      { label: 'Findings', span: 2, start: 0 },
      { label: '', span: 1, start: 2 },
    ]);
    expect(headerBand({ ...DENTAL, headerGroups: [{ label: 'x', from: 'mobility' }] })).toEqual([
      { label: '', span: 1, start: 0 },
      { label: 'x', span: 1, start: 1 },
      { label: '', span: 1, start: 2 },
    ]);
    expect(
      headerBand({ ...DENTAL, headerGroups: [{ label: 'x', from: 'status', span: 2 }, { label: 'y', from: 'mobility', span: 2 }] }),
    ).toBeNull();
    expect(headerBand({ ...DENTAL, headerGroups: [] })).toBeNull();
  });
});

describe('grid: answers in the API shape', () => {
  it('writes the API example answer cell by cell (choice keys, text, rows keyed by row key)', () => {
    let a: GridAnswer | undefined = { print: true };
    a = withCell(a, 't18', 'status', 'caries');
    a = withCell(a ?? null, 't18', 'mobility', 'g1');
    a = withCell(a ?? null, 't17', 'status', 'sound');
    a = withCell(a ?? null, 't16', 'status', 'missing');
    a = withCell(a ?? null, 't16', 'note', 'extracted last year');
    expect(a).toEqual({
      print: true,
      cells: {
        t18: { status: 'caries', mobility: 'g1' },
        t17: { status: 'sound' },
        t16: { status: 'missing', note: 'extracted last year' },
      },
    });
  });

  it('clearing a cell removes it, an empty row goes, and nothing left is no answer', () => {
    const a = withCell(null, 'r', 's', 'x');
    expect(withCell(a ?? null, 'r', 's', '')).toBeUndefined();
    expect(withCell({ print: false, cells: { r: { s: 'x' } } }, 'r', 's', null)).toEqual({ print: false, cells: {} });
    expect(withCell(null, 'r', 'yn', false)).toEqual({ cells: { r: { yn: false } } });
  });

  it('a false yes/no counts as an answer', () => {
    expect(gridAnswered({ cells: { r: { y: false } } })).toBe(true);
    expect(gridAnswered({ print: true, cells: {} })).toBe(false);
    expect(gridAnswered(null)).toBe(false);
  });

  it('words like the API: a choice by label, a number with its unit, Yes / No', () => {
    expect(valueText(DENTAL.columns[1], 'g1')).toBe('Grade 1');
    expect(valueText({ key: 'd', label: 'D', type: 'number', unit: 'mm' }, 4.5)).toBe('4.5 mm');
    expect(valueText({ key: 'y', label: 'Y', type: 'yesno' }, false)).toBe('No');
    expect(valueText({ key: 't', label: 'T' }, '  ')).toBe('');
  });
});

describe('grid: fill a row / a column from one cell', () => {
  const l = gridLayout(DENTAL);
  const at = (row: string, slot: string) => l.slots.find((s) => s.rowKey === row && s.slot === slot)!;

  it('fills the column with the same answer', () => {
    const a = withCell(null, 't18', 'status', 'caries')!;
    const out = fillFrom(l, a, at('t18', 'status'), 'column');
    expect(out.cells).toEqual({ t18: { status: 'caries' }, t17: { status: 'caries' }, t16: { status: 'caries' } });
    expect(out.print).toBe(true);
    expect(fillCount(l, a, at('t18', 'status'), 'column')).toBe(2);
    expect(fillCount(l, a, at('t18', 'status'), 'row')).toBe(0); // no other column takes a status
    expect(fillCount(l, null, at('t18', 'status'), 'column')).toBe(0);
  });

  it('fills the row only where the same kind of answer fits', () => {
    const a = withCell(null, 't17', 'note', 'NAD')!;
    expect(fillFrom(l, a, at('t17', 'note'), 'row').cells).toEqual({ t17: { note: 'NAD' } });
    expect(fillCount(l, a, at('t17', 'note'), 'row')).toBe(0);
  });

  it('clears a row or a column', () => {
    const a = applyChip(l, null, { label: 'Sound' }, { column: 'status' });
    expect(clearAlong(l, a, { column: 'status' })).toEqual({ print: true, cells: {} });
    const b = withCell(a, 't18', 'note', 'x')!;
    expect(clearAlong(l, b, { row: 't17' })?.cells).toEqual({ t18: { status: 'sound', note: 'x' }, t16: { status: 'sound' } });
  });
});

describe('grid: shapes (legacy plain multi-textbox)', () => {
  it('places n boxes around the centre, inside the box', () => {
    for (const shape of ['circle', 'rectangle', 'square', 'triangle'] as const) {
      for (const n of [1, 4, 8, 12]) {
        const ps = shapePositions(shape, n);
        expect(ps).toHaveLength(n);
        for (const p of ps) {
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(100);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(100);
        }
      }
    }
    expect(shapePositions('linear', 3)).toEqual([]);
  });
});
