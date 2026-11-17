import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { renderBandPage } from '../admin-band.spec-helpers';
import { AuthService } from '../../../core/auth/auth.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { CommunicationSettingsPage } from '../communication/communication-settings.page';
import { OrganizationSettingsComponent } from '../organization/organization-settings.component';
import { VendorsComponent } from '../vendors/vendors.component';
import { readFileSync } from 'node:fs';
import { SETTINGS_SHELL_CHILDREN } from '../settings/settings.routes';
import { PHARMACY_VIEW } from '../../opd/pharmacy/pharmacy-view';
import { ROUTE_ACCESS } from '../../../core/auth/route-access';

const route = (data: Record<string, unknown>) => ({ provide: ActivatedRoute, useValue: { snapshot: { data, queryParamMap: new Map() as any, paramMap: new Map() as any }, queryParamMap: of(new Map() as any) } });
afterEach(() => TestBed.resetTestingModule());

describe('Organization › Patient and order numbers (/admin/org/numbers)', () => {
  it('shows only Patient ID and Order ID — the Identity and Sample ID tabs are not here', () => {
    const p = renderBandPage(OrganizationSettingsComponent, { getFor: () => ({}), providers: [route({ orgTabs: ['patient', 'order'] })] });
    const tabs = Array.from(p.el.querySelectorAll('pf-hero-band .pf-hb__tools pf-segmented .seg-item')).map(b => b.getAttribute('aria-label'));
    expect(tabs).toEqual(['Patient ID', 'Order ID']);
    expect(p.cmp.tab()).toBe('patient');
    expect(p.el.textContent).toContain('Patient ID format');
    expect(p.el.textContent).not.toContain('Organization login handle');
    expect(p.el.textContent).not.toContain('Sample ID format');
  });

  it('Patient ID still saves the same payload', () => {
    const p = renderBandPage(OrganizationSettingsComponent, { getFor: () => ({}), providers: [route({ orgTabs: ['patient', 'order'] })] });
    p.cmp.savePatientId();
    expect(p.api.post).toHaveBeenCalledWith('/api/config/patient-id', expect.objectContaining({ datePrefix: 'ddmmyy', serialMode: 'numeric' }));
  });

  it('the old /admin/organization (no route data) keeps all four tabs', () => {
    const p = renderBandPage(OrganizationSettingsComponent, { getFor: () => ({}) });
    const tabs = Array.from(p.el.querySelectorAll('pf-hero-band .pf-hb__tools pf-segmented .seg-item')).map(b => b.getAttribute('aria-label'));
    expect(tabs).toEqual(['Identity', 'Patient ID', 'Sample ID', 'Order ID']);
  });
});

describe('Organization › Message channels (/admin/org/channels)', () => {
  const providers = (data: Record<string, unknown>) => [
    route(data),
    { provide: AuthService, useValue: { user: () => ({ tenantName: 'MW', permissions: [] }), activeBranchId: () => null, hasPermission: () => true, hasAnyPermission: () => true, isAuthenticated: () => true, waitForAuth: async () => undefined } },
    { provide: TenantStateService, useValue: { tenant: () => null, ensureLoaded: vi.fn(), update: vi.fn() } },
    { provide: BranchLabConfigService, useValue: { collectionMode: signal('front_desk'), billingMode: signal('front_desk'), ensureLoaded: vi.fn(), update: vi.fn() } },
    { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true, ensureLoaded: vi.fn() } },
  ];
  const WA = { autoSendEnabled: false, sendUpdatedReports: true, sender: { source: 'platform', displayName: 'Prefrontal', status: 'not_connected', tokenStored: false, canConnect: false },
    platform: { enabled: true, configured: true, webhookConfigured: true } };
  const make = (data: Record<string, unknown>) => renderBandPage(CommunicationSettingsPage, {
    getFor: (u) => u === '/api/whatsapp/settings' ? WA : u.includes('/settings/communication') ? { whatsapp: { auto: true, chat: true }, sms: { chat: true }, email: { enabled: true, mode: 'platform', ready: true } } : [],
    providers: providers(data),
  });

  it('the accounts stay (number, usage); what the lab SENDS (WhatsApp Auto, send again) lives in Lab › Report, not here', () => {
    const p = make({});
    p.f.detectChanges();
    expect(p.el.querySelector('[data-testid="ls-whatsapp"]')).toBeNull();
    expect(p.el.textContent).not.toContain('send the report automatically when it is ready');
    expect(p.el.querySelector('[data-testid="ls-wa-connect-card"]')).not.toBeNull();
    expect(p.el.querySelector('[data-testid="ls-wa-chat"]')).not.toBeNull();
  });

  it('email sender / SMTP and SMS are still on their tabs', () => {
    const p = make({});
    p.cmp.tab.set('email'); p.f.detectChanges();
    expect(p.el.querySelector('[data-testid="cm-email"]')).not.toBeNull();
    p.cmp.tab.set('sms'); p.f.detectChanges();
    expect(p.el.querySelector('[data-testid="cm-sms"]')).not.toBeNull();
  });

});

describe('Credit accounts — setup in Billing, money on Finance', () => {
  const vendor = { id: 'v1', name: 'Apollo Hospital', code: 'APOLLO', isActive: true, totalCredit: 0, usedCredit: 0, outstanding: 500, createdAt: '2026-01-01' };
  const make = (data: Record<string, unknown>) => renderBandPage(VendorsComponent, {
    getFor: (u) => (u.startsWith('/api/vendors') && !u.includes('/transactions') ? [vendor] : []),
    providers: [route(data)],
  });
  const labels = (el: HTMLElement) => Array.from(el.querySelectorAll('.pf-rowact__t')).map(e => e.textContent!.trim());

  it('setup view: add and deactivate only — no top up, payment, statement or history', () => {
    const p = make({ creditView: 'setup' });
    expect(labels(p.el)).toEqual(['Deactivate']);
    expect(p.actions().some(b => b.textContent?.includes('Add vendor'))).toBe(true);
  });

  it('money view: top up, record payment, email statement, history — and no Add vendor', () => {
    const p = make({ creditView: 'money' });
    expect(labels(p.el)).toEqual(['Top up', 'Record payment', 'Email statement', 'View history']);
    expect(p.actions().some(b => b.textContent?.includes('Add vendor'))).toBe(false);
    p.cmp.toggleNewVendor();
    p.f.detectChanges();
    expect(p.el.querySelector('.pf-vn-new')).toBeNull();
  });

  it('the old Vendor Wallets page (no data) shows both, and the money APIs are unchanged', () => {
    const p = make({});
    expect(labels(p.el)).toContain('Top up');
    expect(labels(p.el)).toContain('Deactivate');
    p.cmp.openTopUp(vendor);
    p.cmp.topUpAmount.set('1000');
    p.cmp.confirmTopUp(vendor);
    expect(p.api.post).toHaveBeenCalledWith('/api/vendors/v1/topup', expect.objectContaining({ amount: 1000 }));
  });
});

describe('Settings re-home routes (hosted by the Settings shell; one route table)', () => {
  const by = (path: string) => SETTINGS_SHELL_CHILDREN.find(r => r.path === path)!;
  it('declares every routed page the left panel needs, once', () => {
    for (const p of ['admin/org/profile', 'admin/org/numbers', 'admin/org/channels', 'admin/billing', 'admin/ipd/alerts', 'admin/pharmacy', 'admin/pharmacy/drugs', 'admin/opd/front-desk']) {
      expect(SETTINGS_SHELL_CHILDREN.filter(r => r.path === p).length, p).toBe(1);
    }
  });
  it('every page is guarded (nothing opens without a permission or module gate)', () => {
    for (const p of ['admin/org/profile', 'admin/org/numbers', 'admin/org/channels', 'admin/billing', 'admin/ipd/alerts', 'admin/pharmacy', 'admin/pharmacy/drugs']) {
      expect(by(p).canActivate?.length, p).toBeGreaterThan(0);
    }
  });
  it('the OPD and pharmacy pages are behind the OPD gate; IPD alerts behind the case-sheet gate', () => {
    expect(by('admin/pharmacy').canActivate!.some(g => (g as any).opdGate)).toBe(true);
    expect(by('admin/pharmacy/drugs').canActivate!.some(g => (g as any).opdGate)).toBe(true);
    expect(by('admin/ipd/alerts').canActivate!.length).toBeGreaterThanOrEqual(2);
  });
  it('route data pins what each reused screen shows', () => {
    expect(by('admin/org/numbers').data).toEqual({ orgTabs: ['patient', 'order'] });
    expect(by('admin/ipd/alerts').data).toEqual({ department: 'ipd' });
    expect(by('admin/pharmacy/drugs').data?.[PHARMACY_VIEW]).toBe('drugs');
    expect(readFileSync('apps/lms/src/app/app.routes.ts', 'utf8')).toMatch(/path: 'finance\/credit-accounts',[\s\S]{0,120}data: \{ creditView: 'money' \}/);
  });
  it('the access table has an entry for each guarded page', () => {
    for (const p of ['/admin/org/profile', '/admin/org/numbers', '/admin/org/channels', '/finance/credit-accounts', '/admin/ipd/alerts']) {
      expect(ROUTE_ACCESS[p], p).toBeTruthy();
    }
  });
});
