import { pdfSafeText, splitSuperscriptRuns, hasSuperscript } from './pdf-text';

describe('pdfSafeText', () => {
  it('returns empty string for null and undefined', () => {
    expect(pdfSafeText(null)).toBe('');
    expect(pdfSafeText(undefined)).toBe('');
  });

  it('preserves plain ASCII text unchanged (fast path)', () => {
    expect(pdfSafeText('hello world')).toBe('hello world');
    expect(pdfSafeText('Test 123')).toBe('Test 123');
    expect(pdfSafeText('!@#$%&*()_+-=[]{}|;:,.<>?')).toBe('!@#$%&*()_+-=[]{}|;:,.<>?');
  });

  describe('superscript transliteration', () => {
    it('converts superscript digits to caret form', () => {
      expect(pdfSafeText('×10⁹/L')).toBe('×10^9/L');
      expect(pdfSafeText('×10¹²/L')).toBe('×10^12/L');
      expect(pdfSafeText('²')).toBe('^2');
      expect(pdfSafeText('³')).toBe('^3');
    });

    it('collapses consecutive superscripts into a single caret group', () => {
      expect(pdfSafeText('⁹')).toBe('^9');
      expect(pdfSafeText('¹²³')).toBe('^123');
      expect(pdfSafeText('¹²⁹')).toBe('^129');
    });

    it('handles superscript signs (+, -, n)', () => {
      expect(pdfSafeText('⁺')).toBe('^+');
      expect(pdfSafeText('⁻')).toBe('^-');
      expect(pdfSafeText('ⁿ')).toBe('^n');
      expect(pdfSafeText('10⁻³')).toBe('10^-3');
    });

    it('preserves spacing around superscripts', () => {
      expect(pdfSafeText('x ¹²³ y')).toBe('x ^123 y');
      expect(pdfSafeText('cells/µL⁹')).toBe('cells/µL^9');
    });
  });

  describe('subscript transliteration', () => {
    it('converts subscript digits to plain digits', () => {
      expect(pdfSafeText('CO₂')).toBe('CO2');
      expect(pdfSafeText('H₂O')).toBe('H2O');
      expect(pdfSafeText('₀')).toBe('0');
    });

    it('converts all subscript digits 0-9', () => {
      expect(pdfSafeText('₁₂₃₄₅₆₇₈₉₀')).toBe('1234567890');
    });

    it('preserves non-subscript characters around subscripts', () => {
      expect(pdfSafeText('pH₁ test')).toBe('pH1 test');
    });
  });

  describe('other Unicode transliteration', () => {
    it('transliterates Greek letters', () => {
      expect(pdfSafeText('α')).toBe('alpha');
      expect(pdfSafeText('β')).toBe('beta');
      expect(pdfSafeText('γ')).toBe('gamma');
      expect(pdfSafeText('δ')).toBe('delta');
      expect(pdfSafeText('κ')).toBe('kappa');
      expect(pdfSafeText('λ')).toBe('lambda');
    });

    it('transliterates capital Greek letters', () => {
      expect(pdfSafeText('Α')).toBe('Alpha');
      expect(pdfSafeText('Β')).toBe('Beta');
      expect(pdfSafeText('Γ')).toBe('Gamma');
      expect(pdfSafeText('Δ')).toBe('Delta');
    });

    it('converts Greek mu (U+03BC) to micro sign (U+00B5)', () => {
      // Greek SMALL MU → MICRO SIGN
      expect(pdfSafeText('μL')).toBe('µL');
      expect(pdfSafeText('μmol')).toBe('µmol');
    });

    it('transliterates comparison operators', () => {
      expect(pdfSafeText('≥')).toBe('>=');
      expect(pdfSafeText('≤')).toBe('<=');
      expect(pdfSafeText('≠')).toBe('!=');
      expect(pdfSafeText('≈')).toBe('~');
    });

    it('transliterates mathematical symbols', () => {
      expect(pdfSafeText('∞')).toBe('inf');
      expect(pdfSafeText('⁄')).toBe('/');
    });

    it('transliterates dash variants to hyphen', () => {
      expect(pdfSafeText('‐')).toBe('-');
      expect(pdfSafeText('‑')).toBe('-');
      expect(pdfSafeText('‒')).toBe('-');
      expect(pdfSafeText('−')).toBe('-');
    });

    it('transliterates prime/quote symbols', () => {
      expect(pdfSafeText('′')).toBe("'");
      expect(pdfSafeText('″')).toBe('"');
    });

    it('collapses exotic space characters to plain space or removes them', () => {
      expect(pdfSafeText('a b')).toBe('a b');  // NO-BREAK SPACE → space
      expect(pdfSafeText('a b')).toBe('a b');  // FIGURE SPACE → space
      expect(pdfSafeText('a b')).toBe('a b');  // THIN SPACE → space
      expect(pdfSafeText('a b')).toBe('a b');  // NARROW NO-BREAK SPACE → space
      expect(pdfSafeText('a​b')).toBe('ab');   // ZERO-WIDTH SPACE → removed
    });
  });

  describe('complex mixed scenarios', () => {
    it('handles superscripts and subscripts together', () => {
      expect(pdfSafeText('CO₂⁹/L')).toBe('CO2^9/L');
    });

    it('preserves cp1252 characters (µ, ×, –, —)', () => {
      expect(pdfSafeText('5 µL')).toBe('5 µL');
      expect(pdfSafeText('2×3')).toBe('2×3');
      expect(pdfSafeText('range – value')).toBe('range – value');
      expect(pdfSafeText('em—dash')).toBe('em—dash');
    });

    it('handles realistic unit string with multiple conversions', () => {
      expect(pdfSafeText('10⁹ cells/µL')).toBe('10^9 cells/µL');
      expect(pdfSafeText('10³⁹/L')).toBe('10^39/L');
      expect(pdfSafeText('μmol/L')).toBe('µmol/L');
    });

    it('coerces numbers to strings', () => {
      expect(pdfSafeText(123)).toBe('123');
      expect(pdfSafeText(45.67)).toBe('45.67');
    });

    it('handles strings with leading/trailing spaces', () => {
      expect(pdfSafeText('  ×10⁹/L  ')).toBe('  ×10^9/L  ');
    });

    it('does not modify pure ASCII edge cases', () => {
      expect(pdfSafeText('')).toBe('');
      expect(pdfSafeText(' ')).toBe(' ');
      expect(pdfSafeText('  ')).toBe('  ');
    });
  });
});

describe('splitSuperscriptRuns', () => {
  it('returns a single run for text without superscripts', () => {
    const result = splitSuperscriptRuns('hello world');
    expect(result).toEqual([{ t: 'hello world' }]);
  });

  it('extracts a single superscript run', () => {
    const result = splitSuperscriptRuns('×10^9/L');
    expect(result).toEqual([
      { t: '×10' },
      { t: '9', sup: true },
      { t: '/L' },
    ]);
  });

  it('extracts multiple superscript runs', () => {
    const result = splitSuperscriptRuns('a^1 b^2 c');
    expect(result).toEqual([
      { t: 'a' },
      { t: '1', sup: true },
      { t: ' b' },
      { t: '2', sup: true },
      { t: ' c' },
    ]);
  });

  it('handles superscript at the start of string', () => {
    const result = splitSuperscriptRuns('^12 start');
    expect(result).toEqual([
      { t: '12', sup: true },
      { t: ' start' },
    ]);
  });

  it('handles superscript at the end of string', () => {
    const result = splitSuperscriptRuns('end ^99');
    expect(result).toEqual([
      { t: 'end ' },
      { t: '99', sup: true },
    ]);
  });

  it('handles consecutive superscripts', () => {
    const result = splitSuperscriptRuns('^1^2^3');
    expect(result).toEqual([
      { t: '1', sup: true },
      { t: '2', sup: true },
      { t: '3', sup: true },
    ]);
  });

  it('extracts superscript with signs', () => {
    const result = splitSuperscriptRuns('10^-3 and 10^+2');
    expect(result).toEqual([
      { t: '10' },
      { t: '-3', sup: true },
      { t: ' and 10' },
      { t: '+2', sup: true },
    ]);
  });

  it('ignores caret not followed by digits or signs', () => {
    const result = splitSuperscriptRuns('5^x is not superscript');
    expect(result).toEqual([{ t: '5^x is not superscript' }]);
  });

  it('handles empty string', () => {
    const result = splitSuperscriptRuns('');
    expect(result).toEqual([]);
  });

  it('handles multidigit superscripts', () => {
    const result = splitSuperscriptRuns('×10^123/L');
    expect(result).toEqual([
      { t: '×10' },
      { t: '123', sup: true },
      { t: '/L' },
    ]);
  });

  it('does not mark runs without sup property if they are regular text', () => {
    const result = splitSuperscriptRuns('plain text');
    expect(result).toHaveLength(1);
    expect(result[0].sup).toBeUndefined();
  });

  it('preserves whitespace in regular runs', () => {
    const result = splitSuperscriptRuns('a  b^1  c');
    expect(result).toEqual([
      { t: 'a  b' },
      { t: '1', sup: true },
      { t: '  c' },
    ]);
  });
});

describe('hasSuperscript', () => {
  it('returns false for text without superscripts', () => {
    expect(hasSuperscript('hello world')).toBe(false);
    expect(hasSuperscript('×10/L')).toBe(false);
    expect(hasSuperscript('5^x is not superscript')).toBe(false);
  });

  it('returns true for text with a superscript', () => {
    expect(hasSuperscript('×10^9/L')).toBe(true);
    expect(hasSuperscript('^12')).toBe(true);
  });

  it('returns true for multiple superscripts', () => {
    expect(hasSuperscript('a^1 b^2 c')).toBe(true);
  });

  it('returns true for superscript with signs', () => {
    expect(hasSuperscript('10^-3')).toBe(true);
    expect(hasSuperscript('10^+2')).toBe(true);
  });

  it('resets lastIndex to prevent side effects across calls', () => {
    // Call once to advance lastIndex
    hasSuperscript('×10^9/L');
    // Call again with same content should still detect it
    expect(hasSuperscript('×10^9/L')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(hasSuperscript('')).toBe(false);
  });

  it('returns false for whitespace-only', () => {
    expect(hasSuperscript('  ')).toBe(false);
  });
});

describe('installPdfTextSanitizer', () => {
  // needs-harness: installPdfTextSanitizer
  // Requires a real jsPDF instance and mocking/wrapping its text method.
  // Skipped: this function mutates a jsPDF document object and verifies
  // that its text() method is wrapped to sanitize arguments. A proper test
  // would need to instantiate jsPDF or mock it, which is a different harness.
  it.todo('wraps jsPDF.text() to sanitize all text arguments');
  it.todo('handles Array<string> text argument (multi-line)');
  it.todo('is idempotent (safe on re-used doc)');
});

describe('measureWithSuperscripts', () => {
  // needs-harness: measureWithSuperscripts
  // Requires a real or mocked doc object with getTextWidth() and setFontSize().
  // These return numeric values that depend on the font and glyph metrics,
  // so the function can only be tested with a real PDF font context.
  it.todo('measures text width accounting for superscript scaling');
  it.todo('restores font size to original after measurement');
  it.todo('returns 0 for empty string');
});

describe('drawTextWithSuperscripts', () => {
  // needs-harness: drawTextWithSuperscripts
  // Requires a real or mocked doc object with text(), getTextWidth(), and
  // setFontSize(). The function draws on the document and tracks cursor
  // position (cx), which cannot be tested without a full PDF harness.
  it.todo('draws text with superscripts at correct positions');
  it.todo('positions superscripts higher and smaller');
  it.todo('returns the total advance width');
  it.todo('restores font size to original after drawing');
});
