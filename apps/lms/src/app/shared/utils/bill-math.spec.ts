import { computeBill, previewBillForDiscount, splitDiscountPaise } from './bill-math';
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
    expect(t.payable).toBe(831.9);
    expect(t.gross).toBe(1180);
  });

  it('no discount: payable == gross', () => {
    const t = computeBill([{ price: 1000, slab: 18 }, { price: 250, slab: 5 }], 0);
    expect(t.payable).toBe(1442.5);
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
    expect(t.payable).toBe(831.9);
  });

  it('mixed slabs with odd paise — same figures as the server test', () => {
    const t = computeBill([{ price: 600, slab: 18 }, { price: 350, slab: 5 }, { price: 199, slab: 12 }], 250.55);
    expect(t.lines.map(l => l.share)).toEqual([83.52, 83.52, 83.51]);
    expect(t.taxable).toBe(898.45);
    expect(t.tax).toBe(120.14);
    expect(t.payable).toBe(1018.59);
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

  it('re-splits the bill lines at their billed rates: 1180 bill − ₹295 → ₹831.90 (server ApplyDiscount)', () => {
    const t = previewBillForDiscount(bill(), 295)!;
    expect(t.payable).toBe(831.9);
    expect(t.tax).toBe(126.9);
  });

  it('a Bill of Supply line (0 rates) stays untaxed', () => {
    const b = bill({ items: [{ ...bill().items[0], cgstRate: 0, sgstRate: 0, cgstAmount: 0, sgstAmount: 0, total: 1000 }] });
    expect(previewBillForDiscount(b, 295)!.payable).toBe(705);
  });

  it('no bill → null', () => {
    expect(previewBillForDiscount(null, 10)).toBeNull();
  });
});
