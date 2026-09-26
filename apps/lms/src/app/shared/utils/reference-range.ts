/**
 * Reference-range segment selection — the client mirror of the backend
 * `ResultFlaggingService.SelectRange`. Picks which reference band applies to
 * a patient by sex + age, preferring structured `sex`/`minAge`/`maxAge`
 * fields and falling back to parsing the free-text `segment` label.
 *
 * Used by the result-entry screen for an instant flag preview. The backend
 * remains the source of truth for the persisted/reported flag — keep the two
 * algorithms in step.
 */

export type RangeSex = 'M' | 'F' | 'any' | null;

export interface RangeLike {
  segment?: string;
  min?: number | null;
  max?: number | null;
  /**
   * LEGACY bound comparators (read, never written by new saves). The simple
   * model (owner, 2026-09-26): `min` = L, `max` = H, a value ON a limit is
   * not flagged — so an absent op is inclusive on both sides, one-sided too.
   * Only an explicit legacy strict op ('gt' / 'lt') still flags the limit
   * itself, until the data is migrated. Mirrors mw `RangeDef.MinOp/MaxOp`.
   */
  minOp?: 'gt' | 'gte' | null;
  maxOp?: 'lt' | 'lte' | null;
  sex?: RangeSex;
  minAge?: number | null;
  maxAge?: number | null;
  ageUnit?: 'years' | 'months' | 'days' | null;
  /** Admin's override for the auto-derived friendly name (legacy). */
  label?: string | null;
  /** What the report prints as the reference range, EXACTLY as typed —
   *  line breaks included ("Normal: 70–99\nPrediabetes: 100–125"). Blank =
   *  the simple fallback "L–H unit". Mirrors mw `RangeDef.ReportText`. */
  reportText?: string | null;
}

/**
 * A typed report text as stored: "\r\n" / "\r" → "\n", each line's trailing
 * spaces and any leading / trailing blank lines dropped (inner blank lines
 * stay). Null when nothing is left. Mirrors mw `ReferenceRangeResolver.
 * NormalizeReportText` — the editor saves through it and every reader
 * prints through it, so a pasted Windows text never shows a stray "\r".
 */
export function normalizeReportText(text: string | null | undefined): string | null {
  const s = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map(l => l.trimEnd()).join('\n').trim();
  return s || null;
}

/** `{u}` in a report text = the parameter's CURRENT unit (case-insensitive). */
export const UNIT_TOKEN = /\{u\}/gi;

/** Does this report text use the `{u}` unit placeholder? */
export function hasUnitToken(text: string | null | undefined): boolean {
  return /\{u\}/i.test(text ?? '');
}

/**
 * A report text as it PRINTS: every `{u}` / `{U}` → the parameter's unit, so
 * changing the Unit never leaves a stale unit in the text. No unit → the
 * token goes and so does the space it leaves ("70–99 {u}" → "70–99", "a {u}
 * b" → "a b"). Line breaks are kept. Mirrors mw `ReferenceRangeResolver.
 * FillUnit` — THE one substitution; every reader prints through it.
 */
export function fillUnit(text: string | null | undefined, unit: string | null | undefined): string {
  const s = String(text ?? '');
  if (!hasUnitToken(s)) return s;
  const u = (unit ?? '').trim();
  if (u) return s.replace(UNIT_TOKEN, () => u);
  return s.replace(/([ \t]*)\{u\}([ \t]*)/gi, (_m, a: string, b: string) => (a && b ? ' ' : ''));
}

/** A multi-line text on ONE line ("a; b; c") for places that cannot show a
 *  line break (a one-line summary, a flat export column). */
export function oneLine(text: string | null | undefined, sep = '; '): string {
  return (normalizeReportText(text) ?? '').split('\n').map(l => l.trim()).filter(Boolean).join(sep);
}

/** Normalize a free-text sex to 'M' | 'F' | 'O' or null. */
export function normalizeSex(sex?: string | null): 'M' | 'F' | 'O' | null {
  if (!sex) return null;
  const s = sex.trim().toLowerCase();
  if (s.startsWith('m')) return 'M';
  if (s.startsWith('f')) return 'F';
  if (s.startsWith('o') || s.startsWith('t') || s.startsWith('i')) return 'O';
  return null;
}

/**
 * Choose the best-fitting reference range for a patient. Ranges that
 * contradict the patient's sex/age are excluded; among the rest the most
 * specific (most constraints actively matched) wins, then first-declared.
 * Falls back to the first range so a patient is never left with no range.
 */
export function selectReferenceRange<T extends RangeLike>(
  ranges: readonly T[] | undefined | null,
  sex: 'M' | 'F' | 'O' | null,
  ageYears: number | null
): T | undefined {
  if (!ranges || ranges.length === 0) return undefined;
  return pickBest(ranges, sex, ageYears).best ?? ranges[0];
}

/**
 * Like {@link selectReferenceRange}, but also reports whether the winner was
 * chosen ON MERIT. A band that merely survived (nothing contradicted it)
 * mustn't be printed as "Adult Male" — that would assert something about a
 * patient whose sex/age we don't know. Mirrors `ReferenceRangeResolver.Select`.
 */
export function matchReferenceRange<T extends RangeLike>(
  ranges: readonly T[] | undefined | null,
  sex: 'M' | 'F' | 'O' | null,
  ageYears: number | null
): { range: T | undefined; isSpecific: boolean } {
  if (!ranges || ranges.length === 0) return { range: undefined, isSpecific: false };
  const { best, score } = pickBest(ranges, sex, ageYears);
  if (!best) return { range: ranges[0], isSpecific: false };
  return { range: best, isSpecific: score > 0 };
}

/**
 * The winner among eligible bands: highest score, then first declared — with
 * one tie-break for touching ages ("1–6 years" then "6–10 years"): a patient
 * exactly on the shared birthday belongs to the group that STARTS there, so
 * a group whose age-to equals the patient's age loses a tie. Eligibility
 * itself stays inclusive on age-to (older catalogues rely on it).
 * Mirrors mw `ReferenceRangeResolver.Select`.
 */
function pickBest<T extends RangeLike>(
  ranges: readonly T[], sex: 'M' | 'F' | 'O' | null, ageYears: number | null,
): { best: T | undefined; score: number } {
  let best: T | undefined;
  let bestScore = -Infinity;
  let bestEdge = false;
  for (const r of ranges) {
    const { eligible, score } = scoreRange(r, sex, ageYears);
    if (!eligible) continue;
    const edge = ageYears != null && atAgeTo(r, ageYears);
    if (score > bestScore || (score === bestScore && bestEdge && !edge)) {
      bestScore = score; best = r; bestEdge = edge;
    }
  }
  return { best, score: bestScore };
}

function atAgeTo(r: RangeLike, ageYears: number): boolean {
  const a = resolveRangeAgeYears(r);
  return a.hasAge && a.maxY != null && Math.abs(a.maxY - ageYears) < 1e-9;
}

/**
 * The friendly name shown beside a band — "Adult Male", "Child", "Female".
 * Derived from the band's own constraints so the catalogue reads consistently;
 * an explicit `label` overrides it for anything the rule can't name. Returns
 * null for an unconstrained band, which needs no qualifier.
 * Mirrors `ReferenceRangeResolver.DeriveLabel`.
 */
export function deriveRangeLabel(r: RangeLike): string | null {
  const raw = r.label?.trim();
  const structured = r.min != null || r.max != null;
  if (raw) {
    // Unstructured band: the label IS the range statement — verbatim.
    if (!structured) return raw;
    // A VALUE token is numeric with no letters ("100–125", "<140", "≥6.5",
    // "5.7–6.4%") — an ordinal like "2nd" stays a word. A label without
    // value tokens is a clean name — keep it verbatim.
    const tokens = raw.split(/\s+/).filter(Boolean);
    const hasValueToken = tokens.some(t => /\d/.test(t) && !/[a-zA-Z]/.test(t));
    if (!hasValueToken) return raw;
    // Value tokens inside a structured band's label = the document clause
    // the numbers were parsed FROM ("Prediabetes: 100–125") — printing it
    // next to formatRange duplicated the range. Salvage a crisp 1–2 word
    // tier name; otherwise fall through to segment/sex/age.
    const words = tokens
      .filter(w => /[a-zA-Z]/.test(w))
      .map(w => w.replace(/^[:;,()]+|[:;,()]+$/g, ''))
      .filter(w => w.length > 0);
    if (words.length >= 1 && words.length <= 2) {
      // Sentence-case the salvage — clauses arrive lowercased ("optimal",
      // "near optimal") and a report header shouldn't.
      const salvaged = words.join(' ');
      return salvaged[0].toUpperCase() + salvaged.slice(1);
    }
  }

  const rSex = (r.sex && r.sex !== 'any') ? r.sex : parseSegmentSex(r.segment);
  const sexWord = rSex === 'M' ? 'Male' : rSex === 'F' ? 'Female' : null;
  const ageWord = ageWordFor(r);

  if (ageWord && sexWord) return `${ageWord} ${sexWord}`;
  if (ageWord) return ageWord;
  if (sexWord) return sexWord;

  const seg = (r.segment ?? '').trim();
  if (seg && seg.toLowerCase() !== 'normal' && seg.toLowerCase() !== 'default') return prettify(seg);
  return null;
}

function ageWordFor(r: RangeLike): string | null {
  const { minY, maxY, hasAge } = resolveRangeAgeYears(r);
  if (!hasAge) return null;

  if (minY != null && minY >= 18 && maxY == null) return 'Adult';
  if (minY == null || minY <= 0) {
    if (maxY != null && maxY <= 0.09) return 'Newborn';   // ≈ 28 days
    if (maxY != null && maxY <= 1) return 'Infant';
    if (maxY != null && maxY <= 12) return 'Child';
    if (maxY != null && maxY <= 18) return 'Paediatric';
  }
  if (minY != null && minY >= 60 && maxY == null) return 'Geriatric';

  if (minY != null && maxY != null) return `${ageNum(minY)}–${ageNum(maxY)} y`;
  if (minY != null) return `> ${ageNum(minY)} y`;
  if (maxY != null) return `< ${ageNum(maxY)} y`;
  return null;
}

const ageNum = (y: number): string =>
  y >= 1 || y === 0 ? num(Math.round(y * 10) / 10) : `${num(Math.round(y * 120) / 10)} mo`;

const num = (n: number): string => Number.isInteger(n) ? String(n) : String(+n.toFixed(4));

const prettify = (s: string): string =>
  s.replace(/[_-]+/g, ' ').split(' ').filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

/**
 * Band values as display text: "13–17", "≤ 200", "≥ 40". A value on a limit
 * is normal, so a one-sided band prints ≤ / ≥; only an explicit LEGACY strict
 * op ('lt' / 'gt') prints < / >. Mirrors `Format` (mw).
 */
export function formatRange(r: RangeLike | undefined | null): string | null {
  if (!r) return null;
  if (r.min != null && r.max != null) return `${num(r.min)}–${num(r.max)}`;
  if (r.max != null) return `${r.maxOp === 'lt' ? '<' : '≤'} ${num(r.max)}`;
  if (r.min != null) return `${r.minOp === 'gt' ? '>' : '≥'} ${num(r.min)}`;
  return null;
}

/** A group saved before the simple model (it carries a free-text segment or
 *  a printed-name label) — printed the legacy way until it is migrated. */
export function isLegacyGroup(r: RangeLike): boolean {
  return !!r.label?.trim() || !!r.segment?.trim();
}

/**
 * What the report prints for ONE group: its `reportText` exactly as typed
 * (line breaks kept, `{u}` → the unit);
 * else the simple fallback "13–17 g/dL" (numbers + unit, no who); a legacy
 * group keeps its legacy line ("Adult Male: 13–17 g/dL"). Null when there is
 * nothing to print. Mirrors mw `ReferenceRangeResolver.BandText`.
 */
export function bandReportText(r: RangeLike | null | undefined, unit?: string | null): string | null {
  if (!r) return null;
  const typed = normalizeReportText(fillUnit(r.reportText, unit));
  if (typed) return typed;
  const text = formatRange(r);
  const u = (unit ?? '').trim();
  const withUnit = text ? (u ? `${text} ${u}` : text) : null;
  if (!isLegacyGroup(r)) return withUnit;
  const label = deriveRangeLabel(r);
  if (!withUnit) return r.label?.trim() && label ? label : null;
  return label ? `${label}: ${withUnit}` : withUnit;
}

/** The friendly "who" of a group from its sex / age only ("Adult Male",
 *  "Female"), ignoring any legacy label or segment; null = everyone. */
export function groupWho(r: RangeLike): string | null {
  return deriveRangeLabel({ sex: r.sex, minAge: r.minAge, maxAge: r.maxAge, ageUnit: r.ageUnit });
}

/**
 * The report's reference text for a patient: the matched group alone when it
 * matched on merit; otherwise every group, one per line — a simple-model
 * group prefixed with its who ("Female: 12 – 16 g/dL"), a legacy group as
 * its legacy line. Mirrors mw `ReferenceRangeResolver.ReportRangeText`.
 */
export function reportRangeText(
  ranges: readonly RangeLike[] | null | undefined,
  match: { range: RangeLike | undefined; isSpecific: boolean },
  unit?: string | null,
): string | null {
  if (match.isSpecific && match.range) return bandReportText(match.range, unit);
  const lines: string[] = [];
  for (const r of ranges ?? []) {
    const line = bandReportText(r, unit);
    if (!line) continue;
    const who = r.reportText?.trim() || !isLegacyGroup(r) ? groupWho(r) : null;
    lines.push(who ? `${who}: ${line}` : line);
  }
  return lines.length ? lines.join('\n') : null;
}

/**
 * Flag a numeric value against ONE group — the client mirror of the flagging
 * rule inside mw `ResultFlaggingService.FlagOne`, shared by result entry and
 * validate-result so there is exactly one implementation.
 *
 * The simple model (owner, 2026-09-26): value < L → 'L'; value > H → 'H'; ON
 * a limit = normal; a blank limit = no flag on that side. Only an explicit
 * LEGACY strict op ('gt' / 'lt', un-migrated data) also flags the limit
 * itself. Returns null when the group has no L and no H.
 */
export function flagAgainst(
  r: RangeLike | undefined | null,
  value: number
): 'L' | 'H' | 'N' | null {
  if (!r || (r.min == null && r.max == null)) return null;
  if (r.min != null && (r.minOp === 'gt' ? value <= r.min : value < r.min)) return 'L';
  if (r.max != null && (r.maxOp === 'lt' ? value >= r.max : value > r.max)) return 'H';
  return 'N';
}

/**
 * Every band as "Label 13–17". Used for the report's no-specific-match case
 * and for the Test Master grid, where all bands must read on ONE row rather
 * than splitting a test across several. Mirrors `DescribeAll`.
 */
export function describeAllRanges(ranges: readonly RangeLike[] | undefined | null): string[] {
  if (!ranges) return [];
  const out: string[] = [];
  for (const r of ranges) {
    const text = formatRange(r);
    const label = deriveRangeLabel(r);
    if (!text) {
      // A band with no printable values keeps its line only when it carries
      // an AUTHORED label (method notes) — a derived qualifier alone
      // ("Female") would be noise.
      if (r.label?.trim() && label) out.push(label);
      continue;
    }
    out.push(label ? `${label}: ${text}` : text);
  }
  return out;
}

/**
 * Every group on ONE line — the Test Master grid, the editor's value summary
 * and the bench's no-patient hint: "Female: 12 – 16 g/dL · Male: 13 – 17
 * g/dL"; an all-legacy list keeps "Label: 13–17 · … unit".
 *
 * `keepLines`: a typed report text keeps its OWN line breaks (the groups
 * still join with " · ") — for a cell that shows lines (the bench's Range
 * column, the Test Master grid fallback).
 */
export function summarizeRanges(
  ranges: readonly RangeLike[] | null | undefined,
  unit?: string | null,
  opts?: { keepLines?: boolean },
): string {
  const list = ranges ?? [];
  const u = (unit ?? '').trim();
  if (list.some(r => r.reportText?.trim() || !isLegacyGroup(r))) {
    if (!opts?.keepLines)
      return (reportRangeText(list, { range: undefined, isSpecific: false }, u) ?? '').split('\n').join(' · ');
    const groups: string[] = [];
    for (const r of list) {
      const line = bandReportText(r, u);
      if (!line) continue;
      const who = r.reportText?.trim() || !isLegacyGroup(r) ? groupWho(r) : null;
      groups.push(who ? `${who}: ${line}` : line);
    }
    return groups.join(' · ');
  }
  const lines = describeAllRanges(list);
  return lines.length ? lines.join(' · ') + (u ? ` ${u}` : '') : '';
}

function scoreRange(r: RangeLike, sex: 'M' | 'F' | 'O' | null, ageYears: number | null): { eligible: boolean; score: number } {
  let score = 0;

  // Sex constraint (structured, else parse the segment label).
  const rSex = (r.sex && r.sex !== 'any') ? r.sex : parseSegmentSex(r.segment);
  if (rSex) {
    if (sex && rSex !== sex) return { eligible: false, score: 0 };
    if (sex && rSex === sex) score += 2;
  }

  // Age constraint (structured, else parse — only when no structured sex).
  const age = resolveRangeAgeYears(r);
  if (age.hasAge) {
    if (ageYears != null) {
      if (age.minY != null && ageYears < age.minY) return { eligible: false, score: 0 };
      if (age.maxY != null && ageYears > age.maxY) return { eligible: false, score: 0 };
      score += 1;
    }
  }

  return { eligible: true, score };
}

/** A band's age bounds in YEARS (structured fields first, else parsed from
 *  the segment) — the exact bounds {@link selectReferenceRange} tests. */
export function resolveRangeAgeYears(r: RangeLike): { minY: number | null; maxY: number | null; hasAge: boolean } {
  if (r.minAge != null || r.maxAge != null) {
    return {
      minY: r.minAge != null ? toYears(r.minAge, r.ageUnit) : null,
      maxY: r.maxAge != null ? toYears(r.maxAge, r.ageUnit) : null,
      hasAge: true
    };
  }
  if (!r.sex || r.sex === 'any') return parseSegmentAge(r.segment);
  return { minY: null, maxY: null, hasAge: false };
}

function toYears(n: number, unit?: string | null): number {
  const u = (unit ?? 'years').toLowerCase();
  if (u.startsWith('d')) return n / 365.25;
  if (u.startsWith('w')) return (n * 7) / 365.25;
  if (u.startsWith('mo') || u === 'm' || u === 'mon') return n / 12;
  return n;
}

export function parseSegmentSex(segment?: string | null): 'M' | 'F' | null {
  if (!segment) return null;
  // Whole words only, and separators normalised to spaces first. Substring
  // matching read "post_menopausal" as MALE (it contains "men"), which both
  // excluded that band from every female patient and named it "Male" on the
  // report. Underscores must become spaces before the word boundaries are
  // applied, or "adult_male" stops matching — `_` is itself a word character.
  const s = segment.toLowerCase().replace(/[_-]+/g, ' ');
  if (/\b(female|females|woman|women|f)\b/.test(s)) return 'F';
  if (/\b(male|males|man|men|m)\b/.test(s)) return 'M';
  return null;
}

const AGE_RANGE_RX = /(\d+(?:\.\d+)?)\s*(y|yr|yrs|year|years|m|mo|mon|month|months|d|day|days|w|wk|week|weeks)?\s*[-–to]+\s*(\d+(?:\.\d+)?)\s*(y|yr|yrs|year|years|m|mo|mon|month|months|d|day|days|w|wk|week|weeks)?/i;
const AGE_BOUND_RX = /([<>]=?)\s*(\d+(?:\.\d+)?)\s*(y|yr|yrs|year|years|m|mo|mon|month|months|d|day|days|w|wk|week|weeks)?/i;

export function parseSegmentAge(segment?: string | null): { minY: number | null; maxY: number | null; hasAge: boolean } {
  if (!segment) return { minY: null, maxY: null, hasAge: false };
  const s = segment.toLowerCase();

  const m = AGE_RANGE_RX.exec(s);
  if (m) {
    const lo = toYears(parseFloat(m[1]), m[2] ?? m[4] ?? 'years');
    const hi = toYears(parseFloat(m[3]), m[4] ?? 'years');
    return { minY: lo, maxY: hi, hasAge: true };
  }
  const b = AGE_BOUND_RX.exec(s);
  if (b) {
    const n = toYears(parseFloat(b[2]), b[3] ?? 'years');
    return b[1].startsWith('>') ? { minY: n, maxY: null, hasAge: true } : { minY: null, maxY: n, hasAge: true };
  }
  if (s.includes('newborn') || s.includes('neonate')) return { minY: 0, maxY: 28 / 365.25, hasAge: true };
  if (s.includes('infant')) return { minY: 0, maxY: 1, hasAge: true };
  if (s.includes('child') || s.includes('paediatric') || s.includes('pediatric') || s.includes('peds'))
    return { minY: 0, maxY: 12, hasAge: true };
  if (s.includes('adult')) return { minY: 18, maxY: null, hasAge: true };

  return { minY: null, maxY: null, hasAge: false };
}
