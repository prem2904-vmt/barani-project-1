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

/** One item an {@link AnnotateBucket} carries for an order: which order it
 *  belongs to, plus whatever payload the caller wants back on the merged row
 *  (e.g. the outsourced tube(s) themselves, for inline actions). */
export interface AnnotateItem<D = unknown> {
  orderId: string;
  data: D;
}

/**
 * A feed that is per-SOMETHING-OTHER-THAN-an-order (outsourced is per TUBE —
 * one order can have several), carried alongside the real `WorkBucket`
 * feeds. Default behaviour is annotate-only: add its status (and `data`) to
 * a row that already exists from a `WorkBucket`, touching nothing else.
 *
 * `synthesize`, when given, additionally builds a stand-in row for an order
 * that has NO row from any `WorkBucket` at all — e.g. an order every one of
 * whose tests is outsourced never reaches "in progress" the normal way
 * (outsourced lines are excluded from the lab's own work/status machinery),
 * so it may never surface through ip/done/billing. Without `synthesize`
 * such an order is silently left off the merged list (still fully listed
 * under its own chip) — WITH it, the order gets exactly one row, built from
 * the annotate data alone (source: 'synthetic').
 */
export interface AnnotateBucket<T extends MinimalWorkOrder, D = unknown> {
  status: WorkStatus;
  items: readonly AnnotateItem<D>[];
  synthesize?: (item: AnnotateItem<D>) => T;
  /** When true, this bucket NEVER annotates an order that already has a row
   *  from a `WorkBucket` — it only ever synthesizes a new one. For a status
   *  that would be misleading as a secondary badge on a real row (e.g. a
   *  completed outsourced tube doesn't make an order that's still actively
   *  'ip' for other reasons "done" — it should only ever BECOME a 'done' row
   *  when that's the order's only status at all). Ignored without
   *  `synthesize` (there would be nothing to do either way). */
  synthesizeOnly?: boolean;
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
  /** 'order' = a real row from a `WorkBucket`; 'synthetic' = built purely
   *  from an annotate bucket's `synthesize` (no ip/done/billing row exists
   *  for this order) — callers should hide actions that need real order
   *  state (Bill / Collect / Dispatch / …) for a synthetic row; it has none
   *  to act on beyond what the annotate data itself offers. */
  source: 'order' | 'synthetic';
  /** The annotate `data` carried for each status this row picked up (keyed
   *  by status) — e.g. `annotateData.out` = the order's outsourced tubes,
   *  for inline actions. Empty for a row with no annotate-bucket status. */
  annotateData: Partial<Record<WorkStatus, unknown>>;
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
 *  each row carrying the UNION of statuses it was found under. An annotate
 *  bucket with `synthesize` can ALSO create a row on its own, for an order
 *  with no `WorkBucket` row at all (see {@link AnnotateBucket}). */
export function mergeWorkRows<T extends MinimalWorkOrder>(
  buckets: readonly WorkBucket<T>[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each bucket's own D can differ; callers get full type safety on their own AnnotateBucket<T, D> value.
  annotate: readonly AnnotateBucket<T, any>[] = [],
): MergedWorkRow<T>[] {
  const orders = new Map<string, T>();
  const statusesById = new Map<string, WorkStatus[]>();
  const sourceById = new Map<string, 'order' | 'synthetic'>();
  const annotateDataById = new Map<string, Partial<Record<WorkStatus, unknown>>>();

  const addStatus = (id: string, status: WorkStatus) => {
    const list = statusesById.get(id);
    if (list) { if (!list.includes(status)) list.push(status); }
    else statusesById.set(id, [status]);
  };

  for (const b of buckets) {
    for (const o of b.orders) {
      if (!orders.has(o.id)) { orders.set(o.id, o); sourceById.set(o.id, 'order'); }
      addStatus(o.id, b.status);
    }
  }
  for (const a of annotate) {
    for (const item of a.items) {
      const hasRealRow = sourceById.get(item.orderId) === 'order';
      if (hasRealRow && a.synthesizeOnly) continue; // this bucket only ever creates a row, never annotates a real one
      if (!statusesById.has(item.orderId)) {
        if (!a.synthesize) continue; // annotate-only: no existing row, no row created
        orders.set(item.orderId, a.synthesize(item));
        sourceById.set(item.orderId, 'synthetic');
      }
      addStatus(item.orderId, a.status);
      const data = annotateDataById.get(item.orderId) ?? {};
      data[a.status] = item.data;
      annotateDataById.set(item.orderId, data);
    }
  }

  const rows: MergedWorkRow<T>[] = [];
  for (const [id, statuses] of statusesById) {
    const primary = primaryWorkStatus(statuses);
    rows.push({
      order: orders.get(id)!,
      statuses,
      primary,
      secondary: statuses.filter(s => s !== primary),
      source: sourceById.get(id) ?? 'order',
      annotateData: annotateDataById.get(id) ?? {},
    });
  }
  return rows;
}

function businessDayOf(o: MinimalWorkOrder): string {
  return o.dailyNoDay ?? istDateOf(o.createdAt);
}

/**
 * THE sort for the merged list: group by business day, newest day first;
 * within a day, ascending by the daily serial (#1, #2 … today's order of
 * arrival) — two rows that somehow share one serial (e.g. the same patient
 * registered twice the same day, a data anomaly rather than the ordinary
 * case) break the tie by createdAt rather than leaving their relative order
 * to chance; a row with no serial for its day (shouldn't normally happen —
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
    const byCreatedAt = () => new Date(a.order.createdAt).getTime() - new Date(b.order.createdAt).getTime();
    if (sa != null && sb != null) return sa !== sb ? sa - sb : byCreatedAt();
    if (sa != null) return -1; // numbered rows before un-numbered ones
    if (sb != null) return 1;
    return byCreatedAt();
  });
}

/** {@link mergeWorkRows} + {@link sortMergedWork} — what the component calls. */
export function buildMergedWork<T extends MinimalWorkOrder>(
  buckets: readonly WorkBucket<T>[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see mergeWorkRows
  annotate: readonly AnnotateBucket<T, any>[] = [],
): MergedWorkRow<T>[] {
  return sortMergedWork(mergeWorkRows(buckets, annotate));
}

export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  ip: 'In progress',
  done: 'Completed',
  billing: 'Payments due',
  out: 'Outsourced',
};
