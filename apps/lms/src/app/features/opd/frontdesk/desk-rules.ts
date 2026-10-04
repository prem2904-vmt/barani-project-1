/**
 * OPD front-desk rules (Agent B) — PURE. The server is the source of truth
 * (Services/Opd/Frontdesk/OpdFeeRules.cs + OpdPaymentSplit.cs); these mirror
 * it for the live billing card and are pinned by the SAME fixtures in
 * desk-rules.spec.ts and FrontdeskRulesTests.cs. Money goes through the ONE
 * calculator mirror (shared/utils/bill-math.ts): discount before GST, rupee
 * round-off.
 */
import { computeBill, type BillTotals } from '../../../shared/utils/bill-math';
import type { OpdBillView, PaymentPart, ServiceQuote } from './desk.models';
import type { InlinePaymentResult } from '../../frontdesk/order-create/inline-payment-panel.component';

/** What is charged: the exact desk override, else the rule's quote. */
export function chargedFee(quoted: number, override: number | null | undefined): number {
  return override != null && Number.isFinite(override) ? override : quoted;
}

/** "rule ₹300" note for the bill line when the desk set another amount. */
export function feeLineLabel(serviceName: string, isFollowUp: boolean, quoted: number, override: number | null | undefined): string {
  const name = isFollowUp ? `${serviceName} (follow-up)` : serviceName;
  return override != null && override !== quoted ? `${name} — set at the desk (rule ₹${fmt(quoted)})` : name;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** Parses the override field: digits and one dot, max 2 decimals; blank = no override. */
export function parseOverride(raw: string): number | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  if (!/^\d{1,8}(\.\d{0,2})?$/.test(t)) return NaN;
  return Math.round(parseFloat(t) * 100) / 100;
}

export interface LabLine { id: string; name: string; price: number; slab: number; }

/** The desk's billing card: the OPD consult bill and — separately — the lab
 *  bill the tests will raise. Two bills, no shared line, one amount to take. */
export interface DeskBillPreview {
  opd: BillTotals;
  lab: BillTotals | null;
  total: number;
}

export function deskBillPreview(service: ServiceQuote | null, override: number | null, labs: LabLine[]): DeskBillPreview {
  const fee = service ? chargedFee(service.quoted, override) : 0;
  const opd = computeBill(service ? [{ price: fee, slab: service.taxSlab || 0 }] : [], 0);
  const lab = labs.length ? computeBill(labs.map(l => ({ price: l.price, slab: l.slab })), 0) : null;
  return { opd, lab, total: opd.payable + (lab?.payable ?? 0) };
}

/** The inline payment panel's result → the desk's payment parts (the panel's
 *  "Bill to vendor" and "Pay later" are not OPD modes: null = refuse). */
export function paymentParts(r: InlinePaymentResult, amount: number): PaymentPart[] | null {
  switch (r.mode) {
    case 'cash': case 'upi': case 'card':
      return amount > 0 ? [{ mode: r.mode, amount, reference: r.referenceNo ?? null }] : [];
    case 'split':
      return (r.splitParts ?? []).filter(p => p.amount > 0)
        .map(p => ({ mode: p.mode as PaymentPart['mode'], amount: p.amount }));
    default:
      return null;
  }
}

/** Mirror of OpdPaymentSplit.Allocate: OPD first, then the lab bill. */
export function allocate(parts: PaymentPart[], opdDue: number, labDue: number): { opd: PaymentPart[]; lab: PaymentPart[]; unapplied: number } {
  let o = Math.max(0, opdDue), l = Math.max(0, labDue), left = 0;
  const opd: PaymentPart[] = [], lab: PaymentPart[] = [];
  for (const p of parts) {
    let amt = p.amount;
    const a = Math.min(amt, o); if (a > 0) { opd.push({ ...p, amount: a }); o -= a; amt -= a; }
    const b = Math.min(amt, l); if (b > 0) { lab.push({ ...p, amount: b }); l -= b; amt -= b; }
    left += amt;
  }
  return { opd, lab, unapplied: left };
}

/** "~36 min" / "Free now". */
export function waitLabel(waiting: number, minutes: number): string {
  if (waiting <= 0) return 'Free now';
  return `${waiting} waiting · ~${minutes} min`;
}

/** Wait tone for the dot: amber within ~30 min, red beyond, neutral when free. */
export function waitTone(waiting: number, minutes: number): 'free' | 'ok' | 'long' {
  if (waiting <= 0) return 'free';
  return minutes > 45 ? 'long' : 'ok';
}

// ── Draft (per user, per branch) ──────────────────────────────────────────
export interface DeskDraft {
  patientId?: string | null; doctorId?: string | null; departmentId?: string | null; serviceId?: string | null;
  purpose?: string; override?: string; overrideReason?: string; labIds?: string[]; urgent?: boolean;
  vitalsHere?: boolean; savedAt: number;
}
const DRAFT_TTL_MS = 12 * 60 * 60 * 1000;
export const draftKey = (userId: string, branchId: string) => `pf:opd-desk-draft:${userId}:${branchId}`;

export function readDraft(storage: Pick<Storage, 'getItem'> | null, key: string, now = Date.now()): DeskDraft | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as DeskDraft;
    if (!d || typeof d.savedAt !== 'number' || now - d.savedAt > DRAFT_TTL_MS) return null;
    return d;
  } catch { return null; }
}
export function writeDraft(storage: Pick<Storage, 'setItem' | 'removeItem'> | null, key: string, d: DeskDraft | null): void {
  try {
    if (!storage) return;
    if (!d) storage.removeItem(key); else storage.setItem(key, JSON.stringify(d));
  } catch { /* private mode — the draft is a convenience only */ }
}

// ── Collecting a visit bill (consult after the consult, procedures) ───────
/** The bill re-run with the desk's whole-bill ₹ discount — mirror of the
 *  server's OpdVisitBilling.Recompute (BillMath: discount before GST, rupee
 *  round-off). Null discount = the bill as it stands. */
export function collectPreview(bill: Pick<OpdBillView, 'lines' | 'discount' | 'totalPayable' | 'totalPaid'>, discount: number | null): { payable: number; balance: number; discount: number; gross: number } {
  const t = computeBill(bill.lines.map(l => ({ price: Math.round(l.unitPrice * l.qty * 100) / 100, slab: l.taxSlab || 0 })), discount ?? bill.discount ?? 0);
  return { payable: t.payable, balance: Math.max(0, t.payable - (bill.totalPaid || 0)), discount: t.discount, gross: t.gross };
}

/** A discount the desk may give: within the role cap (% of the pre-discount
 *  gross) and never taking the bill below what is already paid. Null = fine. */
export function collectDiscountProblem(bill: Pick<OpdBillView, 'lines' | 'discount' | 'totalPayable' | 'totalPaid'>, discount: number, capPct: number): string | null {
  if (!Number.isFinite(discount) || discount < 0) return "Discount can't be negative.";
  if (discount === 0) return null;
  const p = collectPreview(bill, discount);
  const sub = bill.lines.reduce((a, l) => a + l.unitPrice * l.qty, 0);
  if (discount > sub + 0.005) return "Discount can't be more than the bill.";
  const pct = p.gross > 0 ? (discount / p.gross) * 100 : 0;
  if (pct > capPct + 0.01) return `Discount ${Math.round(pct * 10) / 10}% exceeds your limit of ${capPct}%.`;
  if (p.payable < (bill.totalPaid || 0)) return "The bill can't go below what has already been paid.";
  return null;
}
