import { defaultChartSpec, normalizeChartSpec, offsetTickLabel, MAX_LINES, MAX_THRESHOLDS } from './report-chart.model';

describe('report chart spec (Test Master chart block)', () => {
  it('is not a chart without an object', () => {
    expect(normalizeChartSpec(null)).toBeNull();
    expect(normalizeChartSpec('line')).toBeNull();
    expect(normalizeChartSpec([])).toBeNull();
  });

  it('fills sensible defaults from an empty object (a time-point line)', () => {
    const s = normalizeChartSpec({})!;
    expect(s).toMatchObject({ v: 1, kind: 'line', x: 'series', refBand: true, showValues: true, size: 'full', yMin: null, yMax: null });
    expect(s.lines).toEqual([{ unit: null, match: null, label: null }]);
    expect(s.thresholds).toEqual([]);
  });

  it('clamps every field: unknown kinds, bad thresholds, inverted axis, too many lines', () => {
    const s = normalizeChartSpec({
      kind: 'sunburst', x: 'series', size: 'huge', refBand: false, showValues: false,
      lines: [{ unit: 'mg/dL' }, { unit: 'µIU/mL', match: 'insulin' }, { unit: 'x' }, {}, {}, {}, { unit: 'seventh' }],
      thresholds: [{ value: '140', label: '  IGT ≥ 140 ' }, { value: 'abc' }, { value: 200 }, { value: 1 }, { value: 2 }, { value: 3 }],
      yMin: 300, yMax: 100, xLabels: { 0: 'Fasting', '30': '', '-5': 'bad', x: 'bad', 60: '1 hour' },
    })!;
    expect(s.kind).toBe('line');
    expect(s.size).toBe('full');
    expect(s.refBand).toBe(false);
    expect(s.showValues).toBe(false);
    expect(s.lines).toHaveLength(MAX_LINES);
    expect(s.lines![1]).toEqual({ unit: 'µIU/mL', match: 'insulin', label: null });
    expect(s.thresholds).toHaveLength(MAX_THRESHOLDS);
    expect(s.thresholds[0]).toEqual({ value: 140, label: 'IGT ≥ 140' });
    expect(s.yMin).toBeNull();
    expect(s.yMax).toBeNull();
    expect(s.xLabels).toEqual({ '0': 'Fasting', '60': '1 hour' });
  });

  it('keeps a chosen-values list unique and in order', () => {
    const s = normalizeChartSpec({ kind: 'bar', x: 'parameters', parameters: ['HDL', 'LDL', 'hdl', '', 7, 'VLDL'] })!;
    expect(s.kind).toBe('bar');
    expect(s.parameters).toEqual(['HDL', 'LDL', 'VLDL']);
    expect(s.lines).toBeUndefined();
  });

  it('defaults: a line over time points for a series, bars over the first six values otherwise', () => {
    expect(defaultChartSpec({ series: true })).toMatchObject({ kind: 'line', x: 'series' });
    const b = defaultChartSpec({ series: false, parameters: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
    expect(b).toMatchObject({ kind: 'bar', x: 'parameters' });
    expect(b.parameters).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('labels time points: the author\'s label, else Fasting / N min', () => {
    expect(offsetTickLabel(0)).toBe('Fasting');
    expect(offsetTickLabel(30)).toBe('30 min');
    expect(offsetTickLabel(120, { '120': '2 h' })).toBe('2 h');
    expect(offsetTickLabel(0, { '0': 'Baseline' })).toBe('Baseline');
  });
});
