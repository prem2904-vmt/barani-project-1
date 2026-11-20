import type { OrderTest } from '../../../shared/models/order.model';
import type { OrderPriority } from '../../../shared/utils/lab-priority';
import { tatDetail, tatLabel, tatStateFor } from '../../../shared/utils/lab-priority';
import { GridFold, JourneyStep, WorkStatus, waitText } from '../../../shared/utils/work-grid';
import type { WorkLine } from './my-work.priority';

/**
 * My Work as a GRID (owner 2026-11-20): the pure row model + column plan behind `my-work-grid.component.ts`. Every
 * word and action here comes from what the tile list showed (tube / patient / tests / TAT / draft / re-entry / owner);
 * nothing is invented. The component only draws it.
 *
 *  Sample focus  → one row per TUBE (Sample ID first);   row tap = open / pick the tube (the old card tap).
 *  Patient focus → one row per PATIENT order;            row tap = show / hide their tubes (the old card tap),
 *                  each tube in the inline detail row keeps the tube tap.
 *  Completed     → one row per finished tube;            row tap = view the results read-only.
 */

export type MwTab = 'intake' | 'my_work' | 'service_queue' | 'rejected' | 'completed' | 'culture';

/** A tube as My Work groups it (`tubesIn` / `sampleRows`). */
export interface MwTube {
  sampleId: string;
  deptName: string;
  barcode: string;
  tests: WorkLine[];
  allDone: boolean;
  hasDraft: boolean;
  assignedTo: string | null;
  rejections: Array<{ testName: string; reason: string }>;
  remainingMin: number | null;
  dueAt: number | null;
  patientName?: string;
  patientMeta?: string;
}

/** A patient order as My Work groups it (`patientGroups`). */
export interface MwGroup {
  orderId: string;
  patientName: string;
  patientMeta: string;
  items: WorkLine[];
  priority: OrderPriority;
  remainingMin: number | null;
  dueAt: number | null;
}

/** A finished tube (`completedTubes`). */
export interface MwDoneTube {
  sampleId: string;
  tests: OrderTest[];
  barcode: string;
  deptName: string;
  patientName: string;
  patientMeta: string;
  testNames: string;
  status: 'validated' | 'partial' | 'submitted' | string;
  openLines: number;
  completedAt: string | null;
}

export type MwActionId = 'enter' | 'pick' | 'tubes' | 'delegate' | 'print' | 'edit' | 'view';
export interface MwAction { id: MwActionId; label: string; aria: string }

export type MwRow =
  | { kind: 'tube'; id: string; priority: OrderPriority; tube: MwTube & { patientName: string; patientMeta: string } }
  | { kind: 'patient'; id: string; priority: OrderPriority; group: MwGroup; tubes: MwTube[]; open: boolean }
  | { kind: 'detail'; id: string; priority: OrderPriority; group: MwGroup; tubes: MwTube[] }
  | { kind: 'done'; id: string; done: MwDoneTube };

/** Who / what the row's rules need to know. */
export interface MwRules { tab: MwTab; myId: string; canReassign: boolean; canEdit: boolean }

const label = (t: Pick<MwTube, 'barcode' | 'sampleId'>) => t.barcode || t.sampleId;

// ── Status: ONE neutral pill + dot per row ─────────────────────────────────────

export function tubeStatus(t: MwTube, r: Pick<MwRules, 'tab' | 'myId'>, ownerName: (id: string) => string = () => 'Claimed'): WorkStatus {
  if (r.tab === 'service_queue') {
    if (t.assignedTo) {
      if (t.assignedTo === r.myId) return { label: 'Claimed · You', tone: 'neutral' };
      const who = ownerName(t.assignedTo);
      // The owner's name is only known once "Show claimed" loaded the users; until then just "Claimed".
      return { label: who && who !== 'Claimed' ? `Claimed · ${who}` : 'Claimed', tone: 'neutral' };
    }
    return { label: 'In queue', tone: 'neutral' };
  }
  if (t.rejections.length || t.tests.some(x => x.status === 're_entry')) return { label: 'Re-entry', tone: 'rose' };
  if (t.allDone) return { label: 'Entered', tone: 'green' };
  if (t.hasDraft) return { label: 'Draft', tone: 'violet' };
  return { label: 'To enter', tone: 'neutral' };
}

export function groupStatus(tubes: MwTube[], r: Pick<MwRules, 'tab' | 'myId'>, ownerName?: (id: string) => string): WorkStatus {
  const s = tubes.map(t => tubeStatus(t, r, ownerName));
  if (r.tab === 'service_queue') return s.length === 1 ? s[0] : { label: `${tubes.length} tubes`, tone: 'neutral' };
  // Rose (sent back) wins, then a draft in hand, then any tube still to enter; "Entered" only when every tube is in.
  return s.find(x => x.tone === 'rose') ?? s.find(x => x.tone === 'violet') ?? s.find(x => x.tone !== 'green') ?? s[0]
    ?? { label: 'To enter', tone: 'neutral' };
}

export function doneStatus(d: Pick<MwDoneTube, 'status' | 'openLines'>): WorkStatus {
  if (d.status === 'validated') return { label: 'Validated', tone: 'green' };
  if (d.status === 'partial') return { label: `Partly validated · ${d.openLines} open`, tone: 'sky' };
  return { label: 'Submitted', tone: 'violet' };
}

// ── Journey: the lab's real steps for a tube ───────────────────────────────────

/** Collected → Received → Entered → Validated; the open step is "now" (rose when past TAT). */
export function tubeJourney(t: Pick<MwTube, 'tests' | 'allDone' | 'remainingMin'>): JourneyStep[] {
  const late = !t.allDone && t.remainingMin != null && t.remainingMin <= 0;
  const received = t.tests.some(x => !!x.subOrder?.receivedAtLab);
  const validated = t.tests.length > 0 && t.tests.every(x => x.status === 'validated');
  return [
    { label: 'Collected', state: 'done' },
    { label: 'Received', state: received ? 'done' : 'now' },
    { label: 'Entered', state: t.allDone ? 'done' : !received ? 'todo' : late ? 'late' : 'now' },
    { label: 'Validated', state: validated ? 'done' : t.allDone ? 'now' : 'todo' },
  ];
}

export function doneJourney(d: Pick<MwDoneTube, 'status'>): JourneyStep[] {
  return [
    { label: 'Collected', state: 'done' }, { label: 'Received', state: 'done' }, { label: 'Entered', state: 'done' },
    { label: 'Validated', state: d.status === 'validated' ? 'done' : 'now' },
  ];
}

// ── TAT: the clock word, rose only when overdue; "in lab 40m" under it ──────────

export interface MwTat { text: string; late: boolean; detail: string; sub: string }
export function tatCell(x: { remainingMin: number | null; dueAt: number | null }, lines: OrderTest[], done = false, now = Date.now()): MwTat {
  const received = lines.map(l => l.subOrder?.receivedAtLab).filter((v): v is string => !!v).sort()[0] ?? null;
  const sub = received ? `in lab ${waitText(received, now)}` : '';
  if (done || x.remainingMin == null) return { text: done ? 'Done' : '—', late: false, detail: done ? 'Every test entered' : tatDetail(null), sub };
  return { text: tatLabel(x, now), late: tatStateFor(x.remainingMin) === 'overdue', detail: tatDetail(x.remainingMin), sub };
}

// ── Actions: ONE primary at the row end, the rest in ⋯ ──────────────────────────

/** The tube tap (`onCardActivate`) as a button: Pick up in the queue, Enter / Continue / Re-enter in My Work. */
export function tubePrimary(t: MwTube, r: Pick<MwRules, 'tab' | 'myId'>): MwAction | null {
  if (r.tab === 'service_queue') {
    if (t.assignedTo && t.assignedTo !== r.myId) return null;   // someone else's tube is not ours to pick up
    return { id: 'pick', label: 'Pick up', aria: `Pick up tube ${label(t)}` };
  }
  if (t.allDone) return null;   // nothing left to enter
  if (t.rejections.length || t.tests.some(x => x.status === 're_entry')) return { id: 'enter', label: 'Re-enter', aria: `Re-enter results for ${label(t)}` };
  if (t.hasDraft) return { id: 'enter', label: 'Continue', aria: `Continue results for ${label(t)}` };
  return { id: 'enter', label: 'Enter results', aria: `Enter results for ${label(t)}` };
}

/** Delegate shows where the tile showed it: supervisors in the queue, any open tube in My Work. */
export function tubeMenu(t: MwTube, r: Pick<MwRules, 'tab' | 'canReassign'>): MwAction[] {
  const can = r.tab === 'service_queue' ? r.canReassign : !t.allDone;
  return can ? [{ id: 'delegate', label: 'Delegate', aria: `Delegate ${label(t)}` }] : [];
}

/** A patient row: its one tube's action, or "N tubes" (the old expand) when it has several. */
export function groupPrimary(tubes: MwTube[], r: Pick<MwRules, 'tab' | 'myId'>, open: boolean): MwAction | null {
  if (tubes.length === 1) return tubePrimary(tubes[0], r);
  return { id: 'tubes', label: `${tubes.length} tubes`, aria: `${open ? 'Hide' : 'Show'} ${tubes.length} tubes` };
}

/** Completed: Print (once validated / partly) or Edit is the primary; View · Edit in ⋯. Row tap = View. */
export function donePrimary(d: MwDoneTube, r: Pick<MwRules, 'canEdit'>): MwAction | null {
  if (d.status === 'validated' || d.status === 'partial') return { id: 'print', label: 'Print', aria: `Print report for ${label(d)}` };
  return r.canEdit ? { id: 'edit', label: 'Edit', aria: `Edit ${label(d)}` } : null;
}
export function doneMenu(d: MwDoneTube, r: Pick<MwRules, 'canEdit'>): MwAction[] {
  const p = donePrimary(d, r);
  const out: MwAction[] = [{ id: 'view', label: 'View results', aria: `View results for ${label(d)}` }];
  if (r.canEdit && p?.id !== 'edit') out.push({ id: 'edit', label: 'Edit results', aria: `Edit ${label(d)}` });
  return out;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/** Bucket order (Urgent first) is kept: the grid lists the buckets' rows one after the other. */
export function sampleRowsOf(buckets: Array<{ priority: OrderPriority; tubes: Array<MwTube & { patientName: string; patientMeta: string }> }>): MwRow[] {
  return buckets.flatMap(b => b.tubes.map(tube => ({ kind: 'tube' as const, id: tube.sampleId, priority: b.priority, tube })));
}

export function patientRowsOf(buckets: Array<{ priority: OrderPriority; groups: Array<{ group: MwGroup; tubes: MwTube[] }> }>,
  isOpen: (orderId: string) => boolean): MwRow[] {
  const out: MwRow[] = [];
  for (const b of buckets) for (const { group, tubes } of b.groups) {
    const open = isOpen(group.orderId);
    out.push({ kind: 'patient', id: group.orderId, priority: group.priority, group, tubes, open });
    if (open) out.push({ kind: 'detail', id: `${group.orderId}~tubes`, priority: group.priority, group, tubes });
  }
  return out;
}

export function doneRowsOf(done: MwDoneTube[]): MwRow[] {
  return done.map(d => ({ kind: 'done' as const, id: d.sampleId, done: d }));
}

// ── Columns (by the grid's own width) ───────────────────────────────────────────

export type MwMode = 'sample' | 'patient' | 'done';
export interface MwColPlan { colId: string; header: string; hide: boolean }

/**
 * full  : every column.
 * fold  : Priority + Status fold under the patient / sample cell; Journey stays; the actions keep full size.
 * tight : Tests and Journey fold too — Sample / Patient · TAT · actions.
 */
export function mwColumns(mode: MwMode, fold: GridFold): MwColPlan[] {
  const f = fold !== 'full', t = fold === 'tight';
  const c = (colId: string, header: string, hide = false): MwColPlan => ({ colId, header, hide });
  if (mode === 'done') return [
    c('sample', 'Sample ID'), c('patient', 'Patient'), c('tests', 'Tests', t), c('journey', 'Journey', f),
    c('status', 'Status', f), c('when', 'Completed', t), c('acts', ''),
  ];
  return [
    ...(mode === 'sample' ? [c('sample', 'Sample ID')] : []),
    c('patient', 'Patient'), c('tests', 'Tests', t), c('priority', 'Priority', f), c('journey', 'Journey', t),
    c('tat', 'TAT'), c('status', 'Status', f), c('acts', ''),
  ];
}
