/**
 * Consult procedures — PURE rules, the TS mirror of prefrontal-mw
 * Services/Opd/Consult/ProcedureRules.cs (same fixtures in both specs). The
 * server decides; this only lets the doctor see a refusal before saving.
 *
 * Price rule (owner): the OPD Master price is fixed for doctors unless the
 * OPD workflow setting "Doctors can change procedure prices" is on; then any
 * exact amount, or — with a cap — at most that % of the rule price up or down.
 */
import type { ConsultProcedureBodyLine, ConsultProcedureDraft, ProcedurePricing } from './consult.api';

export type ProcedureSide = 'left' | 'right' | 'both';
export const PROCEDURE_SIDES: { value: ProcedureSide | null; label: string }[] = [
  { value: null, label: 'None' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }, { value: 'both', label: 'Both' },
];
export const MAX_PROCEDURE_QTY = 50;

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

/** null = fine; else the refusal the server would give. */
export function checkProcedurePrice(rule: number, price: number, policy: ProcedurePricing | null | undefined): { code: string; message: string } | null {
  if (!Number.isFinite(price) || price < 0) return { code: 'invalid_procedure', message: "A procedure price can't be negative." };
  if (price === rule) return null;
  if (!policy?.doctorCanChange) return { code: 'procedure_price_locked', message: "Procedure prices are fixed — the OPD settings don't let doctors change them." };
  const cap = policy.maxChangePercent;
  if (cap != null) {
    const allowed = (rule * cap) / 100;
    if (Math.abs(price - rule) > allowed + 1e-9) {
      return {
        code: 'procedure_price_over_cap',
        message: rule <= 0
          ? "This procedure has no price in the OPD master, so it can't be changed here."
          : `You can change this price by at most ${cap}% (₹${fmt(rule - allowed)} – ₹${fmt(rule + allowed)}).`,
      };
    }
  }
  return null;
}

/** The bill-line text the desk sees (mirror of ProcedureRules.LineDescription). */
export function procedureLineLabel(name: string, side: ProcedureSide | null | undefined, rule: number, unit: number, setBy?: string | null): string {
  let t = side === 'left' ? `${name} · Left` : side === 'right' ? `${name} · Right` : side === 'both' ? `${name} · Both sides` : name;
  if (unit !== rule) t += ` — set by ${setBy?.trim() ? setBy : 'the doctor'} (rule ₹${fmt(rule)})`;
  return t;
}

/** Parses a typed price: digits and one dot, max 2 decimals; blank / bad = NaN. */
export function parsePrice(raw: string): number {
  const t = (raw ?? '').trim().replace(/[₹,\s]/g, '');
  if (!/^\d{1,8}(\.\d{0,2})?$/.test(t)) return NaN;
  return Math.round(parseFloat(t) * 100) / 100;
}

/** What the procedures add to the visit's bill (before any desk discount).
 *  A procedure booked for LATER is not billed today (paid on its day). */
export function proceduresTotal(items: readonly Pick<ConsultProcedureDraft, 'price' | 'qty' | 'when'>[]): number {
  return Math.round(items.filter(p => p.when !== 'later').reduce((a, p) => a + p.price * p.qty, 0) * 100) / 100;
}

/** The draft body's procedure list: the price is sent only when it differs
 *  from the rule. `withLater` (server features.procedureLater) adds when /
 *  preferredWithin / prepNote; an older server never sees them. */
export function proceduresBody(items: readonly ConsultProcedureDraft[], withLater = false): ConsultProcedureBodyLine[] {
  return items.filter(p => p.status !== 'billed').map(p => {
    const line: ConsultProcedureBodyLine = {
      id: p.id ?? null, serviceId: p.serviceId, qty: p.qty,
      price: p.price !== p.rulePrice ? p.price : null,
      priceReason: p.price !== p.rulePrice ? (p.priceReason?.trim() || null) : null,
      side: p.side ?? null, note: p.note?.trim() || null,
    };
    if (withLater) {
      const later = p.when === 'later';
      line.when = later ? 'later' : 'now';
      line.preferredWithin = later ? (p.preferredWithin ?? null) : null;
      line.prepNote = later ? (p.prepNote?.trim() || null) : null;
    }
    return line;
  });
}

/** "Preferred within" choices for a procedure booked for later. */
export const PREFERRED_WITHIN: readonly string[] = ['This week', 'Within 2 weeks', 'Within a month'];

/** The allowed price band under the setting: null = locked (admin hasn't
 *  allowed changes); hi = null = any amount. Pure. */
export function priceRange(rule: number, policy: ProcedurePricing | null | undefined): { lo: number; hi: number | null } | null {
  if (!policy?.doctorCanChange) return null;
  const cap = policy.maxChangePercent;
  if (cap == null) return { lo: 0, hi: null };
  const d = (rule * cap) / 100;
  return { lo: Math.max(0, Math.round((rule - d) * 100) / 100), hi: Math.round((rule + d) * 100) / 100 };
}

const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** The line under the price: "Preset ₹2,000 · you set +25% · allowed ₹1,500 to ₹2,500". Pure. */
export function priceHint(rule: number, price: number, policy: ProcedurePricing | null | undefined): string {
  const r = priceRange(rule, policy);
  if (!r) return 'Price set by the admin';
  const pct = rule > 0 ? Math.round(((price - rule) / rule) * 100) : 0;
  const changed = price !== rule ? ` · you set ${pct > 0 ? '+' : ''}${pct}%` : '';
  const band = r.hi == null ? 'any amount allowed' : `allowed ${inr(r.lo)} to ${inr(r.hi)}`;
  return `Preset ${inr(rule)}${changed} · ${band}`;
}

/** A changed price needs a reason before Complete (the desk sees it). Pure. */
export function needsPriceReason(p: Pick<ConsultProcedureDraft, 'price' | 'rulePrice' | 'priceReason' | 'status'>): boolean {
  return p.status !== 'billed' && p.price !== p.rulePrice && !(p.priceReason ?? '').trim();
}
