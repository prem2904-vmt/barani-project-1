import { ICONS } from './icons';

describe('forms-engine icons', () => {
  it('every icon is stroked SVG path data (no emoji, no text)', () => {
    for (const [name, paths] of Object.entries(ICONS)) {
      expect(paths.length, name).toBeGreaterThan(0);
      for (const d of paths) expect(d, name).toMatch(/^M[\d\s.,MmLlHhVvCcSsQqTtAaZz-]+$/);
    }
  });
});
