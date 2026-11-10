import { GridConfig } from './grid-model';
import {
  addColumn,
  addHeading,
  addOption,
  addPreset,
  addRows,
  keyFrom,
  mergeRight,
  moveColumn,
  moveRow,
  noBox,
  parseRowLabels,
  removeColumn,
  removeOption,
  removePreset,
  removeRow,
  renameOption,
  restoreBox,
  serialiseGrid,
  setColumnType,
  setLabelSpan,
  tidyGrid,
  tokenParts,
  CELL_TOKENS,
  unmerge,
  updateHeading,
  updatePreset,
  gridLimitWords,
} from './grid-edits';

const base = (): GridConfig => ({
  display: 'table',
  rowHeader: 'Tooth',
  columns: [
    { key: 'status', label: 'Status', type: 'choice', options: [{ key: 'sound', label: 'Sound' }] },
    { key: 'mobility', label: 'Mobility', type: 'text' },
    { key: 'note', label: 'Note', type: 'text' },
  ],
  headerGroups: [{ label: 'Findings', from: 'status', span: 2 }],
  rows: [
    { key: 't18', label: '18' },
    { key: 't17', label: '17' },
    { key: 't16', label: '16' },
  ],
});

describe('grid edits: keys', () => {
  it('makes unique keys from labels (letters, digits, _; starts with a letter; any case counts as taken)', () => {
    expect(keyFrom('Right eye', [])).toBe('rightEye');
    expect(keyFrom('18', [], 'row', 64)).toBe('row18');
    expect(keyFrom('Status', ['status'])).toBe('status2');
    expect(keyFrom('', [])).toBe('col');
    expect(keyFrom('x'.repeat(50), [])).toHaveLength(32);
    expect(keyFrom('x'.repeat(50), ['x'.repeat(32)])).toBe('x'.repeat(31) + '2');
    expect(keyFrom('Café · №1', [])).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
  });
});

describe('grid edits: columns', () => {
  it('adds a column with a unique key; a choice starts with one choice', () => {
    const a = addColumn(base(), 'Status', 'choice');
    expect(a.columns[3]).toEqual({ key: 'status2', label: 'Status', type: 'choice', options: [{ key: 'normal', label: 'Normal' }] });
    expect(base().columns).toHaveLength(3); // the input is never changed
  });

  it('removing a column takes its cells, its merges and its heading with it', () => {
    let c = base();
    c = mergeRight(c, 0, 'status'); // 18: status over mobility
    c = noBox(c, 1, 'note');
    c = removeColumn(c, 0);
    expect(c.columns.map((x) => x.key)).toEqual(['mobility', 'note']);
    expect(c.rows[0].cells).toBeUndefined();
    expect(c.rows[1].cells).toEqual([{ column: 'note', fields: [] }]);
    // "Findings" over status + mobility now covers mobility only
    expect(c.headerGroups).toEqual([{ label: 'Findings', from: 'mobility' }]);
    // a merge running over the removed column shrinks
    let d = mergeRight(mergeRight(base(), 2, 'status'), 2, 'status');
    d = removeColumn(d, 1);
    expect(d.rows[2].cells).toEqual([{ column: 'status', colSpan: 2 }]);
    // the last column stays
    expect(removeColumn({ ...base(), columns: [base().columns[0]] }, 0).columns).toHaveLength(1);
  });

  it('moves a column; a heading that no longer fits is dropped rather than overlapping', () => {
    const c = moveColumn(base(), 2, -1);
    expect(c.columns.map((x) => x.key)).toEqual(['status', 'note', 'mobility']);
    expect(moveColumn(base(), 0, -1)).toEqual(base());
  });

  it('changes a column type: choices come and go, defaults and units that no longer fit go', () => {
    let c = setColumnType(base(), 1, 'choice');
    expect(c.columns[1].options).toEqual([{ key: 'normal', label: 'Normal' }]);
    c = setColumnType(c, 1, 'number');
    expect(c.columns[1].options).toBeUndefined();
    c.columns[1].unit = 'mm';
    c = setColumnType(c, 1, 'yesno');
    expect(c.columns[1].unit).toBeUndefined();
  });

  it('choices: unique keys from the words, rename keeps the key, the last one stays', () => {
    let c = addOption(base(), 0, 'Caries');
    c = addOption(c, 0, 'caries'); // same words: not twice
    c = addOption(c, 0, 'Sound!');
    expect(c.columns[0].options!.map((o) => o.key)).toEqual(['sound', 'caries', 'sound2']);
    c = renameOption(c, 0, 'caries', 'Decay');
    expect(c.columns[0].options![1]).toEqual({ key: 'caries', label: 'Decay' });
    c = removeOption(removeOption(c, 0, 'sound2'), 0, 'caries');
    expect(removeOption(c, 0, 'sound').columns[0].options).toHaveLength(1);
  });
});

describe('grid edits: rows', () => {
  it('reads rows typed in one go: lines, commas and a dental range', () => {
    expect(parseRowLabels('18-11')).toEqual(['18', '17', '16', '15', '14', '13', '12', '11']);
    expect(parseRowLabels('21…23, Lids\nCornea;  ')).toEqual(['21', '22', '23', 'Lids', 'Cornea']);
    expect(parseRowLabels('1-500')).toHaveLength(200);
    expect(parseRowLabels('1-10', 3)).toEqual(['1', '2', '3']);
  });

  it('adds rows with unique keys up to the limit', () => {
    const c = addRows(base(), ['18', '15']);
    expect(c.rows.slice(3).map((r) => r.key)).toEqual(['row18', 'row15']);
    const full: GridConfig = { ...base(), rows: Array.from({ length: 199 }, (_, i) => ({ key: `r${i}`, label: `${i}` })) };
    expect(addRows(full, ['a', 'b']).rows).toHaveLength(200);
    expect(gridLimitWords(addRows(full, ['a']), 'row')).toBe('A table has at most 200 rows.');
  });

  it('merged labels: clamped to the rows left, undone by a move, shrink when a row under them goes', () => {
    let c = setLabelSpan(base(), 0, 9);
    expect(c.rows[0].labelSpan).toBe(3);
    c = setLabelSpan(base(), 1, 2);
    expect(c.rows.map((r) => r.labelSpan)).toEqual([undefined, 2, undefined]);
    // a row under a merge starting its own: the outer merge is undone
    c = setLabelSpan(setLabelSpan(base(), 0, 3), 1, 2);
    expect(c.rows.map((r) => r.labelSpan)).toEqual([undefined, 2, undefined]);
    c = removeRow(setLabelSpan(base(), 0, 3), 1);
    expect(c.rows.map((r) => [r.key, r.labelSpan])).toEqual([
      ['t18', 2],
      ['t16', undefined],
    ]);
    c = moveRow(setLabelSpan(base(), 0, 2), 1, 1);
    expect(c.rows.map((r) => r.key)).toEqual(['t18', 't16', 't17']);
    expect(c.rows.every((r) => !r.labelSpan)).toBe(true);
    expect(tidyGrid({ ...base(), rows: [{ key: 'a', label: 'A', labelSpan: 4 }] }).rows[0].labelSpan).toBeUndefined();
  });

  it('a row keeps at least one', () => {
    expect(removeRow({ ...base(), rows: [base().rows[0]] }, 0).rows).toHaveLength(1);
  });
});

describe('grid edits: one cell', () => {
  it('merge with the next column, unmerge, no box, restore', () => {
    let c = mergeRight(base(), 1, 'status');
    expect(c.rows[1].cells).toEqual([{ column: 'status', colSpan: 2 }]);
    c = mergeRight(mergeRight(c, 1, 'status'), 1, 'status'); // clamped to the columns left
    expect(c.rows[1].cells).toEqual([{ column: 'status', colSpan: 3 }]);
    c = unmerge(c, 1, 'status');
    expect(c.rows[1].cells).toBeUndefined();
    c = noBox(c, 1, 'note');
    expect(c.rows[1].cells).toEqual([{ column: 'note', fields: [] }]);
    c = restoreBox(c, 1, 'note');
    expect(c.rows[1].cells).toBeUndefined();
    // a cell under a merge is dropped
    c = mergeRight(noBox(base(), 0, 'mobility'), 0, 'status');
    expect(c.rows[0].cells).toEqual([{ column: 'status', colSpan: 2 }]);
  });
});

describe('grid edits: headings', () => {
  it('adds a heading over the first free columns and never overlaps', () => {
    const c = addHeading(base(), 'Other');
    expect(c.headerGroups).toEqual([
      { label: 'Findings', from: 'status', span: 2 },
      { label: 'Other', from: 'note' },
    ]);
    expect(addHeading(c, 'More')).toEqual(c); // every column has one
    expect(updateHeading(c, 1, { from: 'mobility' })).toEqual(c); // would overlap: refused
    expect(updateHeading(c, 0, { span: 1 }).headerGroups![0]).toEqual({ label: 'Findings', from: 'status' });
  });
});

describe('grid edits: Quick fill', () => {
  it('adds, changes and removes chips up to 20', () => {
    let c = addPreset(base(), 'All sound', 'all', 'Sound');
    c = addPreset(c, 'NAD', 'row');
    expect(c.quickFill).toEqual({ enabled: true, presets: [{ label: 'All sound', value: 'Sound' }, { label: 'NAD', scope: 'row' }] });
    c = updatePreset(c, 1, { scope: 'all', value: '' });
    expect(c.quickFill!.presets![1]).toEqual({ label: 'NAD' });
    c = removePreset(c, 0);
    expect(c.quickFill!.presets).toEqual([{ label: 'NAD' }]);
    for (let i = 0; i < 25; i++) c = addPreset(c, `c${i}`);
    expect(c.quickFill!.presets).toHaveLength(20);
    expect(gridLimitWords(c, 'preset')).toBe('At most 20 Quick fill chips.');
    expect(addPreset(base(), '   ')).toEqual(base());
    const once = addPreset(base(), 'NAD');
    expect(addPreset(once, 'nad')).toBe(once); // the same chip twice: refused
    expect(addPreset(once, 'NAD', 'row').quickFill!.presets).toHaveLength(2);
  });
});

describe('grid edits: what is stored', () => {
  it('writes the API shape: no empty lists, no defaults, no options on a non-choice', () => {
    const c = { ...base(), headerGroups: [], quickFill: undefined, columns: [...base().columns, { key: 'n', label: 'N', type: 'number' as const, options: [], unit: '' }] };
    const out = serialiseGrid(c);
    expect(out['headerGroups']).toBeUndefined();
    expect(out['quickFill']).toBeUndefined();
    expect((out['columns'] as object[])[3]).toEqual({ key: 'n', label: 'N', type: 'number' });
    expect(out['rows']).toEqual(base().rows);
  });

  it('shows a template in words, never in braces', () => {
    expect(tokenParts('{label}: {value} in {row}', CELL_TOKENS).map((p) => p.text)).toEqual(['the box name', ': ', 'the answer', ' in ', 'the row']);
  });
});
