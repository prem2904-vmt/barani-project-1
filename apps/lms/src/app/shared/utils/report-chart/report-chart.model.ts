/**
 * Report chart — the Test Master's chart block (docs/REPORT-CHARTS.md).
 *
 * Stored as the `trend` object of a layout section `{ type: 'chart', label,
 * hidden, trend }` in the test's existing report layout JSON. Any test or
 * profile can carry one; nothing here is OGTT-specific. The legacy
 * single-value gauge chart (`parameter` / `min` / `max` / `zones`, no `trend`)
 * is a different, untouched shape.
 */

export type ChartKind = 'line' | 'bar' | 'dots';
/** X axis: the timed-series time points of a repetitive profile, or a list
 *  of values the author picks. */
export type ChartXSource = 'series' | 'parameters';
export type ChartSize = 'full' | 'half';

/** One plotted line of a time-point chart: the values in `unit` (and, when
 *  set, only values whose name contains `match`). */
export interface ChartLineSpec {
  unit?: string | null;
  match?: string | null;
  label?: string | null;
}

export interface ChartThreshold {
  value: number;
  label?: string | null;
}

export interface ReportChartSpec {
  v: 1;
  kind: ChartKind;
  x: ChartXSource;
  /** x = 'series': at most {@link MAX_LINES}. */
  lines?: ChartLineSpec[];
  /** x = 'series': offset (minutes, as a string key) → tick label. */
  xLabels?: Record<string, string>;
  /** x = 'parameters': the value names, in plotting order. */
  parameters?: string[];
  /** Shade each point's normal band (from the saved result snapshot). */
  refBand: boolean;
  thresholds: ChartThreshold[];
  showValues: boolean;
  size: ChartSize;
  /** Fixed axis limits; null = automatic. */
  yMin: number | null;
  yMax: number | null;
}

export const MAX_LINES = 2;
export const MAX_THRESHOLDS = 4;
export const MAX_PARAMETERS = 12;
export const CHART_KINDS: ReadonlyArray<{ value: ChartKind; label: string }> = [
  { value: 'line', label: 'Line' },
  { value: 'bar', label: 'Bar' },
  { value: 'dots', label: 'Dots' },
];

/** A fresh chart for a test: time points on a repetitive profile (a line),
 *  otherwise the first numeric values (bars). */
export function defaultChartSpec(opts: { series: boolean; parameters?: readonly string[]; unit?: string | null }): ReportChartSpec {
  return opts.series
    ? { v: 1, kind: 'line', x: 'series', lines: [{ unit: opts.unit ?? null }], xLabels: {},
        refBand: true, thresholds: [], showValues: true, size: 'full', yMin: null, yMax: null }
    : { v: 1, kind: 'bar', x: 'parameters', parameters: (opts.parameters ?? []).slice(0, 6),
        refBand: true, thresholds: [], showValues: true, size: 'full', yMin: null, yMax: null };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown, max = 80): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, max) : null;
}

/** Clamp a stored / edited spec into a valid one. Never throws: whatever the
 *  JSON holds, the renderer gets a spec it can draw (or null = not a chart). */
export function normalizeChartSpec(raw: unknown): ReportChartSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const kind: ChartKind = r['kind'] === 'bar' || r['kind'] === 'dots' ? r['kind'] : 'line';
  const x: ChartXSource = r['x'] === 'parameters' ? 'parameters' : 'series';
  const thresholds: ChartThreshold[] = (Array.isArray(r['thresholds']) ? r['thresholds'] : [])
    .map(t => (t && typeof t === 'object') ? t as Record<string, unknown> : {})
    .map(t => ({ value: num(t['value']), label: str(t['label'], 60) }))
    .filter((t): t is { value: number; label: string | null } => t.value !== null)
    .slice(0, MAX_THRESHOLDS);
  let yMin = num(r['yMin']);
  let yMax = num(r['yMax']);
  if (yMin !== null && yMax !== null && yMax <= yMin) { yMin = null; yMax = null; }
  const spec: ReportChartSpec = {
    v: 1, kind, x,
    refBand: r['refBand'] !== false,
    thresholds,
    showValues: r['showValues'] !== false,
    size: r['size'] === 'half' ? 'half' : 'full',
    yMin, yMax,
  };
  if (x === 'series') {
    const lines = (Array.isArray(r['lines']) ? r['lines'] : [{}])
      .map(l => (l && typeof l === 'object') ? l as Record<string, unknown> : {})
      .map(l => ({ unit: str(l['unit'], 30), match: str(l['match'], 40), label: str(l['label'], 40) }))
      .slice(0, MAX_LINES);
    spec.lines = lines.length ? lines : [{ unit: null, match: null, label: null }];
    const labels: Record<string, string> = {};
    const xl = r['xLabels'];
    if (xl && typeof xl === 'object' && !Array.isArray(xl)) {
      for (const [k, v] of Object.entries(xl as Record<string, unknown>)) {
        const n = num(k);
        const s = str(v, 30);
        if (n !== null && n >= 0 && s) labels[String(Math.round(n))] = s;
      }
    }
    spec.xLabels = labels;
  } else {
    const seen = new Set<string>();
    spec.parameters = (Array.isArray(r['parameters']) ? r['parameters'] : [])
      .map(p => str(p, 120))
      .filter((p): p is string => !!p && !seen.has(p.toLowerCase()) && !!seen.add(p.toLowerCase()))
      .slice(0, MAX_PARAMETERS);
  }
  return spec;
}

/** The tick label of a time point: the author's label, else "Fasting" for
 *  the first draw and "30 min" / "120 min" after it. */
export function offsetTickLabel(offsetMin: number, labels?: Record<string, string> | null): string {
  const own = labels?.[String(offsetMin)];
  if (own && own.trim()) return own.trim();
  return offsetMin <= 0 ? 'Fasting' : `${offsetMin} min`;
}
