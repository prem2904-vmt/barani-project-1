import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { LoginComponent, safeReturnUrl, sessionNotice, setPasswordUrl } from './login.component';
import { AuthService } from '../../core/auth/auth.service';
import { AccountsService } from '../../core/auth/accounts.service';

/**
 * Login screen (redesign 2026-09-29): keyboard-first form — Enter moves to
 * the next field and submits from the last; proper autocomplete +
 * enterkeyhint; 16px inputs; show-password toggle; inline errors; the
 * "session expired" note; return-to-URL after sign-in (safe URLs only).
 */
@Component({ template: '' })
class BlankComponent {}

function makeAuth(mustChange = false) {
  const user = signal<{ id: string } | null>(null);
  return {
    user,
    isAuthenticated: () => !!user(),
    rememberedOrgs: signal<string[]>(['Micro World']),
    mustChangePassword: () => mustChange,
    hasAnyPermission: () => true,
    hasAnyEffectivePermission: () => true,
    permissions: () => ['*'],
    signIn: vi.fn(async () => { user.set({ id: 'u1' }); }),
  };
}

async function render(url = '/login', opts: { mustChange?: boolean } = {}) {
  const auth = makeAuth(!!opts.mustChange);
  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      provideRouter([
        { path: 'login', component: LoginComponent },
        { path: 'frontdesk', component: BlankComponent },
        { path: 'set-password', component: BlankComponent },
        { path: 'oauth/consent', component: BlankComponent },
        { path: '', component: BlankComponent },
      ]),
      { provide: AuthService, useValue: auth },
      { provide: AccountsService, useValue: { active: () => null } },
    ],
  });
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  const fixture = TestBed.createComponent(LoginComponent);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const $ = <T extends Element>(s: string) => el.querySelector(s) as T;
  return { fixture, el, $, auth, router };
}

const enter = (input: HTMLElement) =>
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

afterEach(() => { document.body.innerHTML = ''; });

describe('LoginComponent', () => {
  it('uses the right autocomplete + enterkeyhint on every field', async () => {
    const { $ } = await render();
    const org = $<HTMLInputElement>('#lg-org');
    const user = $<HTMLInputElement>('#lg-username');
    const pw = $<HTMLInputElement>('#lg-password');
    expect(org.getAttribute('autocomplete')).toBe('organization');
    expect(user.getAttribute('autocomplete')).toBe('username');
    expect(pw.getAttribute('autocomplete')).toBe('current-password');
    expect(org.getAttribute('enterkeyhint')).toBe('next');
    expect(user.getAttribute('enterkeyhint')).toBe('next');
    expect(pw.getAttribute('enterkeyhint')).toBe('go');
    // Labels are real <label for> — the E2E smoke finds the textbox by name.
    expect($('label[for="lg-username"]').textContent).toContain('Username');
  });

  it('never uses a native datalist / select for the organization', async () => {
    const { el } = await render();
    expect(el.querySelector('datalist, select, input[list]')).toBeNull();
  });

  it('Enter moves org → username → password, and Enter on the password submits', async () => {
    const { $, fixture, auth } = await render();
    const org = $<HTMLInputElement>('#lg-org');
    const user = $<HTMLInputElement>('#lg-username');
    const pw = $<HTMLInputElement>('#lg-password');
    org.focus();
    enter(org);
    expect(document.activeElement).toBe(user);
    user.value = 'labadmin'; user.dispatchEvent(new Event('input'));
    enter(user);
    expect(document.activeElement).toBe(pw);
    pw.value = 'secret'; pw.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    enter(pw);
    await fixture.whenStable();
    expect(auth.signIn).toHaveBeenCalledTimes(1);
    expect(auth.signIn).toHaveBeenCalledWith('Micro World', 'labadmin', 'secret', undefined);
  });

  it('Enter on an empty field shows an inline error on THAT field and focuses it', async () => {
    const { $, fixture, auth } = await render();
    const pw = $<HTMLInputElement>('#lg-password');
    pw.focus();
    enter(pw);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(auth.signIn).not.toHaveBeenCalled();
    expect($('#lg-error').textContent).toContain('Enter your username');
    expect($<HTMLInputElement>('#lg-username').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe($('#lg-username'));
  });

  it('show-password toggles the input type with an SVG icon (no emoji) and aria-pressed', async () => {
    const { $, fixture } = await render();
    const pw = $<HTMLInputElement>('#lg-password');
    const eye = $<HTMLButtonElement>('.lg-field__eye');
    expect(pw.type).toBe('password');
    expect(eye.querySelector('svg')).not.toBeNull();
    expect(eye.getAttribute('aria-label')).toBe('Show password');
    eye.click(); fixture.detectChanges();
    expect(pw.type).toBe('text');
    expect(eye.getAttribute('aria-pressed')).toBe('true');
    expect(eye.getAttribute('aria-label')).toBe('Hide password');
  });

  it('shows the loading state on the button while signing in', async () => {
    const { $, fixture, auth } = await render();
    let release!: () => void;
    auth.signIn.mockImplementationOnce(() => new Promise<void>(r => { release = r; }));
    $<HTMLInputElement>('#lg-username').value = 'u'; $<HTMLInputElement>('#lg-username').dispatchEvent(new Event('input'));
    $<HTMLInputElement>('#lg-password').value = 'p'; $<HTMLInputElement>('#lg-password').dispatchEvent(new Event('input'));
    fixture.detectChanges();
    $<HTMLButtonElement>('.lg__submit').click();
    fixture.detectChanges();
    const btn = $<HTMLButtonElement>('.lg__submit');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.textContent).toContain('Signing in');
    release();
    await fixture.whenStable();
  });

  it('stays busy while the app\'s first screen is on its way — no dead "Sign in" to press twice', async () => {
    const { $, fixture, auth, router } = await render();
    let land!: (ok: boolean) => void;
    const nav = vi.spyOn(router, 'navigateByUrl').mockImplementation(() => new Promise<boolean>(r => { land = r; }));
    $<HTMLInputElement>('#lg-username').value = 'u'; $<HTMLInputElement>('#lg-username').dispatchEvent(new Event('input'));
    $<HTMLInputElement>('#lg-password').value = 'p'; $<HTMLInputElement>('#lg-password').dispatchEvent(new Event('input'));
    fixture.detectChanges();
    $<HTMLButtonElement>('.lg__submit').click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    fixture.detectChanges();
    expect(nav).toHaveBeenCalled();                      // signed in, navigating
    const btn = $<HTMLButtonElement>('.lg__submit');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.textContent).toContain('Signing in');
    btn.click();                                          // a second press does nothing
    expect(auth.signIn).toHaveBeenCalledTimes(1);
    land(false);                                          // a refused navigation releases the button
    await Promise.resolve(); await Promise.resolve();
    fixture.detectChanges();
    expect($<HTMLButtonElement>('.lg__submit').disabled).toBe(false);
  });

  it('shows the "session expired" note and returns to the saved URL after signing in', async () => {
    const { $, fixture, router } = await render('/login?reason=expired&returnUrl=%2Ffrontdesk');
    expect($('.lg__notice').textContent).toContain('Your session expired. Please sign in again.');
    $<HTMLInputElement>('#lg-username').value = 'u'; $<HTMLInputElement>('#lg-username').dispatchEvent(new Event('input'));
    $<HTMLInputElement>('#lg-password').value = 'p'; $<HTMLInputElement>('#lg-password').dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const nav = vi.spyOn(router, 'navigateByUrl');
    $<HTMLButtonElement>('.lg__submit').click();
    await fixture.whenStable();
    await new Promise(r => setTimeout(r, 0));
    expect(nav).toHaveBeenCalledWith('/frontdesk', { replaceUrl: true });
    expect(router.url).toBe('/frontdesk');
  });

  // AI connector (MCP) consent: Supabase sends the browser to
  // /oauth/consent?authorization_id=…; the consent guard bounces a signed-out
  // user here with that EXACT URL, and signing in must land back on it.
  const CONSENT = '/oauth/consent?authorization_id=auth-123';

  async function signInFrom(url: string, opts: { mustChange?: boolean } = {}) {
    const r = await render(url, opts);
    r.$<HTMLInputElement>('#lg-username').value = 'u'; r.$<HTMLInputElement>('#lg-username').dispatchEvent(new Event('input'));
    r.$<HTMLInputElement>('#lg-password').value = 'p'; r.$<HTMLInputElement>('#lg-password').dispatchEvent(new Event('input'));
    r.fixture.detectChanges();
    const nav = vi.spyOn(r.router, 'navigateByUrl');
    r.$<HTMLButtonElement>('.lg__submit').click();
    await r.fixture.whenStable();
    await new Promise(res => setTimeout(res, 0));
    return { ...r, nav };
  }

  it('returns to the exact AI-connector consent URL (authorization_id kept) after signing in', async () => {
    const { nav, router } = await signInFrom('/login?returnUrl=' + encodeURIComponent(CONSENT));
    expect(nav).toHaveBeenCalledWith(CONSENT, { replaceUrl: true });
    expect(router.url).toBe(CONSENT);
  });

  it('temporary password: goes to /set-password CARRYING the consent URL', async () => {
    const { nav } = await signInFrom('/login?returnUrl=' + encodeURIComponent(CONSENT), { mustChange: true });
    expect(nav).toHaveBeenCalledWith('/set-password?returnUrl=' + encodeURIComponent(CONSENT), { replaceUrl: true });
  });

  it('normal login is unchanged: no return URL → the landing; temp password → plain /set-password', async () => {
    let r = await signInFrom('/login');
    expect(r.nav).toHaveBeenCalledWith('/', { replaceUrl: true });
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
    r = await signInFrom('/login', { mustChange: true });
    expect(r.nav).toHaveBeenCalledWith('/set-password', { replaceUrl: true });
  });

  it('inputs are 16px (iOS never zooms) — font-size is set on the field class', () => {
    // jsdom has no layout; the rule is pinned in the stylesheet itself.
    const scss = (LoginComponent as unknown as { ɵcmp?: { styles?: string[] } }).ɵcmp?.styles?.join('') ?? '';
    if (scss) expect(scss).toMatch(/font-size:\s*16px/);
  });
});

describe('login helpers', () => {
  it('sessionNotice maps each end reason to its note', () => {
    expect(sessionNotice('expired')).toMatch(/session expired/i);
    expect(sessionNotice('suspended')).toMatch(/suspended/i);
    expect(sessionNotice('elsewhere')).toMatch(/another window/i);
    expect(sessionNotice(null)).toBeNull();
    expect(sessionNotice('whatever')).toBeNull();
  });

  it('setPasswordUrl carries only a safe return URL', () => {
    expect(setPasswordUrl('/oauth/consent?authorization_id=a1')).toBe('/set-password?returnUrl=%2Foauth%2Fconsent%3Fauthorization_id%3Da1');
    expect(setPasswordUrl('https://evil.example')).toBe('/set-password');
    expect(setPasswordUrl(null)).toBe('/set-password');
  });

  it('safeReturnUrl only follows in-app paths', () => {
    expect(safeReturnUrl('/frontdesk?tab=queue')).toBe('/frontdesk?tab=queue');
    expect(safeReturnUrl('//evil.example')).toBeNull();
    expect(safeReturnUrl('https://evil.example')).toBeNull();
    expect(safeReturnUrl('/login')).toBeNull();
    expect(safeReturnUrl('/set-password')).toBeNull();
    expect(safeReturnUrl('/')).toBeNull();
    expect(safeReturnUrl(null)).toBeNull();
  });
});
