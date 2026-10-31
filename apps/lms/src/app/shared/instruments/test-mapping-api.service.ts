import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { PlatformService } from '../../core/services/platform.service';
import { MessageSummaryDto } from './instrument.models';
import { StartTestSessionBody, StartTestSessionDto, TestSessionDto, testSessionUrl } from './test-mapping';

/**
 * EVERY HTTP call of "Test with an analyzer ID" lives here, so the shapes can
 * be aligned with the server in one place (contract 2026-10-31):
 *   POST   /api/instruments/{id}/test-session            {analyzerId, sampleId} → {sessionId, status}
 *   GET    /api/instruments/{id}/test-session/{sid}       → {status, analyzerId, sampleId, routedCount, endedReason?}
 *   POST   /api/instruments/{id}/test-session/{sid}/ping
 *   DELETE /api/instruments/{id}/test-session/{sid}
 *   POST   /api/instruments/{id}/test-session/{sid}/reingest {messageId}
 * Envelope {success, data}; errors {success:false, error, message} (ApiError code/message).
 */
@Injectable({ providedIn: 'root' })
export class TestMappingApiService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly platform = inject(PlatformService);

  start(instrumentId: string, body: StartTestSessionBody): Observable<StartTestSessionDto> {
    return this.api.post<StartTestSessionDto>(testSessionUrl(instrumentId), body);
  }
  status(instrumentId: string, sessionId: string): Observable<TestSessionDto> {
    return this.api.get<TestSessionDto>(testSessionUrl(instrumentId, sessionId));
  }
  ping(instrumentId: string, sessionId: string): Observable<unknown> {
    return this.api.post<unknown>(testSessionUrl(instrumentId, sessionId, 'ping'), {});
  }
  end(instrumentId: string, sessionId: string): Observable<unknown> {
    return this.api.delete<unknown>(testSessionUrl(instrumentId, sessionId));
  }
  reingest(instrumentId: string, sessionId: string, messageId: string): Observable<MessageSummaryDto> {
    return this.api.post<MessageSummaryDto>(testSessionUrl(instrumentId, sessionId, 'reingest'), { messageId });
  }

  /**
   * End the session while the page is going away (window close / reload).
   * `navigator.sendBeacon` can only POST and cannot carry the Bearer token, so
   * it could never authenticate the (idempotent) DELETE; a
   * `fetch(…, { keepalive: true })` is the beacon that can — it outlives the
   * page like sendBeacon does. Best effort: if it is lost, the server drops
   * the session 60 s after the last ping anyway.
   */
  endOnUnload(instrumentId: string, sessionId: string): void {
    const token = this.auth.accessToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const branch = this.auth.activeBranchId();
    if (branch) headers['X-Active-Branch'] = branch;
    try {
      void fetch(`${this.platform.getApiUrl()}${testSessionUrl(instrumentId, sessionId)}`, {
        method: 'DELETE', keepalive: true, headers,
      }).catch(() => undefined);
    } catch { /* best effort — the 60 s expiry is the backstop */ }
  }
}
