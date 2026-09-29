import {
  INDIAN_PHONE_INVALID_MESSAGE, indianPhoneError, normalizeIndianPhone, phoneLast10, phoneMatches, whatsAppPhone,
} from './indian-phone';

describe('indian-phone (mirror of the server IndianPhone)', () => {
  it.each([
    '9876543210', '09876543210', '919876543210', '+919876543210', '+91 98765-43210',
    '(+91) 98765 43210', '+91-98765-43210', '0091 98765 43210', '+91 09876543210', ' 98765.43210 ',
  ])('normalises %s to +919876543210', raw => {
    expect(normalizeIndianPhone(raw)).toBe('+919876543210');
    expect(indianPhoneError(raw)).toBeNull();
  });

  it.each([
    '5876543210', '987654321', '98765432101', '+9198765432101', '+1 202 555 0123', '+6581234567',
    '0065 81234567', '98765abc10', '98+76543210', '12345',
  ])('rejects %s with the one message', raw => {
    expect(normalizeIndianPhone(raw)).toBeNull();
    expect(indianPhoneError(raw)).toBe(INDIAN_PHONE_INVALID_MESSAGE);
  });

  it('blank is not an error (the form decides mandatory)', () => {
    expect(indianPhoneError('')).toBeNull();
    expect(indianPhoneError(null)).toBeNull();
    expect(normalizeIndianPhone('  ')).toBeNull();
  });

  it('search compares the last 10 digits whatever the format', () => {
    expect(phoneLast10('+919876543210')).toBe('9876543210');
    expect(phoneMatches('+919876543210', '9876543210')).toBe(true);
    expect(phoneMatches('+919876543210', '09876543210')).toBe(true);
    expect(phoneMatches('+919876543210', '+91 98765-43210')).toBe(true);
    expect(phoneMatches('9876543210', '919876543210')).toBe(true);     // legacy bare stored value
    expect(phoneMatches('+919876543210', '9876543211')).toBe(false);
  });

  it('partial numbers still substring-match (3+ digits)', () => {
    expect(phoneMatches('+919876543210', '54321')).toBe(true);
    expect(phoneMatches('+919876543210', '98')).toBe(false);
    expect(phoneMatches(null, '98765')).toBe(false);
  });

  it('WhatsApp gets 91 + ten digits, or nothing', () => {
    expect(whatsAppPhone('+919876543210')).toBe('919876543210');
    expect(whatsAppPhone('9876543210')).toBe('919876543210');
    expect(whatsAppPhone('+1 555 123 4567')).toBe('');
  });
});
