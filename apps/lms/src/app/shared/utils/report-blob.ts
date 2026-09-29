import { Injector } from '@angular/core';
import type { PrintChoiceDialog } from './print-letterhead';
import type { StoredPdfVariant } from './stored-report-pdf';

/**
 * THE report PDF for a stored report — owner rule (2026-09-29): the report is
 * the file in blob storage (`GET /api/reports/{id}/pdf`). Only when nothing is
 * stored yet is it rendered, ONCE, from the report's SAVED snapshot with the
 * ONE recipe every report entry point shares (`prepareReportPdfInput`:
 * template + typed layouts incl. profile layouts + logo/signature images +
 * trendograms), and stored (see `stored-report-pdf.ts`).
 *
 * `rep` may be a summary row (no `data`): the snapshot is read by id only
 * when a render is actually needed. Throws on failure — the caller shows it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function storedReportBlob(rep: any, api: any, injector: Injector, variant: StoredPdfVariant = 'full'): Promise<Blob> {
  const { ensureStoredReportPdf } = await import('./stored-report-pdf');
  return ensureStoredReportPdf(api, rep.id, () => renderReportFromSnapshot(rep, api, injector, variant), variant);
}

/** Render a report from its SAVED snapshot (`report.data`) — used only to
 *  produce the one stored copy. Never called for a report already stored. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function renderReportFromSnapshot(rep: any, api: any, injector: Injector, variant: StoredPdfVariant = 'full'): Promise<Blob> {
  const [{ buildReportPdf }, { ReportLayoutService }, { PlatformService }, { prepareReportPdfInput }, { ensureFullReport }] = await Promise.all([
    import('./report-pdf'),
    import('../../core/services/report-layout.service'),
    import('../../core/services/platform.service'),
    import('./report-render-input'),
    import('./report-summary'),
  ]);
  const svc = injector.get(ReportLayoutService);
  const platform = injector.get(PlatformService);
  const full = await ensureFullReport(api, rep);
  const input = await prepareReportPdfInput(full, {
    api,
    preview: (id, values, images, p) => svc.preview(id, values, images as never, p),
    apiUrl: platform.getApiUrl(),
  });
  return buildReportPdf({ ...input, ...(variant === 'letterpad' ? { blankLetterhead: true } : {}) }).output('blob');
}

/**
 * The stored report as a blob object-URL. Returns '' on failure (it never
 * falls back to a template-less render). Caller owns URL.revokeObjectURL.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildReportBlobUrl(rep: any, api: any, injector: Injector): Promise<string> {
  try {
    return URL.createObjectURL(await storedReportBlob(rep, api, injector, 'full'));
  } catch (err) {
    console.error('[report-blob] report load failed', err);
    return '';
  }
}

/**
 * The PRINT variant of `buildReportBlobUrl`: when the lab's letterpad setting
 * is on it first asks letterhead paper (header & footer left blank) vs plain
 * paper — for this print job only (`askPrintLetterhead`) — and prints the
 * matching STORED copy. Returns the blob URL, '' on a failure, or null when
 * the user dismissed the question (print nothing).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildReportPrintBlobUrl(rep: any, api: any, injector: Injector, dialog: PrintChoiceDialog): Promise<string | null> {
  try {
    const [{ loadReportTemplate }, { askPrintLetterhead }] = await Promise.all([
      import('./report-render-input'),
      import('./print-letterhead'),
    ]);
    const job = await askPrintLetterhead(await loadReportTemplate(api), dialog);
    if (!job) return null;
    return URL.createObjectURL(await storedReportBlob(rep, api, injector, job.blankLetterhead ? 'letterpad' : 'full'));
  } catch (err) {
    console.error('[report-blob] report print failed', err);
    return '';
  }
}
