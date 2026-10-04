/**
 * Report chart data — maps a chart spec + the report snapshot's tests to the
 * points the chart plots (docs/REPORT-CHARTS.md §4). Pure; no Angular, no PDF.
 *
 * Every number comes from the SAVED result snapshot: the value, its flag (as
 * `reportFlag` prints it — criticals are H / L, never C) and the band
 * numbers `low` / `high` mw saved with it. Nothing is recomputed against the
 * live Test Master.
 */
import { reportFlag, reportNumber, type ReportFlagLetter } from '../report-flag';
import { normalizeChartSpec, offsetTickLabel, type ChartKind, type ChartLineSpec, type ChartSize, type ChartThreshold, type ReportChartSpec } from './report-chart.model';

/** The snapshot test fields the chart reads (`ReportSnapshot.tests[n]`). */
export interface ChartTestLike {
  testId?: string;
  name?: string;
  code?: string | null;
  shortName?: string | null;
  packageTestId?: string | null;
  profileTestId?: string | null;
  repeatOffsetMin?: number | null;
  result?: { values?: Record<string, unknown> | null } | Record<string, unknown> | null;
}

export interface ChartPoint {
  /** Numeric value, or null = a gap (missed / not measured). */
  value: number | null;
  /** The value as it prints ("142", "5.6"). */
  display: string;
  flag: ReportFlagLetter;
  isLow: boolean;
  abnormal: boolean;
  low: number | null;
  high: number | null;
  /** The saved value's unit (radar spokes / pie keys print it). */
  unit?: string | null;
}

export interface ChartSeries {
  label: string;
  unit: string | null;
  /** Right-hand axis (a 2nd line in a different unit). */
  secondary: boolean;
  points: ChartPoint[];
}

export interface ChartData {
  title: string;
  kind: ChartKind;
  size: ChartSize;
  xLabels: string[];
  series: ChartSeries[];
  thresholds: ChartThreshold[];
  refBand: boolean;
  showValues: boolean;
  yMin: number | null;
  yMax: number | null;
  /** X labels with no value on any line. */
  missing: string[];
  /** Nothing to plot at all. */
  empty: boolean;
}

interface Entry { name: string; test: ChartTestLike; raw: unknown; }

function valuesOf(t: ChartTestLike): Record<string, unknown> {
  const r = t.result as { values?: Record<string, unknown> | null } | null | undefined;
  return (r && typeof r === 'object' && r.values && typeof r.values === 'object') ? r.values : {};
}

function entriesOf(t: ChartTestLike): Entry[] {
  return Object.entries(valuesOf(t)).map(([name, raw]) => ({ name, test: t, raw }));
}

/** Scalar + metadata of one saved value (the flagged wrapper or a scalar). */
function readEntry(raw: unknown): { value: unknown; flag: string | null; unit: string | null; range: string | null; low: number | null; high: number | null } {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && 'value' in (raw as object)) {
    const o = raw as Record<string, unknown>;
    const n = (k: string) => (typeof o[k] === 'number' && Number.isFinite(o[k] as number) ? o[k] as number : null);
    return {
      value: o['value'],
      flag: typeof o['flag'] === 'string' ? o['flag'] as string : null,
      unit: typeof o['unit'] === 'string' && (o['unit'] as string).trim() ? (o['unit'] as string).trim() : null,
      range: typeof o['range'] === 'string' ? o['range'] as string : null,
      low: n('low'), high: n('high'),
    };
  }
  return { value: raw, flag: null, unit: null, range: null, low: null, high: null };
}

/** A value's number, or null when it is not a plain number ("Positive", "", null). */
function numeric(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean' || Array.isArray(v)) return null;
  return reportNumber(v);
}

function pointOf(raw: unknown, fallbackUnit?: string | null): { point: ChartPoint; unit: string | null } {
  const e = readEntry(raw);
  const v = numeric(e.value);
  if (v === null) return { point: gap(), unit: e.unit ?? fallbackUnit ?? null };
  const bounds = e.low !== null || e.high !== null ? { low: e.low, high: e.high } : e.range;
  const f = reportFlag(e.flag, v, bounds);
  return {
    point: {
      value: v, display: String(e.value).trim(), flag: f.flag, isLow: f.isLow, abnormal: f.abnormal,
      low: e.low, high: e.high, unit: e.unit ?? fallbackUnit ?? null,
    },
    unit: e.unit ?? fallbackUnit ?? null,
  };
}

function gap(): ChartPoint {
  return { value: null, display: '', flag: '', isLow: false, abnormal: false, low: null, high: null };
}

function isMember(t: ChartTestLike, ownerId: string): boolean {
  return !!ownerId && (t.profileTestId === ownerId || t.packageTestId === ownerId);
}

function haystack(e: Entry): string {
  return [e.name, e.test.name, e.test.code, e.test.shortName].filter(Boolean).join(' ').toLowerCase();
}

function sameUnit(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

/**
 * Build the plotted data. `ownerId` is the test whose layout carries the
 * chart (a profile: its members are read; a test: its own values).
 */
export function buildChartData(
  rawSpec: ReportChartSpec | unknown,
  title: string | null | undefined,
  ownerId: string,
  tests: readonly ChartTestLike[],
  /** value name → display title (the report's row titles), lower-cased keys ok. */
  titles?: Readonly<Record<string, string>> | null,
): ChartData | null {
  const spec = normalizeChartSpec(rawSpec);
  if (!spec) return null;
  const base = {
    title: (title ?? '').trim() || 'Chart',
    kind: spec.kind, size: spec.size, thresholds: spec.thresholds, refBand: spec.refBand,
    showValues: spec.showValues, yMin: spec.yMin, yMax: spec.yMax,
  };
  const out = spec.x === 'series' ? seriesData(spec, ownerId, tests) : parameterData(spec, ownerId, tests, titles ?? {});
  const missing = out.xLabels.filter((_, i) => out.series.every(s => s.points[i]?.value == null));
  const empty = out.xLabels.length === 0 || out.series.every(s => s.points.every(p => p.value == null));
  return { ...base, ...out, missing, empty };
}

function seriesData(spec: ReportChartSpec, ownerId: string, tests: readonly ChartTestLike[]): { xLabels: string[]; series: ChartSeries[] } {
  const members = tests.filter(t => isMember(t, ownerId) && t.repeatOffsetMin != null);
  const offsets = [...new Set(members.map(t => t.repeatOffsetMin as number))].sort((a, b) => a - b);
  const byOffset = offsets.map(o => members.filter(t => t.repeatOffsetMin === o).flatMap(entriesOf));
  const lines: ChartLineSpec[] = spec.lines?.length ? spec.lines : [{}];
  // A line with no unit takes the first numeric value's unit (the series' main analyte).
  const firstUnit = (() => {
    for (const es of byOffset) for (const e of es) {
      const r = readEntry(e.raw);
      if (numeric(r.value) !== null) return r.unit;
    }
    return null;
  })();
  const series: ChartSeries[] = [];
  let rightUnit: string | null = null;
  lines.forEach((line, li) => {
    const unit = (line.unit ?? '').trim() || (li === 0 ? firstUnit : null);
    const match = (line.match ?? '').trim().toLowerCase();
    const points = byOffset.map(entries => {
      const hit = entries.find(e => {
        const r = readEntry(e.raw);
        if (numeric(r.value) === null) return false;
        if (unit && r.unit && !sameUnit(r.unit, unit)) return false;
        if (unit && !r.unit && li > 0) return false;
        return !match || haystack(e).includes(match);
      });
      return hit ? pointOf(hit.raw, unit).point : gap();
    });
    const label = (line.label ?? '').trim() || (line.match ?? '').trim() || unit || `Line ${li + 1}`;
    const secondary = li > 0 && !!unit && !sameUnit(unit, series[0]?.unit);
    // Two axes at most: a line in a THIRD unit has no axis to sit on.
    if (secondary && rightUnit !== null && !sameUnit(unit, rightUnit)) return;
    if (secondary) rightUnit = unit ?? null;
    series.push({ label, unit: unit ?? null, secondary, points });
  });
  return { xLabels: offsets.map(o => offsetTickLabel(o, spec.xLabels)), series };
}

function parameterData(spec: ReportChartSpec, ownerId: string, tests: readonly ChartTestLike[],
  titles: Readonly<Record<string, string>>): { xLabels: string[]; series: ChartSeries[] } {
  const titleOf = (n: string) => {
    const k = Object.keys(titles).find(x => x.trim().toLowerCase() === n.trim().toLowerCase());
    return (k && titles[k]?.trim()) || prettyName(n);
  };
  const pool = tests.filter(t => t.testId === ownerId || isMember(t, ownerId)).flatMap(entriesOf);
  const names = spec.parameters ?? [];
  const read = (list: ReadonlyArray<string | null>) => {
    let unit: string | null = null;
    const points = list.map(n => {
      if (!n) return gap();
      const k = n.trim().toLowerCase();
      const e = pool.find(x => x.name.trim().toLowerCase() === k);
      if (!e) return gap();
      const p = pointOf(e.raw);
      unit ??= p.unit;
      return p.point;
    });
    return { unit, points };
  };
  const main = read(names);
  const series: ChartSeries[] = [{ label: main.unit ?? '', unit: main.unit, secondary: false, points: main.points }];
  let rightUnit: string | null = null;
  (spec.sets ?? []).forEach((set, si) => {
    const r = read(set.parameters);
    const secondary = !!r.unit && !sameUnit(r.unit, main.unit);
    if (secondary && rightUnit !== null && !sameUnit(r.unit, rightUnit)) return;   // no third axis
    if (secondary) rightUnit = r.unit;
    series.push({ label: (set.label ?? '').trim() || r.unit || `Set ${si + 2}`, unit: r.unit, secondary, points: r.points });
  });
  if (series.length > 1) series[0].label = (spec.mainLabel ?? '').trim() || main.unit || 'Values';
  return { xLabels: names.map(titleOf), series };
}

/** "total_cholesterol" → "Total cholesterol"; a human name stays as typed. */
export function prettyName(name: string): string {
  const s = name.trim();
  if (!/_/.test(s)) return s;
  const words = s.replace(/_+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
