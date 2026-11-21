import { SERVICES, type ServiceId } from '../../../../core/services/service-shelf';
import { statusWord } from '../../../opd/frontdesk/visit-status';
import { normalizePriority } from '../../../../shared/utils/lab-priority';
import type { FlowRow } from '../flow-grid/flow-row';

/**
 * Frontdesk "All = one screen split by service" (owner mock fd-sections/ColsGrouped, 2026-11-21) — the pure rules:
 *  - which sections show (a service the tenant has, with rows; a row of a service the tenant no longer has is never
 *    hidden — its section is appended after the user's order),
 *  - the USER's section order (owner 2026-11-21: no automatic ordering; drag a header / Alt+↑↓; default = the Services
 *    shelf order; saved per tenant + user in localStorage; new services append, retired ones are ignored),
 *  - each service's OWN columns, built only from data the rows already carry (no Room / Bay / Ward·bed / Discharge:
 *    nothing in the feeds says those), and which ones fold away first when the section's grid is narrow.
 */

/** A section-specific column (Token · Patient · Journey · Next are every section's). */
export type SectionColId = 'doctor' | 'vitals' | 'consult' | 'samples' | 'where' | 'admitted' | 'triage' | 'arrived' | 'wait' | 'pay';

export interface SectionCell { text: string; late?: boolean }
export type SectionCells = Partial<Record<SectionColId, SectionCell>>;

export interface SectionColPlan {
  id: SectionColId;
  header: string;
  /** Laid-out minimum (px) and flex share (0 = fixed width = min). */
  min: number;
  flex: number;
  align: 'left' | 'center';
  /** Fold rank: the highest folds away first on a narrow grid; 0 never folds. */
  fold: number;
}

const C = (id: SectionColId, header: string, min: number, flex: number, align: 'left' | 'center', fold: number): SectionColPlan =>
  ({ id, header, min, flex, align, fold });

const WAIT = C('wait', 'Waiting', 104, 0, 'center', 1);
const PAY = C('pay', 'Payment', 110, 0, 'center', 4);

/** Each service's own middle columns (owner list; only what we have data for). */
export const SECTION_COLS: Record<ServiceId, readonly SectionColPlan[]> = {
  opd: [C('doctor', 'Doctor', 130, 0.8, 'left', 2), C('vitals', 'Vitals', 110, 0.6, 'left', 3), C('consult', 'Consult', 130, 0.8, 'left', 0), WAIT, PAY],
  lab: [C('samples', 'Samples', 120, 0.5, 'center', 0), C('where', 'Where now', 160, 1, 'left', 3), WAIT, PAY],
  ipd: [C('admitted', 'Admitted', 110, 0.4, 'center', 2), C('doctor', 'Doctor', 130, 0.8, 'left', 3), C('where', 'Where now', 160, 1, 'left', 0), PAY],
  er: [C('triage', 'Triage', 96, 0, 'center', 0), C('arrived', 'Arrived', 96, 0, 'center', 2), C('where', 'Where now', 160, 1, 'left', 3), WAIT, PAY],
  scan: [C('where', 'Where now', 160, 1, 'left', 0), WAIT, PAY],
};

/** The columns a section shows when `avail` px are left for its OWN columns (after Token · Patient · Journey · Next):
 *  fold the highest rank until their minimums fit. `folded` = Payment rides the patient line. */
export function sectionPlan(service: ServiceId, avail: number): { cols: SectionColPlan[]; folded: boolean } {
  let cols = [...SECTION_COLS[service]];
  const need = () => cols.reduce((s, c) => s + c.min, 0);
  while (need() > avail) {
    const rank = Math.max(...cols.map(c => c.fold));
    if (rank <= 0) break;
    const i = cols.map(c => c.fold).lastIndexOf(rank);
    cols = cols.filter((_, k) => k !== i);
  }
  return { cols, folded: !cols.some(c => c.id === 'pay') };
}

// ── Section order (the user's) ──────────────────────────────────────────────────────────────────────────────

/** Saved order ∩ the services the tenant has now, then any newly granted service in shelf order. */
export function mergeSectionOrder(saved: readonly string[] | null | undefined, services: readonly ServiceId[]): ServiceId[] {
  const have = new Set(services);
  const out: ServiceId[] = [];
  for (const s of saved ?? []) if (have.has(s as ServiceId) && !out.includes(s as ServiceId)) out.push(s as ServiceId);
  for (const s of services) if (!out.includes(s)) out.push(s);
  return out;
}

/** Move `id` to position `to` among the VISIBLE sections; hidden (row-less) services keep their slots. */
export function moveSection(order: readonly ServiceId[], visible: readonly ServiceId[], id: ServiceId, to: number): ServiceId[] {
  const vis = order.filter(s => visible.includes(s));
  const from = vis.indexOf(id);
  if (from < 0) return [...order];
  const t = Math.max(0, Math.min(vis.length - 1, to));
  if (t === from) return [...order];
  const next = [...vis];
  next.splice(from, 1);
  next.splice(t, 0, id);
  let k = 0;
  return order.map(s => (visible.includes(s) ? next[k++] : s));
}

export const sectionOrderKey = (tenantId: string | null | undefined, userId: string | null | undefined) =>
  `pf.fd.sectionOrder.${tenantId || 'tenant'}.${userId || 'anon'}`;

export function loadSectionOrder(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? v.filter((x: unknown): x is string => typeof x === 'string') : null;
  } catch { return null; }
}

export function saveSectionOrder(key: string, order: readonly string[]): void {
  try { localStorage.setItem(key, JSON.stringify(order)); } catch { /* private mode: not remembered */ }
}

// ── Sections ────────────────────────────────────────────────────────────────────────────────────────────────

export interface WorkSection {
  id: ServiceId;
  label: string;
  rows: FlowRow[];
  late: number;
}

const LABEL: Record<ServiceId, string> = { lab: 'Lab', opd: 'OPD', ipd: 'IPD', scan: 'Scan', er: 'Emergency' };
export const sectionLabel = (s: ServiceId) => LABEL[s];

/** Group the (already filtered + sorted) rows by service, in the user's order; empty services drop out; a row whose
 *  service is not in `order` (no longer granted) still shows, in a section after the ordered ones. Rows keep their order. */
export function buildSections(rows: readonly FlowRow[], order: readonly ServiceId[], now = Date.now()): WorkSection[] {
  const by = new Map<ServiceId, FlowRow[]>();
  for (const r of rows) {
    const list = by.get(r.service) ?? [];
    list.push(r);
    by.set(r.service, list);
  }
  const ids = [...order.filter(s => by.has(s)), ...SERVICES.map(s => s.id).filter(s => by.has(s) && !order.includes(s))];
  return ids.map(id => {
    const list = by.get(id)!;
    const cells = sectionCells(id, list, now);
    return { id, label: LABEL[id], rows: list.map(r => ({ ...r, cells: cells.get(r.id) })), late: list.filter(r => r.late).length };
  });
}

/** "11:30" today, "Yesterday", or "18 Nov". */
export function dayTime(iso: string | null | undefined, now: number): string {
  const t = Date.parse(String(iso ?? ''));
  if (!t) return '—';
  const d = new Date(t);
  const n = new Date(now);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, n)) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now - 86400000);
  if (sameDay(d, y)) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** "Not drawn" · "Drawn" · "1 of 2 drawn" — from the order's own tubes. */
export function samplesText(samples: ReadonlyArray<{ status: string }> | null | undefined): string {
  const list = samples ?? [];
  if (!list.length) return '—';
  const drawn = list.filter(s => s.status && s.status !== 'pending' && s.status !== 'rejected').length;
  if (list.length === 1) return drawn ? 'Drawn' : 'Not drawn';
  return drawn === list.length ? `All ${list.length} drawn` : `${drawn} of ${list.length} drawn`;
}

/** Waiting patients ahead of each OPD visit in its own doctor's queue (by check-in time). */
export function opdAhead(rows: readonly FlowRow[]): Map<string, number> {
  const out = new Map<string, number>();
  const waiting = rows.filter(r => r.visit && r.visit.status === 'waiting');
  const t = (r: FlowRow) => Date.parse(r.visit!.checkedInAt ?? r.visit!.createdAt) || 0;
  for (const r of waiting) {
    out.set(r.id, waiting.filter(o => o !== r && o.visit!.doctorUserId === r.visit!.doctorUserId && t(o) < t(r)).length);
  }
  return out;
}

function sectionCells(service: ServiceId, rows: readonly FlowRow[], now: number): Map<string, SectionCells> {
  const out = new Map<string, SectionCells>();
  const ahead = service === 'opd' ? opdAhead(rows) : new Map<string, number>();
  for (const r of rows) {
    const c: SectionCells = {
      wait: { text: r.wait, late: r.late },
      pay: { text: r.pay, late: r.payDue },
      where: { text: r.where },
    };
    const v = r.visit;
    if (v) {
      c.doctor = { text: v.doctorName || '—' };
      c.vitals = v.vitalsSummary ? { text: v.vitalsSummary, late: v.vitalsFlagged } : { text: v.status === 'vitals' ? 'Now' : '—' };
      const n = ahead.get(r.id);
      c.consult = { text: v.status === 'waiting' && n !== undefined ? `Waiting · ${n === 0 ? 'next' : `${n} ahead`}` : statusWord(v.status) };
    } else {
      const o = r.order;
      c.doctor = { text: o?.refDoctorName?.trim() || '—' };
      c.consult = { text: r.where };
      c.vitals = { text: '—' };
      c.samples = { text: r.kind === 'draft' ? 'Not ordered' : samplesText(o?.samples) };
      c.admitted = { text: dayTime(o?.createdAt as unknown as string, now) };
      c.arrived = { text: dayTime(o?.createdAt as unknown as string, now) };
      const urgent = o ? normalizePriority(o.priority) === 'urgent' : r.urgent;
      c.triage = { text: urgent ? 'Urgent' : 'Normal', late: urgent };
    }
    out.set(r.id, c);
  }
  return out;
}
