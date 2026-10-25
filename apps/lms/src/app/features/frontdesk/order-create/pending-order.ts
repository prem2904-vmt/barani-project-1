/**
 * Order & Payments Confirm = create the order → raise the bill → take the
 * payment. If the bill or payment step fails AFTER the order exists, the
 * retry must bill THAT order — never create a duplicate (bug 3). Pure helpers
 * so the rule is testable without the component.
 */

/** An order this Confirm created whose billing / payment hasn't completed. */
export interface PendingOrder { id: string; patientId: string; key: string }

export type ConfirmOrderPlan =
  | { action: 'create' }
  | { action: 'reuse'; orderId: string }
  | { action: 'patch'; orderId: string };

/** Stable identity of the cart's tests + specimen choices (test order ignored). */
export function cartKey(
  testIds: readonly string[],
  specimens: Record<string, string> | null | undefined,
  outsourcing?: Record<string, string> | null,
): string {
  const sp = specimens ? Object.keys(specimens).sort().map(k => [k, specimens[k]]) : [];
  // The outsourcing picks join the key only when there are any, so a cart
  // without one keys exactly as before (a changed pick re-syncs the order).
  const out = outsourcing ? Object.keys(outsourcing).sort().map(k => [k, outsourcing[k]]) : [];
  return JSON.stringify(out.length ? [[...testIds].sort(), sp, out] : [[...testIds].sort(), sp]);
}

/** create a new order, reuse the pending one, or re-sync its tests first. A
 *  pending order never carries over to a different patient. */
export function planConfirmOrder(pending: PendingOrder | null, patientId: string, key: string): ConfirmOrderPlan {
  if (!pending || pending.patientId !== patientId) return { action: 'create' };
  return pending.key === key ? { action: 'reuse', orderId: pending.id } : { action: 'patch', orderId: pending.id };
}

/** POST /api/billing returns an EXISTING bill untouched — on a retry its
 *  discount may be stale. True when it differs from the cart's and the bill
 *  is still open (a settled bill's discount is final). */
export function discountNeedsSync(
  bill: { totalDiscount: number; balance: number; totalPaid: number; status: string } | null | undefined,
  discount: number,
): boolean {
  if (!bill) return false;
  const settled = bill.status === 'paid' || (bill.totalPaid > 0 && bill.balance <= 0);
  if (settled) return false;
  return Math.abs((Number(bill.totalDiscount) || 0) - (Number(discount) || 0)) >= 0.005;
}
