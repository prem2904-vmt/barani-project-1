/**
 * THE phone rule — TS mirror of the server's IndianPhone
 * (prefrontal-mw Prefrontal/Services/IndianPhone.cs). Keep them in step.
 *
 * A person's phone is an Indian mobile, stored `+91` + 10 digits starting
 * 6–9 (`+919876543210`). Accepted input: `9876543210`, `09876543210`,
 * `919876543210`, `+91 98765-43210`, `(+91) 98765 43210`, `0091…` — digits
 * with spaces, dashes, dots and brackets. Another country's code, letters,
 * or anything that isn't 10 digits (starting 6–9) after the 91 / 0 prefix
 * is invalid. Searches compare the LAST 10 DIGITS, whatever was typed.
 */

export const INDIAN_PHONE_INVALID_MESSAGE =
  'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9';

/** The 10 national digits (starting 6–9), or null when invalid / empty. */
export function indianNational(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s || !/^[0-9 ().+\- ]+$/.test(s)) return null;
  const plusCount = (s.match(/\+/g) ?? []).length;
  if (plusCount > 1 || (plusCount === 1 && !s.replace(/^[( ]+/, '').startsWith('+'))) return null;
  let d = s.replace(/\D/g, '');
  const international = plusCount === 1 || d.startsWith('00');
  if (d.startsWith('00')) d = d.slice(2);                            // 0091…
  if (international && !d.startsWith('91')) return null;             // +65…, +1…
  if (d.length === 13 && d.startsWith('910')) d = d.slice(3);        // +91 0XXXXXXXXXX
  else if (d.length === 12 && d.startsWith('91')) d = d.slice(2);    // 91XXXXXXXXXX
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);     // trunk 0
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

/** The stored form `+91XXXXXXXXXX`; null when invalid or empty. */
export function normalizeIndianPhone(raw: string | null | undefined): string | null {
  const n = indianNational(raw);
  return n ? `+91${n}` : null;
}

/** Validation message for a non-empty invalid value; null when valid or empty. */
export function indianPhoneError(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  return indianNational(s) ? null : INDIAN_PHONE_INVALID_MESSAGE;
}

/** What a phone SEARCH compares: the last 10 digits (fewer when fewer were
 *  typed); '' when there are no digits. */
export function phoneLast10(raw: string | null | undefined): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

/** Does a stored phone match what was typed? 10+ typed digits → same last 10
 *  digits (so 9876543210, 09876543210 and +91 98765-43210 all find
 *  +919876543210); fewer → the typed digits appear in the stored number
 *  (partial search), with at least `minDigits` typed. */
export function phoneMatches(stored: string | null | undefined, query: string | null | undefined, minDigits = 3): boolean {
  const q = String(query ?? '').replace(/\D/g, '');
  if (q.length < minDigits) return false;
  const s = String(stored ?? '').replace(/\D/g, '');
  if (!s) return false;
  return q.length >= 10 ? phoneLast10(s) === phoneLast10(q) : s.includes(q);
}

/** The WhatsApp recipient `91XXXXXXXXXX` (no "+"); '' when invalid. */
export function whatsAppPhone(raw: string | null | undefined): string {
  const n = indianNational(raw);
  return n ? `91${n}` : '';
}
