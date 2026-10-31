import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderBandPage } from '../../admin/admin-band.spec-helpers';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { SessionService } from '../../../core/auth/session.service';
import { PlatformService } from '../../../core/services/platform.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { INSTRUMENT_BRIDGE_SOURCE } from '../../../shared/instruments/instrument-bridge.service';
import type { InstrumentDto, MessageSummaryDto } from '../../../shared/instruments/instrument.models';
import { FX_INSTRUMENTS } from '../../../shared/bridges/testing/bridge-fixtures';
import {
  TEST_MAPPING_PING_MS, canTestWithId, endedNote, fmtMinSec, isSessionGone, isSessionReplaced, isViaTestMapping, latestUnmatchedAnalyzerId, sameAnalyzerId,
  TEST_MAPPING_PERMS, testMappingErrorText, testMappingLine, testSessionUrl,
} from '../../../shared/instruments/test-mapping';
import { analyzerBadge, valuesForRun } from '../../../shared/instruments/instrument-prefill';
import { TestMappingService } from '../../../shared/instruments/test-mapping.service';
import { InstrumentEditorComponent } from './instrument-editor.component';

/**
 * "Test with an analyzer ID" (owner 2026-10-31): a one-time temporary mapping
 * on the instrument's Status tab. Pins: the wire calls (one service), the
 * keep-alive, every way it ends (Close, route leave, window close, logout,
 * server says ended / gone), the "Test with this ID" quick action (prefill,
 * or re-run when that ID is already being tested), the "via test mapping"
 * badge, and that it is hidden without the instrument-editing permission.
 */

const INST = 'inst-1';
const msg = (p: Partial<MessageSummaryDto>): MessageSummaryDto => ({
  id: 'm', instrumentId: INST, instrumentName: 'Haem', sampleId: null, state: 'matched', isQc: false, protocol: 'astm',
  receivedAt: '2026-10-31T05:00:00Z', resultCount: 3, mappedCount: 3, ...p,
});

// ── Pure helpers ─────────────────────────────────────────────────────────
describe('test mapping — pure helpers', () => {
  it('URLs follow the contract', () => {
    expect(testSessionUrl('a b')).toBe('/api/instruments/a%20b/test-session');
    expect(testSessionUrl('i', 's')).toBe('/api/instruments/i/test-session/s');
    expect(testSessionUrl('i', 's', 'ping')).toBe('/api/instruments/i/test-session/s/ping');
    expect(testSessionUrl('i', 's', 'reingest')).toBe('/api/instruments/i/test-session/s/reingest');
  });

  it('prefill = newest unmatched, non-QC result with an ID', () => {
    expect(latestUnmatchedAnalyzerId([])).toBe('');
    expect(latestUnmatchedAnalyzerId([
      msg({ id: '1', state: 'unmatched', sampleId: '8501', receivedAt: '2026-10-31T05:00:00Z' }),
      msg({ id: '2', state: 'unmatched', sampleId: ' 8507 ', receivedAt: '2026-10-31T06:00:00Z' }),
      msg({ id: '3', state: 'unmatched', sampleId: 'QC1', isQc: true, receivedAt: '2026-10-31T07:00:00Z' }),
      msg({ id: '4', state: 'matched', sampleId: '26117', receivedAt: '2026-10-31T08:00:00Z' }),
    ])).toBe('8507');
  });

  it('IDs compare trimmed + case-insensitive; blank never matches', () => {
    expect(sameAnalyzerId(' ab12 ', 'AB12')).toBe(true);
    expect(sameAnalyzerId('', '')).toBe(false);
    expect(sameAnalyzerId('8507', '8508')).toBe(false);
  });

  it('quick action only on unmatched, non-QC rows with an ID; badge from viaTestAlias', () => {
    expect(canTestWithId(msg({ state: 'unmatched', sampleId: '8507' }))).toBe(true);
    expect(canTestWithId(msg({ state: 'unmatched', sampleId: '' }))).toBe(false);
    expect(canTestWithId(msg({ state: 'unmatched', sampleId: '8507', isQc: true }))).toBe(false);
    expect(canTestWithId(msg({ state: 'matched', sampleId: '8507' }))).toBe(false);
    expect(isViaTestMapping(msg({ viaTestAlias: true }))).toBe(true);
    expect(isViaTestMapping(msg({}))).toBe(false);
  });

  it('plain-words lines', () => {
    expect(testMappingLine({ analyzerId: '8507', sampleLabel: '26117', status: 'waiting', routedCount: 0, quietSecondsLeft: null })).toBe('Waiting for 8507 → sample 26117…');
    expect(testMappingLine({ analyzerId: '8507', sampleLabel: '26117', status: 'received', routedCount: 3, quietSecondsLeft: 72 }))
      .toBe('Receiving from 8507 → 26117 — 3 results so far. Finishes after 90 s with no new results (1:12 left).');
    expect(testMappingLine({ analyzerId: '8507', sampleLabel: '26117', status: 'received', routedCount: 1, quietSecondsLeft: null }))
      .toBe('Receiving from 8507 → 26117 — 1 result so far. Finishes after 90 s with no new results.');
    expect(fmtMinSec(72)).toBe('1:12');
    expect(fmtMinSec(5)).toBe('0:05');
    expect(fmtMinSec(-3)).toBe('0:00');
    expect(endedNote({ analyzerId: '8507', sampleLabel: '26117', routedCount: 5 }, 'done')).toBe('Done — 5 results attached to 26117.');
    expect(endedNote({ analyzerId: '8507', sampleLabel: '26117', routedCount: 0 }, 'expired')).toContain('timed out');
  });

  it('server error codes in plain words (session_in_use keeps the server\'s who/when)', () => {
    expect(testMappingErrorText(new ApiError('sample_not_found', 'sample_not_found'), { sample: '26117' })).toBe('Sample 26117 not found.');
    expect(testMappingErrorText(new ApiError('Being tested by Priya since 7:20 PM', 'session_in_use'))).toBe('Being tested by Priya since 7:20 PM');
    expect(testMappingErrorText(new ApiError('session_in_use', 'session_in_use'))).toContain('Someone else is testing this analyzer');
    expect(testMappingErrorText(new ApiError('x', 'instrument_inactive'))).toContain('switched off');
    expect(testMappingErrorText(new ApiError('x', 'invalid_analyzer_id'))).toContain('analyzer ID');
    expect(testMappingErrorText(new ApiError('x', 'too_old'))).toContain('older than 10 minutes');
    expect(testMappingErrorText(new ApiError('x', 'not_unmatched'))).toContain('no longer unmatched');
    expect(testMappingErrorText(new ApiError('x', 'no_alias'), { analyzerId: '8507' })).toContain('8507');
    expect(testMappingErrorText(new ApiError('Boom'))).toBe('Boom');
  });

  it('permission set = manage_lab_settings or manage_tenant', () => {
    expect(TEST_MAPPING_PERMS).toEqual(['manage_lab_settings', 'manage_tenant']);
  });

  it('result-entry prefill badge says "via test mapping" for a routed run only', () => {
    const lines = [{ orderTestId: 'ot1', params: [{ name: 'WBC' }] }] as never;
    const run = (via: boolean) => ({ messageId: 'm1', instrumentId: INST, instrumentName: 'Horiba', receivedAt: '2026-10-31T06:00:00Z', state: 'matched',
      values: [{ analyzerCode: 'WBC', orderTestId: 'ot1', testId: 't', catalogKey: 'k', parameterName: 'WBC', value: '7.2' }], ...(via ? { viaTestAlias: true } : {}) });
    const fmt = () => '7:28 PM';
    expect(analyzerBadge(valuesForRun(run(true), lines), 'ot1', 'WBC', '7.2', fmt)!.label).toBe('From Horiba · 7:28 PM · via test mapping');
    expect(analyzerBadge(valuesForRun(run(false), lines), 'ot1', 'WBC', '7.2', fmt)!.label).toBe('From Horiba · 7:28 PM');
  });

  it('session_replaced is its own state, with plain words', () => {
    expect(isSessionReplaced(new ApiError('x', 'session_replaced'))).toBe(true);
    expect(isSessionReplaced(new ApiError('x', 'session_gone'))).toBe(false);
    expect(endedNote({ analyzerId: '8507', sampleLabel: '26117', routedCount: 2 }, 'replaced')).toBe('Ended — started again elsewhere.');
    expect(testMappingErrorText(new ApiError('x', 'sample_not_testable'))).toBe('Pick a tube that has no results yet.');
  });

  it('session gone = session_gone / not_found code or a bare 404', () => {
    expect(isSessionGone(new ApiError('x', 'session_gone'))).toBe(true);
    expect(isSessionGone(new ApiError('x', 'not_found'))).toBe(true);
    expect(isSessionGone(new ApiError('Http failure response for …: 404 Not Found'))).toBe(true);
    expect(isSessionGone(new ApiError('Request timed out'))).toBe(false);
  });
});

// ── Service lifecycle ────────────────────────────────────────────────────
function svcSetup(statusSeq: unknown[] = []) {
  const seq = [...statusSeq];
  const api = {
    get: vi.fn((u: string) => {
      const next = seq.length > 1 ? seq.shift() : seq[0];
      if (next instanceof Error) return throwError(() => next);
      return of(next ?? { status: 'waiting', analyzerId: '8507', sampleId: 'smp-1', routedCount: 0 });
    }),
    post: vi.fn((u: string, body?: { sampleId?: string }) => {
      if (u.endsWith('/test-session')) {
        return body?.sampleId === 'NOPE'
          ? throwError(() => new ApiError('sample_not_found', 'sample_not_found'))
          : of({ sessionId: 'sid-1', status: 'waiting', pingEverySeconds: 15, expiresAfterSeconds: 60, quietSeconds: 90 });
      }
      return of({ ok: true, expiresAfterSeconds: 60 });
    }),
    delete: vi.fn(() => of({})),
    put: vi.fn(() => of({})), patch: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: AuthService, useValue: { accessToken: () => 'tok-1', activeBranchId: () => 'br-1' } },
      { provide: PlatformService, useValue: { getApiUrl: () => 'https://api.example' } },
    ],
  });
  return { api, svc: TestBed.inject(TestMappingService) };
}

describe('TestMappingService — lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); TestBed.resetTestingModule(); });

  it('start POSTs {analyzerId, sampleId: the typed tube number}, then pings every 15 s', async () => {
    const { api, svc } = svcSetup();
    const r = await svc.start(INST, ' 8507 ', ' 26117 ');
    expect(r).toEqual({ ok: true });
    expect(api.post).toHaveBeenCalledWith('/api/instruments/inst-1/test-session', { analyzerId: '8507', sampleId: '26117' });
    expect(svc.active()).toMatchObject({ sessionId: 'sid-1', analyzerId: '8507', sampleLabel: '26117', status: 'waiting' });

    const pings = () => api.post.mock.calls.filter((c) => (c as unknown[])[0] === '/api/instruments/inst-1/test-session/sid-1/ping').length;
    await vi.advanceTimersByTimeAsync(TEST_MAPPING_PING_MS - 1);
    expect(pings()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(pings()).toBe(1);
    await vi.advanceTimersByTimeAsync(TEST_MAPPING_PING_MS);
    expect(pings()).toBe(2);
    await svc.end('closed');
  });

  it('unknown sample (400 sample_not_found) → plain error, no session', async () => {
    const { svc } = svcSetup();
    const r = await svc.start(INST, '8507', 'NOPE');
    expect(r).toEqual({ ok: false, error: 'Sample NOPE not found.' });
    expect(svc.active()).toBeNull();
  });

  it('only one test at a time', async () => {
    const { svc } = svcSetup();
    await svc.start(INST, '8507', '26117');
    expect(await svc.start(INST, '8508', '26118')).toEqual({ ok: false, error: 'A test is already running — close it first' });
    await svc.end('closed');
  });

  it('received → ended: routed tick, "Done." note, timers stop (no more pings)', async () => {
    const { api, svc } = svcSetup([
      { status: 'received', analyzerId: '8507', sampleId: 'smp-1', barcode: '26117', routedCount: 3, quietSecondsLeft: 88 },
      { status: 'received', analyzerId: '8507', sampleId: 'smp-1', barcode: '26117', routedCount: 3, quietSecondsLeft: 85 },
      { status: 'ended', analyzerId: '8507', sampleId: 'smp-1', barcode: '26117', routedCount: 5, endedReason: 'completed' },
    ]);
    await svc.start(INST, '8507', '26117');
    await vi.advanceTimersByTimeAsync(0); // the immediate first poll
    expect(svc.active()).toMatchObject({ status: 'received', routedCount: 3, quietSecondsLeft: 88 });
    expect(svc.routedTick()).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(svc.active()).toMatchObject({ quietSecondsLeft: 85 });
    expect(svc.routedTick()).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(svc.active()).toBeNull();
    expect(svc.note()).toBe('Done — 5 results attached to 26117.');
    const before = api.post.mock.calls.length;
    await vi.advanceTimersByTimeAsync(TEST_MAPPING_PING_MS * 2);
    expect(api.post.mock.calls.length).toBe(before);
  });

  it('GET says 404 session_gone → ends with a timed-out note', async () => {
    const { svc } = svcSetup([new ApiError('session_gone', 'session_gone')]);
    await svc.start(INST, '8507', '26117');
    await vi.advanceTimersByTimeAsync(3000);
    expect(svc.active()).toBeNull();
    expect(svc.note()).toContain('timed out');
  });

  it('ping/poll 404 session_replaced → ends with the "started again elsewhere" note', async () => {
    const { svc } = svcSetup([new ApiError('Ended — started again elsewhere.', 'session_replaced')]);
    await svc.start(INST, '8507', '26117');
    await vi.advanceTimersByTimeAsync(3000);
    expect(svc.active()).toBeNull();
    expect(svc.note()).toBe('Ended — started again elsewhere.');
  });

  it('Close → DELETE …/test-session/{sid}; nothing keeps running', async () => {
    const { api, svc } = svcSetup();
    await svc.start(INST, '8507', '26117');
    await svc.end('closed');
    expect(api.delete).toHaveBeenCalledWith('/api/instruments/inst-1/test-session/sid-1');
    expect(svc.active()).toBeNull();
    const before = api.post.mock.calls.length + api.get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(TEST_MAPPING_PING_MS * 2);
    expect(api.post.mock.calls.length + api.get.mock.calls.length).toBe(before);
  });

  it('"Finish now" while receiving → DELETE and the "Done — N results" note', async () => {
    const { api, svc } = svcSetup([{ status: 'received', analyzerId: '8507', sampleId: 'smp-1', routedCount: 3, quietSecondsLeft: 60 }]);
    await svc.start(INST, '8507', '26117');
    await vi.advanceTimersByTimeAsync(3000);
    await svc.end('closed');
    expect(api.delete).toHaveBeenCalledWith('/api/instruments/inst-1/test-session/sid-1');
    expect(svc.note()).toBe('Done — 3 results attached to 26117.');
  });

  it.each(['beforeunload', 'pagehide'])('window %s → keepalive DELETE with the Bearer token (beacon)', async (evt) => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal('fetch', fetchSpy);
    const { svc } = svcSetup();
    await svc.start(INST, '8507', '26117');
    window.dispatchEvent(new Event(evt));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/api/instruments/inst-1/test-session/sid-1');
    expect(init).toMatchObject({ method: 'DELETE', keepalive: true });
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-1');
    expect((init.headers as Record<string, string>)['X-Active-Branch']).toBe('br-1');
    expect(svc.active()).toBeNull();
    // Listeners are gone once it ended — a second unload sends nothing.
    window.dispatchEvent(new Event(evt));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('re-run: POST …/reingest {messageId} only while a test runs', async () => {
    const { api, svc } = svcSetup();
    expect(await svc.reingest('msg-9')).toEqual({ ok: false, error: 'No test is running' });
    await svc.start(INST, '8507', '26117');
    expect(svc.isRunningFor(INST, ' 8507')).toBe(true);
    expect(svc.isRunningFor('other', '8507')).toBe(false);
    expect(await svc.reingest('msg-9')).toEqual({ ok: true });
    expect(api.post).toHaveBeenCalledWith('/api/instruments/inst-1/test-session/sid-1/reingest', { messageId: 'msg-9' });
    await svc.end('closed');
  });
});

// ── Logout ends it ───────────────────────────────────────────────────────
@Component({ template: '' })
class BlankComponent {}

describe('sign-out ends a running test mapping', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('SessionService.logout → TestMappingService.end("logout") before the session is cleared', async () => {
    const order: string[] = [];
    const tm = { end: vi.fn(async () => { order.push('test-mapping'); }) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'login', component: BlankComponent }]),
        { provide: TestMappingService, useValue: tm },
        {
          provide: AuthService, useValue: {
            setSessionEndHandler: () => undefined, revokeSession: async () => undefined, stopSessionTimers: () => undefined,
            clearLocalSession: () => { order.push('clear'); }, session: () => null, user: () => null,
          },
        },
      ],
    });
    await TestBed.inject(SessionService).logout();
    expect(tm.end).toHaveBeenCalledWith('logout');
    expect(order).toEqual(['test-mapping', 'clear']);
  });
});

// ── The Status-tab card + quick action + badge + permission ──────────────
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

function renderEditor(dto: InstrumentDto, messages: MessageSummaryDto[], opts: { allowed?: boolean } = {}) {
  const p = renderBandPage(InstrumentEditorComponent, {
    getFor: (u) => {
      if (u === `/api/instruments/${dto.id}`) return dto;
      if (u.startsWith('/api/instruments/messages')) return { items: messages, total: messages.length, page: 1, pageSize: 20 };
      if (u.includes('/test-session/')) return { status: 'waiting', analyzerId: '8507', sampleId: 'smp-1', routedCount: 0 };
      if (u.startsWith('/api/config/sample-search-preset')) return { preset: '', enabled: false };
      return [];
    },
    providers: [
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: dto.id }) } } },
      { provide: PlatformService, useValue: { getApiUrl: () => 'https://api.example', isElectron: () => false } },
      { provide: INSTRUMENT_BRIDGE_SOURCE, useValue: () => undefined },
      ...(opts.allowed === false ? [{
        provide: AuthService, useValue: {
          user: () => ({ tenantName: 'Micro World', firstName: 'Tech', permissions: [] }),
          hasPermission: () => false, hasAnyPermission: () => false, isAuthenticated: () => true, waitForAuth: async () => undefined,
        },
      }] : []),
    ],
  });
  p.api.post.mockImplementation(((u: string) => of(u.endsWith('/test-session') ? { sessionId: 'sid-1', status: 'waiting' } : {})) as never);
  return p;
}

describe('Instrument editor — "Test with an analyzer ID" card', () => {
  afterEach(async () => {
    try { await TestBed.inject(TestMappingService).end('closed'); } catch { /* module gone */ }
    TestBed.resetTestingModule();
  });

  const dto = FX_INSTRUMENTS[2];
  const recent = [
    msg({ id: 'u1', instrumentId: dto.id, state: 'unmatched', sampleId: '8507', receivedAt: '2026-10-31T06:00:00Z' }),
    msg({ id: 'r1', instrumentId: dto.id, state: 'matched', sampleId: '26117', viaTestAlias: true, receivedAt: '2026-10-31T06:01:00Z' }),
    msg({ id: 'u0', instrumentId: dto.id, state: 'unmatched', sampleId: '8490', receivedAt: '2026-10-31T05:00:00Z' }),
  ];

  it('Status tab shows the card, its plain-words explanation, the analyzer ID prefilled from the latest unmatched result', async () => {
    const p = renderEditor(dto, recent);
    await flush(); p.f.detectChanges();
    const card = p.el.querySelector('pf-test-mapping-card');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain('Test with an analyzer ID');
    expect(card!.textContent).toContain('Closing the page stops it.');
    expect(card!.querySelector<HTMLInputElement>('input[name="analyzerId"]')!.value).toBe('8507');
    // No list of aliases / no extra screen: exactly two inputs and Start.
    expect(card!.querySelectorAll('input').length).toBe(2);
    expect(card!.querySelector('button[type="submit"]')!.textContent).toContain('Start');
  });

  it('"via test mapping" badge on routed results only', async () => {
    const p = renderEditor(dto, recent);
    await flush(); p.f.detectChanges();
    const rows = Array.from(p.el.querySelectorAll('.pf-ie-msg'));
    expect(rows.map((r) => !!r.querySelector('.pf-ie-msg__via'))).toEqual([false, true, false]);
    expect(rows[1].textContent).toContain('via test mapping');
  });

  it('"Test with this ID" prefills the card; Start shows "Waiting for … → sample …"; Close ends it', async () => {
    const p = renderEditor(dto, recent);
    await flush(); p.f.detectChanges();
    const rows = Array.from(p.el.querySelectorAll('.pf-ie-msg'));
    expect(rows[1].querySelector('.pf-rowact')).toBeNull(); // matched row: no quick action
    (rows[2].querySelector('.pf-rowact') as HTMLButtonElement).click();
    await flush(); p.f.detectChanges();
    const card = p.el.querySelector('pf-test-mapping-card')!;
    expect(card.querySelector<HTMLInputElement>('input[name="analyzerId"]')!.value).toBe('8490');

    const sample = card.querySelector<HTMLInputElement>('input[name="sampleCode"]')!;
    sample.value = '26117'; sample.dispatchEvent(new Event('input')); p.f.detectChanges();
    (card.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await flush(); p.f.detectChanges();
    expect(p.api.post).toHaveBeenCalledWith(`/api/instruments/${dto.id}/test-session`, { analyzerId: '8490', sampleId: '26117' });
    expect(card.textContent).toContain('Waiting for 8490 → sample 26117…');
    expect(card.textContent).toContain('stops the test');

    const close = Array.from(card.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Close') as HTMLButtonElement;
    close.click();
    await flush(); p.f.detectChanges();
    expect(p.api.delete).toHaveBeenCalledWith(`/api/instruments/${dto.id}/test-session/sid-1`);
    expect(card.querySelector('input[name="analyzerId"]')).not.toBeNull();
  });

  it('"Test with this ID" for the ID already being tested → re-runs that result (reingest), no new session', async () => {
    const p = renderEditor(dto, recent);
    await flush(); p.f.detectChanges();
    const svc = TestBed.inject(TestMappingService);
    await svc.start(dto.id, '8507', '26117');
    p.api.post.mockClear();
    await p.cmp.testWithId(recent[0]);
    expect(p.api.post).toHaveBeenCalledWith(`/api/instruments/${dto.id}/test-session/sid-1/reingest`, { messageId: 'u1' });
    expect(p.api.post).not.toHaveBeenCalledWith(`/api/instruments/${dto.id}/test-session`, expect.anything());
    expect(p.toasts.success).toHaveBeenCalled();
  });

  it('switching tabs keeps the test running (no DELETE), shows "Testing…" on the Status tab, and the card resumes', async () => {
    const p = renderEditor(dto, recent);
    await flush(); p.f.detectChanges();
    const svc = TestBed.inject(TestMappingService);
    await svc.start(dto.id, '8507', '26117');
    p.f.detectChanges();
    const marker = () => p.el.querySelector('.pf-ie-testing');
    expect(marker()?.textContent).toContain('Testing…');

    p.cmp.go('basics');
    await flush(); p.f.detectChanges();
    expect(p.el.querySelector('pf-test-mapping-card')).toBeNull(); // the Status card is gone from the DOM...
    expect(p.api.delete).not.toHaveBeenCalled();                    // ...but the test is NOT ended
    expect(svc.active()).not.toBeNull();
    expect(marker()?.textContent).toContain('Testing…');            // marker visible from any tab

    p.cmp.go('status');
    await flush(); p.f.detectChanges();
    expect(p.el.querySelector('pf-test-mapping-card')!.textContent).toContain('Waiting for 8507 → sample 26117…');
    expect(p.api.delete).not.toHaveBeenCalled();

    p.f.destroy(); // leaving the PAGE ends it
    await flush();
    expect(p.api.delete).toHaveBeenCalledTimes(1);
    expect(p.api.delete).toHaveBeenCalledWith(`/api/instruments/${dto.id}/test-session/sid-1`);
  });

  it('a test started again elsewhere ends this panel with "Ended — started again elsewhere."', async () => {
    const p = renderEditor(dto, recent);
    await flush(); p.f.detectChanges();
    const svc = TestBed.inject(TestMappingService);
    await svc.start(dto.id, '8507', '26117');
    p.api.post.mockImplementation((() => throwError(() => new ApiError('Ended — started again elsewhere.', 'session_replaced'))) as never);
    await vi.waitFor(async () => { await new Promise((r) => setTimeout(r, 20)); });
    await svc.reingest('u1');
    expect(svc.active()).toBeNull();
    expect(svc.note()).toBe('Ended — started again elsewhere.');
  });

  it('leaving the page (route leave) ends the running test', async () => {
    const p = renderEditor(dto, recent);
    await flush(); p.f.detectChanges();
    const svc = TestBed.inject(TestMappingService);
    await svc.start(dto.id, '8507', '26117');
    p.f.destroy();
    await flush();
    expect(p.api.delete).toHaveBeenCalledWith(`/api/instruments/${dto.id}/test-session/sid-1`);
    expect(svc.active()).toBeNull();
  });

  it('without the instrument-editing permission: no card, no quick action', async () => {
    const p = renderEditor(dto, recent, { allowed: false });
    await flush(); p.f.detectChanges();
    expect(p.el.querySelector('pf-test-mapping-card')).toBeNull();
    expect(p.el.querySelector('.pf-ie-msg .pf-rowact')).toBeNull();
    // The badge is information, not an action — it still shows.
    expect(p.el.querySelector('.pf-ie-msg__via')).not.toBeNull();
  });
});
