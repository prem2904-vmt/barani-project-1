/** Where "Resume order" on a checked-in appointment card goes.
 *
 *  Check-in creates no order, so a card normally resumes the ORDER PAGE with
 *  the pre-booked tests filled in. But once an order exists for the
 *  appointment (the desk already created / paid it, or backed out after
 *  Create), resuming that page and pressing Continue to Payment billed a
 *  second order (OPS-74) and landed on payment instead of collection (OPS-29
 *  #12). With an order on file the card goes to the order itself: sample
 *  collection when this desk collects, else the order's own page. */
export interface ResumeTarget { path: string[]; queryParams: Record<string, string> }

export function appointmentResumeTarget(
  appt: { id: string; patientId: string },
  existingOrderId: string | null | undefined,
  canCollectHere: boolean,
): ResumeTarget {
  if (existingOrderId) {
    return canCollectHere
      ? { path: ['/lab/collect'], queryParams: { orderId: existingOrderId } }
      : { path: ['/frontdesk/order'], queryParams: { patientId: appt.patientId, fromOrderId: existingOrderId } };
  }
  return { path: ['/frontdesk/order'], queryParams: { patientId: appt.patientId, appointmentId: appt.id } };
}
