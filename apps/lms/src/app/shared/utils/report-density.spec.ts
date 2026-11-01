import { DENSITY, SQUEEZE_MAX_OVERFLOW, SQUEEZE_SCALE, densityTokens, squeezeEligible, squeezeMessage, squeezedSize, type SqueezeReport } from './report-density';
import { SIG_ROW, setSignatureRhythm } from './report-signatures';

describe('report density — token overlay', () => {
  it('Normal is today: the numbers that used to sit at the draw sites', () => {
    const n = DENSITY.normal;
    expect([n.padV, n.head.top, n.head.bottom, n.subPadV, n.techPad, n.deptLead, n.afterStrip]).toEqual([4, 3, 6, 2, 8, 4, 14]);
    expect(n.sig).toEqual({ lead: 10, tail: 7 });
    expect(n.trendPerRow).toBe(2);
    expect(n.slimDept).toBe(false);
    expect(n.inlineMethod).toBe(false);
    expect(n.sizeCap).toEqual({});
  });

  it('Compact takes about 18 percent off a 9 pt row and Relaxed adds about 10', () => {
    const row = (pad: number) => 9 * 1.15 + 2 * pad;
    expect(1 - row(DENSITY.compact.padV) / row(DENSITY.normal.padV)).toBeGreaterThan(0.17);
    expect(1 - row(DENSITY.compact.padV) / row(DENSITY.normal.padV)).toBeLessThan(0.2);
    expect(row(DENSITY.relaxed.padV) / row(DENSITY.normal.padV) - 1).toBeGreaterThan(0.09);
    expect(row(DENSITY.relaxed.padV) / row(DENSITY.normal.padV) - 1).toBeLessThan(0.12);
  });

  it('Compact: notes capped at 8 pt, never a result face; three trend charts a row', () => {
    const c = DENSITY.compact;
    for (const el of ['note', 'techNote', 'description', 'interpretation'] as const) expect(c.sizeCap[el]).toBe(8);
    for (const el of ['testName', 'result', 'resultAbnormal', 'unit', 'range'] as const) expect(c.sizeCap[el]).toBeUndefined();
    expect(c.trendPerRow).toBe(3);
  });

  it('an unknown or empty id is Normal', () => {
    for (const id of [undefined, null, '', 'huge']) expect(densityTokens(id).id).toBe('normal');
    expect(densityTokens('compact').id).toBe('compact');
  });
});

describe('report density — squeeze decision', () => {
  it('is eligible only from two pages up and within 12 percent of a page', () => {
    expect(SQUEEZE_MAX_OVERFLOW).toBe(0.12);
    expect(squeezeEligible(1, 0.05)).toBe(false);
    expect(squeezeEligible(2, 0)).toBe(false);
    expect(squeezeEligible(2, 0.05)).toBe(true);
    expect(squeezeEligible(2, 0.12)).toBe(true);
    expect(squeezeEligible(3, 0.121)).toBe(false);
    expect(squeezeEligible(2, 0.3)).toBe(false);
  });

  it('the last-resort scale is 0.95 and never goes under the floor', () => {
    expect(SQUEEZE_SCALE).toBe(0.95);
    expect(squeezedSize(9, 0.95, 7)).toBeCloseTo(8.55, 5);
    expect(squeezedSize(9, 0.95, 9)).toBe(9);             // the floor holds
    expect(squeezedSize(6.5, 0.95, 7)).toBe(6.5);          // a face already under the floor is left alone
    expect(squeezedSize(9, 1, 7)).toBe(9);
  });
});

describe('signature rhythm follows the density and resets', () => {
  afterEach(() => setSignatureRhythm(null));
  it('Normal 10 / 7 (base 30); a tighter rhythm moves base and tail; null restores', () => {
    expect([SIG_ROW.lead, SIG_ROW.base, SIG_ROW.tail]).toEqual([10, 30, 7]);
    setSignatureRhythm(DENSITY.compact.sig);
    expect([SIG_ROW.lead, SIG_ROW.base, SIG_ROW.tail]).toEqual([6, 26, 4]);
    setSignatureRhythm(null);
    expect([SIG_ROW.lead, SIG_ROW.base, SIG_ROW.tail]).toEqual([10, 30, 7]);
  });
});

describe('the designer note about the squeeze', () => {
  const base: SqueezeReport = { applied: false, pagesBefore: 2, pagesAfter: 2, overflow: 0.05, by: '' };
  it('says it in plain words, per outcome', () => {
    expect(squeezeMessage(null)).toBe('');
    expect(squeezeMessage({ ...base, applied: true, pagesAfter: 1, by: 'compact' })).toBe('Squeezed to 1 page (was 2) on the sample report.');
    expect(squeezeMessage({ ...base, applied: true, pagesBefore: 4, pagesAfter: 3, by: 'scale' })).toBe('Squeezed to 3 pages (was 4) on the sample report.');
    expect(squeezeMessage({ ...base, reason: 'one-page' })).toContain('already fits one page');
    expect(squeezeMessage({ ...base, reason: 'too-long' })).toContain('too far over');
    expect(squeezeMessage({ ...base, reason: 'no-gain' })).toContain('would not save a page');
  });
  it('never says AI', () => {
    for (const reason of ['one-page', 'too-long', 'no-gain'] as const) expect(squeezeMessage({ ...base, reason })).not.toMatch(/\bAI\b/);
  });
});
