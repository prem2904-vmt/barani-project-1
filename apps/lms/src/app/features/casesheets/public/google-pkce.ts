/**
 * Google sign-in for the public case-sheet site (plan §4.3) — the PKCE half, pure and DOM-light.
 *
 * Why not supabase-js: the LMS never runs a supabase-js session (login audit 2026-09-29 — its own storage held a
 * stale refresh token and revoked sessions; AuthService purges every `sb-*` key on boot, which would also wipe the
 * SDK's code verifier mid-redirect). So the flow talks to GoTrue's REST endpoints exactly as supabase-js's PKCE
 * flow does, and the tokens it returns go through AuthService's ONE session system (persist, single-flight refresh).
 *
 *   1. {@link startPkce}: random verifier (kept in sessionStorage for THIS tab only, 10 min, single use) +
 *      S256 challenge → `GET {supabase}/auth/v1/authorize?provider=google&redirect_to=…&code_challenge=…`.
 *   2. Google → Supabase → `/auth/callback?code=…` (or `?error=…`).
 *   3. {@link takePkce} + `POST {supabase}/auth/v1/token?grant_type=pkce {auth_code, code_verifier}` → tokens.
 *
 * Nothing about WHO the person is is read from here: the server decides (personal/enter + /me), and
 * Supabase `user_metadata` is never trusted.
 */

/** sessionStorage key of the in-flight sign-in (verifier + where to go after). */
export const PKCE_KEY = 'pf.cs.pkce';
/** A verifier older than this is refused (a stale tab / an abandoned Google page). */
export const PKCE_TTL_MS = 10 * 60_000;
/** Where to land after signing in when nothing (valid) was asked for: Departments. */
export const DEFAULT_NEXT = '/';

export interface PkceRecord {
  verifier: string;
  next: string;
  at: number;
}

export interface PkceStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** Only same-app paths of the case-sheet site are a post-sign-in target (no open redirect, never back to sign-in). */
export function safeNext(next: string | null | undefined): string {
  if (!next || typeof next !== 'string') return DEFAULT_NEXT;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return DEFAULT_NEXT;
  if (/^\/(sign-in|login)(\/|\?|#|$)/.test(next) || next.startsWith('/auth/')) return DEFAULT_NEXT;
  return next;
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 7636 verifier: 32 random bytes → 43 base64url characters. */
export function newVerifier(rand: (a: Uint8Array) => Uint8Array = a => crypto.getRandomValues(a)): string {
  return base64url(rand(new Uint8Array(32)));
}

/** S256 challenge = base64url(SHA-256(verifier)). Throws where WebCrypto is missing (never send `plain`). */
export async function challengeFor(verifier: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Secure sign-in needs a secure (https) page.');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** The GoTrue authorize URL (same parameters supabase-js's PKCE `signInWithOAuth` sends). */
export function authorizeUrl(supabaseUrl: string, redirectTo: string, challenge: string): string {
  const q = new URLSearchParams({
    provider: 'google',
    redirect_to: redirectTo,
    code_challenge: challenge,
    code_challenge_method: 's256',
    // Let a shared tablet pick the right Google account every time.
    prompt: 'select_account',
  });
  return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/authorize?${q.toString()}`;
}

/** Step 1: make + remember the verifier; returns the URL to leave for. */
export async function startPkce(o: {
  supabaseUrl: string;
  origin: string;
  next: string | null | undefined;
  storage: PkceStorage;
  now?: number;
  rand?: (a: Uint8Array) => Uint8Array;
}): Promise<string> {
  const verifier = newVerifier(o.rand);
  const challenge = await challengeFor(verifier);
  const rec: PkceRecord = { verifier, next: safeNext(o.next), at: o.now ?? Date.now() };
  o.storage.setItem(PKCE_KEY, JSON.stringify(rec));
  return authorizeUrl(o.supabaseUrl, `${o.origin.replace(/\/+$/, '')}/auth/callback`, challenge);
}

/** Step 3: read AND remove the remembered verifier (single use). Null = none / unreadable / expired. */
export function takePkce(storage: PkceStorage | null, now = Date.now()): PkceRecord | null {
  if (!storage) return null;
  let raw: string | null = null;
  try { raw = storage.getItem(PKCE_KEY); } catch { return null; }
  try { storage.removeItem(PKCE_KEY); } catch { /* blocked storage */ }
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<PkceRecord>;
    if (typeof r.verifier !== 'string' || r.verifier.length < 43 || typeof r.at !== 'number') return null;
    if (now - r.at > PKCE_TTL_MS || r.at > now + 60_000) return null;
    return { verifier: r.verifier, next: safeNext(r.next), at: r.at };
  } catch {
    return null;
  }
}

export function safeSessionStorage(): PkceStorage | null {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; }
}

/** What `POST /api/casesheets/personal/enter` said (plan §4.2; WP4 owns the endpoint). */
export type EnterAnswer =
  /** A personal space exists (created now or before) for this Google account. */
  | { kind: 'personal' }
  /** The account is already a lab user: no personal space; the case-sheet shell runs over their lab (if it has them). */
  | { kind: 'lab' }
  /** Case sheets are switched off here (the gate's empty 404). */
  | { kind: 'unavailable' }
  /** The server refused this account (not Google, unverified e-mail, a staff address…). */
  | { kind: 'refused' }
  /** Couldn't reach / the server failed: try again. */
  | { kind: 'transient' };

/**
 * Read the enter answer. Accepts the Prepare-style raw body and the LMS `ApiResponse` wrapper, and the lab-user
 * signal as `labUser: true`, `kind|tenantKind|status|result: 'lab' | 'lab_user'` (2xx) or a 409 / problem `code`
 * `lab_user`. Anything unknown in a 2xx is a personal space — the shell is still decided by /me afterwards.
 */
export function readEnterAnswer(status: number, body: unknown): EnterAnswer {
  const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const d = (o['data'] && typeof o['data'] === 'object' ? o['data'] : o) as Record<string, unknown>;
  const err = (o['error'] && typeof o['error'] === 'object' ? o['error'] : {}) as Record<string, unknown>;
  const code = String(d['code'] ?? err['code'] ?? o['code'] ?? '').toLowerCase();
  const isLab = d['labUser'] === true || d['isLabUser'] === true || code === 'lab_user'
    || ['kind', 'tenantKind', 'status', 'result'].some(k => /^lab(_user)?$/i.test(String(d[k] ?? '')));
  if (status >= 200 && status < 300) return isLab ? { kind: 'lab' } : { kind: 'personal' };
  if (status === 409 && isLab) return { kind: 'lab' };
  if (status === 404) return { kind: 'unavailable' };
  if (status === 0 || status === 408 || status === 429 || status >= 500) return { kind: 'transient' };
  return { kind: 'refused' };
}
