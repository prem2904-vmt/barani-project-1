import { buildChartData } from './report-chart.data';
import { chartOwnerOf, chartTestsFromOrder, savedValues } from './report-chart.order';
import { OGTT_SPEC } from './report-chart.spec-helpers';

describe('report chart on the lab screens', () => {
  it('the chart lives on the nearest profile, else the test', () => {
    expect(chartOwnerOf({ testId: 't', profileTestId: 'p', packageTestId: 'k' })).toBe('p');
    expect(chartOwnerOf({ testId: 't', packageTestId: 'p', packageType: 'profile' })).toBe('p');
    expect(chartOwnerOf({ testId: 't', packageTestId: 'k', packageType: 'package' })).toBe('t');
  });

  it('reads the saved flagged map (with band numbers), else raw values', () => {
    expect(savedValues(JSON.stringify({ values: { G: 92 }, flagged: { G: { value: 92, flag: 'N', low: 70, high: 99 } } })))
      .toEqual({ G: { value: 92, flag: 'N', low: 70, high: 99 } });
    expect(savedValues(JSON.stringify({ values: { G: 92 } }))).toEqual({ G: 92 });
    expect(savedValues('not json')).toEqual({});
    expect(savedValues(null)).toEqual({});
  });

  it('maps an order\'s tubes to the series chart (offset from the tube, unresulted = gap)', () => {
    const tube = (off: number, v: number | null) => ({ repeatOffsetMin: off, tests: [{
      testId: 'g' + off, name: 'G' + off, profileTestId: 'ogtt',
      currentResult: v == null ? null : JSON.stringify({ flagged: { ['G' + off]: { value: v, flag: v > 140 ? 'H' : 'N', unit: 'mg/dL', high: 140 } } }),
    }] });
    const tests = chartTestsFromOrder({ samples: [tube(0, 90), tube(60, 150), tube(120, null)] });
    const d = buildChartData(OGTT_SPEC, 'Curve', 'ogtt', tests)!;
    expect(d.xLabels).toEqual(['Fasting', '60 min', '120 min']);
    expect(d.series[0].points.map(p => p.value)).toEqual([90, 150, null]);
    expect(d.series[0].points[1].flag).toBe('H');
    expect(d.missing).toEqual(['120 min']);
  });
});
