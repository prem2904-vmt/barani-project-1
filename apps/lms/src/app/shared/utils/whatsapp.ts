/**
 * WhatsApp click-to-chat (wa.me) deep-link builder.
 *
 * Used while the Meta WhatsApp Business API isn't wired up yet: clicking
 * "Send WhatsApp" opens WhatsApp Web / the app with the recipient's number
 * and a pre-filled message. Note: wa.me CANNOT attach files — include a
 * link (e.g. the report's QR verify URL) in the text instead.
 */

import { whatsAppPhone } from './indian-phone';

/** The wa.me recipient: 91 + the 10-digit Indian mobile, no "+" — the one
 *  phone rule (indian-phone.ts, mirror of the server's IndianPhone). '' when
 *  the number isn't a valid Indian mobile (the link then opens the picker). */
export function normalizeWaPhone(phone: string | null | undefined): string {
  return whatsAppPhone(phone);
}

/** Build a wa.me URL. When the phone is missing/invalid, returns the
 *  contact-picker variant so the sender can choose a number. */
export function waLink(phone: string | null | undefined, text: string): string {
  const target = normalizeWaPhone(phone);
  const msg = encodeURIComponent(text);
  return target ? `https://wa.me/${target}?text=${msg}` : `https://wa.me/?text=${msg}`;
}
