import {
  describeAlignment, nudgeStop, placeAligned, snapMove, snapResize, snappingOn, tolFromPx,
  type SnapContext, type SnapRect,
} from './layout-snap';

/**
 * Smart guides (owner 2026-11-01): ONE pure snapping engine for the profile
 * Custom layout designer AND the report letterhead / footer editor.
 */
const BOUNDS: SnapRect = { x: 0, y: 0, w: 200, h: 280 };
const r = (x: number, y: number, w: number, h: number): SnapRect => ({ x, y, w, h });
const ctx = (others: SnapRect[], tol = 2, lines: SnapContext['lines'] = { xs: [0, 100, 200], ys: [0, 280] }): SnapContext =>
  ({ others, lines, bounds: BOUNDS, tol });
const v = (res: { lines: Array<{ axis: string; pos: number }> }) => res.lines.filter(l => l.axis === 'v').map(l => l.pos);
const h = (res: { lines: Array<{ axis: string; pos: number }> }) => res.lines.filter(l => l.axis === 'h').map(l => l.pos);

describe('layout-snap — tolerance is a screen distance', () => {
  it('~6 px at the current zoom, in the caller\'s unit', () => {
    expect(tolFromPx(3)).toBe(2);          // 3 px per mm → 2 mm
    expect(tolFromPx(1.5, 6)).toBe(4);     // zoomed out: a wider reach in mm
    expect(tolFromPx(0)).toBe(0);
  });
  it('snaps within the tolerance, never beyond it', () => {
    const img = r(10, 10, 40, 30);
    expect(snapMove(r(51.5, 100, 20, 20), ctx([img], tolFromPx(4))).rect.x).toBe(50);   // 1.5 ≤ 6/4
    expect(snapMove(r(51.7, 100, 20, 20), ctx([img], tolFromPx(4))).rect.x).toBe(51.7); // 1.7 > 1.5
  });
});

describe('layout-snap — edges and centres, both axes', () => {
  const img = r(20, 20, 60, 40); // an image box: left 20, centre 50, right 80; top 20, middle 40, bottom 60

  it('left edge to the image\'s left edge, with a guide drawn only between the two', () => {
    const res = snapMove(r(21.2, 120, 30, 20), ctx([img]));
    expect(res.rect.x).toBe(20);
    const g = res.lines.find(l => l.axis === 'v' && l.pos === 20)!;
    expect(g.from).toBe(20);   // top of the image
    expect(g.to).toBe(140);    // bottom of the moving box — not the whole page
  });
  it('left edge to the image\'s right edge (side by side)', () => {
    expect(snapMove(r(81, 130, 30, 20), ctx([img])).rect.x).toBe(80);
  });
  it('centre to the image\'s centre', () => {
    const res = snapMove(r(36, 120, 30, 20), ctx([img]));   // centre 51 → 50
    expect(res.rect.x).toBe(35);
    expect(v(res)).toContain(50);
  });
  it('tops / middles / bottoms snap on the y axis with a horizontal guide', () => {
    const res = snapMove(r(120, 21.5, 30, 20), ctx([img]));
    expect(res.rect.y).toBe(20);
    const g = res.lines.find(l => l.axis === 'h' && l.pos === 20)!;
    expect([g.from, g.to]).toEqual([20, 150]);
  });
  it('both axes at once', () => {
    const res = snapMove(r(81.4, 59, 30, 20), ctx([img]));
    expect(res.rect).toEqual({ x: 80, y: 60, w: 30, h: 20 });
    expect(v(res)).toContain(80);
    expect(h(res)).toContain(60);
  });
  it('static lines (margins / centre) still snap and span the whole bounds', () => {
    const res = snapMove(r(1.5, 200, 30, 20), ctx([]));
    expect(res.rect.x).toBe(0);
    expect(res.lines).toContainEqual({ axis: 'v', pos: 0, from: 0, to: 280 });
  });
  it('a locked axis never moves (a full-width bar only moves up / down)', () => {
    const res = snapMove(r(81, 59, 30, 20), ctx([img]), { x: false });
    expect(res.rect.x).toBe(81);
    expect(res.rect.y).toBe(60);
  });
  it('the nearest target wins', () => {
    const res = snapMove(r(79, 120, 30, 20), ctx([img, r(78.2, 200, 10, 10)]));
    expect(res.rect.x).toBe(78.2);
  });
});

describe('layout-snap — Alt (Option) turns snapping off', () => {
  it('snappingOn reads the modifier', () => {
    expect(snappingOn({ altKey: false })).toBe(true);
    expect(snappingOn({ altKey: true })).toBe(false);
    expect(snappingOn(null)).toBe(true);
  });
  it('a zero tolerance (how a caller turns it off) never moves the rect', () => {
    expect(snapMove(r(21.2, 120, 30, 20), ctx([r(20, 20, 60, 40)], 0)).rect.x).toBe(21.2);
  });
});

describe('layout-snap — equal spacing', () => {
  it('centres a box between two neighbours and marks both gaps', () => {
    const a = r(0, 0, 40, 30), c = r(140, 0, 40, 30);
    const res = snapMove(r(71, 0, 40, 30), ctx([a, c], 2, {}));   // equal at 70
    expect(res.rect.x).toBe(70);
    const gaps = res.measures.filter(m => m.kind === 'gap');
    expect(gaps).toHaveLength(2);
    expect(gaps.every(m => m.size === 30)).toBe(true);
    expect(gaps.map(m => [m.from, m.to])).toEqual([[40, 70], [110, 140]]);
  });
  it('repeats the gap two other boxes already keep', () => {
    const a = r(0, 0, 30, 20), b = r(40, 0, 30, 20);              // gap 10
    const res = snapMove(r(81.5, 0, 30, 20), ctx([a, b], 2, {}));  // → 80, gap 10 to b
    expect(res.rect.x).toBe(80);
    expect(res.measures.filter(m => m.kind === 'gap').map(m => m.size)).toEqual([10, 10]);
  });
  it('vertical rhythm too (a column of images)', () => {
    const a = r(0, 0, 30, 20), b = r(0, 26, 30, 20);              // gap 6
    const res = snapMove(r(0, 51, 30, 20), ctx([a, b], 2, {}));    // → 52 (6 under b)
    expect(res.rect.y).toBe(52);
    expect(res.measures.some(m => m.axis === 'y' && m.size === 6)).toBe(true);
  });
  it('no marks when the gaps differ', () => {
    const res = describeAlignment(r(50, 0, 10, 10), { others: [r(0, 0, 30, 10), r(90, 0, 10, 10)], bounds: BOUNDS });
    expect(res.measures).toEqual([]);
  });
});

describe('layout-snap — resize', () => {
  it('the moving edge snaps to another box\'s edge; the opposite edge stays', () => {
    const res = snapResize(r(10, 100, 69, 20), { r: true }, ctx([r(20, 20, 60, 40)]));
    expect(res.rect).toEqual({ x: 10, y: 100, w: 70, h: 20 });
  });
  it('matches another box\'s width (same-size mark on both)', () => {
    const img = r(120, 10, 50, 40);
    const res = snapResize(r(10, 100, 48.8, 20), { r: true }, ctx([img], 2, {}));
    expect(res.rect.w).toBe(50);
    const sizes = res.measures.filter(m => m.kind === 'size');
    expect(sizes.map(m => m.size)).toEqual([50, 50]);
  });
  it('matches height from the top handle', () => {
    const res = snapResize(r(10, 61, 30, 39), { t: true }, ctx([r(120, 10, 50, 40)], 2, {}));
    expect(res.rect).toEqual({ x: 10, y: 60, w: 30, h: 40 });
  });
});

describe('layout-snap — arrow-key nudge stops on another box', () => {
  const img = r(50, 0, 30, 30);
  it('a step that would carry the right edge past the image\'s left edge stops on it', () => {
    const res = nudgeStop(r(10, 100, 39, 10), 5, 0, ctx([img]));  // right 49 → would be 54, image left 50
    expect(res.rect.x).toBe(11);
    expect(v(res)).toContain(50);
  });
  it('from ON the line, the next step moves on', () => {
    expect(nudgeStop(r(11, 100, 39, 10), 5, 0, ctx([img])).rect.x).toBe(16);
  });
  it('vertical steps stop on edges too', () => {
    expect(nudgeStop(r(100, 32, 10, 10), 0, -5, ctx([img])).rect.y).toBe(30);
  });
  it('a free step with nothing in the way moves the full step', () => {
    expect(nudgeStop(r(110, 100, 10, 10), 1, 0, ctx([img], 2, {})).rect.x).toBe(111);
  });
});

describe('layout-snap — a new box lands lined up', () => {
  it('empty page: the top-left', () => {
    expect(placeAligned(40, 30, { others: [], bounds: BOUNDS }, 4)).toEqual({ x: 0, y: 0 });
  });
  it('beside the first box with tops matched when it fits', () => {
    expect(placeAligned(40, 30, { others: [r(0, 0, 100, 80)], bounds: BOUNDS }, 4)).toEqual({ x: 104, y: 0 });
  });
  it('under a box with left edges matched when the side is taken', () => {
    const table = r(0, 0, 120, 80), img = r(124, 0, 76, 50);
    const p = placeAligned(76, 40, { others: [table, img], bounds: BOUNDS }, 4)!;
    expect(p).toEqual({ x: 124, y: 54 });                          // under the image, its left edge
    expect(describeAlignment({ ...p, w: 76, h: 40 }, { others: [table, img], bounds: BOUNDS }).lines
      .some(l => l.axis === 'v' && l.pos === 124)).toBe(true);
  });
  it('null when nothing fits (the caller scans for a free spot)', () => {
    expect(placeAligned(300, 30, { others: [], bounds: BOUNDS }, 4)).toBeNull();
  });
});
