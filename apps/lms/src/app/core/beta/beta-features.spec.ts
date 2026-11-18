import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { BetaFeaturesService, betaGuard, betaHeaderInterceptor, isOurApiRequest, makeBetaHeaderInterceptor } from '../services/beta-features.service';
import {
  BETA_HEADER, BetaStorage, betaFlagKey, betaHeaderValue, betaVisible, installPfBeta, isDevEnvironment,
  parseBetaFlags, readBetaSwitches,
} from './beta-gate';

/**
 * Beta features (owner 2026-10-31): visible ONLY with the console switch
 * pf.<name>() in this browser AND the server's flag (asked with X-PF-BETA)
 * AND the dev environment. Default off; any error ⇒ off.
 */
function memStorage(init: Record<string, string> = {}): BetaStorage & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
    removeItem: (k) => { delete data[k]; },
  };
}

const DEV = { auth: { supabaseUrl: 'https://cottlnsbjnstsgknsgzu.supabase.co' } };
const STAGE = { auth: { supabaseUrl: 'https://gxmbbjmcfuxqzdfczrma.supabase.co' } };
const PROD = { auth: { supabaseUrl: 'https://hslcncwhgqezbqkdowyy.supabase.co' } };

describe('beta gate rules', () => {
  it('console switches: pf.mcp() on, pf.mcp(false) off, each reloads; merges into window.pf (keeps pf.opd)', () => {
    const st = memStorage();
    const opd = vi.fn();
    const win: { pf?: Record<string, unknown> } & Record<string, unknown> = { pf: { opd } };
    const reload = vi.fn();
    const log = vi.fn();
    installPfBeta(win, st, reload, log);
    expect(win.pf!['opd']).toBe(opd);
    (win.pf!['mcp'] as () => void)();
    expect(st.data[betaFlagKey('mcp')]).toBe('1');
    expect(reload).toHaveBeenCalledTimes(1);
    (win.pf!['passkeys'] as () => void)();
    expect((win.pf!['beta'] as () => string[])()).toEqual(['mcp', 'passkeys']);
    expect(log).toHaveBeenCalledWith('Beta on in this browser: mcp, passkeys');
    (win.pf!['mcp'] as (on: boolean) => void)(false);
    expect(st.data[betaFlagKey('mcp')]).toBeUndefined();
    expect(readBetaSwitches(st)).toEqual({ mcp: false, passkeys: true, assistant: false, support: false, neuron: false, settingsaccess: false });
    expect(reload).toHaveBeenCalledTimes(3);
  });

  it('header value lists the switches that are on, or nothing', () => {
    expect(betaHeaderValue(memStorage())).toBeNull();
    expect(betaHeaderValue(memStorage({ 'pf.beta.assistant': '1', 'pf.beta.mcp': '1' }))).toBe('mcp,assistant');
    expect(betaHeaderValue(memStorage({ 'pf.beta.mcp': 'yes' }))).toBeNull();
  });

  it('dev = the dev Supabase project; stage / prod / unknown are not', () => {
    expect(isDevEnvironment(DEV)).toBe(true);
    expect(isDevEnvironment({ auth: { supabaseUrl: DEV.auth.supabaseUrl + '/' } })).toBe(true);
    expect(isDevEnvironment(STAGE)).toBe(false);
    expect(isDevEnvironment(PROD)).toBe(false);
    expect(isDevEnvironment(null)).toBe(false);
  });

  it('server answer: only literal true; envelope or bare; aiConnector aliases mcp; junk ⇒ all off', () => {
    expect(parseBetaFlags({ success: true, data: { mcp: true, passkeys: 'true' } })).toEqual({ mcp: true, passkeys: false, assistant: false, support: false, neuron: false, settingsaccess: false });
    expect(parseBetaFlags({ aiConnector: true, assistant: true })).toEqual({ mcp: true, passkeys: false, assistant: true, support: false, neuron: false, settingsaccess: false });
    expect(parseBetaFlags(null)).toEqual({ mcp: false, passkeys: false, assistant: false, support: false, neuron: false, settingsaccess: false });
    expect(parseBetaFlags([true])).toEqual({ mcp: false, passkeys: false, assistant: false, support: false, neuron: false, settingsaccess: false });
    expect(parseBetaFlags({ data: { support: true } }).support).toBe(true);
    expect(parseBetaFlags({ support: 'true' }).support).toBe(false);
  });

  it('visible only when ALL three hold', () => {
    for (const switchOn of [true, false]) for (const serverAllowed of [true, false]) for (const isDev of [true, false]) {
      expect(betaVisible({ switchOn, serverAllowed, isDev })).toBe(switchOn && serverAllowed && isDev);
    }
  });
});

/** The service with a controllable storage + environment. */
@Injectable()
class TestBeta extends BetaFeaturesService {
  static st: BetaStorage = memStorage();
  static dev = true;
  protected override openStorage(): BetaStorage { return TestBeta.st; }
  protected override isDev(): boolean { return TestBeta.dev; }
}

function service(opts: { switches?: Record<string, string>; dev?: boolean; fetch?: () => Promise<Response> } = {}) {
  TestBeta.st = memStorage(opts.switches ?? {});
  TestBeta.dev = opts.dev ?? true;
  const fetchMock = vi.fn(opts.fetch ?? (async () => new Response(JSON.stringify({ success: true, data: { mcp: true } }), { status: 200 })));
  vi.stubGlobal('fetch', fetchMock);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: BetaFeaturesService, useClass: TestBeta }] });
  return { beta: TestBed.inject(BetaFeaturesService), fetchMock };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('BetaFeaturesService', () => {
  it('off by default: no switch ⇒ never even asks the server', async () => {
    const { beta, fetchMock } = service();
    await beta.ensureLoaded();
    expect(beta.enabled('mcp')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('on: switch + dev + server true; asks ONCE, sending X-PF-BETA', async () => {
    const { beta, fetchMock } = service({ switches: { 'pf.beta.mcp': '1' } });
    expect(beta.enabled('mcp')).toBe(false);            // nothing before the answer
    await Promise.all([beta.ensureLoaded(), beta.ensureLoaded()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/beta-features$/);
    expect((init.headers as Record<string, string>)[BETA_HEADER]).toBe('mcp');
    expect(beta.enabled('mcp')).toBe(true);
    expect(beta.enabled('passkeys')).toBe(false);       // server didn't allow it, no switch either
  });

  it('server says no / errors / garbage ⇒ off', async () => {
    let r = service({ switches: { 'pf.beta.mcp': '1' }, fetch: async () => new Response(JSON.stringify({ success: true, data: { mcp: false } })) });
    await r.beta.ensureLoaded();
    expect(r.beta.enabled('mcp')).toBe(false);
    r = service({ switches: { 'pf.beta.mcp': '1' }, fetch: async () => new Response('oops', { status: 500 }) });
    await r.beta.ensureLoaded();
    expect(r.beta.enabled('mcp')).toBe(false);
    r = service({ switches: { 'pf.beta.mcp': '1' }, fetch: async () => { throw new TypeError('Failed to fetch'); } });
    await r.beta.ensureLoaded();
    expect(r.beta.enabled('mcp')).toBe(false);
    r = service({ switches: { 'pf.beta.mcp': '1' }, fetch: async () => new Response('not json', { status: 200 }) });
    await r.beta.ensureLoaded();
    expect(r.beta.enabled('mcp')).toBe(false);
  });

  it('not dev (stage / prod) ⇒ off even with the switch on and the server saying true', async () => {
    const { beta, fetchMock } = service({ switches: { 'pf.beta.mcp': '1' }, dev: false });
    await beta.ensureLoaded();
    expect(beta.enabled('mcp')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('server true but NO switch in this browser ⇒ off', async () => {
    const { beta } = service({ switches: { 'pf.beta.passkeys': '1' } });
    await beta.ensureLoaded();
    expect(beta.enabled('mcp')).toBe(false);
  });

  it('passkeys: ON only with switch + dev + a literal server true (sends X-PF-BETA: passkeys)', async () => {
    const { beta, fetchMock } = service({ switches: { 'pf.beta.passkeys': '1' },
      fetch: async () => new Response(JSON.stringify({ mcp: false, passkeys: true, assistant: false }), { status: 200 }) });
    await beta.ensureLoaded();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)[BETA_HEADER]).toBe('passkeys');
    expect(beta.enabled('passkeys')).toBe(true);
    expect(beta.enabled('mcp')).toBe(false);
  });

  // Owner rule: ANY error / server unreachable / non-true value = OFF. (The
  // pre-merge passkey gate let an unreachable server count as "didn't say no".)
  it.each([
    ['unreachable (fetch throws)', async () => { throw new TypeError('Failed to fetch'); }],
    ['timeout / abort', async () => { throw new DOMException('aborted', 'AbortError'); }],
    ['HTTP 500', async () => new Response('oops', { status: 500 })],
    ['HTTP 404 (old server, no endpoint)', async () => new Response('', { status: 404 })],
    ['not JSON', async () => new Response('<html>', { status: 200 })],
    ['passkeys missing', async () => new Response(JSON.stringify({ mcp: true }), { status: 200 })],
    ['passkeys "true" (string)', async () => new Response(JSON.stringify({ passkeys: 'true' }), { status: 200 })],
    ['passkeys 1', async () => new Response(JSON.stringify({ passkeys: 1 }), { status: 200 })],
    ['passkeys null', async () => new Response(JSON.stringify({ passkeys: null }), { status: 200 })],
  ] as [string, () => Promise<Response>][])('passkeys OFF when the server answer is %s', async (_label, f) => {
    const { beta } = service({ switches: { 'pf.beta.passkeys': '1' }, fetch: f });
    await beta.ensureLoaded();
    expect(beta.enabled('passkeys')).toBe(false);
  });

  it('betaGuard: off ⇒ the normal unknown-URL landing (/); on ⇒ through', async () => {
    let r = service();
    let out = await TestBed.runInInjectionContext(() => betaGuard('mcp')({} as never, {} as never)) as unknown;
    expect(out).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(out as UrlTree)).toBe('/');
    r = service({ switches: { 'pf.beta.mcp': '1' } });
    out = await TestBed.runInInjectionContext(() => betaGuard('mcp')({} as never, {} as never)) as unknown;
    expect(out).toBe(true);
    expect(r.beta.enabled('mcp')).toBe(true);
  });
});

describe('betaHeaderInterceptor', () => {
  function client(switches: Record<string, string>) {
    const st = memStorage(switches);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([makeBetaHeaderInterceptor(() => st, () => 'https://api.example')])), provideHttpClientTesting()],
    });
    return { http: TestBed.inject(HttpClient), ctl: TestBed.inject(HttpTestingController) };
  }

  it('no switch ⇒ API calls untouched', () => {
    const { http, ctl } = client({});
    http.get('https://api.example/api/orders').subscribe();
    expect(ctl.expectOne('https://api.example/api/orders').request.headers.has(BETA_HEADER)).toBe(false);
  });

  it('switches on ⇒ X-PF-BETA on our API only, never third-party URLs', () => {
    const { http, ctl } = client({ 'pf.beta.mcp': '1', 'pf.beta.assistant': '1' });
    http.get('https://api.example/api/ai-connector').subscribe();
    http.get('https://x.supabase.co/auth/v1/user').subscribe();
    expect(ctl.expectOne('https://api.example/api/ai-connector').request.headers.get(BETA_HEADER)).toBe('mcp,assistant');
    expect(ctl.expectOne('https://x.supabase.co/auth/v1/user').request.headers.has(BETA_HEADER)).toBe(false);
  });

  it('a third-party URL that merely contains /api/ never gets the header', () => {
    const { http, ctl } = client({ 'pf.beta.mcp': '1' });
    http.get('https://evil.example/api/steal').subscribe();
    http.get('https://api.example.evil.com/api/x').subscribe();
    http.get('https://api.example/api/ai-connector').subscribe();
    expect(ctl.expectOne('https://evil.example/api/steal').request.headers.has(BETA_HEADER)).toBe(false);
    expect(ctl.expectOne('https://api.example.evil.com/api/x').request.headers.has(BETA_HEADER)).toBe(false);
    expect(ctl.expectOne('https://api.example/api/ai-connector').request.headers.has(BETA_HEADER)).toBe(true);
  });

  it('isOurApiRequest: base prefix + /api; relative /api only when no absolute base', () => {
    expect(isOurApiRequest('https://api.example/api/x', 'https://api.example/')).toBe(true);
    expect(isOurApiRequest('https://api.example/other', 'https://api.example')).toBe(false);
    expect(isOurApiRequest('/api/x', 'https://api.example')).toBe(false);
    expect(isOurApiRequest('/api/x', '')).toBe(true);
    expect(isOurApiRequest('//evil.com/api/x', '')).toBe(false);
    expect(isOurApiRequest('https://evil.com/api/x', '')).toBe(false);
  });

  it('the app wires it next to the OPD preview interceptor', () => {
    expect(typeof betaHeaderInterceptor).toBe('function');
  });
});

describe('neuron beta key', () => {
  it('pf.neuron() switches it on/off like every beta; the server flag + dev are still required', () => {
    const st = memStorage();
    const win: { pf?: Record<string, unknown> } & Record<string, unknown> = {};
    const reload = vi.fn();
    installPfBeta(win, st, reload, vi.fn());
    (win.pf!['neuron'] as () => void)();
    expect(st.data[betaFlagKey('neuron')]).toBe('1');
    expect(betaFlagKey('neuron')).toBe('pf.beta.neuron');
    expect(betaHeaderValue(st)).toBe('neuron');
    expect(readBetaSwitches(st).neuron).toBe(true);
    expect(parseBetaFlags({ data: { neuron: true } }).neuron).toBe(true);
    expect(parseBetaFlags({ data: { neuron: 'true' } }).neuron).toBe(false);
    expect(parseBetaFlags({ data: { mcp: true } }).neuron).toBe(false);
    expect(betaVisible({ switchOn: true, serverAllowed: true, isDev: false })).toBe(false);
    expect(betaVisible({ switchOn: true, serverAllowed: false, isDev: true })).toBe(false);
    (win.pf!['neuron'] as (on: boolean) => void)(false);
    expect(st.data[betaFlagKey('neuron')]).toBeUndefined();
  });
});

describe('beta settingsaccess (owner 2026-11-18: Settings access is dev-only until confirmed)', () => {
  it('reads only a literal true from the server', () => {
    expect(parseBetaFlags({ data: { settingsaccess: true } }).settingsaccess).toBe(true);
    expect(parseBetaFlags({ data: { settingsaccess: 'true' } }).settingsaccess).toBe(false);
  });
});
