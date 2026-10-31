import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { GoogleSignInService } from '../../core/auth/google-oauth';
import { AuthCallbackPage } from './auth-callback.page';

/** /auth/callback: success → the return URL (consent) or the landing; errors in words + back to sign in. */
@Component({ template: '' })
class BlankComponent {}

async function render(complete: () => Promise<string | null>, mustChange = false) {
  TestBed.resetTestingModule();
  const google = { complete: vi.fn(complete) };
  TestBed.configureTestingModule({
    imports: [AuthCallbackPage],
    providers: [
      provideRouter([{ path: '**', component: BlankComponent }]),
      { provide: GoogleSignInService, useValue: google },
      { provide: AuthService, useValue: { mustChangePassword: () => mustChange } },
    ],
  });
  const router = TestBed.inject(Router);
  const f = TestBed.createComponent(AuthCallbackPage);
  document.body.appendChild(f.nativeElement);
  f.detectChanges();
  for (let i = 0; i < 5; i++) { await f.whenStable(); await new Promise(r => setTimeout(r, 0)); f.detectChanges(); }
  return { f, router, google, el: f.nativeElement as HTMLElement };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('AuthCallbackPage', () => {
  it('success → the consent URL it started from', async () => {
    const { router } = await render(async () => '/oauth/consent?authorization_id=a');
    expect(router.url).toBe('/oauth/consent?authorization_id=a');
  });

  it('success without a return URL → the landing', async () => {
    const { router } = await render(async () => null);
    expect(router.url).toBe('/');
  });

  it('a temp password still goes to /set-password first (same rule as every sign-in)', async () => {
    const { router } = await render(async () => '/oauth/consent?authorization_id=a', true);
    expect(router.url).toBe('/set-password?returnUrl=%2Foauth%2Fconsent%3Fauthorization_id%3Da');
  });

  it('error → plain words + "Back to sign in"', async () => {
    const { el, router, f } = await render(async () => { throw new Error('Google sign-in was cancelled.'); });
    expect(el.textContent).toContain('Google sign-in was cancelled.');
    const btn = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('Back to sign in'))!;
    btn.click();
    await f.whenStable();
    expect(router.url.startsWith('/login')).toBe(true);
  });
});
