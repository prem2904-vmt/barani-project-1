/**
 * The consult's left VISIT card (consult v6) — PURE builders: the "Always"
 * strip's watch line, the selected visit's items (visit flow, vitals record,
 * desk note, intake, reports, results, images, prescription), the prefill
 * review list and the centre tab counts. No DOM, no HTTP.
 */
import type { OpdDiagnosis, OpdRxLineDto } from '../shared/opd.models';
import { journeyDayKey } from '../shared/journey-dock.service';
import type { ConsultEditState } from './consult-state';
import type { ConsultPastConsult, ConsultVitals, ConsultWorkspace } from './consult.api';
import { vitalFlag, vitalText } from './vitals-strip.component';

/** One recent lab value (latest point of a trended parameter). */
export interface RecentResult { test: string; param: string; value: string; unit?: string | null; flag?: string | null; date: string;
  /** Numeric history, oldest → newest (≤ 6) — the tiny trend line. */
  points?: number[]; }

/** SVG polyline points for a tiny trend (w×h box), or '' for < 2 values. Pure. */
export function sparkPoints(vals: readonly number[] | undefined, w = 48, h = 16): string {
  if (!vals || vals.length < 2) return '';
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  return vals.map((v, i) => `${((i * (w - 4)) / (vals.length - 1) + 2).toFixed(1)},${(h - 2 - ((v - lo) / span) * (h - 4)).toFixed(1)}`).join(' ');
}

/** Latest point per parameter from /api/patients/{id}/lab-trends, newest first. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function recentResultsOf(trends: any, max = 6): RecentResult[] {
  const out: RecentResult[] = [];
  for (const t of trends?.tests ?? []) {
    for (const p of t.parameters ?? []) {
      const pts = [...(p.points ?? [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const last = pts[0];
      if (!last) continue;
      const nums = pts.slice(0, 6).reverse().map(x => Number(x.value)).filter(n => Number.isFinite(n));
      out.push({ test: t.testName, param: p.name ?? p.parameter ?? t.testName, value: String(last.value), unit: p.unit, flag: last.flag, date: last.date, points: nums });
    }
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, max);
}

const flagged = (f: unknown) => { const s = String(f ?? '').trim().toUpperCase(); return !!s && s !== 'N'; };

/** The "Always" strip's watch line: the newest out-of-range value with its
 *  previous one ("Fasting Blood Sugar 118 → 145"), or null. Pure. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function watchLine(trends: any): string | null {
  let best: { date: string; text: string } | null = null;
  for (const t of trends?.tests ?? []) for (const p of t.parameters ?? []) {
    const pts = [...(p.points ?? [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const last = pts[pts.length - 1];
    if (!last || !flagged(last.flag)) continue;
    const name = p.name ?? p.parameter ?? t.testName;
    const prev = pts[pts.length - 2];
    const text = prev ? `${name} ${prev.value} → ${last.value}` : `${name} ${last.value}${p.unit ? ' ' + p.unit : ''}`;
    if (!best || String(last.date) > best.date) best = { date: String(last.date), text };
  }
  return best?.text ?? null;
}

/** One record of a visit on the left card. */
export type VisitItemType = 'flow' | 'vit' | 'pre' | 'res' | 'pdf' | 'img' | 'rx';
export interface VisitItem {
  id: string;
  type: VisitItemType;
  title: string;
  sub: string;
  /** Out of range / needs attention (red sub-line). */
  high?: boolean;
  /** Can be ticked for Compare. */
  compare: boolean;
  /** Flow steps (time, what). */
  steps?: { at: string; what: string }[];
  /** A lab result. */
  result?: { value: string; unit?: string | null; flag?: string | null; range?: string | null; points: { date: string; value: number }[] };
  /** A prescription's lines (past visit) — repeatable. */
  rx?: OpdRxLineDto[];
  /** The timeline file behind a report / image ('rep:' + orderId | 'doc:' + docId). */
  fileId?: string;
  /** A whole consult (visit flow) — comparable side by side with today's. */
  consultId?: string;
  /** Free text (desk note / intake). */
  text?: string;
  /** The visit date (compare labels). */
  date: string;
}

/** A lab order / document of the day as the journey loads them. */
export interface DayLabOrder { id: string; name: string; createdAt: string; hasReport: boolean; }
export interface DayDoc { id: string; fileName: string; isImage: boolean; uploadedAt: string; }

const hm = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const dxText = (d: readonly OpdDiagnosis[]) => d.map(x => x.label).join(', ');

/** Out-of-range vitals of a capture ("BP low"), for the record's sub-line. Pure. */
export function vitalsWarnings(v: ConsultVitals | null | undefined): string[] {
  if (!v) return [];
  const names: Record<string, string> = { pulse: 'Pulse', bp: 'BP', temp: 'Temp', spo2: 'SpO₂', rr: 'RR', bmi: 'BMI' };
  return (['bp', 'pulse', 'temp', 'spo2', 'rr', 'bmi'] as const)
    .map(k => ({ k, f: vitalFlag(k, v) })).filter(x => !!x.f).map(x => `${names[x.k]} ${x.f}`);
}

/** The selected visit's records, newest-first within the day's own order:
 *  today = flow · vitals · desk note · intake · reports / results / images;
 *  a past day = flow · prescription · reports / results / images. Pure. */
export function visitItems(a: {
  dayKey: string; todayKey: string; ws: ConsultWorkspace; history: readonly ConsultPastConsult[];
  orders: readonly DayLabOrder[]; docs: readonly DayDoc[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trends: any; intakeCount: number;
}): VisitItem[] {
  const { dayKey, ws } = a;
  const out: VisitItem[] = [];
  const isToday = dayKey === a.todayKey;
  if (isToday) {
    const v = ws.visit;
    // No "Today's consult" tile: the doctor is in it (owner). Compare still
    // adds today's column itself (the page's consultItem), and past visits
    // keep their consult tile below.
    if (ws.vitals) {
      const warn = vitalsWarnings(ws.vitals);
      out.push({ id: 'today:vit', type: 'vit', title: 'Vitals record', compare: false, date: dayKey, high: warn.length > 0,
        sub: [ws.vitals.recordedByName || 'Vitals station', hm(ws.vitals.recordedAt), ...warn].filter(Boolean).join(' · ') });
    }
    if (v.purpose) out.push({ id: 'today:desk', type: 'pre', title: 'Desk note', sub: 'Complaint from the front desk', compare: false, date: dayKey, text: v.purpose });
    if (a.intakeCount > 0) out.push({ id: 'today:intake', type: 'pre', title: 'Intake form', sub: `${plural(a.intakeCount, 'answer')} filled before the consult`, compare: false, date: dayKey });
  } else {
    for (const c of a.history.filter(h => journeyDayKey(h.visitDate) === dayKey)) {
      const steps = [
        { at: '', what: `OPD · ${c.doctorName || 'Doctor'}${c.departmentName ? ' · ' + c.departmentName : ''}` },
        c.chiefComplaint ? { at: '', what: 'Complaint · ' + c.chiefComplaint } : null,
        c.diagnoses.length ? { at: '', what: 'Diagnosis · ' + dxText(c.diagnoses) } : null,
        c.rx.length ? { at: '', what: plural(c.rx.length, 'medicine') + ' prescribed' } : null,
        c.investigations.flatMap(i => i.items).length ? { at: '', what: 'Tests · ' + c.investigations.flatMap(i => i.items).map(t => t.name).join(', ') } : null,
      ].filter((x): x is { at: string; what: string } => !!x);
      out.push({ id: 'consult:' + c.visitId, consultId: c.visitId, type: 'flow', title: 'Consult', compare: true, date: dayKey, steps,
        sub: [`OPD · ${c.doctorName || 'Doctor'}`, c.diagnoses.length ? dxText(c.diagnoses) : ''].filter(Boolean).join(' · ') });
      // The Rx compares as part of its consult (aligned by drug), not on its own.
      if (c.rx.length) out.push({ id: 'rx:' + c.visitId, type: 'rx', title: 'Prescription', sub: plural(c.rx.length, 'medicine'), compare: false, date: dayKey, rx: c.rx });
    }
  }
  for (const o of a.orders.filter(x => journeyDayKey(x.createdAt) === dayKey)) {
    if (o.hasReport) out.push({ id: 'rep:' + o.id, type: 'pdf', title: 'Lab report', sub: o.name, compare: true, date: dayKey, fileId: 'rep:' + o.id });
  }
  for (const t of a.trends?.tests ?? []) for (const p of t.parameters ?? []) {
    const pts = [...(p.points ?? [])].sort((x, y) => String(x.date).localeCompare(String(y.date)));
    const today = pts.filter(x => journeyDayKey(String(x.date)) === dayKey);
    const last = today[today.length - 1];
    if (!last) continue;
    const name = p.name ?? p.parameter ?? t.testName;
    const hi = flagged(last.flag);
    const word = hi ? (String(last.flag).toUpperCase().startsWith('L') ? 'Low' : 'High') : '';
    out.push({ id: `res:${dayKey}:${t.testName}:${name}`, type: 'res', title: name, compare: true, date: dayKey, high: hi,
      sub: `${last.value}${p.unit ? ' ' + p.unit : ''}${word ? ' · ' + word : ''}`,
      result: { value: String(last.value), unit: p.unit, flag: last.flag, range: p.range ?? p.referenceRange ?? null,
        points: pts.map(x => ({ date: String(x.date), value: Number(x.value) })).filter(x => Number.isFinite(x.value)) } });
  }
  for (const d of a.docs.filter(x => journeyDayKey(x.uploadedAt) === dayKey)) {
    out.push({ id: 'doc:' + d.id, type: d.isImage ? 'img' : 'pdf', title: d.fileName, sub: d.isImage ? 'Image' : 'Document', compare: true, date: dayKey, fileId: 'doc:' + d.id });
  }
  return out;
}

/** All / Reports / Images on the left card. */
export type VisitFilter = 'all' | 'reports' | 'images';
export function filterItems(items: readonly VisitItem[], f: VisitFilter): VisitItem[] {
  if (f === 'all') return [...items];
  if (f === 'reports') return items.filter(i => i.type === 'pdf' || i.type === 'res');
  return items.filter(i => i.type === 'img');
}

// ── Prefill review (Findings) ───────────────────────────────────────────

export interface Prefill { id: string; label: string; value: string; src: string; warn?: boolean; }

/** What was filled in before the consult and still needs the doctor's look:
 *  the desk's complaint, today's vitals (with what is out of range) and any
 *  intake answers the server marks as pre-filled. Pure. */
export function prefillsOf(ws: ConsultWorkspace, s: Pick<ConsultEditState, 'chiefComplaint' | 'answers'>, labelOf: (key: string) => string): Prefill[] {
  const out: Prefill[] = [];
  const purpose = (ws.visit.purpose ?? '').trim();
  if (purpose && s.chiefComplaint.trim() === purpose) {
    out.push({ id: 'complaint', label: 'Complaint', value: purpose, src: `Front desk${ws.visit.checkedInAt ? ' · ' + hm(ws.visit.checkedInAt) : ''}` });
  }
  const v = ws.vitals;
  if (v) {
    const warn = vitalsWarnings(v);
    const bits = (['bp', 'pulse', 'temp', 'spo2'] as const).map(k => ({ k, t: vitalText(k, v) })).filter(x => x.t !== '—')
      .map(x => `${({ bp: 'BP', pulse: 'Pulse', temp: 'Temp', spo2: 'SpO₂' } as const)[x.k]} ${x.t}`);
    out.push({
      id: 'vitals', label: 'Vitals', warn: warn.length > 0,
      value: warn.length ? `${warn.join(', ')}. Recheck before you prescribe.` : bits.join(', ') || 'Recorded',
      src: `${v.recordedByName || 'Vitals station'}${v.recordedAt ? ' · ' + hm(v.recordedAt) : ''}`,
    });
  }
  for (const key of ws.prefilledAnswerKeys ?? []) {
    const val = s.answers[key];
    if (val == null || val === '' || (Array.isArray(val) && !val.length)) continue;
    out.push({ id: 'ans:' + key, label: labelOf(key), value: Array.isArray(val) ? val.join(', ') : String(val), src: 'Intake form' });
  }
  return out;
}

// ── Centre tabs (spaces) ────────────────────────────────────────────────

export type ConsultSpace = 'find' | 'dx' | 'med' | 'proc' | 'test' | 'adv';
export const SPACES: readonly { id: ConsultSpace; label: string }[] = [
  { id: 'find', label: 'Findings' }, { id: 'dx', label: 'Diagnosis' }, { id: 'med', label: 'Prescription' },
  { id: 'proc', label: 'Procedures' }, { id: 'test', label: 'Tests' }, { id: 'adv', label: 'Advice & notes' },
];
/** The count beside each tab (Findings shows none — it has the amber dot). Pure. */
export function spaceCount(id: ConsultSpace, s: ConsultEditState): number {
  switch (id) {
    case 'find': return 0;
    case 'dx': return s.diagnoses.length;
    case 'med': return s.lines.length;
    case 'proc': return s.procedures?.length ?? 0;
    case 'test': return s.tests.length;
    case 'adv': return (s.advice.trim() ? 1 : 0) + (s.followUpDays != null ? 1 : 0) + (s.privateNotes.trim() ? 1 : 0);
  }
}

// ── Side panels: auto-balance (owner) ───────────────────────────────────

/** The docked patient card's width and the narrowest centre the form still fits in. */
export const PANEL_W = { right: 320, minCentre: 680 } as const;

/** The patient card docks only when pinned AND the centre keeps
 *  ≥ PANEL_W.minCentre px of `width` (the body's content box, minus the
 *  column `gap`); otherwise it opens over the centre. A pin is never
 *  overwritten — the layout just can't honour it until there is room. Pure. */
export function balancePanels(width: number, gap: number, rightPinned: boolean): { rightDocked: boolean } {
  if (!rightPinned) return { rightDocked: false };
  if (!width) return { rightDocked: true };
  return { rightDocked: width - gap - PANEL_W.right >= PANEL_W.minCentre };
}
