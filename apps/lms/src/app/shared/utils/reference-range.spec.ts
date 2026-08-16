import {
  flagAgainst,
  normalizeSex,
  parseSegmentAge,
  parseSegmentSex,
  selectReferenceRange,
  type RangeLike
} from './reference-range';

// Haemoglobin bands using structured sex fields.
const HB_STRUCTURED: RangeLike[] = [
  { segment: 'Adult Male', min: 13.5, max: 17.5, sex: 'M' },
  { segment: 'Adult Female', min: 12.0, max: 15.5, sex: 'F' }
];

describe('normalizeSex', () => {
  it('maps common spellings to M/F/O', () => {
    expect(normalizeSex('Male')).toBe('M');
    expect(normalizeSex('female')).toBe('F');
    expect(normalizeSex('F')).toBe('F');
    expect(normalizeSex('m')).toBe('M');
    expect(normalizeSex('Other')).toBe('O');
    expect(normalizeSex('transgender')).toBe('O');
  });

  it('returns null for empty / unknown', () => {
    expect(normalizeSex(undefined)).toBeNull();
    expect(normalizeSex('')).toBeNull();
    expect(normalizeSex('  ')).toBeNull();
  });
});

describe('parseSegmentSex', () => {
  it('reads sex from a label, with female taking precedence over the "male" substring', () => {
    expect(parseSegmentSex('Adult Female')).toBe('F');
    expect(parseSegmentSex('adult_male')).toBe('M');
    expect(parseSegmentSex('Women')).toBe('F');
    expect(parseSegmentSex('M')).toBe('M');
    expect(parseSegmentSex('Children')).toBeNull();
  });
});

describe('parseSegmentAge', () => {
  it('parses numeric ranges with units', () => {
    expect(parseSegmentAge('0-12 years')).toEqual({ minY: 0, maxY: 12, hasAge: true });
    const m = parseSegmentAge('1-6 months');
    expect(m.hasAge).toBe(true);
    expect(m.minY).toBeCloseTo(1 / 12, 5);
    expect(m.maxY).toBeCloseTo(6 / 12, 5);
  });

  it('parses open-ended bounds', () => {
    expect(parseSegmentAge('>18')).toEqual({ minY: 18, maxY: null, hasAge: true });
    expect(parseSegmentAge('<1y')).toEqual({ minY: null, maxY: 1, hasAge: true });
  });

  it('recognizes lifecycle words', () => {
    expect(parseSegmentAge('Adult')).toEqual({ minY: 18, maxY: null, hasAge: true });
    expect(parseSegmentAge('Child')).toEqual({ minY: 0, maxY: 12, hasAge: true });
    expect(parseSegmentAge('Newborn').hasAge).toBe(true);
  });

  it('returns hasAge=false when there is no age hint', () => {
    expect(parseSegmentAge('Adult Male')).toEqual({ minY: 18, maxY: null, hasAge: true });
    expect(parseSegmentAge('normal')).toEqual({ minY: null, maxY: null, hasAge: false });
  });
});

describe('selectReferenceRange', () => {
  it('picks the female band for a female patient (not referenceRanges[0])', () => {
    const r = selectReferenceRange(HB_STRUCTURED, 'F', 30);
    expect(r?.segment).toBe('Adult Female');
  });

  it('picks the male band for a male patient', () => {
    const r = selectReferenceRange(HB_STRUCTURED, 'M', 40);
    expect(r?.segment).toBe('Adult Male');
  });

  it('falls back to the free-text segment label when no structured fields', () => {
    const labelOnly: RangeLike[] = [
      { segment: 'Adult Male', min: 13.5, max: 17.5 },
      { segment: 'Adult Female', min: 12.0, max: 15.5 }
    ];
    expect(selectReferenceRange(labelOnly, 'F', 30)?.segment).toBe('Adult Female');
  });

  it('selects the age band for a child vs an adult', () => {
    const creat: RangeLike[] = [
      { segment: 'Child', min: 0.3, max: 0.7, maxAge: 12 },
      { segment: 'Adult', min: 0.7, max: 1.3, minAge: 12 }
    ];
    expect(selectReferenceRange(creat, 'M', 6)?.segment).toBe('Child');
    expect(selectReferenceRange(creat, 'M', 40)?.segment).toBe('Adult');
  });

  it('excludes contradicting bands and falls back to the first when nothing matches', () => {
    const maleOnly: RangeLike[] = [{ segment: 'Adult Male', min: 13.5, max: 17.5, sex: 'M' }];
    // Female patient, only a male band exists — never return "no range".
    expect(selectReferenceRange(maleOnly, 'F', 30)?.segment).toBe('Adult Male');
  });

  it('treats sex=any as applying to everyone', () => {
    const anyBand: RangeLike[] = [{ segment: 'All', min: 12, max: 16, sex: 'any' }];
    expect(selectReferenceRange(anyBand, 'F', 30)?.segment).toBe('All');
    expect(selectReferenceRange(anyBand, 'M', 30)?.segment).toBe('All');
  });

  it('does not exclude on unknown patient sex/age', () => {
    expect(selectReferenceRange(HB_STRUCTURED, null, null)?.segment).toBe('Adult Male'); // first eligible
  });

  it('returns undefined for empty / missing ranges', () => {
    expect(selectReferenceRange([], 'F', 30)).toBeUndefined();
    expect(selectReferenceRange(undefined, 'F', 30)).toBeUndefined();
    expect(selectReferenceRange(null, 'F', 30)).toBeUndefined();
  });

  it('prefers the more specific (sex+age) band over a generic one', () => {
    const bands: RangeLike[] = [
      { segment: 'Adult', min: 12, max: 16 },
      { segment: 'Adult Female', min: 12, max: 15.5, sex: 'F', minAge: 18 }
    ];
    expect(selectReferenceRange(bands, 'F', 30)?.segment).toBe('Adult Female');
  });
});

describe('flagAgainst', () => {
  // The one implementation both result entry and validate-result flag with —
  // mirrored by mw ResultFlaggingService.FlagOne; the boundary cases below are
  // duplicated in ResultFlaggingServiceTests on purpose.

  it('flags one-sided bands at all (the latent "< 200 never flags" bug)', () => {
    expect(flagAgainst({ max: 140 }, 200)).toBe('H');
    expect(flagAgainst({ max: 140 }, 100)).toBe('N');
    expect(flagAgainst({ min: 40 }, 30)).toBe('L');
    expect(flagAgainst({ min: 40 }, 50)).toBe('N');
  });

  it('treats an op-less one-sided bound as STRICT: 140 against "< 140" is High', () => {
    expect(flagAgainst({ max: 140 }, 140)).toBe('H');
    expect(flagAgainst({ min: 40 }, 40)).toBe('L');
  });

  it('treats an explicit inclusive op as ≤/≥: 140 against "≤ 140" is Normal', () => {
    expect(flagAgainst({ max: 140, maxOp: 'lte' }, 140)).toBe('N');
    expect(flagAgainst({ max: 140, maxOp: 'lte' }, 140.1)).toBe('H');
    expect(flagAgainst({ min: 40, minOp: 'gte' }, 40)).toBe('N');
    expect(flagAgainst({ min: 40, minOp: 'gte' }, 39.9)).toBe('L');
  });

  it('keeps op-less two-sided bands inclusive on both bounds (today, unchanged)', () => {
    expect(flagAgainst({ min: 12, max: 16 }, 12)).toBe('N');
    expect(flagAgainst({ min: 12, max: 16 }, 16)).toBe('N');
    expect(flagAgainst({ min: 12, max: 16 }, 11.9)).toBe('L');
    expect(flagAgainst({ min: 12, max: 16 }, 16.1)).toBe('H');
  });

  it('returns null when there is no band or no usable bound', () => {
    expect(flagAgainst(undefined, 5)).toBeNull();
    expect(flagAgainst(null, 5)).toBeNull();
    expect(flagAgainst({ segment: 'normal' }, 5)).toBeNull();
  });
});
