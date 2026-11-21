/**
 * Analytics / Lab Insights — business-metric ECharts option builders
 * (patient/test/revenue trends, stacked / horizontal / grouped bars, donuts,
 * KPI sparklines), sibling to `trend-chart.ts` (the Trendogram LAB-PARAMETER
 * chart: reference bands, flags — a different domain). Same engine (ECharts,
 * dynamically imported) and the SAME theme skin (`ndTrendSkin` from
 * `lab-trends.component.ts`, applied by the Insights chart host — never a
 * second skin); only the chart SHAPES live here.
 *
 * Colour: one categorical order, light and dark stepped separately and
 * validated together (dataviz validator: lightness band, chroma floor,
 * adjacent CVD ΔE ≥ 12.5, normal-vision ΔE ≥ 20, ≥ 3:1 on the card surface).
 * Slot 1 is the brand violet; series keep their slot whatever the filter
 * (colour follows the entity, never its rank). A 6th+ category folds into
 * "Other" in the neutral slate. Series colours ride on `series.color` so the
 * skin's single-violet recolour can be undone for multi-series charts
 * (`restoreSeriesColours`).
 */

export interface BusinessSeries { name: string; data: number[]; color?: string; }

export const CHART_SERIES = {
  light: ['#7c3aed', '#0d9488', '#d97706', '#db2777', '#2563eb'],
  dark: ['#8b5cf6', '#0d9488', '#d97706', '#db2777', '#3b82f6'],
} as const;
export const CHART_OTHER = { light: '#94a3b8', dark: '#64748b' } as const;

/** New design, light (owner palette 2026-11-21): SOFT pastels — violet, Lab sky, late rose, done mint, OPD lilac. No amber. */
export const CHART_SERIES_LIGHT_NEW = ['#a78bfa', '#86c8ea', '#efa6b8', '#7fcfa0', '#bba7f6'] as const;
function isNewDesign(): boolean {
  try { return typeof document !== 'undefined' && document.documentElement.classList.contains('design-new'); } catch { return false; }
}

export function seriesColor(i: number, theme: 'dark' | 'light'): string {
  const p = theme === 'light' && isNewDesign() ? CHART_SERIES_LIGHT_NEW : CHART_SERIES[theme];
  return i < p.length ? p[i] : CHART_OTHER[theme];
}

/** `graphic.LinearGradient`-compatible plain object (ECharts accepts the
 *  object form), so builders don't need the engine module. */
export const EC_SHIM = {
  graphic: {
    LinearGradient: function (x: number, y: number, x2: number, y2: number, colorStops: unknown[]) {
      return { type: 'linear', x, y, x2, y2, colorStops };
    },
  },
};

function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const AXIS_SPLIT = { show: true, lineStyle: { type: 'dashed' as const } };

export interface BuildLineOptionArgs {
  categories: string[];
  series: BusinessSeries[];
  theme: 'dark' | 'light';
  /** y-axis / tooltip value formatter, e.g. a rupee prefix. */
  valueFormatter?: (v: number) => string;
  /** Pretty x labels (raw categories stay the click payload). */
  labels?: string[];
  /** Compact y-axis ticks (defaults to valueFormatter). */
  axisFormatter?: (v: number) => string;
}

/** One or more line series on a shared category axis (patient / tests
 * volume, tests-per-patient, revenue trend). The first series gets a soft
 * gradient area; others are plain 2px lines. Markers appear on hover only
 * unless the series is short (≤ 12 points). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildBusinessLineOption(ec: any, { categories, series, theme, valueFormatter, labels, axisFormatter }: BuildLineOptionArgs): any {
  const dark = theme === 'dark';
  const g = ec?.graphic?.LinearGradient ?? EC_SHIM.graphic.LinearGradient;
  const few = categories.length <= 12;
  // Two or three buckets (early in a month, a short custom range): a line
  // between two dots says nothing — draw grouped bars instead.
  const asBars = categories.length > 0 && categories.length <= 3;
  return {
    backgroundColor: 'transparent',
    grid: { left: 8, right: 16, top: series.length > 1 ? 36 : 14, bottom: 4, containLabel: true },
    legend: series.length > 1 ? { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 4, textStyle: { fontSize: 11 } } : undefined,
    tooltip: { trigger: 'axis', valueFormatter, axisPointer: { type: asBars ? 'shadow' : 'line' } },
    xAxis: {
      type: 'category', data: categories, boundaryGap: asBars,
      axisTick: { show: false }, axisLine: { show: true },
      axisLabel: { hideOverlap: true, formatter: labels ? (_v: string, i: number) => labels[i] ?? _v : undefined },
    },
    yAxis: { type: 'value', minInterval: 1, splitLine: AXIS_SPLIT, axisLabel: (axisFormatter ?? valueFormatter) ? { formatter: axisFormatter ?? valueFormatter } : {} },
    series: series.map((s, i) => {
      const color = s.color ?? seriesColor(i, theme);
      if (asBars) {
        return { name: s.name, type: 'bar', data: s.data, color, barMaxWidth: 36, barGap: '20%', itemStyle: { color, borderRadius: [4, 4, 0, 0] }, emphasis: { focus: 'series' } };
      }
      const base = {
        name: s.name, type: 'line', data: s.data, smooth: 0.25, color,
        symbol: 'circle', symbolSize: 7, showSymbol: few, lineStyle: { width: 2, color },
        itemStyle: { color, borderColor: dark ? '#14141c' : '#ffffff', borderWidth: 2 },
        emphasis: { focus: 'series' },
      };
      if (i === 0) {
        return {
          ...base,
          areaStyle: { color: new g(0, 0, 0, 1, [
            { offset: 0, color: hexA(color, dark ? 0.32 : 0.16) },
            { offset: 1, color: hexA(color, 0) },
          ]) },
        };
      }
      return base;
    }),
  };
}

export interface BuildStackedBarOptionArgs {
  categories: string[];
  series: BusinessSeries[];
  theme: 'dark' | 'light';
  labels?: string[];
  valueFormatter?: (v: number) => string;
}

/** Stacked vertical bars on a shared category axis (New vs Returning,
 * pending vs overdue). A 2px surface gap between segments; only the top
 * segment is rounded. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildStackedBarOption(_ec: any, { categories, series, theme, labels, valueFormatter }: BuildStackedBarOptionArgs): any {
  const dark = (theme ?? 'light') === 'dark';
  return {
    backgroundColor: 'transparent',
    grid: { left: 8, right: 16, top: 36, bottom: 4, containLabel: true },
    legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: { fontSize: 11 } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter },
    xAxis: {
      type: 'category', data: categories, axisTick: { show: false }, axisLine: { show: true },
      axisLabel: categories.length <= 8
        ? { interval: 0, width: 72, overflow: 'break', lineHeight: 14, formatter: labels ? (_v: string, i: number) => labels[i] ?? _v : undefined }
        : { hideOverlap: true, formatter: labels ? (_v: string, i: number) => labels[i] ?? _v : undefined },
    },
    yAxis: { type: 'value', minInterval: 1, splitLine: AXIS_SPLIT },
    series: series.map((s, i) => {
      const color = s.color ?? seriesColor(i, theme ?? 'light');
      return {
        name: s.name, type: 'bar', stack: 'total', data: s.data, color, barMaxWidth: 28,
        itemStyle: {
          color, borderRadius: i === series.length - 1 ? [4, 4, 0, 0] : 0,
          borderColor: dark ? '#14141c' : '#ffffff', borderWidth: series.length > 1 ? 1 : 0,
        },
        emphasis: { focus: 'series' },
      };
    }),
  };
}

export interface BuildHorizontalBarOptionArgs {
  /** Already sorted (largest first); the chart draws top-to-bottom as given. */
  categories: string[];
  values: number[];
  theme: 'dark' | 'light';
  valueFormatter?: (v: number) => string;
  color?: string;
}

/** A horizontal bar ranking (Revenue by department, Top tests) — long
 * category names read better on the Y axis; every bar carries its value as
 * a direct label (≤ 10 bars), so the axis can stay quiet. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildHorizontalBarOption(_ec: any, { categories, values, valueFormatter, theme, color }: BuildHorizontalBarOptionArgs): any {
  const c = color ?? seriesColor(0, theme ?? 'light');
  const fmt = valueFormatter ?? ((v: number) => Math.round(v).toLocaleString('en-IN'));
  return {
    backgroundColor: 'transparent',
    grid: { left: 8, right: 56, top: 4, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: fmt },
    xAxis: { type: 'value', show: false, splitLine: { show: false } },
    yAxis: {
      type: 'category', data: [...categories].reverse(), axisTick: { show: false }, axisLine: { show: false },
      axisLabel: { fontSize: 11, width: 150, overflow: 'break', lineHeight: 14 },
    },
    series: [{
      type: 'bar', data: [...values].reverse(), barMaxWidth: 16, color: c,
      itemStyle: { color: c, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', fontSize: 11, formatter: (p: { value: number }) => fmt(p.value) },
      emphasis: { itemStyle: { color: c, opacity: 0.85 } },
    }],
  };
}

export interface BuildGroupedHBarArgs {
  /** Largest first. */
  categories: string[];
  series: BusinessSeries[];
  theme: 'dark' | 'light';
  valueFormatter?: (v: number) => string;
  stacked?: boolean;
}

/** Horizontal bars, two or more series per category — grouped (TAT median
 * vs P90, entered vs validated, revenue vs cost) or stacked (in-house vs
 * outsourced per department). Legend on top. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildGroupedHBarOption({ categories, series, theme, valueFormatter, stacked }: BuildGroupedHBarArgs): any {
  const dark = theme === 'dark';
  const fmt = valueFormatter ?? ((v: number) => Math.round(v).toLocaleString('en-IN'));
  return {
    backgroundColor: 'transparent',
    grid: { left: 8, right: 24, top: 30, bottom: 4, containLabel: true },
    legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: { fontSize: 11 } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: fmt },
    xAxis: { type: 'value', splitLine: AXIS_SPLIT, axisLabel: { formatter: fmt, hideOverlap: true } },
    yAxis: {
      type: 'category', data: [...categories].reverse(), axisTick: { show: false }, axisLine: { show: false },
      axisLabel: { fontSize: 11, width: 150, overflow: 'break', lineHeight: 14 },
    },
    series: series.map((s, i) => {
      const color = s.color ?? seriesColor(i, theme);
      return {
        name: s.name, type: 'bar', data: [...s.data].reverse(), color, barMaxWidth: stacked ? 16 : 10,
        stack: stacked ? 'total' : undefined, barGap: '30%',
        itemStyle: {
          color, borderRadius: !stacked || i === series.length - 1 ? [0, 4, 4, 0] : 0,
          borderColor: dark ? '#14141c' : '#ffffff', borderWidth: stacked ? 1 : 0,
        },
        emphasis: { focus: 'series' },
      };
    }),
  };
}

export interface DonutItem { name: string; value: number; key?: string | null; }

export interface BuildDonutArgs {
  items: DonutItem[];
  theme: 'dark' | 'light';
  valueFormatter?: (v: number) => string;
  /** Slices before folding the tail into "Other" (palette has 5 slots). */
  maxSlices?: number;
  /** Centre caption, e.g. the total. */
  centre?: { value: string; label: string };
}

/** Fold a ranked list into at most `max` slices: the top `max − 1` + "Other". */
export function foldOther(items: DonutItem[], max = 5): DonutItem[] {
  const sorted = [...items].filter(i => i.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= max) return sorted;
  const head = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1).reduce((s, i) => s + i.value, 0);
  return [...head, { name: 'Other', value: rest, key: null }];
}

/** A donut for a part-to-whole mix (department mix, source type, delivery
 * status) with the total in the hole and a legend carrying each share. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildDonutOption({ items, theme, valueFormatter, maxSlices = 5, centre }: BuildDonutArgs): any {
  const dark = theme === 'dark';
  const slices = foldOther(items, maxSlices);
  const total = slices.reduce((s, i) => s + i.value, 0) || 1;
  const fmt = valueFormatter ?? ((v: number) => Math.round(v).toLocaleString('en-IN'));
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      formatter: (p: { name: string; value: number; percent: number }) => `${p.name}<br/><b>${fmt(p.value)}</b> · ${p.percent}%`,
    },
    legend: {
      orient: 'vertical', left: '58%', right: 0, top: 'middle', icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 10,
      textStyle: { fontSize: 11.5, width: 118, overflow: 'break' },
      formatter: (name: string) => {
        const it = slices.find(s => s.name === name);
        return it ? `${name}  ${Math.round((it.value / total) * 100)}%` : name;
      },
    },
    title: centre ? {
      text: centre.value, subtext: centre.label, left: '30%', top: 'middle', textAlign: 'center', itemGap: 2,
      textStyle: { fontSize: 18, fontWeight: 600, color: dark ? '#f1f5f9' : '#0f172a' },
      subtextStyle: { fontSize: 11, color: dark ? '#94a3b8' : '#64748b' },
    } : undefined,
    series: [{
      type: 'pie', radius: ['52%', '74%'], center: ['30%', '50%'], avoidLabelOverlap: true,
      label: { show: false }, labelLine: { show: false },
      itemStyle: { borderColor: dark ? '#14141c' : '#ffffff', borderWidth: 2, borderRadius: 4 },
      emphasis: { scale: true, scaleSize: 4 },
      data: slices.map((s, i) => {
        const color = s.name === 'Other' && s.key === null ? CHART_OTHER[theme] : seriesColor(i, theme);
        return { name: s.name, value: s.value, key: s.key ?? null, itemStyle: { color } };
      }),
    }],
  };
}

/** A KPI tile's mini trend: no axes, no grid, a 2px line with a faint area
 * and the last point marked. Hover still reads the value. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildSparklineOption({ data, labels, theme, color, valueFormatter }: {
  data: number[]; labels?: string[]; theme: 'dark' | 'light'; color?: string; valueFormatter?: (v: number) => string;
}): any {
  const dark = theme === 'dark';
  const c = color ?? seriesColor(0, theme);
  return {
    backgroundColor: 'transparent',
    animationDuration: 500,
    grid: { left: 2, right: 6, top: 6, bottom: 2 },
    tooltip: {
      trigger: 'axis', confine: true, axisPointer: { type: 'line', lineStyle: { color: dark ? 'rgba(255,255,255,0.2)' : '#cbd5e1' } },
      valueFormatter,
    },
    xAxis: { type: 'category', show: false, boundaryGap: false, data: labels ?? data.map((_, i) => String(i)) },
    yAxis: { type: 'value', show: false, min: (v: { min: number }) => Math.min(0, v.min) },
    series: [{
      type: 'line', data, smooth: 0.3, color: c, showSymbol: false, symbol: 'circle', symbolSize: 6,
      lineStyle: { width: 2, color: c },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
        { offset: 0, color: hexA(c, dark ? 0.28 : 0.14) }, { offset: 1, color: hexA(c, 0) },
      ] } },
      markPoint: data.length ? {
        symbol: 'circle', symbolSize: 6, label: { show: false },
        itemStyle: { color: c, borderColor: dark ? '#14141c' : '#ffffff', borderWidth: 2 },
        data: [{ coord: [data.length - 1, data[data.length - 1]] }],
      } : undefined,
    }],
  };
}

/** The shared skin (`ndTrendSkin`) paints every line the one theme violet —
 * right for the Trendogram's single parameter, wrong for a multi-series
 * business chart. Put each series' own colour back after skinning. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function restoreSeriesColours(opt: any): any {
  for (const s of opt?.series ?? []) {
    if (s.color && s.lineStyle) s.lineStyle = { ...s.lineStyle, color: s.color };
  }
  return opt;
}

/** Rupee axis/tooltip formatter — the one money-display convention every
 * Insights chart uses (no decimals on an axis tick/tooltip, ₹ prefix). */
export function rupeeFormatter(v: number): string {
  return '₹' + Math.round(v).toLocaleString('en-IN');
}

/** Compact rupee axis ticks (₹1.2L, ₹45k) so a y-axis never eats the plot. */
export function rupeeAxisFormatter(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${+(v / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `₹${+(v / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `₹${+(v / 1e3).toFixed(1)}k`;
  return `₹${Math.round(v)}`;
}
