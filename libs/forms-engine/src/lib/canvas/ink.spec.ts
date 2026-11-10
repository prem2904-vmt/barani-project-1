import { regionPath, strokePath } from './ink';

describe('ink', () => {
  it('a stroke becomes a closed, filled outline; a tap is a dot', () => {
    const d = strokePath({ size: 8, points: [0, 0, 0.5, 20, 10, 0.6, 40, 30, 0.8, 60, 30, 0.6] });
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(strokePath({ size: 8, points: [5, 5, 0.5] })).toContain('a4,4');
    expect(strokePath({ size: 8, points: [] })).toBe('');
  });

  it('pen pressure changes the line (thicker where pressed harder)', () => {
    const pts = (p: number) => [0, 0, p, 50, 0, p, 100, 0, p, 150, 0, p];
    expect(strokePath({ size: 10, pen: true, points: pts(0.1) })).not.toBe(strokePath({ size: 10, pen: true, points: pts(1) }));
  });

  it('regions as paths', () => {
    expect(regionPath({ type: 'poly', points: [0, 0, 10, 0, 10, 10] })).toBe('M0,0 L10,0 L10,10Z');
    expect(regionPath({ type: 'ellipse', cx: 10, cy: 10, rx: 5, ry: 3 })).toContain('a5,3');
  });
});
