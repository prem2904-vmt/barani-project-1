import type { ServiceDef, ServiceFilter, ServiceId } from '../../../../core/services/service-shelf';
import type { FlowRow } from '../flow-grid/flow-row';

/**
 * Frontdesk side card "Who is where" (owner-approved 2026-11-20, mock fd-chart-v12) — the pure part.
 * A sunburst over the work card's OWN active rows (no new data): inner ring = service, outer ring = the step the row
 * is at inside that service. The step is the flow grid's "Where now" word (FlowRow.where — the same field the grid
 * shows), shortened to its head word; a draft reads "Draft"; a row with no "Where now" goes to "Other".
 * The chart, its chips and the bottom-bar Services shelf drive ONE filter (ServiceShelfService.selected + step).
 */

/** One active work row, as the chart counts it. */
export interface WhoItem {
  service: ServiceId;
  step: string;
  late: boolean;
  /** Minutes at the current stage (null = unknown). */
  waitMin: number | null;
  /** "#12" — the day's token, '' when the row has none (a draft). */
  token: string;
  name: string;
}

/** The bucket for rows whose step can't be read. */
export const OTHER_STEP = 'Other';

/** The chart's step for a flow-grid row: its "Where now" head word ("Not collected (Patient refused)" → "Not
 *  collected"), "Draft" for a parked draft, "Other" when the row says nothing. */
export function stepOfRow(r: Pick<FlowRow, 'kind' | 'where'>): string {
  if (r.kind === 'draft') return 'Draft';
  const w = (r.where ?? '').split(/\s*[(·—–:]|\s+-\s/)[0].trim();
  if (/not collected/i.test(w)) return 'Not collected';     // "2 of 3 not collected" is the same step
  return w || OTHER_STEP;
}

/** A flow-grid row → what the chart counts. */
export function whoItemOf(r: FlowRow): WhoItem {
  const no = r.order?.dailyNo;
  return {
    service: r.service, step: stepOfRow(r), late: r.late, waitMin: r.waitMin,
    token: no ? `#${no}` : '', name: r.name,
  };
}

export interface StepNode { step: string; n: number; late: number; items: WhoItem[] }
export interface ServiceNode { id: ServiceId; label: string; n: number; late: number; steps: StepNode[]; items: WhoItem[] }

/** Group the items by service (shelf order, every granted service even when empty) then by step (most rows first;
 *  "Other" always last; ties keep first appearance). Items of a service the user doesn't have are dropped. */
export function buildWhoTree(items: readonly WhoItem[], services: readonly ServiceDef[]): ServiceNode[] {
  return services.map(s => {
    const mine = items.filter(i => i.service === s.id);
    const byStep = new Map<string, StepNode>();
    for (const it of mine) {
      const cur = byStep.get(it.step) ?? { step: it.step, n: 0, late: 0, items: [] };
      cur.n++;
      if (it.late) cur.late++;
      cur.items.push(it);
      byStep.set(it.step, cur);
    }
    const order = [...byStep.keys()];
    const steps = [...byStep.values()].sort((a, b) =>
      (a.step === OTHER_STEP ? 1 : 0) - (b.step === OTHER_STEP ? 1 : 0) || b.n - a.n || order.indexOf(a.step) - order.indexOf(b.step));
    return { id: s.id, label: s.label, n: mine.length, late: mine.filter(i => i.late).length, steps, items: mine };
  });
}

/* ── Geometry ─────────────────────────────────────────────────────────────────────────────────────────────── */

/** The chart's box (viewBox 0 0 240 240) and its two rings. */
export const SUN = { size: 240, c: 120, inner: [48, 81] as const, outer: [85, 118] as const };
/** Slices narrower than this (radians) carry no count label. */
export const LABEL_MIN_ANGLE = 0.3;

const pt = (r: number, a: number): [number, number] => [SUN.c + r * Math.sin(a), SUN.c - r * Math.cos(a)];
const f = (n: number) => Math.round(n * 100) / 100;

/** An annular sector from angle a0 to a1 (radians, 0 = 12 o'clock, clockwise). A full turn is drawn as two halves
 *  (one SVG arc can't start and end on the same point). */
export function arcPath(r0: number, r1: number, a0: number, a1: number): string {
  const span = a1 - a0;
  if (span >= 2 * Math.PI - 1e-6) {
    const m = a0 + Math.PI;
    return arcPath(r0, r1, a0, m) + ' ' + arcPath(r0, r1, m, a0 + 2 * Math.PI);
  }
  const big = span > Math.PI ? 1 : 0;
  const [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0);
  return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 ${big} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r0} ${r0} 0 ${big} 0 ${f(x3)} ${f(y3)}Z`;
}

export interface Slice {
  key: string;
  ring: 'service' | 'step';
  service: ServiceId;
  serviceLabel: string;
  step: string | null;
  n: number;
  late: number;
  a0: number;
  a1: number;
  d: string;
  /** Count label position (null = too narrow for one). */
  label: { x: number; y: number } | null;
  /** The slice's middle, on its ring (where the focus card anchors). */
  mid: { x: number; y: number };
}

/** Every slice of the chart: one inner slice per service with rows, then its step slices on the outer ring, each
 *  sized by its share of ALL rows (so the outer ring lines up with its service); a step's late rows are a separate
 *  soft-rose part of that step. */
export function layoutSunburst(tree: readonly ServiceNode[]): Slice[] {
  const total = tree.reduce((s, n) => s + n.n, 0);
  if (!total) return [];
  const T = 2 * Math.PI;
  const out: Slice[] = [];
  let a = 0;
  for (const s of tree) {
    if (!s.n) continue;
    const w = (s.n / total) * T;
    out.push(slice('service', s, null, s.n, s.late, a, a + w, SUN.inner));
    let b = a;
    for (const st of s.steps) {
      // A step's late rows get their own soft-rose part (same step: a click filters the whole step).
      const onTime = st.n - st.late;
      if (onTime) {
        const ww = (onTime / total) * T;
        out.push(slice('step', s, st.step, onTime, 0, b, b + ww, SUN.outer));
        b += ww;
      }
      if (st.late) {
        const ww = (st.late / total) * T;
        out.push(slice('step', s, st.step, st.late, st.late, b, b + ww, SUN.outer, true));
        b += ww;
      }
    }
    a += w;
  }
  return out;
}

function slice(ring: Slice['ring'], s: ServiceNode, step: string | null, n: number, late: number, a0: number, a1: number,
  radii: readonly [number, number], latePart = false): Slice {
  const r = (radii[0] + radii[1]) / 2;
  const [mx, my] = pt(r, (a0 + a1) / 2);
  const mid = { x: f(mx), y: f(my) };
  return {
    key: step === null ? s.id : `${s.id}:${step}${latePart ? ':late' : ''}`, ring, service: s.id, serviceLabel: s.label, step, n, late, a0, a1,
    d: arcPath(radii[0], radii[1], a0, a1), label: a1 - a0 >= LABEL_MIN_ANGLE ? mid : null, mid,
  };
}

/* ── Filter + words ───────────────────────────────────────────────────────────────────────────────────────── */

/** Is a slice part of the filter in force (lit while the rest greys out)? */
export function sliceOn(s: Pick<Slice, 'service' | 'step'>, service: ServiceFilter, step: string | null): boolean {
  if (service === 'all') return true;
  if (s.service !== service) return false;
  return !step || s.step === null || s.step === step;
}

/** The hover / focus card for a slice (or a service chip: step null). */
export interface SliceCard {
  title: string;
  n: number;
  late: number;
  lines: string[];
  action: string;
}

const shortName = (n: string) => n.replace(/^(Mr|Ms|Mrs|Miss|Master|Baby|Dr)\.?\s+/i, '').split(/\s+/)[0] ?? n;

/** Words of the description card: "Lab › Sample", count, "2 late · longest wait 41m", a few tokens, and what a
 *  click does ("Click to show only Lab" / "Click again for everyone"). */
export function describeSlice(tree: readonly ServiceNode[], service: ServiceId, step: string | null,
  active: { service: ServiceFilter; step: string | null }): SliceCard | null {
  const s = tree.find(x => x.id === service);
  if (!s) return null;
  const node = step === null ? s : s.steps.find(x => x.step === step);
  if (!node) return null;
  const items = node.items;
  const late = items.filter(i => i.late).length;
  const longest = Math.max(0, ...items.map(i => i.waitMin ?? 0));
  const lines = [`${late ? `${late} late · ` : ''}${longest ? `longest wait ${fmtMin(longest)}` : 'no one waiting long'}`];
  if (step === null && s.steps.length) lines.push(s.steps.map(x => `${x.step} ${x.n}`).join(' · '));
  const who = [...items].sort((a, b) => (b.waitMin ?? 0) - (a.waitMin ?? 0)).slice(0, 3)
    .map(i => [i.token, shortName(i.name)].filter(Boolean).join(' '));
  if (who.length) lines.push(who.join(' · ') + (items.length > 3 ? ` · +${items.length - 3}` : ''));
  const isActive = active.service === service && (active.step ?? null) === step;
  return {
    title: step === null ? s.label : `${s.label} › ${step}`, n: items.length, late, lines,
    action: isActive ? 'Click again for everyone' : `Click to show only ${step === null ? s.label : 'these'}`,
  };
}

/** "41m" / "1h 5m". */
export function fmtMin(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** The centre's words: no filter → "N in the clinic"; a filter → its name (step, else service) + "tap for all". */
export function centreOf(tree: readonly ServiceNode[], service: ServiceFilter, step: string | null): { n: number; label: string; filtered: boolean } {
  const total = tree.reduce((s, n) => s + n.n, 0);
  if (service === 'all') return { n: total, label: 'in the clinic', filtered: false };
  const s = tree.find(x => x.id === service);
  const node = step ? s?.steps.find(x => x.step === step) : s;
  return { n: node?.n ?? 0, label: step ?? s?.label ?? service, filtered: true };
}

/* ── Appointments ─────────────────────────────────────────────────────────────────────────────────────────── */

/** When a booking starts: its date + "HH:mm" slot (local), or the date-time itself when there is no slot. */
export function apptStartMs(a: { appointmentDate: string; slotTime?: string | null }): number | null {
  const d = new Date(a.appointmentDate);
  if (Number.isNaN(d.getTime())) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(a.slotTime ?? '');
  if (m) d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  else if (d.getHours() === 0 && d.getMinutes() === 0) d.setHours(23, 59, 0, 0);   // a date with no time: due all day
  return d.getTime();
}

/** Minutes a still-booked (not checked-in) appointment is past its slot; null when it isn't overdue. */
export function apptOverdueMin(a: { status: string; appointmentDate: string; slotTime?: string | null }, now: number): number | null {
  if (a.status !== 'booked') return null;
  const at = apptStartMs(a);
  if (at === null || now <= at) return null;
  const min = Math.floor((now - at) / 60000);
  return min >= 1 ? min : null;
}

/** The Appointments tab's accessible name: "Appointments, 7, 1 overdue". */
export function apptTabAria(n: number, overdue: number): string {
  return `Appointments, ${n}${overdue ? `, ${overdue} overdue` : ''}`;
}

/* ── Side card tabs ───────────────────────────────────────────────────────────────────────────────────────── */

export type SideTab = 'who' | 'appt' | 'home';
export interface SideTabInputs {
  /** "Who is where" exists: 2+ services, new design, side-by-side cards. */
  who: boolean;
  appt: boolean;
  home: boolean;
  apptN: number;
  overdue: number;
  homeN: number;
}
export interface SideTabOption { value: SideTab; label: string; count?: number; alert?: boolean; aria?: string }

/** The side card's tab row: "Who is where" | Appointments n (rose dot when overdue) | Home n. A single-service user
 *  (no chart) keeps exactly today's "Appointments | Home collection". */
export function sideTabOptions(i: SideTabInputs): SideTabOption[] {
  const out: SideTabOption[] = [];
  if (i.who) out.push({ value: 'who', label: 'Who is where' });
  if (i.appt) out.push({ value: 'appt', label: 'Appointments', count: i.apptN, alert: i.overdue > 0, aria: apptTabAria(i.apptN, i.overdue) });
  if (i.home) out.push({ value: 'home', label: i.who ? 'Home' : 'Home collection', count: i.homeN });
  return out;
}

/** The tab on show: a remembered "Who is where" reads as Appointments (or Home when appointments are off) wherever
 *  the chart doesn't exist. */
export function effectiveSideTab(t: SideTab, i: Pick<SideTabInputs, 'who' | 'appt' | 'home'>): SideTab {
  if (t !== 'who' || i.who) return t;
  return i.appt || !i.home ? 'appt' : 'home';
}
