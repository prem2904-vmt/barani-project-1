/**
 * Horizontal bar chart (docs/REPORT-CHARTS.md §5): one row per chosen value,
 * the names on the left (long analyte names read without wrapping into the
 * plot), the value axis along the bottom. Each row carries its own normal
 * band as a slot behind the bar; thresholds are vertical dashed lines.
 */
import type { ChartData, ChartPoint } from './report-chart.data';
import {
  approxMeasure, chipped, drawHeader, fmt, niceScale, valueText, wrap2,
  type ChartColor, type ChartLayout, type ChartOp, type LayoutOptions,
} from './report-chart.geom';

export function layoutHBar(data: ChartData, width: number, opts: LayoutOptions): ChartLayout {
  const m = opts.measure ?? approxMeasure;
  const fs = opts.fontScale && opts.fontScale > 0 ? opts.fontScale : 1;
  const ops: ChartOp[] = [];
  const TITLE = 9.5 * fs, SMALL = 7 * fs, TINY = 6.5 * fs;
  const s = data.series[0];
  const pts = s?.points ?? [];
  const bandShown = data.refBand && pts.some(p => p.low != null || p.high != null);

  let y = opts.thumb ? 0 : drawHeader(ops, data.title, bandShown ? [{ kind: 'band', color: 'band', label: 'Normal range' }] : [], width, m, TITLE, SMALL);

  // Scale: from 0 (bars) to the largest value / band / threshold.
  const vals: number[] = [];
  for (const p of pts) {
    if (p.value != null) vals.push(p.value);
    if (bandShown && p.low != null) vals.push(p.low);
    if (bandShown && p.high != null) vals.push(p.high);
  }
  for (const t of data.thresholds) vals.push(t.value);
  const lo0 = Math.min(0, ...(vals.length ? vals : [0]));
  const hi0 = vals.length ? Math.max(...vals) : 1;
  const sc = niceScale(lo0, hi0 + (hi0 - lo0) * 0.18, data.yMin, data.yMax);

  // Names column: as wide as the longest name, at most 38 % of the chart.
  const labelW = Math.min(width * 0.38, Math.max(40, ...data.xLabels.map(l => m(l, SMALL, false) + 8)));
  const left = labelW;
  const right = width - 8;
  const plotW = Math.max(20, right - left);
  const X = (v: number) => left + ((Math.min(Math.max(v, sc.lo), sc.hi) - sc.lo) / (sc.hi - sc.lo)) * plotW;

  // Threshold labels sit in rows above the plot (staggered when close).
  const thr = data.thresholds.map(t => ({ ...t, x: X(t.value) })).sort((a, b) => a.x - b.x);
  const thrLabels: Array<{ x: number; row: number; text: string }> = [];
  { let lastRight = -Infinity, row = 0;
    for (const t of thr) {
      const text = (t.label ?? '').trim() || fmt(t.value, sc.decimals);
      const w = m(text, TINY, false);
      const x = Math.min(right - w / 2, Math.max(left + w / 2, t.x));
      row = x - w / 2 < lastRight + 3 ? row + 1 : 0;
      lastRight = x + w / 2;
      thrLabels.push({ x, row, text });
    } }
  const thrRows = thrLabels.length ? Math.max(...thrLabels.map(t => t.row)) + 1 : 0;
  y += thrRows * (TINY + 2.5);
  y += (s?.unit ? SMALL + 8 : 6);
  if (s?.unit) ops.push({ t: 'text', x: right, y: y - 3, text: s.unit, size: SMALL, color: 'dim', align: 'right', role: 'unit' });
  const top = y + 2;
  const lines = data.xLabels.map(l => wrap2(l, SMALL, labelW - 8, m));
  const rowH = Math.max((data.size === 'half' ? 15 : 17) * fs, ...lines.map(l => l.length * (SMALL + 1.5) + 5));
  const n = Math.max(1, data.xLabels.length);
  const bottom = top + rowH * n;
  const rowMid = (i: number) => top + rowH * (i + 0.5);

  // Gridlines + ticks.
  for (const t of sc.ticks) {
    const tx = X(t);
    ops.push({ t: 'line', x1: tx, y1: top, x2: tx, y2: bottom, color: 'grid', w: 0.4 });
    ops.push({ t: 'text', x: tx, y: bottom + SMALL + 4, text: fmt(t, sc.decimals), size: SMALL, color: 'dim', align: 'center', role: 'tick' });
  }

  const bh = Math.min(rowH * 0.56, 12);
  // Normal band: a slot just taller than the bar.
  if (bandShown) pts.forEach((p, i) => {
    if (p.low == null && p.high == null) return;
    const x0 = p.low != null ? X(p.low) : left;
    const x1 = p.high != null ? X(p.high) : right;
    if (x1 - x0 <= 0.2) return;
    const h = Math.min(rowH - 2, bh + 7);
    const y0 = rowMid(i) - h / 2;
    ops.push({ t: 'rect', x: x0, y: y0, w: x1 - x0, h, fill: 'band' });
    if (p.low != null) ops.push({ t: 'line', x1: x0, y1: y0, x2: x0, y2: y0 + h, color: 'bandEdge', w: 0.5 });
    if (p.high != null) ops.push({ t: 'line', x1: x1, y1: y0, x2: x1, y2: y0 + h, color: 'bandEdge', w: 0.5 });
  });

  // Axes.
  ops.push({ t: 'line', x1: left, y1: top, x2: left, y2: bottom, color: 'hair', w: 0.6 });
  ops.push({ t: 'line', x1: left, y1: bottom, x2: right, y2: bottom, color: 'hair', w: 0.6 });

  // Threshold lines: vertical, dashed, labelled above the plot.
  const thrTop = top - (s?.unit ? SMALL + 8 : 6) - thrRows * (TINY + 2.5);
  thr.forEach((t, i) => {
    const l = thrLabels[i];
    const ly = thrTop + (l.row + 1) * (TINY + 2.5) - 1.5;
    ops.push({ t: 'line', x1: t.x, y1: ly + 1.5, x2: t.x, y2: bottom, color: 'text', w: 0.7, dash: [3, 2] });
  });

  const markColor = (p: ChartPoint, base: ChartColor): ChartColor => p.abnormal ? (p.isLow ? 'low' : 'high') : base;
  const base = X(Math.max(sc.lo, 0));
  const valueLabels: ChartOp[] = [];
  pts.forEach((p, i) => {
    // Names, right-aligned against the axis.
    const ls = lines[i] ?? [];
    let ly = rowMid(i) - ((ls.length - 1) * (SMALL + 1.5)) / 2 + SMALL * 0.35;
    for (const l of ls) {
      ops.push({ t: 'text', x: left - 5, y: ly, text: l, size: SMALL, color: 'text', align: 'right', role: 'xlabel' });
      ly += SMALL + 1.5;
    }
    if (p.value == null) {
      ops.push({ t: 'text', x: left + 5, y: rowMid(i) + TINY * 0.35, text: 'not measured', size: TINY, italic: true, color: 'dim', align: 'left', role: 'xlabel' });
      return;
    }
    const bx = X(p.value);
    ops.push({ t: 'rect', x: Math.min(bx, base), y: rowMid(i) - bh / 2, w: Math.max(0.8, Math.abs(bx - base)), h: bh, fill: markColor(p, 'bar') });
    if (data.showValues) valueLabels.push({ t: 'text', x: Math.max(bx, base) + 4, y: rowMid(i) + SMALL * 0.35, text: valueText(p), size: SMALL,
      bold: p.abnormal, color: p.abnormal ? markColor(p, 'text') : 'text', align: 'left', role: 'value' });
  });
  for (const v of valueLabels) ops.push(...(v.t === 'text' ? chipped(m, v) : [v]));
  thrLabels.forEach(l => ops.push(...chipped(m, { t: 'text', x: l.x, y: thrTop + (l.row + 1) * (TINY + 2.5) - 1.5, text: l.text,
    size: TINY, color: 'text', align: 'center', role: 'threshold' })));

  let h = bottom + SMALL + 6;
  if (data.missing.length) {
    h += TINY + 2;
    ops.push({ t: 'text', x: 0, y: h, text: `Not measured: ${data.missing.join(', ')}.`, size: TINY, italic: true, color: 'dim', align: 'left', role: 'note' });
    h += 3;
  }
  if (data.empty) {
    ops.push({ t: 'text', x: left + plotW / 2, y: (top + bottom) / 2, text: 'No values to plot yet', size: SMALL, italic: true, color: 'dim', align: 'center', role: 'note' });
  }
  return { width, height: Math.ceil(h + 2), ops };
}
