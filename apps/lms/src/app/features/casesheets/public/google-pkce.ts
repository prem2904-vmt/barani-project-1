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

/**
 * What `POST /api/casesheets/personal/enter` said (plan §4.2; the FINAL backend contract, docs/CASESHEETS.md §1.5):
 *  - 200 `{kind:"personal", labUser:false, created, caseSheets:true, tenantId}` — a personal space (made now or before);
 *  - 200 `{kind:"lab", labUser:true, created:false, caseSheets, tenantId}` — already lab staff: no personal space; the case-sheet
 *    shell runs over their lab when `caseSheets` is true, else case sheets are "not available" for them;
 *  - empty 404 — case sheets are switched off here;
 *  - problem+json refusals: 401 `not_signed_in`; 403 `provider_not_allowed` / `email_missing` / `email_not_allowed` /
 *    `email_not_verified` / `account_blocked` / `account_inactive`; 424 `verification_unavailable`.
 */
export type EnterAnswer =
  | { kind: 'personal'; tenantId: string | null; created: boolean }
  | { kind: 'lab'; tenantId: string | null; caseSheets: boolean }
  /** Case sheets are switched off here (the gate's empty 404). */
  | { kind: 'unavailable' }
  /** The server refused this account; `reason` is the problem `code` (see {@link ENTER_REFUSALS}). */
  | { kind: 'refused'; reason: string }
  /** Couldn't reach / the server failed (or couldn't verify the account right now): try again. */
  | { kind: 'transient'; reason?: string };

/** The refusal codes personal/enter sends → plain, kind words for the sign-in page. */
export const ENTER_REFUSALS: Record<string, string> = {
  not_signed_in: 'Google sign-in didn’t finish. Please try again.',
  provider_not_allowed: 'Case sheets use Google sign-in. Please continue with Google.',
  email_missing: 'Your Google account didn’t share an e-mail address. Please try another Google account.',
  email_not_allowed: 'This e-mail address can’t be used for case sheets. Please use your own Google account.',
  email_not_verified: 'Your Google e-mail address isn’t verified yet. Verify it with Google, then try again.',
  account_blocked: 'This account has been blocked. Please contact Prefrontal support.',
  account_inactive: 'This account isn’t active. Please contact Prefrontal support.',
  verification_unavailable: 'We couldn’t check your Google account just now. Please try again in a moment.',
  lab_no_casesheets: 'Case sheets aren’t switched on for your lab yet. Ask your lab admin to turn them on.',
};

/** Read the enter answer (raw JSON / problem+json, as the case-sheet API sends it). */
export function readEnterAnswer(status: number, body: unknown): EnterAnswer {
  const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  if (status === 200 || status === 201) {
    if (o['kind'] === 'lab' || o['labUser'] === true) return { kind: 'lab', tenantId: str(o['tenantId']), caseSheets: o['caseSheets'] === true };
    if (o['kind'] === 'personal') return { kind: 'personal', tenantId: str(o['tenantId']), created: o['created'] === true };
    return { kind: 'transient' };   // a 2xx we don't understand: never guess a space
  }
  if (status === 404) return { kind: 'unavailable' };
  const code = String(o['code'] ?? '').toLowerCase();
  if (status === 424) return { kind: 'transient', reason: 'verification_unavailable' };
  if (status === 401 || status === 403) return { kind: 'refused', reason: code in ENTER_REFUSALS ? code : 'refused' };
  if (status === 0 || status === 408 || status === 429 || status >= 500) return { kind: 'transient' };
  return { kind: 'refused', reason: code in ENTER_REFUSALS ? code : 'refused' };
}
