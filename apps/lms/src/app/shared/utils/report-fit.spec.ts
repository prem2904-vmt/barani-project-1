import { fitText, softTokens, type FitDoc, type FitOptions } from './report-fit';

/** A fake font: every character is 0.5 × the size wide. */
function fakeDoc(): FitDoc & { size: number } {
  const d = { size: 10, getTextWidth(t: string) { return t.length * d.size * 0.5; }, setFontSize(n: number) { d.size = n; } };
  return d;
}
const opts = (o: Partial<FitOptions> = {}): FitOptions => ({ maxW: 100, maxLines: 2, startPt: 10, minPt: 7, policy: 'clinical', ...o });

describe('softTokens', () => {
  it('breaks after space / - , · and before (', () => {
    expect(softTokens('Glucose-6-Phosphate (G6PD) Quantitative, Erythrocyte')).toEqual(
      ['Glucose-', '6-', 'Phosphate ', '(G6PD) ', 'Quantitative, ', 'Erythrocyte']);
    expect(softTokens('a/b')).toEqual(['a/', 'b']);
  });
});

describe('fitText', () => {
  it('text that fits stays one line at full size, unshrunk', () => {
    const r = fitText(fakeDoc(), 'Short', opts());
    expect(r).toMatchObject({ lines: ['Short'], pt: 10, shrunk: false, truncated: false, grew: false });
  });

  it('wraps at soft breaks before shrinking', () => {
    const r = fitText(fakeDoc(), 'Thiruvenkatasamy Subramaniam', opts({ maxW: 100 }));   // 28 chars = 140pt at 10pt
    expect(r.lines).toEqual(['Thiruvenkatasamy', 'Subramaniam']);
    expect(r.pt).toBe(10);
    expect(r.h).toBeCloseTo(2 * 10 * 1.15, 5);
  });

  it('shrinks (largest size that fits) when wrapping to maxLines is not enough', () => {
    const r = fitText(fakeDoc(), 'Thiruvenkatasamy Subramaniam Venkataraghavan', opts({ maxW: 100 }));  // 44 chars
    expect(r.shrunk).toBe(true);
    expect(r.pt).toBeLessThan(10);
    expect(r.pt).toBeGreaterThanOrEqual(7);
    expect(r.lines.length).toBeLessThanOrEqual(2);
    const d = fakeDoc(); d.setFontSize(r.pt);
    for (const l of r.lines) expect(d.getTextWidth(l)).toBeLessThanOrEqual(100 + 1e-6);
    // …and it is the LARGEST such size: a hair bigger would not fit.
    const bigger = fitText(fakeDoc(), 'Thiruvenkatasamy Subramaniam Venkataraghavan', opts({ maxW: 100, startPt: r.pt + 0.2, minPt: r.pt + 0.2 }));
    expect(bigger.lines.length).toBeGreaterThan(2);
  });

  it('tightens the line height when it shrinks, by at most 20%', () => {
    const r = fitText(fakeDoc(), 'Thiruvenkatasamy Subramaniam Venkataraghavan', opts());
    expect(r.lineH).toBeLessThan(r.pt * 1.15);
    expect(r.lineH).toBeGreaterThanOrEqual(r.pt * 1.15 * 0.8 - 1e-9);
  });

  it('never goes below the floor; a clinical value then GROWS (more lines), never cut', () => {
    const text = 'Dr. Lakshminarasimhan Venkatasubramanian MD DM Consultant Clinical Biochemist';
    const r = fitText(fakeDoc(), text, opts({ maxW: 90, minPt: 7 }));
    expect(r.pt).toBe(7);
    expect(r.grew).toBe(true);
    expect(r.truncated).toBe(false);
    expect(r.lines.length).toBeGreaterThan(2);
    expect(r.lines.join(' ').replace(/\s+/g, ' ')).toBe(text);                 // every character survives
    const d = fakeDoc(); d.setFontSize(7);
    for (const l of r.lines) expect(d.getTextWidth(l)).toBeLessThanOrEqual(90 + 1e-6);
  });

  it('a label may be ellipsised at the floor', () => {
    const r = fitText(fakeDoc(), 'A decorative tagline that is far too long for this little box to hold at all', opts({ maxW: 60, policy: 'label' }));
    expect(r.truncated).toBe(true);
    expect(r.lines.length).toBe(2);
    expect(r.lines[1].endsWith('…')).toBe(true);
    const d = fakeDoc(); d.setFontSize(r.pt);
    expect(d.getTextWidth(r.lines[1])).toBeLessThanOrEqual(60 + 1e-6);
  });

  it('a single word wider than the box is broken by characters, not left overflowing', () => {
    const r = fitText(fakeDoc(), 'Pneumonoultramicroscopicsilicovolcanoconiosis', opts({ maxW: 80, maxLines: 4 }));
    const d = fakeDoc(); d.setFontSize(r.pt);
    for (const l of r.lines) expect(d.getTextWidth(l)).toBeLessThanOrEqual(80 + 1e-6);
    expect(r.lines.join('')).toBe('Pneumonoultramicroscopicsilicovolcanoconiosis');
  });

  it('a label in front of the value narrows line 1 only', () => {
    const r = fitText(fakeDoc(), 'Lakshminarasimhan Venkatasubramanian', opts({ maxW: 120, firstLineW: 60, maxLines: 3 }));
    expect(r.lines.length).toBeGreaterThan(1);
    const d = fakeDoc(); d.setFontSize(r.pt);
    expect(d.getTextWidth(r.lines[0])).toBeLessThanOrEqual(60 + 1e-6);
  });

  it('leaves the document at the size the lines were measured at', () => {
    const d = fakeDoc();
    const r = fitText(d, 'Thiruvenkatasamy Subramaniam Venkataraghavan', opts());
    expect(d.size).toBe(r.pt);
  });
});
