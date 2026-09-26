/**
 * Reference ranges, EXPLAINED — what the Test Master's range bar, the "try a
 * value" tester and the range validation read. Nothing here decides a flag of
 * its own: every verdict comes from `flagBand` (the body of `liveFlag`, the
 * client mirror of mw `ResultFlaggingService.FlagOne`) and every band choice
 * from the ONE resolver (`selectReferenceRange` / `matchReferenceRange`).
 *
 * Production semantics this file makes visible (mw FlagOne, 2026-09-26):
 *   · Critical limits are STRICT: below Critical low / above Critical high.
 *     They are checked FIRST and win over the normal range. A band's own
 *     criticals beat the parameter-level pair.
 *   · Two-sided normal range with no ops = inclusive both ends (min ≤ v ≤ max).
 *     One-sided with no op = strict ("< 200": 200 is High); ≤ / ≥ include it.
 *   · The STORED flag is one code: C (either critical), H, L, N. A critical-high
 *     value is stored as C, never H — so "High" in the stored codes EXCLUDES
 *     critical. The level vocabulary below keeps the direction.
 *
 * Shared byte-identical by prefrontal-ui and prefrontal-admin-ui.
 */
import {
  formatRange, matchReferenceRange, parseSegmentSex, resolveRangeAgeYears, type RangeLike,
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

// ── Zones: the number line of one band, as production cuts it ─────────

export interface RangeZone {
  level: FlagLevel | null;
  /** null = open to −∞ / +∞. */
  lo: number | null;
  loIncl: boolean;
  hi: number | null;
  hiIncl: boolean;
  /** "3.5 to under 4" — the values, in words. */
  words: string;
  /** "3.5 to under 4 → Low". */
  caption: string;
}

export interface RangeTick {
  value: number;
  /** "≥ 4" / "> 11": where the zone on the RIGHT starts (≥ = the value is in it). */
  text: string;
  /** "4 counts as Normal". */
  title: string;
}

export const fmtNum = (n: number): string =>
  Number.isInteger(n) ? String(n) : String(+n.toFixed(6));

function zoneWords(z: Pick<RangeZone, 'lo' | 'loIncl' | 'hi' | 'hiIncl'>): string {
  const { lo, hi } = z;
  if (lo == null && hi == null) return 'Any value';
  if (lo == null) return z.hiIncl ? `At or below ${fmtNum(hi!)}` : `Below ${fmtNum(hi!)}`;
  if (hi == null) return z.loIncl ? `At or above ${fmtNum(lo)}` : `Above ${fmtNum(lo)}`;
  if (lo === hi) return `Exactly ${fmtNum(lo)}`;
  if (z.loIncl && z.hiIncl) return `${fmtNum(lo)} to ${fmtNum(hi)}`;
  if (z.loIncl) return `${fmtNum(lo)} to under ${fmtNum(hi)}`;
  if (z.hiIncl) return `Over ${fmtNum(lo)}, up to ${fmtNum(hi)}`;
  return `Over ${fmtNum(lo)}, under ${fmtNum(hi)}`;
}

/** The boundary values production can switch level at, sorted, unique. */
function cutPoints(band: InsightBand, param?: InsightParam | null, extra: readonly number[] = []): number[] {
  const crit = effectiveCriticals(band, param);
  const pts = [crit.low, band.min, band.max, crit.high, ...extra]
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  return [...new Set(pts)].sort((a, b) => a - b);
}

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

/**
 * One band's zones, left to right, exactly as production flags them: the line
 * is cut at every limit, each piece classified by {@link bandLevel}, and
 * neighbours with the same level merged. A limit belongs to whichever zone
 * production puts it in — that is what makes ≤ / < right.
 */
export function bandZones(band: InsightBand | null | undefined, param?: InsightParam | null): RangeZone[] {
  if (!band) return [];
  const pts = cutPoints(band, param);
  if (pts.length === 0) return [];
  const zones: Array<Omit<RangeZone, 'words' | 'caption'>> = [];
  for (const a of atomsOf(pts)) {
    const level = bandLevel(band, a.v, param);
    const last = zones[zones.length - 1];
    if (last && last.level === level) {
      last.hi = a.point ? a.v : a.hi;
      last.hiIncl = a.point;
      continue;
    }
    zones.push({ level, lo: a.point ? a.v : a.lo, loIncl: a.point, hi: a.point ? a.v : a.hi, hiIncl: a.point });
  }
  // Points that are ends of open gaps belong to the neighbour — fix the
  // inclusivity flags of every zone edge from its neighbour's.
  for (let k = 0; k + 1 < zones.length; k++) {
    const l = zones[k], r = zones[k + 1];
    if (l.hi == null || r.lo == null) continue;
    if (l.hiIncl) r.loIncl = false; else r.loIncl = true;
  }
  return zones.map(z => {
    const words = zoneWords(z);
    return { ...z, words, caption: `${words} → ${z.level ? LEVEL_LABEL[z.level] : 'Not flagged'}` };
  });
}

/** The labelled boundaries between zones (one per edge). */
export function zoneTicks(zones: readonly RangeZone[]): RangeTick[] {
  const out: RangeTick[] = [];
  for (let k = 0; k + 1 < zones.length; k++) {
    const r = zones[k + 1];
    if (r.lo == null) continue;
    const owner = r.loIncl ? r : zones[k];
    out.push({
      value: r.lo,
      text: `${r.loIncl ? '≥' : '>'} ${fmtNum(r.lo)}`,
      title: `${fmtNum(r.lo)} counts as ${owner.level ? LEVEL_LABEL[owner.level] : 'not flagged'}`,
    });
  }
  return out;
}

/** Relative widths for drawing: open ends and single points get a fixed
 *  share, finite zones scale with their span (never vanishing). */
export function zoneWeights(zones: readonly RangeZone[]): number[] {
  const spans = zones.map(z => (z.lo != null && z.hi != null ? z.hi - z.lo : null));
  const maxSpan = Math.max(0, ...spans.filter((s): s is number => s != null));
  return zones.map((z, k) => {
    const s = spans[k];
    if (s == null) return 1.2;
    if (s === 0) return 0.45;
    return 1 + 2 * (maxSpan > 0 ? s / maxSpan : 0);
  });
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

// ── Validation ─────────────────────────────────────────────────────────

export type IssueSeverity = 'error' | 'warning';
export type RangeField =
  'min' | 'max' | 'criticalLow' | 'criticalHigh' | 'minAge' | 'maxAge' | 'sex' | 'unit' | 'validLow' | 'validHigh';

export interface RangeIssue {
  severity: IssueSeverity;
  /** 0-based band index; null = the parameter as a whole. */
  band: number | null;
  field: RangeField | null;
  message: string;
}

/** The band's patients in plain words: "Men 18–60 years", "Everyone". */
export function bandWho(b: InsightBand): string {
  const sex = bandSex(b);
  const who = sex === 'M' ? 'Men' : sex === 'F' ? 'Women' : 'Everyone';
  const a = resolveRangeAgeYears(b);
  if (!a.hasAge) return who;
  return `${who} ${ageSpanWords(a.minY, a.maxY)}`;
}

function bandSex(b: InsightBand): 'M' | 'F' | null {
  if (b.sex === 'M' || b.sex === 'F') return b.sex;
  if (b.sex === 'any') return null;
  return parseSegmentSex(b.segment);
}

function ageWord(y: number): string {
  if (y >= 1 || y === 0) {
    const v = Math.round(y * 10) / 10;
    return `${fmtNum(v)} ${v === 1 ? 'year' : 'years'}`;
  }
  const mo = Math.round(y * 120) / 10;
  if (mo >= 1) return `${fmtNum(mo)} ${mo === 1 ? 'month' : 'months'}`;
  const d = Math.round(y * 365.25);
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

function ageSpanWords(lo: number | null, hi: number | null): string {
  if (lo == null || lo <= 0) return hi == null ? 'of any age' : `aged up to ${ageWord(hi)}`;
  if (hi == null) return `aged ${ageWord(lo)} and over`;
  if (lo >= 1 && hi >= 1) return `aged ${fmtNum(Math.round(lo * 10) / 10)}–${ageWord(hi)}`;
  return `aged ${ageWord(lo)} to ${ageWord(hi)}`;
}

const n = fmtNum;

/**
 * Every problem with a numeric parameter's ranges. ERRORS are unsafe (the
 * editor blocks Save; mw rejects the same set — ReferenceRangeValidator);
 * WARNINGS are odd but allowed.
 */
export function validateRanges(param: InsightParam | null | undefined): RangeIssue[] {
  const out: RangeIssue[] = [];
  if (!param) return out;
  const bands = param.referenceRanges ?? [];
  const err = (band: number | null, field: RangeField | null, message: string) =>
    out.push({ severity: 'error', band, field, message });
  const warn = (band: number | null, field: RangeField | null, message: string) =>
    out.push({ severity: 'warning', band, field, message });

  if (param.criticalLow != null && param.criticalHigh != null && param.criticalLow >= param.criticalHigh)
    err(null, 'criticalLow', `Critical low (${n(param.criticalLow)}) must be below Critical high (${n(param.criticalHigh)}).`);

  bands.forEach((b, i) => {
    const { low: cl, high: ch } = effectiveCriticals(b, param);
    const min = b.min ?? null, max = b.max ?? null;
    let broken = false;
    if (min != null && max != null && min > max) {
      err(i, 'max', `Normal to (${n(max)}) is below Normal from (${n(min)}).`); broken = true;
    }
    if (cl != null && ch != null && cl >= ch) {
      err(i, 'criticalLow', `Critical low (${n(cl)}) must be below Critical high (${n(ch)}).`); broken = true;
    }
    if (cl != null && min != null && cl > min) {
      err(i, 'criticalLow', `Critical low (${n(cl)}) is inside the normal range — it must be at or below Normal from (${n(min)}).`); broken = true;
    }
    if (cl != null && min == null && max != null && cl >= max) {
      err(i, 'criticalLow', `Critical low (${n(cl)}) is at or above the normal limit (${n(max)}) — nothing could be normal.`); broken = true;
    }
    if (ch != null && max != null && ch < max) {
      err(i, 'criticalHigh', `Critical high (${n(ch)}) is inside the normal range — it must be at or above Normal to (${n(max)}).`); broken = true;
    }
    if (ch != null && max == null && min != null && ch <= min) {
      err(i, 'criticalHigh', `Critical high (${n(ch)}) is at or below the normal limit (${n(min)}) — nothing could be normal.`); broken = true;
    }
    if (b.minAge != null && b.maxAge != null && b.minAge > b.maxAge) {
      err(i, 'maxAge', `Age from (${n(b.minAge)}) is above Age to (${n(b.maxAge)}).`); broken = true;
    }
    if (broken) return;

    if (min == null && max == null) {
      if (cl != null || ch != null) warn(i, 'min', 'No normal range — only the critical limits flag a result.');
      else if (!b.label?.trim()) warn(i, 'min', 'Empty range — nothing is flagged for these patients.');
      return;
    }
    if (min != null && max != null && min === max)
      warn(i, 'max', `Normal is a single value (${n(min)}) — anything else is flagged.`);

    const levels = new Set(bandZones(b, param).map(z => z.level));
    if (cl != null && min != null && !levels.has('low'))
      warn(i, 'criticalLow', `Low can never be flagged — Critical low (${n(cl)}) meets Normal from (${n(min)}); every low result is critical.`);
    if (ch != null && max != null && !levels.has('high'))
      warn(i, 'criticalHigh', `High can never be flagged — Critical high (${n(ch)}) meets Normal to (${n(max)}); every high result is critical.`);

    const bu = (b.unit ?? '').trim();
    const pu = (param.unit ?? '').trim();
    if (bu && pu && bu.toLowerCase() !== pu.toLowerCase())
      warn(i, 'unit', `This range is in ${bu} but the test reports ${pu}.`);

    if (param.validLow != null && min != null && param.validLow > min)
      warn(i, 'min', `Plausible low (${n(param.validLow)}) is above Normal from (${n(min)}) — normal results would be refused at entry.`);
    if (param.validHigh != null && max != null && param.validHigh < max)
      warn(i, 'max', `Plausible high (${n(param.validHigh)}) is below Normal to (${n(max)}) — normal results would be refused at entry.`);
  });

  const numeric = bands.some(b => b.min != null || b.max != null);
  const unit = (param.unit ?? '').trim();
  if (numeric && !unit) warn(null, 'unit', 'No unit set — the report prints bare numbers.');
  if (unit && /\d\s*[–—-]\s*\d/.test(unit))
    warn(null, 'unit', `The unit “${unit}” looks like a range — check it.`);

  overlapIssues(bands).forEach(x => out.push(x));
  coverageIssues(bands).forEach(x => out.push(x));
  return out;
}

interface Coverage { sex: 'M' | 'F' | null; hasAge: boolean; lo: number; hi: number; profile: string }
function coverageOf(b: InsightBand): Coverage {
  const a = resolveRangeAgeYears(b);
  return {
    sex: bandSex(b),
    hasAge: a.hasAge,
    lo: a.minY ?? 0,
    hi: a.maxY ?? Infinity,
    profile: (b.profileCode ?? '').trim().toUpperCase(),
  };
}

/** Bands the resolver can't tell apart for some patient (same sex rule,
 *  same kind of age rule, overlapping ages): the FIRST one always wins. */
function overlapIssues(bands: readonly InsightBand[]): RangeIssue[] {
  const out: RangeIssue[] = [];
  const cov = bands.map(coverageOf);
  const warned = new Set<number>();
  for (let j = 1; j < bands.length; j++) {
    for (let i = 0; i < j; i++) {
      const a = cov[i], b = cov[j];
      if (warned.has(j) || a.profile !== b.profile || a.sex !== b.sex || a.hasAge !== b.hasAge) continue;
      // Touching ends ("0–18" then "18+") share one instant — the usual
      // catalogue convention, not a real overlap.
      if (a.hasAge && (b.lo >= a.hi || a.lo >= b.hi)) continue;
      const same = formatRange(bands[i]) === formatRange(bands[j])
        && (bands[i].criticalLow ?? null) === (bands[j].criticalLow ?? null)
        && (bands[i].criticalHigh ?? null) === (bands[j].criticalHigh ?? null);
      const covered = !a.hasAge || (a.lo <= b.lo && a.hi >= b.hi);
      const who = bandWho(bands[j]);
      let message: string;
      if (!a.hasAge && a.sex == null && bands[j].label?.trim())
        message = `Range ${i + 1} decides the flag for everyone — range ${j + 1} (“${bands[j].label!.trim()}”) only prints in the list of ranges.`;
      else if (covered)
        message = same
          ? `Duplicate of range ${i + 1} — it is never used.`
          : `Never used — range ${i + 1} covers the same patients (${who}) and comes first.`;
      else {
        const lo = Math.max(a.lo, b.lo), hi = Math.min(a.hi, b.hi);
        const sexW = b.sex === 'M' ? 'men' : b.sex === 'F' ? 'women' : 'patients';
        message = `Overlaps range ${i + 1} for ${sexW} ${ageSpanWords(lo, Number.isFinite(hi) ? hi : null)} — range ${i + 1} is used for them (it comes first).`;
      }
      out.push({ severity: 'warning', band: j, field: a.hasAge ? 'minAge' : 'sex', message });
      warned.add(j);
    }
  }
  return out;
}

/** Ages (per sex) with no band of their own — those patients fall back to
 *  the first band. Only judged when some band is sex- or age-specific. */
function coverageIssues(bands: readonly InsightBand[]): RangeIssue[] {
  const all = bands.map(coverageOf).filter(c => c.profile === '');
  if (all.length === 0 || !all.some(c => c.sex != null || c.hasAge)) return [];
  const gapsFor = (sex: 'M' | 'F'): Array<[number, number]> => {
    const mine = all.filter(c => c.sex == null || c.sex === sex);
    if (mine.some(c => !c.hasAge)) return [];
    const iv = mine.map(c => [c.lo, c.hi] as [number, number]).sort((x, y) => x[0] - y[0]);
    const gaps: Array<[number, number]> = [];
    let reach = 0;
    let first = true;
    for (const [lo, hi] of iv) {
      if (first ? lo > 0 : lo > reach) gaps.push([reach, lo]);
      reach = first ? hi : Math.max(reach, hi);
      first = false;
    }
    if (first) return [[0, Infinity]];
    if (reach < Infinity) gaps.push([reach, Infinity]);
    return gaps;
  };
  const key = (g: [number, number]) => `${g[0]}|${g[1]}`;
  const m = gapsFor('M'), f = gapsFor('F');
  const fk = new Set(f.map(key)), mk = new Set(m.map(key));
  const out: RangeIssue[] = [];
  const say = (who: string, g: [number, number]) => {
    const span = g[0] <= 0 && g[1] === Infinity ? '' : ` ${ageSpanWords(g[0], Number.isFinite(g[1]) ? g[1] : null)}`;
    out.push({
      severity: 'warning', band: null, field: 'minAge',
      message: `No range for ${who}${span} — they are judged against range 1.`,
    });
  };
  for (const g of m) say(fk.has(key(g)) ? 'anyone' : 'men', g);
  for (const g of f) if (!mk.has(key(g))) say('women', g);
  return out;
}

export const hasRangeErrors = (issues: readonly RangeIssue[]): boolean => issues.some(i => i.severity === 'error');
