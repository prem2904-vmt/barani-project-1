import type { Order } from '../../../../shared/models/order.model';
import type { Patient } from '../../../../shared/models/patient.model';
import type { OutsourcedTube } from '../../outsourced/outsourced-view';
import { attachState, rowReport } from '../../outsourced/outsourced-view';
import type { MergedWorkRow } from '../work-merge';
import type { WorkStatus } from '../work-status-filter';
import { drawerAgeSex, drawerName, drawerPipeline, drawerStepCaption } from '../order-drawer';
import { ServiceId, serviceOfModule } from '../../../../core/services/service-shelf';
import { formatDuration, normalizePriority } from '../../../../shared/utils/lab-priority';
import { CurrencyInrPipe } from '../../../../shared/pipes/currency-inr.pipe';
import { LAB_STEPS_VALIDATED, RingStep, labRingSteps, ringSteps, statusRingSteps, validationApplies } from '../../../../shared/components/journey-ring/journey-ring';

/**
 * Frontdesk FLOW GRID rows (owner-approved redesign 2026-11-19) — the pure mapping from what the work card already
 * loads (orders, merged rows, parked drafts, outsourced tubes, bills) to the grid's columns:
 *   Token · Patient · Visit for · Where now · Journey · Waiting · Payment · Next (+ ⋯).
 * No new data: every column is derived from existing order / sample / bill fields, and every action is one the
 * work list already offers, behind the SAME predicates (the landing passes its own show*On() checks in).
 */

/** Minutes at the current stage after which a row reads "late" (rose) — the More filters "Only late" rule. */
export const LATE_AFTER_MIN = 30;

export type FlowKind = 'order' | 'draft' | 'synthetic';
export type JourneyState = 'done' | 'now' | 'todo' | 'stopped';
export type FlowTone = 'violet' | 'green' | 'rose' | 'sky' | 'neutral';

/** Action ids — each maps 1:1 to an existing landing handler. Outsourced ones carry the tube id after a colon. */
export type FlowActionId =
  | 'resume' | 'discard'
  | 'bill' | 'recollect' | 'collect' | 'dispatch' | 'dispatch-drawn' | 'reprint' | 'series' | 'download' | 'pay' | 'share'
  | 'open' | 'profile'
  | `out-upload:${string}` | `out-view:${string}` | `out-attach:${string}` | `out-complete:${string}` | `out-undo:${string}`;

export interface FlowAction {
  id: FlowActionId;
  /** Button / menu text. */
  label: string;
  /** Accessible name (kept identical to the old row buttons — e.g. "Share report"). */
  aria: string;
}

export interface FlowDraft {
  key: string;
  patientId: string;
  patient: Patient;
  testIds: string[];
  savedAt: number;
  priority: string;
}

export interface FlowRow {
  /** Grid row id: the order id, or `draft:<patientId>`. */
  id: string;
  kind: FlowKind;
  order: Order | null;
  draft: FlowDraft | null;
  merged: MergedWorkRow<Order> | null;
  /** The row's leading status (what the head pill would call it). */
  status: WorkStatus;
  service: ServiceId;
  urgent: boolean;
  /** Patient column. */
  name: string;
  meta: string;
  /** Visit for: service tags (LAB, OPD …). */
  tags: string[];
  /** Where now: stage word + quiet sub-line + the stage dot's tone. */
  where: string;
  whereSub: string;
  tone: FlowTone;
  /** Journey dots (Billing → Sample → Dispatch → Result → Report); empty = not tracked for this row. */
  journey: JourneyState[];
  journeyLabel: string;
  /** The journey RING (shared pf-journey-ring): this row's own steps, done / now / late / todo. */
  ring?: RingStep[];
  /** Minutes at the current stage (null = finished / unknown). */
  waitMin: number | null;
  wait: string;
  late: boolean;
  /** Payment column. */
  pay: string;
  payDue: boolean;
  due: number;
  /** For sorting. */
  createdMs: number;
  dailyNo: number | null;
  dailyNoDay: string | null;
  /** The ONE contextual action + the rest for the ⋯ menu. */
  next: FlowAction | null;
  more: FlowAction[];
  /** Outsourced tubes the row's actions reach (pf-outsourced-actions, one per tube). */
  tubes: OutsourcedTube[];
  /** In progress multi-select: ticked (set by the landing from its ONE selection model). */
  selected?: boolean;
  /** The action in flight on this row (its Next shows the busy label), set by the landing. */
  busy?: FlowActionId | null;
}

/** The landing's existing row predicates — passed in, never re-implemented here. */
export interface FlowPredicates {
  showCreateBillOn(o: Order): boolean;
  showRecollectOn(o: Order): boolean;
  showCollectOn(o: Order): boolean;
  showDispatchOn(o: Order): boolean;
  showDispatchDrawn(o: Order): boolean;
  showBillInsteadOfDispatch(o: Order): boolean;
  sampleStatus(o: Order): string;
  isSeriesOrder(o: Order): boolean;
  shareAvailable(o: Order): boolean;
  effectiveStatusLabel(o: Order): string;
  balance(orderId: string): number;
}

const A = (id: FlowActionId, label: string, aria = label): FlowAction => ({ id, label, aria });
const DONE_STATUSES = new Set(['validated', 'delivered', 'completed']);
const inr = new CurrencyInrPipe();

/**
 * Every action the old work-list row offered for this order, in the old row's order and behind the old row's
 * conditions (frontdesk-landing.component.html, In progress / Completed / Payments due / merged rows).
 */
export function orderActions(o: Order, p: FlowPredicates, opts: { primary?: WorkStatus; tubes?: readonly OutsourcedTube[] } = {}): FlowAction[] {
  const out: FlowAction[] = [];
  const add = (a: FlowAction) => { if (!out.some(x => x.id === a.id)) out.push(a); };
  if (o.status === 'created' && p.showCreateBillOn(o)) add(A('bill', 'Bill'));
  if (p.showRecollectOn(o)) {
    add(A('recollect', 'Recollect'));
  } else if (p.sampleStatus(o) === 'partially_collected' || p.showCollectOn(o)) {
    add(A('collect', 'Collect'));
    if (p.showDispatchDrawn(o)) add(A('dispatch-drawn', 'Dispatch', 'Dispatch drawn tubes'));
  } else if (p.showDispatchOn(o)) {
    add(A('dispatch', 'Dispatch'));
  } else if (p.showBillInsteadOfDispatch(o)) {
    add(A('bill', 'Bill'));
  } else if (o.status === 'billed') {
    add(A('reprint', 'Reprint', 'Reprint labels'));
  }
  if (p.isSeriesOrder(o)) add(A('series', 'Status', 'Series status'));
  if (o.status === 'partially_validated' && p.sampleStatus(o) !== 'partially_collected' && !p.showCollectOn(o)) {
    add(A('download', 'Download', 'Download report'));
  }
  if (opts.primary === 'billing' || p.balance(o.id) > 0) add(A('pay', 'Pay now'));
  if (DONE_STATUSES.has(o.status)) {
    if (o.status !== 'delivered' && p.shareAvailable(o)) add(A('share', 'Share', 'Share report'));
    add(A('download', 'Download', 'Download report'));
  }
  for (const t of opts.tubes ?? []) out.push(...tubeActions(t));
  return out;
}

/** One outsourced tube's actions (pf-outsourced-actions' own set: View · Attach/Detach · Mark completed / Undo · Upload). */
export function tubeActions(t: OutsourcedTube): FlowAction[] {
  const tag = t.barcode ? ` (${t.barcode})` : '';
  const out: FlowAction[] = [];
  if (t.status !== 'completed' && t.hasReport) out.push(A(`out-complete:${t.sampleId}`, 'Mark completed' + tag, `Mark completed for ${t.barcode ?? 'this tube'}`));
  out.push(A(`out-upload:${t.sampleId}`, (t.hasReport ? 'Replace report' : 'Upload report') + tag,
    (t.hasReport ? 'Replace partner report for ' : 'Upload partner report for ') + (t.barcode ?? 'this tube')));
  if (rowReport(t)) {
    out.push(A(`out-view:${t.sampleId}`, 'View partner report' + tag, `View partner report for ${t.barcode ?? 'this tube'}`));
    const sep = attachState(t) === 'separate';
    out.push(A(`out-attach:${t.sampleId}`, (sep ? 'Attach to report' : 'Detach from report') + tag,
      (sep ? 'Attach partner report to our report for ' : 'Detach partner report from our report for ') + (t.barcode ?? 'this tube')));
  }
  if (t.status === 'completed') out.push(A(`out-undo:${t.sampleId}`, 'Undo completed' + tag, `Undo completed for ${t.barcode ?? 'this tube'}`));
  return out;
}

/** Which action is the row's NEXT step. A due at the desk (Payments due row) leads with Pay now; a pending
 *  partner tube with its upload / complete; otherwise the old row's first action. */
export function pickNext(actions: readonly FlowAction[], primary: WorkStatus): FlowAction | null {
  if (!actions.length) return null;
  const find = (pred: (a: FlowAction) => boolean) => actions.find(pred) ?? null;
  if (primary === 'billing') return find(a => a.id === 'pay') ?? find(a => a.id === 'bill') ?? actions[0];
  if (primary === 'out') return find(a => a.id.startsWith('out-complete:')) ?? find(a => a.id.startsWith('out-upload:')) ?? actions[0];
  return actions[0];
}

/** The ⋯ menu: every action but Next, then the row's own detail + the patient profile (always available). */
export function menuActions(actions: readonly FlowAction[], next: FlowAction | null, kind: FlowKind): FlowAction[] {
  const rest = actions.filter(a => a !== next);
  if (kind === 'draft') return rest;
  return [...rest, A('open', 'Order details', 'Open order details'), A('profile', 'Patient profile', 'Open patient profile')];
}

/** The 5-step journey as dots: done steps, then ONE current step (now / stopped), then the steps still to come. */
export function journeyDots(o: Pick<Order, 'status' | 'samples'>): { dots: JourneyState[]; label: string } {
  const steps = drawerPipeline(o);
  let current = -1;
  const dots: JourneyState[] = steps.map((s, i) => {
    if (s.state === 'done') return 'done';
    if (current < 0) { current = i; return s.state === 'stopped' ? 'stopped' : 'now'; }
    return 'todo';
  });
  const label = current < 0
    ? 'Journey: every step done'
    : `Journey: ${steps[current].label} — ${drawerStepCaption(o, steps[current])}`;
  return { dots, label };
}

/** The row's ring steps: a lab order walks its pipeline (4 steps when its results release without validation, 5
 *  with), other services their status steps, a partner-lab stand-in "At partner lab → Report in". Late = the grid's
 *  own late rule (the Waiting column); a blocked step (not collected) reads late too. */
export function orderRing(o: Pick<Order, 'status' | 'samples' | 'module'>, late: boolean, synthetic = false, pending = true): RingStep[] {
  if (synthetic) return ringSteps(['At partner lab', 'Report in'], pending ? 0 : -1, { late });
  const service = serviceOfModule(o.module);
  if (service !== 'lab') return statusRingSteps(service, o.status, { late });
  const tests = (o.samples ?? []).flatMap(sm => sm.tests ?? []);
  return labRingSteps(drawerPipeline(o), { late, validation: validationApplies(tests) });
}

/** Minutes the order has sat at its current stage (since its last status change), null once it is finished. */
export function orderStageMinutes(o: Pick<Order, 'status' | 'createdAt' | 'updatedAt'>, now: number): number | null {
  if (DONE_STATUSES.has(o.status) || o.status === 'cancelled') return null;
  const at = Date.parse(String(o.updatedAt ?? o.createdAt)) || Date.parse(String(o.createdAt)) || now;
  return Math.max(0, Math.round((now - at) / 60000));
}

/** THE late rule (rose Waiting, the shelf's rose dot, "Only late"): over 30 minutes at the current stage. */
export function orderIsLate(o: Pick<Order, 'status' | 'createdAt' | 'updatedAt'>, now: number): boolean {
  const m = orderStageMinutes(o, now);
  return m !== null && m >= LATE_AFTER_MIN;
}

/** "34m" / "2h 5m" — minutes since `fromMs`. */
export function waitFor(fromMs: number, now: number): { min: number; label: string } {
  const min = Math.max(0, Math.round((now - fromMs) / 60000));
  return { min, label: min < 1 ? 'Just now' : formatDuration(min) };
}

const toneOf = (status: WorkStatus): FlowTone =>
  status === 'done' ? 'green' : status === 'billing' ? 'rose' : status === 'out' ? 'sky' : 'violet';

function patientMeta(p: Patient | null | undefined): string {
  return [drawerAgeSex(p ?? null), p?.mrn ?? ''].filter(Boolean).join(' · ');
}

function serviceTag(s: ServiceId): string {
  return s === 'scan' ? 'SCAN' : s === 'er' ? 'ER' : s.toUpperCase();
}

/** An order row (a real order, or the merged list's synthetic outsourced-only stand-in). */
export function orderFlowRow(o: Order, p: FlowPredicates, now: number, ctx: {
  primary: WorkStatus; merged?: MergedWorkRow<Order> | null; tubes?: readonly OutsourcedTube[];
}): FlowRow {
  const synthetic = ctx.merged?.source === 'synthetic';
  const tubes = [...(ctx.tubes ?? [])];
  const service = serviceOfModule(o.module);
  const done = DONE_STATUSES.has(o.status) || o.status === 'cancelled';
  const due = synthetic ? 0 : p.balance(o.id);
  const actions = synthetic ? tubes.flatMap(tubeActions) : orderActions(o, p, { primary: ctx.primary, tubes });
  const next = pickNext(actions, ctx.primary);
  const createdMs = Date.parse(o.createdAt as unknown as string) || 0;
  const stageMs = Date.parse((o.updatedAt ?? o.createdAt) as unknown as string) || createdMs;

  let where: string;
  let whereSub: string;
  let journey: JourneyState[] = [];
  let journeyLabel = '';
  if (synthetic) {
    const pending = tubes.some(t => t.status !== 'completed');
    where = pending ? 'At partner lab' : 'Partner report in';
    whereSub = [...new Set(tubes.map(t => t.partnerLabName).filter(Boolean))].join(', ') || 'Outsourced';
  } else {
    where = p.effectiveStatusLabel(o);
    const j = journeyDots(o);
    journey = j.dots;
    journeyLabel = j.label;
    whereSub = j.label.replace(/^Journey: [^—]+— /, '').replace(/^Journey: every step done$/, o.status === 'delivered' ? 'Report delivered' : 'Ready for delivery');
    if (tubes.some(t => t.status !== 'completed')) {
      const partners = [...new Set(tubes.map(t => t.partnerLabName).filter(Boolean))].join(', ');
      whereSub = partners ? `${whereSub} · partner: ${partners}` : whereSub;
    }
  }

  const finished = synthetic ? !tubes.some(t => t.status !== 'completed') : done;
  const w = waitFor(stageMs, now);
  const waitMin = finished ? null : w.min;
  const late = synthetic ? (waitMin !== null && waitMin >= LATE_AFTER_MIN) : orderIsLate(o, now);

  let pay: string;
  let payDue = false;
  if (synthetic) pay = '—';
  else if (due > 0) { pay = `${inr.transform(due)} due`; payDue = true; }
  else if (o.status === 'created' || o.billStatus === 'unbilled') pay = 'Not billed';
  else if (o.billStatus === 'unpaid') { pay = 'Unpaid'; payDue = true; }
  else if (o.status === 'cancelled') pay = '—';
  else pay = 'Paid';

  return {
    id: o.id, kind: synthetic ? 'synthetic' : 'order', order: o, draft: null, merged: ctx.merged ?? null,
    status: ctx.primary, service, urgent: normalizePriority(o.priority) === 'urgent',
    name: drawerName(o.patient), meta: patientMeta(o.patient), tags: [serviceTag(service)],
    where, whereSub, tone: o.status === 'cancelled' ? 'rose' : toneOf(ctx.primary),
    journey, journeyLabel,
    ring: o.status === 'cancelled' ? orderRing(o, false).map(x => ({ ...x, state: 'todo' as const }))
      : orderRing(o, late && !finished, synthetic, !finished),
    waitMin, wait: waitMin === null ? '—' : w.label, late,
    pay, payDue, due,
    createdMs, dailyNo: o.dailyNo ?? null, dailyNoDay: o.dailyNoDay ?? null,
    next, more: menuActions(actions, next, synthetic ? 'synthetic' : 'order'),
    tubes,
  };
}

/** A parked order draft (localStorage) — always Lab, always In progress. */
export function draftFlowRow(d: FlowDraft, now: number): FlowRow {
  const w = waitFor(d.savedAt, now);
  const n = d.testIds.length;
  const resume = A('resume', 'Resume', 'Resume draft');
  return {
    id: `draft:${d.patientId}`, kind: 'draft', order: null, draft: d, merged: null,
    status: 'ip', service: 'lab', urgent: normalizePriority(d.priority) === 'urgent',
    name: drawerName(d.patient), meta: patientMeta(d.patient), tags: ['LAB'],
    where: 'Draft', whereSub: `${n} test${n === 1 ? '' : 's'} · not ordered yet`, tone: 'neutral',
    journey: [], journeyLabel: '',
    ring: ringSteps(LAB_STEPS_VALIDATED, 0, { late: w.min >= LATE_AFTER_MIN }),
    waitMin: w.min, wait: w.label, late: w.min >= LATE_AFTER_MIN,
    pay: 'Not billed', payDue: false, due: 0,
    createdMs: d.savedAt, dailyNo: null, dailyNoDay: null,
    next: resume, more: [A('discard', 'Discard draft')], tubes: [],
  };
}
