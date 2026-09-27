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
  /** Tenant + branch the cart was parked in. A draft belongs to the branch
   *  that raised it — it is only listed / restored there (see
   *  {@link orderDraftInScope}). Absent on drafts saved before 2026-09-27. */
  tenantId?: string;
  branchId?: string;
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
  tenantId?: string | null; branchId?: string | null;
}): OrderDraft {
  const draft: OrderDraft = {
    savedAt: s.savedAt, priority: s.priority, testIds: s.testIds, specimens: s.specimens, patient: s.patient,
  };
  if (s.tenantId) draft.tenantId = s.tenantId;
  if (s.branchId) draft.branchId = s.branchId;
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

// ── Branch scope ────────────────────────────────────────────────────────
// Owner bug (2026-09-27, strict-isolation tenant): "we put a patient for a
// test in the Salem branch, but it is reflecting in the Trichy branch." The
// parked cart lived in localStorage under `pf:order-draft:<patientId>` — one
// browser-wide shelf — so an admin who parked a Salem order and switched to
// Trichy saw it in Trichy's Drafts / draft chips, and resuming it would have
// raised the order IN TRICHY. The patient is shared across branches by
// design; the half-built VISIT is not. Drafts are now keyed by branch
// (`pf:order-draft:<branchId>:<patientId>`) and stamped with tenant + branch.

export const ORDER_DRAFT_PREFIX = 'pf:order-draft:';

/** Where the desk is working right now. `branchId` = the active branch;
 *  `defaultBranchId` = the user's default branch (legacy drafts, saved before
 *  drafts carried a branch, are treated as belonging to it). */
export interface DraftScope {
  tenantId: string | null;
  branchId: string | null;
  defaultBranchId: string | null;
}

/** The storage key a draft is WRITTEN under in this scope. */
export function orderDraftKey(scope: DraftScope, patientId: string): string {
  return scope.branchId ? `${ORDER_DRAFT_PREFIX}${scope.branchId}:${patientId}` : `${ORDER_DRAFT_PREFIX}${patientId}`;
}

/** A storage key → its branch (null for a legacy key) + patient; null when
 *  it isn't an order draft (e.g. the pending-registration stash). */
export function parseOrderDraftKey(key: string | null | undefined): { branchId: string | null; patientId: string } | null {
  if (!key || !key.startsWith(ORDER_DRAFT_PREFIX)) return null;
  const rest = key.slice(ORDER_DRAFT_PREFIX.length);
  if (!rest || rest === 'pending-registration') return null;
  const i = rest.indexOf(':');
  if (i < 0) return { branchId: null, patientId: rest };
  const branchId = rest.slice(0, i), patientId = rest.slice(i + 1);
  return branchId && patientId && !patientId.includes(':') ? { branchId, patientId } : null;
}

/** Does a stored draft belong to the desk's current tenant + branch? */
export function orderDraftInScope(
  keyBranchId: string | null,
  body: { tenantId?: unknown; patient?: unknown } | null | undefined,
  scope: DraftScope,
): boolean {
  const stamped = typeof body?.tenantId === 'string' ? body.tenantId
    : typeof (body?.patient as { tenantId?: unknown } | undefined)?.tenantId === 'string'
      ? (body!.patient as { tenantId: string }).tenantId : null;
  if (stamped && scope.tenantId && stamped !== scope.tenantId) return false;
  if (keyBranchId) return !!scope.branchId && keyBranchId === scope.branchId;
  // Legacy (branch-less) draft: only the user's default branch shows it.
  return !scope.branchId || !scope.defaultBranchId || scope.branchId === scope.defaultBranchId;
}

/** Keys that may hold THIS scope's draft for a patient — the branch key,
 *  then the legacy key when a legacy draft would belong here. */
export function orderDraftKeysFor(scope: DraftScope, patientId: string): string[] {
  const keys = [orderDraftKey(scope, patientId)];
  const legacy = `${ORDER_DRAFT_PREFIX}${patientId}`;
  if (!keys.includes(legacy) && orderDraftInScope(null, null, scope)) keys.push(legacy);
  return keys;
}
