/**
 * WhatsApp click-to-chat (wa.me) deep-link builder.
 *
 * Used while the Meta WhatsApp Business API isn't wired up yet: clicking
 * "Send WhatsApp" opens WhatsApp Web / the app with the recipient's number
 * and a pre-filled message. Note: wa.me CANNOT attach files — include a
 * link (e.g. the report's QR verify URL) in the text instead.
 */

/** Normalise a stored phone number to wa.me's expected form: digits only,
 *  no leading "+". A bare 10-digit Indian number gets a 91 country code. */
export function normalizeWaPhone(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;       // bare Indian mobile
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;                                          // already has a country code
}

/** Build a wa.me URL. When the phone is missing/invalid, returns the
 *  contact-picker variant so the sender can choose a number. */
export function waLink(phone: string | null | undefined, text: string): string {
  const target = normalizeWaPhone(phone);
  const msg = encodeURIComponent(text);
  return target ? `https://wa.me/${target}?text=${msg}` : `https://wa.me/?text=${msg}`;
}
