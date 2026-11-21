import type { ServiceId } from '../../../../core/services/service-shelf';
import { durationText } from '../../../../shared/utils/work-grid';
import type { FlowRow } from '../flow-grid/flow-row';
import { stepOfRow } from '../who-is-where/who-is-where';
import { sectionLabel } from './sections';

/**
 * Frontdesk CLINIC view (owner mock fd-morph-clinic, 2026-11-21) — the pure rules. The same rows the list shows, put
 * where they are: per service, a block of PLACES. Only places our data names (never an invented room):
 *  - OPD: Waiting area (status waiting), Vitals (status vitals), one room per doctor seen in today's open visits
 *    (titled by the doctor — the visit feed carries no room number), Booked (not arrived), Billing counter (a visit's
 *    open bill), Seen today;
 *  - Lab: Billing counter (drafts, Bill / Pay now rows, Payments due), Collection (Collect / Recollect), then one
 *    place per "Where now" step the rows are at (In lab, Dispatched …), At partner lab, Reports ready;
 *  - IPD / Scan / ER: Billing counter, then their "Where now" steps, Done today.
 * Room fitting (`fitRoom`) degrades like the mock: full chips → dense (token + wait) → hide the "who" line →
 * "+N more" → the count in the title.
 */

export interface ClinicChip {
  id: string;
  token: string;
  name: string;
  wait: string;
  waitMin: number;
  late: boolean;
  /** Being seen right now (in consult / at vitals). */
  now: boolean;
}

export interface ClinicPlace {
  id: string;
  title: string;
  /** The quiet line under the title ("General · 3 waiting", "12 waiting · longest 41m"). */
  who: string;
  /** Second quiet line (the waiting area's per-doctor split). */
  by?: string;
  status: { label: string; run: boolean } | null;
  chips: ClinicChip[];
  /** The waiting area: big count, spans two rows of its block when there is room. */
  wait?: boolean;
}

export interface ClinicService {
  id: ServiceId;
  label: string;
  n: number;
  late: number;
  places: ClinicPlace[];
}

const strip = (n: string) => n.replace(/^(Mr\.|Ms\.|Mrs\.|Master|Baby|Dr\.)\s+/i, '').replace(/\s*\(.*?\)\s*$/, '');

export function chipOf(r: FlowRow): ClinicChip {
  const no = r.order?.dailyNo;
  const token = r.visit ? r.visit.tokenLabel : no ? `#${no}` : r.kind === 'draft' ? 'Draft' : '—';
  const now = !!r.visit && (r.visit.status === 'in_consult' || r.visit.status === 'vitals');
  return { id: r.id, token, name: strip(r.name), wait: r.waitMin === null ? '' : r.wait, waitMin: r.waitMin ?? -1, late: r.late, now };
}

/** Late first, then the longest wait, then the row order. */
export function byWait(a: ClinicChip, b: ClinicChip): number {
  return (Number(b.late) - Number(a.late)) || (b.waitMin - a.waitMin);
}

interface Slot { key: string; title: string; rank: number }

const isBillRow = (r: FlowRow) => r.kind === 'draft' || r.status === 'billing' || r.next?.id === 'bill' || r.next?.id === 'pay';

/** Where a row sits. `rank` orders the places inside the service block. */
export function placeOf(r: FlowRow): Slot {
  const s = r.service;
  const v = r.visit;
  if (v) {
    switch (v.status) {
      case 'waiting': return { key: 'opd:wait', title: 'Waiting area', rank: 0 };
      case 'vitals': return { key: 'opd:vitals', title: 'Vitals', rank: 1 };
      case 'in_consult': return { key: `opd:doc:${v.doctorUserId}`, title: v.doctorName || 'Doctor', rank: 2 };
      case 'booked': return { key: 'opd:booked', title: 'Booked · not here yet', rank: 6 };
      default: return r.due > 0 ? { key: 'opd:bill', title: 'Billing counter', rank: 7 } : { key: 'opd:done', title: 'Seen today', rank: 8 };
    }
  }
  if (isBillRow(r)) return { key: `${s}:bill`, title: 'Billing counter', rank: 0 };
  if (r.kind === 'synthetic' || r.status === 'out') return { key: `${s}:partner`, title: 'At partner lab', rank: 7 };
  if (r.status === 'done') return { key: `${s}:done`, title: s === 'lab' ? 'Reports ready' : 'Done today', rank: 8 };
  const n = r.next?.id;
  if (s === 'lab' && (n === 'collect' || n === 'recollect')) return { key: 'lab:collect', title: 'Collection', rank: 1 };
  const step = stepOfRow(r);
  return { key: `${s}:step:${step}`, title: step, rank: 3 };
}

/** The shared work-grid duration ("2d 4h", never "1364h 20m"). */
const fmt = (m: number) => durationText(m);

/** The clinic: one block per service in `order` (then any other service that has rows), each with its places. */
export function clinicServices(rows: readonly FlowRow[], order: readonly ServiceId[]): ClinicService[] {
  const by = new Map<ServiceId, FlowRow[]>();
  for (const r of rows) by.set(r.service, [...(by.get(r.service) ?? []), r]);
  const all: ServiceId[] = ['lab', 'opd', 'ipd', 'scan', 'er'];
  const ids = [...order.filter(s => by.has(s)), ...all.filter(s => by.has(s) && !order.includes(s))];
  return ids.map(id => {
    const list = by.get(id)!;
    const places = new Map<string, ClinicPlace & { rank: number }>();
    const get = (sl: Slot) => {
      let p = places.get(sl.key);
      if (!p) places.set(sl.key, p = { id: sl.key, title: sl.title, who: '', status: null, chips: [], rank: sl.rank });
      return p;
    };
    for (const r of list) get(placeOf(r)).chips.push(chipOf(r));
    if (id === 'opd') {
      // One room per doctor seen in today's OPEN visits (a doctor with people waiting and nobody inside reads Free).
      const open = list.filter(r => r.visit && ['booked', 'vitals', 'waiting', 'in_consult'].includes(r.visit.status));
      const docs = new Map<string, { name: string; dept: string }>();
      for (const r of open) docs.set(r.visit!.doctorUserId, { name: r.visit!.doctorName || 'Doctor', dept: r.visit!.departmentName ?? '' });
      for (const [docId, d] of docs) {
        const p = get({ key: `opd:doc:${docId}`, title: d.name, rank: 2 });
        const waiting = open.filter(r => r.visit!.doctorUserId === docId && r.visit!.status === 'waiting').length;
        p.who = [d.dept, waiting ? `${waiting} waiting` : ''].filter(Boolean).join(' · ');
        p.status = p.chips.length ? { label: 'Seeing', run: true } : { label: 'Free', run: false };
      }
      const w = places.get('opd:wait');
      if (w) {
        const longest = Math.max(0, ...w.chips.map(c => c.waitMin));
        w.wait = true;
        w.who = `${w.chips.length} waiting${longest > 0 ? ` · longest ${fmt(longest)}` : ''}`;
        const per = new Map<string, number>();
        for (const r of list) if (r.visit?.status === 'waiting') per.set(r.visit.doctorName, (per.get(r.visit.doctorName) ?? 0) + 1);
        w.by = [...per].map(([d, n]) => `${d} ${n}`).join(' · ');
      }
    }
    for (const p of places.values()) {
      p.chips.sort(byWait);
      if (!p.who && !p.wait) {
        const late = p.chips.filter(c => c.late).length;
        p.who = `${p.chips.length} here${late ? ` · ${late} late` : ''}`;
      }
    }
    const sorted = [...places.values()].sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
    return {
      id, label: sectionLabel(id), n: list.length, late: list.filter(r => r.late).length,
      places: sorted.map(({ rank: _r, ...p }) => p),
    };
  });
}

// ── Block geometry ──────────────────────────────────────────────────────────────────────────────────────────

/** Column spans (of 12) for the service blocks: up to 3 per row, widths by how many places each holds. */
export function blockSpans(placeCounts: readonly number[], single = false, width = 1200): Array<{ span: number; row: number }> {
  const n = placeCounts.length;
  if (!n) return [];
  if (single || n === 1) return placeCounts.map(() => ({ span: 12, row: 0 }));
  // A narrow card takes fewer blocks per row (each block keeps ~330px), never more than 3.
  const maxPerRow = Math.max(1, Math.min(3, Math.floor(width / 330)));
  const rows = Math.ceil(n / maxPerRow);
  const perRow = Math.ceil(n / rows);
  const out: Array<{ span: number; row: number }> = [];
  for (let start = 0, row = 0; start < n; start += perRow, row++) {
    const part = placeCounts.slice(start, start + perRow);
    const k = part.length;
    const min = k === 1 ? 12 : 2;
    const tot = part.reduce((s, c) => s + Math.max(1, c), 0);
    const spans = part.map(c => Math.max(min, Math.round((12 * Math.max(1, c)) / tot)));
    // Make the row sum exactly 12: trim / pad the widest block.
    let diff = 12 - spans.reduce((s, x) => s + x, 0);
    while (diff !== 0) {
      const i = spans.indexOf(diff > 0 ? Math.min(...spans) : Math.max(...spans));
      spans[i] += diff > 0 ? 1 : -1;
      diff += diff > 0 ? -1 : 1;
    }
    for (const s of spans) out.push({ span: s, row });
  }
  return out;
}

/** Relative row heights for the block rows: a row holding more places gets more height (floor 2, so a one-place
 *  row still holds its title + a chip). */
export function blockRowWeights(placeCounts: readonly number[], spans: ReadonlyArray<{ row: number }>): number[] {
  const rows = Math.max(0, ...spans.map(s => s.row + 1));
  if (rows <= 1) return rows ? [1] : [];
  return Array.from({ length: rows }, (_, r) => Math.max(2, ...placeCounts.filter((_, i) => spans[i]?.row === r)));
}

/** Inner grid columns for a block of `places` places at `width` px (each place at least `minW` wide). */
export function placeCols(places: number, width: number, minW = 170): number {
  if (places <= 1) return 1;
  const fit = Math.max(1, Math.floor(width / minW));
  const want = places <= 2 ? places : places <= 4 ? 2 : places <= 6 ? 3 : 4;
  return Math.max(1, Math.min(fit, want));
}

// ── Room fitting ────────────────────────────────────────────────────────────────────────────────────────────

export type FitLevel = 'full' | 'dense' | 'tight' | 'more' | 'counted';

export interface FitInput {
  /** The chip area's width and the room's inner height (px). */
  w: number;
  h: number;
  /** Title line and the "who" lines' heights. */
  head: number;
  who: number;
  gap: number;
  chipH: number;
  /** Each chip's width with its name (full) and token + wait only (dense). */
  full: readonly number[];
  dense: readonly number[];
  /** Width of the "+N more" chip for n hidden. */
  moreW: (n: number) => number;
  /** The waiting area keeps its count line (mock: tight never hides it) — skip the "hide who" step. */
  keepWho?: boolean;
}

export interface FitResult { level: FitLevel; shown: number }

/** Lines a left-to-right wrap of `widths` takes in `w` (a chip wider than the line takes a line of its own). */
export function wrapLines(widths: readonly number[], w: number, gap: number): number {
  if (!widths.length) return 0;
  let lines = 1;
  let x = 0;
  for (const raw of widths) {
    const cw = Math.min(raw, w);
    if (x > 0 && x + gap + cw > w) { lines++; x = cw; } else x = x > 0 ? x + gap + cw : cw;
  }
  return lines;
}

const heightOf = (lines: number, chipH: number, gap: number) => (lines <= 0 ? 0 : lines * chipH + (lines - 1) * gap);

/** The first level at which every shown chip lies fully inside the room (never overlapping, never cut). */
export function fitRoom(f: FitInput): FitResult {
  const n = f.full.length;
  if (!n) return { level: 'full', shown: 0 };
  const withWho = f.h - f.head - f.who - f.gap;
  const noWho = f.keepWho ? withWho : f.h - f.head - f.gap;
  // A chip wider than the room would be cut: that level does not fit.
  const fits = (widths: readonly number[], room: number) =>
    widths.every(x => x <= f.w) && heightOf(wrapLines(widths, f.w, f.gap), f.chipH, f.gap) <= room;
  if (fits(f.full, withWho)) return { level: 'full', shown: n };
  if (fits(f.dense, withWho)) return { level: 'dense', shown: n };
  if (!f.keepWho && fits(f.dense, noWho)) return { level: 'tight', shown: n };
  for (let k = n - 1; k >= 1; k--) {
    if (fits([...f.dense.slice(0, k), f.moreW(n - k)], noWho)) {
      // Never "+1 more": one hidden chip is no better than the chip itself (it did not fit, so drop one more).
      if (n - k === 1) continue;
      return { level: 'more', shown: k };
    }
  }
  return { level: 'counted', shown: 0 };
}
