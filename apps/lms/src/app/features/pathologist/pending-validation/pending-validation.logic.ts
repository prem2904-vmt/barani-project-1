import { OrderTest } from '../../../shared/models/order.model';
import { formatPatientMeta, patientDisplayName } from '../../../shared/models/patient.model';
import { lineDepartment } from '../../../shared/utils/shared-tube';
import {
  OrderPriority, PRIORITY_RANK, TatState, formatDuration, linePriority, tatInfo, tatStateFor,
} from '../../../shared/utils/lab-priority';
import { matchesDailyNo } from '../../../shared/utils/daily-no';

/**
 * Pathologist queue (/pathologist) — the pure model behind the screen, so the
 * rules are testable without a DOM: order priority (Urgent / Normal — the
 * lab has no other), the TAT clock, one tile per TUBE, the ONE status word
 * per tile, the department filter and "Review next".
 */

export type Enriched = OrderTest & {
  /** The ORDER's priority (urgent / STAT → urgent; everything else normal). */
  _priority: OrderPriority;
  _tat: TatState;
  /** Minutes to TAT due (negative = overdue); null = no clock. */
  _remainingMin: number | null;
};

/** The caller's consultant scope (GET /api/validation/scope). */
export interface ValidationScope {
  /** false = every department (admins; consultants nobody has assigned yet). */
  scoped: boolean;
  departments: { id: string; name: string; code?: string | null }[];
  validatedToday: number;
  validatedTodayByMe: number;
}

export interface QueueTile {
  /** The tube id (falls back to order|department for legacy rows). */
  key: string;
  sampleId: string | null;
  /** Sample ID as printed on the tube (barcode), the tile's primary line. */
  sampleLabel: string;
  deptId: string | null;
  dept: string;
  /** FULL patient name — never cut (ND §5). */
  patientName: string;
  /** "44/F · AA0007" */
  patientMeta: string;
  items: Enriched[];
  testNames: string[];
  priority: OrderPriority;
  tat: TatState;
  remainingMin: number | null;
  anyCritical: boolean;
  mine: boolean;
}

export type StatusTone = 'red' | 'amber' | 'green';
export interface TileStatus { key: 'critical' | 'overdue' | 'due' | 'ontime'; label: string; tone: StatusTone }

/** Soonest due first; no clock last. */
const byDue = (a: { remainingMin: number | null }, b: { remainingMin: number | null }) =>
  ((a.remainingMin ?? Infinity) - (b.remainingMin ?? Infinity)) || 0;

export function isCritical(t: OrderTest): boolean {
  if (!t.currentResult) return false;
  try {
    const s = JSON.parse(t.currentResult) as { flags?: { critical?: boolean } };
    return !!s.flags?.critical;
  } catch { return false; }
}

/** Priority from the order; TAT clock from lab receipt + the test's budget. */
export function enrich(rows: OrderTest[], now: number = Date.now()): Enriched[] {
  return rows.map(t => {
    const tat = tatInfo(t.subOrder?.receivedAtLab, t.test?.tatHours, now);
    return { ...t, _priority: linePriority(t), _tat: tat.state, _remainingMin: tat.remainingMin };
  });
}

/** "Mine" = routed to me as validator, or directly assigned (the server's
 *  ?mine=true rule, applied locally so both tabs can show a count). */
export function isMine(t: OrderTest, myId: string | null | undefined): boolean {
  return !!myId && (t.validatorAssignedTo === myId || t.assignedTo === myId);
}

/** The department a result belongs to: on an in-house tube, its own test's
 *  department — a SHARED tube (integrated lab: CBC + HbA1c on one EDTA)
 *  holds several departments' tests; an outsourced tube, the tube's. */
export function deptOf(t: OrderTest): { id: string | null; name: string } {
  const d = lineDepartment(t as never);
  return { id: d.id, name: d.name ?? 'Department' };
}

/** One tile per TUBE: a tube with N tests is reviewed as one unit. Mine
 *  first, then the most urgent, then the least time left. */
export function groupBySample(items: Enriched[], myId: string | null | undefined): QueueTile[] {
  const bySample = new Map<string, Enriched[]>();
  for (const t of items) {
    // One tile per tube PER DEPARTMENT: each department reviews its own
    // lines of a shared tube.
    const key = `${t.subOrder?.id ?? t.subOrder?.order?.id ?? t.id}|${deptOf(t).id ?? ''}`;
    const list = bySample.get(key);
    if (list) list.push(t); else bySample.set(key, [t]);
  }
  const tiles = Array.from(bySample.entries()).map(([key, group]): QueueTile => {
    const worst = [...group].sort((a, b) => byDue({ remainingMin: a._remainingMin }, { remainingMin: b._remainingMin }))[0];
    const patient = worst.subOrder?.order?.patient;
    const d = deptOf(worst);
    return {
      key,
      sampleId: worst.subOrder?.id ?? null,
      sampleLabel: worst.subOrder?.barcode ?? worst.subOrder?.id?.slice(0, 8) ?? 'Sample',
      deptId: d.id,
      dept: d.name,
      patientName: patientDisplayName(patient) || 'Patient',
      patientMeta: patient ? formatPatientMeta(patient) : '',
      items: group,
      testNames: group.map(t => t.test?.name ?? 'Test'),
      priority: group.some(t => t._priority === 'urgent') ? 'urgent' : 'normal',
      tat: tatStateFor(worst._remainingMin),
      remainingMin: worst._remainingMin,
      anyCritical: group.some(isCritical),
      mine: group.some(t => isMine(t, myId)),
    };
  });
  return tiles.sort((a, b) =>
    (a.mine === b.mine ? 0 : a.mine ? -1 : 1)
    || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || byDue(a, b));
}

/** ONE status per tile: a dot + coloured word (ND §6). Critical outranks
 *  time; then the TAT clock: Overdue › Due in 20m › On time. (Priority is
 *  the group the tile sits in, not a status word.) */
export function tileStatus(t: Pick<QueueTile, 'anyCritical' | 'remainingMin'>): TileStatus {
  if (t.anyCritical) return { key: 'critical', label: 'Critical', tone: 'red' };
  const state = tatStateFor(t.remainingMin);
  if (state === 'overdue') return { key: 'overdue', label: 'Overdue', tone: 'red' };
  if (state === 'dueSoon') return { key: 'due', label: `Due in ${formatDuration(t.remainingMin!)}`, tone: 'amber' };
  return { key: 'ontime', label: 'On time', tone: 'green' };
}

/** The ONE primary: the tube to open next — mine first, then critical,
 *  then Urgent orders, then the least time left. */
export function nextTile(tiles: QueueTile[]): QueueTile | null {
  if (!tiles.length) return null;
  return [...tiles].sort((a, b) =>
    (a.mine === b.mine ? 0 : a.mine ? -1 : 1)
    || (a.anyCritical === b.anyCritical ? 0 : a.anyCritical ? -1 : 1)
    || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || byDue(a, b))[0];
}

/** Departments present in the queue, for the card-header filter (only shown
 *  when there is more than one). */
export function departmentsIn(tiles: QueueTile[]): { id: string; name: string; count: number }[] {
  const m = new Map<string, { id: string; name: string; count: number }>();
  for (const t of tiles) {
    const id = t.deptId ?? t.dept;
    const e = m.get(id);
    if (e) e.count++; else m.set(id, { id, name: t.dept, count: 1 });
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function matchesQuery(t: OrderTest, q: string): boolean {
  if (!q) return true;
  return matchesDailyNo(q, t.subOrder)   // "12" / "#12" = today's daily patient number
    || patientDisplayName(t.subOrder?.order?.patient).toLowerCase().includes(q)
    || (t.subOrder?.order?.patient?.mrn ?? '').toLowerCase().includes(q)
    || (t.subOrder?.barcode ?? '').toLowerCase().includes(q)
    || (t.test?.name ?? '').toLowerCase().includes(q);
}
