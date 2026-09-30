import { buildChartData } from './report-chart.data';
import { layoutChart, niceScale } from './report-chart.layout';
import { LIPID_SPEC, LIPID_TITLES, OGTT_SPEC, lipidTest, ogttTests } from './report-chart.spec-helpers';
import { sampleChartTests, seriesUnits, type ChartEditorContext } from './report-chart.sample';

describe('report chart data — series → points', () => {
  it('maps each time point to its member\'s value, in offset order, with Fasting / N min labels', () => {
    const d = buildChartData(OGTT_SPEC, 'Glucose curve', 'zogtt', ogttTests([92, 168, 155, 131, 118]))!;
    expect(d.xLabels).toEqual(['Fasting', '30 min', '60 min', '90 min', '120 min']);
    expect(d.series).toHaveLength(1);
    expect(d.series[0].points.map(p => p.value)).toEqual([92, 168, 155, 131, 118]);
    expect(d.series[0].unit).toBe('mg/dL');
    expect(d.missing).toEqual([]);
    expect(d.empty).toBe(false);
  });

  it('a missed time point is a gap, named in `missing`', () => {
    const d = buildChartData(OGTT_SPEC, 't', 'zogtt', ogttTests([92, 168, null, 131, 118]))!;
    expect(d.series[0].points[2].value).toBeNull();
    expect(d.missing).toEqual(['60 min']);
  });

  it('the reference band comes per time point from the saved snapshot (low / high)', () => {
    const d = buildChartData(OGTT_SPEC, 't', 'zogtt', ogttTests([92, 168, 155, 131, 118]))!;
    expect(d.series[0].points.map(p => [p.low, p.high])).toEqual([[70, 99], [null, 200], [null, 180], [null, 160], [null, 140]]);
  });

  it('abnormal points carry the report flag (criticals print as H / L, never C)', () => {
    const tests = ogttTests([92, 168, 155, 131, 212]);
    (tests[4].result!.values as Record<string, { flag: string }>)['Zogtt 120 Minutes'].flag = 'CH';
    (tests[0].result!.values as Record<string, { flag: string }>)['Zfasting Glucose'].flag = 'C';
    (tests[0].result!.values as Record<string, { value: number }>)['Zfasting Glucose'].value = 40;
    const p = buildChartData(OGTT_SPEC, 't', 'zogtt', tests)!.series[0].points;
    expect(p[4]).toMatchObject({ flag: 'H', abnormal: true, isLow: false });
    expect(p[0]).toMatchObject({ flag: 'L', abnormal: true, isLow: true });
    expect(p[1]).toMatchObject({ flag: '', abnormal: false });
  });

  it('ignores tests of another profile and non-series members', () => {
    const other = ogttTests([1, 2, 3, 4, 5]).map(t => ({ ...t, testId: 'x' + t.testId, profileTestId: 'other', packageTestId: 'other' }));
    const d = buildChartData(OGTT_SPEC, 't', 'zogtt', [...other, ...ogttTests([92, 168, 155, 131, 118])])!;
    expect(d.series[0].points.map(p => p.value)).toEqual([92, 168, 155, 131, 118]);
  });

  it('a second line in another unit reads its own values and goes on the right axis', () => {
    const spec = { ...OGTT_SPEC, lines: [{ unit: 'mg/dL' }, { unit: 'µIU/mL', label: 'Insulin' }] };
    const d = buildChartData(spec, 't', 'zogtt', ogttTests([92, 168, 155, 131, 118], { secondLine: [6, 48, 52, null, 20] }))!;
    expect(d.series).toHaveLength(2);
    expect(d.series[1]).toMatchObject({ label: 'Insulin', unit: 'µIU/mL', secondary: true });
    expect(d.series[1].points.map(p => p.value)).toEqual([6, 48, 52, null, 20]);
    expect(d.series[0].points.map(p => p.value)).toEqual([92, 168, 155, 131, 118]);
    expect(d.missing).toEqual([]);
  });

  it('with no results at all the chart is empty (the report prints nothing)', () => {
    expect(buildChartData(OGTT_SPEC, 't', 'zogtt', ogttTests([null, null, null, null, null]))!.empty).toBe(true);
  });
});

describe('report chart data — chosen values (not a series)', () => {
  it('plots the picked values in the author\'s order with the report titles', () => {
    const d = buildChartData(LIPID_SPEC, 'Lipid fractions', 'zlipid',
      [lipidTest({ tc: 232, hdl: 36, ldl: 150, vldl: 28, tg: 142 })], LIPID_TITLES)!;
    expect(d.kind).toBe('bar');
    expect(d.xLabels).toEqual(['Total Cholesterol', 'HDL Cholesterol', 'LDL Cholesterol', 'VLDL Cholesterol', 'Triglycerides']);
    expect(d.series[0].points.map(p => p.value)).toEqual([232, 36, 150, 28, 142]);
    expect(d.series[0].points.map(p => p.flag)).toEqual(['H', 'L', 'H', '', '']);
  });

  it('an un-entered value is a gap; names match case-insensitively; snake_case names read as words', () => {
    const t = lipidTest({ tc: 180, hdl: 50, ldl: 90, vldl: 20, tg: 110 });
    delete (t.result.values as Record<string, unknown>)['vldl'];
    const d = buildChartData({ ...LIPID_SPEC, parameters: ['TOTAL_CHOLESTEROL', 'vldl'] }, 't', 'zlipid', [t])!;
    expect(d.xLabels).toEqual(['TOTAL CHOLESTEROL', 'vldl']);
    expect(d.series[0].points[0].value).toBe(180);
    expect(d.missing).toEqual(['vldl']);
  });
});

describe('report chart layout', () => {
  it('nice axis ticks', () => {
    expect(niceScale(0, 212, null, null).ticks).toEqual([0, 50, 100, 150, 200, 250]);
    expect(niceScale(1.2, 3.9, null, null).ticks[0]).toBe(1);
    expect(niceScale(0, 10, 0, 300).ticks.at(-1)).toBe(300);
  });

  it('draws a band rect per time point with a band, a gap in the line, and labels every tick', () => {
    const d = buildChartData(OGTT_SPEC, 'Glucose curve', 'zogtt', ogttTests([92, 168, null, 131, 118]))!;
    const l = layoutChart(d, 535);
    const texts = l.ops.filter(o => o.t === 'text').map(o => (o as { text: string }).text);
    expect(texts).toEqual(expect.arrayContaining(['Glucose curve', 'Fasting', '120 min', '92', 'IGT ≥ 140', 'Diabetes ≥ 200 at 2 h',
      'not measured', 'Not measured: 60 min.', 'Normal range', 'mg/dL']));
    expect(l.ops.filter(o => o.t === 'rect' && (o as { fill?: string }).fill === 'band')).toHaveLength(4 + 1);  // 4 bands + the legend swatch
    const polys = l.ops.filter(o => o.t === 'poly');
    expect(polys).toHaveLength(2);                 // broken at the missed point
    expect(l.height).toBeGreaterThan(150);
    expect(l.height).toBeLessThan(260);
  });

  it('abnormal markers use the high / low tokens and bold labels', () => {
    const d = buildChartData(OGTT_SPEC, 't', 'zogtt', ogttTests([92, 168, 155, 131, 212]))!;
    const l = layoutChart(d, 535);
    expect(l.ops.some(o => o.t === 'circle' && o.fill === 'high')).toBe(true);
    expect(l.ops.some(o => o.t === 'text' && o.text === '212 H' && o.bold)).toBe(true);
  });

  it('half width is narrower and shorter', () => {
    const d = buildChartData({ ...OGTT_SPEC, size: 'half' }, 't', 'zogtt', ogttTests([92, 168, 155, 131, 118]))!;
    const full = layoutChart({ ...d, size: 'full' }, 535);
    const half = layoutChart(d, 268);
    expect(half.height).toBeLessThan(full.height);
  });
});

describe('report chart sample values (Test Master preview)', () => {
  const ctx: ChartEditorContext = {
    ownerId: 'p', series: true, params: [],
    timepoints: [0, 60, 120].map(o => ({ offsetMin: o, members: [{ testId: 't' + o, name: 'G' + o,
      params: [{ name: 'G' + o, unit: 'mg/dL', referenceRanges: [{ sex: 'any', min: o === 0 ? 70 : null, max: o === 0 ? 99 : 140 }] }] }] })),
  };

  it('puts every point inside its band except exactly one abnormal point', () => {
    const d = buildChartData({ v: 1, kind: 'line', x: 'series' }, 't', 'p', sampleChartTests(ctx))!;
    const pts = d.series[0].points;
    expect(pts.every(p => p.value != null)).toBe(true);
    expect(pts.filter(p => p.abnormal)).toHaveLength(1);
    expect(pts[0].low).toBe(70);
    expect(pts[0].high).toBe(99);
    expect(seriesUnits(ctx)).toEqual(['mg/dL']);
  });
});
