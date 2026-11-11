import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BuilderStatusService, CORTEX_BUILDER_ON } from '../casesheets/studio/builder/builder-status.service';
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
  putGrant?: () => ReturnType<AiConnectorApi['putGrant']>;
  deleteGrant?: () => ReturnType<AiConnectorApi['deleteGrant']>;
  /** The case-sheet builder beta's lab switch "let connected apps build case sheets" (undefined = beta off). */
  caseSheetSwitch?: boolean;
} = {}) {
  const client = {
    getDetails: vi.fn(opts.details ?? (async () => DETAILS)),
    approve: vi.fn(opts.approve ?? (async () => ({ redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=abc&state=s' }))),
    deny: vi.fn(opts.deny ?? (async () => ({ redirect_url: 'https://claude.ai/api/mcp/auth_callback?error=access_denied&state=s' }))),
  };
  const calls: string[] = [];
  client.approve = vi.fn(async () => { calls.push('approve'); return (opts.approve ?? (async () => ({ redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=abc&state=s' })))(); });
  const connector = {
    get: vi.fn(opts.connector ?? (() => of(ON))), setEnabled: vi.fn(),
    putGrant: vi.fn((..._a: unknown[]) => { calls.push('put'); return (opts.putGrant ?? (() => of({})))(); }),
    deleteGrant: vi.fn((..._a: unknown[]) => { calls.push('delete'); return (opts.deleteGrant ?? (() => of({})))(); }),
  };
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
      { provide: CORTEX_BUILDER_ON, useValue: () => opts.caseSheetSwitch !== undefined },
      { provide: BuilderStatusService, useValue: { load: vi.fn(async () => undefined), status: signal(opts.caseSheetSwitch === undefined ? null : { cortex: true, connector: opts.caseSheetSwitch, connectorSwitch: opts.caseSheetSwitch, canChangeSwitch: true }) } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(id === null ? {} : { authorization_id: id }) } } },
    ],
  });
  const f = TestBed.createComponent(OAuthConsentPage);
  document.body.appendChild(f.nativeElement);
  return { f, client, connector, redirector, session, calls };
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

  it('lists what the app could see in five plain-words groups, and the never-promise', async () => {
    const { f } = setup();
    await settle(f);
    const titles = Array.from((f.nativeElement as HTMLElement).querySelectorAll('.pf-oc__grptitle')).map(e => e.textContent?.trim());
    expect(titles).toEqual([
      'Test catalogue & lab info',
      'Lab operations',
      'Billing totals — only for people who see money',
      'Patient results as codes — only when your lab’s privacy level allows',
      'Admin overview — for lab admins',
    ]);
    const text = f.nativeElement.textContent ?? '';
    expect(text).toContain('P-K7Q2X');
    expect(text).toContain('Never patient or staff names, phone numbers, exact ages or ID numbers, and never a patient’s or staff member’s address');
    expect(text).toContain('fewer than 5');
  });

  it('says what the lab allows about patients: Counts only by default (older server too), the real level when set', async () => {
    const a = setup();
    await settle(a.f);
    expect(a.f.nativeElement.textContent).toContain('About patients, your lab allows: Counts only.');
    expect(a.f.nativeElement.textContent).toContain('Questions about one patient (results, reports, a bill) are refused.');

    const b = setup({ connector: () => of({ ...ON, privacyLevel: 'results' as const }) });
    await settle(b.f);
    expect(b.f.nativeElement.textContent).toContain('About patients, your lab allows: Results, patients as codes.');
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
    expect(text).toContain('Your Test Master: tests, tubes, preparation, report times, normal ranges and critical limits (prices only for people who can already see them)');
    expect(text).not.toContain('micro-world.pf.local'); // never the synthetic auth email
    expect(qa(f, '.pf-btn--primary')).toHaveLength(1);
    expect(btn(f, 'Allow')?.classList).toContain('pf-btn--primary');
    expect(btn(f, 'Deny')).toBeTruthy();
    expect(client.getDetails).toHaveBeenCalledWith('auth-123');
    expect(client.approve).not.toHaveBeenCalled();
    expect(redirector.go).not.toHaveBeenCalled();
  });

  const SUGGEST_ON: AiConnectorState = { ...ON, proposals: true };
  const box = (f: { nativeElement: HTMLElement }) => q(f, '#pf-oc-suggest-opt') as HTMLButtonElement | null;

  it('the suggest checkbox is HIDDEN when the lab switch is off (or the older server says nothing), and the access chip stays Read only', async () => {
    for (const c of [ON, { ...ON, proposals: false }]) {
      const { f } = setup({ connector: () => of(c) });
      await settle(f);
      expect(box(f)).toBeNull();
      expect(f.nativeElement.textContent).not.toContain('Also let this app suggest Test Master and case sheet changes');
      expect(f.nativeElement.textContent).toContain('Read only');
    }
    // a request scope never turns it on: Supabase refuses custom scopes, the person decides here
    const scoped = setup({ details: async () => ({ ...DETAILS, scope: 'openid prefrontal:test_master.propose' }) });
    await settle(scoped.f);
    expect(box(scoped.f)).toBeNull();
  });

  it('the checkbox is hidden when the request carries no app id (the grant is per app) and when the lab is off', async () => {
    const noId = setup({ connector: () => of(SUGGEST_ON), details: async () => ({ ...DETAILS, client: { name: 'Claude' } }) });
    await settle(noId.f);
    expect(box(noId.f)).toBeNull();
    const off = setup({ connector: () => of({ ...SUGGEST_ON, enabled: false }) });
    await settle(off.f);
    expect(box(off.f)).toBeNull();
  });

  it('when the lab allows suggestions the checkbox shows, UNTICKED by default, with the promise in words', async () => {
    const { f } = setup({ connector: () => of(SUGGEST_ON) });
    await settle(f);
    const b = box(f)!;
    expect(b).toBeTruthy();
    expect(b.getAttribute('role')).toBe('checkbox');
    expect(b.getAttribute('aria-checked')).toBe('false');
    const text = f.nativeElement.textContent ?? '';
    expect(text).toContain('Also let this app suggest Test Master and case sheet changes');
    expect(text).toContain('Nothing is applied until someone with permission approves it in Prefrontal.');
    expect(text).toContain('Read only');
    b.click(); await settle(f);
    expect(b.getAttribute('aria-checked')).toBe('true');
    expect(f.nativeElement.textContent).toContain('Read and suggest');
    b.click(); await settle(f);
    expect(b.getAttribute('aria-checked')).toBe('false');
  });

  it('the SAME box shows when only the case sheet switch is on (one grant covers Test Master and case sheets)', async () => {
    const on = setup({ connector: () => of({ ...ON, proposals: false }), caseSheetSwitch: true });
    await settle(on.f);
    expect(box(on.f)).not.toBeNull();
    expect(on.f.nativeElement.textContent).toContain('Also let this app suggest Test Master and case sheet changes');
    const off = setup({ connector: () => of({ ...ON, proposals: false }), caseSheetSwitch: false });
    await settle(off.f);
    expect(box(off.f)).toBeNull();
  });

  it('ticked Allow WRITES the grant first and only then approves (in that order, grant for this app)', async () => {
    const { f, connector, client, calls, redirector } = setup({ connector: () => of(SUGGEST_ON) });
    await settle(f);
    box(f)!.click(); await settle(f);
    btn(f, 'Allow')!.click(); await settle(f);
    expect(connector.putGrant).toHaveBeenCalledWith('c1', true);
    expect(client.approve).toHaveBeenCalledWith('auth-123');
    expect(calls).toEqual(['put', 'approve']);
    expect(connector.deleteGrant).not.toHaveBeenCalled();
    expect(redirector.go).toHaveBeenCalled();
  });

  it('if approving FAILS after the grant was written, the grant is deleted again', async () => {
    const { f, connector, calls } = setup({ connector: () => of(SUGGEST_ON), approve: async () => { throw new ConsentError('unknown'); } });
    await settle(f);
    box(f)!.click(); await settle(f);
    btn(f, 'Allow')!.click(); await settle(f);
    expect(calls).toEqual(['put', 'approve', 'delete']);
    expect(connector.deleteGrant).toHaveBeenCalledWith('c1');
  });

  it('UNTICKED Allow on a reconnect writes propose=false (which removes an earlier grant), then approves', async () => {
    const { f, connector, calls } = setup({ connector: () => of(SUGGEST_ON) });
    await settle(f);
    btn(f, 'Allow')!.click(); await settle(f);
    expect(connector.putGrant).toHaveBeenCalledWith('c1', false);
    expect(calls).toEqual(['put', 'approve']);
    expect(connector.deleteGrant).not.toHaveBeenCalled();
  });

  it('if the choice cannot be saved, nothing is approved and the person is told', async () => {
    const { f, client, redirector } = setup({ connector: () => of(SUGGEST_ON), putGrant: () => throwError(() => new Error('down')) });
    await settle(f);
    box(f)!.click(); await settle(f);
    btn(f, 'Allow')!.click(); await settle(f);
    expect(client.approve).not.toHaveBeenCalled();
    expect(redirector.go).not.toHaveBeenCalled();
    expect(f.nativeElement.textContent).toContain('Couldn’t save your choice about suggestions');
    expect(btn(f, 'Allow')).toBeTruthy();   // can try again
  });

  it('Deny writes nothing, even with the box ticked; and a lab with the box hidden writes no grant on Allow', async () => {
    const a = setup({ connector: () => of(SUGGEST_ON) });
    await settle(a.f);
    box(a.f)!.click(); await settle(a.f);
    btn(a.f, 'Deny')!.click(); await settle(a.f);
    expect(a.connector.putGrant).not.toHaveBeenCalled();
    expect(a.connector.deleteGrant).not.toHaveBeenCalled();
    const b = setup();   // switch off: no box
    await settle(b.f);
    btn(b.f, 'Allow')!.click(); await settle(b.f);
    expect(b.connector.putGrant).not.toHaveBeenCalled();
    expect(b.client.approve).toHaveBeenCalled();
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
