import { getStroke } from 'perfect-freehand';
import { InkStroke, RegionShape } from './canvas-model';

/**
 * Ink: a stroke's points become a filled outline (perfect-freehand), so a
 * Pencil line swells with pressure and tapers like real ink. The PDF is drawn by
 * the API from the stored vector answer (one printer, not two).
 */

/** perfect-freehand settings: pen = real pressure; finger / mouse = pressure simulated from speed. */
export function strokeOptions(s: Pick<InkStroke, 'size' | 'pen'>, last = true) {
  return {
    size: s.size,
    thinning: s.pen ? 0.6 : 0.5,
    smoothing: 0.5,
    streamline: 0.45,
    simulatePressure: !s.pen,
    start: { taper: false, cap: true },
    end: { taper: false, cap: true },
    last,
  };
}

/** Flat x,y,p triplets → [[x,y,p]…]. */
export function triplets(points: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 2 < points.length; i += 3) out.push([points[i], points[i + 1], points[i + 2]]);
  return out;
}

const avg = (a: number, b: number) => (a + b) / 2;
const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

/** An outline polygon → a smooth closed SVG path (quadratic midpoints). */
export function outlineToPath(outline: number[][]): string {
  const n = outline.length;
  if (n < 4) return '';
  let a = outline[0];
  let b = outline[1];
  const c = outline[2];
  let d = `M${f1(a[0])},${f1(a[1])} Q${f1(b[0])},${f1(b[1])} ${f1(avg(b[0], c[0]))},${f1(avg(b[1], c[1]))} T`;
  for (let i = 2; i < n - 1; i++) {
    a = outline[i];
    b = outline[i + 1];
    d += `${f1(avg(a[0], b[0]))},${f1(avg(a[1], b[1]))} `;
  }
  return d + 'Z';
}

/** The SVG path of one stroke (a single tap is a dot). */
export function strokePath(s: Pick<InkStroke, 'points' | 'size' | 'pen'>, last = true): string {
  const pts = triplets(s.points);
  if (pts.length === 0) return '';
  if (pts.length === 1) {
    const [x, y] = pts[0];
    const r = s.size / 2;
    return `M${f1(x - r)},${f1(y)} a${f1(r)},${f1(r)} 0 1,0 ${f1(r * 2)},0 a${f1(r)},${f1(r)} 0 1,0 ${f1(-r * 2)},0Z`;
  }
  return outlineToPath(getStroke(pts, strokeOptions(s, last)));
}

/** A region as an SVG path. */
export function regionPath(s: RegionShape): string {
  if (s.type === 'ellipse')
    return `M${f1(s.cx - s.rx)},${f1(s.cy)} a${f1(s.rx)},${f1(s.ry)} 0 1,0 ${f1(s.rx * 2)},0 a${f1(s.rx)},${f1(s.ry)} 0 1,0 ${f1(-s.rx * 2)},0Z`;
  const p = s.points;
  if (p.length < 6) return '';
  let d = `M${f1(p[0])},${f1(p[1])}`;
  for (let i = 2; i + 1 < p.length; i += 2) d += ` L${f1(p[i])},${f1(p[i + 1])}`;
  return d + 'Z';
}
