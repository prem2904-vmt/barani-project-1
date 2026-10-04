/**
 * Pure helpers for the public patient report page (/reports/public/:token).
 * No Angular, no DOM: the page's view-model is derived here so the specs can
 * pin every state without a browser.
 */

/** GET /api/public/report/{token} — the lab identity for the verification
 *  step. Never carries patient or report data. */
export interface ReportLinkInfo {
  state: 'active' | 'expired' | 'invalid';
  lab: { name?: string | null; logoUrl?: string | null; phone?: string | null } | null;
  attemptsLeft?: number;
  lockedSeconds?: number;
}

/** POST /api/public/report/{token}/verify — success payload. */
export interface VerifiedReport {
  org?: string;
  /** Masked name ("R••• K••••"); the snapshot has the printed name. */
  patient?: string;
  reportReady?: boolean;
  reportPdfUrl?: string | null;
  /** Same PDF as an attachment with a readable file name (newer API). */
  reportPdfDownloadUrl?: string | null;
  fileName?: string | null;
  /** The link pointed at an older version; this is the newest one. */
  superseded?: boolean;
  report?: { id: string; type: string; createdAt?: string; data?: string | null };
  template?: unknown;
  partnerReports?: { testName: string; partnerLabName?: string | null; url: string; fileName?: string | null }[];
  assetUrls?: Record<string, string>;
}

/** What the report card shows — only what the printed report already shows. */
export interface ReportSummary {
  name: string;
  ageSex: string | null;
  orderNumber: string | null;
  date: Date | null;
  partial: boolean;
  amended: boolean;
}

type Snap = {
  patient?: { displayName?: string | null; firstName?: string | null; fathersName?: string | null; age?: number | string | null; sex?: string | null };
  order?: { orderNumber?: string | null };
  type?: string;
  isPartial?: boolean;
  amendment?: { isAmended?: boolean } | null;
};

function parseSnap(data: string | null | undefined): Snap {
  if (!data) return {};
  try { const v = JSON.parse(data); return v && typeof v === 'object' ? v as Snap : {}; } catch { return {}; }
}

export function sexLabel(sex: string | null | undefined): string | null {
  const s = (sex ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'm' || s === 'male') return 'Male';
  if (s === 'f' || s === 'female') return 'Female';
  if (s === 'o' || s === 'other') return 'Other';
  return sex!.trim();
}

export function ageLabel(age: number | string | null | undefined): string | null {
  if (age == null || age === '') return null;
  const s = String(age).trim();
  if (!s) return null;
  return /^\d+(\.\d+)?$/.test(s) ? `${s} y` : s;
}

/** The card's view-model from a verified payload. */
export function summarise(v: VerifiedReport): ReportSummary {
  const snap = parseSnap(v.report?.data);
  const p = snap.patient ?? {};
  const printed = (p.displayName ?? '').trim() || [p.firstName, p.fathersName].filter(x => !!x && `${x}`.trim()).join(' ').trim();
  const age = ageLabel(p.age);
  const sex = sexLabel(p.sex);
  const created = v.report?.createdAt ? new Date(v.report.createdAt) : null;
  return {
    name: printed || v.patient || 'Patient',
    ageSex: [age, sex].filter(Boolean).join(' · ') || null,
    orderNumber: snap.order?.orderNumber?.trim() || null,
    date: created && !isNaN(created.getTime()) ? created : null,
    partial: v.report?.type === 'partial' || snap.isPartial === true,
    amended: snap.amendment?.isAmended === true,
  };
}

/** "2026-09-29" in local time. */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * "Report-Ravi-Kumar-2026-09-29.pdf": ASCII letters/digits only (safe on
 * every OS and in a Content-Disposition header), at most three name parts;
 * "Report-2026-09-29.pdf" when the name has none. Mirrors the API's
 * TrackingController.DownloadFileName.
 */
export function reportFileName(name: string | null | undefined, date: Date | null): string {
  const parts = (name ?? '')
    .split(/\s+/)
    .map(p => p.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean)
    .slice(0, 3);
  const day = isoDay(date ?? new Date());
  return `Report-${parts.length ? parts.join('-') + '-' : ''}${day}.pdf`;
}

/** Only images we can safely put in <img src>: https / http, a same-API
 *  "/uploads/…" path (made absolute), or an inline image data URL. */
export function safeLogoUrl(url: string | null | undefined, apiUrl: string): string | null {
  const u = (url ?? '').trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (/^data:image\/(png|jpe?g|webp|gif);/i.test(u)) return u;
  if (u.startsWith('/')) return `${apiUrl.replace(/\/$/, '')}${u}`;
  return null;
}

/** "tel:" href from a free-text phone ("+91 98765 43210 / 0422-…" → first number). */
export function telHref(phone: string | null | undefined): string | null {
  const first = (phone ?? '').split(/[,/;]| or /i)[0] ?? '';
  const digits = first.replace(/[^\d+]/g, '');
  return digits.replace(/\D/g, '').length >= 6 ? `tel:${digits}` : null;
}

/** "That doesn't match — 3 attempts left." */
export function mismatchMessage(attemptsLeft: number | null | undefined): string {
  if (attemptsLeft == null) return "That doesn't match. Check and try again.";
  if (attemptsLeft <= 1) return "That doesn't match — 1 attempt left.";
  return `That doesn't match — ${attemptsLeft} attempts left.`;
}

/** "0:32" / "4:05". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** iOS / iPadOS (incl. iPad-as-Mac): renders only page 1 of an <iframe> PDF. */
export function isIosDevice(nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> | null | undefined): boolean {
  if (!nav) return false;
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
}
