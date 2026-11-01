import { niceScale } from './report-chart/report-chart.geom';
import { trendChartData, trendDateLabel, trendPerRow, type TrendogramSeries } from './report-trend-vector';

describe('vector trendograms - data', () => {
  const series: TrendogramSeries = {
    title: 'Haemoglobin - Hb (g/dL)', unit: 'g/dL', referenceRange: '12.0 - 16.0', chartType: 'line',
    points: [
      { date: '2026-01-05T08:00:00Z', value: 11.2, flag: 'L' },
      { date: '2026-03-02T08:00:00Z', value: 12.8, flag: '' },
      { date: '2026-05-20T08:00:00Z', value: 17.1, flag: 'H' },
    ],
  };
  it('turns a series into chart data with the normal band on every point', () => {
    const d = trendChartData(series, { band: true, values: true, size: 'half' });
    expect(d.kind).toBe('line');
    expect(d.refBand).toBe(true);
    expect(d.series[0].points.map(p => [p.low, p.high])).toEqual([[12, 16], [12, 16], [12, 16]]);
    expect(d.series[0].points.map(p => p.flag)).toEqual(['L', '', 'H']);
    expect(d.series[0].points.map(p => p.abnormal)).toEqual([true, false, true]);
    expect(d.empty).toBe(false);
  });
  it('dates are fixed text, not the machine\'s locale', () => {
    expect(trendDateLabel('2026-03-02T08:00:00Z')).toBe('02 Mar 26');
    expect(trendDateLabel('not a date')).toBe('not a date');
  });
  it('no printed range, or the band switched off, means no band', () => {
    expect(trendChartData({ ...series, referenceRange: null }, { band: true, values: true, size: 'half' }).refBand).toBe(false);
    expect(trendChartData(series, { band: false, values: true, size: 'half' }).refBand).toBe(false);
  });
  it('a bar series asks for bars', () => {
    expect(trendChartData({ ...series, chartType: 'bar' }, { band: true, values: true, size: 'full' }).kind).toBe('bar');
  });
  it('cells per row follow the layout', () => {
    expect([trendPerRow('grid-2'), trendPerRow('grid-3'), trendPerRow('list')]).toEqual([2, 3, 1]);
  });
});

describe('vector trendograms - axis', () => {
  it('uses the nice scale the chart blocks use (0..137 -> 0..150 in steps of 50)', () => {
    const s = niceScale(0, 137, null, null);
    expect([s.lo, s.hi, s.step]).toEqual([0, 150, 50]);
    expect(s.ticks).toEqual([0, 50, 100, 150]);
  });
  it('a haemoglobin-sized series gets round ticks, not 11.2 / 17.1', () => {
    const s = niceScale(11.2, 17.1, null, null);
    expect(s.ticks.every(t => Math.abs(t * 2 - Math.round(t * 2)) < 1e-9)).toBe(true);
  });
});
