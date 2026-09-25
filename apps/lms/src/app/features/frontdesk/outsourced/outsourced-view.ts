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
  const parts = reports.map(r => r.partnerLabName ? `${r.testName} (tested at ${r.partnerLabName})` : r.testName);
  return `Also included on the same link: the partner lab report for ${parts.join(', ')}.`;
}
