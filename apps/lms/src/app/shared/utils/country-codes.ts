export interface CountryCode {
  code: string;
  country: string;
  flag: string;
  digitsLength: number;
}

export const COUNTRY_CODES: CountryCode[] = [
  { code: '+91', country: 'India', flag: '🇮🇳', digitsLength: 10 },
  { code: '+1', country: 'USA/Canada', flag: '🇺🇸', digitsLength: 10 },
  { code: '+44', country: 'United Kingdom', flag: '🇬🇧', digitsLength: 10 },
  { code: '+971', country: 'UAE', flag: '🇦🇪', digitsLength: 9 },
  { code: '+966', country: 'Saudi Arabia', flag: '🇸🇦', digitsLength: 9 },
  { code: '+65', country: 'Singapore', flag: '🇸🇬', digitsLength: 8 },
  { code: '+61', country: 'Australia', flag: '🇦🇺', digitsLength: 9 },
  { code: '+60', country: 'Malaysia', flag: '🇲🇾', digitsLength: 9 },
  { code: '+49', country: 'Germany', flag: '🇩🇪', digitsLength: 10 },
  { code: '+33', country: 'France', flag: '🇫🇷', digitsLength: 9 },
  { code: '+81', country: 'Japan', flag: '🇯🇵', digitsLength: 10 },
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
