import { Injectable, signal } from '@angular/core';

/**
 * "Sign in faster next time with fingerprint or face?" — the ONLY place the
 * app ever suggests a passkey (shared-PC rule, clinical audit trail):
 *  - only right after a PASSWORD sign-in (never after a passkey one),
 *  - never in the desktop lab app (Electron) or the phone apps,
 *  - never when the device looks shared (Add-account mode, or more than one
 *    profile saved on it),
 *  - once per user per device — the "seen" mark is set the moment the card is
 *    SHOWN, so a lab bench never nags.
 * Nothing is ever created without the person pressing "Set up".
 */
export interface PasskeyOfferInput {
  /** Passkey UI is allowed here (`passkeyAvailability().ok`). */
  available: boolean;
  isElectron: boolean;
  isCapacitor: boolean;
  /** How THIS session started. */
  signedInWith: 'password' | 'passkey' | null;
  /** Login screen was in "Add account" mode (a shared lab machine). */
  addMode: boolean;
  /** Profiles saved on this device (AccountsService). */
  accountsOnDevice: number;
  /** The card was already shown to this user on this device. */
  seen: boolean;
}

export function shouldOfferPasskey(i: PasskeyOfferInput): boolean {
  if (!i.available || i.isElectron || i.isCapacitor) return false;
  if (i.signedInWith !== 'password') return false;
  if (i.addMode || i.accountsOnDevice > 1) return false;
  return !i.seen;
}

export const PASSKEY_OFFER_SEEN_PREFIX = 'pf.passkeyOffer.seen:';

export function offerSeen(userId: string): boolean {
  try { return localStorage.getItem(PASSKEY_OFFER_SEEN_PREFIX + userId) === '1'; } catch { return false; }
}

export function markOfferSeen(userId: string): void {
  try { localStorage.setItem(PASSKEY_OFFER_SEEN_PREFIX + userId, '1'); } catch { /* private mode */ }
}

/** The pending offer, handed from the login screen to the shell card (memory only). */
@Injectable({ providedIn: 'root' })
export class PasskeyOfferService {
  private readonly _pending = signal<string | null>(null);
  /** User id the card may be shown to, or null. */
  readonly pending = this._pending.asReadonly();

  /** Login: a password sign-in just finished and every rule above passed. */
  offer(userId: string): void { this._pending.set(userId); }

  /** The card is on screen: never again for this user on this device. */
  shown(userId: string): void { markOfferSeen(userId); }

  /** "Not now" / done / signed out: hide the card. */
  clear(): void { this._pending.set(null); }
}
