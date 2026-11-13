/**
 * Front-desk work card: STATUS chips (In progress / Completed / Payments due /
 * Outsourced) and the DATE filter (Today / Yesterday / … / custom range) are two
 * INDEPENDENT filters that combine (owner, 2026-09-30):
 *  - tapping a status chip filters to that status;
 *  - tapping the SAME chip again turns it off → every status is listed;
 *  - the date range stays applied either way (switching / clearing a status
 *    never resets or hides it).
 * Pure helpers so the rule is unit-testable without the 3k-line component.
 */
export type WorkStatus = 'ip' | 'done' | 'billing' | 'out';
/** null = no status chip on — all statuses. */
export type WorkStatusFilter = WorkStatus | null;

const STATUSES: readonly WorkStatus[] = ['ip', 'done', 'billing', 'out'];

/** Tap on a chip: the same chip again clears the status filter. */
export function toggleWorkStatus(current: WorkStatusFilter, tapped: WorkStatus): WorkStatusFilter {
  return current === tapped ? null : tapped;
}

/** Does the list for status `s` render under `filter`? */
export function workStatusShown(filter: WorkStatusFilter, s: WorkStatus): boolean {
  return filter === null || filter === s;
}

/** localStorage value ('all' = cleared). */
export function workStatusStoreValue(filter: WorkStatusFilter): string {
  return filter ?? 'all';
}

/** Restore a persisted choice. Unknown / nothing stored ⇒ In progress (the
 *  historical default); 'all' ⇒ the cleared state. */
export function parseWorkStatus(raw: string | null | undefined): WorkStatusFilter {
  if (raw === 'all') return null;
  return (STATUSES as readonly string[]).includes(raw ?? '') ? raw as WorkStatus : 'ip';
}

export interface WorkBounds { start: number; end: number; isToday: boolean }

/**
 * THE date rule every status list shares. A custom / past range = created in
 * the range. "Today" = today's work feed: anything created today, plus work
 * the server's today feed carried in (an older order that had activity today —
 * e.g. its report was released today), so hand-over never misses it.
 */
export function inWorkWindow(createdAt: string | Date | null | undefined, b: WorkBounds, inTodayFeed = false): boolean {
  if (b.isToday && inTodayFeed) return true;
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  return t >= b.start && t < b.end;
}

/**
 * `inWorkWindow`'s "today feed" bit — but computed from REAL activity, never
 * from "the order happens to be present in the fetched today feed". The
 * server's today feed (OrderRepository.TodayQuery) carries in up to 30 days
 * of still-undelivered ready-for-handover orders (validated / completed /
 * partially_validated) so a stale hand-over is never dropped — every one of
 * those is trivially "in the feed" whether its status changed an hour ago or
 * three weeks ago. Passing that bare feed-membership straight into
 * `inWorkWindow` defeated the Today view's date scope entirely (owner
 * 2026-10-09: "Completed shows 20+ including old orders"). The row's own
 * `updatedAt` — stamped by OrderRepository.MutateOrderAsync every time
 * RecomputeStatusAsync flips the order's status — tells the two apart: only
 * an order actually touched TODAY earns the Today view's hand-over bonus; an
 * old, merely-still-open straggler falls back to its creation date like any
 * other historical row. */
export function hadTodayActivity(updatedAt: string | Date | null | undefined, b: WorkBounds): boolean {
  if (!b.isToday || !updatedAt) return false;
  const t = new Date(updatedAt).getTime();
  return t >= b.start && t < b.end;
}

/**
 * Every order that still carries an outstanding balance (OPS-132): what the Payments due TAB lists and counts,
 * whatever the date range. `feed` is the loaded day/range feed, `fetched` the orders read by id for dues that
 * are not in it (an old due). A fully paid / refund-owed bill (balance <= 0) and a cancelled order never count;
 * an order with two open bills is listed once; a due whose order is not loaded yet is simply not here (yet).
 */
export function dueOrders<O extends { id: string; status?: string | null }>(
  bills: readonly { orderId: string; balance: number }[],
  feed: readonly O[],
  fetched: Readonly<Record<string, O>>,
): O[] {
  const out: O[] = [];
  const seen = new Set<string>();
  for (const b of bills) {
    if (!(b.balance > 0) || seen.has(b.orderId)) continue;
    const o = feed.find(x => x.id === b.orderId) ?? fetched[b.orderId];
    if (!o || o.status === 'cancelled') continue;
    seen.add(b.orderId);
    out.push(o);
  }
  return out;
}

/** The dues inside the chosen date range — feeds the merged "no chip" list only. Follows the order's CREATION day
 *  (no "touched today" bonus: that is for hand-over of a finished report), so an old order merely updated today
 *  never shows under Today (OPS-132). */
export function dueInWindow<O extends { createdAt?: string | Date | null }>(orders: readonly O[], b: WorkBounds): O[] {
  return orders.filter(o => inWorkWindow(o.createdAt, b, false));
}
