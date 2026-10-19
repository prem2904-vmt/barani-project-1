import { clampRect, moveRect, resizeRect, computeOutputSize, centeredCrop, MIN_CROP } from './image-crop';

const B = { w: 200, h: 100 };

describe('clampRect', () => {
  it('keeps a rect inside the bounds', () => {
    expect(clampRect({ x: -10, y: -10, w: 50, h: 50 }, B)).toEqual({ x: 0, y: 0, w: 50, h: 50 });
    expect(clampRect({ x: 180, y: 90, w: 50, h: 50 }, B)).toEqual({ x: 150, y: 50, w: 50, h: 50 });
  });
  it('never exceeds the image size', () => {
    expect(clampRect({ x: 0, y: 0, w: 999, h: 999 }, B)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });
  it('enforces the minimum crop size', () => {
    expect(clampRect({ x: 0, y: 0, w: 2, h: 2 }, B)).toEqual({ x: 0, y: 0, w: MIN_CROP, h: MIN_CROP });
  });
});

describe('moveRect', () => {
  it('translates and clamps to the edge', () => {
    expect(moveRect({ x: 10, y: 10, w: 40, h: 40 }, 20, 20, B)).toEqual({ x: 30, y: 30, w: 40, h: 40 });
    expect(moveRect({ x: 180, y: 80, w: 40, h: 40 }, 100, 100, B)).toEqual({ x: 160, y: 60, w: 40, h: 40 });
  });
});

describe('resizeRect', () => {
  it('grows from the SE corner', () => {
    expect(resizeRect({ x: 20, y: 20, w: 40, h: 40 }, 'se', 10, 10, B)).toEqual({ x: 20, y: 20, w: 50, h: 50 });
  });
  it('grows from the NW corner (moves origin, keeps opposite corner)', () => {
    expect(resizeRect({ x: 50, y: 50, w: 40, h: 40 }, 'nw', -10, -10, B)).toEqual({ x: 40, y: 40, w: 50, h: 50 });
  });
  it('does not invert past the minimum on a NW drag', () => {
    // Drag NW far past the SE corner — origin pins so the box stays MIN at the anchor.
    const r = resizeRect({ x: 50, y: 50, w: 40, h: 40 }, 'nw', 100, 100, B);
    expect(r.w).toBe(MIN_CROP);
    expect(r.h).toBe(MIN_CROP);
    expect(r.x).toBe(50 + 40 - MIN_CROP);
    expect(r.y).toBe(50 + 40 - MIN_CROP);
  });
});

describe('computeOutputSize', () => {
  it('keeps crop size when no target given', () => {
    expect(computeOutputSize(400, 200, null)).toEqual({ w: 400, h: 200 });
  });
  it('downscales preserving aspect ratio', () => {
    expect(computeOutputSize(400, 200, 200)).toEqual({ w: 200, h: 100 });
  });
  it('never upscales beyond the crop resolution', () => {
    expect(computeOutputSize(300, 150, 900)).toEqual({ w: 300, h: 150 });
  });
});

describe('centeredCrop', () => {
  it('returns the full image for a free aspect', () => {
    expect(centeredCrop(B, null)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });
  it('centres a square crop inside a wide image', () => {
    // square must fit height (100) → 100x100 centred horizontally
    expect(centeredCrop(B, 1)).toEqual({ x: 50, y: 0, w: 100, h: 100 });
  });
});
