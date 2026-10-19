import { deriveRangeLabel, describeAllRanges, matchReferenceRange, formatRange, RangeLike } from './reference-range';

/**
 * Naming and selection of conditional reference bands.
 *
 * Two rules matter clinically and are easy to get subtly wrong:
 *
 * 1. A band is only NAMED when it was chosen on merit. If the patient's sex
 *    and age are unknown, some band still wins the fallback — printing
 *    "Adult Male" beside it would assert something the data doesn't support,
 *    so `isSpecific` is false and the report shows every band instead.
 * 2. The label is DERIVED, so 279 tests can't drift into "Adult Male",
 *    "adult male" and "M-Adult"; an explicit label overrides it for the cases
 *    the rule can't name.
 *
 * These expectations are duplicated in the backend's
 * ReferenceRangeLabelTests — the two implementations must agree, because one
 * decides the flag and the other decides what prints.
 */
const M_ADULT: RangeLike = { sex: 'M', minAge: 18, ageUnit: 'years', min: 13, max: 17 };
const F_ADULT: RangeLike = { sex: 'F', minAge: 18, ageUnit: 'years', min: 12, max: 15 };
const CHILD: RangeLike = { minAge: 0, maxAge: 12, ageUnit: 'years', min: 11, max: 14 };
const ANY: RangeLike = { segment: 'normal', min: 70, max: 100 };

describe('deriveRangeLabel', () => {
  it('composes sex and age into a clinical phrase', () => {
    expect(deriveRangeLabel(M_ADULT)).toBe('Adult Male');
    expect(deriveRangeLabel(F_ADULT)).toBe('Adult Female');
  });

  it('names an age-only band without inventing a sex', () => {
    expect(deriveRangeLabel(CHILD)).toBe('Child');
  });

  it('names a sex-only band without inventing an age', () => {
    expect(deriveRangeLabel({ sex: 'F', min: 12, max: 15 })).toBe('Female');
  });

  it('gives an unconstrained band no qualifier at all', () => {
    // The ordinary single-range test: "70–100" needs no explanation, and a
    // stray label under it would imply a condition that isn't there.
    expect(deriveRangeLabel(ANY)).toBeNull();
  });

  it('lets an explicit label win over the derived one', () => {
    expect(deriveRangeLabel({ ...F_ADULT, label: 'Pregnancy — 2nd trimester' }))
      .toBe('Pregnancy — 2nd trimester');
  });

  it('falls back to a descriptive segment when there are no structured fields', () => {
    expect(deriveRangeLabel({ segment: 'post_menopausal', min: 1, max: 2 }))
      .toBe('Post Menopausal');
  });
});

describe('matchReferenceRange', () => {
  const BANDS = [M_ADULT, F_ADULT, CHILD];

  it('picks the band matching the patient and calls it specific', () => {
    const m = matchReferenceRange(BANDS, 'F', 34);
    expect(m.range).toBe(F_ADULT);
    expect(m.isSpecific).toBe(true);
  });

  it('excludes a band that contradicts the patient rather than scoring it', () => {
    // A 34-year-old male must never land on the child band even though its
    // values would also "fit" numerically.
    expect(matchReferenceRange(BANDS, 'M', 34).range).toBe(M_ADULT);
  });

  it('is NOT specific when the patient has no recorded sex or age', () => {
    // The regression this guards: a fallback band printed as though it had
    // been chosen for this patient.
    const m = matchReferenceRange(BANDS, null, null);
    expect(m.isSpecific).toBe(false);
  });

  it('is not specific when the only band constrains nothing', () => {
    expect(matchReferenceRange([ANY], 'M', 34).isSpecific).toBe(false);
  });
});

describe('describeAllRanges', () => {
  it('labels every band for the show-them-all case', () => {
    expect(describeAllRanges([M_ADULT, F_ADULT, CHILD]))
      .toEqual(['Adult Male: 13–17', 'Adult Female: 12–15', 'Child: 11–14']);
  });

  it('skips bands that carry no printable values', () => {
    expect(describeAllRanges([M_ADULT, { sex: 'F' }])).toEqual(['Adult Male: 13–17']);
  });
});

describe('formatRange', () => {
  it('renders one-sided bounds, which lipids and enzymes rely on', () => {
    // A value on the limit is normal (simple model) → ≤ / ≥; only an
    // explicit legacy strict op prints < / >.
    expect(formatRange({ max: 200 })).toBe('≤ 200');
    expect(formatRange({ min: 40 })).toBe('≥ 40');
    expect(formatRange({ max: 200, maxOp: 'lt' })).toBe('< 200');
    expect(formatRange({ min: 40, minOp: 'gt' })).toBe('> 40');
    expect(formatRange({ min: 13, max: 17 })).toBe('13–17');
  });

  it('renders inclusive one-sided bounds with their own glyphs', () => {
    // Op absent = inclusive glyphs (above); an explicit strict op
    // prints </> so "the limit itself flags" is visible.
    expect(formatRange({ max: 140, maxOp: 'lt' })).toBe('< 140');
    expect(formatRange({ min: 40, minOp: 'gt' })).toBe('> 40');
    // Two-sided display is unchanged by ops.
    expect(formatRange({ min: 13, max: 17, minOp: 'gte', maxOp: 'lte' })).toBe('13–17');
  });

  // Logic review (2026-10-02): op-absent is INCLUSIVE by default (above) —
  // UNLESS the band's own reportText/label carries a comparator glyph right
  // before its own number, which is read off and used instead so the
  // printed glyph always matches what flagAgainst actually flags.
  it('derives a strict glyph from the band\'s own text when no op is set', () => {
    expect(formatRange({ max: 140, reportText: 'Normal <140 mg/dL' })).toBe('< 140');
    expect(formatRange({ max: 5, label: 'Nonpregnant — <5 IU/L — Negative' })).toBe('< 5');
  });

  it('derives an inclusive glyph from the band\'s own text when no op is set', () => {
    expect(formatRange({ max: 5, reportText: '≤ 5 {u}' })).toBe('≤ 5');
    expect(formatRange({ min: 90, reportText: '≥ 90 {u}' })).toBe('≥ 90');
    expect(formatRange({ min: 40, reportText: '≥40 {u}' })).toBe('≥ 40');
  });

  it('an explicit op always wins over a glyph found in the text', () => {
    expect(formatRange({ max: 140, maxOp: 'lte', reportText: 'Normal: <140 {u}' })).toBe('≤ 140');
  });

  it('a glyph near a DIFFERENT number in the text is ignored', () => {
    expect(formatRange({ max: 140, reportText: 'G-OGTT: <180 mg/dL\nSame-tier: 140 mg/dL' })).toBe('≤ 140');
  });
});
