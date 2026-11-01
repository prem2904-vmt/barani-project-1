import { autofitColumns } from './report-autofit-columns';

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

describe('autofitColumns', () => {
  it('Σmax fits: every column gets its max, the slack is shared by configured weight', () => {
    const w = autofitColumns([{ pref: 30, min: 20, max: 60 }, { pref: 10, min: 10, max: 30 }], 200);
    expect(sum(w)).toBeCloseTo(200, 6);
    expect(w[0]).toBeCloseTo(60 + 110 * 0.75, 6);
    expect(w[1]).toBeCloseTo(30 + 110 * 0.25, 6);
  });

  it('Σmax does not fit: min plus a share of the remainder in proportion to (max − min)', () => {
    const w = autofitColumns([{ pref: 1, min: 20, max: 220 }, { pref: 1, min: 20, max: 60 }], 150);
    // room = 110; gains 200 and 40
    expect(w[0]).toBeCloseTo(20 + 110 * (200 / 240), 6);
    expect(w[1]).toBeCloseTo(20 + 110 * (40 / 240), 6);
    expect(sum(w)).toBeCloseTo(150, 6);
  });

  it('a long-name column gets the room, and no column drops below its min while Σmin fits', () => {
    const cols = [
      { pref: 36, min: 60, max: 300 },   // parameter names
      { pref: 18, min: 40, max: 50 },    // result (min = max: never wraps)
      { pref: 12, min: 30, max: 40 },
      { pref: 34, min: 50, max: 90 },
    ];
    const w = autofitColumns(cols, 380);
    w.forEach((x, i) => expect(x).toBeGreaterThanOrEqual(cols[i].min - 1e-6));
    expect(w[0]).toBeGreaterThan(w[3]);
    expect(sum(w)).toBeCloseTo(380, 6);
  });

  it('Σmin does not fit: the mins scale down evenly (the caller keeps wrapping)', () => {
    const w = autofitColumns([{ pref: 1, min: 100, max: 100 }, { pref: 1, min: 100, max: 100 }], 100);
    expect(w).toEqual([50, 50]);
  });

  it('empty and degenerate input', () => {
    expect(autofitColumns([], 100)).toEqual([]);
    const w = autofitColumns([{ pref: 0, min: 10, max: 5 }], 100);   // max < min is lifted to min
    expect(w[0]).toBeCloseTo(100, 6);
  });
});
