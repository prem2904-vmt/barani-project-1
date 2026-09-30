import { describe, expect, it } from 'vitest';
import type { MappedValue, RunDto } from './instrument.models';
import {
  AppliedMap, PrefillLine, analyzerBadge, defaultRun, planPrefill, prefillKey, runOptions, targetParam, valuesForRun,
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
  it('defaultRun = newest (first); runOptions label the newest "Run: latest"', () => {
    expect(defaultRun([r1, r2])?.messageId).toBe('m1');
    expect(defaultRun([])).toBeNull();
    const opts = runOptions([r1, r2], fmt);
    expect(opts[0]).toEqual({ value: 'm1', label: 'Run: latest · Sysmex XN · 10:42 am' });
    expect(opts[1].label).toBe('Run: Sysmex XN · 10:42 am');
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
