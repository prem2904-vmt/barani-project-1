import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

/**
 * "Continue with Google" — Supabase's Google provider through GoTrue's REST
 * endpoints with PKCE (RFC 7636), WITHOUT the supabase-js session (login
 * audit 2026-09-29: the SDK's own session storage revoked our tokens).
 *
 *   1. begin():   a random verifier (sessionStorage, this tab only, 10 min) →
 *                 GET {supabase}/auth/v1/authorize?provider=google
 *                     &redirect_to={origin}/auth/callback
 *                     &code_challenge=S256(verifier)&code_challenge_method=s256
 *   2. Google → Supabase → {origin}/auth/callback?code=…
 *   3. complete(): POST {supabase}/auth/v1/token?grant_type=pkce
 *                 {auth_code, code_verifier} → access + refresh token →
 *                 AuthService.signInWithGoogleSession (the SAME tail as the
 *                 password / passkey sign-in: persist, /me, registry, audit).
 *
 * Shown only with the beta `support` switch or on the way to the OAuth
 * consent page (`returnUrl=/oauth/consent…`), and never in the desktop /
 * phone apps (Google refuses sign-in inside embedded web views).
 */

/** sessionStorage key of the pending sign-in (verifier + return URL). */
export const GOOGLE_PENDING_KEY = 'pf.oauth.google.pending';
/** A pending sign-in older than this is refused (the code would be stale anyway). */
export const GOOGLE_PENDING_MAX_MS = 10 * 60 * 1000;
export const GOOGLE_CALLBACK_PATH = '/auth/callback';

export interface GooglePending { verifier: string; returnUrl: string | null; at: number }

/** Bytes → base64url without padding. */
export function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 random bytes → a 43-char verifier (RFC 7636 §4.1: 43–128 unreserved chars). */
export function newVerifier(rnd: Pick<Crypto, 'getRandomValues'> = crypto): string {
  const b = new Uint8Array(32);
  rnd.getRandomValues(b);
  return base64Url(b);
}

/** S256 code challenge of a verifier. */
export async function challengeFor(verifier: string, subtle: SubtleCrypto = crypto.subtle): Promise<string> {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function callbackUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}${GOOGLE_CALLBACK_PATH}`;
}

/** GoTrue's authorize URL for the Google provider (PKCE). */
export function authorizeUrl(o: { supabaseUrl: string; redirectTo: string; challenge: string }): string {
  const q = new URLSearchParams({
    provider: 'google',
    redirect_to: o.redirectTo,
    code_challenge: o.challenge,
    code_challenge_method: 's256',
  });
  return `${o.supabaseUrl.replace(/\/+$/, '')}/auth/v1/authorize?${q.toString()}`;
}

/** The consent page (where Claude's connector sign-in lands). */
export function isConsentReturn(returnUrl: string | null | undefined): boolean {
  return !!returnUrl && (returnUrl === '/oauth/consent' || returnUrl.startsWith('/oauth/consent?'));
}

/** When the login screen offers "Continue with Google". */
export function showGoogleSignIn(i: { betaSupport: boolean; returnUrl: string | null; native: boolean; addMode: boolean }): boolean {
  if (i.native || i.addMode) return false;
  return i.betaSupport || isConsentReturn(i.returnUrl);
}

/** What the callback URL carries: a code, or the provider's error in words. */
export function readCallback(search: string, hash = ''): { code: string } | { error: string } {
  const q = new URLSearchParams(search.replace(/^\?/, ''));
  const h = new URLSearchParams(hash.replace(/^#/, ''));
  const code = q.get('code');
  if (code && /^[A-Za-z0-9._~-]{8,512}$/.test(code)) return { code };
  const err = q.get('error') || h.get('error');
  if (err === 'access_denied') return { error: 'Google sign-in was cancelled.' };
  if (err) return { error: 'Google sign-in didn’t work. Try again, or use your organization, username and password.' };
  return { error: 'This sign-in link is incomplete. Start again from the sign-in screen.' };
}

/** Pending sign-in from storage — one-shot (always removed), fresh only. */
export function takePending(store: Pick<Storage, 'getItem' | 'removeItem'> | null, now = Date.now()): GooglePending | null {
  if (!store) return null;
  let raw: string | null = null;
  try { raw = store.getItem(GOOGLE_PENDING_KEY); store.removeItem(GOOGLE_PENDING_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as GooglePending;
    if (typeof p?.verifier !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(p.verifier)) return null;
    if (typeof p.at !== 'number' || now - p.at > GOOGLE_PENDING_MAX_MS || p.at > now + 60_000) return null;
    return { verifier: p.verifier, returnUrl: SessionService.isReturnable(p.returnUrl ?? '') ? p.returnUrl : null, at: p.at };
  } catch { return null; }
}

/** POST /auth/v1/token?grant_type=pkce → the session tokens. */
export async function exchangeCode(o: {
  supabaseUrl: string; anonKey: string; code: string; verifier: string; fetchImpl?: typeof fetch;
}): Promise<{ access_token: string; refresh_token: string }> {
  const f = o.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`${o.supabaseUrl.replace(/\/+$/, '')}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      headers: { apikey: o.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_code: o.code, code_verifier: o.verifier }),
      cache: 'no-store',
    });
  } catch {
    throw new Error('Can’t reach the server. Check your internet connection and try again.');
  }
  const json = await res.json().catch(() => null) as { access_token?: string; refresh_token?: string } | null;
  if (!res.ok || !json?.access_token || !json.refresh_token) {
    throw new Error('Google sign-in expired or was already used. Start again from the sign-in screen.');
  }
  return { access_token: json.access_token, refresh_token: json.refresh_token };
}

function session(): Storage | null {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; }
}

/** The two halves of the browser round trip. A class so specs can swap it. */
@Injectable({ providedIn: 'root' })
export class GoogleSignInService {
  private readonly auth = inject(AuthService);

  /** Leave for Google. `go` is the navigation (window.location.assign). */
  async begin(returnUrl: string | null, go: (url: string) => void = (u) => window.location.assign(u)): Promise<void> {
    const verifier = newVerifier();
    const challenge = await challengeFor(verifier);
    const store = session();
    if (!store) throw new Error('This browser blocks the storage sign-in needs. Use your organization, username and password.');
    const pending: GooglePending = { verifier, returnUrl: SessionService.isReturnable(returnUrl ?? '') ? returnUrl : null, at: Date.now() };
    store.setItem(GOOGLE_PENDING_KEY, JSON.stringify(pending));
    go(authorizeUrl({ supabaseUrl: environment.auth.supabaseUrl, redirectTo: callbackUrl(window.location.origin), challenge }));
  }

  /** Back from Google: exchange the code, start the normal session. Resolves to the return URL. */
  async complete(search: string, hash = ''): Promise<string | null> {
    const pending = takePending(session());
    const r = readCallback(search, hash);
    if ('error' in r) throw new Error(r.error);
    if (!pending) throw new Error('This sign-in was started in another tab or took too long. Start again from the sign-in screen.');
    const tokens = await exchangeCode({
      supabaseUrl: environment.auth.supabaseUrl, anonKey: environment.auth.supabaseAnonKey, code: r.code, verifier: pending.verifier,
    });
    await this.auth.signInWithGoogleSession(tokens);
    return pending.returnUrl;
  }
}
