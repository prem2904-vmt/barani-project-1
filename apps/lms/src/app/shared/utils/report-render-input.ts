import { firstValueFrom, Observable } from 'rxjs';
import type { ReportTemplate } from '../models/report.model';
import type { ResolvedReportLayout } from '../models/report-layout.model';
import type { ReportPdfInput } from './report-pdf';
import { LayoutSnapshotTest, PreviewFn, resolveReportLayouts } from './report-layouts';
import { ORDER_QR_KEY, patientStripPlaces } from './patient-strip-qr';

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
  let patient: { sex?: string | null; age?: number | null; ageYears?: number | null; ageDisplay?: string | null } | undefined;
  let order: { id?: string; trackToken?: string | null } | undefined;
  try {
    const snap = JSON.parse(report.data ?? '{}');
    tests = snap?.tests ?? [];
    order = snap?.order ?? undefined;
    // Age at collection from the snapshot (DOB-derived server-side); the
    // fractional `ageYears` drives the band pick (older snapshots: `age`).
    patient = { sex: snap?.patient?.sex ?? null, age: snap?.patient?.age ?? null,
                ageYears: snap?.patient?.ageYears ?? null, ageDisplay: snap?.patient?.ageDisplay ?? null };
  } catch { /* malformed snapshot — render without layouts (same for everyone) */ }

  const [template, resolvedLayouts] = await Promise.all([
    loadReportTemplate(deps.api),
    resolveReportLayouts<ResolvedReportLayout>(deps.preview, tests, patient).catch(e => {
      throw new ReportRenderError(REPORT_RENDER_ERROR_MESSAGE, 'layout', e);
    }),
  ]);

  const { preloadReportImages } = await import('./report-pdf');
  const orderTrackToken = await legacyOrderTrackToken(deps.api, order, template, resolvedLayouts);
  const baseInput: ReportPdfInput = { report, resolvedLayouts, template, ...(orderTrackToken ? { orderTrackToken } : {}) };
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

/**
 * Reports generated before the snapshot carried `order.trackToken` can still
 * print the patient-strip Order QR: when a strip that could print places it,
 * fetch (get-or-create) the order's tracking token — the same one the invoice
 * QR uses. Best-effort: a viewer without the order/bill permission, or any
 * failure, prints the report without that QR rather than not at all.
 */
export async function legacyOrderTrackToken(
  api: ApiLike,
  order: { id?: string; trackToken?: string | null } | undefined,
  template: ReportTemplate | null,
  resolvedLayouts: Record<string, ResolvedReportLayout>,
): Promise<string | null> {
  if (!order?.id || order.trackToken) return null;
  const strips = Object.values(resolvedLayouts ?? {}).map(l => l?.patientStrip);
  if (!patientStripPlaces(ORDER_QR_KEY, template?.patientColumnsJson, strips)) return null;
  try {
    const r = await firstValueFrom(api.get<{ token?: string } | null>(`/api/orders/${encodeURIComponent(order.id)}/track-token`));
    return r?.token || null;
  } catch {
    return null;
  }
}
