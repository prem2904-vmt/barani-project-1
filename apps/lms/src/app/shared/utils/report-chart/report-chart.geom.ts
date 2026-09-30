/**
 * Report chart drawing primitives shared by every chart type
 * (docs/REPORT-CHARTS.md §5): the drawing-operation vocabulary both painters
 * understand (vector jsPDF + inline SVG), text measuring, nice axis scales,
 * label wrapping / chips, and the curve maths (arcs, smooth lines) as cubic
 * Béziers — so a pie slice or a smooth line is a real vector path in the PDF.
 *
 * Pure: no Angular, no jsPDF, no DOM.
 */

export type ChartColor =
  | 'ink' | 'text' | 'dim' | 'hair' | 'grid'
  | 'accent' | 'line2' | 'bar' | 'band' | 'bandEdge'
  | 'high' | 'low' | 'paper'
  /** Series 3–6 (series 1 / 2 are `accent` / `line2`). */
  | 's3' | 's4' | 's5' | 's6'
  /** Parts of a whole (pie / donut slices), darkest first. */
  | 'p1' | 'p2' | 'p3' | 'p4' | 'p5' | 'p6' | 'p7' | 'p8';

/** One path segment, absolute coordinates: move / line / cubic / close. */
export type PathSeg =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Z'];

export type ChartOp =
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; color: ChartColor; w: number; dash?: number[] }
  | { t: 'poly'; pts: Array<[number, number]>; color: ChartColor; w: number; dash?: number[] }
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill?: ChartColor; stroke?: ChartColor; lw?: number }
  | { t: 'circle'; cx: number; cy: number; r: number; fill?: ChartColor; stroke?: ChartColor; lw?: number }
  /** A vector path (curves, arcs, areas). `opacity` applies to the fill only. */
  | { t: 'path'; segs: PathSeg[]; fill?: ChartColor; stroke?: ChartColor; lw?: number; dash?: number[]; opacity?: number }
  /** `y` is the text BASELINE (jsPDF and SVG agree on that). */
  | { t: 'text'; x: number; y: number; text: string; size: number; bold?: boolean; italic?: boolean;
      color: ChartColor; align: 'left' | 'center' | 'right'; role?: 'title' | 'value' | 'tick' | 'xlabel' | 'threshold' | 'legend' | 'note' | 'unit' };

export type TextOp = Extract<ChartOp, { t: 'text' }>;

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
  /** A picker thumbnail: marks only — no text, legend or labels. */
  thumb?: boolean;
}

export interface Scale { lo: number; hi: number; step: number; ticks: number[]; decimals: number; }

function niceStep(range: number, count: number): number {
  const raw = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * mag;
}

/** A readable axis over [min, max] (4–6 ticks). Exported for tests. */
export function niceScale(min: number, max: number, fixedLo: number | null, fixedHi: number | null, count = 5): Scale {
  let lo = fixedLo ?? min;
  let hi = fixedHi ?? max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (hi <= lo) { hi = lo === 0 ? 1 : lo + Math.abs(lo) * 0.2; }
  const step = niceStep(hi - lo, count);
  const nlo = fixedLo ?? Math.floor(lo / step) * step;
  const nhi = fixedHi ?? Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  const first = Math.ceil(nlo / step - 1e-9) * step;
  for (let v = first; v <= nhi + step * 1e-6; v += step) ticks.push(Number(v.toFixed(10)));
  const stepText = String(Number(step.toFixed(10)));
  const decimals = Math.min(3, stepText.includes('.') ? stepText.split('.')[1].length : 0);
  return { lo: nlo, hi: nhi === nlo ? nlo + step : nhi, step, ticks, decimals };
}

export function fmt(v: number, decimals: number): string {
  return v.toFixed(decimals);
}

/** Split a label into at most two lines that fit `maxW`. */
export function wrap2(text: string, size: number, maxW: number, m: Measure): string[] {
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

/** A text op with a paper chip behind it, so a label never fights a line,
 *  a gridline or a band edge. */
export function chipped(m: Measure, op: TextOp): ChartOp[] {
  const w = m(op.text, op.size, !!op.bold) + 3;
  const x = op.align === 'center' ? op.x - w / 2 : op.align === 'right' ? op.x - w + 1.5 : op.x - 1.5;
  return [{ t: 'rect', x, y: op.y - op.size * 0.82, w, h: op.size * 1.05, fill: 'paper' }, op];
}

/** A value as it prints on a chart: the saved text + its H / L letter. */
export function valueText(p: { display: string; value: number | null; flag: string }): string {
  return (p.display || String(p.value)) + (p.flag === 'H' || p.flag === 'L' ? ` ${p.flag}` : '');
}

/** Series colours, dashes and marker shapes by series index (1 and 2 are
 *  the v1 look: accent solid circles, slate dashed squares). */
export const SERIES_COLOR: ChartColor[] = ['accent', 'line2', 's3', 's4', 's5', 's6'];
export const SERIES_DASH: Array<number[] | undefined> = [undefined, [3, 2], [1, 1.6], [5, 2, 1, 2], [6, 2.5], [2, 2]];
export const PART_COLOR: ChartColor[] = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
/** Fills dark enough to carry white text. */
export const DARK_FILLS: ReadonlySet<ChartColor> = new Set<ChartColor>(['accent', 'line2', 's5', 's6', 'p1', 'p2', 'p3', 'ink']);

/** A marker for series `si` at (cx, cy): circle, square, triangle, diamond… */
export function marker(si: number, cx: number, cy: number, fill: ChartColor, stroke: ChartColor): ChartOp {
  const shape = si % 4;
  if (shape === 0) return { t: 'circle', cx, cy, r: 2.6, fill, stroke, lw: 1.1 };
  if (shape === 1) return { t: 'rect', x: cx - 2.4, y: cy - 2.4, w: 4.8, h: 4.8, fill, stroke, lw: 1 };
  const r = 3.1;
  const segs: PathSeg[] = shape === 2
    ? [['M', cx, cy - r], ['L', cx + r * 0.9, cy + r * 0.62], ['L', cx - r * 0.9, cy + r * 0.62], ['Z']]
    : [['M', cx, cy - r], ['L', cx + r, cy], ['L', cx, cy + r], ['L', cx - r, cy], ['Z']];
  return { t: 'path', segs, fill, stroke, lw: 1 };
}

// ── Curves ──────────────────────────────────────────────────────────

/** Point on a circle; angles in radians, clockwise from 3 o'clock (y down). */
export function polar(cx: number, cy: number, r: number, a: number): [number, number] {
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** Arc from a0 to a1 as cubic Béziers (≤ 90° each). Does not include the
 *  initial move — the caller starts at `polar(…, a0)`. */
export function arcSegs(cx: number, cy: number, r: number, a0: number, a1: number): PathSeg[] {
  const out: PathSeg[] = [];
  const total = a1 - a0;
  const n = Math.max(1, Math.ceil(Math.abs(total) / (Math.PI / 2) - 1e-9));
  const d = total / n;
  const k = (4 / 3) * Math.tan(d / 4);
  for (let i = 0; i < n; i++) {
    const s = a0 + d * i, e = s + d;
    const [x0, y0] = polar(cx, cy, r, s);
    const [x1, y1] = polar(cx, cy, r, e);
    out.push(['C', x0 - k * r * Math.sin(s), y0 + k * r * Math.cos(s), x1 + k * r * Math.sin(e), y1 - k * r * Math.cos(e), x1, y1]);
  }
  return out;
}

/** A pie slice (inner = 0) or a ring sector (donut / gauge track). */
export function sectorSegs(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): PathSeg[] {
  const [ox, oy] = polar(cx, cy, rOuter, a0);
  const segs: PathSeg[] = [['M', ox, oy], ...arcSegs(cx, cy, rOuter, a0, a1)];
  if (rInner > 0) {
    const [ix, iy] = polar(cx, cy, rInner, a1);
    segs.push(['L', ix, iy], ...arcSegs(cx, cy, rInner, a1, a0));
  } else {
    segs.push(['L', cx, cy]);
  }
  segs.push(['Z']);
  return segs;
}

/**
 * A smooth line through points with increasing x — monotone cubic
 * (Fritsch–Carlson), the same idea as ECharts' `smoothMonotone`: the curve
 * never overshoots between two measured values, so it never shows a peak or
 * a dip that was not measured.
 */
export function monotoneSegs(pts: ReadonlyArray<[number, number]>): PathSeg[] {
  const n = pts.length;
  if (n === 0) return [];
  const segs: PathSeg[] = [['M', pts[0][0], pts[0][1]]];
  if (n === 1) return segs;
  if (n === 2) { segs.push(['L', pts[1][0], pts[1][1]]); return segs; }
  const h: number[] = [], d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(pts[i + 1][0] - pts[i][0]);
    d.push((pts[i + 1][1] - pts[i][1]) / (h[i] || 1));
  }
  const t: number[] = [d[0]];
  for (let i = 1; i < n - 1; i++) t.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  t.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / d[i], b = t[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * d[i]; t[i + 1] = k * b * d[i]; }
  }
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const dx = h[i] / 3;
    segs.push(['C', x0 + dx, y0 + t[i] * dx, x1 - dx, y1 - t[i + 1] * dx, x1, y1]);
  }
  return segs;
}

/** A step line through points: level at each point, the change half-way to
 *  the next one (ECharts `step: 'middle'`). */
export function stepSegs(pts: ReadonlyArray<[number, number]>): PathSeg[] {
  if (pts.length === 0) return [];
  const segs: PathSeg[] = [['M', pts[0][0], pts[0][1]]];
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1][0] + pts[i][0]) / 2;
    segs.push(['L', mx, pts[i - 1][1]], ['L', mx, pts[i][1]], ['L', pts[i][0], pts[i][1]]);
  }
  return segs;
}

export type LegendItem = { kind: 'line' | 'band' | 'box'; color: ChartColor; dash?: number[]; label: string };

/**
 * Title + legend. The legend sits right of the title when both fit on one
 * row, else on the next row(s), wrapping at the chart width. Returns the
 * baseline y of the last row.
 */
export function drawHeader(ops: ChartOp[], title: string, legend: LegendItem[], width: number, m: Measure, TITLE: number, SMALL: number): number {
  let y = TITLE;
  ops.push({ t: 'text', x: 0, y, text: title, size: TITLE, bold: true, color: 'ink', align: 'left', role: 'title' });
  if (!legend.length) return y;
  const itemW = legend.map(l => 16 + m(l.label, SMALL, false) + 10);
  const total = itemW.reduce((a, b) => a + b, 0);
  const titleW = m(title, TITLE, true);
  let lx: number;
  if (titleW + 16 + total <= width) { lx = width - total; }       // same row, right-aligned
  else { y += SMALL + 6; lx = 0; }
  legend.forEach((l, i) => {
    if (lx > 0 && lx + itemW[i] - 10 > width) { y += SMALL + 5; lx = 0; }      // wrap
    const ly = y - SMALL * 0.3;
    if (l.kind === 'band') ops.push({ t: 'rect', x: lx, y: ly - 3.5, w: 12, h: 7, fill: 'band', stroke: 'bandEdge', lw: 0.4 });
    else if (l.kind === 'box') ops.push({ t: 'rect', x: lx + 2, y: ly - 3.5, w: 8, h: 7, fill: l.color });
    else ops.push({ t: 'line', x1: lx, y1: ly, x2: lx + 12, y2: ly, color: l.color, w: 1.4, dash: l.dash });
    ops.push({ t: 'text', x: lx + 16, y: y, text: l.label, size: SMALL, color: 'text', align: 'left', role: 'legend' });
    lx += itemW[i];
  });
  return y;
}

/** SVG path data for a segment list (2-decimal, stable output). */
export function pathD(segs: readonly PathSeg[]): string {
  const f = (n: number) => String(Math.round(n * 100) / 100);
  return segs.map(sg => sg[0] === 'Z' ? 'Z' : sg[0] + sg.slice(1).map(v => f(v as number)).join(' ')).join(' ');
}

/** Drop every text (and the paper chip under it) — picker thumbnails. */
export function marksOnly(ops: ChartOp[]): ChartOp[] {
  return ops.filter((o, i) => o.t !== 'text' && !(o.t === 'rect' && o.fill === 'paper' && !o.stroke && ops[i + 1]?.t === 'text'));
}

/** [x0, y0, x1, y1] around every non-text mark (thumbnail crop). */
export function marksBox(ops: readonly ChartOp[]): [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const o of ops) {
    switch (o.t) {
      case 'line': add(o.x1, o.y1); add(o.x2, o.y2); break;
      case 'poly': o.pts.forEach(([x, y]) => add(x, y)); break;
      case 'rect': add(o.x, o.y); add(o.x + o.w, o.y + o.h); break;
      case 'circle': add(o.cx - o.r, o.cy - o.r); add(o.cx + o.r, o.cy + o.r); break;
      case 'path': for (const sg of o.segs) if (sg[0] !== 'Z') add(sg[sg.length - 2] as number, sg[sg.length - 1] as number); break;
    }
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}
