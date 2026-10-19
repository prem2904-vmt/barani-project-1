import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  pdfSafeText, splitSuperscriptRuns, hasSuperscript, installPdfTextSanitizer,
  splitSymbolRuns, hasSymbolGlyph, toSymbolEncoding, symbolRunUnitWidth,
  drawTextWithSuperscripts,
} from './pdf-text';

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

describe('pdfSafeText keepSymbols', () => {
  it('keeps ≥ ≤ ≠ ≈ ∞ and Greek for the symbol-aware draw', () => {
    expect(pdfSafeText('Diabetes: ≥126 mg/dL', { keepSymbols: true })).toBe('Diabetes: ≥126 mg/dL');
    expect(pdfSafeText('≤5 ≠ ≈ ∞ β-hCG', { keepSymbols: true })).toBe('≤5 ≠ ≈ ∞ β-hCG');
  });
  it('still transliterates everything else', () => {
    expect(pdfSafeText('≥ ×10⁹/L CO₂ μL', { keepSymbols: true })).toBe('≥ ×10^9/L CO2 µL');
  });
});

describe('symbol runs', () => {
  it('splits a mixed line into body and symbol runs', () => {
    expect(splitSymbolRuns('Diabetes: ≥126 mg/dL')).toEqual([
      { t: 'Diabetes: ' }, { t: '≥', sym: true }, { t: '126 mg/dL' },
    ]);
    expect(splitSymbolRuns('≥≤x')).toEqual([{ t: '≥≤', sym: true }, { t: 'x' }]);
    expect(splitSymbolRuns('plain')).toEqual([{ t: 'plain' }]);
  });
  it('detects symbol glyphs but not cp1252 characters', () => {
    expect(hasSymbolGlyph('≥126')).toBe(true);
    expect(hasSymbolGlyph('±5 µL ×10 – —')).toBe(false);
  });
  it('maps to Symbol-font encoding bytes', () => {
    expect(toSymbolEncoding('≥≤≠≈∞')).toBe('\u00b3\u00a3\u00b9\u00bb\u00a5');
    expect(toSymbolEncoding('αβγ')).toBe('abg');
  });
  it('measures with Symbol AFM widths', () => {
    expect(symbolRunUnitWidth('≥')).toBeCloseTo(0.549);
    expect(symbolRunUnitWidth('≥∞')).toBeCloseTo(0.549 + 0.713);
  });
});

describe('installPdfTextSanitizer', () => {
  type Call = { t: unknown; x: unknown; y: unknown; font: string };
  function makeDoc() {
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: false });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const calls: Call[] = [];
    const raw = doc.text.bind(doc);
    (doc as unknown as { text: unknown }).text = (t: unknown, x: unknown, y: unknown, ...r: unknown[]) => {
      calls.push({ t, x, y, font: doc.getFont().fontName });
      return (raw as (...a: unknown[]) => unknown)(t, x, y, ...r);
    };
    installPdfTextSanitizer(doc);
    return { doc, calls };
  }
  const drawn = (calls: Call[]) => calls.map(c => Array.isArray(c.t) ? c.t.join('\n') : String(c.t)).join('|');

  it('draws ≥ from the Symbol font instead of emitting ">="', () => {
    const { doc, calls } = makeDoc();
    doc.text('Diabetes: ≥126 mg/dL', 50, 100);
    expect(drawn(calls)).not.toContain('>=');
    expect(calls.map(c => [c.t, c.font])).toEqual([
      ['Diabetes: ', 'helvetica'], ['\u00b3', 'symbol'], ['126 mg/dL', 'helvetica'],
    ]);
    // font restored afterwards
    expect(doc.getFont().fontName).toBe('helvetica');
  });

  it('positions runs at the running advance on one baseline', () => {
    const { doc, calls } = makeDoc();
    doc.text('Diabetes: ≥126', 50, 100);
    const wBody = doc.getTextWidth('Diabetes: ');
    expect(calls[0].x).toBe(50);
    expect(calls[1].x).toBeCloseTo(50 + wBody);
    expect(calls[2].x).toBeCloseTo(50 + wBody + 0.549 * 10);
    expect(new Set(calls.map(c => c.y))).toEqual(new Set([100]));
  });

  it('measures symbols at their real width (getTextWidth / getStringUnitWidth)', () => {
    const { doc } = makeDoc();
    expect(doc.getTextWidth('≥126')).toBeCloseTo(0.549 * 10 + doc.getTextWidth('126'));
    expect(doc.getStringUnitWidth('≤')).toBeCloseTo(0.549);
    // text without symbols measures exactly as before
    expect(doc.getTextWidth('126 mg/dL')).toBeGreaterThan(0);
  });

  it('honours right and centre alignment for mixed lines', () => {
    const { doc, calls } = makeDoc();
    const w = doc.getTextWidth('≥126');
    doc.text('≥126', 200, 50, { align: 'right' });
    expect(calls[0].x).toBeCloseTo(200 - w);
    calls.length = 0;
    doc.text('≥126', 200, 50, { align: 'center' });
    expect(calls[0].x).toBeCloseTo(200 - w / 2);
  });

  it('draws every line of multi-line report text', () => {
    const { doc, calls } = makeDoc();
    doc.text('Normal: 70–99 mg/dL\nPrediabetes: 100–125 mg/dL\nDiabetes: ≥126 mg/dL', 40, 60);
    const txt = drawn(calls);
    expect(txt).toContain('Normal: 70–99 mg/dL');
    expect(txt).toContain('Prediabetes: 100–125 mg/dL');
    expect(txt).toContain('Diabetes: ');
    expect(txt).not.toContain('>=');
    const ys = [...new Set(calls.map(c => c.y as number))].sort((a, b) => a - b);
    expect(ys.length).toBe(3);
    expect(ys[1] - ys[0]).toBeCloseTo(10 * doc.getLineHeightFactor());
  });

  it('handles array input (autotable multi-line cells)', () => {
    const { doc, calls } = makeDoc();
    doc.text(['<=5', '≤5 U/L'], 10, 10);
    expect(drawn(calls)).toContain('<=5');   // literal ASCII untouched
    expect(calls.some(c => c.t === '\u00a3' && c.font === 'symbol')).toBe(true);
  });

  it('still transliterates plain lines (superscripts, subscripts)', () => {
    const { doc, calls } = makeDoc();
    doc.text('×10⁹/L CO₂', 10, 10);
    expect(calls[0].t).toBe('×10^9/L CO2');
  });

  it('falls back to transliteration for rotated text', () => {
    const { doc, calls } = makeDoc();
    doc.text('≥ WATERMARK', 10, 10, { angle: 30 });
    expect(calls[0].t).toBe('>= WATERMARK');
  });

  it('is idempotent (safe on re-used doc)', () => {
    const { doc, calls } = makeDoc();
    installPdfTextSanitizer(doc);
    doc.text('≥1', 10, 10);
    expect(calls.length).toBe(2);
  });

  it('works through superscript runs (×10^9 next to ≥)', () => {
    const { doc, calls } = makeDoc();
    drawTextWithSuperscripts(doc, '≥4 ×10^9/L', 10, 10, 10);
    expect(drawn(calls)).not.toContain('>=');
    expect(calls.some(c => c.t === '9')).toBe(true);
  });

  it('emits Symbol-font text operators in the real PDF (incl. autotable cells)', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: false });
    installPdfTextSanitizer(doc);
    doc.text('Diabetes: ≥126 mg/dL', 40, 40);
    autoTable(doc, { body: [['Glucose', '≤99 mg/dL'], ['Ratio', '≥ 1.5']], startY: 60 });
    const out = doc.output();
    expect(out).toContain('/BaseFont /Symbol');
    expect(out).toContain('(\u00b3) Tj');
    expect(out).toContain('(\u00a3) Tj');
    expect(out).not.toMatch(/\(>=/);
    expect(out).not.toMatch(/\(<=/);
  });
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
