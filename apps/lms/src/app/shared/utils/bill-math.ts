/**
 * THE bill calculator, mirrored line for line from the server
 * (Prefrontal/Services/BillMath.cs + BillingCalculator.cs). The cart, the
 * counter and the payment panel show exactly what the invoice will be.
 *
 * Tax rule: the discount reduces the TAXABLE value; GST is charged on the
 * discounted value. The discount is split evenly across the billed units in
 * whole paise (Σ shares == discount); the odd paise go to the dearest units
 * first (price desc, then slab desc — so line order never matters). A unit is
 * never discounted below zero: its excess is re-spread over the others.
 * Rounding: banker's (C# `decimal.Round`) to the paisa at every step the
 * server rounds. Round-off (owner rule, BillMath.RoundRupee): the bill TOTAL
 * is whole rupees — paise < 50 round DOWN, ≥ 50 round UP — and the ±0.xx is
 * shown as its own "Round off" row; lines stay exact to the paisa and the
 * gross (the discount-cap base) is not rounded. Keep both specs pinned to the
 * same numbers.
 */
import type { Bill } from '../models/bill.model';
import { roundPaiseHalfEven } from './test-pricing';

/** One billed unit: pre-discount price and the GST slab it's billed at (0 = no GST). */
export interface BillUnit { price: number; slab: number }

export interface BillLineCalc {
  price: number; slab: number; share: number;
  taxable: number; cgst: number; sgst: number; igst: number; total: number;
}

export interface BillTotals {
  lines: BillLineCalc[];
  subTotal: number;
  /** Discount actually applied (Σ shares; never more than the subtotal). */
  discount: number;
  taxable: number; cgst: number; sgst: number; igst: number; tax: number;
  /** Whole-rupee bill total (taxable + tax + roundOff). */
  payable: number;
  /** Pre-discount gross (price + GST at full price) — the base for every % and cap. */
  gross: number;
  /** ±0.xx taking the exact taxable + tax to the whole-rupee payable. */
  roundOff: number;
}

const toPaise = (n: number) => Math.round(roundPaiseHalfEven(n) * 100);
const fromPaise = (p: number) => p / 100;

/** BillMath.RoundRupee: whole rupees, paise < 50 → down, ≥ 50 → up
 *  (831.49 → 831, 831.50 → 832). */
export function roundRupee(n: number): number {
  const p = toPaise(n);
  const sign = p < 0 ? -1 : 1;
  const a = Math.abs(p);
  const rupees = Math.floor(a / 100) + (a % 100 >= 50 ? 1 : 0);
  return sign * rupees || 0;
}

/** Split an exact paise total into (whole-rupee payable, round-off), in rupees. */
function withRoundOff(exactPaise: number): { payable: number; roundOff: number } {
  const payable = roundRupee(fromPaise(exactPaise));
  return { payable, roundOff: fromPaise(payable * 100 - exactPaise) };
}

/** The round-off a bill carries: the server's `roundOff`, else derived
 *  (payable − taxable − tax). Bills raised before round-off read 0. */
export function billRoundOff(bill: Pick<Bill, 'totalPayable' | 'totalTaxable' | 'totalTax'> & { roundOff?: number | null } | null | undefined): number {
  if (!bill) return 0;
  if (typeof bill.roundOff === 'number') return bill.roundOff;
  return fromPaise(toPaise(bill.totalPayable) - toPaise(bill.totalTaxable) - toPaise(bill.totalTax));
}

/** BillingCalculator.Compute for one line. */
function computeLine(price: number, slab: number, discount: number, interstate: boolean) {
  const taxable = roundPaiseHalfEven(Math.max(price - discount, 0));
  let cgst = 0, sgst = 0, igst = 0;
  if (slab > 0) {
    if (interstate) {
      igst = roundPaiseHalfEven(taxable * slab / 100);
    } else {
      const half = slab / 2;
      cgst = roundPaiseHalfEven(taxable * half / 100);
      sgst = roundPaiseHalfEven(taxable * half / 100);
    }
  }
  const total = fromPaise(toPaise(taxable) + toPaise(cgst) + toPaise(sgst) + toPaise(igst));
  return { taxable, cgst, sgst, igst, total };
}

/** Per-unit discount shares in paise (BillMath.SplitPaise). */
export function splitDiscountPaise(units: BillUnit[], discount: number): number[] {
  const n = units.length;
  const share = new Array<number>(n).fill(0);
  const d = Number(discount) || 0;
  if (n === 0 || d <= 0) return share;
  const cap = units.map(u => toPaise(Math.max(0, Number(u.price) || 0)));
  let remaining = Math.min(toPaise(d), cap.reduce((a, b) => a + b, 0));
  let active = units.map((_, i) => i)
    .filter(i => cap[i] > 0)
    .sort((a, b) => (units[b].price - units[a].price) || (units[b].slab - units[a].slab) || (a - b));
  while (remaining > 0 && active.length > 0) {
    const per = Math.floor(remaining / active.length);
    const odd = remaining % active.length;
    let left = 0;
    const next: number[] = [];
    active.forEach((i, k) => {
      const want = per + (k < odd ? 1 : 0);
      const give = Math.min(want, cap[i] - share[i]);
      share[i] += give;
      left += want - give;
      if (share[i] < cap[i]) next.push(i);
    });
    remaining = left;
    active = next;
  }
  return share;
}

/** The bill the server will raise for these units at this discount. */
export function computeBill(units: BillUnit[], discount: number, interstate = false): BillTotals {
  const clean = units.map(u => ({ price: Number(u.price) || 0, slab: Number(u.slab) || 0 }));
  const shares = splitDiscountPaise(clean, discount);
  let sub = 0, disc = 0, taxable = 0, cgst = 0, sgst = 0, igst = 0, gross = 0; // paise
  const lines: BillLineCalc[] = clean.map((u, i) => {
    const share = fromPaise(shares[i]);
    const b = computeLine(u.price, u.slab, share, interstate);
    const full = computeLine(u.price, u.slab, 0, interstate);
    sub += toPaise(u.price); disc += shares[i];
    taxable += toPaise(b.taxable); cgst += toPaise(b.cgst); sgst += toPaise(b.sgst); igst += toPaise(b.igst);
    gross += toPaise(full.total);
    return { price: u.price, slab: u.slab, share, ...b };
  });
  const tax = cgst + sgst + igst;
  return {
    lines,
    subTotal: fromPaise(sub), discount: fromPaise(disc), taxable: fromPaise(taxable),
    cgst: fromPaise(cgst), sgst: fromPaise(sgst), igst: fromPaise(igst), tax: fromPaise(tax),
    ...withRoundOff(taxable + tax), gross: fromPaise(gross),
  };
}

/** What POST /api/billing/{id}/discount will make this bill: its lines
 *  re-split at the rates they were billed at (0 on a Bill of Supply). An
 *  item-less legacy bill falls back to its totals less the discount. */
export function previewBillForDiscount(bill: Bill | null | undefined, discount: number): BillTotals | null {
  if (!bill) return null;
  const items = bill.items ?? [];
  if (items.length === 0) {
    const exact = Math.max(0, toPaise(bill.totalPayable) - toPaise(Math.max(0, discount)));
    return {
      lines: [], subTotal: bill.subTotal, discount: Math.max(0, discount), taxable: bill.totalTaxable,
      cgst: bill.totalCgst, sgst: bill.totalSgst, igst: bill.totalIgst, tax: bill.totalTax,
      ...withRoundOff(exact), gross: fromPaise(toPaise(bill.subTotal) + toPaise(bill.totalTax)),
    };
  }
  const units = items.map(i => ({
    price: Number(i.price) || 0,
    slab: (Number(i.cgstRate) || 0) + (Number(i.sgstRate) || 0) + (Number(i.igstRate) || 0),
  }));
  return computeBill(units, discount, !!bill.isInterstate);
}

/** The largest counter discount (₹, to the paisa) that keeps the recomputed,
 *  rounded payable at or above what is already paid — the server refuses more
 *  with 400 `discount_exceeds_balance`. Nothing paid → the whole subtotal.
 *  The payable only falls as the discount grows, so a paise binary search. */
export function maxDiscountWithinPaid(bill: Bill | null | undefined, paid: number): number {
  if (!bill) return 0;
  const cap = toPaise(bill.subTotal);
  const paidP = toPaise(paid);
  if (paidP <= 0) return fromPaise(cap);
  const ok = (p: number) => toPaise(previewBillForDiscount(bill, fromPaise(p))!.payable) >= paidP;
  if (!ok(0)) return 0;
  let lo = 0, hi = cap;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ok(mid)) lo = mid; else hi = mid - 1;
  }
  return fromPaise(lo);
}
