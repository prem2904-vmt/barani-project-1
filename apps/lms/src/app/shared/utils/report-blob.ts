import { Injector } from '@angular/core';

/**
 * Build a patient lab REPORT into a blob object-URL, client-side, using the ONE
 * recipe every report entry point shares (`prepareReportPdfInput`: template +
 * typed layouts incl. profile layouts + logo/signature images + trendograms).
 *
 * Returns '' on failure. It no longer falls back to a template-less render:
 * that printed the product-default letterhead, i.e. a report that looked like a
 * different lab's. Caller owns URL.revokeObjectURL and shows its error.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildReportBlobUrl(rep: any, api: any, injector: Injector): Promise<string> {
  try {
    const [{ renderReportPdfBlobUrl }, { ReportLayoutService }, { PlatformService }, { prepareReportPdfInput }] = await Promise.all([
      import('./report-pdf'),
      import('../../core/services/report-layout.service'),
      import('../../core/services/platform.service'),
      import('./report-render-input'),
    ]);
    const svc = injector.get(ReportLayoutService);
    const platform = injector.get(PlatformService);
    const input = await prepareReportPdfInput(rep, {
      api,
      preview: (id, values, images, p) => svc.preview(id, values, images as never, p),
      apiUrl: platform.getApiUrl(),
    });
    return renderReportPdfBlobUrl(input);
  } catch (err) {
    console.error('[report-blob] report render failed', err);
    return '';
  }
}
