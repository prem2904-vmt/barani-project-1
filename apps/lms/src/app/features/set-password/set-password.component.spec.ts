import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { SessionService } from '../../core/auth/session.service';
import { SetPasswordComponent } from './set-password.component';

/**
 * Forced password change → where next. Normal sign-in: the app root (the
 * landing guard routes by permission) — unchanged. Reached with a return URL
 * (an AI connector consent link that went through login): back to that exact
 * URL. Only in-app paths are followed.
 */
@Component({ template: '' })
class BlankComponent {}

async function render(url: string) {
  const auth = { changePassword: vi.fn(async () => undefined) };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [SetPasswordComponent],
    providers: [
      provideRouter([
        { path: 'set-password', component: SetPasswordComponent },
        { path: 'oauth/consent', component: BlankComponent },
        { path: '', component: BlankComponent },
      ]),
      { provide: AuthService, useValue: auth },
      { provide: SessionService, useValue: { logout: vi.fn() } },
    ],
  });
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  const f = TestBed.createComponent(SetPasswordComponent);
  f.detectChanges();
  const cmp = f.componentInstance as unknown as { pw: { set(v: string): void }; confirm: { set(v: string): void }; submit(): Promise<void> };
  cmp.pw.set('a-good-password');
  cmp.confirm.set('a-good-password');
  const nav = vi.spyOn(router, 'navigateByUrl');
  await cmp.submit();
  return { auth, nav };
}

describe('SetPasswordComponent → next screen', () => {
  it('no return URL → the app root, as before', async () => {
    const { auth, nav } = await render('/set-password');
    expect(auth.changePassword).toHaveBeenCalledWith('a-good-password');
    expect(nav).toHaveBeenCalledWith('/');
  });

  it('with the consent return URL → back to that exact URL', async () => {
    const consent = '/oauth/consent?authorization_id=auth-123';
    const { nav } = await render('/set-password?returnUrl=' + encodeURIComponent(consent));
    expect(nav).toHaveBeenCalledWith(consent);
  });

  it('an external / auth-screen return URL is ignored', async () => {
    let r = await render('/set-password?returnUrl=' + encodeURIComponent('https://evil.example'));
    expect(r.nav).toHaveBeenCalledWith('/');
    r = await render('/set-password?returnUrl=' + encodeURIComponent('//evil.example'));
    expect(r.nav).toHaveBeenCalledWith('/');
    r = await render('/set-password?returnUrl=' + encodeURIComponent('/login'));
    expect(r.nav).toHaveBeenCalledWith('/');
  });
});
