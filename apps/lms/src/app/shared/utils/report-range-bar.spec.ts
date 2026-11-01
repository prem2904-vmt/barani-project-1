import { jsPDF } from 'jspdf';
import { drawRangeBar, rangeBarBounds, rangeBarModel, rowRangeBar } from './report-range-bar';

/**
 * The range-bar column (report layout plan 3.11): one number line per numeric row. The geometry is
 * pure (0..1), so every case - inside, high, low, one-sided, off the end, text - is a plain assertion.
 */
describe('range bar - which rows get one', () => {
  it('reads a printed band, an upper limit and a lower limit', () => {
    expect(rangeBarBounds('12.0 – 16.0')).toEqual({ low: 12, high: 16 });
    expect(rangeBarBounds('≤ 41')).toEqual({ high: 41 });
    expect(rangeBarBounds('< 200')).toEqual({ high: 200 });
    expect(rangeBarBounds('> 40')).toEqual({ low: 40 });
    expect(rangeBarBounds('13–17\nAdult Male')).toEqual({ low: 13, high: 17 });
  });
  it('gives no bar when the cell names several different bands (no band matched sex / age)', () => {
    expect(rangeBarBounds('Adult Male 13–17\nAdult Female 12–15')).toBeNull();
    expect(rangeBarBounds('')).toBeNull();
    expect(rangeBarBounds('Negative')).toBeNull();
  });
  it('text and qualitative rows leave the cell blank', () => {
    expect(rowRangeBar({ result: 'Positive', range: 'Negative', flag: 'A' })).toBeNull();
    expect(rowRangeBar({ result: 'Nil', range: '0 – 5' })).toBeNull();
    expect(rowRangeBar({ result: '12', range: 'See comment' })).toBeNull();
    expect(rowRangeBar({ result: '', range: '1 – 2' })).toBeNull();
  });
  it('H and L come from the row\'s own flag, never from the geometry', () => {
    expect(rowRangeBar({ result: '96', range: '≤ 41', flag: 'H' })!.state).toBe('high');
    expect(rowRangeBar({ result: '11.4', range: '12.0 – 16.0', flag: 'L' })!.state).toBe('low');
    expect(rowRangeBar({ result: '14', range: '12.0 – 16.0', flag: '' })!.state).toBe('normal');
  });
});

describe('range bar - geometry', () => {
  const model = (value: number, bounds: { low?: number; high?: number }, state: 'normal' | 'high' | 'low' = 'normal') =>
    rangeBarModel({ value, bounds, state })!;

  it('a normal value sits inside the band, the band inside the line', () => {
    const m = model(14, { low: 12, high: 16 });
    expect(m.band0).toBeGreaterThan(0); expect(m.band1).toBeLessThan(1);
    expect(m.marker).toBeGreaterThan(m.band0); expect(m.marker).toBeLessThan(m.band1);
    expect(m.pinned).toBe(false); expect(m.openLow || m.openHigh).toBe(false);
  });
  it('a high value is right of the band, a low one left of it', () => {
    expect(model(15.5, { low: 12, high: 16 }, 'normal').marker).toBeLessThan(model(18, { low: 12, high: 16 }, 'high').marker);
    expect(model(18, { low: 12, high: 16 }, 'high').marker).toBeGreaterThan(model(18, { low: 12, high: 16 }, 'high').band1);
    expect(model(10, { low: 12, high: 16 }, 'low').marker).toBeLessThan(model(10, { low: 12, high: 16 }, 'low').band0);
  });
  it('"<= 41": the band starts at the left edge (open) and 96 is to the right of it', () => {
    const m = model(96, { high: 41 }, 'high');
    expect(m.openLow).toBe(true); expect(m.band0).toBe(0);
    expect(m.marker).toBeGreaterThan(m.band1);
    expect(m.pinned).toBe(true);                 // 96 is far past 1.8 x 41: pinned at the end
    expect(m.marker).toBe(1);
  });
  it('"> 40": the band runs to the right edge; 25 is left of it', () => {
    const m = model(25, { low: 40 }, 'low');
    expect(m.openHigh).toBe(true); expect(m.band1).toBe(1);
    expect(m.marker).toBeLessThan(m.band0);
  });
  it('a value far off the line is pinned to the end, never drawn outside the cell', () => {
    const m = model(1000, { low: 12, high: 16 }, 'high');
    expect(m.pinned).toBe(true); expect(m.marker).toBe(1);
    expect(model(-5, { low: 12, high: 16 }, 'low').marker).toBe(0);
  });
  it('a band that starts at zero never extends the line below zero', () => {
    const m = model(1, { low: 2, high: 4 }, 'low');
    expect(m.band0).toBeGreaterThan(0);          // 2 is not at the left edge...
    expect(m.marker).toBeLessThan(m.band0);      // ...and 1 is left of it, on the line
  });
  it('a broken band (high <= low) draws nothing', () => {
    expect(rangeBarModel({ value: 5, bounds: { low: 10, high: 10 }, state: 'normal' })).toBeNull();
  });
});

describe('range bar - painting', () => {
  const paint = { accent: '#0f766e', ink: '#000000', highColor: '#b91c1c', lowColor: '#1d4ed8', font: ['helvetica', 'bold'] as [string, string] };
  const cell = { x: 300, y: 100, width: 90, height: 16 };

  function drawn(row: Parameters<typeof drawRangeBar>[2]): { text: string[]; stream: string } {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const text: string[] = [];
    const orig = doc.text.bind(doc);
    (doc as unknown as { text: unknown }).text = (t: string, ...rest: unknown[]) => { text.push(String(t)); return (orig as (...a: unknown[]) => unknown)(t, ...rest); };
    drawRangeBar(doc, cell, row, paint);
    return { text, stream: Buffer.from(doc.output('arraybuffer')).toString('latin1') };
  }

  it('an abnormal value carries its letter as text (never colour only); a normal one prints none', () => {
    expect(drawn({ value: 96, bounds: { high: 41 }, state: 'high' }).text).toEqual(['H']);
    expect(drawn({ value: 10, bounds: { low: 12, high: 16 }, state: 'low' }).text).toEqual(['L']);
    expect(drawn({ value: 14, bounds: { low: 12, high: 16 }, state: 'normal' }).text).toEqual([]);
  });
  it('the marker differs in SHAPE too: a circle (curves) when normal, a diamond (straight edges) when not', () => {
    const normal = drawn({ value: 14, bounds: { low: 12, high: 16 }, state: 'normal' }).stream;
    const high = drawn({ value: 18, bounds: { low: 12, high: 16 }, state: 'high' }).stream;
    expect(/ c\n/.test(normal) || normal.includes(' c')).toBe(true);
    expect(high).not.toBe(normal);
  });
  it('draws nothing for a row with a broken band', () => {
    expect(drawn({ value: 5, bounds: { low: 10, high: 10 }, state: 'normal' }).text).toEqual([]);
  });
});
