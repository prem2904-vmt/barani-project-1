import { PEEK_W, peekPlacement } from './peek-placement';

describe('peekPlacement — the peek popover sits next to the pointer', () => {
  it('goes to the right of the pointer, slightly above it', () => {
    expect(peekPlacement(400, 500, 1440, 900)).toEqual({ x: 416, y: 476 });
  });
  it('flips to the left when there is no room on the right', () => {
    const p = peekPlacement(1300, 500, 1440, 900);
    expect(p.x).toBe(1300 - PEEK_W - 16);
    expect(p.x + PEEK_W).toBeLessThan(1300);
  });
  it('stays inside the viewport near the edges (phones)', () => {
    const p = peekPlacement(60, 820, 390, 844);
    expect(p.x).toBeGreaterThanOrEqual(8);
    expect(p.x + PEEK_W).toBeLessThanOrEqual(390 - 8);
    expect(p.y).toBeGreaterThanOrEqual(8);
    expect(p.y).toBeLessThanOrEqual(844 - 260 - 8);
    expect(peekPlacement(200, 2, 1440, 900).y).toBe(8);
  });
  it('is always close to the pointer when there is room', () => {
    for (const [px, py] of [[300, 300], [900, 450], [1200, 200]]) {
      const p = peekPlacement(px, py, 1440, 900);
      const dx = Math.max(p.x - px, 0, px - (p.x + PEEK_W));
      const dy = Math.max(p.y - py, 0, py - (p.y + 260));
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(80);
    }
  });
});
