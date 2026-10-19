import { OrderTest } from '../../../shared/models/order.model';
import {
  OrderPriority, TatState, comparePriorityThenDue, linePriority, tatInfo,
} from '../../../shared/utils/lab-priority';

/**
 * My Work queue model (pure, DOM-free): the groups are the ORDER's priority
 * — Urgent / Normal, nothing else — and TAT is a per-line clock that only
 * orders rows within a group and drives the "Overdue / Due in …" chip.
 * (Before 2026-09-29 the groups were TAT buckets labelled urgent / high /
 * normal, so a front-desk Urgent order wasn't urgent in the lab until it
 * was overdue, and a non-existent "High" priority appeared.)
 */
export type WorkLine = OrderTest & {
  _priority: OrderPriority;
  _tat: TatState;
  _remainingMin: number | null;
  _dueAt: number | null;
};

export function enrichWorkLines(rows: OrderTest[], now: number = Date.now()): WorkLine[] {
  return rows.map(t => {
    const tat = tatInfo(t.subOrder?.receivedAtLab, t.test?.tatHours, now);
    return { ...t, _priority: linePriority(t), _tat: tat.state, _remainingMin: tat.remainingMin, _dueAt: tat.dueAt };
  });
}

const key = (t: WorkLine) => ({ priority: t._priority, remainingMin: t._remainingMin });

/** Urgent group first, then Normal; each sorted soonest-due first. */
export function groupByPriority<T extends WorkLine>(lines: T[]):
  Array<{ priority: OrderPriority; label: 'Urgent' | 'Normal'; items: T[] }> {
  const sorted = [...lines].sort((a, b) => comparePriorityThenDue(key(a), key(b)));
  return [
    { priority: 'urgent' as const, label: 'Urgent' as const, items: sorted.filter(t => t._priority === 'urgent') },
    { priority: 'normal' as const, label: 'Normal' as const, items: sorted.filter(t => t._priority === 'normal') },
  ];
}

/** The line due soonest (overdue first); lines without a clock last. */
export function soonestDue<T extends WorkLine>(lines: T[]): T {
  return [...lines].sort((a, b) =>
    ((a._remainingMin ?? Infinity) - (b._remainingMin ?? Infinity)) || 0)[0];
}
