import { waE164 } from './whatsapp-manual';

/**
 * SMS Chat (owner 2026-11-13): on a phone or tablet, Share → SMS opens the
 * device's OWN Messages app with the text + report link already typed; the
 * person presses Send. Nothing is sent by Prefrontal (TRAI DLT forbids business
 * SMS from a personal SIM; Play forbids SEND_SMS for non-default SMS apps), so
 * this is only an `sms:` link. Never offered on a computer.
 *
 * The body separator differs by platform:
 *   - iOS (iPhone / iPad, native or Safari):  `sms:+919876543210&body=…`
 *   - Android (and anything else):            `sms:+919876543210?body=…`
 */
export type SmsPlatform = 'ios' | 'android' | 'other';

export interface SmsEnv {
  /** Capacitor.getPlatform() when running in the native shell ('ios' | 'android' | 'web'). */
  nativePlatform?: string | null;
  userAgent?: string | null;
  maxTouchPoints?: number | null;
}

/** Which `sms:` dialect this device speaks. iPad-as-Mac (Macintosh UA + touch) counts as iOS. */
export function smsPlatform(env: SmsEnv): SmsPlatform {
  const native = (env.nativePlatform ?? '').toLowerCase();
  if (native === 'ios') return 'ios';
  if (native === 'android') return 'android';
  const ua = env.userAgent ?? '';
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Macintosh/.test(ua) && (env.maxTouchPoints ?? 0) > 1) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

/** The `sms:` link for one number + message, or null when the number is not a valid mobile. */
export function smsUri(phone: string | null | undefined, body: string, platform: SmsPlatform): string | null {
  const e164 = waE164(phone);
  if (!e164) return null;
  const sep = platform === 'ios' ? '&' : '?';
  return `sms:${e164}${sep}body=${encodeURIComponent(body)}`;
}

/** Patient message: one short report-ready line + the report link (the one WhatsApp carries). */
export function smsReportMessage(p: { patient?: string | null; lab?: string | null; link?: string | null }): string {
  const who = p.patient?.trim() ? `Dear ${p.patient.trim()}, your` : 'Your';
  const lab = p.lab?.trim() || 'the lab';
  return `${who} report from ${lab} is ready.${p.link ? ` View it here: ${p.link}` : ''}`;
}

/** Referral doctor's message. */
export function smsDoctorReportMessage(p: { doctor?: string | null; patient?: string | null; lab?: string | null; link?: string | null }): string {
  const doc = p.doctor?.trim() || 'Doctor';
  const pat = p.patient?.trim() ? ` of ${p.patient.trim()}` : '';
  const lab = p.lab?.trim() || 'the lab';
  return `Dear ${doc}, the report${pat} from ${lab} is ready.${p.link ? ` View it here: ${p.link}` : ''}`;
}

/** Read the SMS env from the real window (the service passes it to `smsPlatform`). */
export function readSmsEnv(view: Window | null | undefined): SmsEnv {
  const w = view as (Window & { Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean } }) | null | undefined;
  const native = w?.Capacitor?.isNativePlatform?.() ? (w.Capacitor.getPlatform?.() ?? null) : null;
  return { nativePlatform: native, userAgent: w?.navigator?.userAgent ?? '', maxTouchPoints: w?.navigator?.maxTouchPoints ?? 0 };
}
