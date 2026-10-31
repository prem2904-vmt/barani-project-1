import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

/**
 * A passkey sign-in ends in the SAME place as a password sign-in: same
 * persisted session shape, same /me bootstrap with the same token, same
 * registry row, same idle-lock reset — and the temp-password gate is raised
 * when /me says so. A session /me refuses is revoked at once.
 */
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
const jwt = (sub: string) => `${b64({ alg: 'none' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const ME = {
  id: 'app-1', authId: 'sub-1', firstName: 'Lab', fathersName: 'Tech', displayName: 'Lab Tech',
  email: 'lt@t1.tenant.prefrontal', tenantId: 't1', tenantName: 'Micro World', branchId: 'b1', branchName: 'Main',
  roles: ['Technician'], permissions: ['enter_result'], branches: [{ id: 'b1', name: 'Main' }],
};

function memStorage() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
  };
}

function setup(me: (token: string) => Response, login?: Record<string, unknown>) {
  TestBed.resetTestingModule();
  const store = memStorage();
  vi.stubGlobal('localStorage', store);
  vi.stubGlobal('sessionStorage', memStorage());
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/api/auth/me')) return me(((init.headers ?? {}) as Record<string, string>)['Authorization'] ?? '');
    if (url.endsWith('/api/auth/login')) return json(200, { success: true, data: login });
    if (url.endsWith('/api/auth/session-started')) return json(200, { success: true, data: { recorded: true } });
    if (url.includes('/auth/v1/logout')) return new Response(null, { status: 204 });
    return json(404, {});
  }));
  const auth = TestBed.inject(AuthService);
  return { auth, store, calls };
}

afterEach(() => vi.unstubAllGlobals());

const sessionStarts = (calls: { url: string; init: RequestInit }[]) =>
  calls.filter(c => c.url === `${environment.apiUrl}/api/auth/session-started`);

describe('AuthService.signInWithPasskeySession', () => {
  it('runs the password path’s tail: same persisted tokens, /me with that token, registry, lock reset', async () => {
    const token = jwt('sub-1');
    const { auth, store, calls } = setup(() => json(200, { success: true, data: ME }));
    store.setItem('pf.lockedAt', String(Date.now()));
    const fresh = vi.fn();
    window.addEventListener('pf:fresh-signin', fresh);

    await auth.signInWithPasskeySession({ access_token: token, refresh_token: 'ref-pk' });

    expect(JSON.parse(store.getItem('pf.session')!)).toEqual({ access_token: token, refresh_token: 'ref-pk' });
    const meCall = calls.find(c => c.url.endsWith('/api/auth/me'))!;
    expect((meCall.init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${token}`);
    expect(auth.user()?.id).toBe('app-1');
    expect(auth.accessToken()).toBe(token);
    expect(auth.accounts.accounts().map(a => a.userId)).toEqual(['app-1']);
    expect(store.getItem('pf.lockedAt')).toBeNull();
    expect(fresh).toHaveBeenCalled();
    expect(auth.mustChangePassword()).toBe(false);
    expect(auth.signedInWith()).toBe('passkey');
    // The org is remembered for the next password sign-in.
    expect(auth.rememberedOrgs()[0]).toBe('Micro World');
    window.removeEventListener('pf:fresh-signin', fresh);
  });

  it('matches a password sign-in field for field (same session + profile)', async () => {
    const token = jwt('sub-1');
    const pw = setup(() => json(200, { success: true, data: ME }),
      { accessToken: token, refreshToken: 'ref', tenant: { id: 't1', name: 'Micro World' }, mustChangePassword: false });
    await pw.auth.signIn('Micro World', 'lt', 'secret');
    const pwState = { session: pw.store.getItem('pf.session'), user: pw.auth.user(), gate: pw.auth.mustChangePassword() };

    const pk = setup(() => json(200, { success: true, data: ME }));
    await pk.auth.signInWithPasskeySession({ access_token: token, refresh_token: 'ref' });
    expect({ session: pk.store.getItem('pf.session'), user: pk.auth.user(), gate: pk.auth.mustChangePassword() }).toEqual(pwState);
    expect(pw.auth.signedInWith()).toBe('password');
  });

  it('raises the temp-password gate when /me says mustChangePassword', async () => {
    const { auth } = setup(() => json(200, { success: true, data: { ...ME, mustChangePassword: true } }));
    await auth.signInWithPasskeySession({ access_token: jwt('sub-1'), refresh_token: 'r' });
    expect(auth.mustChangePassword()).toBe(true);
  });

  it('a session the LMS refuses (no user here) is restored-away and revoked on Supabase', async () => {
    const token = jwt('sub-x');
    const { auth, store, calls } = setup(() => json(403, { error: 'forbidden' }));
    await expect(auth.signInWithPasskeySession({ access_token: token, refresh_token: 'r' }))
      .rejects.toThrow(/can’t be used here/);
    expect(auth.user()).toBeNull();
    expect(store.getItem('pf.session')).toBeNull();
    await new Promise(r => setTimeout(r, 0));
    const revoke = calls.find(c => c.url === `${environment.auth.supabaseUrl}/auth/v1/logout?scope=local`);
    expect((revoke?.init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${token}`);
  });

  it('records the session start once (login audit), with the passkey token and the beta header', async () => {
    const token = jwt('sub-1');
    const { auth, store, calls } = setup(() => json(200, { success: true, data: ME }));
    store.setItem('pf.beta.passkeys', '1');
    await auth.signInWithPasskeySession({ access_token: token, refresh_token: 'r' });
    await new Promise(r => setTimeout(r, 0));
    const posts = sessionStarts(calls);
    expect(posts).toHaveLength(1);
    expect(posts[0].init.method).toBe('POST');
    const h = posts[0].init.headers as Record<string, string>;
    expect(h['Authorization']).toBe(`Bearer ${token}`);
    expect(h['X-PF-BETA']).toBe('passkeys');
    expect(JSON.parse(posts[0].init.body as string)).toEqual({ method: 'passkey' });
  });

  it('a failing session-start call never breaks the sign-in', async () => {
    const { auth, calls } = setup(() => json(200, { success: true, data: ME }));
    const base = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.endsWith('/api/auth/session-started')) { calls.push({ url, init }); throw new TypeError('offline'); }
      return base(url, init);
    }));
    await expect(auth.signInWithPasskeySession({ access_token: jwt('sub-1'), refresh_token: 'r' })).resolves.toBeUndefined();
    expect(auth.user()?.id).toBe('app-1');
    expect(sessionStarts(calls)).toHaveLength(1);
  });

  it('a password sign-in and a refused passkey session never call it', async () => {
    const pw = setup(() => json(200, { success: true, data: ME }),
      { accessToken: jwt('sub-1'), refreshToken: 'ref', tenant: { id: 't1', name: 'Micro World' }, mustChangePassword: false });
    await pw.auth.signIn('Micro World', 'lt', 'secret');
    expect(sessionStarts(pw.calls)).toHaveLength(0);

    const bad = setup(() => json(403, { error: 'forbidden' }));
    await expect(bad.auth.signInWithPasskeySession({ access_token: jwt('sub-x'), refresh_token: 'r' })).rejects.toThrow();
    expect(sessionStarts(bad.calls)).toHaveLength(0);
  });
});
