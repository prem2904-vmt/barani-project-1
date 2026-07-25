/**
 * Shared Trendogram chart builder. One ECharts option, two themes:
 *  - 'dark'  — the on-screen patient-profile chart (transparent bg, light axes)
 *  - 'light' — the PDF report chart (white bg, dark axes + visible background
 *              grid lines, no tooltip/animation, a title per chart)
 * Also an offscreen renderer that turns a chart into a PNG data URL for the PDF.
 */

export interface TrendPoint { date: string; value: number; flag?: string | null; }
export interface TrendParam { parameter: string; unit?: string | null; referenceRange?: string | null; points: TrendPoint[]; }
export interface TrendTest { testId: string; testName: string; count: number; parameters: TrendParam[]; }

/** Parse a "low - high" reference range into numbers (for the reference band). */
export function parseTrendRange(text?: string | null): { low: number; high: number } | null {
  if (!text) return null;
  const m = text.match(/(-?\d+(?:\.\d+)?)\s*[-–—]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const low = parseFloat(m[1]), high = parseFloat(m[2]);
  return Number.isFinite(low) && Number.isFinite(high) ? { low, high } : null;
}

export interface BuildTrendOptionArgs {
  param: TrendParam;
  points: TrendPoint[];
  chartType: 'line' | 'bar';
  theme: 'dark' | 'light';
  /** Optional chart title (used on the PDF/light theme). */
  title?: string;
}

/**
 * Build the ECharts option for a trend chart. `ec` is the (dynamically
 * imported) echarts module — needed for graphic.LinearGradient.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildTrendOption(ec: any, { param, points, chartType, theme, title }: BuildTrendOptionArgs): any {
  const light = theme === 'light';
  const labels = points.map(p => new Date(p.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }));
  const values = points.map(p => p.value);
  const abnormal = points.map(p => !!(p.flag && p.flag.trim() && p.flag.toUpperCase() !== 'N'));

  const band = parseTrendRange(param.referenceRange);
  const markArea = band ? {
    silent: true,
    itemStyle: { color: light ? 'rgba(16,185,129,0.12)' : 'rgba(110,231,183,0.10)' },
    data: [[{ yAxis: band.low }, { yAxis: band.high }]],
  } : undefined;

  const purple = '#a855f7';
  const abnormalColor = light ? '#dc2626' : '#fb7185';
  const series = chartType === 'line'
    ? {
        // Sharp/angular segments (ECharts line-simple style) — no curve smoothing.
        type: 'line', data: values, smooth: false, symbolSize: light ? 6 : 8, showSymbol: true,
        lineStyle: { width: light ? 2.4 : 3, color: light ? '#7c3aed' : purple },
        itemStyle: { color: (p: { dataIndex: number }) => abnormal[p.dataIndex] ? abnormalColor : (light ? '#7c3aed' : purple) },
        areaStyle: { color: new ec.graphic.LinearGradient(0, 0, 0, 1, light
          ? [{ offset: 0, color: 'rgba(124,58,237,0.18)' }, { offset: 1, color: 'rgba(124,58,237,0.02)' }]
          : [{ offset: 0, color: 'rgba(168,85,247,0.35)' }, { offset: 1, color: 'rgba(168,85,247,0.02)' }]) },
        markArea,
        animation: !light, animationDuration: 700, animationEasing: 'cubicOut',
      }
    : {
        type: 'bar', data: values, barMaxWidth: 34,
        itemStyle: {
          borderRadius: [6, 6, 0, 0],
          color: (p: { dataIndex: number }) => abnormal[p.dataIndex] ? abnormalColor
            : new ec.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#a855f7' }, { offset: 1, color: '#7c3aed' }]),
        },
        markArea,
        animation: !light, animationDuration: 700, animationEasing: 'cubicOut',
      };

  const axisLabelColor = light ? '#475569' : '#94a3b8';
  const gridLineColor = light ? '#e2e8f0' : 'rgba(255,255,255,0.06)';
  const axisLineColor = light ? '#cbd5e1' : 'rgba(255,255,255,0.15)';

  return {
    backgroundColor: light ? '#ffffff' : 'transparent',
    title: light && title ? {
      text: title, left: 'center', top: 6,
      textStyle: { color: '#1e293b', fontSize: 12, fontWeight: 600 },
    } : undefined,
    grid: { left: 44, right: 16, top: light && title ? 34 : 24, bottom: 34 },
    tooltip: light ? undefined : {
      trigger: 'axis',
      backgroundColor: 'rgba(20,20,28,0.92)', borderColor: 'rgba(168,85,247,0.3)',
      textStyle: { color: '#e2e8f0', fontSize: 12 },
      formatter: (a: Array<{ dataIndex: number; value: number }>) => {
        const i = a[0].dataIndex;
        const f = points[i].flag && abnormal[i] ? ` · ${points[i].flag}` : '';
        return `${labels[i]}<br/><b>${a[0].value}</b>${param.unit ? ' ' + param.unit : ''}${f}`;
      },
    },
    xAxis: {
      type: 'category', data: labels, boundaryGap: chartType === 'bar',
      axisLine: { lineStyle: { color: axisLineColor } },
      axisLabel: { color: axisLabelColor, fontSize: 10 },
    },
    yAxis: {
      type: 'value', scale: true,
      // The requested background grid lines — solid + visible on the white PDF.
      splitLine: { lineStyle: { color: gridLineColor } },
      axisLabel: { color: axisLabelColor, fontSize: 10 },
    },
    series: [series],
  };
}

/**
 * Minimal sparkline option — an axis-less mini line for the panel "overall"
 * grid (ECharts matrix-sparkline style). Sharp segments, a single dot on the
 * latest point, abnormal points in red, and a faint reference band if known.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildSparklineOption(ec: any, args: { points: TrendPoint[]; referenceRange?: string | null }): any {
  const values = args.points.map(p => p.value);
  const abnormal = args.points.map(p => !!(p.flag && p.flag.trim() && p.flag.toUpperCase() !== 'N'));
  const last = values.length - 1;
  const band = parseTrendRange(args.referenceRange);
  const markArea = band ? {
    silent: true,
    itemStyle: { color: 'rgba(168,85,247,0.08)' },
    data: [[{ yAxis: band.low }, { yAxis: band.high }]],
  } : undefined;

  return {
    backgroundColor: 'transparent',
    grid: { left: 3, right: 3, top: 6, bottom: 4 },
    xAxis: { type: 'category', show: false, boundaryGap: false, data: values.map((_v, i) => i) },
    yAxis: { type: 'value', show: false, scale: true },
    series: [{
      type: 'line', data: values, smooth: false, showSymbol: true,
      symbolSize: (_v: number, p: { dataIndex: number }) => p.dataIndex === last ? 5 : 0,
      lineStyle: { width: 2, color: '#a855f7' },
      itemStyle: { color: (p: { dataIndex: number }) => abnormal[p.dataIndex] ? '#fb7185' : '#a855f7' },
      areaStyle: { color: new ec.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: 'rgba(168,85,247,0.28)' }, { offset: 1, color: 'rgba(168,85,247,0.01)' },
      ]) },
      markArea,
      animation: false,
    }],
  };
}

/** Filter a param's points by a duration key (matches the on-screen options). */
export function filterTrendPoints(points: TrendPoint[], duration: string): TrendPoint[] {
  const pts = [...points].sort((a, b) => a.date.localeCompare(b.date));
  if (duration === '5') return pts.slice(-5);
  if (duration === '10') return pts.slice(-10);
  if (duration === '3m' || duration === '6m') {
    const cutoff = Date.now() - (duration === '3m' ? 90 : 180) * 86400_000;
    return pts.filter(pt => new Date(pt.date).getTime() >= cutoff);
  }
  return pts;
}

/**
 * Render a trend chart off-screen to a PNG data URL (for embedding in the PDF).
 * ECharts is dynamically imported so it stays out of the main bundle.
 */
export async function renderTrendogramPng(args: {
  param: TrendParam; points: TrendPoint[]; chartType: 'line' | 'bar'; title: string;
  width?: number; height?: number; pixelRatio?: number;
}): Promise<string | null> {
  if (args.points.length === 0) return null;
  const ec = await import('echarts');
  const w = args.width ?? 520, h = args.height ?? 320;
  const el = document.createElement('div');
  el.style.cssText = `position:absolute;left:-99999px;top:0;width:${w}px;height:${h}px;`;
  document.body.appendChild(el);
  try {
    const chart = ec.init(el, undefined, { renderer: 'canvas', width: w, height: h });
    chart.setOption(buildTrendOption(ec, {
      param: args.param, points: args.points, chartType: args.chartType, theme: 'light', title: args.title,
    }), true);
    const url = chart.getDataURL({ type: 'png', pixelRatio: args.pixelRatio ?? 2, backgroundColor: '#fff' });
    chart.dispose();
    return url;
  } finally {
    el.remove();
  }
}
