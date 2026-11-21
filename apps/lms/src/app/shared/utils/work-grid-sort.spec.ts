import type { ColDef } from 'ag-grid-community';
import {
  SORT_CYCLE, choiceCol, compareNum, compareText, dateCol, duePresets, durationCol, durationText, epochOf, moneyCol, numComparator, numberCol,
  ratioCol, ratioValue, shapeCol, sortsAndFilters, textCol, textComparator, tokenCol, tokenLabelValue, tokenValue, valuesCol, waitPresets,
} from './work-grid';

/**
 * Owner 2026-11-21: "wherever the math is there, it should sort by the math". Every work-grid column sorts on the
 * REAL value (minutes, paise, ratio, epoch, token day+number), text case-insensitively by the whole text, blanks last
 * in BOTH directions — and every helper builds the sort and the filter together.
 */

/** Sort like AG-Grid: comparator result, flipped when descending (stable on ties). */
function agSort<V>(vals: V[], cmp: (a: unknown, b: unknown, na?: unknown, nb?: unknown, desc?: boolean) => number, desc = false): V[] {
  return vals.map((v, i) => ({ v, i }))
    .sort((a, b) => (desc ? -1 : 1) * cmp(a.v, b.v, undefined, undefined, desc) || a.i - b.i)
    .map(x => x.v);
}
/** Sort rows through a column def's own valueGetter + comparator. */
function sortRows<T>(c: ColDef<T>, rows: T[], desc = false): T[] {
  const get = (r: T) => (c.valueGetter as (p: { data: T }) => unknown)({ data: r });
  return rows.map((r, i) => ({ r, v: get(r), i }))
    .sort((a, b) => (desc ? -1 : 1) * (c.comparator as (a: unknown, b: unknown, na: unknown, nb: unknown, d: boolean) => number)(a.v, b.v, null, null, desc) || a.i - b.i)
    .map(x => x.r);
}
type Fv = { filterValueGetter: (p: { data: unknown }) => unknown; filterParams: { filterOptions: Array<string | { displayKey: string; predicate: (f: unknown[], v: unknown) => boolean }> } };
const presetOf = (c: unknown, key: string) =>
  (c as Fv).filterParams.filterOptions.find(o => typeof o !== 'string' && o.displayKey === key) as { predicate: (f: unknown[], v: unknown) => boolean };

describe('compareNum / compareText — blanks last both ways', () => {
  it('numbers ascending and descending; null / NaN last either way', () => {
    const v = [41, null, 419, 5, Number.NaN, 81860];
    expect(agSort(v, numComparator)).toEqual([5, 41, 419, 81860, null, Number.NaN]);
    expect(agSort(v, numComparator, true)).toEqual([81860, 419, 41, 5, null, Number.NaN]);
    expect(compareNum(null, null)).toBe(0);
    expect(compareNum(3, 3)).toBe(0);
  });

  it('text: case-insensitive, by the WHOLE text, digits by value; "—" / "" last both ways', () => {
    const v = ['priya Nair', '—', 'Arya Stark', '', 'arya stark b', 'Bed 10', 'Bed 2', null];
    expect(agSort(v, textComparator).slice(0, 5)).toEqual(['Arya Stark', 'arya stark b', 'Bed 2', 'Bed 10', 'priya Nair']);
    expect(agSort(v, textComparator).slice(5)).toEqual(['—', '', null]);
    expect(agSort(v, textComparator, true).slice(0, 5)).toEqual(['priya Nair', 'Bed 10', 'Bed 2', 'arya stark b', 'Arya Stark']);
    expect(agSort(v, textComparator, true).slice(5)).toEqual(['—', '', null]);
    expect(compareText('ARYA', 'arya')).toBe(0);
  });
});

describe('durations — sort on MINUTES, never the words', () => {
  type W = { id: string; min: number | null; text: string };
  const rows: W[] = [
    { id: 'a', min: 41, text: '41m' },
    { id: 'b', min: 419, text: '6h 59m' },
    { id: 'c', min: null, text: '—' },
    { id: 'd', min: 81860, text: '1364h 20m' },
    { id: 'e', min: 5, text: '5m' },
  ];
  const wait = durationCol<W>({ colId: 'wait', headerName: 'Waiting' }, r => r.min, { kind: 'wait' });

  it('Waiting asc = shortest first, desc = longest first; unknown last both ways', () => {
    expect(sortRows(wait, rows).map(r => r.id)).toEqual(['e', 'a', 'b', 'd', 'c']);
    expect(sortRows(wait, rows, true).map(r => r.id)).toEqual(['d', 'b', 'a', 'e', 'c']);
    // The text order would be wrong: "1364h 20m" < "41m" < "5m" < "6h 59m".
    expect([...rows].filter(r => r.min !== null).map(r => r.text).sort()).toEqual(['1364h 20m', '41m', '5m', '6h 59m']);
  });

  it('Due with late (negative) values: most late first ascending, "—" last both ways', () => {
    type D = { id: string; left: number | null };
    const due = durationCol<D>({ colId: 'due' }, r => r.left, { kind: 'due' });
    const d: D[] = [{ id: 'in25', left: 25 }, { id: 'late55d', left: -(55 * 1440 + 20 * 60) }, { id: 'none', left: null }, { id: 'late12', left: -12 }, { id: 'in6h', left: 419 }];
    expect(sortRows(due, d).map(r => r.id)).toEqual(['late55d', 'late12', 'in25', 'in6h', 'none']);
    expect(sortRows(due, d, true).map(r => r.id)).toEqual(['in6h', 'in25', 'late12', 'late55d', 'none']);
    // Presets: Late only = below 0; Due in 30 min = 0–30.
    expect(presetOf(due, 'wgLate').predicate([], -12)).toBe(true);
    expect(presetOf(due, 'wgLate').predicate([], 25)).toBe(false);
    expect(presetOf(due, 'wgLate').predicate([], null)).toBe(false);
    expect(presetOf(due, 'wgDue30').predicate([], 25)).toBe(true);
    expect(duePresets().map(p => p.displayName)).toContain('Late only');
  });

  it('Waiting filter = minutes with presets (> 30 min, Late only by the screen rule) and the typed options', () => {
    const c = wait as unknown as Fv & { filter: unknown };
    expect(c.filter).toBe('agNumberColumnFilter');
    expect(c.filterValueGetter({ data: rows[3] })).toBe(81860);
    expect(presetOf(wait, 'wgOver30').predicate([], 41)).toBe(true);
    expect(presetOf(wait, 'wgOver30').predicate([], 5)).toBe(false);
    expect(presetOf(durationCol<W>({}, r => r.min, { lateAfter: 45 }), 'wgLate').predicate([], 41)).toBe(false);
    expect(waitPresets().map(p => p.displayName)).toEqual(['Late only', '> 30 min', '> 1 h', '> 4 h', '> 1 day']);
    expect(c.filterParams.filterOptions).toEqual(expect.arrayContaining(['greaterThan', 'lessThan', 'inRange']));
  });

  it('ONE formatter: over 24h reads "2d 4h", never "1364h 20m"', () => {
    expect(durationText(41)).toBe('41m');
    expect(durationText(419)).toBe('6h 59m');
    expect(durationText(81860)).toBe('56d 20h');
    expect(durationText(52 * 60)).toBe('2d 4h');
    expect(durationText(-12)).toBe('12m');
    expect(durationText(null)).toBe('—');
    expect(durationText(Number.NaN)).toBe('—');
  });
});

describe('money — "₹450 due" vs "Paid" sorts on the amount (paise)', () => {
  type P = { id: string; due: number | null };
  const pay = moneyCol<P>({ colId: 'pay' }, r => r.due);
  const rows: P[] = [{ id: 'due450', due: 450 }, { id: 'paid', due: 0 }, { id: 'notbilled', due: null }, { id: 'due1200.5', due: 1200.5 }, { id: 'due99.99', due: 99.99 }];
  it('asc = Paid (0) first, then the smallest due; not billed last both ways', () => {
    expect(sortRows(pay, rows).map(r => r.id)).toEqual(['paid', 'due99.99', 'due450', 'due1200.5', 'notbilled']);
    expect(sortRows(pay, rows, true).map(r => r.id)).toEqual(['due1200.5', 'due450', 'due99.99', 'paid', 'notbilled']);
  });
  it('paise are integers (no float drift); the filter is in rupees with Has dues / Nothing due', () => {
    expect((pay.valueGetter as (p: { data: P }) => unknown)({ data: rows[4] })).toBe(9999);
    expect((pay as unknown as Fv).filterValueGetter({ data: rows[0] })).toBe(450);
    expect(presetOf(pay, 'wgDue').predicate([], 450)).toBe(true);
    expect(presetOf(pay, 'wgDue').predicate([], 0)).toBe(false);
    expect(presetOf(pay, 'wgClear').predicate([], 0)).toBe(true);
    expect(presetOf(pay, 'wgClear').predicate([], null)).toBe(false);
  });
});

describe('ratios — "0 of 2 drawn" sorts on done / total', () => {
  type S = { id: string; c: { done: number; total: number } | null };
  const col = ratioCol<S>({ colId: 'samples' }, r => r.c);
  const rows: S[] = [
    { id: '1of2', c: { done: 1, total: 2 } }, { id: 'all3', c: { done: 3, total: 3 } }, { id: 'none', c: null },
    { id: '0of2', c: { done: 0, total: 2 } }, { id: '2of3', c: { done: 2, total: 3 } }, { id: '0of1', c: { done: 0, total: 1 } },
  ];
  it('asc = least done first (0 of 2 before 0 of 1: more still to draw); no tubes last both ways', () => {
    expect(sortRows(col, rows).map(r => r.id)).toEqual(['0of2', '0of1', '1of2', '2of3', 'all3', 'none']);
    expect(sortRows(col, rows, true).map(r => r.id)).toEqual(['all3', '2of3', '1of2', '0of1', '0of2', 'none']);
  });
  it('filter = percent done with None yet / Partly / All done', () => {
    expect((col as unknown as Fv).filterValueGetter({ data: rows[0] })).toBe(50);
    expect(presetOf(col, 'wgNone').predicate([], 0)).toBe(true);
    expect(presetOf(col, 'wgSome').predicate([], 50)).toBe(true);
    expect(presetOf(col, 'wgAll').predicate([], 100)).toBe(true);
    expect(ratioValue(1, 0)).toBeNull();
  });
});

describe('dates — sort on epoch, date filter', () => {
  type T = { id: string; at: string | null };
  const col = dateCol<T>({ colId: 'when' }, r => r.at);
  const rows: T[] = [
    { id: 'yesterday', at: '2026-11-20T09:30:00Z' }, { id: 'none', at: null }, { id: 'today-late', at: '2026-11-21T18:05:00Z' },
    { id: 'today-early', at: '2026-11-21T04:10:00Z' }, { id: 'bad', at: 'not a date' }, { id: 'oct', at: '2026-10-01T12:00:00Z' },
  ];
  it('asc oldest first, desc newest first; unknown / unparseable last both ways', () => {
    expect(sortRows(col, rows).map(r => r.id)).toEqual(['oct', 'yesterday', 'today-early', 'today-late', 'none', 'bad']);
    expect(sortRows(col, rows, true).map(r => r.id)).toEqual(['today-late', 'today-early', 'yesterday', 'oct', 'none', 'bad']);
    expect((col as unknown as { filter: unknown }).filter).toBe('agDateColumnFilter');
    expect(epochOf('2026-11-21T00:00:00Z')).toBe(Date.parse('2026-11-21T00:00:00Z'));
    expect(epochOf('')).toBeNull();
  });
});

describe('tokens — day then number ("2 · 1 Oct" is an older day than today\'s 12)', () => {
  const today = '2026-11-21';
  it('tokenValue: older day first, then the number; none = null', () => {
    const v = [tokenValue(12, today, today), tokenValue(2, '2026-10-01', today), tokenValue(3, today, today), tokenValue(30, '2026-11-20', today), tokenValue(null, today, today)];
    expect(agSort(v, numComparator)).toEqual([v[1], v[3], v[2], v[0], null]);
    expect(agSort(v, numComparator, true)).toEqual([v[0], v[2], v[3], v[1], null]);
  });
  it('from the chip LABEL: "12", "#12", "R-5", "2 · 1 Oct" (and a December token read in January is last year\'s)', () => {
    expect(tokenLabelValue('12', today)).toBe(tokenValue(12, today, today));
    expect(tokenLabelValue('#12', today)).toBe(tokenValue(12, today, today));
    expect(tokenLabelValue('R-5', today)).toBe(tokenValue(5, today, today));
    expect(tokenLabelValue('2 · 1 Oct', today)).toBe(tokenValue(2, '2026-10-01', today));
    expect(tokenLabelValue('4 · 30 Dec', '2027-01-02')).toBe(tokenValue(4, '2026-12-30', '2027-01-02'));
    expect(tokenLabelValue('', today)).toBeNull();
    const labels = ['12', '2 · 1 Oct', '3', '30 · 20 Nov', ''];
    expect(agSort(labels.map(l => ({ l, v: tokenLabelValue(l, today) })), (a, b, _x, _y, d) => numComparator((a as { v: number }).v, (b as { v: number }).v, _x, _y, d)).map(x => x.l))
      .toEqual(['2 · 1 Oct', '30 · 20 Nov', '3', '12', '']);
  });
  it('tokenCol = text filter on the label + numeric sort', () => {
    type K = { l: string; no: number; day: string };
    const c = tokenCol<K>({ colId: 'token' }, r => r.l, r => tokenValue(r.no, r.day, today));
    expect((c as unknown as { filter: unknown }).filter).toBe('agTextColumnFilter');
    const rows: K[] = [{ l: '12', no: 12, day: today }, { l: '2 · 1 Oct', no: 2, day: '2026-10-01' }, { l: '3', no: 3, day: today }];
    expect(sortRows(c, rows).map(r => r.l)).toEqual(['2 · 1 Oct', '3', '12']);
  });
});

describe('every helper builds sort + filter together (a column cannot be made without a sort)', () => {
  type R = { name: string; n: number | null; s: string; at: string | null; c: { done: number; total: number } | null };
  const cols: Array<[string, ColDef<R>]> = [
    ['textCol', textCol<R>({ colId: 'a' }, r => r.name)],
    ['valuesCol', valuesCol<R>({ colId: 'b' }, r => r.s, class {})],
    ['valuesCol rank', valuesCol<R>({ colId: 'b2' }, r => r.s, class {}, 'center', r => (r.s === 'Urgent' ? 0 : 1))],
    ['numberCol', numberCol<R>({ colId: 'c' }, r => r.n)],
    ['durationCol', durationCol<R>({ colId: 'd' }, r => r.n)],
    ['moneyCol', moneyCol<R>({ colId: 'e' }, r => r.n)],
    ['ratioCol', ratioCol<R>({ colId: 'f' }, r => r.c)],
    ['dateCol', dateCol<R>({ colId: 'g' }, r => r.at)],
    ['tokenCol', tokenCol<R>({ colId: 'h' }, r => r.s, r => r.n)],
    ['shapeCol progress', shapeCol<R>({ colId: 'i' }, 'center', r => r.n)],
    ['choiceCol', choiceCol<R, object>({ colId: 'j' }, {}, class {}, { text: r => r.s })],
  ];
  it.each(cols)('%s: sortable asc → desc → none, comparator + valueGetter + filter', (_n, c) => {
    expect(sortsAndFilters(c as ColDef<unknown>)).toBe(true);
    expect(c.sortingOrder).toEqual(SORT_CYCLE);
    expect(SORT_CYCLE).toEqual(['asc', 'desc', null]);
  });
  it('a categorical column with a rank sorts by the rank (Urgent before Normal), not the words', () => {
    const c = valuesCol<R>({ colId: 'p' }, r => r.s, class {}, 'center', r => (r.s === 'Urgent' ? 0 : 1));
    const rows = [{ s: 'Normal' }, { s: 'Urgent' }, { s: 'Normal' }] as R[];
    expect(sortRows(c, rows).map(r => r.s)).toEqual(['Urgent', 'Normal', 'Normal']);
  });
  it('a shape without progress is decoration: neither sorts nor filters', () => {
    const c = shapeCol<R>({ colId: 'ring' });
    expect(c.sortable).toBe(false);
    expect(c.filter).toBe(false);
  });
  it('a detail row that returns its parent\'s value stays right under its parent (stable ties)', () => {
    type Dr = { id: string; v: number };
    const c = numberCol<Dr>({}, r => r.v);
    const rows: Dr[] = [{ id: 'P1', v: 5 }, { id: 'P1-detail', v: 5 }, { id: 'P2', v: 1 }, { id: 'P3', v: 5 }];
    expect(sortRows(c, rows).map(r => r.id)).toEqual(['P2', 'P1', 'P1-detail', 'P3']);
    expect(sortRows(c, rows, true).map(r => r.id)).toEqual(['P1', 'P1-detail', 'P3', 'P2']);
  });
});
