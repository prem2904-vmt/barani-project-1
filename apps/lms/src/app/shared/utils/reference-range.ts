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
   * Bound comparators. The simple model (owner, 2026-09-26): `min` = L,
   * `max` = H, a value ON a limit is Normal — so an ABSENT op is inclusive on
   * both sides, two-sided or one-sided alike (2026-10-02: reverted the
   * strict-by-default read of a one-sided bound). The one exception: a
   * comparator glyph sitting immediately before the bound's OWN number in
   * `reportText`/`label` ("Normal: <140", "≥ 90") is read off and used
   * instead — see {@link effectiveOneSidedOp}. An explicit op always wins
   * over both. Mirrors mw `RangeDef.MinOp/MaxOp`.
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
 * The comparator glyph + number immediately preceding, anywhere in a free
 * text ("Normal: <140", "≥ 90", "≤5" — space optional). Mirrors mw
 * `ReferenceRangeResolver.GlyphNumRx`.
 */
const GLYPH_NUM_RX = /(<=|>=|≤|≥|<|>)\s*([\d.]+)/g;

/**
 * The EFFECTIVE comparator for a one-sided bound — "gt"/"gte" for the Min
 * side, "lt"/"lte" for the Max side. THE one place both {@link formatRange}
 * (the printed glyph) and {@link flagAgainst} (the flag it triggers) resolve
 * it, so they never disagree. Mirrors mw
 * `ReferenceRangeResolver.EffectiveOneSidedOp`.
 *
 * Precedence: an EXPLICIT op on the band always wins. Absent one, a glyph
 * ("<", ">", "≤", "≥", "<=", ">=") found immediately before the bound's OWN
 * number in the band's `reportText` or `label` is read off and used — "<
 * 140" / "Normal: <140" derives strict, "≤ 5" / "≥40" derives inclusive.
 * Absent that too, the bound stays INCLUSIVE (the owner's long-standing
 * default) — one-sidedness alone is never a reason to assume strict.
 */
export function effectiveOneSidedOp(r: RangeLike, isMin: boolean): 'gt' | 'gte' | 'lt' | 'lte' {
  const explicitOp = isMin ? r.minOp : r.maxOp;
  if (explicitOp) return explicitOp;
  const derived = deriveGlyphOp(r, isMin);
  if (derived) return derived;
  return isMin ? 'gte' : 'lte';
}

/** Scan the band's reportText/label for a comparator glyph that sits
 *  immediately before (optional spaces only) the bound's OWN number. Only a
 *  glyph of the correct DIRECTION for this bound counts. Null when none is
 *  found. Mirrors mw `ReferenceRangeResolver.DeriveGlyphOp`. */
function deriveGlyphOp(r: RangeLike, isMin: boolean): 'gt' | 'gte' | 'lt' | 'lte' | null {
  const boundValue = isMin ? r.min : r.max;
  if (boundValue == null) return null;
  const text = [r.reportText, r.label].filter(t => t && t.trim()).join('\n');
  if (!text) return null;
  GLYPH_NUM_RX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GLYPH_NUM_RX.exec(text))) {
    const n = parseFloat(m[2]);
    if (!Number.isFinite(n) || Math.abs(n - boundValue) > 1e-9) continue;
    const g = m[1];
    if (isMin) {
      if (g === '>') return 'gt';
      if (g === '≥' || g === '>=') return 'gte';
    } else {
      if (g === '<') return 'lt';
      if (g === '≤' || g === '<=') return 'lte';
    }
  }
  return null;
}

/**
 * Band values as display text: "13–17", "< 200", "> 40", "≤ 5", "≥ 90".
 * Two-sided display is unchanged by ops; a one-sided bound's glyph follows
 * {@link effectiveOneSidedOp} — explicit op, else a glyph read off the
 * band's own text, else the inclusive default (≤ / ≥). Mirrors `Format` (mw).
 */
export function formatRange(r: RangeLike | undefined | null): string | null {
  if (!r) return null;
  if (r.min != null && r.max != null) return `${num(r.min)}–${num(r.max)}`;
  if (r.max != null) return `${effectiveOneSidedOp(r, false) === 'lt' ? '<' : '≤'} ${num(r.max)}`;
  if (r.min != null) return `${effectiveOneSidedOp(r, true) === 'gt' ? '>' : '≥'} ${num(r.min)}`;
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
 * rule inside mw `ResultFlaggingService.NumericLevel`, shared by result entry
 * and validate-result so there is exactly one implementation.
 *
 * The simple model (owner, 2026-09-26): value < L → 'L'; value > H → 'H'; ON
 * a limit = Normal; a blank limit = no flag on that side — TWO-SIDED bands
 * only ever honour an EXPLICIT op. A ONE-SIDED bound's op is resolved
 * through {@link effectiveOneSidedOp} (explicit, else a glyph read off its
 * own text, else the inclusive default), so the report's printed glyph and
 * this flag never disagree (2026-10-02). Returns null when the group has no
 * L and no H.
 */
export function flagAgainst(
  r: RangeLike | undefined | null,
  value: number
): 'L' | 'H' | 'N' | null {
  if (!r || (r.min == null && r.max == null)) return null;
  const twoSided = r.min != null && r.max != null;
  const minOp = twoSided ? (r.minOp ?? 'gte') : effectiveOneSidedOp(r, true);
  const maxOp = twoSided ? (r.maxOp ?? 'lte') : effectiveOneSidedOp(r, false);
  if (r.min != null && (minOp === 'gt' ? value <= r.min : value < r.min)) return 'L';
  if (r.max != null && (maxOp === 'lt' ? value >= r.max : value > r.max)) return 'H';
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

/**
 * "pregnan(t|cy)" is gestational UNLESS it's actually negated right there in
 * the text ("non-pregnant", "nonpregnant", "not pregnant", "non pregnant") —
 * a Beta-hCG band's own NEGATIVE tier for a non-pregnant patient must never
 * be read as the gestational one. Mirrors mw `ReferenceRangeResolver.GestationalRx`.
 */
const GESTATIONAL_RX = /\bg-?ogtt\b|\bgestational\b|(?<!non-)(?<!non\s)(?<!not\s)\bpregnan(?:t|cy)\b/i;

/** A band's text (reportText + label) names it gestational ("G-OGTT",
 *  "gestational", "pregnant"/"pregnancy", never negated). Mirrors mw
 *  `ReferenceRangeResolver.LooksGestational`. */
function looksGestational(r: RangeLike): boolean {
  const text = [r.label, r.reportText].filter(t => t && t.trim()).join(' ');
  return text.length > 0 && GESTATIONAL_RX.test(text);
}

/**
 * A band's sex for EXCLUSION purposes only: the admin-set signal (structured
 * `sex`, else the segment label) when there is one; otherwise, ONLY for a
 * band that actually carries numeric bounds, a guess from free text naming
 * it gestational — a catalogue authoring gap, not a reason to apply it to a
 * man. This NEVER awards match score (see {@link scoreRange}), only
 * excludes — an unconstrained band and a text-guessed one must never out-
 * rank each other by this alone. Mirrors mw `ReferenceRangeResolver.EffectiveSex`.
 */
function effectiveSex(r: RangeLike, structuredSex: 'M' | 'F' | null): 'M' | 'F' | null {
  if (structuredSex) return structuredSex;
  return (r.min != null || r.max != null) && looksGestational(r) ? 'F' : null;
}

function scoreRange(r: RangeLike, sex: 'M' | 'F' | 'O' | null, ageYears: number | null): { eligible: boolean; score: number } {
  let score = 0;

  // Sex constraint (structured, else parse the segment label).
  const rSex = (r.sex && r.sex !== 'any') ? r.sex : parseSegmentSex(r.segment);
  const effSex = effectiveSex(r, rSex);
  if (effSex) {
    if (sex && effSex !== sex) return { eligible: false, score: 0 }; // contradiction (structured OR text-guessed)
  }
  if (rSex && sex && rSex === sex) score += 2; // active match — admin-set only, never the text guess

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
