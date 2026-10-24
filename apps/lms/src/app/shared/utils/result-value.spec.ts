import {
  flagRangeAgainstBand, isInvalidNumericValue, nextDouble, liveRangeFlag, parseRangeValue, rangeAllowed,
  rangeFlagRule, rangeKeyAllowed, rangePasteText, rangeValueFor,
} from './result-value';

/**
 * Range / censored results (owner 2026-10-24). The parser table is the SAME
 * as mw's `RangeResultValueTests` (Services/ResultValue.cs) so the bench chip
 * and the stored flag can never disagree.
 */
describe('parseRangeValue — the one grammar', () => {
  it.each([
    ['0-4', 'range', 0, 4],
    ['4-6', 'range', 4, 6],
    [' 0 - 4 ', 'range', 0, 4],
    ['0 – 4', 'range', 0, 4],
    ['0—4', 'range', 0, 4],
    ['1.5-2.25', 'range', 1.5, 2.25],
    ['4-4', 'range', 4, 4],
    ['<5', 'lt', 5, 5],
    ['< 5', 'lt', 5, 5],
    ['>100', 'gt', 100, 100],
    ['<=5', 'lte', 5, 5],
    ['>=0.5', 'gte', 0.5, 0.5],
    ['≤5', 'lte', 5, 5],
    ['≥5', 'gte', 5, 5],
  ] as const)('%s → %s %d..%d', (raw, kind, low, high) => {
    expect(parseRangeValue(raw)).toEqual({ kind, low, high });
  });

  it.each(['5', '-3', '6-4', '4-', '-4', '<', '<-5', '0-4-6', 'abc', '', '1e2', '<>5'])(
    '%s is not a range', raw => expect(parseRangeValue(raw)).toBeNull());

  it('non-strings are never ranges', () => {
    expect(parseRangeValue(4)).toBeNull();
    expect(parseRangeValue(null)).toBeNull();
    expect(parseRangeValue(undefined)).toBeNull();
    expect(parseRangeValue(['0-4'])).toBeNull();
  });
});

describe('the Test Master switch', () => {
  it('only allowRange === true opens a value to ranges', () => {
    expect(rangeAllowed({ allowRange: true })).toBe(true);
    expect(rangeAllowed({})).toBe(false);
    expect(rangeAllowed({ allowRange: false })).toBe(false);
    expect(rangeAllowed({ allowRange: 'true' as unknown as boolean })).toBe(false);
    expect(rangeAllowed(null)).toBe(false);
    expect(rangeValueFor({}, '0-4')).toBeNull();
    expect(rangeValueFor({ allowRange: true }, '0-4')).toEqual({ kind: 'range', low: 0, high: 4 });
  });

  it('rule defaults to ends', () => {
    expect(rangeFlagRule({})).toBe('ends');
    expect(rangeFlagRule({ rangeFlag: 'bogus' as never })).toBe('ends');
    expect(rangeFlagRule({ rangeFlag: 'middle' })).toBe('middle');
  });
});

describe('flagging by the rule (mirrors mw ResultValue.Level)', () => {
  const band = { min: 2, max: 5 };
  const crit = { criticalLow: 1, criticalHigh: 50 };
  const flag = (rule: 'ends' | 'upper' | 'lower' | 'middle', raw: string) =>
    flagRangeAgainstBand(band, parseRangeValue(raw)!, rule, crit)?.code ?? null;

  it.each([
    ['ends', '2-4', 'N'], ['ends', '4-6', 'H'], ['ends', '1.5-4', 'L'], ['ends', '1.5-6', 'H'],
    ['ends', '4-60', 'CH'], ['ends', '0.5-4', 'CL'], ['ends', '0.5-60', 'CH'],
    ['ends', '<5', 'N'], ['ends', '<6', 'H'], ['ends', '>100', 'CH'], ['ends', '<0.5', 'CL'],
    ['upper', '1.5-4', 'N'], ['upper', '4-6', 'H'],
    ['lower', '4-6', 'N'], ['lower', '1.5-4', 'L'],
    ['middle', '4-6', 'N'], ['middle', '4-8', 'H'], ['middle', '0-2', 'L'],
  ] as const)('%s %s → %s', (rule, raw, code) => expect(flag(rule, raw)).toBe(code));

  it.each([
    ['>100', { min: 0, max: 100 }, {}, 'H'],
    ['>50', { min: 0, max: 10 }, { criticalHigh: 50 }, 'CH'],
    ['<2', { min: 2, max: 10 }, {}, 'L'],
    ['<5', { min: 0, max: 5 }, {}, 'N'],
    ['<=5', { min: 0, max: 5 }, {}, 'N'],
    ['>=100', { min: 0, max: 100 }, {}, 'N'],
    ['<1', { min: 0, max: 10 }, { criticalLow: 1 }, 'CL'],
    ['>=50', { min: 0, max: 100 }, { criticalHigh: 50 }, 'N'],
  ] as const)('strict comparators: %s against %o %o → %s (mw table twin)', (raw, b, c, code) => {
    expect(flagRangeAgainstBand(b, parseRangeValue(raw)!, 'ends', c)?.code).toBe(code);
  });

  it('nextDouble steps one representable double', () => {
    expect(nextDouble(100, 1)).toBeGreaterThan(100);
    expect(nextDouble(100, -1)).toBeLessThan(100);
    expect(nextDouble(100, 1) - 100).toBeLessThan(1e-12);
    expect(nextDouble(-2, 1)).toBeGreaterThan(-2);
    expect(nextDouble(0, -1)).toBeLessThan(0);
  });

  it('no band and no criticals → nothing to judge', () => {
    expect(flagRangeAgainstBand(null, parseRangeValue('0-4')!, 'ends', null)).toBeNull();
  });

  it('liveRangeFlag picks the patient band like liveFlag', () => {
    const p = {
      allowRange: true, rangeFlag: 'ends' as const,
      referenceRanges: [{ min: 0, max: 5, sex: 'M' as const }, { min: 0, max: 3, sex: 'F' as const }],
    };
    const v = parseRangeValue('2-4')!;
    expect(liveRangeFlag(p, v, 'M', 40)?.code).toBe('N');
    expect(liveRangeFlag(p, v, 'F', 40)?.code).toBe('H');
  });
});

describe('entry guards', () => {
  it('keys: digits, one leading < / > (then =), a dash between numbers, one dot per number', () => {
    expect(rangeKeyAllowed('', '<')).toBe(true);
    expect(rangeKeyAllowed('4', '<')).toBe(false);
    expect(rangeKeyAllowed('<', '=')).toBe(true);
    expect(rangeKeyAllowed('4', '=')).toBe(false);
    expect(rangeKeyAllowed('0', '-')).toBe(true);
    expect(rangeKeyAllowed('<5', '-')).toBe(false);
    expect(rangeKeyAllowed('1.5', '.')).toBe(false);
    expect(rangeKeyAllowed('1.5-2', '.')).toBe(true);
    expect(rangeKeyAllowed('0', ' ')).toBe(true);
    expect(rangeKeyAllowed('', ' ')).toBe(false);
    expect(rangeKeyAllowed('0', 'a')).toBe(false);
    expect(rangeKeyAllowed('0', '7')).toBe(true);
  });

  it('paste: a range lands trimmed; anything else falls back to the numeric clean-up', () => {
    expect(rangePasteText(' 0 - 4 ')).toBe('0 - 4');
    expect(rangePasteText('<5')).toBe('<5');
    expect(rangePasteText('12 mg/dL')).toBeNull();
  });

  it('WITHOUT the switch the invalid check is exactly the old Number.isNaN rule', () => {
    const old = (raw: unknown) => raw === undefined || raw === null || raw === ''
      ? false : Number.isNaN(Number(String(raw).trim()));
    for (const raw of ['0-4', '<5', '>100', '5', ' 7 ', '-3', '4-', 'abc', '', null, undefined, 6, '1e2', '0x1A', 'Infinity'])
      expect(isInvalidNumericValue({}, raw)).toBe(old(raw));
  });

  it('WITH the switch a range is valid; junk is still invalid', () => {
    const p = { allowRange: true };
    expect(isInvalidNumericValue(p, '0-4')).toBe(false);
    expect(isInvalidNumericValue(p, '<5')).toBe(false);
    expect(isInvalidNumericValue(p, '5')).toBe(false);
    expect(isInvalidNumericValue(p, '6-4')).toBe(true);
    expect(isInvalidNumericValue(p, '4-')).toBe(true);
    expect(isInvalidNumericValue(p, 'abc')).toBe(true);
  });
});
