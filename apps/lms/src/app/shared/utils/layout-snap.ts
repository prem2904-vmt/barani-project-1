/**
 * Smart guides — the ONE snapping engine every layout editor uses (owner
 * 2026-11-01: "guided lines and alignment — if one image is there it auto
 * aligns and shows that"). The profile Custom layout designer (mm, body
 * coordinates) and the report-template letterhead / footer editor (pt, page
 * coordinates) both call these pure functions, so the two can never drift.
 *
 * Unit-agnostic: every number (rects, lines, tolerance) is in the CALLER's
 * unit. The tolerance is a screen distance — `tolFromPx(pxPerUnit)` turns
 * ~6 px into the caller's unit at the current zoom, so snapping feels the
 * same at every page size.
 *
 * What snaps (Figma-style):
 *   · a moving rect's left / centre / right (and top / middle / bottom) to the
 *     static lines (margins, centre, body edges) and to every other rect's
 *     edges and centres;
 *   · equal spacing — to the gap two neighbours already keep, or centred
 *     between its two neighbours;
 *   · on resize, the moving edge to the same targets, or the size to another
 *     rect's width / height.
 * What it returns: the snapped rect + guide SEGMENTS drawn only between the
 * aligned rects (a static line spans `bounds`) + equal-gap / equal-size
 * measures. Alt (Option) held = `snappingOn(ev) === false` = free placement.
 */

export interface SnapRect { x: number; y: number; w: number; h: number }

/** A guide line: `v` is vertical at x = pos (from/to are y), `h` is horizontal at y = pos. */
export interface GuideSeg { axis: 'v' | 'h'; pos: number; from: number; to: number }

/** A spacing / size mark: `x` runs horizontally from→to at y = at; `y` runs vertically at x = at. */
export interface Measure { axis: 'x' | 'y'; from: number; to: number; at: number; size: number; kind: 'gap' | 'size' }

/** What an editor draws while something moves. */
export interface SnapGuides { lines: GuideSeg[]; measures: Measure[] }

export interface SnapContext {
  /** The other rects (hidden ones already left out by the caller). */
  others: ReadonlyArray<SnapRect>;
  /** Static lines (margins, centre, body edges). */
  lines?: { xs?: ReadonlyArray<number>; ys?: ReadonlyArray<number> };
  /** The area a static line is drawn across (the body / page). */
  bounds: SnapRect;
  /** Snap distance, in the caller's unit (see `tolFromPx`). */
  tol: number;
}

export interface SnapResult extends SnapGuides { rect: SnapRect }

export const NO_GUIDES: SnapGuides = Object.freeze({ lines: [], measures: [] }) as SnapGuides;

/** Snap distance on screen. */
export const SNAP_PX = 6;
/** Two positions closer than this count as aligned (for drawing guides). */
const ALIGN_EPS = 0.05;

/** Screen px → the caller's unit at the current zoom (`pxPerUnit` px per mm / pt). */
export function tolFromPx(pxPerUnit: number, px = SNAP_PX): number {
  return pxPerUnit > 0 && isFinite(pxPerUnit) ? px / pxPerUnit : 0;
}

/** Hold Alt (Option) while dragging = place freely, no snapping. */
export function snappingOn(ev: { altKey?: boolean } | null | undefined): boolean {
  return !ev?.altKey;
}

type Axis = 'x' | 'y';
const start = (r: SnapRect, a: Axis) => (a === 'x' ? r.x : r.y);
const size = (r: SnapRect, a: Axis) => (a === 'x' ? r.w : r.h);
const end = (r: SnapRect, a: Axis) => start(r, a) + size(r, a);
const other = (a: Axis): Axis => (a === 'x' ? 'y' : 'x');
const anchors = (r: SnapRect, a: Axis) => [start(r, a), start(r, a) + size(r, a) / 2, end(r, a)];
const withStart = (r: SnapRect, a: Axis, v: number): SnapRect => (a === 'x' ? { ...r, x: v } : { ...r, y: v });
/** Do two rects share any span on the cross axis (same row for x, same column for y)? */
const crossOverlap = (p: SnapRect, q: SnapRect, a: Axis) => {
  const b = other(a);
  return start(p, b) < end(q, b) - ALIGN_EPS && start(q, b) < end(p, b) - ALIGN_EPS;
};

function targets(ctx: SnapContext, a: Axis): number[] {
  const out = [...((a === 'x' ? ctx.lines?.xs : ctx.lines?.ys) ?? [])];
  for (const o of ctx.others) out.push(...anchors(o, a));
  return out;
}

/** The neighbours on one axis: the nearest rect before and after `r` in the same row / column. */
function neighbours(r: SnapRect, others: ReadonlyArray<SnapRect>, a: Axis, slack: number) {
  let before: SnapRect | null = null, after: SnapRect | null = null;
  for (const o of others) {
    if (!crossOverlap(r, o, a)) continue;
    if (end(o, a) <= start(r, a) + slack && (!before || end(o, a) > end(before, a))) before = o;
    if (start(o, a) >= end(r, a) - slack && (!after || start(o, a) < start(after, a))) after = o;
  }
  return { before, after };
}

/** Gaps two neighbouring OTHER rects already keep on an axis (same row / column). */
function existingGaps(others: ReadonlyArray<SnapRect>, a: Axis): Array<{ p: SnapRect; q: SnapRect; g: number }> {
  const out: Array<{ p: SnapRect; q: SnapRect; g: number }> = [];
  for (const p of others) {
    // The nearest rect after p in its row.
    let q: SnapRect | null = null;
    for (const o of others) {
      if (o === p || !crossOverlap(p, o, a) || start(o, a) < end(p, a) - ALIGN_EPS) continue;
      if (!q || start(o, a) < start(q, a)) q = o;
    }
    if (q) {
      const g = start(q, a) - end(p, a);
      if (g > ALIGN_EPS) out.push({ p, q, g });
    }
  }
  return out;
}

/** Best snap of a moving rect's start on one axis: edges / centres, then equal gaps. */
function snapAxis(r: SnapRect, ctx: SnapContext, a: Axis): number | null {
  if (!(ctx.tol > 0)) return null;
  let best: { v: number; d: number } | null = null;
  const consider = (v: number, prefer: boolean) => {
    const d = Math.abs(v - start(r, a));
    if (d > ctx.tol + 1e-9) return;
    // Alignment wins a tie with an equal-gap candidate.
    if (!best || d < best.d - 1e-9 || (prefer && Math.abs(d - best.d) <= 1e-9)) best = { v, d };
  };
  const offs = [0, size(r, a) / 2, size(r, a)];
  for (const t of targets(ctx, a)) for (const off of offs) consider(t - off, true);
  const { before, after } = neighbours(r, ctx.others, a, ctx.tol);
  if (before && after) consider((end(before, a) + start(after, a) - size(r, a)) / 2, false);
  for (const { g } of existingGaps(ctx.others, a)) {
    if (before) consider(end(before, a) + g, false);
    if (after) consider(start(after, a) - g - size(r, a), false);
  }
  return best ? (best as { v: number }).v : null;
}

/**
 * Snap a rect being DRAGGED. `axes` limits which axes may move (a full-width
 * bar only moves up / down). Returns the snapped rect and what to draw.
 */
export function snapMove(r: SnapRect, ctx: SnapContext, axes: { x?: boolean; y?: boolean } = {}): SnapResult {
  let rect = { ...r };
  for (const a of ['x', 'y'] as const) {
    if (axes[a] === false) continue;
    const v = snapAxis(rect, ctx, a);
    if (v !== null) rect = withStart(rect, a, v);
  }
  return { rect, ...describeAlignment(rect, ctx) };
}

/** Which edges a resize moves. */
export interface ResizeEdges { l?: boolean; r?: boolean; t?: boolean; b?: boolean }

/**
 * Snap a rect being RESIZED: the moving edge lands on a target line / another
 * rect's edge or centre, or the size matches another rect's width / height.
 * The opposite edge never moves.
 */
export function snapResize(r: SnapRect, edges: ResizeEdges, ctx: SnapContext): SnapResult {
  let l = r.x, rt = r.x + r.w, t = r.y, b = r.y + r.h;
  const pick = (moving: number, fixed: number, sign: 1 | -1, a: Axis): number => {
    let best: { v: number; d: number } | null = null;
    const consider = (v: number, prefer: boolean) => {
      const d = Math.abs(v - moving);
      if (d > ctx.tol + 1e-9) return;
      if (!best || d < best.d - 1e-9 || (prefer && Math.abs(d - best.d) <= 1e-9)) best = { v, d };
    };
    for (const tg of targets(ctx, a)) consider(tg, true);
    for (const o of ctx.others) consider(fixed + sign * size(o, a), false);
    return best ? (best as { v: number }).v : moving;
  };
  if (ctx.tol > 0) {
    if (edges.r && !edges.l) rt = pick(rt, l, 1, 'x');
    if (edges.l && !edges.r) l = pick(l, rt, -1, 'x');
    if (edges.b && !edges.t) b = pick(b, t, 1, 'y');
    if (edges.t && !edges.b) t = pick(t, b, -1, 'y');
  }
  const rect = { x: l, y: t, w: rt - l, h: b - t };
  const d = describeAlignment(rect, ctx);
  return { rect, lines: d.lines, measures: [...d.measures, ...sizeMatches(rect, ctx.others, edges)] };
}

/** Equal width / height marks (only for the dimension being resized). */
function sizeMatches(r: SnapRect, others: ReadonlyArray<SnapRect>, edges: ResizeEdges): Measure[] {
  const out: Measure[] = [];
  for (const a of ['x', 'y'] as const) {
    const moving = a === 'x' ? edges.l || edges.r : edges.t || edges.b;
    if (!moving) continue;
    const same = others.filter(o => Math.abs(size(o, a) - size(r, a)) <= ALIGN_EPS);
    if (!same.length) continue;
    for (const s of [r, ...same]) {
      out.push({ axis: a, from: start(s, a), to: end(s, a), at: start(s, other(a)), size: size(r, a), kind: 'size' });
    }
  }
  return out;
}

/**
 * Arrow-key NUDGE: a step that would carry an edge or centre ACROSS a target
 * (a static line or another rect's edge / centre) stops exactly on it; the
 * next step moves on. A rect already on a line is free to leave it.
 */
export function nudgeStop(r: SnapRect, dx: number, dy: number, ctx: SnapContext): SnapResult {
  let rect = { ...r };
  for (const [a, d] of [['x', dx], ['y', dy]] as const) {
    if (!d) continue;
    let best: number | null = null;
    for (const t of targets(ctx, a)) for (const p of anchors(rect, a)) {
      const q = p + d;
      const crosses = (p < t - 0.01 && q > t + 0.01) || (p > t + 0.01 && q < t - 0.01);
      if (crosses && (best === null || Math.abs(t - p) < Math.abs(best))) best = t - p;
    }
    rect = withStart(rect, a, start(rect, a) + (best ?? d));
  }
  return { rect, ...describeAlignment(rect, ctx) };
}

/**
 * Where a NEW rect of w × h should go so it lines up with what is already
 * there: beside / below an existing rect with its edges matched (left edges
 * below, top edges beside), `gap` apart, never overlapping, inside `bounds`.
 * First such spot in reading order (top-down, then left-right); null when
 * none fits (the caller falls back to its own free-spot scan).
 */
export function placeAligned(w: number, h: number, ctx: Pick<SnapContext, 'others' | 'bounds'>, gap: number): { x: number; y: number } | null {
  const B = ctx.bounds;
  const cands: Array<{ x: number; y: number }> = [];
  if (!ctx.others.length) cands.push({ x: B.x, y: B.y });
  for (const o of ctx.others) {
    cands.push(
      { x: o.x + o.w + gap, y: o.y },          // beside it, tops matched
      { x: o.x, y: o.y + o.h + gap },          // below it, left edges matched
      { x: o.x + o.w - w, y: o.y + o.h + gap }, // below it, right edges matched
    );
  }
  const fits = (c: { x: number; y: number }) =>
    c.x >= B.x - ALIGN_EPS && c.y >= B.y - ALIGN_EPS && c.x + w <= B.x + B.w + ALIGN_EPS && c.y + h <= B.y + B.h + ALIGN_EPS
    && !ctx.others.some(o => c.x < o.x + o.w + gap - ALIGN_EPS && c.x + w > o.x - gap + ALIGN_EPS
                          && c.y < o.y + o.h + gap - ALIGN_EPS && c.y + h > o.y - gap + ALIGN_EPS);
  const ok = cands.filter(fits).sort((p, q) => p.y - q.y || p.x - q.x);
  return ok[0] ?? null;
}

/**
 * The guides for a rect where it is NOW: every line its edges / centres share
 * with another rect (drawn from the topmost to the bottommost of the aligned
 * rects) or with a static line (drawn across `bounds`), plus equal-gap marks.
 */
export function describeAlignment(r: SnapRect, ctx: Pick<SnapContext, 'others' | 'lines' | 'bounds'>): SnapGuides {
  const lines: GuideSeg[] = [];
  for (const a of ['x', 'y'] as const) {
    const b = other(a);
    const axis = a === 'x' ? 'v' : 'h';
    const statics = (a === 'x' ? ctx.lines?.xs : ctx.lines?.ys) ?? [];
    const seen: number[] = [];
    for (const p of anchors(r, a)) {
      if (seen.some(s => Math.abs(s - p) <= ALIGN_EPS)) continue;
      const mates = ctx.others.filter(o => anchors(o, a).some(q => Math.abs(q - p) <= ALIGN_EPS));
      if (mates.length) {
        seen.push(p);
        const all = [r, ...mates];
        lines.push({ axis, pos: p, from: Math.min(...all.map(o => start(o, b))), to: Math.max(...all.map(o => end(o, b))) });
      } else if (statics.some(s => Math.abs(s - p) <= ALIGN_EPS)) {
        seen.push(p);
        lines.push({ axis, pos: p, from: start(ctx.bounds, b), to: end(ctx.bounds, b) });
      }
    }
  }
  return { lines, measures: equalGaps(r, ctx.others) };
}

/** Equal-spacing marks: the moving rect's gap to a neighbour matches the gap
 *  on its other side, or a gap two other rects already keep. */
function equalGaps(r: SnapRect, others: ReadonlyArray<SnapRect>): Measure[] {
  const out: Measure[] = [];
  const mark = (p: SnapRect, q: SnapRect, a: Axis, g: number): Measure => {
    const b = other(a);
    const lo = Math.max(start(p, b), start(q, b)), hi = Math.min(end(p, b), end(q, b));
    return { axis: a, from: end(p, a), to: start(q, a), at: (lo + hi) / 2, size: g, kind: 'gap' };
  };
  for (const a of ['x', 'y'] as const) {
    const { before, after } = neighbours(r, others, a, ALIGN_EPS);
    const gB = before ? start(r, a) - end(before, a) : null;
    const gA = after ? start(after, a) - end(r, a) : null;
    const found: Measure[] = [];
    const eq = (u: number, v: number) => Math.abs(u - v) <= ALIGN_EPS * 2;
    if (gB !== null && gA !== null && gB > ALIGN_EPS && eq(gB, gA)) {
      found.push(mark(before!, r, a, gB), mark(r, after!, a, gA));
    }
    for (const { p, q, g } of existingGaps(others, a)) {
      if (gB !== null && gB > ALIGN_EPS && eq(gB, g)) found.push(mark(before!, r, a, gB), mark(p, q, a, g));
      if (gA !== null && gA > ALIGN_EPS && eq(gA, g)) found.push(mark(r, after!, a, gA), mark(p, q, a, g));
    }
    for (const m of found) {
      if (!out.some(o => o.axis === m.axis && eq(o.from, m.from) && eq(o.to, m.to) && eq(o.at, m.at))) out.push(m);
    }
  }
  return out;
}
