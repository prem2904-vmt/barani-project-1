/**
 * Discount math shared by the order cart and the billing counter.
 *
 * One base everywhere (and on the server — BillingService.PreDiscountGross):
 * the bill's PRE-discount gross = Σ price + the GST that price carries with no
 * discount, i.e. the total the patient saw. Every "% of the bill" and every
 * per-role cap check is measured on it.
 */
import type { Bill } from '../models/bill.model';
import { roundPaiseHalfEven } from './test-pricing';

/** ₹ value of a percent discount on `base`, rounded DOWN to the paisa so the
 *  resolved amount never exceeds the percent typed. (Rounding to whole rupees
 *  turned 17% of a ₹3 cart into ₹1 = 33% and tripped a 25% cap.) */
export function percentDiscountAmount(base: number, pct: number): number {
  const b = Number(base) || 0;
  const p = Number(pct) || 0;
  if (b <= 0 || p <= 0) return 0;
  // b rupees × p% = b·p paise; the epsilon absorbs float noise (0.29·100).
  const amt = Math.floor(b * p + 1e-7) / 100;
  return Math.min(amt, b);
}

/** A ₹ discount as a percent of `base` (0 when there is no base). */
export function discountPctOf(amount: number, base: number): number {
  const b = Number(base) || 0;
  return b > 0 ? ((Number(amount) || 0) / b) * 100 : 0;
}

/** The bill's pre-discount gross, from its items at the rates they were taxed
 *  at (0 on a Bill of Supply) — mirrors the server's PreDiscountGross. A bill
 *  that already carries a discount stores post-discount GST in `totalTax`, so
 *  `subTotal + totalTax` under-states it. Falls back to that sum when the bill
 *  has no items. */
export function billPreDiscountGross(bill: Pick<Bill, 'subTotal' | 'totalTax' | 'items'> | null | undefined): number {
  if (!bill) return 0;
  const items = bill.items ?? [];
  if (items.length === 0) return (Number(bill.subTotal) || 0) + (Number(bill.totalTax) || 0);
  let sum = 0;
  for (const i of items) {
    const taxable = roundPaiseHalfEven(Math.max(0, Number(i.price) || 0));
    const tax = (Number(i.igstRate) || 0) > 0
      ? roundPaiseHalfEven(taxable * Number(i.igstRate) / 100)
      : roundPaiseHalfEven(taxable * (Number(i.cgstRate) || 0) / 100)
        + roundPaiseHalfEven(taxable * (Number(i.sgstRate) || 0) / 100);
    sum += taxable + tax;
  }
  return Math.round(sum * 100) / 100;
}

/** "25.2%" / "25%" — one decimal, so an over-cap attempt never reads
 *  "25% exceeds your limit of 25%". */
export function fmtPct(pct: number): string {
  return `${Math.round((Number(pct) || 0) * 10) / 10}%`;
}
