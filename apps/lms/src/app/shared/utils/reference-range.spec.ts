import {
  bandReportText,
  fillUnit,
  hasUnitToken,
  normalizeReportText,
  oneLine,
  flagAgainst,
  matchReferenceRange,
  normalizeSex,
  reportRangeText,
  summarizeRanges,
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

  it('a value ON a one-sided limit is normal (simple model); legacy strict ops still flag it', () => {
    expect(flagAgainst({ max: 140 }, 140)).toBe('N');
    expect(flagAgainst({ min: 40 }, 40)).toBe('N');
    expect(flagAgainst({ max: 140 }, 140.01)).toBe('H');
    expect(flagAgainst({ min: 40 }, 39.99)).toBe('L');
    expect(flagAgainst({ max: 140, maxOp: 'lt' }, 140)).toBe('H');
    expect(flagAgainst({ min: 40, minOp: 'gt' }, 40)).toBe('L');
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

  // Logic review (2026-10-02): a one-sided band with no explicit op derives
  // its strictness from a comparator glyph sitting immediately before its
  // OWN number in reportText/label — never from one-sidedness alone. Mirrors
  // mw ResultFlaggingService.NumericLevel + ReferenceRangeResolver.
  // EffectiveOneSidedOp; the boundary cases below are duplicated in
  // ReferenceRangeGlyphParityTests (mw) on purpose — SAME inputs, SAME flag.
  describe('op-absent one-sided bound: glyph-derived, else inclusive (2026-10-02)', () => {
    it('no glyph at all stays inclusive (the limit itself is Normal)', () => {
      expect(flagAgainst({ max: 200, reportText: null }, 200)).toBe('N');
      expect(flagAgainst({ min: 60 }, 60)).toBe('N');
    });

    it('a strict "<" / ">" glyph before the bound\'s own number flags the limit', () => {
      expect(flagAgainst({ max: 140, reportText: 'Normal <140 mg/dL' }, 140)).toBe('H');
      expect(flagAgainst({ max: 140, reportText: 'Normal <140 mg/dL' }, 139.9)).toBe('N');
      expect(flagAgainst({ max: 5, label: 'Nonpregnant — <5 IU/L — Negative' }, 5)).toBe('H');
    });

    it('an inclusive "≤" / "≥" glyph (even with no space) keeps the limit Normal', () => {
      expect(flagAgainst({ max: 5, reportText: '≤ 5 {u}' }, 5)).toBe('N');
      expect(flagAgainst({ min: 90, reportText: '≥ 90 {u}' }, 90)).toBe('N');
      expect(flagAgainst({ min: 40, reportText: '≥40 {u}' }, 40)).toBe('N');
    });

    it('an explicit op always wins over a glyph in the text', () => {
      expect(flagAgainst({ max: 140, maxOp: 'lte', reportText: 'Normal: <140 {u}' }, 140)).toBe('N');
    });

    it('a glyph near a DIFFERENT number is ignored — falls back to inclusive', () => {
      expect(flagAgainst({ max: 140, reportText: 'G-OGTT: <180 mg/dL\nSame-tier: 140 mg/dL' }, 140)).toBe('N');
    });

    // The owner's named boundary cases (real master-catalogue shapes) —
    // mw ReferenceRangeGlyphParityTests covers the full 158-band sweep.
    it('CRP 5.0 against "≤ 5" is Normal', () => {
      expect(flagAgainst({ max: 5, reportText: '≤ 5 mg/L' }, 5.0)).toBe('N');
    });
    it('eGFR 90 against "≥ 90" is Normal', () => {
      expect(flagAgainst({ min: 90, reportText: '≥ 90 mL/min' }, 90.0)).toBe('N');
    });
    it('HDL 40 against "≥40" is Normal', () => {
      expect(flagAgainst({ min: 40, reportText: 'Normal ≥40 mg/dL' }, 40.0)).toBe('N');
    });
    it('OGTT 140 against "<140" is High', () => {
      expect(flagAgainst({ max: 140, reportText: 'Normal <140 mg/dL' }, 140.0)).toBe('H');
    });
    it('Postprandial 139 against a band whose text says "<140" is Normal (structured max is 139)', () => {
      expect(flagAgainst({ max: 139, reportText: '2-hour: <140 mg/dL normal' }, 139.0)).toBe('N');
    });
    it('HbA1c 6.4 is not High', () => {
      expect(flagAgainst(
        { max: 6.4, reportText: 'Normal: <5.7 %\nPrediabetes: 5.7–6.4%\nDiabetes: ≥6.5%' }, 6.4,
      )).not.toBe('H');
    });
  });
});

describe('report text — the simple model prints what was typed', () => {
  const unit = 'g/dL';
  const F = { sex: 'F' as const, minAge: 18, min: 12, max: 16, reportText: '12 – 16 g/dL' };
  const M = { sex: 'M' as const, minAge: 18, min: 13, max: 17 };
  it('a typed report text prints verbatim; blank prints "L–H unit" with no who', () => {
    expect(bandReportText(F, unit)).toBe('12 – 16 g/dL');
    expect(bandReportText({ ...F, reportText: '  Normal: 70–99 · Prediabetes: 100–125 · Diabetes: ≥126 ' }, 'mg/dL'))
      .toBe('Normal: 70–99 · Prediabetes: 100–125 · Diabetes: ≥126');
    expect(bandReportText(M, unit)).toBe('13–17 g/dL');
    expect(bandReportText({ max: 200 }, 'mg/dL')).toBe('≤ 200 mg/dL');
    expect(bandReportText({ min: 60 }, '')).toBe('≥ 60');
    expect(bandReportText({}, unit)).toBeNull();
  });
  it('a legacy group keeps its legacy line until migrated', () => {
    expect(bandReportText({ segment: 'adult_male', min: 13, max: 17 }, unit)).toBe('Adult Male: 13–17 g/dL');
    expect(bandReportText({ segment: 'n', label: 'Negative' }, '')).toBe('Negative');
  });
  it('matched on merit → that group alone; otherwise every group with its who', () => {
    expect(reportRangeText([F, M], { range: F, isSpecific: true }, unit)).toBe('12 – 16 g/dL');
    expect(reportRangeText([F, M], { range: F, isSpecific: false }, unit)).toBe('Adult Female: 12 – 16 g/dL\nAdult Male: 13–17 g/dL');
    expect(reportRangeText([{ sex: 'any' as const, min: 1, max: 2, reportText: 'up to 2' }], { range: undefined, isSpecific: false }, unit)).toBe('up to 2');
    expect(summarizeRanges([F, M], unit)).toBe('Adult Female: 12 – 16 g/dL · Adult Male: 13–17 g/dL');
  });
  it('touching ages: the patient on the shared birthday gets the group that starts there', () => {
    const kids = [{ sex: 'any' as const, minAge: 1, maxAge: 6, min: 1 }, { sex: 'any' as const, minAge: 6, maxAge: 10, min: 2 }];
    expect(selectReferenceRange(kids, null, 6)).toBe(kids[1]);
    expect(selectReferenceRange(kids, null, 5.5)).toBe(kids[0]);
    expect(matchReferenceRange(kids, null, 6)).toEqual({ range: kids[1], isSpecific: true });
  });
});

describe('report text — line breaks and the {u} unit placeholder', () => {
  const GLU = 'Normal: 70–99\nPrediabetes: 100–125\nDiabetes: ≥126 mg/dL';
  it('normalizeReportText: CRLF / CR → LF, trailing spaces and blank lines dropped, inner lines kept', () => {
    expect(normalizeReportText('Normal: 70–99  \r\nPrediabetes: 100–125\r\nDiabetes: ≥126 mg/dL\r\n\r\n ')).toBe(GLU);
    expect(normalizeReportText('a\rb')).toBe('a\nb');
    expect(normalizeReportText('a\n\nb')).toBe('a\n\nb');
    expect(normalizeReportText('  \n ')).toBeNull();
    expect(normalizeReportText(null)).toBeNull();
  });
  it('a typed multi-line text prints its lines; summaries join them with " · " unless asked to keep them', () => {
    const g = { sex: 'any' as const, min: 70, max: 99, reportText: GLU.replace(/\n/g, '\r\n') };
    expect(bandReportText(g, 'mg/dL')).toBe(GLU);
    expect(reportRangeText([g], { range: g, isSpecific: true }, 'mg/dL')).toBe(GLU);
    expect(summarizeRanges([g], 'mg/dL')).toBe('Normal: 70–99 · Prediabetes: 100–125 · Diabetes: ≥126 mg/dL');
    expect(summarizeRanges([g], 'mg/dL', { keepLines: true })).toBe(GLU);
    expect(oneLine(GLU)).toBe('Normal: 70–99; Prediabetes: 100–125; Diabetes: ≥126 mg/dL');
  });
  it('fillUnit: {u} / {U} → the unit; no unit drops the token and its space; lines kept', () => {
    expect(hasUnitToken('4 – 6.6 {U}')).toBe(true);
    expect(hasUnitToken('4 – 6.6')).toBe(false);
    expect(fillUnit('4 – 6.6 {u}', '×10¹²/L')).toBe('4 – 6.6 ×10¹²/L');
    expect(fillUnit('Normal: 70–99 {U}\nDiabetes: ≥126 {u}', 'mg/dL')).toBe('Normal: 70–99 mg/dL\nDiabetes: ≥126 mg/dL');
    expect(fillUnit('70–99 {u}', '')).toBe('70–99');
    expect(fillUnit('{u} 70–99', null)).toBe('70–99');
    expect(fillUnit('a {u} b\nc {u}', '  ')).toBe('a b\nc');
    expect(fillUnit('no token', 'g/dL')).toBe('no token');
    expect(fillUnit('$& {u}', '$1')).toBe('$& $1');               // a unit is never a replace pattern
  });
  it('every reader prints the unit: the report line, the all-groups list, the summary', () => {
    const m = { sex: 'M' as const, minAge: 18, min: 4.5, max: 5.9, reportText: '4.5 – 5.9 {u}' };
    const f = { sex: 'F' as const, minAge: 18, min: 4, max: 5.2 };
    expect(bandReportText(m, '×10¹²/L')).toBe('4.5 – 5.9 ×10¹²/L');
    expect(reportRangeText([m, f], { range: undefined, isSpecific: false }, '×10¹²/L'))
      .toBe('Adult Male: 4.5 – 5.9 ×10¹²/L\nAdult Female: 4–5.2 ×10¹²/L');
    expect(summarizeRanges([m], 'x/L')).toBe('Adult Male: 4.5 – 5.9 x/L');
    expect(bandReportText(m, '')).toBe('4.5 – 5.9');
  });
});

// L2 (2026-10-02): the gestational-text guess, mirroring mw
// ReferenceRangeResolver.EffectiveSex/LooksGestational — a band naming
// itself "G-OGTT"/"gestational"/"pregnant" (never negated) is implicitly
// female for EXCLUSION only, never for match score.
describe('gestational-text guess (mirrors mw EffectiveSex/LooksGestational)', () => {
  const gOgtt: RangeLike = { segment: 'g_ogtt', min: null, max: 92, label: 'G-OGTT: <92' };

  it('excludes a male patient from a band whose text names it gestational', () => {
    // Paired with an equally-unconstrained, non-gestational band (score 0
    // either way): if gOgtt is correctly EXCLUDED for a male patient, it
    // drops out of the eligible set entirely and the other band wins
    // outright, even though neither actively scores. Without the guess,
    // both would tie and the first-declared (gOgtt) would win instead.
    const other: RangeLike = { segment: 'other', min: 1, max: 2 };
    const { range, isSpecific } = matchReferenceRange([gOgtt, other], 'M', 30);
    expect(range).toBe(other);
    expect(isSpecific).toBe(false); // survived by elimination, not a merit match
  });

  it('does not exclude a female or unknown-sex patient, but never scores it either', () => {
    const other: RangeLike = { segment: 'other', min: 1, max: 2 };
    const female = matchReferenceRange([gOgtt, other], 'F', 28);
    expect(female.range).toBe(gOgtt); // first-declared tie-winner — not excluded for a woman
    expect(female.isSpecific).toBe(false); // text guess never AWARDS score
    const unknown = matchReferenceRange([gOgtt, other], null, 28);
    expect(unknown.range).toBe(gOgtt); // unknown sex never contradicts either
    expect(unknown.isSpecific).toBe(false);
  });

  it('never excludes a band whose gestational wording is explicitly negated', () => {
    const nonPregnant: RangeLike = { segment: 'nonpregnant', min: null, max: 5, label: 'Non-pregnant: <5 IU/L' };
    const other: RangeLike = { segment: 'other', min: 1, max: 2 };
    const { range } = matchReferenceRange([nonPregnant, other], 'M', 30);
    expect(range).toBe(nonPregnant); // first-declared tie-winner — never excluded; "non-pregnant" is not a gestational guess
  });

  it('never guesses gestational from a band with no numeric bounds (a placeholder line)', () => {
    // Bound-less, so the guess never applies — a MALE patient is never
    // excluded from this band just because its label mentions "pregnancy".
    // Paired with an equally-unconstrained band (score 0 either way) so a
    // wrong exclusion would be visible: if the placeholder were (incorrectly)
    // excluded as gestational, only the second band would remain eligible
    // and WIN outright — instead both tie at 0 and the first-declared one
    // (the placeholder) wins, proving it was never excluded.
    const placeholder: RangeLike = { segment: 'pregnancy', min: null, max: null, label: 'Pregnancy — see gestational-age table' };
    const unconstrained: RangeLike = { segment: 'other', min: 1, max: 2 };
    const both = matchReferenceRange([placeholder, unconstrained], 'M', 30);
    expect(both.range).toBe(placeholder);
  });

  it('a REAL sex field still wins the active match score; the text guess never does', () => {
    const female: RangeLike = { sex: 'F', min: 70, max: 180, label: 'G-OGTT: <180' };
    const { range, isSpecific } = matchReferenceRange([female], 'F', 28);
    expect(range).toBe(female);
    expect(isSpecific).toBe(true); // the STRUCTURED sex match earns the score, not the text guess
  });
});
