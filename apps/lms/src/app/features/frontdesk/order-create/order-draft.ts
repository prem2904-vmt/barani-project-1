/**
 * The Order & Payments draft (`pf:order-draft:<patientId>` in localStorage).
 * Saved by "Save as draft" / parking the cart, restored when the patient's
 * cart reopens, listed by the front-desk Draft tab. Pure so the shape is
 * testable. The discount is stored AS TYPED (value + ₹/% kind) so a restored
 * draft rebuilds the same discount, over-cap check and totals. Bill state is
 * never stored (a draft has no bill). Old drafts without a discount restore.
 */

export type DraftDiscountKind = 'flat' | 'percent';
export interface DraftDiscount { value: string; kind: DraftDiscountKind }

export interface OrderDraft {
  savedAt: number;
  priority?: string;
  testIds: string[];
  specimens: Record<string, string> | null;
  /** Patient snapshot so the Draft tab can list it without a lookup. */
  patient?: unknown;
  discount?: DraftDiscount;
}

export interface ParsedOrderDraft {
  savedAt: number;
  priority: string | null;
  testIds: string[];
  specimens: Record<string, string>;
  discount: DraftDiscount | null;
}

export function buildOrderDraft(s: {
  savedAt: number; priority: string; testIds: string[]; specimens: Record<string, string> | null;
  patient: unknown; discountValue: string; discountKind: DraftDiscountKind;
}): OrderDraft {
  const draft: OrderDraft = {
    savedAt: s.savedAt, priority: s.priority, testIds: s.testIds, specimens: s.specimens, patient: s.patient,
  };
  const value = (s.discountValue ?? '').trim();
  if (value !== '') draft.discount = { value, kind: s.discountKind === 'percent' ? 'percent' : 'flat' };
  return draft;
}

/** Parse a stored draft; null when missing, stale (older than `ttlMs`),
 *  empty or unreadable. A malformed discount is dropped, not fatal. */
export function parseOrderDraft(raw: string | null | undefined, now: number, ttlMs: number): ParsedOrderDraft | null {
  if (!raw) return null;
  let parsed: Partial<OrderDraft> & { discount?: unknown };
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || !parsed.savedAt || now - parsed.savedAt > ttlMs) return null;
  const testIds = (Array.isArray(parsed.testIds) ? parsed.testIds : []).filter((id): id is string => typeof id === 'string');
  if (testIds.length === 0) return null;
  const sp = parsed.specimens && typeof parsed.specimens === 'object' ? parsed.specimens : {};
  const specimens = Object.fromEntries(
    Object.entries(sp).filter(([k, v]) => testIds.includes(k) && typeof v === 'string' && !!v)) as Record<string, string>;
  return {
    savedAt: parsed.savedAt,
    priority: typeof parsed.priority === 'string' ? parsed.priority : null,
    testIds, specimens,
    discount: readDiscount(parsed.discount),
  };
}

function readDiscount(d: unknown): DraftDiscount | null {
  if (!d || typeof d !== 'object') return null;
  const { value, kind } = d as { value?: unknown; kind?: unknown };
  if (kind !== 'flat' && kind !== 'percent') return null;
  const v = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  const n = parseFloat(v);
  if (v === '' || !Number.isFinite(n) || n < 0) return null;
  return { value: v, kind };
}
