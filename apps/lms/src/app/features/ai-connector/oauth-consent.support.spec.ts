import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { SessionService } from '../../core/auth/session.service';
import { NavBackService } from '../../core/services/nav-back.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { BetaFeaturesService } from '../../core/services/beta-features.service';
import { AiConnectorApi, AiConnectorState } from './ai-connector.api';
import { ConsentRedirector } from './consent-redirect';
import { OAuthConsentClient } from './oauth-consent.client';
import { OAuthConsentPage } from './oauth-consent.page';
import { SupportWhoami, isSupportTenantName } from './support-whoami';

/**
 * Consent page for Prefrontal Support (beta `support`): when the SERVER says
 * the signed-in person is in the Prefrontal Support tenant (wording only), the page says
 * "Prefrontal Support access" in plain words and Allow does not depend on the
 * support tenant's own AI-connector switch. Otherwise the normal wording.
 */
@Component({ template: '' })
class BlankComponent {}

const DETAILS = {
  authorization_id: 'auth-123',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  client: { id: 'c1', name: 'Claude' },
  user: { id: 'u-auth', email: 'eng@gmail.com' },
  scope: 'openid profile email',
};
const OFF: AiConnectorState = { enabled: false, connectorUrl: '', labName: 'Prefrontal Support' };

function setup(o: { isSupport: boolean }) {
  TestBed.resetTestingModule();
  const client = {
    getDetails: vi.fn(async () => DETAILS),
    approve: vi.fn(async () => ({ redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=abc' })),
    deny: vi.fn(async () => ({ redirect_url: 'https://claude.ai/api/mcp/auth_callback?error=access_denied' })),
  };
  TestBed.configureTestingModule({
    imports: [OAuthConsentPage],
    providers: [
      provideRouter([{ path: '**', component: BlankComponent }]),
      { provide: OAuthConsentClient, useValue: client },
      { provide: AiConnectorApi, useValue: { get: () => of(OFF), setEnabled: vi.fn() } },
      { provide: ConsentRedirector, useValue: { go: vi.fn() } },
      { provide: SessionService, useValue: { expire: vi.fn() } },
      { provide: SupportWhoami, useValue: { isSupport: async () => o.isSupport } },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1', displayName: 'Support Engineer', tenantName: 'Prefrontal Support' }) } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Prefrontal Support' }) } },
      { provide: NavBackService, useValue: { showBack: () => false, back: vi.fn() } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ authorization_id: 'auth-123' }) } } },
    ],
  });
  const f = TestBed.createComponent(OAuthConsentPage);
  document.body.appendChild(f.nativeElement);
  return { f, client };
}

async function settle(f: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  f.detectChanges();
  for (let i = 0; i < 5; i++) { await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); }
  await f.whenStable();
  f.detectChanges();
}

const btn = (el: HTMLElement, label: string) =>
  Array.from(el.querySelectorAll('button')).find(b => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

afterEach(() => { document.body.innerHTML = ''; });

describe('OAuthConsentPage — Prefrontal Support', () => {
  it('support user: "Prefrontal Support access" wording; Allow without the lab AI switch; approve on Allow only', async () => {
    const { f, client } = setup({ isSupport: true });
    await settle(f);
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Prefrontal Support access');
    expect(el.querySelector('[data-testid="support-consent"]')?.textContent).toContain('Prefrontal Support');
    expect(el.textContent).toContain('the lab allows or denies each change on the PC');
    expect(el.textContent).not.toContain('hasn’t turned on AI connectors');
    expect(el.textContent).toContain('Support sessions');
    expect(client.approve).not.toHaveBeenCalled();
    btn(el, 'Allow')!.click();
    await settle(f);
    expect(client.approve).toHaveBeenCalledWith('auth-123');
  });

  it('not support: the normal wording, and the lab switch OFF still means Deny only', async () => {
    const { f } = setup({ isSupport: false });
    await settle(f);
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Connect an app');
    expect(el.textContent).not.toContain('Prefrontal Support access');
    expect(el.textContent).toContain('hasn’t turned on AI connectors');
    expect(btn(el, 'Allow')).toBeUndefined();
  });
});

describe('SupportWhoami', () => {
  it('only the "Prefrontal Support" tenant name counts', () => {
    expect(isSupportTenantName('Prefrontal Support')).toBe(true);
    expect(isSupportTenantName('  prefrontal   support ')).toBe(true);
    expect(isSupportTenantName('Prefrontal Support Lab')).toBe(false);
    expect(isSupportTenantName('Micro World')).toBe(false);
    expect(isSupportTenantName(undefined)).toBe(false);
  });

  it('beta off ⇒ false; on ⇒ the signed-in tenant decides; no session ⇒ false', async () => {
    const run = async (enabled: boolean, tenantName?: string) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [
        { provide: BetaFeaturesService, useValue: { ensureLoaded: async () => undefined, enabled: () => enabled } },
        { provide: AuthService, useValue: { user: () => (tenantName ? { tenantName } : null) } },
      ] });
      return TestBed.inject(SupportWhoami).isSupport();
    };
    expect(await run(false, 'Prefrontal Support')).toBe(false);
    expect(await run(true, 'Prefrontal Support')).toBe(true);
    expect(await run(true, 'Micro World')).toBe(false);
    expect(await run(true)).toBe(false);
  });
});
