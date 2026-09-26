/**
 * Reference ranges — the simple model (owner, 2026-09-26): each group of
 * patients (Who + Age) has L, H, CL, CH and a Report text.
 *
 *   · value < L → L; value > H → H; value < CL or > CH → critical (C).
 *     ON a limit = not flagged; a blank limit = no flag on that side.
 *     A group's own CL / CH beat the (legacy) parameter-level pair.
 *   · The STORED flag is one code: C (either critical), H, L, N.
 *
 * Nothing here decides a flag of its own: every verdict comes from `flagBand`
 * (the client mirror of mw `ResultFlaggingService.FlagOne`) and every group
 * choice from the ONE resolver (`matchReferenceRange`). The validation below
 * is the SAME hard rule set mw refuses (ReferenceRangeValidator) — every
 * issue blocks Save, including ones the test already had when it was opened.
 *
 * Shared byte-identical by prefrontal-ui and prefrontal-admin-ui.
 */
import {
  matchReferenceRange, parseSegmentSex, resolveRangeAgeYears, type RangeLike,
} from './reference-range';
import { bandsForProfile, flagBand, liveFlag } from './result-flag';

/** The five result levels, most severe low → most severe high. */
export type FlagLevel = 'critical_low' | 'low' | 'normal' | 'high' | 'critical_high';

export const FLAG_LEVELS: readonly FlagLevel[] = ['critical_low', 'low', 'normal', 'high', 'critical_high'];

export const LEVEL_LABEL: Record<FlagLevel, string> = {
  critical_low: 'Critical low',
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  critical_high: 'Critical high',
};

/** The code mw stores for each level (result snapshot `flagged[p].flag`). */
export const LEVEL_CODE: Record<FlagLevel, 'C' | 'L' | 'N' | 'H'> = {
  critical_low: 'C', low: 'L', normal: 'N', high: 'H', critical_high: 'C',
};

/** A band as the editor holds it (ReferenceRange + band criticals). */
export interface InsightBand extends RangeLike {
  criticalLow?: number | null;
  criticalHigh?: number | null;
  unit?: string | null;
  profileCode?: string | null;
}

/** The parts of a numeric parameter these helpers read. */
export interface InsightParam {
  name?: string | null;
  label?: string | null;
  unit?: string | null;
  referenceRanges?: InsightBand[] | null;
  criticalLow?: number | null;
  criticalHigh?: number | null;
  validLow?: number | null;
  validHigh?: number | null;
}

/** Level of one value against ONE band — production's rule, verbatim. */
export function bandLevel(
  band: InsightBand | null | undefined,
  value: number,
  param?: Pick<InsightParam, 'criticalLow' | 'criticalHigh'> | null,
): FlagLevel | null {
  const hit = flagBand(band, value, param ?? null);
  if (!hit) return null;
  if (hit.code === 'C') return hit.critical === 'low' ? 'critical_low' : 'critical_high';
  return hit.code === 'L' ? 'low' : hit.code === 'H' ? 'high' : 'normal';
}

/** The effective critical pair for a band (band first, then the parameter). */
export function effectiveCriticals(band: InsightBand | null | undefined, param?: InsightParam | null) {
  return {
    low: band?.criticalLow ?? param?.criticalLow ?? null,
    high: band?.criticalHigh ?? param?.criticalHigh ?? null,
  };
}

// ── Line atoms (flag-condition checks walk them) ─────────────────────

export const fmtNum = (n: number): string =>
  Number.isInteger(n) ? String(n) : String(+n.toFixed(6));

/** Representative values of every atom of the line cut at `pts`: each point
 *  itself and one value strictly inside every gap (incl. both open ends). */
export function atomsOf(pts: readonly number[]): Array<{ v: number; lo: number | null; hi: number | null; point: boolean }> {
  if (pts.length === 0) return [{ v: 0, lo: null, hi: null, point: false }];
  const span = Math.max(1, Math.abs(pts[0]), Math.abs(pts[pts.length - 1]), pts[pts.length - 1] - pts[0]);
  const out: Array<{ v: number; lo: number | null; hi: number | null; point: boolean }> = [];
  out.push({ v: pts[0] - span, lo: null, hi: pts[0], point: false });
  pts.forEach((p, k) => {
    out.push({ v: p, lo: p, hi: p, point: true });
    const next = pts[k + 1];
    out.push(next == null
      ? { v: p + span, lo: p, hi: null, point: false }
      : { v: (p + next) / 2, lo: p, hi: next, point: false });
  });
  return out;
}

// ── Try a value ────────────────────────────────────────────────────────

export interface TryResult {
  /** Index into the parameter's referenceRanges (null = no band). */
  bandIndex: number | null;
  band: InsightBand | null;
  /** False when no band matched this sex/age on merit (the report then prints
   *  every band and the flag falls back to the first eligible band). */
  onMerit: boolean;
  level: FlagLevel | null;
  /** The mw code a save would store. */
  code: 'C' | 'L' | 'N' | 'H' | '';
}

/**
 * What result entry would do with this value for this patient: the band the
 * ONE resolver picks and the flag `liveFlag` (= mw FlagOne) computes.
 */
export function tryValue(
  param: InsightParam | null | undefined,
  value: number,
  sex: 'M' | 'F' | 'O' | null,
  ageYears: number | null,
  profileCode?: string | null,
): TryResult {
  const bands = param?.referenceRanges ?? [];
  const pool = bandsForProfile(bands, profileCode);
  const m = matchReferenceRange(pool, sex, ageYears);
  const live = param ? liveFlag(param as never, value, sex, ageYears, profileCode) : null;
  const level: FlagLevel | null = !live ? null
    : live.code === 'C' ? (live.critical === 'low' ? 'critical_low' : 'critical_high')
    : live.code === 'L' ? 'low' : live.code === 'H' ? 'high' : 'normal';
  const band = (live?.band ?? m.range ?? null) as InsightBand | null;
  const idx = band ? bands.indexOf(band) : -1;
  return {
    bandIndex: idx >= 0 ? idx : null,
    band,
    onMerit: m.isSpecific,
    level,
    code: level ? LEVEL_CODE[level] : '',
  };
}

// ── Validation (hard rules — every issue blocks Save) ──────────────────

/** Flag-condition checks also warn; range issues are always errors. */
export type IssueSeverity = 'error' | 'warning';
export type RangeField = 'min' | 'max' | 'criticalLow' | 'criticalHigh' | 'age' | 'sex';

export interface RangeIssue {
  severity: 'error';
  /** 0-based group index; null = the parameter as a whole. */
  band: number | null;
  /** The box to outline (the row's message names the rest). */
  field: RangeField | null;
  message: string;
}

/** A group's sex: structured first, else the legacy segment label. */
export function bandSex(b: InsightBand): 'M' | 'F' | null {
  if (b.sex === 'M' || b.sex === 'F') return b.sex;
  if (b.sex === 'any') return null;
  return parseSegmentSex(b.segment);
}

const n = fmtNum;

/** "Female · 18 years+" — who a group covers, in the table's own words. */
export function groupTitle(b: InsightBand): string {
  const sex = bandSex(b);
  const who = sex === 'M' ? 'Male' : sex === 'F' ? 'Female' : 'Anyone';
  return `${who} · ${groupAgeText(b)}`;
}

const unitWord = (u: string, v: number) => (v === 1 ? u.replace(/s$/, '') : u);

/** A group's age in the unit it is stored in ("0–28 days", "18 years+",
 *  "up to 1 year", "Any age"); legacy segment ages read in years. */
export function groupAgeText(b: InsightBand): string {
  let lo: number | null = b.minAge ?? null, hi: number | null = b.maxAge ?? null;
  let unit: string = b.ageUnit ?? 'years';
  if (lo == null && hi == null) {
    const a = resolveRangeAgeYears(b);
    if (!a.hasAge) return 'Any age';
    lo = a.minY != null ? +a.minY.toFixed(2) : null; hi = a.maxY != null ? +a.maxY.toFixed(2) : null; unit = 'years';
  }
  if (lo != null && hi == null) return `${n(lo)} ${unitWord(unit, lo)}+`;
  if (lo == null || lo === 0) return hi == null ? 'Any age' : lo == null ? `up to ${n(hi)} ${unitWord(unit, hi)}` : `0–${n(hi)} ${unitWord(unit, hi)}`;
  return `${n(lo)}–${n(hi!)} ${unitWord(unit, hi!)}`;
}

interface Coverage { sex: 'M' | 'F' | null; lo: number; hi: number; profile: string }
function coverageOf(b: InsightBand): Coverage {
  const a = resolveRangeAgeYears(b);
  return {
    sex: bandSex(b),
    lo: a.hasAge ? a.minY ?? 0 : 0,
    hi: a.hasAge ? a.maxY ?? Infinity : Infinity,
    profile: (b.profileCode ?? '').trim().toUpperCase(),
  };
}

/** Two groups cover a common patient: sexes overlap (Anyone overlaps Male
 *  and Female), ages overlap as [from, to) — "1–6" and "6–10" touch but do
 *  not overlap — and they belong to the same profile. Mirrors mw. */
export function groupsOverlap(a: InsightBand, b: InsightBand): boolean {
  const x = coverageOf(a), y = coverageOf(b);
  if (x.profile !== y.profile) return false;
  if (x.sex != null && y.sex != null && x.sex !== y.sex) return false;
  return x.lo < y.hi && y.lo < x.hi;
}

/**
 * Every problem with a numeric parameter's groups — the hard rules the editor
 * blocks Save on and mw refuses (ReferenceRangeValidator):
 *   age from < to · L ≤ H · CL ≤ L · CH ≥ H · CL < CH · no two groups cover
 *   the same patients.
 * CL / CH are the group's own, else the (legacy) parameter-level pair.
 */
export function validateRanges(param: InsightParam | null | undefined): RangeIssue[] {
  const out: RangeIssue[] = [];
  if (!param) return out;
  const bands = param.referenceRanges ?? [];
  const err = (band: number | null, field: RangeField | null, message: string) =>
    out.push({ severity: 'error', band, field, message });

  if (!bands.length && param.criticalLow != null && param.criticalHigh != null && param.criticalLow >= param.criticalHigh)
    err(null, 'criticalLow', `CL (${n(param.criticalLow)}) must be below CH (${n(param.criticalHigh)}).`);

  bands.forEach((b, i) => {
    const { low: cl, high: ch } = effectiveCriticals(b, param);
    const L = b.min ?? null, H = b.max ?? null;
    if (b.minAge != null && b.maxAge != null && b.minAge >= b.maxAge)
      err(i, 'age', 'Age from must be less than age to.');
    if (L != null && H != null && L > H)
      err(i, 'max', `L (${n(L)}) must not be above H (${n(H)}).`);
    if (cl != null && L != null && cl > L)
      err(i, 'criticalLow', `CL (${n(cl)}) must not be above L (${n(L)}).`);
    if (ch != null && H != null && ch < H)
      err(i, 'criticalHigh', `CH (${n(ch)}) must not be below H (${n(H)}).`);
    if (cl != null && ch != null && cl >= ch)
      err(i, 'criticalLow', `CL (${n(cl)}) must be below CH (${n(ch)}).`);
    for (let j = 0; j < i; j++) {
      if (!groupsOverlap(bands[j], b)) continue;
      err(i, 'sex', `Overlaps group ${j + 1} (${groupTitle(bands[j])}) — two groups cannot cover the same patients.`);
      break;
    }
  });
  return out;
}

export const hasRangeErrors = (issues: readonly RangeIssue[]): boolean => issues.length > 0;
