import { CanvasLabel, CanvasPin, CanvasRegion, InkStroke, RegionShape } from './canvas-model';

/** Pure geometry for the canvas engine: hit-testing, the eraser, the zoom / pan view. Tested without a browser. */

export interface Pt {
  x: number;
  y: number;
}

/** Ray casting; `points` is flat x,y pairs. */
export function pointInPolygon(p: Pt, points: number[]): boolean {
  let inside = false;
  const n = points.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points[i * 2];
    const yi = points[i * 2 + 1];
    const xj = points[j * 2];
    const yj = points[j * 2 + 1];
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInShape(p: Pt, s: RegionShape): boolean {
  if (s.type === 'ellipse') {
    if (s.rx <= 0 || s.ry <= 0) return false;
    const dx = (p.x - s.cx) / s.rx;
    const dy = (p.y - s.cy) / s.ry;
    return dx * dx + dy * dy <= 1;
  }
  return s.points.length >= 6 && pointInPolygon(p, s.points);
}

export function shapeArea(s: RegionShape): number {
  if (s.type === 'ellipse') return Math.PI * s.rx * s.ry;
  let a = 0;
  const n = s.points.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++)
    a += (s.points[j * 2] + s.points[i * 2]) * (s.points[j * 2 + 1] - s.points[i * 2 + 1]);
  return Math.abs(a / 2);
}

export function shapeCentre(s: RegionShape): Pt {
  if (s.type === 'ellipse') return { x: s.cx, y: s.cy };
  let x = 0;
  let y = 0;
  const n = s.points.length / 2;
  for (let i = 0; i < n; i++) {
    x += s.points[i * 2];
    y += s.points[i * 2 + 1];
  }
  return { x: x / n, y: y / n };
}

/**
 * The region under a point. Overlaps resolve to the SMALLEST region (the
 * pupil inside the iris, a finger on the hand), so small areas stay reachable.
 */
export function hitRegion(regions: readonly CanvasRegion[], p: Pt): CanvasRegion | null {
  let best: CanvasRegion | null = null;
  let bestArea = Infinity;
  for (const r of regions) {
    if (!pointInShape(p, r.shape)) continue;
    const a = shapeArea(r.shape);
    if (a < bestArea) {
      best = r;
      bestArea = a;
    }
  }
  return best;
}

/**
 * The region nearest a point within `slop` (a finger is wider than a line):
 * a tap just outside a thin finger still marks it.
 */
export function hitRegionNear(regions: readonly CanvasRegion[], p: Pt, slop: number): CanvasRegion | null {
  const exact = hitRegion(regions, p);
  if (exact || slop <= 0) return exact;
  let best: CanvasRegion | null = null;
  let bestD = slop;
  for (const r of regions) {
    const d = distanceToShape(p, r.shape);
    if (d <= bestD) {
      best = r;
      bestD = d;
    }
  }
  return best;
}

export function distanceToSegment(p: Pt, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len === 0 ? 0 : ((p.x - ax) * dx + (p.y - ay) * dy) / len;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx - p.x;
  const y = ay + t * dy - p.y;
  return Math.sqrt(x * x + y * y);
}

function distanceToShape(p: Pt, s: RegionShape): number {
  if (pointInShape(p, s)) return 0;
  if (s.type === 'ellipse') {
    // distance to the ellipse, approximated on the ray from the centre
    const a = Math.atan2((p.y - s.cy) / s.ry, (p.x - s.cx) / s.rx);
    const ex = s.cx + s.rx * Math.cos(a);
    const ey = s.cy + s.ry * Math.sin(a);
    return Math.hypot(p.x - ex, p.y - ey);
  }
  let d = Infinity;
  const n = s.points.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++)
    d = Math.min(d, distanceToSegment(p, s.points[j * 2], s.points[j * 2 + 1], s.points[i * 2], s.points[i * 2 + 1]));
  return d;
}

/** Does the eraser (a circle of `radius` at p) touch this stroke? */
export function strokeHit(s: InkStroke, p: Pt, radius: number): boolean {
  const pts = s.points;
  const reach = radius + s.size / 2;
  if (pts.length === 3) return Math.hypot(pts[0] - p.x, pts[1] - p.y) <= reach;
  for (let i = 3; i + 2 < pts.length; i += 3)
    if (distanceToSegment(p, pts[i - 3], pts[i - 2], pts[i], pts[i + 1]) <= reach) return true;
  return false;
}

/** The strokes the eraser path from a → b touches (sampled along the segment). */
export function strokesUnder(strokes: readonly InkStroke[], a: Pt, b: Pt, radius: number): Set<string> {
  const out = new Set<string>();
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, radius / 2)));
  for (let i = 0; i <= steps; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps };
    for (const s of strokes) if (!out.has(s.id) && strokeHit(s, p, radius)) out.add(s.id);
  }
  return out;
}

export function pinAt(pins: readonly CanvasPin[], p: Pt, radius: number): CanvasPin | null {
  let best: CanvasPin | null = null;
  let bestD = radius;
  for (const pin of pins) {
    const d = Math.hypot(pin.x - p.x, pin.y - p.y);
    if (d <= bestD) {
      best = pin;
      bestD = d;
    }
  }
  return best;
}

export function labelAt(labels: readonly CanvasLabel[], p: Pt, size: number): CanvasLabel | null {
  for (let i = labels.length - 1; i >= 0; i--) {
    const l = labels[i];
    const w = Math.max(size * 2, l.text.length * size * 0.56);
    if (p.x >= l.x - size * 0.3 && p.x <= l.x + w && p.y >= l.y - size * 1.1 && p.y <= l.y + size * 0.4) return l;
  }
  return null;
}

// ---------- view: zoom and pan ----------

/** Screen = picture × scale + offset (CSS px, relative to the surface's top-left). */
export interface View {
  scale: number;
  x: number;
  y: number;
}

export const MAX_ZOOM = 6;

/** The view that fits the picture inside a box (letterboxed, centred). */
export function fitView(w: number, h: number, boxW: number, boxH: number): View {
  if (w <= 0 || h <= 0 || boxW <= 0 || boxH <= 0) return { scale: 1, x: 0, y: 0 };
  const scale = Math.min(boxW / w, boxH / h);
  return { scale, x: (boxW - w * scale) / 2, y: (boxH - h * scale) / 2 };
}

export function toPicture(v: View, sx: number, sy: number): Pt {
  return { x: (sx - v.x) / v.scale, y: (sy - v.y) / v.scale };
}

export function toScreen(v: View, px: number, py: number): Pt {
  return { x: px * v.scale + v.x, y: py * v.scale + v.y };
}

/** Zoom by `factor` keeping the screen point (cx, cy) still; clamped between "fit" and MAX_ZOOM × fit. */
export function zoomAt(v: View, factor: number, cx: number, cy: number, fit: View): View {
  const scale = Math.min(fit.scale * MAX_ZOOM, Math.max(fit.scale, v.scale * factor));
  const k = scale / v.scale;
  return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
}

/** Keep the picture covering the box when zoomed in (no panning into the void); centred at fit. */
export function clampView(v: View, w: number, h: number, boxW: number, boxH: number): View {
  const pw = w * v.scale;
  const ph = h * v.scale;
  const x = pw <= boxW ? (boxW - pw) / 2 : Math.min(0, Math.max(boxW - pw, v.x));
  const y = ph <= boxH ? (boxH - ph) / 2 : Math.min(0, Math.max(boxH - ph, v.y));
  return { scale: v.scale, x, y };
}

/**
 * The pixel size of a raster export (the thumbnail) for a CSS size and a
 * device pixel ratio: sharp on retina, capped so a huge picture never makes
 * a huge file.
 */
export function rasterSize(cssW: number, cssH: number, dpr: number, maxSide = 2048): { w: number; h: number; k: number } {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  let k = ratio;
  const side = Math.max(cssW, cssH) * k;
  if (side > maxSide) k = maxSide / Math.max(cssW, cssH);
  return { w: Math.round(cssW * k), h: Math.round(cssH * k), k };
}
