/**
 * "Send on WhatsApp" — the MANUAL flow (every lab, no WhatsApp Business
 * account needed). ONE home for its URL, message and window rules.
 *
 * Hard lines (legal / WhatsApp terms — pinned by whatsapp-manual.spec.ts and
 * electron/test/whatsapp-dock.test.js):
 *   - Only WhatsApp's official click-to-chat link is ever opened:
 *     `https://web.whatsapp.com/send?phone=<digits>&text=<encoded>`
 *     (or `whatsapp://send?…` / `wa.me` for the WhatsApp app). Nothing else.
 *   - NOTHING inside WhatsApp is automated: no script in its page, no reading
 *     it, no pressing Send, no attaching files, no bulk sending. The person
 *     checks the message and presses Send in WhatsApp themselves.
 *
 * The desktop app shows WhatsApp Web docked on the right (electron/
 * whatsapp-dock.js); a browser opens it as a narrow phone-shaped window at
 * the right edge of the screen (WhatsApp refuses to be framed, and we never
 * work around that).
 */

import { indianNational } from './indian-phone';

/** The only page the manual flow opens on the web / desktop. */
export const WA_WEB_SEND = 'https://web.whatsapp.com/send';
/** The ONE named browser window repeat clicks reuse. */
export const WA_POPUP_NAME = 'pf-whatsapp';
/** Phone-shaped: about as wide as a phone, the full height of the screen. */
export const WA_POPUP_WIDTH = 420;

/** The message, editable per lab later — keep it here and only here.
 *  `{patient}`, `{lab}` and `{link}` are filled by `waReportMessage`. */
export const WA_REPORT_TEMPLATE = 'Dear {patient}, your report from {lab} is ready. View it here: {link}';

/** E.164 for a patient's mobile: `+91` + the 10 digits (the one phone rule,
 *  indian-phone.ts — a bare 10-digit number is Indian). null when invalid. */
export function waE164(raw: string | null | undefined): string | null {
  const n = indianNational(raw);
  return n ? `+91${n}` : null;
}

/** `+91 98765 43210` — for the confirm, never for the link. */
export function waDisplayPhone(e164: string): string {
  const d = e164.replace(/\D/g, '');
  return d.length === 12 ? `+${d.slice(0, 2)} ${d.slice(2, 7)} ${d.slice(7)}` : e164;
}

/** The click-to-chat link for WhatsApp Web; null when the phone is invalid
 *  (the caller says so plainly and opens nothing). */
export function waClickToChatUrl(phone: string | null | undefined, text: string): string | null {
  const e164 = waE164(phone);
  if (!e164) return null;
  return `${WA_WEB_SEND}?phone=${e164.slice(1)}&text=${encodeURIComponent(text ?? '')}`;
}

/** The same chat in the WhatsApp app on a phone (wa.me hands over to it). */
export function waMeUrl(phone: string | null | undefined, text: string): string | null {
  const e164 = waE164(phone);
  if (!e164) return null;
  return `https://wa.me/${e164.slice(1)}?text=${encodeURIComponent(text ?? '')}`;
}

/** Is this EXACTLY a click-to-chat link (and nothing more)? https,
 *  web.whatsapp.com, /send, only `phone` (8–15 digits) and `text`. Mirrored
 *  in main (electron/whatsapp-dock.js `parseClickToChat`). */
export function isClickToChatUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.hostname !== 'web.whatsapp.com' || u.port || u.username || u.password || u.hash) return false;
  if (u.pathname !== '/send') return false;
  const keys = [...u.searchParams.keys()];
  if (keys.some(k => k !== 'phone' && k !== 'text') || new Set(keys).size !== keys.length) return false;
  return /^\d{8,15}$/.test(u.searchParams.get('phone') ?? '');
}

/** The public, identity-checked report page (`/reports/public/{token}`). */
export function reportPublicLink(base: string | null | undefined, qrToken: string | null | undefined): string {
  const b = (base ?? '').replace(/\/+$/, '');
  return b && qrToken ? `${b}/reports/public/${encodeURIComponent(qrToken)}` : '';
}

/** "Dear Asha, your report from Micro World is ready. View it here: <link>".
 *  No name → "Dear patient"; no link → the sentence ends at "ready."; extra
 *  lines (an outside lab's report) follow on their own paragraph. */
export function waReportMessage(p: { patient?: string | null; lab?: string | null; link?: string | null; extra?: (string | null | undefined)[] }): string {
  const patient = (p.patient ?? '').trim() || 'patient';
  const lab = (p.lab ?? '').trim() || 'our lab';
  const link = (p.link ?? '').trim();
  let text = WA_REPORT_TEMPLATE.replace('{patient}', patient).replace('{lab}', lab);
  text = link ? text.replace('{link}', link) : text.replace(/ View it here: \{link\}$/, '');
  const extra = (p.extra ?? []).map(s => (s ?? '').trim()).filter(Boolean);
  return [text, ...extra].join('\n\n');
}

/** The part of `window.screen` the popup placement reads. */
export interface WaScreen {
  availWidth: number;
  availHeight: number;
  availLeft?: number;
  availTop?: number;
}

/** Where the phone-shaped window goes: the right edge of the screen this
 *  window is on, full available height. */
export function waPopupRect(s: WaScreen): { width: number; height: number; left: number; top: number } {
  const width = Math.min(WA_POPUP_WIDTH, Math.max(320, Math.floor(s.availWidth || WA_POPUP_WIDTH)));
  const height = Math.max(480, Math.floor(s.availHeight || 800));
  const left = Math.max(0, Math.floor((s.availLeft ?? 0) + (s.availWidth || width) - width));
  const top = Math.max(0, Math.floor(s.availTop ?? 0));
  return { width, height, left, top };
}

/** The `window.open` features string for that rect (a popup, not a tab). */
export function waPopupFeatures(s: WaScreen): string {
  const r = waPopupRect(s);
  return `popup=yes,width=${r.width},height=${r.height},left=${r.left},top=${r.top}`;
}
