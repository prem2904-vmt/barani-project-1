import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth/auth.service';

/**
 * Supabase OAuth 2.1 server — the consent half (MCP Phase 0).
 *
 * WHY NOT `supabase.auth.oauth.*`: the installed @supabase/supabase-js
 * (2.104.x) has `getAuthorizationDetails / approveAuthorization /
 * denyAuthorization`, but this app deliberately has NO Supabase client for
 * sessions (login audit 2026-09-29, AuthService constructor): the SDK's own
 * storage held a stale refresh token, `getSession()` silently refreshed it
 * and Supabase's reuse detection revoked the whole session. Those helpers run
 * through the SDK's `_useSession()` — they would need exactly that client.
 * So we call the SAME documented GoTrue endpoints the SDK calls, with the
 * token AuthService owns (the way revokeSession / postRefresh already talk to
 * Supabase directly):
 *
 *   GET  {supabaseUrl}/auth/v1/oauth/authorizations/{id}
 *   POST {supabaseUrl}/auth/v1/oauth/authorizations/{id}/consent  {action}
 *
 * Nothing here ever approves on its own — only the Allow button calls approve().
 */

/** The OAuth client asking for access. `name` is UNTRUSTED text (anyone can
 *  register a client) — templates render it as text, never as HTML. */
export interface OAuthClientInfo {
  id?: string;
  name: string;
  uri?: string;
  logo_uri?: string;
}

/** Consent needed: show the screen. */
export interface OAuthAuthorizationDetails {
  authorization_id: string;
  redirect_uri: string;
  client: OAuthClientInfo;
  user?: { id: string; email: string };
  scope: string;
}

/** Already consented / decided: go back to the app. */
export interface OAuthRedirect { redirect_url: string }

export type ConsentErrorKind = 'missing' | 'expired' | 'signed-out' | 'network' | 'framed' | 'unknown';

/** A consent call failed — `kind` picks the plain words on screen. */
export class ConsentError extends Error {
  constructor(readonly kind: ConsentErrorKind, message?: string) {
    super(message ?? kind);
    this.name = 'ConsentError';
  }
}

/** Same discrimination the SDK documents: no authorization_id ⇒ redirect. */
export function isConsentNeeded(d: OAuthAuthorizationDetails | OAuthRedirect): d is OAuthAuthorizationDetails {
  return !!(d as OAuthAuthorizationDetails)?.authorization_id;
}

/** Plain words for each failure (no codes, no hosts). */
export function consentErrorText(kind: ConsentErrorKind): string {
  switch (kind) {
    case 'missing': return 'This link is missing its request. Go back to the app you were connecting and start again.';
    case 'expired': return 'This request has expired or was already used. Go back to the app you were connecting and start again.';
    case 'signed-out': return 'Your sign-in has ended. Sign in again to continue.';
    case 'framed': return 'Open this page directly in your browser. For your safety it can’t be used inside another page.';
    case 'network': return 'Can’t reach the sign-in server. Check your connection and try again.';
    default: return 'Something went wrong with this request. Go back to the app you were connecting and try again.';
  }
}

/**
 * Where a decision may send the browser: an absolute https URL, or http only
 * on this machine (MCP Inspector / local tools). Anything else — javascript:,
 * data:, a relative path, garbage — is refused, whatever the server said.
 */
export function safeRedirectUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol === 'https:') return u.toString();
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]')) return u.toString();
  return null;
}

/** The host a redirect goes to, for the "you go back to …" line. */
export function redirectHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try { return new URL(raw).host || null; } catch { return null; }
}

@Injectable({ providedIn: 'root' })
export class OAuthConsentClient {
  private readonly auth = inject(AuthService);

  getDetails(authorizationId: string): Promise<OAuthAuthorizationDetails | OAuthRedirect> {
    return this.call<OAuthAuthorizationDetails | OAuthRedirect>('GET', authorizationId);
  }

  async approve(authorizationId: string): Promise<OAuthRedirect> {
    return this.call<OAuthRedirect>('POST', authorizationId, 'approve');
  }

  async deny(authorizationId: string): Promise<OAuthRedirect> {
    return this.call<OAuthRedirect>('POST', authorizationId, 'deny');
  }

  /** One consent call; a 401 refreshes the token once (single-flight in
   *  AuthService) and retries. */
  private async call<T>(method: 'GET' | 'POST', id: string, action?: 'approve' | 'deny', retried = false): Promise<T> {
    if (!id) throw new ConsentError('missing');
    const token = await this.auth.getAccessToken();
    if (!token) throw new ConsentError('signed-out');
    const base = `${environment.auth.supabaseUrl}/auth/v1/oauth/authorizations/${encodeURIComponent(id)}`;
    let res: Response;
    try {
      res = await fetch(action ? `${base}/consent` : base, {
        method,
        headers: {
          apikey: environment.auth.supabaseAnonKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Supabase-Api-Version': '2024-01-01',
        },
        body: action ? JSON.stringify({ action }) : undefined,
        cache: 'no-store',
      });
    } catch {
      throw new ConsentError('network');
    }
    if (res.status === 401 && !retried) {
      const r = await this.auth.refreshSession();
      if (r === 'ok') return this.call<T>(method, id, action, true);
      throw new ConsentError(r === 'transient' ? 'network' : 'signed-out');
    }
    if (res.status === 401 || res.status === 403) throw new ConsentError('signed-out');
    if (res.status === 404 || res.status === 410) throw new ConsentError('expired');
    if (res.status >= 500) throw new ConsentError('network');
    const body = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!res.ok) {
      const text = String(body?.['msg'] ?? body?.['message'] ?? body?.['error_description'] ?? body?.['error_code'] ?? '');
      throw new ConsentError(/expire|not.?found|invalid.*(authori[sz]ation|request)|already/i.test(text) ? 'expired' : 'unknown', text);
    }
    if (!body) throw new ConsentError('unknown');
    return body as T;
  }
}
