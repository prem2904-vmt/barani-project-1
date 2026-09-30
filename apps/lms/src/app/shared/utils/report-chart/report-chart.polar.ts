/**
 * Round report charts (docs/REPORT-CHARTS.md §5): pie, donut, radar and
 * gauge — drawn as vector paths (arcs are cubic Béziers) in the same
 * operation vocabulary as the x / y charts, so the PDF stays crisp and every
 * label is real text.
 *
 * Values and flags come from the saved result snapshot exactly as the
 * results table prints them (report-chart.data.ts); nothing here judges a
 * value on its own.
 */
import type { ChartData, ChartPoint } from './report-chart.data';
import { partsOfWhole, shareText } from './report-chart.model';
import {
  approxMeasure, chipped, DARK_FILLS, drawHeader, fmt, niceScale, PART_COLOR, polar, sectorSegs, valueText,
  type ChartColor, type ChartLayout, type ChartOp, type LayoutOptions, type LegendItem, type PathSeg, type TextOp,
} from './report-chart.geom';

const TAU = Math.PI * 2;

function markColor(p: ChartPoint, base: ChartColor): ChartColor {
  return p.abnormal ? (p.isLow ? 'low' : 'high') : base;
}

/** "78 % H": the value, its unit, then its saved H / L. */
function withUnit(p: ChartPoint, unit: string | null | undefined): string {
  return p.display + (unit ? ` ${unit}` : '') + (p.flag === 'H' || p.flag === 'L' ? ` ${p.flag}` : '');
}

function rangeText(p: ChartPoint): string {
  if (p.low != null && p.high != null) return `${p.low}–${p.high}`;
  if (p.high != null) return `< ${p.high}`;
  if (p.low != null) return `> ${p.low}`;
  return '';
}

function sizes(opts: LayoutOptions) {
  const fs = opts.fontScale && opts.fontScale > 0 ? opts.fontScale : 1;
  return { m: opts.measure ?? approxMeasure, fs, TITLE: 9.5 * fs, SMALL: 7 * fs, TINY: 6.5 * fs };
}

function missingNote(ops: ChartOp[], data: ChartData, h: number, TINY: number): number {
  if (!data.missing.length) return h;
  h += TINY + 2;
  ops.push({ t: 'text', x: 0, y: h, text: `Not measured: ${data.missing.join(', ')}.`, size: TINY, italic: true, color: 'dim', align: 'left', role: 'note' });
  return h + 3;
}

// ── Pie / donut ─────────────────────────────────────────────────────

/**
 * Parts of a whole (e.g. a WBC differential in %, or its absolute counts):
 * slices in the author's
 * order from 12 o'clock, clockwise, in shades of the report accent (they
 * stay distinct in black-and-white print), white separators, and a key
 * beside the pie that prints each value with its flag and normal range. An
 * abnormal part is outlined in the template's abnormal style.
 *
 * Values in % ARE the shares. Values in any other unit (counts) are parts of
 * their total: each slice shows its computed share, and the key prints the
 * share next to the actual value + unit, its saved flag and normal range.
 * Values in different units, or a negative value, are not parts of one
 * whole: no slices, a note says why (the key still prints every value).
 */
export function layoutPie(data: ChartData, width: number, opts: LayoutOptions): ChartLayout {
  const { m, fs, TITLE, SMALL, TINY } = sizes(opts);
  const ops: ChartOp[] = [];
  const donut = data.kind === 'donut';
  const s = data.series[0];
  const pts = s?.points ?? [];
  let y = opts.thumb ? 0 : drawHeader(ops, data.title, [], width, m, TITLE, SMALL) + 8;

  const half = data.size === 'half';
  const D = opts.thumb ? Math.min(width, 120) : Math.min((half ? 112 : 142) * Math.min(1.2, fs), width * (half ? 0.5 : 0.36));
  const R = D / 2;
  const ri = donut ? R * 0.56 : 0;

  const whole = partsOfWhole(pts);
  const unit = whole.unit ?? s?.unit ?? '';
  const total = whole.ok ? whole.total : 0;
  // Counts (not %): each part's share of the total is computed and printed.
  const counts = whole.ok && !whole.percent && total > 0;

  // The key: swatch · name · [share] · value (+ unit, flag) · normal range.
  const rows = data.xLabels.map((label, i) => {
    const p = pts[i];
    const v = p?.value != null ? p.display + (unit ? ` ${unit}` : '') : 'not measured';
    const share = counts && p?.value != null ? shareText(p.value, total) : '';
    return { label, p, v, share, flag: p?.flag === 'H' || p?.flag === 'L' ? p.flag : '', range: p ? rangeText(p) : '' };
  });
  const rowH = SMALL + 6;
  const nameW = Math.max(0, ...rows.map(r => m(r.label, SMALL, false)));
  const valW = Math.max(0, ...rows.map(r => m(r.v, SMALL, true)));
  const shareW = counts ? Math.max(m('Share', TINY, false), ...rows.map(r => m(r.share, SMALL, true))) + 12 : 0;
  const flagW = rows.some(r => r.flag) ? m('H', SMALL, true) + 4 : 0;
  const hasRange = rows.some(r => r.range);
  const rangeW = hasRange ? Math.max(m('Normal', TINY, false), ...rows.map(r => m(r.range, TINY, false))) : 0;
  const keyW = 12 + nameW + shareW + 12 + valW + flagW + (hasRange ? 14 + rangeW : 0);
  const keyHead = hasRange || counts;
  const beside = !opts.thumb && width - D - 24 >= keyW;

  const top = y;
  const cx = R + 2, cy = top + R;

  // Slices.
  const slices: Array<{ i: number; a0: number; a1: number; color: ChartColor; p: ChartPoint }> = [];
  if (total > 0) {
    let a = -Math.PI / 2;
    pts.forEach((p, i) => {
      if (p.value == null || p.value <= 0) return;
      const a1 = a + TAU * (p.value / total);
      slices.push({ i, a0: a, a1, color: PART_COLOR[i % PART_COLOR.length], p });
      a = a1;
    });
  }
  if (slices.length === 1) {
    // One part is the whole: a disc (or ring), no seam.
    const sl = slices[0];
    ops.push(donut
      ? { t: 'path', segs: sectorSegs(cx, cy, R, ri, -Math.PI / 2, -Math.PI / 2 + TAU - 1e-6), fill: sl.color }
      : { t: 'circle', cx, cy, r: R, fill: sl.color });
  } else {
    for (const sl of slices) ops.push({ t: 'path', segs: sectorSegs(cx, cy, R, ri, sl.a0, sl.a1), fill: sl.color, stroke: 'paper', lw: 0.8 });
  }
  if (total <= 0) ops.push({ t: 'circle', cx, cy, r: R, stroke: 'grid', lw: 0.8 });
  // Abnormal parts: outlined in the abnormal style, on top of the separators.
  for (const sl of slices) if (sl.p.abnormal) {
    const inset = 0.7;
    ops.push({ t: 'path', segs: sectorSegs(cx, cy, R - inset, ri > 0 ? ri + inset : 0, sl.a0 + 0.012, sl.a1 - 0.012),
      stroke: markColor(sl.p, 'ink'), lw: 1.3 });
  }
  // Values on the slices that have room.
  if (data.showValues && !opts.thumb) for (const sl of slices) {
    if (sl.a1 - sl.a0 < 0.42) continue;
    const mid = (sl.a0 + sl.a1) / 2;
    const [lx, ly] = polar(cx, cy, donut ? (R + ri) / 2 : R * 0.62, mid);
    // Counts: the slice carries its share (the count + its flag are in the key).
    const op: TextOp = { t: 'text', x: lx, y: ly + SMALL * 0.35, text: counts ? shareText(sl.p.value!, total) : valueText(sl.p), size: SMALL, bold: sl.p.abnormal,
      color: sl.p.abnormal ? markColor(sl.p, 'text') : DARK_FILLS.has(sl.color) ? 'paper' : 'ink', align: 'center', role: 'value' };
    ops.push(...(sl.p.abnormal ? chipped(m, op) : [op]));
  }
  // Donut centre: the first part (the author's lead value).
  if (donut && !opts.thumb) {
    const i0 = pts.findIndex(p => p.value != null);
    if (i0 >= 0) {
      const p = pts[i0];
      const big = TITLE * 1.25;
      ops.push({ t: 'text', x: cx, y: cy + big * 0.3, text: counts ? shareText(p.value!, total) : withUnit(p, unit), size: big, bold: true,
        color: p.abnormal ? markColor(p, 'text') : 'ink', align: 'center', role: 'value' });
      ops.push({ t: 'text', x: cx, y: cy + big * 0.3 + TINY + 4, text: data.xLabels[i0], size: TINY, color: 'dim', align: 'center', role: 'legend' });
    }
  }

  // The key.
  let h = top + D;
  if (!opts.thumb) {
    const kx = beside ? D + 24 : 0;
    let ky = beside ? Math.max(top + 2, cy - (rows.length * rowH + (keyHead ? rowH : 0)) / 2) : top + D + 12;
    if (keyHead) {
      if (hasRange) ops.push({ t: 'text', x: kx + keyW, y: ky + TINY, text: 'Normal', size: TINY, color: 'dim', align: 'right', role: 'legend' });
      if (counts) ops.push({ t: 'text', x: kx + 12 + nameW + shareW - 12, y: ky + TINY, text: 'Share', size: TINY, color: 'dim', align: 'right', role: 'legend' });
      ky += rowH;
    }
    rows.forEach((r, i) => {
      const by = ky + i * rowH;
      const base = by + SMALL * 0.9;
      const color = PART_COLOR[i % PART_COLOR.length];
      ops.push({ t: 'rect', x: kx, y: base - SMALL * 0.8, w: 8, h: 8, fill: r.p?.value != null ? color : 'grid' });
      ops.push({ t: 'text', x: kx + 12, y: base, text: r.label, size: SMALL, color: 'text', align: 'left', role: 'xlabel' });
      if (r.share) ops.push({ t: 'text', x: kx + 12 + nameW + shareW - 12, y: base, text: r.share, size: SMALL, bold: true, color: 'ink', align: 'right', role: 'value' });
      const vx = kx + 12 + nameW + shareW + 12 + valW;
      const ab = !!r.p?.abnormal;
      ops.push({ t: 'text', x: vx, y: base, text: r.v, size: SMALL, bold: ab, italic: r.p?.value == null,
        color: ab ? markColor(r.p!, 'text') : r.p?.value == null ? 'dim' : 'ink', align: 'right', role: 'value' });
      if (r.flag) ops.push({ t: 'text', x: vx + 4, y: base, text: r.flag, size: SMALL, bold: true, color: markColor(r.p!, 'text'), align: 'left', role: 'value' });
      if (hasRange && r.range) ops.push({ t: 'text', x: kx + keyW, y: base, text: r.range, size: TINY, color: 'dim', align: 'right', role: 'legend' });
    });
    const keyBottom = ky + rows.length * rowH;
    h = Math.max(h, keyBottom) + 4;
  }
  if (data.empty && !opts.thumb) {
    ops.push({ t: 'text', x: cx, y: cy, text: 'No values to plot yet', size: SMALL, italic: true, color: 'dim', align: 'center', role: 'note' });
  }
  if (!opts.thumb && counts) {
    const dec = Math.min(2, Math.max(0, ...pts.map(p => p.value != null ? (p.display.split('.')[1] ?? '').replace(/\D.*$/, '').length : 0)));
    h += TINY + 2;
    ops.push({ t: 'text', x: 0, y: h, text: `Each slice is its share of the total (${fmt(total, dec)}${unit ? ' ' + unit : ''}).`,
      size: TINY, italic: true, color: 'dim', align: 'left', role: 'note' });
    h += 3;
  }
  if (!opts.thumb && !whole.ok && !data.empty) {
    h += TINY + 2;
    ops.push({ t: 'text', x: 0, y: h, text: `Not drawn as parts of a whole: ${whole.reason}.`, size: TINY, italic: true, color: 'dim', align: 'left', role: 'note' });
    h += 3;
  }
  h = missingNote(ops, data, h, TINY);
  return { width, height: Math.ceil(h + 2), ops };
}

// ── Radar ───────────────────────────────────────────────────────────

/**
 * Several values in DIFFERENT units on one picture (e.g. a liver panel):
 * each spoke is scaled to that value's own upper normal limit, so the
 * "1×" ring is the top of normal on every spoke and the shaded ring is each
 * value's normal band. The spoke labels print the real value + flag.
 */
export function layoutRadar(data: ChartData, width: number, opts: LayoutOptions): ChartLayout {
  const { m, fs, TITLE, SMALL, TINY } = sizes(opts);
  const ops: ChartOp[] = [];
  const s = data.series[0];
  const pts = s?.points ?? [];
  const N = Math.max(3, data.xLabels.length);
  const bandShown = data.refBand && pts.some(p => p.high != null);
  const legend: LegendItem[] = [{ kind: 'line', color: 'accent', label: 'Result' }];
  if (bandShown) legend.push({ kind: 'band', color: 'band', label: 'Normal range' });
  let y = opts.thumb ? 0 : drawHeader(ops, data.title, legend, width, m, TITLE, SMALL) + 6;

  // Ratio of each value to its upper normal limit (no limit: its own value
  // sits on the 1× ring, and the spoke says so).
  const ratio = (p: ChartPoint | undefined): number | null =>
    p?.value == null ? null : p.high != null && p.high > 0 ? p.value / p.high : 1;
  const ratios = pts.map(ratio);
  const maxRatio = Math.max(1.5, ...ratios.filter((r): r is number => r != null));
  const ringStep = maxRatio <= 2 ? 0.5 : maxRatio <= 4 ? 1 : 2;
  const ringMax = Math.min(8, Math.ceil(maxRatio / ringStep - 1e-9) * ringStep);

  const half = data.size === 'half';
  const R = opts.thumb ? Math.min(width / 2 - 2, 60) : Math.min((half ? 62 : 84) * Math.min(1.2, fs), width * (half ? 0.3 : 0.2));
  const labelGap = 7;
  const cx = width / 2;
  const cy = y + (opts.thumb ? 2 : SMALL * 2 + 10) + R;
  const ang = (i: number) => -Math.PI / 2 + (TAU * i) / N;
  const rOf = (r: number) => (Math.min(r, ringMax) / ringMax) * R;
  const poly = (radii: number[]): PathSeg[] => {
    const segs: PathSeg[] = radii.map((r, i) => { const [x, yy] = polar(cx, cy, r, ang(i)); return [i === 0 ? 'M' : 'L', x, yy] as PathSeg; });
    segs.push(['Z']);
    return segs;
  };

  // Rings + spokes.
  for (let r = ringStep; r <= ringMax + 1e-9; r += ringStep) {
    ops.push({ t: 'path', segs: poly(Array(N).fill(rOf(r))), stroke: Math.abs(r - 1) < 1e-9 ? 'hair' : 'grid', lw: Math.abs(r - 1) < 1e-9 ? 0.7 : 0.4 });
  }
  for (let i = 0; i < N; i++) {
    const [x, yy] = polar(cx, cy, R, ang(i));
    ops.push({ t: 'line', x1: cx, y1: cy, x2: x, y2: yy, color: 'grid', w: 0.4 });
  }
  // Normal range: inside the 1× ring (the upper limit of every spoke); a
  // value's LOW limit is a short tick across its spoke.
  if (bandShown) {
    ops.push({ t: 'path', segs: poly(Array(N).fill(rOf(1))), fill: 'band', stroke: 'bandEdge', lw: 0.5 });
    pts.forEach((p, i) => {
      if (p.low == null || p.high == null || p.high <= 0 || p.low <= 0) return;
      const a = ang(i), r = rOf(p.low / p.high);
      const [x1, y1] = polar(cx, cy, r, a);
      const dx = Math.cos(a + Math.PI / 2) * 3, dy = Math.sin(a + Math.PI / 2) * 3;
      ops.push({ t: 'line', x1: x1 - dx, y1: y1 - dy, x2: x1 + dx, y2: y1 + dy, color: 'bandEdge', w: 0.9 });
    });
  }
  // Ring captions (on the top spoke).
  if (!opts.thumb) for (let r = ringStep; r <= ringMax + 1e-9; r += ringStep) {
    const [x, yy] = polar(cx, cy, rOf(r), -Math.PI / 2);
    ops.push(...chipped(m, { t: 'text', x: x + 2, y: yy + TINY * 0.35, text: `${fmt(r, r % 1 ? 1 : 0)}×`, size: TINY, color: 'dim', align: 'left', role: 'tick' }));
  }

  // The result polygon (missing values leave their spoke out).
  const vpts = pts.map((p, i) => ({ p, i, r: ratios[i] })).filter(v => v.r != null);
  if (vpts.length >= 2) {
    const segs: PathSeg[] = vpts.map((v, k) => { const [x, yy] = polar(cx, cy, rOf(v.r!), ang(v.i)); return [k === 0 ? 'M' : 'L', x, yy] as PathSeg; });
    segs.push(['Z']);
    ops.push({ t: 'path', segs, fill: 'accent', opacity: 0.12, stroke: 'accent', lw: 1.4 });
  }
  for (const v of vpts) {
    const [x, yy] = polar(cx, cy, rOf(v.r!), ang(v.i));
    ops.push({ t: 'circle', cx: x, cy: yy, r: v.p.abnormal ? 3 : 2.6, fill: v.p.abnormal ? markColor(v.p, 'accent') : 'paper',
      stroke: v.p.abnormal ? markColor(v.p, 'accent') : 'accent', lw: 1.1 });
  }

  // Spoke labels: name, then the value as it prints.
  let minY = cy - R, maxY = cy + R;
  if (!opts.thumb) data.xLabels.forEach((label, i) => {
    const a = ang(i);
    const [x, yy] = polar(cx, cy, R + labelGap, a);
    const c = Math.cos(a), sn = Math.sin(a);
    const align: 'left' | 'center' | 'right' = c > 0.3 ? 'left' : c < -0.3 ? 'right' : 'center';
    const p = pts[i];
    const lines: TextOp[] = [];
    const noRange = p?.value != null && p.high == null;
    lines.push({ t: 'text', x, y: 0, text: label + (noRange ? ' *' : ''), size: SMALL, color: 'text', align, role: 'xlabel' });
    if (p?.value == null) lines.push({ t: 'text', x, y: 0, text: 'not measured', size: TINY, italic: true, color: 'dim', align, role: 'xlabel' });
    else if (data.showValues) lines.push({ t: 'text', x, y: 0, text: withUnit(p, p.unit), size: SMALL, bold: p.abnormal,
      color: p.abnormal ? markColor(p, 'text') : 'ink', align, role: 'value' });
    const blockH = lines.length * (SMALL + 1.5);
    let ty = sn < -0.3 ? yy - blockH + SMALL : sn > 0.3 ? yy + SMALL : yy - blockH / 2 + SMALL * 0.85;
    for (const l of lines) { ops.push({ ...l, y: ty }); ty += SMALL + 1.5; }
    minY = Math.min(minY, ty - blockH - SMALL);
    maxY = Math.max(maxY, ty - SMALL);
  });

  let h = maxY + 6;
  if (!opts.thumb) {
    h += TINY + 2;
    const star = pts.some(p => p.value != null && p.high == null) ? ' * no upper normal limit saved: drawn on the 1× ring.' : '';
    ops.push({ t: 'text', x: 0, y: h, text: `Each spoke is scaled to its own upper normal limit (1×); a tick marks a lower limit.${star}`, size: TINY, italic: true, color: 'dim', align: 'left', role: 'note' });
  }
  if (data.empty && !opts.thumb) ops.push({ t: 'text', x: cx, y: cy, text: 'No values to plot yet', size: SMALL, italic: true, color: 'dim', align: 'center', role: 'note' });
  h = missingNote(ops, data, h, TINY);
  return { width, height: Math.ceil(h + 2), ops };
}

// ── Gauge ───────────────────────────────────────────────────────────

/**
 * One value against its range (e.g. HbA1c): a 240° dial, the normal band
 * shaded on the track, the author's thresholds as labelled ticks, a needle
 * at the value and the value itself (with its saved flag) under the hub.
 */
export function layoutGauge(data: ChartData, width: number, opts: LayoutOptions): ChartLayout {
  const { m, fs, TITLE, SMALL, TINY } = sizes(opts);
  const ops: ChartOp[] = [];
  const s = data.series[0];
  const idx = Math.max(0, (s?.points ?? []).findIndex(p => p.value != null));
  const p: ChartPoint | undefined = s?.points[idx];
  const name = data.xLabels[idx] ?? '';
  const bandShown = data.refBand && !!p && (p.low != null || p.high != null);
  const legend: LegendItem[] = bandShown ? [{ kind: 'band', color: 'band', label: 'Normal range' }] : [];
  let y = opts.thumb ? 0 : drawHeader(ops, data.title, legend, width, m, TITLE, SMALL) + 6;

  const vals: number[] = [];
  if (p?.value != null) vals.push(p.value);
  if (p?.low != null) vals.push(p.low);
  if (p?.high != null) vals.push(p.high);
  for (const t of data.thresholds) vals.push(t.value);
  if (!vals.length) vals.push(0, 1);
  const vmin = Math.min(...vals), vmax = Math.max(...vals);
  const span = Math.max(vmax - vmin, Math.abs(vmax) * 0.2, 1e-6);
  const sc = niceScale(Math.max(vmin >= 0 ? 0 : -Infinity, vmin - span * 0.3), vmax + span * 0.3, data.yMin, data.yMax, 6);

  const half = data.size === 'half';
  const R = opts.thumb ? Math.min(width / 2 - 2, 60) : Math.min((half ? 74 : 92) * Math.min(1.2, fs), width * (half ? 0.36 : 0.22));
  const tw = R * 0.15;
  const A0 = (5 * Math.PI) / 6, SWEEP = (4 * Math.PI) / 3;
  const A = (v: number) => A0 + ((Math.min(Math.max(v, sc.lo), sc.hi) - sc.lo) / (sc.hi - sc.lo)) * SWEEP;
  const cx = width / 2;
  const cy = y + (opts.thumb ? 2 : TINY * 2 + 10) + R;

  // Track, normal band, ticks.
  ops.push({ t: 'path', segs: sectorSegs(cx, cy, R, R - tw, A0, A0 + SWEEP), fill: 'grid' });
  if (bandShown && p) {
    const a0 = A(p.low ?? sc.lo), a1 = A(p.high ?? sc.hi);
    if (a1 - a0 > 0.005) ops.push({ t: 'path', segs: sectorSegs(cx, cy, R, R - tw, a0, a1), fill: 'band', stroke: 'bandEdge', lw: 0.5 });
  }
  for (const t of sc.ticks) {
    const a = A(t);
    const [x1, y1] = polar(cx, cy, R - tw, a);
    const [x2, y2] = polar(cx, cy, R - tw - 3.5, a);
    ops.push({ t: 'line', x1, y1, x2, y2, color: 'hair', w: 0.6 });
    if (!opts.thumb) {
      const [lx, ly] = polar(cx, cy, R - tw - 5 - SMALL * 0.9, a);
      ops.push({ t: 'text', x: lx, y: ly + SMALL * 0.35, text: fmt(t, sc.decimals), size: SMALL, color: 'dim', align: 'center', role: 'tick' });
    }
  }
  // Thresholds: a tick across the track, labelled outside the dial.
  for (const t of data.thresholds) {
    const a = A(t.value);
    const [x1, y1] = polar(cx, cy, R - tw - 1, a);
    const [x2, y2] = polar(cx, cy, R + 3, a);
    ops.push({ t: 'line', x1, y1, x2, y2, color: 'text', w: 0.9, dash: [2, 1.2] });
    if (!opts.thumb) {
      const [lx, ly] = polar(cx, cy, R + 6, a);
      const c = Math.cos(a);
      const label = (t.label ?? '').trim() || fmt(t.value, sc.decimals);
      ops.push(...chipped(m, { t: 'text', x: lx, y: ly + (Math.sin(a) < -0.5 ? -1 : TINY * 0.35), text: label, size: TINY, color: 'text',
        align: c > 0.25 ? 'left' : c < -0.25 ? 'right' : 'center', role: 'threshold' }));
    }
  }

  // Needle + hub.
  if (p?.value != null) {
    const a = A(p.value);
    const [tx, ty] = polar(cx, cy, R - tw * 0.4, a);
    const [bx1, by1] = polar(cx, cy, 2.6, a + Math.PI / 2);
    const [bx2, by2] = polar(cx, cy, 2.6, a - Math.PI / 2);
    const col = markColor(p, 'ink');
    ops.push({ t: 'path', segs: [['M', bx1, by1], ['L', tx, ty], ['L', bx2, by2], ['Z']], fill: col });
    ops.push({ t: 'circle', cx, cy, r: 4.2, fill: col });
    ops.push({ t: 'circle', cx, cy, r: 1.6, fill: 'paper' });
  }

  // The value under the hub (inside the dial's open bottom).
  let h = cy + R * 0.5;
  if (!opts.thumb) {
    const big = TITLE * 1.7;
    let ty = cy + R * 0.36 + big * 0.35;
    if (p?.value != null) {
      const unit = s?.unit ? ` ${s.unit}` : '';
      ops.push({ t: 'text', x: cx, y: ty, text: p.display + unit + (p.flag === 'H' || p.flag === 'L' ? `  ${p.flag}` : ''),
        size: big, bold: true, color: p.abnormal ? markColor(p, 'text') : 'ink', align: 'center', role: 'value' });
    } else {
      ops.push({ t: 'text', x: cx, y: ty, text: 'not measured', size: SMALL, italic: true, color: 'dim', align: 'center', role: 'note' });
    }
    ty += SMALL + 6;
    ops.push({ t: 'text', x: cx, y: ty, text: name, size: SMALL, color: 'text', align: 'center', role: 'xlabel' });
    const rt = p ? rangeText(p) : '';
    if (rt) { ty += TINY + 4; ops.push({ t: 'text', x: cx, y: ty, text: `Normal ${rt}${s?.unit ? ' ' + s.unit : ''}`, size: TINY, color: 'dim', align: 'center', role: 'legend' }); }
    h = Math.max(h, ty + 4);
  }
  h = missingNote(ops, data, h, TINY);
  return { width, height: Math.ceil(h + 2), ops };
}
