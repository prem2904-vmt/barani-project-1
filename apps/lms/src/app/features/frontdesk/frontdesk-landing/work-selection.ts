import { Signal, computed, signal } from '@angular/core';
import { Order } from '../../../shared/models/order.model';

/**
 * Multi-select for the Frontdesk work list (In progress tab).
 *
 * The old bug: ONE raw id set was shared by every list on the page, rows were
 * tinted straight from that set, but the bar counted only the DISPATCHABLE
 * subset of it. Any row could be ticked (In Lab, Billed…), so three tinted rows
 * read "1 SELECTED". Ids also survived tab / search / date changes.
 *
 * Now the COUNT and the HIGHLIGHT come from the same computed list: the rows
 * currently shown that can take the bulk actions AND are in the set. A row that
 * can't be dispatched never gets a checkbox, and a row that drops out of the
 * list stops counting (and stops being tinted) at once.
 */
export interface WorkSelection {
  /** Selected ids, in list order — what the bulk actions send. */
  readonly ids: Signal<string[]>;
  readonly count: Signal<number>;
  /** Rows that may be selected (shown + eligible), in list order. */
  readonly selectable: Signal<string[]>;
  readonly allSelected: Signal<boolean>;
  isSelected(id: string): boolean;
  isSelectable(id: string): boolean;
  /** Toggle one row; `range` (shift-click) selects from the last toggled row. */
  toggle(id: string, range?: boolean): void;
  selectAll(): void;
  clear(): void;
}

/** A row can take "Mark dispatched" / "Bundle as package": it has a collected
 *  tube not yet sent, and no payment hold (the server would reject it). */
export function canBulkDispatch(o: Pick<Order, 'paymentHold' | 'samples'>): boolean {
  return !o.paymentHold && (o.samples ?? []).some(s => s.status === 'collected');
}

export function createWorkSelection(
  rows: Signal<readonly Pick<Order, 'id' | 'paymentHold' | 'samples'>[]>,
  canSelect: (o: Pick<Order, 'id' | 'paymentHold' | 'samples'>) => boolean = canBulkDispatch,
): WorkSelection {
  const raw = signal<ReadonlySet<string>>(new Set());
  let anchor: string | null = null;

  const selectable = computed(() => rows().filter(o => canSelect(o)).map(o => o.id));
  const selectableSet = computed(() => new Set(selectable()));
  const ids = computed(() => {
    const sel = raw();
    return selectable().filter(id => sel.has(id));
  });
  const idSet = computed(() => new Set(ids()));
  const count = computed(() => ids().length);
  const allSelected = computed(() => selectable().length > 0 && count() === selectable().length);

  return {
    ids, count, selectable, allSelected,
    isSelected: id => idSet().has(id),
    isSelectable: id => selectableSet().has(id),
    toggle(id, range = false) {
      if (!selectableSet().has(id)) return;
      const list = selectable();
      const a = range && anchor ? list.indexOf(anchor) : -1;
      const b = list.indexOf(id);
      const next = new Set(ids()); // prune stale ids on every write
      if (a >= 0 && b >= 0 && a !== b) {
        const [from, to] = a < b ? [a, b] : [b, a];
        for (let i = from; i <= to; i++) next.add(list[i]);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      anchor = id;
      raw.set(next);
    },
    selectAll() { raw.set(new Set(selectable())); },
    clear() { anchor = null; if (raw().size) raw.set(new Set()); },
  };
}

/** Work-list row status colour (owner, 2026-09-26: the old dot + coloured
 *  word, no chip). Billed / completed = green, dispatched = blue, everything
 *  on the way (created, collected, in lab, partially ready, a balance due) =
 *  amber, cancelled / rejected = red, a live repeat series = violet. The
 *  order drawer keeps its neutral chip (orderStatusState). */
export type WorkRowTone = 'green' | 'blue' | 'amber' | 'red' | 'violet';
export function workRowTone(status: string | null | undefined, label = '', series = false): WorkRowTone {
  if (series) return 'violet';
  switch (status) {
    case 'cancelled':
    case 'rejected': return 'red';
    case 'billed':
    case 'completed':
    case 'validated':
    case 'delivered': return 'green';
    case 'dispatched':
    case 'in_transit': return 'blue';
  }
  return /dispatched/i.test(label) ? 'blue' : 'amber';
}
