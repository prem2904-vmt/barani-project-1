import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { LoginComponent } from './login.component';
import { AuthService } from '../../core/auth/auth.service';
import { AccountsService } from '../../core/auth/accounts.service';
import { PasskeyService } from '../../core/auth/passkey.service';
import { PasskeyOfferService, PASSKEY_OFFER_SEEN_PREFIX } from '../../core/auth/passkey-offer';
import { PasskeyError } from '../../core/auth/passkey-webauthn';
import { PlatformService } from '../../core/services/platform.service';

/**
 * Login → "Sign in with a passkey" (beta, dev only, web only):
 *  - the button shows only where passkeys are available, never in Add-account;
 *  - success runs the SAME downstream (temp-password gate → returnUrl → landing);
 *  - cancel is a calm note, errors are plain words; password login untouched;
 *  - after a PASSWORD sign-in the one-time passkey suggestion is queued —
 *    never in Electron, never twice, never on a shared (multi-profile) device.
 */
@Component({ template: '' })
class BlankComponent {}

function memStorage(init: Record<string, string> = {}) {
  const m = new Map<string, string>(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
  };
}

interface Opts {
  url?: string;
  available?: boolean;
  electron?: boolean;
  authenticate?: () => Promise<{ access_token: string; refresh_token: string }>;
  mustChange?: boolean;
  accounts?: number;
  seen?: boolean;
  activeAccount?: { tenantId: string; org: string } | null;
  conditional?: boolean;
}

async function render(o: Opts = {}) {
  TestBed.resetTestingModule();
  vi.stubGlobal('localStorage', memStorage(o.seen ? { [PASSKEY_OFFER_SEEN_PREFIX + 'u1']: '1' } : {}));
  const user = signal<{ id: string } | null>(null);
  const mustChange = signal(false);
  const auth = {
    user,
    isAuthenticated: () => !!user(),
    rememberedOrgs: signal<string[]>(['Micro World']),
    mustChangePassword: () => mustChange(),
    hasAnyPermission: () => true,
    hasAnyEffectivePermission: () => true,
    permissions: () => ['*'],
    signIn: vi.fn(async () => { user.set({ id: 'u1' }); }),
    signInWithPasskeySession: vi.fn(async () => { user.set({ id: 'u1' }); if (o.mustChange) mustChange.set(true); }),
  };
  const passkeys = {
    available: () => o.available ?? true,
    conditionalAvailable: async () => !!o.conditional,
    authenticate: vi.fn(o.authenticate ?? (async () => ({ access_token: 'acc', refresh_token: 'ref' }))),
  };
  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      provideRouter([
        { path: 'login', component: LoginComponent },
        { path: 'frontdesk', component: BlankComponent },
        { path: 'oauth/consent', component: BlankComponent },
        { path: 'set-password', component: BlankComponent },
        { path: '', component: BlankComponent },
      ]),
      { provide: AuthService, useValue: auth },
      { provide: AccountsService, useValue: {
        active: () => o.activeAccount ?? null,
        accounts: () => Array.from({ length: o.accounts ?? 1 }, (_, i) => ({ userId: `u${i + 1}` })),
      } },
      { provide: PasskeyService, useValue: passkeys },
      { provide: PlatformService, useValue: { isCapacitor: signal(false), isElectron: signal(!!o.electron) } },
    ],
  });
  const router = TestBed.inject(Router);
  await router.navigateByUrl(o.url ?? '/login');
  const fixture = TestBed.createComponent(LoginComponent);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => { for (let i = 0; i < 4; i++) { await fixture.whenStable(); fixture.detectChanges(); } };
  return { fixture, el, auth, passkeys, router, settle, offer: TestBed.inject(PasskeyOfferService) };
}

afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

type AuthOpts = { mediation?: string; onPicked?: () => void };
async function renderAutofill(impl: (o: AuthOpts) => Promise<{ access_token: string; refresh_token: string }>, url = '/login') {
  let first = true;
  const r = await render({
    url,
    conditional: true,
    authenticate: ((o: AuthOpts) => {
      if (!first) return new Promise(() => undefined);   // re-armed autofill: stays pending
      first = false;
      return impl(o);
    }) as unknown as Opts['authenticate'],
  });
  await r.settle();
  return r;
}

describe('Login — sign in with a passkey', () => {
  it('shows the passkey button (SVG icon, no emoji) where passkeys are available', async () => {
    const { el } = await render();
    const btn = el.querySelector('[data-testid="passkey-signin"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('Sign in with a passkey');
    expect(btn.querySelector('svg')).toBeTruthy();
    expect(btn.getAttribute('type')).toBe('button');
    // Password login is unchanged and still the one primary.
    expect(el.querySelector('button[type="submit"].pf-btn--primary')).toBeTruthy();
    expect(el.querySelector('#lg-password')).toBeTruthy();
  });

  it('hides it where passkeys are not available (Electron / phone apps / beta off) and in Add-account', async () => {
    expect((await render({ available: false })).el.querySelector('[data-testid="passkey-signin"]')).toBeNull();
    const add = await render({ url: '/login?add=1', activeAccount: { tenantId: 't1', org: 'Micro World' } });
    expect(add.el.querySelector('[data-testid="passkey-signin"]')).toBeNull();
  });

  it('success → AuthService passkey session → the landing, without touching the password path', async () => {
    const { el, auth, passkeys, router, settle } = await render();
    (el.querySelector('[data-testid="passkey-signin"]') as HTMLButtonElement).click();
    await settle();
    expect(passkeys.authenticate).toHaveBeenCalledWith(expect.objectContaining({ onPicked: expect.any(Function) }));
    expect(auth.signInWithPasskeySession).toHaveBeenCalledWith({ access_token: 'acc', refresh_token: 'ref' });
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(router.url).toBe('/');
  });

  it('honours a returnUrl (e.g. the OAuth consent screen) after a passkey sign-in', async () => {
    const { el, router, settle } = await render({ url: '/login?returnUrl=%2Foauth%2Fconsent%3Fclient%3Dx' });
    (el.querySelector('[data-testid="passkey-signin"]') as HTMLButtonElement).click();
    await settle();
    expect(router.url).toBe('/oauth/consent?client=x');
  });

  it('a temp password still forces /set-password after a passkey sign-in (keeping the return URL, same as the password path)', async () => {
    const { el, router, settle } = await render({ mustChange: true, url: '/login?returnUrl=%2Ffrontdesk' });
    (el.querySelector('[data-testid="passkey-signin"]') as HTMLButtonElement).click();
    await settle();
    expect(router.url).toBe('/set-password?returnUrl=%2Ffrontdesk');
  });

  it('a temp password + consent link: /set-password carries the exact consent URL (one returnUrl rule for both paths)', async () => {
    const consent = '/oauth/consent?authorization_id=abc';
    const { el, router, settle } = await render({ mustChange: true, url: '/login?returnUrl=' + encodeURIComponent(consent) });
    (el.querySelector('[data-testid="passkey-signin"]') as HTMLButtonElement).click();
    await settle();
    expect(router.url).toBe('/set-password?returnUrl=' + encodeURIComponent(consent));
  });

  it('cancel → a calm note (not an error), stays on the login screen', async () => {
    const { el, auth, router, settle } = await render({ authenticate: async () => { throw new PasskeyError('cancelled'); } });
    (el.querySelector('[data-testid="passkey-signin"]') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('.lg__pknote')?.textContent).toContain('cancelled');
    expect(el.querySelector('#lg-error')).toBeNull();
    expect(auth.signInWithPasskeySession).not.toHaveBeenCalled();
    expect(router.url).toBe('/login');
  });

  it('an error shows plain words in the form error', async () => {
    const { el, settle } = await render({ authenticate: async () => { throw new PasskeyError('not_found'); } });
    (el.querySelector('[data-testid="passkey-signin"]') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('#lg-error')?.textContent).toContain('isn’t linked to an account');
  });
});

describe('Login — passkey autofill (conditional UI)', () => {
  it('listens in the username field and stays SILENT when the background request fails', async () => {
    TestBed.resetTestingModule();
    const r = await renderAutofill(async () => { throw new PasskeyError('network'); });
    expect(r.passkeys.authenticate).toHaveBeenCalledWith(expect.objectContaining({ mediation: 'conditional' }));
    expect(r.el.querySelector('#lg-username')?.getAttribute('autocomplete')).toBe('username webauthn');
    expect(r.el.querySelector('#lg-error')).toBeNull();
  });

  it('a passkey picked from autofill signs in and follows the returnUrl', async () => {
    const r = await renderAutofill(async (o) => { o.onPicked?.(); return { access_token: 'a', refresh_token: 'r' }; }, '/login?returnUrl=%2Ffrontdesk');
    expect(r.auth.signInWithPasskeySession).toHaveBeenCalled();
    expect(r.router.url).toBe('/frontdesk');
  });

  it('an error AFTER a passkey was picked is shown', async () => {
    const r = await renderAutofill(async (o) => { o.onPicked?.(); throw new PasskeyError('not_found'); });
    expect(r.el.querySelector('#lg-error')?.textContent).toContain('isn’t linked');
  });
});

describe('Login — the one-time passkey suggestion (shared-PC rule)', () => {
  async function passwordLogin(o: Opts) {
    const r = await render(o);
    const set = (id: string, v: string) => {
      const i = r.el.querySelector(id) as HTMLInputElement;
      i.value = v; i.dispatchEvent(new Event('input'));
    };
    set('#lg-username', 'lt');
    set('#lg-password', 'pw');
    r.fixture.detectChanges();
    (r.el.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await r.settle();
    return r;
  }

  it('queues the offer after a password sign-in in a web browser', async () => {
    const { offer, auth } = await passwordLogin({});
    expect(auth.signIn).toHaveBeenCalled();
    expect(offer.pending()).toBe('u1');
  });

  it('never in the desktop lab app (Electron)', async () => {
    expect((await passwordLogin({ electron: true })).offer.pending()).toBeNull();
  });

  it('never twice for the same user on this device', async () => {
    expect((await passwordLogin({ seen: true })).offer.pending()).toBeNull();
  });

  it('never on a shared device (more than one saved profile)', async () => {
    expect((await passwordLogin({ accounts: 2 })).offer.pending()).toBeNull();
  });

  it('never where passkeys are unavailable (beta off)', async () => {
    expect((await passwordLogin({ available: false })).offer.pending()).toBeNull();
  });

  it('never after a passkey sign-in', async () => {
    const { el, offer, settle } = await render();
    (el.querySelector('[data-testid="passkey-signin"]') as HTMLButtonElement).click();
    await settle();
    expect(offer.pending()).toBeNull();
  });
});
