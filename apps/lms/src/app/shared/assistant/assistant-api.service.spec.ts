import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { PlatformService } from '../../core/services/platform.service';
import { AssistantApiService } from './assistant-api.service';
import { assistantError } from './assistant-logic';

/**
 * The wire contract with the backend AssistantController:
 *  - GET  /api/assistant/providers         → 200 { success, data: [{ id, label, available }] }
 *  - POST /api/assistant/instruments/chat  → 200 { success:true, data: { reply, suggestions, provider, model, usage } }
 *                                           or 200 { success:false, error: bad_request|not_found|ai_unavailable|ai_cap_reached|ai_failed, message }
 *  - either one → empty 404 when the X-PF-BETA switch is missing.
 */
describe('AssistantApiService (backend contract)', () => {
  let api: AssistantApiService;
  let http: HttpTestingController;
  const base = 'https://api.test/api/assistant';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: PlatformService, useValue: { getApiUrl: () => 'https://api.test' } }],
    });
    api = TestBed.inject(AssistantApiService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('providers: unwraps the ApiResponse envelope', async () => {
    const p = firstValueFrom(api.providers());
    const req = http.expectOne(`${base}/providers`);
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: [{ id: 'claude', label: 'Claude', available: false }, { id: 'gemini', label: 'Gemini', available: true }] });
    expect(await p).toEqual([
      { id: 'gemini', label: 'Gemini', available: true },
      { id: 'claude', label: 'Claude', available: false },
    ]);
  });

  it('providers: a success:false envelope is an error, not an empty list', async () => {
    const p = firstValueFrom(api.providers());
    http.expectOne(`${base}/providers`).flush({ success: false, error: 'ai_unavailable', message: 'x' });
    await expect(p).rejects.toMatchObject({ status: 200, error: { error: 'ai_unavailable' } });
  });

  it('providers: empty 404 (beta header missing) reads as "off"', async () => {
    const p = firstValueFrom(api.providers());
    http.expectOne(`${base}/providers`).flush(null, { status: 404, statusText: 'Not Found' });
    const e = await p.catch((x) => x);
    expect(assistantError(e).kind).toBe('off');
  });

  it('chat: posts to /instruments/chat with the request DTO and unwraps the reply', async () => {
    const p = firstValueFrom(api.chat('instruments', { provider: 'gemini', instrumentId: 'i-1', messages: [{ role: 'user', text: 'hi' }] }));
    const req = http.expectOne(`${base}/instruments/chat`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ provider: 'gemini', instrumentId: 'i-1', messages: [{ role: 'user', text: 'hi' }] });
    req.flush({ success: true, data: {
      reply: 'Set the host IP.', provider: 'gemini', model: 'gemini-x', usage: { inputTokens: 10, outputTokens: 5 },
      suggestions: [{ kind: 'setting', label: 'Host IP', value: '192.168.1.8', note: null, text: null, analyzerCode: null, unit: null, tests: null, confidence: null, why: null }],
    } });
    const r = await p;
    expect(r.reply).toBe('Set the host IP.');
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(r.suggestions).toEqual([{ kind: 'setting', label: 'Host IP', value: '192.168.1.8', note: null }]);
  });

  for (const [code, kind] of [
    ['bad_request', 'invalid'], ['not_found', 'missing'], ['ai_unavailable', 'provider'], ['ai_cap_reached', 'limit'], ['ai_failed', 'failed'],
  ] as const) {
    it(`chat: HTTP 200 success:false "${code}" → ${kind}`, async () => {
      const p = firstValueFrom(api.chat('instruments', { provider: 'claude', messages: [{ role: 'user', text: 'q' }] }));
      http.expectOne(`${base}/instruments/chat`).flush({ success: false, error: code, message: 'server words' });
      const e = await p.catch((x) => x);
      expect(e).toMatchObject({ status: 200, error: { error: code, message: 'server words' } });
      expect(assistantError(e, 'Claude').kind).toBe(kind);
    });
  }

  it('chat: empty 404 (beta header missing) reads as "off"', async () => {
    const p = firstValueFrom(api.chat('instruments', { provider: 'gemini', messages: [{ role: 'user', text: 'q' }] }));
    http.expectOne(`${base}/instruments/chat`).flush(null, { status: 404, statusText: 'Not Found' });
    const e = await p.catch((x) => x);
    expect(assistantError(e).kind).toBe('off');
  });
});
