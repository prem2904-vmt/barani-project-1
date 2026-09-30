import { buildChartData } from './report-chart.data';
import { layoutChart } from './report-chart.layout';
import { CHART_KINDS, kindAvailability, normalizeChartSpec, type ChartKind, type ChartShape } from './report-chart.model';
import { CATALOGUE_SAMPLES, type CatalogueSample } from './report-chart.catalogue.spec-helpers';
import { OGTT_SPEC, buildChartReport, fingerprint, ogttTests, textRuns, wbcDiffTest, WBC_PCT, WBC_TITLES, type Run } from './report-chart.spec-helpers';
import { autoCompareSet, autoSecondLine, chartShape, type ChartEditorContext } from './report-chart.sample';

/**
 * The chart-type catalogue (docs/REPORT-CHARTS.md §1): every type prints as
 * VECTOR content with real, readable text, from the saved snapshot only,
 * whole on one page, deterministically; the picker offers only the types
 * that fit the test's data.
 */

/** The chart's title in the test PDFs (unique: never a table row). */
const T = (s: CatalogueSample) => `Zchart ${s.name}`;
const reportOf = (s: CatalogueSample) =>
  buildChartReport({ tests: s.tests, chartOwner: s.owner, spec: s.spec, title: T(s), titles: s.titles, flagStyle: 'bold_color' });
/** PDF literal text → plain (escapes and non-ASCII folded) for comparing. */
const norm = (t: string) => t.replace(/\\([()\\])/g, '$1').replace(/\\\d{3}|[^\x20-\x7e]/g, '?');
const dataOf = (s: CatalogueSample) => buildChartData(s.spec, s.title, s.owner, s.tests as never, s.titles)!;
const texts = (ops: ReturnType<typeof layoutChart>['ops']) => ops.flatMap(o => o.t === 'text' ? [o.text] : []);

/** The chart's content stream slice: everything painted after its title. */
function chartStream(doc: ReturnType<typeof buildChartReport>, title: string): string {
  const pages = (doc as unknown as { internal: { pages: Array<string[] | null> } }).internal.pages;
  for (const p of pages) {
    if (!p) continue;
    const body = p.join('\n');
    const i = body.lastIndexOf(`(${title}) Tj`);
    if (i >= 0) return body.slice(i);
  }
  return '';
}

describe('report chart types — every type in the real PDF', () => {
  it('the catalogue covers every chart type the picker offers', () => {
    expect(new Set(CATALOGUE_SAMPLES.map(s => s.spec.kind))).toEqual(new Set(CHART_KINDS.map(k => k.value)));
  });

  for (const s of CATALOGUE_SAMPLES) {
    describe(s.name, () => {
      const doc = reportOf(s);
      const runs = textRuns(doc);
      const data = dataOf(s);

      it('is vector: no embedded image, drawn with path / rect operators', () => {
        expect(doc.output()).not.toMatch(/\/Subtype \/Image/);
        const stream = chartStream(doc, T(s));
        expect(stream.length).toBeGreaterThan(200);
        // Curves for the round / smooth kinds, rectangles or lines for the rest.
        if (['pie', 'donut', 'gauge', 'smooth'].includes(s.spec.kind)) expect(stream).toMatch(/ c\n/);
        else expect(stream).toMatch(/ re\n| l\n/);
      });

      it('prints its title and labels as real text on one page', () => {
        const title = runs.find(r => r.text === T(s));
        expect(title, 'title').toBeTruthy();
        const labels = s.spec.kind === 'gauge' ? data.xLabels.slice(0, 1) : data.xLabels;
        for (const l of labels) {
          const first = norm(l).split(' ')[0];
          const hit = runs.find(r => r.page === title!.page && r.top > title!.top && (norm(r.text) === norm(l) || norm(r.text).includes(first)));
          expect(hit, `label "${l}"`).toBeTruthy();
        }
      });

      it('labels every abnormal value with its saved H / L', () => {
        const all = texts(layoutChart(data, 535).ops).join(' | ');
        for (const se of data.series) for (const p of se.points) {
          if (p.value == null) continue;
          expect(all).toContain(p.display);
          if (p.abnormal && s.spec.showValues && data.series.length <= 2) expect(all).toMatch(new RegExp(`${p.display.replace('.', '\\.')}[^|]*${p.flag}|\\| ${p.flag} \\|`));
        }
      });

      it('is deterministic (same snapshot → same drawing, same PDF content)', () => {
        const a = layoutChart(dataOf(s), 535), b = layoutChart(dataOf(s), 535);
        expect(fingerprint(a.ops)).toBe(fingerprint(b.ops));
        expect(chartStream(reportOf(s), T(s))).toBe(chartStream(reportOf(s), T(s)));
      });
    });
  }
});

/** Every table row printed with one of `titles` → { first result run, its H / L }. */
function tableRows(runs: Run[], titles: string[]): Array<{ title: string; value: string; flag: string }> {
  const want = new Set(titles.map(norm));
  return runs.filter(r => want.has(norm(r.text))).map(row => {
    const same = runs.filter(r => r.page === row.page && Math.abs(r.top - row.top) < 2 && r.x > row.x).sort((a, b) => a.x - b.x);
    const letter = same.map(r => / (H|L)$|^(H|L)$/.exec(r.text.trim())).find(Boolean);
    return { title: row.text, value: (same[0]?.text ?? '').trim(), flag: letter ? (letter[1] ?? letter[2]) : '' };
  }).filter(r => r.value);
}

describe('report chart types — table and chart print the same saved flag', () => {
  for (const s of CATALOGUE_SAMPLES) {
    it(`${s.name}: every plotted value carries the table's H / L`, () => {
      const runs = textRuns(reportOf(s));
      const data = dataOf(s);
      const titles = s.tests.flatMap(t => Object.keys(((t['result'] as { values?: object } | null)?.values) ?? {})).map(k => s.titles?.[k] ?? k);
      const rows = tableRows(runs, titles);
      expect(rows.length).toBeGreaterThan(0);
      let checked = 0;
      for (const se of data.series) for (const p of se.points) {
        if (p.value == null) continue;
        const r = rows.find(x => x.value.startsWith(p.display + ' ') || x.value === p.display);
        expect(r, `table row for ${p.display}`).toBeTruthy();
        expect(p.flag, `${r!.title} = ${p.display}`).toBe(r!.flag);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    });
  }

  it('a value saved as N stays normal on every type, whatever its band says', () => {
    const t = wbcDiffTest({ neu: 78, lym: 15, mono: 5, eos: 1.5, baso: 0.5 });
    (t.result.values as Record<string, { flag: string }>)['neutrophils_pct'].flag = 'N';
    for (const kind of ['pie', 'donut', 'bar', 'hbar', 'radar', 'gauge', 'dots'] as ChartKind[]) {
      const d = buildChartData({ ...normalizeChartSpec({ kind, x: 'parameters', parameters: WBC_PCT })! }, 't', 'zdiff', [t], WBC_TITLES)!;
      expect(d.series[0].points[0], kind).toMatchObject({ value: 78, flag: '', abnormal: false });
      const l = layoutChart(d, 535);
      expect(l.ops.some(o => o.t === 'text' && /^78( %)?\s*H$/.test(o.text)), kind).toBe(false);
    }
  });
});

describe('report chart types — only the types that fit the data', () => {
  const shape = (p: Partial<ChartShape>): ChartShape =>
    ({ x: 'parameters', multiPerPoint: false, sameUnitPerPoint: false, available: 5, percent: 0, series: false, ...p });

  it('pie / donut need parts of a whole (2+ values in %)', () => {
    expect(kindAvailability('pie', shape({ percent: 0 }))).toEqual({ ok: false, reason: expect.stringMatching(/Parts of a whole/) });
    expect(kindAvailability('donut', shape({ percent: 5 })).ok).toBe(true);
  });

  it('a gauge shows one value; a radar needs three', () => {
    expect(kindAvailability('gauge', shape({ available: 1 })).ok).toBe(true);
    expect(kindAvailability('gauge', shape({ x: 'series', series: true })).reason).toMatch(/one value/);
    expect(kindAvailability('radar', shape({ available: 2 })).ok).toBe(false);
    expect(kindAvailability('radar', shape({ available: 3 })).ok).toBe(true);
  });

  it('lines join time points: not offered across chosen values', () => {
    for (const k of ['line', 'smooth', 'step', 'area', 'stackedArea'] as ChartKind[]) {
      expect(kindAvailability(k, shape({})).ok, k).toBe(false);
      expect(kindAvailability(k, shape({ x: 'series', series: true, sameUnitPerPoint: true, multiPerPoint: true })).ok, k).toBe(true);
    }
    expect(kindAvailability('hbar', shape({ x: 'series', series: true })).reason).toMatch(/Time runs left to right/);
  });

  it('two-series types over time need two values per time point (stacks: one unit)', () => {
    expect(kindAvailability('combo', shape({ x: 'series', series: true })).ok).toBe(false);
    expect(kindAvailability('combo', shape({ x: 'series', series: true, multiPerPoint: true })).ok).toBe(true);
    expect(kindAvailability('stackedBar', shape({ x: 'series', series: true, multiPerPoint: true })).ok).toBe(false);
    expect(kindAvailability('stackedBar', shape({ x: 'series', series: true, multiPerPoint: true, sameUnitPerPoint: true })).ok).toBe(true);
  });

  it('every disabled type says why in one line', () => {
    for (const x of ['series', 'parameters'] as const) for (const k of CHART_KINDS) {
      const a = kindAvailability(k.value, shape({ x, series: x === 'series', available: 0 }));
      if (!a.ok) { expect(a.reason, k.value).toBeTruthy(); expect(a.reason!.length).toBeLessThan(44); }
    }
  });

  const OGTT_CTX: ChartEditorContext = {
    ownerId: 'o', series: true, params: [],
    timepoints: [0, 60].map(o => ({ offsetMin: o, members: [{ testId: 't' + o, name: 'G' + o, params: [
      { name: 'Glucose', unit: 'mg/dL' }, { name: 'Insulin', unit: 'µIU/mL' }] }] })),
  };
  const DIFF_CTX: ChartEditorContext = {
    ownerId: 'd', series: false, timepoints: [],
    params: [...WBC_PCT.map(n => ({ name: n, unit: '%' })), ...WBC_PCT.map(n => ({ name: n.replace('_pct', '_abs'), unit: '10³/µL' })),
      { name: 'total_wbc', unit: '10³/µL' }],
  };

  it('reads the shape from the test definition', () => {
    expect(chartShape(OGTT_CTX, 'series')).toMatchObject({ series: true, multiPerPoint: true, sameUnitPerPoint: false });
    expect(chartShape(DIFF_CTX, 'parameters')).toMatchObject({ available: 11, percent: 5 });
  });

  it('a comparison set pairs each value with its namesake (the % with its absolute count)', () => {
    const set = autoCompareSet(DIFF_CTX, WBC_PCT);
    expect(set.parameters).toEqual(WBC_PCT.map(n => n.replace('_pct', '_abs')));
    expect(set.label).toBe('10³/µL');
  });

  it('a two-series chart over time gets its second line (another unit, or a stack in one unit)', () => {
    expect(autoSecondLine(OGTT_CTX, [{}], false)).toEqual([{ unit: 'mg/dL' }, { unit: 'µIU/mL' }]);
    const stackCtx: ChartEditorContext = { ...OGTT_CTX, timepoints: [{ offsetMin: 0, members: [{ testId: 'u', name: 'U', params: [
      { name: 'Urine albumin', unit: 'mg' }, { name: 'Other protein', unit: 'mg' }] }] }] };
    const lines = autoSecondLine(stackCtx, [{}], true);
    expect(lines.map(l => [l.unit, l.match])).toEqual([['mg', 'urine'], ['mg', 'other']]);
  });
});

describe('report chart types — old saved charts and new limits', () => {
  it('v1 kinds stay what they were; other tools\' names map to ours; unknown draws as a line', () => {
    expect(normalizeChartSpec({ kind: 'line' })!.kind).toBe('line');
    expect(normalizeChartSpec({ kind: 'bar', x: 'parameters' })!.kind).toBe('bar');
    expect(normalizeChartSpec({ kind: 'dots' })!.kind).toBe('dots');
    expect(normalizeChartSpec({ kind: 'scatter' })!.kind).toBe('dots');
    expect(normalizeChartSpec({ kind: 'doughnut', x: 'parameters' })!.kind).toBe('donut');
    expect(normalizeChartSpec({ kind: 'stacked-bar' })!.kind).toBe('stackedBar');
    expect(normalizeChartSpec({ kind: 'sunburst' })!.kind).toBe('line');
  });

  it('an old saved spec (v1 JSON) builds exactly as before', () => {
    const old = { v: 1, kind: 'line', x: 'series', lines: [{ unit: 'mg/dL' }], xLabels: {}, refBand: true,
      thresholds: [{ value: 140, label: 'IGT ≥ 140' }], showValues: true, size: 'full', yMin: null, yMax: null };
    expect(normalizeChartSpec(old)).toEqual({ ...old, lines: [{ unit: 'mg/dL', match: null, label: null }] });
    const oldBars = { v: 1, kind: 'bar', x: 'parameters', parameters: ['hdl', 'ldl'], refBand: false, thresholds: [], showValues: true,
      size: 'half', yMin: 0, yMax: 300 };
    expect(normalizeChartSpec(oldBars)).toEqual(oldBars);          // no sets / mainLabel appear
  });

  it('sets are aligned to the chosen values and capped; empty sets drop', () => {
    const s = normalizeChartSpec({ kind: 'groupedBar', x: 'parameters', parameters: ['a', 'b', 'c'], mainLabel: ' Percent ',
      sets: [{ label: 'Abs', parameters: ['x', 'y', 'z', 'extra'] }, { parameters: ['p'] }, { parameters: [] }, 'junk',
        ...Array.from({ length: 8 }, () => ({ parameters: ['q'] }))] })!;
    expect(s.sets![0]).toEqual({ label: 'Abs', parameters: ['x', 'y', 'z'] });
    expect(s.sets![1]).toEqual({ label: null, parameters: ['p', null, null] });
    expect(s.sets).toHaveLength(5);                  // 6 series at most
    expect(s.mainLabel).toBe('Percent');
  });

  it('up to 6 lines draw (each its own colour, dash and marker); a THIRD unit is not drawn', () => {
    const tests = ogttTests([92, 168, 155, 131, 118], { secondLine: [6, 48, 52, 30, 20] }).map((t, i) => ({
      ...t, result: { values: { ...(t.result?.values ?? {}),
        A: { value: 10 + i, unit: 'mg/dL', flag: 'N' }, B: { value: 20 + i, unit: 'mg/dL', flag: 'N' },
        C: { value: 30 + i, unit: 'mg/dL', flag: 'N' }, D: { value: 40 + i, unit: 'mg/dL', flag: 'H' }, K: { value: 1, unit: 'mmol/L', flag: 'N' } } },
    }));
    const lines = [{ unit: 'mg/dL', match: 'Z' }, { unit: 'µIU/mL' }, { unit: 'mg/dL', match: 'a' }, { unit: 'mg/dL', match: 'b' },
      { unit: 'mg/dL', match: 'c' }, { unit: 'mg/dL', match: 'd' }];
    const d = buildChartData({ ...OGTT_SPEC, lines }, 'Six', 'zogtt', tests as never)!;
    expect(d.series).toHaveLength(6);
    const l = layoutChart(d, 535);
    expect(l.ops.filter(o => o.t === 'poly')).toHaveLength(6);
    expect(l.ops.filter(o => o.t === 'text' && o.role === 'legend' && o.text !== 'Normal range')).toHaveLength(6);   // one legend entry per line
    // With more than two lines only the abnormal values are labelled.
    expect(texts(l.ops)).toContain('40 H');
    expect(texts(l.ops)).not.toContain('30');
    const third = buildChartData({ ...OGTT_SPEC, lines: [{ unit: 'mg/dL' }, { unit: 'µIU/mL' }, { unit: 'mmol/L' }] }, 'T', 'zogtt', tests as never)!;
    expect(third.series.map(s => s.unit)).toEqual(['mg/dL', 'µIU/mL']);
  });
});

describe('report chart types — round charts', () => {
  const diff = (pct: Parameters<typeof wbcDiffTest>[0]) => [wbcDiffTest(pct)];

  it('pie: the slices add up to the whole circle, in the author\'s order from 12 o\'clock', () => {
    const d = buildChartData(normalizeChartSpec({ kind: 'pie', x: 'parameters', parameters: WBC_PCT }), 'W', 'zdiff', diff({ neu: 60, lym: 30, mono: 6, eos: 3, baso: 1 }), WBC_TITLES)!;
    const l = layoutChart(d, 535);
    const slices = l.ops.filter(o => o.t === 'path' && o.fill?.startsWith('p'));
    expect(slices).toHaveLength(5);
    const first = (slices[0] as { segs: Array<[string, ...number[]]> }).segs;
    const [, x0, y0] = first[0];
    const cx = (first.find(s => s[0] === 'L') as [string, number, number])[1];
    expect(x0).toBeCloseTo(cx, 5);                    // starts straight up
    expect(y0).toBeLessThan((first.find(s => s[0] === 'L') as [string, number, number])[2]);
    expect(texts(l.ops)).toEqual(expect.arrayContaining(['Neutrophils', '60 %', '40–75', 'Normal']));
  });

  it('pie: an abnormal part is outlined in the abnormal style; a missing part is named', () => {
    const t = wbcDiffTest({ neu: 78, lym: 15, mono: 5, eos: 1.5, baso: 0.5 });
    delete (t.result.values as Record<string, unknown>)['basophils_pct'];
    const d = buildChartData(normalizeChartSpec({ kind: 'donut', x: 'parameters', parameters: WBC_PCT }), 'W', 'zdiff', [t], WBC_TITLES)!;
    const l = layoutChart(d, 535);
    expect(l.ops.filter(o => o.t === 'path' && !o.fill && (o.stroke === 'high' || o.stroke === 'low')).map(o => (o as { stroke: string }).stroke))
      .toEqual(['high', 'low']);
    expect(texts(l.ops)).toEqual(expect.arrayContaining(['not measured', 'Not measured: Basophils.', '78 % H']));
  });

  it('gauge: one value, its band on the dial, thresholds as marks, the value + flag under the hub', () => {
    const s = CATALOGUE_SAMPLES.find(x => x.name === 'gauge')!;
    const l = layoutChart(dataOf(s), 535);
    expect(l.ops.some(o => o.t === 'path' && o.fill === 'band')).toBe(true);
    expect(texts(l.ops)).toEqual(expect.arrayContaining(['7.8 %  H', 'HbA1c', 'Normal 4–5.6 %', 'Prediabetes 5.7', 'Diabetes 6.5']));
    // The needle points at 7.8 on the dial's scale (past 6.5, before the end).
    const needle = l.ops.find(o => o.t === 'path' && (o.fill === 'high'))!;
    expect(needle).toBeTruthy();
  });

  it('radar: each spoke scaled to its own upper limit; values print with their units', () => {
    const s = CATALOGUE_SAMPLES.find(x => x.name === 'radar')!;
    const l = layoutChart(dataOf(s), 535);
    expect(texts(l.ops)).toEqual(expect.arrayContaining(['ALT (SGPT)', '96 U/L H', '3.8 g/dL', '1×', '2×']));
  });
});

describe('report chart types — units with superscripts', () => {
  it('10³/µL prints with a raised 3, not "10^3"', () => {
    const s = CATALOGUE_SAMPLES.find(x => x.name === 'grouped-bar')!;
    const runs = textRuns(reportOf(s));
    const title = runs.find(r => r.text === T(s))!;
    const chart = runs.filter(r => r.page === title.page && r.top >= title.top);
    expect(chart.some(r => r.text.includes('10^3'))).toBe(false);
    expect(chart.some(r => r.text === '3')).toBe(true);
  });
});
