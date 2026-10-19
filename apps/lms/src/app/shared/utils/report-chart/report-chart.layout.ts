/**
 * Report chart geometry — ONE layout, two painters (docs/REPORT-CHARTS.md §5).
 *
 * `layoutChart` turns chart data into drawing operations in PDF points,
 * origin top-left of the chart block. `report-chart.pdf.ts` paints them as
 * vector jsPDF calls; `pf-report-chart` paints them as inline SVG. Colours
 * are semantic tokens the painter resolves from the report theme, so the
 * geometry never knows about templates, light / dark or flag styles.
 *
 * This file draws the x / y (cartesian) kinds — line, smooth, step, area,
 * stacked area, bar, grouped / stacked bar, bar + line, dots. Horizontal bars
 * live in report-chart.hbar.ts; pie, donut, radar and gauge in
 * report-chart.polar.ts. The v1 kinds (line / bar / dots, ≤ 2 series) draw
 * exactly the operations they always drew (report-chart.fingerprint.spec.ts).
 */
import type { ChartData, ChartPoint, ChartSeries } from './report-chart.data';
import { STACKED_KINDS } from './report-chart.model';
import {
  approxMeasure, chipped, fmt, marker, marksOnly, monotoneSegs, niceScale, SERIES_COLOR, SERIES_DASH, stepSegs, valueText, wrap2,
  drawHeader, type ChartColor, type ChartLayout, type ChartOp, type LayoutOptions, type LegendItem, type PathSeg, type TextOp,
} from './report-chart.geom';
import { layoutHBar } from './report-chart.hbar';
import { layoutGauge, layoutPie, layoutRadar } from './report-chart.polar';

export { approxMeasure, niceScale } from './report-chart.geom';
export type { ChartColor, ChartLayout, ChartOp, LayoutOptions, Measure, PathSeg } from './report-chart.geom';
export { drawHeader } from './report-chart.geom';

/** Full / half chart widths inside the report's content box. */
export function chartWidth(size: 'full' | 'half', contentWidth: number): number {
  return size === 'half' ? Math.round(contentWidth * 0.5) : contentWidth;
}

/**
 * Lay the chart out at `width` points. The height follows from the content
 * (title, legend, plot, wrapped x labels, the missing-points note), so the
 * caller can keep the whole chart on one page before drawing it.
 */
export function layoutChart(data: ChartData, width: number, opts: LayoutOptions = {}): ChartLayout {
  let l: ChartLayout;
  switch (data.kind) {
    case 'pie': case 'donut': l = layoutPie(data, width, opts); break;
    case 'radar': l = layoutRadar(data, width, opts); break;
    case 'gauge': l = layoutGauge(data, width, opts); break;
    case 'hbar': l = layoutHBar(data, width, opts); break;
    default: l = layoutCartesian(data, width, opts);
  }
  return opts.thumb ? { ...l, ops: marksOnly(l.ops) } : l;
}

/** Bars: normal = neutral, abnormal = the abnormal style — a normal bar must
 *  never share the LOW colour. */
const BAR_COLOR: ChartColor[] = ['bar', 'line2', 's3', 's4', 's5', 's6'];

function seriesLabel(s: ChartSeries): string {
  return s.unit && s.label !== s.unit ? `${s.label} (${s.unit})` : s.label;
}

/** Per x index, the running total of the stacked series below series `upto`. */
function stackBase(series: ChartSeries[], upto: number, i: number): number {
  let b = 0;
  for (let k = 0; k < upto; k++) b += series[k].points[i]?.value ?? 0;
  return b;
}

function domainOf(series: ChartSeries[], data: ChartData, withBand: boolean, withThresholds: boolean, bars: boolean, stacked = false): [number, number] | null {
  const vals: number[] = [];
  if (stacked) {
    const n = Math.max(0, ...series.map(s => s.points.length));
    for (let i = 0; i < n; i++) if (series.some(s => s.points[i]?.value != null)) vals.push(stackBase(series, series.length, i));
  } else {
    for (const s of series) for (const p of s.points) if (p.value != null) vals.push(p.value);
  }
  if (withBand) for (const p of series[0]?.points ?? []) {
    if (p.low != null) vals.push(p.low);
    if (p.high != null) vals.push(p.high);
  }
  if (withThresholds) for (const t of data.thresholds) vals.push(t.value);
  if (vals.length === 0) return null;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (bars) lo = Math.min(0, lo);
  else if (lo >= 0) {
    // Lines and dots: a little air under the lowest point, never below 0.
    lo = Math.max(0, lo - (hi - lo) * 0.15);
  }
  hi = hi + (hi - lo) * 0.12;       // room for the value labels
  return [lo, hi];
}

function layoutCartesian(data: ChartData, width: number, opts: LayoutOptions): ChartLayout {
  const m = opts.measure ?? approxMeasure;
  const fs = opts.fontScale && opts.fontScale > 0 ? opts.fontScale : 1;
  const ops: ChartOp[] = [];
  const TITLE = 9.5 * fs, SMALL = 7 * fs, TINY = 6.5 * fs;
  const half = data.size === 'half';
  const plotH = (half ? 118 : 150) * Math.min(1.2, fs);
  const kind = data.kind;

  const series = data.series.filter(s => s.points.length > 0);
  const primary = series.filter(s => !s.secondary);
  const secondary = series.filter(s => s.secondary);
  /** v1 bars (side by side) and grouped bars draw the same way. */
  const bars = kind === 'bar' || kind === 'groupedBar';
  const stacked = STACKED_KINDS.has(kind);
  const combo = kind === 'combo';
  /** Bars sit on a slot-shaped normal band, never a full column. */
  const barBand = bars || combo || kind === 'stackedBar';
  const zeroBase = bars || stacked || combo;
  const grouped = kind === 'groupedBar' && series.length > 1;
  const bandShown = data.refBand && !stacked && (grouped ? series : series.slice(0, 1)).some(s => s.points.some(p => p.low != null || p.high != null));
  const v1 = kind === 'line' || kind === 'bar' || kind === 'dots';
  const many = series.length > 2;

  // ── Title + legend ────────────────────────────────────────────
  const legend: LegendItem[] = [];
  if (series.length > 1) series.forEach((s, i) => {
    const boxed = (kind === 'groupedBar' || kind === 'stackedBar' || kind === 'stackedArea') || (combo && i === 0);
    legend.push(boxed
      ? { kind: 'box', color: kind === 'groupedBar' ? BAR_COLOR[i] ?? 'line2' : combo ? 'bar' : SERIES_COLOR[i] ?? 'line2', label: seriesLabel(s) }
      : { kind: 'line', color: SERIES_COLOR[i] ?? 'line2', dash: v1 ? (i > 0 ? [3, 2] : undefined) : SERIES_DASH[i], label: seriesLabel(s) });
  });
  if (bandShown) legend.push({ kind: 'band', color: 'band', label: 'Normal range' });
  let y = opts.thumb ? 0 : drawHeader(ops, data.title, legend, width, m, TITLE, SMALL);

  // ── Scales ────────────────────────────────────────────────────
  const stackPrimary = stacked ? primary : [];
  const d1 = domainOf(primary.length ? primary : series, data, bandShown, true, zeroBase, stacked);
  const s1 = niceScale(d1?.[0] ?? 0, d1?.[1] ?? 1, data.yMin, data.yMax);
  const d2 = secondary.length ? domainOf(secondary, { ...data, thresholds: [] }, false, false, bars) : null;
  const s2 = d2 ? niceScale(d2[0], d2[1], null, null) : null;

  const unit1 = (primary[0] ?? series[0])?.unit ?? '';
  const unit2 = secondary[0]?.unit ?? '';
  const tickW1 = Math.max(...s1.ticks.map(t => m(fmt(t, s1.decimals), SMALL, false)), m(unit1, SMALL, false) * 0.6, 10);
  const tickW2 = s2 ? Math.max(...s2.ticks.map(t => m(fmt(t, s2.decimals), SMALL, false)), 10) : 0;
  const left = tickW1 + 6;
  const right = width - (s2 ? tickW2 + 6 : 6);
  y += SMALL + 8;                                   // the unit captions row
  if (unit1) ops.push({ t: 'text', x: left - 4, y: y - 3, text: unit1, size: SMALL, color: 'dim', align: 'left', role: 'unit' });
  if (s2 && unit2) ops.push({ t: 'text', x: right + 4, y: y - 3, text: unit2, size: SMALL, color: 'dim', align: 'right', role: 'unit' });
  const top = y + 4;
  const bottom = top + plotH;
  const plotW = Math.max(20, right - left);
  const Y1 = (v: number) => bottom - ((Math.min(Math.max(v, s1.lo), s1.hi) - s1.lo) / (s1.hi - s1.lo)) * plotH;
  const Y2 = (v: number) => s2 ? bottom - ((Math.min(Math.max(v, s2.lo), s2.hi) - s2.lo) / (s2.hi - s2.lo)) * plotH : Y1(v);

  const n = Math.max(1, data.xLabels.length);
  const step = plotW / n;
  const X = (i: number) => left + step * (i + 0.5);

  // Gridlines + tick labels.
  for (const t of s1.ticks) {
    const ty = Y1(t);
    ops.push({ t: 'line', x1: left, y1: ty, x2: right, y2: ty, color: 'grid', w: 0.4 });
    ops.push({ t: 'text', x: left - 4, y: ty + SMALL * 0.35, text: fmt(t, s1.decimals), size: SMALL, color: 'dim', align: 'right', role: 'tick' });
  }
  if (s2) for (const t of s2.ticks) {
    ops.push({ t: 'text', x: right + 4, y: Y2(t) + SMALL * 0.35, text: fmt(t, s2.decimals), size: SMALL, color: 'dim', align: 'left', role: 'tick' });
  }

  // Normal band per point (line 1), half-way to each neighbour.
  // Bars: the band is a slot just wider than the bar group (it must never
  // read as a second bar); lines / dots: a column half-way to each neighbour.
  const barCount = bars ? series.length : 1;
  const barGroupW = Math.min(step * 0.56, 30 * barCount);
  if (bandShown && grouped) {
    // Grouped bars: each bar sits in its OWN normal band, on its own axis
    // (the % and the absolute count of a differential have different bands).
    const bw = barGroupW / series.length;
    series.forEach((s, si) => s.points.forEach((p, i) => {
      if (p.low == null && p.high == null) return;
      const Y = s.secondary ? Y2 : Y1;
      const x0 = X(i) - barGroupW / 2 + si * bw - 1;
      const yTop = p.high != null ? Y(p.high) : top;
      const yBot = p.low != null ? Y(p.low) : bottom;
      if (yBot - yTop <= 0.2) return;
      ops.push({ t: 'rect', x: x0, y: yTop, w: bw + 2, h: yBot - yTop, fill: 'band' });
      if (p.high != null) ops.push({ t: 'line', x1: x0, y1: yTop, x2: x0 + bw + 2, y2: yTop, color: 'bandEdge', w: 0.5 });
      if (p.low != null) ops.push({ t: 'line', x1: x0, y1: yBot, x2: x0 + bw + 2, y2: yBot, color: 'bandEdge', w: 0.5 });
    }));
  } else if (bandShown) {
    (series[0].points).forEach((p, i) => {
      if (p.low == null && p.high == null) return;
      const w = barBand ? Math.min(step - 3, barGroupW + 16) : step - 3;
      const x0 = X(i) - w / 2;
      const yTop = p.high != null ? Y1(p.high) : top;
      const yBot = p.low != null ? Y1(p.low) : bottom;
      if (yBot - yTop <= 0.2) return;
      ops.push({ t: 'rect', x: x0, y: yTop, w, h: yBot - yTop, fill: 'band' });
      if (p.high != null) ops.push({ t: 'line', x1: x0, y1: yTop, x2: x0 + w, y2: yTop, color: 'bandEdge', w: 0.5 });
      if (p.low != null) ops.push({ t: 'line', x1: x0, y1: yBot, x2: x0 + w, y2: yBot, color: 'bandEdge', w: 0.5 });
    });
  }

  // Axes.
  ops.push({ t: 'line', x1: left, y1: top, x2: left, y2: bottom, color: 'hair', w: 0.6 });
  ops.push({ t: 'line', x1: left, y1: bottom, x2: right, y2: bottom, color: 'hair', w: 0.6 });
  if (s2) ops.push({ t: 'line', x1: right, y1: top, x2: right, y2: bottom, color: 'hair', w: 0.6 });

  // Threshold lines — dashed, labelled at the right; close labels stagger.
  const thr = data.thresholds.map(t => ({ ...t, y: Y1(t.value) })).sort((a, b) => a.y - b.y);
  let lastLabelY = -Infinity;
  for (const t of thr) {
    ops.push({ t: 'line', x1: left, y1: t.y, x2: right, y2: t.y, color: 'text', w: 0.7, dash: [3, 2] });
    const label = (t.label ?? '').trim() || fmt(t.value, s1.decimals);
    let ly = t.y - 2.5;
    if (ly - lastLabelY < TINY + 1.5) ly = t.y + TINY + 1.5;
    lastLabelY = ly;
    ops.push(...chipped(m, { t: 'text', x: right - 2, y: ly, text: label, size: TINY, color: 'text', align: 'right', role: 'threshold' }));
  }

  // Series.
  const valueLabels: ChartOp[] = [];
  const markColor = (p: ChartPoint, base: ChartColor): ChartColor => p.abnormal ? (p.isLow ? 'low' : 'high') : base;
  /** With more than two series only the abnormal values are labelled (the
   *  rest would pile up); the table prints every value anyway. */
  const labelled = (p: ChartPoint) => data.showValues && (!many || p.abnormal);
  const valueOp = (p: ChartPoint, x: number, yy: number, extra: Partial<TextOp> = {}): TextOp => ({
    t: 'text', x, y: yy, text: valueText(p), size: SMALL, bold: p.abnormal,
    color: p.abnormal ? markColor(p, 'text') : 'text', align: 'center', role: 'value', ...extra,
  });
  const lineOf = (si: number, pts: Array<[number, number]>, color: ChartColor, dash?: number[]): ChartOp => {
    const w = si === 0 ? 1.4 : 1.2;
    if (kind === 'smooth') return { t: 'path', segs: monotoneSegs(pts), stroke: color, lw: w, dash };
    if (kind === 'step') return { t: 'path', segs: stepSegs(pts), stroke: color, lw: w, dash };
    return { t: 'poly', pts, color, w, dash };
  };
  const drawPointMarker = (si: number, p: ChartPoint, cx: number, cy: number, color: ChartColor) => {
    const fill = p.abnormal ? markColor(p, color) : 'paper';
    const stroke = p.abnormal ? markColor(p, color) : color;
    if (si === 0) ops.push({ t: 'circle', cx, cy, r: p.abnormal ? 3 : 2.6, fill, stroke, lw: 1.1 });
    else if (si === 1) ops.push({ t: 'rect', x: cx - 2.4, y: cy - 2.4, w: 4.8, h: 4.8, fill, stroke, lw: 1 });
    else ops.push(marker(si, cx, cy, fill, stroke));
  };

  series.forEach((s, si) => {
    const color = SERIES_COLOR[si] ?? 'line2';
    const Y = s.secondary ? Y2 : Y1;
    const dash = v1 ? (si > 0 ? [3, 2] : undefined) : SERIES_DASH[si];

    // Bars side by side (bar / grouped bar).
    if (bars) {
      const count = series.length;
      const bw = barGroupW / count;
      const base = Y(Math.max(s.secondary && s2 ? s2.lo : s1.lo, 0));
      s.points.forEach((p, i) => {
        if (p.value == null) return;
        const bx = X(i) - (bw * count) / 2 + si * bw;
        const by = Y(p.value);
        ops.push({ t: 'rect', x: bx + 0.5, y: Math.min(by, base), w: bw - 1, h: Math.max(0.8, Math.abs(base - by)),
          fill: markColor(p, BAR_COLOR[si] ?? 'line2') });
        if (labelled(p)) valueLabels.push(valueOp(p, bx + bw / 2, Math.min(by, base) - 3));
      });
      return;
    }

    // One bar per x: the combination's first series, or a stack segment.
    const stackedBar = kind === 'stackedBar' && stackPrimary.includes(s);
    if ((combo && si === 0) || stackedBar) {
      const bw = Math.min(step * 0.56, 30);
      const fillOf = stackedBar ? color : 'bar';
      const k = stackPrimary.indexOf(s);
      s.points.forEach((p, i) => {
        if (p.value == null) return;
        const b0 = stackedBar ? stackBase(stackPrimary, k, i) : Math.max(s1.lo, 0);
        const yb = Y(b0), yt = Y(b0 + p.value);
        const h = Math.max(0.8, Math.abs(yb - yt));
        const x0 = X(i) - bw / 2 + 0.5;
        ops.push({ t: 'rect', x: x0, y: Math.min(yb, yt), w: bw - 1, h,
          fill: stackedBar ? fillOf : markColor(p, fillOf),
          ...(stackedBar && p.abnormal ? { stroke: markColor(p, 'ink'), lw: 1.3 } : {}) });
        if (!labelled(p)) return;
        // A stack segment carries its value in its middle (on a paper chip),
        // a combination bar above its top.
        valueLabels.push(stackedBar
          ? valueOp(p, X(i), Math.min(yb, yt) + h / 2 + SMALL * 0.35)
          : valueOp(p, X(i), Math.min(yb, yt) - 3));
      });
      return;
    }

    // Lines (line / smooth / step / area / stacked area / combination's lines).
    const stackedArea = kind === 'stackedArea' && stackPrimary.includes(s);
    const k = stackPrimary.indexOf(s);
    const at = (i: number, v: number) => stackedArea ? Y(stackBase(stackPrimary, k, i) + v) : Y(v);
    if (kind !== 'dots') {
      let run: Array<[number, number]> = [];
      let idx: number[] = [];
      const flush = () => {
        if (run.length > 1) {
          if (kind === 'area' || stackedArea) {
            const lower: Array<[number, number]> = stackedArea
              ? idx.map(i => [X(i), Y(stackBase(stackPrimary, k, i))] as [number, number]).reverse()
              : [[run[run.length - 1][0], bottom], [run[0][0], bottom]];
            const segs: PathSeg[] = [['M', run[0][0], run[0][1]], ...run.slice(1).map(([x, yy]) => ['L', x, yy] as PathSeg),
              ...lower.map(([x, yy]) => ['L', x, yy] as PathSeg), ['Z']];
            ops.push({ t: 'path', segs, fill: color, opacity: stackedArea ? 0.32 : 0.14 });
          }
          ops.push(lineOf(si, run, color, dash));
        }
        run = []; idx = [];
      };
      s.points.forEach((p, i) => { if (p.value == null) flush(); else { run.push([X(i), at(i, p.value)]); idx.push(i); } });
      flush();
    }
    s.points.forEach((p, i) => {
      if (p.value == null) return;
      const cx = X(i), cy = at(i, p.value);
      drawPointMarker(si, p, cx, cy, color);
      if (labelled(p)) valueLabels.push(valueOp(p, cx, si === 0 || stackedArea || many ? cy - 5.5 : cy + SMALL + 4));
    });
  });
  for (const v of valueLabels) ops.push(...(v.t === 'text' ? chipped(m, v) : [v]));

  // X labels (wrapped to two lines) + the missing-point mark under the axis.
  let labelsBottom = bottom;
  data.xLabels.forEach((label, i) => {
    const lines = wrap2(label, SMALL, step - 4, m);
    let ly = bottom + SMALL + 4;
    for (const l of lines) {
      ops.push({ t: 'text', x: X(i), y: ly, text: l, size: SMALL, color: 'text', align: 'center', role: 'xlabel' });
      ly += SMALL + 1.5;
    }
    if (data.missing.includes(label)) {
      const cx = X(i), cy = bottom - 4;
      ops.push({ t: 'line', x1: cx - 2.5, y1: cy - 2.5, x2: cx + 2.5, y2: cy + 2.5, color: 'dim', w: 0.8 });
      ops.push({ t: 'line', x1: cx - 2.5, y1: cy + 2.5, x2: cx + 2.5, y2: cy - 2.5, color: 'dim', w: 0.8 });
      ops.push({ t: 'text', x: X(i), y: ly, text: 'not measured', size: TINY, italic: true, color: 'dim', align: 'center', role: 'xlabel' });
      ly += TINY + 1.5;
    }
    labelsBottom = Math.max(labelsBottom, ly - 1.5);
  });

  let h = labelsBottom + 4;
  if (data.missing.length) {
    h += TINY + 2;
    ops.push({ t: 'text', x: 0, y: h, text: `Not measured: ${data.missing.join(', ')}.`, size: TINY, italic: true, color: 'dim', align: 'left', role: 'note' });
    h += 3;
  }
  if (data.empty) {
    ops.push({ t: 'text', x: left + plotW / 2, y: top + plotH / 2, text: 'No values to plot yet', size: SMALL, italic: true, color: 'dim', align: 'center', role: 'note' });
  }
  return { width, height: Math.ceil(h + 2), ops };
}
