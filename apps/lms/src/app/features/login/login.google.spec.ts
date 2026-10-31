import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { LoginComponent } from './login.component';
import { AuthService } from '../../core/auth/auth.service';
import { AccountsService } from '../../core/auth/accounts.service';
import { PasskeyService } from '../../core/auth/passkey.service';
import { GoogleSignInService } from '../../core/auth/google-oauth';
import { PlatformService } from '../../core/services/platform.service';
import { BetaFeaturesService } from '../../core/services/beta-features.service';

/**
 * Login → "Continue with Google" (beta `support`, or on the way to the OAuth
 * consent page). Web only; never in Add-account. The password and passkey
 * sign-ins are untouched: same button, same call, same downstream.
 */
@Component({ template: '' })
class BlankComponent {}

interface Opts { url?: string; beta?: boolean; electron?: boolean; capacitor?: boolean; passkeys?: boolean; begin?: () => Promise<void> }

async function render(o: Opts = {}) {
  TestBed.resetTestingModule();
  const user = signal<{ id: string } | null>(null);
  const auth = {
    user,
    isAuthenticated: () => !!user(),
    rememberedOrgs: signal<string[]>(['Micro World']),
    mustChangePassword: () => false,
    hasAnyPermission: () => true,
    hasAnyEffectivePermission: () => true,
    permissions: () => ['*'],
    signIn: vi.fn(async () => { user.set({ id: 'u1' }); }),
    signInWithPasskeySession: vi.fn(async () => { user.set({ id: 'u1' }); }),
  };
  const google = { begin: vi.fn(o.begin ?? (async () => undefined)) };
  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      provideRouter([
        { path: 'login', component: LoginComponent },
        { path: 'oauth/consent', component: BlankComponent },
        { path: '', component: BlankComponent },
      ]),
      { provide: AuthService, useValue: auth },
      { provide: AccountsService, useValue: { active: () => ({ tenantId: 't1', org: 'Micro World' }), accounts: () => [] } },
      { provide: PasskeyService, useValue: { available: () => !!o.passkeys, conditionalAvailable: async () => false, authenticate: vi.fn() } },
      { provide: PlatformService, useValue: { isCapacitor: signal(!!o.capacitor), isElectron: signal(!!o.electron) } },
      { provide: BetaFeaturesService, useValue: { enabled: (k: string) => k === 'support' && !!o.beta, ensureLoaded: async () => undefined } },
      { provide: GoogleSignInService, useValue: google },
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
  return { fixture, el, auth, google, router, settle };
}

const googleBtn = (el: HTMLElement) => el.querySelector('[data-testid="google-signin"]') as HTMLButtonElement | null;
const CONSENT = '/oauth/consent?authorization_id=auth-123';

afterEach(() => { document.body.innerHTML = ''; });

describe('Login — Continue with Google', () => {
  it('hidden on a normal login (no beta, no consent return): the screen is exactly the password form', async () => {
    const { el } = await render();
    expect(googleBtn(el)).toBeNull();
    expect(el.querySelector('.lg__or')).toBeNull();
    expect(el.querySelector('button[type="submit"].pf-btn--primary')?.textContent).toContain('Sign in');
  });

  it('shown on the way to the OAuth consent page, and with the beta `support` switch', async () => {
    const c = await render({ url: `/login?returnUrl=${encodeURIComponent(CONSENT)}` });
    expect(googleBtn(c.el)?.textContent).toContain('Continue with Google');
    expect(googleBtn(c.el)?.querySelector('svg')).toBeTruthy();
    expect(googleBtn(c.el)?.classList.contains('pf-btn--primary')).toBe(false);   // the one primary stays Sign in
    const b = await render({ beta: true });
    expect(googleBtn(b.el)).toBeTruthy();
  });

  it('never in the desktop / phone apps (Google refuses embedded web views) or in Add-account', async () => {
    expect(googleBtn((await render({ beta: true, electron: true })).el)).toBeNull();
    expect(googleBtn((await render({ beta: true, capacitor: true })).el)).toBeNull();
    expect(googleBtn((await render({ beta: true, url: '/login?add=1' })).el)).toBeNull();
  });

  it('click → leaves for Google carrying the exact consent return URL; the password path is not called', async () => {
    const { el, google, auth, settle } = await render({ url: `/login?returnUrl=${encodeURIComponent(CONSENT)}` });
    googleBtn(el)!.click();
    await settle();
    expect(google.begin).toHaveBeenCalledWith(CONSENT);
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(auth.signInWithPasskeySession).not.toHaveBeenCalled();
  });

  it('an error starting Google shows plain words and the button works again', async () => {
    const { el, settle } = await render({ beta: true, begin: async () => { throw new Error('Failed to fetch'); } });
    googleBtn(el)!.click();
    await settle();
    expect(el.querySelector('#lg-error')?.textContent).toContain('Can\'t reach the server');
    expect(googleBtn(el)!.disabled).toBe(false);
  });

  it('password sign-in is unchanged with the Google button on screen', async () => {
    const { el, auth, router, settle, google } = await render({ beta: true });
    const set = (sel: string, v: string) => { const i = el.querySelector(sel) as HTMLInputElement; i.value = v; i.dispatchEvent(new Event('input')); };
    set('#lg-org', 'Micro World'); set('#lg-username', 'lt'); set('#lg-password', 'secret');
    await settle();
    (el.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await settle();
    expect(auth.signIn).toHaveBeenCalledWith('Micro World', 'lt', 'secret', undefined);
    expect(google.begin).not.toHaveBeenCalled();
    expect(router.url).toBe('/');
  });

  it('passkey and Google together share one "or" divider', async () => {
    const { el } = await render({ beta: true, passkeys: true });
    expect(el.querySelectorAll('.lg__or').length).toBe(1);
    expect(el.querySelector('[data-testid="passkey-signin"]')).toBeTruthy();
    expect(googleBtn(el)).toBeTruthy();
  });
});
