import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { authGuard } from './auth.guard';
import { authInterceptor } from './auth.interceptor';
import { SessionService, SignOutStep } from './session.service';
import { StoredAccount } from './accounts.service';
import { PushService } from '../services/push.service';
import { ChatService } from '../services/chat.service';
import { SignalingService } from '../services/signaling.service';
import { WebrtcService } from '../services/webrtc.service';
import { PatientProfileService } from '../services/patient-profile.service';
import { AppointmentBookingService } from '../services/appointment-booking.service';
import { TenantStateService } from '../services/tenant-state.service';
import { BranchLabConfigService } from '../services/branch-lab-config.service';
import { TenantEntitlementsService } from '../services/tenant-entitlements.service';

/**
 * Login audit 2026-09-29 — "it gets logged out frequently". The session
 * lifecycle rules this pins:
 *  - five parallel 401s share ONE refresh-token exchange and all retry;
 *  - a TRANSIENT failure (offline, timeout, 5xx, a deploy window) never
 *    logs out — the request fails, the session stays;
 *  - a DEFINITIVE failure (the auth server rejects the refresh token) ends
 *    the session exactly once, however many requests fail;
 *  - sign-out runs revoke → push → sockets → timers → clear → navigate,
 *    revokes with scope=local (never the SDK's global default), clears the
 *    session's keys but keeps per-device conveniences, replaces history,
 *    and Back can't reach an authed screen afterwards;
 *  - an expiry carries the return URL + the "session expired" note.
 */

@Component({ template: '' })
class BlankComponent {}

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
const jwt = (sub: string, expInSec = 3600) =>
  `${b64({ alg: 'none' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + expInSec })}.sig`;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

const SUB = 'sub-fd';
const USER_ID = 'app-fd';
const ME = {
  id: USER_ID, authId: SUB, firstName: 'Front', fathersName: 'Desk', displayName: 'Front Desk',
  email: 'fd@t1.tenant.prefrontal', tenantId: 't1', tenantName: 'Micro World', branchId: 'b1',
  branchName: 'Main', roles: ['Receptionist'], permissions: ['*'], branches: [{ id: 'b1', name: 'Main' }],
};

type TokenRoute = (body: { refresh_token?: string }) => Response | Promise<Response> | never;

interface Harness {
  auth: AuthService;
  session: SessionService;
  http: HttpClient;
  ctl: HttpTestingController;
  router: Router;
  mem: Map<string, string>;
  tokenCalls: string[];
  fetchUrls: string[];
  order: string[];
  steps: SignOutStep[];
  push: { unregister: ReturnType<typeof vi.fn> };
}

function setup(opts: {
  token?: TokenRoute;
  me?: (auth: string) => Response | Promise<Response>;
  access?: string;
  extraStorage?: Record<string, string>;
} = {}): Harness {
  const mem = new Map<string, string>();
  const store = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
    key: (i: number) => Array.from(mem.keys())[i] ?? null,
    get length() { return mem.size; },
  };
  vi.stubGlobal('localStorage', store);
  vi.stubGlobal('sessionStorage', { ...store, getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  const access = opts.access ?? jwt(SUB);
  const row: StoredAccount = {
    userId: USER_ID, org: 'Micro World', tenantId: 't1', displayName: 'Front Desk',
    email: ME.email, accessToken: access, refreshToken: 'rt-1', hasPin: false, addedAt: '',
  };
  mem.set('pf.accounts', JSON.stringify([row]));
  mem.set('pf.activeAccount', USER_ID);
  mem.set('pf.session', JSON.stringify({ access_token: access, refresh_token: 'rt-1' }));
  for (const [k, v] of Object.entries(opts.extraStorage ?? {})) mem.set(k, v);

  const order: string[] = [];
  const tokenCalls: string[] = [];
  const fetchUrls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    fetchUrls.push(url);
    if (url.includes('/auth/v1/token')) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      tokenCalls.push(body.refresh_token);
      return opts.token ? opts.token(body) : json(200, { access_token: jwt(SUB), refresh_token: `rt-${tokenCalls.length + 1}` });
    }
    if (url.includes('/auth/v1/logout')) { order.push('revoke:' + url.split('?')[1]); return new Response(null, { status: 204 }); }
    if (url.includes('/api/auth/me')) {
      const auth = new Headers(init?.headers).get('Authorization') ?? '';
      return opts.me ? opts.me(auth) : json(200, { success: true, data: ME });
    }
    return json(404, {});
  }));

  const push = { unregister: vi.fn(async () => { order.push('push'); }) };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      provideRouter([
        { path: 'login', component: BlankComponent },
        { path: 'frontdesk', component: BlankComponent, canActivate: [authGuard] },
        { path: '', component: BlankComponent },
      ]),
      { provide: PushService, useValue: push },
      { provide: ChatService, useValue: { disconnect: vi.fn(async () => { order.push('chat'); }) } },
      { provide: SignalingService, useValue: { disconnect: vi.fn(async () => { order.push('signaling'); }) } },
      { provide: WebrtcService, useValue: { reset: vi.fn(() => { order.push('webrtc'); }) } },
      { provide: PatientProfileService, useValue: { close: vi.fn(() => order.push('overlays')) } },
      { provide: AppointmentBookingService, useValue: { close: vi.fn() } },
      { provide: TenantStateService, useValue: { reset: vi.fn(() => order.push('tenant-cache')) } },
      { provide: BranchLabConfigService, useValue: { reset: vi.fn(), hasDedicatedCollection: () => false, collectsAtFrontdesk: () => true } },
      { provide: TenantEntitlementsService, useValue: { reset: vi.fn() } },
    ],
  });
  const auth = TestBed.inject(AuthService);
  const session = TestBed.inject(SessionService);
  const steps: SignOutStep[] = [];
  session.onStep = (s) => { steps.push(s); if (s === 'clear') order.push('clear'); };
  return {
    auth, session, mem, order, steps, tokenCalls, fetchUrls, push,
    http: TestBed.inject(HttpClient),
    ctl: TestBed.inject(HttpTestingController),
    router: TestBed.inject(Router),
  };
}

/** Fire n GETs; return settled results. */
function fire(t: Harness, n: number) {
  return Array.from({ length: n }, (_, i) =>
    firstValueFrom(t.http.get(`/api/things/${i}`)).then(
      v => ({ ok: true as const, v }),
      (e: HttpErrorResponse) => ({ ok: false as const, status: e.status })));
}

async function signedIn(t: Harness): Promise<void> {
  await t.auth.waitForAuth();
  await tick();
  expect(t.auth.user()?.id).toBe(USER_ID);
  await t.router.navigateByUrl('/frontdesk?tab=queue');
  expect(t.router.url).toBe('/frontdesk?tab=queue');
}

afterEach(() => {
  TestBed.inject(AuthService).stopSessionTimers();
  vi.unstubAllGlobals();
});

describe('refresh on 401 — single flight', () => {
  it('five parallel 401s share ONE refresh-token exchange and all retry with the new token', async () => {
    const t = setup();
    await signedIn(t);
    const results = fire(t, 5);
    await tick();
    const first = t.ctl.match(r => r.url.startsWith('/api/things/'));
    expect(first.length).toBe(5);
    first.forEach(r => r.flush({}, { status: 401, statusText: 'Unauthorized' }));
    await tick(10);

    expect(t.tokenCalls).toEqual(['rt-1']);                    // exactly one exchange
    const retried = t.ctl.match(r => r.url.startsWith('/api/things/'));
    expect(retried.length).toBe(5);
    const newToken = t.auth.accessToken();
    for (const r of retried) {
      expect(r.request.headers.get('Authorization')).toBe(`Bearer ${newToken}`);
      r.flush({ ok: 1 });
    }
    const settled = await Promise.all(results);
    expect(settled.every(s => s.ok)).toBe(true);
    expect(t.steps).toEqual([]);                                 // nobody signed out
    expect(t.auth.session()?.refresh_token).toBe('rt-2');
    // The rotated token is filed under this tab's registry row.
    expect(JSON.parse(t.mem.get('pf.accounts')!)[0].refreshToken).toBe('rt-2');
  });

  it('refreshes PROACTIVELY before sending when the token is about to expire (no 401 burst)', async () => {
    const t = setup();
    await signedIn(t);
    // The token now has 30s left (a long-open tab).
    (t.auth as unknown as { _session: { set(v: unknown): void } })._session
      .set({ access_token: jwt(SUB, 30), refresh_token: 'rt-1' });
    t.tokenCalls.length = 0;
    const results = fire(t, 3);
    await tick(10);
    expect(t.tokenCalls.length).toBe(1);
    const sent = t.ctl.match(r => r.url.startsWith('/api/things/'));
    expect(sent.length).toBe(3);
    sent.forEach(r => r.flush({}));
    expect((await Promise.all(results)).every(s => s.ok)).toBe(true);
  });
});

describe('a transient failure never logs out', () => {
  const cases: Array<[string, TokenRoute]> = [
    ['the auth server is unreachable (offline / DNS / CORS)', () => { throw new TypeError('Failed to fetch'); }],
    ['the auth server answers 503 (deploy / outage)', () => json(503, {})],
    ['the auth server rate-limits (429)', () => json(429, {})],
  ];
  for (const [name, token] of cases) {
    it(`401 + ${name}: the request fails, the session and the user stay`, async () => {
      const t = setup({ token });
      await signedIn(t);
      const results = fire(t, 3);
      await tick();
      t.ctl.match(r => r.url.startsWith('/api/things/')).forEach(r => r.flush({}, { status: 401, statusText: 'Unauthorized' }));
      await tick(10);
      const settled = await Promise.all(results);
      expect(settled.every(s => !s.ok && s.status === 401)).toBe(true);
      expect(t.tokenCalls.length).toBe(1);
      expect(t.steps).toEqual([]);
      expect(t.auth.user()?.id).toBe(USER_ID);
      expect(t.auth.session()?.refresh_token).toBe('rt-1');
      expect(t.router.url).toBe('/frontdesk?tab=queue');
      expect(t.push.unregister).not.toHaveBeenCalled();
    });
  }

  it('/me answering 502 (backend restarting) keeps the signed-in user — it used to sign out', async () => {
    let down = false;
    const t = setup({ me: () => (down ? json(502, {}) : json(200, { success: true, data: ME })) });
    await signedIn(t);
    down = true;
    await expect(t.auth.loadProfile()).resolves.toBe('transient');
    expect(t.auth.user()?.id).toBe(USER_ID);
    expect(t.steps).toEqual([]);
  });

  it('/me unreachable on resume (radio not up yet) keeps the user — it used to null it', async () => {
    let offline = false;
    const t = setup({ me: () => { if (offline) throw new TypeError('Load failed'); return json(200, { success: true, data: ME }); } });
    await signedIn(t);
    offline = true;
    await expect(t.auth.loadProfile()).resolves.toBe('transient');
    expect(t.auth.isAuthenticated()).toBe(true);
  });

  it('boots straight in from the cached profile even when /me is unreachable', async () => {
    const t0 = setup();
    await signedIn(t0);                                          // caches the profile
    const cache = t0.mem.get(`pf.profile:${SUB}`)!;
    expect(JSON.parse(cache).user.id).toBe(USER_ID);
    t0.auth.stopSessionTimers();
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();

    const t = setup({
      me: () => { throw new TypeError('Failed to fetch'); },
      extraStorage: { [`pf.profile:${SUB}`]: cache },
    });
    await t.auth.waitForAuth();
    expect(t.auth.isAuthenticated()).toBe(true);
    expect(t.auth.user()?.displayName).toBe('Front Desk');
    await tick();
    expect(t.auth.isAuthenticated()).toBe(true);               // still in after /me failed
  });
});

describe('a definitive failure logs out exactly once', () => {
  it('five 401s + a REJECTED refresh token → one sign-out, one redirect with the note and return URL', async () => {
    const t = setup({ token: () => json(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Already Used' }) });
    await signedIn(t);
    const nav = vi.spyOn(t.router, 'navigate');
    const results = fire(t, 5);
    await tick();
    t.ctl.match(r => r.url.startsWith('/api/things/')).forEach(r => r.flush({}, { status: 401, statusText: 'Unauthorized' }));
    await tick(20);
    await Promise.all(results);

    expect(t.tokenCalls.length).toBe(1);
    expect(t.steps.filter(s => s === 'clear').length).toBe(1);   // ONE sequence
    expect(t.push.unregister).toHaveBeenCalledTimes(1);
    const loginNavs = nav.mock.calls.filter(c => (c[0] as string[])[0] === '/login');
    expect(loginNavs.length).toBe(1);
    expect(loginNavs[0][1]).toMatchObject({
      replaceUrl: true,
      queryParams: { reason: 'expired', returnUrl: '/frontdesk?tab=queue' },
    });
    expect(t.router.url.startsWith('/login')).toBe(true);
    expect(t.auth.session()).toBeNull();
    expect(t.auth.user()).toBeNull();
    // Expired: nothing live to revoke with.
    expect(t.fetchUrls.some(u => u.includes('/auth/v1/logout'))).toBe(false);
  });

  it('adopts a token another tab rotated meanwhile instead of declaring the session dead', async () => {
    const t = setup({ token: (b) => (b.refresh_token === 'rt-1' ? json(400, { error: 'invalid_grant' })
      : json(200, { access_token: jwt(SUB), refresh_token: 'rt-9' })) });
    await signedIn(t);
    // Another tab rotated rt-1 → rt-8 while ours was in flight (the access
    // token it wrote is already stale, so we must exchange rt-8).
    const origFetch = globalThis.fetch as unknown as (u: RequestInfo | URL, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (u: RequestInfo | URL, i?: RequestInit) => {
      const r = await origFetch(u, i);
      if (String(u).includes('/auth/v1/token') && JSON.parse(String(i?.body)).refresh_token === 'rt-1') {
        const list = JSON.parse(t.mem.get('pf.accounts')!) as StoredAccount[];
        list[0] = { ...list[0], accessToken: jwt(SUB, -10), refreshToken: 'rt-8' };
        t.mem.set('pf.accounts', JSON.stringify(list));
      }
      return r;
    }));
    await expect(t.auth.refreshSession()).resolves.toBe('ok');
    expect(t.tokenCalls).toEqual(['rt-1', 'rt-8']);
    expect(t.auth.session()?.refresh_token).toBe('rt-9');
    expect(t.steps).toEqual([]);
  });

  it('a suspended tenant (/me 403 tenant_suspended) ends the session with its own note', async () => {
    let suspended = false;
    const t = setup({ me: () => (suspended ? json(403, { error: 'tenant_suspended' }) : json(200, { success: true, data: ME })) });
    await signedIn(t);
    const nav = vi.spyOn(t.router, 'navigate');
    suspended = true;
    await t.auth.loadProfile();
    expect(t.auth.user()).toBeNull();
    expect(nav.mock.calls.find(c => (c[0] as string[])[0] === '/login')?.[1]).toMatchObject({ queryParams: { reason: 'suspended' } });
  });

  it('no 401 storm after sign-out: stray 401s neither refresh nor start a second sequence', async () => {
    const t = setup();
    await signedIn(t);
    await t.session.logout();
    t.steps.length = 0; t.tokenCalls.length = 0;
    const results = fire(t, 4);
    await tick();
    t.ctl.match(r => r.url.startsWith('/api/things/')).forEach(r => {
      expect(r.request.headers.has('Authorization')).toBe(false);
      r.flush({}, { status: 401, statusText: 'Unauthorized' });
    });
    await tick(10);
    await Promise.all(results);
    expect(t.tokenCalls).toEqual([]);
    expect(t.steps).toEqual([]);
    expect(t.router.url.startsWith('/login')).toBe(true);
  });

  it('public endpoints answer for themselves — a 401 there never bounces to login', async () => {
    const t = setup();
    await signedIn(t);
    const p = firstValueFrom(t.http.post('/api/public/report/tok/verify', {})).catch(e => e);
    await tick();
    t.ctl.expectOne('/api/public/report/tok/verify').flush({}, { status: 401, statusText: 'Unauthorized' });
    await p; await tick();
    expect(t.tokenCalls).toEqual([]);
    expect(t.steps).toEqual([]);
  });
});

describe('logout sequence', () => {
  it('runs revoke → push → sockets → timers → clear → navigate, in that order', async () => {
    const t = setup();
    await signedIn(t);
    await t.session.logout();
    expect(t.steps).toEqual(['revoke', 'push', 'sockets', 'timers', 'clear', 'navigate']);
    expect(t.order).toEqual([
      'revoke:scope=local', 'push', 'chat', 'signaling', 'webrtc', 'overlays', 'tenant-cache', 'clear',
    ]);
    // Never the SDK's global scope (which revoked the user on every device).
    expect(t.fetchUrls.some(u => u.includes('scope=global'))).toBe(false);
  });

  it('clears the session state + keys but keeps per-device conveniences', async () => {
    const t = setup({
      extraStorage: {
        'pf.activeBranch': 'b1', 'pf.lockedAt': '1', 'sb-cottlnsbjnstsgknsgzu-auth-token': '{}',
        'pf-theme': 'dark', 'pf-design-mode': 'new', 'pf.orgs': '["Micro World"]', 'pf.printer.deviceId': 'p1',
      },
    });
    await signedIn(t);
    expect(t.mem.has(`pf.profile:${SUB}`)).toBe(true);
    await t.session.logout();

    expect(t.auth.session()).toBeNull();
    expect(t.auth.user()).toBeNull();
    expect(t.auth.permissions()).toEqual([]);
    expect(t.auth.activeBranchId()).toBeNull();
    for (const k of ['pf.session', 'pf.activeBranch', 'pf.lockedAt', 'sb-cottlnsbjnstsgknsgzu-auth-token', `pf.profile:${SUB}`]) {
      expect(t.mem.has(k), k).toBe(false);
    }
    expect(JSON.parse(t.mem.get('pf.accounts')!)).toEqual([]);
    for (const k of ['pf-theme', 'pf-design-mode', 'pf.orgs', 'pf.printer.deviceId']) {
      expect(t.mem.has(k), k).toBe(true);
    }
    // Other tabs of this account are told.
    expect(JSON.parse(t.mem.get(AuthService.SESSION_EVENT_KEY)!)).toMatchObject({ type: 'signout', userId: USER_ID });
  });

  it('replaces history and Back cannot return to an authed screen', async () => {
    const t = setup();
    await signedIn(t);
    const nav = vi.spyOn(t.router, 'navigate');
    await t.session.logout();
    expect(nav).toHaveBeenCalledWith(['/login'], expect.objectContaining({ replaceUrl: true }));
    expect(t.router.url).toBe('/login');
    // "Back" to the screen we signed out of → the guard keeps us on login.
    await t.router.navigateByUrl('/frontdesk?tab=queue');
    expect(t.router.url.startsWith('/login')).toBe(true);
    expect(t.router.url).toContain('returnUrl=');
  });

  it('a manual sign-out carries no return URL and no note', async () => {
    const t = setup();
    await signedIn(t);
    await t.session.logout();
    expect(t.router.url).toBe('/login');
  });

  it('covers the app while it runs (no flash of the half-cleared UI)', async () => {
    const t = setup();
    await signedIn(t);
    const seen: boolean[] = [];
    t.session.onStep = () => seen.push(t.session.ending());
    await t.session.logout();
    expect(seen.every(Boolean)).toBe(true);
    expect(t.session.ending()).toBe(false);
  });

  it('a sign-out in another tab of the SAME account follows; another profile is left alone', async () => {
    const t = setup();
    await signedIn(t);
    window.dispatchEvent(new StorageEvent('storage', {
      key: AuthService.SESSION_EVENT_KEY, newValue: JSON.stringify({ type: 'signout', userId: 'someone-else' }),
    }));
    await tick();
    expect(t.auth.user()?.id).toBe(USER_ID);
    window.dispatchEvent(new StorageEvent('storage', {
      key: AuthService.SESSION_EVENT_KEY, newValue: JSON.stringify({ type: 'signout', userId: USER_ID }),
    }));
    await tick(10);
    expect(t.auth.user()).toBeNull();
    expect(t.push.unregister).not.toHaveBeenCalled();           // the other tab did it
    expect(t.fetchUrls.some(u => u.includes('/auth/v1/logout'))).toBe(false);
    expect(t.router.url).toBe('/login?reason=elsewhere');
  });

  it('sign-out still completes when the network is gone (every step is bounded)', async () => {
    const t = setup();
    await signedIn(t);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await t.session.logout();
    expect(t.auth.session()).toBeNull();
    expect(t.router.url).toBe('/login');
  });
});


describe('SessionService.isReturnable', () => {
  it('accepts in-app paths', () => {
    expect(SessionService.isReturnable('/frontdesk?tab=queue')).toBe(true);
    expect(SessionService.isReturnable('/oauth/consent?authorization_id=a1')).toBe(true);
  });
  it('rejects open-redirect shapes: protocol-relative, backslash, absolute, login loops', () => {
    for (const bad of ['', '/', '//evil.com', '/\\evil.com', '/\\/evil.com', '/a\\b', 'https://evil.com', 'evil', '/login', '/set-password']) {
      expect(SessionService.isReturnable(bad), bad).toBe(false);
    }
  });
});
