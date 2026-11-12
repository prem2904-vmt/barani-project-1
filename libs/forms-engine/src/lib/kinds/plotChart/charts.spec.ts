import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vectors from '../../testing/casesheet-charts.vectors.json';
import {
  GrowthMeasure,
  Sex,
  actionCrossedAt,
  actionLine,
  alertCrossedAt,
  alertLine,
  analyseEar,
  ageWords,
  band,
  bandWords,
  growthRange,
  growthZ,
  lmsAt,
  valueAt,
  zScore,
  REF,
} from './chart-math';
import { audiogramChart, growthChart, layoutChart, niceScale, partographChart } from './chart-model';
import { measuresOf, pointsOf, presetOf, tidy } from './plotchart-value';

/**
 * The chart maths is the C# engine's twin. The expected numbers below come from the shared vectors (docs/vectors/casesheet-charts.json in
 * prefrontal-mw), worked out by an independent Python implementation of the published formulas, and the reference data is pinned by hash.
 */
const tol = vectors.tolerance;
const near = (expected: number, actual: number, what: string) =>
  expect(Math.abs(expected - actual), `${what}: expected ${expected}, got ${actual}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(expected)));

describe('chart reference data', () => {
  it('is the very same file the server uses (SHA-256 pinned in the shared vectors)', () => {
    const file = readFileSync(resolve(process.cwd(), 'libs/forms-engine/src/lib/kinds/plotChart/reference.json'));
    expect(createHash('sha256').update(file).digest('hex')).toBe(vectors.referenceSha256);
  });

  it('names its sources and covers the ages it claims', () => {
    for (const k of ['growth', 'audiogram', 'partograph'] as const) expect((REF[k] as unknown as { sources: string[] }).sources.length).toBeGreaterThan(0);
    expect(growthRange('weight')).toEqual({ from: 0, to: 120 });
    expect(growthRange('height')).toEqual({ from: 0, to: 228 });
    expect(growthRange('head')).toEqual({ from: 0, to: 60 });
  });
});

describe('growth maths (shared vectors)', () => {
  it.each(vectors.lms)('L, M, S for $measure $sex at $age months', (c) => {
    const p = lmsAt(c.measure as GrowthMeasure, c.sex as Sex, c.age)!;
    near(c.L, p.L, 'L');
    near(c.M, p.M, 'M');
    near(c.S, p.S, 'S');
  });

  it.each(vectors.growth)('z-score and band for $measure $sex $age months = $value', (c) => {
    const z = growthZ(c.measure as GrowthMeasure, c.sex as Sex, c.age, c.value)!;
    near(c.z, z, 'z');
    expect(band(z)).toBe(c.band);
    expect(bandWords(band(z))).toBe(c.words);
  });

  it.each(vectors.curve)('centile line $line for $measure $sex at $age', (c) => {
    near(c.value, valueAt(REF.growth.centileZ[c.line], lmsAt(c.measure as GrowthMeasure, c.sex as Sex, c.age)!), 'curve');
  });

  it('a reading on a curve reads back as its own z-score', () => {
    const p = lmsAt('weight', 'girl', 30)!;
    for (const z of [-2, -1, 0, 1.5]) near(z, zScore(valueAt(z, p), p), 'round trip');
  });

  it('a value exactly on a centile line belongs to the band above', () => {
    expect(band(0)).toBe(4);
    expect(band(-1e-9)).toBe(3);
    expect(band(REF.growth.centileZ[6])).toBe(7);
    expect(band(-5)).toBe(0);
  });

  it('no sex, a missing value or an age outside the table gives no z-score', () => {
    expect(growthZ('weight', null, 12, 9)).toBeNull();
    expect(growthZ('head', 'boy', 61, 50)).toBeNull();
    expect(growthZ('weight', 'boy', 121, 30)).toBeNull();
    expect(growthZ('weight', 'boy', 12, 0)).toBeNull();
  });

  it.each([
    [0, 'birth'],
    [1, '1 month'],
    [7, '7 months'],
    [18.5, '18.5 months'],
    [24, '2 years'],
    [40, '3 years 4 months'],
    [37, '3 years 1 month'],
  ])('%s months is written "%s"', (m, words) => expect(ageWords(m)).toBe(words));
});

describe('audiogram maths (shared vectors)', () => {
  const freq = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [Number(k), v]));
  it.each(vectors.audiogram.map((c, i) => [i, c] as const))('case %s', (_i, c) => {
    const r = analyseEar(freq(c.air as Record<string, number>), freq(c.bone as Record<string, number>));
    expect(r.pta).toBe(c.pta);
    expect(r.grade).toBe(c.grade);
    expect(r.type).toBe(c.type);
    expect(r.hasAir).toBe(c.hasAir);
  });
});

describe('partograph maths (shared vectors)', () => {
  it.each(vectors.partograph.map((c, i) => [i, c] as const))('case %s', (_i, c) => {
    const rs = c.readings as { hour: number; dilatation?: number }[];
    expect(alertCrossedAt(rs)).toBe(c.alertAt);
    expect(actionCrossedAt(rs)).toBe(c.actionAt);
  });

  it('alert line: 1 cm an hour from 4 cm; action line: four hours behind', () => {
    expect([alertLine(0), alertLine(6)]).toEqual([4, 10]);
    expect([actionLine(4), actionLine(10)]).toEqual([4, 10]);
  });
});

describe('chart model', () => {
  it('growth: seven centile curves and the patient, windowed to the age plotted', () => {
    const c = growthChart('weight', 'girl', [{ measure: 'weight', age: 18, value: 11.2 }])!;
    const s = c.panels[0].series;
    expect(s.map((x) => x.name)).toEqual(['P3', 'P10', 'P25', 'P50', 'P75', 'P90', 'P97', 'Patient']);
    expect(c.xMax).toBe(24);
    expect(c.xTicks.map((t) => t.label)).toEqual(['0', '3', '6', '9', '12', '15', '18', '21', '24']);
    expect(s[7].points).toEqual([{ x: 18, y: 11.2 }]);
    // each curve rises with age and the lines never cross
    for (let i = 0; i < 7; i++) expect(s[i].points[24].y).toBeGreaterThan(s[i].points[0].y);
    expect(s[6].points[10].y).toBeGreaterThan(s[0].points[10].y);
  });

  it('growth: school age is drawn in years from the 5 to 19 year reference; head circumference stops at 5 years', () => {
    const h = growthChart('height', 'boy', [{ measure: 'height', age: 120, value: 128 }])!;
    expect(h.xMax).toBe(120);
    expect(h.xTicks.map((t) => t.label)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    const head = growthChart('head', 'girl', [{ measure: 'head', age: 72, value: 50 }, { measure: 'head', age: 30, value: 48 }])!;
    expect(head.xMax).toBe(60);
    expect(head.panels[0].series[7].points).toEqual([{ x: 30, y: 48 }]); // 72 months is past the table: not plotted
    expect(growthChart('weight', 'girl', [])).toBeNull();
  });

  it('audiogram: standard symbols per ear, 0 dB at the top, WHO grade bands behind', () => {
    const r = audiogramChart('right', { 500: 45 }, { 500: 40 });
    const l = audiogramChart('left', { 500: 45 }, { 500: 40 });
    expect(r.panels[0].series.map((s) => s.marker)).toEqual(['circle', 'less']);
    expect(l.panels[0].series.map((s) => s.marker)).toEqual(['cross', 'greater']);
    expect(r.panels[0].inverted).toBe(true);
    expect(r.panels[0].bands).toHaveLength(7);
    expect(r.xTicks.map((t) => t.label)).toEqual(['250', '500', '1k', '2k', '4k', '8k']);
    const laid = layoutChart(r);
    const top = laid.panels[0].hgrid.find((t) => t.label === '-10')!;
    const bottom = laid.panels[0].hgrid.find((t) => t.label === '120')!;
    expect(top.y).toBeLessThan(bottom.y);
  });

  it('partograph: four panels, alert line dashed, action line starting at hour 4, window grows past 12 h', () => {
    const c = partographChart([{ hour: 0, dilatation: 4 }, { hour: 14, dilatation: 8 }]);
    expect(c.panels).toHaveLength(4);
    expect(c.xMax).toBe(14);
    const [alert, action, cervix] = c.panels[0].series;
    expect(alert.dashed).toBe(true);
    expect(action.points[0]).toEqual({ x: 4, y: 4 });
    expect(cervix.points).toHaveLength(2);
    expect(c.panels[3].series[0].marker).toBe('bar');
  });

  it('layout puts every panel inside the box and orders points left to right', () => {
    const laid = layoutChart(partographChart([{ hour: 3, dilatation: 6, fhr: 140 }, { hour: 1, dilatation: 5, fhr: 150 }]));
    expect(laid.panels).toHaveLength(4);
    for (const p of laid.panels) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y + p.height).toBeLessThanOrEqual(laid.h);
    }
    const xs = laid.panels[0].series[2].marks.map((m) => m.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it('number labels of two stacked panels never touch where the panels meet', () => {
    const laid = layoutChart(partographChart([{ hour: 1, dilatation: 5, fhr: 150 }]));
    const FONT = 11;
    for (let i = 1; i < laid.panels.length; i++) {
      const above = laid.panels[i - 1];
      const labelBottom = Math.max(...above.hgrid.map((t) => t.y)) + FONT / 2;
      const labelTop = Math.min(...laid.panels[i].hgrid.map((t) => t.y)) - FONT / 2;
      expect(labelTop - labelBottom).toBeGreaterThanOrEqual(2);
    }
  });

  it('niceScale gives round ticks that cover the data', () => {
    const s = niceScale(8.1, 13.7, 5);
    expect(s.min).toBeLessThanOrEqual(8.1);
    expect(s.max).toBeGreaterThanOrEqual(13.7);
    expect(s.ticks.every((t) => Math.abs(t.v * 2 - Math.round(t.v * 2)) < 1e-9)).toBe(true);
    expect(niceScale(5, 5).ticks.length).toBeGreaterThan(1);
  });
});

describe('plotChart value helpers', () => {
  it('reads presets, measures, points and tidies empty parts away', () => {
    expect(presetOf({ preset: 'audiogram' })).toBe('audiogram');
    expect(presetOf({})).toBe('growth');
    expect(measuresOf({ measures: ['height', 'weight'] })).toEqual(['height', 'weight']);
    expect(measuresOf({ measures: [] })).toEqual(['weight', 'height', 'head']);
    expect(pointsOf({ points: [{ measure: 'weight', age: 1, value: 4 }, { measure: 'nope', age: 1, value: 4 }, { measure: 'head', age: 'x', value: 1 }] })).toHaveLength(1);
    expect(tidy({ sex: 'girl' })).toEqual({ sex: 'girl' });
    expect(tidy({ right: { air: { '500': null as unknown as number } } })).toBeUndefined();
    expect(tidy({ readings: [] })).toBeUndefined();
  });
});
