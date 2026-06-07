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
  sex?: RangeSex;
  minAge?: number | null;
  maxAge?: number | null;
  ageUnit?: 'years' | 'months' | 'days' | null;
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
  const s = segment.toLowerCase();
  if (s.includes('female') || s.includes('woman') || s.includes('women') || /\bf\b/.test(s)) return 'F';
  if (s.includes('male') || s.includes('man') || s.includes('men') || /\bm\b/.test(s)) return 'M';
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
