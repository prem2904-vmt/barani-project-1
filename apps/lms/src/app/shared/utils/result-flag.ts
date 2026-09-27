/**
 * Result flags — ONE place for how the browser shows a flag.
 *
 * Owner rule (Test Master single source, 2026-09-24): the flag a SAVED result
 * shows is the flag mw computed and stored with it — the result snapshot's
 * `flagged[param]` map ({ value, flag, range, unit, segment, rangeLabel,
 * allRanges }, written by ResultFlaggingService at entry time). No screen
 * recomputes a saved result's flag in the browser any more: every recompute
 * used to pick its own band (`referenceRanges[0]`), its own boundary rule
 * (inclusive vs strict criticals) and ignored band-scoped criticals, so the
 * same value read "normal" on one screen and "critical" on the next.
 *
 * The ONLY browser-side computation left is the live hint while a value is
 * being typed (before it is saved) — {@link liveFlag}, which mirrors mw
 * `FlagOne`: the patient's band via the shared resolver, band criticals →
 * parameter criticals (strict), then the shared `flagAgainst` rule.
 */
import type { TestParameter } from '../models/test.model';
import { describeAllRanges, flagAgainst, selectReferenceRange, type RangeLike } from './reference-range';
import { parseParametersBlob, readParameters } from './test-parameters';

/**
 * mw flag codes: H high, L low, CL critical low, CH critical high, A abnormal
 * (qualitative), N normal, '' not flaggable. 'C' is the LEGACY direction-less
 * critical (results saved before 2026-09-27) — still critical, shown as "C".
 * Lab screens badge CL / CH; the patient report prints H / L only
 * ({@link ../utils/report-flag reportFlag}).
 */
export type FlagCode = 'H' | 'L' | 'CL' | 'CH' | 'C' | 'A' | 'N' | '';
/** The critical codes: CL, CH and legacy C. */
export type CriticalCode = 'CL' | 'CH' | 'C';
/** The three-state tone the review screens colour by. */
export type FlagTone = 'normal' | 'abnormal' | 'critical';

/** One entry of the snapshot's `flagged` map, as mw persists it. */
export interface SavedFlag {
  value?: unknown;
  flag?: string | null;
  range?: string | null;
  unit?: string | null;
  segment?: string | null;
  rangeLabel?: string | null;
  allRanges?: string[] | null;
}

/** The parts of a result snapshot (`OrderTest.currentResult`) flags read. */
export interface ResultSnapshotLike {
  values?: Record<string, unknown>;
  flagged?: Record<string, SavedFlag>;
}

let lastJson: string | null = null;
let lastSnap: ResultSnapshotLike | null = null;

/** Parse a result snapshot JSON (memoised on the last string — screens call
 *  this per row per change-detection pass). Null for empty/malformed input. */
export function parseResultSnapshot(json: string | null | undefined): ResultSnapshotLike | null {
  if (!json) return null;
  if (json === lastJson) return lastSnap;
  let snap: ResultSnapshotLike | null;
  try {
    const v = JSON.parse(json);
    snap = v && typeof v === 'object' ? (v as ResultSnapshotLike) : null;
  } catch { snap = null; }
  lastJson = json;
  lastSnap = snap;
  return snap;
}

/** The saved flag entry for one value (exact name first, then case-insensitive). */
export function savedFlagOf(snap: ResultSnapshotLike | null | undefined, name: string): SavedFlag | undefined {
  const map = snap?.flagged;
  if (!map || typeof map !== 'object' || !name) return undefined;
  if (map[name]) return map[name];
  const k = name.trim().toLowerCase();
  const hit = Object.keys(map).find(x => x.trim().toLowerCase() === k);
  return hit ? map[hit] : undefined;
}

/** Normalise a stored flag string to an mw code. */
export function flagCodeOf(flag: string | null | undefined): FlagCode {
  const f = String(flag ?? '').trim().toUpperCase();
  return (f === 'H' || f === 'L' || f === 'CL' || f === 'CH' || f === 'C' || f === 'A' || f === 'N') ? f : '';
}

/** Is a stored flag critical — CL, CH or legacy C? Every "is it critical?"
 *  check goes through here (never `=== 'C'`). */
export function isCriticalFlag(flag: string | null | undefined): boolean {
  const c = flagCodeOf(flag);
  return c === 'CL' || c === 'CH' || c === 'C';
}

/** The lab badge for a critical flag: "CL" / "CH", legacy "C"; '' when the
 *  flag isn't critical. */
export function criticalBadge(flag: string | null | undefined): CriticalCode | '' {
  const c = flagCodeOf(flag);
  return c === 'CL' || c === 'CH' || c === 'C' ? c : '';
}

/** What a flag code MEANS, in plain words — chip tooltips and legends
 *  (QA 2026-09-24: users could not tell which of H / L was high). */
export function flagMeaning(flag: string | null | undefined): string {
  switch (flagCodeOf(flag)) {
    case 'H': return 'H = High — above the reference range';
    case 'L': return 'L = Low — below the reference range';
    case 'CL': return 'CL = Critical low — below the critical (panic) limit';
    case 'CH': return 'CH = Critical high — above the critical (panic) limit';
    case 'C': return 'C = Critical — past a critical (panic) limit (saved before direction was recorded)';
    case 'A': return 'A = Abnormal — not an expected (normal) answer';
    case 'N': return 'N = Normal — within the reference range';
    default: return '';
  }
}

/** Tooltip for a result-entry flag chip ({ tone, label } as the entry screens
 *  build it): names the direction of a critical and what H / L stand for. */
export function flagChipTitle(chip: { tone: string; label: string } | null | undefined): string {
  if (!chip) return '';
  const label = chip.label.toLowerCase();
  if (chip.tone === 'critical') {
    if (label === 'cl' || label.startsWith('cl ')) return flagMeaning('CL');
    if (label === 'ch' || label.startsWith('ch ')) return flagMeaning('CH');
    if (label.includes('low') || label.includes('below')) return 'Critical low — below the critical (panic) limit';
    if (label.includes('high') || label.includes('above')) return 'Critical high — above the critical (panic) limit';
    return flagMeaning('C');
  }
  if (label === 'abnormal') return flagMeaning('A');
  if (chip.tone === 'high') return flagMeaning('H');
  if (chip.tone === 'low') return flagMeaning('L');
  if (chip.tone === 'normal') return flagMeaning('N');
  return '';
}

/** mw code → review tone: CL / CH / legacy C critical; H/L/A abnormal; N / '' normal. */
export function flagTone(flag: string | null | undefined): FlagTone {
  const c = flagCodeOf(flag);
  if (isCriticalFlag(c)) return 'critical';
  if (c === 'H' || c === 'L' || c === 'A') return 'abnormal';
  return 'normal';
}

/** "12–15" + "g/dL" → "12–15 g/dL" (never doubles a unit already printed). */
export function rangeWithUnit(range: string | null | undefined, unit: string | null | undefined): string | undefined {
  const r = (range ?? '').trim();
  if (!r) return undefined;
  const u = (unit ?? '').trim();
  return u && !r.endsWith(u) ? `${r} ${u}` : r;
}

/** One reviewed value: what was entered + the flag/range mw saved with it. */
export interface SavedValueRow {
  name: string;
  title: string;
  value: unknown;
  unit?: string;
  range?: string;
  flag: FlagTone;
  code: FlagCode;
  /** True when mw stored a verdict for this value (false = legacy snapshot). */
  saved: boolean;
}

/**
 * A saved result's rows, one per parameter of the test (in the test's order),
 * with the flag and printed range mw SAVED. A legacy snapshot (entered before
 * flagging shipped) has no verdict: the value shows unflagged with every band
 * listed — never a browser-picked band.
 */
export function savedValueRows(
  currentResult: string | null | undefined,
  parametersJson: string | null | undefined,
): SavedValueRow[] {
  const snap = parseResultSnapshot(currentResult);
  if (!snap?.values) return [];
  const params = readParameters(parseParametersBlob(parametersJson));
  return params.map(p => {
    const sf = savedFlagOf(snap, p.name);
    const unit = (sf?.unit ?? p.unit) || undefined;
    const range = sf
      ? rangeWithUnit(sf.range, unit)
      : rangeWithUnit(describeAllRanges(p.referenceRanges).join(' · '), unit);
    return {
      name: p.name,
      title: p.title || p.name,
      value: snap.values![p.name],
      unit,
      range,
      flag: flagTone(sf?.flag),
      code: flagCodeOf(sf?.flag),
      saved: !!sf,
    };
  });
}

// ── Live hint while typing (pre-save only) ────────────────────────────

/** Profile-scoped bands (body fluids): under a profile its own bands win,
 *  else the untagged generics; standalone, every band. Mirrors mw. */
export function bandsForProfile<T extends RangeLike & { profileCode?: string | null }>(
  bands: readonly T[] | null | undefined,
  profileCode?: string | null,
): T[] {
  const all = [...(bands ?? [])];
  const pc = (profileCode ?? '').trim().toUpperCase();
  if (!pc) return all;
  const scoped = all.filter(b => (b.profileCode ?? '').trim().toUpperCase() === pc);
  return scoped.length ? scoped : all.filter(b => !b.profileCode);
}

export interface LiveFlag {
  /** Mirrors the code mw will store: CL / CH for a critical. */
  code: 'L' | 'H' | 'N' | 'CL' | 'CH';
  /** Which critical limit tripped (only for CL / CH). */
  critical?: 'low' | 'high';
  /** The limit value that tripped. */
  limit?: number;
  /** The band the value was judged against (patient sex/age). */
  band?: RangeLike & { criticalLow?: number | null; criticalHigh?: number | null };
}

type LiveParam = Pick<TestParameter, 'referenceRanges' | 'criticalLow' | 'criticalHigh'>;

/**
 * The live flag for a numeric value being TYPED — mirrors mw `FlagOne`:
 * band for the patient's sex/age, the band's own criticals win over the
 * parameter pair (strict `<` / `>`), then the shared in-range rule.
 * Null when there is nothing to judge against. Never use it for a SAVED
 * value — read {@link savedFlagOf} instead.
 */
export function liveFlag(
  p: LiveParam | null | undefined,
  value: number,
  sex: 'M' | 'F' | 'O' | null,
  ageYears: number | null,
  profileCode?: string | null,
): LiveFlag | null {
  if (!p || !Number.isFinite(value)) return null;
  const band = selectReferenceRange(bandsForProfile(p.referenceRanges, profileCode), sex, ageYears);
  const hit = flagBand(band, value, p);
  return hit ? { ...hit, band } : null;
}

/**
 * The flag for ONE already-chosen band — the body of {@link liveFlag} (and of
 * mw `FlagOne`) without the band selection: the band's own criticals win over
 * the parameter pair (strict `<` / `>`), then the shared in-range rule. The
 * Test Master's range bar and "try a value" tester call this per band so what
 * the editor SHOWS is literally what result entry computes.
 */
export function flagBand(
  band: (RangeLike & { criticalLow?: number | null; criticalHigh?: number | null }) | null | undefined,
  value: number,
  fallback?: { criticalLow?: number | null; criticalHigh?: number | null } | null,
): Omit<LiveFlag, 'band'> | null {
  if (!Number.isFinite(value)) return null;
  const critLow = band?.criticalLow ?? fallback?.criticalLow;
  const critHigh = band?.criticalHigh ?? fallback?.criticalHigh;
  if (critLow != null && value < critLow) return { code: 'CL', critical: 'low', limit: critLow };
  if (critHigh != null && value > critHigh) return { code: 'CH', critical: 'high', limit: critHigh };
  const fl = flagAgainst(band, value);
  return fl ? { code: fl } : null;
}
