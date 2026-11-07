/**
 * Patient profile — CLINICAL-FIRST helpers (docs/PF-PATTERN.md §22).
 *
 * Pure functions, no Angular: the page reads
 *  - GET /api/patients/{id}                    → patient, orders (history), appointments
 *  - GET /api/patients/{id}/cumulative-results → every resulted test with the
 *    value / unit / printed range / flag the lab SAVED (one query)
 * and turns them into the snapshot ("needs attention", "in progress now",
 * "last visit"), the analyte × date cumulative grid (sparklines, trend
 * arrows, unit-mismatch flag), the timeline feed and the permission-gated
 * quick actions. Nothing here is invented: no data → an empty state.
 */
import { Order } from '../../../shared/models/order.model';
import { canOpenRoute, type RouteAccessCtx } from '../../../core/auth/route-access';
import { flagCodeOf, isCriticalFlag, type FlagCode } from '../../../shared/utils/result-flag';
import { orderTests, orderTitle } from './patient-profile.nd';
import { resultValueText } from '../../../shared/utils/option-family';

// ── API shapes ───────────────────────────────────────────────────────────

export interface CumulativeValue {
  name: string; title: string; value: string; num: number | null;
  unit?: string | null; range?: string | null; flag?: string | null;
}
export interface CumulativeResult {
  orderTestId: string; orderId: string; orderNumber?: string | null; orderedAt: string;
  testId: string; testName: string; testCode?: string | null; department?: string | null; panel?: string | null;
  status: string; final: boolean; resultedAt?: string | null; values: CumulativeValue[];
}
export interface CumulativePayload { results: CumulativeResult[]; truncated?: boolean; }

/** The profile payload's per-order extras (bill + report summaries). */
export interface OrderExtras {
  bill?: { id: string; status?: string | null; totalPayable?: number | null; balance?: number | null } | null;
  report?: { id: string; status?: string | null; deliveryStatus?: string | null } | null;
}
export type ProfileOrder = Order & OrderExtras;

export interface PatientAppointment {
  id: string; type?: string | null; collectionType?: string | null; appointmentDate: string;
  slotTime?: string | null; status?: string | null; refDoctorName?: string | null; notes?: string | null;
}

// ── Small shared bits ────────────────────────────────────────────────────

export type Tone = 'normal' | 'abnormal' | 'critical';
export type Dir = 'up' | 'down' | 'flat' | null;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Aug" (this year) or "12 Aug 25" (another year). Local time. */
export function shortDate(iso: string | null | undefined, now = new Date()): string {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return '—';
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${String(d.getFullYear()).slice(2)}`;
}

/** "4:30 PM" local. */
export function shortTime(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return '';
  const h = d.getHours(), m = d.getMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const time = (iso: string | null | undefined) => { const t = iso ? new Date(iso).getTime() : NaN; return isNaN(t) ? 0 : t; };

/** Lower / upper bound of a printed reference range: "13 - 17", "13–17 g/dL",
 *  "< 200", "> 40", "Up to 5", "0.5 to 1.2". Only the first line counts
 *  (multi-band text lists the patient's band first). Null when unreadable. */
export function parseRangeBounds(range: string | null | undefined): { lo?: number; hi?: number } | null {
  const line = String(range ?? '').split(/\r?\n|·/)[0].replace(/,/g, '').trim();
  if (!line) return null;
  const num = '(-?\\d+(?:\\.\\d+)?)';
  let m = line.match(new RegExp(`${num}\\s*(?:-|–|—|to)\\s*${num}`, 'i'));
  if (m) return { lo: +m[1], hi: +m[2] };
  m = line.match(new RegExp(`^(?:<=?|≤|up\\s*to|upto|below|less\\s*than)\\s*${num}`, 'i'));
  if (m) return { hi: +m[1] };
  m = line.match(new RegExp(`^(?:>=?|≥|above|more\\s*than|greater\\s*than)\\s*${num}`, 'i'));
  if (m) return { lo: +m[1] };
  return null;
}

/** mw flag → the three review tones (CL / CH / legacy C via the shared
 *  isCriticalFlag — never `=== 'C'`). */
export function toneOf(flag: string | null | undefined): Tone {
  if (isCriticalFlag(flag)) return 'critical';
  const c = flagCodeOf(flag);
  if (c === 'H' || c === 'L' || c === 'A') return 'abnormal';
  return 'normal';
}

/** Which way a flagged value sits, from the STORED code: H / CH up, L / CL
 *  down. Legacy direction-less C (and A / N) has no direction. */
export function flagDir(flag: string | null | undefined): 'up' | 'down' | null {
  const c = flagCodeOf(flag);
  if (c === 'H' || c === 'CH') return 'up';
  if (c === 'L' || c === 'CL') return 'down';
  return null;
}

/** Units compare case/space-insensitively, µ = u, "^" ignored. */
export function normUnit(u: string | null | undefined): string {
  return String(u ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(/[µμ]/g, 'u').replace(/\^/g, '');
}

/** Change vs the previous value: "+18%" (or the absolute step when the
 *  previous value is 0). */
export function deltaOf(latest: number | null | undefined, prev: number | null | undefined): { dir: Dir; pct: number | null; text: string } | null {
  if (latest == null || prev == null) return null;
  const d = latest - prev;
  if (d === 0) return { dir: 'flat', pct: 0, text: 'no change' };
  const dir: Dir = d > 0 ? 'up' : 'down';
  if (prev === 0) return { dir, pct: null, text: `${d > 0 ? '+' : '−'}${fmtNum(Math.abs(d))}` };
  const pct = Math.round((d / Math.abs(prev)) * 100);
  return { dir, pct, text: `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%` };
}
function fmtNum(n: number): string { return Number.isInteger(n) ? String(n) : n.toFixed(Math.abs(n) >= 10 ? 1 : 2).replace(/\.?0+$/, ''); }

// ── Cumulative grid ──────────────────────────────────────────────────────

export interface CumColumn { orderId: string; orderNumber?: string | null; date: string; label: string; final: boolean; }
export interface CumCell {
  orderId: string; orderTestId: string; value: string; num: number | null; unit?: string | null;
  range?: string | null; flag: FlagCode; tone: Tone; dir: 'up' | 'down' | null; final: boolean;
  /** This cell's unit differs from the row's (latest) unit. */
  unitOff: boolean;
}
export interface CumPoint { date: string; num: number; tone: Tone; orderId: string; }
export interface CumRow {
  key: string; testId: string; name: string; title: string; testName: string; panel: string; department: string;
  unit: string; range: string; cells: Record<string, CumCell>;
  /** Numeric values, oldest → latest (sparkline + trend). */
  points: CumPoint[];
  latest: CumCell; prev: CumCell | null;
  unitMismatch: boolean; units: string[];
  trend: { dir: Dir; pct: number | null; text: string } | null;
  anyAbnormal: boolean;
}
export interface CumGroup { key: string; department: string; panel: string; rows: CumRow[]; }
export interface CumGrid { columns: CumColumn[]; groups: CumGroup[]; departments: string[]; rowCount: number; }

const OTHER_DEPT = 'Other';

/** Results → the analyte × date grid. Columns are the patient's resulted
 *  ORDERS (visits), newest first. Rows group by department → panel (the
 *  profile a test arrived through, else the test), analytes in the lab's
 *  authored order. A row whose dates carry different units is flagged. */
export function buildCumulative(results: CumulativeResult[] | null | undefined, now = new Date()): CumGrid {
  // One result per (visit, test): the first the API listed wins (a test
  // split across two tubes of one order must not double its column).
  const seenOt = new Set<string>();
  const list = (results ?? [])
    .filter(r => { const k = `${r.orderId}|${r.testId}`; if (seenOt.has(k)) return false; seenOt.add(k); return true; })
    .sort((a, b) => time(b.orderedAt) - time(a.orderedAt));
  const cols = new Map<string, CumColumn>();
  const rows = new Map<string, CumRow & { _order: number }>();
  const groupOrder = new Map<string, number>();
  let seq = 0;

  // Walk oldest → newest so a row's authored order comes from the first
  // time it was seen and the LATEST value lands last.
  for (const r of [...list].reverse()) {
    const col = cols.get(r.orderId);
    if (!col) cols.set(r.orderId, { orderId: r.orderId, orderNumber: r.orderNumber, date: r.orderedAt, label: shortDate(r.orderedAt, now), final: r.final });
    else col.final = col.final && r.final;
    const department = (r.department || '').trim() || OTHER_DEPT;
    const panel = (r.panel || r.testName || 'Tests').trim();
    const gk = `${department}\u0000${panel}`;
    if (!groupOrder.has(gk)) groupOrder.set(gk, groupOrder.size);
    for (const v of r.values ?? []) {
      const key = `${r.testId}|${v.name.trim().toLowerCase()}`;
      const flag = flagCodeOf(v.flag);
      const cell: CumCell = {
        orderId: r.orderId, orderTestId: r.orderTestId, value: resultValueText(v.value), num: v.num ?? null, unit: v.unit ?? null,
        range: v.range ?? null, flag, tone: toneOf(flag), dir: flagDir(flag), final: r.final, unitOff: false,
      };
      let row = rows.get(key);
      if (!row) {
        row = {
          key, testId: r.testId, name: v.name, title: v.title || v.name, testName: r.testName, panel, department,
          unit: '', range: '', cells: {}, points: [], latest: cell, prev: null, unitMismatch: false, units: [],
          trend: null, anyAbnormal: false, _order: seq++,
        };
        rows.set(key, row);
      }
      if (row.cells[r.orderId]) continue;   // one value per visit (the first saved)
      row.cells[r.orderId] = cell;
      row.prev = row.latest === cell ? null : row.latest;
      row.latest = cell;
      row.title = v.title || row.title;
      if (cell.num != null) row.points.push({ date: r.orderedAt, num: cell.num, tone: cell.tone, orderId: r.orderId });
      if (cell.tone !== 'normal') row.anyAbnormal = true;
    }
  }

  for (const row of rows.values()) {
    const cells = Object.values(row.cells);
    row.unit = (row.latest.unit || cells.slice().reverse().find(c => c.unit)?.unit || '').trim();
    row.range = (row.latest.range || '').trim();
    const seen = new Map<string, string>();
    for (const c of cells) if (c.unit?.trim()) seen.set(normUnit(c.unit), c.unit.trim());
    row.units = [...seen.values()];
    row.unitMismatch = seen.size > 1;
    if (row.unitMismatch) for (const c of cells) c.unitOff = !!c.unit?.trim() && normUnit(c.unit) !== normUnit(row.unit);
    // Trend: latest vs the previous NUMERIC value — only across one unit.
    const pts = row.points;
    row.trend = pts.length >= 2 && !row.unitMismatch ? deltaOf(pts[pts.length - 1].num, pts[pts.length - 2].num) : null;
  }

  const groups = new Map<string, CumGroup>();
  for (const row of [...rows.values()].sort((a, b) => a._order - b._order)) {
    const gk = `${row.department}\u0000${row.panel}`;
    let g = groups.get(gk);
    if (!g) groups.set(gk, g = { key: gk, department: row.department, panel: row.panel, rows: [] });
    g.rows.push(row);
  }
  const orderedGroups = [...groups.values()].sort((a, b) =>
    deptRank(a.department) - deptRank(b.department) || a.department.localeCompare(b.department)
    || (groupOrder.get(a.key) ?? 0) - (groupOrder.get(b.key) ?? 0));
  const departments = [...new Set(orderedGroups.map(g => g.department))];
  return {
    columns: [...cols.values()].sort((a, b) => time(b.date) - time(a.date)),
    groups: orderedGroups, departments, rowCount: rows.size,
  };
}
const deptRank = (d: string) => (d === OTHER_DEPT ? 1 : 0);

export interface CumFilter { departments?: string[]; abnormalOnly?: boolean; query?: string; }

/** Department chips (none = all), "abnormal only" (any flagged value) and
 *  the analyte search (analyte, test or panel name). Empty groups drop. */
export function filterCumulative(grid: CumGrid, f: CumFilter): CumGroup[] {
  const depts = new Set(f.departments ?? []);
  const q = (f.query ?? '').trim().toLowerCase();
  const out: CumGroup[] = [];
  for (const g of grid.groups) {
    if (depts.size && !depts.has(g.department)) continue;
    const rows = g.rows.filter(r =>
      (!f.abnormalOnly || r.anyAbnormal)
      && (!q || `${r.title} ${r.name} ${r.testName} ${r.panel}`.toLowerCase().includes(q)));
    if (rows.length) out.push({ ...g, rows });
  }
  return out;
}

// ── Sparklines ───────────────────────────────────────────────────────────

export interface Spark {
  w: number; h: number; d: string;
  dots: Array<{ x: number; y: number; tone: Tone }>;
  /** The reference band as a shaded rect (y + height), when the range reads. */
  band: { y: number; h: number } | null;
}

/** A tiny inline-SVG sparkline over the numeric points (oldest → latest):
 *  the path, a dot per point (flagged ones toned) and the reference band
 *  shaded. y scales over the values AND the band, so "inside the band" reads
 *  at a glance. Null when there are fewer than 2 numbers. */
export function sparkline(points: CumPoint[], range: string | null | undefined, w = 72, h = 24): Spark | null {
  const nums = points.map(p => p.num).filter(n => Number.isFinite(n));
  if (nums.length < 2) return null;
  const b = parseRangeBounds(range);
  const pad = 3;
  const lo0 = Math.min(...nums, ...(b?.lo != null ? [b.lo] : []), ...(b?.hi != null ? [b.hi] : []));
  const hi0 = Math.max(...nums, ...(b?.lo != null ? [b.lo] : []), ...(b?.hi != null ? [b.hi] : []));
  const span = hi0 - lo0 || Math.abs(hi0) || 1;
  const lo = lo0 - span * 0.08, hi = hi0 + span * 0.08;
  const y = (v: number) => +(pad + (h - 2 * pad) * (1 - (v - lo) / (hi - lo))).toFixed(2);
  const step = (w - 2 * pad) / (points.length - 1);
  const dots = points.map((p, i) => ({ x: +(pad + i * step).toFixed(2), y: y(p.num), tone: p.tone }));
  const d = dots.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  let band: Spark['band'] = null;
  if (b && (b.lo != null || b.hi != null)) {
    const top = y(b.hi ?? hi), bot = y(b.lo ?? lo);
    band = { y: Math.min(top, bot), h: +Math.abs(bot - top).toFixed(2) };
  }
  return { w, h, d, dots, band };
}

// ── Snapshot: needs attention ────────────────────────────────────────────

export interface AttentionItem {
  key: string; testId: string; name: string; title: string; testName: string;
  value: string; unit: string; range: string; tone: Tone; dir: 'up' | 'down' | null;
  date: string; dateLabel: string; orderId: string; final: boolean;
  delta: { dir: Dir; pct: number | null; text: string; since: string } | null;
}

/** Current critical + abnormal results: each analyte's LATEST value, when
 *  it is flagged and comes from one of the patient's `recentVisits` most
 *  recent resulted visits (an old flag that was never re-tested is history,
 *  not "now"). Criticals first, then newest. The delta compares with the
 *  previous numeric value in the same unit. */
export function needsAttention(grid: CumGrid, recentVisits = 3, now = new Date()): AttentionItem[] {
  const recent = new Set(grid.columns.slice(0, recentVisits).map(c => c.orderId));
  const colDate = new Map(grid.columns.map(c => [c.orderId, c.date] as const));
  const out: AttentionItem[] = [];
  for (const g of grid.groups) for (const r of g.rows) {
    const c = r.latest;
    if (c.tone === 'normal' || !recent.has(c.orderId)) continue;
    const pts = r.points;
    const last = pts[pts.length - 1];
    const prevPt = last && last.orderId === c.orderId && pts.length >= 2 ? pts[pts.length - 2] : null;
    const prevCell = prevPt ? r.cells[prevPt.orderId] : null;
    const sameUnit = !!prevCell && normUnit(prevCell.unit) === normUnit(c.unit);
    const dl = prevPt && sameUnit ? deltaOf(c.num, prevPt.num) : null;
    const date = colDate.get(c.orderId) ?? '';
    out.push({
      key: r.key, testId: r.testId, name: r.name, title: r.title, testName: r.testName,
      value: c.value, unit: (c.unit || r.unit || '').trim(), range: (c.range || '').trim(),
      tone: c.tone, dir: c.dir, date, dateLabel: shortDate(date, now), orderId: c.orderId, final: c.final,
      delta: dl ? { ...dl, since: shortDate(prevPt!.date, now) } : null,
    });
  }
  return out.sort((a, b) => (a.tone === 'critical' ? 0 : 1) - (b.tone === 'critical' ? 0 : 1) || time(b.date) - time(a.date));
}

// ── Snapshot: in progress now ────────────────────────────────────────────

export const STAGES = ['Collected', 'In lab', 'Awaiting validation', 'Ready'] as const;
export type StageLabel = 'Ordered' | typeof STAGES[number];

/** Where an order is: 0 ordered, 1 collected, 2 in lab, 3 awaiting
 *  validation, 4 ready. -1 = cancelled / rejected (not "in progress"). */
export function orderStage(o: Order): number {
  const s = (o.status || '').toLowerCase();
  if (s === 'cancelled' || s === 'rejected') return -1;
  if (s === 'validated' || s === 'delivered' || s === 'completed') return 4;
  const tests = orderTests(o).filter(t => !['cancelled', 'rejected', 'superseded', 'skipped'].includes(t.status));
  if (tests.length && tests.every(t => ['validated', 'completed', 'reported'].includes(t.status))) return 4;
  if (s === 'resulted' || s === 'partially_validated' || tests.some(t => t.status === 'entered' || t.status === 'resulted')) return 3;
  if (['received_in_lab', 'received', 'processing', 'in_progress', 'partially_rejected'].includes(s)) return 2;
  if (['sample_collected', 'collected', 'dispatched', 'in_transit'].includes(s)) return 1;
  return 0;
}
/** "All orders" filter chips (OPS-109): every order of the patient, whatever its
 *  status - In progress (stage 0-3) / Completed (ready) / Cancelled (cancelled or rejected). */
export type OrderBucket = 'all' | 'progress' | 'done' | 'cancelled';
export function orderBucket(o: Order): Exclude<OrderBucket, 'all'> {
  const st = orderStage(o);
  return st < 0 ? 'cancelled' : st >= 4 ? 'done' : 'progress';
}
export function ordersInBucket<T extends Order>(orders: readonly T[] | null | undefined, b: OrderBucket): T[] {
  return (orders ?? []).filter(o => b === 'all' || orderBucket(o) === b);
}
export function stageLabel(stage: number): StageLabel {
  return stage <= 0 ? 'Ordered' : STAGES[Math.min(stage, 4) - 1];
}

export interface ActiveOrder {
  order: ProfileOrder; title: string; stage: number; stageLabel: StageLabel;
  /** Expected ready time (created + the slowest test's TAT). */
  due: string | null; dueLabel: string; overdue: boolean;
}

/** The orders still moving (ordered … awaiting validation), newest first,
 *  with the expected ready time from the tests' TAT hours. */
export function activeOrders(orders: ProfileOrder[] | null | undefined, now = new Date()): ActiveOrder[] {
  return (orders ?? [])
    .map(o => ({ o, stage: orderStage(o) }))
    .filter(x => x.stage >= 0 && x.stage < 4)
    .sort((a, b) => time(b.o.createdAt) - time(a.o.createdAt))
    .map(({ o, stage }) => {
      const tat = Math.max(0, ...orderTests(o).map(t => Number((t.test as { tatHours?: number } | undefined)?.tatHours) || 0));
      const start = time(o.createdAt);
      const dueMs = tat && start ? start + tat * 3_600_000 : 0;
      const due = dueMs ? new Date(dueMs).toISOString() : null;
      const overdue = !!dueMs && dueMs < now.getTime();
      let dueLabel = '';
      if (due) {
        const sameDay = new Date(dueMs).toDateString() === now.toDateString();
        const when = sameDay ? shortTime(due) : `${shortDate(due, now)}, ${shortTime(due)}`;
        if (overdue) {
          const hrs = Math.round((now.getTime() - dueMs) / 3_600_000);
          dueLabel = hrs >= 1 ? `Overdue by ${hrs < 48 ? `${hrs} h` : `${Math.round(hrs / 24)} days`}` : `Due ${when}`;
        } else dueLabel = `Ready by ${when}`;
      }
      return { order: o, title: orderTitle(o), stage, stageLabel: stageLabel(stage), due, dueLabel, overdue };
    });
}

// ── Snapshot: last visit ─────────────────────────────────────────────────

export interface LastVisit {
  order: ProfileOrder; title: string; date: string; doctor: string;
  report: 'ready' | 'partial' | 'pending' | 'none'; reportLabel: string;
}

/** The newest COMPLETED visit (ready report) — the in-progress ones are
 *  already in "In progress now" — else the newest non-cancelled order; and
 *  where its report stands. */
export function lastVisit(orders: ProfileOrder[] | null | undefined): LastVisit | null {
  const live = [...(orders ?? [])].filter(x => orderStage(x) >= 0).sort((a, b) => time(b.createdAt) - time(a.createdAt));
  const o = live.find(x => orderStage(x) >= 4) ?? live[0];
  if (!o) return null;
  const stage = orderStage(o);
  const rs = (o.report?.status || '').toLowerCase();
  let report: LastVisit['report'] = 'none';
  if (o.report) report = rs === 'partial' || rs === 'preliminary' || stage < 4 ? 'partial' : 'ready';
  else if (stage < 4) report = 'pending';
  const reportLabel = { ready: 'Report ready', partial: 'Partial report', pending: 'Report pending', none: 'No report' }[report];
  return { order: o, title: orderTitle(o), date: o.createdAt, doctor: o.refDoctorName?.trim() || 'Self referral', report, reportLabel };
}

// ── Timeline ─────────────────────────────────────────────────────────────

export type TimelineKind = 'order' | 'report' | 'appointment' | 'home';
export interface TimelineEvent {
  id: string; kind: TimelineKind; date: string; title: string; meta: string[];
  status: string; tone: 'green' | 'amber' | 'red' | 'blue' | 'neutral';
  orderId?: string; appointment?: PatientAppointment; order?: ProfileOrder;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** The patient's REAL history as one feed, newest first: each order (with
 *  its bill folded into the meta), each report, each appointment / home
 *  visit. Nothing is generated: no data, no events. */
export function buildTimeline(orders: ProfileOrder[] | null | undefined, appointments: PatientAppointment[] | null | undefined): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const o of orders ?? []) {
    const stage = orderStage(o);
    const meta: string[] = [];
    if (o.orderNumber) meta.push(o.orderNumber);
    meta.push(o.refDoctorName?.trim() || 'Self referral');
    const b = o.bill;
    const total = b?.totalPayable ?? o.totalAmount;
    const bal = b?.balance ?? 0;
    if (total != null) meta.push(bal > 0 ? (bal >= total ? `${inr(bal)} due` : `${inr(total)}, ${inr(bal)} due`) : (b?.status === 'paid' || o.billStatus === 'paid') ? `${inr(total)} paid` : inr(total));
    out.push({
      id: `o:${o.id}`, kind: 'order', date: o.createdAt, title: orderTitle(o), meta,
      status: stage < 0 ? (o.status === 'rejected' ? 'Rejected' : 'Cancelled') : stageLabel(stage),
      tone: stage < 0 ? 'red' : stage >= 4 ? 'green' : stage === 1 ? 'blue' : 'amber',
      orderId: o.id, order: o,
    });
    if (o.report) {
      const validated = orderTests(o).map(t => time(t.validatedAt)).filter(Boolean);
      const at = validated.length ? new Date(Math.max(...validated)).toISOString() : o.createdAt;
      const partial = stage < 4;
      const delivered = (o.report.deliveryStatus || '').toLowerCase() === 'delivered';
      out.push({
        id: `r:${o.report.id}`, kind: 'report', date: at, title: `${partial ? 'Partial report' : 'Report'} · ${orderTitle(o)}`,
        meta: [o.orderNumber || '', delivered ? 'Delivered' : 'Not delivered yet'].filter(Boolean),
        status: partial ? 'Partial' : 'Ready', tone: partial ? 'amber' : 'green', orderId: o.id, order: o,
      });
    }
  }
  for (const a of appointments ?? []) {
    const home = (a.collectionType || '').toLowerCase() === 'home' || /home/i.test(a.type || '');
    const st = (a.status || 'booked').toLowerCase();
    const tone: TimelineEvent['tone'] = st === 'cancelled' || st === 'no_show' ? 'red'
      : st === 'completed' || st === 'checked_in' || st === 'collected' ? 'green' : 'blue';
    out.push({
      id: `a:${a.id}`, kind: home ? 'home' : 'appointment', date: a.appointmentDate,
      title: home ? 'Home collection' : 'Appointment',
      meta: [a.slotTime || '', a.refDoctorName || ''].filter(Boolean),
      status: st.charAt(0).toUpperCase() + st.slice(1).replace(/_/g, ' '), tone, appointment: a,
    });
  }
  // Newest first; a report never sorts below its own order (same instant
  // when the tests carry no validation time).
  const rank = (e: TimelineEvent) => (e.kind === 'report' ? 1 : 0);
  return out.sort((a, b) => time(b.date) - time(a.date) || rank(b) - rank(a));
}

// ── Quick actions ────────────────────────────────────────────────────────

export type QuickKey = 'new' | 'repeat' | 'labels' | 'report';
export interface QuickAction { key: QuickKey; label: string; orderId?: string; }

/** Tech quick actions, only those the user may take (route-access + the
 *  APIs' permissions) and only when there is something to act on. `new` is
 *  THE band primary; the rest sit on the side card. */
export function quickActions(orders: ProfileOrder[] | null | undefined, ctx: RouteAccessCtx): QuickAction[] {
  const has = (p: string[]) => !!ctx.isSuper || ctx.hasAny(p);
  const sorted = [...(orders ?? [])].sort((a, b) => time(b.createdAt) - time(a.createdAt));
  const last = sorted.find(o => orderStage(o) >= 0);
  const withSamples = sorted.find(o => orderStage(o) >= 0 && (o.samples ?? []).length > 0);
  const withReport = sorted.find(o => !!o.report);
  const out: QuickAction[] = [];
  const canOrder = canOpenRoute('/frontdesk/order', ctx);
  if (canOrder) out.push({ key: 'new', label: 'New order' });
  if (canOrder && last) out.push({ key: 'repeat', label: 'Repeat last order', orderId: last.id });
  // GET /api/orders/{id} (view_order) + a label-printing role.
  if (withSamples && has(['view_order']) && has(['print_barcode', 'collect_sample', 'create_order', 'register_patient'])) {
    out.push({ key: 'labels', label: 'Reprint labels', orderId: withSamples.id });
  }
  // GET /api/reports/by-order/{id}.
  if (withReport && has(['view_report', 'deliver_report', 'view_order', 'create_bill'])) {
    out.push({ key: 'report', label: 'View last report', orderId: withReport.id });
  }
  return out;
}

/** Can this user read cumulative results (the endpoint's permissions)? */
export const RESULTS_PERMS = ['view_report', 'validate_result', 'view_order'];
