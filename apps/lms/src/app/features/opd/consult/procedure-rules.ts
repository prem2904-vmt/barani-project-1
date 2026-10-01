/**
 * Consult procedures — PURE rules, the TS mirror of prefrontal-mw
 * Services/Opd/Consult/ProcedureRules.cs (same fixtures in both specs). The
 * server decides; this only lets the doctor see a refusal before saving.
 *
 * Price rule (owner): the OPD Master price is fixed for doctors unless the
 * OPD workflow setting "Doctors can change procedure prices" is on; then any
 * exact amount, or — with a cap — at most that % of the rule price up or down.
 */
import type { ConsultProcedureDraft, ProcedurePricing } from './consult.api';

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

/** What the procedures add to the visit's bill (before any desk discount). */
export function proceduresTotal(items: readonly Pick<ConsultProcedureDraft, 'price' | 'qty'>[]): number {
  return Math.round(items.reduce((a, p) => a + p.price * p.qty, 0) * 100) / 100;
}

/** The draft body's procedure list: the price is sent only when it differs from the rule. */
export function proceduresBody(items: readonly ConsultProcedureDraft[]) {
  return items.filter(p => p.status !== 'billed').map(p => ({
    id: p.id ?? null, serviceId: p.serviceId, qty: p.qty,
    price: p.price !== p.rulePrice ? p.price : null,
    priceReason: p.price !== p.rulePrice ? (p.priceReason?.trim() || null) : null,
    side: p.side ?? null, note: p.note?.trim() || null,
  }));
}
