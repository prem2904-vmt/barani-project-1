/**
 * The ONE in-place action a notification row offers — always an EXISTING flow:
 *   Acknowledge          the critical-result acknowledgement (CriticalResultsService, via 'bell')
 *   Open sample / Open order / View / Reply / Retry   navigate through notificationRoute (or a kind's own screen)
 * No row invents a new endpoint. A row with no screen and nothing to acknowledge has no button.
 */
import { Notification } from '../../models/user.model';
import { canonicalNotificationType } from '../../utils/notification-type';
import { NotifRoute } from './notification-route';

export interface RowAction {
  kind: 'ack' | 'go';
  label: string;
  /** Destination for a 'go' action. */
  route?: NotifRoute;
  /** The critical Acknowledge is the one outlined-in-rose button; everything else is the quiet secondary. */
  danger: boolean;
}

/** Kinds whose button is a verb of their own (the screen it opens is where that verb happens). */
const VERB: Record<string, string> = {
  critical_value: 'View',
  critical_unvalidated: 'View',
  result_comment_added: 'Reply',
  office_mention: 'Reply',
  report_blocked: 'Retry',
  whatsapp_payment_failed: 'Fix',
};
/** Kinds that open a screen of their own rather than what notificationRoute picks for their referenceType. */
const SCREEN: Record<string, NotifRoute> = {
  report_blocked: { commands: ['/reports'] },
};

const BY_REFERENCE: Record<string, string> = {
  order_sample: 'Open sample',
  order_test: 'Open result',
  order: 'Open order',
  bill: 'Open order',
  dispatch_package: 'Open package',
  appointment: 'Open appointment',
};

export interface ActionPolicy {
  canAcknowledge(n: Notification): boolean;
  linkFor(n: Notification): NotifRoute | null;
}

export function rowAction(rep: Notification, policy: ActionPolicy): RowAction | null {
  if (policy.canAcknowledge(rep)) return { kind: 'ack', label: 'Acknowledge', danger: true };
  const kind = canonicalNotificationType(rep.type);
  const route = SCREEN[kind] ?? policy.linkFor(rep);
  if (!route) return null;
  const label = VERB[kind] ?? BY_REFERENCE[rep.referenceType ?? ''] ?? 'View';
  return { kind: 'go', label, route, danger: false };
}

/** "LAB-2611-000009" style reference found in the notification text, for the page's meta line. */
export function orderRefOf(n: Notification): string | null {
  const m = /\b[A-Z][A-Z0-9]{1,5}-\d{3,}(?:-\d+)*\b/.exec(`${n.body ?? ''} ${n.title ?? ''}`);
  return m ? m[0] : null;
}
