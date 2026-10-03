import { chromeInsets } from './consult-records';
import { fitChips } from './vitals-strip.component';

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });

describe('Consult layout — beside the real app nav', () => {
  it('a bottom bar reserves its full height from its top edge (safe area included)', () => {
    expect(chromeInsets([rect(0, 900 - 91, 1440, 91)], 1440, 900)).toEqual({ bottom: 91, left: 0 });
  });
  it('a floating pill reserves its height plus the gap under it', () => {
    expect(chromeInsets([rect(400, 900 - 16 - 56, 640, 56)], 1440, 900)).toEqual({ bottom: 72, left: 0 });
  });
  it('a left rail (iPad) reserves its width; a hidden / top element reserves nothing', () => {
    expect(chromeInsets([rect(8, 0, 60, 1024)], 1366, 1024)).toEqual({ bottom: 0, left: 68 });
    expect(chromeInsets([rect(0, 0, 1440, 64), rect(0, 0, 0, 0)], 1440, 900)).toEqual({ bottom: 0, left: 0 });
  });
});

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
