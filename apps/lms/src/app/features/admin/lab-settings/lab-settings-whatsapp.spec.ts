import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { renderBandPage } from '../admin-band.spec-helpers';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { LabSettingsComponent } from './lab-settings.component';

/**
 * Lab settings → Report → "Send WhatsApp automatically when the report is
 * ready" (Meta Cloud API). Tenant switch (server default OFF; paid orders only)
 * + "send again when a report is regenerated" (default OFF) +
 * template override; the sender line says whose number the patient sees, and
 * "Connect your WhatsApp number" (Embedded Signup) is disabled — coming soon.
 */
const providers = [
  {
    provide: AuthService,
    useValue: {
      user: () => ({ tenantName: 'Micro World', firstName: 'Admin', branchId: null, permissions: [] }),
      activeBranchId: () => null, hasPermission: () => true, hasAnyPermission: () => true,
      isAuthenticated: () => true, waitForAuth: async () => undefined,
    },
  },
  { provide: TenantStateService, useValue: { tenant: () => null, ensureLoaded: vi.fn(), update: vi.fn() } },
  { provide: BranchLabConfigService, useValue: { collectionMode: signal('front_desk'), billingMode: signal('front_desk'), ensureLoaded: vi.fn(), update: vi.fn() } },
  { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true, ensureLoaded: vi.fn() } },
];

const SETTINGS = (over: Record<string, unknown> = {}) => ({
  autoSendEnabled: false, sendUpdatedReports: true, templateName: null, templateLanguage: null,
  sender: { source: 'platform', displayName: 'Prefrontal', status: 'not_connected', tokenStored: false, canConnect: false },
  platform: { enabled: true, configured: true, webhookConfigured: true, defaultTemplateName: 'report_ready', defaultTemplateLanguage: 'en' },
  ...over,
});

function make(settings: unknown) {
  const p = renderBandPage(LabSettingsComponent, {
    getFor: (url) => url === '/api/whatsapp/settings' ? settings
      : url === '/api/tenants/branch-lab-config' ? { labStructure: 'auto' } : [],
    providers,
  });
  p.api.put.mockImplementation(((_url: string, body: Record<string, unknown>) => of({ ...(settings as object), ...body })) as never);
  p.cmp.tab.set('report');
  p.f.detectChanges();
  const card = () => p.el.querySelector<HTMLElement>('[data-testid="ls-whatsapp"]');
  const main = () => card()!.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Send WhatsApp automatically when the report is ready"]')!;
  return { ...p, card, main };
}

describe('Lab settings — WhatsApp auto-send', () => {
  it('is an ND switch card under the Report tab, OFF by default, shared sender, Connect disabled', () => {
    const p = make(SETTINGS());
    expect(p.card()).not.toBeNull();
    expect(p.main().classList.contains('nd-toggle')).toBe(true);
    expect(p.main().getAttribute('aria-checked')).toBe('false');
    expect(p.card()!.querySelector('[data-testid="ls-wa-sender"]')!.textContent).toContain('Prefrontal (shared)');
    const connect = p.card()!.querySelector<HTMLButtonElement>('[data-testid="ls-wa-connect"]')!;
    expect(connect.disabled).toBe(true);   // WhatsApp:EmbeddedSignupEnabled is off
    expect(p.card()!.textContent).toContain('Coming soon');
    // No native controls.
    expect(p.card()!.querySelector('select, datalist, input[type="checkbox"]')).toBeNull();
  });

  it('turning it on PUTs the settings and confirms', () => {
    const p = make(SETTINGS());
    p.main().click();
    p.f.detectChanges();
    expect(p.api.put).toHaveBeenCalledWith('/api/whatsapp/settings',
      { autoSendEnabled: true, sendUpdatedReports: true, templateName: null, templateLanguage: null });
    expect(p.main().getAttribute('aria-checked')).toBe('true');
    expect(p.toasts.success).toHaveBeenCalledWith('Reports will be sent on WhatsApp automatically once paid');
  });

  it('a connected lab number shows the lab\'s own name and hides Connect', () => {
    const p = make(SETTINGS({
      autoSendEnabled: true,
      sender: { source: 'tenant', displayName: 'Micro World Labs', status: 'connected', tokenStored: true, canConnect: false },
    }));
    expect(p.card()!.querySelector('[data-testid="ls-wa-sender"]')!.textContent).toContain('Micro World Labs (connected)');
    expect([...p.card()!.querySelectorAll('button')].some(b => b.textContent!.includes('Connect your WhatsApp number'))).toBe(false);
    // The token never reaches the page.
    expect(p.card()!.textContent).not.toMatch(/token/i);
  });

  it('warns when the shared sender is not configured on the server', () => {
    const p = make(SETTINGS({ platform: { enabled: true, configured: false, webhookConfigured: false, defaultTemplateName: 'report_ready', defaultTemplateLanguage: 'en' } }));
    expect(p.card()!.textContent).toContain("isn't set up on the server yet");
  });

  it('no permission / older server → no card', () => {
    const p = make([]);
    expect(p.card()).toBeNull();
  });

  it('with Embedded Signup enabled, Connect asks the server for the signed link and follows it', () => {
    const p = make(SETTINGS({ sender: { source: 'platform', displayName: 'Prefrontal', status: 'not_connected', tokenStored: false, canConnect: true } }));
    const assign = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, 'location', { value: { ...orig, assign }, configurable: true, writable: true });
    p.api.post.mockImplementation(((url: string) => url === '/api/whatsapp/onboarding/start'
      ? of({ connectUrl: 'https://api.example/api/whatsapp/onboarding/begin?state=abc', hostedUrl: 'https://business.facebook.com/x', redirectUri: 'r' })
      : of({})) as never);
    const connect = p.card()!.querySelector<HTMLButtonElement>('[data-testid="ls-wa-connect"]')!;
    expect(connect.disabled).toBe(false);
    connect.click();
    expect(p.api.post).toHaveBeenCalledWith('/api/whatsapp/onboarding/start', {});
    expect(assign).toHaveBeenCalledWith('https://api.example/api/whatsapp/onboarding/begin?state=abc');
    Object.defineProperty(window, 'location', { value: orig, configurable: true, writable: true });
  });

  it('says the message waits for payment, carries the PDF, and the regenerate re-send is a switch (off by default)', () => {
    const p = make(SETTINGS({ autoSendEnabled: true, sendUpdatedReports: false }));
    const text = p.card()!.textContent!;
    expect(text).toContain('fully paid');
    expect(text).toContain('On hold');
    expect(text).toContain('report PDF');
    expect(text).toContain('Partial reports are never sent');
    const regen = p.card()!.querySelector<HTMLButtonElement>('[data-testid="ls-wa-resend-regen"]')!;
    expect(regen.classList.contains('nd-toggle')).toBe(true);
    expect(regen.getAttribute('role')).toBe('switch');
    expect(regen.getAttribute('aria-checked')).toBe('false');
    expect(regen.textContent).toContain('regenerated');
    regen.click();
    p.f.detectChanges();
    expect(p.api.put).toHaveBeenCalledWith('/api/whatsapp/settings',
      { autoSendEnabled: true, sendUpdatedReports: true, templateName: null, templateLanguage: null });
  });
});
