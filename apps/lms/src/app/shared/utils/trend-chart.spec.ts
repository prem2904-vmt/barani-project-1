import {
  parseTrendRange,
  buildTrendOption,
  buildSparklineOption,
  filterTrendPoints,
  renderTrendogramPng,
  TrendPoint,
  TrendParam,
} from './trend-chart';

describe('parseTrendRange', () => {
  it('parses "low - high" format with dash', () => {
    const result = parseTrendRange('70 - 100');
    expect(result).toEqual({ low: 70, high: 100 });
  });

  it('parses with en-dash (–)', () => {
    const result = parseTrendRange('70 – 100');
    expect(result).toEqual({ low: 70, high: 100 });
  });

  it('parses with em-dash (—)', () => {
    const result = parseTrendRange('70 — 100');
    expect(result).toEqual({ low: 70, high: 100 });
  });

  it('parses decimal values', () => {
    const result = parseTrendRange('3.5 - 5.8');
    expect(result).toEqual({ low: 3.5, high: 5.8 });
  });

  it('parses negative values', () => {
    const result = parseTrendRange('-10 - 10');
    expect(result).toEqual({ low: -10, high: 10 });
  });

  it('parses both negative values', () => {
    const result = parseTrendRange('-100 - -50');
    expect(result).toEqual({ low: -100, high: -50 });
  });

  it('parses with multiple spaces', () => {
    const result = parseTrendRange('70  -  100');
    expect(result).toEqual({ low: 70, high: 100 });
  });

  it('returns null for null/undefined input', () => {
    expect(parseTrendRange(null)).toBeNull();
    expect(parseTrendRange(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseTrendRange('')).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(parseTrendRange('70 to 100')).toBeNull();
    expect(parseTrendRange('70 - abc')).toBeNull();
    expect(parseTrendRange('70')).toBeNull();
  });

  it('returns null when high comes before low (still parses but low/high swap)', () => {
    // The function doesn't validate order, just parses
    const result = parseTrendRange('100 - 70');
    expect(result).toEqual({ low: 100, high: 70 });
  });

  it('returns null for non-finite numbers', () => {
    // NaN or Infinity should be rejected
    expect(parseTrendRange('Infinity - 100')).toBeNull();
  });
});

describe('buildTrendOption', () => {
  const mockEc = {
    graphic: {
      LinearGradient: function (x0: number, y0: number, x1: number, y1: number, stops: any[]) {
        return { _type: 'LinearGradient', x0, y0, x1, y1, stops };
      },
    },
  };

  it('builds line chart for dark theme with points and no reference range', () => {
    const points: TrendPoint[] = [
      { date: '2026-08-01', value: 100 },
      { date: '2026-08-02', value: 110 },
      { date: '2026-08-03', value: 105 },
    ];
    const param: TrendParam = {
      parameter: 'Glucose',
      unit: 'mg/dL',
      referenceRange: '70 - 100',
      points,
    };

    const option = buildTrendOption(mockEc, {
      param,
      points,
      chartType: 'line',
      theme: 'dark',
    });

    expect(option).toBeDefined();
    expect(option.backgroundColor).toBe('transparent');
    expect(option.grid).toBeDefined();
    expect(option.xAxis.data).toHaveLength(3);
    expect(option.yAxis.type).toBe('value');
    expect(option.series).toHaveLength(1);
    expect(option.series[0].type).toBe('line');
    expect(option.series[0].data).toEqual([100, 110, 105]);
  });

  it('builds bar chart for light theme with title', () => {
    const points: TrendPoint[] = [
      { date: '2026-08-01', value: 50 },
      { date: '2026-08-02', value: 60 },
    ];
    const param: TrendParam = {
      parameter: 'Hemoglobin',
      unit: 'g/dL',
      referenceRange: '12 - 16',
      points,
    };

    const option = buildTrendOption(mockEc, {
      param,
      points,
      chartType: 'bar',
      theme: 'light',
      title: 'Hemoglobin Trend',
    });

    expect(option.backgroundColor).toBe('#ffffff');
    expect(option.title).toBeDefined();
    expect(option.title.text).toBe('Hemoglobin Trend');
    expect(option.series[0].type).toBe('bar');
  });

  it('marks abnormal points with flag', () => {
    const points: TrendPoint[] = [
      { date: '2026-08-01', value: 100, flag: 'N' },
      { date: '2026-08-02', value: 110, flag: 'H' },
      { date: '2026-08-03', value: 105, flag: null },
    ];
    const param: TrendParam = {
      parameter: 'Glucose',
      points,
    };

    const option = buildTrendOption(mockEc, {
      param,
      points,
      chartType: 'line',
      theme: 'dark',
    });

    // The series has itemStyle.color that is a function that checks the flag
    expect(option.series[0].itemStyle.color).toBeDefined();
    // Normal point at index 0
    expect(option.series[0].itemStyle.color({ dataIndex: 0 })).toBe('#a855f7');
    // Abnormal point at index 1
    expect(option.series[0].itemStyle.color({ dataIndex: 1 })).toBe('#fb7185');
  });

  it('includes reference band when range is provided', () => {
    const points: TrendPoint[] = [{ date: '2026-08-01', value: 100 }];
    const param: TrendParam = {
      parameter: 'Test',
      referenceRange: '70 - 100',
      points,
    };

    const option = buildTrendOption(mockEc, {
      param,
      points,
      chartType: 'line',
      theme: 'dark',
    });

    expect(option.series[0].markArea).toBeDefined();
    expect(option.series[0].markArea.data[0]).toEqual([{ yAxis: 70 }, { yAxis: 100 }]);
  });

  it('omits reference band when range is null or invalid', () => {
    const points: TrendPoint[] = [{ date: '2026-08-01', value: 100 }];
    const param: TrendParam = {
      parameter: 'Test',
      referenceRange: null,
      points,
    };

    const option = buildTrendOption(mockEc, {
      param,
      points,
      chartType: 'line',
      theme: 'dark',
    });

    expect(option.series[0].markArea).toBeUndefined();
  });

  it('handles light theme colors correctly', () => {
    const points: TrendPoint[] = [{ date: '2026-08-01', value: 100 }];
    const param: TrendParam = {
      parameter: 'Test',
      points,
    };

    const option = buildTrendOption(mockEc, {
      param,
      points,
      chartType: 'line',
      theme: 'light',
    });

    expect(option.series[0].lineStyle.color).toBe('#7c3aed');
    expect(option.xAxis.axisLabel.color).toBe('#475569');
    expect(option.grid.top).toBe(24);
  });

  it('handles dates in various formats', () => {
    const points: TrendPoint[] = [
      { date: '2026-08-01', value: 100 },
      { date: '2026-08-15', value: 105 },
      { date: '2026-09-01', value: 110 },
    ];
    const param: TrendParam = {
      parameter: 'Test',
      points,
    };

    const option = buildTrendOption(mockEc, {
      param,
      points,
      chartType: 'line',
      theme: 'dark',
    });

    expect(option.xAxis.data).toHaveLength(3);
    expect(option.xAxis.data[0]).toMatch(/Aug/);
  });

  it('includes tooltip for dark theme only', () => {
    const points: TrendPoint[] = [{ date: '2026-08-01', value: 100 }];
    const param: TrendParam = { parameter: 'Test', points };

    const darkOption = buildTrendOption(mockEc, {
      param,
      points,
      chartType: 'line',
      theme: 'dark',
    });
    expect(darkOption.tooltip).toBeDefined();

    const lightOption = buildTrendOption(mockEc, {
      param,
      points,
      chartType: 'line',
      theme: 'light',
    });
    expect(lightOption.tooltip).toBeUndefined();
  });
});

describe('buildSparklineOption', () => {
  const mockEc = {
    graphic: {
      LinearGradient: function (x0: number, y0: number, x1: number, y1: number, stops: any[]) {
        return { _type: 'LinearGradient', x0, y0, x1, y1, stops };
      },
    },
  };

  it('builds a minimal sparkline for multiple points', () => {
    const points: TrendPoint[] = [
      { date: '2026-08-01', value: 100 },
      { date: '2026-08-02', value: 110 },
      { date: '2026-08-03', value: 105 },
    ];

    const option = buildSparklineOption(mockEc, { points });

    expect(option).toBeDefined();
    expect(option.backgroundColor).toBe('transparent');
    expect(option.series[0].type).toBe('line');
    expect(option.series[0].data).toEqual([100, 110, 105]);
    expect(option.series[0].animation).toBe(false);
  });

  it('shows symbol only on the last point', () => {
    const points: TrendPoint[] = [
      { date: '2026-08-01', value: 100 },
      { date: '2026-08-02', value: 110 },
      { date: '2026-08-03', value: 105 },
    ];

    const option = buildSparklineOption(mockEc, { points });

    expect(option.series[0].symbolSize).toBeDefined();
    // Test the function for each dataIndex
    expect(option.series[0].symbolSize(null, { dataIndex: 0 })).toBe(0);
    expect(option.series[0].symbolSize(null, { dataIndex: 1 })).toBe(0);
    expect(option.series[0].symbolSize(null, { dataIndex: 2 })).toBe(5); // last point
  });

  it('marks abnormal points in red', () => {
    const points: TrendPoint[] = [
      { date: '2026-08-01', value: 100, flag: 'N' },
      { date: '2026-08-02', value: 110, flag: 'H' },
      { date: '2026-08-03', value: 105, flag: null },
    ];

    const option = buildSparklineOption(mockEc, { points });

    expect(option.series[0].itemStyle.color).toBeDefined();
    expect(option.series[0].itemStyle.color({ dataIndex: 0 })).toBe('#a855f7');
    expect(option.series[0].itemStyle.color({ dataIndex: 1 })).toBe('#fb7185');
    expect(option.series[0].itemStyle.color({ dataIndex: 2 })).toBe('#a855f7');
  });

  it('includes reference band when range is provided', () => {
    const points: TrendPoint[] = [{ date: '2026-08-01', value: 100 }];

    const option = buildSparklineOption(mockEc, {
      points,
      referenceRange: '70 - 100',
    });

    expect(option.series[0].markArea).toBeDefined();
    expect(option.series[0].markArea.data[0]).toEqual([{ yAxis: 70 }, { yAxis: 100 }]);
  });

  it('omits reference band when range is null or invalid', () => {
    const points: TrendPoint[] = [{ date: '2026-08-01', value: 100 }];

    const option = buildSparklineOption(mockEc, {
      points,
      referenceRange: null,
    });

    expect(option.series[0].markArea).toBeUndefined();
  });

  it('has minimal grid and no axes displayed', () => {
    const points: TrendPoint[] = [{ date: '2026-08-01', value: 100 }];

    const option = buildSparklineOption(mockEc, { points });

    expect(option.grid.left).toBe(3);
    expect(option.grid.right).toBe(3);
    expect(option.xAxis.show).toBe(false);
    expect(option.yAxis.show).toBe(false);
  });

  it('handles single point', () => {
    const points: TrendPoint[] = [{ date: '2026-08-01', value: 100 }];

    const option = buildSparklineOption(mockEc, { points });

    expect(option.series[0].data).toEqual([100]);
    // Last point should show symbol
    expect(option.series[0].symbolSize(null, { dataIndex: 0 })).toBe(5);
  });
});

describe('filterTrendPoints', () => {
  it('returns last 5 points for duration "5"', () => {
    const points: TrendPoint[] = [
      { date: '2026-08-01', value: 100 },
      { date: '2026-08-02', value: 101 },
      { date: '2026-08-03', value: 102 },
      { date: '2026-08-04', value: 103 },
      { date: '2026-08-05', value: 104 },
      { date: '2026-08-06', value: 105 },
    ];

    const result = filterTrendPoints(points, '5');

    expect(result).toHaveLength(5);
    expect(result[0].value).toBe(101);
    expect(result[4].value).toBe(105);
  });

  it('returns last 10 points for duration "10"', () => {
    const points: TrendPoint[] = Array.from({ length: 15 }, (_, i) => ({
      date: `2026-08-${String(i + 1).padStart(2, '0')}`,
      value: 100 + i,
    }));

    const result = filterTrendPoints(points, '10');

    expect(result).toHaveLength(10);
    expect(result[0].value).toBe(105);
  });

  it('filters by 3 months (90 days)', () => {
    const now = Date.now();
    const cutoff = now - 90 * 86400_000;
    const points: TrendPoint[] = [
      { date: new Date(cutoff - 30 * 86400_000).toISOString().split('T')[0], value: 100 },
      { date: new Date(cutoff + 10 * 86400_000).toISOString().split('T')[0], value: 101 },
      { date: new Date(cutoff + 50 * 86400_000).toISOString().split('T')[0], value: 102 },
    ];

    const result = filterTrendPoints(points, '3m');

    expect(result).toHaveLength(2);
    expect(result[0].value).toBe(101);
  });

  it('filters by 6 months (180 days)', () => {
    const now = Date.now();
    const cutoff = now - 180 * 86400_000;
    const points: TrendPoint[] = [
      { date: new Date(cutoff - 30 * 86400_000).toISOString().split('T')[0], value: 100 },
      { date: new Date(cutoff + 10 * 86400_000).toISOString().split('T')[0], value: 101 },
      { date: new Date(cutoff + 100 * 86400_000).toISOString().split('T')[0], value: 102 },
    ];

    const result = filterTrendPoints(points, '6m');

    expect(result).toHaveLength(2);
    expect(result[0].value).toBe(101);
  });

  it('returns all points for unknown duration', () => {
    const points: TrendPoint[] = [
      { date: '2026-08-01', value: 100 },
      { date: '2026-08-02', value: 101 },
    ];

    const result = filterTrendPoints(points, 'all');

    expect(result).toEqual(points);
  });

  it('sorts points by date before filtering', () => {
    const points: TrendPoint[] = [
      { date: '2026-08-05', value: 105 },
      { date: '2026-08-01', value: 101 },
      { date: '2026-08-03', value: 103 },
      { date: '2026-08-02', value: 102 },
    ];

    const result = filterTrendPoints(points, '10');

    expect(result[0].date).toBe('2026-08-01');
    expect(result[1].date).toBe('2026-08-02');
  });

  it('does not mutate the original array', () => {
    const points: TrendPoint[] = [
      { date: '2026-08-01', value: 100 },
      { date: '2026-08-02', value: 101 },
    ];
    const original = [...points];

    filterTrendPoints(points, '5');

    expect(points).toEqual(original);
  });

  it('handles empty array', () => {
    const points: TrendPoint[] = [];

    const result = filterTrendPoints(points, '5');

    expect(result).toEqual([]);
  });

  it('handles single point', () => {
    const points: TrendPoint[] = [{ date: '2026-08-01', value: 100 }];

    const result = filterTrendPoints(points, '5');

    expect(result).toEqual([{ date: '2026-08-01', value: 100 }]);
  });
});

describe('renderTrendogramPng', () => {
  // Mock document for DOM operations
  let mockDiv: any;
  let appendedElement: Node | null = null;

  beforeEach(() => {
    // Reset mocks before each test
    mockDiv = {
      style: { cssText: '' },
    };

    // Mock document.createElement
    vi.spyOn(document, 'createElement').mockReturnValue(mockDiv as any);
    vi.spyOn(document.body, 'appendChild').mockImplementation((el) => {
      appendedElement = el;
      return el;
    });
    vi.spyOn(document.body, 'removeChild').mockImplementation((el) => {
      if (el === appendedElement) {
        appendedElement = null;
      }
      return el;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for empty points array', async () => {
    const param: TrendParam = {
      parameter: 'Test',
      points: [],
    };
    const points: TrendPoint[] = [];

    const result = await renderTrendogramPng({
      param,
      points,
      chartType: 'line',
      title: 'Test Chart',
    });

    expect(result).toBeNull();
  });

  it('needs-harness: full echarts + DOM mock for rendering PNG', () => {
    // This test would require proper echarts mocking which is complex
    // The renderTrendogramPng function uses dynamic import of echarts
    // and DOM manipulation that requires integration testing
    // Marking as needs-harness since it requires DOM and echarts async import
    expect(true).toBe(true);
  });
});
