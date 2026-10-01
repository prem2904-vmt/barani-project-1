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

/** Calendar days from `todayIso` to the expiry (negative = already past). */
export function daysToExpiry(iso: string, todayIso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = todayIso.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
}

export type ExpiryBand = 'expired' | 'soon30' | 'soon90' | 'ok';

/**
 * Expiry chip band (critic #10) — mirror of the server's
 * PharmacyRules.IsExpired (sellable up to AND INCLUDING the expiry date):
 * expired (red, not pickable) · < 30 days (red) · < 90 days (amber) · ok.
 * Used by the batch pickers (dispense, walk-in counter) and the stock page.
 */
export function expiryBand(iso: string, todayIso: string): ExpiryBand {
  const days = daysToExpiry(iso, todayIso);
  if (days < 0) return 'expired';
  if (days < 30) return 'soon30';
  if (days < 90) return 'soon90';
  return 'ok';
}

/** MM/YYYY + a CSS class for an expiry band (the "exp …" prefix is the
 *  caller's — this never repeats the word "expired"). */
export function expiryChip(iso: string, todayIso: string): { label: string; cls: string } {
  const band = expiryBand(iso, todayIso);
  const cls = band === 'expired' || band === 'soon30' ? 'pf-exp-red' : band === 'soon90' ? 'pf-exp-amber' : 'pf-exp-ok';
  return { label: expiryLabel(iso), cls };
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

/** Friendly text for the server's coded Schedule H / H1 / X errors (mirror of
 *  PharmacyDispenseService.EnforceSchedules / PharmacyRules.EnsurePrescriptionUploaded,
 *  owner 2026-10-01) — any other code, or none, falls back to errText. */
const SCHEDULE_ERROR_MESSAGES: Record<string, string> = {
  prescription_required: 'Enter the prescribing doctor’s name to sell this drug.',
  prescriber_regno_required: 'Enter the prescribing doctor’s registration number to sell this drug.',
  buyer_required: 'Schedule H1 / X sales go in the register — enter the customer’s name.',
  h1_address_required: 'Schedule H1 / X sales go in the register — enter the customer’s address.',
  prescription_upload_required: 'Upload the prescription before you can take payment for this Schedule H1 / X sale.',
};
export function scheduleErrorText(e: unknown, fallback = 'Something went wrong.'): string {
  const code = (e as { code?: string } | null)?.code;
  return (code && SCHEDULE_ERROR_MESSAGES[code]) || errText(e, fallback);
}
