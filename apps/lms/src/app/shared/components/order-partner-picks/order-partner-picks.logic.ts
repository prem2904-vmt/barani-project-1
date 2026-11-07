import {
  OutsourcingOption, OutsourcingTestRow, PartnerRow,
  effectiveDestinationLabel, lineDefaultPartners, outsourcingFromOrder, outsourcingOptions,
} from '../../utils/order-outsourcing';
import { OrderLike, collectedItemIds, orderedItemId, orderedItemIds } from '../../../features/frontdesk/order-create/order-edit-items';

/**
 * The billing screens' per-line partner choice (OPS-106). Same building blocks
 * as order-create (shared/utils/order-outsourcing: defaults from Test Master,
 * options, the plain-words destination) over the ORDERED items of an existing
 * order. Locked once the item is collected (or the bill is paid) - then it only
 * says where the line goes. Saving is PATCH orders/{id}/tests with the same
 * ordered ids + one `outsourcing` pick (server: ChangeKeptLinesOutsourcingAsync).
 */
export interface OrderPartnerLine {
  /** The ordered item (test / profile / package id) - the key the server takes. */
  id: string;
  name: string;
  /** Test Master partner(s) of the item. */
  defaults: string[];
  /** The desk's stored pick: '' = Test Master partner, 'inhouse', or a partner id. */
  pick: string;
  /** "Outsourced · Metro Labs" / "In-house" - where the line goes now. */
  label: string;
  locked: boolean;
  options: OutsourcingOption[];
}

type OrderForBilling = OrderLike & { samples?: readonly { tests?: readonly { test?: { name?: string | null } | null; testName?: string | null }[] | null }[] | null };

export function orderPartnerLines(
  order: OrderForBilling | null | undefined,
  byId: (id: string) => (OutsourcingTestRow & { name?: string | null }) | undefined,
  partners: readonly PartnerRow[],
  paid: boolean,
): OrderPartnerLine[] {
  if (!order) return [];
  const { picks, effective } = outsourcingFromOrder(order as Parameters<typeof outsourcingFromOrder>[0]);
  const collected = collectedItemIds(order);
  const names = new Map<string, string>();
  for (const s of order.samples ?? []) for (const t of s.tests ?? []) {
    const id = orderedItemId(t as Parameters<typeof orderedItemId>[0]);
    const n = t.test?.name ?? t.testName;
    if (id && n && !names.has(id)) names.set(id, n);
  }
  const out: OrderPartnerLine[] = [];
  for (const id of orderedItemIds(order)) {
    const row = byId(id);
    const defaults = lineDefaultPartners(row, byId);
    if (defaults.length === 0) continue;
    const pick = picks[id] ?? '';
    const locked = paid || collected.has(id);
    const pid = effective[id];
    const label = id in effective && locked
      ? (pid ? effectiveDestinationLabel(pid, [], partners) : 'In-house')
      : effectiveDestinationLabel(pick, defaults, partners);
    out.push({ id, name: row?.name ?? names.get(id) ?? 'Test', defaults, pick, label, locked,
      options: outsourcingOptions(defaults, partners) });
  }
  return out;
}

/** The PATCH body for one pick: every ordered item stays, one choice rides along. */
export function orderPartnerBody(order: OrderLike, id: string, value: string): Record<string, unknown> {
  return { testIds: orderedItemIds(order), outsourcing: { [id]: value ?? '' }, reason: 'billing partner change' };
}
