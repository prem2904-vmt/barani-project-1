import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { LoginComponent } from './login.component';
import { AuthService } from '../../core/auth/auth.service';
import { AccountsService } from '../../core/auth/accounts.service';
import { PasskeyService } from '../../core/auth/passkey.service';
import { PlatformService } from '../../core/services/platform.service';
import { BetaFeaturesService } from '../../core/services/beta-features.service';
import { appRoutes } from '../../app.routes';

/**
 * Remote support identity is an ADMIN-CONSOLE support token used only by
 * Claude Code on /support-mcp (owner 2026-10-31). Nothing in the LMS signs
 * anyone in with Google: no button (whatever the beta switches or the
 * returnUrl), no /auth/callback route. Password + passkey sign-in unchanged.
 */
@Component({ template: '' })
class BlankComponent {}

interface Opts { url?: string; passkeys?: boolean }

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
      { provide: PlatformService, useValue: { isCapacitor: signal(false), isElectron: signal(false) } },
      // Every beta switch on (incl. `support`): still no Google anywhere.
      { provide: BetaFeaturesService, useValue: { enabled: () => true, ensureLoaded: async () => undefined } },
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
  return { el, auth, router, settle };
}

const CONSENT = '/oauth/consent?authorization_id=auth-123';

afterEach(() => { document.body.innerHTML = ''; });

describe('Login — no Google sign-in (support uses admin-console tokens)', () => {
  it('no Google button or wording: plain login, consent return, beta support on', async () => {
    for (const url of ['/login', `/login?returnUrl=${encodeURIComponent(CONSENT)}`]) {
      const { el } = await render({ url });
      expect(el.querySelector('[data-testid="google-signin"]')).toBeNull();
      expect(el.textContent ?? '').not.toMatch(/google/i);
      expect(el.querySelector('button[type="submit"].pf-btn--primary')?.textContent).toContain('Sign in');
    }
  });

  it('no /auth/callback route in the app', () => {
    expect(appRoutes.some((r) => r.path === 'auth/callback')).toBe(false);
  });

  it('password sign-in unchanged', async () => {
    const { el, auth, router, settle } = await render();
    const set = (sel: string, v: string) => { const i = el.querySelector(sel) as HTMLInputElement; i.value = v; i.dispatchEvent(new Event('input')); };
    set('#lg-org', 'Micro World'); set('#lg-username', 'lt'); set('#lg-password', 'secret');
    await settle();
    (el.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await settle();
    expect(auth.signIn).toHaveBeenCalledWith('Micro World', 'lt', 'secret', undefined);
    expect(router.url).toBe('/');
  });

  it('passkey button still shows where passkeys are available', async () => {
    const { el } = await render({ passkeys: true });
    expect(el.querySelector('[data-testid="passkey-signin"]')).toBeTruthy();
    expect(el.querySelectorAll('.lg__or').length).toBe(1);
  });
});
