import { buildBusinessLineOption, buildHorizontalBarOption, buildStackedBarOption, rupeeFormatter } from './business-chart';

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
      categories: ['2026-10-01', '2026-10-02'],
      series: [{ name: 'Patients', data: [10, 14] }],
      theme: 'dark',
    });
    expect(opt.xAxis.data).toEqual(['2026-10-01', '2026-10-02']);
    expect(opt.series).toHaveLength(1);
    expect(opt.series[0].type).toBe('line');
    expect(opt.series[0].data).toEqual([10, 14]);
    expect(opt.series[0].areaStyle).toBeDefined();
    expect(opt.legend).toBeUndefined();
  });

  it('builds a multi-series line (the Revenue toggle group) with a legend and only the first series gradient-filled', () => {
    const opt = buildBusinessLineOption(mockEc, {
      categories: ['d1', 'd2'],
      series: [
        { name: 'Gross', data: [100, 120] },
        { name: 'Net', data: [90, 110] },
        { name: 'Collected', data: [80, 100] },
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
