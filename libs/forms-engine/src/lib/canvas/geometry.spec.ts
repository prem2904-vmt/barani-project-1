import { CanvasRegion, InkStroke } from './canvas-model';
import {
  clampView,
  fitView,
  hitRegion,
  hitRegionNear,
  pinAt,
  pointInPolygon,
  rasterSize,
  strokesUnder,
  toPicture,
  toScreen,
  zoomAt,
} from './geometry';

const square = [0, 0, 100, 0, 100, 100, 0, 100];
const regions: CanvasRegion[] = [
  { key: 'big', label: 'Big', shape: { type: 'poly', points: square } },
  { key: 'small', label: 'Small', shape: { type: 'ellipse', cx: 50, cy: 50, rx: 10, ry: 10 } },
  { key: 'right', label: 'Right', shape: { type: 'poly', points: [200, 0, 300, 0, 300, 100, 200, 100] } },
];

describe('canvas geometry', () => {
  it('point in polygon', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 50 }, square)).toBe(false);
    expect(pointInPolygon({ x: 50, y: 50 }, [0, 0, 100, 0, 50, 40])).toBe(false);
  });

  it('region hit-testing: the smallest region under the point wins (pupil inside iris)', () => {
    expect(hitRegion(regions, { x: 50, y: 50 })?.key).toBe('small');
    expect(hitRegion(regions, { x: 10, y: 10 })?.key).toBe('big');
    expect(hitRegion(regions, { x: 250, y: 50 })?.key).toBe('right');
    expect(hitRegion(regions, { x: 150, y: 50 })).toBeNull();
  });

  it('a tap just outside a region still finds it within the finger slop', () => {
    expect(hitRegionNear(regions, { x: 195, y: 50 }, 10)?.key).toBe('right');
    expect(hitRegionNear(regions, { x: 150, y: 50 }, 10)).toBeNull();
  });

  it('the eraser finds strokes it crosses, including between samples', () => {
    const s = (id: string, pts: number[]): InkStroke => ({ id, color: 'ink', size: 4, points: pts });
    const strokes = [s('a', [0, 50, 0.5, 100, 50, 0.5]), s('b', [0, 200, 0.5, 100, 200, 0.5]), s('dot', [300, 300, 0.5])];
    expect([...strokesUnder(strokes, { x: 50, y: 0 }, { x: 50, y: 100 }, 5)]).toEqual(['a']);
    expect([...strokesUnder(strokes, { x: 300, y: 302 }, { x: 300, y: 302 }, 5)]).toEqual(['dot']);
    expect(strokesUnder(strokes, { x: 400, y: 0 }, { x: 400, y: 100 }, 5).size).toBe(0);
  });

  it('pins are found within their radius', () => {
    const pins = [{ id: 'p', x: 10, y: 10, n: 1 }];
    expect(pinAt(pins, { x: 14, y: 12 }, 8)?.id).toBe('p');
    expect(pinAt(pins, { x: 40, y: 40 }, 8)).toBeNull();
  });

  it('fit, zoom around a point, clamp, and screen ↔ picture', () => {
    const fit = fitView(1000, 500, 500, 500);
    expect(fit).toEqual({ scale: 0.5, x: 0, y: 125 });
    const p = toPicture(fit, 250, 250);
    expect(p).toEqual({ x: 500, y: 250 });
    const z = zoomAt(fit, 2, 250, 250, fit);
    expect(z.scale).toBe(1);
    expect(toPicture(z, 250, 250)).toEqual(p); // the point under the fingers stays put
    expect(zoomAt(fit, 0.1, 0, 0, fit).scale).toBe(0.5); // never smaller than fit
    expect(zoomAt(fit, 1000, 0, 0, fit).scale).toBe(3); // MAX_ZOOM × fit
    const c = clampView({ scale: 1, x: 400, y: 0 }, 1000, 500, 500, 500);
    expect(c.x).toBe(0);
    expect(toScreen(fit, 500, 250)).toEqual({ x: 250, y: 250 });
  });

  it('DPR: the raster export is sharp on retina and capped', () => {
    expect(rasterSize(400, 300, 1)).toEqual({ w: 400, h: 300, k: 1 });
    expect(rasterSize(400, 300, 2)).toEqual({ w: 800, h: 600, k: 2 });
    expect(rasterSize(400, 300, 3)).toEqual({ w: 1200, h: 900, k: 3 });
    expect(rasterSize(1500, 1000, 3).w).toBe(2048);
    expect(rasterSize(400, 300, NaN)).toEqual({ w: 400, h: 300, k: 1 });
  });
});
