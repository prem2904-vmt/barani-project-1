import { billRoundOff, computeBill, maxDiscountWithinPaid, previewBillForDiscount, roundRupee, splitDiscountPaise } from './bill-math';
import type { Bill } from '../models/bill.model';

/**
 * Pinned to the SERVER's numbers (Prefrontal.Tests/BillMathTests.cs +
 * BillingFinanceTests): the cart and the counter must show exactly what the
 * invoice will be. Discount comes off the TAXABLE value; GST on the rest.
 */
describe('computeBill (mirror of BillingService / BillMath)', () => {
  it('takes the discount off before GST: ₹1000 @18% − ₹295 = 705 + 126.90 = ₹831.90 (not 1180 − 295 = 885)', () => {
    const t = computeBill([{ price: 1000, slab: 18 }], 295);
    expect(t.subTotal).toBe(1000);
    expect(t.discount).toBe(295);
    expect(t.taxable).toBe(705);
    expect(t.cgst).toBe(63.45);
    expect(t.sgst).toBe(63.45);
    expect(t.tax).toBe(126.9);
    // Round-off (owner rule): 831.90 → ₹832, the +0.10 its own row.
    expect(t.payable).toBe(832);
    expect(t.roundOff).toBe(0.1);
    expect(t.gross).toBe(1180);
  });

  it('no discount: payable == gross rounded to the rupee (1442.50 → 1443); gross stays exact', () => {
    const t = computeBill([{ price: 1000, slab: 18 }, { price: 250, slab: 5 }], 0);
    expect(t.payable).toBe(1443);
    expect(t.roundOff).toBe(0.5);
    expect(t.gross).toBe(1442.5);
  });

  it('splits in whole paise so shares sum to the discount', () => {
    const t = computeBill([{ price: 500, slab: 18 }, { price: 500, slab: 18 }, { price: 500, slab: 18 }], 100);
    expect(t.lines.map(l => l.share)).toEqual([33.34, 33.33, 33.33]);
    expect(t.taxable).toBe(1400);
    expect(t.discount).toBe(100);
  });

  it('never discounts a unit below zero — the excess moves to the others', () => {
    const t = computeBill([{ price: 1000, slab: 0 }, { price: 50, slab: 0 }], 262);
    expect(t.lines.map(l => l.share)).toEqual([212, 50]);
    expect(t.payable).toBe(788);
  });

  it('caps the discount at the subtotal', () => {
    const t = computeBill([{ price: 1000, slab: 18 }], 5000);
    expect(t.discount).toBe(1000);
    expect(t.payable).toBe(0);
  });

  it('GST off (zero slab): payable = subtotal − discount, unchanged behaviour', () => {
    const t = computeBill([{ price: 1000, slab: 0 }], 295);
    expect(t.tax).toBe(0);
    expect(t.payable).toBe(705);
    expect(t.gross).toBe(1000);
  });

  it('interstate uses IGST', () => {
    const t = computeBill([{ price: 1000, slab: 18 }], 295, true);
    expect(t.cgst + t.sgst).toBe(0);
    expect(t.igst).toBe(126.9);
    expect(t.payable).toBe(832);
  });

  it('mixed slabs with odd paise — same figures as the server test', () => {
    const t = computeBill([{ price: 600, slab: 18 }, { price: 350, slab: 5 }, { price: 199, slab: 12 }], 250.55);
    expect(t.lines.map(l => l.share)).toEqual([83.52, 83.52, 83.51]);
    expect(t.taxable).toBe(898.45);
    expect(t.tax).toBe(120.14);
    expect(t.payable).toBe(1019);
    expect(t.roundOff).toBe(0.41);
    expect(t.gross).toBe(1298.38);
  });

  it('odd paise go to the dearest unit whatever the line order', () => {
    expect(splitDiscountPaise([{ price: 300, slab: 18 }, { price: 100, slab: 5 }], 0.05)).toEqual([3, 2]);
    expect(splitDiscountPaise([{ price: 100, slab: 5 }, { price: 300, slab: 18 }], 0.05)).toEqual([2, 3]);
    const a = computeBill([{ price: 100, slab: 5 }, { price: 300, slab: 18 }], 0.05);
    const b = computeBill([{ price: 300, slab: 18 }, { price: 100, slab: 5 }], 0.05);
    expect(a.payable).toBe(b.payable);
  });
});

describe('previewBillForDiscount (the counter: what /discount will make the bill)', () => {
  const bill = (over: Partial<Bill> = {}): Bill => ({
    id: 'b', orderId: 'o', patientId: 'p', branchId: 'x', type: 'tax_invoice', isInterstate: false,
    subTotal: 1000, overrideDiscount: 0, totalDiscount: 0, totalTaxable: 1000, totalCgst: 90, totalSgst: 90, totalIgst: 0,
    totalTax: 180, totalPayable: 1180, totalPaid: 0, balance: 1180, status: 'pending', createdAt: '',
    items: [{ id: 'i', billId: 'b', testId: 't', testName: 'T', price: 1000, discount: 0, taxableAmount: 1000, taxSlab: 18,
      cgstRate: 9, sgstRate: 9, igstRate: 0, cgstAmount: 90, sgstAmount: 90, igstAmount: 0, total: 1180 }],
    ...over,
  } as Bill);

  it('re-splits the bill lines at their billed rates: 1180 bill − ₹295 → ₹832 (831.90 rounded; server ApplyDiscount)', () => {
    const t = previewBillForDiscount(bill(), 295)!;
    expect(t.payable).toBe(832);
    expect(t.roundOff).toBe(0.1);
    expect(t.tax).toBe(126.9);
  });

  it('a Bill of Supply line (0 rates) stays untaxed', () => {
    const b = bill({ items: [{ ...bill().items[0], cgstRate: 0, sgstRate: 0, cgstAmount: 0, sgstAmount: 0, total: 1000 }] });
    expect(previewBillForDiscount(b, 295)!.payable).toBe(705);
  });

  it('no bill → null', () => {
    expect(previewBillForDiscount(null, 10)).toBeNull();
  });

  it('max discount on a part-paid bill keeps the payable ≥ what is paid (server discount_exceeds_balance)', () => {
    // ₹1000 paid on the 1180 bill: ₹152.96 off → exact 999.50 → ₹1000 (allowed); 152.97 → 999.49 → ₹999.
    expect(maxDiscountWithinPaid(bill(), 1000)).toBe(152.96);
    expect(previewBillForDiscount(bill(), 152.96)!.payable).toBe(1000);
    expect(previewBillForDiscount(bill(), 152.97)!.payable).toBe(999);
    // Nothing paid → the whole subtotal.
    expect(maxDiscountWithinPaid(bill(), 0)).toBe(1000);
  });
});

describe('round-off (owner rule — pinned with BillMathTests.RoundRupee)', () => {
  it.each([
    [831.9, 832, 0.1], [831.4, 831, -0.4], [831.49, 831, -0.49], [831.5, 832, 0.5], [831.51, 832, 0.49],
    [831.01, 831, -0.01], [831.99, 832, 0.01], [832, 832, 0], [0.49, 0, -0.49], [0.5, 1, 0.5], [0, 0, 0],
  ])('%s → %s (round-off %s)', (exact, rounded, off) => {
    expect(roundRupee(exact)).toBe(rounded);
    const t = computeBill([{ price: exact, slab: 0 }], 0);
    expect(t.payable).toBe(rounded);
    expect(t.roundOff).toBe(off);
  });

  it('lines stay exact to the paisa; taxable + GST + round-off = payable', () => {
    const t = computeBill([{ price: 600, slab: 18 }, { price: 350, slab: 5 }, { price: 199, slab: 12 }], 250.55);
    expect(t.lines.reduce((a, l) => a + Math.round(l.total * 100), 0) / 100).toBe(1018.59);
    expect(Math.round((t.taxable + t.tax + t.roundOff) * 100) / 100).toBe(t.payable);
  });

  it('billRoundOff: server value, else derived; legacy bills read 0', () => {
    expect(billRoundOff({ roundOff: 0.1 } as Bill)).toBe(0.1);
    expect(billRoundOff({ totalPayable: 832, totalTaxable: 705, totalTax: 126.9 } as Bill)).toBe(0.1);
    expect(billRoundOff({ totalPayable: 1180, totalTaxable: 1000, totalTax: 180 } as Bill)).toBe(0);
    expect(billRoundOff(null)).toBe(0);
  });
});
