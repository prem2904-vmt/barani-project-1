import { CurrencyInrPipe } from './currency-inr.pipe';

describe('CurrencyInrPipe', () => {
  const pipe = new CurrencyInrPipe();

  it('formats positive integers with INR symbol and 2 decimal places', () => {
    expect(pipe.transform(100)).toBe('₹100.00');
    expect(pipe.transform(1000)).toBe('₹1,000.00');
  });

  it('formats positive decimals with proper rounding to 2 places', () => {
    expect(pipe.transform(100.5)).toBe('₹100.50');
    expect(pipe.transform(100.567)).toBe('₹100.57');
    expect(pipe.transform(100.564)).toBe('₹100.56');
  });

  it('formats zero', () => {
    expect(pipe.transform(0)).toBe('₹0.00');
  });

  it('formats negative numbers with minus sign before currency symbol', () => {
    expect(pipe.transform(-100)).toBe('-₹100.00');
    expect(pipe.transform(-1000.5)).toBe('-₹1,000.50');
  });

  it('uses Indian numbering system for large numbers (lakhs, crores)', () => {
    expect(pipe.transform(100000)).toBe('₹1,00,000.00');
    expect(pipe.transform(1000000)).toBe('₹10,00,000.00');
    expect(pipe.transform(10000000)).toBe('₹1,00,00,000.00');
  });

  it('converts string inputs to numbers and formats them', () => {
    expect(pipe.transform('100')).toBe('₹100.00');
    expect(pipe.transform('100.5')).toBe('₹100.50');
    expect(pipe.transform('-50')).toBe('-₹50.00');
  });

  it('returns empty string for null', () => {
    expect(pipe.transform(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(pipe.transform(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(pipe.transform('')).toBe('');
  });

  it('returns empty string for invalid string inputs (NaN)', () => {
    expect(pipe.transform('abc')).toBe('');
    expect(pipe.transform('not a number')).toBe('');
  });

  it('handles very small positive decimals', () => {
    expect(pipe.transform(0.01)).toBe('₹0.01');
    expect(pipe.transform(0.001)).toBe('₹0.00');
  });

  it('handles string inputs with leading zeros', () => {
    expect(pipe.transform('00100')).toBe('₹100.00');
  });

  it('handles very large numbers', () => {
    expect(pipe.transform(999999999)).toBe('₹99,99,99,999.00');
  });
});
