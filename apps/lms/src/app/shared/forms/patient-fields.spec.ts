import { describe, it, expect } from 'vitest';
import {
  AGE_LIMITS, dobFromAge, identityKind, isContactNumberField, validateAadhaar, validateAadhaarLast4,
  validateAbhaNumber, validateAge, validateEmail, verhoeffValid, isPersonNameField, validatePersonName,
} from './patient-fields';
import { validateFieldValue } from './validate';

/** QA #2 (2026-09-27): registration field rules. */
describe('patient-fields — phone (validateFieldValue, per country)', () => {
  const phone = { type: 'phone', name: 'phone' };
  it('+91: exactly 10 digits starting 6–9', () => {
    expect(validateFieldValue(phone, '+919876543210')).toBeNull();
    expect(validateFieldValue(phone, '+916000000000')).toBeNull();
    expect(validateFieldValue(phone, '+91987654321')).toMatch(/10-digit/);     // 9
    expect(validateFieldValue(phone, '+9198765432101')).toMatch(/10-digit/);   // 11
    expect(validateFieldValue(phone, '+915876543210')).toMatch(/6, 7, 8, or 9/);
  });
  it('other countries are rejected — Indian mobiles only (server IndianPhone)', () => {
    expect(validateFieldValue(phone, '+6581234567')).not.toBeNull();
    expect(validateFieldValue(phone, '+971501234567')).not.toBeNull();
    expect(validateFieldValue(phone, '+12025550123')).not.toBeNull();
  });
  it('an OPTIONAL additional contact (a number field) may be empty, but is checked like a phone when filled', () => {
    const extra = { type: 'number', name: 'additional_contact', title: 'Additional contact' };
    expect(isContactNumberField(extra)).toBe(true);
    expect(validateFieldValue(extra, '')).toBeNull();
    expect(validateFieldValue(extra, null)).toBeNull();
    expect(validateFieldValue(extra, '+919876543210')).toBeNull();
    expect(validateFieldValue(extra, '+9112345')).not.toBeNull();
  });
  it('a plain number field is NOT treated as a phone', () => {
    expect(isContactNumberField({ type: 'number', name: 'weight', title: 'Weight' })).toBe(false);
    expect(validateFieldValue({ type: 'number', name: 'weight' }, 12345)).toBeNull();
  });
});

describe('patient-fields — ABHA number', () => {
  it('14 digits (grouped or raw) passes', () => {
    expect(validateAbhaNumber('12345678901234')).toBeNull();
    expect(validateAbhaNumber('12-3456-7890-1234')).toBeNull();
    expect(validateAbhaNumber('')).toBeNull();
  });
  it('too few / too many digits → error with the count', () => {
    expect(validateAbhaNumber('1234567890')).toBe('ABHA number must be 14 digits (10 entered)');
    expect(validateAbhaNumber('123456789012345')).toMatch(/14 digits/);
  });
  it('an ABHA address is not an ABHA number (the field is digits-only)', () => {
    expect(validateAbhaNumber('ravi@abdm')).toMatch(/14 digits/);
  });
  it('validateFieldValue applies it to the abha_id text field', () => {
    const f = { type: 'text', name: 'abha_id' };
    expect(validateFieldValue(f, '123')).toMatch(/14 digits/);
    expect(validateFieldValue(f, '12345678901234')).toBeNull();
    expect(validateFieldValue(f, '')).toBeNull();
  });
});

describe('patient-fields — Aadhaar', () => {
  it('Verhoeff: known-good numbers pass, a changed digit fails', () => {
    expect(verhoeffValid('234567890124')).toBe(true);
    expect(verhoeffValid('987654321096')).toBe(true);
    expect(verhoeffValid('234567890125')).toBe(false);
    expect(verhoeffValid('abc')).toBe(false);
  });
  it('12 digits + checksum; formatted input accepted', () => {
    expect(validateAadhaar('234567890124')).toBeNull();
    expect(validateAadhaar('2345 6789 0124')).toBeNull();
    expect(validateAadhaar('')).toBeNull();
  });
  it('too few digits → error with the count; bad checksum / leading 0-1 → error', () => {
    expect(validateAadhaar('23456789')).toBe('Aadhaar must be 12 digits (8 entered)');
    expect(validateAadhaar('234567890125')).toMatch(/check the digits/);
    expect(validateAadhaar('123456789012')).toMatch(/cannot start with 0 or 1/);
  });
  it('last-4 field: exactly 4 digits', () => {
    expect(validateAadhaarLast4('1234')).toBeNull();
    expect(validateAadhaarLast4('123')).toMatch(/last 4/);
    expect(validateAadhaarLast4('12a4')).toMatch(/last 4/);
    expect(validateFieldValue({ type: 'text', name: 'aadhaar_last4' }, '12')).toMatch(/last 4/);
    expect(validateFieldValue({ type: 'text', name: 'aadhaar' }, '23456789')).toMatch(/12 digits/);
  });
  it('identityKind recognises only TEXT fields by name', () => {
    expect(identityKind({ type: 'text', name: 'abha_id' })).toBe('abha');
    expect(identityKind({ type: 'text', name: 'aadhaar' })).toBe('aadhaar');
    expect(identityKind({ type: 'text', name: 'aadhaar_last4' })).toBe('aadhaar_last4');
    expect(identityKind({ type: 'text', name: 'first_name' })).toBeNull();
    expect(identityKind({ type: 'number', name: 'abha_id' })).toBeNull();
  });
});

describe('patient-fields — email', () => {
  it('optional: empty passes; a well-formed address passes', () => {
    expect(validateEmail('')).toBeNull();
    expect(validateEmail('ravi@example.com')).toBeNull();
    expect(validateEmail('a.b+lab@mail.co.in')).toBeNull();
  });
  it('malformed → error', () => {
    for (const bad of ['ravi', 'ravi@', '@x.com', 'ravi@example', 'ra vi@x.com', 'a@@b.com', 'a@b..com']) {
      expect(validateEmail(bad), bad).toMatch(/valid email/);
    }
  });
  it('validateFieldValue applies it to email fields', () => {
    expect(validateFieldValue({ type: 'email', name: 'email' }, 'nope')).toMatch(/valid email/);
    expect(validateFieldValue({ type: 'email', name: 'email' }, '')).toBeNull();
  });
});

describe('patient-fields — age', () => {
  it('limits: Yrs 0–150, Mo 0–1199, Days 0–365', () => {
    expect(AGE_LIMITS).toEqual({ years: 150, months: 1199, days: 365 });
    expect(validateAge(0, 'years')).toBeNull();
    expect(validateAge(150, 'years')).toBeNull();
    expect(validateAge(151, 'years')).toMatch(/0–150 years/);
    expect(validateAge(1199, 'months')).toBeNull();
    expect(validateAge(1200, 'months')).toMatch(/0–1199/);
    expect(validateAge(365, 'days')).toBeNull();
    expect(validateAge(366, 'days')).toMatch(/0–365/);
    expect(validateAge(-1, 'years')).toMatch(/whole number/);
    expect(validateAge(1.5, 'years')).toMatch(/whole number/);
    expect(validateAge(null, 'years')).toBeNull();
  });
  it('dobFromAge is a LOCAL calendar date (no UTC day shift)', () => {
    const now = new Date(2026, 8, 27, 1, 30);   // 01:30 local — UTC would still be the 26th in IST
    expect(dobFromAge(40, 'years', now)).toBe('1986-09-27');
    expect(dobFromAge(3, 'months', now)).toBe('2026-06-27');
    expect(dobFromAge(10, 'days', now)).toBe('2026-09-17');
  });
});

describe('OPS-30 person-name fields', () => {
  it('accepts letters of any script, spaces and . \' -', () => {
    for (const n of ['Prem', 'Mary-Ann', "O'Neil", 'Dr. K R', 'அருண்', 'José', 'Müller'])
      expect(validatePersonName(n), n).toBeNull();
    expect(validatePersonName('')).toBeNull();
  });
  it('rejects digits and symbols', () => {
    for (const n of ['Prem1', '123', 'a@b', 'x_y', '-Prem', '#'])
      expect(validatePersonName(n), n).toMatch(/letters only/);
  });
  it('applies to the core name fields only, not custom text', () => {
    expect(isPersonNameField({ type: 'text', name: 'first_name' })).toBe(true);
    expect(isPersonNameField({ type: 'text', name: 'guardian_name' })).toBe(true);
    expect(isPersonNameField({ type: 'text', name: 'barcode' })).toBe(false);
    expect(validateFieldValue({ type: 'text', name: 'first_name' }, 'Ab3')).toMatch(/letters only/);
    expect(validateFieldValue({ type: 'text', name: 'occupation' }, 'Teacher')).toBeNull();
    expect(validateFieldValue({ type: 'text', name: 'custom_note' }, 'Ab3 #1')).toBeNull();
  });
});
