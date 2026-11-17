import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { renderBandPage } from '../admin-band.spec-helpers';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { WaSettingsSectionComponent } from './wa-settings-section.component';

/**
 * Settings → Communication → WhatsApp (moved from Lab settings → Report, 2026-11-13) →
 * "Send WhatsApp automatically when the report is ready" (Meta Cloud API). Tenant switch (server default OFF; paid orders only)
 * + "send again when a report is regenerated" (default OFF) +
 * template override; the sender line says whose number the patient sees. The
 * lab's OWN number (Embedded Signup) lives in the "Your WhatsApp number" card
 * right below (wa-connect-card.spec.ts covers its states and the SDK flow).
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
  const p = renderBandPage(WaSettingsSectionComponent, {
    getFor: (url) => url === '/api/whatsapp/settings' ? settings
      : url === '/api/tenants/branch-lab-config' ? { labStructure: 'auto' } : [],
    providers,
  });
  p.api.put.mockImplementation(((_url: string, body: Record<string, unknown>) => of({ ...(settings as object), ...body })) as never);
  p.f.detectChanges();
  const card = () => p.el.querySelector<HTMLElement>('[data-testid="ls-whatsapp"]');
  return { ...p, card };
}

/** Message channels → WhatsApp: the ACCOUNT (the lab's number, usage, WhatsApp Chat). What the lab SENDS
 *  (WhatsApp Auto, send again, the report message) lives in Lab › Report, never here. */
describe('Message channels → WhatsApp account', () => {
  it('has the number card and WhatsApp Chat, and no WhatsApp Auto / send-again card', () => {
    const p = make(SETTINGS());
    expect(p.card()).toBeNull();
    expect(p.el.textContent).not.toContain('send the report automatically');
    expect(p.el.querySelector('[data-testid="ls-wa-resend-regen"]')).toBeNull();
    const numberCard = p.el.querySelector<HTMLElement>('[data-testid="ls-wa-connect-card"]')!;
    expect(numberCard.getAttribute('data-state')).toBe('not_connected');
    expect(numberCard.querySelector('[data-testid="wac-connect"]')).toBeNull();
    expect(document.getElementById('pf-facebook-jssdk')).toBeNull();
    expect(p.el.querySelector('select, datalist, input[type="checkbox"]')).toBeNull();
  });

  it('a connected lab number says Connected; the token never reaches the page', () => {
    const p = make(SETTINGS({
      autoSendEnabled: true,
      sender: { source: 'tenant', state: 'connected', displayName: 'Micro World Labs', status: 'connected', tokenStored: true, phoneNumberId: 'pn-1', canConnect: false },
    }));
    expect(p.el.querySelector<HTMLElement>('[data-testid="ls-wa-connect-card"]')!.getAttribute('data-state')).toBe('connected');
    expect([...p.el.querySelectorAll('button')].some(b => b.textContent!.includes('Connect WhatsApp'))).toBe(false);
    expect(p.el.textContent).not.toMatch(/token/i);
  });

  it('no permission / older server: a plain line instead', () => {
    const p = make([]);
    expect(p.el.querySelector('[data-testid="ls-wa-none"]')).not.toBeNull();
  });

  it('shows WhatsApp Chat (a platform switch) read-only, on or off', () => {
    const p = make(SETTINGS());
    expect(p.el.querySelector('[data-testid="ls-wa-chat-state"]')!.textContent!.trim()).toBe('On');
    p.f.componentRef.setInput('chatOn', false);
    p.f.detectChanges();
    expect(p.el.querySelector('[data-testid="ls-wa-chat-state"]')!.textContent!.trim()).toBe('Off');
    expect(p.el.querySelector('[data-testid="ls-wa-chat"]')!.textContent).toContain('ask Prefrontal');
    expect(p.el.querySelector('[data-testid="ls-wa-chat"] button[role="switch"]')).toBeNull();
  });
});
