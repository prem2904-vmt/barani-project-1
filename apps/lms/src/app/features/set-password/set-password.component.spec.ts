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

/**
 * The form itself (layout-independent): validation says why instead of a
 * silently disabled button, the server's reason surfaces inline, Enter in the
 * confirm field submits, and a second press while saving does nothing.
 */
describe('SetPasswordComponent → form', () => {
  async function mount(changePassword: () => Promise<void> = async () => undefined) {
    const auth = { changePassword: vi.fn(changePassword) };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SetPasswordComponent],
      providers: [
        provideRouter([
          { path: 'set-password', component: SetPasswordComponent },
          { path: '', component: BlankComponent },
        ]),
        { provide: AuthService, useValue: auth },
        { provide: SessionService, useValue: { logout: vi.fn(async () => undefined) } },
      ],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/set-password');
    const f = TestBed.createComponent(SetPasswordComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const type = async (sel: string, v: string) => {
      const i = el.querySelector(sel) as HTMLInputElement;
      i.value = v;
      i.dispatchEvent(new Event('input'));
      f.detectChanges();
      await f.whenStable();
      f.detectChanges();
    };
    const nav = vi.spyOn(router, 'navigateByUrl');
    return { f, el, auth, type, nav, session: TestBed.inject(SessionService) as unknown as { logout: ReturnType<typeof vi.fn> } };
  }

  const alertText = (el: HTMLElement) => el.querySelector('[role="alert"]')?.textContent?.trim() ?? '';

  it('both fields are new-password fields with show / hide', async () => {
    const { f, el } = await mount();
    const inputs = el.querySelectorAll('input');
    expect(Array.from(inputs).map(i => i.getAttribute('autocomplete'))).toEqual(['new-password', 'new-password']);
    expect(inputs[0].type).toBe('password');
    (el.querySelector('button[aria-label="Show password"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(inputs[0].type).toBe('text');
  });

  it('too short: inline hint while typing, and submitting says why without calling the server', async () => {
    const { f, el, auth, type } = await mount();
    await type('#sp-new-pw', 'short');
    expect(el.textContent).toContain('At least 8 characters.');
    expect(el.querySelector('#sp-new-pw')!.getAttribute('aria-invalid')).toBe('true');
    (el.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await f.whenStable(); f.detectChanges();
    expect(alertText(el)).toContain('8–64 characters');
    expect(auth.changePassword).not.toHaveBeenCalled();
  });

  it('longer than 64 is refused too', async () => {
    const { f, el, auth, type } = await mount();
    const long = 'x'.repeat(65);
    await type('#sp-new-pw', long);
    await type('#sp-confirm-pw', long);
    (el.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await f.whenStable(); f.detectChanges();
    expect(alertText(el)).toContain('8–64 characters');
    expect(auth.changePassword).not.toHaveBeenCalled();
  });

  it('mismatch: inline hint, and Enter in the confirm field explains instead of doing nothing', async () => {
    const { f, el, auth, type } = await mount();
    await type('#sp-new-pw', 'a-good-password');
    await type('#sp-confirm-pw', 'a-good-passwore');
    expect(el.textContent).toContain('The two passwords don’t match yet.');
    el.querySelector('#sp-confirm-pw')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await f.whenStable(); f.detectChanges();
    expect(alertText(el)).toContain('don’t match');
    expect(auth.changePassword).not.toHaveBeenCalled();
  });

  it('Enter in the first field moves to the confirm field', async () => {
    const { el } = await mount();
    const first = el.querySelector('#sp-new-pw') as HTMLInputElement;
    const second = el.querySelector('#sp-confirm-pw') as HTMLInputElement;
    document.body.appendChild(el);
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(document.activeElement).toBe(second);
    el.remove();
  });

  it('a good pair + Enter → saved once, then home; a second press while saving is ignored', async () => {
    let release!: () => void;
    const { f, el, auth, type, nav } = await mount(() => new Promise<void>(r => { release = r; }));
    await type('#sp-new-pw', 'a-good-password');
    await type('#sp-confirm-pw', 'a-good-password');
    el.querySelector('#sp-confirm-pw')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    f.detectChanges();
    const submit = el.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toContain('Saving');
    submit.click();
    expect(auth.changePassword).toHaveBeenCalledTimes(1);
    release();
    await f.whenStable();
    expect(nav).toHaveBeenCalledWith('/');
  });

  it('the server’s reason (e.g. a breached password) shows inline and clears on edit', async () => {
    const { f, el, type, nav } = await mount(async () => { throw new Error('This password has appeared in a data breach — choose another.'); });
    await type('#sp-new-pw', 'password123');
    await type('#sp-confirm-pw', 'password123');
    (el.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await f.whenStable(); f.detectChanges();
    expect(alertText(el)).toContain('data breach');
    expect(nav).not.toHaveBeenCalled();
    await type('#sp-new-pw', 'password1234');
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('“Sign in as someone else” runs the one sign-out sequence', async () => {
    const { el, session } = await mount();
    const btn = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('Sign in as someone else'))!;
    btn.click();
    expect(session.logout).toHaveBeenCalled();
  });
});
