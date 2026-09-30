/**
 * Report chart — the Test Master's chart block (docs/REPORT-CHARTS.md).
 *
 * Stored as the `trend` object of a layout section `{ type: 'chart', label,
 * hidden, trend }` in the test's existing report layout JSON. Any test or
 * profile can carry one; nothing here is OGTT-specific. The legacy
 * single-value gauge chart (`parameter` / `min` / `max` / `zones`, no `trend`)
 * is a different, untouched shape.
 */

/** The chart types (docs/REPORT-CHARTS.md §1). `line` / `bar` / `dots` are
 *  the v1 kinds and keep their exact drawing. */
export type ChartKind =
  | 'line' | 'smooth' | 'step' | 'area' | 'stackedArea'
  | 'bar' | 'hbar' | 'groupedBar' | 'stackedBar' | 'dots'
  | 'pie' | 'donut' | 'radar' | 'gauge' | 'combo';
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

/** A further set of chosen values: `parameters[i]` is compared with the
 *  main list's i-th value (null = nothing at that position). */
export interface ChartSetSpec {
  label?: string | null;
  parameters: Array<string | null>;
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
  /** x = 'parameters': further sets of values compared against `parameters`
   *  (grouped / stacked bars, combination), aligned by position — e.g. the
   *  WBC differential's absolute counts next to its percentages. */
  sets?: ChartSetSpec[];
  /** x = 'parameters' with sets: the legend name of the main list. */
  mainLabel?: string | null;
  /** Shade each point's normal band (from the saved result snapshot). */
  refBand: boolean;
  thresholds: ChartThreshold[];
  showValues: boolean;
  size: ChartSize;
  /** Fixed axis limits; null = automatic. */
  yMin: number | null;
  yMax: number | null;
}

/** Plotted series (time-point lines, or the chosen list + its sets). */
export const MAX_LINES = 6;
export const MAX_THRESHOLDS = 4;
export const MAX_PARAMETERS = 12;
export type ChartFamily = 'line' | 'bar' | 'part' | 'single';
export interface ChartKindInfo { value: ChartKind; label: string; family: ChartFamily; }
/** The picker's catalogue, in display order. */
export const CHART_KINDS: ReadonlyArray<ChartKindInfo> = [
  { value: 'line', label: 'Line', family: 'line' },
  { value: 'smooth', label: 'Smooth line', family: 'line' },
  { value: 'step', label: 'Step line', family: 'line' },
  { value: 'area', label: 'Area', family: 'line' },
  { value: 'stackedArea', label: 'Stacked area', family: 'line' },
  { value: 'bar', label: 'Bar', family: 'bar' },
  { value: 'hbar', label: 'Horizontal bar', family: 'bar' },
  { value: 'groupedBar', label: 'Grouped bar', family: 'bar' },
  { value: 'stackedBar', label: 'Stacked bar', family: 'bar' },
  { value: 'combo', label: 'Bar + line', family: 'bar' },
  { value: 'dots', label: 'Dots', family: 'line' },
  { value: 'pie', label: 'Pie', family: 'part' },
  { value: 'donut', label: 'Donut', family: 'part' },
  { value: 'radar', label: 'Radar', family: 'part' },
  { value: 'gauge', label: 'Gauge', family: 'single' },
];
const KIND_SET = new Set<string>(CHART_KINDS.map(k => k.value));
/** Names other tools use for the same chart (ECharts / Excel words). */
const KIND_ALIASES: Readonly<Record<string, ChartKind>> = {
  scatter: 'dots', points: 'dots', spline: 'smooth', curve: 'smooth', column: 'bar', vbar: 'bar',
  horizontalbar: 'hbar', 'horizontal-bar': 'hbar', grouped: 'groupedBar', 'grouped-bar': 'groupedBar',
  stacked: 'stackedBar', 'stacked-bar': 'stackedBar', 'stacked-area': 'stackedArea', doughnut: 'donut',
  ring: 'donut', meter: 'gauge', spider: 'radar', mixed: 'combo', 'bar-line': 'combo',
  stackedarea: 'stackedArea', stackedbar: 'stackedBar', groupedbar: 'groupedBar',
};

/** Bars / slices that share one value axis stack or group. */
export const STACKED_KINDS: ReadonlySet<ChartKind> = new Set<ChartKind>(['stackedArea', 'stackedBar']);
/** Kinds drawn on an x / y grid (the v1 geometry). */
export const CARTESIAN_KINDS: ReadonlySet<ChartKind> = new Set<ChartKind>(
  ['line', 'smooth', 'step', 'area', 'stackedArea', 'bar', 'groupedBar', 'stackedBar', 'dots', 'combo']);
/** Which overlays / settings a kind supports (the editor hides the rest). */
export function kindSupports(kind: ChartKind): { band: boolean; thresholds: boolean; axis: boolean; sets: boolean } {
  const polar = kind === 'pie' || kind === 'donut' || kind === 'radar';
  return {
    band: !STACKED_KINDS.has(kind) && kind !== 'pie' && kind !== 'donut',
    thresholds: !polar,
    axis: !polar,
    sets: kind === 'groupedBar' || kind === 'stackedBar' || kind === 'combo',
  };
}

/** What the test's data looks like, for offering only the chart types that
 *  make sense (report-chart.sample.ts `chartShape`). */
export interface ChartShape {
  x: ChartXSource;
  /** Series mode: a time point carries two or more numeric values. */
  multiPerPoint: boolean;
  /** Series mode: a time point carries two or more numeric values in ONE unit. */
  sameUnitPerPoint: boolean;
  /** Numeric values the test (or its members) can chart. */
  available: number;
  /** …of which are percentages (parts of a whole). */
  percent: number;
  /** The largest group of values sharing ONE unit that can never be
   *  negative (parts of a whole given as counts, e.g. absolute differential
   *  counts). Missing = 0 (a shape from before counts were allowed). */
  partMax?: number;
  /** The test is a timed series (time points exist). */
  series: boolean;
}

/** Can this kind draw the test's data? A disabled kind carries a one-line reason. */
export function kindAvailability(kind: ChartKind, shape: ChartShape): { ok: boolean; reason: string | null } {
  const no = (reason: string) => ({ ok: false, reason });
  const yes = { ok: true, reason: null };
  if (shape.x === 'series') {
    switch (kind) {
      case 'groupedBar': case 'combo':
        return shape.multiPerPoint ? yes : no('Needs 2 values per time point');
      case 'stackedArea': case 'stackedBar':
        return shape.sameUnitPerPoint ? yes : no('Needs 2 values in one unit per time point');
      case 'hbar': return no('Time runs left to right — use Bar');
      case 'pie': case 'donut': return no('Parts of a whole — needs Chosen values');
      case 'radar': return no('Needs Chosen values (3+)');
      case 'gauge': return no('Shows one value — needs Chosen values');
      default: return yes;
    }
  }
  switch (kind) {
    case 'line': case 'smooth': case 'step': case 'area': case 'stackedArea':
      return no(shape.series ? 'Joins time points — pick Time points' : 'Joins time points — not a timed series');
    case 'pie': case 'donut':
      return shape.percent >= 2 || (shape.partMax ?? 0) >= 2 ? yes : no('Parts of a whole — 2+ values in one unit');
    case 'radar': return shape.available >= 3 ? yes : no('Needs 3 or more numeric values');
    case 'groupedBar': case 'stackedBar': case 'combo':
      return shape.available >= 2 ? yes : no('Needs 2 sets of values');
    default:
      return shape.available >= 1 ? yes : no('This test has no numeric values');
  }
}

/** A stored kind → a known kind (v1 kinds unchanged; aliases mapped;
 *  anything else draws as a line, as v1 did). */
export function normalizeKind(raw: unknown): ChartKind {
  if (typeof raw !== 'string') return 'line';
  const k = raw.trim();
  if (KIND_SET.has(k)) return k as ChartKind;
  return KIND_ALIASES[k.toLowerCase()] ?? (KIND_SET.has(k.toLowerCase()) ? k.toLowerCase() as ChartKind : 'line');
}

/** Is `unit` a percentage (a part of a whole)? */
export function isPercentUnit(unit: string | null | undefined): boolean {
  return /^\s*%\s*$|^\s*(percent|per ?cent|pct)\s*$/i.test(unit ?? '');
}

/**
 * Can these values print as parts of a whole (pie / donut)? Two or more
 * values sharing ONE unit — % (the values are the shares) or any other unit
 * (counts: each slice's share is computed from the total) — none negative.
 * A value with no saved unit takes the others' unit; missing values are
 * skipped. Fewer than two present values still draw (one part = the whole).
 */
export function partsOfWhole(points: ReadonlyArray<{ value: number | null; unit?: string | null }>):
  { ok: boolean; reason: string | null; percent: boolean; unit: string | null; total: number } {
  const present = points.filter(p => p.value != null);
  const units = [...new Set(present.map(p => (p.unit ?? '').trim()).filter(Boolean).map(u => u.toLowerCase()))];
  const unit = present.map(p => (p.unit ?? '').trim()).find(Boolean) ?? null;
  const total = present.reduce((a, p) => a + Math.max(0, p.value as number), 0);
  const percent = isPercentUnit(unit);
  if (units.length > 1) return { ok: false, reason: 'the values are in different units', percent, unit, total };
  if (present.some(p => (p.value as number) < 0)) return { ok: false, reason: 'a value is negative', percent, unit, total };
  return { ok: true, reason: null, percent, unit, total };
}

/** A part's share of the whole, as it prints ("62 %", "8.4 %", "0.6 %"). */
export function shareText(value: number, total: number): string {
  if (!(total > 0) || value < 0) return '';
  const pc = (value / total) * 100;
  return `${pc >= 10 || pc === 0 ? pc.toFixed(0) : pc.toFixed(1)} %`;
}

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
  const kind = normalizeKind(r['kind']);
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
    const n = spec.parameters.length;
    const sets = (Array.isArray(r['sets']) ? r['sets'] : [])
      .map(x => (x && typeof x === 'object' && !Array.isArray(x)) ? x as Record<string, unknown> : null)
      .filter((x): x is Record<string, unknown> => !!x && Array.isArray(x['parameters']))
      .map(x => {
        const ps = (x['parameters'] as unknown[]).map(p => str(p, 120)).slice(0, n);
        while (ps.length < n) ps.push(null);
        return { label: str(x['label'], 40), parameters: ps };
      })
      .filter(x => x.parameters.some(p => p))
      .slice(0, MAX_LINES - 1);
    if (sets.length) {
      spec.sets = sets;
      const ml = str(r['mainLabel'], 40);
      if (ml) spec.mainLabel = ml;
    }
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
