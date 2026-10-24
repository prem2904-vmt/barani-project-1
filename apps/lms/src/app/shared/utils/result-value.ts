/**
 * Range / censored result values — "0-4", "4 – 6", "<5", ">100", "<=5".
 *
 * Owner 2026-10-24: some numeric tests (urine microscopy pus cells "0-4 /HPF",
 * "<5", ">100") report a RANGE or a censored number instead of one value.
 * Which tests may do that is decided in the Test Master, per numeric value:
 * the switch "Allow a range or < / >" (`allowRange: true`) and the rule
 * "Flag a range by" (`rangeFlag`: ends | upper | lower | middle).
 *
 * HARD RULE: a parameter WITHOUT the switch behaves exactly as before
 * everywhere — every caller checks {@link rangeAllowed} first and otherwise
 * runs its old code untouched.
 *
 * ONE parser. mw's twin is `Services/ResultValue.cs` (same grammar, same
 * flag rule — `ResultFlaggingService.FlagOne`); the specs on both sides pin
 * the same table of inputs.
 */
import type { RangeFlagRule, TestParameter } from '../models/test.model';
import { bandsForProfile, flagBand, type LiveFlag } from './result-flag';
import { selectReferenceRange } from './reference-range';

export type RangeValueKind = 'range' | 'lt' | 'gt' | 'lte' | 'gte';

/** A parsed range / censored value. For "<n" / ">n" both ends are n. */
export interface RangeValue {
  kind: RangeValueKind;
  low: number;
  high: number;
}

const NUM = '(\\d+(?:\\.\\d+)?|\\.\\d+)';
// a-b: hyphen, en dash, em dash or minus sign between; spaces allowed.
const RANGE_RX = new RegExp(`^\\s*${NUM}\\s*[-\\u2013\\u2014\\u2212]\\s*${NUM}\\s*$`);
const CENSORED_RX = new RegExp(`^\\s*(<=|>=|\\u2264|\\u2265|<|>)\\s*${NUM}\\s*$`);

/**
 * "a-b" (a ≤ b, decimals and spaces ok, en dash ok), "<n", ">n", "<=n",
 * ">=n" (≤ / ≥ too) → the parsed value; anything else — including a plain
 * number — → null.
 */
export function parseRangeValue(raw: unknown): RangeValue | null {
  if (typeof raw !== 'string') return null;
  const r = RANGE_RX.exec(raw);
  if (r) {
    const low = Number(r[1]);
    const high = Number(r[2]);
    if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) return null;
    return { kind: 'range', low, high };
  }
  const c = CENSORED_RX.exec(raw);
  if (c) {
    const n = Number(c[2]);
    if (!Number.isFinite(n)) return null;
    const op = c[1];
    const kind: RangeValueKind = op === '<' ? 'lt' : op === '>' ? 'gt'
      : op === '<=' || op === '≤' ? 'lte' : 'gte';
    return { kind, low: n, high: n };
  }
  return null;
}

type RangeParam = Pick<TestParameter, 'allowRange' | 'rangeFlag'>;

/** True only when the Test Master switched range entry on for this value. */
export function rangeAllowed(p: RangeParam | null | undefined): boolean {
  return p?.allowRange === true;
}

/** The parameter's rule; unknown / missing → 'ends'. */
export function rangeFlagRule(p: RangeParam | null | undefined): RangeFlagRule {
  const r = p?.rangeFlag;
  return r === 'upper' || r === 'lower' || r === 'middle' ? r : 'ends';
}

/** A range / censored value of a range-enabled parameter, else null. A
 *  parameter without the switch ALWAYS gets null (its old path runs). */
export function rangeValueFor(p: RangeParam | null | undefined, raw: unknown): RangeValue | null {
  return rangeAllowed(p) ? parseRangeValue(raw) : null;
}

/**
 * "Is this numeric field's value invalid?" — the check every result-entry
 * screen blocks submit on. Without the switch it is EXACTLY the old check
 * (`Number.isNaN(Number(String(raw).trim()))`); with it, a parseable range
 * is valid too.
 */
export function isInvalidNumericValue(p: RangeParam | null | undefined, raw: unknown): boolean {
  if (raw === undefined || raw === null || raw === '') return false;
  if (rangeValueFor(p, raw)) return false;
  return Number.isNaN(Number(String(raw).trim()));
}

type FlagHit = Omit<LiveFlag, 'band'>;
type Band = Parameters<typeof flagBand>[0];
type Fallback = Parameters<typeof flagBand>[2];

const isHighish = (h: FlagHit | null) => h?.code === 'H' || h?.code === 'CH';
const isLowish = (h: FlagHit | null) => h?.code === 'L' || h?.code === 'CL';

/**
 * Flag a range value against ONE band by the rule — mirrors mw
 * `ResultValue.Level`. "<n" / ">n" are judged as n.
 *  - ends:   High (or CH) if the upper value is above the range, Low (or CL)
 *            if the lower value is below; a critical end wins; else Normal.
 *  - upper / lower: that end alone.  - middle: (low + high) / 2.
 */
export function flagRangeAgainstBand(band: Band, value: RangeValue, rule: RangeFlagRule, fallback?: Fallback): FlagHit | null {
  if (rule === 'upper') return flagBand(band, value.high, fallback);
  if (rule === 'lower') return flagBand(band, value.low, fallback);
  if (rule === 'middle') return flagBand(band, (value.low + value.high) / 2, fallback);
  const up = flagBand(band, value.high, fallback);
  const lo = flagBand(band, value.low, fallback);
  if (!up && !lo) return null;
  if (up?.code === 'CH') return up;
  if (lo?.code === 'CL') return lo;
  if (isHighish(up)) return up;
  if (isLowish(lo)) return lo;
  // Both ends below / above (e.g. "0-1" against 2–10): the end that left.
  if (isLowish(up)) return up;
  if (isHighish(lo)) return lo;
  return up ?? lo;
}

/** The live flag for a range value being typed — {@link liveFlag}'s twin:
 *  the patient's band (profile-scoped), then {@link flagRangeAgainstBand}. */
export function liveRangeFlag(
  p: (Pick<TestParameter, 'referenceRanges' | 'criticalLow' | 'criticalHigh'> & RangeParam) | null | undefined,
  value: RangeValue,
  sex: 'M' | 'F' | 'O' | null,
  ageYears: number | null,
  profileCode?: string | null,
): LiveFlag | null {
  if (!p) return null;
  const band = selectReferenceRange(bandsForProfile(p.referenceRanges, profileCode), sex, ageYears);
  const hit = flagRangeAgainstBand(band, value, rangeFlagRule(p), p);
  return hit ? { ...hit, band } : null;
}

/** Keys a range-enabled numeric field accepts (besides digits / navigation):
 *  `remaining` is the field text OUTSIDE the selection the key replaces. */
export function rangeKeyAllowed(remaining: string, key: string): boolean {
  if (/^[0-9]$/.test(key)) return true;
  const hasCmp = /[<>≤≥]/.test(remaining);
  const dashes = (remaining.match(/[-–—−]/g) ?? []).length;
  switch (key) {
    case '<': case '>': return remaining.trim() === '';
    case '=': return /^\s*[<>]$/.test(remaining);
    case '.': {
      const lastNum = remaining.split(/[-–—−<>=\s]/).pop() ?? '';
      return !lastNum.includes('.');
    }
    case '-': case '–': return !hasCmp && dashes < 2;
    case ' ': return remaining.trim() !== '';
    default: return false;
  }
}

/** A pasted text for a range-enabled field: the trimmed range when it IS one
 *  ("0 - 4", "<5"), else null (the old numeric paste clean-up runs). */
export function rangePasteText(text: string | null | undefined): string | null {
  const t = String(text ?? '').trim();
  return parseRangeValue(t) ? t : null;
}
