import { describe, expect, it } from 'vitest';
import type { MappedValue, RunDto } from './instrument.models';
import {
  AppliedMap, LATEST_VALUES, PrefillLine, analyzerBadge, defaultRun, planPrefill, prefillKey, runOptions, targetParam, valuesForRun,
  valuesForRuns,
} from './instrument-prefill';

function mv(orderTestId: string | null, value: string, extra: Partial<MappedValue> = {}): MappedValue {
  return { analyzerCode: 'X', orderTestId, testId: null, catalogKey: 'K', parameterName: null, value, rawValue: value,
    unit: null, rawUnit: null, flags: [], ...extra };
}
function run(id: string, values: MappedValue[], extra: Partial<RunDto> = {}): RunDto {
  return { messageId: id, instrumentId: 'i1', instrumentName: 'Sysmex XN', receivedAt: '2026-09-30T05:12:00Z', runAt: null,
    state: 'matched', values, ...extra };
}
const LINES: PrefillLine[] = [
  { orderTestId: 'wbc', params: [{ name: 'result', title: 'Result' }] },
  { orderTestId: 'hgb', params: [{ name: 'result' }] },
  { orderTestId: 'diff', params: [{ name: 'neut', title: 'Neutrophils' }, { name: 'lymph', title: 'Lymphocytes' }] },
];
function screen(values: Record<string, Record<string, unknown>>) {
  return (ot: string, p: string) => values[ot]?.[p];
}
const fmt = (iso: string | null) => (iso ? '10:42 am' : '');

describe('instrument prefill — targeting', () => {
  it('null parameterName → the line’s first / only parameter', () => {
    expect(targetParam({ parameterName: null }, LINES[0])).toBe('result');
    expect(targetParam({ parameterName: null }, LINES[2])).toBe('neut');
  });
  it('parameterName honoured (exact, then case-insensitive name or title)', () => {
    expect(targetParam({ parameterName: 'lymph' }, LINES[2])).toBe('lymph');
    expect(targetParam({ parameterName: 'LYMPH' }, LINES[2])).toBe('lymph');
    expect(targetParam({ parameterName: 'Lymphocytes' }, LINES[2])).toBe('lymph');
  });
  it('an unknown parameterName or a line with no parameters → no target', () => {
    expect(targetParam({ parameterName: 'eos' }, LINES[2])).toBeNull();
    expect(targetParam({ parameterName: null }, { orderTestId: 'z', params: [] })).toBeNull();
  });
  it('values without an order line on screen are ignored', () => {
    const m = valuesForRun(run('m1', [mv(null, '1'), mv('not-here', '2'), mv('wbc', '7800')]), LINES);
    expect(Object.keys(m)).toEqual([prefillKey('wbc', 'result')]);
  });
});

describe('instrument prefill — never overwrite typed values', () => {
  it('fills EMPTY fields only; typed fields are kept', () => {
    const plan = planPrefill({
      run: run('m1', [mv('wbc', '7800'), mv('hgb', '13.2')]),
      lines: LINES,
      current: screen({ hgb: { result: '12.9' } }),
    });
    expect(plan.writes).toEqual([{ orderTestId: 'wbc', paramName: 'result', value: '7800' }]);
    expect(plan.kept).toEqual([prefillKey('hgb', 'result')]);
  });
  it('whitespace-only counts as empty; an equal value is not re-written', () => {
    const plan = planPrefill({
      run: run('m1', [mv('wbc', '7800'), mv('hgb', '13.2')]),
      lines: LINES,
      current: screen({ wbc: { result: '  ' }, hgb: { result: '13.2' } }),
    });
    expect(plan.writes).toEqual([{ orderTestId: 'wbc', paramName: 'result', value: '7800' }]);
  });
  it('multi-parameter line: parameterName decides the field', () => {
    const plan = planPrefill({
      run: run('m1', [mv('diff', '61.0', { parameterName: 'neut' }), mv('diff', '30.5', { parameterName: 'lymph' })]),
      lines: LINES,
      current: screen({}),
    });
    expect(plan.writes).toEqual([
      { orderTestId: 'diff', paramName: 'neut', value: '61.0' },
      { orderTestId: 'diff', paramName: 'lymph', value: '30.5' },
    ]);
  });
});

describe('instrument prefill — run switching', () => {
  const r1 = run('m1', [mv('wbc', '7800'), mv('hgb', '13.2')]);
  const r2 = run('m2', [mv('wbc', '8100')], { receivedAt: '2026-09-30T04:00:00Z' });

  it('re-fills fields still equal to the previous prefill; typed ones stay', () => {
    const first = planPrefill({ run: r1, lines: LINES, current: screen({}) });
    // The tech then edits HGB; WBC stays as prefilled.
    const now = { wbc: { result: '7800' }, hgb: { result: '13.2' } };
    const switched = planPrefill({ run: r2, lines: LINES, current: screen({ ...now, hgb: { result: '13.5' } }), previous: first.applied });
    expect(switched.writes).toEqual([{ orderTestId: 'wbc', paramName: 'result', value: '8100' }]);
  });
  it('clears an untouched field the old run filled but the new run lacks', () => {
    const first = planPrefill({ run: r1, lines: LINES, current: screen({}) });
    const switched = planPrefill({ run: r2, lines: LINES, current: screen({ wbc: { result: '7800' }, hgb: { result: '13.2' } }), previous: first.applied });
    expect(switched.writes).toContainEqual({ orderTestId: 'hgb', paramName: 'result', value: '' });
  });
  it('never clears a field the tech changed after the prefill', () => {
    const first = planPrefill({ run: r1, lines: LINES, current: screen({}) });
    const switched = planPrefill({ run: r2, lines: LINES, current: screen({ wbc: { result: '7800' }, hgb: { result: '14' } }), previous: first.applied });
    expect(switched.writes.find((w) => w.orderTestId === 'hgb')).toBeUndefined();
  });
  it('defaultRun = newest (first); runOptions: "Latest values" first, then each run', () => {
    expect(defaultRun([r1, r2])?.messageId).toBe('m1');
    expect(defaultRun([])).toBeNull();
    const opts = runOptions([r1, r2], fmt);
    expect(opts[0]).toEqual({ value: LATEST_VALUES, label: 'Latest values (all runs)' });
    expect(opts[1]).toEqual({ value: 'm1', label: 'Run: Sysmex XN · 10:42 am' });
    expect(opts[2]).toEqual({ value: 'm2', label: 'Run: Sysmex XN · 10:42 am' });
    expect(runOptions([], fmt)).toEqual([]);
  });
});

describe('instrument prefill — merged "Latest values" (one message per test)', () => {
  // Snibe Maglumi X3, tube 261000012: TT3 (6:17), TT4 (6:17), TSH (6:32) — three messages.
  const T_LINES: PrefillLine[] = [
    { orderTestId: 'tt3', params: [{ name: 'result' }] },
    { orderTestId: 'tt4', params: [{ name: 'result' }] },
    { orderTestId: 'tsh', params: [{ name: 'result' }] },
  ];
  const tsh = run('m3', [mv('tsh', '2.40')], { instrumentName: 'Maglumi X3', runAt: '2026-10-24T01:02:00Z' });
  const tt4 = run('m2', [mv('tt4', '8.10')], { instrumentName: 'Maglumi X3', runAt: '2026-10-24T00:47:00Z' });
  const tt3 = run('m1', [mv('tt3', '1.21')], { instrumentName: 'Maglumi X3', runAt: '2026-10-24T00:47:00Z' });

  it('fills every test from its own run (not just the newest message)', () => {
    const plan = planPrefill({ runs: [tsh, tt4, tt3], lines: T_LINES, current: screen({}) });
    expect(plan.writes).toEqual(expect.arrayContaining([
      { orderTestId: 'tt3', paramName: 'result', value: '1.21' },
      { orderTestId: 'tt4', paramName: 'result', value: '8.10' },
      { orderTestId: 'tsh', paramName: 'result', value: '2.40' },
    ]));
    expect(plan.writes).toHaveLength(3);
    // each badge names its own run
    expect(plan.applied[prefillKey('tt3', 'result')].messageId).toBe('m1');
    expect(plan.applied[prefillKey('tsh', 'result')].messageId).toBe('m3');
  });

  it('a re-run of one test: the newer value wins, the others stay', () => {
    const tsh2 = run('m4', [mv('tsh', '2.95')], { instrumentName: 'Maglumi X3', runAt: '2026-10-24T01:30:00Z' });
    const m = valuesForRuns([tsh2, tsh, tt4, tt3], T_LINES);
    expect(m[prefillKey('tsh', 'result')].value).toBe('2.95');
    expect(m[prefillKey('tt3', 'result')].value).toBe('1.21');
    expect(m[prefillKey('tt4', 'result')].value).toBe('8.10');
  });

  it('newest by run time even if the list is not ordered; a late older value never wins', () => {
    const late = run('m0', [mv('tt3', '0.90')], { runAt: '2026-10-24T00:10:00Z', state: 'superseded' });
    const m = valuesForRuns([late, tt3, tsh], T_LINES);
    expect(m[prefillKey('tt3', 'result')].value).toBe('1.21');
  });

  it('equal times keep the server order (newest first)', () => {
    const a = run('a', [mv('tt3', '1.30')], { runAt: '2026-10-24T00:47:00Z' });
    const b = run('b', [mv('tt3', '1.21')], { runAt: '2026-10-24T00:47:00Z' });
    expect(valuesForRuns([a, b], T_LINES)[prefillKey('tt3', 'result')].messageId).toBe('a');
  });

  it('whole-panel analyzers (CBC): identical to the newest run when it carries every field', () => {
    const newer = run('n', [mv('wbc', '8100'), mv('hgb', '13.4')], { runAt: '2026-10-24T05:00:00Z' });
    const older = run('o', [mv('wbc', '7800'), mv('hgb', '13.2')], { runAt: '2026-10-24T04:00:00Z', state: 'superseded' });
    expect(valuesForRuns([newer, older], LINES)).toEqual(valuesForRun(newer, LINES));
  });

  it('switching from "Latest values" to one run shows only that run (old fill cleared when untouched)', () => {
    const merged = planPrefill({ runs: [tsh, tt4, tt3], lines: T_LINES, current: screen({}) });
    const onScreen = { tt3: { result: '1.21' }, tt4: { result: '8.10' }, tsh: { result: '2.40' } };
    const one = planPrefill({ run: tsh, lines: T_LINES, current: screen(onScreen), previous: merged.applied });
    expect(one.writes).toEqual(expect.arrayContaining([
      { orderTestId: 'tt3', paramName: 'result', value: '' },
      { orderTestId: 'tt4', paramName: 'result', value: '' },
    ]));
    expect(Object.keys(one.applied)).toEqual([prefillKey('tsh', 'result')]);
  });

  it('never overwrites a typed value', () => {
    const plan = planPrefill({ runs: [tsh, tt4, tt3], lines: T_LINES, current: screen({ tt4: { result: '7.9' } }) });
    expect(plan.writes.find((w) => w.orderTestId === 'tt4')).toBeUndefined();
    expect(plan.kept).toEqual([prefillKey('tt4', 'result')]);
  });

  it('no runs → nothing', () => {
    expect(planPrefill({ runs: [], lines: T_LINES, current: screen({}) })).toEqual({ writes: [], applied: {}, kept: [] });
    expect(valuesForRuns(null, T_LINES)).toEqual({});
  });
});

describe('instrument prefill — badge + flags', () => {
  const applied: AppliedMap = valuesForRun(
    run('m1', [mv('wbc', '7800', { rawValue: '7.8', rawUnit: '10^3/uL', unit: 'cells/µL', flags: ['H', ''], analyzerCode: 'WBC' })],
      { runAt: '2026-09-30T05:12:00Z' }),
    LINES,
  );
  it('value as prefilled → "From <instrument> · time" + analyzer flags', () => {
    const b = analyzerBadge(applied, 'wbc', 'result', '7800', fmt)!;
    expect(b.kind).toBe('from');
    expect(b.label).toBe('From Sysmex XN · 10:42 am');
    expect(b.flags).toEqual(['H']);
    expect(b.title).toContain('sent 7.8 10^3/uL');
  });
  it('tech changed it → an "edited" badge naming the analyzer value', () => {
    const b = analyzerBadge(applied, 'wbc', 'result', '7900', fmt)!;
    expect(b.kind).toBe('edited');
    expect(b.label).toBe('Analyzer 7800');
  });
  it('cleared field or a field without a prefill → no badge', () => {
    expect(analyzerBadge(applied, 'wbc', 'result', '', fmt)).toBeNull();
    expect(analyzerBadge(applied, 'hgb', 'result', '13', fmt)).toBeNull();
  });
  it('no runs / an empty (404-shaped) payload plans nothing', () => {
    const plan = planPrefill({ run: null, lines: LINES, current: screen({}) });
    expect(plan).toEqual({ writes: [], applied: {}, kept: [] });
  });
});
