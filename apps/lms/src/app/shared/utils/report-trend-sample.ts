import type { TrendogramItem } from './trendogram-report';
import type { TrendogramSeries } from './report-trend-vector';

/**
 * Sample serial results for the report designer's preview (Footer tab): five
 * visits of a few common tests, with one value off each end of the normal band, so
 * the Chart panel card shows what a lab's trend charts will look like. Nothing here
 * is a real patient's data and it never reaches a real report.
 */
export function sampleTrendSeries(now = Date.now()): TrendogramSeries[] {
  const at = (monthsAgo: number) => new Date(now - monthsAgo * 30 * 86400_000).toISOString();
  const mk = (name: string, unit: string, range: string, vals: Array<[number, string]>): TrendogramSeries => ({
    title: `${name} (${unit})`, unit, referenceRange: range, chartType: 'line',
    points: vals.map(([value, flag], i) => ({ date: at((vals.length - 1 - i) * 2), value, flag })),
  });
  return [
    mk('Haemoglobin', 'g/dL', '12.0 - 16.0', [[11.2, 'L'], [11.8, 'L'], [12.6, ''], [13.4, ''], [14.1, '']]),
    mk('Total Cholesterol', 'mg/dL', '0 - 200', [[238, 'H'], [226, 'H'], [214, 'H'], [196, ''], [188, '']]),
    mk('SGPT (ALT)', 'U/L', '0 - 41', [[34, ''], [52, 'H'], [96, 'H'], [64, 'H'], [38, '']]),
    mk('Fasting Glucose', 'mg/dL', '70 - 100', [[92, ''], [104, 'H'], [118, 'H'], [99, ''], [88, '']]),
  ];
}

/** The preview's trendograms in the style being edited: the series to draw (vector) or pictures (as today). */
export async function sampleTrendograms(vector: boolean): Promise<TrendogramItem[]> {
  const series = sampleTrendSeries();
  if (vector) return series.map(s => ({ title: s.title, dataUrl: '', series: s }));
  const { renderTrendogramPng } = await import('./trend-chart');
  const out: TrendogramItem[] = [];
  for (const s of series) {
    const dataUrl = await renderTrendogramPng({
      param: { parameter: s.title, unit: s.unit, referenceRange: s.referenceRange, points: s.points },
      points: s.points, chartType: s.chartType, title: s.title,
    });
    if (dataUrl) out.push({ title: s.title, dataUrl });
  }
  return out;
}
