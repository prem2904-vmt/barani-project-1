import { upiLink, isLikelyVpa } from './upi';

describe('upiLink', () => {
  it('builds a minimal UPI link with VPA only', () => {
    const link = upiLink('user@okhdfcbank');
    expect(link).toBe('upi://pay?pa=user%40okhdfcbank&cu=INR');
  });

  it('includes payee name when provided and non-empty', () => {
    const link = upiLink('user@okhdfcbank', 'John Doe');
    expect(link).toBe('upi://pay?pa=user%40okhdfcbank&pn=John+Doe&cu=INR');
  });

  it('omits payee name when null or empty string', () => {
    expect(upiLink('user@okhdfcbank', null)).toBe('upi://pay?pa=user%40okhdfcbank&cu=INR');
    expect(upiLink('user@okhdfcbank', '')).toBe('upi://pay?pa=user%40okhdfcbank&cu=INR');
  });

  it('includes amount formatted to 2 decimal places', () => {
    const link = upiLink('user@okhdfcbank', null, 500);
    expect(link).toContain('am=500.00');
  });

  it('formats whole amounts with .00 suffix', () => {
    const link = upiLink('user@okhdfcbank', null, 1000);
    expect(link).toContain('am=1000.00');
  });

  it('rounds amount to 2 decimal places', () => {
    const link = upiLink('user@okhdfcbank', null, 99.999);
    expect(link).toContain('am=100.00');
  });

  it('omits amount when null or zero or negative', () => {
    expect(upiLink('user@okhdfcbank', null, null)).not.toContain('am=');
    expect(upiLink('user@okhdfcbank', null, 0)).not.toContain('am=');
    expect(upiLink('user@okhdfcbank', null, -50)).not.toContain('am=');
  });

  it('includes note when provided and non-empty', () => {
    const link = upiLink('user@okhdfcbank', null, null, 'Monthly subscription');
    expect(link).toContain('tn=Monthly+subscription');
  });

  it('omits note when null or empty string', () => {
    expect(upiLink('user@okhdfcbank', null, null, null)).not.toContain('tn=');
    expect(upiLink('user@okhdfcbank', null, null, '')).not.toContain('tn=');
  });

  it('encodes special characters in VPA, name, and note', () => {
    const link = upiLink('user+tag@okhdfcbank', 'Alice & Bob', 100, 'Pay for A&B #2');
    // URLSearchParams encodes @ as %40, & as %26, + as %2B or +, # as %23
    expect(link).toContain('pa=user%2Btag%40okhdfcbank');
    expect(link).toContain('pn=Alice+%26+Bob');
    expect(link).toContain('tn=Pay+for+A%26B+%232');
  });

  it('trims leading/trailing whitespace from VPA, name, and note', () => {
    const link = upiLink('  user@okhdfcbank  ', '  John Doe  ', 100, '  rent  ');
    expect(link).toContain('pa=user%40okhdfcbank');
    expect(link).toContain('pn=John+Doe');
    expect(link).toContain('tn=rent');
  });

  it('always includes currency as INR', () => {
    expect(upiLink('user@okhdfcbank')).toContain('cu=INR');
    expect(upiLink('user@okhdfcbank', 'John', 500, 'note')).toContain('cu=INR');
  });

  it('builds a complete link with all parameters', () => {
    const link = upiLink('user@okhdfcbank', 'Alice Smith', 250.50, 'Payment for services');
    expect(link).toBe('upi://pay?pa=user%40okhdfcbank&pn=Alice+Smith&am=250.50&tn=Payment+for+services&cu=INR');
  });
});

describe('isLikelyVpa', () => {
  it('accepts valid VPA handles', () => {
    expect(isLikelyVpa('user@okhdfcbank')).toBe(true);
    expect(isLikelyVpa('john.doe@ybl')).toBe(true);
    expect(isLikelyVpa('test-123@upi')).toBe(true);
  });

  it('accepts VPA with numbers and special chars (dot, dash, underscore) in handle', () => {
    expect(isLikelyVpa('alice_123@googlepay')).toBe(true);
    expect(isLikelyVpa('a.b.c@paytm')).toBe(true);
    expect(isLikelyVpa('x-y_z@bank123')).toBe(true);
  });

  it('rejects VPA with invalid characters', () => {
    expect(isLikelyVpa('user#name@bank')).toBe(false);
    expect(isLikelyVpa('user@bank$')).toBe(false);
    expect(isLikelyVpa('user name@bank')).toBe(false);
  });

  it('rejects VPA without @ symbol or missing parts', () => {
    expect(isLikelyVpa('userbank')).toBe(false);
    expect(isLikelyVpa('@bank')).toBe(false);
    expect(isLikelyVpa('user@')).toBe(false);
  });

  it('rejects VPA with too-short handle or domain', () => {
    expect(isLikelyVpa('a@bank')).toBe(false);
    expect(isLikelyVpa('user@b')).toBe(false);
  });

  it('rejects null and undefined VPA', () => {
    expect(isLikelyVpa(null)).toBe(false);
    expect(isLikelyVpa(undefined)).toBe(false);
  });

  it('rejects empty or whitespace-only VPA', () => {
    expect(isLikelyVpa('')).toBe(false);
    expect(isLikelyVpa('   ')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isLikelyVpa('User@OkhdfcBank')).toBe(true);
    expect(isLikelyVpa('ALICE@YBL')).toBe(true);
  });
});
