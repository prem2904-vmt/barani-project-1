import { billPreDiscountGross, discountPctOf, fmtPct, percentDiscountAmount } from './discount';

const item = (price: number, cgstRate: number, sgstRate: number, igstRate = 0) =>
  ({ id: 'i', billId: 'b', testId: 't', testName: 'T', price, discount: 0, taxableAmount: price, taxSlab: cgstRate + sgstRate + igstRate,
     cgstRate, sgstRate, igstRate, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, total: 0 });

describe('percentDiscountAmount', () => {
  it('never resolves above the percent typed (owner bug: 17% of ₹3 became ₹1 = 33%)', () => {
    const amt = percentDiscountAmount(3, 17);
    expect(amt).toBe(0.51);
    expect(discountPctOf(amt, 3)).toBeLessThanOrEqual(17);
    for (const pct of [17, 20, 24, 25]) {
      expect(discountPctOf(percentDiscountAmount(3, pct), 3)).toBeLessThanOrEqual(pct);
    }
  });
  it('is exact on round figures', () => {
    expect(percentDiscountAmount(1180, 25)).toBe(295);
    expect(percentDiscountAmount(0.29 * 100, 1)).toBe(0.29);
  });
  it('rounds down to the paisa and clamps to the base', () => {
    expect(percentDiscountAmount(3.33, 25)).toBe(0.83);
    expect(percentDiscountAmount(50, 150)).toBe(50);
    expect(percentDiscountAmount(0, 10)).toBe(0);
    expect(percentDiscountAmount(100, 0)).toBe(0);
  });
});

describe('billPreDiscountGross', () => {
  it('uses full-price GST, not the post-discount totalTax', () => {
    // 1000 @ 18% billed with ₹100 off: totalTax 162, gross 1180.
    expect(billPreDiscountGross({ subTotal: 1000, totalTax: 162, items: [item(1000, 9, 9)] })).toBe(1180);
  });
  it('handles IGST and zero-rated lines', () => {
    expect(billPreDiscountGross({ subTotal: 700, totalTax: 0, items: [item(500, 0, 0, 18), item(200, 0, 0)] })).toBe(790);
  });
  it('falls back to subTotal + totalTax without items', () => {
    expect(billPreDiscountGross({ subTotal: 100, totalTax: 18, items: [] })).toBe(118);
    expect(billPreDiscountGross(null)).toBe(0);
  });
});

describe('fmtPct', () => {
  it('shows one decimal only when needed', () => {
    expect(fmtPct(25.169)).toBe('25.2%');
    expect(fmtPct(25)).toBe('25%');
  });
});
