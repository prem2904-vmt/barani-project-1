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
    const [{ renderReportPdfBlobUrl, preloadReportImages }, { ReportLayoutService }, { PlatformService }] = await Promise.all([
      import('./report-pdf'),
      import('../../core/services/report-layout.service'),
      import('../../core/services/platform.service'),
    ]);
    const svc = injector.get(ReportLayoutService);
    const platform = injector.get(PlatformService);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolvedLayouts: Record<string, any> = {};
    let tests: Array<{ testId?: string; result?: { values?: Record<string, unknown> } }> = [];
    let patient: { sex?: string | null; age?: number | null } | undefined;
    try { const snap = JSON.parse(rep.data ?? '{}'); tests = snap?.tests ?? []; patient = { sex: snap?.patient?.sex ?? null, age: snap?.patient?.age ?? null }; } catch { /* malformed */ }
    const [template] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      firstValueFrom(api.get('/api/config/report-template') as any).catch(() => null),
      ...tests.map(async t => {
        if (!t.testId) return;
        try { resolvedLayouts[t.testId] = await svc.preview(t.testId, (t.result?.values ?? {}) as Record<string, unknown>, [], patient); } catch { /* fallback table */ }
      }),
    ]);
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
