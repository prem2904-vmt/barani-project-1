import {
  FLAG_CONDITIONS, analyzeLines, evaluateRules, flagCondLabel, flagCondMatches, lineReach, lineWords,
  normalizeFlagCond, reachWords, type CondLookup, type CondRule,
} from './flag-conditions';
import { tryValue, type InsightParam } from './range-insight';

const wbc: InsightParam = {
  unit: '10³/µL',
  referenceRanges: [{ segment: 'normal', min: 4, max: 11, criticalLow: 3.5, criticalHigh: 20 }],
};

describe('flag condition semantics — critical is the more severe part of high / low', () => {
  it('the matrix: each choice matches exactly its levels', () => {
    const m = (c: string, l: Parameters<typeof flagCondMatches>[1]) => flagCondMatches(normalizeFlagCond(c), l);
    expect(m('critical_high', 'critical_high')).toBe(true);
    expect(m('critical_high', 'high')).toBe(false);
    expect(m('high_only', 'high')).toBe(true);
    expect(m('high_only', 'critical_high')).toBe(false);
    expect(m('high_any', 'high')).toBe(true);
    expect(m('high_any', 'critical_high')).toBe(true);
    expect(m('high_any', 'normal')).toBe(false);
    expect(m('low_any', 'critical_low')).toBe(true);
    expect(m('low_only', 'critical_low')).toBe(false);
    expect(m('critical_any', 'critical_low')).toBe(true);
    expect(m('critical_any', 'high')).toBe(false);
    expect(m('abnormal', 'low')).toBe(true);
    expect(m('abnormal', 'normal')).toBe(false);
    expect(m('abnormal', 'abnormal')).toBe(true);     // qualitative A
    expect(m('normal', 'abnormal')).toBe(false);
    expect(m('normal', null)).toBe(false);            // not flaggable
    expect(m('bogus', 'high')).toBe(false);
  });

  it('legacy single-letter values keep the STORED code meaning (C is never H)', () => {
    expect(normalizeFlagCond('H')).toBe('high_only');
    expect(normalizeFlagCond('h')).toBe('high_only');
    expect(normalizeFlagCond('L')).toBe('low_only');
    expect(normalizeFlagCond('C')).toBe('critical_any');
    expect(normalizeFlagCond('CL')).toBe('critical_low');
    expect(normalizeFlagCond('ch')).toBe('critical_high');
    expect(normalizeFlagCond('N')).toBe('normal');
    expect(normalizeFlagCond('A')).toBe('abnormal');
    expect(flagCondLabel('H')).toBe('is High (not critical) — stored as flag H');
    expect(flagCondLabel('high_any')).toBe('is High or critical high');
    expect(normalizeFlagCond('high')).toBeNull();     // ambiguous word: never guessed
  });

  it('offers the precise choices in severity order', () => {
    expect(FLAG_CONDITIONS.map(o => o.label)).toEqual([
      'is Critical high', 'is High (not critical)', 'is High or critical high', 'is Normal',
      'is Low or critical low', 'is Low (not critical)', 'is Critical low',
      'is Critical (high or low)', 'is Abnormal (any flag)',
    ]);
  });
});

describe('engine mirror — first match wins, else is the fallback', () => {
  const at = (v: number): CondLookup => name => name === 'WBC'
    ? { value: v, level: tryValue(wbc, v, null, null).level } : undefined;
  const rules: CondRule[] = [
    { if: { parameter: 'WBC', operator: 'flag', value: 'critical_high' }, then: { cells: { description: 'crit' } } },
    { if: { parameter: 'WBC', operator: 'flag', value: 'high_any' }, then: { cells: { description: 'high' } } },
    { else: true, then: { cells: { description: 'base' } } },
  ];

  it('a critical-high value takes the first (critical) line, a high one the second', () => {
    expect(evaluateRules(rules, at(25))).toBe(0);
    expect(evaluateRules(rules, at(15))).toBe(1);
    expect(evaluateRules(rules, at(8))).toBe(2);
  });

  it('numeric leaves, and / or, and has_images behave like mw MatchLeaf', () => {
    const between: CondRule[] = [{ if: { parameter: 'WBC', operator: '>=', value: 4, and: { parameter: 'WBC', operator: '<=', value: 11 } }, then: { show: true } }];
    expect(evaluateRules(between, at(4))).toBe(0);
    expect(evaluateRules(between, at(11.01))).toBeNull();
    expect(evaluateRules([{ if: { parameter: 'WBC', operator: '>', value: '10' }, then: { show: true } }], at(10.5))).toBe(0);
    expect(evaluateRules([{ if: { has_images: true }, then: { show: true } }], at(1))).toBe(0);
    expect(evaluateRules([{ if: { parameter: 'Other', operator: '>', value: 1 }, then: { show: true } }], at(9))).toBeNull();
  });
});

describe('condition analysis — unreachable, overlap + winner, never produced, contradictions', () => {
  it('"High (not critical)" AFTER "High or critical high" can never be used (first match)', () => {
    const issues = analyzeLines([
      { operator: 'flag', value: 'high_any' },
      { operator: 'flag', value: 'high_only' },
    ], wbc, 'first-match');
    expect(issues).toEqual([{ severity: 'warning', line: 1, message: 'Never used — line 1 already catches every such result. Move this line above it.' }]);
  });

  it('the right order is clean: critical first, then the rest of high', () => {
    expect(analyzeLines([
      { operator: 'flag', value: 'critical_high' },
      { operator: 'flag', value: 'high_any' },
    ], wbc, 'first-match')).toEqual([{ severity: 'warning', line: 1, message: 'Overlaps line 1 for Critical high results — line 1 wins there (first match).' }]);
    expect(analyzeLines([
      { operator: 'flag', value: 'critical_high' },
      { operator: 'flag', value: 'high_only' },
    ], wbc, 'first-match')).toEqual([]);
  });

  it('numeric vs flag overlap names the winner', () => {
    const i = analyzeLines([
      { operator: '>', value: 15 },
      { operator: 'flag', value: 'high_only' },
    ], wbc, 'first-match');
    expect(i).toEqual([{ severity: 'warning', line: 1, message: 'Overlaps line 1 for High results — line 1 wins there (first match).' }]);
  });

  it('a flag the ranges can never produce', () => {
    const noCrit: InsightParam = { unit: 'x', referenceRanges: [{ segment: 'n', min: 4, max: 11 }] };
    expect(analyzeLines([{ operator: 'flag', value: 'critical_high' }], noCrit, 'first-match'))
      .toEqual([{ severity: 'warning', line: 0, message: 'Never used — these ranges never produce Critical high.' }]);
  });

  it('contradictory / incomplete numeric lines are errors', () => {
    const i = analyzeLines([
      { operator: 'between', value: 10, value2: 5 },
      { operator: '>', value: '' },
      { operator: 'flag', value: 'sideways' },
    ], wbc, 'first-match');
    expect(i.filter(x => x.severity === 'error').map(x => x.message)).toEqual([
      '‘between 10 and 5’ can never match — the first value must be the lower one.',
      '‘is above’ needs a number.',
      'Unknown flag condition “sideways”.',
    ]);
  });

  it('independent blocks: both print — say for which results', () => {
    const i = analyzeLines([
      { operator: 'flag', value: 'high_any' },
      { operator: 'flag', value: 'critical_high' },
    ], wbc, 'independent');
    expect(i).toEqual([{ severity: 'warning', line: 1, message: 'Prints together with block 1 for Critical high results.' }]);
    // "except when" blocks are negated
    expect(analyzeLines([
      { operator: 'flag', value: 'normal' },
      { operator: 'flag', value: 'normal', negate: true },
    ], wbc, 'independent')).toEqual([]);
  });

  it('reach + words for the hint under a line', () => {
    expect(reachWords(lineReach({ operator: '>', value: 15 }, wbc))).toBe('High and Critical high results');
    expect(lineWords({ operator: 'between', value: 4, value2: 11 })).toBe('is between 4 and 11');
    expect(lineWords({ operator: 'flag', value: 'low_any' })).toBe('is Low or critical low');
  });
});
