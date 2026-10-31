import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

/**
 * A Google sign-in ("Continue with Google", beta `support` / OAuth consent)
 * ends in the SAME place as a password sign-in: same persisted session shape,
 * same /me bootstrap with the same token, same registry row. A Google account
 * the LMS refuses (no Prefrontal user) is revoked at once.
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

describe('AuthService.signInWithGoogleSession', () => {
  it('matches a password sign-in field for field (same session + profile), marked as google', async () => {
    const token = jwt('sub-1');
    const pw = setup(() => json(200, { success: true, data: ME }),
      { accessToken: token, refreshToken: 'ref', tenant: { id: 't1', name: 'Micro World' }, mustChangePassword: false });
    await pw.auth.signIn('Micro World', 'lt', 'secret');
    const pwState = { session: pw.store.getItem('pf.session'), user: pw.auth.user(), gate: pw.auth.mustChangePassword() };

    const g = setup(() => json(200, { success: true, data: ME }));
    await g.auth.signInWithGoogleSession({ access_token: token, refresh_token: 'ref' });
    expect({ session: g.store.getItem('pf.session'), user: g.auth.user(), gate: g.auth.mustChangePassword() }).toEqual(pwState);
    const meCall = g.calls.find(c => c.url.endsWith('/api/auth/me'))!;
    expect((meCall.init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${token}`);
    expect(g.auth.signedInWith()).toBe('google');
    expect(g.auth.rememberedOrgs()[0]).toBe('Micro World');
  });

  it('a Google account the LMS refuses is revoked on Supabase and leaves no session', async () => {
    const token = jwt('sub-x');
    const { auth, store, calls } = setup(() => json(403, { error: 'forbidden' }));
    await expect(auth.signInWithGoogleSession({ access_token: token, refresh_token: 'r' })).rejects.toThrow(/can’t be used here/);
    expect(auth.user()).toBeNull();
    expect(store.getItem('pf.session')).toBeNull();
    await new Promise(r => setTimeout(r, 0));
    const revoke = calls.find(c => c.url === `${environment.auth.supabaseUrl}/auth/v1/logout?scope=local`);
    expect((revoke?.init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${token}`);
    expect(sessionStarts(calls)).toHaveLength(0);
  });

  it('records the session start once with method google', async () => {
    const { auth, calls } = setup(() => json(200, { success: true, data: ME }));
    await auth.signInWithGoogleSession({ access_token: jwt('sub-1'), refresh_token: 'r' });
    await new Promise(r => setTimeout(r, 0));
    const posts = sessionStarts(calls);
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0].init.body as string)).toEqual({ method: 'google' });
  });

  it('never touches the supabase-js SDK storage (no sb-* keys written)', async () => {
    const { auth, store } = setup(() => json(200, { success: true, data: ME }));
    await auth.signInWithGoogleSession({ access_token: jwt('sub-1'), refresh_token: 'r' });
    expect(Array.from(store.m.keys()).filter(k => k.startsWith('sb-'))).toEqual([]);
  });
});
