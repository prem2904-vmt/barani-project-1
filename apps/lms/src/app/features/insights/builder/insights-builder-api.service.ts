import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, timeout } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { PlatformService } from '../../../core/services/platform.service';
import { assistantFailure } from '../../../shared/assistant/assistant-logic';
import {
  normaliseChatReply, normaliseDashboard, normaliseMetrics, normalisePreview, normaliseSummaries, normaliseVersions,
} from './insights-builder-logic';
import type {
  InsightsChatReply, InsightsChatRequest, InsightsDashboard, InsightsDashboardSummary, InsightsDashboardVersion, InsightsMetric,
  InsightsPreview, InsightsRecipe, PublishDashboardRequest, SaveDashboardRequest,
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

  preview(recipe: InsightsRecipe): Observable<InsightsPreview> {
    return this.api.post<unknown>('/api/insights/preview', { recipe }).pipe(map(normalisePreview));
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

  versions(id: string): Observable<InsightsDashboardVersion[]> {
    return this.api.get<unknown>(`/api/insights/dashboards/${encodeURIComponent(id)}/versions`).pipe(map(normaliseVersions));
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
