import {
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
