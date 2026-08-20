import { normalizeWaPhone, waLink } from './whatsapp';

describe('normalizeWaPhone', () => {
  it('strips non-digit characters from the input', () => {
    expect(normalizeWaPhone('+91-9876543210')).toBe('919876543210');
    expect(normalizeWaPhone('91 9876 5432 10')).toBe('919876543210');
    expect(normalizeWaPhone('+1(555)123-4567')).toBe('15551234567');
  });

  it('converts bare 10-digit Indian mobile to 91 country code', () => {
    expect(normalizeWaPhone('9876543210')).toBe('919876543210');
    expect(normalizeWaPhone('9000000000')).toBe('919000000000');
  });

  it('converts 11-digit number starting with 0 to 91 prefix (removing leading 0)', () => {
    expect(normalizeWaPhone('09876543210')).toBe('919876543210');
    expect(normalizeWaPhone('01234567890')).toBe('911234567890');
  });

  it('passes through digits that already have country code', () => {
    expect(normalizeWaPhone('919876543210')).toBe('919876543210');
    expect(normalizeWaPhone('15551234567')).toBe('15551234567');
    expect(normalizeWaPhone('447700900123')).toBe('447700900123');
  });

  it('returns empty string when input is null or undefined', () => {
    expect(normalizeWaPhone(null)).toBe('');
    expect(normalizeWaPhone(undefined)).toBe('');
  });

  it('returns empty string when input contains no digits', () => {
    expect(normalizeWaPhone('')).toBe('');
    expect(normalizeWaPhone('+-() ')).toBe('');
    expect(normalizeWaPhone('abc xyz')).toBe('');
  });

  it('handles edge case of single leading 0 with 10 other digits', () => {
    expect(normalizeWaPhone('09999999999')).toBe('919999999999');
  });
});

describe('waLink', () => {
  it('builds wa.me URL with country code when phone is valid', () => {
    expect(waLink('9876543210', 'Hello'))
      .toBe('https://wa.me/919876543210?text=Hello');
    expect(waLink('+91-9876543210', 'Test message'))
      .toBe('https://wa.me/919876543210?text=Test%20message');
  });

  it('URL-encodes the message text', () => {
    expect(waLink('9876543210', 'Hello World'))
      .toBe('https://wa.me/919876543210?text=Hello%20World');
    expect(waLink('9876543210', 'Special chars: @#$%'))
      .toContain('text=');
  });

  it('returns contact-picker variant when phone is null', () => {
    expect(waLink(null, 'Pick a contact'))
      .toBe('https://wa.me/?text=Pick%20a%20contact');
  });

  it('returns contact-picker variant when phone is undefined', () => {
    expect(waLink(undefined, 'Please choose'))
      .toBe('https://wa.me/?text=Please%20choose');
  });

  it('returns contact-picker variant when phone contains no digits', () => {
    expect(waLink('+-() ', 'Invalid phone'))
      .toBe('https://wa.me/?text=Invalid%20phone');
  });

  it('encodes ampersand and equals in message', () => {
    const result = waLink('9876543210', 'a=b&c=d');
    expect(result).toContain('text=a%3Db%26c%3Dd');
  });

  it('handles empty message text', () => {
    expect(waLink('9876543210', ''))
      .toBe('https://wa.me/919876543210?text=');
  });

  it('preserves normalized phone with various formats', () => {
    // All these should normalize to the same phone
    const msg = 'Test';
    const formats = [
      '09876543210',
      '+91-9876543210',
      '91 9876 5432 10',
      '919876543210'
    ];
    formats.forEach(fmt => {
      const url = waLink(fmt, msg);
      expect(url).toContain('https://wa.me/919876543210?text=Test');
    });
  });

  it('handles international numbers in the URL', () => {
    expect(waLink('15551234567', 'US number'))
      .toBe('https://wa.me/15551234567?text=US%20number');
    expect(waLink('447700900123', 'UK number'))
      .toBe('https://wa.me/447700900123?text=UK%20number');
  });
});
