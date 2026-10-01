import { matchesDailyNo } from '../../../shared/utils/daily-no';
/**
 * Frontdesk "Outsourced" tab — pure view logic (unit-tested). Outsourced tests
 * never enter the lab's own queues; the front desk tracks them here and, when
 * the partner lab's report comes back, uploads it and marks them Completed.
 *
 * Status names (backend, OutsourcingService):
 *   'outsourced' — sent / awaiting the partner's report
 *   'completed'  — the partner report is back and attached
 */

export type OutsourcedStatus = 'outsourced' | 'completed';
export type OutsourcedStatusFilter = 'all' | OutsourcedStatus;

export interface PartnerReport {
  orderTestId: string;
  testName: string;
  partnerLabId?: string | null;
  partnerLabName?: string | null;
  url: string;
  fileName?: string | null;
  contentType?: string | null;
  uploadedAt?: string | null;
  uploadedByName?: string | null;
  /** "Attach to our report" — the patient gets ONE PDF (ours + these pages).
   *  Absent on files uploaded before the feature = not attached. */
  attachToReport?: boolean;
  /** Why an attached file can't be joined (password-protected / unreadable);
   *  it then stays a separate file. */
  attachProblem?: string | null;
  /** Attached AND joinable = inside the patient's combined PDF. */
  inReport?: boolean;
}

export interface OutsourcedLine {
  orderTestId: string;
  testId: string;
  testName: string;
  status: OutsourcedStatus;
  completed: boolean;
  report?: PartnerReport | null;
}

export interface OutsourcedTube {
  sampleId: string;
  barcode?: string | null;
  sampleStatus: string;
  tubeColor?: string | null;
  orderId: string;
  orderNumber?: string | null;
  patientId: string;
  patientName: string;
  /** Daily patient number for this visit (per branch per IST day) and its
   *  day, yyyy-MM-dd — on-screen only (utils/daily-no.ts). */
  dailyNo?: number | null;
  dailyNoDay?: string | null;
  partnerLabId?: string | null;
  partnerLabName?: string | null;
  createdAt: string;
  collectedAt?: string | null;
  dispatchedAt?: string | null;
  status: OutsourcedStatus;
  hasReport: boolean;
  tests: OutsourcedLine[];
}

export interface OutsourcedFilter {
  query?: string;
  status?: OutsourcedStatusFilter;
  partnerId?: string | null;
}

export const STATUS_LABEL: Record<OutsourcedStatus, string> = {
  outsourced: 'Outsourced',
  completed: 'Completed',
};

/** Rows matching the band filters: status, partner lab, and a free-text
 *  query over patient, order ID, sample ID, tests and partner. */
export function filterOutsourced(rows: readonly OutsourcedTube[], f: OutsourcedFilter): OutsourcedTube[] {
  const q = (f.query ?? '').trim().toLowerCase();
  return rows.filter(r => {
    if (f.status && f.status !== 'all' && r.status !== f.status) return false;
    if (f.partnerId && r.partnerLabId !== f.partnerId) return false;
    if (!q) return true;
    if (matchesDailyNo(q, r)) return true;
    const hay = [r.patientName, r.orderNumber, r.barcode, r.partnerLabName, ...r.tests.map(t => t.testName)]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
}

/** Partner-lab filter options from the rows (distinct, by name). */
export function partnerOptions(rows: readonly OutsourcedTube[]): { value: string; label: string }[] {
  const m = new Map<string, string>();
  for (const r of rows) if (r.partnerLabId) m.set(r.partnerLabId, r.partnerLabName?.trim() || 'Partner lab');
  return [...m.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

export function countByStatus(rows: readonly OutsourcedTube[]): Record<OutsourcedStatus, number> {
  return {
    outsourced: rows.filter(r => r.status === 'outsourced').length,
    completed: rows.filter(r => r.status === 'completed').length,
  };
}

/** Outsourced/Completed tab counts, server shape (OutsourcingService.OutsourcedCounts,
 *  mw). Always for the WHOLE date window — never narrowed by the status /
 *  partner filter that's also on screen (the chip reads the total). */
export interface OutsourcedServerCounts { outsourced: number; completed: number }

/** One page of `GET /api/samples/outsourced?days=…&page=…` (DB optimisation,
 *  release 2026-10-01). An older server ignores the paging params and
 *  answers the whole window as an array — callers accept both shapes. */
export interface OutsourcedPage {
  items: OutsourcedTube[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  counts: OutsourcedServerCounts;
}

export const OUTSOURCED_PAGE_SIZE = 50;

export function outsourcedPageUrl(o: {
  days: number; page: number; pageSize: number; status: OutsourcedStatusFilter; partnerId?: string | null;
}): string {
  let url = `/api/samples/outsourced?days=${o.days}&page=${o.page}&pageSize=${o.pageSize}`
    + `&status=${encodeURIComponent(o.status || 'all')}`;
  if (o.partnerId) url += `&partnerLabId=${encodeURIComponent(o.partnerId)}`;
  return url;
}

/** Lines the row's actions act on: upload/complete targets the lines not yet
 *  completed (all of them when every line is done — a replace). */
export function actionLines(r: OutsourcedTube): string[] {
  const open = r.tests.filter(t => !t.completed).map(t => t.orderTestId);
  return open.length ? open : r.tests.map(t => t.orderTestId);
}

/** The attached partner report of a row (the latest line that has one). */
export function rowReport(r: OutsourcedTube): PartnerReport | null {
  for (let i = r.tests.length - 1; i >= 0; i--) if (r.tests[i].report) return r.tests[i].report!;
  return null;
}

/** How a row's partner report reaches the patient. */
export type AttachState = 'none' | 'in-report' | 'separate' | 'problem';

export function attachState(r: OutsourcedTube): AttachState {
  const rep = rowReport(r);
  if (!rep) return 'none';
  if (rep.attachToReport && rep.attachProblem) return 'problem';
  return rep.attachToReport ? 'in-report' : 'separate';
}

/** The chip text for {@link attachState} (null = no chip). */
export const ATTACH_LABEL: Record<AttachState, string | null> = {
  'none': null,
  'in-report': 'In our report',
  'separate': 'Separate file',
  'problem': 'Separate file',
};

/** Default of the "Attach to our report" choice at upload: ON for every
 *  accepted type (PDF and images) — the patient should get one document. */
export const ATTACH_DEFAULT = true;

/** The first "can't join" problem among the tubes' reports, if any (to warn). */
export function firstAttachProblem(rows: readonly OutsourcedTube[] | null | undefined): string | null {
  for (const r of rows ?? []) for (const t of r.tests) if (t.report?.attachToReport && t.report.attachProblem) return t.report.attachProblem;
  return null;
}

/** What the report's DELIVERED PDF really contains for one partner file —
 *  `GET /api/reports/{id}/pdf-parts` (the server built / read the combined
 *  file to answer). Keyed by the partner file's url. */
export interface PdfPartStatus {
  url: string;
  testNames?: string;
  partnerLabName?: string | null;
  joined: boolean;
  problem?: string | null;
}
export interface PdfParts {
  /** Our PDF is stored (nothing can be joined before it is). */
  stored: boolean;
  combined: boolean;
  parts: PdfPartStatus[];
}

/** The report viewer's line for a partner report: where it goes, whether the
 *  desk can still attach it, and a warning tone when an attached file is NOT
 *  in the PDF. The server's pdf-parts answer wins over the flag — the flag
 *  alone once claimed "In this PDF" for a file that wasn't (LAB-2609-000154). */
export interface PartnerWhere {
  text: string;
  warn: boolean;
  /** Not attached — offer "Attach to report" (legacy uploads have no flag). */
  canAttach: boolean;
}

export function partnerWhere(p: PartnerReport, parts: PdfParts | null | undefined): PartnerWhere {
  if (!p.attachToReport) {
    return { text: 'Sent as a separate file — attach it to send one PDF', warn: false, canAttach: true };
  }
  if (p.attachProblem) return { text: `Sent as a separate file — ${p.attachProblem}`, warn: true, canAttach: false };
  const st = parts?.parts.find(x => x.url === p.url);
  if (st?.joined) return { text: 'In this PDF, after our report', warn: false, canAttach: false };
  if (st && !st.joined) {
    return { text: `Not in this PDF — ${st.problem ?? 'it couldn’t be joined'}`, warn: true, canAttach: false };
  }
  // No answer yet (loading / our PDF not stored yet / the check failed).
  return { text: 'Attached — joined after our report', warn: false, canAttach: false };
}

/** Files the partner-report upload accepts (mirrors the backend). */
export const PARTNER_REPORT_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';
export const PARTNER_REPORT_MAX_MB = 15;

/** Client-side guard before uploading; null = ok, else the message. */
export function partnerFileProblem(file: { type: string; size: number }): string | null {
  if (!PARTNER_REPORT_ACCEPT.split(',').includes((file.type || '').toLowerCase()))
    return 'Upload a PDF or an image (PNG, JPEG, WebP).';
  if (file.size > PARTNER_REPORT_MAX_MB * 1024 * 1024) return `Max size is ${PARTNER_REPORT_MAX_MB} MB.`;
  return null;
}

/** Absolute URL for an uploaded file ("/uploads/…" lives on the API host). */
export function absoluteFileUrl(url: string, apiBase: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${apiBase.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** The WhatsApp line that tells the patient the partner-lab report(s) ride
 *  on the same (verified) link; null when there are none. */
export function partnerReportShareLine(reports: readonly PartnerReport[]): string | null {
  if (!reports.length) return null;
  const name = (r: PartnerReport) => r.partnerLabName ? `${r.testName} (tested at ${r.partnerLabName})` : r.testName;
  const inside = reports.filter(r => r.inReport).map(name);
  const separate = reports.filter(r => !r.inReport).map(name);
  const lines: string[] = [];
  if (inside.length) lines.push(`Your report PDF also includes the partner lab report for ${inside.join(', ')}.`);
  if (separate.length) lines.push(`Also included on the same link: the partner lab report for ${separate.join(', ')}.`);
  return lines.join('\n');
}
