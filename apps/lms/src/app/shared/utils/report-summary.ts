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
