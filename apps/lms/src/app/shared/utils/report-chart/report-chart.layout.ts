/**
 * Report chart geometry — ONE layout, two painters (docs/REPORT-CHARTS.md §5).
 *
 * `layoutChart` turns chart data into drawing operations in PDF points,
 * origin top-left of the chart block. `report-chart.pdf.ts` paints them as
 * vector jsPDF calls; `pf-report-chart` paints them as inline SVG. Colours
 * are semantic tokens the painter resolves from the report theme, so the
 * geometry never knows about templates, light / dark or flag styles.
 */
import type { ChartData, ChartPoint, ChartSeries } from './report-chart.data';

export type ChartColor =
  | 'ink' | 'text' | 'dim' | 'hair' | 'grid'
  | 'accent' | 'line2' | 'bar' | 'band' | 'bandEdge'
  | 'high' | 'low' | 'paper';

export type ChartOp =
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; color: ChartColor; w: number; dash?: number[] }
  | { t: 'poly'; pts: Array<[number, number]>; color: ChartColor; w: number; dash?: number[] }
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill?: ChartColor; stroke?: ChartColor; lw?: number }
  | { t: 'circle'; cx: number; cy: number; r: number; fill?: ChartColor; stroke?: ChartColor; lw?: number }
  /** `y` is the text BASELINE (jsPDF and SVG agree on that). */
  | { t: 'text'; x: number; y: number; text: string; size: number; bold?: boolean; italic?: boolean;
      color: ChartColor; align: 'left' | 'center' | 'right'; role?: 'title' | 'value' | 'tick' | 'xlabel' | 'threshold' | 'legend' | 'note' | 'unit' };

export interface ChartLayout {
  width: number;
  height: number;
  ops: ChartOp[];
}

/** Text width in points for `size`-pt text (bold or not). */
export type Measure = (text: string, size: number, bold: boolean) => number;

/** A font-free width estimate (Helvetica-ish average) — the SVG preview and
 *  tests; the PDF passes jsPDF's own metrics. */
export const approxMeasure: Measure = (text, size, bold) => text.length * size * (bold ? 0.56 : 0.52);

export interface LayoutOptions {
  measure?: Measure;
  /** The template's body font scale (1 = Classic). */
  fontScale?: number;
}

/** Full / half chart widths inside the report's content box. */
export function chartWidth(size: 'full' | 'half', contentWidth: number): number {
  return size === 'half' ? Math.round(contentWidth * 0.5) : contentWidth;
}

interface Scale { lo: number; hi: number; step: number; ticks: number[]; decimals: number; }

function niceStep(range: number, count: number): number {
  const raw = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * mag;
}

/** A readable axis over [min, max] (4–6 ticks). Exported for tests. */
export function niceScale(min: number, max: number, fixedLo: number | null, fixedHi: number | null): Scale {
  let lo = fixedLo ?? min;
  let hi = fixedHi ?? max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (hi <= lo) { hi = lo === 0 ? 1 : lo + Math.abs(lo) * 0.2; }
  const step = niceStep(hi - lo, 5);
  const nlo = fixedLo ?? Math.floor(lo / step) * step;
  const nhi = fixedHi ?? Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  const first = Math.ceil(nlo / step - 1e-9) * step;
  for (let v = first; v <= nhi + step * 1e-6; v += step) ticks.push(Number(v.toFixed(10)));
  const stepText = String(Number(step.toFixed(10)));
  const decimals = Math.min(3, stepText.includes('.') ? stepText.split('.')[1].length : 0);
  return { lo: nlo, hi: nhi === nlo ? nlo + step : nhi, step, ticks, decimals };
}

function fmt(v: number, decimals: number): string {
  return v.toFixed(decimals);
}

function domainOf(series: ChartSeries[], data: ChartData, withBand: boolean, withThresholds: boolean, bars: boolean): [number, number] | null {
  const vals: number[] = [];
  for (const s of series) for (const p of s.points) if (p.value != null) vals.push(p.value);
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

/** Split a label into at most two lines that fit `maxW`. */
function wrap2(text: string, size: number, maxW: number, m: Measure): string[] {
  if (m(text, size, false) <= maxW) return [text];
  const words = text.split(/\s+/);
  let a = '';
  let i = 0;
  for (; i < words.length; i++) {
    const next = a ? `${a} ${words[i]}` : words[i];
    if (m(next, size, false) > maxW && a) break;
    a = next;
  }
  const b = words.slice(i).join(' ');
  return b ? [a, b] : [a];
}

const SERIES_COLOR: ChartColor[] = ['accent', 'line2'];
/** Bars: normal = neutral, abnormal = the abnormal style — a normal bar must
 *  never share the LOW colour. */
const BAR_COLOR: ChartColor[] = ['bar', 'line2'];

/** A text op with a paper chip behind it, so a label never fights a line,
 *  a gridline or a band edge. */
function chipped(m: Measure, op: Extract<ChartOp, { t: 'text' }>): ChartOp[] {
  const w = m(op.text, op.size, !!op.bold) + 3;
  const x = op.align === 'center' ? op.x - w / 2 : op.align === 'right' ? op.x - w + 1.5 : op.x - 1.5;
  return [{ t: 'rect', x, y: op.y - op.size * 0.82, w, h: op.size * 1.05, fill: 'paper' }, op];
}

/**
 * Lay the chart out at `width` points. The height follows from the content
 * (title, legend, plot, wrapped x labels, the missing-points note), so the
 * caller can keep the whole chart on one page before drawing it.
 */
export function layoutChart(data: ChartData, width: number, opts: LayoutOptions = {}): ChartLayout {
  const m = opts.measure ?? approxMeasure;
  const fs = opts.fontScale && opts.fontScale > 0 ? opts.fontScale : 1;
  const ops: ChartOp[] = [];
  const TITLE = 9.5 * fs, SMALL = 7 * fs, TINY = 6.5 * fs;
  const half = data.size === 'half';
  const plotH = (half ? 118 : 150) * Math.min(1.2, fs);

  // ── Title + legend ────────────────────────────────────────────
  let y = TITLE;
  ops.push({ t: 'text', x: 0, y, text: data.title, size: TITLE, bold: true, color: 'ink', align: 'left', role: 'title' });

  const series = data.series.filter(s => s.points.length > 0);
  const primary = series.filter(s => !s.secondary);
  const secondary = series.filter(s => s.secondary);
  const bars = data.kind === 'bar';
  const bandShown = data.refBand && (series[0]?.points ?? []).some(p => p.low != null || p.high != null);

  const legend: Array<{ kind: 'line' | 'band'; color: ChartColor; dash?: number[]; label: string }> = [];
  if (series.length > 1) series.forEach((s, i) => legend.push({
    kind: 'line', color: SERIES_COLOR[i] ?? 'line2', dash: i > 0 ? [3, 2] : undefined,
    label: s.unit && s.label !== s.unit ? `${s.label} (${s.unit})` : s.label,
  }));
  if (bandShown) legend.push({ kind: 'band', color: 'band', label: 'Normal range' });
  if (legend.length) {
    const itemW = legend.map(l => 16 + m(l.label, SMALL, false) + 10);
    const total = itemW.reduce((a, b) => a + b, 0);
    const titleW = m(data.title, TITLE, true);
    let lx: number;
    if (titleW + 16 + total <= width) { lx = width - total; }       // same row, right-aligned
    else { y += SMALL + 6; lx = 0; }
    const ly = y - SMALL * 0.3;
    legend.forEach((l, i) => {
      if (l.kind === 'band') ops.push({ t: 'rect', x: lx, y: ly - 3.5, w: 12, h: 7, fill: 'band', stroke: 'bandEdge', lw: 0.4 });
      else ops.push({ t: 'line', x1: lx, y1: ly, x2: lx + 12, y2: ly, color: l.color, w: 1.4, dash: l.dash });
      ops.push({ t: 'text', x: lx + 16, y: y, text: l.label, size: SMALL, color: 'text', align: 'left', role: 'legend' });
      lx += itemW[i];
    });
  }

  // ── Scales ────────────────────────────────────────────────────
  const d1 = domainOf(primary.length ? primary : series, data, bandShown, true, bars);
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
  const barGroupW = Math.min(step * 0.56, 30 * series.length);
  if (bandShown) {
    (series[0].points).forEach((p, i) => {
      if (p.low == null && p.high == null) return;
      const w = bars ? Math.min(step - 3, barGroupW + 16) : step - 3;
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
  const valueText = (p: ChartPoint) => (p.display || String(p.value)) + (p.flag === 'H' || p.flag === 'L' ? ` ${p.flag}` : '');
  series.forEach((s, si) => {
    const color = SERIES_COLOR[si] ?? 'line2';
    const Y = s.secondary ? Y2 : Y1;
    const dash = si > 0 ? [3, 2] : undefined;
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
        if (data.showValues) valueLabels.push({ t: 'text', x: bx + bw / 2, y: Math.min(by, base) - 3, text: valueText(p),
          size: SMALL, bold: p.abnormal, color: p.abnormal ? markColor(p, 'text') : 'text', align: 'center', role: 'value' });
      });
      return;
    }
    if (data.kind === 'line') {
      let run: Array<[number, number]> = [];
      const flush = () => { if (run.length > 1) ops.push({ t: 'poly', pts: run, color, w: si === 0 ? 1.4 : 1.2, dash }); run = []; };
      s.points.forEach((p, i) => { if (p.value == null) flush(); else run.push([X(i), Y(p.value)]); });
      flush();
    }
    s.points.forEach((p, i) => {
      if (p.value == null) return;
      const cx = X(i), cy = Y(p.value);
      if (si === 0) ops.push({ t: 'circle', cx, cy, r: p.abnormal ? 3 : 2.6, fill: p.abnormal ? markColor(p, color) : 'paper',
        stroke: p.abnormal ? markColor(p, color) : color, lw: 1.1 });
      else ops.push({ t: 'rect', x: cx - 2.4, y: cy - 2.4, w: 4.8, h: 4.8, fill: p.abnormal ? markColor(p, color) : 'paper',
        stroke: p.abnormal ? markColor(p, color) : color, lw: 1 });
      if (data.showValues) valueLabels.push({ t: 'text', x: cx, y: si === 0 ? cy - 5.5 : cy + SMALL + 4, text: valueText(p),
        size: SMALL, bold: p.abnormal, color: p.abnormal ? markColor(p, 'text') : 'text', align: 'center', role: 'value' });
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
