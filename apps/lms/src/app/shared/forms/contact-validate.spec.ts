import { describe, it, expect } from 'vitest';
import {
  hospitalErrors, referralDoctorErrors, validateGstin, validateOrgPhone, vendorErrors, validateContactPersonName,
} from './contact-validate';
import { validatePhoneNumber } from './validate';

describe('OPS-45 contact validation', () => {
  it('person names: letters only, bounded', () => {
    expect(validateContactPersonName('Dr. Priya Krishnan')).toBeNull();
    expect(validateContactPersonName('Dr 9', 'Doctor name')).toMatch(/Doctor name: use letters only/);
    expect(validateContactPersonName('a'.repeat(121))).toMatch(/120/);
  });
  it('org phone: mobile or landline, not junk', () => {
    expect(validateOrgPhone('+91 44 1234 5678')).toBeNull();
    expect(validateOrgPhone('98765 43210')).toBeNull();
    expect(validateOrgPhone('abc')).toMatch(/digits/);
    expect(validateOrgPhone('12345')).toMatch(/8–13/);
  });
  it('gstin', () => {
    expect(validateGstin('33AABCA1234A1Z5')).toBeNull();
    expect(validateGstin('33aabca1234a1z5')).toBeNull();
    expect(validateGstin('123')).toMatch(/15 characters/);
  });
  it('hospital: name required, email format', () => {
    expect(hospitalErrors({ name: '  ' })['name']).toMatch(/required/);
    expect(hospitalErrors({ name: 'Apollo', email: 'x@y' })['email']).toBeTruthy();
    expect(hospitalErrors({ name: 'Apollo', email: 'a@b.com', phone: '+91 44 1234 5678', gstin: '33AABCA1234A1Z5' })).toEqual({});
  });
  it('referral doctor: indian mobile + name letters + email', () => {
    const e = referralDoctorErrors({ name: 'Dr 1', phone: '12345', email: 'bad' }, validatePhoneNumber);
    expect(Object.keys(e).sort()).toEqual(['email', 'name', 'phone']);
    expect(referralDoctorErrors({ name: 'Dr. Priya', phone: '9876543210', email: 'p@a.com' }, validatePhoneNumber)).toEqual({});
  });
  it('vendor: contact name / phone / email / gstin', () => {
    const e = vendorErrors({ name: '', contactName: 'J0hn', contactPhone: 'x', contactEmail: 'no', gstin: '1' });
    expect(Object.keys(e).sort()).toEqual(['contactEmail', 'contactName', 'contactPhone', 'gstin', 'name']);
    expect(vendorErrors({ name: 'Acme Labs 2', contactName: 'John Doe' })).toEqual({});
  });
});
