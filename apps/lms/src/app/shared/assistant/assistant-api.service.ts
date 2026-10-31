import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, timeout } from 'rxjs';
import { PlatformService } from '../../core/services/platform.service';
import { normaliseProviders, normaliseReply } from './assistant-logic';
import type { AssistantChatRequest, AssistantPage, AssistantProvider, AssistantReply } from './assistant.models';

/**
 * The assistant endpoints (BETA). HttpClient directly (like the AST disk
 * read) — a model answer can take longer than ApiService's 20 s ceiling, and
 * the panel needs the HTTP status to tell "not on" (404) from "limit" (429).
 * The beta interceptor adds X-PF-BETA; errors pass through untouched for
 * `assistantError()` to word.
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
      map((r) => normaliseProviders(r)),
    );
  }

  chat(page: AssistantPage, req: AssistantChatRequest): Observable<AssistantReply> {
    return this.http.post<unknown>(this.url(`/${encodeURIComponent(page)}/chat`), req).pipe(
      timeout(AssistantApiService.CHAT_TIMEOUT_MS),
      map((r) => {
        // ApiResponse envelope with success:false → a coded failure.
        if (r && typeof r === 'object' && (r as { success?: unknown }).success === false) {
          const b = r as { error?: string; message?: string };
          throw { status: 200, error: { error: b.error ?? 'ai_failed', message: b.message ?? '' } };
        }
        return normaliseReply(r);
      }),
    );
  }
}
