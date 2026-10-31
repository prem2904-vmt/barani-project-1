import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import {
  GOOGLE_PENDING_KEY, GOOGLE_PENDING_MAX_MS, GoogleSignInService, authorizeUrl, base64Url, callbackUrl, challengeFor,
  exchangeCode, isConsentReturn, newVerifier, readCallback, showGoogleSignIn, takePending,
} from './google-oauth';

/**
 * "Continue with Google" (PKCE against GoTrue's REST endpoints, never the
 * supabase-js session): verifier / challenge per RFC 7636, the authorize URL,
 * the one-shot pending state, the code exchange, and the hand-off to
 * AuthService's normal session tail.
 */
function memStorage(init: Record<string, string> = {}) {
  const m = new Map<string, string>(Object.entries(init));
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

afterEach(() => vi.unstubAllGlobals());

describe('google-oauth (pure)', () => {
  it('S256 challenge matches RFC 7636 appendix B', async () => {
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('verifier: 43 base64url chars from 32 random bytes, different each time', () => {
    const a = newVerifier();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newVerifier()).not.toBe(a);
    expect(base64Url(new Uint8Array([251, 255]))).toBe('-_8');
  });

  it('authorize URL: Google provider, our callback, S256 challenge — nothing else', () => {
    const u = new URL(authorizeUrl({ supabaseUrl: 'https://x.supabase.co/', redirectTo: callbackUrl('https://med-dev.prefrontal.health'), challenge: 'abc' }));
    expect(u.origin + u.pathname).toBe('https://x.supabase.co/auth/v1/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      provider: 'google', redirect_to: 'https://med-dev.prefrontal.health/auth/callback', code_challenge: 'abc', code_challenge_method: 's256',
    });
  });

  it('shown with the beta switch or a consent return URL; never native / Add-account', () => {
    expect(showGoogleSignIn({ betaSupport: false, returnUrl: null, native: false, addMode: false })).toBe(false);
    expect(showGoogleSignIn({ betaSupport: false, returnUrl: '/frontdesk', native: false, addMode: false })).toBe(false);
    expect(showGoogleSignIn({ betaSupport: false, returnUrl: '/oauth/consent?authorization_id=a', native: false, addMode: false })).toBe(true);
    expect(showGoogleSignIn({ betaSupport: true, returnUrl: null, native: false, addMode: false })).toBe(true);
    expect(showGoogleSignIn({ betaSupport: true, returnUrl: null, native: true, addMode: false })).toBe(false);
    expect(showGoogleSignIn({ betaSupport: true, returnUrl: null, native: false, addMode: true })).toBe(false);
    expect(isConsentReturn('/oauth/consentx')).toBe(false);
  });

  it('callback: a code, or plain words for cancel / errors / nothing', () => {
    expect(readCallback('?code=abc-123_XYZ')).toEqual({ code: 'abc-123_XYZ' });
    expect(readCallback('?error=access_denied&error_description=x')).toEqual({ error: 'Google sign-in was cancelled.' });
    expect('error' in readCallback('', '#error=server_error')).toBe(true);
    expect('error' in readCallback('?code=<script>')).toBe(true);
    expect(readCallback('')).toEqual({ error: 'This sign-in link is incomplete. Start again from the sign-in screen.' });
  });

  it('pending state is one-shot, fresh only, and keeps only a safe in-app return URL', () => {
    const v = 'a'.repeat(43);
    const st = memStorage({ [GOOGLE_PENDING_KEY]: JSON.stringify({ verifier: v, returnUrl: '/oauth/consent?authorization_id=a', at: 1000 }) });
    expect(takePending(st, 2000)).toEqual({ verifier: v, returnUrl: '/oauth/consent?authorization_id=a', at: 1000 });
    expect(st.m.has(GOOGLE_PENDING_KEY)).toBe(false);
    expect(takePending(st, 2000)).toBeNull();
    const stale = memStorage({ [GOOGLE_PENDING_KEY]: JSON.stringify({ verifier: v, returnUrl: null, at: 0 }) });
    expect(takePending(stale, GOOGLE_PENDING_MAX_MS + 1)).toBeNull();
    const evil = memStorage({ [GOOGLE_PENDING_KEY]: JSON.stringify({ verifier: v, returnUrl: '//evil.com', at: 1000 }) });
    expect(takePending(evil, 2000)?.returnUrl).toBeNull();
    expect(takePending(memStorage({ [GOOGLE_PENDING_KEY]: '{bad' }), 2000)).toBeNull();
  });

  it('code exchange: POST token?grant_type=pkce with the anon key; refusal in plain words', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ access_token: 'acc', refresh_token: 'ref' }), { status: 200 }));
    const t = await exchangeCode({ supabaseUrl: 'https://x.supabase.co', anonKey: 'anon', code: 'c0de-c0de', verifier: 'v'.repeat(43), fetchImpl: f as unknown as typeof fetch });
    expect(t).toEqual({ access_token: 'acc', refresh_token: 'ref' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://x.supabase.co/auth/v1/token?grant_type=pkce');
    expect((init.headers as Record<string, string>)['apikey']).toBe('anon');
    expect(JSON.parse(init.body as string)).toEqual({ auth_code: 'c0de-c0de', code_verifier: 'v'.repeat(43) });
    const bad = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    await expect(exchangeCode({ supabaseUrl: 'https://x', anonKey: 'a', code: 'c0de-c0de', verifier: 'v', fetchImpl: bad as unknown as typeof fetch }))
      .rejects.toThrow(/expired or was already used/);
  });
});

describe('GoogleSignInService', () => {
  function setup() {
    TestBed.resetTestingModule();
    const ss = memStorage();
    vi.stubGlobal('sessionStorage', ss);
    const auth = { signInWithGoogleSession: vi.fn(async () => undefined) };
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: auth }] });
    return { svc: TestBed.inject(GoogleSignInService), auth, ss };
  }

  it('begin → stores the verifier + return URL for this tab and leaves for GoTrue authorize', async () => {
    const { svc, ss } = setup();
    const go = vi.fn();
    await svc.begin('/oauth/consent?authorization_id=a', go);
    const pending = JSON.parse(ss.getItem(GOOGLE_PENDING_KEY)!);
    expect(pending.returnUrl).toBe('/oauth/consent?authorization_id=a');
    const u = new URL(go.mock.calls[0][0] as string);
    expect(u.origin).toBe(new URL(environment.auth.supabaseUrl).origin);
    expect(u.searchParams.get('code_challenge')).toBe(await challengeFor(pending.verifier));
    expect(u.searchParams.get('redirect_to')).toBe(`${window.location.origin}/auth/callback`);
  });

  it('complete → exchanges the code and hands the tokens to AuthService (the normal session + /me path)', async () => {
    const { svc, auth } = setup();
    await svc.begin('/oauth/consent?authorization_id=a', () => undefined);
    const f = vi.fn(async () => new Response(JSON.stringify({ access_token: 'acc', refresh_token: 'ref' }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const back = await svc.complete('?code=c0de-c0de');
    expect(back).toBe('/oauth/consent?authorization_id=a');
    expect(auth.signInWithGoogleSession).toHaveBeenCalledWith({ access_token: 'acc', refresh_token: 'ref' });
  });

  it('complete without a pending sign-in (another tab / replay) is refused before any exchange', async () => {
    const { svc, auth } = setup();
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(svc.complete('?code=c0de-c0de')).rejects.toThrow(/another tab|too long/);
    expect(f).not.toHaveBeenCalled();
    expect(auth.signInWithGoogleSession).not.toHaveBeenCalled();
  });
});
