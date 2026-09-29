export interface CountryCode {
  code: string;
  country: string;
  flag: string;
  digitsLength: number;
}

/** Staff phones follow the same rule as patients (server IndianPhone):
 *  Indian mobiles only, so the dialling-code picker offers +91 alone. */
export const COUNTRY_CODES: CountryCode[] = [
  { code: '+91', country: 'India', flag: '🇮🇳', digitsLength: 10 },
];

export function getCountryDigitLength(code: string): number {
  const c = COUNTRY_CODES.find(x => x.code === code);
  return c ? c.digitsLength : 10;
}

export function parsePhoneNumber(raw: string | undefined | null): { code: string; digits: string } {
  if (!raw) return { code: '+91', digits: '' };
  const trimmed = raw.trim();
  const matched = COUNTRY_CODES.find(c => trimmed.startsWith(c.code));
  if (matched) {
    const digits = trimmed.substring(matched.code.length).replace(/\D/g, '');
    return { code: matched.code, digits };
  }
  if (trimmed.startsWith('+')) {
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx > 0) {
      return {
        code: trimmed.substring(0, spaceIdx),
        digits: trimmed.substring(spaceIdx).replace(/\D/g, '')
      };
    }
  }
  return { code: '+91', digits: trimmed.replace(/\D/g, '') };
}
