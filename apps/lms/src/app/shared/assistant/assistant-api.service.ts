import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, timeout } from 'rxjs';
import { PlatformService } from '../../core/services/platform.service';
import { assistantFailure, normaliseProviders, normaliseReply, normaliseRateCardSummary } from './assistant-logic';
import type { AssistantChatRequest, AssistantPage, AssistantProvider, AssistantProviderId, AssistantReply, RateCardSummary, RateCardUpload } from './assistant.models';

/**
 * The assistant endpoints (BETA). HttpClient directly (like the AST disk
 * read) — a model answer can take longer than ApiService's 20 s ceiling, and
 * the panel needs the HTTP status to tell "not on" (404) from "limit" (429).
 * The beta interceptor adds X-PF-BETA (an empty 404 without it). Coded
 * failures arrive as HTTP 200 `{ success:false, error }` (bad_request /
 * not_found / ai_unavailable / ai_cap_reached / ai_failed) and are rethrown
 * as errors; HTTP errors pass through untouched — `assistantError()` words both.
 */
@Injectable({ providedIn: 'root' })
export class AssistantApiService {
  static readonly CHAT_TIMEOUT_MS = 90_000;
  static readonly PROVIDERS_TIMEOUT_MS = 15_000;
  /** Uploading ≤ 6 JPEG pages (≤ 15 MB) / reading them (one model call per page + one more). */
  static readonly UPLOAD_TIMEOUT_MS = 90_000;
  static readonly READ_TIMEOUT_MS = 240_000;

  private readonly http = inject(HttpClient);
  private readonly platform = inject(PlatformService);
  private url(p: string) { return `${this.platform.getApiUrl()}/api/assistant${p}`; }

  providers(): Observable<AssistantProvider[]> {
    return this.http.get<unknown>(this.url('/providers')).pipe(
      timeout(AssistantApiService.PROVIDERS_TIMEOUT_MS),
      map((r) => {
        const fail = assistantFailure(r);
        if (fail) throw fail;
        return normaliseProviders(r);
      }),
    );
  }

  chat(page: AssistantPage, req: AssistantChatRequest): Observable<AssistantReply> {
    return this.http.post<unknown>(this.url(`/${encodeURIComponent(page)}/chat`), req).pipe(
      timeout(AssistantApiService.CHAT_TIMEOUT_MS),
      map((r) => {
        const fail = assistantFailure(r);
        if (fail) throw fail;
        return normaliseReply(r);
      }),
    );
  }

  /** Test Master → "Read a rate card", step 1: store the JPEG pages (no model call). */
  rateCardUpload(pages: readonly Blob[]): Observable<RateCardUpload> {
    const form = new FormData();
    pages.forEach((b, i) => form.append('pages', b, `page-${i + 1}.jpg`));
    return this.http.post<unknown>(this.url('/test-master/rate-card'), form).pipe(
      timeout(AssistantApiService.UPLOAD_TIMEOUT_MS),
      map((r) => {
        const fail = assistantFailure(r);
        if (fail) throw fail;
        const d = ((r as { data?: Record<string, unknown> })?.data ?? {}) as Record<string, unknown>;
        const uploadId = typeof d['uploadId'] === 'string' ? d['uploadId'] : '';
        if (!uploadId) throw { status: 200, error: { error: 'ai_failed', message: '' } };
        return { uploadId, pages: Number(d['pages']) || pages.length };
      }),
    );
  }

  /** Report designer: which engines are available to Cortex "Tidy up" (needs the report-template permission). */
  reportTidyProviders(): Observable<AssistantProvider[]> {
    return this.http.get<unknown>(this.url('/report-tidy/providers')).pipe(
      timeout(AssistantApiService.PROVIDERS_TIMEOUT_MS),
      map((r) => {
        const fail = assistantFailure(r);
        if (fail) throw fail;
        return normaliseProviders(r);
      }),
    );
  }

  /** Report designer: Cortex's judgement calls on a layout. Layout settings and geometry go in; allow-listed suggestions come
   *  back. Nothing is saved anywhere by this call. */
  reportTidy(body: Record<string, unknown>): Observable<{ summary: string; changes: Array<Record<string, unknown>>; dropped: number }> {
    return this.http.post<unknown>(this.url('/report-tidy'), body).pipe(
      timeout(AssistantApiService.CHAT_TIMEOUT_MS),
      map((r) => {
        const fail = assistantFailure(r);
        if (fail) throw fail;
        const d = ((r as { data?: Record<string, unknown> })?.data ?? {}) as Record<string, unknown>;
        return {
          summary: typeof d['summary'] === 'string' ? d['summary'] : '',
          changes: Array.isArray(d['changes']) ? (d['changes'] as Array<Record<string, unknown>>) : [],
          dropped: Number(d['dropped']) || 0,
        };
      }),
    );
  }

  /** Step 2: read it. Adds PENDING suggestions only; the answer is the summary. */
  rateCardRead(uploadId: string, provider: AssistantProviderId): Observable<RateCardSummary> {
    return this.http.post<unknown>(this.url(`/test-master/rate-card/${encodeURIComponent(uploadId)}/read`), { provider }).pipe(
      timeout(AssistantApiService.READ_TIMEOUT_MS),
      map((r) => {
        const fail = assistantFailure(r);
        if (fail) throw fail;
        const s = normaliseRateCardSummary(r);
        if (!s) throw { status: 200, error: { error: 'ai_failed', message: '' } };
        return s;
      }),
    );
  }
}
