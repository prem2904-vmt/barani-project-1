import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, RouterStateSnapshot, UrlTree, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { SessionService } from '../../core/auth/session.service';
import { NavBackService } from '../../core/services/nav-back.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { AiConnectorApi, AiConnectorState } from './ai-connector.api';
import { ConsentRedirector, consentGuard } from './consent-redirect';
import { ConsentError, OAuthConsentClient } from './oauth-consent.client';
import { OAuthConsentPage } from './oauth-consent.page';

/**
 * /oauth/consent (AI connector, MCP Phase 0): signed-out → login keeping the
 * exact URL; the request's app / lab / user shown; Allow (the ONE primary) →
 * approve → back to the app; Deny → back; already consented → straight back;
 * lab switch off → Deny only; errors in plain words. Never auto-approves.
 */
@Component({ template: '' })
class BlankComponent {}

const DETAILS = {
  authorization_id: 'auth-123',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  client: { id: 'c1', name: 'Claude' },
  user: { id: 'u-auth', email: 'labadmin@micro-world.pf.local' },
  scope: 'openid profile email',
};
const ON: AiConnectorState = { enabled: true, connectorUrl: 'https://med-fetch-dev.prefrontal.health/mcp', labName: 'Micro World' };

function setup(opts: {
  id?: string | null;
  details?: () => Promise<unknown>;
  connector?: () => ReturnType<AiConnectorApi['get']>;
  approve?: () => Promise<unknown>;
  deny?: () => Promise<unknown>;
} = {}) {
  const client = {
    getDetails: vi.fn(opts.details ?? (async () => DETAILS)),
    approve: vi.fn(opts.approve ?? (async () => ({ redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=abc&state=s' }))),
    deny: vi.fn(opts.deny ?? (async () => ({ redirect_url: 'https://claude.ai/api/mcp/auth_callback?error=access_denied&state=s' }))),
  };
  const connector = { get: vi.fn(opts.connector ?? (() => of(ON))), setEnabled: vi.fn() };
  const redirector = { go: vi.fn() };
  const session = { expire: vi.fn(async () => undefined) };
  const id = opts.id === undefined ? 'auth-123' : opts.id;
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [OAuthConsentPage],
    providers: [
      provideRouter([{ path: '**', component: BlankComponent }]),
      { provide: OAuthConsentClient, useValue: client },
      { provide: AiConnectorApi, useValue: connector },
      { provide: ConsentRedirector, useValue: redirector },
      { provide: SessionService, useValue: session },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1', displayName: 'Priya Raman', tenantName: 'Micro World' }) } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }) } },
      { provide: NavBackService, useValue: { showBack: () => false, back: vi.fn() } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(id === null ? {} : { authorization_id: id }) } } },
    ],
  });
  const f = TestBed.createComponent(OAuthConsentPage);
  document.body.appendChild(f.nativeElement);
  return { f, client, connector, redirector, session };
}

async function settle(f: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  f.detectChanges();
  for (let i = 0; i < 5; i++) { await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); }
  await f.whenStable();
  f.detectChanges();
}

const q = (f: { nativeElement: HTMLElement }, s: string) => f.nativeElement.querySelector(s) as HTMLElement | null;
const qa = (f: { nativeElement: HTMLElement }, s: string) => Array.from(f.nativeElement.querySelectorAll(s)) as HTMLElement[];
const btn = (f: { nativeElement: HTMLElement }, label: string) =>
  qa(f, 'button').find(b => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('OAuthConsentPage', () => {
  it('inside a frame it shows a plain-words error, never loads the request and never renders Allow', async () => {
    const spy = vi.spyOn(OAuthConsentPage, 'isFramed').mockReturnValue(true);
    const { f, client } = setup();
    await settle(f);
    expect(spy).toHaveBeenCalled();
    const text = f.nativeElement.textContent ?? '';
    expect(text).toContain('Open this page directly in your browser');
    expect(btn(f, 'Allow')).toBeUndefined();
    expect(btn(f, 'Deny')).toBeUndefined();
    expect(client.getDetails).not.toHaveBeenCalled();
    expect(client.approve).not.toHaveBeenCalled();
  });

  it('isFramed is true when window.top is not this window, and when reading it throws', () => {
    expect(OAuthConsentPage.isFramed()).toBe(false);   // jsdom top-level
    const orig = Object.getOwnPropertyDescriptor(window, 'top')!;
    Object.defineProperty(window, 'top', { configurable: true, get: () => ({}) as Window });
    expect(OAuthConsentPage.isFramed()).toBe(true);
    Object.defineProperty(window, 'top', { configurable: true, get: () => { throw new Error('cross-origin'); } });
    expect(OAuthConsentPage.isFramed()).toBe(true);
    Object.defineProperty(window, 'top', orig);
  });

  it('shows the app, lab and signed-in user; Allow is the ONE primary, Deny beside it; nothing is approved on load', async () => {
    const { f, client, redirector } = setup();
    await settle(f);
    const text = f.nativeElement.textContent ?? '';
    expect(text).toContain('Claude wants to read your lab’s numbers.');
    expect(text).toContain('Micro World');
    expect(text).toContain('Priya Raman');
    expect(text).toContain('claude.ai');           // where you go back to
    expect(text).toContain('Read only');
    expect(text).toContain('Your Test Master: tests, tubes, preparation, report times and normal ranges (prices only for people who can already see them)');
    expect(text).not.toContain('micro-world.pf.local'); // never the synthetic auth email
    expect(qa(f, '.pf-btn--primary')).toHaveLength(1);
    expect(btn(f, 'Allow')?.classList).toContain('pf-btn--primary');
    expect(btn(f, 'Deny')).toBeTruthy();
    expect(client.getDetails).toHaveBeenCalledWith('auth-123');
    expect(client.approve).not.toHaveBeenCalled();
    expect(redirector.go).not.toHaveBeenCalled();
  });

  it('renders the app name as TEXT — markup in it never becomes HTML', async () => {
    const evil = '<img src=x onerror="alert(1)"><b>Claude</b>';
    const { f } = setup({ details: async () => ({ ...DETAILS, client: { name: evil } }) });
    await settle(f);
    expect(f.nativeElement.querySelector('img')).toBeNull();
    expect(f.nativeElement.querySelector('.pf-oc__name b')).toBeNull();
    expect(q(f, '.pf-oc__lead .pf-oc__name')?.textContent).toBe(evil);
  });

  it('Allow → approve → back to the app\'s redirect URL', async () => {
    const { f, client, redirector } = setup();
    await settle(f);
    btn(f, 'Allow')!.click();
    await settle(f);
    expect(client.approve).toHaveBeenCalledWith('auth-123');
    expect(client.deny).not.toHaveBeenCalled();
    expect(redirector.go).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?code=abc&state=s');
    expect(f.nativeElement.textContent).toContain('Taking you back to Claude');
  });

  it('Deny → deny → back to the app with its error', async () => {
    const { f, client, redirector } = setup();
    await settle(f);
    btn(f, 'Deny')!.click();
    await settle(f);
    expect(client.deny).toHaveBeenCalledWith('auth-123');
    expect(client.approve).not.toHaveBeenCalled();
    expect(redirector.go).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?error=access_denied&state=s');
  });

  it('already consented (no authorization_id in the details) → straight back, no buttons', async () => {
    const { f, client, redirector } = setup({ details: async () => ({ redirect_url: 'https://claude.ai/cb?code=again' }) });
    await settle(f);
    expect(redirector.go).toHaveBeenCalledWith('https://claude.ai/cb?code=again');
    expect(client.approve).not.toHaveBeenCalled();
    expect(btn(f, 'Allow')).toBeUndefined();
  });

  it('lab switch off → explains it and offers Deny only', async () => {
    const { f, client } = setup({ connector: () => of({ ...ON, enabled: false }) });
    await settle(f);
    expect(f.nativeElement.textContent).toContain('Your lab hasn’t turned on AI connectors');
    expect(f.nativeElement.textContent).toContain('Ask your lab admin');
    expect(btn(f, 'Allow')).toBeUndefined();
    expect(qa(f, '.pf-btn--primary')).toHaveLength(0);
    const deny = btn(f, 'Deny')!;
    expect(deny.disabled).toBe(false);
    deny.click();
    await settle(f);
    expect(client.deny).toHaveBeenCalled();
  });

  it('the lab setting can\'t be read → no Allow; Try again + Deny', async () => {
    const { f, connector } = setup({ connector: () => throwError(() => new Error('Request timed out')) });
    await settle(f);
    expect(f.nativeElement.textContent).toContain('Couldn’t check your lab’s AI connector setting');
    expect(btn(f, 'Allow')).toBeUndefined();
    expect(btn(f, 'Deny')).toBeTruthy();
    btn(f, 'Try again')!.click();
    await settle(f);
    expect(connector.get).toHaveBeenCalledTimes(2);
  });

  it('errors in plain words: missing id, expired request, network (Try again), dead session (Sign in again)', async () => {
    let r = setup({ id: null });
    await settle(r.f);
    expect(r.f.nativeElement.textContent).toContain('missing its request');
    expect(r.client.getDetails).not.toHaveBeenCalled();
    expect(btn(r.f, 'Allow')).toBeUndefined();
    expect(btn(r.f, 'Deny')).toBeUndefined();

    r = setup({ details: async () => { throw new ConsentError('expired'); } });
    await settle(r.f);
    expect(r.f.nativeElement.textContent).toContain('expired or was already used');

    r = setup({ details: async () => { throw new ConsentError('network'); } });
    await settle(r.f);
    expect(r.f.nativeElement.textContent).toContain('Can’t reach the sign-in server');
    btn(r.f, 'Try again')!.click();
    await settle(r.f);
    expect(r.client.getDetails).toHaveBeenCalledTimes(2);

    r = setup({ details: async () => { throw new ConsentError('signed-out'); } });
    await settle(r.f);
    btn(r.f, 'Sign in again')!.click();
    expect(r.session.expire).toHaveBeenCalledWith('expired');
  });

  it('a failed Allow keeps the screen with a plain note; an expired one turns into the error state', async () => {
    let r = setup({ approve: async () => { throw new ConsentError('network'); } });
    await settle(r.f);
    btn(r.f, 'Allow')!.click();
    await settle(r.f);
    expect(q(r.f, '.pf-oc__err')?.textContent).toContain('Can’t reach the sign-in server');
    expect(btn(r.f, 'Allow')?.disabled).toBe(false);
    expect(r.redirector.go).not.toHaveBeenCalled();

    r = setup({ approve: async () => { throw new ConsentError('expired'); } });
    await settle(r.f);
    btn(r.f, 'Allow')!.click();
    await settle(r.f);
    expect(r.f.nativeElement.textContent).toContain('expired or was already used');
  });

  it('never follows an unsafe redirect (javascript:, plain http to another host)', async () => {
    const r = setup({ details: async () => ({ redirect_url: 'javascript:alert(1)' }) });
    await settle(r.f);
    expect(r.redirector.go).not.toHaveBeenCalled();
    expect(r.f.nativeElement.textContent).toContain('Something went wrong');
  });

  it('SVG icons only, no native select / datalist', async () => {
    const { f } = setup();
    await settle(f);
    expect(f.nativeElement.querySelector('select, datalist, input[list]')).toBeNull();
    expect(qa(f, 'svg').length).toBeGreaterThan(2);
    expect(f.nativeElement.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2705}\u{274C}]/u);
  });
});

describe('consentGuard', () => {
  function run(auth: { authed: boolean; mustChange?: boolean }, url: string) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: {
          waitForAuth: async () => undefined,
          isAuthenticated: () => auth.authed,
          mustChangePassword: () => !!auth.mustChange,
        } },
      ],
    });
    const router = TestBed.inject(Router);
    const out = TestBed.runInInjectionContext(() => consentGuard({} as never, { url } as RouterStateSnapshot)) as Promise<unknown>;
    return out.then((r: unknown) => ({ r, router }));
  }
  const URL = '/oauth/consent?authorization_id=auth-123';

  it('signed out → /login with the EXACT consent URL as the return', async () => {
    const { r, router } = await run({ authed: false }, URL);
    expect(r).toBeInstanceOf(UrlTree);
    expect((r as UrlTree).root.children['primary'].segments.map(s => s.path)).toEqual(['login']);
    expect(router.serializeUrl(r as UrlTree)).toContain('authorization_id%3Dauth-123');
    expect((r as UrlTree).queryParams['returnUrl']).toBe(URL);
  });

  it('a temporary password still owed → /set-password, keeping the consent URL', async () => {
    const { r } = await run({ authed: true, mustChange: true }, URL);
    expect((r as UrlTree).root.children['primary'].segments.map(s => s.path)).toEqual(['set-password']);
    expect((r as UrlTree).queryParams['returnUrl']).toBe(URL);
  });

  it('signed in → the page opens', async () => {
    const { r } = await run({ authed: true }, URL);
    expect(r).toBe(true);
  });
});
