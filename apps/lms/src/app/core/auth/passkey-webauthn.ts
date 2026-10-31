/**
 * Passkeys (WebAuthn) — the pure half: where the passkey UI may show, the
 * JSON <-> WebAuthn binary codec, and the ONE table of plain-words errors.
 *
 * Supabase Auth serves passkeys at `/auth/v1/passkeys/*` (supabase-js ≥ 2.117
 * wraps the same endpoints as `auth.signInWithPasskey()` / `auth.registerPasskey()`
 * / `auth.passkey.list|update|delete`). The LMS does not use the SDK for
 * sessions (AuthService, login audit 2026-09-29), so `PasskeyService` calls
 * those endpoints directly and this file does the codec the SDK would have
 * done (native WebAuthn Level 3 JSON helpers first, manual base64url fallback).
 */

// ── Where passkeys are offered ───────────────────────────────────────────

export interface PasskeyHost {
  /** `window.PublicKeyCredential` exists. */
  hasWebAuthn: boolean;
  /** `window.isSecureContext` (https, or localhost). */
  secure: boolean;
  /** `location.hostname`. */
  hostname: string;
  /** Desktop lab app (Electron) — native setup is a later phase. */
  isElectron: boolean;
  /** iOS / Android app (Capacitor) — needs associated domains / asset links first. */
  isCapacitor: boolean;
  /** The Supabase project's passkey RP ID (`environment.auth.passkeyRpId`). */
  rpId: string | null | undefined;
}

export type PasskeyUnavailableReason =
  | 'beta-off' | 'native' | 'desktop' | 'no-webauthn' | 'insecure' | 'not-configured' | 'origin';

export interface PasskeyAvailability {
  ok: boolean;
  reason: PasskeyUnavailableReason | null;
}

/** A WebAuthn RP ID is a bare domain: no scheme, port or path. */
export function isBareDomain(v: unknown): v is string {
  return typeof v === 'string' && /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(v.trim());
}

/** The page's host may use passkeys bound to `rpId` (equal, or a subdomain of it). */
export function originAllowed(hostname: string, rpId: string): boolean {
  const h = hostname.trim().toLowerCase();
  const r = rpId.trim().toLowerCase();
  return !!h && !!r && (h === r || h.endsWith(`.${r}`));
}

/**
 * Show passkey UI only in a real browser, on a secure page whose host the
 * server's RP ID covers. Native shells stay on passwords for now.
 */
export function passkeyAvailability(h: PasskeyHost): PasskeyAvailability {
  const no = (reason: PasskeyUnavailableReason): PasskeyAvailability => ({ ok: false, reason });
  if (h.isCapacitor) return no('native');
  if (h.isElectron) return no('desktop');
  if (!h.hasWebAuthn) return no('no-webauthn');
  if (!h.secure) return no('insecure');
  if (!isBareDomain(h.rpId)) return no('not-configured');
  if (!originAllowed(h.hostname, h.rpId)) return no('origin');
  return { ok: true, reason: null };
}

// ── base64url codec ──────────────────────────────────────────────────────

export function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(buf: ArrayBuffer | ArrayBufferView): string {
  const bytes = buf instanceof ArrayBuffer
    ? new Uint8Array(buf)
    : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const toBuffer = (s: string): ArrayBuffer => {
  const b = base64UrlToBytes(s);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

interface CredentialDescriptorJSON { id: string; type?: string; transports?: string[] }
type Json = Record<string, unknown>;

interface PkcStatics {
  parseCreationOptionsFromJSON?: (o: unknown) => PublicKeyCredentialCreationOptions;
  parseRequestOptionsFromJSON?: (o: unknown) => PublicKeyCredentialRequestOptions;
}

function pkcStatics(): PkcStatics | null {
  const g = globalThis as unknown as { PublicKeyCredential?: PkcStatics };
  return g.PublicKeyCredential ?? null;
}

const descriptors = (list: unknown): PublicKeyCredentialDescriptor[] | undefined => {
  if (!Array.isArray(list) || !list.length) return undefined;
  return (list as CredentialDescriptorJSON[]).map(c => ({
    ...c,
    id: toBuffer(c.id),
    type: 'public-key',
    transports: c.transports as AuthenticatorTransport[] | undefined,
  }));
};

/** Server JSON (base64url) → options for `navigator.credentials.create()`. */
export function toCreationOptions(json: Json): PublicKeyCredentialCreationOptions {
  const native = pkcStatics()?.parseCreationOptionsFromJSON;
  if (typeof native === 'function') return native.call(pkcStatics(), json);
  const { challenge, user, excludeCredentials, ...rest } = json as Json & {
    challenge: string; user: Json & { id: string }; excludeCredentials?: unknown;
  };
  const out = {
    ...rest,
    challenge: toBuffer(challenge),
    user: { ...user, id: toBuffer(user.id) },
  } as unknown as PublicKeyCredentialCreationOptions;
  const ex = descriptors(excludeCredentials);
  if (ex) out.excludeCredentials = ex;
  return out;
}

/** Server JSON (base64url) → options for `navigator.credentials.get()`. */
export function toRequestOptions(json: Json): PublicKeyCredentialRequestOptions {
  const native = pkcStatics()?.parseRequestOptionsFromJSON;
  if (typeof native === 'function') return native.call(pkcStatics(), json);
  const { challenge, allowCredentials, ...rest } = json as Json & { challenge: string; allowCredentials?: unknown };
  const out = { ...rest, challenge: toBuffer(challenge) } as unknown as PublicKeyCredentialRequestOptions;
  const allow = descriptors(allowCredentials);
  if (allow) out.allowCredentials = allow;
  return out;
}

/** A credential from create()/get() → the JSON Supabase verifies. */
export function credentialToJSON(cred: PublicKeyCredential): Json {
  const withJson = cred as PublicKeyCredential & { toJSON?: () => Json };
  if (typeof withJson.toJSON === 'function') return withJson.toJSON();
  const r = cred.response as AuthenticatorResponse & {
    attestationObject?: ArrayBuffer; authenticatorData?: ArrayBuffer;
    signature?: ArrayBuffer; userHandle?: ArrayBuffer | null;
  };
  const response: Json = { clientDataJSON: bytesToBase64Url(r.clientDataJSON) };
  if (r.attestationObject) response['attestationObject'] = bytesToBase64Url(r.attestationObject);
  if (r.authenticatorData) response['authenticatorData'] = bytesToBase64Url(r.authenticatorData);
  if (r.signature) response['signature'] = bytesToBase64Url(r.signature);
  if (r.userHandle) response['userHandle'] = bytesToBase64Url(r.userHandle);
  return {
    id: cred.id,
    rawId: cred.id,
    type: 'public-key',
    response,
    clientExtensionResults: typeof cred.getClientExtensionResults === 'function' ? cred.getClientExtensionResults() : {},
    authenticatorAttachment: (cred as PublicKeyCredential & { authenticatorAttachment?: string | null }).authenticatorAttachment ?? undefined,
  };
}

// ── Errors, in plain words ───────────────────────────────────────────────

export type PasskeyErrorKind =
  | 'cancelled' | 'not_found' | 'expired' | 'disabled' | 'exists' | 'too_many'
  | 'reauth' | 'banned' | 'network' | 'unsupported' | 'failed';

export class PasskeyError extends Error {
  constructor(readonly kind: PasskeyErrorKind, message?: string) {
    super(message ?? passkeyErrorText(kind));
    this.name = 'PasskeyError';
  }
}

/** The ONE place a passkey failure becomes words on screen. */
export function passkeyErrorText(kind: PasskeyErrorKind, during: 'signin' | 'add' = 'signin'): string {
  switch (kind) {
    case 'cancelled':
      return during === 'add'
        ? 'Passkey not added. You cancelled, or this device has no fingerprint, face or screen lock set up.'
        : 'Passkey sign-in was cancelled. Try again, or use your password.';
    case 'not_found':
      return 'That passkey isn’t linked to an account any more. Sign in with your password, then add a new passkey.';
    case 'expired': return 'That took too long. Please try again.';
    case 'disabled': return 'Passkeys aren’t turned on for this server yet. Use your password.';
    case 'exists': return 'This device already has a passkey for your account.';
    case 'too_many': return 'You have the most passkeys allowed. Remove one you no longer use, then add this one.';
    case 'reauth': return 'For your safety, sign out and sign in again with your password, then add the passkey.';
    case 'banned': return 'This account can’t sign in. Ask your admin.';
    case 'network': return 'Can’t reach the sign-in server. Check your internet connection and try again.';
    case 'unsupported': return 'Passkeys don’t work in this app or browser yet. Use your password.';
    default:
      return during === 'add' ? 'Couldn’t add the passkey. Please try again.' : 'Passkey sign-in failed. Try again, or use your password.';
  }
}

/** A browser WebAuthn rejection (DOMException name) → kind. */
export function kindFromDomError(e: unknown): PasskeyErrorKind {
  const name = (e as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'AbortError') return 'cancelled';
  if (name === 'InvalidStateError') return 'exists';
  if (name === 'NotSupportedError' || name === 'SecurityError') return 'unsupported';
  return 'failed';
}

/** A Supabase Auth error body / status → kind. */
export function kindFromAuthError(status: number, body: unknown): PasskeyErrorKind {
  const b = (body ?? {}) as { error_code?: string; code?: string | number };
  const code = String(b.error_code ?? (typeof b.code === 'string' ? b.code : '') ?? '');
  switch (code) {
    case 'webauthn_credential_not_found': return 'not_found';
    case 'webauthn_challenge_expired':
    case 'webauthn_challenge_not_found': return 'expired';
    case 'passkey_disabled': return 'disabled';
    case 'webauthn_credential_exists': return 'exists';
    case 'too_many_passkeys': return 'too_many';
    case 'reauthentication_needed':
    case 'insufficient_aal': return 'reauth';
    case 'user_banned': return 'banned';
  }
  if (status === 401) return 'reauth';
  if (status === 0 || status >= 500 || status === 429) return 'network';
  return 'failed';
}

// ── Labels ───────────────────────────────────────────────────────────────

/** A friendly default name for a new passkey: "Chrome on Mac". */
export function deviceLabel(ua: string): string {
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /CriOS\/|Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';
  const os = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'Chromebook'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return os ? `${browser} on ${os}` : browser;
}
