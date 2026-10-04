/**
 * Lab PRIORITY vs TAT — two different things, never mixed (owner 2026-09-29).
 *
 *  - PRIORITY is what the front desk set on the ORDER. The lab has exactly
 *    two: Urgent and Normal. Legacy / internal values fold in: `stat`
 *    (appointments map emergency → STAT) is Urgent; `routine`, `normal`, ''
 *    and anything unknown are Normal. There is no "High" priority.
 *
 *  - TAT is a clock: how long is left before the test's turnaround budget
 *    (from lab receipt) runs out. It is a separate chip, worded as time —
 *    "Overdue", "Due in 20m", "Due 14:30" — and is never called a priority.
 *
 * Queues group by priority (Urgent first) and sort by TAT due time within
 * each group (overdue first).
 */

export type OrderPriority = 'urgent' | 'normal';
export type TatState = 'overdue' | 'dueSoon' | 'onTrack';

/** Minutes before the due time at which a test counts as "due soon". */
export const DUE_SOON_MIN = 60;

/** Order priority → Urgent | Normal. Only `urgent` and `stat` are urgent. */
export function normalizePriority(p: string | null | undefined): OrderPriority {
  const v = (p ?? '').trim().toLowerCase();
  return v === 'urgent' || v === 'stat' ? 'urgent' : 'normal';
}

export function priorityLabel(p: string | null | undefined): 'Urgent' | 'Normal' {
  return normalizePriority(p) === 'urgent' ? 'Urgent' : 'Normal';
}

/** The ORDER priority of a work line (OrderTest → subOrder → order). */
export function linePriority(t: { subOrder?: { order?: { priority?: string | null } | null } | null } | null | undefined): OrderPriority {
  return normalizePriority(t?.subOrder?.order?.priority);
}

export const PRIORITY_RANK: Record<OrderPriority, number> = { urgent: 0, normal: 1 };

export interface TatInfo {
  state: TatState;
  /** Minutes left (negative = overdue); null when the test has no TAT
   *  budget or the tube isn't received yet — there is no clock to show. */
  remainingMin: number | null;
  /** Epoch ms the test is due; null with remainingMin. */
  dueAt: number | null;
}

/** TAT state from minutes remaining. No clock → on track (nothing to flag). */
export function tatStateFor(remainingMin: number | null | undefined): TatState {
  if (remainingMin == null || !Number.isFinite(remainingMin)) return 'onTrack';
  if (remainingMin <= 0) return 'overdue';
  if (remainingMin <= DUE_SOON_MIN) return 'dueSoon';
  return 'onTrack';
}

/** TAT from lab receipt + the test's budget (hours). */
export function tatInfo(
  receivedAtLab: string | null | undefined,
  tatHours: number | null | undefined,
  now: number = Date.now(),
): TatInfo {
  const budgetMin = (tatHours ?? 0) * 60;
  const received = receivedAtLab ? new Date(receivedAtLab).getTime() : NaN;
  if (!(budgetMin > 0) || !Number.isFinite(received)) {
    return { state: 'onTrack', remainingMin: null, dueAt: null };
  }
  const dueAt = received + budgetMin * 60000;
  const remainingMin = (dueAt - now) / 60000;
  return { state: tatStateFor(remainingMin), remainingMin, dueAt };
}

/** "45m", "1h", "1h 20m", "2d 3h". Minutes are rounded (min 1). */
export function formatDuration(min: number): string {
  const m = Math.max(1, Math.round(Math.abs(min)));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h < 24) return r ? `${h}h ${r}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

function pad2(n: number): string { return n < 10 ? `0${n}` : `${n}`; }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Due 14:30" today, "Due 30 Sep, 14:30" on another day. */
export function formatDueAt(dueAt: number, now: number = Date.now()): string {
  const d = new Date(dueAt);
  const n = new Date(now);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? `Due ${hm}` : `Due ${d.getDate()} ${MONTHS[d.getMonth()]}, ${hm}`;
}

/**
 * The TAT chip's words. Overdue → "Overdue" (with how long in `detail`);
 * within the hour → "Due in 20m" / "Due in 1h"; otherwise the plain due
 * time. Empty string when there is no clock (the chip hides).
 */
export function tatLabel(info: Pick<TatInfo, 'remainingMin' | 'dueAt'>, now: number = Date.now()): string {
  const rem = info.remainingMin;
  if (rem == null) return '';
  const state = tatStateFor(rem);
  if (state === 'overdue') return 'Overdue';
  if (state === 'dueSoon') return `Due in ${formatDuration(rem)}`;
  return info.dueAt != null ? formatDueAt(info.dueAt, now) : `Due in ${formatDuration(rem)}`;
}

/** Tooltip / screen-reader detail: "Overdue by 1h 20m", "Due in 3h 5m". */
export function tatDetail(remainingMin: number | null | undefined): string {
  if (remainingMin == null) return 'No turnaround time set';
  return remainingMin <= 0
    ? `Overdue by ${formatDuration(remainingMin)}`
    : `Due in ${formatDuration(remainingMin)}`;
}

/** Queue order: Urgent first, then soonest due (overdue first); lines with
 *  no TAT clock sink to the end of their priority group. */
export function comparePriorityThenDue(
  a: { priority: OrderPriority; remainingMin: number | null },
  b: { priority: OrderPriority; remainingMin: number | null },
): number {
  return (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    || ((a.remainingMin ?? Number.POSITIVE_INFINITY) - (b.remainingMin ?? Number.POSITIVE_INFINITY))
    || 0;
}

/** Soonest-due of several remaining-minute values (null = no clock). */
export function minRemaining(values: Array<number | null | undefined>): number | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? Math.min(...v) : null;
}
