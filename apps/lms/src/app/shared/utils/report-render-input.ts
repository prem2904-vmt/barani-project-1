import { firstValueFrom, Observable } from 'rxjs';
import type { ReportTemplate } from '../models/report.model';
import type { ResolvedReportLayout } from '../models/report-layout.model';
import type { ReportPdfInput } from './report-pdf';
import { LayoutSnapshotTest, PreviewFn, resolveReportLayouts } from './report-layouts';

/**
 * The ONE recipe that turns a stored report into the input of `buildReportPdf`.
 *
 * A report must render IDENTICALLY for every viewer: the lab's template
 * (letterhead, flag style, department grouping, patient strip, signatures) and
 * the per-test layouts are part of the REPORT, not an admin setting. Every
 * entry point used to fetch the template with `.catch(() => null)`, so a user
 * who got a 403 on it (reception, before the backend fix) silently printed the
 * product-default letterhead — "PREFRONTAL PATHOLOGY LAB", letter flags, no
 * Centre, no department Sample IDs — while an admin printed the lab's own.
 *
 * Now: a template or layout read that fails for a reason that depends on the
 * viewer (permission, sign-in, network) throws `ReportRenderError`. Callers show
 * an error state; they never render — or archive to the patient's public link —
 * a report that looks different from the one the lab designed.
 */
export class ReportRenderError extends Error {
  constructor(
    message: string,
    /** Which input could not be loaded. */
    readonly part: 'template' | 'layout',
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ReportRenderError';
  }
}

export const REPORT_RENDER_ERROR_MESSAGE =
  'The lab’s report design couldn’t be loaded, so the report wasn’t rendered. Try again in a moment.';

/** Message for a toast / error state: the specific one for a render error,
 *  the caller's generic one otherwise. */
export function reportRenderErrorMessage(e: unknown, fallback: string): string {
  return e instanceof ReportRenderError ? e.message : fallback;
}

export interface ApiLike {
  get<T>(path: string): Observable<T>;
}

/** The tenant's report template. `null` only when the lab has never saved one
 *  (a 200 with no data — the same for every viewer). Any failure throws. */
export async function loadReportTemplate(api: ApiLike): Promise<ReportTemplate | null> {
  try {
    return (await firstValueFrom(api.get<ReportTemplate | null>('/api/config/report-template'))) ?? null;
  } catch (e) {
    throw new ReportRenderError(REPORT_RENDER_ERROR_MESSAGE, 'template', e);
  }
}

export interface ReportRenderDeps {
  api: ApiLike;
  /** ReportLayoutService.preview (injected so this stays DI-free). */
  preview: PreviewFn;
  /** Base URL for relative logo / signature image URLs. */
  apiUrl: string;
  /** Include trendogram charts (every staff entry point does). */
  trendograms?: boolean;
}

type RenderableReport = ReportPdfInput['report'];

/** Build the full `ReportPdfInput` (template + layouts + images + trendograms)
 *  for a stored report. Throws `ReportRenderError` instead of degrading. */
export async function prepareReportPdfInput(report: RenderableReport, deps: ReportRenderDeps): Promise<ReportPdfInput> {
  let tests: LayoutSnapshotTest[] = [];
  let patient: { sex?: string | null; age?: number | null } | undefined;
  try {
    const snap = JSON.parse(report.data ?? '{}');
    tests = snap?.tests ?? [];
    patient = { sex: snap?.patient?.sex ?? null, age: snap?.patient?.age ?? null };
  } catch { /* malformed snapshot — render without layouts (same for everyone) */ }

  const [template, resolvedLayouts] = await Promise.all([
    loadReportTemplate(deps.api),
    resolveReportLayouts<ResolvedReportLayout>(deps.preview, tests, patient).catch(e => {
      throw new ReportRenderError(REPORT_RENDER_ERROR_MESSAGE, 'layout', e);
    }),
  ]);

  const { preloadReportImages } = await import('./report-pdf');
  const baseInput: ReportPdfInput = { report, resolvedLayouts, template };
  const [imageCache, trendograms] = await Promise.all([
    preloadReportImages(baseInput, deps.apiUrl),
    deps.trendograms === false
      ? Promise.resolve([])
      : import('./trendogram-report').then(m => m.prepareTrendograms(report, deps.api as never)).catch(e => {
          throw new ReportRenderError(REPORT_RENDER_ERROR_MESSAGE, 'layout', e);
        }),
  ]);
  return { ...baseInput, imageCache, trendograms };
}
