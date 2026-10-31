import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, timeout } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { PlatformService } from '../../../core/services/platform.service';
import { assistantFailure } from '../../../shared/assistant/assistant-logic';
import {
  normaliseChatReply, normaliseDashboard, normaliseDimensions, normaliseMetrics, normaliseOptions, normalisePreview, normaliseSummaries,
  normaliseVersionDetail, normaliseVersions,
} from './insights-builder-logic';
import type {
  DimensionKind, DimensionValue, InsightsChatReply, InsightsChatRequest, InsightsDashboard, InsightsDashboardSummary, InsightsDashboardVersion,
  InsightsDashboardVersionDetail, InsightsMetric, InsightsOptions, InsightsPreview, InsightsRecipe, PreviewBand, PublishDashboardRequest,
  SaveDashboardRequest,
} from './insights-builder.models';

/**
 * The ONE file that talks to the Insights builder endpoints (BETA
 * `assistant`; the beta interceptor adds X-PF-BETA). Every response goes
 * through a normaliser in `insights-builder-logic.ts`, so aligning with the
 * backend's final shapes is a change here + there, never in the component.
 *
 * CRUD / metrics / preview use ApiService (the `{ success, data }` envelope,
 * 20 s ceiling). The chat goes through HttpClient like the instruments
 * assistant: a model answer can take longer than 20 s, and the panel needs
 * the HTTP status to word failures (`assistantError`).
 */
@Injectable({ providedIn: 'root' })
export class InsightsBuilderApiService {
  static readonly CHAT_TIMEOUT_MS = 90_000;

  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);
  private readonly platform = inject(PlatformService);

  metrics(): Observable<InsightsMetric[]> {
    return this.api.get<unknown>('/api/insights/metrics').pipe(map(normaliseMetrics));
  }

  /** Pickers + limits (chart kinds, period presets, sizes, widget cap, canSeeMoney, canShare). */
  options(): Observable<InsightsOptions> {
    return this.api.get<unknown>('/api/insights/options').pipe(map(normaliseOptions));
  }

  /** Names + ids a widget can be narrowed to (tenant-scoped, at most 25; `q` searches). */
  dimensions(kind: DimensionKind, q = ''): Observable<DimensionValue[]> {
    const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
    return this.api.get<unknown>(`/api/insights/dimensions/${kind}${qs}`).pipe(map(normaliseDimensions));
  }

  /** The band (branch / period over every widget) is applied by the server; the recipe is sent as is. */
  preview(recipe: InsightsRecipe, band?: PreviewBand | null): Observable<InsightsPreview> {
    return this.api.post<unknown>('/api/insights/preview', band ? { recipe, band } : { recipe }).pipe(map(normalisePreview));
  }

  list(): Observable<InsightsDashboardSummary[]> {
    return this.api.get<unknown>('/api/insights/dashboards').pipe(map(normaliseSummaries));
  }

  get(id: string): Observable<InsightsDashboard> {
    return this.api.get<unknown>(`/api/insights/dashboards/${encodeURIComponent(id)}`).pipe(map(required));
  }

  create(body: SaveDashboardRequest): Observable<InsightsDashboard> {
    return this.api.post<unknown>('/api/insights/dashboards', body).pipe(map(required));
  }

  update(id: string, body: SaveDashboardRequest): Observable<InsightsDashboard> {
    return this.api.put<unknown>(`/api/insights/dashboards/${encodeURIComponent(id)}`, body).pipe(map(required));
  }

  remove(id: string): Observable<unknown> {
    return this.api.delete<unknown>(`/api/insights/dashboards/${encodeURIComponent(id)}`);
  }

  publish(id: string, body: PublishDashboardRequest): Observable<InsightsDashboard> {
    return this.api.post<unknown>(`/api/insights/dashboards/${encodeURIComponent(id)}/publish`, body).pipe(map(required));
  }

  /** Back to a private draft (owner or lab admin). */
  unpublish(id: string): Observable<InsightsDashboard> {
    return this.api.post<unknown>(`/api/insights/dashboards/${encodeURIComponent(id)}/unpublish`, {}).pipe(map(required));
  }

  versions(id: string): Observable<InsightsDashboardVersion[]> {
    return this.api.get<unknown>(`/api/insights/dashboards/${encodeURIComponent(id)}/versions`).pipe(map(normaliseVersions));
  }

  version(id: string, version: number): Observable<InsightsDashboardVersionDetail> {
    return this.api.get<unknown>(`/api/insights/dashboards/${encodeURIComponent(id)}/versions/${Math.floor(version)}`).pipe(map((raw) => {
      const v = normaliseVersionDetail(raw);
      if (!v) throw new Error('That version came back incomplete.');
      return v;
    }));
  }

  restore(id: string, version: number): Observable<InsightsDashboard> {
    return this.api.post<unknown>(`/api/insights/dashboards/${encodeURIComponent(id)}/restore`, { version }).pipe(map(required));
  }

  /** Roles for the "Roles" visibility pick (same endpoint as Users & access). */
  roles(): Observable<{ id: string; name: string }[]> {
    return this.api.get<{ id: string; name: string }[] | null>('/api/roles/').pipe(
      map((l) => (Array.isArray(l) ? l : []).filter((r) => r && typeof r.id === 'string').map((r) => ({ id: r.id, name: String(r.name ?? r.id) }))),
    );
  }

  chat(req: InsightsChatRequest): Observable<InsightsChatReply> {
    return this.http.post<unknown>(`${this.platform.getApiUrl()}/api/assistant/insights/chat`, req).pipe(
      timeout(InsightsBuilderApiService.CHAT_TIMEOUT_MS),
      map((r) => {
        const fail = assistantFailure(r);
        if (fail) throw fail;
        return normaliseChatReply(r);
      }),
    );
  }
}

function required(raw: unknown): InsightsDashboard {
  const d = normaliseDashboard(raw);
  if (!d) throw new Error('The dashboard came back incomplete. Reload and try again.');
  return d;
}
