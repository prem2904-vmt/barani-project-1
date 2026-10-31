import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, timeout } from 'rxjs';
import { PlatformService } from '../../core/services/platform.service';
import { assistantFailure, normaliseProviders, normaliseReply } from './assistant-logic';
import type { AssistantChatRequest, AssistantPage, AssistantProvider, AssistantReply } from './assistant.models';

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
}
