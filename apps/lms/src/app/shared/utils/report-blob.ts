import { Injector } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/**
 * Build a patient lab REPORT into a blob object-URL, client-side, using the same
 * recipe as the report viewer (template + typed layouts + logo/signature images
 * + trendograms). Returns '' on failure. Caller owns URL.revokeObjectURL.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildReportBlobUrl(rep: any, api: any, injector: Injector): Promise<string> {
  try {
    const [{ renderReportPdfBlobUrl, preloadReportImages }, { ReportLayoutService }, { PlatformService }, { resolveReportLayouts }] = await Promise.all([
      import('./report-pdf'),
      import('../../core/services/report-layout.service'),
      import('../../core/services/platform.service'),
      import('./report-layouts'),
    ]);
    const svc = injector.get(ReportLayoutService);
    const platform = injector.get(PlatformService);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolvedLayouts: Record<string, any> = {};
    let tests: Array<{ testId?: string; packageTestId?: string | null; profileTestId?: string | null; result?: { values?: Record<string, unknown> }; images?: string[] | null }> = [];
    let patient: { sex?: string | null; age?: number | null } | undefined;
    try { const snap = JSON.parse(rep.data ?? '{}'); tests = snap?.tests ?? []; patient = { sex: snap?.patient?.sex ?? null, age: snap?.patient?.age ?? null }; } catch { /* malformed */ }
    // The ONE layout resolver (scalar values → conditions match; images;
    // profile layouts) — same as the report viewer and report queue.
    const [template, layouts] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      firstValueFrom(api.get('/api/config/report-template') as any).catch(() => null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolveReportLayouts<any>((id, values, images, p) => svc.preview(id, values, images as never, p), tests, patient),
    ]);
    Object.assign(resolvedLayouts, layouts);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseInput: any = { report: rep, resolvedLayouts, template: template ?? null };
    const [imageCache, trendograms] = await Promise.all([
      preloadReportImages(baseInput, platform.getApiUrl()),
      (await import('./trendogram-report')).prepareTrendograms(rep, api),
    ]);
    return renderReportPdfBlobUrl({ ...baseInput, imageCache, trendograms });
  } catch {
    try {
      const { renderReportPdfBlobUrl } = await import('./report-pdf');
      return renderReportPdfBlobUrl({ report: rep });
    } catch { return ''; }
  }
}
