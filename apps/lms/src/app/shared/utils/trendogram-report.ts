import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { TrendTest, filterTrendPoints, renderTrendogramPng } from './trend-chart';

/** The trendogram preference stored on the order metadata + echoed into the
 *  report snapshot. `charts` is the explicit list the user picked in the popup;
 *  when absent we fall back to one chart per repeated test (its first param). */
export interface TrendogramConfig {
  enabled?: boolean;
  duration?: string;                 // '5' | '10' | '3m' | '6m' | 'all'
  chartType?: 'line' | 'bar';
  charts?: Array<{ testId: string; parameter: string }>;
}

/**
 * From a report row, produce the Trendogram PNGs to embed in its PDF. Reads
 * snapshot.trendogram + snapshot.patient.id, fetches /lab-trends, and renders
 * each selected (test, parameter) to a PNG over the chosen duration. Returns []
 * when the feature is off, there's no data, or anything fails (never throws).
 */
export async function prepareTrendograms(
  report: { data?: string | null },
  api: ApiService,
): Promise<Array<{ title: string; dataUrl: string }>> {
  let snap: { trendogram?: TrendogramConfig; patient?: { id?: string } };
  try { snap = JSON.parse(report.data ?? '{}'); } catch { return []; }
  const cfg = snap?.trendogram;
  const patientId = snap?.patient?.id;
  if (!cfg?.enabled || !patientId) return [];

  let trends: TrendTest[] = [];
  try {
    const r = await firstValueFrom(api.get<{ tests: TrendTest[] }>(`/api/patients/${patientId}/lab-trends`));
    trends = r?.tests ?? [];
  } catch { return []; }
  if (trends.length === 0) return [];

  const duration = cfg.duration ?? '5';
  const chartType = cfg.chartType ?? 'line';

  // Explicit picks from the popup, else one chart per repeated test (first param).
  const wanted = (cfg.charts && cfg.charts.length)
    ? cfg.charts
    : trends.map(t => ({ testId: t.testId, parameter: t.parameters[0]?.parameter ?? '' }))
            .filter(c => !!c.parameter);

  const out: Array<{ title: string; dataUrl: string }> = [];
  for (const w of wanted) {
    const test = trends.find(t => t.testId === w.testId);
    const param = test?.parameters.find(p => p.parameter === w.parameter);
    if (!test || !param) continue;
    const points = filterTrendPoints(param.points, duration);
    if (points.length < 2) continue;   // no trend to draw
    const title = `${test.testName} — ${param.parameter}${param.unit ? ' (' + param.unit + ')' : ''}`;
    const dataUrl = await renderTrendogramPng({ param, points, chartType, title });
    if (dataUrl) out.push({ title, dataUrl });
  }
  return out;
}
