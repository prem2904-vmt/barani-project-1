import { OrderTest } from '../../../shared/models/order.model';
import { formatPatientMeta, patientDisplayName } from '../../../shared/models/patient.model';

/**
 * Pathologist queue (/pathologist) — the pure model behind the screen, so the
 * rules are testable without a DOM: TAT urgency, one tile per TUBE, the ONE
 * status word per tile, the department filter and "Review next".
 */

export type Level = 'urgent' | 'high' | 'normal';
export type Enriched = OrderTest & { _level: Level; _remainingMin: number };

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
  level: Level;
  remainingMin: number;
  anyCritical: boolean;
  mine: boolean;
}

export type StatusTone = 'red' | 'amber' | 'green';
export interface TileStatus { key: 'critical' | 'overdue' | 'due' | 'ontime'; label: string; tone: StatusTone }

const RANK: Record<Level, number> = { urgent: 0, high: 1, normal: 2 };

export function isCritical(t: OrderTest): boolean {
  if (!t.currentResult) return false;
  try {
    const s = JSON.parse(t.currentResult) as { flags?: { critical?: boolean } };
    return !!s.flags?.critical;
  } catch { return false; }
}

/** TAT from lab receipt: overdue = urgent, ≤ 60 min left = high. */
export function enrich(rows: OrderTest[], now: number = Date.now()): Enriched[] {
  return rows.map(t => {
    const ral = t.subOrder?.receivedAtLab;
    const budget = (t.test?.tatHours ?? 0) * 60;
    const elapsed = ral ? (now - new Date(ral).getTime()) / 60000 : 0;
    const remaining = budget - elapsed;
    const level: Level = remaining <= 0 ? 'urgent' : remaining <= 60 ? 'high' : 'normal';
    return { ...t, _level: level, _remainingMin: remaining };
  });
}

/** "Mine" = routed to me as validator, or directly assigned (the server's
 *  ?mine=true rule, applied locally so both tabs can show a count). */
export function isMine(t: OrderTest, myId: string | null | undefined): boolean {
  return !!myId && (t.validatorAssignedTo === myId || t.assignedTo === myId);
}

export function deptOf(t: OrderTest): { id: string | null; name: string } {
  const d = t.subOrder?.department ?? t.test?.department;
  return { id: t.subOrder?.departmentId ?? d?.id ?? null, name: d?.name ?? 'Department' };
}

/** One tile per TUBE: a tube with N tests is reviewed as one unit. Mine
 *  first, then the most urgent, then the least time left. */
export function groupBySample(items: Enriched[], myId: string | null | undefined): QueueTile[] {
  const bySample = new Map<string, Enriched[]>();
  for (const t of items) {
    const key = t.subOrder?.id ?? `${t.subOrder?.order?.id ?? t.id}|${deptOf(t).id ?? ''}`;
    const list = bySample.get(key);
    if (list) list.push(t); else bySample.set(key, [t]);
  }
  const tiles = Array.from(bySample.entries()).map(([key, group]): QueueTile => {
    const worst = [...group].sort((a, b) => RANK[a._level] - RANK[b._level])[0];
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
      level: worst._level,
      remainingMin: Math.min(...group.map(t => t._remainingMin)),
      anyCritical: group.some(isCritical),
      mine: group.some(t => isMine(t, myId)),
    };
  });
  return tiles.sort((a, b) =>
    (a.mine === b.mine ? 0 : a.mine ? -1 : 1)
    || RANK[a.level] - RANK[b.level]
    || a.remainingMin - b.remainingMin);
}

/** ONE status per tile: a dot + coloured word (ND §6). Critical outranks
 *  time; then Overdue › Due in N min › On time. */
export function tileStatus(t: Pick<QueueTile, 'anyCritical' | 'level' | 'remainingMin'>): TileStatus {
  if (t.anyCritical) return { key: 'critical', label: 'Critical', tone: 'red' };
  if (t.level === 'urgent') return { key: 'overdue', label: 'Overdue', tone: 'red' };
  if (t.level === 'high') return { key: 'due', label: `Due in ${Math.max(1, Math.round(t.remainingMin))} min`, tone: 'amber' };
  return { key: 'ontime', label: 'On time', tone: 'green' };
}

/** The ONE primary: the tube to open next — mine first, then critical,
 *  then the most urgent / least time left. */
export function nextTile(tiles: QueueTile[]): QueueTile | null {
  if (!tiles.length) return null;
  return [...tiles].sort((a, b) =>
    (a.mine === b.mine ? 0 : a.mine ? -1 : 1)
    || (a.anyCritical === b.anyCritical ? 0 : a.anyCritical ? -1 : 1)
    || RANK[a.level] - RANK[b.level]
    || a.remainingMin - b.remainingMin)[0];
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
  return patientDisplayName(t.subOrder?.order?.patient).toLowerCase().includes(q)
    || (t.subOrder?.order?.patient?.mrn ?? '').toLowerCase().includes(q)
    || (t.subOrder?.barcode ?? '').toLowerCase().includes(q)
    || (t.test?.name ?? '').toLowerCase().includes(q);
}
