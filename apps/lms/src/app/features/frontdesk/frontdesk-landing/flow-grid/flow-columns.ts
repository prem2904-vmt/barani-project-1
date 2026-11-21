import type { FlowRow } from './flow-row';
import { FLOW_MIN, FLOW_SLACK, OWN_FLOOR, flowColId, type FlowFoldStep } from './flow-fold';
import { foldSteps } from '../../../../shared/utils/work-grid';
import { type FdModule, fdColumn, fdDataValue } from '../../../../shared/utils/fd-grid-columns';
import { dueCell } from '../../../../shared/utils/work-grid';
import { normalizePriority } from '../../../../shared/utils/lab-priority';
import { statusWord } from '../../../opd/frontdesk/visit-status';
import { dayTime, opdAhead, samplesText } from '../work-view/sections';

/**
 * The flow grid's columns from the admin's Work grid columns (shared/utils/fd-grid-columns.ts) — pure:
 *  - `fdFlowLayout`: which of the saved columns fit the grid's own width (work grids NEVER scroll sideways).
 *  - `fdCell`: the text of every catalogue column that is not drawn by its own renderer, from data the row already
 *    carries. Needs-data columns read their named field (`fdDataValue`) and show "—" until a feed carries it.
 */

/** The AG-Grid column ids behind a catalogue id (Waiting / Payment keep their old colIds; Where now is ONE column now). */
export const FD_AG_COLS: Readonly<Record<string, readonly string[]>> = { waiting: ['wait'], payment: ['pay'] };
export const agColsOf = (id: string): readonly string[] => FD_AG_COLS[id] ?? [id];
/** The catalogue id behind an AG-Grid column id (a legacy "journey" = Where now, `flowColId`). */
export function fdIdOfAgCol(colId: string): string {
  const live = flowColId(colId);
  for (const [id, cols] of Object.entries(FD_AG_COLS)) if (cols.includes(live)) return id;
  return live;
}

/** Fixed columns: Token · Patient · Where now first, Waiting (right before Next) and Next last. */
const FIXED = new Set(['token', 'patient', 'where', 'waiting', 'next']);

export interface FdFlowLayout {
  fold: Set<FlowFoldStep>;
  /** The admin's middle columns shown, in order (catalogue ids). */
  mid: string[];
  need: number;
}

/**
 * One grid (one service picked / a single-service tenant): the admin's middle columns step out first, RIGHT-MOST first
 * (Payment → the patient line), then Waiting → a line in Where now, Token → a chip, the tight floors.
 * A SECTION (`section`: owner 2026-11-21 — Token · Patient · Where now · Waiting · Next sit at the SAME x in every
 * section): the fixed columns fold by the WIDTH alone (+ one shared floor for the module's own columns), then the middle
 * columns take what is left, right-most out first; if even that does not fit, the remaining fixed steps fold too.
 */
export function fdFlowLayout(width: number, module: FdModule, ids: readonly string[],
  opts: { selecting?: boolean; tokenW?: number; noFold?: boolean; tight?: boolean; section?: boolean } = {}): FdFlowLayout {
  const tw = opts.tokenW ?? FLOW_MIN.token;
  const hasWhere = ids.includes('where');
  const hasWait = ids.includes('waiting');
  let mid = ids.filter(id => !FIXED.has(id));
  const fixed = (f: Set<FlowFoldStep>) => (opts.selecting ? FLOW_MIN.sel : 0) + (f.has('token') ? 0 : tw)
    + (f.has('tight') ? FLOW_MIN.patientTight : FLOW_MIN.patient)
    + (hasWhere ? (f.has('tight') ? FLOW_MIN.whereTight : FLOW_MIN.where) : 0)
    + (hasWait && !f.has('wait') ? FLOW_MIN.wait : 0)
    + (f.has('tight') ? FLOW_MIN.nextTight : FLOW_MIN.next);
  const midNeed = () => mid.reduce((s, id) => s + (id === 'payment' ? FLOW_MIN.pay : fdColumn(module, id)?.min ?? 100), 0);
  if (opts.noFold) { const f = new Set<FlowFoldStep>(opts.tight ? ['tight'] : []); return { fold: f, mid, need: fixed(f) + midNeed() }; }
  const tightSaves = (FLOW_MIN.patient - FLOW_MIN.patientTight) + (FLOW_MIN.next - FLOW_MIN.nextTight) + (hasWhere ? FLOW_MIN.where - FLOW_MIN.whereTight : 0);
  const fold = opts.section ? foldSteps<FlowFoldStep>(width, fixed(new Set()) + OWN_FLOOR, [
    ...(hasWait ? [{ id: 'wait' as const, saves: FLOW_MIN.wait }] : []),
    { id: 'token', saves: tw },
    { id: 'tight', saves: tightSaves },
  ], FLOW_SLACK) : new Set<FlowFoldStep>();
  while (width < fixed(fold) + midNeed() + FLOW_SLACK && mid.length > 0) {
    const out = mid[mid.length - 1];
    mid = mid.slice(0, -1);
    if (out === 'payment') fold.add('pay');
  }
  for (const st of [...(hasWait ? ['wait' as const] : []), 'tight' as const, 'token' as const]) {
    if (width >= fixed(fold) + midNeed() + FLOW_SLACK) break;
    fold.add(st);
  }
  return { fold, mid, need: fixed(fold) + midNeed() };
}

/** A preview header's room for grip + the whole label + ✕ / lock (edit mode). */
export function fdHeaderNeed(label: string, locked = false): number {
  // Locked: label + lock icon. Movable: grip + label + the 22px ✕ (its 44px touch area is an invisible overlay).
  return Math.ceil(label.length * 7.4 + (locked ? 50 : 86));
}

/**
 * A column's laid-out minimum in the settings preview (edit headers; `tight` = the fixed columns at their floors, the
 * Frontdesk's own tight step for Patient / Next; Where now keeps its full width so its words never clip). The preview sums these to decide how many columns it can show at ≥85% scale.
 */
export function fdPreviewMin(module: FdModule, id: string, tight = false, tokenW: number = FLOW_MIN.token): number {
  const c = fdColumn(module, id);
  const base = id === 'token' ? tokenW
    : id === 'patient' ? (tight ? FLOW_MIN.patientTight : FLOW_MIN.patient)
    : id === 'where' ? FLOW_MIN.where   // the ring + its words never go below their full width in the preview
    : id === 'waiting' ? FLOW_MIN.wait
    : id === 'payment' ? FLOW_MIN.pay
    : id === 'next' ? (tight ? FLOW_MIN.nextTight : FLOW_MIN.next)
    : c?.min ?? 100;
  return Math.max(base, fdHeaderNeed(c?.label ?? id, !!c?.locked));
}

/**
 * Which columns the settings preview shows in `box` px without going below `minScale` (owner 2026-11-21: never smaller
 * than 85% — readable). It first tries every column (fixed columns at full width, then at their tight floors); beyond
 * that the RIGHT-MOST movable columns fold away like the real Frontdesk, except `pin` (the column being dragged, just
 * added or hovered) — its neighbours fold instead. Returns the shown ids (in order), the folded ones and the tight flag.
 */
export function fdPreviewPlan(module: FdModule, order: readonly string[], box: number,
  opts: { pin?: string | null; minScale?: number; tokenW?: number } = {}): { shown: string[]; folded: string[]; tight: boolean } {
  const budget = box / (opts.minScale ?? 0.85);
  const est = (ids: readonly string[], tight: boolean) => ids.reduce((s, id) => s + fdPreviewMin(module, id, tight, opts.tokenW), 4);
  if (!box || est(order, false) <= budget) return { shown: [...order], folded: [], tight: false };
  const shown = [...order];
  const folded: string[] = [];
  while (est(shown, true) > budget) {
    let i = shown.length - 1;
    while (i >= 0 && (fdColumn(module, shown[i])?.locked || shown[i] === opts.pin)) i--;
    if (i < 0) break;
    folded.unshift(shown[i]);
    shown.splice(i, 1);
  }
  return { shown, folded, tight: true };
}

// ── Cells ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface FdCell { text: string; late?: boolean }

export interface FdCellCtx {
  now: number;
  /** OPD: waiting patients ahead of each visit in its doctor's queue (`opdAhead` over the grid's rows). */
  ahead: Map<string, number>;
  branchName(id: string | null | undefined): string;
}

export function fdCellCtx(rows: readonly FlowRow[], branchName: (id: string | null | undefined) => string, now = Date.now()): FdCellCtx {
  return { now, ahead: opdAhead(rows), branchName };
}

const DASH: FdCell = { text: '—' };
const t = (s: string | null | undefined): FdCell => (s && s.trim() ? { text: s.trim() } : DASH);

function daysSince(iso: string | null | undefined, now: number): FdCell {
  const at = Date.parse(String(iso ?? ''));
  if (!at) return DASH;
  const d = Math.max(0, Math.floor((now - at) / 86400000));
  return { text: d === 0 ? 'Today' : d === 1 ? '1 day' : `${d} days` };
}

/** "Walk-in" · "Appointment" · "Home" from the order's own source / collection type. */
export function labVisitType(o: { source?: string | null; collectionType?: string | null } | null | undefined): string {
  if (!o) return '—';
  const ct = String(o.collectionType ?? '').toLowerCase();
  const src = String(o.source ?? '').toLowerCase();
  if (ct.includes('home') || src.includes('home')) return 'Home';
  if (src.includes('appoint') || ct.includes('appoint')) return 'Appointment';
  return 'Walk-in';
}

/** A needs-data column's value once a feed carries it (a date-time reads as the day / time; a TAT due as "in 2h"). */
function dataCell(module: FdModule, id: string, r: FlowRow, now: number): FdCell {
  const c = fdColumn(module, id);
  const v = c ? fdDataValue(c, r) : undefined;
  if (v === null || v === undefined || String(v).trim() === '') return DASH;
  if (id === 'due') {
    const at = Date.parse(String(v));
    if (!at) return DASH;
    const d = dueCell((at - now) / 60000);
    return { text: d.text, late: d.late };
  }
  if (id === 'discharge') return { text: dayTime(String(v), now) };
  if (id === 'triage') return { text: /^\d$/.test(String(v)) ? `Level ${v}` : String(v), late: String(v) === '1' || String(v) === '2' };
  return { text: String(v) };
}

/** The text of a catalogue column for a row. Where now / Waiting / Payment / Token / Patient / Next have their own renderers. */
export function fdCell(module: FdModule, id: string, r: FlowRow, ctx: FdCellCtx): FdCell {
  const o = r.order;
  const v = r.visit;
  const col = fdColumn(module, id);
  if (col?.needsData) return dataCell(module, id, r, ctx.now);
  switch (id) {
    case 'samples': return r.kind === 'draft' ? { text: 'Not ordered' } : v ? DASH : { text: samplesText(o?.samples) };
    case 'priority': {
      const urgent = o ? normalizePriority(o.priority) === 'urgent' : r.urgent;
      return { text: urgent ? 'Urgent' : 'Normal', late: urgent };
    }
    case 'refdoc': return t(o?.refDoctorName);
    case 'visit': return v ? { text: v.isFollowUp ? 'Follow-up' : 'New' } : r.kind === 'draft' ? DASH : { text: labVisitType(o) };
    case 'orderid': return t(v ? v.visitNumber : o?.orderNumber);
    case 'branch': return o ? t(ctx.branchName(o.branchId)) : DASH;
    case 'doctor': return t(v ? v.doctorName : o?.refDoctorName);
    case 'vitals': return v
      ? (v.vitalsSummary ? { text: v.vitalsSummary, late: v.vitalsFlagged } : { text: v.status === 'vitals' ? 'Now' : 'Pending' })
      : DASH;
    case 'dept': return t(v?.departmentName ?? v?.serviceName);
    case 'ahead': {
      if (!v) return DASH;
      const n = ctx.ahead.get(r.id);
      return v.status === 'waiting' && n !== undefined ? { text: n === 0 ? 'Next' : `${n} ahead` } : { text: statusWord(v.status) };
    }
    case 'admitted':
    case 'arrived': return { text: dayTime((o?.createdAt ?? v?.checkedInAt ?? v?.createdAt) as string | undefined, ctx.now) };
    case 'days': return daysSince((o?.createdAt ?? v?.createdAt) as string | undefined, ctx.now);
    default: return DASH;
  }
}
