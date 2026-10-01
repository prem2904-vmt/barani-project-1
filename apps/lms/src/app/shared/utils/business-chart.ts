/**
 * Analytics / Lab Insights (Phase 1) — business-metric ECharts option
 * builders (patient/test/revenue trends, stacked and bar charts), sibling to
 * `trend-chart.ts` (the Trendogram LAB-PARAMETER chart: reference bands,
 * flags — a different domain). Same engine (ECharts, dynamically imported),
 * same lifecycle convention (`ec` passed in for `graphic.LinearGradient`),
 * same theme skin (`ndTrendSkin` from `lab-trends.component.ts`, reused
 * verbatim — never a second skin). A test/revenue count has no reference
 * range or flag, so `buildTrendOption` doesn't fit; this is the "extend
 * minimally" the brief asked for when the existing renderer can't do
 * stacked/grouped bars.
 */

export interface BusinessSeries { name: string; data: number[]; color?: string; }

export interface BuildLineOptionArgs {
  categories: string[];
  series: BusinessSeries[];
  theme: 'dark' | 'light';
  /** y-axis value formatter, e.g. a rupee prefix. */
  valueFormatter?: (v: number) => string;
}

const PALETTE = ['#7c3aed', '#0ea5e9', '#f59e0b', '#ef4444', '#10b981', '#64748b'];

/** One or more line series on a shared category axis (patient/tests volume,
 * tests-per-patient, revenue trend with its Gross/Discount/Refund/Net/
 * Collected toggle, average bill value). The first series gets the same
 * gradient-area treatment as the Trendogram line; additional series are
 * plain lines (a toggle group reads better flat).</summary> */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildBusinessLineOption(ec: any, { categories, series, theme, valueFormatter }: BuildLineOptionArgs): any {
  const dark = theme === 'dark';
  return {
    backgroundColor: 'transparent',
    grid: { left: 48, right: 16, top: series.length > 1 ? 36 : 16, bottom: 28 },
    legend: series.length > 1 ? { top: 0, textStyle: { fontSize: 11 } } : undefined,
    tooltip: { trigger: 'axis', valueFormatter },
    xAxis: { type: 'category', data: categories, boundaryGap: false },
    yAxis: { type: 'value', axisLabel: valueFormatter ? { formatter: valueFormatter } : undefined },
    series: series.map((s, i) => {
      const color = s.color ?? PALETTE[i % PALETTE.length];
      const base = {
        name: s.name, type: 'line', data: s.data, smooth: true,
        symbol: 'circle', symbolSize: 6, lineStyle: { width: 2, color },
        itemStyle: { color },
      };
      if (i === 0) {
        return {
          ...base,
          areaStyle: {
            color: new ec.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: dark ? 'rgba(124,58,237,0.35)' : 'rgba(124,58,237,0.18)' },
              { offset: 1, color: 'rgba(124,58,237,0)' },
            ]),
          },
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
}

/** Stacked bars on a shared category axis (New vs Returning patients). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildStackedBarOption(_ec: any, { categories, series }: BuildStackedBarOptionArgs): any {
  return {
    backgroundColor: 'transparent',
    grid: { left: 48, right: 16, top: 36, bottom: 28 },
    legend: { top: 0, textStyle: { fontSize: 11 } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'category', data: categories },
    yAxis: { type: 'value' },
    series: series.map((s, i) => ({
      name: s.name, type: 'bar', stack: 'total', data: s.data,
      itemStyle: { color: s.color ?? PALETTE[i % PALETTE.length], borderRadius: i === series.length - 1 ? [4, 4, 0, 0] : 0 },
    })),
  };
}

export interface BuildHorizontalBarOptionArgs {
  /** Already sorted (largest first); the chart draws top-to-bottom as given. */
  categories: string[];
  values: number[];
  theme: 'dark' | 'light';
  valueFormatter?: (v: number) => string;
}

/** A horizontal bar ranking (Revenue by department, Top tests by revenue) —
 * long category labels (department/test names) read better on the Y axis. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildHorizontalBarOption(_ec: any, { categories, values, valueFormatter }: BuildHorizontalBarOptionArgs): any {
  return {
    backgroundColor: 'transparent',
    grid: { left: 140, right: 24, top: 8, bottom: 8 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter },
    xAxis: { type: 'value', axisLabel: valueFormatter ? { formatter: valueFormatter } : undefined },
    yAxis: { type: 'category', data: [...categories].reverse(), axisLabel: { fontSize: 11 } },
    series: [{
      type: 'bar', data: [...values].reverse(), barMaxWidth: 20,
      itemStyle: { color: '#7c3aed', borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', formatter: valueFormatter ? (p: { value: number }) => valueFormatter(p.value) : undefined },
    }],
  };
}

/** Rupee axis/tooltip formatter — the one money-display convention every
 * Insights chart uses (no decimals on an axis tick/tooltip, ₹ prefix). */
export function rupeeFormatter(v: number): string {
  return '₹' + Math.round(v).toLocaleString('en-IN');
}
