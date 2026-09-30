/**
 * Pharmacy cart math — a thin, TESTED mirror of the server
 * (Services/Opd/Pharmacy/PharmacyRules.TaxableFromMrp + PharmacyBilling.Compute):
 * drug MRPs INCLUDE GST, so each line enters the ONE bill calculator
 * (shared/utils/bill-math.ts computeBill ⇄ BillMath.cs) at its taxable value;
 * the discount comes off the taxable value before GST and the total rounds
 * to the rupee. The cart shows exactly what the server will bill.
 */
import { computeBill, type BillTotals } from '../../../shared/utils/bill-math';
import { roundPaiseHalfEven } from '../../../shared/utils/test-pricing';
import type { DrugSchedule } from '../shared/opd.models';

export interface CartLine { qty: number; mrp: number; taxSlab: number }

/** MRP (GST inclusive) → taxable value to the paisa (C# decimal.Round = half-even). */
export function taxableFromMrp(inclusive: number, slab: number): number {
  return slab <= 0 ? roundPaiseHalfEven(inclusive) : roundPaiseHalfEven((inclusive * 100) / (100 + slab));
}

/** The bill the server will raise for these lines (intra-state, like the lab). */
export function cartTotals(lines: CartLine[], discount = 0, gstEnabled = true): BillTotals {
  return computeBill(lines.map(l => {
    const slab = gstEnabled ? l.taxSlab : 0;
    return { price: taxableFromMrp(l.qty * l.mrp, slab), slab };
  }), Math.max(0, discount || 0));
}

/** Schedule H, H1 and X are prescription-only (mirror of PharmacyRules.NeedsPrescription). */
export function needsPrescription(s: DrugSchedule | string | null | undefined): boolean {
  return s === 'H' || s === 'H1' || s === 'X';
}

/** H1 and X sales go in the register (mirror of PharmacyRules.NeedsRegister). */
export function needsRegister(s: DrugSchedule | string | null | undefined): boolean {
  return s === 'H1' || s === 'X';
}

/** "Sch H1" / "OTC" label for a schedule chip. */
export function scheduleLabel(s: DrugSchedule | string | null | undefined): string {
  return s === 'H' || s === 'H1' || s === 'X' ? 'Sch ' + s : s === 'G' ? 'Sch G' : 'OTC';
}

/** "₹1,234.50" (always two decimals) or "₹784" (whole). */
export function inr(n: number | null | undefined, paise = true): string {
  const v = Number(n) || 0;
  return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: paise ? 2 : 0, maximumFractionDigits: paise ? 2 : 0 });
}

/** "05/2027" from an ISO date. */
export function expiryLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m] = iso.slice(0, 10).split('-');
  return `${m}/${y}`;
}

/** Whole months from `todayIso` to the expiry (negative = expired). */
export function monthsToExpiry(iso: string, todayIso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = todayIso.slice(0, 10).split('-').map(Number);
  return (y - ty) * 12 + (m - tm) + (d < td ? -1 : 0);
}

/** "10 tabs" / "1 bottle" for a stock quantity. */
export function unitWords(qty: number, unit: string | null | undefined, form?: string | null): string {
  const u = unit || (form === 'tab' ? 'tab' : form === 'sachet' ? 'sachet' : 'pack');
  const n = Number(qty) || 0;
  const whole = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
  return `${whole} ${u}${n === 1 ? '' : 's'}`;
}

/** Friendly message from an API error (ApiService rejects with Error(message)). */
export function errText(e: unknown, fallback = 'Something went wrong.'): string {
  const m = (e as { message?: string } | null)?.message;
  return m && m.trim() ? m : fallback;
}
