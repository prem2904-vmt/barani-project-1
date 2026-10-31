import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { PlatformService } from '../services/platform.service';
import { BetaFeaturesService } from '../services/beta-features.service';
import { AuthService } from './auth.service';
import {
  PasskeyAvailability, PasskeyError, credentialToJSON, deviceLabel, kindFromAuthError, kindFromDomError,
  passkeyAvailability, toCreationOptions, toRequestOptions,
} from './passkey-webauthn';

/** One passkey on the account (Supabase `GET /passkeys`). */
export interface PasskeyItem {
  id: string;
  friendlyName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/** The tokens a passkey sign-in returns — the SAME Supabase session a password sign-in gets. */
export interface PasskeySession {
  access_token: string;
  refresh_token: string;
}

interface ListRow { id: string; friendly_name?: string | null; created_at: string; last_used_at?: string | null }
interface ChallengeResponse { challenge_id: string; options: Record<string, unknown> }

const toItem = (r: ListRow): PasskeyItem => ({
  id: r.id,
  friendlyName: r.friendly_name?.trim() || null,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at ?? null,
});

/**
 * Passkeys against Supabase Auth's `/auth/v1/passkeys/*` endpoints — the same
 * ones supabase-js ≥ 2.117 calls from `auth.signInWithPasskey()` /
 * `auth.registerPasskey()` / `auth.passkey.*`. Called directly (like
 * AuthService's refresh / logout) because the SDK's session storage is not
 * used in this app. A passkey sign-in only produces tokens; AuthService then
 * runs the exact password-login tail (persist, /me, temp-password gate).
 */
@Injectable({ providedIn: 'root' })
export class PasskeyService {
  private readonly platform = inject(PlatformService);
  private readonly auth = inject(AuthService);
  private readonly beta = inject(BetaFeaturesService);

  /** BETA gate (owner 2026-10-31): server flag `passkeys` && the DEV
   *  environment. Reactive — read it inside computed / templates. Off = no
   *  passkey UI anywhere (login button, autofill, offer card, Passkeys page). */
  enabled(): boolean { return this.beta.enabled('passkeys'); }

  /** Where passkey UI may show (read lazily: /config.json may set the RP ID). */
  availability(): PasskeyAvailability {
    if (!this.enabled()) return { ok: false, reason: 'beta-off' };
    const w = typeof window !== 'undefined' ? window : undefined;
    return passkeyAvailability({
      hasWebAuthn: !!w && typeof (w as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential === 'function',
      secure: !!w?.isSecureContext,
      hostname: w?.location?.hostname ?? '',
      isElectron: this.platform.isElectron(),
      isCapacitor: this.platform.isCapacitor(),
      rpId: (environment.auth as { passkeyRpId?: string | null }).passkeyRpId ?? null,
    });
  }

  available(): boolean { return this.availability().ok; }

  /** Browser can offer passkeys in the username field's autofill (conditional UI). */
  async conditionalAvailable(): Promise<boolean> {
    if (!this.available()) return false;
    const pkc = (window as unknown as { PublicKeyCredential?: { isConditionalMediationAvailable?: () => Promise<boolean> } }).PublicKeyCredential;
    try { return !!(await pkc?.isConditionalMediationAvailable?.()); } catch { return false; }
  }

  // ── Sign in (no username: discoverable credential) ─────────────────────

  /** `onPicked` fires once the person chose a passkey (before the server checks it). */
  async authenticate(opts: { mediation?: 'conditional'; signal?: AbortSignal; onPicked?: () => void } = {}): Promise<PasskeySession> {
    if (!this.available()) throw new PasskeyError('unsupported');
    const ch = await this.call<ChallengeResponse>('POST', '/passkeys/authentication/options', { body: {} });
    let cred: Credential | null;
    try {
      cred = await navigator.credentials.get({
        publicKey: toRequestOptions(ch.options),
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.mediation ? { mediation: opts.mediation as CredentialMediationRequirement } : {}),
      });
    } catch (e) {
      throw new PasskeyError(kindFromDomError(e));
    }
    if (!cred) throw new PasskeyError('cancelled');
    opts.onPicked?.();
    const data = await this.call<Record<string, unknown>>('POST', '/passkeys/authentication/verify', {
      body: { challenge_id: ch.challenge_id, credential: credentialToJSON(cred as PublicKeyCredential) },
    });
    const s = (data['session'] as PasskeySession | undefined) ?? (data as unknown as PasskeySession);
    if (!s?.access_token || !s.refresh_token) throw new PasskeyError('failed');
    return { access_token: s.access_token, refresh_token: s.refresh_token };
  }

  // ── Manage (signed in) ─────────────────────────────────────────────────

  /** Create a passkey on THIS device for the signed-in user. */
  async register(): Promise<PasskeyItem> {
    if (!this.available()) throw new PasskeyError('unsupported');
    const token = await this.token();
    const ch = await this.call<ChallengeResponse>('POST', '/passkeys/registration/options', { token, body: {} });
    let cred: Credential | null;
    try {
      cred = await navigator.credentials.create({ publicKey: toCreationOptions(ch.options) });
    } catch (e) {
      throw new PasskeyError(kindFromDomError(e));
    }
    if (!cred) throw new PasskeyError('cancelled');
    const row = await this.call<ListRow>('POST', '/passkeys/registration/verify', {
      token, body: { challenge_id: ch.challenge_id, credential: credentialToJSON(cred as PublicKeyCredential) },
    });
    let item = toItem(row);
    // A name the person recognises in the list ("Chrome on Mac"); best effort.
    if (!item.friendlyName && typeof navigator !== 'undefined') {
      try { item = await this.rename(item.id, deviceLabel(navigator.userAgent)); } catch { /* keep unnamed */ }
    }
    return item;
  }

  async list(): Promise<PasskeyItem[]> {
    const rows = await this.call<ListRow[] | null>('GET', '/passkeys', { token: await this.token() });
    return (rows ?? []).map(toItem);
  }

  async rename(id: string, name: string): Promise<PasskeyItem> {
    const friendly = name.trim().slice(0, 120);
    const row = await this.call<ListRow>('PATCH', `/passkeys/${encodeURIComponent(id)}`, {
      token: await this.token(), body: { friendly_name: friendly },
    });
    return toItem(row ?? { id, friendly_name: friendly, created_at: '' });
  }

  async remove(id: string): Promise<void> {
    await this.call<unknown>('DELETE', `/passkeys/${encodeURIComponent(id)}`, { token: await this.token() });
  }

  // ── plumbing ───────────────────────────────────────────────────────────

  private async token(): Promise<string> {
    const t = await this.auth.getAccessToken();
    if (!t) throw new PasskeyError('reauth');
    return t;
  }

  private async call<T>(method: string, path: string, o: { token?: string; body?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = { apikey: environment.auth.supabaseAnonKey };
    if (o.token) headers['Authorization'] = `Bearer ${o.token}`;
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(`${environment.auth.supabaseUrl}/auth/v1${path}`, {
        method, headers, cache: 'no-store',
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      });
    } catch {
      throw new PasskeyError('network');
    }
    const text = await res.text().catch(() => '');
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) throw new PasskeyError(kindFromAuthError(res.status, json));
    return json as T;
  }
}
