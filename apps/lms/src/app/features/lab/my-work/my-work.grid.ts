import { OrderTest, logicalTestCount } from '../../../shared/models/order.model';
import { matchesDailyNo } from '../../../shared/utils/daily-no';
import { lineDepartment } from '../../../shared/utils/shared-tube';
import type { LabSortKey } from '../../../shared/utils/lab-sort';
import type { OrderPriority } from '../../../shared/utils/lab-priority';
import { tatDetail, tatLabel, tatStateFor } from '../../../shared/utils/lab-priority';
import { GridFold, WorkStatus, waitText } from '../../../shared/utils/work-grid';
import type { WorkLine } from './my-work.priority';
import { type StatusWords, statusWords } from '../../../shared/utils/status-words';

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

// ── Status as WORDS (owner design D, 2026-11-21): two lines, no pill, no dot ───────────────────────────────
// Line 1 = the status word above (the Status column's filter value stays the WorkStatus label); line 2 = the detail.
// Rose = sent back or past its TAT with something left to enter; green = entered / validated.

const nTests = (n: number) => `${n} test${n === 1 ? '' : 's'}`;

export function tubeWords(t: MwTube, r: Pick<MwRules, 'tab' | 'myId'>, ownerName?: (id: string) => string): StatusWords {
  const st = tubeStatus(t, r, ownerName);
  const late = tubeLate(t);
  if (r.tab === 'service_queue') {
    if (st.label.startsWith('Claimed')) {
      const who = st.label.split(' · ')[1];
      return statusWords('Claimed', who === 'You' ? 'By you' : who ? `By ${who}` : 'By another technician', late ? 'late' : 'normal');
    }
    return statusWords('In queue', `Not picked up · ${nTests(logicalTestCount(t.tests as never))}`, late ? 'late' : 'normal');
  }
  if (st.label === 'Re-entry') {
    const r0 = t.rejections[0];
    // The reason itself already reads under the patient (rose note) — line 2 says what to do, never repeats it.
    return statusWords('Re-entry', r0 ? 'Sent back · fix and resubmit' : 'Sent back for correction', 'late');
  }
  if (st.label === 'Entered') return statusWords('Entered', `All ${nTests(logicalTestCount(t.tests as never))} in`, 'done');
  if (st.label === 'Draft') return statusWords('Draft', 'Saved, not submitted', late ? 'late' : 'normal');
  // The test count already rides the patient line; line 2 says where the entry stands.
  return statusWords('To enter', late ? 'Past TAT · nothing entered' : 'Nothing entered yet', late ? 'late' : 'normal');
}

export function groupWords(tubes: MwTube[], r: Pick<MwRules, 'tab' | 'myId'>, ownerName?: (id: string) => string): StatusWords {
  if (tubes.length === 1) return tubeWords(tubes[0], r, ownerName);
  const st = groupStatus(tubes, r, ownerName);
  const late = tubes.some(tubeLate);
  if (r.tab === 'service_queue') return statusWords(st.label.endsWith(' tubes') ? 'In queue' : st.label.split(' · ')[0], `${tubes.length} tubes`, late ? 'late' : 'normal');
  const entered = tubes.filter(t => t.allDone).length;
  const detail = `${entered} of ${tubes.length} tubes entered`;
  if (st.tone === 'green') return statusWords('Entered', `All ${tubes.length} tubes in`, 'done');
  if (st.label === 'Re-entry') return statusWords('Re-entry', detail, 'late');
  return statusWords(st.label.split(' · ')[0], detail, late ? 'late' : 'normal');
}

export function doneWords(d: Pick<MwDoneTube, 'status' | 'openLines'>): StatusWords {
  if (d.status === 'validated') return statusWords('Validated', 'Report ready', 'done');
  if (d.status === 'partial') return statusWords('Partly validated', `${nTests(d.openLines)} still open`, 'normal');
  return statusWords('Submitted', 'Waiting for validation', 'normal');
}

/** Department column (the old Filters → Department): the line departments' names ("Biochemistry", or "2 departments"). */
export function deptText(lines: OrderTest[]): { text: string; names: string[] } {
  const names = [...new Set(lines.map(l => lineDepartment(l as never).name).filter((n): n is string => !!n))];
  return { text: names.length > 1 ? `${names.length} departments` : names[0] ?? '—', names };
}

// ── Due: time left to TAT (owner 2026-11-21 — no journey ring on the lab screens) ─────────────────────────

/** A tube is late when it is past its TAT with something still to enter (the Due column's rose rule). */
export function tubeLate(t: Pick<MwTube, 'allDone' | 'remainingMin'>): boolean {
  return !t.allDone && t.remainingMin != null && t.remainingMin <= 0;
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
 * No Tests column (owner 2026-11-20: long test lists blew rows up to 6–8 lines): the department + test count ride the
 * patient's meta line, the full names stay in the tooltip / press-and-hold peek. No Journey ring (owner 2026-11-21:
 * every row here is at the same step) — DUE (time left to TAT) instead; Waiting = time in the lab.
 * Department is its own column (owner 2026-11-21: the head's "Filters → Department" became its header filter); the
 * patient line then carries just the test count.
 * full  : every column.
 * fold  : Priority + Status fold under the patient / sample cell; the actions keep full size.
 * tight : Sample ID, Department and Waiting fold into the patient cell — Patient · Due · actions: the grid never scrolls
 *         sideways down to a 520px card (owner 2026-11-21).
 */
export function mwColumns(mode: MwMode, fold: GridFold): MwColPlan[] {
  const f = fold !== 'full', t = fold === 'tight';
  const c = (colId: string, header: string, hide = false): MwColPlan => ({ colId, header, hide });
  if (mode === 'done') return [
    c('sample', 'Sample ID', t), c('patient', 'Patient'), c('dept', 'Department', t), c('status', 'Status', f), c('when', 'Completed', t), c('acts', ''),
  ];
  return [
    ...(mode === 'sample' ? [c('sample', 'Sample ID', t)] : []),
    c('patient', 'Patient'), c('dept', 'Department', t), c('priority', 'Priority', f), c('due', 'Due'), c('wait', 'Waiting', t), c('status', 'Status', f), c('acts', ''),
  ];
}

// ── Compact tests: "Biochemistry · 12 tests" / "2 departments · 14 tests" ─────────

export function testsSummary(lines: OrderTest[]): string {
  const depts = [...new Set(lines.map(l => lineDepartment(l as never).name).filter((n): n is string => !!n))];
  const n = logicalTestCount(lines as never);
  const d = depts.length > 1 ? `${depts.length} departments` : depts[0] ?? '';
  return [d, `${n} test${n === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
}
/** The full names (tooltip / peek). */
export function testNames(lines: Array<{ test?: { name?: string } | null }>): string {
  return lines.map(l => l.test?.name ?? 'Test').join(' · ');
}

// ── Card-head filters (owner 2026-11-20: "the filter in the grid is missing") ─────

export type MwStatusKey = 'all' | 'to_enter' | 'draft' | 're_entry' | 'entered' | 'in_queue' | 'claimed' | 'validated' | 'partial' | 'submitted';
export interface MwFilter { q: string; status: MwStatusKey; priority: 'all' | 'urgent' | 'normal'; dept: string | null }
export const NO_MW_FILTER: MwFilter = { q: '', status: 'all', priority: 'all', dept: null };

const KEY_OF: Record<string, MwStatusKey> = {
  'To enter': 'to_enter', Draft: 'draft', 'Re-entry': 're_entry', Entered: 'entered', 'In queue': 'in_queue', Validated: 'validated', Submitted: 'submitted',
};
export function statusKeyOf(label: string): MwStatusKey {
  if (label.startsWith('Claimed') || / tubes$/.test(label)) return 'claimed';
  if (label.startsWith('Partly validated')) return 'partial';
  return KEY_OF[label] ?? 'all';
}
export const MW_STATUS_LABEL: Record<MwStatusKey, string> = {
  all: 'All', to_enter: 'To enter', draft: 'Draft', re_entry: 'Re-entry', entered: 'Entered', in_queue: 'In queue', claimed: 'Claimed',
  validated: 'Validated', partial: 'Partly validated', submitted: 'Submitted',
};
/** The statuses each view really has, in reading order. */
export const MW_STATUSES: Record<'queue' | 'work' | 'done', MwStatusKey[]> = {
  queue: ['in_queue', 'claimed'],
  work: ['to_enter', 'draft', 're_entry', 'entered'],
  done: ['validated', 'partial', 'submitted'],
};

type StatusOf = (row: MwRow) => MwStatusKey;
const linesOf = (r: MwRow): OrderTest[] => r.kind === 'tube' ? r.tube.tests : r.kind === 'done' ? r.done.tests : r.group.items;
const deptIdsOf = (r: MwRow): string[] => [...new Set(linesOf(r).map(l => lineDepartment(l as never).id ?? lineDepartment(l as never).name ?? '').filter(Boolean))];

function matchesQ(r: MwRow, q: string): boolean {
  if (!q) return true;
  const ln = linesOf(r);
  const patient = ln[0]?.subOrder?.order?.patient as { displayName?: string; mrn?: string } | undefined;
  const hay = [
    r.kind === 'tube' ? r.tube.patientName : r.kind === 'done' ? r.done.patientName : r.group.patientName,
    patient?.mrn, ...ln.map(l => l.subOrder?.barcode), ...ln.map(l => l.subOrder?.id),
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q) || ln.some(l => matchesDailyNo(q, l.subOrder));
}

/** Search (sample ID / patient / MRN / daily number) · status · priority · department. A patient's inline tubes row
 *  follows its patient row. */
export function filterMwRows(rows: MwRow[], f: MwFilter, statusOf: StatusOf): MwRow[] {
  const q = f.q.trim().toLowerCase();
  const keep = (r: MwRow) =>
    matchesQ(r, q)
    && (f.status === 'all' || statusOf(r) === f.status)
    && (f.priority === 'all' || (r.kind !== 'done' && r.priority === f.priority))
    && (!f.dept || deptIdsOf(r).includes(f.dept));
  const out: MwRow[] = [];
  let parentKept = false;
  for (const r of rows) {
    if (r.kind === 'detail') { if (parentKept) out.push(r); continue; }
    parentKept = keep(r);
    if (parentKept) out.push(r);
  }
  return out;
}

/** Status pill options with counts (on everything else that is filtered — search, priority, department). */
export function statusOptions(rows: MwRow[], f: MwFilter, view: 'queue' | 'work' | 'done', statusOf: StatusOf):
  Array<{ value: MwStatusKey; label: string; count: number }> {
  const base = filterMwRows(rows, { ...f, status: 'all' }, statusOf).filter(r => r.kind !== 'detail');
  const n = (k: MwStatusKey) => base.filter(r => statusOf(r) === k).length;
  return [{ value: 'all', label: 'All', count: base.length },
    ...MW_STATUSES[view].map(k => ({ value: k, label: MW_STATUS_LABEL[k], count: n(k) })).filter(o => o.count > 0 || o.value === f.status)];
}

/** Departments present (the filter only shows with 2+). */
export function deptOptions(rows: MwRow[]): Array<{ id: string; name: string }> {
  const m = new Map<string, string>();
  for (const r of rows) for (const l of linesOf(r)) {
    const d = lineDepartment(l as never);
    const id = d.id ?? d.name;
    if (id && !m.has(id)) m.set(id, d.name ?? id);
  }
  return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** "4 of 9 samples" while a filter narrows the list, else "9 samples". */
export function countLabel(shown: number, total: number, unit: string): string {
  const u = (n: number) => `${unit}${n === 1 ? '' : 's'}`;
  return shown === total ? `${total} ${u(total)}` : `${shown} of ${total} ${u(total)}`;
}

// ── Header sort = the lab's persisted sort key (the old band "Priority" picker) ───────

export type MwSortCol = { colId: string; sort: 'asc' | 'desc' } | null;
/** A column header's sort → LabSortService key (what phones and the next visit start from). The grid itself sorts
 *  on the real value of ANY column (work-grid helpers); only Sample / Patient / Waiting / Completed have a key —
 *  any other header (Due, Priority, Status) or none = the default order (Urgent first, then soonest due). */
export function sortKeyOf(mode: MwMode, s: MwSortCol): LabSortKey {
  if (!s) return 'default';
  if (s.colId === 'sample') return 'sample';
  if (s.colId === 'patient') return 'patient';
  if (s.colId === 'wait') return s.sort === 'desc' ? 'oldest' : 'newest';
  if (s.colId === 'when') return s.sort === 'asc' ? 'oldest' : 'default';
  return 'default';
}
/** …and back: which header shows the arrow for a saved key. */
export function sortColOf(mode: MwMode, key: LabSortKey): MwSortCol {
  if (key === 'sample') return mode === 'patient' ? null : { colId: 'sample', sort: 'asc' };
  if (key === 'patient') return { colId: 'patient', sort: 'asc' };
  if (mode === 'done') return { colId: 'when', sort: key === 'oldest' ? 'asc' : 'desc' };
  if (key === 'oldest') return { colId: 'wait', sort: 'desc' };
  if (key === 'newest') return { colId: 'wait', sort: 'asc' };
  return null;   // the default order (Urgent first, then soonest due) — no header owns it, so no arrow
}
