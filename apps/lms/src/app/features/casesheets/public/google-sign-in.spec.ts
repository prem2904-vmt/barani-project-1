import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { environment } from '../../../../environments/environment';
import { AuthService, GoogleSignInError } from '../../../core/auth/auth.service';
import { ENTER_REFUSALS, PKCE_KEY } from './google-pkce';

/**
 * Google sign-in on the public case-sheet site (plan §4.3): PKCE code → session → POST personal/enter → the SAME
 * beginSession tail as password / passkey sign-in (persisted tokens, /me, registry). Only in casesheets mode; a
 * personal space never gets an LMS profile on an LMS host (§4.4).
 */
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
const jwt = (sub: string) => `${b64({ alg: 'none' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const PERSONAL_ME = {
  id: 'app-g', authId: 'sub-g', firstName: 'Meera', fathersName: 'R', displayName: 'Dr Meera R',
  email: 'meera@gmail.com', tenantId: 'pt-1', tenantName: 'Dr Meera R', branchId: 'pb-1', branchName: 'Main',
  roles: ['Personal doctor'], permissions: ['casesheet_fill', 'casesheet_view'], branches: [{ id: 'pb-1', name: 'Main' }],
  tenantKind: 'personal',
};
const LAB_ME = { ...PERSONAL_ME, id: 'app-l', email: 'doc@lab.com', tenantId: 't1', tenantName: 'Micro World', tenantKind: undefined };

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

interface Opts {
  mode?: 'casesheets' | 'lms';
  token?: (body: Record<string, string>) => Response;
  enter?: (auth: string) => Response;
  me?: (auth: string) => Response;
}

const env = environment as { mode?: string };
let savedMode: string | undefined;
beforeEach(() => { savedMode = env.mode; });
afterEach(() => { env.mode = savedMode; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup(o: Opts = {}) {
  env.mode = o.mode ?? 'casesheets';
  TestBed.resetTestingModule();
  const local = memStorage();
  const session = memStorage();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
  const calls: { url: string; init: RequestInit }[] = [];
  const token = jwt('sub-g');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const authz = ((init.headers ?? {}) as Record<string, string>)['Authorization'] ?? '';
    if (url.includes('/auth/v1/token?grant_type=pkce')) {
      const body = JSON.parse(String(init.body)) as Record<string, string>;
      return o.token ? o.token(body) : json(200, { access_token: token, refresh_token: 'ref-g', token_type: 'bearer' });
    }
    if (url.endsWith('/api/casesheets/personal/enter')) return o.enter ? o.enter(authz) : json(200, { kind: 'personal', labUser: false, created: true, caseSheets: true, tenantId: 'tp' });
    if (url.endsWith('/api/auth/me')) return o.me ? o.me(authz) : json(200, { success: true, data: PERSONAL_ME });
    if (url.includes('/auth/v1/logout')) return new Response(null, { status: 204 });
    return json(404, {});
  }));
  const auth = TestBed.inject(AuthService);
  const left: string[] = [];
  vi.spyOn(auth as unknown as { leavePage: (u: string) => void }, 'leavePage').mockImplementation((u: string) => { left.push(u); });
  return { auth, local, session, calls, token, left };
}

/** "Continue with Google" then the return with ?code=. */
async function startAndReturn(s: ReturnType<typeof setup>, next: string | null = null) {
  await s.auth.signInWithGoogle(next);
  return s.auth.completeGoogleSignIn({ code: 'one-time-code' });
}

describe('AuthService Google sign-in (casesheets mode)', () => {
  it('Continue with Google: verifier kept in THIS tab, leaves for Supabase /authorize with our callback', async () => {
    const s = setup();
    await s.auth.signInWithGoogle('/cases');
    expect(s.left).toHaveLength(1);
    const u = new URL(s.left[0]);
    expect(u.origin + u.pathname).toBe(`${environment.auth.supabaseUrl}/auth/v1/authorize`);
    expect(u.searchParams.get('provider')).toBe('google');
    expect(u.searchParams.get('redirect_to')).toBe(`${location.origin}/auth/callback`);
    expect(u.searchParams.get('code_challenge_method')).toBe('s256');
    expect(JSON.parse(s.session.m.get(PKCE_KEY)!).next).toBe('/cases');
    // Nothing persisted in localStorage (no sb-* SDK keys, no session yet).
    expect(s.local.getItem('pf.session')).toBeNull();
  });

  it('callback → PKCE exchange with this tab’s verifier → personal/enter with the new token → /me → session', async () => {
    const s = setup();
    const r = await startAndReturn(s, '/cases');
    const verifier = s.calls.find(c => c.url.includes('grant_type=pkce'))!;
    expect(verifier.url).toBe(`${environment.auth.supabaseUrl}/auth/v1/token?grant_type=pkce`);
    const body = JSON.parse(String(verifier.init.body));
    expect(body.auth_code).toBe('one-time-code');
    expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(((verifier.init.headers ?? {}) as Record<string, string>)['apikey']).toBe(environment.auth.supabaseAnonKey);

    const order = s.calls.map(c => c.url.replace(/^https?:\/\/[^/]+/, ''));
    const iEnter = order.indexOf('/api/casesheets/personal/enter');
    const iMe = order.indexOf('/api/auth/me');
    expect(iEnter).toBeGreaterThan(-1);
    expect(iMe).toBeGreaterThan(iEnter);
    const enter = s.calls[iEnter];
    expect(enter.init.method).toBe('POST');
    expect(((enter.init.headers ?? {}) as Record<string, string>)['Authorization']).toBe(`Bearer ${s.token}`);

    expect(r).toEqual({ enter: 'personal', next: '/cases' });
    // Same session system as password / passkey: persisted tokens, profile, registry row.
    expect(JSON.parse(s.local.getItem('pf.session')!)).toEqual({ access_token: s.token, refresh_token: 'ref-g' });
    expect(s.auth.user()?.tenantKind).toBe('personal');
    expect(s.auth.accessToken()).toBe(s.token);
    expect(s.auth.accounts.accounts().map(a => a.userId)).toEqual(['app-g']);
    expect(s.auth.signedInWith()).toBe('google');
    // The verifier is single use.
    expect(s.session.m.has(PKCE_KEY)).toBe(false);
    await expect(s.auth.completeGoogleSignIn({ code: 'one-time-code' })).rejects.toMatchObject({ code: 'stale' });
  });

  it('lab-user branch: enter says the account is a lab user whose lab has case sheets → session over their lab, enter = lab', async () => {
    const s = setup({ enter: () => json(200, { kind: 'lab', labUser: true, created: false, caseSheets: true, tenantId: 't1' }), me: () => json(200, { success: true, data: LAB_ME }) });
    const r = await startAndReturn(s);
    expect(r).toEqual({ enter: 'lab', next: '/' });
    expect(s.auth.user()?.tenantId).toBe('t1');
    expect(s.auth.user()?.tenantKind).toBeUndefined();
  });

  it('a lab user whose lab has NO case sheets → "not available", no session, token revoked', async () => {
    const s = setup({ enter: () => json(200, { kind: 'lab', labUser: true, created: false, caseSheets: false, tenantId: 't1' }), me: () => json(200, { success: true, data: LAB_ME }) });
    await expect(startAndReturn(s)).rejects.toMatchObject({ code: 'unavailable', reason: 'lab_no_casesheets', message: ENTER_REFUSALS['lab_no_casesheets'] });
    expect(s.auth.user()).toBeNull();
    expect(s.local.getItem('pf.session')).toBeNull();
    expect(s.calls.some(c => c.url.endsWith('/api/auth/me'))).toBe(false);
  });

  it('every problem+json refusal maps to its own plain words (and 424 is "try again")', async () => {
    const cases: [number, string, string][] = [
      [401, 'not_signed_in', 'refused'], [403, 'provider_not_allowed', 'refused'], [403, 'email_missing', 'refused'],
      [403, 'email_not_allowed', 'refused'], [403, 'email_not_verified', 'refused'], [403, 'account_blocked', 'refused'],
      [403, 'account_inactive', 'refused'], [424, 'verification_unavailable', 'transient'],
    ];
    for (const [status, code, kind] of cases) {
      const s = setup({ enter: () => new Response(JSON.stringify({ status, title: 'x', code, traceId: 't' }), { status, headers: { 'Content-Type': 'application/problem+json' } }) });
      await expect(startAndReturn(s)).rejects.toMatchObject({ code: kind, reason: code, message: ENTER_REFUSALS[code] });
      expect(s.auth.user()).toBeNull();
    }
  });

  it('Google sign-in never calls /api/auth/session-started (the server audits it)', async () => {
    const s = setup();
    await startAndReturn(s);
    expect(s.calls.some(c => c.url.endsWith('/api/auth/session-started'))).toBe(false);
  });

  it('refused by personal/enter → no session left, the new token revoked', async () => {
    const s = setup({ enter: () => json(403, { code: 'email_not_verified' }) });
    await expect(startAndReturn(s)).rejects.toMatchObject({ code: 'refused' });
    expect(s.auth.user()).toBeNull();
    expect(s.local.getItem('pf.session')).toBeNull();
    await new Promise(r => setTimeout(r, 0));
    const revoke = s.calls.find(c => c.url === `${environment.auth.supabaseUrl}/auth/v1/logout?scope=local`);
    expect(((revoke?.init.headers ?? {}) as Record<string, string>)['Authorization']).toBe(`Bearer ${s.token}`);
    expect(s.calls.some(c => c.url.endsWith('/api/auth/me'))).toBe(false);
  });

  it('gate closed (enter 404) → unavailable; offline → transient; both without a session', async () => {
    const a = setup({ enter: () => json(404, null) });
    await expect(startAndReturn(a)).rejects.toMatchObject({ code: 'unavailable' });
    expect(a.auth.user()).toBeNull();
    const b = setup({ enter: () => { throw new TypeError('offline'); } });
    await expect(startAndReturn(b)).rejects.toMatchObject({ code: 'transient' });
    expect(b.local.getItem('pf.session')).toBeNull();
  });

  it('/me refuses the session → revoked, previous state kept', async () => {
    const s = setup({ me: () => json(403, { error: 'forbidden' }) });
    await expect(startAndReturn(s)).rejects.toBeInstanceOf(GoogleSignInError);
    expect(s.auth.user()).toBeNull();
    expect(s.local.getItem('pf.session')).toBeNull();
  });

  it('Google sent back an error / no code → cancelled; no token exchange', async () => {
    const s = setup();
    await s.auth.signInWithGoogle(null);
    await expect(s.auth.completeGoogleSignIn({ error: 'access_denied' })).rejects.toMatchObject({ code: 'cancelled' });
    expect(s.calls.some(c => c.url.includes('grant_type=pkce'))).toBe(false);
    // …and the verifier is gone with it.
    expect(s.session.m.has(PKCE_KEY)).toBe(false);
  });

  it('a callback link from another tab / browser (no verifier) is refused before any exchange', async () => {
    const s = setup();
    await expect(s.auth.completeGoogleSignIn({ code: 'stolen-code' })).rejects.toMatchObject({ code: 'stale' });
    expect(s.calls.some(c => c.url.includes('grant_type=pkce'))).toBe(false);
  });

  it('a rejected code exchange → stale, nothing persisted', async () => {
    const s = setup({ token: () => json(400, { error: 'invalid_grant' }) });
    await expect(startAndReturn(s)).rejects.toMatchObject({ code: 'stale' });
    expect(s.calls.some(c => c.url.endsWith('/personal/enter'))).toBe(false);
    expect(s.local.getItem('pf.session')).toBeNull();
  });
});

describe('LMS mode: no Google sign-in, and a personal space never boots the LMS', () => {
  it('signInWithGoogle / completeGoogleSignIn refuse outside casesheets mode', async () => {
    const s = setup({ mode: 'lms' });
    await expect(s.auth.signInWithGoogle(null)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(s.auth.completeGoogleSignIn({ code: 'c' })).rejects.toMatchObject({ code: 'unavailable' });
    expect(s.left).toHaveLength(0);
    expect(s.calls).toHaveLength(0);
  });

  it('a personal space’s token on an LMS host: /me is refused client-side → no profile, told where to go', async () => {
    const s = setup({ mode: 'lms' });
    await expect(s.auth.signInWithPasskeySession({ access_token: s.token, refresh_token: 'r' }))
      .rejects.toThrow(/case-sheet account\. Sign in at prepare\.prefrontal\.health/);
    expect(s.auth.user()).toBeNull();
    expect(s.local.getItem('pf.session')).toBeNull();
    expect(s.auth.accounts.accounts()).toHaveLength(0);
  });

  it('a restored personal session + cached profile on an LMS host never publishes that profile', async () => {
    env.mode = 'lms';
    TestBed.resetTestingModule();
    const local = memStorage();
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', memStorage());
    const token = jwt('sub-g');
    local.setItem('pf.session', JSON.stringify({ access_token: token, refresh_token: 'r' }));
    local.setItem('pf.profile:sub-g', JSON.stringify({ user: PERSONAL_ME, at: Date.now() }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/api/auth/me')) return json(200, { success: true, data: PERSONAL_ME });
      return new Response(null, { status: 204 });
    }));
    const ended: string[] = [];
    const auth = TestBed.inject(AuthService);
    auth.setSessionEndHandler(async (r) => { ended.push(r); auth.clearLocalSession(); });
    // The cached personal profile was NOT applied at boot (no instant LMS shell).
    expect(auth.user()).toBeNull();
    await auth.waitForAuth();
    await new Promise(r => setTimeout(r, 0));
    expect(auth.user()).toBeNull();
    expect(ended).toEqual(['expired']);
  });

  it('a lab profile on an LMS host is unaffected', async () => {
    const s = setup({ mode: 'lms', me: () => json(200, { success: true, data: LAB_ME }) });
    await s.auth.signInWithPasskeySession({ access_token: s.token, refresh_token: 'r' });
    expect(s.auth.user()?.tenantId).toBe('t1');
  });
});
