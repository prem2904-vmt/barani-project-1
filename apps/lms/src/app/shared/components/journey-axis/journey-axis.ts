/**
 * The patient journey's proportional time axis — PURE model (no DOM). Lifted
 * verbatim out of pf-patient-timeline (axisModel + buildTicks) so the
 * frontdesk timeline and the OPD journey dock place their dates the SAME way.
 *
 *  - x is a percent of the axis (6 % padding either side of the date range;
 *    a single date gets ±1 day so it sits in the middle).
 *  - Dates closer than `8 / zoom` % stack onto the next lane; the lane is
 *    capped at `maxLanes - 1` (the host decides how many fit).
 *  - Ticks: days (≤ 75 days), months (≤ ~2.2 years), else years.
 */

export type JourneyEventType = 'lab' | 'opd' | 'ipd' | 'pharmacy' | 'doc' | 'today';

/** One date on the axis. `key` is the day key the host selects by. */
export interface JourneyAxisEvent {
  key: string;
  /** ISO date or date-time — placement only. */
  date: string;
  type: JourneyEventType;
  /** Pill text (default: the date as "MMM d"). */
  label?: string;
  /** A red dot on the pill (e.g. a result outside the normal range that day). */
  alert?: boolean;
  /** Tooltip / accessible name. */
  title?: string;
}

export interface PlacedJourneyEvent extends JourneyAxisEvent { x: number; lane: number; }
export interface JourneyAxisTick { key: string; x: number; label: string; }
export interface JourneyAxisModel { events: PlacedJourneyEvent[]; ticks: JourneyAxisTick[]; lanes: number; }

const DAY = 86400000;

const fmtDay = (t: number) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const fmtMonth = (t: number) => new Date(t).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

/** Tick marks between lo and hi (ms), placed with xOf. Pure. */
export function journeyAxisTicks(lo: number, hi: number, xOf: (t: number) => number): JourneyAxisTick[] {
  const days = (hi - lo) / DAY;
  const ticks: JourneyAxisTick[] = [];
  const push = (t: number, label: string) => { if (t >= lo && t <= hi) ticks.push({ key: String(t), x: xOf(t), label }); };
  if (days <= 75) {
    const step = Math.max(1, Math.round(days / 8));
    const start = new Date(lo); start.setHours(0, 0, 0, 0);
    for (let t = start.getTime(); t <= hi; t += step * DAY) push(t, fmtDay(t));
  } else if (days <= 365 * 2.2) {
    let d = new Date(lo); d = new Date(d.getFullYear(), d.getMonth(), 1);
    while (d.getTime() <= hi) { push(d.getTime(), fmtMonth(d.getTime())); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
  } else {
    const endY = new Date(hi).getFullYear();
    for (let y = new Date(lo).getFullYear(); y <= endY; y++) push(new Date(y, 0, 1).getTime(), String(y));
  }
  return ticks;
}

/** Place the events on the axis (oldest → newest), lanes + ticks. Pure. */
export function journeyAxisModel(list: readonly JourneyAxisEvent[], zoom = 1, maxLanes = 4): JourneyAxisModel {
  const vs = [...list].sort((a, b) => a.date.localeCompare(b.date));
  if (!vs.length) return { events: [], ticks: [], lanes: 0 };
  const times = vs.map(v => new Date(v.date).getTime());
  let min = Math.min(...times), max = Math.max(...times);
  if (min === max) { min -= DAY; max += DAY; }
  const pad = (max - min) * 0.06 || DAY;
  const lo = min - pad, hi = max + pad, span = hi - lo;
  const xOf = (t: number) => ((t - lo) / span) * 100;
  const laneLastX: number[] = [];
  // Lane spacing tightens as you zoom in (the axis widens), so clustered
  // dates spread onto FEWER lanes.
  const MIN_SEP = 8 / Math.max(1, zoom);
  const cap = Math.max(1, maxLanes);
  const events: PlacedJourneyEvent[] = vs.map(v => {
    const x = xOf(new Date(v.date).getTime());
    let lane = laneLastX.findIndex(lx => x - lx >= MIN_SEP);
    if (lane === -1) lane = laneLastX.length;
    laneLastX[lane] = x;
    return { ...v, x, lane: Math.min(lane, cap - 1) };
  });
  return { events, ticks: journeyAxisTicks(lo, hi, xOf), lanes: Math.min(laneLastX.length, cap) };
}

/** Clamp a zoom factor to the axis's range (1 … 8). Pure. */
export function clampZoom(z: number): number { return Math.min(8, Math.max(1, z)); }
