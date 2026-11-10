import { Component, TemplateRef, Type, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService, GoogleSignInError } from '../../../core/auth/auth.service';
import { SessionService } from '../../../core/auth/session.service';
import { CasesheetGateService } from '../shared/casesheet-gate.service';
import { CsAuthCallbackPage } from './cs-auth-callback.page';
import { CsSignInPage } from './cs-sign-in.page';
import { CsBottomNavComponent } from './cs-bottom-nav.component';
import { FormBarService } from '../data/form-bar/form-bar.service';
import { casesheetsSignInGuard, casesheetsSignedInGuard, publicAccess } from './public-access';

/**
 * The public case-sheet site's door: the access rule, the sign-in page (one Google button / "not available" with
 * Sign out) and the Google return's routing (personal → in; lab with case sheets → in; lab without → not available).
 */
@Component({ template: '' })
class Blank {}

type Who = null | { kind: 'personal' | 'lab'; email?: string };

function fakes(o: { who?: Who; gateOpen?: boolean; complete?: () => Promise<unknown> } = {}) {
  const user = signal<Record<string, unknown> | null>(
    o.who ? { id: 'u', email: o.who.email ?? 'meera@gmail.com', tenantName: 'Lab', tenantKind: o.who.kind === 'personal' ? 'personal' : undefined } : null);
  const auth = {
    user,
    isAuthenticated: () => !!user(),
    mustChangePassword: () => false,
    waitForAuth: async () => undefined,
    signInWithGoogle: vi.fn(async () => undefined),
    completeGoogleSignIn: vi.fn(o.complete ?? (async () => {
      user.set({ id: 'u', email: 'meera@gmail.com', tenantKind: 'personal' });
      return { enter: 'personal', next: '/cases' };
    })),
  };
  const gate = {
    ready: async () => undefined,
    visible: () => o.gateOpen ?? user()?.['tenantKind'] === 'personal',
  };
  const session = { logout: vi.fn(async () => { user.set(null); }) };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'sign-in', canActivate: [casesheetsSignInGuard], component: Blank },
        { path: 'auth/callback', component: Blank },
        { path: '', canActivate: [casesheetsSignedInGuard], children: [
          { path: '', pathMatch: 'full', component: Blank },
          { path: 'cases', component: Blank },
          { path: 'settings', component: Blank },
        ] },
      ]),
      { provide: AuthService, useValue: auth },
      { provide: CasesheetGateService, useValue: gate },
      { provide: SessionService, useValue: session },
    ],
  });
  return { auth, gate, session, router: TestBed.inject(Router) };
}

async function mount<T>(cmp: Type<T>) {
  const f = TestBed.createComponent(cmp);
  f.detectChanges();
  for (let i = 0; i < 5; i++) { await f.whenStable(); await new Promise(r => setTimeout(r, 0)); f.detectChanges(); }
  return { f, el: f.nativeElement as HTMLElement };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('publicAccess', () => {
  it('signed out / allowed / unavailable', () => {
    expect(publicAccess({ signedIn: false, mustChangePassword: false, gateOpen: true })).toBe('signed-out');
    expect(publicAccess({ signedIn: true, mustChangePassword: false, gateOpen: true })).toBe('allowed');
    expect(publicAccess({ signedIn: true, mustChangePassword: false, gateOpen: false })).toBe('unavailable');
    expect(publicAccess({ signedIn: true, mustChangePassword: true, gateOpen: true })).toBe('unavailable');
  });
});

describe('public guards', () => {
  it('signed out: every area → /sign-in (keeping where they were going)', async () => {
    const { router } = fakes();
    await router.navigateByUrl('/cases');
    expect(router.url).toBe('/sign-in?next=%2Fcases');
    await router.navigateByUrl('/');
    expect(router.url).toBe('/sign-in');
  });

  it('personal space: the areas open; /sign-in bounces to Departments', async () => {
    const { router } = fakes({ who: { kind: 'personal' } });
    expect(await router.navigateByUrl('/settings')).toBe(true);
    expect(router.url).toBe('/settings');
    await router.navigateByUrl('/sign-in');
    expect(router.url).toBe('/');
  });

  it('lab user whose lab has case sheets: in', async () => {
    const { router } = fakes({ who: { kind: 'lab' }, gateOpen: true });
    await router.navigateByUrl('/cases');
    expect(router.url).toBe('/cases');
  });

  it('lab user without case sheets: held on /sign-in (the "not available" card)', async () => {
    const { router } = fakes({ who: { kind: 'lab' }, gateOpen: false });
    await router.navigateByUrl('/cases');
    expect(router.url).toBe('/sign-in');
  });
});

describe('sign-in page', () => {
  it('signed out: Prefrontal case sheets branding + ONE "Continue with Google" button (Google mark), no "AI"', async () => {
    const { auth } = fakes();
    const { el, f } = await mount(CsSignInPage);
    const buttons = el.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    const g = el.querySelector('[data-testid="google-sign-in"]') as HTMLButtonElement;
    expect(g.textContent).toContain('Continue with Google');
    expect(g.querySelector('pf-google-mark svg')).toBeTruthy();
    expect(el.textContent).toContain('Prefrontal');
    expect(el.textContent).toContain('Case sheets');
    expect(el.textContent).not.toMatch(/\bAI\b/);
    expect(el.querySelector('input, select, datalist')).toBeNull();
    g.click();
    f.detectChanges();
    await f.whenStable();
    expect(auth.signInWithGoogle).toHaveBeenCalledWith(null);
  });

  it('shows why the last attempt failed (?e=) and a Google error in place', async () => {
    const { auth, router } = fakes();
    await router.navigateByUrl('/sign-in?e=refused');
    const { el, f } = await mount(CsSignInPage);
    expect(el.querySelector('[data-testid="cs-sign-in-notice"]')?.textContent).toContain('can’t be used for case sheets');
    auth.signInWithGoogle.mockRejectedValueOnce(new GoogleSignInError('transient', 'Secure sign-in isn’t available on this page.'));
    (el.querySelector('[data-testid="google-sign-in"]') as HTMLButtonElement).click();
    for (let i = 0; i < 3; i++) { await f.whenStable(); f.detectChanges(); }
    expect(el.querySelector('[data-testid="cs-sign-in-notice"]')?.textContent).toContain('Secure sign-in');
  });

  it('signed in but not available: plain card + Sign out (the ONE sign-out sequence), no Google button', async () => {
    const { session } = fakes({ who: { kind: 'lab', email: 'doc@lab.com' }, gateOpen: false });
    const { el, f } = await mount(CsSignInPage);
    expect(el.querySelector('[data-testid="cs-unavailable"]')?.textContent).toContain('Case sheets aren’t available for this account');
    expect(el.textContent).toContain('doc@lab.com');
    expect(el.querySelector('[data-testid="google-sign-in"]')).toBeNull();
    (el.querySelector('[data-testid="cs-sign-out"]') as HTMLButtonElement).click();
    for (let i = 0; i < 3; i++) { await f.whenStable(); f.detectChanges(); }
    expect(session.logout).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-testid="google-sign-in"]')).toBeTruthy();
  });

  it('never shows a synthetic staff auth address', async () => {
    fakes({ who: { kind: 'lab', email: 'lt@micro.tenant.prefrontal' }, gateOpen: false });
    const { el } = await mount(CsSignInPage);
    expect(el.textContent).not.toContain('tenant.prefrontal');
  });
});

describe('Google return (/auth/callback)', () => {
  it('personal space → where they were going (history replaced)', async () => {
    const { router, auth } = fakes();
    await router.navigateByUrl('/auth/callback?code=c1');
    await mount(CsAuthCallbackPage);
    expect(auth.completeGoogleSignIn).toHaveBeenCalledWith({ code: 'c1', error: null });
    expect(router.url).toBe('/cases');
  });

  it('lab user whose lab has case sheets → in (Departments)', async () => {
    const { router } = fakes({
      gateOpen: true,
      complete: async () => ({ enter: 'lab', next: '/' }),
    });
    const auth = TestBed.inject(AuthService) as unknown as { user: ReturnType<typeof signal<Record<string, unknown> | null>> };
    auth.user.set({ id: 'l', email: 'doc@lab.com' });
    await router.navigateByUrl('/auth/callback?code=c1');
    await mount(CsAuthCallbackPage);
    expect(router.url).toBe('/');
  });

  it('lab user without case sheets → /sign-in ("not available")', async () => {
    const { router } = fakes({ gateOpen: false, complete: async () => ({ enter: 'lab', next: '/' }) });
    const auth = TestBed.inject(AuthService) as unknown as { user: ReturnType<typeof signal<Record<string, unknown> | null>> };
    auth.user.set({ id: 'l', email: 'doc@lab.com' });
    await router.navigateByUrl('/auth/callback?code=c1');
    await mount(CsAuthCallbackPage);
    expect(router.url).toBe('/sign-in');
  });

  it('failure → /sign-in?e=<code>', async () => {
    const { router } = fakes({ complete: async () => { throw new GoogleSignInError('cancelled', 'x'); } });
    await router.navigateByUrl('/auth/callback?error=access_denied');
    await mount(CsAuthCallbackPage);
    expect(router.url).toBe('/sign-in?e=cancelled');
  });
});

describe('public bottom nav layering (WP11)', () => {
  it('sits on the LMS bottom-nav layer, below dialogs and sheets (it once covered the patient step\'s buttons)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/features/casesheets/public/cs-bottom-nav.component.ts'), 'utf8');
    const z = src.match(/\.csn \{[^}]*z-index:\s*([^;]+);/)?.[1].trim();
    expect(z).toBe('var(--pf-z-bottom-nav, 35)');
  });
});

describe('public bottom nav hosts an open sheet\'s Back · Pages · Next (WP11)', () => {
  @Component({
    standalone: true,
    imports: [CsBottomNavComponent],
    template: `<pf-cs-bottom-nav /><ng-template #bar><div class="lf-bar" data-test-bar>Back Pages Next</div></ng-template>`,
  })
  class NavHost {
    readonly bar = viewChild.required<TemplateRef<unknown>>('bar');
  }

  it('shows the three areas, then the lent controls in their place, then the areas again', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const f = TestBed.createComponent(NavHost);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll('[data-nav]').length).toBe(3);
    const formBar = TestBed.inject(FormBarService);
    const owner = {};
    formBar.show(owner, f.componentInstance.bar());
    f.detectChanges();
    expect(el.querySelector('[data-formbar] [data-test-bar]')).not.toBeNull();
    expect(el.querySelectorAll('[data-nav]').length).toBe(0);
    formBar.clear(owner);
    f.detectChanges();
    expect(el.querySelectorAll('[data-nav]').length).toBe(3);
  });
});

