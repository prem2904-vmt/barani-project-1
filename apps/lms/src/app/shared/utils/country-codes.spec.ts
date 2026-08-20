import { describe, it, expect } from 'vitest';
import { COUNTRY_CODES, CountryCode, getCountryDigitLength, parsePhoneNumber } from './country-codes';

describe('country-codes', () => {
  describe('COUNTRY_CODES', () => {
    it('exports an array of country code objects', () => {
      expect(Array.isArray(COUNTRY_CODES)).toBe(true);
      expect(COUNTRY_CODES.length).toBeGreaterThan(0);
    });

    it('has expected length and structure', () => {
      expect(COUNTRY_CODES.length).toBe(11);
      COUNTRY_CODES.forEach((cc) => {
        expect(cc).toHaveProperty('code');
        expect(cc).toHaveProperty('country');
        expect(cc).toHaveProperty('flag');
        expect(cc).toHaveProperty('digitsLength');
      });
    });

    it('includes India with +91 dial code', () => {
      const india = COUNTRY_CODES.find(c => c.code === '+91');
      expect(india).toBeDefined();
      expect(india?.country).toBe('India');
      expect(india?.digitsLength).toBe(10);
    });

    it('has all codes starting with plus sign', () => {
      COUNTRY_CODES.forEach((cc) => {
        expect(cc.code).toMatch(/^\+/);
      });
    });

    it('has no duplicate dial codes', () => {
      const codes = COUNTRY_CODES.map(c => c.code);
      const unique = new Set(codes);
      expect(unique.size).toBe(codes.length);
    });

    it('has reasonable digit lengths (8–10)', () => {
      COUNTRY_CODES.forEach((cc) => {
        expect(cc.digitsLength).toBeGreaterThanOrEqual(8);
        expect(cc.digitsLength).toBeLessThanOrEqual(10);
      });
    });
  });

  describe('getCountryDigitLength', () => {
    it('returns correct digit length for known country code', () => {
      expect(getCountryDigitLength('+91')).toBe(10); // India
      expect(getCountryDigitLength('+1')).toBe(10);  // USA/Canada
      expect(getCountryDigitLength('+65')).toBe(8);  // Singapore
      expect(getCountryDigitLength('+971')).toBe(9); // UAE
    });

    it('returns default 10 for unknown country code', () => {
      expect(getCountryDigitLength('+999')).toBe(10);
      expect(getCountryDigitLength('+0')).toBe(10);
      expect(getCountryDigitLength('invalid')).toBe(10);
    });

    it('returns default 10 for empty string', () => {
      expect(getCountryDigitLength('')).toBe(10);
    });
  });

  describe('parsePhoneNumber', () => {
    it('returns default India code for null or undefined input', () => {
      expect(parsePhoneNumber(null)).toEqual({ code: '+91', digits: '' });
      expect(parsePhoneNumber(undefined)).toEqual({ code: '+91', digits: '' });
    });

    it('parses known country code with digits', () => {
      const result = parsePhoneNumber('+91 9876543210');
      expect(result.code).toBe('+91');
      expect(result.digits).toBe('9876543210');
    });

    it('strips non-digit characters from the digit part', () => {
      const result = parsePhoneNumber('+1 (555) 123-4567');
      expect(result.code).toBe('+1');
      expect(result.digits).toBe('5551234567');
    });

    it('handles unmatched country code with space-separated format', () => {
      const result = parsePhoneNumber('+999 1234567890');
      expect(result.code).toBe('+999');
      expect(result.digits).toBe('1234567890');
    });

    it('defaults to India code for plain digits (no plus or space)', () => {
      const result = parsePhoneNumber('9876543210');
      expect(result.code).toBe('+91');
      expect(result.digits).toBe('9876543210');
    });

    it('trims whitespace and handles multiple country codes by longest match', () => {
      const result = parsePhoneNumber('  +971  50123456  ');
      expect(result.code).toBe('+971');
      expect(result.digits).toBe('50123456');
    });
  });
});
