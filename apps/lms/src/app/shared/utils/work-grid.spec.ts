import { TOUCH_GAP_PX, TOUCH_TARGET_PX, fitFold, minWidthOf, gridFold, rowActionSizing, touchViolations, waitText } from './work-grid';

const box = (left: number, width: number, height = 44, top = 0, name?: string) => ({ left, right: left + width, top, bottom: top + height, name });

describe('work grids — the touch sizing rule (owner 2026-11-20: "touch devices get more room for taps")', () => {
  it('targets are 44px and neighbours 8px apart', () => {
    expect(TOUCH_TARGET_PX).toBe(44);
    expect(TOUCH_GAP_PX).toBe(8);
    expect(rowActionSizing(true)).toEqual({ minSize: 44, gap: 8 });
    expect(rowActionSizing(false).gap).toBe(8);   // web keeps the same room between buttons, smaller faces
    expect(rowActionSizing(false).minSize).toBeLessThan(44);
  });

  it('a 44×44 primary + a 44×44 ⋯ 8px apart passes', () => {
    expect(touchViolations([box(0, 120, 44, 0, 'Enter results'), box(128, 44, 44, 0, 'More')])).toEqual([]);
  });

  it('a control under 44 in either direction fails', () => {
    expect(touchViolations([box(0, 36, 44, 0, 'More')])).toEqual(['More is 36×44']);
    expect(touchViolations([box(0, 100, 36, 0, 'Review')])).toEqual(['Review is 100×36']);
  });

  it('two controls closer than 8px on the same line fail; on different lines they do not', () => {
    expect(touchViolations([box(0, 100, 44, 0, 'A'), box(104, 44, 44, 0, 'B')])).toEqual(['A → B: 4px apart']);
    expect(touchViolations([box(0, 100, 44, 0, 'A'), box(104, 44, 44, 60, 'B')])).toEqual([]);
  });
});

describe('work grids — columns fold by the grid width', () => {
  it('full ≥ 1040, fold ≥ 700, tight below (defaults); thresholds are per screen', () => {
    expect(gridFold(1200)).toBe('full');
    expect(gridFold(1040)).toBe('full');
    expect(gridFold(860)).toBe('fold');
    expect(gridFold(699)).toBe('tight');
    expect(gridFold(905, 900, 620)).toBe('full');
    expect(gridFold(640, 900, 620)).toBe('fold');
  });
});

describe('work grids — the tier that fits (never clip the actions)', () => {
  const plan = (hideB: boolean) => [{ colId: 'a', hide: false }, { colId: 'b', hide: hideB }, { colId: 'acts', hide: false }];
  const mins = { a: 300, b: 400, acts: 220 };
  const need = (f: 'full' | 'fold' | 'tight') => minWidthOf(plan(f !== 'full'), mins) + (f === 'tight' ? -100 : 0);
  it('sums only the visible columns', () => {
    expect(minWidthOf(plan(false), mins)).toBe(920);
    expect(minWidthOf(plan(true), mins)).toBe(520);
  });
  it('full only when every full column fits; then fold; else tight', () => {
    expect(fitFold(940, need)).toBe('full');
    expect(fitFold(920, need)).toBe('fold');   // 920 + 20 slack (the scrollbar) does not fit
    expect(fitFold(540, need)).toBe('fold');
    expect(fitFold(500, need)).toBe('tight');
  });
});

describe('work grids — waiting text', () => {
  const now = Date.parse('2026-11-20T10:00:00Z');
  it('minutes / hours since a time; empty when unknown', () => {
    expect(waitText('2026-11-20T09:20:00Z', now)).toBe('40m');
    expect(waitText('2026-11-20T07:55:00Z', now)).toBe('2h 5m');
    expect(waitText(null, now)).toBe('');
    expect(waitText('not a date', now)).toBe('');
  });
});
