import { fitChips } from './vitals-strip.component';

describe('Vitals chips — whole chips only', () => {
  it('all fit → all show', () => {
    expect(fitChips([100, 80, 90], 300, 8)).toBe(3);
  });
  it('otherwise the trailing chips fold into "+N" and the +N chip always has room', () => {
    // 100 + 8 + 80 = 188; + 8 + 48 (the +N) = 244 ≤ 260 → 2 shown; a 3rd would need 196 + 90 > room.
    expect(fitChips([100, 80, 90, 70], 260, 8, 48)).toBe(2);
    expect(fitChips([200, 80], 150, 8, 48)).toBe(0);
  });
});
