import type { ChartData, ChartPoint } from './report-chart/report-chart.data';
import { reportFlag } from './report-flag';
import { parseTrendRange, type TrendPoint } from './trend-chart';

/**
 * Vector trendograms (report layout plan 3.11, `reportStyle.charts.trend`).
 *
 * A trendogram used to reach the PDF as a picture drawn by a chart library.
 * With the Vector style the report receives the SERIES instead and draws it with
 * the same chart painter the Test Master chart blocks use (report-chart.*): the
 * lines, band, axis and text are real PDF shapes in the report's own type and
 * accent, with a "nice" axis (0, 25, 50 ...), crisp at any zoom, and still
 * readable in black and white (the normal range is a tint under the line, and
 * an abnormal point is filled and carries its H / L letter).
 */

/** One serial-result series to draw, as the report receives it. */
export interface TrendogramSeries {
  title: string;
  unit: string | null;
  /** The parameter's printed range ("12.0 - 16.0"), for the normal band. */
  referenceRange: string | null;
  points: TrendPoint[];
  chartType: 'line' | 'bar';
}

/** "05 Mar 26" - fixed, not locale-dependent, so a PDF never differs by machine. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function trendDateLabel(iso: string): string {
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return String(iso).slice(0, 10);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
}

/** The chart painter's data for one trend series. */
export function trendChartData(s: TrendogramSeries, opts: { band: boolean; values: boolean; size: 'half' | 'full' }): ChartData {
  const band = parseTrendRange(s.referenceRange);
  const points: ChartPoint[] = s.points.map(p => {
    const f = reportFlag(p.flag, p.value, band ? { low: band.low, high: band.high } : s.referenceRange);
    return {
      value: p.value, display: String(p.value), flag: f.flag, isLow: f.isLow, abnormal: f.abnormal,
      low: band ? band.low : null, high: band ? band.high : null, unit: s.unit,
    };
  });
  return {
    title: s.title, kind: s.chartType === 'bar' ? 'bar' : 'line', size: opts.size,
    xLabels: s.points.map(p => trendDateLabel(p.date)),
    series: [{ label: s.unit ?? '', unit: s.unit, secondary: false, points }],
    thresholds: [], refBand: opts.band && !!band, showValues: opts.values, yMin: null, yMax: null,
    missing: [], empty: points.length === 0,
  };
}

/** Cells per row for the chosen layout. */
export function trendPerRow(layout: 'grid-2' | 'grid-3' | 'list'): 1 | 2 | 3 {
  return layout === 'grid-3' ? 3 : layout === 'list' ? 1 : 2;
}
