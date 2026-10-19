/**
 * The flag a PATIENT REPORT prints — ONE helper for every report path (PDF
 * continuous table, legacy values map, classic table, on-screen report view).
 *
 * Owner rule (2026-09-26): the report never shows "C" or "Critical" —
 * "Critical is for internal lab use." A critical-high value prints as H and a
 * critical-low value as L, with the SAME styling as H / L (letter / arrow /
 * none indicator and the high / low colours). Internal screens (result entry,
 * validate, alerts, worklists) badge the stored CL / CH (legacy: C) — this is
 * applied at the report-rendering layer only; stored flags are never rewritten.
 *
 * Owner 2026-09-27: mw stores the critical WITH its direction — 'CL' / 'CH'
 * (ResultFlaggingService.CodeOf). The report reads that direction directly:
 * CL → L, CH → H, no range guessing. Only a LEGACY direction-less 'C' (rows
 * saved before the change — no migration) falls back to the range:
 *  1. a stored code that already carries it (CH / CL / HH / LL /
 *     critical_high / critical_low) — every new row, else
 *  2. legacy 'C': the numeric value against the row's printed reference bounds
 *     (below the low bound → L, above the high bound → H), else
 *  3. with both bounds known and the value inside them, H only when the
 *     value is above their midpoint;
 *  4. otherwise no letter (the row keeps its abnormal styling). Never 'C'.
 */

export type ReportFlagLetter = 'H' | 'L' | 'A' | '';

export interface ReportFlag {
  /** The letter the report may print ('' = no letter). */
  flag: ReportFlagLetter;
  /** Low direction → low colour / down arrow. */
  isLow: boolean;
  /** The row is abnormal (a critical with no resolvable direction stays abnormal). */
  abnormal: boolean;
}

export interface ReportBounds {
  low?: number | null;
  high?: number | null;
}

const HIGH_CODES = new Set(['CH', 'HH', 'CRITICAL_HIGH', 'CRITICAL HIGH']);
const LOW_CODES = new Set(['CL', 'LL', 'CRITICAL_LOW', 'CRITICAL LOW']);
const CRIT_CODES = new Set(['C', 'CRITICAL', 'CRIT']);

/** A leading number of a result text ("600", "< 0.5", "≈7.2", "1,200") or null. */
export function reportNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value ?? '').trim().replace(/,(?=\d{3}\b)/g, '');
  const m = /^[<>≤≥≈~=]*\s*(-?\d+(?:\.\d+)?|-?\.\d+)/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

const NUM = '(-?\\d+(?:\\.\\d+)?)';

/**
 * The normal bounds printed in a reference-range text — the FIRST band that
 * reads as a range: "70 - 100", "70–99 mg/dL", "Normal: 70 to 99", "< 200",
 * "≤ 5", "Up to 40", "> 40", "≥ 126". Null when nothing numeric is found.
 */
export function reportRangeBounds(text: string | null | undefined): ReportBounds | null {
  const s = String(text ?? '');
  if (!s.trim()) return null;
  for (const line of s.split(/\r?\n|;|·/)) {
    const pair = new RegExp(`${NUM}\\s*(?:-|–|—|to)\\s*${NUM}`, 'i').exec(line);
    if (pair) {
      const a = Number(pair[1]), b = Number(pair[2]);
      if (Number.isFinite(a) && Number.isFinite(b) && a <= b) return { low: a, high: b };
    }
    const upper = new RegExp(`(?:<=?|≤|up\\s*to|upto|below|less than)\\s*${NUM}`, 'i').exec(line);
    if (upper) return { high: Number(upper[1]) };
    const lower = new RegExp(`(?:>=?|≥|above|more than|greater than)\\s*${NUM}`, 'i').exec(line);
    if (lower) return { low: Number(lower[1]) };
  }
  return null;
}

/** Direction of a critical value against its normal bounds, or '' when unknown. */
function criticalDirection(value: unknown, bounds: ReportBounds | null): 'H' | 'L' | '' {
  const v = reportNumber(value);
  if (v == null || !bounds) return '';
  const lo = bounds.low ?? null, hi = bounds.high ?? null;
  if (lo != null && v < lo) return 'L';
  if (hi != null && v > hi) return 'H';
  if (lo != null && hi != null && v > (lo + hi) / 2) return 'H';
  return '';
}

/**
 * The report flag for one printed value. `bounds` is the row's reference
 * range — either the printed range text or explicit numbers.
 */
export function reportFlag(
  flag: string | null | undefined,
  value: unknown,
  bounds: ReportBounds | string | null | undefined,
): ReportFlag {
  const f = String(flag ?? '').trim().toUpperCase();
  if (f === 'H') return { flag: 'H', isLow: false, abnormal: true };
  if (f === 'L') return { flag: 'L', isLow: true, abnormal: true };
  if (f === 'A') return { flag: 'A', isLow: false, abnormal: true };
  if (HIGH_CODES.has(f)) return { flag: 'H', isLow: false, abnormal: true };
  if (LOW_CODES.has(f)) return { flag: 'L', isLow: true, abnormal: true };
  if (CRIT_CODES.has(f)) {
    const b = typeof bounds === 'string' || bounds == null ? reportRangeBounds(bounds) : bounds;
    const dir = criticalDirection(value, b);
    return { flag: dir, isLow: dir === 'L', abnormal: true };
  }
  return { flag: '', isLow: false, abnormal: false };
}

/** The classic table's word for a report flag: High / Low / Abnormal / ''. */
export function reportFlagWord(flag: ReportFlagLetter): string {
  return flag === 'H' ? 'High' : flag === 'L' ? 'Low' : flag === 'A' ? 'Abnormal' : '';
}
