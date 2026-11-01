import { MEASURE_PAD_MM, measureStationery } from './report-background-measure';
import { stationery } from './report-background-measure.spec-helpers';

/**
 * Auto-measure for pre-printed stationery (plan §3.8): the lowest printed row in
 * the top 40 percent and the highest printed row in the bottom 25 percent become
 * "blank at the top / bottom" in mm (plus a small margin).
 */
describe('measureStationery', () => {
  // ink ends 40 mm from the top; the footer artwork starts 26 mm from the bottom edge (271 mm from the top)
  const SHEET = { bands: [[8, 40], [271, 289]] as Array<[number, number]> };

  it(`finds 42 mm at the top and 28 mm at the bottom (ink + ${MEASURE_PAD_MM} mm) on a synthetic letterhead`, () => {
    const m = measureStationery(stationery(SHEET));
    expect(m.headerMm).toBe(42);
    expect(m.footerMm).toBe(28);
  });

  it('is not fooled by cream paper and scanner noise', () => {
    const m = measureStationery(stationery({ ...SHEET, paper: [244, 236, 214], noise: 14 }));
    expect(m.headerMm).toBe(42);
    expect(m.footerMm).toBe(28);
    expect(m.paper[0]).toBeGreaterThan(236);
  });

  it('ignores dust specks', () => {
    const m = measureStationery(stationery({ ...SHEET, specks: 60 }));
    expect(m.headerMm).toBe(42);
    expect(m.footerMm).toBe(28);
  });

  it('ignores tall side borders that run the whole sheet', () => {
    const m = measureStationery(stationery({ ...SHEET, sideRules: [6, 204] }));
    expect(m.headerMm).toBe(42);
    expect(m.footerMm).toBe(28);
  });

  it('a letterhead only at the top leaves the bottom unmeasured', () => {
    const m = measureStationery(stationery({ bands: [[10, 55]] }));
    expect(m.headerMm).toBe(57);
    expect(m.footerMm).toBeNull();
  });

  it('a blank sheet has nothing to measure', () => {
    const m = measureStationery(stationery());
    expect(m.headerMm).toBeNull();
    expect(m.footerMm).toBeNull();
  });

  it('only looks in the top 40 percent / bottom 25 percent (a middle watermark is left alone)', () => {
    const m = measureStationery(stationery({ bands: [[10, 30], [140, 160]] }));
    expect(m.headerMm).toBe(32);
    expect(m.footerMm).toBeNull();
  });

  it('is measured the way the page will show it (stretch maps the image height onto 297 mm)', () => {
    const m = measureStationery(stationery({ ...SHEET, widthMm: 210, heightMm: 280 }), 'stretch');
    expect(m.headerMm).toBe(Math.round(40 * 297 / 280 + MEASURE_PAD_MM));
  });

  it('tiny or empty images are refused quietly', () => {
    expect(measureStationery({ data: new Uint8ClampedArray(16), width: 2, height: 2 }).headerMm).toBeNull();
  });
});
