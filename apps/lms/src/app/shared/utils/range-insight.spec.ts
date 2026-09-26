import {
  bandLevel, bandZones, tryValue, validateRanges, zoneTicks, zoneWeights,
  type InsightBand, type InsightParam, type FlagLevel,
} from './range-insight';
import { liveFlag } from './result-flag';

/** The production verdict (liveFlag = mw FlagOne mirror) as a level. */
function prodLevel(p: InsightParam, v: number, sex: 'M' | 'F' | 'O' | null = null, age: number | null = null): FlagLevel | null {
  const f = liveFlag(p as never, v, sex, age);
  if (!f) return null;
  if (f.code === 'C') return f.critical === 'low' ? 'critical_low' : 'critical_high';
  return f.code === 'L' ? 'low' : f.code === 'H' ? 'high' : 'normal';
}

const wbc: InsightParam = {
  unit: '10³/µL',
  referenceRanges: [{ segment: 'normal', min: 4, max: 11, criticalLow: 3.5, criticalHigh: 20 }],
};

describe('range bar zones — the number line as production cuts it', () => {
  it('two-sided band with criticals: five zones, plain-words captions, inclusive normal', () => {
    const z = bandZones(wbc.referenceRanges![0], wbc);
    expect(z.map(x => x.level)).toEqual(['critical_low', 'low', 'normal', 'high', 'critical_high']);
    expect(z.map(x => x.caption)).toEqual([
      'Below 3.5 → Critical low',
      '3.5 to under 4 → Low',
      '4 to 11 → Normal',
      'Over 11, up to 20 → High',
      'Above 20 → Critical high',
    ]);
  });

  it('ticks name where the next zone starts: ≥ = the limit is in it, > = it is not', () => {
    const t = zoneTicks(bandZones(wbc.referenceRanges![0], wbc));
    expect(t.map(x => x.text)).toEqual(['≥ 3.5', '≥ 4', '> 11', '> 20']);
    expect(t[1].title).toBe('4 counts as Normal');
    expect(t[2].title).toBe('11 counts as Normal');
    expect(t[3].title).toBe('20 counts as High');
  });

  it('one-sided strict band ("< 200"): 200 itself is High', () => {
    const z = bandZones({ segment: 'n', max: 200 });
    expect(z.map(x => x.caption)).toEqual(['Below 200 → Normal', 'At or above 200 → High']);
    expect(zoneTicks(z).map(x => x.text)).toEqual(['≥ 200']);
  });

  it('one-sided inclusive band ("≤ 140"): 140 is Normal', () => {
    const z = bandZones({ segment: 'n', max: 140, maxOp: 'lte' });
    expect(z.map(x => x.caption)).toEqual(['At or below 140 → Normal', 'Above 140 → High']);
    expect(zoneTicks(z).map(x => x.text)).toEqual(['> 140']);
  });

  it('one-sided lower bounds: "> 60" strict and "≥ 60" inclusive', () => {
    expect(bandZones({ segment: 'n', min: 60 }).map(x => x.caption))
      .toEqual(['At or below 60 → Low', 'Above 60 → Normal']);
    expect(bandZones({ segment: 'n', min: 60, minOp: 'gte' }).map(x => x.caption))
      .toEqual(['Below 60 → Low', 'At or above 60 → Normal']);
  });

  it('parameter-level criticals apply when the band has none; band criticals win', () => {
    const p: InsightParam = { criticalHigh: 30, referenceRanges: [{ segment: 'n', min: 1, max: 5 }, { segment: 'n', min: 1, max: 5, criticalHigh: 9 }] };
    expect(bandZones(p.referenceRanges![0], p).at(-1)!.caption).toBe('Above 30 → Critical high');
    expect(bandZones(p.referenceRanges![1], p).at(-1)!.caption).toBe('Above 9 → Critical high');
  });

  it('a critical that meets the normal limit leaves no Low zone (every low result is critical)', () => {
    const z = bandZones({ segment: 'n', min: 4, max: 11, criticalLow: 4 });
    expect(z.map(x => x.level)).toEqual(['critical_low', 'normal', 'high']);
  });

  it('a strict lower bound equal to the critical leaves a single-value Low zone', () => {
    const z = bandZones({ segment: 'n', min: 4, minOp: 'gt', criticalLow: 4 });
    expect(z.map(x => x.caption)).toEqual(['Below 4 → Critical low', 'Exactly 4 → Low', 'Above 4 → Normal']);
  });

  it('no numbers = no zones; weights keep every zone visible', () => {
    expect(bandZones({ segment: 'n' })).toEqual([]);
    const w = zoneWeights(bandZones(wbc.referenceRanges![0], wbc));
    expect(w.every(x => x > 0)).toBe(true);
  });

  it('every zone agrees with production for a sweep of values incl. each limit', () => {
    const bands: InsightBand[] = [
      { segment: 'n', min: 4, max: 11, criticalLow: 3.5, criticalHigh: 20 },
      { segment: 'n', max: 200 },
      { segment: 'n', max: 140, maxOp: 'lte', criticalHigh: 400 },
      { segment: 'n', min: 60, minOp: 'gte', criticalLow: 15 },
      { segment: 'n', min: 0.5, max: 0.5 },
    ];
    for (const b of bands) {
      const p: InsightParam = { referenceRanges: [b] };
      const zones = bandZones(b, p);
      const probe = [b.min, b.max, b.criticalLow, b.criticalHigh].filter((x): x is number => x != null);
      const values = [-1000, 1000, ...probe.flatMap(x => [x - 0.01, x, x + 0.01])];
      for (const v of values) {
        const z = zones.find(q =>
          (q.lo == null || (q.loIncl ? v >= q.lo : v > q.lo)) && (q.hi == null || (q.hiIncl ? v <= q.hi : v < q.hi)));
        expect(z?.level ?? null).toBe(prodLevel(p, v));
        expect(bandLevel(b, v, p)).toBe(prodLevel(p, v));
      }
    }
  });
});

describe('try a value — same band + flag as result entry', () => {
  const hb: InsightParam = {
    unit: 'g/dL', criticalLow: 7, criticalHigh: 20,
    referenceRanges: [
      { segment: 'm', sex: 'M', minAge: 18, min: 13, max: 17 },
      { segment: 'f', sex: 'F', minAge: 18, min: 12, max: 15, criticalLow: 6.5 },
      { segment: 'c', sex: 'any', minAge: 0, maxAge: 17.99, min: 11, max: 14 },
    ],
  };

  it('picks the band by sex/age and flags like liveFlag at every boundary', () => {
    const cases: Array<[number, 'M' | 'F' | null, number | null]> = [];
    for (const v of [6, 6.5, 6.9, 7, 11, 12, 12.9, 13, 15, 15.1, 17, 17.1, 20, 20.1])
      for (const s of ['M', 'F', null] as const)
        for (const a of [40, 10, null]) cases.push([v, s, a]);
    for (const [v, s, a] of cases) {
      expect(tryValue(hb, v, s, a).level).toBe(prodLevel(hb, v, s, a));
    }
  });

  it('reports which band and whether it was chosen on merit', () => {
    const w = tryValue(hb, 6.8, 'F', 30);
    expect(w.bandIndex).toBe(1);
    expect(w.onMerit).toBe(true);
    expect(w.level).toBe('low');   // band 1's own critical low (6.5) beats the parameter's 7
    expect(tryValue(hb, 6.4, 'F', 30)).toMatchObject({ level: 'critical_low', code: 'C' });
    expect(tryValue(hb, 25, null, null).onMerit).toBe(false);
  });
});

describe('range validation — errors block, warnings inform', () => {
  const band = (b: Partial<InsightBand>): InsightParam => ({ unit: 'mg/dL', referenceRanges: [{ segment: 'n', ...b }] });
  const errs = (p: InsightParam) => validateRanges(p).filter(i => i.severity === 'error');
  const warns = (p: InsightParam) => validateRanges(p).filter(i => i.severity === 'warning');

  it('a clean band has no issues', () => {
    expect(validateRanges(wbc)).toEqual([]);
  });
  it('normal high below normal low', () => {
    expect(errs(band({ min: 11, max: 4 }))).toEqual([{ severity: 'error', band: 0, field: 'max', message: 'Normal to (4) is below Normal from (11).' }]);
  });
  it('critical low not below critical high', () => {
    expect(errs(band({ criticalLow: 9, criticalHigh: 9 }))[0].message).toBe('Critical low (9) must be below Critical high (9).');
  });
  it('critical low inside the normal range', () => {
    expect(errs(band({ min: 4, max: 11, criticalLow: 5 }))[0]).toMatchObject({ field: 'criticalLow', message: 'Critical low (5) is inside the normal range — it must be at or below Normal from (4).' });
  });
  it('critical high inside the normal range (the Serum Osmolality seed bug)', () => {
    expect(errs(band({ min: 3.5, max: 5, criticalHigh: 4 }))[0].message)
      .toBe('Critical high (4) is inside the normal range — it must be at or above Normal to (5).');
  });
  it('one-sided band with the opposite critical past it', () => {
    expect(errs(band({ max: 200, criticalLow: 250 }))[0].message).toBe('Critical low (250) is at or above the normal limit (200) — nothing could be normal.');
    expect(errs(band({ min: 60, criticalHigh: 50 }))[0].message).toBe('Critical high (50) is at or below the normal limit (60) — nothing could be normal.');
  });
  it('age from above age to', () => {
    expect(errs(band({ min: 1, max: 2, minAge: 18, maxAge: 5 }))[0]).toMatchObject({ field: 'maxAge' });
  });
  it('parameter-level critical pair', () => {
    expect(errs({ unit: 'x', criticalLow: 5, criticalHigh: 2, referenceRanges: [] })[0]).toMatchObject({ band: null, field: 'criticalLow' });
  });
  it('warns: single-value normal, unreachable Low / High, empty band', () => {
    expect(warns(band({ min: 5, max: 5 }))[0].message).toContain('single value');
    expect(warns(band({ min: 4, max: 11, criticalLow: 4 }))[0].message).toContain('Low can never be flagged');
    expect(warns(band({ min: 4, max: 11, criticalHigh: 11 }))[0].message).toContain('High can never be flagged');
    expect(warns(band({}))[0].message).toContain('Empty range');
    expect(warns(band({ criticalHigh: 9 }))[0].message).toContain('only the critical limits');
  });
  it('warns on units: missing, a range typed as the unit, a band in another unit', () => {
    expect(warns({ referenceRanges: [{ segment: 'n', min: 1, max: 2 }] })[0].message).toContain('No unit set');
    expect(warns({ unit: '275–295', referenceRanges: [{ segment: 'n', min: 1, max: 2 }] })[0].message).toContain('looks like a range');
    expect(warns({ unit: 'mg/dL', referenceRanges: [{ segment: 'n', min: 1, max: 2, unit: 'mmol/L' }] })[0].message)
      .toBe('This range is in mmol/L but the test reports mg/dL.');
  });
  it('warns on plausible limits inside the normal range', () => {
    expect(warns({ unit: 'x', validLow: 5, referenceRanges: [{ segment: 'n', min: 4, max: 11 }] })[0].message).toContain('Plausible low (5)');
  });

  it('overlapping bands: the first wins — says who, and when a band is never used', () => {
    const p: InsightParam = { unit: 'x', referenceRanges: [
      { segment: 'a', sex: 'M', minAge: 18, maxAge: 60, min: 1, max: 2 },
      { segment: 'b', sex: 'M', minAge: 50, maxAge: 80, min: 1, max: 3 },
      { segment: 'c', sex: 'M', minAge: 20, maxAge: 30, min: 1, max: 4 },
      { segment: 'd', sex: 'F', minAge: 18, min: 1, max: 2 },
    ] };
    const w = warns(p);
    expect(w.find(x => x.band === 1)!.message).toBe('Overlaps range 1 for men aged 50–60 years — range 1 is used for them (it comes first).');
    expect(w.find(x => x.band === 2)!.message).toContain('Never used — range 1 covers the same patients');
    // Men vs women never tie; Everyone vs Men never tie (the specific band wins).
    expect(w.some(x => x.band === 3 && x.field === 'sex')).toBe(false);
  });

  it('labelled tiers with no sex/age: only the first decides the flag', () => {
    const p: InsightParam = { unit: 'mg/dL', referenceRanges: [
      { segment: 'n', max: 200, label: 'Desirable' },
      { segment: 't', min: 200, max: 239, label: 'Borderline high' },
    ] };
    expect(warns(p).map(x => x.message)).toEqual([
      'Range 1 decides the flag for everyone — range 2 (“Borderline high”) only prints in the list of ranges.',
    ]);
  });

  it('age gaps per sex are named; full coverage is quiet', () => {
    const gappy: InsightParam = { unit: 'x', referenceRanges: [
      { segment: 'a', sex: 'any', minAge: 1, maxAge: 12, min: 1, max: 2 },
      { segment: 'b', sex: 'M', minAge: 18, min: 1, max: 2 },
      { segment: 'c', sex: 'F', minAge: 18, min: 1, max: 2 },
    ] };
    expect(warns(gappy).map(x => x.message)).toEqual([
      'No range for anyone aged up to 1 year — they are judged against range 1.',
      'No range for anyone aged 12–18 years — they are judged against range 1.',
    ]);
    const menOnly: InsightParam = { unit: 'x', referenceRanges: [{ segment: 'a', sex: 'M', min: 1, max: 2 }] };
    expect(warns(menOnly).map(x => x.message)).toEqual(['No range for women — they are judged against range 1.']);
    const full: InsightParam = { unit: 'x', referenceRanges: [
      { segment: 'a', sex: 'any', minAge: 0, maxAge: 18, min: 1, max: 2 },
      { segment: 'b', sex: 'any', minAge: 18, min: 1, max: 2 },
    ] };
    expect(warns(full)).toEqual([]);
  });
});
