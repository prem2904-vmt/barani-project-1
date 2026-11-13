/**
 * Map a notification to router navigation so a tap jumps to the relevant,
 * ACTIONABLE screen (OPS-60). Returns null when there's no dedicated page
 * (the tap then just marks it read). Pure so it can be unit-tested.
 *
 * Routing keys off the notification `type` first — that's the precise event —
 * because a single `referenceType` ("order") is shared by many events
 * (created / cancelled / billed-not-collected / dispatch-not-received …) and
 * can't disambiguate the right destination on its own. Falls back to
 * `referenceType`. `referenceId` is the entity id.
 */
import { canonicalNotificationType } from '../../utils/notification-type';

export interface NotifRoute {
  commands: unknown[];
  queryParams?: Record<string, string>;
}

export function notificationRoute(
  type: string | undefined | null,
  referenceType: string | undefined | null,
  referenceId: string | undefined | null,
  canValidate: boolean,
): NotifRoute | null {
  const id = referenceId || undefined;
  const t = canonicalNotificationType(type);

  // Type-specific: open the exact action screen for the order.
  if ((t === 'billed_not_collected' || t === 'sample_not_collected') && id) {
    return { commands: ['/lab/collect'], queryParams: { orderId: id } };
  }
  if (t === 'dispatch_not_received') {
    return { commands: ['/lab/receive'] };
  }
  // Urgent order ready to report (Work Register #6): referenceType is the
  // generic 'order' (shared with Collect-bound events like billed_not_collected
  // above), so the TYPE decides here — the desk's actionable screen is the
  // report queue, not Collect (nothing left to collect on a validated order).
  if (t === 'urgent_report_ready') {
    return { commands: ['/reports'] };
  }

  switch (referenceType) {
    case 'report':           return { commands: id ? ['/reports/view', id] : ['/reports'] };
    case 'order_sample':     return { commands: id ? ['/lab/sample', id] : ['/lab/my-work'] };
    case 'order_test':       return { commands: id && canValidate ? ['/pathologist/validate', id] : ['/lab/my-work'] };
    case 'dispatch_package': return { commands: ['/lab/receive'] };
    case 'appointment':      return { commands: ['/frontdesk/appointments'] };
    case 'user':             return { commands: id ? ['/admin/users', id, 'edit'] : ['/admin/users'] };
    case 'vendor':           return { commands: ['/admin/vendors'] };
    // WhatsApp billing / credits alerts → Settings → Communication → WhatsApp (the WhatsApp cards).
    case 'whatsapp_billing': return { commands: ['/admin/communication'], queryParams: { tab: 'whatsapp' } };
    case 'process_workflow': return { commands: ['/admin/process'] };
    // Generic order → open its collection drawer (the common actionable case);
    // a bare bill has no per-order screen, so land on the frontdesk queue.
    case 'order':            return id ? { commands: ['/lab/collect'], queryParams: { orderId: id } } : { commands: ['/frontdesk'] };
    case 'bill':             return { commands: ['/frontdesk'] };
    default:                 return null;
  }
}
