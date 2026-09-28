import { firstValueFrom, type Observable } from 'rxjs';

/**
 * Report LIST reads without the rendered snapshot (DB optimisation phase 2).
 *
 * `GET /api/reports/queue?view=summary` and `GET /api/reports/by-order/{id}?view=summary`
 * return the same report rows (order + patient included on the queue) WITHOUT
 * `data` (the rendered snapshot, ~21 kB each), `qrCode` and `sampleIdsJson`.
 * A screen that renders / prints / shares one of them reads the full report
 * first with {@link ensureFullReport} (`GET /api/reports/{id}`).
 */
export const REPORT_QUEUE_SUMMARY_URL = '/api/reports/queue?view=summary';

/** Report-queue tab counts over the WHOLE queue (search / status not applied). */
export interface ReportQueueCounts { all: number; pending: number; delivered: number; failed: number }

/** One page of `GET /api/reports/queue?view=summary&page=…` (DB optimisation
 *  phase 3). An older server ignores the paging params and answers the whole
 *  queue as an array — callers accept both. */
export interface ReportQueuePage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  counts: ReportQueueCounts;
}

export const REPORT_QUEUE_PAGE_SIZE = 50;

/** Server status for a queue tab: the report tabs filter by delivery status;
 *  All and Partial (whose cards come from elsewhere) read the whole queue. */
export function reportQueueServerStatus(tab: string): 'all' | 'pending' | 'delivered' | 'failed' {
  return tab === 'pending' || tab === 'delivered' || tab === 'failed' ? tab : 'all';
}

export function reportQueuePageUrl(o: { page: number; pageSize: number; status: string; q?: string | null }): string {
  const q = (o.q ?? '').trim();
  return `${REPORT_QUEUE_SUMMARY_URL}&page=${o.page}&pageSize=${o.pageSize}&status=${encodeURIComponent(o.status)}`
    + (q ? `&q=${encodeURIComponent(q)}` : '');
}

export function reportByOrderSummaryUrl(orderId: string): string {
  return `/api/reports/by-order/${encodeURIComponent(orderId)}?view=summary`;
}

type ApiLike = { get<T>(url: string): Observable<T> };

/** The report WITH its rendered `data`: the row itself when it already carries
 *  it, else the full report by id merged over the row (the row's order /
 *  patient, which the by-id read doesn't include, are kept). Throws when the
 *  report can't be read — callers already turn render failures into a toast. */
export async function ensureFullReport<T extends { id: string; data?: string | null }>(api: ApiLike, r: T): Promise<T> {
  if (r.data != null) return r;
  const full = await firstValueFrom(api.get<Partial<T> | null>(`/api/reports/${encodeURIComponent(r.id)}`));
  if (!full) throw new Error('Report not found');
  return { ...r, ...full } as T;
}
