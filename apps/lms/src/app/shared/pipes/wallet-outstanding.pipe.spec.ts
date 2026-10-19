import { WalletOutstandingPipe } from './wallet-outstanding.pipe';

describe('WalletOutstandingPipe', () => {
  const pipe = new WalletOutstandingPipe();

  it('formats positive balance as due', () => {
    expect(pipe.transform(500)).toBe('₹500.00 due');
    expect(pipe.transform(1000)).toBe('₹1,000.00 due');
    expect(pipe.transform(50)).toBe('₹50.00 due');
  });

  it('formats negative balance as in credit', () => {
    expect(pipe.transform(-200)).toBe('₹200.00 in credit');
    expect(pipe.transform(-1500)).toBe('₹1,500.00 in credit');
    expect(pipe.transform(-75.50)).toBe('₹75.50 in credit');
  });

  it('returns Settled for zero or near-zero balance', () => {
    expect(pipe.transform(0)).toBe('Settled');
    expect(pipe.transform(0.001)).toBe('Settled');
    expect(pipe.transform(0.004)).toBe('Settled');
    expect(pipe.transform(-0.001)).toBe('Settled');
    expect(pipe.transform(-0.004)).toBe('Settled');
  });

  it('rounds above 0.005 threshold to due', () => {
    expect(pipe.transform(0.005)).toBe('₹0.01 due');
    expect(pipe.transform(0.01)).toBe('₹0.01 due');
  });

  it('rounds below -0.005 threshold to credit', () => {
    expect(pipe.transform(-0.005)).toBe('₹0.01 in credit');
    expect(pipe.transform(-0.01)).toBe('₹0.01 in credit');
  });

  it('handles null and undefined as zero (Settled)', () => {
    expect(pipe.transform(null)).toBe('Settled');
    expect(pipe.transform(undefined)).toBe('Settled');
  });

  it('formats large numbers with Indian locale grouping', () => {
    expect(pipe.transform(1000000)).toBe('₹10,00,000.00 due');
    expect(pipe.transform(12345.67)).toBe('₹12,345.67 due');
    expect(pipe.transform(-99999)).toBe('₹99,999.00 in credit');
  });

  it('preserves decimal precision up to two places', () => {
    expect(pipe.transform(100.50)).toBe('₹100.50 due');
    expect(pipe.transform(250.33)).toBe('₹250.33 due');
    expect(pipe.transform(-333.99)).toBe('₹333.99 in credit');
  });

  it('rounds decimals beyond two places', () => {
    expect(pipe.transform(100.506)).toBe('₹100.51 due');
    expect(pipe.transform(100.504)).toBe('₹100.50 due');
    expect(pipe.transform(-200.999)).toBe('₹201.00 in credit');
  });

  it('formats fractional amounts below one rupee', () => {
    expect(pipe.transform(0.50)).toBe('₹0.50 due');
    expect(pipe.transform(-0.50)).toBe('₹0.50 in credit');
  });

  it('uses currency symbol and format for all due and credit amounts', () => {
    const result = pipe.transform(123.45);
    expect(result).toContain('₹');
    expect(result).toContain('due');
    expect(result).not.toContain('$');
  });

  it('uses currency symbol and format for all credit amounts', () => {
    const result = pipe.transform(-123.45);
    expect(result).toContain('₹');
    expect(result).toContain('in credit');
  });

  it('preserves sign for boundary values exactly at thresholds', () => {
    const settled = pipe.transform(0.0045);
    const due = pipe.transform(0.006);
    const credit = pipe.transform(-0.006);
    expect(settled).toBe('Settled');
    expect(due).toContain('due');
    expect(credit).toContain('in credit');
  });
});
