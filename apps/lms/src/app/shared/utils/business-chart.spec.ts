import { CHART_OTHER, CHART_SERIES, buildBusinessLineOption, buildDonutOption, buildGroupedHBarOption, buildHorizontalBarOption, buildSparklineOption, buildStackedBarOption, foldOther, restoreSeriesColours, rupeeAxisFormatter, rupeeFormatter } from './business-chart';

const mockEc = {
  graphic: {
    LinearGradient: function (x0: number, y0: number, x1: number, y1: number, stops: unknown[]) {
      return { _type: 'LinearGradient', x0, y0, x1, y1, stops };
    },
  },
};

describe('buildBusinessLineOption', () => {
  it('builds a single-series line with a gradient area and no legend', () => {
    const opt = buildBusinessLineOption(mockEc, {
      categories: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'],
      series: [{ name: 'Patients', data: [10, 14, 9, 12] }],
      theme: 'dark',
    });
    expect(opt.xAxis.data).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(opt.series).toHaveLength(1);
    expect(opt.series[0].type).toBe('line');
    expect(opt.series[0].data).toEqual([10, 14, 9, 12]);
    expect(opt.series[0].areaStyle).toBeDefined();
    expect(opt.legend).toBeUndefined();
  });

  it('builds a multi-series line (the Revenue toggle group) with a legend and only the first series gradient-filled', () => {
    const opt = buildBusinessLineOption(mockEc, {
      categories: ['d1', 'd2', 'd3', 'd4'],
      series: [
        { name: 'Gross', data: [100, 120, 1, 1] },
        { name: 'Net', data: [90, 110, 1, 1] },
        { name: 'Collected', data: [80, 100, 1, 1] },
      ],
      theme: 'light',
      valueFormatter: rupeeFormatter,
    });
    expect(opt.series).toHaveLength(3);
    expect(opt.legend).toBeDefined();
    expect(opt.series[0].areaStyle).toBeDefined();
    expect(opt.series[1].areaStyle).toBeUndefined();
    expect(opt.series[2].areaStyle).toBeUndefined();
    expect(opt.series.map((s: { name: string }) => s.name)).toEqual(['Gross', 'Net', 'Collected']);
  });
});

describe('buildStackedBarOption', () => {
  it('stacks every series on the same key and rounds only the top bar', () => {
    const opt = buildStackedBarOption(mockEc, {
      categories: ['Mon', 'Tue'],
      series: [
        { name: 'New', data: [3, 5] },
        { name: 'Returning', data: [7, 2] },
      ],
      theme: 'dark',
    });
    expect(opt.series).toHaveLength(2);
    expect(opt.series[0].stack).toBe('total');
    expect(opt.series[1].stack).toBe('total');
    expect(opt.series[0].itemStyle.borderRadius).toBe(0);
    expect(opt.series[1].itemStyle.borderRadius).toEqual([4, 4, 0, 0]);
  });
});

describe('buildHorizontalBarOption', () => {
  it('reverses categories and values so the largest value draws at the top', () => {
    const opt = buildHorizontalBarOption(mockEc, {
      categories: ['CBC', 'LFT', 'KFT'],
      values: [900, 600, 300],
      theme: 'dark',
      valueFormatter: rupeeFormatter,
    });
    // ECharts draws a category axis bottom-to-top, so reversing puts the
    // FIRST (largest) category/value pair visually on top.
    expect(opt.yAxis.data).toEqual(['KFT', 'LFT', 'CBC']);
    expect(opt.series[0].data).toEqual([300, 600, 900]);
  });
});

describe('rupeeFormatter', () => {
  it('prefixes with the rupee sign, Indian grouping, no decimals', () => {
    expect(rupeeFormatter(1234567)).toBe('₹12,34,567');
    expect(rupeeFormatter(1234567.8)).not.toContain('.');
  });
});

describe('Insights chart shapes (redesign)', () => {
  it('donut folds the tail into a neutral "Other" slice', () => {
    const items = [
      { name: 'A', value: 50 }, { name: 'B', value: 40 }, { name: 'C', value: 30 },
      { name: 'D', value: 20 }, { name: 'E', value: 10 }, { name: 'F', value: 5 },
    ];
    const folded = foldOther(items, 5);
    expect(folded.map(i => i.name)).toEqual(['A', 'B', 'C', 'D', 'Other']);
    expect(folded[4].value).toBe(15);
    const opt = buildDonutOption({ items, theme: 'light' });
    expect(opt.series[0].data[4].itemStyle.color).toBe(CHART_OTHER.light);
    expect(opt.series[0].data[0].itemStyle.color).toBe(CHART_SERIES.light[0]);
  });

  it('multi-series lines keep their own colours after the single-violet skin', () => {
    const opt = buildBusinessLineOption(null, {
      categories: ['d1', 'd2', 'd3', 'd4'], series: [{ name: 'Billed', data: [1, 2, 3, 4] }, { name: 'Collected', data: [1, 1, 1, 1] }], theme: 'dark',
    });
    // simulate the skin painting every line violet
    for (const s of opt.series) s.lineStyle = { ...s.lineStyle, color: '#a78bfa' };
    restoreSeriesColours(opt);
    expect(opt.series[1].lineStyle.color).toBe(CHART_SERIES.dark[1]);
  });

  it('grouped horizontal bars reverse categories and every series together', () => {
    const opt = buildGroupedHBarOption({
      categories: ['Haem', 'Bio'], series: [{ name: 'Median', data: [30, 60] }, { name: 'P90', data: [50, 90] }], theme: 'light',
    });
    expect(opt.yAxis.data).toEqual(['Bio', 'Haem']);
    expect(opt.series[1].data).toEqual([90, 50]);
  });

  it('two or three buckets draw as grouped bars, not a two-dot line', () => {
    const opt = buildBusinessLineOption(null, { categories: ['d1', 'd2'], series: [{ name: 'Tests', data: [3, 5] }], theme: 'light' });
    expect(opt.series[0].type).toBe('bar');
    expect(opt.xAxis.boundaryGap).toBe(true);
  });

  it('sparkline marks the last point', () => {
    const opt = buildSparklineOption({ data: [1, 4, 2], theme: 'light' });
    expect(opt.series[0].markPoint.data[0].coord).toEqual([2, 2]);
    expect(opt.xAxis.show).toBe(false);
  });

  it('compact rupee axis ticks', () => {
    expect(rupeeAxisFormatter(150000)).toBe('₹1.5L');
    expect(rupeeAxisFormatter(4500)).toBe('₹4.5k');
  });
});
