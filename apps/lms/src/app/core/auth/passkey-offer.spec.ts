import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PASSKEY_OFFER_SEEN_PREFIX, PasskeyOfferInput, PasskeyOfferService, offerSeen, shouldOfferPasskey } from './passkey-offer';

/** The one-time passkey suggestion — shared-PC rule (clinical audit trail). */
const base: PasskeyOfferInput = {
  available: true, isElectron: false, isCapacitor: false, signedInWith: 'password',
  addMode: false, accountsOnDevice: 1, seen: false,
};

describe('shouldOfferPasskey', () => {
  it('offers once, after a password sign-in, in a browser, on a single-profile device', () => {
    expect(shouldOfferPasskey(base)).toBe(true);
  });
  it.each([
    ['passkeys unavailable / beta off', { available: false }],
    ['desktop lab app (Electron)', { isElectron: true }],
    ['phone app (Capacitor)', { isCapacitor: true }],
    ['after a passkey sign-in', { signedInWith: 'passkey' as const }],
    ['restored session', { signedInWith: null }],
    ['Add-account (shared machine)', { addMode: true }],
    ['several profiles on the device', { accountsOnDevice: 2 }],
    ['already shown to this user here', { seen: true }],
  ])('never: %s', (_label, patch) => {
    expect(shouldOfferPasskey({ ...base, ...patch })).toBe(false);
  });
});

describe('PasskeyOfferService', () => {
  function memStorage() {
    const m = new Map<string, string>();
    return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
  }
  afterEach(() => vi.unstubAllGlobals());

  it('shown() marks the user seen on this device; clear() hides it', () => {
    const store = memStorage();
    vi.stubGlobal('localStorage', store);
    const svc = TestBed.inject(PasskeyOfferService);
    svc.offer('u1');
    expect(svc.pending()).toBe('u1');
    svc.shown('u1');
    expect(store.m.get(PASSKEY_OFFER_SEEN_PREFIX + 'u1')).toBe('1');
    expect(offerSeen('u1')).toBe(true);
    expect(offerSeen('u2')).toBe(false);
    svc.clear();
    expect(svc.pending()).toBeNull();
  });

  it('a blocked localStorage never throws and reads as not seen', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } });
    expect(offerSeen('u1')).toBe(false);
    expect(() => TestBed.inject(PasskeyOfferService).shown('u1')).not.toThrow();
  });
});
