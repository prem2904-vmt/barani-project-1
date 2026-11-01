import { Component, Injector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { installPasswordGate, setPasswordUrl } from './password-gate';

/**
 * Temporary-password gate on a RESTORED session (reload / reopened app before
 * the password was replaced). Before: the gate was only raised by the sign-in
 * itself, so a reload booted straight into the app and every call answered
 * 403 "Set a new password before using the app".
 */
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
const jwt = (sub: string) => `${b64({ alg: 'none' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const ME = {
  id: 'app-1', authId: 'sub-1', firstName: 'Asha', fathersName: 'Rao', displayName: 'Asha Rao',
  email: 'a@t1.tenant.prefrontal', tenantId: 't1', tenantName: 'Micro World', branchId: 'b1', branchName: 'Main',
  roles: ['Technician'], permissions: ['enter_result'], branches: [{ id: 'b1', name: 'Main' }],
};

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
  };
}

function bootWithStoredSession(me: Record<string, unknown>, opts: { cachedProfile?: boolean } = {}) {
  TestBed.resetTestingModule();
  const store = memStorage();
  vi.stubGlobal('localStorage', store);
  vi.stubGlobal('sessionStorage', memStorage());
  const token = jwt('sub-1');
  store.setItem('pf.session', JSON.stringify({ access_token: token, refresh_token: 'rt-1' }));
  if (opts.cachedProfile) {
    store.setItem(AuthService.PROFILE_KEY_PREFIX + 'sub-1', JSON.stringify({ user: { ...ME, modules: ['lab'] }, at: Date.now() }));
  }
  let answer!: () => void;
  const meAnswered = new Promise<void>(r => { answer = r; });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/api/auth/me')) { queueMicrotask(answer); return json(200, { success: true, data: me }); }
    return json(404, {});
  }));
  const auth = TestBed.inject(AuthService);
  return { auth, meAnswered };
}

const settle = () => new Promise(r => setTimeout(r, 0));

afterEach(() => vi.unstubAllGlobals());

describe('AuthService — the gate on a restored session', () => {
  it('no cached profile: /me says mustChangePassword → the gate is up before the guards run', async () => {
    const { auth } = bootWithStoredSession({ ...ME, mustChangePassword: true });
    await auth.waitForAuth();
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.mustChangePassword()).toBe(true);
  });

  it('cached profile: the app boots at once, then /me raises the gate', async () => {
    const { auth, meAnswered } = bootWithStoredSession({ ...ME, mustChangePassword: true }, { cachedProfile: true });
    await auth.waitForAuth();
    expect(auth.isAuthenticated()).toBe(true);
    await meAnswered;
    await settle();
    expect(auth.mustChangePassword()).toBe(true);
  });

  it('/me without the flag (or an older server) never raises it', async () => {
    const { auth } = bootWithStoredSession({ ...ME, mustChangePassword: false });
    await auth.waitForAuth();
    expect(auth.mustChangePassword()).toBe(false);
    const older = bootWithStoredSession({ ...ME });
    await older.auth.waitForAuth();
    expect(older.auth.mustChangePassword()).toBe(false);
  });
});

@Component({ template: '' })
class BlankComponent {}

describe('installPasswordGate', () => {
  function setup(startUrl: string) {
    TestBed.resetTestingModule();
    const must = signal(false);
    const authed = signal(true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'set-password', component: BlankComponent },
          { path: 'login', component: BlankComponent },
          { path: '**', component: BlankComponent },
        ]),
        { provide: AuthService, useValue: { mustChangePassword: must, isAuthenticated: authed } },
      ],
    });
    const router = TestBed.inject(Router);
    return { must, authed, router, start: async () => {
      await router.navigateByUrl(startUrl);
      runInInjectionContext(TestBed.inject(Injector), () => installPasswordGate());
      TestBed.tick();
    } };
  }

  it('the gate rising on an in-app screen → /set-password, keeping where they were', async () => {
    const { must, router, start } = setup('/frontdesk?tab=queue');
    await start();
    expect(router.url).toBe('/frontdesk?tab=queue');
    must.set(true);
    TestBed.tick();
    await settle();
    expect(router.url).toBe('/set-password?returnUrl=%2Ffrontdesk%3Ftab%3Dqueue');
  });

  it('leaves the sign-in screen, set-password itself and signed-out sessions alone', async () => {
    for (const url of ['/login', '/set-password']) {
      const { must, router, start } = setup(url);
      await start();
      must.set(true);
      TestBed.tick();
      await settle();
      expect(router.url).toBe(url);
    }
    const s = setup('/frontdesk');
    await s.start();
    s.authed.set(false);
    s.must.set(true);
    TestBed.tick();
    await settle();
    expect(s.router.url).toBe('/frontdesk');
  });

  it('setPasswordUrl carries only a safe in-app return URL', () => {
    expect(setPasswordUrl('/frontdesk')).toBe('/set-password?returnUrl=%2Ffrontdesk');
    expect(setPasswordUrl('/')).toBe('/set-password');
    expect(setPasswordUrl('//evil.example')).toBe('/set-password');
    expect(setPasswordUrl(null)).toBe('/set-password');
  });
});
