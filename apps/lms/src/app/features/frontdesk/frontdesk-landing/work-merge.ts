import { istDateOf } from '../../../shared/utils/lab-clock';
import { WorkStatus } from './work-status-filter';

/**
 * The "no chip" front-desk work list (owner, 2026-10-01): with every status
 * chip off, the four feeds (In progress / Completed / Payments due /
 * Outsourced) used to render as four separate SECTIONS, each order possibly
 * repeated across sections (e.g. an in-progress order with a balance due
 * appeared once under In progress and again under Payments due). This file
 * is the pure, unit-tested core of the replacement: ONE merged list, each
 * order exactly once, sorted by the day's arrival order (the daily serial).
 *
 * A chip STILL filters to a single status exactly as before
 * (work-status-filter.ts) — this module only drives the no-chip view.
 */

export interface MinimalWorkOrder {
  id: string;
  createdAt: string | Date;
  /** Daily patient number ("#N") + the IST day it was issued for
   *  (utils/daily-no.ts) — on-screen only, never printed. */
  dailyNo?: number | null;
  dailyNoDay?: string | null;
}

/** One status feed, already filtered by the work card's search + date range
 *  (the SAME filtered signals the single-chip views use — shownInProgress /
 *  shownCompleted / shownPaymentsDueOnly). Every order here becomes (or joins)
 *  a merged row. */
export interface WorkBucket<T extends MinimalWorkOrder> {
  status: WorkStatus;
  orders: readonly T[];
}

/** A feed that only ANNOTATES rows that already exist from a `WorkBucket` —
 *  it never introduces a new row on its own. Outsourced is per-TUBE, not
 *  per-order (one order can have several outsourced tubes, and the tube
 *  carries its own upload/attach UI — ONE home, `OutsourcedListComponent`);
 *  an order with a pending outsourced tube is, in practice, always ALSO
 *  in-progress or completed, so it already has a row from a `WorkBucket`.
 *  The rare order that is outsourced-only for the chosen range (no row from
 *  any other feed) is intentionally left off the merged list — it still
 *  lists in full under the Outsourced chip — rather than render a
 *  field-sparse row built from tube data alone. */
export interface AnnotateBucket {
  status: WorkStatus;
  ids: ReadonlySet<string> | readonly string[];
}

export interface MergedWorkRow<T extends MinimalWorkOrder> {
  order: T;
  /** Every status this order is currently shown under (insertion order,
   *  not precedence order). */
  statuses: readonly WorkStatus[];
  /** The status whose dot/label the merged row leads with (see
   *  {@link primaryWorkStatus}). */
  primary: WorkStatus;
  /** The rest — rendered as small secondary badges, never a second row. */
  secondary: readonly WorkStatus[];
}

/**
 * Precedence when an order sits in more than one feed — which status the
 * merged row's dot/label leads with. Highest first:
 *
 *   Outsourced (pending) > Payments due > In progress > Completed
 *
 * Reasoning (owner-approved rule of thumb — what most needs the desk's
 * ATTENTION): an outsourced tube awaiting the partner lab's report is the
 * most "stuck" state and the one the desk is most likely to be chasing;
 * payments due blocks hand-over on money the desk must still collect;
 * in-progress is normal, already-moving work; completed is the least
 * urgent — it is done, nothing left to chase (that's also the ordinary read
 * of "the order's status", so it loses to any still-open concern).
 */
const PRECEDENCE: readonly WorkStatus[] = ['out', 'billing', 'ip', 'done'];

export function primaryWorkStatus(statuses: Iterable<WorkStatus>): WorkStatus {
  const set = statuses instanceof Set ? statuses : new Set(statuses);
  for (const s of PRECEDENCE) if (set.has(s)) return s;
  // Every row is built from at least one bucket — this is unreachable in
  // practice; fall back to the commonest status rather than throw.
  return 'ip';
}

/** Dedupe by order id across every status feed (annotate feeds included),
 *  each row carrying the UNION of statuses it was found under. */
export function mergeWorkRows<T extends MinimalWorkOrder>(
  buckets: readonly WorkBucket<T>[],
  annotate: readonly AnnotateBucket[] = [],
): MergedWorkRow<T>[] {
  const orders = new Map<string, T>();
  const statusesById = new Map<string, WorkStatus[]>();

  const addStatus = (id: string, status: WorkStatus) => {
    const list = statusesById.get(id);
    if (list) { if (!list.includes(status)) list.push(status); }
    else statusesById.set(id, [status]);
  };

  for (const b of buckets) {
    for (const o of b.orders) {
      if (!orders.has(o.id)) orders.set(o.id, o);
      addStatus(o.id, b.status);
    }
  }
  // Annotate-only feeds never create a row by themselves.
  for (const a of annotate) {
    for (const id of a.ids) {
      if (statusesById.has(id)) addStatus(id, a.status);
    }
  }

  const rows: MergedWorkRow<T>[] = [];
  for (const [id, statuses] of statusesById) {
    const primary = primaryWorkStatus(statuses);
    rows.push({ order: orders.get(id)!, statuses, primary, secondary: statuses.filter(s => s !== primary) });
  }
  return rows;
}

function businessDayOf(o: MinimalWorkOrder): string {
  return o.dailyNoDay ?? istDateOf(o.createdAt);
}

/**
 * THE sort for the merged list: group by business day, newest day first;
 * within a day, ascending by the daily serial (#1, #2 … today's order of
 * arrival); a row with no serial for its day (shouldn't normally happen —
 * every order gets one on creation — but an older, pre-feature order might
 * lack one) sorts after the numbered rows of that day, oldest-created first.
 */
export function sortMergedWork<T extends MinimalWorkOrder>(rows: readonly MergedWorkRow<T>[]): MergedWorkRow<T>[] {
  return [...rows].sort((a, b) => {
    const da = businessDayOf(a.order);
    const db = businessDayOf(b.order);
    if (da !== db) return da < db ? 1 : -1; // newest day first
    const sa = a.order.dailyNo ?? null;
    const sb = b.order.dailyNo ?? null;
    if (sa != null && sb != null) return sa - sb;
    if (sa != null) return -1; // numbered rows before un-numbered ones
    if (sb != null) return 1;
    return new Date(a.order.createdAt).getTime() - new Date(b.order.createdAt).getTime();
  });
}

/** {@link mergeWorkRows} + {@link sortMergedWork} — what the component calls. */
export function buildMergedWork<T extends MinimalWorkOrder>(
  buckets: readonly WorkBucket<T>[],
  annotate: readonly AnnotateBucket[] = [],
): MergedWorkRow<T>[] {
  return sortMergedWork(mergeWorkRows(buckets, annotate));
}

export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  ip: 'In progress',
  done: 'Completed',
  billing: 'Payments due',
  out: 'Outsourced',
};
