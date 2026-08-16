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
   * First-class bound comparators. Backward-compatible defaults when an op is
   * ABSENT: a two-sided band stays INCLUSIVE on both bounds (min ≤ v ≤ max is
   * normal — today's semantics), while a one-sided band renders and flags as
   * STRICT `<`/`>` (today's glyphs). Mirrors mw `RangeDef.MinOp/MaxOp`.
   */
  minOp?: 'gt' | 'gte' | null;
  maxOp?: 'lt' | 'lte' | null;
  sex?: RangeSex;
  minAge?: number | null;
  maxAge?: number | null;
  ageUnit?: 'years' | 'months' | 'days' | null;
  /** Admin's override for the auto-derived friendly name. */
  label?: string | null;
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
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const r of ranges) {
    const { eligible, score } = scoreRange(r, sex, ageYears);
    if (!eligible) continue;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best ?? ranges[0];
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
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const r of ranges) {
    const { eligible, score } = scoreRange(r, sex, ageYears);
    if (!eligible) continue;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  if (!best) return { range: ranges[0], isSpecific: false };
  return { range: best, isSpecific: bestScore > 0 };
}

/**
 * The friendly name shown beside a band — "Adult Male", "Child", "Female".
 * Derived from the band's own constraints so the catalogue reads consistently;
 * an explicit `label` overrides it for anything the rule can't name. Returns
 * null for an unconstrained band, which needs no qualifier.
 * Mirrors `ReferenceRangeResolver.DeriveLabel`.
 */
export function deriveRangeLabel(r: RangeLike): string | null {
  if (r.label && r.label.trim()) return r.label.trim();

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
 * Band values as display text: "13–17", "< 200", "> 40", "≤ 140", "≥ 40".
 * Two-sided display is unchanged by ops; a one-sided bound prints ≤/≥ when its
 * op is inclusive, else the strict default glyph. Mirrors `Format` (mw).
 */
export function formatRange(r: RangeLike | undefined | null): string | null {
  if (!r) return null;
  if (r.min != null && r.max != null) return `${num(r.min)}–${num(r.max)}`;
  if (r.max != null) return `${r.maxOp === 'lte' ? '≤' : '<'} ${num(r.max)}`;
  if (r.min != null) return `${r.minOp === 'gte' ? '≥' : '>'} ${num(r.min)}`;
  return null;
}

/**
 * Flag a numeric value against ONE band — the client mirror of the flagging
 * rule inside mw `ResultFlaggingService.FlagOne`, shared by result entry and
 * validate-result so there is exactly one implementation.
 *
 * Flags when EITHER bound exists (one-sided bands used to render "< 200" but
 * never flag). Op-absent defaults: a two-sided band stays inclusive-normal
 * (min ≤ v ≤ max = 'N'); a one-sided bound is STRICT, so 140 against "< 140"
 * is 'H'. An explicit inclusive op ('lte'/'gte') moves the boundary value back
 * into normal. Returns null when there is no band or no usable bound.
 */
export function flagAgainst(
  r: RangeLike | undefined | null,
  value: number
): 'L' | 'H' | 'N' | null {
  if (!r || (r.min == null && r.max == null)) return null;
  const minInclusive = r.minOp === 'gte' || (r.minOp == null && r.max != null);
  const maxInclusive = r.maxOp === 'lte' || (r.maxOp == null && r.min != null);
  if (r.min != null && (minInclusive ? value < r.min : value <= r.min)) return 'L';
  if (r.max != null && (maxInclusive ? value > r.max : value >= r.max)) return 'H';
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
    if (!text) continue;
    const label = deriveRangeLabel(r);
    out.push(label ? `${label} ${text}` : text);
  }
  return out;
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

function resolveRangeAgeYears(r: RangeLike): { minY: number | null; maxY: number | null; hasAge: boolean } {
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
