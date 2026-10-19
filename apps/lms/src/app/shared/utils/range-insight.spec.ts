import {
  bandLevel, groupAgeText, groupTitle, groupsOverlap, tryValue, validateRanges,
  type InsightBand, type InsightParam, type FlagLevel,
} from './range-insight';
import { liveFlag } from './result-flag';

/** The production verdict (liveFlag = mw FlagOne mirror) as a level. */
function prodLevel(p: InsightParam, v: number, sex: 'M' | 'F' | 'O' | null = null, age: number | null = null): FlagLevel | null {
  const f = liveFlag(p as never, v, sex, age);
  if (!f) return null;
  if (f.code === 'CL') return 'critical_low';
  if (f.code === 'CH') return 'critical_high';
  return f.code === 'L' ? 'low' : f.code === 'H' ? 'high' : 'normal';
}

describe('flag rule — the simple model: L, H, CL, CH; on a limit = not flagged', () => {
  const g: InsightBand = { sex: 'any', min: 4, max: 11, criticalLow: 3.5, criticalHigh: 20 };
  const p: InsightParam = { referenceRanges: [g] };
  it('below L → low, above H → high, below CL / above CH → critical', () => {
    expect(bandLevel(g, 3.4, p)).toBe('critical_low');
    expect(bandLevel(g, 3.9, p)).toBe('low');
    expect(bandLevel(g, 11.1, p)).toBe('high');
    expect(bandLevel(g, 20.1, p)).toBe('critical_high');
  });
  it('every limit itself is not flagged at its own level', () => {
    expect(bandLevel(g, 4, p)).toBe('normal');
    expect(bandLevel(g, 11, p)).toBe('normal');
    expect(bandLevel(g, 3.5, p)).toBe('low');       // on CL: not critical, still below L
    expect(bandLevel(g, 20, p)).toBe('high');       // on CH: not critical, still above H
  });
  it('one-sided groups are inclusive too; a blank side never flags', () => {
    expect(bandLevel({ max: 200 }, 200)).toBe('normal');
    expect(bandLevel({ max: 200 }, 200.1)).toBe('high');
    expect(bandLevel({ max: 200 }, -5)).toBe('normal');
    expect(bandLevel({ min: 60 }, 60)).toBe('normal');
    expect(bandLevel({ min: 60 }, 59.9)).toBe('low');
    expect(bandLevel({}, 5)).toBeNull();
  });
  it('legacy explicit strict ops still flag the limit until migrated', () => {
    expect(bandLevel({ max: 200, maxOp: 'lt' }, 200)).toBe('high');
    expect(bandLevel({ min: 60, minOp: 'gt' }, 60)).toBe('low');
  });
  it('a group’s own CL / CH beat the legacy test-wide pair', () => {
    const q: InsightParam = { criticalHigh: 30, referenceRanges: [{ min: 1, max: 5 }, { min: 1, max: 5, criticalHigh: 9 }] };
    expect(bandLevel(q.referenceRanges![0], 10, q)).toBe('high');
    expect(bandLevel(q.referenceRanges![1], 10, q)).toBe('critical_high');
  });
});

describe('try a value — same group + flag as result entry', () => {
  const hb: InsightParam = {
    unit: 'g/dL',
    referenceRanges: [
      { sex: 'M', minAge: 18, min: 13, max: 17, criticalLow: 7, criticalHigh: 20 },
      { sex: 'F', minAge: 18, min: 12, max: 15, criticalLow: 6.5, criticalHigh: 20 },
      { sex: 'any', minAge: 0, maxAge: 18, min: 11, max: 14, criticalLow: 7, criticalHigh: 20 },
    ],
  };

  it('picks the group by sex/age and flags like liveFlag at every boundary', () => {
    for (const v of [6, 6.5, 6.9, 7, 11, 12, 12.9, 13, 15, 15.1, 17, 17.1, 20, 20.1])
      for (const s of ['M', 'F', null] as const)
        for (const a of [40, 10, 18, null])
          expect(tryValue(hb, v, s, a).level).toBe(prodLevel(hb, v, s, a));
  });

  it('reports which group and whether it was chosen on merit', () => {
    const w = tryValue(hb, 6.8, 'F', 30);
    expect(w.bandIndex).toBe(1);
    expect(w.onMerit).toBe(true);
    expect(w.level).toBe('low');
    expect(tryValue(hb, 6.4, 'F', 30)).toMatchObject({ level: 'critical_low', code: 'CL' });
    expect(tryValue(hb, 25, null, null).onMerit).toBe(false);
  });

  it('a patient exactly on a shared birthday belongs to the group that starts there', () => {
    // "1–6 years" then "6–10 years": the first runs up to the 6th birthday.
    const kids: InsightParam = { referenceRanges: [
      { sex: 'any', minAge: 1, maxAge: 6, min: 1, max: 2 },
      { sex: 'any', minAge: 6, maxAge: 10, min: 3, max: 4 },
    ] };
    expect(tryValue(kids, 2.5, null, 6).bandIndex).toBe(1);
    expect(tryValue(kids, 2.5, null, 5.9).bandIndex).toBe(0);
    expect(tryValue(kids, 2.5, null, 10).bandIndex).toBe(1);   // age-to stays inclusive
  });
});

describe('who a group covers', () => {
  it('reads "Female · 18 years+", "Anyone · 0–28 days", "Anyone · Any age"', () => {
    expect(groupTitle({ sex: 'F', minAge: 18 })).toBe('Female · 18 years+');
    expect(groupTitle({ minAge: 0, maxAge: 28, ageUnit: 'days' })).toBe('Anyone · 0–28 days');
    expect(groupTitle({})).toBe('Anyone · Any age');
    expect(groupAgeText({ maxAge: 1 })).toBe('up to 1 year');
    expect(groupAgeText({ minAge: 1, maxAge: 6 })).toBe('1–6 years');
  });
  it('overlap: Anyone overlaps Male and Female; touching ages do not; profiles never mix', () => {
    expect(groupsOverlap({ sex: 'any' }, { sex: 'M' })).toBe(true);
    expect(groupsOverlap({ sex: 'M' }, { sex: 'F' })).toBe(false);
    expect(groupsOverlap({ minAge: 1, maxAge: 6 }, { minAge: 6, maxAge: 10 })).toBe(false);
    expect(groupsOverlap({ minAge: 0, maxAge: 13, ageUnit: 'months' }, { minAge: 1, maxAge: 5 })).toBe(true);
    expect(groupsOverlap({ minAge: 0, maxAge: 12, ageUnit: 'months' }, { minAge: 1, maxAge: 5 })).toBe(false);
    expect(groupsOverlap({ profileCode: 'CSF' }, {})).toBe(false);
    // Legacy category tiers on the same population overlap (they must be merged).
    expect(groupsOverlap({ segment: 'prediabetes', min: 100, max: 125 }, { segment: 'diabetes', min: 126 })).toBe(true);
  });
});

describe('range validation — every issue blocks Save', () => {
  const one = (b: Partial<InsightBand>): InsightParam => ({ unit: 'mg/dL', referenceRanges: [{ sex: 'any', ...b }] });
  const msgs = (p: InsightParam) => validateRanges(p).map(i => i.message);

  it('a clean table has no issues', () => {
    expect(validateRanges({ unit: 'x', referenceRanges: [
      { sex: 'M', minAge: 18, min: 13, max: 17, criticalLow: 7, criticalHigh: 20 },
      { sex: 'F', minAge: 18, min: 12, max: 16, criticalLow: 7, criticalHigh: 20 },
      { sex: 'any', minAge: 0, maxAge: 18, min: 11, max: 14 },
    ] })).toEqual([]);
  });
  it('limits that touch are fine (CL = L, CH = H, L = H)', () => {
    expect(validateRanges(one({ min: 4, max: 4, criticalLow: 4, criticalHigh: 4.5 }))).toEqual([]);
  });
  it('L above H', () => {
    expect(validateRanges(one({ min: 11, max: 4 }))).toEqual([{ severity: 'error', band: 0, field: 'max', message: 'L (11) must not be above H (4).' }]);
  });
  it('CL above L, CH below H, CL not below CH', () => {
    expect(msgs(one({ min: 4, max: 11, criticalLow: 5 }))).toEqual(['CL (5) must not be above L (4).']);
    expect(msgs(one({ min: 3.5, max: 5, criticalHigh: 4 }))).toEqual(['CH (4) must not be below H (5).']);
    expect(msgs(one({ criticalLow: 9, criticalHigh: 9 }))).toEqual(['CL (9) must be below CH (9).']);
  });
  it('age from must be less than age to', () => {
    expect(validateRanges(one({ minAge: 18, maxAge: 5 }))[0]).toMatchObject({ field: 'age', message: 'Age from must be less than age to.' });
    expect(validateRanges(one({ minAge: 5, maxAge: 5 }))[0]).toMatchObject({ field: 'age' });
  });
  it('legacy test-wide criticals count as each group’s CL / CH', () => {
    expect(msgs({ unit: 'g/dL', criticalHigh: 20, referenceRanges: [{ minAge: 0, maxAge: 28, ageUnit: 'days', min: 14, max: 22 }] }))
      .toEqual(['CH (20) must not be below H (22).']);
    expect(validateRanges({ unit: 'x', criticalLow: 5, criticalHigh: 2, referenceRanges: [] })[0]).toMatchObject({ band: null });
  });
  it('overlapping groups: named on the later one', () => {
    const p: InsightParam = { unit: 'x', referenceRanges: [
      { sex: 'any', minAge: 18, min: 1, max: 2 },
      { sex: 'M', minAge: 50, maxAge: 80, min: 1, max: 3 },
      { sex: 'F', minAge: 0, maxAge: 18, min: 1, max: 2 },
    ] };
    expect(validateRanges(p)).toEqual([{ severity: 'error', band: 1, field: 'sex',
      message: 'Overlaps group 1 (Anyone · 18 years+) — two groups cannot cover the same patients.' }]);
  });
  it('legacy category tiers on one population are an overlap to fix', () => {
    const p: InsightParam = { unit: 'mg/dL', referenceRanges: [
      { segment: 'normal', min: 70, max: 99 },
      { segment: 'prediabetes', min: 100, max: 125, label: 'Prediabetes' },
    ] };
    expect(msgs(p)).toEqual(['Overlaps group 1 (Anyone · Any age) — two groups cannot cover the same patients.']);
  });
});
