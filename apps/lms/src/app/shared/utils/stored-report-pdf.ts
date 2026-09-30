import { firstValueFrom, type Observable } from 'rxjs';

/**
 * The STORED report PDF — owner rule (2026-09-29):
 *
 * > "Once a report has been generated, it has to stay in blob storage. When
 * > they view it, it has to fetch it from blob storage only. The only point
 * > where the report is regenerated is deleting the previous report, bringing
 * > up the new settings and regenerating it."
 *
 * Every screen that shows / prints / downloads / shares a report goes through
 * {@link ensureStoredReportPdf}:
 *
 * 1. `GET /api/reports/{id}/pdf` → the stored file. That IS the report —
 *    no live re-render, whatever the Test Master or template say today.
 * 2. 404 (nothing stored yet — a report generated on the server, e.g. the
 *    auto-report on validation, or one from before this rule): render it ONCE
 *    from the report's SAVED snapshot (`report.data`, never live data) and
 *    `POST` it. The server keeps the first upload and refuses every later one
 *    (409 `already_stored`) — if another screen won that race we show ITS
 *    file. If the upload fails (offline, storage down) the rendered copy is
 *    shown and the next view tries again.
 * 3. Any other read failure is an error — never a silent re-render.
 *
 * Partner reports the front desk attached ("Attach to our report") are
 * joined server-side: the GET returns ONE combined PDF (our stored pages
 * first, untouched) — so after a first store we read it back once.
 *
 * Variants: `full` (with the letterhead — view, download, share, WhatsApp,
 * the patient link) and `letterpad` (the letterhead-paper print: header &
 * footer blank). Each is stored once.
 */
export type StoredPdfVariant = 'full' | 'letterpad';

export interface StoredPdfApi {
  post(path: string, body: unknown): Observable<unknown>;
  /** ApiService.getBlob — absent on some test doubles (treated as "nothing stored"). */
  getBlob?(path: string): Observable<Blob>;
}

/** The read of a stored PDF failed for a reason other than "not stored yet". */
export class StoredReportPdfError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'StoredReportPdfError';
  }
}

export const STORED_PDF_READ_ERROR = 'The stored report couldn’t be loaded. Check your connection and try again.';

export function storedReportPdfPath(reportId: string, variant: StoredPdfVariant = 'full'): string {
  return `/api/reports/${encodeURIComponent(reportId)}/pdf${variant === 'letterpad' ? '?variant=letterpad' : ''}`;
}

function statusOf(e: unknown): number | undefined {
  const o = e as { status?: number; httpStatus?: number } | null;
  return o?.status ?? o?.httpStatus;
}

/** The stored PDF, or null when none is stored yet (404). Throws
 *  {@link StoredReportPdfError} on any other failure. */
export async function fetchStoredReportPdf(api: StoredPdfApi, reportId: string, variant: StoredPdfVariant = 'full'): Promise<Blob | null> {
  if (typeof api.getBlob !== 'function') return null;
  try {
    const blob = await firstValueFrom(api.getBlob(storedReportPdfPath(reportId, variant)));
    return blob && blob.size > 0 ? blob : null;
  } catch (e) {
    if (statusOf(e) === 404) return null;
    throw new StoredReportPdfError(STORED_PDF_READ_ERROR, e);
  }
}

/** Store a rendered PDF — first write wins. */
export async function storeReportPdf(
  api: StoredPdfApi, reportId: string, blob: Blob, variant: StoredPdfVariant = 'full',
): Promise<'stored' | 'exists' | 'failed'> {
  try {
    const fd = new FormData();
    fd.append('file', blob, `${reportId}.pdf`);
    await firstValueFrom(api.post(storedReportPdfPath(reportId, variant), fd));
    return 'stored';
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    return statusOf(e) === 409 || code === 'already_stored' ? 'exists' : 'failed';
  }
}

/** Concurrent callers for the same report + variant share ONE render/store. */
const inflight = new Map<string, Promise<Blob>>();

/**
 * THE report PDF for a report id: the stored file, or — when none is stored
 * yet — `render()` once (from the saved snapshot) and store it.
 */
export function ensureStoredReportPdf(
  api: StoredPdfApi,
  reportId: string,
  render: () => Promise<Blob>,
  variant: StoredPdfVariant = 'full',
): Promise<Blob> {
  const key = `${reportId}|${variant}`;
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      const stored = await fetchStoredReportPdf(api, reportId, variant);
      if (stored) return stored;
      const rendered = await render();
      const outcome = await storeReportPdf(api, reportId, rendered, variant);
      if (outcome === 'stored') {
        // What the server serves now — our report, plus any attached partner
        // pages. One retry: our own render has NO partner pages, so it is only
        // the last resort (LAB-2609-000154).
        for (let attempt = 0; attempt < 2; attempt++) {
          const served = await fetchStoredReportPdf(api, reportId, variant).catch(() => null);
          if (served) return served;
        }
      }
      if (outcome === 'exists') {
        // Another screen stored it first — that file is the report.
        const winner = await fetchStoredReportPdf(api, reportId, variant).catch(() => null);
        if (winner) return winner;
      }
      return rendered;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** Save a PDF blob as a file (web) — the native shell uses the share sheet. */
export function downloadPdfBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* */ } }, 60_000);
}
